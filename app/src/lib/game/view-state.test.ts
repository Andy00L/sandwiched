import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { parseRecordedRound, type RecordedRound } from "./round-events";
import { applyRoundEvent, createViewState, viewStateAt, type RoundViewState } from "./view-state";

const ROUNDS_DIRECTORY = join(import.meta.dir, "../../../tests/rounds");
const CANONICAL_FILE_NAMES = [
  "balanced.json",
  "crowd.json",
  "duel.json",
  "pigeons-feast.json",
  "slam-showcase.json",
  "whale-keeps.json",
];

function parseCanonicalFile(fileName: string) {
  const json: unknown = JSON.parse(readFileSync(join(ROUNDS_DIRECTORY, fileName), "utf8"));
  return parseRecordedRound(json);
}

const CANONICAL_ROUNDS = CANONICAL_FILE_NAMES.flatMap((fileName): [string, RecordedRound][] => {
  const parsed = parseCanonicalFile(fileName);
  return parsed.ok ? [[fileName, parsed.round]] : [];
});

function countCrumbsInPlay(state: RoundViewState): number {
  const loose = state.looseCrumbs.reduce((total, crumbs) => total + crumbs, 0);
  const beaks = state.seats.reduce((total, seat) => total + seat.beakCrumbs, 0);
  return state.pot + loose + beaks;
}

function countAntedCrumbs(state: RoundViewState): number {
  return state.seats.filter((seat) => seat.presence === "anted").length * state.chipsPerAnte;
}

function findConservationBreak(round: RecordedRound): string | null {
  let state = createViewState(round);
  for (const [index, event] of round.events.entries()) {
    state = applyRoundEvent(state, event);
    if (countCrumbsInPlay(state) !== countAntedCrumbs(state)) {
      return `event ${index} at tick ${event.tick} (${event.kind})`;
    }
  }
  return null;
}

describe("canonical rounds", () => {
  test("the folder holds exactly the recorded rounds and each one parses", () => {
    const fileNames = readdirSync(ROUNDS_DIRECTORY).filter((fileName) => fileName.endsWith(".json"));
    expect(fileNames.sort()).toEqual(CANONICAL_FILE_NAMES);
    for (const fileName of CANONICAL_FILE_NAMES) {
      const parsed = parseCanonicalFile(fileName);
      expect(parsed.ok ? null : parsed.reason).toBeNull();
    }
  });

  test.each(CANONICAL_ROUNDS)("%s conserves crumbs after every event", (_fileName, round) => {
    expect(findConservationBreak(round)).toBeNull();
  });

  test.each(CANONICAL_ROUNDS)("%s ends in the state its settlement names", (_fileName, round) => {
    const settledEvent = round.events.at(-1);
    expect(settledEvent?.kind).toBe("settled");
    if (settledEvent?.kind !== "settled") {
      return;
    }
    const finalState = viewStateAt(round, settledEvent.tick);
    const loose = finalState.looseCrumbs.reduce((total, crumbs) => total + crumbs, 0);
    const pigeonBeaks = finalState.seats
      .filter((seat) => seat.role === "pigeon")
      .map((seat) => ({ seat: seat.seat, crumbs: seat.beakCrumbs }));
    expect(finalState.phase).toBe("settled");
    expect(finalState.pot + loose).toBe(settledEvent.whaleCrumbs);
    expect(pigeonBeaks).toEqual([...settledEvent.beaks]);
    expect(pigeonBeaks.reduce((total, beak) => total + beak.crumbs, 0)).toBe(settledEvent.pigeonCrumbs);
  });
});

describe("viewStateAt", () => {
  test.each(CANONICAL_ROUNDS)("%s includes the events of the asked tick and none after", (_fileName, round) => {
    const drawEvent = round.events.find((event) => event.kind === "whaleDrawn");
    expect(drawEvent?.kind).toBe("whaleDrawn");
    if (drawEvent?.kind !== "whaleDrawn") {
      return;
    }
    const beforeDraw = viewStateAt(round, drawEvent.tick - 1);
    const atDraw = viewStateAt(round, drawEvent.tick);
    expect(beforeDraw.phase).toBe("lobby");
    expect(beforeDraw.tick).toBe(drawEvent.tick - 1);
    expect(atDraw.phase).toBe("live");
    expect(atDraw.seats.find((seat) => seat.seat === drawEvent.whaleSeat)?.role).toBe("whale");
  });
});

describe("applyRoundEvent", () => {
  test.each(CANONICAL_ROUNDS.slice(0, 1))(
    "a peck on an empty box stuns until its tick, then the stun end perches the pigeon (%s roster)",
    (_fileName, round) => {
      const perched = applyRoundEvent(createViewState(round), { tick: 10, kind: "landed", seat: 1, box: 0 });
      const stunned = applyRoundEvent(perched, {
        tick: 20,
        kind: "pecked",
        seat: 1,
        box: 0,
        outcome: "emptyBox",
        untilTick: 220,
      });
      const recovered = applyRoundEvent(stunned, { tick: 220, kind: "stunEnded", seat: 1 });
      const findPigeon = (state: RoundViewState) => state.seats.find((seat) => seat.seat === 1)?.pigeon;
      expect(findPigeon(stunned)).toEqual({ state: "stunned", box: 0, untilTick: 220 });
      expect(findPigeon(recovered)).toEqual({ state: "perched", box: 0 });
      expect(countCrumbsInPlay(recovered)).toBe(countCrumbsInPlay(perched));
    },
  );
});
