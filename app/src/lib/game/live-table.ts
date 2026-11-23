import { PublicKey } from "@solana/web3.js";
import { type AccountFeed, createAccountFeed } from "../chain/account-feed";
import { type TableSnapshot, fetchTable, watchSeat, watchTable } from "../chain/accounts";
import { findSeatAddress } from "../chain/addresses";
import { type ChainClient, createChainClient, createSponsoredFeePayment } from "../chain/client";
import { ROLLUP_RPC_URL, ROLLUP_WS_URL, SPONSOR_ROUTE_PATH } from "../chain/config";
import type { KeyStore } from "../chain/key-store";
import { type SandwichProgram, createChainPrograms } from "../chain/program";
import { type Result, attemptSync, failure, success } from "../chain/result";
import { createRpcConnection } from "../chain/rpc";
import { type FeePayment, type TransactionSigner, sendOnRollupOnExit } from "../chain/transport";
import { LIVE_TIMING } from "./chain-rules";
import type { PreparedLeave } from "../chain/player";
import { type ActionSigner, type CashOutReceipt, createGuestPlayChain } from "./guest-chain";
import type { GuestStage } from "./guest-steps";
import type { RecordedRound } from "./round-events";
import { type RoundSource, waitForLiveRoundSource } from "./round-source";
import { type AntePolicy, type TablePlayer, startTablePlayer } from "./table-player";
import { type LiveRound, type TableStore, createTableStore } from "./table-store";

const ADVANCE_INTERVAL_MS = 20;

export type LiveTableSource = { feed: AccountFeed; program: SandwichProgram; table: PublicKey };

export function connectTableStore(store: TableStore, source: LiveTableSource, onTable?: (table: TableSnapshot) => void): () => void {
  const stopWatchingSeats = new Map<string, () => void>();
  const reportError = (reason: string) => console.warn(`[connectTableStore] ${reason}`);
  const syncSeatWatchers = (seatedWallets: readonly (PublicKey | null)[]) => {
    const seated = new Map(seatedWallets.flatMap((wallet) => (wallet === null ? [] : [[wallet.toBase58(), wallet] as const])));
    for (const [walletKey, stopWatchingSeat] of stopWatchingSeats) {
      if (seated.has(walletKey)) continue;
      stopWatchingSeat();
      stopWatchingSeats.delete(walletKey);
    }
    for (const [walletKey, wallet] of seated) {
      if (stopWatchingSeats.has(walletKey)) continue;
      const seatAddress = findSeatAddress(source.table, wallet);
      stopWatchingSeats.set(walletKey, watchSeat(source.feed, source.program, seatAddress, { onSnapshot: store.ingestSeat, onError: reportError }));
    }
  };
  const stopWatchingTable = watchTable(source.feed, source.program, source.table, {
    onSnapshot: (table) => {
      store.ingestTable(table);
      syncSeatWatchers(table.seats);
      onTable?.(table);
    },
    onError: reportError,
  });
  const advanceTimer = setInterval(store.advance, ADVANCE_INTERVAL_MS);
  return () => {
    clearInterval(advanceTimer);
    stopWatchingTable();
    for (const stopWatchingSeat of stopWatchingSeats.values()) stopWatchingSeat();
    stopWatchingSeats.clear();
  };
}

export function describeSettledRound(round: RecordedRound): string | null {
  const settle = round.events.findLast((event) => event.kind === "settled");
  const draw = round.events.find((event) => event.kind === "whaleDrawn");
  if (settle?.kind !== "settled" || draw?.kind !== "whaleDrawn") return null;
  const swatNumbers = round.events.flatMap((event) => (event.kind === "handRaised" ? [event.swatNumber] : []));
  return JSON.stringify({
    whaleSeat: draw.whaleSeat,
    sandwichBox: draw.sandwichBox,
    endTick: draw.endTick,
    swatNumbers,
    whaleCrumbs: settle.whaleCrumbs,
    pigeonCrumbs: settle.pigeonCrumbs,
    beaks: settle.beaks,
  });
}

export function reportSettledRounds(store: TableStore): void {
  const reported = new Set<number>();
  const report = (live: LiveRound | null) => {
    if (live === null || reported.has(live.roundNumber)) return;
    const summary = describeSettledRound(live.round);
    if (summary === null) return;
    reported.add(live.roundNumber);
    console.info(`[reportSettledRounds] round ${live.roundNumber} settled: ${summary}`);
  };
  store.subscribe(() => {
    const snapshot = store.getSnapshot();
    report(snapshot.previous);
    report(snapshot.live);
  });
}

export const parseTableAddress = (tableAddressText: string): Result<PublicKey> => {
  const table = attemptSync(() => new PublicKey(tableAddressText));
  return table.ok ? table : failure(`not a table address: ${tableAddressText}`);
};

export async function openLiveRoundSource(tableAddressText: string, timeoutMs: number): Promise<Result<RoundSource>> {
  const table = parseTableAddress(tableAddressText);
  if (!table.ok) return failure(`[openLiveRoundSource] ${table.reason}`);
  const feed = createAccountFeed({ rpcUrl: ROLLUP_RPC_URL, wsUrl: ROLLUP_WS_URL });
  const program = createChainPrograms(createRpcConnection(ROLLUP_RPC_URL, { commitment: "processed" })).sandwich;
  const store = createTableStore({ ownWallet: null });
  reportSettledRounds(store);
  const stop = connectTableStore(store, { feed, program, table: table.value });
  const source = await waitForLiveRoundSource(store, timeoutMs);
  if (!source.ok) {
    stop();
    feed.close();
  }
  return source;
}

export type GuestSeatSetup = {
  table: PublicKey;
  feePayment: FeePayment;
  keyStore: KeyStore;
  wallet: TransactionSigner;
  feed: AccountFeed;
  signsWith: ActionSigner;
  buyInChips: bigint;
  isCranking: boolean;
  antePolicy: AntePolicy;
  onStage: (stage: GuestStage) => void;
};

export type GuestSeat = {
  store: TableStore;
  player: TablePlayer;
  guest: PublicKey;
  client: ChainClient;
  tableSnapshot: TableSnapshot;
  cashOut: () => Promise<Result<CashOutReceipt>>;
  prepareLeave: () => Promise<Result<PreparedLeave>>;
  close: () => void;
};

export async function seatGuest(setup: GuestSeatSetup): Promise<Result<GuestSeat>> {
  const { table, feed } = setup;
  const client = createChainClient(setup.feePayment);
  const program = client.programs.sandwich;
  const tableSnapshot = await fetchTable(program, client.rollup, table);
  if (!tableSnapshot.ok) return failure(`[seatGuest] ${tableSnapshot.reason}`);
  if (tableSnapshot.value === null) return failure(`[seatGuest] no table at ${table.toBase58()} on the rollup`);
  const { wallet } = setup;
  const store = createTableStore({ ownWallet: wallet.publicKey });
  let latestTable: TableSnapshot = tableSnapshot.value;
  const stopFeed = connectTableStore(store, { feed, program, table }, (snapshot) => (latestTable = snapshot));
  const play = createGuestPlayChain({ client, wallet, table, tableSnapshot: tableSnapshot.value, keyStore: setup.keyStore, signsWith: setup.signsWith, buyInChips: setup.buyInChips });
  const player = startTablePlayer({
    store,
    actions: play.actions,
    guest: play.guest,
    needs: play.needs,
    wallet: wallet.publicKey,
    timing: LIVE_TIMING,
    readTable: () => latestTable,
    onStage: setup.onStage,
    isCranking: setup.isCranking,
    antePolicy: setup.antePolicy,
  });
  const close = () => {
    player.stop();
    stopFeed();
  };
  return success({ store, player, guest: wallet.publicKey, client, tableSnapshot: tableSnapshot.value, cashOut: play.cashOut, prepareLeave: play.prepareLeave, close });
}

export type LivePlay = {
  source: RoundSource;
  store: TableStore;
  player: TablePlayer;
  guest: PublicKey;
  tableSnapshot: TableSnapshot;
  cashOut: () => Promise<Result<CashOutReceipt>>;
  close: () => void;
};

export type CompanionSeat = { table: PublicKey; feed: AccountFeed; keyStore: KeyStore; guest: PublicKey };

export type LivePlaySetup = {
  table: PublicKey;
  keyStore: KeyStore;
  wallet: TransactionSigner;
  timeoutMs: number;
  buyInChips: bigint;
  antePolicy: AntePolicy;
  onStage: (stage: GuestStage) => void;
  startCompanions: ((seat: CompanionSeat) => () => void) | null;
};

const EXIT_LEAVE_REFRESH_MS = 5_000;

function armLeaveOnExit(client: ChainClient, prepareLeave: () => Promise<Result<PreparedLeave>>): () => void {
  let prepared: PreparedLeave | null = null;
  const refresh = async () => {
    const next = await prepareLeave();
    if (next.ok) prepared = next.value;
    else console.warn(`[armLeaveOnExit] ${next.reason}`);
  };
  const leaveOnExit = () => {
    if (prepared !== null) sendOnRollupOnExit(client.rollupUrl, client.rollupBlockhashes, prepared.instructions, prepared.signer);
  };
  void refresh();
  const refreshTimer = setInterval(() => void refresh(), EXIT_LEAVE_REFRESH_MS);
  window.addEventListener("pagehide", leaveOnExit);
  return () => {
    clearInterval(refreshTimer);
    window.removeEventListener("pagehide", leaveOnExit);
  };
}

export async function openLivePlay(setup: LivePlaySetup): Promise<Result<LivePlay>> {
  const feePayment = await createSponsoredFeePayment(SPONSOR_ROUTE_PATH);
  if (!feePayment.ok) return failure(`[openLivePlay] ${feePayment.reason}`);
  const feed = createAccountFeed({ rpcUrl: ROLLUP_RPC_URL, wsUrl: ROLLUP_WS_URL });
  let disarmLeave: (() => void) | null = null;
  let armOnReady: (() => void) | null = null;
  let isReady = false;
  const seated = await seatGuest({
    table: setup.table,
    feePayment: feePayment.value,
    keyStore: setup.keyStore,
    wallet: setup.wallet,
    feed,
    signsWith: "session",
    buyInChips: setup.buyInChips,
    isCranking: true,
    antePolicy: setup.antePolicy,
    onStage: (stage) => {
      if (stage.kind === "ready") {
        isReady = true;
        armOnReady?.();
      }
      setup.onStage(stage);
    },
  });
  if (!seated.ok) {
    feed.close();
    return seated;
  }
  const seat = seated.value;
  armOnReady = () => {
    disarmLeave ??= armLeaveOnExit(seat.client, seat.prepareLeave);
  };
  if (isReady) armOnReady();
  const stopCompanions = setup.startCompanions?.({ table: setup.table, feed, keyStore: setup.keyStore, guest: seated.value.guest }) ?? (() => undefined);
  const close = () => {
    disarmLeave?.();
    stopCompanions();
    seated.value.close();
    feed.close();
  };
  reportSettledRounds(seated.value.store);
  const source = await waitForLiveRoundSource(seated.value.store, setup.timeoutMs);
  if (source.ok) {
    const { store, player, guest, tableSnapshot, cashOut } = seated.value;
    return success({ source: source.value, store, player, guest, tableSnapshot, cashOut, close });
  }
  close();
  return source;
}
