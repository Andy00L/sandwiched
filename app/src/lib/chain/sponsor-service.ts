import { readFileSync } from "node:fs";
import type { Connection, Keypair } from "@solana/web3.js";
import { findTestMintAddress } from "./addresses";
import { BASE_RPC_URL } from "./config";
import { restoreKeypair } from "./guest-key";
import { readRedis } from "../redis";
import { type Result, attempt, attemptSync, failure, success } from "./result";
import { createRpcConnection } from "./rpc";
import type { BalanceReading, SpendRule } from "./spend-budget";
import { type SponsorGuards, type SponsorLimits, createMemorySponsorGuards, createSharedSponsorGuards } from "./sponsor-guards";
import { parseSponsorRequest, reviewSponsoredTransaction } from "./sponsor-policy";

export const SPONSOR_KEYPAIR_PATH_ENV = "SANDWICH_SPONSOR_KEYPAIR_PATH";
export const SPONSOR_SECRET_KEY_ENV = "SANDWICH_SPONSOR_SECRET_KEY";
export const SPONSOR_MIN_LAMPORTS = 200_000_000;
export const MAX_SPONSOR_BODY_BYTES = 4_096;

const HOUR_MS = 3_600_000;
const DAY_MS = 24 * HOUR_MS;
const LAMPORTS_PER_SOL = 1_000_000_000;
export const SPONSOR_SPEND_RULES: readonly SpendRule[] = [
  { windowMs: HOUR_MS, limitLamports: LAMPORTS_PER_SOL },
  { windowMs: DAY_MS, limitLamports: 5 * LAMPORTS_PER_SOL },
];
export const SPONSOR_RESERVED_LAMPORTS_PER_TRANSACTION = 10_000_000;
export const SPONSOR_LIMITS: SponsorLimits = {
  rates: { perIp: { limit: 60, windowMs: HOUR_MS }, perWallet: { limit: 12, windowMs: HOUR_MS } },
  spendRules: SPONSOR_SPEND_RULES,
  reservedLamportsPerTransaction: SPONSOR_RESERVED_LAMPORTS_PER_TRANSACTION,
  maxMemoryEntries: 10_000,
};
export const SPONSOR_BALANCE_CACHE_MS = 5_000;

export type SponsorReply = { status: number; body: Record<string, string | number | boolean> };

export type SponsorService = {
  describe: () => Promise<SponsorReply>;
  sponsor: (body: unknown, ip: string) => Promise<SponsorReply>;
};

const refuse = (status: number, reason: string): SponsorReply => ({ status, body: { reason } });

const parseSponsorKeypair = (text: string, source: string): Result<Keypair> => {
  const parsed = attemptSync((): unknown => JSON.parse(text));
  const keypair = parsed.ok ? restoreKeypair(parsed.value) : null;
  return keypair === null ? failure(`${source} does not hold a keypair`) : success(keypair);
};

export const loadSponsorKeypair = (env: Record<string, string | undefined>): Result<Keypair> => {
  const secretKeyText = env[SPONSOR_SECRET_KEY_ENV];
  if (secretKeyText !== undefined && secretKeyText !== "") return parseSponsorKeypair(secretKeyText, SPONSOR_SECRET_KEY_ENV);
  const path = env[SPONSOR_KEYPAIR_PATH_ENV];
  if (path === undefined || path === "") return failure(`neither ${SPONSOR_SECRET_KEY_ENV} nor ${SPONSOR_KEYPAIR_PATH_ENV} is set`);
  const text = attemptSync(() => readFileSync(path, "utf8"));
  if (!text.ok) return failure("the sponsor keypair file cannot be read");
  return parseSponsorKeypair(text.value, "the sponsor keypair file");
};

export const readClientIp = (headers: Headers): string =>
  headers.get("x-real-ip")?.trim() || headers.get("x-forwarded-for")?.split(",").at(-1)?.trim() || "unknown";

export type SponsorConnection = Pick<Connection, "getBalance" | "sendRawTransaction">;

export const createSponsorService = (
  keypair: Keypair,
  connection: SponsorConnection,
  readNowMs: () => number = Date.now,
  guards: SponsorGuards = createMemorySponsorGuards(SPONSOR_LIMITS),
): SponsorService => {
  const policy = { sponsor: keypair.publicKey, testMint: findTestMintAddress() };
  let cachedBalance: BalanceReading | null = null;
  let balanceInFlight: Promise<Result<BalanceReading>> | null = null;

  const readBalance = (): Promise<Result<BalanceReading>> => {
    if (cachedBalance !== null && readNowMs() - cachedBalance.readAtMs < SPONSOR_BALANCE_CACHE_MS) return Promise.resolve(success(cachedBalance));
    if (balanceInFlight !== null) return balanceInFlight;
    balanceInFlight = attempt(() => connection.getBalance(keypair.publicKey, "confirmed")).then((read) => {
      balanceInFlight = null;
      if (!read.ok) return read;
      cachedBalance = { lamports: read.value, readAtMs: readNowMs() };
      return success(cachedBalance);
    });
    return balanceInFlight;
  };

  const describe = async (): Promise<SponsorReply> => {
    const balance = await readBalance();
    if (!balance.ok) return refuse(502, "the sponsor balance cannot be read");
    const lamports = balance.value.lamports;
    return { status: 200, body: { sponsor: keypair.publicKey.toBase58(), isAccepting: lamports >= SPONSOR_MIN_LAMPORTS, lamports } };
  };

  const sponsorTransaction = async (body: unknown, ip: string): Promise<SponsorReply> => {
    const parsed = parseSponsorRequest(body);
    if (!parsed.ok) return refuse(400, parsed.reason);
    const transaction = parsed.value;
    const review = reviewSponsoredTransaction(transaction, policy);
    if (!review.ok) return refuse(400, review.reason);
    const decision = await guards.admitRequest({ ip, wallet: review.value.wallet?.toBase58() ?? null }, readNowMs());
    if (!decision.isAllowed && decision.scope === "limiter") {
      return { status: 503, body: { reason: "the rate limiter is unreachable, try again or connect a wallet", retryAfterMs: decision.retryAfterMs } };
    }
    if (!decision.isAllowed) {
      return { status: 429, body: { reason: `too many sponsored transactions for this ${decision.scope}`, retryAfterMs: decision.retryAfterMs } };
    }
    const balance = await readBalance();
    if (!balance.ok) return refuse(502, "the sponsor balance cannot be read");
    if (balance.value.lamports < SPONSOR_MIN_LAMPORTS) return refuse(503, "the sponsor is low on SOL, connect a wallet");
    const budget = await guards.admitSpend(balance.value, readNowMs());
    if (!budget.isAllowed) {
      return { status: 503, body: { reason: "the sponsor spent its budget for now, connect a wallet", retryAfterMs: budget.retryAfterMs } };
    }
    const signed = attemptSync(() => transaction.partialSign(keypair));
    if (!signed.ok || !transaction.verifySignatures()) return refuse(400, "the transaction is missing a signature or carries an invalid one");
    const sent = await attempt(() => connection.sendRawTransaction(transaction.serialize({ verifySignatures: false }), { preflightCommitment: "confirmed" }));
    if (!sent.ok) return refuse(502, `the transaction failed preflight: ${sent.reason.slice(0, 300)}`);
    console.log(`[sponsorTransaction] ${review.value.labels.join("+")} for ${review.value.wallet?.toBase58() ?? "no wallet"}: ${sent.value}`);
    return { status: 200, body: { signature: sent.value } };
  };

  return { describe, sponsor: sponsorTransaction };
};

let cachedService: SponsorService | null = null;

export const resolveSponsorService = (): Result<SponsorService> => {
  if (cachedService !== null) return success(cachedService);
  const keypair = loadSponsorKeypair(process.env);
  if (!keypair.ok) return failure(`[resolveSponsorService] ${keypair.reason}`);
  const redis = readRedis();
  if (!redis.ok) console.warn(`[resolveSponsorService] sponsor limits stay in this instance's memory: ${redis.reason}`);
  const guards = redis.ok ? createSharedSponsorGuards(redis.value, SPONSOR_LIMITS) : createMemorySponsorGuards(SPONSOR_LIMITS);
  cachedService = createSponsorService(keypair.value, createRpcConnection(BASE_RPC_URL, { commitment: "confirmed" }), Date.now, guards);
  return success(cachedService);
};
