import { describe, expect, test } from "bun:test";
import { FLAP_SPACING_S, FLAP_SPACING_JITTER_S, MAX_PAPER_VOICES, PECK_TICKS_PER_S, createPaperGate, createPeckTickLimiter } from "./paper-gate";

describe("peck ticks", () => {
  test("play at most 6 in any second across all players", () => {
    const limiter = createPeckTickLimiter();
    const taken = Array.from({ length: 40 }, (_unused, index) => index * 0.05).filter((atS) => limiter.tryTake(atS, false));
    for (const atS of taken) expect(taken.filter((other) => other > atS - 1 && other <= atS).length).toBeLessThanOrEqual(PECK_TICKS_PER_S);
  });

  test("keep room for the player's own pecks when others fill the second", () => {
    const limiter = createPeckTickLimiter();
    const othersTaken = [0, 0.1, 0.2, 0.3, 0.4, 0.5].filter((atS) => limiter.tryTake(atS, false));
    expect(othersTaken).toEqual([0, 0.1, 0.2, 0.3]);
    expect(limiter.tryTake(0.6, true)).toBe(true);
    expect(limiter.tryTake(0.7, true)).toBe(true);
    expect(limiter.tryTake(0.8, true)).toBe(false);
  });

  test("give one tick when several pigeons peck on the same instant", () => {
    const limiter = createPeckTickLimiter();
    expect([true, false, false, false].map((isOwn) => limiter.tryTake(5, isOwn))).toEqual([true, false, false, false]);
  });
});

describe("fold flaps", () => {
  const fold = (atS: number, size: number, isUp: boolean) => ({ request: { atS, size, isUp, seed: 7 }, payload: atS });

  test("voice only the largest rising fold of a frame", () => {
    const gate = createPaperGate<string>();
    gate.offerFold({ request: { atS: 1, size: 0.25, isUp: false, seed: 1 }, payload: "small closing" });
    gate.offerFold({ request: { atS: 1, size: 0.25, isUp: true, seed: 2 }, payload: "small rising" });
    gate.offerFold({ request: { atS: 1, size: 0.4, isUp: false, seed: 3 }, payload: "large closing" });
    expect(gate.flushFolds()?.payload).toBe("small rising");
    expect(gate.flushFolds()).toBeNull();
  });

  test("keep 0.35 to 0.75 s between fold onsets and drop the ones that come too soon", () => {
    const gate = createPaperGate<number>();
    gate.offerFold(fold(1, 0.25, true));
    expect(gate.flushFolds()?.flap.atS).toBe(1);
    gate.offerFold(fold(1.2, 0.25, true));
    expect(gate.flushFolds()).toBeNull();
    gate.offerFold(fold(1 + FLAP_SPACING_S + FLAP_SPACING_JITTER_S + 0.01, 0.25, true));
    expect(gate.flushFolds()).not.toBeNull();
  });

  test("let the telegraph and the reveal lids through, and push the next fold back", () => {
    const gate = createPaperGate<number>();
    const lids = [10, 10.12, 10.24].map((atS) => gate.placeExemptFlap({ atS, size: 0.35, isUp: true, seed: 3 }));
    expect(lids.map((lid) => lid?.atS)).toEqual([10, 10.12, 10.24]);
    gate.offerFold(fold(10.3, 0.25, true));
    expect(gate.flushFolds()).toBeNull();
  });

  test("refuse a new paper sound while 10 are still sounding", () => {
    const gate = createPaperGate<number>();
    const reserved = Array.from({ length: MAX_PAPER_VOICES + 2 }, () => gate.reserveVoice(0, 0.2));
    expect(reserved.filter(Boolean).length).toBe(MAX_PAPER_VOICES);
    expect(gate.reserveVoice(0.25, 0.2)).toBe(true);
  });
});
