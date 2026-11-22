import { type Keypair, PublicKey } from "@solana/web3.js";
import { type AccountFeed, createAccountFeed } from "../chain/account-feed";
import { type TableSnapshot, fetchTable, watchSeat, watchTable } from "../chain/accounts";
import { findSeatAddress } from "../chain/addresses";
import { type ChainClient, createChainClient, createSponsoredFeePayment } from "../chain/client";
import { ROLLUP_RPC_URL, ROLLUP_WS_URL, SPONSOR_ROUTE_PATH } from "../chain/config";
import type { KeyStore } from "../chain/key-store";
import { type SandwichProgram, createChainPrograms } from "../chain/program";
import { type Result, attemptSync, failure, success } from "../chain/result";
import { createRpcConnection } from "../chain/rpc";
import { type FeePayment, createKeypairSigner } from "../chain/transport";
import { LIVE_TIMING } from "./chain-rules";
import { type ActionSigner, createGuestPlayChain } from "./guest-chain";
import type { GuestStage } from "./guest-steps";
import type { RecordedRound } from "./round-events";
import { type RoundSource, waitForLiveRoundSource } from "./round-source";
import { type TablePlayer, startTablePlayer } from "./table-player";
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
  wallet: Keypair;
  feed: AccountFeed;
  signsWith: ActionSigner;
  isCranking: boolean;
  onStage: (stage: GuestStage) => void;
};

export type GuestSeat = { store: TableStore; player: TablePlayer; guest: PublicKey; client: ChainClient; tableSnapshot: TableSnapshot; close: () => void };

export async function seatGuest(setup: GuestSeatSetup): Promise<Result<GuestSeat>> {
  const { table, feed } = setup;
  const client = createChainClient(setup.feePayment);
  const program = client.programs.sandwich;
  const tableSnapshot = await fetchTable(program, client.rollup, table);
  if (!tableSnapshot.ok) return failure(`[seatGuest] ${tableSnapshot.reason}`);
  if (tableSnapshot.value === null) return failure(`[seatGuest] no table at ${table.toBase58()} on the rollup`);
  const wallet = createKeypairSigner(setup.wallet);
  const store = createTableStore({ ownWallet: wallet.publicKey });
  let latestTable: TableSnapshot = tableSnapshot.value;
  const stopFeed = connectTableStore(store, { feed, program, table }, (snapshot) => (latestTable = snapshot));
  const play = createGuestPlayChain({ client, wallet, table, tableSnapshot: tableSnapshot.value, keyStore: setup.keyStore, signsWith: setup.signsWith });
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
  });
  const close = () => {
    player.stop();
    stopFeed();
  };
  return success({ store, player, guest: wallet.publicKey, client, tableSnapshot: tableSnapshot.value, close });
}

export type LivePlay = { source: RoundSource; player: TablePlayer; guest: PublicKey; close: () => void };

export type CompanionSeat = { table: PublicKey; feed: AccountFeed; keyStore: KeyStore; guest: PublicKey };

export type LivePlaySetup = {
  table: PublicKey;
  keyStore: KeyStore;
  guestKey: Keypair;
  timeoutMs: number;
  onStage: (stage: GuestStage) => void;
  startCompanions: ((seat: CompanionSeat) => () => void) | null;
};

export async function openLivePlay(setup: LivePlaySetup): Promise<Result<LivePlay>> {
  const feePayment = await createSponsoredFeePayment(SPONSOR_ROUTE_PATH);
  if (!feePayment.ok) return failure(`[openLivePlay] ${feePayment.reason}`);
  const feed = createAccountFeed({ rpcUrl: ROLLUP_RPC_URL, wsUrl: ROLLUP_WS_URL });
  const seated = await seatGuest({
    table: setup.table,
    feePayment: feePayment.value,
    keyStore: setup.keyStore,
    wallet: setup.guestKey,
    feed,
    signsWith: "session",
    isCranking: true,
    onStage: setup.onStage,
  });
  if (!seated.ok) {
    feed.close();
    return seated;
  }
  const stopCompanions = setup.startCompanions?.({ table: setup.table, feed, keyStore: setup.keyStore, guest: seated.value.guest }) ?? (() => undefined);
  const close = () => {
    stopCompanions();
    seated.value.close();
    feed.close();
  };
  reportSettledRounds(seated.value.store);
  const source = await waitForLiveRoundSource(seated.value.store, setup.timeoutMs);
  if (source.ok) return success({ source: source.value, player: seated.value.player, guest: seated.value.guest, close });
  close();
  return source;
}
