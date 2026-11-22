import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { type Keypair, SystemProgram } from "@solana/web3.js";
import { fetchTable } from "../src/lib/chain/accounts";
import { ensureTestMintAndVault, fetchValidatorIdentity, openTable } from "../src/lib/chain/admin";
import { type ChainClient, createChainClient } from "../src/lib/chain/client";
import { restoreKeypair } from "../src/lib/chain/guest-key";
import type { KeyStore } from "../src/lib/chain/key-store";
import { type Result, attempt, attemptSync, failure, success } from "../src/lib/chain/result";
import { type TransactionSigner, createKeypairSigner, sendOnBase } from "../src/lib/chain/transport";
import { DEFAULT_BUY_IN_CHIPS, createGuestPlayChain } from "../src/lib/game/guest-chain";
import { prepareGuest } from "../src/lib/game/guest-steps";
import { derivePracticeBotKeys } from "../src/lib/game/practice-table";
import { ALL_TABLES, type TableListing } from "../src/lib/game/table-listings";
import { createFileKeyStore } from "./file-key-store";

const DEFAULT_ADMIN_KEYPAIR_PATH = join(homedir(), ".config", "solana", "id.json");
const BOT_STORE_FOLDER = fileURLToPath(new URL("../../.scratch/practice-bots/", import.meta.url));
const BOT_MIN_LAMPORTS = 20_000_000;
const BOT_FUND_LAMPORTS = 50_000_000;
const MAX_ATTEMPTS_PER_STEP = 6;
const RETRY_DELAY_MS = 1_500;
const SETTLE_DELAY_MS = 1_200;

const log = (message: string): void => console.log(`[openTables] ${message}`);

const wait = (milliseconds: number) => new Promise<void>((resolve) => setTimeout(resolve, milliseconds));

const readAdminKeypair = (path: string): Result<Keypair> => {
  if (!existsSync(path)) return failure(`[readAdminKeypair] missing ${path}`);
  const parsed = attemptSync((): unknown => JSON.parse(readFileSync(path, "utf8")));
  const keypair = parsed.ok ? restoreKeypair(parsed.value) : null;
  return keypair === null ? failure(`[readAdminKeypair] ${path} is not a keypair file`) : success(keypair);
};

async function fundBot(client: ChainClient, admin: TransactionSigner, bot: Keypair): Promise<Result<number>> {
  const balance = await attempt(() => client.base.getBalance(bot.publicKey, "confirmed"));
  if (!balance.ok) return failure(`[fundBot] ${balance.reason}`);
  const lamports = balance.value;
  if (lamports >= BOT_MIN_LAMPORTS) return success(lamports);
  const transfer = SystemProgram.transfer({ fromPubkey: admin.publicKey, toPubkey: bot.publicKey, lamports: BOT_FUND_LAMPORTS });
  const sent = await sendOnBase(client.base, client.feePayment, [transfer], [admin]);
  return sent.ok ? success(lamports + BOT_FUND_LAMPORTS) : failure(`[fundBot] ${sent.reason}`);
}

async function seatPracticeBots(client: ChainClient, admin: TransactionSigner, listing: TableListing, keyStore: KeyStore): Promise<void> {
  const tableSnapshot = await fetchTable(client.programs.sandwich, client.rollup, listing.address);
  if (!tableSnapshot.ok || tableSnapshot.value === null) {
    log(`table ${listing.tableId}: cannot read it on the rollup, bots not seated`);
    return;
  }
  const bots = await derivePracticeBotKeys(listing.address);
  if (!bots.ok) {
    log(`table ${listing.tableId}: ${bots.reason}`);
    return;
  }
  for (const [botIndex, bot] of bots.value.entries()) {
    const funded = await fundBot(client, admin, bot);
    if (!funded.ok) {
      log(`table ${listing.tableId} bot ${botIndex}: ${funded.reason}`);
      continue;
    }
    const wallet = createKeypairSigner(bot);
    const play = createGuestPlayChain({ client, wallet, table: listing.address, tableSnapshot: tableSnapshot.value, keyStore, signsWith: "wallet", buyInChips: DEFAULT_BUY_IN_CHIPS });
    const stage = await prepareGuest(play.guest, {
      needs: play.needs,
      maxAttemptsPerStep: MAX_ATTEMPTS_PER_STEP,
      retryDelayMs: RETRY_DELAY_MS,
      settleDelayMs: SETTLE_DELAY_MS,
      onStage: () => undefined,
      wait,
      isStopped: () => false,
    });
    log(`table ${listing.tableId} bot ${botIndex} ${bot.publicKey.toBase58()}: ${JSON.stringify(stage)}`);
  }
}

async function openListedTable(client: ChainClient, admin: TransactionSigner, listing: TableListing): Promise<Result<string>> {
  const existing = await fetchTable(client.programs.sandwich, client.rollup, listing.address);
  if (!existing.ok) return existing;
  if (existing.value !== null) return success("already open");
  const mint = await ensureTestMintAndVault(client, admin);
  if (!mint.ok) return mint;
  const validator = await fetchValidatorIdentity(client.rollup);
  if (!validator.ok) return validator;
  const opened = await openTable(client, admin, { tableId: listing.tableId, anteUnits: listing.anteUnits, boxCount: listing.boxCount, validator: validator.value, mint: mint.value });
  return opened.ok ? success("opened") : opened;
}

const adminKeypair = readAdminKeypair(process.argv[2] ?? DEFAULT_ADMIN_KEYPAIR_PATH);
if (!adminKeypair.ok) {
  log(adminKeypair.reason);
  process.exit(1);
}
mkdirSync(BOT_STORE_FOLDER, { recursive: true, mode: 0o700 });
const client = createChainClient({ kind: "wallet" });
const admin = createKeypairSigner(adminKeypair.value);
const botStore = createFileKeyStore(`${BOT_STORE_FOLDER}records.json`);
for (const listing of ALL_TABLES) {
  const opened = await openListedTable(client, admin, listing);
  log(`${listing.kind} table ${listing.tableId} ${listing.address.toBase58()}: ${opened.ok ? opened.value : opened.reason}`);
  if (opened.ok && listing.kind === "practice") await seatPracticeBots(client, admin, listing, botStore);
}
process.exit(0);
