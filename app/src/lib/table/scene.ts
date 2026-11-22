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
import type { RecordedRound } from "../game/round-events";
import { GROUND_INKS } from "./palette";
import { placeOnTable } from "./layout";
import { buildLunchbox, LUNCHBOX_LOOKS } from "./pieces/lunchbox";
import { buildCrumbScatter, buildLunchClutter } from "./pieces/lunch";
import { buildFlowerBed, buildHedge, buildLampPost, buildLitterBin, buildParkBench, buildParkSign, buildPlaneTree } from "./pieces/park";
import { sittingPigeonCard, standingPigeonCard } from "./pieces/pigeon";
import { buildPicnicTable } from "./pieces/table";
import { buildWhale, buildWhaleFluke } from "./pieces/whale";
import { BOX_ROW_DECK_Z, BOX_SPACING_UNITS, boxAlong } from "./replay/perches";
import { loadRecordedRound } from "./replay/recorded-rounds";
import { buildReplayScene } from "./replay/replay-scene";
import { recordFrameTimes } from "./stage/frame-recorder";
import { printParkGround } from "./stage/park-ground";
import { PAPER_STOCK, PARK_LENS, PARK_LIGHT, PARK_TEST_VIEW, PARK_VIEW, TABLE_YAW_RAD, TEST_CARD_SPOT } from "./stage/look";

type SceneMode = { kind: "sample" } | { kind: "replay"; round: RecordedRound };

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

function buildPark(harness: Harness, mode: SceneMode): void {
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

  if (mode.kind === "replay") {
    buildReplayScene(harness, picnicTable, whaleModel, boxes, mode.round);
  } else {
    const pigeonYaw = -TABLE_YAW_RAD;
    harness.popup(...standingPigeonCard("gary", "left"), { parent: deck, x: 5.3, z: BOX_ROW_DECK_Z + 0.4, yaw: pigeonYaw, order: boxOrder + 0.8 });
    harness.popup(...standingPigeonCard("linda", "right"), { parent: deck, x: -BOX_SPACING_UNITS + 5.2, z: BOX_ROW_DECK_Z - 0.6, yaw: pigeonYaw, order: boxOrder + 0.9 });
    buildCrumbScatter(harness, deck, 3.6, BOX_ROW_DECK_Z + 1.4, boxOrder + 1.2);
  }
  harness.setHero(whaleModel.whale);
}

async function readSceneMode(): Promise<SceneMode> {
  const replayName = new URLSearchParams(location.search).get("replay");
  if (!replayName) return { kind: "sample" };
  const loaded = await loadRecordedRound(replayName);
  if (loaded.ok) return { kind: "replay", round: loaded.round };
  console.warn(`[readSceneMode] ${loaded.reason}`);
  return { kind: "sample" };
}

export async function buildTableScene(): Promise<void> {
  const mode = await readSceneMode();
  const harness = createHarness({
    ground: GROUND_INKS.lawn,
    stock: PAPER_STOCK,
    view: PARK_VIEW,
    testView: PARK_TEST_VIEW,
    light: PARK_LIGHT,
    lens: PARK_LENS,
    focus: [1.5, 8, -7],
  });
  harness.printGround((tools) => printParkGround(tools, harness.bounds));
  if (harness.flags.TEST) buildTestCards(harness);
  else buildPark(harness, mode);
  harness.start();
  holdAtRequestedTime();
  reportFrameTimesWhenAsked();
}

function holdAtRequestedTime(): void {
  const requestedSeconds = Number(new URLSearchParams(location.search).get("t"));
  if (!(requestedSeconds > 0)) return;
  window.__papercraft?.restart();
  window.__papercraft?.step(requestedSeconds);
}

const FRAME_RECORDER_WARMUP_MS = 1500;

function reportFrameTimesWhenAsked(): void {
  const requestedSeconds = Number(new URLSearchParams(location.search).get("fps"));
  if (!(requestedSeconds > 0)) return;
  window.setTimeout(() => {
    void recordFrameTimes(requestedSeconds * 1000).then((summary) => {
      console.info(`[reportFrameTimesWhenAsked] ${JSON.stringify(summary)}`);
    });
  }, FRAME_RECORDER_WARMUP_MS);
}
