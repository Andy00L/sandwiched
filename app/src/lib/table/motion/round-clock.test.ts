import { describe, expect, test } from "bun:test";
import { TIMER_KICK_RAD } from "./motion-tokens";
import { timerKickRad, timerSweep, timerWedgeShare } from "./round-clock";

const ROUND_TICKS = 4_500;
const END_TICK = 10_000;

describe("timerSweep", () => {
  test("rests at twelve before the draw, turns once over the round, and stays at twelve after the end", () => {
    expect(timerSweep(1_000, null, ROUND_TICKS)).toBe(0);
    expect(timerSweep(END_TICK - ROUND_TICKS - 50, END_TICK, ROUND_TICKS)).toBe(0);
    expect(timerSweep(END_TICK - ROUND_TICKS / 2, END_TICK, ROUND_TICKS)).toBeCloseTo(0.5, 6);
    expect(timerSweep(END_TICK + 300, END_TICK, ROUND_TICKS)).toBe(1);
  });
});

describe("timerKickRad", () => {
  test("does not kick before the last ten seconds or after the end", () => {
    expect(timerKickRad(10_001)).toBe(0);
    expect(timerKickRad(0)).toBe(0);
    expect(timerKickRad(-200)).toBe(0);
  });

  test("kicks two degrees on each second and alternates sides", () => {
    expect(Math.abs(timerKickRad(9_000))).toBeCloseTo(TIMER_KICK_RAD, 6);
    expect(Math.sign(timerKickRad(9_000))).toBe(-Math.sign(timerKickRad(8_000)));
    expect(Math.abs(timerKickRad(8_500))).toBeLessThan(TIMER_KICK_RAD * 0.05);
  });
});

describe("timerWedgeShare", () => {
  test("prints the last ten seconds of a 45 second round as two ninths of the dial", () => {
    expect(timerWedgeShare(45_000)).toBeCloseTo(10 / 45, 6);
  });
});
