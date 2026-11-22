import { Biquad, FLAP, SURFACES, grain, noiseGen, synthFlap, synthStep } from "papercraft/lib/paper-sound.js";
import type { FlapVoicing, SurfaceVoicing } from "papercraft/lib/paper-sound.js";

const TICK_GAIN = 0.28;
const THUMP_LEVEL = 0.3;
const KNOCK_GAIN = 1.3;
export const THUMP_LENGTH_S = 0.22;
export const STEP_LENGTH_S = 0.09;
const LID_SURFACE = "tin";

const TIN_SURFACE: SurfaceVoicing = { bedHz: 1000, bedQ: 0.7, bedGain: 0.5, resHz: [620, 1400], resQ: [2.2, 1.8], grain: 0.2, scuffs: 2, lpHz: 1900, knock: 0.7, gain: 0.9 };
const THUMP_DECAY_S = 0.04;
const THUMP_BAND_HZ = 90;
const THUMP_BAND_Q = 1.2;
const KNOCK_BODY_HZ = 180;
const KNOCK_BODY_Q = 8;
const KNOCK_FLAP_SHARE = 0.6;
const KNOCK_BODY_SHARE = 0.8;
const KNOCK_GRAIN_AT_S = 0.0008;
const KNOCK_GRAIN_DECAY_S = 0.003;
const ATTACK_S = 0.002;
const RELEASE_S = 0.03;

export type FlapTone = "plain" | "tick" | "timer" | "whoosh" | "knock";

type ToneVoicing = { voicing: FlapVoicing; gain: number };

const TONES: Readonly<Record<FlapTone, ToneVoicing>> = {
  plain: { voicing: FLAP, gain: 1 },
  tick: { voicing: { ...FLAP, lpHz: 4000 }, gain: TICK_GAIN },
  timer: { voicing: FLAP, gain: TICK_GAIN },
  whoosh: { voicing: { ...FLAP, lpHz: 1200, airLpHz: 1200 }, gain: 1 },
  knock: { voicing: FLAP, gain: KNOCK_GAIN },
};

export type PaperRecipe =
  | { kind: "flap"; tone: FlapTone; size: number; isUp: boolean; pitch: number; durS: number; synthSeed: number; level: number }
  | { kind: "step"; seed: number; foot: number }
  | { kind: "thump"; seed: number };

type RenderedPaper = { samples: Float32Array<ArrayBuffer>; level: number };

export function voicingForTone(tone: FlapTone): FlapVoicing {
  return TONES[tone].voicing;
}

function normalisePeak(samples: Float32Array<ArrayBuffer>): Float32Array<ArrayBuffer> {
  let peak = 1e-9;
  for (const sample of samples) peak = Math.max(peak, Math.abs(sample));
  for (let index = 0; index < samples.length; index++) samples[index] = (samples[index] ?? 0) / peak;
  return samples;
}

function applyEdges(samples: Float32Array<ArrayBuffer>, sampleRate: number): Float32Array<ArrayBuffer> {
  const attackCount = Math.max(1, Math.round(ATTACK_S * sampleRate));
  const releaseCount = Math.max(1, Math.round(RELEASE_S * sampleRate));
  for (let index = 0; index < samples.length; index++) {
    const edge = Math.max(0, Math.min(1, index / attackCount, (samples.length - 1 - index) / releaseCount));
    samples[index] = (samples[index] ?? 0) * edge * edge * (3 - 2 * edge);
  }
  return samples;
}

function synthThump(seed: number, sampleRate: number): Float32Array<ArrayBuffer> {
  const samples = new Float32Array(Math.ceil(THUMP_LENGTH_S * sampleRate));
  const noise = noiseGen(seed);
  const firstBand = new Biquad("bp", THUMP_BAND_HZ, THUMP_BAND_Q, sampleRate);
  const secondBand = new Biquad("bp", THUMP_BAND_HZ, THUMP_BAND_Q, sampleRate);
  const decayPerSample = Math.exp(-1 / (THUMP_DECAY_S * sampleRate));
  let envelope = 1;
  for (let index = 0; index < samples.length; index++) {
    samples[index] = secondBand.run(firstBand.run(noise() * envelope));
    envelope *= decayPerSample;
  }
  return normalisePeak(applyEdges(samples, sampleRate));
}

function synthKnock(flap: Float32Array<ArrayBuffer>, seed: number, sampleRate: number): Float32Array<ArrayBuffer> {
  const excitation = new Float32Array(flap.length);
  grain(excitation, sampleRate, noiseGen(seed ^ 0x6b6e), KNOCK_GRAIN_AT_S, 1, KNOCK_GRAIN_DECAY_S);
  const body = new Biquad("bp", KNOCK_BODY_HZ, KNOCK_BODY_Q, sampleRate);
  const ring = normalisePeak(excitation.map((sample) => body.run(sample)));
  const mixed = flap.map((sample, index) => KNOCK_FLAP_SHARE * sample + KNOCK_BODY_SHARE * (ring[index] ?? 0));
  return normalisePeak(applyEdges(mixed, sampleRate));
}

function ensureLidSurface(): void {
  SURFACES[LID_SURFACE] ??= TIN_SURFACE;
}

export function renderPaperRecipe(recipe: PaperRecipe, sampleRate: number): RenderedPaper {
  if (recipe.kind === "thump") return { samples: synthThump(recipe.seed, sampleRate), level: THUMP_LEVEL };
  if (recipe.kind === "step") {
    ensureLidSurface();
    const step = synthStep({ surface: LID_SURFACE, foot: recipe.foot, seed: recipe.seed, sr: sampleRate });
    return { samples: step.buf, level: step.level };
  }
  const tone = TONES[recipe.tone];
  const flap = synthFlap({ size: recipe.size, up: recipe.isUp, pitch: recipe.pitch, dur: recipe.durS, seed: recipe.synthSeed, air: 0, sr: sampleRate }, tone.voicing);
  const samples = recipe.tone === "knock" ? synthKnock(flap, recipe.synthSeed, sampleRate) : flap;
  return { samples, level: recipe.level * tone.gain };
}
