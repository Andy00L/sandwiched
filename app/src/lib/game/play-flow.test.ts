import { describe, expect, test } from "bun:test";
import { findTestWallet } from "../../../tests/fake-chain";
import { INITIAL_PLAY_STATE, type PlayEvent, type PlayState, ROUND_TITLES, chooseRoundTitle, isTableOpenForPlay, stepPlay, summarizeRound } from "./play-flow";
import type { RecordedRound } from "./round-events";
import { LIVE_TIMING } from "./chain-rules";
import type { TableListing } from "./table-listings";

const TABLE: TableListing = { tableId: 2_001n, kind: "practice", anteUnits: 100_000n, boxCount: 3, address: findTestWallet(40) };

const play = (...events: PlayEvent[]): PlayState => events.reduce(stepPlay, INITIAL_PLAY_STATE);

const SUMMARY = { roundNumber: 4, whaleCrumbs: 500, pigeonCrumbs: 200, ownSeat: 1, ownRole: "pigeon" as const, ownCrumbs: 41, topPigeons: [] };

describe("stepPlay", () => {
  test("a visitor picks a table, plays now, and sits once the guest is ready", () => {
    const seating = play({ kind: "pickTable", table: TABLE }, { kind: "playNow" }, { kind: "seatStage", stage: { kind: "preparing", step: "deposit", attempt: 1 } });
    expect(seating.flow).toMatchObject({ kind: "seat", sheet: { phase: "seating", step: "deposit" } });
    const seated = stepPlay(seating, { kind: "seatStage", stage: { kind: "ready" } });
    expect(seated.flow).toMatchObject({ kind: "table", overlay: { kind: "none" } });
    expect(isTableOpenForPlay(seated)).toBe(true);
  });

  test("a failed seat shows its reason and can be tried again, but not abandoned mid-way", () => {
    const failed = play({ kind: "pickTable", table: TABLE }, { kind: "playNow" }, { kind: "seatStage", stage: { kind: "failed", step: "fund", reason: "faucet dry" } });
    expect(failed.flow).toMatchObject({ kind: "seat", sheet: { phase: "failed", reason: "faucet dry" } });
    const retrying = stepPlay(failed, { kind: "playNow" });
    expect(retrying.flow).toMatchObject({ kind: "seat", sheet: { phase: "seating" } });
    expect(stepPlay(retrying, { kind: "goHome" }).flow.kind).toBe("seat");
  });

  test("shows the role sheet once per round and the results once per round", () => {
    const seated = play({ kind: "pickTable", table: TABLE }, { kind: "playNow" }, { kind: "seatStage", stage: { kind: "ready" } });
    const withRole = stepPlay(seated, { kind: "roundLive", roundNumber: 4, role: "whale" });
    expect(withRole.flow).toMatchObject({ overlay: { kind: "role", role: "whale" } });
    expect(isTableOpenForPlay(withRole)).toBe(false);
    const afterRole = stepPlay(withRole, { kind: "roleSeen", roundNumber: 4 });
    expect(stepPlay(afterRole, { kind: "roundLive", roundNumber: 4, role: "whale" }).flow).toMatchObject({ overlay: { kind: "none" } });
    const results = stepPlay(afterRole, { kind: "roundSettled", summary: SUMMARY });
    expect(results.flow).toMatchObject({ overlay: { kind: "results" } });
    const anted = stepPlay(results, { kind: "anteAgain" });
    expect(stepPlay(anted, { kind: "roundSettled", summary: SUMMARY }).flow).toMatchObject({ overlay: { kind: "none" } });
  });

  test("cashing out goes from the results to a receipt, and a receipt that left money on the rollup can try again", () => {
    const results = play(
      { kind: "pickTable", table: TABLE },
      { kind: "playNow" },
      { kind: "seatStage", stage: { kind: "ready" } },
      { kind: "roundSettled", summary: SUMMARY },
    );
    const cashing = stepPlay(results, { kind: "cashOutStarted" });
    expect(cashing.flow).toMatchObject({ overlay: { kind: "cashingOut" } });
    expect(stepPlay(cashing, { kind: "anteAgain" })).toBe(cashing);
    const stuck = stepPlay(cashing, { kind: "cashOutEnded", receipt: { kind: "onRollup", chips: 400n, units: 400_000n, reason: "base down" } });
    expect(stuck.flow).toMatchObject({ overlay: { kind: "receipt", receipt: { kind: "onRollup" } } });
    expect(stepPlay(stuck, { kind: "cashOutStarted" }).flow).toMatchObject({ overlay: { kind: "cashingOut" } });
  });

  test("an open drawer covers the table and toggles closed with the same key", () => {
    const seated = play({ kind: "pickTable", table: TABLE }, { kind: "playNow" }, { kind: "seatStage", stage: { kind: "ready" } });
    const helping = stepPlay(seated, { kind: "toggleDrawer", drawer: "help" });
    expect(isTableOpenForPlay(helping)).toBe(false);
    expect(stepPlay(helping, { kind: "toggleDrawer", drawer: "help" }).drawer).toBeNull();
  });
});

const buildRound = (events: RecordedRound["events"]): RecordedRound => ({
  version: 1,
  seed: 0,
  tickMs: 10,
  boxCount: 3,
  timing: LIVE_TIMING,
  chipsPerAnte: 100,
  players: [0, 1, 2, 3].map((seat) => ({ seat, name: ["Gary", "Linda", "Doug", "Brenda"][seat] ?? "", variant: seat, temperament: "greedy" })),
  events,
});

describe("summarizeRound", () => {
  const round = buildRound([
    { tick: 1, kind: "whaleDrawn", whaleSeat: 0, sandwichBox: 1, endTick: 4_500 },
    { tick: 4_500, kind: "settled", whaleCrumbs: 340, pigeonCrumbs: 60, beaks: [{ seat: 1, crumbs: 12 }, { seat: 2, crumbs: 41 }, { seat: 3, crumbs: 7 }] },
  ]);

  test("gives a pigeon its own beak and ranks the flock by crumbs", () => {
    expect(summarizeRound(9, round, 2)).toMatchObject({ ownRole: "pigeon", ownCrumbs: 41, topPigeons: [{ name: "Doug", crumbs: 41 }, { name: "Linda", crumbs: 12 }, { name: "Brenda", crumbs: 7 }] });
  });

  test("gives the whale what it kept, and nothing to a seat that sat the round out", () => {
    expect(summarizeRound(9, round, 0)).toMatchObject({ ownRole: "whale", ownCrumbs: 340 });
    expect(summarizeRound(9, round, 5)).toBeNull();
  });
});

describe("chooseRoundTitle", () => {
  test("picks the title by the whale's share of the pot", () => {
    expect(chooseRoundTitle({ whaleCrumbs: 10, pigeonCrumbs: 90 })).toBe(ROUND_TITLES.sandwiched);
    expect(chooseRoundTitle({ whaleCrumbs: 40, pigeonCrumbs: 60 })).toBe(ROUND_TITLES.shared);
    expect(chooseRoundTitle({ whaleCrumbs: 70, pigeonCrumbs: 30 })).toBe(ROUND_TITLES.mostly);
    expect(chooseRoundTitle({ whaleCrumbs: 699, pigeonCrumbs: 1 })).toBe(ROUND_TITLES.hungry);
  });
});
