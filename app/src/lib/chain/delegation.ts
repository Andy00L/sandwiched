import type { PublicKey } from "@solana/web3.js";
import { RPC_REQUEST_TIMEOUT_MS } from "./config";
import { type Result, attempt, failure, success } from "./result";
import { fetchWithTimeout } from "./rpc";

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null;

export const readDelegationStatus = async (rollupUrl: string, account: PublicKey): Promise<Result<boolean>> => {
  const body = JSON.stringify({ jsonrpc: "2.0", id: 1, method: "getDelegationStatus", params: [account.toBase58()] });
  const response = await attempt(() => fetchWithTimeout(rollupUrl, { method: "POST", headers: { "content-type": "application/json" }, body }, RPC_REQUEST_TIMEOUT_MS));
  if (!response.ok) return failure(`[readDelegationStatus] ${response.reason}`);
  const parsed = await attempt((): Promise<unknown> => response.value.json());
  if (!parsed.ok || !isRecord(parsed.value)) return failure("[readDelegationStatus] the rollup sent no JSON");
  const result = parsed.value.result;
  if (!isRecord(result) || typeof result.isDelegated !== "boolean") return failure(`[readDelegationStatus] unexpected answer: ${JSON.stringify(parsed.value).slice(0, 200)}`);
  return success(result.isDelegated);
};
