import { expect, jest } from "bun:test";

const MICROTASK_FLUSHES_PER_STEP = 10;
const DEFAULT_STEP_MS = 10;

type TimerControl = { advanceTimersByTime: (milliseconds: number) => void };

const hasTimerControl = (candidate: object): candidate is TimerControl =>
  "advanceTimersByTime" in candidate && typeof candidate.advanceTimersByTime === "function";

export function advanceTimers(milliseconds: number): void {
  expect(hasTimerControl(jest)).toBe(true);
  if (hasTimerControl(jest)) jest.advanceTimersByTime(milliseconds);
}

export async function flushMicrotasks(): Promise<void> {
  for (let flush = 0; flush < MICROTASK_FLUSHES_PER_STEP; flush += 1) await Promise.resolve();
}

export async function advanceFakeTime(totalMs: number, stepMs: number = DEFAULT_STEP_MS): Promise<void> {
  for (let elapsedMs = 0; elapsedMs < totalMs; elapsedMs += stepMs) {
    advanceTimers(Math.min(stepMs, totalMs - elapsedMs));
    await flushMicrotasks();
  }
}
