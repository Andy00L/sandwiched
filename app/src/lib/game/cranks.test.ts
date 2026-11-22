import { describe, expect, test } from "bun:test";
import { buildRoundSnapshot, buildTableSnapshot, findTestWallet } from "../../../tests/fake-chain";
import { findSeatAddress } from "../chain/addresses";
import { LIVE_TIMING } from "./chain-rules";
import type { TableSnapshot } from "../chain/accounts";
import { EVICT_AFTER_ROUNDS_SAT_OUT, NO_ROUNDS_SAT_OUT, type RoundsSatOut, chooseCrank, countRoundsSatOut, describeCrank } from "./cranks";

const seatsOf = (count: number) => Array.from({ length: 21 }, (_unused, seat) => (seat < count ? findTestWallet(seat) : null));
const OUTSIDER = findTestWallet(20);
const crankAt = (table: TableSnapshot, nowTick: number, roundsSatOut: RoundsSatOut = NO_ROUNDS_SAT_OUT) =>
  chooseCrank(table, nowTick, LIVE_TIMING, roundsSatOut, OUTSIDER);

describe("chooseCrank", () => {
  test("starts the round once two players anted and everyone seated is in, or once the lobby closed", () => {
    const lobby = { state: "lobby" as const, firstAnteTick: 1_000n };
    const alone = buildTableSnapshot({ seats: seatsOf(3), antedSeatIndexes: [0], phase: lobby });
    expect(crankAt(alone, 9_000)).toBeNull();
    const twoOfThree = buildTableSnapshot({ seats: seatsOf(3), antedSeatIndexes: [0, 1], phase: lobby });
    expect(crankAt(twoOfThree, 1_100)).toBeNull();
    expect(crankAt(twoOfThree, 1_000 + LIVE_TIMING.lobbyTicks)).toMatchObject({ kind: "startRound" });
    const allIn = buildTableSnapshot({ seats: seatsOf(2), antedSeatIndexes: [0, 1], phase: lobby });
    expect(crankAt(allIn, 1_100)).toMatchObject({ kind: "startRound" });
  });

  test("lands the newest landed swat and settles once the end tick passed, naming every anted seat account", () => {
    const round = buildRoundSnapshot({
      endTick: 9_000n,
      swats: [
        { number: 1n, box: 0, landsTick: 2_000n },
        { number: 2n, box: 2, landsTick: 3_000n },
        { number: 3n, box: 1, landsTick: 5_000n },
      ],
    });
    const live = buildTableSnapshot({ seats: seatsOf(4), antedSeatIndexes: [0, 1, 3], phase: { state: "live", whaleSeat: 1 }, round });
    expect(crankAt(live, 1_500)).toBeNull();
    const landing = crankAt(live, 3_500);
    expect(landing).toMatchObject({ kind: "landSwat", swatNumber: 2n });
    const antedSeatAccounts = [0, 1, 3].map((seat) => findSeatAddress(live.address, findTestWallet(seat)).toBase58());
    expect(landing?.kind === "landSwat" ? landing.seats.map((seat) => seat.toBase58()) : []).toEqual(antedSeatAccounts);
    expect(landing && describeCrank(landing)).toBe(`landSwat:${live.roundNumber}:2`);
    const settle = crankAt(live, 9_000);
    expect(settle?.kind).toBe("settle");
    expect(settle?.kind === "settle" ? settle.seats.map((seat) => seat.toBase58()) : []).toEqual(antedSeatAccounts);
  });

  test("does nothing while the whale is being drawn", () => {
    expect(crankAt(buildTableSnapshot({ phase: { state: "drawing", requestedTick: 10n } }), 99_999)).toBeNull();
  });

  test("evicts a seat that sat out two live rounds, or any sitting-out seat once the table is crowded, never its own", () => {
    const live = (roundNumber: bigint, seated: number) =>
      buildTableSnapshot({ seats: seatsOf(seated), antedSeatIndexes: [0, 1, 3], phase: { state: "live", whaleSeat: 1 }, roundNumber, round: buildRoundSnapshot({ endTick: 9_000n, swats: [] }) });
    const firstRound = countRoundsSatOut(NO_ROUNDS_SAT_OUT, live(4n, 5));
    expect(countRoundsSatOut(firstRound, live(4n, 5))).toBe(firstRound);
    expect(crankAt(live(4n, 5), 1_000, firstRound)).toBeNull();
    const satOutTwice = countRoundsSatOut(firstRound, live(5n, 5));
    expect(satOutTwice.byWallet.get(findTestWallet(2).toBase58())).toBe(EVICT_AFTER_ROUNDS_SAT_OUT);
    const eviction = crankAt(live(5n, 5), 1_000, satOutTwice);
    expect(eviction?.kind === "evictSeat" ? eviction.wallet.toBase58() : null).toBe(findTestWallet(2).toBase58());
    expect(chooseCrank(live(5n, 5), 1_000, LIVE_TIMING, satOutTwice, findTestWallet(2))).toMatchObject({ kind: "evictSeat", wallet: findTestWallet(4) });
    const crowded = live(4n, 19);
    expect(crankAt(crowded, 1_000)).toMatchObject({ kind: "evictSeat", wallet: findTestWallet(2) });
  });
});
