import type * as THREE from "three";
import type { Point } from "./paperkit-2d";

type Range = number | [number, number];
type CutName = "leaf" | "petal" | "flake" | "disc" | "puff" | "streak" | "confetti" | "wing" | "birdWing" | "curl";

interface LifeKindOptions {
  day?: number;
  night?: number;
}

export interface FallerOptions extends LifeKindOptions {
  count?: number;
  colors?: string[];
  cut?: CutName | Point[];
  size?: Range;
  fall?: Range;
  sway?: number;
  tumble?: number;
  land?: number;
  wind?: number;
  streak?: boolean;
  ground?: number;
}

export interface CloudShadowOptions extends LifeKindOptions {
  count?: number;
  size?: Range;
  alpha?: number;
  speed?: number;
  color?: string;
}

export interface CritterOptions {
  behaviour?: "graze" | "peck" | "shy" | "float" | "perch" | "pet";
  home?: Point | null;
  roam?: number;
  speed?: number;
  run?: number;
  hero?: THREE.Vector3 | null;
  card?: THREE.Object3D;
  notice?: number;
  scatter?: number;
  hop?: number;
  rock?: number;
  step?: number;
}

export interface Life {
  group: THREE.Group;
  fallers(options?: FallerOptions): void;
  cloudShadows(options?: CloudShadowOptions): void;
  critter(node: THREE.Object3D, options?: CritterOptions): void;
  update(dtSeconds: number, at?: THREE.Vector3 | null): void;
  reset(at?: THREE.Vector3 | null): void;
}

export function createLife(options: {
  scene: THREE.Scene;
  camera: THREE.Camera;
  heroHeight?: number;
  seed?: number;
  wind?: [number, number];
  box?: { w: number; d: number; h: number };
}): Life;
