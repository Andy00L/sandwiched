import type { PublicKey } from "@solana/web3.js";
import type { TableSnapshot } from "../chain/accounts";
import type { RollupAck } from "../chain/transport";
import { type ClickTarget, type PlayerIntent, intentForClick } from "./click-intent";
import { type Crank, chooseCrank, describeCrank } from "./cranks";
import { type GuestChain, type GuestNeeds, type GuestStage, prepareGuest } from "./guest-steps";
import type { RoundTiming } from "./round-events";
import type { PigeonIntent, TableStore } from "./table-store";

const DECIDE_INTERVAL_MS = 250;
const CRANK_RETRY_MS = 3_000;
const GUEST_MAX_ATTEMPTS_PER_STEP = 6;
const GUEST_RETRY_DELAY_MS = 1_500;
const GUEST_SETTLE_DELAY_MS = 1_200;

export type PlayerActions = {
  ante: () => Promise<RollupAck>;
  flyTo: (boxIndex: number) => Promise<RollupAck>;
  takeOff: () => Promise<RollupAck>;
  peck: () => Promise<RollupAck>;
  raiseHand: (boxIndex: number) => Promise<RollupAck>;
  startRound: () => Promise<RollupAck>;
  landSwat: (seats: PublicKey[]) => Promise<RollupAck>;
  settle: (seats: PublicKey[]) => Promise<RollupAck>;
};

export type TablePlayerPorts = {
  store: TableStore;
  actions: PlayerActions;
  guest: GuestChain;
  needs: GuestNeeds;
  wallet: PublicKey;
  timing: RoundTiming;
  readTable: () => TableSnapshot | null;
  onStage: (stage: GuestStage) => void;
};

export type TablePlayer = { click: (target: ClickTarget) => void; perform: (intent: PlayerIntent) => void; stop: () => void };

const wait = (milliseconds: number) => new Promise<void>((resolve) => setTimeout(resolve, milliseconds));

function sendIntent(actions: PlayerActions, intent: PigeonIntent): Promise<RollupAck> {
  switch (intent.kind) {
    case "flyTo":
      return actions.flyTo(intent.box);
    case "takeOff":
      return actions.takeOff();
    case "peck":
      return actions.peck();
  }
}

function sendCrank(actions: PlayerActions, crank: Crank): Promise<RollupAck> {
  switch (crank.kind) {
    case "startRound":
      return actions.startRound();
    case "settle":
      return actions.settle(crank.seats);
    case "landSwat":
      return actions.landSwat(crank.seats);
  }
}

export function findOwnSeatIndex(table: TableSnapshot, wallet: PublicKey): number | null {
  const seatIndex = table.seats.findIndex((seated) => seated?.equals(wallet) === true);
  return seatIndex === -1 ? null : seatIndex;
}

export function startTablePlayer(ports: TablePlayerPorts): TablePlayer {
  const { store, actions, timing } = ports;
  const crankSentAtMs = new Map<string, number>();
  let stage: GuestStage = { kind: "preparing", step: "sit", attempt: 0 };
  let antedRound: bigint | null = null;
  let isStopped = false;
  let isDeciding = false;

  const report = (label: string, ack: RollupAck) => {
    if (!ack.ok) console.warn(`[startTablePlayer] ${label} refused: ${ack.errorName} ${ack.detail}`);
  };

  const anteWhenDue = async (table: TableSnapshot) => {
    if (table.phase.state !== "lobby" || antedRound === table.roundNumber) return;
    const seatIndex = findOwnSeatIndex(table, ports.wallet);
    if (seatIndex === null || table.antedSeatIndexes.includes(seatIndex)) return;
    antedRound = table.roundNumber;
    const ack = await actions.ante();
    report("ante", ack);
    if (!ack.ok) setTimeout(() => (antedRound = null), CRANK_RETRY_MS);
  };

  const crankWhenDue = async (table: TableSnapshot) => {
    const crank = chooseCrank(table, store.chainTick(), timing);
    if (crank === null) return;
    const key = describeCrank(crank);
    const sentAtMs = crankSentAtMs.get(key);
    if (sentAtMs !== undefined && performance.now() - sentAtMs < CRANK_RETRY_MS) return;
    crankSentAtMs.set(key, performance.now());
    if (crankSentAtMs.size > 64) crankSentAtMs.delete(crankSentAtMs.keys().next().value ?? key);
    report(key, await sendCrank(actions, crank));
  };

  const decide = async () => {
    const table = ports.readTable();
    if (isDeciding || isStopped || stage.kind !== "ready" || table === null) return;
    isDeciding = true;
    await anteWhenDue(table);
    await crankWhenDue(table);
    isDeciding = false;
  };

  const decideTimer = setInterval(() => void decide(), DECIDE_INTERVAL_MS);
  void prepareGuest(ports.guest, {
    needs: ports.needs,
    maxAttemptsPerStep: GUEST_MAX_ATTEMPTS_PER_STEP,
    retryDelayMs: GUEST_RETRY_DELAY_MS,
    settleDelayMs: GUEST_SETTLE_DELAY_MS,
    onStage: (next) => {
      stage = next;
      ports.onStage(next);
    },
    wait,
    isStopped: () => isStopped,
  });

  const perform = (intent: PlayerIntent) => {
    if (stage.kind !== "ready") return;
    if (intent.actor === "whale") {
      void actions.raiseHand(intent.box).then((ack) => report("raiseHand", ack));
      return;
    }
    void store.perform(intent.intent, () => sendIntent(actions, intent.intent)).then((ack) => report(intent.intent.kind, ack));
  };

  const click = (target: ClickTarget) => {
    const snapshot = store.getSnapshot();
    if (snapshot.live === null) return;
    const intent = intentForClick(snapshot.live.view, snapshot.ownSeat, target);
    if (intent !== null) perform(intent);
  };

  return {
    click,
    perform,
    stop: () => {
      isStopped = true;
      clearInterval(decideTimer);
    },
  };
}
