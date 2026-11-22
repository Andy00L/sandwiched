import { describe, expect, test } from "bun:test";
import { REWARD_GAP_S, REWARD_PAIR_GAP_S, REWARD_RANGES, WALTZ_BAR_S, chordAt, createRewardNotes, listWaltzNotes } from "./waltz";

const always = () => true;
const isChordTone = (midi: number, chord: readonly number[]) => chord.some((tone) => (((midi - tone) % 12) + 12) % 12 === 0);

describe("reward notes", () => {
  test("play a chord tone of the bar sounding now, in the register of the crumb", () => {
    const rewards = createRewardNotes();
    for (let step = 0; step < 40; step++) {
      const musicS = step * 0.9;
      const [note] = rewards.pick("high", 1, step, musicS, always);
      expect(note).toBeDefined();
      expect(isChordTone(note?.midi ?? 0, chordAt(musicS))).toBe(true);
      expect(note?.midi).toBeGreaterThanOrEqual(REWARD_RANGES.high.lowest);
      expect(note?.midi).toBeLessThanOrEqual(REWARD_RANGES.high.highest);
    }
  });

  test("sound at most once per 250 ms", () => {
    const rewards = createRewardNotes();
    expect(rewards.pick("middle", 1, 1, 1, always).length).toBe(1);
    expect(rewards.pick("middle", 1, 1 + REWARD_GAP_S - 0.01, 1, always)).toEqual([]);
    expect(rewards.pick("middle", 1, 1 + REWARD_GAP_S, 1, always).length).toBe(1);
  });

  test("a streak inside one bar plays a rising line", () => {
    const rewards = createRewardNotes();
    const streak = [0, 0.3, 0.6].map((atS) => rewards.pick("high", 1, atS, 0.1, always)[0]?.midi ?? 0);
    expect(streak[1]).toBeGreaterThan(streak[0] ?? 0);
    expect(streak[2]).toBeGreaterThan(streak[1] ?? 0);
  });

  test("a big slam gives two rising low notes 0.17 s apart, the second louder", () => {
    const [first, second] = createRewardNotes().pick("low", 2, 3, 3, always);
    expect((second?.atS ?? 0) - (first?.atS ?? 0)).toBeCloseTo(REWARD_PAIR_GAP_S);
    expect(second?.midi).toBeGreaterThan(first?.midi ?? 0);
    expect(second?.velocity).toBeGreaterThan(first?.velocity ?? 0);
  });

  test("stay silent while no pitch of the chord is ready", () => {
    expect(createRewardNotes().pick("low", 1, 0, 0, () => false)).toEqual([]);
  });
});

describe("the last 10 seconds", () => {
  test("double the bass an octave down and change nothing else", () => {
    const plain = listWaltzNotes(0, 4 * WALTZ_BAR_S, () => false);
    const doubled = listWaltzNotes(0, 4 * WALTZ_BAR_S, () => true);
    const added = doubled.filter((note) => !plain.includes(note) && !plain.some((other) => other.atS === note.atS && other.midi === note.midi));
    const basses = plain.filter((note) => note.part === "bass");
    expect(added.length).toBe(basses.length);
    expect(added.map((note) => note.midi)).toEqual(basses.map((note) => note.midi - 12));
    expect(doubled.filter((note) => note.part !== "bass")).toEqual(plain.filter((note) => note.part !== "bass"));
  });
});
