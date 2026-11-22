import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { TOKEN_PROGRAM_ID, unpackAccount } from "@solana/spl-token";
import {
  ComputeBudgetProgram,
  Connection,
  Keypair,
  type PublicKey,
  Transaction,
  type TransactionInstruction,
} from "@solana/web3.js";
import { attempt, failure, success, type Result } from "./result";

const BASE_RPC_URL = "https://rpc.magicblock.app/devnet";
export const ROLLUP_URL = "https://devnet-us.magicblock.app";
const ADMIN_KEYPAIR_PATH = join(homedir(), ".config", "solana", "id.json");
const KEYS_DIR = join(import.meta.dir, "..", "..", ".scratch", "it1");

const SETUP_COMPUTE_UNITS = 400_000;
const ACTION_COMPUTE_UNIT_BASE = 200_000;
const ACTION_COMPUTE_UNIT_SPREAD = 100_000;

const readKeypair = (path: string): Result<Keypair> => {
  if (!existsSync(path)) return failure(`[readKeypair] missing ${path}`);
  const secret: unknown = JSON.parse(readFileSync(path, "utf8"));
  if (!Array.isArray(secret)) return failure(`[readKeypair] ${path} is not a keypair file`);
  return success(Keypair.fromSecretKey(Uint8Array.from(secret.map(Number))));
};

export const loadAdmin = (): Result<Keypair> => readKeypair(ADMIN_KEYPAIR_PATH);

export const createRunKeypair = (runName: string, keyName: string): Result<Keypair> => {
  const runDir = join(KEYS_DIR, runName);
  mkdirSync(runDir, { recursive: true });
  const keypairPath = join(runDir, `${keyName}.json`);
  if (existsSync(keypairPath)) return readKeypair(keypairPath);
  const created = Keypair.generate();
  writeFileSync(keypairPath, JSON.stringify(Array.from(created.secretKey)));
  return success(created);
};

export const writeRunRecord = (runName: string, record: unknown): void => {
  const runDir = join(KEYS_DIR, runName);
  mkdirSync(runDir, { recursive: true });
  const text = JSON.stringify(record, (_key, value: unknown) => (typeof value === "bigint" ? value.toString() : value), 2);
  writeFileSync(join(runDir, "results.json"), text);
};

export const createBaseConnection = (): Connection => new Connection(BASE_RPC_URL, "confirmed");

export const createRollupConnection = (): Connection =>
  new Connection(ROLLUP_URL, { commitment: "processed", wsEndpoint: ROLLUP_URL.replace("https://", "wss://") });

type JsonRpcError = { code: number; message: string; data?: { err?: unknown; logs?: string[] } };
type JsonRpcResponse<T> = { result?: T; error?: JsonRpcError };

const postJsonRpc = async <T>(url: string, method: string, params: unknown[]): Promise<Result<JsonRpcResponse<T>>> => {
  const response = await attempt(() =>
    fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
    }),
  );
  if (!response.ok) return failure(`[postJsonRpc] ${method} transport: ${response.reason}`);
  if (!response.value.ok) return failure(`[postJsonRpc] ${method} HTTP ${response.value.status}`);
  return attempt(() => response.value.json() as Promise<JsonRpcResponse<T>>);
};

export const getValidatorIdentity = async (url: string): Promise<Result<string>> => {
  const answer = await postJsonRpc<{ identity: string }>(url, "getIdentity", []);
  if (!answer.ok) return answer;
  if (answer.value.result === undefined) return failure(`[getValidatorIdentity] ${JSON.stringify(answer.value.error)}`);
  return success(answer.value.result.identity);
};

export const isDelegatedOnRollup = async (account: PublicKey): Promise<boolean> => {
  const answer = await postJsonRpc<{ isDelegated: boolean }>(ROLLUP_URL, "getDelegationStatus", [account.toBase58()]);
  return answer.ok && answer.value.result?.isDelegated === true;
};

type BaseSend = { signature: string; confirmMs: number };

const BASE_SEND_ATTEMPTS = 3;
const EXPIRED_ERROR_NAME = "TransactionExpiredBlockheightExceededError";

export const sendOnBase = async (
  connection: Connection,
  instructions: TransactionInstruction[],
  signers: Keypair[],
): Promise<Result<BaseSend>> => {
  let outcome = await sendOnBaseOnce(connection, instructions, signers);
  for (let attemptNumber = 2; attemptNumber <= BASE_SEND_ATTEMPTS && !outcome.ok && outcome.reason.includes(EXPIRED_ERROR_NAME); attemptNumber += 1) {
    console.log(`[sendOnBase] expired before landing, sending again (attempt ${attemptNumber} of ${BASE_SEND_ATTEMPTS})`);
    outcome = await sendOnBaseOnce(connection, instructions, signers);
  }
  return outcome;
};

const sendOnBaseOnce = async (
  connection: Connection,
  instructions: TransactionInstruction[],
  signers: Keypair[],
): Promise<Result<BaseSend>> => {
  const [feePayer] = signers;
  if (feePayer === undefined) return failure("[sendOnBase] no signer");
  const blockhash = await attempt(() => connection.getLatestBlockhash("confirmed"));
  if (!blockhash.ok) return failure(`[sendOnBase] blockhash: ${blockhash.reason}`);
  const transaction = new Transaction({
    feePayer: feePayer.publicKey,
    blockhash: blockhash.value.blockhash,
    lastValidBlockHeight: blockhash.value.lastValidBlockHeight,
  }).add(ComputeBudgetProgram.setComputeUnitLimit({ units: SETUP_COMPUTE_UNITS }), ...instructions);
  transaction.sign(...signers);
  const startedAt = performance.now();
  const sent = await attempt(() => connection.sendRawTransaction(transaction.serialize()));
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

export type RollupAck =
  | { ok: true; signature: string; ackMs: number }
  | { ok: false; kind: "transport" | "validator" | "program"; errorCode: number | null; detail: string; ackMs: number };

const PROGRAM_ERROR_PATTERN = /custom program error: 0x([0-9a-f]+)/i;

const readProgramErrorCode = (rpcError: JsonRpcError): number | null => {
  const text = `${rpcError.message} ${JSON.stringify(rpcError.data?.err ?? null)} ${(rpcError.data?.logs ?? []).join(" ")}`;
  const hexMatch = PROGRAM_ERROR_PATTERN.exec(text);
  if (hexMatch?.[1] !== undefined) return Number.parseInt(hexMatch[1], 16);
  const customMatch = /"Custom":(\d+)/.exec(text);
  return customMatch?.[1] === undefined ? null : Number.parseInt(customMatch[1], 10);
};

export class BlockhashCache {
  private latest: string | null = null;
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor(private readonly connection: Connection, private readonly intervalMs: number) {}

  async start(): Promise<Result<string>> {
    const refreshed = await this.refresh();
    this.timer = setInterval(() => void this.refresh(), this.intervalMs);
    return refreshed;
  }

  stop(): void {
    if (this.timer !== null) clearInterval(this.timer);
  }

  current(): string | null {
    return this.latest;
  }

  private async refresh(): Promise<Result<string>> {
    const fetched = await attempt(() => this.connection.getLatestBlockhash("processed"));
    if (!fetched.ok) return fetched;
    this.latest = fetched.value.blockhash;
    return success(fetched.value.blockhash);
  }
}

let transactionNonce = 0;

export const sendOnRollup = async (
  blockhashes: BlockhashCache,
  instructions: TransactionInstruction[],
  signers: Keypair[],
): Promise<RollupAck> => {
  const [feePayer] = signers;
  const blockhash = blockhashes.current();
  if (feePayer === undefined || blockhash === null) {
    return { ok: false, kind: "transport", errorCode: null, detail: "[sendOnRollup] no signer or blockhash", ackMs: 0 };
  }
  transactionNonce += 1;
  const transaction = new Transaction({ feePayer: feePayer.publicKey, recentBlockhash: blockhash }).add(
    ComputeBudgetProgram.setComputeUnitLimit({ units: ACTION_COMPUTE_UNIT_BASE + (transactionNonce % ACTION_COMPUTE_UNIT_SPREAD) }),
    ...instructions,
  );
  transaction.sign(...signers);
  const params = [transaction.serialize().toString("base64"), { encoding: "base64", skipPreflight: false, preflightCommitment: "processed" }];
  const startedAt = performance.now();
  const answer = await postJsonRpc<string>(ROLLUP_URL, "sendTransaction", params);
  const ackMs = performance.now() - startedAt;
  if (!answer.ok) return { ok: false, kind: "transport", errorCode: null, detail: answer.reason, ackMs };
  const rpcError = answer.value.error;
  if (rpcError !== undefined) {
    const errorCode = readProgramErrorCode(rpcError);
    const lastLogs = (rpcError.data?.logs ?? []).slice(-2).join(" / ");
    return { ok: false, kind: errorCode === null ? "validator" : "program", errorCode, detail: `${rpcError.code} ${rpcError.message} ${lastLogs}`.trim(), ackMs };
  }
  if (typeof answer.value.result !== "string") return { ok: false, kind: "transport", errorCode: null, detail: "no signature", ackMs };
  return { ok: true, signature: answer.value.result, ackMs };
};

export const readTokenUnits = async (connection: Connection, account: PublicKey): Promise<bigint> => {
  const info = await attempt(() => connection.getAccountInfo(account, "processed"));
  if (!info.ok || info.value === null) return 0n;
  const unpacked = await attempt(async () => unpackAccount(account, info.value, TOKEN_PROGRAM_ID));
  return unpacked.ok ? unpacked.value.amount : 0n;
};

export const readLamports = async (connection: Connection, account: PublicKey): Promise<number> =>
  (await connection.getAccountInfo(account, "confirmed"))?.lamports ?? 0;

export type Execution = { computeUnits: number; logs: string[] };

export const readExecution = async (connection: Connection, signature: string): Promise<Execution | null> => {
  const fetched = await attempt(() => connection.getTransaction(signature, { commitment: "confirmed", maxSupportedTransactionVersion: 0 }));
  const meta = fetched.ok ? fetched.value?.meta : null;
  if (meta === null || meta === undefined || meta.computeUnitsConsumed === undefined) return null;
  return { computeUnits: meta.computeUnitsConsumed, logs: meta.logMessages ?? [] };
};
