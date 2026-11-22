import { expect, jest, test } from "bun:test";
import type { IdlAccounts } from "@coral-xyz/anchor";
import { Connection, Keypair, PublicKey } from "@solana/web3.js";
import { Buffer } from "buffer";
import type { AccountChange, AccountFeed } from "../chain/account-feed";
import { findSeatAddress } from "../chain/addresses";
import { SANDWICH_PROGRAM_ID } from "../chain/config";
import tableFixture from "../chain/fixtures/table.devnet.json";
import type { Sandwich } from "../chain/idl/sandwich";
import { createChainPrograms } from "../chain/program";
import { connectTableStore } from "./live-table";
import { createTableStore } from "./table-store";

const program = createChainPrograms(new Connection("http://127.0.0.1:8899")).sandwich;
const TABLE_ADDRESS = new PublicKey(tableFixture.address);
const PUBLIC_KEY_BYTES = 32;

function createFakeFeed() {
  const watched = new Map<string, (change: AccountChange) => void>();
  const feed: AccountFeed = {
    watch: (address, onChange) => {
      watched.set(address.toBase58(), onChange);
      return () => watched.delete(address.toBase58());
    },
    status: () => "live",
    close: () => watched.clear(),
  };
  return { feed, watched };
}

function encodeTableWithSeats(wallets: readonly (PublicKey | null)[], slot: number): AccountChange {
  const data = Buffer.from(tableFixture.dataBase64, "base64");
  const decoded = program.coder.accounts.decode<IdlAccounts<Sandwich>["table"]>("table", data);
  const anchorIndex = decoded.seats.findIndex((wallet) => !wallet.equals(PublicKey.default));
  const anchorWallet = decoded.seats[anchorIndex] ?? PublicKey.default;
  const seatsOffset = data.indexOf(anchorWallet.toBuffer()) - anchorIndex * PUBLIC_KEY_BYTES;
  decoded.seats.forEach((_wallet, index) => (wallets[index] ?? PublicKey.default).toBuffer().copy(data, seatsOffset + index * PUBLIC_KEY_BYTES));
  return { address: TABLE_ADDRESS, slot, account: { owner: SANDWICH_PROGRAM_ID, data } };
}

test("stops watching the seat of a wallet that left the table", async () => {
  jest.useFakeTimers();
  const { feed, watched } = createFakeFeed();
  const [stayer, leaver] = [Keypair.generate().publicKey, Keypair.generate().publicKey];
  const disconnect = connectTableStore(createTableStore({ ownWallet: null, horizonTicks: 0, now: () => 0 }), { feed, program, table: TABLE_ADDRESS });
  const deliverTable = watched.get(TABLE_ADDRESS.toBase58());
  expect(deliverTable).toBeDefined();

  deliverTable?.(encodeTableWithSeats([stayer, leaver], 100));
  expect(watched.has(findSeatAddress(TABLE_ADDRESS, leaver).toBase58())).toBe(true);
  deliverTable?.(encodeTableWithSeats([stayer, null], 200));
  expect(watched.has(findSeatAddress(TABLE_ADDRESS, leaver).toBase58())).toBe(false);
  expect(watched.has(findSeatAddress(TABLE_ADDRESS, stayer).toBase58())).toBe(true);

  disconnect();
  jest.useRealTimers();
});
