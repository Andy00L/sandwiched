import { TICK_MS } from "./chain-rules";

const SAMPLE_WINDOW_MS = 5_000;

export type TickClock = {
  observe: (slot: number, observedAtMs: number) => void;
  estimate: (atMs: number) => number;
  reset: () => void;
};

type OffsetSample = { offsetTicks: number; observedAtMs: number };

export function createTickClock(tickMs: number = TICK_MS): TickClock {
  let descendingSamples: OffsetSample[] = [];
  let highestSlot = 0;
  let lastEstimate = 0;
  return {
    observe(slot, observedAtMs) {
      const offsetTicks = slot - observedAtMs / tickMs;
      while ((descendingSamples.at(-1)?.offsetTicks ?? Number.POSITIVE_INFINITY) <= offsetTicks) descendingSamples.pop();
      descendingSamples.push({ offsetTicks, observedAtMs });
      while ((descendingSamples[0]?.observedAtMs ?? observedAtMs) < observedAtMs - SAMPLE_WINDOW_MS) descendingSamples.shift();
      highestSlot = Math.max(highestSlot, slot);
    },
    estimate(atMs) {
      const freshest = descendingSamples[0];
      if (freshest === undefined) return lastEstimate;
      lastEstimate = Math.max(lastEstimate, highestSlot, Math.floor(freshest.offsetTicks + atMs / tickMs));
      return lastEstimate;
    },
    reset() {
      descendingSamples = [];
      highestSlot = 0;
      lastEstimate = 0;
    },
  };
}
