import * as THREE from "three";
import { FOCUS_PULL_MS, FOCUS_RETURN_MS, HIT_STOP_BASE_MS, HIT_STOP_MAX_MS, HIT_STOP_PER_HIT_MS, RIPPLE_S_PER_UNIT, SLAM_DOWN_MS, SLAM_HOLD_MS, SLAM_LIFT_MS, SLAM_RAISE_MS } from "./motion-tokens";
import { PIGEON_HEIGHT_UNITS } from "../stage/look";

export const HIT_STOP_CATCH_UP_MS = 150;
const DEGREES = THREE.MathUtils.degToRad;
const TORSO_BACK_RAD = DEGREES(4);
const TORSO_FORWARD_RAD = DEGREES(3);
const TORSO_LEAN_IN_MS = 120;
const TORSO_RING_MS = 400;
const TORSO_RING_HZ = 2.5;
const DECK_DIP_RAD = DEGREES(1.2);
const DECK_RING_HZ = 4.5;
const DECK_RING_CYCLES = 2;
const BOX_HOP_RAD = DEGREES(4);
const BOX_HOP_HZ = 6;
const BOX_HOP_CYCLES = 1.5;
const RIPPLE_REACH_UNITS = 6 * PIGEON_HEIGHT_UNITS;
const CAMERA_DROP_UNITS = 0.15 * PIGEON_HEIGHT_UNITS;
const CAMERA_RETURN_TAU_MS = 40;
const SHAKE_START_MS = 400;
const SHAKE_END_MS = 900;
const SHAKE_RAD = DEGREES(10);
const SHAKE_CYCLES = 3;
const LID_POP_MS = 180;
const LID_POP_AMOUNT = 0.1;
const FLIPPER_BACK_AT_REST_MS = SLAM_HOLD_MS + SLAM_LIFT_MS;
const SHADOW_APPEAR_HEIGHT_UNITS = 6;
const SHADOW_HOLD_HEIGHT_UNITS = 3.2;
const SHADOW_DARK_HEIGHT_UNITS = 1.6;
const SHADOW_CONTACT_HEIGHT_UNITS = 0.35;

export interface Landing {
  tick: number;
  hitCount: number;
}

function smoothstep(progress: number): number {
  const clamped = Math.min(1, Math.max(0, progress));
  return clamped * clamped * (3 - 2 * clamped);
}

export function hitStopMs(hitCount: number): number {
  return Math.min(HIT_STOP_MAX_MS, HIT_STOP_BASE_MS + HIT_STOP_PER_HIT_MS * hitCount);
}

export function presentationTick(nowTick: number, landing: Landing | null, tickMs: number): number {
  if (!landing || nowTick < landing.tick) return nowTick;
  const holdTicks = hitStopMs(landing.hitCount) / tickMs;
  const catchUpTicks = HIT_STOP_CATCH_UP_MS / tickMs;
  const sinceLanding = nowTick - landing.tick;
  if (sinceLanding < holdTicks) return landing.tick;
  if (sinceLanding < holdTicks + catchUpTicks) return landing.tick + (sinceLanding - holdTicks) * ((holdTicks + catchUpTicks) / catchUpTicks);
  return nowTick;
}

export function dampedRing(elapsedMs: number, amplitude: number, frequencyHz: number, cycles: number): number {
  if (elapsedMs < 0) return 0;
  const seconds = elapsedMs / 1000;
  const duration = cycles / frequencyHz;
  if (seconds >= duration) return 0;
  return amplitude * (1 - seconds / duration) * Math.sin(Math.PI * 2 * frequencyHz * seconds);
}

export function torsoLeanRad(msFromLanding: number, windupMs: number): number {
  if (msFromLanding < -windupMs) return 0;
  if (msFromLanding < 0) return -TORSO_BACK_RAD * smoothstep((msFromLanding + windupMs) / TORSO_LEAN_IN_MS);
  if (msFromLanding >= TORSO_RING_MS) return 0;
  const seconds = msFromLanding / 1000;
  return TORSO_FORWARD_RAD * (1 - msFromLanding / TORSO_RING_MS) * Math.cos(Math.PI * 2 * TORSO_RING_HZ * seconds);
}

export function deckDipRad(msFromImpact: number): number {
  return -dampedRing(msFromImpact, DECK_DIP_RAD, DECK_RING_HZ, DECK_RING_CYCLES);
}

export function boxHopRad(msFromImpact: number, distanceUnits: number): number {
  if (distanceUnits <= 0 || distanceUnits > RIPPLE_REACH_UNITS) return 0;
  const delayMs = distanceUnits * RIPPLE_S_PER_UNIT * 1000;
  return dampedRing(msFromImpact - delayMs, BOX_HOP_RAD * Math.min(1, PIGEON_HEIGHT_UNITS / distanceUnits), BOX_HOP_HZ, BOX_HOP_CYCLES);
}

export function cameraDropUnits(msFromImpact: number): number {
  if (msFromImpact < 0) return 0;
  const scaled = msFromImpact / CAMERA_RETURN_TAU_MS;
  return CAMERA_DROP_UNITS * (1 + scaled) * Math.exp(-scaled);
}

export function flipperShakeRad(msFromLanding: number): number {
  if (msFromLanding < SHAKE_START_MS || msFromLanding >= SHAKE_END_MS) return 0;
  const progress = (msFromLanding - SHAKE_START_MS) / (SHAKE_END_MS - SHAKE_START_MS);
  return SHAKE_RAD * Math.sin(progress * Math.PI * 2 * SHAKE_CYCLES);
}

export function lidPopAmount(msFromImpact: number): number {
  if (msFromImpact < 0 || msFromImpact >= LID_POP_MS) return 0;
  return LID_POP_AMOUNT * Math.sin((msFromImpact / LID_POP_MS) * Math.PI);
}

export function focusPullAmount(msFromLanding: number, windupMs: number, holdAfterLandingMs: number): number {
  const sinceRaise = msFromLanding + windupMs;
  const releaseMs = Math.max(FLIPPER_BACK_AT_REST_MS, holdAfterLandingMs);
  if (sinceRaise < SLAM_RAISE_MS) return 0;
  if (msFromLanding < releaseMs) return smoothstep((sinceRaise - SLAM_RAISE_MS) / FOCUS_PULL_MS);
  return 1 - smoothstep((msFromLanding - releaseMs) / FOCUS_RETURN_MS);
}

export function isFlipperShadowShown(msFromLanding: number, windupMs: number): boolean {
  return msFromLanding >= -windupMs && msFromLanding < FLIPPER_BACK_AT_REST_MS;
}

function lerp(from: number, to: number, progress: number): number {
  return from + (to - from) * Math.min(1, Math.max(0, progress));
}

export function flipperShadowHeightUnits(msFromLanding: number, windupMs: number): number {
  const sinceRaise = msFromLanding + windupMs;
  if (sinceRaise < SLAM_RAISE_MS) return lerp(SHADOW_APPEAR_HEIGHT_UNITS, SHADOW_HOLD_HEIGHT_UNITS, smoothstep(sinceRaise / SLAM_RAISE_MS));
  if (msFromLanding < -SLAM_DOWN_MS) return lerp(SHADOW_HOLD_HEIGHT_UNITS, SHADOW_DARK_HEIGHT_UNITS, (sinceRaise - SLAM_RAISE_MS) / Math.max(1, windupMs - SLAM_RAISE_MS - SLAM_DOWN_MS));
  if (msFromLanding < 0) {
    const downProgress = (msFromLanding + SLAM_DOWN_MS) / SLAM_DOWN_MS;
    return lerp(SHADOW_DARK_HEIGHT_UNITS, SHADOW_CONTACT_HEIGHT_UNITS, downProgress * downProgress * downProgress);
  }
  if (msFromLanding < SLAM_HOLD_MS) return SHADOW_CONTACT_HEIGHT_UNITS;
  return lerp(SHADOW_CONTACT_HEIGHT_UNITS, SHADOW_APPEAR_HEIGHT_UNITS, smoothstep((msFromLanding - SLAM_HOLD_MS) / SLAM_LIFT_MS));
}
