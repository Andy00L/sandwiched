import { readFileSync } from "node:fs";
import { Connection, type Keypair } from "@solana/web3.js";
import { findTestMintAddress } from "./addresses";
import { BASE_RPC_URL } from "./config";
import { restoreKeypair } from "./guest-key";
import { type RateLimits, type RateWindow, decideRate, pruneRateWindows } from "./rate-limit";
import { type Result, attempt, attemptSync, failure, success } from "./result";
import { parseSponsorRequest, reviewSponsoredTransaction } from "./sponsor-policy";

export const SPONSOR_KEYPAIR_PATH_ENV = "SANDWICH_SPONSOR_KEYPAIR_PATH";
export const SPONSOR_MIN_LAMPORTS = 200_000_000;
export const MAX_SPONSOR_BODY_BYTES = 4_096;

const HOUR_MS = 3_600_000;
const SPONSOR_RATE_LIMITS: RateLimits = {
  perIp: { limit: 60, windowMs: HOUR_MS },
  perWallet: { limit: 12, windowMs: HOUR_MS },
};
const PRUNE_ABOVE_ENTRIES = 1_000;

export type SponsorReply = { status: number; body: Record<string, string | number | boolean> };

export type SponsorService = {
  describe: () => Promise<SponsorReply>;
  sponsor: (body: unknown, ip: string) => Promise<SponsorReply>;
};

const refuse = (status: number, reason: string): SponsorReply => ({ status, body: { reason } });

const loadSponsorKeypair =(path: string | undefined): Result<Keypair> => {
  if (path === undefined || path === "") return failure(`${SPONSOR_KEYPAIR_PATH_ENV} is not set`);
  const text = attemptSync(() => readFileSync(path, "utf8"));
  if (!text.ok) return failure("the sponsor keypair file cannot be read");
  const parsed = attemptSync((): unknown => JSON.parse(text.value));
  const keypair = parsed.ok ? restoreKeypair(parsed.value) : null;
  return keypair === null ? failure("the sponsor keypair file does not hold a keypair") : success(keypair);
};

export const readClientIp = (headers: Headers): string =>
  headers.get("x-forwarded-for")?.split(",")[0]?.trim() || headers.get("x-real-ip")?.trim() || "unknown";

export type SponsorConnection = Pick<Connection, "getBalance" | "sendRawTransaction">;

export const createSponsorService = (
  keypair: Keypair,
  connection: SponsorConnection,
  readNowMs: () => number = Date.now,
): SponsorService => {
  const policy = { sponsor: keypair.publicKey, testMint: findTestMintAddress() };
  const longestWindowMs = Math.max(SPONSOR_RATE_LIMITS.perIp.windowMs, SPONSOR_RATE_LIMITS.perWallet.windowMs);
  let rateWindows = new Map<string, RateWindow>();

  const readBalance = () => attempt(() => connection.getBalance(keypair.publicKey, "confirmed"));

  const describe = async (): Promise<SponsorReply> => {
    const balance = await readBalance();
    if (!balance.ok) return refuse(502, "the sponsor balance cannot be read");
    return {
      status: 200,
      body: { sponsor: keypair.publicKey.toBase58(), isAccepting: balance.value >= SPONSOR_MIN_LAMPORTS, lamports: balance.value },
    };
  };

  const sponsorTransaction = async (body: unknown, ip: string): Promise<SponsorReply> => {
    const parsed = parseSponsorRequest(body);
    if (!parsed.ok) return refuse(400, parsed.reason);
    const transaction = parsed.value;
    const review = reviewSponsoredTransaction(transaction, policy);
    if (!review.ok) return refuse(400, review.reason);
    const nowMs = readNowMs();
    if (rateWindows.size > PRUNE_ABOVE_ENTRIES) rateWindows = pruneRateWindows(rateWindows, nowMs, longestWindowMs);
    const decision = decideRate(rateWindows, { ip, wallet: review.value.wallet?.toBase58() ?? null }, nowMs, SPONSOR_RATE_LIMITS);
    if (!decision.isAllowed) {
      return { status: 429, body: { reason: `too many sponsored transactions for this ${decision.scope}`, retryAfterMs: decision.retryAfterMs } };
    }
    rateWindows = decision.windows;
    const balance = await readBalance();
    if (!balance.ok) return refuse(502, "the sponsor balance cannot be read");
    if (balance.value < SPONSOR_MIN_LAMPORTS) return refuse(503, "the sponsor is low on SOL, connect a wallet");
    const signed = attemptSync(() => transaction.partialSign(keypair));
    if (!signed.ok || !transaction.verifySignatures()) return refuse(400, "the transaction is missing a signature or carries an invalid one");
    const sent = await attempt(() => connection.sendRawTransaction(transaction.serialize(), { preflightCommitment: "confirmed" }));
    if (!sent.ok) return refuse(502, `the transaction failed preflight: ${sent.reason.slice(0, 300)}`);
    console.log(`[sponsorTransaction] ${review.value.labels.join("+")} for ${review.value.wallet?.toBase58() ?? "no wallet"}: ${sent.value}`);
    return { status: 200, body: { signature: sent.value } };
  };

  return { describe, sponsor: sponsorTransaction };
};

let cachedService: SponsorService | null = null;

export const resolveSponsorService = (): Result<SponsorService> => {
  if (cachedService !== null) return success(cachedService);
  const keypair = loadSponsorKeypair(process.env[SPONSOR_KEYPAIR_PATH_ENV]);
  if (!keypair.ok) return failure(`[resolveSponsorService] ${keypair.reason}`);
  cachedService = createSponsorService(keypair.value, new Connection(BASE_RPC_URL, "confirmed"));
  return success(cachedService);
};
