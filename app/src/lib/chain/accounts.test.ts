import { describe, expect, test } from "bun:test";
import { Connection, PublicKey } from "@solana/web3.js";
import { Buffer } from "buffer";
import { decodeSeat, decodeTable } from "./accounts";
import { findEscrowTokenAddress, findSeatAddress, findTableAddress, findTestMintAddress } from "./addresses";
import { SANDWICH_PROGRAM_ID } from "./config";
import seatFixture from "./fixtures/seat.devnet.json";
import tableFixture from "./fixtures/table.devnet.json";
import { createChainPrograms } from "./program";

const program = createChainPrograms(new Connection("http://127.0.0.1:8899")).sandwich;

const IT1_RUN_4 = {
  table: "BmwZZovvZBLLL6WTAAEAFA4Xe1RHqs2iawav9EaE5aQk",
  validator: "MUS3hc9TCw4cGC12vHNoYcCGzJG1txjgQLZWVoeNHNd",
  firstPlayer: "E76WKAVL787Jsx39LbpULx2QSn1PecYJvhTrHAPcvamd",
  whale: "DRGgRFgwnjpqTFJMFondAjVmEaEzjpQrtdoLjLcrDpLF",
  anteUnits: 100_000n,
  boxCount: 3,
  playerCount: 6,
  whaleCrumbs: 588n,
  pigeonCrumbs: 12n,
  swatCount: 33n,
};

const CHIPS_PER_ANTE = 100n;

const decodeFixtureTable = () =>
  decodeTable(program, new PublicKey(tableFixture.address), tableFixture.slot, Buffer.from(tableFixture.dataBase64, "base64"));

const decodeFixtureSeat = () =>
  decodeSeat(program, new PublicKey(seatFixture.address), seatFixture.slot, Buffer.from(seatFixture.dataBase64, "base64"));

describe("decodeTable on the IT-1 run 4 table captured from devnet-us", () => {
  test("reads the configuration IT-1 created the table with", () => {
    const decoded = decodeFixtureTable();
    expect(decoded.ok ? null : decoded.reason).toBeNull();
    if (!decoded.ok) return;
    const table = decoded.value;
    expect(tableFixture.owner).toBe(SANDWICH_PROGRAM_ID.toBase58());
    expect(table.address.toBase58()).toBe(IT1_RUN_4.table);
    expect(findTableAddress(table.tableId).toBase58()).toBe(IT1_RUN_4.table);
    expect(table.validator.toBase58()).toBe(IT1_RUN_4.validator);
    expect(table.mint.equals(findTestMintAddress())).toBe(true);
    expect(table.escrow.equals(findEscrowTokenAddress(table.address, table.mint))).toBe(true);
    expect(table.anteUnits).toBe(IT1_RUN_4.anteUnits);
    expect(table.chipUnits).toBe(IT1_RUN_4.anteUnits / CHIPS_PER_ANTE);
    expect(table.boxCount).toBe(IT1_RUN_4.boxCount);
  });

  test("lists the six seated wallets and leaves the other places empty", () => {
    const decoded = decodeFixtureTable();
    expect(decoded.ok ? null : decoded.reason).toBeNull();
    if (!decoded.ok) return;
    const seated = decoded.value.seats.filter((wallet) => wallet !== null);
    expect(decoded.value.seats).toHaveLength(21);
    expect(seated).toHaveLength(IT1_RUN_4.playerCount);
    expect(decoded.value.seats[0]?.toBase58()).toBe(IT1_RUN_4.firstPlayer);
    expect(decoded.value.seats.slice(IT1_RUN_4.playerCount).every((wallet) => wallet === null)).toBe(true);
  });

  test("reads the settled round: lobby phase, no ante, and a result whose crumbs add up to the antes", () => {
    const decoded = decodeFixtureTable();
    expect(decoded.ok ? null : decoded.reason).toBeNull();
    if (!decoded.ok) return;
    const table = decoded.value;
    expect(table.phase.state).toBe("lobby");
    expect(table.roundNumber).toBe(1n);
    expect(table.antedSeatIndexes).toEqual([]);
    expect(table.round.swatCount).toBe(IT1_RUN_4.swatCount);
    expect(table.round.swats).toHaveLength(8);
    expect(table.round.antedCrumbs).toBe(BigInt(IT1_RUN_4.playerCount) * CHIPS_PER_ANTE);
    expect(table.lastResult?.whaleWallet.toBase58()).toBe(IT1_RUN_4.whale);
    expect(table.lastResult?.whaleCrumbs).toBe(IT1_RUN_4.whaleCrumbs);
    expect(table.lastResult?.pigeonCrumbs).toBe(IT1_RUN_4.pigeonCrumbs);
    expect((table.lastResult?.whaleCrumbs ?? 0n) + (table.lastResult?.pigeonCrumbs ?? 0n)).toBe(table.round.antedCrumbs);
  });

  test("refuses Seat data and truncated data", () => {
    const seatData = Buffer.from(seatFixture.dataBase64, "base64");
    const tableData = Buffer.from(tableFixture.dataBase64, "base64");
    expect(decodeTable(program, PublicKey.default, 0, seatData).ok).toBe(false);
    expect(decodeTable(program, PublicKey.default, 0, tableData.subarray(0, 100)).ok).toBe(false);
  });
});

describe("decodeSeat on the first IT-1 run 4 player captured from devnet-us", () => {
  test("reads the wallet, its place in the seat list and the chips left after the cash out", () => {
    const decoded = decodeFixtureSeat();
    expect(decoded.ok ? null : decoded.reason).toBeNull();
    if (!decoded.ok) return;
    const seat = decoded.value;
    expect(seat.address.equals(findSeatAddress(new PublicKey(IT1_RUN_4.table), new PublicKey(IT1_RUN_4.firstPlayer)))).toBe(true);
    expect(seat.wallet.toBase58()).toBe(IT1_RUN_4.firstPlayer);
    expect(seat.seatIndex).toBe(0);
    expect(seat.chips).toBe(0n);
    expect(seat.lastSwatNumber).toBe(IT1_RUN_4.swatCount);
    expect(["hovering", "flying", "perched", "stunned"]).toContain(seat.pigeon.state);
  });

  test("refuses Table data", () => {
    expect(decodeSeat(program, PublicKey.default, 0, Buffer.from(tableFixture.dataBase64, "base64")).ok).toBe(false);
  });
});
