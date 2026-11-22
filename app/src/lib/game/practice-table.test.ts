import { describe, expect, test } from "bun:test";
import type { PublicKey } from "@solana/web3.js";
import { buildTableSnapshot, findTestWallet } from "../../../tests/fake-chain";
import { PRACTICE_BOT_COUNT, chooseBotDriver, choosePracticeTable, derivePracticeBotKeys } from "./practice-table";
import type { TableListing } from "./table-listings";

const TABLE_SEATS = 21;
const BOTS = [findTestWallet(10), findTestWallet(11)];
const GUEST = findTestWallet(1);
const OTHER_HUMAN = findTestWallet(2);

const seatAt = (placed: ReadonlyArray<readonly [number, PublicKey]>): (PublicKey | null)[] => {
  const seats: (PublicKey | null)[] = Array.from({ length: TABLE_SEATS }, () => null);
  for (const [seatIndex, wallet] of placed) seats[seatIndex] = wallet;
  return seats;
};

const listTestTable = (tableId: bigint): TableListing => ({ tableId, kind: "practice", anteUnits: 100_000n, boxCount: 3, address: findTestWallet(Number(tableId)) });
const firstListing = listTestTable(50n);
const secondListing = listTestTable(51n);

describe("chooseBotDriver", () => {
  test("is the lowest seat among humans who anted and this browser's own guest", () => {
    const seats = seatAt([[0, BOTS[0] ?? GUEST], [3, OTHER_HUMAN], [5, GUEST], [7, BOTS[1] ?? GUEST]]);
    expect(chooseBotDriver({ seats, antedSeatIndexes: [0, 3, 5] }, BOTS, GUEST)?.equals(OTHER_HUMAN)).toBe(true);
  });

  test("passes over a human who left without anteing, so a gone visitor never blocks the bots", () => {
    const seats = seatAt([[0, BOTS[0] ?? GUEST], [3, OTHER_HUMAN], [5, GUEST]]);
    expect(chooseBotDriver({ seats, antedSeatIndexes: [0] }, BOTS, GUEST)?.equals(GUEST)).toBe(true);
  });

  test("is nobody while only bots sit", () => {
    expect(chooseBotDriver({ seats: seatAt([[0, BOTS[0] ?? GUEST]]), antedSeatIndexes: [0] }, BOTS, GUEST)).toBeNull();
  });
});

describe("choosePracticeTable", () => {
  test("goes back to the table the guest already sits at, even when it is busier", () => {
    const busy = buildTableSnapshot({ seats: seatAt([[0, OTHER_HUMAN], [1, GUEST]]) });
    const empty = buildTableSnapshot({ seats: seatAt([]) });
    const chosen = choosePracticeTable([{ listing: firstListing, table: empty, bots: BOTS }, { listing: secondListing, table: busy, bots: BOTS }], GUEST);
    expect(chosen?.tableId).toBe(secondListing.tableId);
  });

  test("picks the table with the fewest humans, counting bots as no one", () => {
    const crowded = buildTableSnapshot({ seats: seatAt([[0, OTHER_HUMAN]]) });
    const botsOnly = buildTableSnapshot({ seats: seatAt([[0, BOTS[0] ?? GUEST], [1, BOTS[1] ?? GUEST]]) });
    const chosen = choosePracticeTable([{ listing: firstListing, table: crowded, bots: BOTS }, { listing: secondListing, table: botsOnly, bots: BOTS }], GUEST);
    expect(chosen?.tableId).toBe(secondListing.tableId);
  });

  test("skips tables that are missing or full", () => {
    const full = buildTableSnapshot({ seats: Array.from({ length: TABLE_SEATS }, (_unused, seatIndex) => findTestWallet(100 + seatIndex)) });
    expect(choosePracticeTable([{ listing: firstListing, table: full, bots: BOTS }, { listing: secondListing, table: null, bots: BOTS }], GUEST)).toBeNull();
  });
});

describe("derivePracticeBotKeys", () => {
  test("gives every browser the same bots for a table, and other bots for another table", async () => {
    const [first, again, other] = await Promise.all([
      derivePracticeBotKeys(firstListing.address),
      derivePracticeBotKeys(firstListing.address),
      derivePracticeBotKeys(secondListing.address),
    ]);
    expect([first.ok, again.ok, other.ok]).toEqual([true, true, true]);
    if (!first.ok || !again.ok || !other.ok) return;
    const names = (keys: typeof first.value) => keys.map((key) => key.publicKey.toBase58());
    expect(names(first.value)).toEqual(names(again.value));
    expect(new Set([...names(first.value), ...names(other.value)]).size).toBe(PRACTICE_BOT_COUNT * 2);
  });
});
