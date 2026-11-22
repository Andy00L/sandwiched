import type * as THREE from "three";

const FLIP_RATE_PER_S = 11;
const FLIP_CUT = 0.12;

export type FlipTarget = -1 | 1;

export function stepFlip(current: number, target: FlipTarget, dtSeconds: number): number {
  const moved = current + Math.sign(target - current) * FLIP_RATE_PER_S * dtSeconds;
  const clamped = target > 0 ? Math.min(target, moved) : Math.max(target, moved);
  return Math.abs(clamped) < FLIP_CUT ? target * FLIP_CUT : clamped;
}

export function applyFlip(node: THREE.Object3D, flip: number): void {
  node.scale.x = flip;
}
