import type { VoiceFile } from "./voices";

export const PAN_SCALE = 0.5;
const MASTER_GAIN = 0.855;
const LIMITER_KNEE = 0.6;
export const DUCK_GAIN = Math.pow(10, -4 / 20);
export const DUCK_ATTACK_S = 0.01;
export const DUCK_HOLD_S = 0.3;
const DUCK_RELEASE_S = 0.08;
const VOICE_GAIN = 0.28;
const VOICE_PEAK_CEILING_DBFS = -18.5;
export const MUSIC_GAIN = 0.53;
export const MUSIC_FADE_IN_S = 4;
export const MUTE_FADE_S = 0.015;
export const VOICE_CUT_FADE_S = 0.015;

const CENTRE_PAN_GAIN = Math.SQRT1_2;

export type AudioBus = "music" | "sounds" | "voices";

export type AudioLevels = Readonly<Record<AudioBus, number>>;

export const DEFAULT_LEVELS: AudioLevels = { music: 1, sounds: 1, voices: 1 };

function dbToGain(decibels: number): number {
  return Math.pow(10, decibels / 20);
}

export function gainToDb(gain: number): number {
  return 20 * Math.log10(Math.max(1e-12, gain));
}

export function voiceGainFor(file: VoiceFile): number {
  const ceiling = dbToGain(VOICE_PEAK_CEILING_DBFS) / (dbToGain(file.peakDbfs) * CENTRE_PAN_GAIN * MASTER_GAIN);
  return Math.min(VOICE_GAIN, ceiling);
}

export function equalPowerPan(pan: number): [left: number, right: number] {
  const position = (Math.max(-1, Math.min(1, pan)) + 1) / 2;
  return [Math.cos((position * Math.PI) / 2), Math.sin((position * Math.PI) / 2)];
}

export function limitSample(roomOutput: number): number {
  const magnitude = Math.min(2, Math.abs(roomOutput));
  const shaped = magnitude <= LIMITER_KNEE ? magnitude : LIMITER_KNEE + (1 - LIMITER_KNEE) * Math.tanh((magnitude - LIMITER_KNEE) / (1 - LIMITER_KNEE));
  return Math.sign(roomOutput) * shaped * MASTER_GAIN;
}

export function duckTimeConstantS(isDucking: boolean): number {
  return (isDucking ? DUCK_ATTACK_S : DUCK_RELEASE_S) / 3;
}
