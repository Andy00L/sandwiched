import type { PublicKey } from "@solana/web3.js";
import type { SeatSnapshot, TableSnapshot } from "../chain/accounts";
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
import { EMPTY_CHAIN_FRAME, deriveRoundEvents, mergeChainFrames, type ChainFrame } from "./snapshot-diff";
import { createTickClock } from "./tick-clock";
import { applyRoundEvent, createViewState, type RoundViewState } from "./view-state";

const DEFAULT_HORIZON_TICKS = 10;
const PREDICTION_TIMEOUT_TICKS = 150;
const PIGEON_NAMES = ["Gary", "Linda", "Doug", "Brenda", "Keith", "Sheila"] as const;
const LIVE_PLAYER_TEMPERAMENT: Temperament = "greedy";

export type PeckStartedEvent = { tick: number; kind: "peckStarted"; seat: number; box: number };

export type PredictedEvent = FlewEvent | TookOffEvent | PeckStartedEvent;

export type PigeonIntent = { kind: "flyTo"; box: number } | { kind: "takeOff" } | { kind: "peck" };

export type ActionRefusal = { intent: PigeonIntent; seat: number | null; tick: number; errorName: string };

export type LiveRound = { roundNumber: number; round: RecordedRound; view: RoundViewState };

export type TableStoreSnapshot = {
  live: LiveRound | null;
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

type PendingChange = { slot: number; arrival: number } & (
  | { kind: "table"; snapshot: TableSnapshot }
  | { kind: "seat"; snapshot: SeatSnapshot }
);

type RoundState = { roundNumber: number; header: RecordedRound; events: RoundEvent[]; view: RoundViewState };

type Prediction = { event: PredictedEvent; afterTick: number; expiresTick: number };

function describeLivePlayer(seat: number): RoundPlayer {
  const baseName = PIGEON_NAMES[seat % PIGEON_NAMES.length] ?? PIGEON_NAMES[0];
  const repeat = Math.floor(seat / PIGEON_NAMES.length);
  return {
    seat,
    name: repeat === 0 ? baseName : `${baseName} ${repeat + 1}`,
    variant: seat % PIGEON_NAMES.length,
    temperament: LIVE_PLAYER_TEMPERAMENT,
  };
}

function listSeatedSeats(table: TableSnapshot): number[] {
  return table.seats.flatMap((wallet, seat) => (wallet === null ? [] : [seat]));
}

function startRound(table: TableSnapshot, timing: RoundTiming, seatedSeats: readonly number[], tick: number): RoundState {
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
  const events = seatedSeats.map((seat): RoundEvent => ({ tick, kind: "seatJoined", seat }));
  return { roundNumber: Number(table.roundNumber), header, events, view: events.reduce(applyRoundEvent, createViewState(header)) };
}

function applyChange(frame: ChainFrame, change: PendingChange): ChainFrame {
  const tick = Math.max(frame.tick, change.slot);
  if (change.kind === "table") return { tick, table: change.snapshot, seats: frame.seats };
  const seatIndex = change.snapshot.seatIndex;
  if (seatIndex === null) return { ...frame, tick };
  return { tick, table: frame.table, seats: new Map(frame.seats).set(seatIndex, change.snapshot) };
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
  let snapshot: TableStoreSnapshot = { live: null, ownSeat: null, predicted: [], lastRefusal: null };

  const findOwnSeat = (): number | null => {
    if (ownWallet === null || applied.table === null) return null;
    const seat = applied.table.seats.findIndex((wallet) => wallet !== null && wallet.equals(ownWallet));
    return seat === -1 ? null : seat;
  };

  const publish = () => {
    snapshot = {
      live:
        roundState === null
          ? null
          : { roundNumber: roundState.roundNumber, round: { ...roundState.header, events: [...roundState.events] }, view: roundState.view },
      ownSeat: findOwnSeat(),
      predicted: predictions.map((prediction) => prediction.event),
      lastRefusal,
    };
    for (const listener of listeners) listener();
  };

  const recordEvents = (events: readonly RoundEvent[], table: TableSnapshot) => {
    for (const event of events) {
      if (roundState === null) return;
      if (event.kind === "anted" && roundState.view.phase === "settled") {
        roundState = startRound(table, timing, listSeatedSeats(table), event.tick);
      }
      roundState.events.push(event);
      roundState.view = applyRoundEvent(roundState.view, event);
    }
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

  const expirePredictions = (chainTick: number): boolean => {
    const unexpired = predictions.filter((prediction) => prediction.expiresTick >= chainTick);
    const hasChanged = unexpired.length !== predictions.length;
    predictions = unexpired;
    return hasChanged;
  };

  const stepTo = (next: ChainFrame): boolean => {
    const merged = mergeChainFrames(applied, next);
    const table = merged.table;
    if (table === null) {
      applied = merged;
      return false;
    }
    const isFirstSight = roundState === null;
    const previous: ChainFrame = isFirstSight ? { tick: applied.tick, table: null, seats: new Map() } : applied;
    const currentRound = roundState ?? startRound(table, timing, [], table.slot);
    roundState = currentRound;
    const events = deriveRoundEvents(currentRound.view, previous, merged, timing);
    recordEvents(events, table);
    const wasCancelled = roundState.roundNumber !== Number(table.roundNumber) && roundState.view.phase !== "settled";
    if (wasCancelled) roundState = startRound(table, timing, listSeatedSeats(table), merged.tick);
    applied = merged;
    const hasResolved = resolvePredictions(events);
    return isFirstSight || wasCancelled || hasResolved || events.length > 0;
  };

  const advance = () => {
    const chainTick = clock.estimate(now());
    const horizon = Math.max(applied.tick, chainTick - horizonTicks);
    const dueChanges = pendingChanges
      .filter((change) => change.slot <= horizon)
      .sort((left, right) => left.slot - right.slot || left.arrival - right.arrival);
    pendingChanges = pendingChanges.filter((change) => change.slot > horizon);
    let hasChanged = false;
    for (const change of dueChanges) hasChanged = stepTo(applyChange(applied, change)) || hasChanged;
    if (horizon > applied.tick) hasChanged = stepTo({ ...applied, tick: horizon }) || hasChanged;
    hasChanged = expirePredictions(chainTick) || hasChanged;
    if (hasChanged) publish();
  };

  const ingest = (accountKey: string, change: PendingChange) => {
    const lastSlot = lastSlotByAccount.get(accountKey);
    if (lastSlot !== undefined && change.slot < lastSlot) return;
    lastSlotByAccount.set(accountKey, change.slot);
    clock.observe(change.slot, now());
    pendingChanges.push(change);
    advance();
  };

  const perform = async (intent: PigeonIntent, send: () => Promise<RollupAck>): Promise<RollupAck> => {
    const seat = findOwnSeat();
    const chainTick = clock.estimate(now());
    const predictedEvent = seat === null || roundState === null ? null : predictIntent(roundState.view, intent, seat, chainTick, timing);
    const prediction: Prediction | null =
      predictedEvent === null ? null : { event: predictedEvent, afterTick: applied.tick, expiresTick: chainTick + PREDICTION_TIMEOUT_TICKS };
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
      ingest(table.address.toBase58(), { kind: "table", snapshot: table, slot: table.slot, arrival: arrivalCount });
    },
    ingestSeat: (seat) => {
      arrivalCount += 1;
      ingest(seat.address.toBase58(), { kind: "seat", snapshot: seat, slot: seat.slot, arrival: arrivalCount });
    },
    advance,
    horizonTick: () => applied.tick,
    chainTick: () => clock.estimate(now()),
    perform,
  };
}
