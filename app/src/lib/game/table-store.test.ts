import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { RollupAck } from "../chain/transport";
import { buildTableSnapshot, createFakeChain, findTestWallet, ingestChange, type FakeChain } from "../../../tests/fake-chain";
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
