import { hashSeed } from "papercraft/lib/paper-sound.js";
import * as P2 from "papercraft/lib/paperkit-2d.js";

export const PIANO_SAMPLE_RATE = 24000;
export const HALL_WET = 0.4;
const HALL_LENGTH_S = 4;

const NOTE_ATTACK_S = 0.006;
const NOTE_RELEASE_S = 0.5;
const HAMMER_LENGTH_S = 0.04;
const HAMMER_DECAY_S = 0.008;
const STRUCK_AT = 8.3;
const PARTIAL_CEILING_HZ = 2800;
const MAX_PARTIALS = 12;
const HALL_PREDELAY_S = 0.022;
const HALL_DECAY_PER_S = 1.7;
const WEB_AUDIO_GAIN_CALIBRATION = 0.00125;
const WEB_AUDIO_CALIBRATION_RATE = 44100;
const WEB_AUDIO_MIN_POWER = 0.000125;

type NotePlayback = { lowpassHz: number; gain: number; pan: number };

function midiToHz(midi: number): number {
  return 440 * Math.pow(2, (midi - 69) / 12);
}

export function synthFeltPianoNote(midi: number, sampleRate = PIANO_SAMPLE_RATE): Float32Array<ArrayBuffer> {
  const random = P2.rng(hashSeed("piano", midi));
  const frequency = midiToHz(midi);
  const lengthS = Math.max(3.2, Math.min(7.5, 7.5 - (midi - 36) * 0.075));
  const sampleCount = Math.ceil(lengthS * sampleRate);
  const out = new Float32Array(sampleCount);
  const stiffness = 0.00008 * Math.pow(2, (midi - 40) / 12);
  const baseDecay = 0.55 + Math.max(0, midi - 40) * 0.022;
  const partialCount = Math.max(2, Math.min(MAX_PARTIALS, Math.floor(PARTIAL_CEILING_HZ / frequency)));
  for (let partial = 1; partial <= partialCount; partial++) {
    const amplitude = (Math.pow(partial, -2.4) * Math.abs(Math.sin((Math.PI * partial) / STRUCK_AT))) / Math.sin(Math.PI / STRUCK_AT);
    const decay = baseDecay * (1 + 0.42 * (partial - 1));
    const fastRatio = Math.exp((-decay * 3.2) / sampleRate);
    const slowRatio = Math.exp((-decay * 0.7) / sampleRate);
    for (const side of [-1, 1]) {
      const detune = Math.pow(2, (side * (0.5 + 0.12 * partial)) / 1200);
      const omega = (2 * Math.PI * frequency * partial * Math.sqrt(1 + stiffness * partial * partial) * detune) / sampleRate;
      const coefficient = 2 * Math.cos(omega);
      const phase = random() * 2 * Math.PI;
      let previous = Math.sin(phase - omega);
      let beforePrevious = Math.sin(phase - 2 * omega);
      let fastEnvelope = 0.6 * amplitude;
      let slowEnvelope = 0.4 * amplitude;
      for (let index = 0; index < sampleCount; index++) {
        const value = coefficient * previous - beforePrevious;
        beforePrevious = previous;
        previous = value;
        out[index] = (out[index] ?? 0) + value * (fastEnvelope + slowEnvelope);
        fastEnvelope *= fastRatio;
        slowEnvelope *= slowRatio;
      }
    }
  }
  let lowpassed = 0;
  let hammer = 0.025 * Math.min(1, 200 / frequency + 0.3);
  const hammerRatio = Math.exp(-1 / (HAMMER_DECAY_S * sampleRate));
  for (let index = 0; index < HAMMER_LENGTH_S * sampleRate; index++) {
    lowpassed += 0.12 * (random() * 2 - 1 - lowpassed);
    out[index] = (out[index] ?? 0) + lowpassed * hammer;
    hammer *= hammerRatio;
  }
  let peak = 1e-9;
  for (let index = 0; index < sampleCount; index++) {
    const edge = Math.min(1, index / (NOTE_ATTACK_S * sampleRate), (sampleCount - 1 - index) / (NOTE_RELEASE_S * sampleRate));
    out[index] = (out[index] ?? 0) * edge;
    peak = Math.max(peak, Math.abs(out[index] ?? 0));
  }
  for (let index = 0; index < sampleCount; index++) out[index] = (out[index] ?? 0) / peak;
  return out;
}

export function notePlayback(midi: number, velocity: number): NotePlayback {
  const frequency = midiToHz(midi);
  return {
    lowpassHz: Math.max(350, Math.min(1900, frequency * (1.3 + 5 * velocity))),
    gain: velocity,
    pan: Math.max(-0.45, Math.min(0.45, (midi - 60) / 55)),
  };
}

export function buildHallImpulse(sampleRate: number, seed = hashSeed("hall")): [Float32Array<ArrayBuffer>, Float32Array<ArrayBuffer>] {
  const random = P2.rng(seed);
  const sampleCount = Math.ceil(HALL_LENGTH_S * sampleRate);
  const predelay = Math.round(HALL_PREDELAY_S * sampleRate);
  const channels: [Float32Array<ArrayBuffer>, Float32Array<ArrayBuffer>] = [new Float32Array(sampleCount), new Float32Array(sampleCount)];
  let sumOfSquares = 0;
  for (const channel of channels) {
    let smoothed = 0;
    for (let index = predelay; index < sampleCount; index++) {
      const elapsedS = (index - predelay) / sampleRate;
      const coefficient = 0.03 + 0.12 * Math.exp(-2.2 * elapsedS);
      smoothed += coefficient * (random() * 2 - 1 - smoothed);
      const value = smoothed * Math.exp(-HALL_DECAY_PER_S * elapsedS);
      channel[index] = value;
      sumOfSquares += value * value;
    }
  }
  const rootMeanSquare = Math.max(WEB_AUDIO_MIN_POWER, Math.sqrt(sumOfSquares / (channels.length * sampleCount)));
  const scale = (WEB_AUDIO_GAIN_CALIBRATION * WEB_AUDIO_CALIBRATION_RATE) / (rootMeanSquare * sampleRate);
  for (const channel of channels) for (let index = 0; index < sampleCount; index++) channel[index] = (channel[index] ?? 0) * scale;
  return channels;
}
