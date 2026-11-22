import { describe, expect, test } from "bun:test";
import { hitStopMs, HIT_STOP_CATCH_UP_MS, presentationTick } from "./impact";

const TICK_MS = 10;

describe("hit-stop", () => {
  test("holds 50 ms plus 15 ms per pigeon hit, at most 110 ms", () => {
    expect([0, 1, 2, 3, 4, 8].map(hitStopMs)).toEqual([50, 65, 80, 95, 110, 110]);
  });

  test("freezes the picture on the contact tick, then catches up to the chain without a jump", () => {
    const landing = { tick: 1000, hitCount: 2 };
    const holdTicks = hitStopMs(2) / TICK_MS;
    const catchUpTicks = HIT_STOP_CATCH_UP_MS / TICK_MS;
    expect(presentationTick(999, landing, TICK_MS)).toBe(999);
    expect(presentationTick(1000, landing, TICK_MS)).toBe(1000);
    expect(presentationTick(1000 + holdTicks - 0.5, landing, TICK_MS)).toBe(1000);
    const samples = Array.from({ length: 400 }, (_unused, step) => presentationTick(990 + step * 0.1, landing, TICK_MS));
    for (const [index, sample] of samples.entries()) if (index > 0) expect(sample).toBeGreaterThanOrEqual(samples[index - 1] ?? sample);
    expect(presentationTick(1000 + holdTicks + catchUpTicks, landing, TICK_MS)).toBeCloseTo(1000 + holdTicks + catchUpTicks, 9);
    expect(presentationTick(1100, landing, TICK_MS)).toBe(1100);
  });
});
