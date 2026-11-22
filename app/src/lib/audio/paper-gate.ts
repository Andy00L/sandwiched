import { FLAP, flapParams } from "papercraft/lib/paper-sound.js";
import type { FlapVoicing } from "papercraft/lib/paper-sound.js";
import { seededUnit } from "./voice-gate";

export const FLAP_SPACING_S = 0.55;
export const FLAP_SPACING_JITTER_S = 0.2;
const FLAP_LATE_WINDOW_S = 0.08;
export const MAX_PAPER_VOICES = 10;
export const PECK_TICKS_PER_S = 6;
const OTHER_PECK_TICKS_PER_S = 4;
const PECK_TICK_GAP_S = 0.06;
const FLAP_TAIL_S = 0.012;
const CLOSING_SCORE = 0.7;

export type FlapRequest = { atS: number; size: number; isUp: boolean; seed: number };

export type ResolvedFlap = { atS: number; size: number; isUp: boolean; pitch: number; durS: number; level: number; synthSeed: number };

type FoldCandidate<Payload> = { request: FlapRequest; payload: Payload };

export type PaperGate<Payload> = {
  placeExemptFlap: (request: FlapRequest, voicing?: FlapVoicing) => ResolvedFlap | null;
  placeTick: (request: FlapRequest, voicing?: FlapVoicing) => ResolvedFlap | null;
  offerFold: (candidate: FoldCandidate<Payload>) => void;
  flushFolds: () => { flap: ResolvedFlap; payload: Payload } | null;
  reserveVoice: (atS: number, durationS: number) => boolean;
};

export type PeckTickLimiter = { tryTake: (atS: number, isOwn: boolean) => boolean };

function scoreFold(request: FlapRequest): number {
  return (0.85 + 0.15 * request.size) * (request.isUp ? 1 : CLOSING_SCORE);
}

export function createPeckTickLimiter(maxPerSecond = PECK_TICKS_PER_S, othersPerSecond = OTHER_PECK_TICKS_PER_S): PeckTickLimiter {
  let recent: { atS: number; isOwn: boolean }[] = [];
  return {
    tryTake(atS, isOwn) {
      recent = recent.filter((taken) => taken.atS > atS - 2);
      const lastSecond = recent.filter((taken) => taken.atS > atS - 1 && taken.atS <= atS);
      if (lastSecond.length >= maxPerSecond) return false;
      if (recent.some((taken) => Math.abs(taken.atS - atS) < PECK_TICK_GAP_S)) return false;
      if (!isOwn && lastSecond.filter((taken) => !taken.isOwn).length >= othersPerSecond) return false;
      recent.push({ atS, isOwn });
      return true;
    },
  };
}

export function createPaperGate<Payload>(): PaperGate<Payload> {
  let nextFlapS = Number.NEGATIVE_INFINITY;
  let lastSt: number | null = null;
  let voiceEnds: number[] = [];
  let pending: FoldCandidate<Payload> | null = null;

  const reserveVoice = (atS: number, durationS: number): boolean => {
    voiceEnds = voiceEnds.filter((endS) => endS > atS);
    if (voiceEnds.length >= MAX_PAPER_VOICES) return false;
    voiceEnds.push(atS + durationS);
    return true;
  };

  const resolve = (request: FlapRequest, atS: number, voicing: FlapVoicing, isPitchStepped: boolean): ResolvedFlap | null => {
    const params = flapParams({ size: request.size, up: request.isUp, seed: request.seed, lastSt: isPitchStepped ? lastSt : null }, voicing);
    if (!reserveVoice(atS, params.dur + FLAP_TAIL_S)) return null;
    if (isPitchStepped) {
      lastSt = params.st;
      const jitter = (seededUnit(params.synthSeed, "gap") * 2 - 1) * FLAP_SPACING_JITTER_S;
      nextFlapS = Math.max(nextFlapS, atS + FLAP_SPACING_S + jitter);
    }
    return { atS, size: request.size, isUp: request.isUp, pitch: params.pitch, durS: params.dur, level: params.level, synthSeed: params.synthSeed };
  };

  const placeSpacedFlap = (request: FlapRequest): ResolvedFlap | null => {
    if (request.atS < nextFlapS - FLAP_LATE_WINDOW_S) return null;
    return resolve(request, Math.max(request.atS, nextFlapS), FLAP, true);
  };

  return {
    placeExemptFlap: (request, voicing = FLAP) => resolve(request, request.atS, voicing, true),
    placeTick: (request, voicing = FLAP) => resolve(request, request.atS, voicing, false),
    offerFold(candidate) {
      if (pending === null || scoreFold(candidate.request) > scoreFold(pending.request)) pending = candidate;
    },
    flushFolds() {
      const best = pending;
      pending = null;
      if (best === null) return null;
      const flap = placeSpacedFlap(best.request);
      return flap === null ? null : { flap, payload: best.payload };
    },
    reserveVoice,
  };
}
