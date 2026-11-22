import { TOKEN_PROGRAM_ID, unpackAccount } from "@solana/spl-token";
import {
  ComputeBudgetProgram,
  type Connection,
  type Keypair,
  type PublicKey,
  Transaction,
  type TransactionInstruction,
} from "@solana/web3.js";
import { Buffer } from "buffer";
import { BASE_COMPUTE_UNITS, BASE_CONFIRM_TIMEOUT_MS, RPC_REQUEST_TIMEOUT_MS, SPONSOR_REQUEST_TIMEOUT_MS } from "./config";
import { nameProgramError, readProgramErrorCode } from "./errors";
import { type Failure, type Result, attempt, attemptSync, failure, raceDeadline, success } from "./result";

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
      signal: AbortSignal.timeout(RPC_REQUEST_TIMEOUT_MS),
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

const serializeTransaction = (transaction: Transaction, requireAllSignatures: boolean): Result<Buffer> => {
  const unsigned = requireAllSignatures ? transaction.signatures.find((entry) => entry.signature === null) : undefined;
  if (unsigned !== undefined) return failure(`[serializeTransaction] missing a signature from ${unsigned.publicKey.toBase58()}`);
  const serialized = attemptSync(() => transaction.serialize({ requireAllSignatures: false, verifySignatures: false }));
  return serialized.ok ? success(Buffer.from(serialized.value)) : failure(`[serializeTransaction] ${serialized.reason}`);
};

export type BlockhashSource = Pick<Connection, "getLatestBlockhash">;

export type BlockhashCache = {
  start: () => Promise<Result<string>>;
  stop: () => void;
  ready: () => Promise<string | null>;
  invalidate: () => void;
};

const STALE_AFTER_REFRESHES = 2;

export const createBlockhashCache = (source: BlockhashSource, refreshMs: number): BlockhashCache => {
  let latest: { blockhash: string; fetchedAtMs: number } | null = null;
  let inFlight: Promise<Result<string>> | null = null;
  let timer: ReturnType<typeof setInterval> | null = null;

  const refresh = (): Promise<Result<string>> => {
    if (inFlight !== null) return inFlight;
    const fetching = attempt(() => source.getLatestBlockhash("processed"));
    inFlight = raceDeadline(fetching, RPC_REQUEST_TIMEOUT_MS, "getLatestBlockhash").then((fetched) => {
      inFlight = null;
      if (!fetched.ok) return fetched;
      latest = { blockhash: fetched.value.blockhash, fetchedAtMs: performance.now() };
      return success(fetched.value.blockhash);
    });
    return inFlight;
  };

  const start = (): Promise<Result<string>> => {
    if (timer === null) timer = setInterval(() => void refresh(), refreshMs);
    return refresh();
  };

  return {
    start,
    stop: () => {
      if (timer !== null) clearInterval(timer);
      timer = null;
    },
    ready: async () => {
      if (latest !== null && performance.now() - latest.fetchedAtMs < refreshMs * STALE_AFTER_REFRESHES) return latest.blockhash;
      const refreshed = await start();
      return refreshed.ok ? refreshed.value : null;
    },
    invalidate: () => {
      latest = null;
    },
  };
};

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

export const refuseLocally = (detail: string): RollupAck => ({ ok: false, kind: "client", errorCode: null, errorName: "client", detail, ackMs: 0 });

const ACTION_COMPUTE_UNIT_BASE = 200_000;
const ACTION_COMPUTE_UNIT_SPREAD = 100_000;
const BLOCKHASH_NOT_FOUND_PATTERN = /blockhash ?not ?found/i;
let transactionNonce = 0;

type RollupAttempt = { ack: RollupAck; isBlockhashMissing: boolean };

const sendOnRollupOnce = async (
  rollupUrl: string,
  blockhashes: BlockhashCache,
  instructions: TransactionInstruction[],
  signers: TransactionSigner[],
): Promise<RollupAttempt> => {
  const settle = (ack: RollupAck): RollupAttempt => ({ ack, isBlockhashMissing: false });
  const [feePayer] = signers;
  const blockhash = await blockhashes.ready();
  if (feePayer === undefined || blockhash === null) return settle(refuseLocally("[sendOnRollup] no signer or blockhash"));
  transactionNonce += 1;
  // Identical transactions under one blockhash share a signature and the validator drops the repeat, so each action gets a distinct compute limit.
  const computeUnits = ACTION_COMPUTE_UNIT_BASE + (transactionNonce % ACTION_COMPUTE_UNIT_SPREAD);
  const unsigned = new Transaction({ feePayer: feePayer.publicKey, recentBlockhash: blockhash }).add(
    ComputeBudgetProgram.setComputeUnitLimit({ units: computeUnits }),
    ...instructions,
  );
  const signed = await signWithEach(unsigned, signers);
  if (!signed.ok) return settle(refuseLocally(signed.reason));
  const serialized = serializeTransaction(signed.value, true);
  if (!serialized.ok) return settle(refuseLocally(serialized.reason));
  const params = [serialized.value.toString("base64"), { encoding: "base64", skipPreflight: false, preflightCommitment: "processed" }];
  const startedAt = performance.now();
  const answer = await postJsonRpc<string>(rollupUrl, "sendTransaction", params);
  const ackMs = performance.now() - startedAt;
  if (!answer.ok) return settle({ ok: false, kind: "transport", errorCode: null, errorName: "transport", detail: answer.reason, ackMs });
  const rpcError = answer.value.error;
  if (rpcError !== undefined) {
    const errorText = `${rpcError.message} ${JSON.stringify(rpcError.data?.err ?? null)} ${(rpcError.data?.logs ?? []).join(" ")}`;
    const errorCode = readProgramErrorCode(errorText);
    const lastLogs = (rpcError.data?.logs ?? []).slice(-2).join(" / ");
    return {
      ack: {
        ok: false,
        kind: errorCode === null ? "validator" : "program",
        errorCode,
        errorName: nameProgramError(errorCode),
        detail: `${rpcError.code} ${rpcError.message} ${lastLogs}`.trim(),
        ackMs,
      },
      isBlockhashMissing: errorCode === null && BLOCKHASH_NOT_FOUND_PATTERN.test(errorText),
    };
  }
  if (typeof answer.value.result !== "string") {
    return settle({ ok: false, kind: "transport", errorCode: null, errorName: "transport", detail: "no signature", ackMs });
  }
  return settle({ ok: true, signature: answer.value.result, ackMs });
};

export const sendOnRollup = async (
  rollupUrl: string,
  blockhashes: BlockhashCache,
  instructions: TransactionInstruction[],
  signers: TransactionSigner[],
): Promise<RollupAck> => {
  const first = await sendOnRollupOnce(rollupUrl, blockhashes, instructions, signers);
  if (!first.isBlockhashMissing) return first.ack;
  blockhashes.invalidate();
  return (await sendOnRollupOnce(rollupUrl, blockhashes, instructions, signers)).ack;
};

export type BaseSubmission = { signature: string; blockhash: string; lastValidBlockHeight: number; submittedAtMs: number };

export type BaseSend = { signature: string; confirmMs: number };

export type BaseConfirmation = { ok: true; value: BaseSend } | (Failure & { hasLanded: boolean });

const requestSponsorSignature = async (routeUrl: string, transaction: Transaction): Promise<Result<string>> => {
  const serialized = serializeTransaction(transaction, false);
  if (!serialized.ok) return serialized;
  const response = await attempt(() =>
    fetch(routeUrl, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ transaction: serialized.value.toString("base64") }),
      signal: AbortSignal.timeout(SPONSOR_REQUEST_TIMEOUT_MS),
    }),
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

const sendSignedOnBase = async (connection: Connection, feePayment: FeePayment, signed: Transaction): Promise<Result<string>> => {
  if (feePayment.kind === "sponsor") return requestSponsorSignature(feePayment.routeUrl, signed);
  const serialized = serializeTransaction(signed, true);
  if (!serialized.ok) return serialized;
  return attempt(() => connection.sendRawTransaction(serialized.value));
};

export const submitOnBase = async (
  connection: Connection,
  feePayment: FeePayment,
  instructions: TransactionInstruction[],
  signers: TransactionSigner[],
): Promise<Result<BaseSubmission>> => {
  const [wallet] = signers;
  if (wallet === undefined) return failure("[submitOnBase] no signer");
  const blockhash = await attempt(() => connection.getLatestBlockhash("confirmed"));
  if (!blockhash.ok) return failure(`[submitOnBase] blockhash: ${blockhash.reason}`);
  const unsigned = new Transaction({
    feePayer: resolveFeePayer(feePayment, wallet.publicKey),
    blockhash: blockhash.value.blockhash,
    lastValidBlockHeight: blockhash.value.lastValidBlockHeight,
  }).add(ComputeBudgetProgram.setComputeUnitLimit({ units: BASE_COMPUTE_UNITS }), ...instructions);
  const signed = await signWithEach(unsigned, signers);
  if (!signed.ok) return signed;
  const submittedAtMs = performance.now();
  const sent = await sendSignedOnBase(connection, feePayment, signed.value);
  if (!sent.ok) return failure(`[submitOnBase] send: ${sent.reason}`);
  return success({ signature: sent.value, ...blockhash.value, submittedAtMs });
};

export const confirmOnBase = async (connection: Connection, submission: BaseSubmission): Promise<BaseConfirmation> => {
  const { signature, blockhash, lastValidBlockHeight } = submission;
  const confirming = attempt(() => connection.confirmTransaction({ signature, blockhash, lastValidBlockHeight }, "confirmed"));
  const confirmed = await raceDeadline(confirming, BASE_CONFIRM_TIMEOUT_MS, `confirming ${signature}`);
  if (!confirmed.ok) return { ok: false, reason: `[confirmOnBase] ${signature}: ${confirmed.reason}`, hasLanded: false };
  const transactionError = confirmed.value.value.err;
  if (transactionError !== null) {
    return { ok: false, reason: `[confirmOnBase] ${signature} failed: ${JSON.stringify(transactionError)}`, hasLanded: true };
  }
  return { ok: true, value: { signature, confirmMs: performance.now() - submission.submittedAtMs } };
};

export const sendOnBase = async (
  connection: Connection,
  feePayment: FeePayment,
  instructions: TransactionInstruction[],
  signers: TransactionSigner[],
): Promise<BaseConfirmation> => {
  const submitted = await submitOnBase(connection, feePayment, instructions, signers);
  if (!submitted.ok) return { ...submitted, hasLanded: false };
  return confirmOnBase(connection, submitted.value);
};

export const readTokenAccountUnits = async (connection: Connection, account: PublicKey): Promise<Result<bigint | null>> => {
  const info = await attempt(() => connection.getAccountInfo(account, "processed"));
  if (!info.ok) return info;
  if (info.value === null) return success(null);
  const accountInfo = info.value;
  const unpacked = attemptSync(() => unpackAccount(account, accountInfo, TOKEN_PROGRAM_ID));
  return unpacked.ok ? success(unpacked.value.amount) : unpacked;
};

export const readTokenUnits = async (connection: Connection, account: PublicKey): Promise<Result<bigint>> => {
  const units = await readTokenAccountUnits(connection, account);
  return units.ok ? success(units.value ?? 0n) : units;
};
