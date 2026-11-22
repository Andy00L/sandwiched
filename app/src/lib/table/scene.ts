/*
PAPER SPEC: Sandwich, the table scene
BRIEF      A city park at lunch hour on a clear early-autumn day. A picnic table. A whale in a business suit guards
           three lunchboxes from city pigeons. Comic, warm, a little absurd. Must have: one readable whale face, up to
           20 pigeons that never blur into a flock, three lunchboxes told apart at a glance, a slam that is the best
           frame of the game. Must not: gore, realistic birds, a casino look, any crypto logo in the scene.
           Reference: x.com/xikhar/status/2123941283320479918 (already papercraft): the craft only, no subject.
SUBJECT    A lunch stolen in public. The thieves fold flat when hit and pop back up. The eye goes to the whale's face,
           then to the box under its flipper.
STOCK      cardstock for characters and props, kraft for the table and benches, tissue for lettuce and napkins,
           corrugated for lunchbox sides; one quiet fibre (felt 0.6 to 0.8) on every sheet.
PALETTE    plan/06 section 2 (lib/table/palette.ts): lawn #b4c08f / #8fa274, path #d6ccae, kraft #c58a4b / #96602f,
           whale #5e7f97 / #c7d5da, suit #2e3a50, tomato #d5452e, mustard #e0a62c, teal #3c998c, pigeon #8e96a3 /
           #5b6472, plum #8a5a84, ink #3b2a22, cream #f2e6cb, shadow leak #a0602c, contact #5a3214.
LIGHT      warm day key #ffdcb2 3.0 from the left, 55 deg off the camera axis, 50 deg up; frontal fill #f2dcc2 0.8;
           sky #fff0da over #b39a78 0.42; leak #a0602c.
LENS       fov 26, pitch 47, dist 70 on the table top; focusBand 0.3, ramp 0.3, max blur 16 px; hedges, a bin and a
           bench back overlap the bottom edge; tree crowns cut by the top edge.
FORMAT     game 16:9 fluid, authored at 1920x1080; video 1920x1080 at 60 fps; X clips 1080x1080 and 1080x1920.
GROUND     mown lawn with soft stripes, a gravel path bending twice, a flagstone picnic pad under the table, leaf litter
           under the trees, grass ticks in drifts.
LAYOUT     the path enters bottom left, passes behind the table, leaves top right; the table on its pad at the centre,
           turned 26 deg; the whale behind it, right of centre; groups of 4 to 8 around it; clearings outside the band.
MOTION     hinge rotation only, FlapSpring rise and fall; the slam is the one bold motion (plan/07).
LIFE       falling leaves, cloud shadows, park pigeons pecking, a duck on the fountain, a shy squirrel.
TYPES      card, layered card, cross (trees, lamp post), box fold (lunchboxes, bin, bench), built ground (table deck on
           legs, benches), figure models (whale, pigeons), movers (flipper, lids, eye wheel), life.
SOUND      paper flaps and mouth-made voices (plan/08).
BANNED     look.md section 12, plus neon, glow, coin sparkles, floating numbers, confetti, screen shake, squash and
           stretch, any HUD panel that is not paper.
QA         plan/06 section 9: F0 to F13 captured with restart(); step(T).
*/
import { createHarness } from "papercraft/harness.js";
import type { Harness } from "papercraft/harness.js";
import type { Object3D } from "three";
import type { GuestStage } from "../game/guest-steps";
import { loadGuestKey } from "../chain/guest-key";
import { createBrowserKeyStore } from "../chain/key-store";
import type { Result } from "../chain/result";
import { type LivePlay, openLivePlay, openLiveRoundSource, parseTableAddress } from "../game/live-table";
import { openPracticePlay } from "../game/practice-table";
import type { ClickTarget } from "../game/click-intent";
import { DEFAULT_BUY_IN_CHIPS } from "../game/guest-chain";
import { createReplaySource, type RoundSource } from "../game/round-source";
import { GROUND_INKS } from "./palette";
import { placeOnTable } from "./layout";
import { buildLunchbox, LUNCHBOX_LOOKS, type LunchboxModel } from "./pieces/lunchbox";
import { buildLawnFillers } from "./pieces/lawn";
import { buildCrumbScatter, buildLunchClutter } from "./pieces/lunch";
import { buildFlowerBed, buildHedge, buildLampPost, buildLitterBin, buildParkBench, buildParkSign, buildPlaneTree } from "./pieces/park";
import { PIGEON_VARIANTS, printCropBags, printPigeonKit, sittingPigeonCard } from "./pieces/pigeon";
import { placeStandingPigeon } from "./pieces/pigeon-puppet";
import { buildPicnicTable } from "./pieces/table";
import { buildWhale, buildWhaleFluke } from "./pieces/whale";
import { WHALE_MOODS } from "./pieces/whale-face";
import type { WhaleFace } from "./pieces/whale-face";
import { BOX_ROW_DECK_Z, BOX_SPACING_UNITS, boxAlong } from "./replay/perches";
import { loadRecordedRound } from "./replay/recorded-rounds";
import { buildReplayScene, REPLAY_LEAD_S } from "./replay/replay-scene";
import { listenForTableClicks } from "./stage/box-picking";
import { type SignpostLook, buildSignpost } from "./pieces/signpost";
import { buildTitleBanner } from "./pieces/title-banner";
import { type CameraShot, directCameraShots } from "./stage/camera-shots";
import { recordFrameTimes } from "./stage/frame-recorder";
import { buildParkLife } from "./stage/park-life";
import { printParkGround } from "./stage/park-ground";
import { trimHiddenBacksOnceRisen } from "./stage/hidden-backs";
import { probeQualityTier, storedQuality } from "./stage/quality-probe";
import { PAPER_STOCK, PARK_LENS, PARK_LIGHT, PARK_TEST_VIEW, PARK_VIEW, SCENE_FOCUS, TABLE_YAW_RAD, TEST_CARD_SPOT } from "./stage/look";

const LIVE_TABLE_TIMEOUT_MS = 20_000;
const ignoreClick = (): void => undefined;
const PLAY_WAIT_MS = 600_000;

type SceneMode = { kind: "sample" } | { kind: "rounds"; source: RoundSource; onClick: ((target: ClickTarget) => void) | null };

export type SignpostPlacement = { x: number; z: number; look: SignpostLook; canPick: () => boolean; onPick: () => void };

export type GameScenePorts = {
  source: RoundSource;
  onClick: (target: ClickTarget) => void;
  signposts: readonly SignpostPlacement[];
  readShot: () => CameraShot;
};

const TITLE_BANNER_SPOT = { x: 1, z: -31, halfWidth: 12 };


function buildTestCards(harness: Harness): void {
  const [outline, paint] = sittingPigeonCard();
  const [cardX, cardZ] = TEST_CARD_SPOT;
  const pigeon = harness.popup(outline, paint, { x: cardX, z: cardZ });
  harness.setHero(pigeon);
}

function buildParkDressing(harness: Harness): void {
  const [signX, signZ] = placeOnTable([-21, -5]);
  buildParkSign(harness, signX, signZ);
  const [binX, binZ] = placeOnTable([21.5, 3.5]);
  buildLitterBin(harness, binX, binZ);
  buildPlaneTree(harness, -27, -26, 31);
  buildPlaneTree(harness, 30, -31, 37);
  buildPlaneTree(harness, -38, -12, 61);
  buildHedge(harness, -31, 1, 41);
  buildHedge(harness, -27, -9, 53, 0.8);
  buildHedge(harness, -35, 8, 67, 1.1);
  buildHedge(harness, 31, -9, 59, 0.9);
  buildHedge(harness, 34, 1, 71, 1.2);
  buildHedge(harness, 27, 21, 43, 1.9);
  buildHedge(harness, -22, 24, 47, 2.0);
  buildLitterBin(harness, -24, 10);
  buildFlowerBed(harness, -30, -3, 73);
  buildLampPost(harness, -26, -14);
  buildParkBench(harness, -36, -18);
  buildFlowerBed(harness, 29, -3, 79);
  buildLampPost(harness, 25, -16);
  buildParkBench(harness, 33, -20);
  buildFlowerBed(harness, 36, 9, 83);
}

function buildPark(harness: Harness, mode: SceneMode): readonly LunchboxModel[] {
  const picnicTable = buildPicnicTable(harness);
  const { table, deck, backBenchAcross } = picnicTable;
  const boxOrder = table.order + 0.6;
  const boxes = LUNCHBOX_LOOKS.map((look, boxIndex) =>
    buildLunchbox(harness, look, boxIndex, deck, boxAlong(boxIndex, LUNCHBOX_LOOKS.length), BOX_ROW_DECK_Z, boxOrder + boxIndex * 0.15),
  );
  buildLunchClutter(harness, deck, boxOrder + 1.0);

  const [whaleX, whaleZ] = placeOnTable([3.2, backBenchAcross - 1.6]);
  const whaleModel = buildWhale(harness, whaleX, whaleZ, TABLE_YAW_RAD * 0.45);
  const [flukeX, flukeZ] = placeOnTable([13.5, backBenchAcross - 3.6]);
  buildWhaleFluke(harness, flukeX, flukeZ);
  buildParkDressing(harness);
  buildLawnFillers(harness);
  buildParkLife(harness);

  if (mode.kind === "rounds") {
    buildReplayScene(harness, picnicTable, whaleModel, boxes, mode.source);
  } else {
    buildSamplePigeons(harness, deck, boxOrder + 0.8);
    buildCrumbScatter(harness, deck, 3.6, BOX_ROW_DECK_Z + 1.4, boxOrder + 1.2);
    poseFaceWhenAsked(harness, whaleModel.face);
  }
  harness.setHero(whaleModel.whale);
  return boxes;
}

const LINEUP_SPACING_UNITS = 4.6;
const LINEUP_LAWN_Z = 17;

function buildSamplePigeons(harness: Harness, deck: Object3D, order: number): void {
  const options = harness.cardOpts(0, 0, 1, deck);
  const cropBags = printCropBags(options);
  if (new URLSearchParams(location.search).has("lineup")) {
    PIGEON_VARIANTS.forEach((variant, variantIndex) => {
      placeStandingPigeon(harness, null, printPigeonKit(harness.cardOpts(0, LINEUP_LAWN_Z, 1, null), variant), cropBags, {
        along: (variantIndex - (PIGEON_VARIANTS.length - 1) / 2) * LINEUP_SPACING_UNITS,
        deckZ: LINEUP_LAWN_Z,
        facing: "right",
        order: order + variantIndex * 0.05,
        name: `pigeon ${variant}`,
      });
    });
    return;
  }
  placeStandingPigeon(harness, deck, printPigeonKit(options, "gary"), cropBags, { along: 5.3, deckZ: BOX_ROW_DECK_Z + 0.4, facing: "left", order, name: "pigeon gary" });
  placeStandingPigeon(harness, deck, printPigeonKit(options, "linda"), cropBags, {
    along: -BOX_SPACING_UNITS + 5.2,
    deckZ: BOX_ROW_DECK_Z - 0.6,
    facing: "right",
    order: order + 0.1,
    name: "pigeon linda",
  });
}

function poseFaceWhenAsked(harness: Harness, face: WhaleFace): void {
  const requested = new URLSearchParams(location.search).get("face");
  const mood = WHALE_MOODS.find((candidate) => candidate === requested);
  if (!mood) return;
  harness.onRestart(() => face.reset());
  harness.onStep((timeSeconds, dtSeconds) => {
    face.setMood(mood, "left");
    face.step(dtSeconds, timeSeconds * 1000);
  });
}

function reportGuestStage(stage: GuestStage): void {
  console.info(`[reportGuestStage] ${JSON.stringify(stage)}`);
}

function readPlayMode(play: Result<LivePlay>): SceneMode {
  if (play.ok) return { kind: "rounds", source: play.value.source, onClick: play.value.player.click };
  console.warn(`[readPlayMode] ${play.reason}`);
  return { kind: "sample" };
}

async function readSceneMode(): Promise<SceneMode> {
  const params = new URLSearchParams(location.search);
  const tableAddress = params.get("table");
  if (params.has("practice")) return readPlayMode(await openPracticePlay(PLAY_WAIT_MS, "everyRound", reportGuestStage));
  if (tableAddress && params.has("play")) {
    const table = parseTableAddress(tableAddress);
    if (!table.ok) return readPlayMode(table);
    const keyStore = createBrowserKeyStore();
    const guestKey = loadGuestKey(keyStore).keypair;
    return readPlayMode(await openLivePlay({ table: table.value, keyStore, guestKey, timeoutMs: PLAY_WAIT_MS, buyInChips: DEFAULT_BUY_IN_CHIPS, antePolicy: "everyRound", onStage: reportGuestStage, startCompanions: null }));
  }
  if (tableAddress) {
    const live = await openLiveRoundSource(tableAddress, LIVE_TABLE_TIMEOUT_MS);
    if (live.ok) return { kind: "rounds", source: live.value, onClick: null };
    console.warn(`[readSceneMode] ${live.reason}`);
    return { kind: "sample" };
  }
  const replayName = params.get("replay");
  if (!replayName) return { kind: "sample" };
  const loaded = await loadRecordedRound(replayName);
  if (loaded.ok) return { kind: "rounds", source: createReplaySource(loaded.round, REPLAY_LEAD_S), onClick: null };
  console.warn(`[readSceneMode] ${loaded.reason}`);
  return { kind: "sample" };
}

export async function buildStageScene(): Promise<void> {
  buildScene(await readSceneMode(), [], null);
}

export function buildGameScene(ports: GameScenePorts): void {
  buildScene({ kind: "rounds", source: ports.source, onClick: ports.onClick }, ports.signposts, ports.readShot);
}

function buildScene(mode: SceneMode, signposts: readonly SignpostPlacement[], readShot: (() => CameraShot) | null): void {
  const onClick = mode.kind === "rounds" ? mode.onClick : null;
  const quality = storedQuality();
  const harness = createHarness({
    ground: GROUND_INKS.lawn,
    stock: PAPER_STOCK,
    view: PARK_VIEW,
    testView: PARK_TEST_VIEW,
    light: { ...PARK_LIGHT, mapSize: quality.shadowMapSize, blockerSamples: quality.blockerSamples, filterSamples: quality.filterSamples },
    lens: { ...PARK_LENS, taps: quality.dofTaps, msaa: quality.msaa },
    focus: SCENE_FOCUS,
    renderScale: quality.renderScale,
    foldOnClick: onClick === null && signposts.length === 0,
  });
  harness.printGround((tools) => printParkGround(tools, harness.bounds));
  if (harness.flags.TEST) buildTestCards(harness);
  else {
    const boxes = buildPark(harness, mode);
    if (signposts.length > 0) buildTitleBanner(harness, TITLE_BANNER_SPOT.x, TITLE_BANNER_SPOT.z, TITLE_BANNER_SPOT.halfWidth);
    const pickable = signposts.map((placement) => ({
      node: buildSignpost(harness, placement.x, placement.z, placement.look).group,
      canPick: placement.canPick,
      onPick: placement.onPick,
    }));
    if (onClick !== null || pickable.length > 0) listenForTableClicks(harness, { boxes, signposts: pickable, onClick: onClick ?? ignoreClick });
  }
  trimHiddenBacksOnceRisen(harness);
  harness.start();
  if (readShot !== null) directCameraShots(harness, readShot);
  probeQualityTier(harness);
  holdAtRequestedTime();
  reportFrameTimesWhenAsked(harness);
}

function holdAtRequestedTime(): void {
  const requestedSeconds = Number(new URLSearchParams(location.search).get("t"));
  if (!(requestedSeconds > 0)) return;
  window.__papercraft?.restart();
  window.__papercraft?.step(requestedSeconds);
}

const FRAME_RECORDER_WARMUP_MS = 1500;

function reportFrameTimesWhenAsked(harness: Harness): void {
  const requestedSeconds = Number(new URLSearchParams(location.search).get("fps"));
  if (!(requestedSeconds > 0)) return;
  window.setTimeout(() => {
    void recordFrameTimes(requestedSeconds * 1000, harness.frameCost).then((summary) => {
      console.info(`[reportFrameTimesWhenAsked] ${JSON.stringify(summary)}`);
    });
  }, FRAME_RECORDER_WARMUP_MS);
}
