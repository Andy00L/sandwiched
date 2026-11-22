import { PublicKey } from "@solana/web3.js";
import { type AccountFeed, createAccountFeed } from "../chain/account-feed";
import { watchSeat, watchTable } from "../chain/accounts";
import { findSeatAddress } from "../chain/addresses";
import { ROLLUP_RPC_URL, ROLLUP_WS_URL } from "../chain/config";
import { type SandwichProgram, createChainPrograms } from "../chain/program";
import { type Result, attemptSync, failure } from "../chain/result";
import { createRpcConnection } from "../chain/rpc";
import type { RecordedRound } from "./round-events";
import { type RoundSource, waitForLiveRoundSource } from "./round-source";
import { type LiveRound, type TableStore, createTableStore } from "./table-store";

const ADVANCE_INTERVAL_MS = 20;

export type LiveTableSource = { feed: AccountFeed; program: SandwichProgram; table: PublicKey };

export function connectTableStore(store: TableStore, source: LiveTableSource): () => void {
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

function reportSettledRounds(store: TableStore): void {
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

export async function openLiveRoundSource(tableAddressText: string, timeoutMs: number): Promise<Result<RoundSource>> {
  const table = attemptSync(() => new PublicKey(tableAddressText));
  if (!table.ok) return failure(`[openLiveRoundSource] not a table address: ${tableAddressText}`);
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
