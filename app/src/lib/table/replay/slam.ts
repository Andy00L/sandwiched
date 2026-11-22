import * as THREE from "three";
import { SLAM_DOWN_MS, SLAM_HOLD_MS, SLAM_LIFT_MS, SLAM_RAISE_MS } from "../motion/motion-tokens";

interface HandPath {
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

export function raisedHandPosition(shoulder: THREE.Vector3, side: -1 | 1): THREE.Vector3 {
  return new THREE.Vector3(shoulder.x + side * 1.2, shoulder.y + 6.4, shoulder.z + 2.6);
}

export function slamHandPosition(path: HandPath, msFromLanding: number, windupMs: number): THREE.Vector3 {
  const sinceRaise = msFromLanding + windupMs;
  if (sinceRaise < 0) return path.rest.clone();
  if (sinceRaise < SLAM_RAISE_MS) return path.rest.clone().lerp(path.raised, easeInOut(sinceRaise / SLAM_RAISE_MS));
  if (msFromLanding < -SLAM_DOWN_MS) return path.raised.clone();
  if (msFromLanding < 0) return path.raised.clone().lerp(path.contact, easeIn((msFromLanding + SLAM_DOWN_MS) / SLAM_DOWN_MS));
  if (msFromLanding < SLAM_HOLD_MS) return path.contact.clone();
  return path.contact.clone().lerp(path.rest, easeInOut((msFromLanding - SLAM_HOLD_MS) / SLAM_LIFT_MS));
}
