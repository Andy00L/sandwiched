import type * as THREE from "three";

export const FLIP_RATE_PER_S = 11;
const FLIP_CUT = 0.12;
const POP_PEAK_SHAPE = { cubic: 2.4, square: 1.4 } as const;

export type FlipTarget = -1 | 1;

export function stepFlip(current: number, target: FlipTarget, dtSeconds: number): number {
  const moved = current + Math.sign(target - current) * FLIP_RATE_PER_S * dtSeconds;
  const clamped = target > 0 ? Math.min(target, moved) : Math.max(target, moved);
  return Math.abs(clamped) < FLIP_CUT ? target * FLIP_CUT : clamped;
}

export function applyFlip(node: THREE.Object3D, flip: number): void {
  node.scale.x = flip;
}

export function popScale(progress: number): number {
  const shifted = Math.min(1, Math.max(0, progress)) - 1;
  return 1 + POP_PEAK_SHAPE.cubic * shifted ** 3 + POP_PEAK_SHAPE.square * shifted ** 2;
}

export function shrinkAwayScale(progress: number): number {
  const clamped = Math.min(1, Math.max(0, progress));
  return 1 - clamped * clamped;
}

export function applyUniformScale(node: THREE.Object3D, scale: number): void {
  node.scale.setScalar(scale);
}
