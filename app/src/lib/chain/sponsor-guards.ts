import { Ratelimit } from "@upstash/ratelimit";
import type { Redis } from "@upstash/redis";
import { type RateDecision, type RateLimits, type RateRequest, createRateLimiter } from "./rate-limit";
import { attempt } from "./result";
import { type BalanceReading, type SpendDecision, type SpendRule, createSpendBudget } from "./spend-budget";

const SHARED_LIMIT_TIMEOUT_MS = 2_000;
const UNREACHABLE_RETRY_MS = 30_000;
const GLOBAL_SPEND_IDENTIFIER = "sponsor";

export type SponsorLimits = {
  rates: RateLimits;
  spendRules: readonly SpendRule[];
  reservedLamportsPerTransaction: number;
  maxMemoryEntries: number;
};

export type SponsorGuards = {
  admitRequest: (request: RateRequest, nowMs: number) => Promise<RateDecision>;
  admitSpend: (balance: BalanceReading, nowMs: number) => Promise<SpendDecision>;
};

type SharedCheck = { kind: "allowed" } | { kind: "refused"; retryAfterMs: number } | { kind: "unreachable" };

export const createMemorySponsorGuards = (limits: SponsorLimits): SponsorGuards => {
  const rateLimiter = createRateLimiter(limits.rates, limits.maxMemoryEntries);
  const spendBudget = createSpendBudget(limits.spendRules, limits.reservedLamportsPerTransaction);
  return {
    admitRequest: async (request, nowMs) => rateLimiter.decide(request, nowMs),
    admitSpend: async (balance, nowMs) => spendBudget.decide(balance, nowMs),
  };
};

export const countSpendCap = (rule: SpendRule, reservedLamportsPerTransaction: number): number =>
  Math.max(1, Math.floor(rule.limitLamports / reservedLamportsPerTransaction));

export const createSharedSponsorGuards = (redis: Redis, limits: SponsorLimits, keyPrefix = "sandwich:sponsor"): SponsorGuards => {
  const makeLimiter = (name: string, limit: number, windowMs: number) =>
    new Ratelimit({
      redis,
      prefix: `${keyPrefix}:${name}`,
      limiter: Ratelimit.fixedWindow(limit, `${Math.max(1, Math.round(windowMs / 1000))} s`),
      timeout: SHARED_LIMIT_TIMEOUT_MS,
    });
  const perIp = makeLimiter("ip", limits.rates.perIp.limit, limits.rates.perIp.windowMs);
  const perWallet = makeLimiter("wallet", limits.rates.perWallet.limit, limits.rates.perWallet.windowMs);
  const spendCaps = limits.spendRules.map((rule) => makeLimiter(`spend-${rule.windowMs}`, countSpendCap(rule, limits.reservedLamportsPerTransaction), rule.windowMs));
  const localBudget = createSpendBudget(limits.spendRules, limits.reservedLamportsPerTransaction);

  const check = async (limiter: Ratelimit, identifier: string, nowMs: number): Promise<SharedCheck> => {
    const reply = await attempt(() => limiter.limit(identifier));
    if (!reply.ok || reply.value.reason === "timeout") {
      console.warn(`[createSharedSponsorGuards] the shared limiter did not answer: ${reply.ok ? "timeout" : reply.reason}`);
      return { kind: "unreachable" };
    }
    return reply.value.success ? { kind: "allowed" } : { kind: "refused", retryAfterMs: Math.max(0, reply.value.reset - nowMs) };
  };

  const admitRequest = async (request: RateRequest, nowMs: number): Promise<RateDecision> => {
    const byIp = await check(perIp, request.ip, nowMs);
    if (byIp.kind === "unreachable") return { isAllowed: false, scope: "limiter", retryAfterMs: UNREACHABLE_RETRY_MS };
    if (byIp.kind === "refused") return { isAllowed: false, scope: "ip", retryAfterMs: byIp.retryAfterMs };
    if (request.wallet === null) return { isAllowed: true };
    const byWallet = await check(perWallet, request.wallet, nowMs);
    if (byWallet.kind === "unreachable") return { isAllowed: false, scope: "limiter", retryAfterMs: UNREACHABLE_RETRY_MS };
    if (byWallet.kind === "refused") return { isAllowed: false, scope: "wallet", retryAfterMs: byWallet.retryAfterMs };
    return { isAllowed: true };
  };

  const admitSpend = async (balance: BalanceReading, nowMs: number): Promise<SpendDecision> => {
    const local = localBudget.decide(balance, nowMs);
    if (!local.isAllowed) return local;
    for (const cap of spendCaps) {
      const capped = await check(cap, GLOBAL_SPEND_IDENTIFIER, nowMs);
      if (capped.kind === "unreachable") return { isAllowed: false, retryAfterMs: UNREACHABLE_RETRY_MS };
      if (capped.kind === "refused") return { isAllowed: false, retryAfterMs: capped.retryAfterMs };
    }
    return { isAllowed: true };
  };

  return { admitRequest, admitSpend };
};
