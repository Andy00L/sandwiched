import { Biquad } from "papercraft/lib/paper-sound.js";
import * as P2 from "papercraft/lib/paperkit-2d.js";
import { HALL_WET, PIANO_SAMPLE_RATE, buildHallImpulse, notePlayback, synthFeltPianoNote } from "./felt-piano";
import { DUCK_ATTACK_S, DUCK_GAIN, DUCK_HOLD_S, MUSIC_GAIN, PAN_SCALE, VOICE_CUT_FADE_S, duckTimeConstantS, equalPowerPan, limitSample, voiceGainFor } from "./mix";
import { renderPaperRecipe } from "./paper-synth";
import type { LevelSource, PlannedSound } from "./sound-plan";
import { createRewardNotes, listWaltzNotes } from "./waltz";
import type { WaltzNote, WaltzPart } from "./waltz";

export const OFFLINE_SAMPLE_RATE = 48000;

const ROOM_LENGTH_S = 0.05;
const ROOM_SEED = 7;
const ROOM_TAIL_FROM_S = 0.003;
const ROOM_TAIL_LOWPASS_HZ = 3200;
const ROOM_TAIL_GAIN = 0.03;
const ROOM_TAIL_DECAY_S = 0.009;
const ROOM_TAIL_RISE_S = 0.002;
const ROOM_FADE_S = 0.004;
const ROOM_TAPS: readonly (readonly [atS: number, gain: number, pan: number])[] = [
  [0.0013, 0.26, 0],
  [0.0049, 0.13, -0.6],
  [0.0071, 0.12, 0.6],
  [0.0117, 0.08, -0.8],
  [0.0143, 0.075, 0.8],
  [0.0196, 0.05, -0.4],
  [0.0233, 0.045, 0.5],
];
const PIANO_LOWPASS_Q = Math.pow(10, 0.5 / 20);
const NOTE_TAIL_BEFORE_S = 8;
const MIN_FFT_SIZE = 65536;
const MUSIC_LABELS: readonly MixLabel[] = ["bass", "inner", "melody", "reward"];
const PAPER_LABELS: readonly MixLabel[] = ["slam", "voice", "risingFlap", "closingFlap", "tick", "landing"];

export type MixLabel = LevelSource | WaltzPart;

export type StereoBuffer = { left: Float32Array<ArrayBuffer>; right: Float32Array<ArrayBuffer>; sampleRate: number };

export type OfflinePlan = {
  sounds: readonly PlannedSound[];
  durationS: number;
  musicStartS: number | null;
  finalStretch: { fromS: number; untilS: number } | null;
};

export type OfflineVoices = ReadonlyMap<string, Float32Array<ArrayBuffer>>;

type VoiceSound = Extract<PlannedSound, { kind: "voice" }>;

function buildKitRoomImpulse(sampleRate: number): [Float32Array<ArrayBuffer>, Float32Array<ArrayBuffer>] {
  const sampleCount = Math.ceil(ROOM_LENGTH_S * sampleRate);
  const random = P2.rng(ROOM_SEED);
  const channels: [Float32Array<ArrayBuffer>, Float32Array<ArrayBuffer>] = [new Float32Array(sampleCount), new Float32Array(sampleCount)];
  for (const [channelIndex, channel] of channels.entries()) {
    channel[0] = 1;
    let smoothed = 0;
    const smoothing = 1 - Math.exp((-2 * Math.PI * ROOM_TAIL_LOWPASS_HZ) / sampleRate);
    for (let index = Math.round(ROOM_TAIL_FROM_S * sampleRate); index < sampleCount; index++) {
      smoothed += smoothing * (random() * 2 - 1 - smoothed);
      const elapsedS = index / sampleRate - ROOM_TAIL_FROM_S;
      channel[index] = (channel[index] ?? 0) + smoothed * ROOM_TAIL_GAIN * Math.exp(-elapsedS / ROOM_TAIL_DECAY_S) * Math.min(1, elapsedS / ROOM_TAIL_RISE_S);
    }
    for (const [atS, gain, pan] of ROOM_TAPS) {
      const index = Math.round(atS * sampleRate);
      const tapGain = gain * Math.min(1, channelIndex === 1 ? 1 + pan : 1 - pan);
      channel[index - 1] = (channel[index - 1] ?? 0) + tapGain * 0.25;
      channel[index] = (channel[index] ?? 0) + tapGain * 0.5;
      channel[index + 1] = (channel[index + 1] ?? 0) + tapGain * 0.25;
    }
    const fadeCount = Math.round(ROOM_FADE_S * sampleRate);
    for (let index = sampleCount - fadeCount; index < sampleCount; index++) channel[index] = (channel[index] ?? 0) * ((sampleCount - index) / fadeCount);
  }
  return channels;
}

function transformInPlace(real: Float64Array<ArrayBuffer>, imaginary: Float64Array<ArrayBuffer>, isInverse: boolean): void {
  const size = real.length;
  for (let index = 1, reversed = 0; index < size; index++) {
    let bit = size >> 1;
    for (; reversed & bit; bit >>= 1) reversed ^= bit;
    reversed ^= bit;
    if (index < reversed) {
      const heldReal = real[index] ?? 0;
      real[index] = real[reversed] ?? 0;
      real[reversed] = heldReal;
      const heldImaginary = imaginary[index] ?? 0;
      imaginary[index] = imaginary[reversed] ?? 0;
      imaginary[reversed] = heldImaginary;
    }
  }
  for (let span = 2; span <= size; span <<= 1) {
    const angle = ((2 * Math.PI) / span) * (isInverse ? 1 : -1);
    const stepReal = Math.cos(angle);
    const stepImaginary = Math.sin(angle);
    const half = span >> 1;
    for (let start = 0; start < size; start += span) {
      let twiddleReal = 1;
      let twiddleImaginary = 0;
      for (let offset = 0; offset < half; offset++) {
        const evenIndex = start + offset;
        const oddIndex = evenIndex + half;
        const oddReal = (real[oddIndex] ?? 0) * twiddleReal - (imaginary[oddIndex] ?? 0) * twiddleImaginary;
        const oddImaginary = (real[oddIndex] ?? 0) * twiddleImaginary + (imaginary[oddIndex] ?? 0) * twiddleReal;
        real[oddIndex] = (real[evenIndex] ?? 0) - oddReal;
        imaginary[oddIndex] = (imaginary[evenIndex] ?? 0) - oddImaginary;
        real[evenIndex] = (real[evenIndex] ?? 0) + oddReal;
        imaginary[evenIndex] = (imaginary[evenIndex] ?? 0) + oddImaginary;
        const nextReal = twiddleReal * stepReal - twiddleImaginary * stepImaginary;
        twiddleImaginary = twiddleReal * stepImaginary + twiddleImaginary * stepReal;
        twiddleReal = nextReal;
      }
    }
  }
  if (!isInverse) return;
  for (let index = 0; index < size; index++) {
    real[index] = (real[index] ?? 0) / size;
    imaginary[index] = (imaginary[index] ?? 0) / size;
  }
}

function convolve(signal: Float32Array<ArrayBuffer>, impulse: Float32Array<ArrayBuffer>): Float32Array<ArrayBuffer> {
  const out = new Float32Array(signal.length + impulse.length - 1);
  let size = MIN_FFT_SIZE;
  while (size < impulse.length * 4) size <<= 1;
  const blockLength = size - impulse.length + 1;
  const impulseReal = new Float64Array(size);
  const impulseImaginary = new Float64Array(size);
  impulseReal.set(impulse);
  transformInPlace(impulseReal, impulseImaginary, false);
  const real = new Float64Array(size);
  const imaginary = new Float64Array(size);
  for (let blockStart = 0; blockStart < signal.length; blockStart += blockLength) {
    real.fill(0);
    imaginary.fill(0);
    real.set(signal.subarray(blockStart, Math.min(signal.length, blockStart + blockLength)));
    transformInPlace(real, imaginary, false);
    for (let index = 0; index < size; index++) {
      const productReal = (real[index] ?? 0) * (impulseReal[index] ?? 0) - (imaginary[index] ?? 0) * (impulseImaginary[index] ?? 0);
      imaginary[index] = (real[index] ?? 0) * (impulseImaginary[index] ?? 0) + (imaginary[index] ?? 0) * (impulseReal[index] ?? 0);
      real[index] = productReal;
    }
    transformInPlace(real, imaginary, true);
    const end = Math.min(out.length, blockStart + size);
    for (let index = blockStart; index < end; index++) out[index] = (out[index] ?? 0) + (real[index - blockStart] ?? 0);
  }
  return out;
}

function createStereo(sampleCount: number, sampleRate: number): StereoBuffer {
  return { left: new Float32Array(sampleCount), right: new Float32Array(sampleCount), sampleRate };
}

function addMono(target: StereoBuffer, samples: Float32Array<ArrayBuffer>, startS: number, gain: number, pan: number, rate = 1, stopAtS = Number.POSITIVE_INFINITY): void {
  const [leftGain, rightGain] = equalPowerPan(pan);
  const startIndex = Math.round(startS * target.sampleRate);
  const fadeRatio = Math.exp(-1 / ((VOICE_CUT_FADE_S / 3) * target.sampleRate));
  const stopIndex = stopAtS * target.sampleRate;
  let fade = 1;
  for (let outIndex = Math.max(0, startIndex); outIndex < target.left.length; outIndex++) {
    const position = (outIndex - startIndex) * rate;
    const below = Math.floor(position);
    if (below + 1 >= samples.length) break;
    if (outIndex >= stopIndex) {
      fade *= fadeRatio;
      if (fade < 1e-4) break;
    }
    const fraction = position - below;
    const value = ((samples[below] ?? 0) * (1 - fraction) + (samples[below + 1] ?? 0) * fraction) * gain * fade;
    target.left[outIndex] = (target.left[outIndex] ?? 0) + value * leftGain;
    target.right[outIndex] = (target.right[outIndex] ?? 0) + value * rightGain;
  }
}

function duckEnvelope(duckStarts: readonly number[], sampleCount: number, sampleRate: number): Float32Array<ArrayBuffer> {
  const envelope = new Float32Array(sampleCount);
  const starts = [...duckStarts].sort((first, second) => first - second);
  let gain = 1;
  let nextDuck = 0;
  let duckUntilS = Number.NEGATIVE_INFINITY;
  for (let index = 0; index < sampleCount; index++) {
    const atS = index / sampleRate;
    while (nextDuck < starts.length && (starts[nextDuck] ?? Number.POSITIVE_INFINITY) <= atS) {
      duckUntilS = (starts[nextDuck] ?? 0) + DUCK_ATTACK_S + DUCK_HOLD_S;
      nextDuck++;
    }
    const isDucking = atS < duckUntilS;
    const target = isDucking ? DUCK_GAIN : 1;
    gain += (target - gain) * (1 - Math.exp(-1 / (duckTimeConstantS(isDucking) * sampleRate)));
    envelope[index] = gain;
  }
  return envelope;
}

function findCutTimes(sounds: readonly PlannedSound[]): ReadonlyMap<number, number> {
  const cutAt = new Map<number, number>();
  for (const sound of sounds) {
    if (sound.kind !== "voice") continue;
    for (const playId of sound.play.cuts) cutAt.set(playId, Math.min(cutAt.get(playId) ?? Number.POSITIVE_INFINITY, sound.atS));
  }
  return cutAt;
}

function renderPaperAndVoices(plan: OfflinePlan, voices: OfflineVoices, include: (label: MixLabel) => boolean, sampleCount: number): StereoBuffer {
  const ducked = createStereo(sampleCount, OFFLINE_SAMPLE_RATE);
  const unducked = createStereo(sampleCount, OFFLINE_SAMPLE_RATE);
  const cutAt = findCutTimes(plan.sounds);
  const duckStarts: number[] = [];
  for (const sound of plan.sounds) {
    if (sound.kind === "duck") duckStarts.push(sound.atS);
    if (sound.kind === "paper" && include(sound.source)) {
      const rendered = renderPaperRecipe(sound.recipe, OFFLINE_SAMPLE_RATE);
      addMono(sound.isSlam ? unducked : ducked, rendered.samples, sound.atS, rendered.level * sound.gain, sound.pan * PAN_SCALE);
    }
    if (sound.kind === "voice" && include("voice")) addVoice(sound, voices, cutAt, sound.play.isUnducked ? unducked : ducked);
  }
  const envelope = duckEnvelope(duckStarts, sampleCount, OFFLINE_SAMPLE_RATE);
  const [roomLeft, roomRight] = buildKitRoomImpulse(OFFLINE_SAMPLE_RATE);
  const out = createStereo(sampleCount, OFFLINE_SAMPLE_RATE);
  for (const [channel, impulse] of [["left", roomLeft], ["right", roomRight]] as const) {
    const summed = new Float32Array(sampleCount);
    for (let index = 0; index < sampleCount; index++) summed[index] = (ducked[channel][index] ?? 0) * (envelope[index] ?? 1) + (unducked[channel][index] ?? 0);
    const roomed = convolve(summed, impulse);
    for (let index = 0; index < sampleCount; index++) out[channel][index] = limitSample(roomed[index] ?? 0);
  }
  return out;
}

function addVoice(sound: VoiceSound, voices: OfflineVoices, cutAt: ReadonlyMap<number, number>, target: StereoBuffer): void {
  const samples = voices.get(sound.play.file.id);
  if (samples === undefined) return;
  addMono(target, samples, sound.atS, voiceGainFor(sound.play.file), sound.pan * PAN_SCALE, sound.play.rate, cutAt.get(sound.play.playId));
}

function listMusicNotes(plan: OfflinePlan): WaltzNote[] {
  const { musicStartS, finalStretch } = plan;
  if (musicStartS === null) return [];
  const isFinalStretchAt = (musicS: number) => finalStretch !== null && musicStartS + musicS >= finalStretch.fromS && musicStartS + musicS < finalStretch.untilS;
  const fromS = Math.max(0, -NOTE_TAIL_BEFORE_S - musicStartS);
  const score = listWaltzNotes(fromS, plan.durationS - musicStartS, isFinalStretchAt).map((note) => ({ ...note, atS: note.atS + musicStartS }));
  const rewards = createRewardNotes();
  const rewardNotes = plan.sounds.flatMap((sound) => (sound.kind === "reward" ? rewards.pick(sound.register, sound.noteCount, sound.atS, sound.atS - musicStartS, () => true) : []));
  return [...score, ...rewardNotes];
}

function renderMusic(plan: OfflinePlan, include: (label: MixLabel) => boolean, sampleCount: number): StereoBuffer {
  const pianoCount = Math.ceil((sampleCount / OFFLINE_SAMPLE_RATE) * PIANO_SAMPLE_RATE);
  const dry = createStereo(pianoCount, PIANO_SAMPLE_RATE);
  const noteCache = new Map<number, Float32Array<ArrayBuffer>>();
  for (const note of listMusicNotes(plan)) {
    if (!include(note.part)) continue;
    const raw = noteCache.get(note.midi) ?? synthFeltPianoNote(note.midi, PIANO_SAMPLE_RATE);
    noteCache.set(note.midi, raw);
    const playback = notePlayback(note.midi, note.velocity);
    const lowpass = new Biquad("lp", playback.lowpassHz, PIANO_LOWPASS_Q, PIANO_SAMPLE_RATE);
    const filtered = raw.map((sample) => lowpass.run(sample));
    const startS = Math.max(0, note.atS);
    const skipped = Math.round((startS - note.atS) * PIANO_SAMPLE_RATE);
    addMono(dry, filtered.subarray(skipped), startS, playback.gain, playback.pan);
  }
  const duckStarts = plan.sounds.flatMap((sound) => (sound.kind === "duck" ? [sound.atS] : []));
  const envelope = duckEnvelope(duckStarts, pianoCount, PIANO_SAMPLE_RATE);
  const [hallLeft, hallRight] = buildHallImpulse(PIANO_SAMPLE_RATE);
  const out = createStereo(sampleCount, OFFLINE_SAMPLE_RATE);
  for (const [channel, impulse] of [["left", hallLeft], ["right", hallRight]] as const) {
    const ducked = dry[channel].map((sample, index) => sample * (envelope[index] ?? 1));
    const wet = convolve(ducked, impulse);
    const rateRatio = PIANO_SAMPLE_RATE / OFFLINE_SAMPLE_RATE;
    for (let index = 0; index < sampleCount; index++) {
      const position = index * rateRatio;
      const below = Math.floor(position);
      const fraction = position - below;
      const mixedAt = (at: number) => (ducked[at] ?? 0) + HALL_WET * (wet[at] ?? 0);
      out[channel][index] = (mixedAt(below) * (1 - fraction) + mixedAt(below + 1) * fraction) * MUSIC_GAIN;
    }
  }
  return out;
}

export function renderPlanOffline(plan: OfflinePlan, voices: OfflineVoices, include: (label: MixLabel) => boolean = () => true): StereoBuffer {
  const sampleCount = Math.ceil(plan.durationS * OFFLINE_SAMPLE_RATE);
  const silence = createStereo(sampleCount, OFFLINE_SAMPLE_RATE);
  const paper = PAPER_LABELS.some(include) ? renderPaperAndVoices(plan, voices, include, sampleCount) : silence;
  const music = MUSIC_LABELS.some(include) ? renderMusic(plan, include, sampleCount) : silence;
  const out = createStereo(sampleCount, OFFLINE_SAMPLE_RATE);
  for (let index = 0; index < sampleCount; index++) {
    out.left[index] = (paper.left[index] ?? 0) + (music.left[index] ?? 0);
    out.right[index] = (paper.right[index] ?? 0) + (music.right[index] ?? 0);
  }
  return out;
}
