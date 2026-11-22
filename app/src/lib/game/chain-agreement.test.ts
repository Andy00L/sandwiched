import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createFakeChain, ingestChange } from "../../../tests/fake-chain";
import { LIVE_TIMING } from "./chain-rules";
import { parseRecordedRound, type RecordedRound, type RoundEvent } from "./round-events";
import { createTableStore } from "./table-store";

const ROUNDS_DIRECTORY = join(import.meta.dir, "../../../tests/rounds");
const EXACT_ROUND_FILES = ["duel.json", "whale-keeps.json", "pigeons-feast.json"];
const OWED_CRUMB_ROUND_FILES = ["balanced.json", "crowd.json"];

const ROUNDS = new Map(
  [...EXACT_ROUND_FILES, ...OWED_CRUMB_ROUND_FILES].flatMap((fileName): [string, RecordedRound][] => {
    const parsed = parseRecordedRound(JSON.parse(readFileSync(join(ROUNDS_DIRECTORY, fileName), "utf8")));
    return parsed.ok ? [[fileName, parsed.round]] : [];
  }),
);

function playOnFakeChain(round: RecordedRound, eventCount: number = round.events.length) {
  const chain = createFakeChain(round);
  const store = createTableStore({ ownWallet: null, horizonTicks: 0, now: () => 0 });
  for (const event of round.events.slice(0, eventCount)) {
    for (const change of chain.apply(event)) ingestChange(store, change);
  }
  const live = store.getSnapshot().live;
  return { chain, events: live?.round.events ?? [], view: live?.view ?? null };
}

function swapCrumbSource(event: RoundEvent): RoundEvent {
  if (event.kind !== "pecked" || event.outcome === "emptyBox") return event;
  return { ...event, outcome: event.outcome === "looseCrumb" ? "sandwichCrumb" : "looseCrumb" };
}

describe("the chain adapter against the recorded rounds", () => {
  test("every round parses and was generated with the live timing", () => {
    expect([...ROUNDS.keys()]).toEqual([...EXACT_ROUND_FILES, ...OWED_CRUMB_ROUND_FILES]);
    for (const round of ROUNDS.values()) expect(round.timing).toEqual(LIVE_TIMING);
  });

  test.each(EXACT_ROUND_FILES)("%s: snapshots from a lazy chain give back the recorded events exactly", (fileName) => {
    const round = ROUNDS.get(fileName);
    expect(round).toBeDefined();
    if (round === undefined) return;
    expect(playOnFakeChain(round).events).toEqual([...round.events]);
  });

  test.each(OWED_CRUMB_ROUND_FILES)(
    "%s: the streams differ only in pecks that meet crumbs a swat knocked loose but the chain has not credited yet",
    (fileName) => {
      const round = ROUNDS.get(fileName);
      expect(round).toBeDefined();
      if (round === undefined) return;
      const { chain, events, view } = playOnFakeChain(round);
      const gapIndexes = round.events.flatMap((event, index) => (Bun.deepEquals(event, events[index]) ? [] : [index]));
      expect(events).toHaveLength(round.events.length);
      expect(gapIndexes.length).toBeGreaterThan(0);
      for (const index of gapIndexes) {
        const recorded = round.events[index];
        expect(events[index]).toEqual(recorded === undefined ? undefined : swapCrumbSource(recorded));
      }

      const firstGapIndex = gapIndexes[0] ?? 0;
      const firstGap = round.events[firstGapIndex];
      expect(firstGap?.kind === "pecked" ? firstGap.outcome : null).toBe("looseCrumb");
      const box = firstGap?.kind === "pecked" ? firstGap.box : 0;
      const beforeGap = playOnFakeChain(round, firstGapIndex);
      const chainLoose = beforeGap.chain.table().round.looseCrumbs.map(Number);
      const chainBeaks = beforeGap.chain.seats().reduce((total, seat) => total + Number(seat.beakCrumbs), 0);
      const viewLoose = beforeGap.view?.looseCrumbs ?? [];
      const viewBeaks = beforeGap.view?.seats.reduce((total, seat) => total + seat.beakCrumbs, 0) ?? 0;
      expect(chainLoose[box]).toBe(0);
      expect(viewLoose[box]).toBeGreaterThan(0);
      expect(chainBeaks - viewBeaks).toBe(viewLoose.reduce((total, loose) => total + loose, 0) - chainLoose.reduce((total, loose) => total + loose, 0));

      expect(events.at(-1)).toEqual(round.events.at(-1));
      expect(view?.pot).toBe(Number(chain.table().round.potCrumbs));
      expect(view?.looseCrumbs).toEqual(chain.table().round.looseCrumbs.map(Number));
    },
  );
});
