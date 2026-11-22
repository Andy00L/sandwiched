import { hashSeed } from "papercraft/lib/paper-sound.js";
import * as P2 from "papercraft/lib/paperkit-2d.js";
import { VOICE_RULES, characterKey } from "./voices";
import type { VoiceCharacter, VoiceFile, VoiceNeed } from "./voices";

export const CHARACTER_GAP_S = 0.25;
const MAX_VOICES_AT_ONCE = 3;
const PIGEON_PITCH_SPREAD_ST = 1;
const FORGET_AFTER_S = 30;
const SEED_RANGE = 4294967296;

export type VoicePlay = { playId: number; file: VoiceFile; atS: number; rate: number; durationS: number; cuts: readonly number[]; isUnducked: boolean };

type VoiceRequest = { need: VoiceNeed; character: VoiceCharacter; atS: number };

export type VoiceGate = { request: (wanted: VoiceRequest) => VoicePlay | null };

type VariantRotation = { next: () => number };

type ActiveVoice = { playId: number; character: string; priority: number; endS: number };

export function seededUnit(...parts: ReadonlyArray<string | number>): number {
  return hashSeed(...parts) / SEED_RANGE;
}

export function createVariantRotation(seed: number, count: number): VariantRotation {
  const random = P2.rng(seed);
  let order: number[] = [];
  let lastPicked: number | null = null;
  const reshuffle = () => {
    order = Array.from({ length: count }, (_unused, index) => index);
    for (let index = count - 1; index > 0; index--) {
      const swapWith = Math.floor(random() * (index + 1));
      const held = order[index] ?? 0;
      order[index] = order[swapWith] ?? 0;
      order[swapWith] = held;
    }
    if (count > 1 && order[0] === lastPicked) {
      const first = order[0] ?? 0;
      order[0] = order[1] ?? 0;
      order[1] = first;
    }
  };
  return {
    next() {
      if (order.length === 0) reshuffle();
      const picked = order.shift() ?? 0;
      lastPicked = picked;
      return picked;
    },
  };
}

export function pigeonPitchRate(roundSeed: number, seat: number): number {
  const offsetSt = (seededUnit(roundSeed, "pitch", seat) * 2 - 1) * PIGEON_PITCH_SPREAD_ST;
  return Math.pow(2, offsetSt / 12);
}

function groupFilesByNeed(files: readonly VoiceFile[]): ReadonlyMap<VoiceNeed, readonly VoiceFile[]> {
  const byNeed = new Map<VoiceNeed, VoiceFile[]>();
  for (const file of files) byNeed.set(file.need, [...(byNeed.get(file.need) ?? []), file]);
  return byNeed;
}

export function createVoiceGate(files: readonly VoiceFile[], roundSeed: number): VoiceGate {
  const filesByNeed = groupFilesByNeed(files);
  const rotations = new Map<VoiceNeed, VariantRotation>();
  const lastStartByCharacter = new Map<string, number>();
  const lastStartByCharacterNeed = new Map<string, number>();
  let active: ActiveVoice[] = [];
  let nextPlayId = 1;

  const rotationFor = (need: VoiceNeed, count: number): VariantRotation => {
    const known = rotations.get(need);
    if (known) return known;
    const created = createVariantRotation(hashSeed(roundSeed, "variants", need), count);
    rotations.set(need, created);
    return created;
  };

  return {
    request({ need, character, atS }) {
      const choices = filesByNeed.get(need) ?? [];
      if (choices.length === 0) return null;
      const rule = VOICE_RULES[need];
      const speaker = characterKey(character);
      const needKey = `${speaker}|${need}`;
      if (!rule.canInterrupt && atS - (lastStartByCharacter.get(speaker) ?? Number.NEGATIVE_INFINITY) < CHARACTER_GAP_S) return null;
      if (atS - (lastStartByCharacterNeed.get(needKey) ?? Number.NEGATIVE_INFINITY) < rule.minGapS) return null;
      active = active.filter((voice) => voice.endS > atS - FORGET_AFTER_S);
      const sounding = active.filter((voice) => voice.endS > atS);
      const cuts: number[] = [];
      const sameSpeaker = sounding.find((voice) => voice.character === speaker);
      if (sameSpeaker) {
        if (sameSpeaker.priority > rule.priority) return null;
        cuts.push(sameSpeaker.playId);
      }
      const others = sounding.filter((voice) => voice.character !== speaker);
      if (others.length >= MAX_VOICES_AT_ONCE) {
        const quietest = others.reduce((lowest, voice) => (voice.priority < lowest.priority ? voice : lowest));
        if (quietest.priority >= rule.priority) return null;
        cuts.push(quietest.playId);
      }
      const file = choices[rotationFor(need, choices.length).next() % choices.length];
      if (file === undefined) return null;
      const rate = character.kind === "pigeon" ? pigeonPitchRate(roundSeed, character.seat) : 1;
      const durationS = file.durationS / rate;
      const playId = nextPlayId++;
      active = active.map((voice) => (cuts.includes(voice.playId) ? { ...voice, endS: atS } : voice));
      active.push({ playId, character: speaker, priority: rule.priority, endS: atS + durationS });
      lastStartByCharacter.set(speaker, atS);
      lastStartByCharacterNeed.set(needKey, atS);
      return { playId, file, atS, rate, durationS, cuts, isUnducked: rule.isUnducked };
    },
  };
}
