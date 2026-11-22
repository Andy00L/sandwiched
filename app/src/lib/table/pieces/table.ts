import type * as THREE from "three";
import type { Harness, PlacedPiece } from "papercraft/harness.js";
import * as P2 from "papercraft/lib/paperkit-2d.js";
import type { PaintFn, Point, Print } from "papercraft/lib/paperkit-2d.js";
import { platform } from "papercraft/lib/paperkit-3d.js";
import { TABLE_DEPTH_UNITS, TABLE_HEIGHT_UNITS, TABLE_LENGTH_UNITS, placeOnTable } from "../layout";
import { KRAFT_INKS, PALETTE } from "../palette";
import { TABLE_YAW_RAD } from "../stage/look";

const PLANK_COUNT = 7;
const APRON_HEIGHT_UNITS = 0.8;
const LEG_WIDTH_UNITS = 1.5;
const LEG_INSET_UNITS = 3.2;
const LEG_SPLAY_UNITS = 1.4;
const RUNNER_WIDTH_UNITS = 4.4;
const GINGHAM_CHECK_UNITS = 0.62;
const BENCH_HEIGHT_UNITS = 2.3;
const BENCH_DEPTH_UNITS = 3.1;
const BENCH_GAP_UNITS = 1.6;

export interface PicnicTable {
  table: PlacedPiece;
  deck: THREE.Object3D;
  backBenchAcross: number;
}

function printWoodGrain(print: Print, region: { x0: number; x1: number; y0: number; y1: number }, color: string, alongX: boolean): void {
  const { r: random } = print;
  print.draw((context) => {
    context.strokeStyle = P2.rgba(color, 0.42);
    context.lineCap = "round";
    const span = alongX ? region.y1 - region.y0 : region.x1 - region.x0;
    const lines = Math.max(2, Math.round(span / 0.45));
    for (let line = 0; line < lines; line++) {
      context.lineWidth = (0.05 + random() * 0.04);
      const offset = (alongX ? region.y0 : region.x0) + ((line + 0.5) / lines) * span;
      const start = alongX ? region.x0 : region.y0;
      const end = alongX ? region.x1 : region.y1;
      context.beginPath();
      for (let step = 0; step <= 24; step++) {
        const along = start + ((end - start) * step) / 24;
        const wobble = Math.sin(along * 0.9 + line * 1.7) * 0.06 + Math.sin(along * 0.23 + line) * 0.05;
        const [pointX, pointY] = alongX ? [along, offset + wobble] : [offset + wobble, along];
        if (step === 0) context.moveTo(pointX, pointY);
        else context.lineTo(pointX, pointY);
      }
      context.stroke();
    }
  });
}

function printKnot(print: Print, centreX: number, centreY: number, size: number, color: string): void {
  print.draw((context) => {
    context.strokeStyle = P2.rgba(color, 0.6);
    context.lineWidth = 0.07;
    for (let ring = 1; ring <= 3; ring++) {
      context.beginPath();
      context.ellipse(centreX, centreY, size * ring * 0.9, size * ring * 0.45, 0, 0, Math.PI * 2);
      context.stroke();
    }
    context.fillStyle = P2.rgba(color, 0.75);
    context.beginPath();
    context.ellipse(centreX, centreY, size * 0.5, size * 0.28, 0, 0, Math.PI * 2);
    context.fill();
  });
}

function paintPlanksAlongX(plankCount: number, base: string, withRunner: boolean): PaintFn {
  return (print) => {
    const { box, r: random } = print;
    const gapColor = P2.shade(KRAFT_INKS.woodDark, -0.25);
    print.fill(gapColor);
    const plankDepth = box.h / plankCount;
    print.layer((context) => {
      for (let plank = 0; plank < plankCount; plank++) {
        const tone = P2.shade(base, (random() - 0.5) * 0.12);
        context.fillStyle = tone;
        context.beginPath();
        context.roundRect(box.x0 + 0.05, box.y0 + plank * plankDepth + 0.07, box.w - 0.1, plankDepth - 0.14, 0.12);
        context.fill();
      }
    }, base, { depth: 0.8 });
    for (let plank = 0; plank < plankCount; plank++) {
      printWoodGrain(print, { x0: box.x0, x1: box.x1, y0: box.y0 + plank * plankDepth + 0.15, y1: box.y0 + (plank + 1) * plankDepth - 0.15 }, KRAFT_INKS.woodDark, true);
    }
    printKnot(print, box.x0 + box.w * 0.18, box.y0 + plankDepth * 1.5, 0.22, KRAFT_INKS.woodDark);
    printKnot(print, box.x0 + box.w * 0.83, box.y0 + plankDepth * (plankCount - 1.5), 0.18, KRAFT_INKS.woodDark);
    if (withRunner) printGinghamRunner(print);
    print.felt(0.7);
    print.innerShade(PALETTE.contactTint, { alpha: 0.28, blurPx: 14 });
  };
}

function printGinghamRunner(print: Print): void {
  const { box } = print;
  const centreY = (box.y0 + box.y1) / 2;
  const runner: Point[] = [
    [box.x0 + 1.2, centreY - RUNNER_WIDTH_UNITS / 2],
    [box.x1 - 1.2, centreY - RUNNER_WIDTH_UNITS / 2],
    [box.x1 - 1.2, centreY + RUNNER_WIDTH_UNITS / 2],
    [box.x0 + 1.2, centreY + RUNNER_WIDTH_UNITS / 2],
  ];
  print.layer(runner, PALETTE.creamCore, { depth: 0.9, rim: 0.6 });
  print.draw((context) => {
    context.save();
    P2.tracePath(context, runner);
    context.clip();
    context.fillStyle = P2.rgba(PALETTE.tomato, 0.5);
    for (let stripeX = box.x0 + 1.2; stripeX < box.x1 - 1.2; stripeX += GINGHAM_CHECK_UNITS * 2) {
      context.fillRect(stripeX, centreY - RUNNER_WIDTH_UNITS / 2, GINGHAM_CHECK_UNITS, RUNNER_WIDTH_UNITS);
    }
    for (let stripeY = centreY - RUNNER_WIDTH_UNITS / 2; stripeY < centreY + RUNNER_WIDTH_UNITS / 2; stripeY += GINGHAM_CHECK_UNITS * 2) {
      context.fillRect(box.x0 + 1.2, stripeY, box.w - 2.4, GINGHAM_CHECK_UNITS);
    }
    context.restore();
  });
}

function legsFaceOutline(width: number, height: number): Point[] {
  const half = width / 2;
  const apronBottom = height - APRON_HEIGHT_UNITS;
  return [
    [-half + LEG_INSET_UNITS - LEG_SPLAY_UNITS, 0],
    [-half + LEG_INSET_UNITS - LEG_SPLAY_UNITS + LEG_WIDTH_UNITS, 0],
    [-half + LEG_INSET_UNITS + LEG_WIDTH_UNITS, apronBottom],
    [half - LEG_INSET_UNITS - LEG_WIDTH_UNITS, apronBottom],
    [half - LEG_INSET_UNITS + LEG_SPLAY_UNITS - LEG_WIDTH_UNITS, 0],
    [half - LEG_INSET_UNITS + LEG_SPLAY_UNITS, 0],
    [half - LEG_INSET_UNITS, apronBottom],
    [half, apronBottom],
    [half, height],
    [-half, height],
    [-half, apronBottom],
    [-half + LEG_INSET_UNITS, apronBottom],
  ];
}

function paintLegsFace(print: Print): void {
  const { box } = print;
  print.gradient(P2.shade(KRAFT_INKS.woodDark, 0.12), P2.shade(KRAFT_INKS.woodDark, -0.16), 0.5);
  printWoodGrain(print, { x0: box.x0, x1: box.x1, y0: box.y1 - APRON_HEIGHT_UNITS, y1: box.y1 }, P2.shade(KRAFT_INKS.woodDark, -0.45), true);
  print.layer(
    [
      [box.x0, box.y1 - APRON_HEIGHT_UNITS + 0.1],
      [box.x1, box.y1 - APRON_HEIGHT_UNITS + 0.1],
      [box.x1, box.y1 - APRON_HEIGHT_UNITS + 0.32],
      [box.x0, box.y1 - APRON_HEIGHT_UNITS + 0.32],
    ],
    P2.shade(KRAFT_INKS.wood, -0.05),
    { depth: 0.6 },
  );
  print.marks("rivet", { color: PALETTE.ink, alpha: 0.7, size: 0.06, units: true, region: { ...box, y0: box.y1 - 0.5, y1: box.y1 - 0.2 } });
  print.felt(0.7);
}

function paintSupport(print: Print): void {
  print.gradient(P2.shade(KRAFT_INKS.woodDark, -0.05), P2.shade(KRAFT_INKS.woodDark, -0.28), 0.4);
  print.felt(0.6);
}

function buildBench(harness: Harness, acrossTable: number, seed: number): PlacedPiece {
  const benchLength = TABLE_LENGTH_UNITS - 2;
  const [benchX, benchZ] = placeOnTable([0, acrossTable]);
  const options = harness.cardOpts(benchX, benchZ);
  const bench = platform({
    w: benchLength,
    d: BENCH_DEPTH_UNITS,
    h: BENCH_HEIGHT_UNITS,
    paper: harness.paper,
    seed,
    facePts: legsFaceOutline(benchLength, BENCH_HEIGHT_UNITS),
    paints: { face: paintLegsFace, deck: paintPlanksAlongX(3, KRAFT_INKS.wood, false), support: paintSupport },
    print: { pxPerUnit: options.pxPerUnit, effects: options.effects },
  });
  return harness.popup(null, null, { node: bench, height: BENCH_HEIGHT_UNITS, x: benchX, z: benchZ, yaw: TABLE_YAW_RAD, level: true });
}

export function buildPicnicTable(harness: Harness): PicnicTable {
  const frontAcross = TABLE_DEPTH_UNITS / 2;
  const [tableX, tableZ] = placeOnTable([0, frontAcross]);
  const options = harness.cardOpts(tableX, tableZ);
  const tableNode = platform({
    w: TABLE_LENGTH_UNITS,
    d: TABLE_DEPTH_UNITS,
    h: TABLE_HEIGHT_UNITS,
    paper: harness.paper,
    seed: 401,
    facePts: legsFaceOutline(TABLE_LENGTH_UNITS, TABLE_HEIGHT_UNITS),
    paints: { face: paintLegsFace, deck: paintPlanksAlongX(PLANK_COUNT, KRAFT_INKS.wood, true), support: paintSupport },
    print: { pxPerUnit: options.pxPerUnit, effects: options.effects },
  });
  const table = harness.popup(null, null, { node: tableNode, height: TABLE_HEIGHT_UNITS, x: tableX, z: tableZ, yaw: TABLE_YAW_RAD, level: true });
  const backBenchAcross = -frontAcross - BENCH_GAP_UNITS;
  buildBench(harness, frontAcross + BENCH_GAP_UNITS + BENCH_DEPTH_UNITS, 431);
  buildBench(harness, backBenchAcross, 437);
  const deck = tableNode.userData.deck as THREE.Object3D;
  return { table, deck, backBenchAcross };
}
