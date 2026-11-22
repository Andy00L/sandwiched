import type * as THREE from "three";
import type { PaintFn, Point } from "./paperkit-2d";

export interface PaperTextures {
  sheet: HTMLCanvasElement;
  map: THREE.Texture;
  normalMap: THREE.Texture;
}

export interface CardOptions {
  paint?: PaintFn | null;
  paper: PaperTextures;
  thickness?: number;
  edgeWidth?: number;
  pxPerUnit?: number;
  seed?: number;
  back?: "kraft" | "mirror" | PaintFn | false;
  backRes?: number;
  folds?: Array<"bottom" | "top" | "left" | "right">;
  rimLight?: Point;
  effects?: 0 | 1;
  materials?: THREE.Material | THREE.Material[] | null;
  holes?: Point[][] | null;
  geomPts?: Point[] | null;
  contact?: { amount: number; height: number; color?: string };
}

export interface HingeHandle {
  group: THREE.Group;
  pivot: THREE.Group;
  sway: number;
  readonly p: number;
  set(open: number, delay?: number): void;
  reset(open?: number): void;
  update(dt: number): number;
}

export interface LayeredCardLayer {
  pts: Point[];
  paint: PaintFn;
  z?: number;
}

export function makeCard(pts: Point[], options: CardOptions): THREE.Mesh;
export function layeredCard(layers: LayeredCardLayer[], options: CardOptions): THREE.Group;
export function fanCard(pts: Point[], options: CardOptions & { rear?: { scale?: number; shift?: number; dz?: number; tone?: number } }): THREE.Group;
export function hinge(
  child: THREE.Object3D,
  options?: { at?: THREE.Vector3; yaw?: number; open?: number; size?: number; flat?: number; rest?: number; delay?: number },
): HingeHandle;
export interface PrismFoldOptions {
  h?: number;
  roofH?: number;
  paper: PaperTextures;
  seed?: number;
  thickness?: number;
  edgeWidth?: number;
  paints?: { wall?: PaintFn | PaintFn[]; roof?: PaintFn | PaintFn[] };
  rimLight?: Point;
  print?: Partial<CardOptions>;
}

export interface FoldedVolume extends THREE.Group {
  userData: { follow(progress: number): void; footprint: Point[] };
}

export interface LiddedVolume extends THREE.Group {
  userData: { follow(progress: number): void; footprint: Point[]; top: THREE.Group & { parent: THREE.Group } };
}

export function prismFold(footprint: Point[], options: PrismFoldOptions & { roof?: "flat" }): LiddedVolume;
export function prismFold(footprint: Point[], options: PrismFoldOptions & { roof: "pyramid" | "none" }): FoldedVolume;
export function platform(options: {
  w?: number;
  d?: number;
  h?: number;
  paper: PaperTextures;
  paints?: { face?: PaintFn; deck?: PaintFn; support?: PaintFn };
  support?: boolean;
  seed?: number;
  thickness?: number;
  edgeWidth?: number;
  facePts?: Point[] | null;
  deckPts?: Point[] | null;
  supportPts?: Point[] | null;
  rimLight?: Point;
  print?: Partial<CardOptions>;
}): THREE.Group;

export class FlapSpring {
  constructor(options?: { p?: number; size?: number; jitter?: number; quiverJitter?: number });
  readonly atRest: boolean;
  reset(open?: number): FlapSpring;
  set(target: number): void;
  step(dt: number): number;
}

export class Spring {
  constructor(options?: { value?: number; hz?: number; zeta?: number });
  target: number;
  readonly settled: boolean;
  reset(value?: number): Spring;
  set(target: number): void;
  step(dt: number): number;
}
