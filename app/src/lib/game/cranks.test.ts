import { describe, expect, test } from "bun:test";
import { buildRoundSnapshot, buildTableSnapshot, findTestWallet } from "../../../tests/fake-chain";
import { findSeatAddress } from "../chain/addresses";
import { LIVE_TIMING } from "./chain-rules";
import { chooseCrank, describeCrank } from "./cranks";

const seatsOf = (count: number) => Array.from({ length: 21 }, (_unused, seat) => (seat < count ? findTestWallet(seat) : null));

describe("chooseCrank", () => {
  test("starts the round once two players anted and everyone seated is in, or once the lobby closed", () => {
    const lobby = { state: "lobby" as const, firstAnteTick: 1_000n };
    const alone = buildTableSnapshot({ seats: seatsOf(3), antedSeatIndexes: [0], phase: lobby });
    expect(chooseCrank(alone, 9_000, LIVE_TIMING)).toBeNull();
    const twoOfThree = buildTableSnapshot({ seats: seatsOf(3), antedSeatIndexes: [0, 1], phase: lobby });
    expect(chooseCrank(twoOfThree, 1_100, LIVE_TIMING)).toBeNull();
    expect(chooseCrank(twoOfThree, 1_000 + LIVE_TIMING.lobbyTicks, LIVE_TIMING)).toMatchObject({ kind: "startRound" });
    const allIn = buildTableSnapshot({ seats: seatsOf(2), antedSeatIndexes: [0, 1], phase: lobby });
    expect(chooseCrank(allIn, 1_100, LIVE_TIMING)).toMatchObject({ kind: "startRound" });
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
    expect(chooseCrank(live, 1_500, LIVE_TIMING)).toBeNull();
    const landing = chooseCrank(live, 3_500, LIVE_TIMING);
    expect(landing).toMatchObject({ kind: "landSwat", swatNumber: 2n });
    const antedSeatAccounts = [0, 1, 3].map((seat) => findSeatAddress(live.address, findTestWallet(seat)).toBase58());
    expect(landing?.kind === "landSwat" ? landing.seats.map((seat) => seat.toBase58()) : []).toEqual(antedSeatAccounts);
    expect(landing && describeCrank(landing)).toBe(`landSwat:${live.roundNumber}:2`);
    const settle = chooseCrank(live, 9_000, LIVE_TIMING);
    expect(settle?.kind).toBe("settle");
    expect(settle?.kind === "settle" ? settle.seats.map((seat) => seat.toBase58()) : []).toEqual(antedSeatAccounts);
  });

  test("does nothing while the whale is being drawn", () => {
    expect(chooseCrank(buildTableSnapshot({ phase: { state: "drawing", requestedTick: 10n } }), 99_999, LIVE_TIMING)).toBeNull();
  });
});
