import { PublicKey } from "@solana/web3.js";
import type { PigeonState, RoundSnapshot, SeatSnapshot, SwatSnapshot, TableSnapshot } from "../src/lib/chain/accounts";
import { CHIPS_PER_ANTE, applyLandedSwats, readChainPigeon, type ChainPigeon } from "../src/lib/game/chain-rules";
import type { RecordedRound, RoundEvent, RoundTiming } from "../src/lib/game/round-events";
import type { TableStore } from "../src/lib/game/table-store";
import type { PigeonView } from "../src/lib/game/view-state";

export type ChainChange = { kind: "table"; snapshot: TableSnapshot } | { kind: "seat"; snapshot: SeatSnapshot };

export type SwatLandingMode = "lazy" | "landSwat";

const SEAT_COUNT = 21;
const SWAT_HISTORY_LENGTH = 8;
const KEY_FAMILY_TABLE = 1;
const KEY_FAMILY_SEAT = 2;
const KEY_FAMILY_WALLET = 3;

export function createTestKey(family: number, index: number): PublicKey {
  const bytes = new Uint8Array(32);
  bytes[0] = family;
  bytes[1] = index;
  return new PublicKey(bytes);
}

export const TEST_TABLE_ADDRESS = createTestKey(KEY_FAMILY_TABLE, 0);

export const findTestWallet = (seat: number): PublicKey => createTestKey(KEY_FAMILY_WALLET, seat);

export function buildRoundSnapshot(overrides: Partial<RoundSnapshot> = {}): RoundSnapshot {
  return {
    boxCount: 3,
    sandwichBox: 0,
    endTick: 0n,
    antedCrumbs: 0n,
    potCrumbs: 0n,
    looseCrumbs: [0n, 0n, 0n],
    perchClaims: [0, 0, 0],
    hand: { state: "idle", readyTick: 0n },
    swats: [],
    swatCount: 0n,
    switchCount: 0,
    nextSwitchTick: 0n,
    ...overrides,
  };
}

export function buildTableSnapshot(overrides: Partial<TableSnapshot> = {}): TableSnapshot {
  return {
    address: TEST_TABLE_ADDRESS,
    slot: 0,
    tableId: 1n,
    validator: createTestKey(KEY_FAMILY_TABLE, 1),
    mint: createTestKey(KEY_FAMILY_TABLE, 2),
    escrow: createTestKey(KEY_FAMILY_TABLE, 3),
    anteUnits: 100_000n,
    chipUnits: 1_000n,
    boxCount: 3,
    roundNumber: 0n,
    seats: Array.from({ length: SEAT_COUNT }, () => null),
    antedSeatIndexes: [],
    phase: { state: "lobby", firstAnteTick: 0n },
    round: buildRoundSnapshot(),
    lastResult: null,
    ...overrides,
  };
}

export function buildSeatSnapshot(seat: number, overrides: Partial<SeatSnapshot> = {}): SeatSnapshot {
  return {
    address: createTestKey(KEY_FAMILY_SEAT, seat),
    slot: 0,
    wallet: findTestWallet(seat),
    seatIndex: seat,
    chips: BigInt(CHIPS_PER_ANTE),
    pigeon: { state: "hovering" },
    beakCrumbs: 0n,
    nextPeckTick: 0n,
    lastSwatNumber: 0n,
    ...overrides,
  };
}

function writePigeonState(pigeon: PigeonView): PigeonState {
  switch (pigeon.state) {
    case "hovering":
      return { state: "hovering" };
    case "flying":
      return { state: "flying", box: pigeon.box, landsTick: BigInt(pigeon.landsTick) };
    case "perched":
      return { state: "perched", box: pigeon.box };
    case "stunned":
      return { state: "stunned", box: pigeon.box, untilTick: BigInt(pigeon.untilTick) };
  }
}

function addToBox(looseCrumbs: readonly bigint[], box: number, crumbs: number): bigint[] {
  return looseCrumbs.map((loose, index) => (index === box ? loose + BigInt(crumbs) : loose));
}

export type FakeChain = {
  apply: (event: RoundEvent) => ChainChange[];
  table: () => TableSnapshot;
  seats: () => SeatSnapshot[];
};

export function ingestChange(store: TableStore, change: ChainChange): void {
  if (change.kind === "table") store.ingestTable(change.snapshot);
  else store.ingestSeat(change.snapshot);
}

function isSamePigeon(left: ChainPigeon, right: ChainPigeon): boolean {
  return left.beakCrumbs === right.beakCrumbs && left.lastSwatNumber === right.lastSwatNumber && Bun.deepEquals(left.pigeon, right.pigeon);
}

export function createFakeChain(recorded: RecordedRound, swatLanding: SwatLandingMode = "lazy"): FakeChain {
  const timing: RoundTiming = recorded.timing;
  let table = buildTableSnapshot({ boxCount: recorded.boxCount });
  const seats = new Map<number, SeatSnapshot>();
  let swatRing: SwatSnapshot[] = [];

  const writeTable = (tick: number, overrides: Partial<TableSnapshot>): ChainChange => {
    table = { ...table, slot: tick, ...overrides };
    return { kind: "table", snapshot: table };
  };
  const writeRound = (tick: number, overrides: Partial<RoundSnapshot>): ChainChange =>
    writeTable(tick, { round: { ...table.round, ...overrides } });
  const writeSeat = (seat: number, tick: number, overrides: Partial<SeatSnapshot>): ChainChange => {
    const current = seats.get(seat) ?? buildSeatSnapshot(seat);
    const next = { ...current, slot: tick, ...overrides };
    seats.set(seat, next);
    return { kind: "seat", snapshot: next };
  };
  const readSeat = (seat: number): SeatSnapshot => seats.get(seat) ?? buildSeatSnapshot(seat);

  const touchPigeon = (seat: number, tick: number, looseCrumbs: readonly bigint[] = table.round.looseCrumbs) => {
    const { after, drops } = applyLandedSwats(readChainPigeon(readSeat(seat)), table.round, tick, timing);
    return {
      pigeon: after,
      isFlattened: drops.length > 0 && after.pigeon.state === "stunned",
      looseCrumbs: drops.reduce((loose, drop) => addToBox(loose, drop.box, drop.crumbs), [...looseCrumbs]),
    };
  };

  const writePigeon = (seat: number, tick: number, pigeon: ChainPigeon, nextPeckTick?: number) =>
    writeSeat(seat, tick, {
      pigeon: writePigeonState(pigeon.pigeon),
      beakCrumbs: BigInt(pigeon.beakCrumbs),
      lastSwatNumber: BigInt(pigeon.lastSwatNumber),
      ...(nextPeckTick === undefined ? {} : { nextPeckTick: BigInt(nextPeckTick) }),
    });

  const movePigeon = (seat: number, tick: number, target: PigeonView): ChainChange[] => {
    const touched = touchPigeon(seat, tick);
    if (!touched.isFlattened && touched.pigeon.pigeon.state === "stunned") return [];
    const pigeon = touched.isFlattened ? touched.pigeon : { ...touched.pigeon, pigeon: target };
    return [writeRound(tick, { looseCrumbs: touched.looseCrumbs }), writePigeon(seat, tick, pigeon)];
  };

  const peck = (seat: number, tick: number): ChainChange[] => {
    const touched = touchPigeon(seat, tick);
    const looseCrumbs = touched.looseCrumbs;
    if (touched.isFlattened) return [writeRound(tick, { looseCrumbs }), writePigeon(seat, tick, touched.pigeon)];
    if (touched.pigeon.pigeon.state !== "perched") return [];
    const box = touched.pigeon.pigeon.box;
    const nextPeckTick = tick + timing.peckCooldownTicks;
    const fedPigeon = { ...touched.pigeon, beakCrumbs: touched.pigeon.beakCrumbs + 1 };
    if ((looseCrumbs[box] ?? 0n) > 0n) {
      return [writeRound(tick, { looseCrumbs: addToBox(looseCrumbs, box, -1) }), writePigeon(seat, tick, fedPigeon, nextPeckTick)];
    }
    if (box === table.round.sandwichBox && table.round.potCrumbs > 0n) {
      return [writeRound(tick, { looseCrumbs, potCrumbs: table.round.potCrumbs - 1n }), writePigeon(seat, tick, fedPigeon, nextPeckTick)];
    }
    const stunned: PigeonView = { state: "stunned", box, untilTick: tick + timing.emptyBoxStunTicks };
    return [writeRound(tick, { looseCrumbs }), writePigeon(seat, tick, { ...touched.pigeon, pigeon: stunned }, nextPeckTick)];
  };

  const touchRoundPigeons = (whaleSeat: number, tick: number) => {
    let looseCrumbs = table.round.looseCrumbs;
    const pigeons = table.antedSeatIndexes
      .filter((seat) => seat !== whaleSeat)
      .map((seat) => {
        const touched = touchPigeon(seat, tick, looseCrumbs);
        looseCrumbs = touched.looseCrumbs;
        return { seat, before: readChainPigeon(readSeat(seat)), pigeon: touched.pigeon };
      });
    return { pigeons, looseCrumbs };
  };

  const landSwat = (tick: number): ChainChange[] => {
    if (table.phase.state !== "live" || tick >= Number(table.round.endTick)) return [];
    const { pigeons, looseCrumbs } = touchRoundPigeons(table.phase.whaleSeat, tick);
    const seatChanges = pigeons
      .filter((touched) => !isSamePigeon(touched.before, touched.pigeon))
      .map((touched) => writePigeon(touched.seat, tick, touched.pigeon));
    return [writeRound(tick, { looseCrumbs }), ...seatChanges];
  };

  const raiseHand = (tick: number, box: number): ChainChange[] => {
    const number = table.round.swatCount + 1n;
    const landsTick = BigInt(tick + timing.swatWindupTicks);
    swatRing = [...swatRing, { number, box, landsTick }].slice(-SWAT_HISTORY_LENGTH);
    return [writeRound(tick, { swats: swatRing, swatCount: number, hand: { state: "raised", box, landsTick } })];
  };

  const settle = (tick: number): ChainChange[] => {
    if (table.phase.state !== "live") return [];
    const whaleSeat = table.phase.whaleSeat;
    const { pigeons: settledPigeons, looseCrumbs } = touchRoundPigeons(whaleSeat, Number(table.round.endTick));
    const pigeonCrumbs = settledPigeons.reduce((total, settled) => total + settled.pigeon.beakCrumbs, 0);
    const whaleCrumbs = Number(table.round.potCrumbs + looseCrumbs.reduce((total, loose) => total + loose, 0n));
    const seatChanges = settledPigeons.map((settled) =>
      writeSeat(settled.seat, tick, {
        chips: readSeat(settled.seat).chips + BigInt(settled.pigeon.beakCrumbs),
        pigeon: writePigeonState(settled.pigeon.pigeon),
        beakCrumbs: 0n,
        lastSwatNumber: BigInt(settled.pigeon.lastSwatNumber),
      }),
    );
    const whaleChange = writeSeat(whaleSeat, tick, { chips: readSeat(whaleSeat).chips + BigInt(whaleCrumbs) });
    const tableChange = writeTable(tick, {
      lastResult: {
        roundNumber: table.roundNumber,
        whaleWallet: findTestWallet(whaleSeat),
        sandwichBox: table.round.sandwichBox,
        whaleCrumbs: BigInt(whaleCrumbs),
        pigeonCrumbs: BigInt(pigeonCrumbs),
      },
      round: { ...table.round, looseCrumbs },
      antedSeatIndexes: [],
      roundNumber: table.roundNumber + 1n,
      phase: { state: "lobby", firstAnteTick: 0n },
    });
    return [tableChange, ...seatChanges, whaleChange];
  };

  const apply = (event: RoundEvent): ChainChange[] => {
    const tick = event.tick;
    switch (event.kind) {
      case "seatJoined":
        return [
          writeTable(tick, { seats: table.seats.map((wallet, seat) => (seat === event.seat ? findTestWallet(seat) : wallet)) }),
          writeSeat(event.seat, tick, { seatIndex: event.seat, chips: BigInt(recorded.chipsPerAnte) }),
        ];
      case "anted":
        return [
          writeTable(tick, {
            antedSeatIndexes: [...table.antedSeatIndexes, event.seat].sort((left, right) => left - right),
            phase: table.antedSeatIndexes.length === 0 ? { state: "lobby", firstAnteTick: BigInt(tick) } : table.phase,
          }),
          writeSeat(event.seat, tick, {
            chips: readSeat(event.seat).chips - BigInt(recorded.chipsPerAnte),
            pigeon: { state: "hovering" },
            beakCrumbs: 0n,
            nextPeckTick: 0n,
            lastSwatNumber: 0n,
          }),
        ];
      case "whaleDrawn": {
        const antedCrumbs = BigInt(table.antedSeatIndexes.length * recorded.chipsPerAnte);
        swatRing = [];
        return [
          writeTable(tick, { phase: { state: "drawing", requestedTick: BigInt(tick) } }),
          writeTable(tick, {
            phase: { state: "live", whaleSeat: event.whaleSeat },
            round: buildRoundSnapshot({
              boxCount: recorded.boxCount,
              sandwichBox: event.sandwichBox,
              endTick: BigInt(tick + timing.roundTicks),
              antedCrumbs,
              potCrumbs: antedCrumbs,
              hand: { state: "idle", readyTick: BigInt(tick) },
              nextSwitchTick: BigInt(tick),
            }),
          }),
        ];
      }
      case "flew":
        return movePigeon(event.seat, tick, { state: "flying", box: event.box, landsTick: tick + timing.flightTicks });
      case "tookOff":
        return movePigeon(event.seat, tick, { state: "hovering" });
      case "pecked":
        return peck(event.seat, tick);
      case "handRaised":
        return raiseHand(tick, event.box);
      case "settled":
        return settle(tick);
      case "swatLanded":
        return swatLanding === "landSwat" ? landSwat(tick) : [];
      case "landed":
      case "stunEnded":
        return [];
    }
  };

  return { apply, table: () => table, seats: () => [...seats.values()] };
}
