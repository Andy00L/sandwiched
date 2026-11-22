import type { PublicKey } from "@solana/web3.js";
import type { SeatSnapshot, TableSnapshot } from "../chain/accounts";
import { SLOT_REGRESSION_SLOTS } from "../chain/config";
import type { RollupAck } from "../chain/transport";
import { CHIPS_PER_ANTE, LIVE_TIMING, TICK_MS } from "./chain-rules";
import {
  ROUND_SCHEMA_VERSION,
  type FlewEvent,
  type RecordedRound,
  type RoundEvent,
  type RoundPlayer,
  type RoundTiming,
  type Temperament,
  type TookOffEvent,
} from "./round-events";
import { EMPTY_CHAIN_FRAME, deriveRoundEvents, findNextDueTick, type ChainFrame } from "./snapshot-diff";
import { createTickClock } from "./tick-clock";
import { applyRoundEvent, createViewState, type RoundViewState } from "./view-state";

const DEFAULT_HORIZON_TICKS = 10;
const PREDICTION_TIMEOUT_TICKS = 150;
const SETTLE_WAIT_MS = 500;
const PIGEON_NAMES = ["Gary", "Linda", "Doug", "Brenda", "Keith", "Sheila"] as const;
const LIVE_PLAYER_TEMPERAMENT: Temperament = "greedy";

export type PeckStartedEvent = { tick: number; kind: "peckStarted"; seat: number; box: number };

export type PredictedEvent = FlewEvent | TookOffEvent | PeckStartedEvent;

export type PigeonIntent = { kind: "flyTo"; box: number } | { kind: "takeOff" } | { kind: "peck" };

export type ActionRefusal = { intent: PigeonIntent; seat: number | null; tick: number; errorName: string };

export type LiveRound = { roundNumber: number; round: RecordedRound; view: RoundViewState };

export type TableStoreSnapshot = {
  live: LiveRound | null;
  previous: LiveRound | null;
  ownSeat: number | null;
  predicted: readonly PredictedEvent[];
  lastRefusal: ActionRefusal | null;
};

export type TableStore = {
  subscribe: (listener: () => void) => () => void;
  getSnapshot: () => TableStoreSnapshot;
  ingestTable: (snapshot: TableSnapshot) => void;
  ingestSeat: (snapshot: SeatSnapshot) => void;
  advance: () => void;
  horizonTick: () => number;
  chainTick: () => number;
  perform: (intent: PigeonIntent, send: () => Promise<RollupAck>) => Promise<RollupAck>;
};

export type TableStoreOptions = {
  ownWallet: PublicKey | null;
  horizonTicks?: number;
  now?: () => number;
  timing?: RoundTiming;
};

type PendingChange = { slot: number; arrival: number; arrivedAtMs: number } & (
  | { kind: "table"; snapshot: TableSnapshot }
  | { kind: "seat"; snapshot: SeatSnapshot }
);

type RoundState = { roundNumber: number; header: RecordedRound; events: RoundEvent[]; view: RoundViewState };

type Prediction = { event: PredictedEvent; afterTick: number; expiresTick: number; roundNumber: number };

export function describeLivePlayer(seat: number): RoundPlayer {
  const baseName = PIGEON_NAMES[seat % PIGEON_NAMES.length] ?? PIGEON_NAMES[0];
  const repeat = Math.floor(seat / PIGEON_NAMES.length);
  return {
    seat,
    name: repeat === 0 ? baseName : `${baseName} ${repeat + 1}`,
    variant: seat % PIGEON_NAMES.length,
    temperament: LIVE_PLAYER_TEMPERAMENT,
  };
}

function startRound(table: TableSnapshot, timing: RoundTiming): RoundState {
  const header: RecordedRound = {
    version: ROUND_SCHEMA_VERSION,
    seed: 0,
    tickMs: TICK_MS,
    boxCount: table.boxCount,
    timing,
    chipsPerAnte: CHIPS_PER_ANTE,
    players: table.seats.map((_wallet, seat) => describeLivePlayer(seat)),
    events: [],
  };
  return { roundNumber: Number(table.roundNumber), header, events: [], view: createViewState(header) };
}

function hasRoundActivity(table: TableSnapshot): boolean {
  return table.antedSeatIndexes.length > 0 || table.phase.state !== "lobby";
}

function dropVacatedSeats(seats: ReadonlyMap<number, SeatSnapshot>, table: TableSnapshot): ReadonlyMap<number, SeatSnapshot> {
  const isVacated = (seatIndex: number, seat: SeatSnapshot) => table.seats[seatIndex]?.equals(seat.wallet) !== true;
  if (![...seats].some(([seatIndex, seat]) => isVacated(seatIndex, seat))) return seats;
  return new Map([...seats].filter(([seatIndex, seat]) => !isVacated(seatIndex, seat)));
}

function applyChange(frame: ChainFrame, change: PendingChange): ChainFrame {
  const tick = Math.max(frame.tick, change.slot);
  if (change.kind === "table") return { tick, table: change.snapshot, seats: dropVacatedSeats(frame.seats, change.snapshot) };
  const seat = change.snapshot;
  const seats = new Map([...frame.seats].filter(([seatIndex, held]) => seatIndex === seat.seatIndex || !held.address.equals(seat.address)));
  if (seat.seatIndex !== null) seats.set(seat.seatIndex, seat);
  return { tick, table: frame.table, seats };
}

function buildRoundStartFrame(applied: ChainFrame, table: TableSnapshot): ChainFrame {
  const emptyLobby: TableSnapshot = {
    ...table,
    seats: table.seats.map(() => null),
    antedSeatIndexes: [],
    phase: { state: "lobby", firstAnteTick: 0n },
  };
  return { tick: applied.tick, table: emptyLobby, seats: applied.seats };
}

function buildSettledFrame(applied: ChainFrame, next: ChainFrame, roundNumber: number): ChainFrame | null {
  const previousTable = applied.table;
  const table = next.table;
  if (previousTable === null || table === null || previousTable.phase.state !== "live") return null;
  if (!isSettleOf(table, roundNumber)) return null;
  if (!hasRoundActivity(table)) return { tick: next.tick, table, seats: next.seats };
  const nextRoundAntes = new Set(table.antedSeatIndexes);
  const readSeatAtSettle = (seatIndex: number, seat: SeatSnapshot): SeatSnapshot => {
    if (!nextRoundAntes.has(seatIndex)) return seat;
    const roundSeat = applied.seats.get(seatIndex);
    if (roundSeat === undefined || !roundSeat.wallet.equals(seat.wallet)) return seat;
    return { ...roundSeat, slot: seat.slot, chips: seat.chips + BigInt(CHIPS_PER_ANTE) };
  };
  const seatsAtSettle = new Map([...next.seats].map(([seatIndex, seat]) => [seatIndex, readSeatAtSettle(seatIndex, seat)]));
  const settleTick = Math.min(Math.max(Number(previousTable.round.endTick), previousTable.slot, applied.tick), next.tick);
  const settledTable: TableSnapshot = {
    ...previousTable,
    slot: settleTick,
    roundNumber: table.roundNumber,
    antedSeatIndexes: [],
    phase: { state: "lobby", firstAnteTick: 0n },
    lastResult: table.lastResult,
    round: table.phase.state === "live" ? previousTable.round : table.round,
  };
  return { tick: Math.max(applied.tick, settleTick), table: settledTable, seats: seatsAtSettle };
}

function isSettleOf(table: TableSnapshot, roundNumber: number): boolean {
  return table.lastResult !== null && Number(table.lastResult.roundNumber) === roundNumber;
}

function answersPrediction(prediction: Prediction, event: RoundEvent): boolean {
  const seat = prediction.event.seat;
  if (event.tick <= prediction.afterTick) return false;
  if (event.kind === "swatLanded") return event.hits.some((hit) => hit.seat === seat);
  if (!("seat" in event) || event.seat !== seat) return false;
  switch (prediction.event.kind) {
    case "flew":
      return event.kind === "flew";
    case "tookOff":
      return event.kind === "tookOff";
    case "peckStarted":
      return event.kind === "pecked";
  }
}

function predictIntent(view: RoundViewState, intent: PigeonIntent, seat: number, tick: number, timing: RoundTiming): PredictedEvent | null {
  const seatView = view.seats.find((candidate) => candidate.seat === seat);
  if (view.phase !== "live" || seatView === undefined || seatView.role !== "pigeon" || seatView.pigeon.state === "stunned") return null;
  switch (intent.kind) {
    case "flyTo":
      return { tick, kind: "flew", seat, box: intent.box, landsTick: tick + timing.flightTicks };
    case "takeOff":
      return seatView.pigeon.state === "hovering" ? null : { tick, kind: "tookOff", seat };
    case "peck":
      return seatView.pigeon.state === "perched" ? { tick, kind: "peckStarted", seat, box: seatView.pigeon.box } : null;
  }
}

function refuseThrownSend(error: unknown): RollupAck {
  return { ok: false, kind: "client", errorCode: null, errorName: "client", detail: String(error), ackMs: 0 };
}

export function createTableStore(options: TableStoreOptions): TableStore {
  const timing = options.timing ?? LIVE_TIMING;
  const horizonTicks = options.horizonTicks ?? DEFAULT_HORIZON_TICKS;
  const now = options.now ?? (() => performance.now());
  const ownWallet = options.ownWallet;
  const clock = createTickClock();
  const listeners = new Set<() => void>();
  const lastSlotByAccount = new Map<string, number>();
  let pendingChanges: PendingChange[] = [];
  let arrivalCount = 0;
  let applied: ChainFrame = EMPTY_CHAIN_FRAME;
  let roundState: RoundState | null = null;
  let predictions: Prediction[] = [];
  let lastRefusal: ActionRefusal | null = null;
  let previousRound: LiveRound | null = null;
  let publishedLive: { from: RoundState; eventCount: number; live: LiveRound } | null = null;
  let snapshot: TableStoreSnapshot = { live: null, previous: null, ownSeat: null, predicted: [], lastRefusal: null };

  const findOwnSeat = (): number | null => {
    if (ownWallet === null || applied.table === null) return null;
    const seat = applied.table.seats.findIndex((wallet) => wallet !== null && wallet.equals(ownWallet));
    return seat === -1 ? null : seat;
  };

  const toLiveRound = (round: RoundState): LiveRound => {
    if (publishedLive !== null && publishedLive.from === round && publishedLive.eventCount === round.events.length) return publishedLive.live;
    const live: LiveRound = { roundNumber: round.roundNumber, round: { ...round.header, events: [...round.events] }, view: round.view };
    publishedLive = { from: round, eventCount: round.events.length, live };
    return live;
  };

  const publish = () => {
    snapshot = {
      live: roundState === null ? null : toLiveRound(roundState),
      previous: previousRound,
      ownSeat: findOwnSeat(),
      predicted: predictions.map((prediction) => prediction.event),
      lastRefusal,
    };
    for (const listener of listeners) listener();
  };

  const resolvePredictions = (events: readonly RoundEvent[]): boolean => {
    const unanswered = events.reduce((remaining, event) => {
      const answered = remaining.find((prediction) => answersPrediction(prediction, event));
      return answered === undefined ? remaining : remaining.filter((prediction) => prediction !== answered);
    }, predictions);
    const hasChanged = unanswered.length !== predictions.length;
    predictions = unanswered;
    return hasChanged;
  };

  const keepPredictions = (isKept: (prediction: Prediction) => boolean): boolean => {
    if (predictions.length === 0) return false;
    const kept = predictions.filter(isKept);
    const hasChanged = kept.length !== predictions.length;
    predictions = kept;
    return hasChanged;
  };

  const recordStep = (round: RoundState, previous: ChainFrame, next: ChainFrame): boolean => {
    const events = deriveRoundEvents(round.view, previous, next, timing);
    for (const event of events) {
      round.events.push(event);
      round.view = applyRoundEvent(round.view, event);
    }
    applied = next;
    return resolvePredictions(events) || events.length > 0;
  };

  const stepTo = (next: ChainFrame): boolean => {
    const table = next.table;
    if (table === null) {
      applied = next;
      return false;
    }
    if (roundState === null) {
      roundState = startRound(table, timing);
      recordStep(roundState, { tick: applied.tick, table: null, seats: new Map() }, next);
      return true;
    }
    if (Number(table.roundNumber) === roundState.roundNumber) return recordStep(roundState, applied, next);
    const settledFrame = roundState.view.phase === "settled" ? null : buildSettledFrame(applied, next, roundState.roundNumber);
    const hasSettled = settledFrame !== null && recordStep(roundState, applied, settledFrame);
    if (roundState.view.phase === "settled" && !hasRoundActivity(table)) {
      applied = next;
      return hasSettled;
    }
    const nextRound = startRound(table, timing);
    previousRound = toLiveRound(roundState);
    roundState = nextRound;
    recordStep(nextRound, buildRoundStartFrame(applied, table), next);
    return true;
  };

  const advanceClockTo = (horizon: number): boolean => {
    const dueTick = roundState === null ? null : findNextDueTick(roundState.view);
    if (dueTick === null || dueTick > horizon) {
      applied = { ...applied, tick: horizon };
      return false;
    }
    return stepTo({ ...applied, tick: horizon });
  };

  const findSettleHoldTick = (): number | null => {
    const round = roundState;
    const endTick = round?.view.endTick ?? null;
    if (round === null || round.view.phase !== "live" || endTick === null) return null;
    const afterEnd = pendingChanges.filter((change) => change.slot >= endTick);
    if (afterEnd.length === 0) return null;
    if (now() - Math.min(...afterEnd.map((change) => change.arrivedAtMs)) >= SETTLE_WAIT_MS) return null;
    const settle = afterEnd.find((change) => change.kind === "table" && isSettleOf(change.snapshot, round.roundNumber));
    if (settle === undefined) return endTick;
    const hasSeatAtSettle = (seatIndex: number) =>
      (applied.seats.get(seatIndex)?.slot ?? -1) >= settle.slot ||
      afterEnd.some((change) => change.kind === "seat" && change.snapshot.seatIndex === seatIndex && change.slot >= settle.slot);
    const pigeonSeats = round.view.seats.filter((seat) => seat.role === "pigeon" && seat.presence === "anted");
    return pigeonSeats.every((seat) => hasSeatAtSettle(seat.seat)) ? null : endTick;
  };

  const applyDueChanges = (horizon: number): boolean => {
    if (pendingChanges.length === 0) return false;
    const dueChanges = pendingChanges
      .filter((change) => change.slot <= horizon)
      .sort((left, right) => left.slot - right.slot || left.arrival - right.arrival);
    if (dueChanges.length === 0) return false;
    pendingChanges = pendingChanges.filter((change) => change.slot > horizon);
    let hasChanged = false;
    let frame = applied;
    dueChanges.forEach((change, index) => {
      frame = applyChange(frame, change);
      if (dueChanges[index + 1]?.slot === change.slot) return;
      hasChanged = stepTo(frame) || hasChanged;
      frame = applied;
    });
    return hasChanged;
  };

  const advance = () => {
    const chainTick = clock.estimate(now());
    const horizon = Math.max(applied.tick, chainTick - horizonTicks);
    const settleHoldTick = findSettleHoldTick();
    const releaseTick = settleHoldTick === null ? horizon : Math.min(horizon, settleHoldTick - 1);
    let hasChanged = applyDueChanges(releaseTick);
    if (releaseTick > applied.tick) hasChanged = advanceClockTo(releaseTick) || hasChanged;
    const liveRoundNumber = roundState?.view.phase === "live" ? roundState.roundNumber : null;
    hasChanged = keepPredictions((prediction) => prediction.roundNumber === liveRoundNumber && prediction.expiresTick >= chainTick) || hasChanged;
    if (hasChanged) publish();
  };

  const restartFromChain = () => {
    console.warn("[createTableStore] the rollup slots went backwards, starting over from the restarted chain");
    lastSlotByAccount.clear();
    pendingChanges = [];
    applied = EMPTY_CHAIN_FRAME;
    roundState = null;
    previousRound = null;
    predictions = [];
    clock.reset();
  };

  const ingest = (accountKey: string, change: PendingChange) => {
    const lastSlot = lastSlotByAccount.get(accountKey);
    if (lastSlot !== undefined && change.slot < lastSlot) {
      if (lastSlot - change.slot <= SLOT_REGRESSION_SLOTS) return;
      restartFromChain();
    }
    lastSlotByAccount.set(accountKey, change.slot);
    clock.observe(change.slot, now());
    pendingChanges.push(change);
    advance();
  };

  const perform = async (intent: PigeonIntent, send: () => Promise<RollupAck>): Promise<RollupAck> => {
    const seat = findOwnSeat();
    const chainTick = clock.estimate(now());
    const round = roundState;
    const predictedEvent = seat === null || round === null ? null : predictIntent(round.view, intent, seat, chainTick, timing);
    const prediction: Prediction | null =
      predictedEvent === null || round === null
        ? null
        : { event: predictedEvent, afterTick: applied.tick, expiresTick: chainTick + PREDICTION_TIMEOUT_TICKS, roundNumber: round.roundNumber };
    if (prediction !== null) {
      predictions = [...predictions, prediction];
      publish();
    }
    const ack = await send().catch(refuseThrownSend);
    if (!ack.ok) {
      predictions = predictions.filter((candidate) => candidate !== prediction);
      lastRefusal = { intent, seat, tick: chainTick, errorName: ack.errorName };
      publish();
    }
    return ack;
  };

  return {
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    getSnapshot: () => snapshot,
    ingestTable: (table) => {
      arrivalCount += 1;
      ingest(table.address.toBase58(), { kind: "table", snapshot: table, slot: table.slot, arrival: arrivalCount, arrivedAtMs: now() });
    },
    ingestSeat: (seat) => {
      arrivalCount += 1;
      ingest(seat.address.toBase58(), { kind: "seat", snapshot: seat, slot: seat.slot, arrival: arrivalCount, arrivedAtMs: now() });
    },
    advance,
    horizonTick: () => applied.tick,
    chainTick: () => clock.estimate(now()),
    perform,
  };
}
