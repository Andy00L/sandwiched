import { describe, expect, test } from "bun:test";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import type { PublicKey } from "@solana/web3.js";
import { SLOT_REGRESSION_SLOTS } from "../chain/config";
import type { RollupAck } from "../chain/transport";
import { coalesceChanges, createFakeChain, findTestWallet, type ChainChange, type FakeChain, type SwatLandingMode } from "../../../tests/fake-chain";
import { TICK_MS } from "./chain-rules";
import { parseRecordedRound, type RecordedRound, type RoundEvent, type SeatCrumbs } from "./round-events";
import { createTableStore, type LiveRound, type PigeonIntent, type PredictedEvent, type TableStore } from "./table-store";

const ROUNDS_DIRECTORY = join(import.meta.dir, "../../../tests/rounds");
const SEED_COUNT = Number(process.env.TABLE_STORE_SEEDS ?? 12);
const LATE_SEED_COUNT = Number(process.env.TABLE_STORE_LATE_SEEDS ?? 6);
const FIRST_SEED = Number(process.env.TABLE_STORE_FIRST_SEED ?? 1);
const MAX_POLL_PERIOD_TICKS = Number(process.env.TABLE_STORE_MAX_PERIOD ?? 32);
const MAX_SKIP_PERIOD_TICKS = Number(process.env.TABLE_STORE_MAX_SKIP_PERIOD ?? 8);
const TEST_TIMEOUT_MS = 120_000;
const RANDOM_MAX_PERIOD_TICKS = 500;
const ADVANCE_EVERY_MS = 20;
const BASE_LATENCY_MS = 30;
const ON_TIME_MAX_DELAY_MS = 60;
const LATE_MAX_DELAY_MS = 400;
const MAX_DUPLICATE_DELAY_MS = 400;
const FLUSH_AFTER_LAST_DELIVERY_MS = 1_000;
const RESTART_PAUSE_TICKS = 1_000;
const RESTARTED_FIRST_SLOT = 40;
const PRE_RESTART_SLOT_BASE = 1_000 * SLOT_REGRESSION_SLOTS;
const MAX_ROUNDS_PER_SESSION = 4;
const MAX_GAP_TICKS = 400;
const MIN_ABORT_DELAY_TICKS = 20;
const MAX_THINNED_SHARE = 0.4;
const MICROTASK_FLUSHES = 5;
const REPORTED_FAULTS = 6;
const NEXT_ANTE_DELAYS_TICKS = [0, 1, 2, 3, 5, 8] as const;
const SHARED_POLL_PERIODS_TICKS = [25, 50, 100, 250] as const;
const THINNABLE_KINDS: ReadonlySet<RoundEvent["kind"]> = new Set(["flew", "tookOff", "pecked", "handRaised", "swatLanded"]);
const LOBBY_KINDS: ReadonlySet<RoundEvent["kind"]> = new Set(["seatJoined", "anted"]);
const IN_ROUND_KINDS: ReadonlySet<RoundEvent["kind"]> = new Set(["flew", "landed", "tookOff", "pecked", "handRaised", "swatLanded", "stunEnded"]);

type Random = {
  nextFraction: () => number;
  pickInteger: (low: number, high: number) => number;
  pick: <Item>(items: readonly [Item, ...Item[]]) => Item;
};

function createRandom(seed: number): Random {
  let state = seed >>> 0;
  const nextFraction = () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let mixed = Math.imul(state ^ (state >>> 15), 1 | state);
    mixed = (mixed + Math.imul(mixed ^ (mixed >>> 7), 61 | mixed)) ^ mixed;
    return ((mixed ^ (mixed >>> 14)) >>> 0) / 4_294_967_296;
  };
  const pickInteger = (low: number, high: number) => low + Math.floor(nextFraction() * (high - low + 1));
  return { nextFraction, pickInteger, pick: (items) => items[pickInteger(0, items.length - 1)] ?? items[0] };
}

function hashText(text: string): number {
  let hash = 2_166_136_261;
  for (const character of text) hash = Math.imul(hash ^ (character.codePointAt(0) ?? 0), 16_777_619) >>> 0;
  return hash;
}

type NamedRound = { name: string; round: RecordedRound };

function loadRecordedRounds(): NamedRound[] {
  return readdirSync(ROUNDS_DIRECTORY)
    .filter((fileName) => fileName.endsWith(".json"))
    .sort()
    .flatMap((fileName) => {
      const parsed = parseRecordedRound(JSON.parse(readFileSync(join(ROUNDS_DIRECTORY, fileName), "utf8")));
      return parsed.ok ? [{ name: fileName.replace(".json", ""), round: parsed.round }] : [];
    });
}

const RECORDED_ROUNDS = loadRecordedRounds();
const RECORDED_NAMES = RECORDED_ROUNDS.map((recorded) => recorded.name);
const HEADER = RECORDED_ROUNDS[0]?.round;
const DUEL = RECORDED_ROUNDS.find((recorded) => recorded.name === "duel")?.round;
const DUEL_DRAW_INDEX = DUEL?.events.findIndex((event) => event.kind === "whaleDrawn") ?? -1;
const NEXT_OPENING: readonly RoundEvent[] = DUEL?.events.slice(0, DUEL_DRAW_INDEX + 1) ?? [];
const NEXT_FIRST_ANTE_TICK = NEXT_OPENING.find((event) => event.kind === "anted")?.tick ?? 0;

type RoundPlan = { name: string; events: readonly RoundEvent[]; abortAfterEvents: number | null; abortDelayTicks: number };

type SessionPlan = {
  rounds: readonly RoundPlan[];
  gapTicks: readonly number[];
  restartBeforeRound: number | null;
  swatLanding: SwatLandingMode;
  ownSeat: number;
};

type Sampling =
  | { kind: "everySlot" }
  | { kind: "polled"; periodTicks: number; phaseTicks: number }
  | { kind: "skipping"; periodTicks: number; phaseTicks: number };

type DeliveryPlan = { sampling: Sampling; maxDelayMs: number; duplicateShare: number };

type SettledSplit = { whaleCrumbs: number; pigeonCrumbs: number; beaks: readonly SeatCrumbs[] };

type RoundSummary = {
  roundNumber: number;
  antedSeats: readonly number[];
  whaleSeat: number | null;
  sandwichBox: number | null;
  endTick: number | null;
  swatNumbers: readonly number[];
  settled: SettledSplit | null;
};

type TimedChange = { wallTick: number; segment: number; slotOffset: number; change: ChainChange };

type ChainTimeline = { changes: readonly TimedChange[]; rounds: readonly RoundSummary[] };

type SampledChange = { wallTick: number; group: number; change: ChainChange; isDuplicable: boolean };

type Delivery = { atMs: number; change: ChainChange };

type PublishedRound = { roundNumber: number; live: LiveRound };

type StoreRun = { rounds: readonly PublishedRound[]; predictionFaults: readonly string[] };

const ACCOUNT_NAMES = new WeakMap<PublicKey, string>();

function nameAccount(change: ChainChange): string {
  if (change.kind === "table") return "table";
  const address = change.snapshot.address;
  const known = ACCOUNT_NAMES.get(address);
  if (known !== undefined) return known;
  const name = address.toBase58();
  ACCOUNT_NAMES.set(address, name);
  return name;
}

function copyChange(change: ChainChange): ChainChange {
  return change.kind === "table" ? { kind: "table", snapshot: { ...change.snapshot } } : { kind: "seat", snapshot: { ...change.snapshot } };
}

function offsetRoundNumber(change: ChainChange, roundOffset: bigint): ChainChange {
  if (change.kind === "seat" || roundOffset === 0n) return change;
  const table = change.snapshot;
  const lastResult = table.lastResult === null ? null : { ...table.lastResult, roundNumber: table.lastResult.roundNumber + roundOffset };
  return { kind: "table", snapshot: { ...table, roundNumber: table.roundNumber + roundOffset, lastResult } };
}

function abortLiveRound(chain: FakeChain, slot: number, chipsPerAnte: number): ChainChange[] {
  const table = chain.table();
  const antedSeats = new Set(table.antedSeatIndexes);
  const tableChange: ChainChange = {
    kind: "table",
    snapshot: { ...table, slot, roundNumber: table.roundNumber + 1n, antedSeatIndexes: [], phase: { state: "lobby", firstAnteTick: 0n } },
  };
  const refunds = chain
    .seats()
    .filter((seat) => seat.seatIndex !== null && antedSeats.has(seat.seatIndex))
    .map(
      (seat): ChainChange => ({
        kind: "seat",
        snapshot: { ...seat, slot, chips: seat.chips + BigInt(chipsPerAnte), pigeon: { state: "hovering" }, beakCrumbs: 0n, nextPeckTick: 0n, lastSwatNumber: 0n },
      }),
    );
  return [tableChange, ...refunds];
}

function readChipsBySeat(chain: FakeChain): ReadonlyMap<number, bigint> {
  return new Map(chain.seats().flatMap((seat) => (seat.seatIndex === null ? [] : [[seat.seatIndex, seat.chips] as const])));
}

function playSessionOnChain(header: RecordedRound, session: SessionPlan): ChainTimeline {
  const changes: TimedChange[] = [];
  const rounds: RoundSummary[] = [];
  let chain = createFakeChain(header, session.swatLanding);
  let roundOffset = 0n;
  let segment = 0;
  let slotOffset = session.restartBeforeRound === null ? 0 : PRE_RESTART_SLOT_BASE;
  let wallTick = 0;
  const record = (applied: readonly ChainChange[], atWallTick: number) => {
    for (const change of applied) changes.push({ wallTick: atWallTick, segment, slotOffset, change: offsetRoundNumber(change, roundOffset) });
  };
  const recordTruth = (event: RoundEvent, chipsBefore: ReadonlyMap<number, bigint>) => {
    const table = chain.table();
    if (event.kind === "whaleDrawn" && table.phase.state === "live") {
      rounds.push({
        roundNumber: Number(table.roundNumber + roundOffset),
        antedSeats: [...table.antedSeatIndexes].sort((left, right) => left - right),
        whaleSeat: table.phase.whaleSeat,
        sandwichBox: table.round.sandwichBox,
        endTick: Number(table.round.endTick),
        swatNumbers: [],
        settled: null,
      });
    }
    const current = rounds.at(-1);
    if (event.kind === "handRaised" && current !== undefined && current.settled === null) {
      current.swatNumbers = Array.from({ length: Number(table.round.swatCount) }, (_unused, index) => index + 1);
    }
    if (event.kind !== "settled" || table.lastResult === null || current === undefined || current.settled !== null) return;
    const chipsAfter = readChipsBySeat(chain);
    const beaks = current.antedSeats
      .filter((seat) => seat !== current.whaleSeat)
      .map((seat) => ({ seat, crumbs: Number((chipsAfter.get(seat) ?? 0n) - (chipsBefore.get(seat) ?? 0n)) }));
    current.settled = { whaleCrumbs: Number(table.lastResult.whaleCrumbs), pigeonCrumbs: Number(table.lastResult.pigeonCrumbs), beaks };
  };
  for (const [roundIndex, round] of session.rounds.entries()) {
    wallTick += session.gapTicks[roundIndex] ?? 0;
    if (roundIndex === session.restartBeforeRound) {
      segment += 1;
      wallTick += RESTART_PAUSE_TICKS;
      slotOffset = RESTARTED_FIRST_SLOT - wallTick;
    }
    const roundStartWallTick = wallTick;
    const playedEvents = round.abortAfterEvents === null ? round.events : round.events.slice(0, round.abortAfterEvents);
    for (const event of playedEvents) {
      if (event.kind === "seatJoined" && chain.table().seats[event.seat] !== null) continue;
      const eventWallTick = Math.max(roundStartWallTick + event.tick, wallTick);
      const chipsBefore = readChipsBySeat(chain);
      record(chain.apply({ ...event, tick: eventWallTick + slotOffset }), eventWallTick);
      recordTruth(event, chipsBefore);
      wallTick = eventWallTick;
    }
    if (round.abortAfterEvents !== null) {
      wallTick += round.abortDelayTicks;
      record(abortLiveRound(chain, wallTick + slotOffset, header.chipsPerAnte), wallTick);
      roundOffset += chain.table().roundNumber + 1n;
      chain = createFakeChain(header, session.swatLanding);
    }
  }
  return { changes, rounds };
}

function listLastWritesPerSlot(changes: readonly TimedChange[]): ReadonlySet<TimedChange> {
  const lastByAccountSlot = new Map<string, TimedChange>();
  for (const timed of changes) lastByAccountSlot.set(`${nameAccount(timed.change)}@${timed.change.snapshot.slot}`, timed);
  return new Set(lastByAccountSlot.values());
}

function groupIntoWindows(changes: readonly TimedChange[], periodTicks: number, phaseTicks: number) {
  const windows = new Map<string, { endWallTick: number; slotOffset: number; changes: TimedChange[] }>();
  for (const timed of changes) {
    const windowIndex = Math.floor((timed.wallTick + phaseTicks) / periodTicks);
    const key = `${timed.segment}:${windowIndex}`;
    const window = windows.get(key) ?? { endWallTick: (windowIndex + 1) * periodTicks - phaseTicks, slotOffset: timed.slotOffset, changes: [] };
    window.changes.push(timed);
    windows.set(key, window);
  }
  return [...windows.values()];
}

function sampleChanges(changes: readonly TimedChange[], sampling: Sampling): SampledChange[] {
  if (sampling.kind === "everySlot") {
    const lastWrites = listLastWritesPerSlot(changes);
    return changes.map((timed, index) => ({ wallTick: timed.wallTick, group: index, change: timed.change, isDuplicable: lastWrites.has(timed) }));
  }
  return groupIntoWindows(changes, sampling.periodTicks, sampling.phaseTicks).flatMap((window, windowIndex): SampledChange[] => {
    if (sampling.kind === "polled") {
      const readSlot = window.endWallTick + window.slotOffset;
      return coalesceChanges(
        window.changes.map((timed) => timed.change),
        readSlot,
      ).map((change) => ({ wallTick: window.endWallTick, group: windowIndex, change, isDuplicable: true }));
    }
    const timedByChange = new Map(window.changes.map((timed) => [timed.change, timed]));
    return coalesceChanges(window.changes.map((timed) => timed.change)).map((change, index) => ({
      wallTick: timedByChange.get(change)?.wallTick ?? window.endWallTick,
      group: windowIndex * changes.length + index,
      change,
      isDuplicable: true,
    }));
  });
}

function planDeliveries(timeline: ChainTimeline, plan: DeliveryPlan, random: Random): Delivery[] {
  const lastAtMsByAccount = new Map<string, number>();
  const delayByGroup = new Map<number, number>();
  const deliveries: Delivery[] = [];
  const sampled = sampleChanges(timeline.changes, plan.sampling).sort((left, right) => left.wallTick - right.wallTick);
  for (const { wallTick, group, change, isDuplicable } of sampled) {
    const delayMs = delayByGroup.get(group) ?? BASE_LATENCY_MS + Math.floor(random.nextFraction() * plan.maxDelayMs);
    delayByGroup.set(group, delayMs);
    const account = nameAccount(change);
    const atMs = Math.max(wallTick * TICK_MS + delayMs, lastAtMsByAccount.get(account) ?? 0);
    lastAtMsByAccount.set(account, atMs);
    deliveries.push({ atMs, change });
    if (isDuplicable && random.nextFraction() < plan.duplicateShare) {
      deliveries.push({ atMs: atMs + random.pickInteger(0, MAX_DUPLICATE_DELAY_MS), change: copyChange(change) });
    }
  }
  return deliveries.sort((left, right) => left.atMs - right.atMs);
}

function ingestChange(store: TableStore, change: ChainChange): void {
  if (change.kind === "table") store.ingestTable(change.snapshot);
  else store.ingestSeat(change.snapshot);
}

function watchPublishedRounds(store: TableStore, readNowMs: () => number) {
  const rounds: PublishedRound[] = [];
  const predictionFaults: string[] = [];
  const madeInRound = new Map<PredictedEvent, number | null>();
  const recordRound = (shown: LiveRound) => {
    const known = rounds.findLast((published) => published.roundNumber === shown.roundNumber);
    if (known !== undefined) known.live = shown;
    else rounds.push({ roundNumber: shown.roundNumber, live: shown });
  };
  store.subscribe(() => {
    const snapshot = store.getSnapshot();
    const live = snapshot.live;
    if (snapshot.previous !== null) recordRound(snapshot.previous);
    if (live !== null) recordRound(live);
    for (const predicted of snapshot.predicted) {
      if (!madeInRound.has(predicted)) madeInRound.set(predicted, live?.roundNumber ?? null);
      const origin = madeInRound.get(predicted) ?? null;
      if (live !== null && origin === live.roundNumber && live.view.phase === "live") continue;
      predictionFaults.push(
        `at ${readNowMs()} ms a ${predicted.kind} prediction made in round ${origin} is still shown while the store shows round ${live?.roundNumber ?? "none"} as ${live?.view.phase ?? "absent"}`,
      );
    }
  });
  return { rounds, predictionFaults };
}

function runReferenceStore(timeline: ChainTimeline): StoreRun {
  const store = createTableStore({ ownWallet: null, horizonTicks: 0, now: () => 0 });
  const watched = watchPublishedRounds(store, () => 0);
  for (const timed of timeline.changes) ingestChange(store, timed.change);
  return watched;
}

function choosePigeonIntent(live: LiveRound, ownSeat: number, random: Random): PigeonIntent | null {
  const seatView = live.view.seats.find((seat) => seat.seat === ownSeat);
  if (live.view.phase !== "live" || seatView === undefined || seatView.role !== "pigeon" || seatView.presence !== "anted") return null;
  const box = random.pickInteger(0, live.view.looseCrumbs.length - 1);
  return random.pick<PigeonIntent>([{ kind: "flyTo", box }, { kind: "takeOff" }, { kind: "peck" }]);
}

async function flushMicrotasks(): Promise<void> {
  for (let flush = 0; flush < MICROTASK_FLUSHES; flush += 1) await Promise.resolve();
}

async function runSampledStore(deliveries: readonly Delivery[], ownSeat: number, random: Random): Promise<StoreRun> {
  let nowMs = 0;
  const store = createTableStore({ ownWallet: findTestWallet(ownSeat), now: () => nowMs });
  const watched = watchPublishedRounds(store, () => nowMs);
  const pendingAcks: { atMs: number; ack: RollupAck; resolve: (ack: RollupAck) => void }[] = [];
  const endMs = (deliveries.at(-1)?.atMs ?? 0) + FLUSH_AFTER_LAST_DELIVERY_MS;
  let deliveryIndex = 0;
  let nextActionMs = random.pickInteger(100, 600);
  for (let stepMs = 0; stepMs <= endMs; stepMs += ADVANCE_EVERY_MS) {
    for (let delivery = deliveries[deliveryIndex]; delivery !== undefined && delivery.atMs <= stepMs; delivery = deliveries[deliveryIndex]) {
      nowMs = delivery.atMs;
      ingestChange(store, delivery.change);
      deliveryIndex += 1;
    }
    nowMs = stepMs;
    const dueAcks = pendingAcks.filter((pending) => pending.atMs <= stepMs);
    if (dueAcks.length > 0) {
      for (const pending of dueAcks) {
        pendingAcks.splice(pendingAcks.indexOf(pending), 1);
        pending.resolve(pending.ack);
      }
      await flushMicrotasks();
    }
    store.advance();
    const live = store.getSnapshot().live;
    if (stepMs < nextActionMs || live === null) continue;
    nextActionMs = stepMs + random.pickInteger(100, 600);
    const intent = choosePigeonIntent(live, ownSeat, random);
    if (intent === null) continue;
    const acked = Promise.withResolvers<RollupAck>();
    const ack: RollupAck =
      random.nextFraction() < 0.7
        ? { ok: true, signature: `action-${stepMs}`, ackMs: 1 }
        : { ok: false, kind: "program", errorCode: null, errorName: "BoxFull", detail: "", ackMs: 1 };
    pendingAcks.push({ atMs: stepMs + random.pickInteger(20, 400), ack, resolve: acked.resolve });
    void store.perform(intent, () => acked.promise);
  }
  for (const pending of pendingAcks) pending.resolve(pending.ack);
  await flushMicrotasks();
  return watched;
}

function summarizePublishedRound(published: PublishedRound): RoundSummary {
  const events = published.live.round.events;
  const draw = events.find((event) => event.kind === "whaleDrawn");
  const settle = events.find((event) => event.kind === "settled");
  const drawIndex = draw === undefined ? events.length : events.indexOf(draw);
  const antedSeats = [...new Set(events.slice(0, drawIndex).flatMap((event) => (event.kind === "anted" ? [event.seat] : [])))];
  return {
    roundNumber: published.roundNumber,
    antedSeats: antedSeats.sort((left, right) => left - right),
    whaleSeat: draw?.kind === "whaleDrawn" ? draw.whaleSeat : null,
    sandwichBox: draw?.kind === "whaleDrawn" ? draw.sandwichBox : null,
    endTick: draw?.kind === "whaleDrawn" ? draw.endTick : null,
    swatNumbers: events.flatMap((event) => (event.kind === "handRaised" ? [event.swatNumber] : [])).sort((left, right) => left - right),
    settled: settle?.kind === "settled" ? { whaleCrumbs: settle.whaleCrumbs, pigeonCrumbs: settle.pigeonCrumbs, beaks: settle.beaks } : null,
  };
}

function hasGoneLive(published: PublishedRound): boolean {
  return published.live.round.events.some((event) => event.kind === "whaleDrawn" || event.kind === "settled");
}

function listRoundsSeenLive(deliveries: readonly Delivery[]): ReadonlySet<number> {
  return new Set(deliveries.flatMap((delivery) => (delivery.change.kind === "table" && delivery.change.snapshot.phase.state === "live" ? [Number(delivery.change.snapshot.roundNumber)] : [])));
}

function isContiguousRun(numbers: readonly number[], highest: number): boolean {
  return numbers.every((number, index) => number >= 1 && number <= highest && (index === 0 || number === (numbers[index - 1] ?? 0) + 1));
}

function listSeatsNamedBy(event: RoundEvent): readonly number[] {
  if (event.kind === "swatLanded") return event.hits.map((hit) => hit.seat);
  return "seat" in event ? [event.seat] : [];
}

function findStructureFaults(published: PublishedRound): string[] {
  const events = published.live.round.events;
  const label = `round ${published.roundNumber}`;
  const faults: string[] = [];
  const drawIndexes = events.flatMap((event, index) => (event.kind === "whaleDrawn" ? [index] : []));
  const settleIndexes = events.flatMap((event, index) => (event.kind === "settled" ? [index] : []));
  if (drawIndexes.length > 1) faults.push(`${label} has ${drawIndexes.length} whaleDrawn events`);
  if (settleIndexes.length > 1) faults.push(`${label} has ${settleIndexes.length} settled events`);
  const drawIndex = drawIndexes[0] ?? events.length;
  const settleIndex = settleIndexes[0] ?? events.length;
  const summary = summarizePublishedRound(published);
  const roundPigeons = new Set(summary.antedSeats.filter((seat) => seat !== summary.whaleSeat));
  events.forEach((event, index) => {
    const previous = events[index - 1];
    const at = `${label} event ${index} (${event.kind} at tick ${event.tick})`;
    if (previous !== undefined && event.tick < previous.tick) faults.push(`${at} comes after tick ${previous.tick}`);
    if (LOBBY_KINDS.has(event.kind) && index > drawIndex) faults.push(`${at} comes after the whale was drawn`);
    if (IN_ROUND_KINDS.has(event.kind) && (index < drawIndex || index > settleIndex)) faults.push(`${at} falls outside the live round`);
    if (index > settleIndex) faults.push(`${at} comes after the settle`);
    const stranger = IN_ROUND_KINDS.has(event.kind) ? listSeatsNamedBy(event).find((seat) => !roundPigeons.has(seat)) : undefined;
    if (stranger !== undefined) faults.push(`${at} names seat ${stranger}, which is not a pigeon of this round`);
  });
  return faults;
}

function describeSettleGap(expected: SettledSplit | null, actual: SettledSplit | null): string[] {
  if (expected === null && actual === null) return [];
  if (expected === null) return ["the store published a settle the chain never made"];
  if (actual === null) return [`the chain settled it (whale ${expected.whaleCrumbs}, pigeons ${expected.pigeonCrumbs}) but the store never published that settle`];
  const gaps: string[] = [];
  if (expected.whaleCrumbs !== actual.whaleCrumbs || expected.pigeonCrumbs !== actual.pigeonCrumbs) {
    gaps.push(`split chain ${expected.whaleCrumbs}/${expected.pigeonCrumbs}, store ${actual.whaleCrumbs}/${actual.pigeonCrumbs}`);
  }
  const actualBySeat = new Map(actual.beaks.map((beak) => [beak.seat, beak.crumbs]));
  const beakGaps = expected.beaks.filter((beak) => actualBySeat.get(beak.seat) !== beak.crumbs);
  const extraSeats = actual.beaks.filter((beak) => !expected.beaks.some((expectedBeak) => expectedBeak.seat === beak.seat));
  if (beakGaps.length > 0 || extraSeats.length > 0) {
    const described = [
      ...beakGaps.map((beak) => `seat ${beak.seat} chain ${beak.crumbs} store ${actualBySeat.get(beak.seat) ?? "none"}`),
      ...extraSeats.map((beak) => `seat ${beak.seat} chain none store ${beak.crumbs}`),
    ];
    gaps.push(`beaks at settlement differ: ${described.join(", ")}`);
  }
  return gaps;
}

function describeSwatGap(expected: RoundSummary, actual: RoundSummary, isLossless: boolean): string[] {
  const highest = expected.swatNumbers.length;
  const isAgreeing = isLossless ? Bun.deepEquals(actual.swatNumbers, expected.swatNumbers) : isContiguousRun(actual.swatNumbers, highest);
  return isAgreeing ? [] : [`swat numbers chain 1..${highest}, store [${actual.swatNumbers.join(",")}]`];
}

function describeRoundGap(expected: RoundSummary | undefined, actual: RoundSummary | undefined, isLossless: boolean): string | null {
  if (expected === undefined) return actual === undefined ? null : `the store published round ${actual.roundNumber}, which the chain never played`;
  if (actual === undefined) return `the chain played round ${expected.roundNumber} but the store never published it`;
  if (actual.roundNumber !== expected.roundNumber) return `the chain played round ${expected.roundNumber} where the store published round ${actual.roundNumber}`;
  const fields = ["antedSeats", "whaleSeat", "sandwichBox", "endTick"] as const;
  const gaps = [
    ...fields.flatMap((field) =>
      Bun.deepEquals(actual[field], expected[field]) ? [] : [`${field} chain ${JSON.stringify(expected[field])}, store ${JSON.stringify(actual[field])}`],
    ),
    ...describeSwatGap(expected, actual, isLossless),
    ...describeSettleGap(expected.settled, actual.settled),
  ];
  return gaps.length === 0 ? null : `round ${expected.roundNumber}: ${gaps.join("; ")}`;
}

function findViewBeakGaps(published: PublishedRound, expected: RoundSummary | undefined): string[] {
  if (expected?.settled === undefined || expected.settled === null || published.live.view.phase !== "settled") return [];
  const viewBeaks = new Map(published.live.view.seats.map((seat) => [seat.seat, seat.beakCrumbs]));
  const gaps = expected.settled.beaks.filter((beak) => viewBeaks.get(beak.seat) !== beak.crumbs);
  if (gaps.length === 0) return [];
  const described = gaps.map((beak) => `seat ${beak.seat} chain ${beak.crumbs} view ${viewBeaks.get(beak.seat) ?? "none"}`);
  return [`round ${published.roundNumber}: the view's beaks at settlement drifted from the chain: ${described.join(", ")}`];
}

function compareWithChain(run: StoreRun, timeline: ChainTimeline, isLossless: boolean, seenLive: ReadonlySet<number> | null): string[] {
  const expectedRounds = timeline.rounds.filter((round) => seenLive === null || round.settled !== null || seenLive.has(round.roundNumber));
  const playedRounds = run.rounds.filter(hasGoneLive);
  const published = playedRounds.map(summarizePublishedRound);
  const roundCount = Math.max(published.length, expectedRounds.length);
  const roundGaps = Array.from({ length: roundCount }, (_unused, index) => describeRoundGap(expectedRounds[index], published[index], isLossless));
  const firstRoundGap = roundGaps.find((gap) => gap !== null);
  const viewBeakGaps = isLossless ? playedRounds.flatMap((round, index) => findViewBeakGaps(round, expectedRounds[index])) : [];
  return [
    ...run.rounds.flatMap(findStructureFaults),
    ...(firstRoundGap === undefined || firstRoundGap === null ? [] : [firstRoundGap]),
    ...viewBeakGaps.slice(0, 1),
    ...run.predictionFaults.slice(0, 2),
  ];
}

function describeWithoutCrumbSource(event: RoundEvent): string {
  return event.kind === "pecked" && event.outcome !== "emptyBox" ? JSON.stringify({ ...event, outcome: "crumb" }) : JSON.stringify(event);
}

function groupEventsByTick(events: readonly RoundEvent[]): Map<number, string[]> {
  const byTick = new Map<number, string[]>();
  for (const event of events) byTick.set(event.tick, [...(byTick.get(event.tick) ?? []), describeWithoutCrumbSource(event)]);
  for (const group of byTick.values()) group.sort();
  return byTick;
}

function compareEventStreams(run: StoreRun, reference: StoreRun): string[] {
  const settledReference = reference.rounds.filter((published) => published.live.view.phase === "settled");
  const referenceByRound = new Map(settledReference.map((published) => [published.roundNumber, published.live.round.events]));
  for (const published of run.rounds) {
    const referenceEvents = referenceByRound.get(published.roundNumber);
    if (referenceEvents === undefined) continue;
    const expected = groupEventsByTick(referenceEvents);
    const actual = groupEventsByTick(published.live.round.events);
    const ticks = [...new Set([...expected.keys(), ...actual.keys()])].sort((left, right) => left - right);
    const gapTick = ticks.find((tick) => !Bun.deepEquals(expected.get(tick), actual.get(tick)));
    if (gapTick === undefined) continue;
    return [
      `round ${published.roundNumber} tick ${gapTick}: the every-slot run has [${(expected.get(gapTick) ?? []).join(", ")}] but this run has [${(actual.get(gapTick) ?? []).join(", ")}]`,
    ];
  }
  return [];
}

function describeDelivery(plan: DeliveryPlan): string {
  const sampling = plan.sampling;
  const sampled =
    sampling.kind === "everySlot"
      ? "every slot"
      : sampling.kind === "polled"
        ? `polled every ${sampling.periodTicks} ticks from phase ${sampling.phaseTicks}, stamped with the read slot`
        : `only the latest change per account every ${sampling.periodTicks} ticks from phase ${sampling.phaseTicks}, at its own slot`;
  return `${sampled}, delay up to ${BASE_LATENCY_MS + plan.maxDelayMs} ms, duplicates ${Math.round(plan.duplicateShare * 100)}%`;
}

function describeSession(session: SessionPlan): string {
  const rounds = session.rounds.map((round, index) => {
    const recordedLength = RECORDED_ROUNDS.find((recorded) => recorded.name === round.name)?.round.events.length ?? round.events.length;
    const cut = round.abortAfterEvents === null ? "" : `, aborted after ${round.abortAfterEvents} events`;
    const restart = index === session.restartBeforeRound ? "rollup restart, then " : "";
    return `${restart}${round.name} (${round.events.length}/${recordedLength} events, gap ${session.gapTicks[index] ?? 0}${cut})`;
  });
  return `${rounds.join(" then ")}; swats ${session.swatLanding}; own seat ${session.ownSeat}`;
}

async function checkSession(session: SessionPlan, plans: readonly DeliveryPlan[], label: string): Promise<string[]> {
  if (HEADER === undefined) return ["[checkSession] no recorded rounds were found"];
  const timeline = playSessionOnChain(HEADER, session);
  const reference = runReferenceStore(timeline);
  const referenceFaults = compareWithChain(reference, timeline, true, null);
  if (referenceFaults.length > 0) return [`[checkSession] ${label}, ${describeSession(session)}, every slot one by one: ${referenceFaults.join("; ")}`];
  const faults: string[] = [];
  for (const [planIndex, plan] of plans.entries()) {
    const random = createRandom(hashText(`${label}#${planIndex}`));
    const deliveries = planDeliveries(timeline, plan, random);
    const run = await runSampledStore(deliveries, session.ownSeat, random);
    const isLossless = plan.sampling.kind === "everySlot" && plan.maxDelayMs <= ON_TIME_MAX_DELAY_MS;
    const seenLive = isLossless ? null : listRoundsSeenLive(deliveries);
    const planFaults = [...compareWithChain(run, timeline, isLossless, seenLive), ...(isLossless ? compareEventStreams(run, reference) : [])];
    if (planFaults.length > 0) faults.push(`[checkSession] ${label}, ${describeSession(session)}, ${describeDelivery(plan)}: ${planFaults.join("; ")}`);
  }
  return faults;
}

function thinRound(named: NamedRound, random: Random): readonly RoundEvent[] {
  const share = random.nextFraction() * MAX_THINNED_SHARE;
  return named.round.events.filter((event) => !THINNABLE_KINDS.has(event.kind) || random.nextFraction() >= share);
}

function generateSession(random: Random, minGapTicks: number): SessionPlan {
  const roundCount = random.pickInteger(2, MAX_ROUNDS_PER_SESSION);
  const rounds = Array.from({ length: roundCount }, (): RoundPlan => {
    const named = RECORDED_ROUNDS[random.pickInteger(0, RECORDED_ROUNDS.length - 1)] ?? RECORDED_ROUNDS[0];
    if (named === undefined) return { name: "none", events: [], abortAfterEvents: null, abortDelayTicks: 0 };
    const events = random.nextFraction() < 0.5 ? thinRound(named, random) : named.round.events;
    const drawIndex = events.findIndex((event) => event.kind === "whaleDrawn");
    const settleIndex = events.findIndex((event) => event.kind === "settled");
    const isAborted = random.nextFraction() < 0.2 && drawIndex >= 0 && settleIndex > drawIndex + 1;
    const abortAfterEvents = isAborted ? random.pickInteger(drawIndex + 1, settleIndex - 1) : null;
    return { name: named.name, events, abortAfterEvents, abortDelayTicks: random.pickInteger(MIN_ABORT_DELAY_TICKS, MAX_GAP_TICKS) };
  });
  const restartBeforeRound = random.nextFraction() < 0.3 ? random.pickInteger(1, roundCount - 1) : null;
  const gapTicks = rounds.map((_round, index) => (index === 0 ? 0 : minGapTicks + random.pick([0, 1, random.pickInteger(2, MAX_GAP_TICKS)])));
  const firstPlayers = RECORDED_ROUNDS.find((recorded) => recorded.name === rounds[0]?.name)?.round.players ?? [];
  const ownSeat = firstPlayers[random.pickInteger(0, Math.max(0, firstPlayers.length - 1))]?.seat ?? 0;
  return { rounds, gapTicks, restartBeforeRound, swatLanding: random.pick<SwatLandingMode>(["lazy", "landSwat"]), ownSeat };
}

function generateDeliveryPlans(random: Random, periodTicks: number, maxDelayMs: number): DeliveryPlan[] {
  const duplicateShare = random.pick([0, 0.3]);
  return [
    { sampling: { kind: "everySlot" }, maxDelayMs, duplicateShare },
    { sampling: { kind: "polled", periodTicks, phaseTicks: random.pickInteger(0, periodTicks - 1) }, maxDelayMs, duplicateShare },
    { sampling: { kind: "skipping", periodTicks, phaseTicks: random.pickInteger(0, periodTicks - 1) }, maxDelayMs, duplicateShare },
  ];
}

function buildBoundarySession(name: string, gapTicks: number): SessionPlan | null {
  const recorded = RECORDED_ROUNDS.find((candidate) => candidate.name === name)?.round;
  if (recorded === undefined) return null;
  return {
    rounds: [
      { name, events: recorded.events, abortAfterEvents: null, abortDelayTicks: 0 },
      { name: "duel", events: NEXT_OPENING, abortAfterEvents: null, abortDelayTicks: 0 },
    ],
    gapTicks: [0, gapTicks],
    restartBeforeRound: null,
    swatLanding: "lazy",
    ownSeat: recorded.players[1]?.seat ?? 0,
  };
}

async function runGeneratedSessions(maxDelayMs: number, seedCount: number): Promise<string[]> {
  const faults: string[] = [];
  for (let seed = FIRST_SEED; seed < FIRST_SEED + seedCount; seed += 1) {
    const random = createRandom(seed);
    const periodTicks = random.pickInteger(2, RANDOM_MAX_PERIOD_TICKS);
    const plans = generateDeliveryPlans(random, periodTicks, maxDelayMs);
    faults.push(...(await checkSession(generateSession(random, periodTicks), plans, `seed ${seed}`)));
  }
  return faults.slice(0, REPORTED_FAULTS);
}

describe("the table store agrees with the chain however its snapshots are sampled", () => {
  test("the recorded rounds share one table setup, so one fake chain can play them back to back", () => {
    expect(RECORDED_ROUNDS.length).toBeGreaterThanOrEqual(6);
    expect(NEXT_OPENING.at(-1)?.kind).toBe("whaleDrawn");
    const setups = RECORDED_ROUNDS.map(({ round }) => JSON.stringify({ timing: round.timing, boxCount: round.boxCount, chipsPerAnte: round.chipsPerAnte }));
    expect(new Set(setups).size).toBe(1);
  });

  test.each(RECORDED_NAMES)(
    `%s: polled every 1 to ${MAX_POLL_PERIOD_TICKS} ticks and skipping every 1 to ${MAX_SKIP_PERIOD_TICKS} ticks, on time, next round apart`,
    async (name) => {
      const session = buildBoundarySession(name, Math.max(MAX_POLL_PERIOD_TICKS, MAX_SKIP_PERIOD_TICKS));
      expect(session).not.toBeNull();
      if (session === null) return;
      const listPeriods = (maxTicks: number) => Array.from({ length: maxTicks }, (_unused, index) => index + 1);
      const plans: DeliveryPlan[] = [
        ...listPeriods(MAX_POLL_PERIOD_TICKS).map((periodTicks): DeliveryPlan => ({ sampling: { kind: "polled", periodTicks, phaseTicks: 0 }, maxDelayMs: 0, duplicateShare: 0 })),
        ...listPeriods(MAX_SKIP_PERIOD_TICKS).map((periodTicks): DeliveryPlan => ({ sampling: { kind: "skipping", periodTicks, phaseTicks: 0 }, maxDelayMs: 0, duplicateShare: 0 })),
      ];
      expect((await checkSession(session, plans, name)).slice(0, REPORTED_FAULTS)).toEqual([]);
    },
    TEST_TIMEOUT_MS,
  );

  test(
    `${SEED_COUNT} generated sessions from seed ${FIRST_SEED}, on time: thinned, aborted, restarted and duplicated rounds`,
    async () => {
      expect(await runGeneratedSessions(ON_TIME_MAX_DELAY_MS, SEED_COUNT)).toEqual([]);
    },
    TEST_TIMEOUT_MS,
  );

  test.each(RECORDED_NAMES)("%s: the settle is published when the next round's first ante follows closely", async (name) => {
    const delayedSessions = NEXT_ANTE_DELAYS_TICKS.map((delayTicks) => buildBoundarySession(name, delayTicks - NEXT_FIRST_ANTE_TICK));
    const everySlot: DeliveryPlan = { sampling: { kind: "everySlot" }, maxDelayMs: ON_TIME_MAX_DELAY_MS, duplicateShare: 0 };
    const faults: string[] = [];
    for (const [index, session] of delayedSessions.entries()) {
      if (session !== null) faults.push(...(await checkSession(session, [everySlot], `${name}, next ante ${NEXT_ANTE_DELAYS_TICKS[index]} ticks after the settle`)));
    }
    const sharedSession = buildBoundarySession(name, 1 - NEXT_FIRST_ANTE_TICK);
    const settleTick = RECORDED_ROUNDS.find((recorded) => recorded.name === name)?.round.events.at(-1)?.tick ?? 0;
    const sharedPolls = SHARED_POLL_PERIODS_TICKS.map(
      (periodTicks): DeliveryPlan => ({ sampling: { kind: "polled", periodTicks, phaseTicks: (periodTicks - (settleTick % periodTicks)) % periodTicks }, maxDelayMs: 0, duplicateShare: 0 }),
    );
    if (sharedSession !== null) faults.push(...(await checkSession(sharedSession, sharedPolls, `${name}, settle and next ante in one poll`)));
    expect(faults.slice(0, REPORTED_FAULTS)).toEqual([]);
  }, TEST_TIMEOUT_MS);

  test.each(RECORDED_NAMES)(
    "%s: the last swat before the settle is published when both land in one poll",
    async (name) => {
      const session = buildBoundarySession(name, RANDOM_MAX_PERIOD_TICKS);
      const events = RECORDED_ROUNDS.find((recorded) => recorded.name === name)?.round.events ?? [];
      const lastRaiseTick = events.findLast((event) => event.kind === "handRaised")?.tick ?? 0;
      const settleTick = events.at(-1)?.tick ?? 0;
      const periodTicks = settleTick - lastRaiseTick + 2;
      const phaseTicks = (periodTicks - ((lastRaiseTick - 1) % periodTicks)) % periodTicks;
      expect(session).not.toBeNull();
      if (session === null) return;
      const plan: DeliveryPlan = { sampling: { kind: "polled", periodTicks, phaseTicks }, maxDelayMs: 0, duplicateShare: 0 };
      if (HEADER === undefined) return;
      const timeline = playSessionOnChain(HEADER, session);
      const run = await runSampledStore(planDeliveries(timeline, plan, createRandom(1)), session.ownSeat, createRandom(1));
      const publishedSwats = run.rounds[0] === undefined ? [] : summarizePublishedRound(run.rounds[0]).swatNumbers;
      expect({ lastSwatNumber: publishedSwats.at(-1), poll: describeDelivery(plan) }).toEqual({ lastSwatNumber: timeline.rounds[0]?.swatNumbers.at(-1), poll: describeDelivery(plan) });
    },
    TEST_TIMEOUT_MS,
  );

  test(
    `${LATE_SEED_COUNT} generated sessions from seed ${FIRST_SEED}, delivered up to ${BASE_LATENCY_MS + LATE_MAX_DELAY_MS} ms late`,
    async () => {
      expect(await runGeneratedSessions(LATE_MAX_DELAY_MS, LATE_SEED_COUNT)).toEqual([]);
    },
    TEST_TIMEOUT_MS,
  );
});
