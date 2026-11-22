import { TIMER_KICK_DECAY_MS, TIMER_KICK_RAD, TIMER_WEDGE_S } from "./motion-tokens";

const SECOND_MS = 1000;

export function timerSweep(nowTick: number, endTick: number | null, roundTicks: number): number {
  if (endTick === null || roundTicks <= 0) return 0;
  return Math.min(1, Math.max(0, (nowTick - (endTick - roundTicks)) / roundTicks));
}

export function timerKickRad(remainingMs: number): number {
  if (remainingMs <= 0 || remainingMs > TIMER_WEDGE_S * SECOND_MS) return 0;
  const msSinceSecond = (SECOND_MS - (remainingMs % SECOND_MS)) % SECOND_MS;
  const side = Math.floor(remainingMs / SECOND_MS) % 2 === 0 ? 1 : -1;
  return side * TIMER_KICK_RAD * Math.exp(-msSinceSecond / TIMER_KICK_DECAY_MS);
}

export function timerWedgeShare(roundMs: number): number {
  return roundMs > 0 ? Math.min(1, (TIMER_WEDGE_S * SECOND_MS) / roundMs) : 0;
}
