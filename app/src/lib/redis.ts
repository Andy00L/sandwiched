import { Redis } from "@upstash/redis";
import { type Result, failure, success } from "./chain/result";

export const REDIS_REQUEST_TIMEOUT_MS = 2_000;
const REDIS_RETRIES = 2;
const REDIS_BACKOFF_BASE_MS = 50;

let sharedRedis: Redis | null = null;

export function readRedis(): Result<Redis> {
  if (sharedRedis !== null) return success(sharedRedis);
  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) return failure("[readRedis] UPSTASH_REDIS_REST_URL and UPSTASH_REDIS_REST_TOKEN must both be set");
  sharedRedis = new Redis({
    url,
    token,
    enableTelemetry: false,
    signal: () => AbortSignal.timeout(REDIS_REQUEST_TIMEOUT_MS),
    retry: { retries: REDIS_RETRIES, backoff: (retryCount) => Math.exp(retryCount) * REDIS_BACKOFF_BASE_MS },
  });
  return success(sharedRedis);
}
