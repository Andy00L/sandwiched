import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { PublicKey } from "@solana/web3.js";
import type { RollupAck } from "../chain/transport";
import {
  buildRoundSnapshot,
  buildSeatSnapshot,
  buildTableSnapshot,
  coalesceChanges,
  createFakeChain,
  createTestKey,
  findTestWallet,
  ingestChange,
  type ChainChange,
  type FakeChain,
} from "../../../tests/fake-chain";
import { LIVE_TIMING, TICK_MS } from "./chain-rules";
import { parseRecordedRound, type RecordedRound, type RoundEvent } from "./round-events";
import { createTableStore, type TableStore } from "./table-store";

const DUEL_FILE = join(import.meta.dir, "../../../tests/rounds/duel.json");
const OWN_SEAT = 1;

function loadDuel(): RecordedRound | null {
  const parsed = parseRecordedRound(JSON.parse(readFileSync(DUEL_FILE, "utf8")));
  return parsed.ok ? parsed.round : null;
}

const DUEL = loadDuel();

function feedEvents(chain: FakeChain, store: TableStore, events: readonly RoundEvent[]): void {
  for (const event of events) {
    for (const change of chain.apply(event)) ingestChange(store, change);
  }
}

function startAtDraw(round: RecordedRound) {
  const drawIndex = round.events.findIndex((event) => event.kind === "whaleDrawn");
  const chain = createFakeChain(round);
  const store = createTableStore({ ownWallet: findTestWallet(OWN_SEAT), horizonTicks: 0, now: () => 0 });
  feedEvents(chain, store, round.events.slice(0, drawIndex + 1));
  return { chain, store, drawTick: round.events[drawIndex]?.tick ?? 0, ownFlight: round.events[drawIndex + 1] };
}

const readEvents = (store: TableStore) => store.getSnapshot().live?.round.events ?? [];

describe("createTableStore prediction", () => {
  test("an own flight shows on input, and the chain's flew takes its place", async () => {
    expect(DUEL).not.toBeNull();
    if (DUEL === null) return;
    const { chain, store, drawTick, ownFlight } = startAtDraw(DUEL);
    expect(ownFlight).toMatchObject({ kind: "flew", seat: OWN_SEAT, box: 2 });
    const ack = Promise.withResolvers<RollupAck>();
    const performed = store.perform({ kind: "flyTo", box: 2 }, () => ack.promise);

    expect(store.getSnapshot().predicted).toEqual([
      { tick: drawTick, kind: "flew", seat: OWN_SEAT, box: 2, landsTick: drawTick + LIVE_TIMING.flightTicks },
    ]);
    expect(readEvents(store).some((event) => event.kind === "flew")).toBe(false);

    feedEvents(chain, store, ownFlight === undefined ? [] : [ownFlight]);
    expect(store.getSnapshot().predicted).toEqual([]);
    expect(readEvents(store).at(-1)).toEqual(ownFlight);
    ack.resolve({ ok: true, signature: "flight", ackMs: 40 });
    expect((await performed).ok).toBe(true);
  });

  test("a refused action is withdrawn and leaves no trace in the authoritative events", async () => {
    expect(DUEL).not.toBeNull();
    if (DUEL === null) return;
    const { store } = startAtDraw(DUEL);
    const eventsBefore = readEvents(store);
    let predictedWhileSending: readonly unknown[] = [];
    const refusal: RollupAck = { ok: false, kind: "program", errorCode: null, errorName: "BoxFull", detail: "box 2 is full", ackMs: 30 };

    const ack = await store.perform({ kind: "flyTo", box: 2 }, async () => {
      predictedWhileSending = store.getSnapshot().predicted;
      return refusal;
    });

    expect(ack).toEqual(refusal);
    expect(predictedWhileSending).toHaveLength(1);
    expect(store.getSnapshot().predicted).toEqual([]);
    expect(store.getSnapshot().lastRefusal).toMatchObject({ intent: { kind: "flyTo", box: 2 }, seat: OWN_SEAT, errorName: "BoxFull" });
    expect(readEvents(store)).toEqual(eventsBefore);
    expect(store.getSnapshot().live?.view.seats.find((seat) => seat.seat === OWN_SEAT)?.pigeon).toEqual({ state: "hovering" });
  });
});

describe("createTableStore clock and rounds", () => {
  test("a change waits behind the horizon until the clock, extrapolated from observed slots, passes it", () => {
    const horizonTicks = 10;
    let nowMs = 0;
    const store = createTableStore({ ownWallet: null, horizonTicks, now: () => nowMs });
    const seats = buildTableSnapshot().seats.map((wallet, seat) => (seat === 0 ? findTestWallet(0) : wallet));
    store.ingestTable(buildTableSnapshot({ slot: 1_000, seats }));
    expect(store.getSnapshot().live).toBeNull();

    nowMs = (horizonTicks - 1) * TICK_MS;
    store.advance();
    expect(store.chainTick()).toBe(1_000 + horizonTicks - 1);
    expect(store.getSnapshot().live).toBeNull();

    nowMs = horizonTicks * TICK_MS;
    store.advance();
    expect(readEvents(store)).toEqual([{ tick: 1_000, kind: "seatJoined", seat: 0 }]);
  });

  test("the first ante after a settled round starts a new round with the seated players", () => {
    const round = DUEL;
    expect(round).not.toBeNull();
    if (round === null) return;
    const chain = createFakeChain(round);
    const store = createTableStore({ ownWallet: null, horizonTicks: 0, now: () => 0 });
    feedEvents(chain, store, round.events);
    expect(store.getSnapshot().live?.view.phase).toBe("settled");

    const settleTick = round.events.at(-1)?.tick ?? 0;
    feedEvents(chain, store, [{ tick: settleTick + 50, kind: "anted", seat: 1 }]);
    const live = store.getSnapshot().live;
    expect(live?.roundNumber).toBe(1);
    expect(live?.round.events).toEqual([
      { tick: settleTick + 50, kind: "seatJoined", seat: 0 },
      { tick: settleTick + 50, kind: "seatJoined", seat: 1 },
      { tick: settleTick + 50, kind: "anted", seat: 1 },
    ]);
    expect(live?.view.pot).toBe(round.chipsPerAnte);
  });
});

function collectChanges(chain: FakeChain, events: readonly RoundEvent[]): ChainChange[] {
  return events.flatMap((event) => chain.apply(event));
}

function seatWallets(occupied: readonly number[], overrides: ReadonlyMap<number, PublicKey> = new Map()) {
  return buildTableSnapshot().seats.map((_wallet, seat) => overrides.get(seat) ?? (occupied.includes(seat) ? findTestWallet(seat) : null));
}

describe("createTableStore round boundaries", () => {
  test("one snapshot carrying the settle of a round and the antes of the next starts the next round with both antes", () => {
    const round = DUEL;
    expect(round).not.toBeNull();
    if (round === null) return;
    const chain = createFakeChain(round);
    const store = createTableStore({ ownWallet: null, horizonTicks: 0, now: () => 0 });
    feedEvents(chain, store, round.events.slice(0, -1));
    const settleTick = round.events.at(-1)?.tick ?? 0;
    const nextRoundAntes: RoundEvent[] = [
      { tick: settleTick + 40, kind: "anted", seat: 0 },
      { tick: settleTick + 60, kind: "anted", seat: 1 },
    ];
    const settleAndAntes = collectChanges(chain, [...round.events.slice(-1), ...nextRoundAntes]);
    for (const change of coalesceChanges(settleAndAntes)) ingestChange(store, change);

    const live = store.getSnapshot().live;
    expect(live?.roundNumber).toBe(1);
    expect(live?.round.events.filter((event) => event.kind === "anted").map((event) => event.kind === "anted" && event.seat)).toEqual([0, 1]);
    expect(live?.view.pot).toBe(2 * round.chipsPerAnte);
    expect(live?.view.phase).toBe("lobby");
  });

  test("a prediction from a round the chain cancelled disappears with that round", async () => {
    expect(DUEL).not.toBeNull();
    if (DUEL === null) return;
    const { chain, store } = startAtDraw(DUEL);
    const ack = Promise.withResolvers<RollupAck>();
    const performed = store.perform({ kind: "flyTo", box: 0 }, () => ack.promise);
    expect(store.getSnapshot().predicted).toHaveLength(1);

    const table = chain.table();
    store.ingestTable({ ...table, slot: table.slot + 5, roundNumber: table.roundNumber + 1n, antedSeatIndexes: [], phase: { state: "lobby", firstAnteTick: 0n } });
    expect(store.getSnapshot().live?.roundNumber).toBe(1);
    expect(store.getSnapshot().predicted).toEqual([]);
    ack.resolve({ ok: true, signature: "late", ackMs: 1 });
    await performed;
  });

  test("follows a rollup that restarted at a lower slot instead of dropping its changes", () => {
    const store = createTableStore({ ownWallet: null, horizonTicks: 0, now: () => 0 });
    store.ingestTable(buildTableSnapshot({ slot: 900_000, seats: seatWallets([0]) }));
    expect(readEvents(store)).toEqual([{ tick: 900_000, kind: "seatJoined", seat: 0 }]);

    store.ingestTable(buildTableSnapshot({ slot: 40, seats: seatWallets([0, 1]) }));
    expect(readEvents(store)).toEqual([
      { tick: 40, kind: "seatJoined", seat: 0 },
      { tick: 40, kind: "seatJoined", seat: 1 },
    ]);
    expect(store.chainTick()).toBe(40);
  });
});

describe("createTableStore seats", () => {
  test("a seat that was vacated stops counting toward crumbs another pigeon finds", () => {
    const store = createTableStore({ ownWallet: null, horizonTicks: 0, now: () => 0 });
    const leaver = createTestKey(4, 1);
    const leaverSeat = (overrides: Parameters<typeof buildSeatSnapshot>[1]) =>
      buildSeatSnapshot(1, { address: createTestKey(5, 1), wallet: leaver, ...overrides });
    const sandwichBox = 2;
    store.ingestTable(buildTableSnapshot({ slot: 10, seats: seatWallets([0, 2], new Map([[1, leaver]])) }));
    store.ingestSeat(leaverSeat({ slot: 11, pigeon: { state: "perched", box: sandwichBox }, beakCrumbs: 4n }));
    store.ingestSeat(leaverSeat({ slot: 20, seatIndex: null }));
    store.ingestTable(buildTableSnapshot({ slot: 20, seats: seatWallets([0, 2]) }));

    const liveRound = buildRoundSnapshot({ sandwichBox, endTick: 5_000n, antedCrumbs: 300n, potCrumbs: 300n });
    const liveTable = buildTableSnapshot({
      slot: 100,
      roundNumber: 0n,
      seats: seatWallets([0, 1, 2]),
      antedSeatIndexes: [0, 1, 2],
      phase: { state: "live", whaleSeat: 0 },
      round: liveRound,
    });
    store.ingestTable({ ...liveTable, slot: 30, phase: { state: "lobby", firstAnteTick: 30n } });
    store.ingestTable(liveTable);
    const flying = buildSeatSnapshot(2, { slot: 110, pigeon: { state: "flying", box: sandwichBox, landsTick: 160n } });
    store.ingestSeat(flying);
    store.ingestSeat({ ...flying, slot: 170, pigeon: { state: "perched", box: sandwichBox }, beakCrumbs: 1n, nextPeckTick: 200n });
    store.ingestSeat({ ...flying, slot: 200, pigeon: { state: "perched", box: sandwichBox }, beakCrumbs: 2n, nextPeckTick: 230n });
    const swat = { number: 1n, box: sandwichBox, landsTick: 300n };
    store.ingestTable({ ...liveTable, slot: 265, round: { ...liveRound, swats: [swat], swatCount: 1n, hand: { state: "raised", box: sandwichBox, landsTick: 300n } } });
    const swatHit = { ...flying, slot: 460, pigeon: { state: "perched" as const, box: sandwichBox }, beakCrumbs: 1n, lastSwatNumber: 1n, nextPeckTick: 230n };
    store.ingestTable({ ...liveTable, slot: 455, round: { ...liveRound, swats: [swat], swatCount: 1n, looseCrumbs: [0n, 0n, 1n] } });
    store.ingestSeat({ ...swatHit, beakCrumbs: 2n, nextPeckTick: 490n });

    expect(readEvents(store).at(-1)).toMatchObject({ kind: "pecked", seat: 2, outcome: "looseCrumb" });
  });
});

describe("createTableStore deliveries", () => {
  test("a seat delivery older than the one already applied changes nothing", () => {
    expect(DUEL).not.toBeNull();
    if (DUEL === null) return;
    const { chain, store, ownFlight } = startAtDraw(DUEL);
    feedEvents(chain, store, ownFlight === undefined ? [] : [ownFlight]);
    const eventsAfterFlight = readEvents(store);
    const [ownSeat] = chain.seats().filter((seat) => seat.seatIndex === OWN_SEAT);
    if (ownSeat === undefined) return;
    store.ingestSeat({ ...ownSeat, slot: ownSeat.slot - 20, pigeon: { state: "hovering" } });
    expect(readEvents(store)).toBe(eventsAfterFlight);
  });
});

describe("createTableStore publishing", () => {
  test("a publish that adds no events hands out the same event array", async () => {
    expect(DUEL).not.toBeNull();
    if (DUEL === null) return;
    const { store } = startAtDraw(DUEL);
    const eventsBefore = readEvents(store);
    await store.perform({ kind: "flyTo", box: 2 }, async () => ({ ok: false, kind: "program", errorCode: null, errorName: "BoxFull", detail: "", ackMs: 1 }));
    expect(readEvents(store)).toBe(eventsBefore);
  });
});
