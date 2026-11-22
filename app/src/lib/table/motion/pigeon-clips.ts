import { FLIGHT_ARC_HEIGHT_UNITS, PECK_RECOVER_MS, PECK_STRIKE_MS, PECK_TILT_RAD } from "./motion-tokens";

export const PECK_HOLD_REPLAY_MS = 40;
const PECK_OVERSHOOT_SHARE = 0.08;
const PECK_RECOVERY_SPAN = 1.6;

export interface FlightEndPoint {
  along: number;
  deckZ: number;
}

export interface FlightPlacement {
  along: number;
  height: number;
  deckZ: number;
  progress: number;
}

function smoothstep(progress: number): number {
  const clamped = Math.min(1, Math.max(0, progress));
  return clamped * clamped * (3 - 2 * clamped);
}

export function peckDepth(elapsedMs: number): number {
  if (elapsedMs < 0) return 0;
  if (elapsedMs < PECK_STRIKE_MS) return smoothstep(elapsedMs / PECK_STRIKE_MS);
  const recoverStart = PECK_STRIKE_MS + PECK_HOLD_REPLAY_MS;
  if (elapsedMs < recoverStart) return 1;
  const recover = (elapsedMs - recoverStart) / PECK_RECOVER_MS;
  if (recover >= PECK_RECOVERY_SPAN) return 0;
  const overshoot = Math.sin(Math.min(1, recover) * Math.PI) * PECK_OVERSHOOT_SHARE;
  return 1 - smoothstep(recover) - overshoot;
}

export function peckTiltRad(elapsedMs: number): number {
  return peckDepth(elapsedMs) * PECK_TILT_RAD;
}

export function flightPlacement(
  from: FlightEndPoint,
  to: FlightEndPoint,
  heights: { fromHeight: number; toHeight: number },
  timing: { startTick: number; landsTick: number; nowTick: number },
): FlightPlacement {
  const progress = Math.min(1, Math.max(0, (timing.nowTick - timing.startTick) / Math.max(1, timing.landsTick - timing.startTick)));
  const eased = smoothstep(progress);
  return {
    along: from.along + (to.along - from.along) * eased,
    height: heights.fromHeight + (heights.toHeight - heights.fromHeight) * eased + Math.sin(progress * Math.PI) * FLIGHT_ARC_HEIGHT_UNITS,
    deckZ: from.deckZ + (to.deckZ - from.deckZ) * eased,
    progress,
  };
}
