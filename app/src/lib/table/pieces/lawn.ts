import type { Harness } from "papercraft/harness.js";
import * as P2 from "papercraft/lib/paperkit-2d.js";
import type { Point, Print } from "papercraft/lib/paperkit-2d.js";
import { placeOnTable } from "../layout";
import { GROUND_INKS, PALETTE } from "../palette";

const TUFT_GREEN = P2.shade(GROUND_INKS.lawnShade, -0.28);
const LEAF_DARK = P2.shade(GROUND_INKS.lawnShade, -0.42);
const PEBBLE_GREY = P2.mix(GROUND_INKS.padStone, PALETTE.pigeonDark, 0.25);

function tuftOutline(): Point[] {
  return P2.fromDrawing(
    (context) => {
      for (const [baseX, tipX, tipY, width] of [
        [-0.35, -0.75, 1.0, 0.16],
        [-0.12, -0.3, 1.35, 0.18],
        [0.08, 0.15, 1.5, 0.18],
        [0.26, 0.6, 1.15, 0.16],
        [0.4, 0.95, 0.75, 0.14],
      ] as const) {
        P2.draw2.poly(context, [
          [baseX - width, 0],
          [baseX + width, 0],
          [tipX, tipY],
        ]);
      }
    },
    { w: 2.4, h: 1.7, name: "grass tuft" },
  );
}

function paintTuft(print: Print): void {
  print.gradient(P2.shade(TUFT_GREEN, 0.18), P2.shade(TUFT_GREEN, -0.12), 0.1);
  print.draw((context) => {
    context.strokeStyle = P2.rgba(LEAF_DARK, 0.7);
    context.lineWidth = 0.05;
    for (const [fromX, toX, toY] of [
      [-0.12, -0.28, 1.2],
      [0.08, 0.14, 1.35],
      [0.26, 0.55, 1.0],
    ] as const) {
      context.beginPath();
      context.moveTo(fromX, 0.05);
      context.lineTo(toX, toY);
      context.stroke();
    }
  });
  print.felt(0.6);
}

function daisyOutline(): Point[] {
  return P2.fromDrawing(
    (context) => {
      P2.draw2.ell(context, 0, 0.32, 0.72, 0.34);
      for (const [flowerX, flowerY] of [
        [-0.38, 0.62],
        [0.12, 0.78],
        [0.5, 0.55],
      ] as const) {
        P2.draw2.ell(context, flowerX, flowerY, 0.2, 0.2);
      }
    },
    { w: 1.9, h: 1.2, name: "daisy clump" },
  );
}

function paintDaisy(print: Print): void {
  print.fill(P2.shade(GROUND_INKS.lawnShade, -0.2));
  print.layer((context) => {
    for (const [leafX, leafY, angle] of [
      [-0.45, 0.25, 0.5],
      [0.0, 0.2, -0.2],
      [0.42, 0.28, -0.6],
    ] as const) {
      P2.fillLeaf(context, leafX, leafY, 0.45, angle, 0.45);
    }
  }, LEAF_DARK, { depth: 0.6 });
  print.layer((context) => {
    for (const [flowerX, flowerY] of [
      [-0.38, 0.62],
      [0.12, 0.78],
      [0.5, 0.55],
    ] as const) {
      context.beginPath();
      context.arc(flowerX, flowerY, 0.19, 0, Math.PI * 2);
      context.fill();
    }
  }, PALETTE.creamCore, { depth: 0.7 });
  print.layer((context) => {
    for (const [flowerX, flowerY] of [
      [-0.38, 0.62],
      [0.12, 0.78],
      [0.5, 0.55],
    ] as const) {
      context.beginPath();
      context.arc(flowerX, flowerY, 0.07, 0, Math.PI * 2);
      context.fill();
    }
  }, PALETTE.mustard, { depth: 0.5 });
  print.felt(0.6);
}

function pebbleOutline(random: () => number): Point[] {
  return P2.roughen(P2.shape.mound(random, { w: 0.9, h: 0.45, lobes: 3, depth: 0.1 }), random);
}

function paintPebble(print: Print): void {
  print.gradient(P2.shade(PEBBLE_GREY, 0.15), P2.shade(PEBBLE_GREY, -0.25), 0.3);
  print.felt(0.6);
}

const FILLER_GROUPS: ReadonlyArray<readonly [number, number]> = [
  [-20.5, -1.5],
  [-19, 6.5],
  [-12, 10.5],
  [20, -6.5],
  [23.5, 1],
  [11, 11.5],
];
const COPIES_PER_KIND = 2;
const FILLER_SCALE = 1.5;

export function buildLawnFillers(harness: Harness): void {
  const random = P2.rng(431);
  const kinds = [
    { outline: tuftOutline(), paint: paintTuft },
    { outline: daisyOutline(), paint: paintDaisy },
    { outline: pebbleOutline(random), paint: paintPebble },
  ].map((kind) => ({ outline: kind.outline, materials: harness.printed(kind.outline, kind.paint) }));
  for (const [centreAlong, centreAcross] of FILLER_GROUPS) {
    for (const [kindIndex, kind] of kinds.entries()) {
      for (let copy = 0; copy < COPIES_PER_KIND; copy++) {
        const [worldX, worldZ] = placeOnTable([centreAlong + (random() - 0.5) * 4.2, centreAcross + (random() - 0.5) * 3.2]);
        harness.popup(kind.outline, null, { materials: kind.materials, x: worldX, z: worldZ, scale: FILLER_SCALE + random() * 0.5, sway: kindIndex === 0 ? 0.6 : 0 });
      }
    }
  }
}
