import { describe, expect, test } from "bun:test";
import { createTickClock } from "./tick-clock";

const TICK_MS = 10;
const CHAIN_OFFSET_TICKS = 1_000;
const SAMPLE_GAP_MS = 100;

const readChainSlot = (atMs: number, offsetTicks: number = CHAIN_OFFSET_TICKS) => Math.floor(offsetTicks + atMs / TICK_MS);

function observeOnTime(clock: ReturnType<typeof createTickClock>, fromMs: number, toMs: number, offsetTicks: number = CHAIN_OFFSET_TICKS) {
  for (let atMs = fromMs; atMs <= toMs; atMs += SAMPLE_GAP_MS) {
    clock.observe(readChainSlot(atMs, offsetTicks), atMs);
    clock.estimate(atMs);
  }
}

describe("createTickClock", () => {
  test("a burst of late samples after a hidden tab does not hold the estimate behind the chain", () => {
    const clock = createTickClock(TICK_MS);
    observeOnTime(clock, 0, 3_000);
    const returnMs = 4_500;
    for (let atMs = 3_100; atMs < returnMs; atMs += 50) clock.observe(readChainSlot(atMs), returnMs);
    expect(clock.estimate(returnMs + 500)).toBe(readChainSlot(returnMs + 500));
  });

  test("a single late sample among on-time ones does not lower the estimate", () => {
    const clock = createTickClock(TICK_MS);
    observeOnTime(clock, 0, 2_000);
    clock.observe(readChainSlot(1_200), 2_050);
    expect(clock.estimate(2_100)).toBe(readChainSlot(2_100));
  });

  test("follows a chain that fell behind once the faster samples leave the window", () => {
    const clock = createTickClock(TICK_MS);
    observeOnTime(clock, 0, 2_000);
    const slowerOffset = CHAIN_OFFSET_TICKS - 100;
    observeOnTime(clock, 2_100, 9_000, slowerOffset);
    expect(clock.estimate(9_100)).toBe(readChainSlot(9_100, slowerOffset));
  });

  test("never goes backwards between two estimates", () => {
    const clock = createTickClock(TICK_MS);
    observeOnTime(clock, 0, 1_000);
    const before = clock.estimate(1_000);
    clock.observe(readChainSlot(1_000) - 30, 1_000);
    expect(clock.estimate(1_000)).toBeGreaterThanOrEqual(before);
  });

  test("starts over from a restarted chain's slots after a reset", () => {
    const clock = createTickClock(TICK_MS);
    observeOnTime(clock, 0, 1_000);
    clock.reset();
    clock.observe(5, 1_100);
    expect(clock.estimate(1_100)).toBe(5);
  });
});
