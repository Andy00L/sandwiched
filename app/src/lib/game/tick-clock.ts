import { TICK_MS } from "./chain-rules";

const SAMPLE_COUNT = 20;

export type TickClock = {
  observe: (slot: number, observedAtMs: number) => void;
  estimate: (atMs: number) => number;
};

function readMedian(values: readonly number[]): number {
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  const upper = sorted[middle] ?? 0;
  return sorted.length % 2 === 1 ? upper : ((sorted[middle - 1] ?? upper) + upper) / 2;
}

export function createTickClock(tickMs: number = TICK_MS): TickClock {
  const slotOffsets: number[] = [];
  let highestSlot = 0;
  let lastEstimate = 0;
  return {
    observe(slot, observedAtMs) {
      slotOffsets.push(slot - observedAtMs / tickMs);
      if (slotOffsets.length > SAMPLE_COUNT) slotOffsets.shift();
      highestSlot = Math.max(highestSlot, slot);
    },
    estimate(atMs) {
      if (slotOffsets.length === 0) return lastEstimate;
      const extrapolated = Math.floor(readMedian(slotOffsets) + atMs / tickMs);
      lastEstimate = Math.max(lastEstimate, highestSlot, extrapolated);
      return lastEstimate;
    },
  };
}
