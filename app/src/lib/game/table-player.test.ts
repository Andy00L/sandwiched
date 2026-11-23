import { afterEach, beforeEach, describe, expect, jest, test } from "bun:test";
import type { PublicKey } from "@solana/web3.js";
import { buildRoundSnapshot, buildTableSnapshot, findTestWallet } from "../../../tests/fake-chain";
import { advanceFakeTime } from "../../../tests/fake-time";
import { success } from "../chain/result";
import type { TableSnapshot } from "../chain/accounts";
import type { RollupAck } from "../chain/transport";
import { LIVE_TIMING } from "./chain-rules";
import type { GuestChain } from "./guest-steps";
import { type PlayerActions, startTablePlayer } from "./table-player";
import type { TableStore, TableStoreSnapshot } from "./table-store";

const OWN_SEAT = 1;
const OWN_WALLET = findTestWallet(OWN_SEAT);
const OK_ACK: RollupAck = { ok: true, signature: "signature", ackMs: 1 };

const createRecordingActions = () => {
  const calls: string[] = [];
  const record = (label: string) => async () => {
    calls.push(label);
    return OK_ACK;
  };
  const actions: PlayerActions = {
    ante: record("ante"),
    flyTo: async (boxIndex) => (calls.push(`flyTo:${boxIndex}`), OK_ACK),
    takeOff: record("takeOff"),
    peck: record("peck"),
    raiseHand: async (boxIndex) => (calls.push(`raiseHand:${boxIndex}`), OK_ACK),
    startRound: record("startRound"),
    landSwat: async (seats: PublicKey[]) => (calls.push(`landSwat:${seats.length}`), OK_ACK),
    settle: async (seats: PublicKey[]) => (calls.push(`settle:${seats.length}`), OK_ACK),
    evictSeat: async (wallet: PublicKey) => (calls.push(`evictSeat:${wallet.toBase58()}`), OK_ACK),
  };
  return { actions, calls };
};

const readyGuest: GuestChain = {
  readFacts: async () => success({ isSeatOnRollup: true, hasSession: true, seatIndex: OWN_SEAT, chips: 1_000n, walletUnits: 0n, rollupUnits: 0n }),
  run: async () => success("unused"),
  readDecline: () => null,
};

const createStubStore = (chainTick: number): TableStore => {
  const snapshot: TableStoreSnapshot = { live: null, previous: null, ownSeat: OWN_SEAT, predicted: [], lastRefusal: null };
  return {
    subscribe: () => () => undefined,
    getSnapshot: () => snapshot,
    ingestTable: () => undefined,
    ingestSeat: () => undefined,
    advance: () => undefined,
    horizonTick: () => chainTick,
    chainTick: () => chainTick,
    perform: async (_intent, send) => send(),
  };
};

const seats = Array.from({ length: 21 }, (_unused, seat) => (seat < 3 ? findTestWallet(seat) : null));

beforeEach(() => jest.useFakeTimers());
afterEach(() => jest.useRealTimers());

describe("startTablePlayer", () => {
  test("antes once per lobby when the guest is ready, and not again in the same round", async () => {
    const { actions, calls } = createRecordingActions();
    let table: TableSnapshot = buildTableSnapshot({ seats, antedSeatIndexes: [0], phase: { state: "lobby", firstAnteTick: 100n }, roundNumber: 4n });
    const player = startTablePlayer({
      store: createStubStore(150),
      actions,
      guest: readyGuest,
      needs: { chipsToPlay: 100n, unitsPerBuyIn: 1n },
      wallet: OWN_WALLET,
      timing: LIVE_TIMING,
      readTable: () => table,
      onStage: () => undefined,
      isCranking: true,
      antePolicy: "everyRound",
    });
    await advanceFakeTime(2_000, 50);
    expect(calls.filter((call) => call === "ante")).toHaveLength(1);
    table = { ...table, roundNumber: 5n };
    await advanceFakeTime(1_000, 50);
    expect(calls.filter((call) => call === "ante")).toHaveLength(2);
    player.stop();
  });

  test("sends a due crank once, then again only after the retry pause", async () => {
    const { actions, calls } = createRecordingActions();
    const round = buildRoundSnapshot({ endTick: 100n, swats: [] });
    const table = buildTableSnapshot({ seats, antedSeatIndexes: [0, 1, 2], phase: { state: "live", whaleSeat: 0 }, round });
    const player = startTablePlayer({
      store: createStubStore(200),
      actions,
      guest: readyGuest,
      needs: { chipsToPlay: 100n, unitsPerBuyIn: 1n },
      wallet: OWN_WALLET,
      timing: LIVE_TIMING,
      readTable: () => table,
      onStage: () => undefined,
      isCranking: true,
      antePolicy: "everyRound",
    });
    await advanceFakeTime(2_000, 50);
    expect(calls.filter((call) => call.startsWith("settle"))).toEqual(["settle:3"]);
    await advanceFakeTime(2_000, 50);
    expect(calls.filter((call) => call.startsWith("settle"))).toHaveLength(2);
    player.stop();
  });

  test("a player that leaves cranks to others sends none, even when one is due", async () => {
    const { actions, calls } = createRecordingActions();
    const round = buildRoundSnapshot({ endTick: 100n, swats: [] });
    const table = buildTableSnapshot({ seats, antedSeatIndexes: [0, 1, 2], phase: { state: "live", whaleSeat: 0 }, round });
    const player = startTablePlayer({
      store: createStubStore(200),
      actions,
      guest: readyGuest,
      needs: { chipsToPlay: 100n, unitsPerBuyIn: 1n },
      wallet: OWN_WALLET,
      timing: LIVE_TIMING,
      readTable: () => table,
      onStage: () => undefined,
      isCranking: false,
      antePolicy: "everyRound",
    });
    await advanceFakeTime(2_000, 50);
    expect(calls).toEqual([]);
    player.stop();
  });

  test("a player who antes when asked antes once after the ask, then waits for the next ask", async () => {
    const { actions, calls } = createRecordingActions();
    let table: TableSnapshot = buildTableSnapshot({ seats, antedSeatIndexes: [0], phase: { state: "lobby", firstAnteTick: 100n }, roundNumber: 4n });
    const player = startTablePlayer({
      store: createStubStore(150),
      actions,
      guest: readyGuest,
      needs: { chipsToPlay: 100n, unitsPerBuyIn: 1n },
      wallet: OWN_WALLET,
      timing: LIVE_TIMING,
      readTable: () => table,
      onStage: () => undefined,
      isCranking: false,
      antePolicy: "whenAsked",
    });
    await advanceFakeTime(1_000, 50);
    expect(calls).toEqual([]);
    player.anteNextRound();
    await advanceFakeTime(1_000, 50);
    expect(calls).toEqual(["ante"]);
    table = { ...table, roundNumber: 5n };
    await advanceFakeTime(1_000, 50);
    expect(calls).toEqual(["ante"]);
    player.stop();
  });
});
