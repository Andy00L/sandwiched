import type { PublicKey } from "@solana/web3.js";
import type { AccountFeed } from "../chain/account-feed";
import { watchSeat, watchTable } from "../chain/accounts";
import { findSeatAddress } from "../chain/addresses";
import type { SandwichProgram } from "../chain/program";
import type { TableStore } from "./table-store";

const ADVANCE_INTERVAL_MS = 20;

export type LiveTableSource = { feed: AccountFeed; program: SandwichProgram; table: PublicKey };

export function connectTableStore(store: TableStore, source: LiveTableSource): () => void {
  const stopWatchingSeats = new Map<string, () => void>();
  const reportError = (reason: string) => console.warn(`[connectTableStore] ${reason}`);
  const stopWatchingTable = watchTable(source.feed, source.program, source.table, {
    onSnapshot: (table) => {
      store.ingestTable(table);
      for (const wallet of table.seats) {
        if (wallet === null || stopWatchingSeats.has(wallet.toBase58())) continue;
        const seatAddress = findSeatAddress(source.table, wallet);
        stopWatchingSeats.set(
          wallet.toBase58(),
          watchSeat(source.feed, source.program, seatAddress, { onSnapshot: store.ingestSeat, onError: reportError }),
        );
      }
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
