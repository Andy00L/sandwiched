import type * as THREE from "three";
import type { PaintFn, Point, Rng } from "./lib/paperkit-2d";
import type { CardOptions, HingeHandle, PaperTextures } from "./lib/paperkit-3d";

export type Vector3Tuple = [number, number, number];

export interface Bounds {
  x0: number;
  x1: number;
  z0: number;
  z1: number;
}

export interface LensOptions {
  focusBand?: number;
  ramp?: number;
  maxBlur?: number;
  nearGain?: number;
  farGain?: number;
  depthWeight?: number;
  falloff?: number;
  falloffTint?: number;
  ao?: number;
  aoRadius?: number;
  aoBias?: number;
  aoTint?: string;
  edgeLine?: number;
  edgeLineColor?: string;
  edgeLinePx?: number;
  exposure?: number;
  tint?: Vector3Tuple;
  saturation?: number;
  contrast?: number;
  greenDesat?: number;
  shadowTint?: string;
  shadowLift?: number;
  haze?: string;
  hazeStart?: number;
  hazeEnd?: number;
  hazeAmount?: number;
  vignette?: number;
  vignetteColor?: string;
  grain?: number;
  chroma?: number;
  sharpen?: number;
  taps?: number;
  msaa?: number;
}

export interface LightOptions {
  keyDir?: Vector3Tuple;
  key?: string;
  keyIntensity?: number;
  fill?: string;
  fillIntensity?: number;
  fillDir?: Vector3Tuple;
  sky?: string;
  ground?: string;
  skyIntensity?: number;
  shadowExtent?: number;
  distance?: number;
  mapSize?: number;
  leak?: string;
  softness?: number;
  maxPenumbra?: number;
  blockerSamples?: number;
  filterSamples?: number;
  target?: THREE.Vector3;
}

export interface HarnessOptions {
  bounds?: Bounds;
  ground?: string;
  view?: { pitch?: number; dist?: number; target?: Vector3Tuple; fov?: number; yaw?: number };
  testView?: { dist: number; target: Vector3Tuple };
  heroHeight?: number;
  light?: LightOptions;
  lens?: LensOptions;
  play?: boolean;
  focus?: Vector3Tuple | null;
  mood?: string | null;
  stock?: string;
  subject?: Point | Vector3Tuple | null;
  renderScale?: number;
}

export interface GroundTools {
  g: CanvasRenderingContext2D;
  W: number;
  H: number;
  ppu: number;
  X(x: number): number;
  Z(z: number): number;
  rnd: Rng;
  washes(colors: string[], options?: { scales?: Array<[number, number, number, number]> }): void;
  torn(pts: Point[], fill: string, fringe?: string): void;
  bandOf(pts: Point[], half: number): Point[];
  line(pts: Point[], width: number, color: string): void;
  drifts(mark: (px: number, py: number) => void, options?: { n?: number; inside?: number; outside?: number; threshold?: number }): void;
}

export interface PopupOptions {
  x?: number;
  z?: number;
  yaw?: number | null;
  cross?: boolean | "full" | "half" | "half-front" | "quarter";
  second?: { pts?: Point[]; paint?: PaintFn; ymax?: number; scale?: number } | null;
  angle?: number;
  sway?: number;
  scale?: number;
  node?: THREE.Object3D | null;
  height?: number;
  edge?: number;
  self?: boolean;
  parent?: THREE.Object3D | null;
  order?: number | null;
  solid?: number;
  level?: boolean;
  effects?: 0 | 1 | null;
  holes?: Point[][] | null;
  res?: number;
  materials?: THREE.Material | THREE.Material[] | null;
}

export interface PlacedPiece extends HingeHandle {
  order: number;
  x: number;
  z: number;
}

export interface Harness {
  flags: { TEST: boolean; MOOD: string; WALK: boolean; ROAM: boolean; DIAG: string | null };
  renderer: THREE.WebGLRenderer;
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  paper: PaperTextures;
  target: THREE.Vector3;
  bounds: Bounds;
  heroHeight: number;
  groundAt(screenX: number, screenY: number): THREE.Vector3 | null;
  printGround(draw: (tools: GroundTools) => void, options?: { ppu?: number; seed?: number }): THREE.Mesh;
  popup(pts: Point[] | null, paint: PaintFn | null, options?: PopupOptions): PlacedPiece;
  printed(pts: Point[], paint: PaintFn, options?: { res?: number; cross?: boolean }): THREE.Material | THREE.Material[];
  cardOpts(x: number, z: number, scale?: number, parent?: THREE.Object3D | null, res?: number): CardOptions;
  inFrame(x: number, z: number, margin?: number, y?: number): boolean;
  sharpAt(x: number, z: number, y?: number): boolean;
  onStep(hook: (time: number, dt: number) => void): void;
  onRestart(hook: () => void): void;
  setHero(handle: PlacedPiece, options?: { turn?: "yaw" | "flip" }): void;
  start(): void;
  setQuality(quality: { renderScale?: number; shadowMapSize?: number; dofTaps?: number; msaa?: number }): void;
  focusOn(point: THREE.Vector3 | null): void;
  castShadowOnly(object: THREE.Object3D): void;
  keyLight: THREE.DirectionalLight | null;
  readonly frameCost: { readonly stepMs: number; readonly renderMs: number };
}

export function createHarness(options?: HarnessOptions): Harness;

export interface PapercraftDebug {
  ready: boolean;
  step(seconds: number, fps?: number): number;
  restart(): void;
}

declare global {
  interface Window {
    __papercraft?: PapercraftDebug;
  }
}
