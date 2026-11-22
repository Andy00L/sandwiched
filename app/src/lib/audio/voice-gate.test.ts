import { describe, expect, test } from "bun:test";
import { CHARACTER_GAP_S, createVariantRotation, createVoiceGate, pigeonPitchRate } from "./voice-gate";
import type { VoiceFile, VoiceNeed } from "./voices";

const file = (id: string, need: VoiceNeed, durationS = 0.4): VoiceFile => ({ id, need, url: `/audio/${id}.ogg`, durationS, peakDbfs: -3 });

const FILES: readonly VoiceFile[] = [
  file("ow-1", "pigeonOw"),
  file("ow-2", "pigeonOw"),
  file("ow-3", "pigeonOw"),
  file("windup", "whaleWindup", 0.35),
  file("grunt", "whaleGrunt", 0.3),
  file("coo", "pigeonCoo", 1.5),
  file("whistle", "refereeWhistle", 0.4),
];

describe("variant rotation", () => {
  test("never plays the same take twice in a row and uses every take", () => {
    for (const count of [2, 3, 5]) {
      const rotation = createVariantRotation(11, count);
      const picks = Array.from({ length: 300 }, () => rotation.next());
      expect(picks.some((pick, index) => index > 0 && pick === picks[index - 1])).toBe(false);
      expect(new Set(picks).size).toBe(count);
    }
  });

  test("gives the same order for the same seed", () => {
    const first = createVariantRotation(42, 3);
    const second = createVariantRotation(42, 3);
    expect(Array.from({ length: 12 }, () => first.next())).toEqual(Array.from({ length: 12 }, () => second.next()));
  });
});

describe("voice playback rules", () => {
  test("a character speaks at most once per 250 ms", () => {
    const gate = createVoiceGate(FILES, 1);
    const pigeon = { kind: "pigeon", seat: 2 } as const;
    expect(gate.request({ need: "pigeonOw", character: pigeon, atS: 1 })).not.toBeNull();
    expect(gate.request({ need: "pigeonOw", character: pigeon, atS: 1 + CHARACTER_GAP_S - 0.01 })).toBeNull();
    expect(gate.request({ need: "pigeonOw", character: { kind: "pigeon", seat: 3 }, atS: 1.1 })).not.toBeNull();
  });

  test("at most 3 voices at once, and a more important voice takes the place of a lesser one", () => {
    const gate = createVoiceGate(FILES, 1);
    const coos = [0, 1, 2].map((seat) => gate.request({ need: "pigeonCoo", character: { kind: "pigeon", seat }, atS: 0 }));
    expect(coos.every((play) => play !== null)).toBe(true);
    expect(gate.request({ need: "pigeonCoo", character: { kind: "pigeon", seat: 3 }, atS: 0.1 })).toBeNull();
    const whistle = gate.request({ need: "refereeWhistle", character: { kind: "referee" }, atS: 0.2 });
    expect(whistle?.cuts.length).toBe(1);
    expect(coos.map((play) => play?.playId)).toContain(whistle?.cuts[0]);
  });

  test("the slam grunt cuts the wind-up of the same whale", () => {
    const gate = createVoiceGate(FILES, 1);
    const windup = gate.request({ need: "whaleWindup", character: { kind: "whale" }, atS: 3 });
    const grunt = gate.request({ need: "whaleGrunt", character: { kind: "whale" }, atS: 3.3 });
    expect(grunt?.cuts).toEqual([windup?.playId ?? -1]);
    expect(grunt?.isUnducked).toBe(true);
  });

  test("each pigeon keeps one pitch offset within a semitone for the whole round", () => {
    const rates = Array.from({ length: 20 }, (_unused, seat) => pigeonPitchRate(99, seat));
    for (const rate of rates) expect(Math.abs(12 * Math.log2(rate))).toBeLessThanOrEqual(1);
    expect(new Set(rates).size).toBeGreaterThan(15);
    const gate = createVoiceGate(FILES, 99);
    const first = gate.request({ need: "pigeonOw", character: { kind: "pigeon", seat: 4 }, atS: 0 });
    const later = gate.request({ need: "pigeonOw", character: { kind: "pigeon", seat: 4 }, atS: 5 });
    expect(first?.rate).toBe(pigeonPitchRate(99, 4));
    expect(later?.rate).toBe(first?.rate ?? 0);
  });
});
