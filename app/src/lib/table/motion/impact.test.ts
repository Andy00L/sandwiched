import { describe, expect, test } from "bun:test";
import { flipperShadowHeightUnits, focusPullAmount, hitStopMs, HIT_STOP_CATCH_UP_MS, isFlipperShadowShown, presentationTick } from "./impact";
import { FOCUS_RETURN_MS, SLAM_DOWN_MS, SLAM_HOLD_MS, SLAM_LIFT_MS } from "./motion-tokens";

const TICK_MS = 10;
const WINDUP_MS = 350;
const STUN_MS = 1500;

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

describe("rack focus to the struck box (plan/07 section 4.2)", () => {
  test("stays on the table while the flipper rises, is on the box by the down stroke, holds through the stun, then returns", () => {
    expect(focusPullAmount(-WINDUP_MS, WINDUP_MS, STUN_MS)).toBe(0);
    expect(focusPullAmount(-WINDUP_MS + 179, WINDUP_MS, STUN_MS)).toBe(0);
    expect(focusPullAmount(-SLAM_DOWN_MS, WINDUP_MS, STUN_MS)).toBe(1);
    expect(focusPullAmount(STUN_MS - 1, WINDUP_MS, STUN_MS)).toBe(1);
    expect(focusPullAmount(STUN_MS + FOCUS_RETURN_MS, WINDUP_MS, STUN_MS)).toBe(0);
    expect(focusPullAmount(SLAM_HOLD_MS + SLAM_LIFT_MS - 1, WINDUP_MS, 0)).toBe(1);
  });

  test("never jumps more than 4 % of the pull in one millisecond", () => {
    for (let ms = -WINDUP_MS - 10; ms < STUN_MS + 1000; ms += 1) {
      expect(Math.abs(focusPullAmount(ms + 1, WINDUP_MS, STUN_MS) - focusPullAmount(ms, WINDUP_MS, STUN_MS))).toBeLessThan(0.04);
    }
  });

  test("the flipper shadow comes down onto the lid until contact, then lifts away with the flipper", () => {
    const heights = Array.from({ length: WINDUP_MS + 1 }, (_unused, step) => flipperShadowHeightUnits(step - WINDUP_MS, WINDUP_MS));
    for (const [index, height] of heights.entries()) if (index > 0) expect(height).toBeLessThanOrEqual(heights[index - 1] ?? height);
    expect(flipperShadowHeightUnits(0, WINDUP_MS)).toBeLessThan(0.5);
    expect(flipperShadowHeightUnits(SLAM_HOLD_MS - 1, WINDUP_MS)).toBeLessThan(0.5);
    expect(flipperShadowHeightUnits(SLAM_HOLD_MS + SLAM_LIFT_MS, WINDUP_MS)).toBeGreaterThan(flipperShadowHeightUnits(-WINDUP_MS + 200, WINDUP_MS));
  });

  test("the flipper shadow lives from the click until the flipper is back at rest", () => {
    expect(isFlipperShadowShown(-WINDUP_MS - 1, WINDUP_MS)).toBe(false);
    expect(isFlipperShadowShown(-WINDUP_MS, WINDUP_MS)).toBe(true);
    expect(isFlipperShadowShown(SLAM_HOLD_MS + SLAM_LIFT_MS - 1, WINDUP_MS)).toBe(true);
    expect(isFlipperShadowShown(SLAM_HOLD_MS + SLAM_LIFT_MS, WINDUP_MS)).toBe(false);
  });
});
