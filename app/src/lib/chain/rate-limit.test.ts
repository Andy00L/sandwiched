import { describe, expect, test } from "bun:test";
import { type RateLimiter, type RateLimits, type RateRequest, createRateLimiter } from "./rate-limit";

const LIMITS: RateLimits = { perIp: { limit: 3, windowMs: 1_000 }, perWallet: { limit: 2, windowMs: 5_000 } };
const ROOMY_ENTRY_CAP = 100;

const sendRequests = (limiter: RateLimiter, count: number, request: RateRequest, nowMs: number) =>
  Array.from({ length: count }, () => limiter.decide(request, nowMs).isAllowed);

describe("createRateLimiter", () => {
  test("allows an IP up to its limit, refuses the next with the time left, and allows it again after the window", () => {
    const limiter = createRateLimiter(LIMITS, ROOMY_ENTRY_CAP);
    expect(sendRequests(limiter, 4, { ip: "1.1.1.1", wallet: null }, 10_000)).toEqual([true, true, true, false]);
    expect(limiter.decide({ ip: "1.1.1.1", wallet: null }, 10_400)).toEqual({ isAllowed: false, scope: "ip", retryAfterMs: 600 });
    expect(limiter.decide({ ip: "1.1.1.1", wallet: null }, 11_000).isAllowed).toBe(true);
  });

  test("limits a wallet across IPs", () => {
    const limiter = createRateLimiter(LIMITS, ROOMY_ENTRY_CAP);
    const verdicts = ["1.1.1.1", "2.2.2.2", "3.3.3.3"].map((ip) => {
      const decision = limiter.decide({ ip, wallet: "guest" }, 10_000);
      return decision.isAllowed ? "allowed" : decision.scope;
    });
    expect(verdicts).toEqual(["allowed", "allowed", "wallet"]);
  });

  test("keeps separate counts for separate IPs and wallets", () => {
    const limiter = createRateLimiter(LIMITS, ROOMY_ENTRY_CAP);
    sendRequests(limiter, 3, { ip: "1.1.1.1", wallet: null }, 10_000);
    expect(sendRequests(limiter, 1, { ip: "2.2.2.2", wallet: "other" }, 10_000)).toEqual([true]);
  });

  test("does not count a refused request, so the window still ends where it started", () => {
    const limiter = createRateLimiter(LIMITS, ROOMY_ENTRY_CAP);
    sendRequests(limiter, 3, { ip: "1.1.1.1", wallet: null }, 10_000);
    expect(sendRequests(limiter, 5, { ip: "1.1.1.1", wallet: null }, 10_900)).toEqual([false, false, false, false, false]);
    expect(sendRequests(limiter, 3, { ip: "1.1.1.1", wallet: null }, 11_000)).toEqual([true, true, true]);
  });

  test("drops expired windows first and never holds more entries than its cap", () => {
    const limiter = createRateLimiter(LIMITS, 4);
    sendRequests(limiter, 1, { ip: "1.1.1.1", wallet: "old" }, 0);
    sendRequests(limiter, 3, { ip: "2.2.2.2", wallet: null }, 9_000);
    expect(limiter.countEntries()).toBe(3);
    expect(sendRequests(limiter, 1, { ip: "3.3.3.3", wallet: "new" }, 9_500)).toEqual([true]);
    expect(limiter.countEntries()).toBe(3);
    expect(limiter.decide({ ip: "2.2.2.2", wallet: null }, 9_500).isAllowed).toBe(false);
    for (let index = 0; index < 20; index += 1) limiter.decide({ ip: `10.0.0.${index}`, wallet: `wallet-${index}` }, 9_600);
    expect(limiter.countEntries()).toBeLessThanOrEqual(4);
  });
});
