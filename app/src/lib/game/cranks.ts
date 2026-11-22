import type { PublicKey } from "@solana/web3.js";
import type { TableSnapshot } from "../chain/accounts";
import { findSeatAddress } from "../chain/addresses";
import { MIN_PLAYERS } from "./chain-rules";
import type { RoundTiming } from "./round-events";

export const EVICT_AFTER_ROUNDS_SAT_OUT = 2;
export const EVICT_WHEN_FREE_SEATS = 2;

export type Crank =
  | { kind: "startRound"; roundNumber: bigint }
  | { kind: "settle"; roundNumber: bigint; seats: PublicKey[] }
  | { kind: "landSwat"; roundNumber: bigint; swatNumber: bigint; seats: PublicKey[] }
  | { kind: "evictSeat"; roundNumber: bigint; wallet: PublicKey };

export type RoundsSatOut = { countedRound: bigint | null; byWallet: ReadonlyMap<string, number> };

export const NO_ROUNDS_SAT_OUT: RoundsSatOut = { countedRound: null, byWallet: new Map() };

export function describeCrank(crank: Crank): string {
  switch (crank.kind) {
    case "landSwat":
      return `landSwat:${crank.roundNumber}:${crank.swatNumber}`;
    case "evictSeat":
      return `evictSeat:${crank.roundNumber}:${crank.wallet.toBase58()}`;
    default:
      return `${crank.kind}:${crank.roundNumber}`;
  }
}

function listAntedSeatAddresses(table: TableSnapshot): PublicKey[] {
  return table.antedSeatIndexes.flatMap((seatIndex) => {
    const wallet = table.seats[seatIndex];
    return wallet ? [findSeatAddress(table.address, wallet)] : [];
  });
}

function listSeatsSittingOut(table: TableSnapshot): PublicKey[] {
  return table.seats.flatMap((wallet, seatIndex) => (wallet !== null && !table.antedSeatIndexes.includes(seatIndex) ? [wallet] : []));
}

export function countRoundsSatOut(previous: RoundsSatOut, table: TableSnapshot): RoundsSatOut {
  if (table.phase.state !== "live" || previous.countedRound === table.roundNumber) return previous;
  const byWallet = new Map<string, number>();
  for (const wallet of listSeatsSittingOut(table)) byWallet.set(wallet.toBase58(), (previous.byWallet.get(wallet.toBase58()) ?? 0) + 1);
  return { countedRound: table.roundNumber, byWallet };
}

function findEvictableWallet(table: TableSnapshot, roundsSatOut: RoundsSatOut, ownWallet: PublicKey): PublicKey | null {
  const freeSeats = table.seats.filter((wallet) => wallet === null).length;
  const isCrowded = freeSeats <= EVICT_WHEN_FREE_SEATS;
  const evictable = listSeatsSittingOut(table).find(
    (wallet) => !wallet.equals(ownWallet) && (isCrowded || (roundsSatOut.byWallet.get(wallet.toBase58()) ?? 0) >= EVICT_AFTER_ROUNDS_SAT_OUT),
  );
  return evictable ?? null;
}

export function chooseCrank(table: TableSnapshot, nowTick: number, timing: RoundTiming, roundsSatOut: RoundsSatOut, ownWallet: PublicKey): Crank | null {
  const phase = table.phase;
  if (phase.state === "lobby") {
    const anted = table.antedSeatIndexes.length;
    if (anted < MIN_PLAYERS) return null;
    const seated = table.seats.filter((wallet) => wallet !== null).length;
    const isLobbyClosed = nowTick >= Number(phase.firstAnteTick) + timing.lobbyTicks;
    return anted === seated || isLobbyClosed ? { kind: "startRound", roundNumber: table.roundNumber } : null;
  }
  if (phase.state !== "live") return null;
  const seats = listAntedSeatAddresses(table);
  if (nowTick >= Number(table.round.endTick)) return { kind: "settle", roundNumber: table.roundNumber, seats };
  const landed = table.round.swats.filter((swat) => Number(swat.landsTick) <= nowTick).sort((left, right) => Number(right.number - left.number))[0];
  if (landed) return { kind: "landSwat", roundNumber: table.roundNumber, swatNumber: landed.number, seats };
  const evictable = findEvictableWallet(table, roundsSatOut, ownWallet);
  return evictable === null ? null : { kind: "evictSeat", roundNumber: table.roundNumber, wallet: evictable };
}
