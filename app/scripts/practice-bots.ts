import { mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { createSponsoredFeePayment } from "../src/lib/chain/client";
import { type AccountFeed, createAccountFeed } from "../src/lib/chain/account-feed";
import { ROLLUP_RPC_URL, ROLLUP_WS_URL, SPONSOR_ROUTE_PATH } from "../src/lib/chain/config";
import { loadGuestKey } from "../src/lib/chain/guest-key";
import { createKeypairSigner } from "../src/lib/chain/transport";
import { startBotBrain } from "../src/lib/game/bot-player";
import { DEFAULT_BUY_IN_CHIPS } from "../src/lib/game/guest-chain";
import { LIVE_TIMING } from "../src/lib/game/chain-rules";
import { type GuestSeat, parseTableAddress, reportSettledRounds, seatGuest } from "../src/lib/game/live-table";
import type { Temperament } from "../src/lib/game/round-events";
import { rng } from "../src/lib/papercraft/lib/paperkit-2d.js";
import { createFileKeyStore } from "./file-key-store";

const DEFAULT_ROUTE_URL = `http://localhost:3000${SPONSOR_ROUTE_PATH}`;
const DEFAULT_BOT_COUNT = 3;
const DEFAULT_SEED = 1;
const BOT_KEY_FOLDER = fileURLToPath(new URL("../../.scratch/bots/", import.meta.url));
const TEMPERAMENTS: readonly Temperament[] = ["greedy", "nervous", "vulture"];

const log = (message: string): void => console.log(`[practiceBots] ${message}`);

type RunningBot = { seat: GuestSeat; stopBrain: () => void };

async function startBot(botIndex: number, tableAddressText: string, routeUrl: string, seed: number, feed: AccountFeed): Promise<RunningBot | null> {
  const table = parseTableAddress(tableAddressText);
  if (!table.ok) {
    log(table.reason);
    return null;
  }
  const feePayment = await createSponsoredFeePayment(routeUrl);
  if (!feePayment.ok) {
    log(`bot ${botIndex}: ${feePayment.reason}`);
    return null;
  }
  const temperament = TEMPERAMENTS[botIndex % TEMPERAMENTS.length] ?? "greedy";
  const keyStore = createFileKeyStore(`${BOT_KEY_FOLDER}bot-${botIndex}.json`);
  const seated = await seatGuest({
    table: table.value,
    feePayment: feePayment.value,
    keyStore,
    wallet: createKeypairSigner(loadGuestKey(keyStore).keypair),
    feed,
    signsWith: "session",
    buyInChips: DEFAULT_BUY_IN_CHIPS,
    payout: null,
    isCranking: true,
    antePolicy: "everyRound",
    onStage: (stage) => log(`bot ${botIndex} (${temperament}) ${JSON.stringify(stage)}`),
  });
  if (!seated.ok) {
    log(`bot ${botIndex}: ${seated.reason}`);
    return null;
  }
  log(`bot ${botIndex} (${temperament}) plays as ${seated.value.guest.toBase58()}`);
  const stopBrain = startBotBrain({ store: seated.value.store, perform: seated.value.player.perform, temperament, timing: LIVE_TIMING, random: rng(seed + botIndex) });
  return { seat: seated.value, stopBrain };
}

const [tableAddressText, botCountText, routeUrlText, seedText] = process.argv.slice(2);
if (tableAddressText === undefined) {
  log("usage: bun scripts/practice-bots.ts <table address> [bot count] [sponsor route url] [seed]");
  process.exit(1);
}
mkdirSync(BOT_KEY_FOLDER, { recursive: true, mode: 0o700 });
const botCount = Number(botCountText ?? DEFAULT_BOT_COUNT);
const seed = Number(seedText ?? DEFAULT_SEED);
const feed = createAccountFeed({ rpcUrl: ROLLUP_RPC_URL, wsUrl: ROLLUP_WS_URL });
const bots = (
  await Promise.all(Array.from({ length: botCount }, (_unused, botIndex) => startBot(botIndex, tableAddressText, routeUrlText ?? DEFAULT_ROUTE_URL, seed, feed)))
).filter((bot): bot is RunningBot => bot !== null);
const [firstBot] = bots;
if (firstBot === undefined) process.exit(1);
reportSettledRounds(firstBot.seat.store);
process.on("SIGINT", () => {
  for (const bot of bots) {
    bot.stopBrain();
    bot.seat.close();
  }
  feed.close();
  process.exit(0);
});
