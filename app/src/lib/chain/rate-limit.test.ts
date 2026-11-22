import { describe, expect, test } from "bun:test";
import { type RateLimits, type RateWindow, decideRate, pruneRateWindows } from "./rate-limit";

const LIMITS: RateLimits = { perIp: { limit: 3, windowMs: 1_000 }, perWallet: { limit: 2, windowMs: 5_000 } };

const sendRequests = (count: number, request: { ip: string; wallet: string | null }, nowMs: number, start = new Map<string, RateWindow>()) => {
  let windows = start;
  const verdicts: boolean[] = [];
  for (let index = 0; index < count; index += 1) {
    const decision = decideRate(windows, request, nowMs, LIMITS);
    verdicts.push(decision.isAllowed);
    if (decision.isAllowed) windows = decision.windows;
  }
  return { verdicts, windows };
};

describe("decideRate", () => {
  test("allows an IP up to its limit, refuses the next with the time left, and allows it again after the window", () => {
    const { verdicts, windows } = sendRequests(4, { ip: "1.1.1.1", wallet: null }, 10_000);
    expect(verdicts).toEqual([true, true, true, false]);
    const refused = decideRate(windows, { ip: "1.1.1.1", wallet: null }, 10_400, LIMITS);
    expect(refused).toEqual({ isAllowed: false, scope: "ip", retryAfterMs: 600 });
    expect(decideRate(windows, { ip: "1.1.1.1", wallet: null }, 11_000, LIMITS).isAllowed).toBe(true);
  });

  test("limits a wallet across IPs", () => {
    let windows = new Map<string, RateWindow>();
    const verdicts = ["1.1.1.1", "2.2.2.2", "3.3.3.3"].map((ip) => {
      const decision = decideRate(windows, { ip, wallet: "guest" }, 10_000, LIMITS);
      if (decision.isAllowed) windows = decision.windows;
      return decision.isAllowed ? "allowed" : decision.scope;
    });
    expect(verdicts).toEqual(["allowed", "allowed", "wallet"]);
  });

  test("keeps separate counts for separate IPs and wallets", () => {
    const first = sendRequests(3, { ip: "1.1.1.1", wallet: null }, 10_000);
    const second = sendRequests(1, { ip: "2.2.2.2", wallet: "other" }, 10_000, first.windows);
    expect(second.verdicts).toEqual([true]);
  });

  test("does not count a refused request", () => {
    const { windows } = sendRequests(3, { ip: "1.1.1.1", wallet: null }, 10_000);
    const afterRefusals = sendRequests(5, { ip: "1.1.1.1", wallet: null }, 10_100, windows);
    expect(afterRefusals.verdicts).toEqual([false, false, false, false, false]);
    expect(afterRefusals.windows.get("ip:1.1.1.1")).toEqual({ startedAtMs: 10_000, count: 3 });
  });
});

describe("pruneRateWindows", () => {
  test("drops windows older than the longest rule and keeps the rest", () => {
    const windows = new Map<string, RateWindow>([
      ["ip:old", { startedAtMs: 0, count: 3 }],
      ["ip:recent", { startedAtMs: 9_000, count: 1 }],
    ]);
    expect([...pruneRateWindows(windows, 10_000, 5_000).keys()]).toEqual(["ip:recent"]);
  });
});
