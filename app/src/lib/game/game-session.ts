import * as P2 from "papercraft/lib/paperkit-2d.js";
import { PALETTE } from "../table/palette";
import type { SignpostLook } from "../table/pieces/signpost";
import { loadRecordedRound } from "../table/replay/recorded-rounds";
import { REPLAY_LEAD_S } from "../table/replay/replay-scene";
import type { SignpostPlacement } from "../table/scene";
import { CHIPS_PER_ANTE, LIVE_TIMING, MAX_SEATS, TICK_MS } from "./chain-rules";
import { type PlayController, createPlayController } from "./play-controller";
import { ROUND_SCHEMA_VERSION, type RecordedRound } from "./round-events";
import { type RoundSource, createReplaySource, createSwitchableSource } from "./round-source";
import { PRACTICE_TABLES, PUBLIC_TABLES, TABLE_BOX_COUNT, type TableListing, USDC_UNITS_PER_USDC } from "./table-listings";
import { describeLivePlayer } from "./table-store";

const ATTRACT_ROUND = "slam-showcase";
const PAPER_TILE_PX = 384;
const PAPER_PAGE = "#ebddbf";

const LIVE_PLAYERS = Array.from({ length: MAX_SEATS }, (_unused, seat) => describeLivePlayer(seat));

const EMPTY_ROUND: RecordedRound = {
  version: ROUND_SCHEMA_VERSION,
  seed: 0,
  tickMs: TICK_MS,
  boxCount: TABLE_BOX_COUNT,
  timing: LIVE_TIMING,
  chipsPerAnte: CHIPS_PER_ANTE,
  players: LIVE_PLAYERS,
  events: [],
};

const EMPTY_SOURCE: RoundSource = {
  players: LIVE_PLAYERS,
  boxCount: TABLE_BOX_COUNT,
  tickMs: TICK_MS,
  timing: LIVE_TIMING,
  latestRound: () => EMPTY_ROUND,
  tickAt: () => 0,
};

export const formatUsdc = (units: bigint): string => {
  const cents = (units * 100n) / USDC_UNITS_PER_USDC;
  return `${cents / 100n}.${(cents % 100n).toString().padStart(2, "0")}`;
};

type SignpostSpot = { x: number; z: number };

const PRACTICE_SPOT: SignpostSpot = { x: 21, z: 1 };
const PUBLIC_SPOTS: readonly SignpostSpot[] = [
  { x: -25, z: -2 },
  { x: -27, z: -13 },
  { x: 28, z: -12 },
];
const PUBLIC_BOARDS = [PALETTE.creamCore, PALETTE.creamCore, PALETTE.creamCore];

function listSignposts(controller: PlayController): SignpostPlacement[] {
  const canPick = () => controller.getSnapshot().flow.kind === "home";
  const place = (listing: TableListing, spot: SignpostSpot, look: SignpostLook): SignpostPlacement => ({
    ...spot,
    look,
    canPick,
    onPick: () => controller.pickTable(listing),
  });
  const [practice] = PRACTICE_TABLES;
  const practicePost =
    practice === undefined
      ? []
      : [place(practice, PRACTICE_SPOT, { title: "PRACTICE", caption: "with bots", board: PALETTE.mustard, ink: PALETTE.ink, pointsLeft: false, scale: 1.6, name: "signpost practice" })];
  const publicPosts = PUBLIC_TABLES.flatMap((listing, index) => {
    const spot = PUBLIC_SPOTS[index];
    if (spot === undefined) return [];
    const look: SignpostLook = {
      title: `ANTE ${formatUsdc(listing.anteUnits)}`,
      caption: "test USDC",
      board: PUBLIC_BOARDS[index] ?? PALETTE.creamCore,
      ink: PALETTE.ink,
      pointsLeft: spot.x > 0,
      scale: 1.3,
      name: `signpost table ${listing.tableId}`,
    };
    return [place(listing, spot, look)];
  });
  return [...practicePost, ...publicPosts];
}

function installPaperTexture(): void {
  const tile = P2.paperSheet({ size: PAPER_TILE_PX, color: PAPER_PAGE, fibres: 0.7, mottle: 0.04 });
  document.documentElement.style.setProperty("--paper", `url(${tile.toDataURL()})`);
}

export type GameSession = { controller: PlayController; start: () => void };

export function createGameSession(): GameSession {
  const switchable = createSwitchableSource(EMPTY_SOURCE, LIVE_PLAYERS);
  let isLive = false;
  const controller = createPlayController({
    onLiveSource: (source) => {
      isLive = true;
      switchable.switchTo(source);
    },
  });
  const start = () => {
    installPaperTexture();
    window.addEventListener("keydown", controller.handleKey);
    void loadRecordedRound(ATTRACT_ROUND).then((loaded) => {
      if (!loaded.ok) {
        console.warn(`[createGameSession] attract round: ${loaded.reason}`);
        return;
      }
      if (!isLive) switchable.switchTo(createReplaySource(loaded.round, REPLAY_LEAD_S));
    });
    void import("../table/scene").then(({ buildGameScene }) =>
      buildGameScene({ source: switchable.source, onClick: controller.clickTable, signposts: listSignposts(controller) }),
    );
  };
  return { controller, start };
}
