import type { BN, IdlAccounts } from "@coral-xyz/anchor";
import { type AccountInfo, type Connection, PublicKey } from "@solana/web3.js";
import { Buffer } from "buffer";
import type { AccountChange, AccountFeed } from "./account-feed";
import { SANDWICH_PROGRAM_ID } from "./config";
import type { Sandwich } from "./idl/sandwich";
import type { SandwichProgram } from "./program";
import { type Result, attempt, attemptSync, failure, success } from "./result";

export type PigeonState =
  | { state: "hovering" }
  | { state: "flying"; box: number; landsTick: bigint }
  | { state: "perched"; box: number }
  | { state: "stunned"; box: number; untilTick: bigint };

export type HandState = { state: "idle"; readyTick: bigint } | { state: "raised"; box: number; landsTick: bigint };

export type TablePhase =
  | { state: "lobby"; firstAnteTick: bigint }
  | { state: "drawing"; requestedTick: bigint }
  | { state: "live"; whaleSeat: number };

export type SwatSnapshot = { number: bigint; box: number; landsTick: bigint };

export type RoundSnapshot = {
  boxCount: number;
  sandwichBox: number;
  endTick: bigint;
  antedCrumbs: bigint;
  potCrumbs: bigint;
  looseCrumbs: bigint[];
  perchClaims: number[];
  hand: HandState;
  swats: SwatSnapshot[];
  swatCount: bigint;
  switchCount: number;
  nextSwitchTick: bigint;
};

export type RoundResultSnapshot = {
  roundNumber: bigint;
  whaleWallet: PublicKey;
  sandwichBox: number;
  whaleCrumbs: bigint;
  pigeonCrumbs: bigint;
};

export type TableSnapshot = {
  address: PublicKey;
  slot: number;
  tableId: bigint;
  validator: PublicKey;
  mint: PublicKey;
  escrow: PublicKey;
  anteUnits: bigint;
  chipUnits: bigint;
  boxCount: number;
  roundNumber: bigint;
  seats: (PublicKey | null)[];
  antedSeatIndexes: number[];
  phase: TablePhase;
  round: RoundSnapshot;
  lastResult: RoundResultSnapshot | null;
};

export type SeatSnapshot = {
  address: PublicKey;
  slot: number;
  wallet: PublicKey;
  seatIndex: number | null;
  chips: bigint;
  pigeon: PigeonState;
  beakCrumbs: bigint;
  nextPeckTick: bigint;
  lastSwatNumber: bigint;
};

type DecodedTable = IdlAccounts<Sandwich>["table"];
type DecodedSeat = IdlAccounts<Sandwich>["seat"];

const toBigInt = (value: BN): bigint => BigInt(value.toString());

const readPhase = (phase: DecodedTable["phase"]): TablePhase | null => {
  if (phase.lobby !== undefined) return { state: "lobby", firstAnteTick: toBigInt(phase.lobby.firstAnteTick) };
  if (phase.drawing !== undefined) return { state: "drawing", requestedTick: toBigInt(phase.drawing.requestedTick) };
  if (phase.live !== undefined) return { state: "live", whaleSeat: phase.live.whaleSeat };
  return null;
};

const readHand = (hand: DecodedTable["round"]["hand"]): HandState | null => {
  if (hand.idle !== undefined) return { state: "idle", readyTick: toBigInt(hand.idle.readyTick) };
  if (hand.raised !== undefined) return { state: "raised", box: hand.raised.boxIndex, landsTick: toBigInt(hand.raised.landsTick) };
  return null;
};

const readPigeon = (pigeonState: DecodedSeat["pigeon"]["state"]): PigeonState | null => {
  if (pigeonState.hovering !== undefined) return { state: "hovering" };
  if (pigeonState.flying !== undefined) {
    return { state: "flying", box: pigeonState.flying.boxIndex, landsTick: toBigInt(pigeonState.flying.landsTick) };
  }
  if (pigeonState.perched !== undefined) return { state: "perched", box: pigeonState.perched.boxIndex };
  if (pigeonState.stunned !== undefined) {
    return { state: "stunned", box: pigeonState.stunned.boxIndex, untilTick: toBigInt(pigeonState.stunned.untilTick) };
  }
  return null;
};

const listAntedSeatIndexes = (antedBits: number, seatCount: number): number[] =>
  Array.from({ length: seatCount }, (_unused, seatIndex) => seatIndex).filter((seatIndex) => (antedBits & (1 << seatIndex)) !== 0);

export const decodeTable = (program: SandwichProgram, address: PublicKey, slot: number, data: Buffer): Result<TableSnapshot> => {
  const decoded = attemptSync(() => program.coder.accounts.decode<DecodedTable>("table", data));
  if (!decoded.ok) return failure(`[decodeTable] ${address.toBase58()}: ${decoded.reason}`);
  const table = decoded.value;
  const phase = readPhase(table.phase);
  const hand = readHand(table.round.hand);
  if (phase === null || hand === null) return failure(`[decodeTable] ${address.toBase58()}: unknown phase or hand variant`);
  return success({
    address,
    slot,
    tableId: toBigInt(table.tableId),
    validator: table.validator,
    mint: table.mint,
    escrow: table.escrow,
    anteUnits: toBigInt(table.anteUnits),
    chipUnits: toBigInt(table.chipUnits),
    boxCount: table.boxCount,
    roundNumber: toBigInt(table.roundNumber),
    seats: table.seats.map((wallet) => (wallet.equals(PublicKey.default) ? null : wallet)),
    antedSeatIndexes: listAntedSeatIndexes(table.anted, table.seats.length),
    phase,
    round: {
      boxCount: table.round.boxCount,
      sandwichBox: table.round.sandwichBox,
      endTick: toBigInt(table.round.endTick),
      antedCrumbs: toBigInt(table.round.antedCrumbs),
      potCrumbs: toBigInt(table.round.potCrumbs),
      looseCrumbs: table.round.looseCrumbs.map(toBigInt),
      perchClaims: table.round.perchClaims,
      hand,
      swats: table.round.swats
        .map((swat) => ({ number: toBigInt(swat.number), box: swat.boxIndex, landsTick: toBigInt(swat.landsTick) }))
        .filter((swat) => swat.number > 0n),
      swatCount: toBigInt(table.round.swatCount),
      switchCount: table.round.switchCount,
      nextSwitchTick: toBigInt(table.round.nextSwitchTick),
    },
    lastResult:
      table.lastResult === null
        ? null
        : {
            roundNumber: toBigInt(table.lastResult.roundNumber),
            whaleWallet: table.lastResult.whaleWallet,
            sandwichBox: table.lastResult.sandwichBox,
            whaleCrumbs: toBigInt(table.lastResult.whaleCrumbs),
            pigeonCrumbs: toBigInt(table.lastResult.pigeonCrumbs),
          },
  });
};

export const decodeSeat = (program: SandwichProgram, address: PublicKey, slot: number, data: Buffer): Result<SeatSnapshot> => {
  const decoded = attemptSync(() => program.coder.accounts.decode<DecodedSeat>("seat", data));
  if (!decoded.ok) return failure(`[decodeSeat] ${address.toBase58()}: ${decoded.reason}`);
  const seat = decoded.value;
  const pigeon = readPigeon(seat.pigeon.state);
  if (pigeon === null) return failure(`[decodeSeat] ${address.toBase58()}: unknown pigeon state`);
  return success({
    address,
    slot,
    wallet: seat.wallet,
    seatIndex: seat.seatIndex,
    chips: toBigInt(seat.chips),
    pigeon,
    beakCrumbs: toBigInt(seat.pigeon.beakCrumbs),
    nextPeckTick: toBigInt(seat.pigeon.nextPeckTick),
    lastSwatNumber: toBigInt(seat.pigeon.lastSwatNumber),
  });
};

type Decoder<Snapshot> = (program: SandwichProgram, address: PublicKey, slot: number, data: Buffer) => Result<Snapshot>;

const decodeOwnedAccount = <Snapshot>(
  decode: Decoder<Snapshot>,
  program: SandwichProgram,
  address: PublicKey,
  slot: number,
  account: Pick<AccountInfo<Buffer>, "owner" | "data"> | null,
): Result<Snapshot | null> => {
  if (account === null || !account.owner.equals(SANDWICH_PROGRAM_ID)) return success(null);
  return decode(program, address, slot, Buffer.from(account.data));
};

const fetchAccount = async <Snapshot>(
  decode: Decoder<Snapshot>,
  program: SandwichProgram,
  connection: Connection,
  address: PublicKey,
): Promise<Result<Snapshot | null>> => {
  const fetched = await attempt(() => connection.getAccountInfoAndContext(address, "processed"));
  if (!fetched.ok) return fetched;
  return decodeOwnedAccount(decode, program, address, fetched.value.context.slot, fetched.value.value);
};

export const fetchTable = (program: SandwichProgram, connection: Connection, table: PublicKey) =>
  fetchAccount(decodeTable, program, connection, table);

export const fetchSeat = (program: SandwichProgram, connection: Connection, seat: PublicKey) =>
  fetchAccount(decodeSeat, program, connection, seat);

export type SnapshotListener<Snapshot> = {
  onSnapshot: (snapshot: Snapshot) => void;
  onError?: (reason: string) => void;
};

const watchAccount = <Snapshot>(
  decode: Decoder<Snapshot>,
  feed: AccountFeed,
  program: SandwichProgram,
  address: PublicKey,
  listener: SnapshotListener<Snapshot>,
): (() => void) =>
  feed.watch(address, (change: AccountChange) => {
    const decoded = decodeOwnedAccount(decode, program, address, change.slot, change.account);
    if (!decoded.ok) {
      listener.onError?.(decoded.reason);
      return;
    }
    if (decoded.value !== null) listener.onSnapshot(decoded.value);
  });

export const watchTable = (feed: AccountFeed, program: SandwichProgram, table: PublicKey, listener: SnapshotListener<TableSnapshot>) =>
  watchAccount(decodeTable, feed, program, table, listener);

export const watchSeat = (feed: AccountFeed, program: SandwichProgram, seat: PublicKey, listener: SnapshotListener<SeatSnapshot>) =>
  watchAccount(decodeSeat, feed, program, seat, listener);
