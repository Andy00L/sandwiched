import { seededUnit } from "./voice-gate";
import type { RewardRegister } from "./sound-plan";

const WALTZ_BPM = 72;
const WALTZ_BEATS_PER_BAR = 3;
const WALTZ_BEAT_S = 60 / WALTZ_BPM;
export const WALTZ_BAR_S = WALTZ_BEATS_PER_BAR * WALTZ_BEAT_S;
const WALTZ_BAR_COUNT = 16;
export const FINAL_STRETCH_S = 10;
export const REWARD_GAP_S = 0.25;
export const REWARD_PAIR_GAP_S = 0.17;
const REWARD_PAIR_LIFT = 1.1;

const BASS_VELOCITY = 0.3;
const INNER_VELOCITY = 0.16;
const MELODY_VELOCITY = 0.24;
const VELOCITY_SPREAD = 0.1;
const LEFT_HAND_JITTER_BEATS = 0.0175;
const RIGHT_HAND_LATE_BEATS = 0.015;
const RIGHT_HAND_JITTER_BEATS = 0.02;
const PHRASE_BARS = 8;
const BREATH_STRETCH = 0.05;
const THIN_EVERY_CYCLES = 3;
const LEFT_HAND_DROP_CHANCE = 0.3;
const MELODY_DROP_CHANCE = 0.22;
const QUIET_CYCLE_FACTOR = 0.85;

type Chord = readonly [bass: number, low: number, middle: number, high: number];

type WaltzBar = { chord: Chord; melody: readonly (readonly [beat: number, midi: number])[] };

export type WaltzPart = "bass" | "inner" | "melody" | "reward";

export type WaltzNote = { atS: number; midi: number; velocity: number; part: WaltzPart };

type RewardRange = { lowest: number; highest: number; velocity: number };

const REWARD_REGISTERS: readonly RewardRegister[] = ["high", "middle", "low"];

export const REWARD_RANGES: Readonly<Record<RewardRegister, RewardRange>> = {
  high: { lowest: 76, highest: 84, velocity: 0.15 },
  middle: { lowest: 64, highest: 72, velocity: 0.12 },
  low: { lowest: 43, highest: 57, velocity: 0.2 },
};

const SCORE: readonly WaltzBar[] = [
  { chord: [36, 52, 55, 60], melody: [[0, 64], [2, 67]] },
  { chord: [35, 50, 55, 59], melody: [[0, 67], [1, 65], [2, 62]] },
  { chord: [33, 52, 57, 60], melody: [[0, 64], [2, 60]] },
  { chord: [43, 52, 55, 59], melody: [[0, 59]] },
  { chord: [41, 53, 57, 60], melody: [[0, 60], [1, 62], [2, 65]] },
  { chord: [40, 52, 55, 60], melody: [[0, 64], [2, 67]] },
  { chord: [38, 53, 57, 60], melody: [[0, 65], [2, 62]] },
  { chord: [43, 53, 55, 59], melody: [[0, 62]] },
  { chord: [36, 52, 55, 60], melody: [[0, 67], [2, 69]] },
  { chord: [34, 52, 55, 58], melody: [[0, 67], [2, 64]] },
  { chord: [33, 53, 57, 60], melody: [[0, 65], [2, 69]] },
  { chord: [44, 53, 56, 60], melody: [[0, 68], [2, 65]] },
  { chord: [43, 52, 55, 60], melody: [[0, 64], [2, 67]] },
  { chord: [45, 52, 55, 57], melody: [[0, 64], [2, 60]] },
  { chord: [38, 53, 57, 60], melody: [[0, 62], [2, 65]] },
  { chord: [43, 53, 55, 59], melody: [[0, 62], [2, 59]] },
];

const LEFT_HAND: readonly (readonly [beat: number, tone: 0 | 1 | 2 | 3])[] = [
  [0, 0],
  [1, 1],
  [1.5, 2],
  [2, 3],
  [2.5, 2],
];

function spread(...parts: ReadonlyArray<string | number>): number {
  return seededUnit(...parts) * 2 - 1;
}

function barOf(absoluteBar: number): WaltzBar {
  const index = ((absoluteBar % WALTZ_BAR_COUNT) + WALTZ_BAR_COUNT) % WALTZ_BAR_COUNT;
  return SCORE[index] ?? { chord: [36, 52, 55, 60], melody: [] };
}

export function chordAt(musicS: number): Chord {
  return barOf(Math.floor(musicS / WALTZ_BAR_S)).chord;
}

function notesOfBar(absoluteBar: number): WaltzNote[] {
  const cycle = Math.floor(absoluteBar / WALTZ_BAR_COUNT);
  const barInCycle = absoluteBar % WALTZ_BAR_COUNT;
  const bar = barOf(absoluteBar);
  const barStartS = absoluteBar * WALTZ_BAR_S;
  const isPhraseEnd = barInCycle % PHRASE_BARS === PHRASE_BARS - 1;
  const timeOf = (beat: number, offsetBeats: number) => barStartS + (beat * (isPhraseEnd ? 1 + (BREATH_STRETCH * beat) / WALTZ_BEATS_PER_BAR : 1) + offsetBeats) * WALTZ_BEAT_S;
  const notes: WaltzNote[] = [];
  for (const [index, [beat, tone]] of LEFT_HAND.entries()) {
    const isThinned = cycle % THIN_EVERY_CYCLES === THIN_EVERY_CYCLES - 1 && !Number.isInteger(beat);
    const isDropped = index >= LEFT_HAND.length - 2 && seededUnit("waltz-drop", absoluteBar, index) < LEFT_HAND_DROP_CHANCE;
    if (isThinned || isDropped) continue;
    const velocity = (tone === 0 ? BASS_VELOCITY : INNER_VELOCITY) * (1 + spread("waltz-velocity", absoluteBar, index) * VELOCITY_SPREAD);
    notes.push({ atS: timeOf(beat, spread("waltz-left", absoluteBar, index) * LEFT_HAND_JITTER_BEATS), midi: bar.chord[tone], velocity, part: tone === 0 ? "bass" : "inner" });
  }
  for (const [index, [beat, midi]] of bar.melody.entries()) {
    if (cycle >= 1 && index > 0 && seededUnit("waltz-melody-drop", absoluteBar, index) < MELODY_DROP_CHANCE) continue;
    const velocity = MELODY_VELOCITY * (0.65 + 0.35 * seededUnit("waltz-melody-velocity", absoluteBar, index)) * (cycle % 2 === 1 ? QUIET_CYCLE_FACTOR : 1);
    notes.push({ atS: timeOf(beat, RIGHT_HAND_LATE_BEATS + spread("waltz-right", absoluteBar, index) * RIGHT_HAND_JITTER_BEATS), midi, velocity, part: "melody" });
  }
  return notes;
}

export function listWaltzNotes(fromS: number, toS: number, isFinalStretchAt: (musicS: number) => boolean): WaltzNote[] {
  const notes: WaltzNote[] = [];
  const firstBar = Math.max(0, Math.floor(fromS / WALTZ_BAR_S) - 1);
  const lastBar = Math.floor(toS / WALTZ_BAR_S);
  for (let absoluteBar = firstBar; absoluteBar <= lastBar; absoluteBar++) {
    for (const note of notesOfBar(absoluteBar)) {
      if (note.atS < fromS || note.atS >= toS) continue;
      notes.push(note);
      if (note.part === "bass" && isFinalStretchAt(note.atS)) notes.push({ ...note, midi: note.midi - 12 });
    }
  }
  return notes;
}

function isChordTone(midi: number, chord: Chord): boolean {
  return chord.some((tone) => (((midi - tone) % 12) + 12) % 12 === 0);
}

function rewardPool(register: RewardRegister, chord: Chord, isReady: (midi: number) => boolean): number[] {
  const range = REWARD_RANGES[register];
  const pool: number[] = [];
  for (let midi = range.lowest; midi <= range.highest; midi++) if (isChordTone(midi, chord) && isReady(midi)) pool.push(midi);
  return pool;
}

export function listWaltzPitches(): number[] {
  const pitches = new Set<number>();
  for (const bar of SCORE) {
    for (const tone of bar.chord) pitches.add(tone);
    pitches.add(bar.chord[0] - 12);
    for (const [, midi] of bar.melody) pitches.add(midi);
  }
  return [...pitches].sort((first, second) => first - second);
}

export function listRewardPitches(): number[] {
  const pitches = new Set<number>();
  for (const register of REWARD_REGISTERS) {
    for (const bar of SCORE) for (const midi of rewardPool(register, bar.chord, () => true)) pitches.add(midi);
  }
  return [...pitches].sort((first, second) => first - second);
}

type RewardNotes = {
  pick: (register: RewardRegister, noteCount: 1 | 2, atS: number, musicS: number, isReady: (midi: number) => boolean) => WaltzNote[];
};

export function createRewardNotes(): RewardNotes {
  let lastRewardS = Number.NEGATIVE_INFINITY;
  let turn = 0;
  return {
    pick(register, noteCount, atS, musicS, isReady) {
      if (atS - lastRewardS < REWARD_GAP_S) return [];
      const pool = rewardPool(register, chordAt(musicS), isReady);
      const first = pool[turn % Math.max(1, pool.length)];
      if (first === undefined) return [];
      lastRewardS = atS;
      turn++;
      const { velocity } = REWARD_RANGES[register];
      const notes: WaltzNote[] = [{ atS, midi: first, velocity, part: "reward" }];
      const second = pool.find((midi) => midi > first);
      if (noteCount === 2 && second !== undefined) notes.push({ atS: atS + REWARD_PAIR_GAP_S, midi: second, velocity: velocity * REWARD_PAIR_LIFT, part: "reward" });
      return notes;
    },
  };
}
