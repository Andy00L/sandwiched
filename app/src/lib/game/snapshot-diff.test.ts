import { describe, expect, test } from "bun:test";
import type { SeatSnapshot, TableSnapshot } from "../chain/accounts";
import { buildRoundSnapshot, buildSeatSnapshot, buildTableSnapshot, findTestWallet } from "../../../tests/fake-chain";
import { LIVE_TIMING } from "./chain-rules";
import type { RecordedRound, RoundEvent } from "./round-events";
import { EMPTY_CHAIN_FRAME, deriveRoundEvents, mergeChainFrames, type ChainFrame } from "./snapshot-diff";
import { applyRoundEvent, createViewState, type RoundViewState } from "./view-state";

const START_TICK = 100;
const END_TICK = START_TICK + LIVE_TIMING.roundTicks;
const SANDWICH_BOX = 2;

const HEADER: RecordedRound = {
  version: 1,
  seed: 0,
  tickMs: 10,
  boxCount: 3,
  timing: LIVE_TIMING,
  chipsPerAnte: 100,
  players: [0, 1, 2].map((seat) => ({ seat, name: `Seat ${seat}`, variant: seat, temperament: "greedy" })),
  events: [],
};

const SEATED_WALLETS = Array.from({ length: 21 }, (_unused, seat) => (seat < 3 ? findTestWallet(seat) : null));

const LIVE_TABLE = buildTableSnapshot({
  slot: START_TICK,
  seats: SEATED_WALLETS,
  antedSeatIndexes: [0, 1, 2],
  phase: { state: "live", whaleSeat: 0 },
  round: buildRoundSnapshot({ sandwichBox: SANDWICH_BOX, endTick: BigInt(END_TICK), antedCrumbs: 300n, potCrumbs: 300n }),
});

const LIVE_HISTORY: RoundEvent[] = [
  ...[0, 1, 2].map((seat): RoundEvent => ({ tick: 0, kind: "seatJoined", seat })),
  ...[0, 1, 2].map((seat): RoundEvent => ({ tick: 10, kind: "anted", seat })),
  { tick: START_TICK, kind: "whaleDrawn", whaleSeat: 0, sandwichBox: SANDWICH_BOX, endTick: END_TICK },
];

function viewAfter(history: readonly RoundEvent[]): RoundViewState {
  return [...LIVE_HISTORY, ...history].reduce(applyRoundEvent, createViewState(HEADER));
}

function buildFrame(tick: number, table: TableSnapshot, seats: readonly SeatSnapshot[]): ChainFrame {
  return { tick, table, seats: new Map(seats.map((seat) => [seat.seatIndex ?? -1, seat])) };
}

function deriveEvents(history: readonly RoundEvent[], previous: ChainFrame, next: ChainFrame): RoundEvent[] {
  return deriveRoundEvents(viewAfter(history), previous, next, LIVE_TIMING);
}

const PERCHED_ON_SANDWICH: RoundEvent[] = [
  { tick: 110, kind: "flew", seat: 1, box: SANDWICH_BOX, landsTick: 160 },
  { tick: 160, kind: "landed", seat: 1, box: SANDWICH_BOX },
];

describe("deriveRoundEvents in the lobby", () => {
  test("the first sight of a table names every seat that joined and anted, then the draw", () => {
    const events = deriveRoundEvents(createViewState(HEADER), EMPTY_CHAIN_FRAME, buildFrame(START_TICK, LIVE_TABLE, []), LIVE_TIMING);
    expect(events).toEqual([...LIVE_HISTORY.map((event) => ({ ...event, tick: START_TICK }))]);
  });

  test("a table change names only the seats that joined or anted since the previous one", () => {
    const before = buildTableSnapshot({ slot: 20, seats: SEATED_WALLETS.map((wallet, seat) => (seat === 0 ? wallet : null)) });
    const after = buildTableSnapshot({ slot: 35, seats: SEATED_WALLETS.map((wallet, seat) => (seat < 2 ? wallet : null)), antedSeatIndexes: [0] });
    const view = createViewState(HEADER);
    const events = deriveRoundEvents(view, buildFrame(20, before, []), buildFrame(35, after, []), LIVE_TIMING);
    expect(events).toEqual([
      { tick: 35, kind: "seatJoined", seat: 1 },
      { tick: 35, kind: "anted", seat: 0 },
    ]);
  });

  test("the draw becomes whaleDrawn at the round start, with the public box and the end tick", () => {
    const drawing = { ...LIVE_TABLE, slot: 90, phase: { state: "drawing" as const, requestedTick: 90n } };
    const events = deriveEvents([], buildFrame(90, drawing, []), buildFrame(START_TICK, LIVE_TABLE, []));
    expect(events).toEqual([{ tick: START_TICK, kind: "whaleDrawn", whaleSeat: 0, sandwichBox: SANDWICH_BOX, endTick: END_TICK }]);
  });
});

describe("deriveRoundEvents for pigeon moves", () => {
  const hovering = buildSeatSnapshot(1, { slot: 10 });

  test("a flight starts at its take-off tick, and the clock alone lands it", () => {
    const flying = buildSeatSnapshot(1, { slot: 110, pigeon: { state: "flying", box: 1, landsTick: 160n } });
    const takeOff = buildFrame(110, LIVE_TABLE, [flying]);
    expect(deriveEvents([], buildFrame(105, LIVE_TABLE, [hovering]), takeOff)).toEqual([
      { tick: 110, kind: "flew", seat: 1, box: 1, landsTick: 160 },
    ]);
    const afterFlight = viewAfter([{ tick: 110, kind: "flew", seat: 1, box: 1, landsTick: 160 }]);
    expect(deriveRoundEvents(afterFlight, takeOff, { ...takeOff, tick: 170 }, LIVE_TIMING)).toEqual([
      { tick: 160, kind: "landed", seat: 1, box: 1 },
    ]);
  });

  test("a pigeon back in the air gives tookOff at the change", () => {
    const perched = buildSeatSnapshot(1, { slot: 110, pigeon: { state: "flying", box: SANDWICH_BOX, landsTick: 160n } });
    const lifted = buildSeatSnapshot(1, { slot: 200, pigeon: { state: "hovering" } });
    expect(deriveEvents(PERCHED_ON_SANDWICH, buildFrame(190, LIVE_TABLE, [perched]), buildFrame(200, LIVE_TABLE, [lifted]))).toEqual([
      { tick: 200, kind: "tookOff", seat: 1 },
    ]);
  });

  test("a delivery older than the snapshot already applied for that seat changes nothing", () => {
    const newer = buildSeatSnapshot(1, { slot: 200, pigeon: { state: "flying", box: 0, landsTick: 250n } });
    const older = buildSeatSnapshot(1, { slot: 150, pigeon: { state: "hovering" } });
    const history: RoundEvent[] = [{ tick: 200, kind: "flew", seat: 1, box: 0, landsTick: 250 }];
    const previous = buildFrame(210, LIVE_TABLE, [newer]);
    const stale = buildFrame(210, LIVE_TABLE, [older]);
    expect(deriveEvents(history, previous, stale)).toEqual([]);
    expect(mergeChainFrames(previous, stale).seats.get(1)).toBe(newer);
    expect(deriveEvents(history, previous, buildFrame(210, LIVE_TABLE, [{ ...newer }]))).toEqual([]);
  });
});

describe("deriveRoundEvents for pecks", () => {
  const perched = buildSeatSnapshot(1, { slot: 160, pigeon: { state: "perched", box: SANDWICH_BOX } });

  test("a peck on the sandwich box with no loose crumbs takes a sandwich crumb", () => {
    const fed = { ...perched, slot: 170, beakCrumbs: 1n, nextPeckTick: BigInt(170 + LIVE_TIMING.peckCooldownTicks) };
    expect(deriveEvents(PERCHED_ON_SANDWICH, buildFrame(165, LIVE_TABLE, [perched]), buildFrame(170, LIVE_TABLE, [fed]))).toEqual([
      { tick: 170, kind: "pecked", seat: 1, box: SANDWICH_BOX, outcome: "sandwichCrumb" },
    ]);
  });

  test("a peck on an empty box stuns until the tick the seat names", () => {
    const history: RoundEvent[] = [
      { tick: 110, kind: "flew", seat: 1, box: 0, landsTick: 160 },
      { tick: 160, kind: "landed", seat: 1, box: 0 },
    ];
    const onEmptyBox = { ...perched, pigeon: { state: "perched" as const, box: 0 } };
    const untilTick = 170 + LIVE_TIMING.emptyBoxStunTicks;
    const bonked = {
      ...onEmptyBox,
      slot: 170,
      pigeon: { state: "stunned" as const, box: 0, untilTick: BigInt(untilTick) },
      nextPeckTick: BigInt(170 + LIVE_TIMING.peckCooldownTicks),
    };
    expect(deriveEvents(history, buildFrame(165, LIVE_TABLE, [onEmptyBox]), buildFrame(170, LIVE_TABLE, [bonked]))).toEqual([
      { tick: 170, kind: "pecked", seat: 1, box: 0, outcome: "emptyBox", untilTick },
    ]);
  });

  describe("after a swat knocked crumbs out of another pigeon's beak", () => {
    const SWAT_LANDS_TICK = 300;
    const swatTable: TableSnapshot = {
      ...LIVE_TABLE,
      slot: 265,
      round: {
        ...LIVE_TABLE.round,
        swats: [{ number: 1n, box: SANDWICH_BOX, landsTick: BigInt(SWAT_LANDS_TICK) }],
        swatCount: 1n,
        hand: { state: "raised", box: SANDWICH_BOX, landsTick: BigInt(SWAT_LANDS_TICK) },
      },
    };
    const history: RoundEvent[] = [
      { tick: 110, kind: "flew", seat: 2, box: SANDWICH_BOX, landsTick: 160 },
      { tick: 160, kind: "landed", seat: 2, box: SANDWICH_BOX },
      { tick: 160, kind: "pecked", seat: 2, box: SANDWICH_BOX, outcome: "sandwichCrumb" },
      { tick: 190, kind: "pecked", seat: 2, box: SANDWICH_BOX, outcome: "sandwichCrumb" },
      { tick: 265, kind: "handRaised", box: SANDWICH_BOX, swatNumber: 1, landsTick: SWAT_LANDS_TICK },
      { tick: SWAT_LANDS_TICK, kind: "swatLanded", box: SANDWICH_BOX, swatNumber: 1, hits: [{ seat: 2, droppedCrumbs: 1, untilTick: 450 }] },
      { tick: 320, kind: "flew", seat: 1, box: SANDWICH_BOX, landsTick: 370 },
      { tick: 370, kind: "landed", seat: 1, box: SANDWICH_BOX },
    ];
    const lander = buildSeatSnapshot(1, { slot: 320, pigeon: { state: "flying", box: SANDWICH_BOX, landsTick: 370n }, lastSwatNumber: 1n });
    const fedLander = { ...lander, slot: 380, beakCrumbs: 1n, nextPeckTick: BigInt(380 + LIVE_TIMING.peckCooldownTicks) };
    const untouchedVictim = buildSeatSnapshot(2, { slot: 190, pigeon: { state: "perched", box: SANDWICH_BOX }, beakCrumbs: 2n, nextPeckTick: 220n });
    const touchedVictim = {
      ...untouchedVictim,
      slot: 375,
      pigeon: { state: "stunned" as const, box: SANDWICH_BOX, untilTick: 450n },
      beakCrumbs: 1n,
      lastSwatNumber: 1n,
    };

    test.each([
      ["has not been touched since, so the chain still owes the crumb and the peck takes", untouchedVictim, "sandwichCrumb"],
      ["was touched since, so the crumb lies on the box and the peck takes", touchedVictim, "looseCrumb"],
    ] as const)("the victim %s a %s", (_label, victim, outcome) => {
      const previous = buildFrame(375, swatTable, [lander, victim]);
      const next = buildFrame(380, swatTable, [fedLander, victim]);
      expect(deriveEvents(history, previous, next)).toEqual([{ tick: 380, kind: "pecked", seat: 1, box: SANDWICH_BOX, outcome }]);
    });
  });
});

describe("deriveRoundEvents for the whale", () => {
  test("a raised hand lands from the clock, flattens the perched pigeon, and the stun ends from the clock", () => {
    const history: RoundEvent[] = [
      ...PERCHED_ON_SANDWICH,
      { tick: 160, kind: "pecked", seat: 1, box: SANDWICH_BOX, outcome: "sandwichCrumb" },
      { tick: 190, kind: "pecked", seat: 1, box: SANDWICH_BOX, outcome: "sandwichCrumb" },
      { tick: 220, kind: "pecked", seat: 1, box: SANDWICH_BOX, outcome: "sandwichCrumb" },
    ];
    const pigeon = buildSeatSnapshot(1, { slot: 220, pigeon: { state: "perched", box: SANDWICH_BOX }, beakCrumbs: 3n, nextPeckTick: 250n });
    const landsTick = 300 + LIVE_TIMING.swatWindupTicks;
    const raisedTable: TableSnapshot = {
      ...LIVE_TABLE,
      slot: 300,
      round: {
        ...LIVE_TABLE.round,
        swats: [{ number: 1n, box: SANDWICH_BOX, landsTick: BigInt(landsTick) }],
        swatCount: 1n,
        hand: { state: "raised", box: SANDWICH_BOX, landsTick: BigInt(landsTick) },
      },
    };
    const beforeRaise = buildFrame(290, LIVE_TABLE, [pigeon]);
    const atRaise = buildFrame(300, raisedTable, [pigeon]);
    const raised = deriveEvents(history, beforeRaise, atRaise);
    expect(raised).toEqual([{ tick: 300, kind: "handRaised", box: SANDWICH_BOX, swatNumber: 1, landsTick }]);

    const untilTick = landsTick + LIVE_TIMING.swatStunTicks;
    const landed = deriveEvents([...history, ...raised], atRaise, { ...atRaise, tick: untilTick + 5 });
    expect(landed).toEqual([
      { tick: landsTick, kind: "swatLanded", box: SANDWICH_BOX, swatNumber: 1, hits: [{ seat: 1, droppedCrumbs: 2, untilTick }] },
      { tick: untilTick, kind: "stunEnded", seat: 1 },
    ]);
  });

  test("settle names the chain's split and each pigeon's beak", () => {
    const history: RoundEvent[] = [...PERCHED_ON_SANDWICH, { tick: 160, kind: "pecked", seat: 1, box: SANDWICH_BOX, outcome: "sandwichCrumb" }];
    const settledTable = buildTableSnapshot({
      ...LIVE_TABLE,
      slot: END_TICK,
      roundNumber: 1n,
      antedSeatIndexes: [],
      phase: { state: "lobby", firstAnteTick: 0n },
      lastResult: { roundNumber: 0n, whaleWallet: findTestWallet(0), sandwichBox: SANDWICH_BOX, whaleCrumbs: 299n, pigeonCrumbs: 1n },
    });
    expect(deriveEvents(history, buildFrame(END_TICK - 5, LIVE_TABLE, []), buildFrame(END_TICK, settledTable, []))).toEqual([
      {
        tick: END_TICK,
        kind: "settled",
        whaleCrumbs: 299,
        pigeonCrumbs: 1,
        beaks: [
          { seat: 1, crumbs: 1 },
          { seat: 2, crumbs: 0 },
        ],
      },
    ]);
  });
});
