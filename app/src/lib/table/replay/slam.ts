import * as THREE from "three";
import { SLAM_DOWN_MS, SLAM_HOLD_MS, SLAM_LIFT_MS, SLAM_RAISE_MS } from "../motion/motion-tokens";

export interface HandPath {
  rest: THREE.Vector3;
  raised: THREE.Vector3;
  contact: THREE.Vector3;
}

function easeInOut(progress: number): number {
  const clamped = Math.min(1, Math.max(0, progress));
  return clamped * clamped * (3 - 2 * clamped);
}

function easeIn(progress: number): number {
  const clamped = Math.min(1, Math.max(0, progress));
  return clamped * clamped * clamped;
}

const RAISED_HAND_OUT_UNITS = 3.5;
const RAISED_HAND_UP_UNITS = 8.5;
const RAISED_HAND_BACK_UNITS = 3;
export const HAND_COCK_RAD = 0.6;

export function raisedHandPosition(shoulder: THREE.Vector3, side: -1 | 1): THREE.Vector3 {
  return new THREE.Vector3(shoulder.x + side * RAISED_HAND_OUT_UNITS, shoulder.y + RAISED_HAND_UP_UNITS, shoulder.z - RAISED_HAND_BACK_UNITS);
}

export function slamHandPosition(path: HandPath, msFromLanding: number, windupMs: number, out: THREE.Vector3): THREE.Vector3 {
  const sinceRaise = msFromLanding + windupMs;
  if (sinceRaise < 0) return out.copy(path.rest);
  if (sinceRaise < SLAM_RAISE_MS) return out.lerpVectors(path.rest, path.raised, easeInOut(sinceRaise / SLAM_RAISE_MS));
  if (msFromLanding < -SLAM_DOWN_MS) return out.copy(path.raised);
  if (msFromLanding < 0) return out.lerpVectors(path.raised, path.contact, easeIn((msFromLanding + SLAM_DOWN_MS) / SLAM_DOWN_MS));
  if (msFromLanding < SLAM_HOLD_MS) return out.copy(path.contact);
  return out.lerpVectors(path.contact, path.rest, easeInOut((msFromLanding - SLAM_HOLD_MS) / SLAM_LIFT_MS));
}

export function handCockAmount(msFromLanding: number, windupMs: number): number {
  const sinceRaise = msFromLanding + windupMs;
  if (sinceRaise < 0 || msFromLanding >= 0) return 0;
  if (msFromLanding >= -SLAM_DOWN_MS) return 1 - easeIn((msFromLanding + SLAM_DOWN_MS) / SLAM_DOWN_MS);
  return easeInOut(sinceRaise / SLAM_RAISE_MS);
}
