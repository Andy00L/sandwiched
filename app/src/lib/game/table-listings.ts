import type { PublicKey } from "@solana/web3.js";
import { findTableAddress } from "../chain/addresses";

export type TableKind = "public" | "practice";

export type TableListing = { tableId: bigint; kind: TableKind; anteUnits: bigint; boxCount: number; address: PublicKey };

export const TABLE_BOX_COUNT = 3;
export const USDC_UNITS_PER_USDC = 1_000_000n;

const listTable = (tableId: bigint, kind: TableKind, anteUnits: bigint): TableListing => ({
  tableId,
  kind,
  anteUnits,
  boxCount: TABLE_BOX_COUNT,
  address: findTableAddress(tableId),
});

export const PUBLIC_TABLES: readonly TableListing[] = [
  listTable(1_001n, "public", 100_000n),
  listTable(1_002n, "public", 250_000n),
  listTable(1_003n, "public", 1_000_000n),
];

export const PRACTICE_TABLES: readonly TableListing[] = [listTable(2_001n, "practice", 100_000n), listTable(2_002n, "practice", 100_000n), listTable(2_003n, "practice", 100_000n)];

export const ALL_TABLES: readonly TableListing[] = [...PUBLIC_TABLES, ...PRACTICE_TABLES];
