import { type Result, failure, success } from "../chain/result";
import type { RecordedRound, RoundEvent, RoundPlayer, RoundTiming } from "./round-events";
import type { LiveRound, TableStore } from "./table-store";

export type RoundSource = {
  players: readonly RoundPlayer[];
  boxCount: number;
  tickMs: number;
  timing: RoundTiming;
  latestRound: () => RecordedRound;
  tickAt: (timeSeconds: number) => number;
};

const KEPT_ROUND_COUNT = 2;

export function createReplaySource(round: RecordedRound, leadSeconds: number): RoundSource {
  return {
    players: round.players,
    boxCount: round.boxCount,
    tickMs: round.tickMs,
    timing: round.timing,
    latestRound: () => round,
    tickAt: (timeSeconds) => ((timeSeconds - leadSeconds) * 1000) / round.tickMs,
  };
}

type KeptRound = { roundNumber: number; events: RoundEvent[]; round: RecordedRound };

function keepRound(live: LiveRound): KeptRound {
  const events = [...live.round.events];
  return { roundNumber: live.roundNumber, events, round: { ...live.round, events } };
}

function isSameRoundHistory(kept: KeptRound, live: LiveRound): boolean {
  const [firstKept] = kept.events;
  return live.round.events.length >= kept.events.length && (firstKept === undefined || firstKept === live.round.events[0]);
}

export function waitForLiveRoundSource(store: TableStore, timeoutMs: number): Promise<Result<RoundSource>> {
  const keptRounds: KeptRound[] = [];

  const absorb = (live: LiveRound) => {
    const kept = keptRounds.find((candidate) => candidate.roundNumber === live.roundNumber);
    if (kept === undefined || !isSameRoundHistory(kept, live)) {
      const replaced = keptRounds.filter((candidate) => candidate.roundNumber !== live.roundNumber);
      keptRounds.splice(0, keptRounds.length, ...replaced, keepRound(live));
    } else {
      for (let index = kept.events.length; index < live.round.events.length; index++) {
        const event = live.round.events[index];
        if (event !== undefined) kept.events.push(event);
      }
    }
    keptRounds.sort((left, right) => left.roundNumber - right.roundNumber);
    if (keptRounds.length > KEPT_ROUND_COUNT) keptRounds.splice(0, keptRounds.length - KEPT_ROUND_COUNT);
  };

  const absorbSnapshot = () => {
    const snapshot = store.getSnapshot();
    if (snapshot.previous !== null) absorb(snapshot.previous);
    if (snapshot.live !== null) absorb(snapshot.live);
  };

  return new Promise((resolve) => {
    const deadline = setTimeout(() => {
      stopWaiting();
      resolve(failure(`[waitForLiveRoundSource] the table showed no round within ${timeoutMs} ms`));
    }, timeoutMs);
    const resolveOnFirstRound = () => {
      const first = keptRounds.at(-1);
      if (first === undefined) return;
      clearTimeout(deadline);
      stopWaiting();
      resolve(
        success({
          players: first.round.players,
          boxCount: first.round.boxCount,
          tickMs: first.round.tickMs,
          timing: first.round.timing,
          latestRound: () => keptRounds.at(-1)?.round ?? first.round,
          tickAt: () => store.horizonTick(),
        }),
      );
    };
    store.subscribe(absorbSnapshot);
    const stopWaiting = store.subscribe(resolveOnFirstRound);
    absorbSnapshot();
    resolveOnFirstRound();
  });
}
