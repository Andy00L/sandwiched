import type { PublicKey } from "@solana/web3.js";
import type { TableSnapshot } from "../chain/accounts";
import { findSeatAddress } from "../chain/addresses";
import { MIN_PLAYERS } from "./chain-rules";
import type { RoundTiming } from "./round-events";

export type Crank =
  | { kind: "startRound"; roundNumber: bigint }
  | { kind: "settle"; roundNumber: bigint; seats: PublicKey[] }
  | { kind: "landSwat"; roundNumber: bigint; swatNumber: bigint; seats: PublicKey[] };

export function describeCrank(crank: Crank): string {
  return crank.kind === "landSwat" ? `landSwat:${crank.roundNumber}:${crank.swatNumber}` : `${crank.kind}:${crank.roundNumber}`;
}

function listAntedSeatAddresses(table: TableSnapshot): PublicKey[] {
  return table.antedSeatIndexes.flatMap((seatIndex) => {
    const wallet = table.seats[seatIndex];
    return wallet ? [findSeatAddress(table.address, wallet)] : [];
  });
}

export function chooseCrank(table: TableSnapshot, nowTick: number, timing: RoundTiming): Crank | null {
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
  return landed ? { kind: "landSwat", roundNumber: table.roundNumber, swatNumber: landed.number, seats } : null;
}
