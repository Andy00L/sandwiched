declare module "papercraft/lib/paper-sound.js" {
  export type FlapVoicing = { readonly [lever: string]: number | readonly number[] };

  export type SurfaceVoicing = {
    bedHz: number;
    bedQ: number;
    bedGain: number;
    resHz: number[];
    resQ: number[];
    grain: number;
    scuffs: number;
    lpHz: number;
    knock: number;
    gain: number;
  };

  export type FlapParams = { st: number; pitch: number; dur: number; level: number; synthSeed: number };

  export const FLAP: FlapVoicing;
  export const SURFACES: Record<string, SurfaceVoicing>;

  export function hashSeed(...parts: ReadonlyArray<string | number>): number;
  export function noiseGen(seed: number): () => number;
  export function grain(buffer: Float32Array<ArrayBuffer>, sampleRate: number, noise: () => number, atS: number, amplitude: number, decayS: number): void;
  export function finish(out: Float32Array<ArrayBuffer>, sampleRate: number, options: { attack: number; tailFrom: number; peakWithin?: number }): Float32Array<ArrayBuffer>;
  export function flapParams(options: { size?: number; up?: boolean; seed?: number; lastSt?: number | null }, voicing?: FlapVoicing): FlapParams;
  export function synthFlap(
    options: { size?: number; up?: boolean; pitch?: number; dur?: number; seed?: number; air?: number; sr?: number },
    voicing?: FlapVoicing,
  ): Float32Array<ArrayBuffer>;
  export function synthStep(options?: { surface?: string; foot?: number; seed?: number; sr?: number }): { buf: Float32Array<ArrayBuffer>; level: number };

  export class Biquad {
    constructor(type: "lp" | "hp" | "bp", frequencyHz: number, quality: number, sampleRate: number);
    run(sample: number): number;
  }

  export class PaperSound {
    constructor(options?: { spacing?: number; spacingJitter?: number; maxVoices?: number; falloff?: number; volume?: number; groupWindow?: number });
    ctx: AudioContext | null;
    chain: { bus: GainNode; master: GainNode } | undefined;
    unlock(): AudioContext;
    setMuted(isMuted: boolean): void;
  }
}
