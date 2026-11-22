import { describe, expect, test } from "bun:test";
import { Redis } from "@upstash/redis";
import { readRedis } from "../redis";
import { type SponsorLimits, countSpendCap, createSharedSponsorGuards } from "./sponsor-guards";

const HOUR_MS = 3_600_000;
const BALANCE = { lamports: 5_000_000_000, readAtMs: 1_000 };
const LIMITS: SponsorLimits = {
  rates: { perIp: { limit: 60, windowMs: HOUR_MS }, perWallet: { limit: 2, windowMs: HOUR_MS } },
  spendRules: [{ windowMs: HOUR_MS, limitLamports: 30_000_000 }],
  reservedLamportsPerTransaction: 10_000_000,
  maxMemoryEntries: 100,
};

const unreachableRedis = new Redis({ url: "http://127.0.0.1:9", token: "unused", enableTelemetry: false, retry: false });

describe("countSpendCap", () => {
  test("turns a SOL budget into a transaction count at the reserved cost per transaction", () => {
    expect(countSpendCap({ windowMs: HOUR_MS, limitLamports: 1_000_000_000 }, 10_000_000)).toBe(100);
    expect(countSpendCap({ windowMs: HOUR_MS, limitLamports: 5 }, 10_000_000)).toBe(1);
  });
});

describe("createSharedSponsorGuards without Redis", () => {
  test("refuses to sponsor when the shared limiter cannot be reached", async () => {
    const guards = createSharedSponsorGuards(unreachableRedis, LIMITS, "sandwich:test:unreachable");
    expect(await guards.admitRequest({ ip: "1.1.1.1", wallet: "wallet" }, Date.now())).toMatchObject({ isAllowed: false, scope: "limiter" });
    expect((await guards.admitSpend(BALANCE, Date.now())).isAllowed).toBe(false);
  });
});

const liveRedis = readRedis();

describe.if(process.env.UPSTASH_LIVE_TEST === "1" && liveRedis.ok)("createSharedSponsorGuards on the real database", () => {
  test("a wallet over its limit and the global spend cap are refused for every instance sharing the database", async () => {
    if (!liveRedis.ok) return;
    const prefix = `sandwich:test:${Date.now()}`;
    const firstInstance = createSharedSponsorGuards(liveRedis.value, LIMITS, prefix);
    const secondInstance = createSharedSponsorGuards(liveRedis.value, LIMITS, prefix);
    const request = { ip: "1.1.1.1", wallet: "wallet-a" };
    expect((await firstInstance.admitRequest(request, Date.now())).isAllowed).toBe(true);
    expect((await secondInstance.admitRequest(request, Date.now())).isAllowed).toBe(true);
    expect(await firstInstance.admitRequest(request, Date.now())).toMatchObject({ isAllowed: false, scope: "wallet" });
    const spendDecisions = [];
    for (let attemptIndex = 0; attemptIndex < 4; attemptIndex++) {
      const guards = attemptIndex % 2 === 0 ? firstInstance : secondInstance;
      spendDecisions.push((await guards.admitSpend({ lamports: BALANCE.lamports, readAtMs: Date.now() + attemptIndex }, Date.now())).isAllowed);
    }
    expect(spendDecisions).toEqual([true, true, true, false]);
    const keys = await liveRedis.value.keys(`${prefix}:*`);
    if (keys.length > 0) await liveRedis.value.del(...keys);
  }, 30_000);
});
