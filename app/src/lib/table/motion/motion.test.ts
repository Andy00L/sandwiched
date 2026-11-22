import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { FlapSpring } from "papercraft/lib/paperkit-3d.js";
import { parseRecordedRound } from "../../game/round-events";
import { PECK_STRIKE_MS } from "./motion-tokens";
import { flightPlacement, peckDepth } from "./pigeon-clips";
import { popScale, stepFlip } from "./verbs";

const FRAME_30_S = 1 / 30;
const FRAME_60_MS = 1000 / 60;
const DEGREES_PER_UNIT = 90;

function sampleSpring(start: number, target: number, size: number, seconds: number, dtSeconds: number): number[] {
  const spring = new FlapSpring({ p: start, size });
  spring.set(target);
  return Array.from({ length: Math.round(seconds / dtSeconds) + 1 }, (_unused, frame) => (frame === 0 ? start : spring.step(dtSeconds)));
}

function countReversals(samples: readonly number[], minimumDegrees: number): number {
  let reversals = 0;
  let direction = 0;
  let extreme = samples[0] ?? 0;
  for (const value of samples) {
    const move = value - extreme;
    if (direction >= 0 && move < -minimumDegrees / DEGREES_PER_UNIT) {
      if (direction > 0) reversals += 1;
      direction = -1;
      extreme = value;
    } else if (direction <= 0 && move > minimumDegrees / DEGREES_PER_UNIT) {
      if (direction < 0) reversals += 1;
      direction = 1;
      extreme = value;
    } else if ((direction > 0 && value > extreme) || (direction < 0 && value < extreme)) {
      extreme = value;
    }
  }
  return reversals;
}

describe("motion acceptance (plan/07 section 12)", () => {
  test("item 1: a pigeon card's rise stays inside the published bands", () => {
    const rise = sampleSpring(0, 1, 0.3, 1.2, FRAME_30_S);
    const overshoot = Math.max(...rise) - 1;
    const firstUpright = rise.findIndex((value) => value >= 1) * FRAME_30_S;
    const settledFrom = rise.findLastIndex((value) => Math.abs(value - 1) > 0.3 / DEGREES_PER_UNIT) * FRAME_30_S;
    expect(overshoot).toBeGreaterThanOrEqual(0.08);
    expect(overshoot).toBeLessThanOrEqual(0.15);
    expect(firstUpright).toBeGreaterThanOrEqual(0.18);
    expect(firstUpright).toBeLessThanOrEqual(0.32);
    expect(countReversals(rise, 0.5)).toBeGreaterThanOrEqual(4);
    expect(countReversals(rise, 0.5)).toBeLessThanOrEqual(6);
    expect(settledFrom).toBeLessThanOrEqual(1.1);
  });

  test("item 1: a pigeon card's fall settles in time with a small rebound", () => {
    const fall = sampleSpring(1, 0, 0.3, 1.2, FRAME_30_S);
    const firstFlat = fall.findIndex((value) => value <= 0.01);
    const settledAt = (fall.findLastIndex((value) => Math.abs(value) > 0.005) + 1) * FRAME_30_S;
    expect(firstFlat).toBeGreaterThan(0);
    expect(Math.max(...fall.slice(firstFlat))).toBeLessThanOrEqual(0.03);
    expect(Math.min(...fall)).toBeGreaterThanOrEqual(0);
    expect(settledAt).toBeGreaterThanOrEqual(0.4);
    expect(settledAt).toBeLessThanOrEqual(0.85);
  });

  test("item 2: the same input gives the same pose at 20, 60 and 144 fps, within a tenth of a degree", () => {
    const poseAtHalfSecond = (framesPerSecond: number) => sampleSpring(0, 1, 0.3, 0.5, 1 / framesPerSecond).at(-1) ?? Number.NaN;
    const tenthOfDegree = 0.1 / DEGREES_PER_UNIT;
    expect(Math.abs(poseAtHalfSecond(60) - poseAtHalfSecond(20))).toBeLessThan(tenthOfDegree);
    expect(Math.abs(poseAtHalfSecond(144) - poseAtHalfSecond(20))).toBeLessThan(tenthOfDegree);
  });

  test("item 4: a flight lasts the rule's 500 ms and lands on its tick", () => {
    const parsed = parseRecordedRound(JSON.parse(readFileSync(join(import.meta.dir, "../../../../tests/rounds/balanced.json"), "utf8")));
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    const { flightTicks } = parsed.round.timing;
    expect(flightTicks * parsed.round.tickMs).toBe(500);
    const from = { along: -4, deckZ: -2 };
    const to = { along: 3, deckZ: -6 };
    const heights = { fromHeight: 3, toHeight: 0 };
    const atTick = (nowTick: number) => flightPlacement(from, to, heights, { startTick: 100, landsTick: 100 + flightTicks, nowTick });
    expect(atTick(100)).toMatchObject({ progress: 0, along: -4, height: 3 });
    expect(atTick(100 + flightTicks)).toMatchObject({ progress: 1, along: 3, deckZ: -6 });
    expect(atTick(100 + flightTicks).height).toBeCloseTo(0, 9);
    expect(atTick(100 + flightTicks - FRAME_60_MS / parsed.round.tickMs).progress).toBeLessThan(1);
  });

  test("item 5: the peck strikes 70 ms after the input, within one frame", () => {
    expect(peckDepth(PECK_STRIKE_MS)).toBe(1);
    expect(peckDepth(PECK_STRIKE_MS - FRAME_60_MS)).toBeLessThan(1);
    expect(peckDepth(0)).toBe(0);
  });

  test("the flip verb turns a pigeon in under 0.2 s and never shows it edge-on", () => {
    let flip = 1;
    let elapsed = 0;
    const seen: number[] = [];
    while (flip > -1 && elapsed < 1) {
      flip = stepFlip(flip, -1, FRAME_60_MS / 1000);
      seen.push(flip);
      elapsed += FRAME_60_MS / 1000;
    }
    expect(elapsed).toBeLessThanOrEqual(0.2);
    expect(seen.every((value) => Math.abs(value) >= 0.12)).toBe(true);
  });

  test("the pop verb peaks near 1.07", () => {
    expect(popScale(0.61)).toBeCloseTo(1.07, 2);
    expect(popScale(1)).toBe(1);
  });
});
