import { afterEach, beforeEach, describe, expect, jest, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { advanceFakeTime } from "../../../tests/fake-time";
import type { Result } from "../chain/result";
import { parseRecordedRound, type RecordedRound } from "./round-events";
import { type RoundSource, createReplaySource, waitForLiveRoundSource } from "./round-source";
import type { LiveRound, TableStore, TableStoreSnapshot } from "./table-store";
import { createViewState } from "./view-state";

const DUEL_PATH = join(import.meta.dir, "../../../tests/rounds/duel.json");
const TIMEOUT_MS = 1_000;

const readDuel = (): RecordedRound => {
  const parsed = parseRecordedRound(JSON.parse(readFileSync(DUEL_PATH, "utf8")));
  if (!parsed.ok) return expect.unreachable(parsed.reason);
  return parsed.round;
};

const liveRoundOf = (round: RecordedRound, roundNumber: number, eventCount: number): LiveRound => ({
  roundNumber,
  round: { ...round, events: round.events.slice(0, eventCount) },
  view: createViewState(round),
});

const createFakeStore = () => {
  const listeners = new Set<() => void>();
  let snapshot: TableStoreSnapshot = { live: null, previous: null, ownSeat: null, predicted: [], lastRefusal: null };
  const store: TableStore = {
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    getSnapshot: () => snapshot,
    ingestTable: () => undefined,
    ingestSeat: () => undefined,
    advance: () => undefined,
    horizonTick: () => 4_321,
    chainTick: () => 4_331,
    perform: async () => ({ ok: true, signature: "unused", ackMs: 0 }),
  };
  const publish = (live: LiveRound | null, previous: LiveRound | null = null) => {
    snapshot = { ...snapshot, live, previous };
    for (const listener of listeners) listener();
  };
  return { store, publish };
};

const requireSource = async (pending: Promise<Result<RoundSource>>): Promise<RoundSource> => {
  const outcome = await pending;
  expect(outcome.ok).toBe(true);
  if (!outcome.ok) return expect.unreachable(outcome.reason);
  return outcome.value;
};

beforeEach(() => jest.useFakeTimers());
afterEach(() => jest.useRealTimers());

describe("waitForLiveRoundSource", () => {
  test("keeps one round object per round and appends the events the store publishes", async () => {
    const duel = readDuel();
    const { store, publish } = createFakeStore();
    const pending = waitForLiveRoundSource(store, TIMEOUT_MS);
    publish(liveRoundOf(duel, 7, 3));
    const source = await requireSource(pending);
    const shown = source.latestRound();
    publish(liveRoundOf(duel, 7, 10));
    expect(source.latestRound()).toBe(shown);
    expect(shown.events).toEqual(duel.events.slice(0, 10));
    expect(source.tickAt(99)).toBe(4_321);
  });

  test("gives the round that just ended its last events when the next round starts in the same publish", async () => {
    const duel = readDuel();
    const { store, publish } = createFakeStore();
    const pending = waitForLiveRoundSource(store, TIMEOUT_MS);
    publish(liveRoundOf(duel, 7, 3));
    const source = await requireSource(pending);
    const endedRound = source.latestRound();
    publish(liveRoundOf(duel, 8, 1), liveRoundOf(duel, 7, duel.events.length));
    expect(endedRound.events.at(-1)?.kind).toBe("settled");
    expect(source.latestRound()).not.toBe(endedRound);
    expect(source.latestRound().events).toHaveLength(1);
  });

  test("starts the round over when the store's history for that round number changed, as after a rollup restart", async () => {
    const duel = readDuel();
    const { store, publish } = createFakeStore();
    const pending = waitForLiveRoundSource(store, TIMEOUT_MS);
    publish(liveRoundOf(duel, 7, 10));
    const source = await requireSource(pending);
    const beforeRestart = source.latestRound();
    publish(liveRoundOf(duel, 7, 2));
    expect(source.latestRound()).not.toBe(beforeRestart);
    expect(source.latestRound().events).toHaveLength(2);
  });

  test("fails when the table shows no round before the deadline", async () => {
    const { store } = createFakeStore();
    const pending = waitForLiveRoundSource(store, TIMEOUT_MS);
    await advanceFakeTime(TIMEOUT_MS + 10, 100);
    const outcome = await pending;
    expect(outcome.ok).toBe(false);
  });
});

describe("createReplaySource", () => {
  test("starts the recorded round after the lead and never changes rounds", () => {
    const duel = readDuel();
    const source = createReplaySource(duel, 2.5);
    expect(source.tickAt(2.5)).toBe(0);
    expect(source.tickAt(3.5)).toBe(1000 / duel.tickMs);
    expect(source.latestRound()).toBe(duel);
  });
});
