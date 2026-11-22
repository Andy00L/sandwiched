import { Connection, type ConnectionConfig } from "@solana/web3.js";
import { RPC_REQUEST_TIMEOUT_MS } from "./config";

export const fetchWithTimeout = (url: string, init: Omit<RequestInit, "signal">, timeoutMs: number): Promise<Response> =>
  fetch(url, { ...init, signal: AbortSignal.timeout(timeoutMs) });

export const createRpcConnection = (url: string, config: Omit<ConnectionConfig, "fetchMiddleware">): Connection =>
  new Connection(url, {
    ...config,
    fetchMiddleware: (info, init, send) => send(info, { ...init, signal: AbortSignal.timeout(RPC_REQUEST_TIMEOUT_MS) }),
  });
