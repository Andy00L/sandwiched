import { Keypair, type PublicKey } from "@solana/web3.js";
import type { AccountFeed } from "../chain/account-feed";
import { type TableSnapshot, fetchTable, watchTable } from "../chain/accounts";
import { createChainClient } from "../chain/client";
import { type KeyStore, createBrowserKeyStore } from "../chain/key-store";
import { loadGuestKey } from "../chain/guest-key";
import { type Result, attempt, failure, success } from "../chain/result";
import { createKeypairSigner } from "../chain/transport";
import { rng } from "../papercraft/lib/paperkit-2d.js";
import { startBotBrain } from "./bot-player";
import { LIVE_TIMING } from "./chain-rules";
import { DEFAULT_BUY_IN_CHIPS } from "./guest-chain";
import type { GuestStage } from "./guest-steps";
import { type CompanionSeat, type GuestSeat, type LivePlay, openLivePlay, seatGuest } from "./live-table";
import type { Temperament } from "./round-events";
import type { AntePolicy } from "./table-player";
import { PRACTICE_TABLES, type TableListing } from "./table-listings";

export const PRACTICE_BOT_COUNT = 6;
export const PRACTICE_BOT_TEMPERAMENTS: readonly Temperament[] = ["greedy", "nervous", "vulture"];
const BOT_SEED_LABEL = "sandwich practice bot v1";

export async function derivePracticeBotKeys(table: PublicKey): Promise<Result<Keypair[]>> {
  const label = new TextEncoder().encode(BOT_SEED_LABEL);
  return attempt(() =>
    Promise.all(
      Array.from({ length: PRACTICE_BOT_COUNT }, async (_unused, botIndex) => {
        const digest = await crypto.subtle.digest("SHA-256", new Uint8Array([...label, botIndex, ...table.toBytes()]));
        return Keypair.fromSeed(new Uint8Array(digest));
      }),
    ),
  );
}

const isBotWallet = (wallet: PublicKey, bots: readonly PublicKey[]) => bots.some((bot) => bot.equals(wallet));

export type DriverView = { seats: readonly (PublicKey | null)[]; antedSeatIndexes: readonly number[] };

export function chooseBotDriver(table: DriverView, bots: readonly PublicKey[], self: PublicKey): PublicKey | null {
  const isCandidate = (wallet: PublicKey, seatIndex: number) =>
    !isBotWallet(wallet, bots) && (wallet.equals(self) || table.antedSeatIndexes.includes(seatIndex));
  return table.seats.find((wallet, seatIndex): wallet is PublicKey => wallet !== null && isCandidate(wallet, seatIndex)) ?? null;
}

export type PracticeCandidate = { listing: TableListing; table: TableSnapshot | null; bots: readonly PublicKey[] };

export function choosePracticeTable(candidates: readonly PracticeCandidate[], guest: PublicKey): TableListing | null {
  const open = candidates.flatMap((candidate) => (candidate.table === null ? [] : [{ ...candidate, table: candidate.table }]));
  const alreadySeated = open.find((candidate) => candidate.table.seats.some((wallet) => wallet?.equals(guest) === true));
  if (alreadySeated !== undefined) return alreadySeated.listing;
  const countHumans = (table: TableSnapshot, bots: readonly PublicKey[]) =>
    table.seats.filter((wallet) => wallet !== null && !isBotWallet(wallet, bots)).length;
  const withRoom = open.filter((candidate) => candidate.table.seats.some((wallet) => wallet === null));
  const quietest = withRoom.toSorted((left, right) => countHumans(left.table, left.bots) - countHumans(right.table, right.bots))[0];
  return quietest?.listing ?? null;
}

export async function findPracticeTable(guest: PublicKey): Promise<Result<TableListing>> {
  const client = createChainClient({ kind: "wallet" });
  const candidates = await Promise.all(
    PRACTICE_TABLES.map(async (listing): Promise<Result<PracticeCandidate>> => {
      const [table, bots] = await Promise.all([fetchTable(client.programs.sandwich, client.rollup, listing.address), derivePracticeBotKeys(listing.address)]);
      if (!table.ok) return table;
      if (!bots.ok) return bots;
      return success({ listing, table: table.value, bots: bots.value.map((bot) => bot.publicKey) });
    }),
  );
  const readable = candidates.flatMap((candidate) => (candidate.ok ? [candidate.value] : []));
  const chosen = choosePracticeTable(readable, guest);
  if (chosen !== null) return success(chosen);
  const reasons = candidates.flatMap((candidate) => (candidate.ok ? [] : [candidate.reason]));
  return failure(`[findPracticeTable] no practice table has room${reasons.length > 0 ? `: ${reasons.join("; ")}` : ""}`);
}

type RunningBot = { seat: GuestSeat; stopBrain: () => void };

type BotCrew = { kind: "parked" } | { kind: "starting"; isWanted: boolean } | { kind: "driving"; running: RunningBot[] } | { kind: "closed" };

export type PracticeBotsSetup = { table: PublicKey; feed: AccountFeed; keyStore: KeyStore; bots: readonly Keypair[]; driver: PublicKey; seed: number };

const stopBots = (running: readonly RunningBot[]) => {
  for (const bot of running) {
    bot.stopBrain();
    bot.seat.close();
  }
};

const reportBotStage = (botIndex: number) => (stage: GuestStage) => {
  if (stage.kind === "failed") console.warn(`[drivePracticeBots] bot ${botIndex} ${stage.step}: ${stage.reason}`);
};

async function startBot(setup: PracticeBotsSetup, bot: Keypair, botIndex: number): Promise<RunningBot | null> {
  const seated = await seatGuest({
    table: setup.table,
    feePayment: { kind: "wallet" },
    keyStore: setup.keyStore,
    wallet: createKeypairSigner(bot),
    feed: setup.feed,
    signsWith: "wallet",
    buyInChips: DEFAULT_BUY_IN_CHIPS,
    payout: null,
    isCranking: false,
    antePolicy: "everyRound",
    onStage: reportBotStage(botIndex),
  });
  if (!seated.ok) {
    console.warn(`[drivePracticeBots] bot ${botIndex}: ${seated.reason}`);
    return null;
  }
  const temperament = PRACTICE_BOT_TEMPERAMENTS[botIndex % PRACTICE_BOT_TEMPERAMENTS.length] ?? "greedy";
  const stopBrain = startBotBrain({ store: seated.value.store, perform: seated.value.player.perform, temperament, timing: LIVE_TIMING, random: rng(setup.seed + botIndex) });
  return { seat: seated.value, stopBrain };
}

export function drivePracticeBots(setup: PracticeBotsSetup): () => void {
  const program = createChainClient({ kind: "wallet" }).programs.sandwich;
  const botWallets = setup.bots.map((bot) => bot.publicKey);
  let crew: BotCrew = { kind: "parked" };

  const launch = async () => {
    const started = await Promise.all(setup.bots.map((bot, botIndex) => startBot(setup, bot, botIndex)));
    const running = started.filter((bot): bot is RunningBot => bot !== null);
    if (crew.kind === "starting" && crew.isWanted) {
      crew = { kind: "driving", running };
      return;
    }
    stopBots(running);
    if (crew.kind !== "closed") crew = { kind: "parked" };
  };

  const steer = (table: TableSnapshot) => {
    const isWanted = chooseBotDriver(table, botWallets, setup.driver)?.equals(setup.driver) === true;
    switch (crew.kind) {
      case "parked":
        if (!isWanted) return;
        crew = { kind: "starting", isWanted };
        void launch();
        return;
      case "starting":
        crew = { kind: "starting", isWanted };
        return;
      case "driving":
        if (isWanted) return;
        stopBots(crew.running);
        crew = { kind: "parked" };
        return;
      case "closed":
        return;
    }
  };

  const stopWatching = watchTable(setup.feed, program, setup.table, {
    onSnapshot: steer,
    onError: (reason) => console.warn(`[drivePracticeBots] ${reason}`),
  });
  return () => {
    stopWatching();
    if (crew.kind === "driving") stopBots(crew.running);
    crew = { kind: "closed" };
  };
}

const PRACTICE_BOT_SEED = 1;

export async function openPracticePlay(
  timeoutMs: number,
  antePolicy: AntePolicy,
  payout: PublicKey | null,
  onStage: (stage: GuestStage) => void,
): Promise<Result<LivePlay>> {
  const keyStore = createBrowserKeyStore();
  const guestKey = loadGuestKey(keyStore).keypair;
  const listing = await findPracticeTable(guestKey.publicKey);
  if (!listing.ok) return listing;
  const bots = await derivePracticeBotKeys(listing.value.address);
  if (!bots.ok) return failure(`[openPracticePlay] ${bots.reason}`);
  const startCompanions = (seat: CompanionSeat) =>
    drivePracticeBots({ table: seat.table, feed: seat.feed, keyStore: seat.keyStore, bots: bots.value, driver: seat.guest, seed: PRACTICE_BOT_SEED });
  return openLivePlay({ table: listing.value.address, keyStore, wallet: createKeypairSigner(guestKey), timeoutMs, buyInChips: DEFAULT_BUY_IN_CHIPS, payout, antePolicy, onStage, startCompanions });
}
