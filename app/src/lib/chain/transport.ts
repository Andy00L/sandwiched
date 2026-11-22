import { TOKEN_PROGRAM_ID, unpackAccount } from "@solana/spl-token";
import {
  ComputeBudgetProgram,
  type Connection,
  type Keypair,
  PublicKey,
  Transaction,
  type TransactionInstruction,
} from "@solana/web3.js";
import { Buffer } from "buffer";
import { BASE_COMPUTE_UNITS } from "./config";
import { nameProgramError, readProgramErrorCode } from "./errors";
import { type Result, attempt, attemptSync, failure, success } from "./result";

export type TransactionSigner = {
  publicKey: PublicKey;
  signTransaction: (transaction: Transaction) => Promise<Transaction>;
};

export const createKeypairSigner = (keypair: Keypair): TransactionSigner => ({
  publicKey: keypair.publicKey,
  signTransaction: async (transaction) => {
    transaction.partialSign(keypair);
    return transaction;
  },
});

export type FeePayment = { kind: "sponsor"; routeUrl: string; sponsor: PublicKey } | { kind: "wallet" };

export const resolveFeePayer = (feePayment: FeePayment, wallet: PublicKey): PublicKey =>
  feePayment.kind === "sponsor" ? feePayment.sponsor : wallet;

type JsonRpcError = { code: number; message: string; data?: { err?: unknown; logs?: string[] } };
type JsonRpcResponse<Value> = { result?: Value; error?: JsonRpcError };

const postJsonRpc = async <Value>(url: string, method: string, params: unknown[]): Promise<Result<JsonRpcResponse<Value>>> => {
  const response = await attempt(() =>
    fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
    }),
  );
  if (!response.ok) return failure(`[postJsonRpc] ${method} transport: ${response.reason}`);
  if (!response.value.ok) return failure(`[postJsonRpc] ${method} HTTP ${response.value.status}`);
  return attempt(() => response.value.json() as Promise<JsonRpcResponse<Value>>);
};

const listRequiredSigners = (transaction: Transaction): Result<Set<string>> => {
  const message = attemptSync(() => transaction.compileMessage());
  if (!message.ok) return message;
  const requiredKeys = message.value.accountKeys.slice(0, message.value.header.numRequiredSignatures);
  return success(new Set(requiredKeys.map((key) => key.toBase58())));
};

const signWithEach = async (transaction: Transaction, signers: TransactionSigner[]): Promise<Result<Transaction>> => {
  const required = listRequiredSigners(transaction);
  if (!required.ok) return failure(`[signWithEach] cannot compile the message: ${required.reason}`);
  let signed = transaction;
  for (const signer of signers.filter((candidate) => required.value.has(candidate.publicKey.toBase58()))) {
    const next = await attempt(() => signer.signTransaction(signed));
    if (!next.ok) return failure(`[signWithEach] ${signer.publicKey.toBase58()} did not sign: ${next.reason}`);
    signed = next.value;
  }
  return success(signed);
};

export class BlockhashCache {
  private latest: string | null = null;
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor(
    private readonly connection: Connection,
    private readonly intervalMs: number,
  ) {}

  async start(): Promise<Result<string>> {
    if (this.timer === null) this.timer = setInterval(() => void this.refresh(), this.intervalMs);
    return this.refresh();
  }

  stop(): void {
    if (this.timer !== null) clearInterval(this.timer);
    this.timer = null;
  }

  async ready(): Promise<string | null> {
    if (this.latest !== null) return this.latest;
    const started = await this.start();
    return started.ok ? started.value : null;
  }

  private async refresh(): Promise<Result<string>> {
    const fetched = await attempt(() => this.connection.getLatestBlockhash("processed"));
    if (!fetched.ok) return fetched;
    this.latest = fetched.value.blockhash;
    return success(fetched.value.blockhash);
  }
}

export type RollupAck =
  | { ok: true; signature: string; ackMs: number }
  | {
      ok: false;
      kind: "client" | "transport" | "validator" | "program";
      errorCode: number | null;
      errorName: string;
      detail: string;
      ackMs: number;
    };

const refuseLocally = (detail: string): RollupAck => ({ ok: false, kind: "client", errorCode: null, errorName: "client", detail, ackMs: 0 });

const ACTION_COMPUTE_UNIT_BASE = 200_000;
const ACTION_COMPUTE_UNIT_SPREAD = 100_000;
let transactionNonce = 0;

export const sendOnRollup = async (
  rollupUrl: string,
  blockhashes: BlockhashCache,
  instructions: TransactionInstruction[],
  signers: TransactionSigner[],
): Promise<RollupAck> => {
  const [feePayer] = signers;
  const blockhash = await blockhashes.ready();
  if (feePayer === undefined || blockhash === null) return refuseLocally("[sendOnRollup] no signer or blockhash");
  transactionNonce += 1;
  // Identical transactions under one blockhash share a signature and the validator drops the repeat, so each action gets a distinct compute limit.
  const computeUnits = ACTION_COMPUTE_UNIT_BASE + (transactionNonce % ACTION_COMPUTE_UNIT_SPREAD);
  const unsigned = new Transaction({ feePayer: feePayer.publicKey, recentBlockhash: blockhash }).add(
    ComputeBudgetProgram.setComputeUnitLimit({ units: computeUnits }),
    ...instructions,
  );
  const signed = await signWithEach(unsigned, signers);
  if (!signed.ok) return refuseLocally(signed.reason);
  const params = [Buffer.from(signed.value.serialize()).toString("base64"), { encoding: "base64", skipPreflight: false, preflightCommitment: "processed" }];
  const startedAt = performance.now();
  const answer = await postJsonRpc<string>(rollupUrl, "sendTransaction", params);
  const ackMs = performance.now() - startedAt;
  if (!answer.ok) return { ok: false, kind: "transport", errorCode: null, errorName: "transport", detail: answer.reason, ackMs };
  const rpcError = answer.value.error;
  if (rpcError !== undefined) {
    const errorText = `${rpcError.message} ${JSON.stringify(rpcError.data?.err ?? null)} ${(rpcError.data?.logs ?? []).join(" ")}`;
    const errorCode = readProgramErrorCode(errorText);
    const lastLogs = (rpcError.data?.logs ?? []).slice(-2).join(" / ");
    return {
      ok: false,
      kind: errorCode === null ? "validator" : "program",
      errorCode,
      errorName: nameProgramError(errorCode),
      detail: `${rpcError.code} ${rpcError.message} ${lastLogs}`.trim(),
      ackMs,
    };
  }
  if (typeof answer.value.result !== "string") {
    return { ok: false, kind: "transport", errorCode: null, errorName: "transport", detail: "no signature", ackMs };
  }
  return { ok: true, signature: answer.value.result, ackMs };
};

export type BaseSend = { signature: string; confirmMs: number };

const requestSponsorSignature = async (routeUrl: string, transaction: Transaction): Promise<Result<string>> => {
  const serialized = Buffer.from(transaction.serialize({ requireAllSignatures: false, verifySignatures: true })).toString("base64");
  const response = await attempt(() =>
    fetch(routeUrl, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ transaction: serialized }) }),
  );
  if (!response.ok) return failure(`[requestSponsorSignature] transport: ${response.reason}`);
  const body = await attempt((): Promise<unknown> => response.value.json());
  if (!body.ok || typeof body.value !== "object" || body.value === null) {
    return failure(`[requestSponsorSignature] HTTP ${response.value.status} with no JSON body`);
  }
  if ("signature" in body.value && typeof body.value.signature === "string") return success(body.value.signature);
  const reason = "reason" in body.value && typeof body.value.reason === "string" ? body.value.reason : "unknown";
  return failure(`[requestSponsorSignature] HTTP ${response.value.status}: ${reason}`);
};

export const sendOnBase = async (
  connection: Connection,
  feePayment: FeePayment,
  instructions: TransactionInstruction[],
  signers: TransactionSigner[],
): Promise<Result<BaseSend>> => {
  const [wallet] = signers;
  if (wallet === undefined) return failure("[sendOnBase] no signer");
  const blockhash = await attempt(() => connection.getLatestBlockhash("confirmed"));
  if (!blockhash.ok) return failure(`[sendOnBase] blockhash: ${blockhash.reason}`);
  const unsigned = new Transaction({
    feePayer: resolveFeePayer(feePayment, wallet.publicKey),
    blockhash: blockhash.value.blockhash,
    lastValidBlockHeight: blockhash.value.lastValidBlockHeight,
  }).add(ComputeBudgetProgram.setComputeUnitLimit({ units: BASE_COMPUTE_UNITS }), ...instructions);
  const signed = await signWithEach(unsigned, signers);
  if (!signed.ok) return signed;
  const startedAt = performance.now();
  const sent =
    feePayment.kind === "sponsor"
      ? await requestSponsorSignature(feePayment.routeUrl, signed.value)
      : await attempt(() => connection.sendRawTransaction(signed.value.serialize()));
  if (!sent.ok) return failure(`[sendOnBase] send: ${sent.reason}`);
  const confirmed = await attempt(() =>
    connection.confirmTransaction(
      { signature: sent.value, blockhash: blockhash.value.blockhash, lastValidBlockHeight: blockhash.value.lastValidBlockHeight },
      "confirmed",
    ),
  );
  if (!confirmed.ok) return failure(`[sendOnBase] confirm ${sent.value}: ${confirmed.reason}`);
  if (confirmed.value.value.err !== null) return failure(`[sendOnBase] ${sent.value} failed: ${JSON.stringify(confirmed.value.value.err)}`);
  return success({ signature: sent.value, confirmMs: performance.now() - startedAt });
};

export const readTokenUnits = async (connection: Connection, account: PublicKey): Promise<Result<bigint>> => {
  const info = await attempt(() => connection.getAccountInfo(account, "processed"));
  if (!info.ok) return info;
  if (info.value === null) return success(0n);
  const accountInfo = info.value;
  const unpacked = await attempt(async () => unpackAccount(account, accountInfo, TOKEN_PROGRAM_ID));
  return unpacked.ok ? success(unpacked.value.amount) : unpacked;
};
