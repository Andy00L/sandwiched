import type { Harness, PlacedPiece } from "papercraft/harness.js";
import * as P2 from "papercraft/lib/paperkit-2d.js";
import type { PaintFn, Point, Print, Rng } from "papercraft/lib/paperkit-2d.js";
import { layeredCard, prismFold } from "papercraft/lib/paperkit-3d.js";
import { KRAFT_INKS, PALETTE } from "../palette";

const FOLIAGE = "#7b9566";
const FOLIAGE_DARK = "#5c7752";
const BARK = "#6f4b33";
const BIN_METAL = "#4f5d58";
const SIGN_LINES = ["PLEASE DO NOT", "FEED THE", "PIGEONS"];

function signOutline(): Point[] {
  return P2.fromDrawing(
    (context) => {
      P2.draw2.rect(context, -0.28, 0, 0.56, 3.0, 0.08);
      P2.draw2.rect(context, -2.5, 2.5, 5.0, 2.6, 0.32);
    },
    { w: 5.4, h: 5.3, name: "park sign" },
  );
}

function paintSign(print: Print): void {
  const { box } = print;
  print.gradient(P2.shade(KRAFT_INKS.woodDark, 0.1), P2.shade(KRAFT_INKS.woodDark, -0.2), 0.5);
  const board: Point[] = [
    [-2.35, 2.62],
    [2.35, 2.62],
    [2.35, 4.98],
    [-2.35, 4.98],
  ];
  print.layer(board, PALETTE.creamCore, { depth: 1, rim: 0.5 });
  print.draw((context) => {
    context.strokeStyle = P2.rgba(PALETTE.ink, 0.85);
    context.lineWidth = 0.08;
    context.strokeRect(-2.15, 2.8, 4.3, 2.0);
    context.save();
    context.scale(1, -1);
    context.fillStyle = PALETTE.ink;
    context.textAlign = "center";
    context.textBaseline = "middle";
    context.font = "700 0.5px Georgia, 'Times New Roman', serif";
    SIGN_LINES.forEach((line, index) => context.fillText(line, 0, -(4.4 - index * 0.58)));
    context.restore();
  });
  print.marks("rivet", { color: PALETTE.ink, alpha: 0.75, size: 0.07, units: true, region: { ...box, x0: -2.3, x1: 2.3, y0: 4.82, y1: 4.92 } });
  print.felt(0.7);
}

function paintPlaneTree(random: Rng): PaintFn {
  return (print) => {
    const { box } = print;
    print.gradient(P2.shade(FOLIAGE, 0.12), FOLIAGE_DARK, 0.5);
    print.felt(0.7);
    print.layer((context) => {
      P2.fillLimb(context, 0, box.y0, 0.1, box.y0 + 3.5, 0, box.y0 + 6.2, 1.1, 0.5);
      P2.fillLimb(context, 0, box.y0 + 4.6, -1.6, box.y0 + 5.6, -2.6, box.y0 + 7.4, 0.5, 0.18);
      P2.fillLimb(context, 0, box.y0 + 5.2, 1.4, box.y0 + 6.2, 2.4, box.y0 + 8.0, 0.45, 0.16);
      P2.fillLimb(context, 0, box.y0 + 6.0, -0.4, box.y0 + 7.6, -0.6, box.y0 + 9.2, 0.35, 0.14);
    }, BARK, { depth: 0.8 });
    const leafTones = [PALETTE.mustard, PALETTE.tomato, P2.shade(FOLIAGE, 0.3)];
    print.layer((context) => {
      for (let leaf = 0; leaf < 22; leaf++) {
        const angle = random() * Math.PI * 2;
        const reach = Math.sqrt(random()) * 3.4;
        context.fillStyle = leafTones[leaf % leafTones.length] ?? PALETTE.mustard;
        P2.fillLeaf(context, Math.cos(angle) * reach, box.y0 + 6.6 + Math.sin(angle) * reach * 0.85, 0.75, random() * Math.PI * 2, 0.42);
      }
    }, PALETTE.mustard, { depth: 0.8 });
    print.innerShade("#24321e", { alpha: 0.4, blurPx: 14 });
  };
}

function paintHedge(base: string, withFlowers: boolean): PaintFn {
  return (print) => {
    const { box, r: random } = print;
    print.gradient(P2.shade(base, 0.1), P2.shade(base, -0.16), 0.5);
    print.felt(0.75);
    if (withFlowers) {
      print.layer((context) => {
        for (let flower = 0; flower < 14; flower++) {
          const flowerX = box.x0 + 0.5 + random() * (box.w - 1);
          const flowerY = box.y0 + 0.4 + random() * (box.h * 0.7);
          context.fillStyle = flower % 3 === 0 ? PALETTE.plum : PALETTE.creamCore;
          for (let petal = 0; petal < 5; petal++) {
            const angle = (petal / 5) * Math.PI * 2;
            context.beginPath();
            context.arc(flowerX + Math.cos(angle) * 0.18, flowerY + Math.sin(angle) * 0.18, 0.13, 0, Math.PI * 2);
            context.fill();
          }
        }
      }, PALETTE.creamCore, { depth: 0.5 });
    }
    print.innerShade("#24321e", { alpha: 0.35, blurPx: 12 });
  };
}

function paintBinWall(print: Print): void {
  const { box } = print;
  print.gradient(P2.shade(BIN_METAL, 0.12), P2.shade(BIN_METAL, -0.15), 0.4);
  print.draw((context) => {
    context.strokeStyle = P2.rgba(P2.shade(BIN_METAL, -0.45), 0.6);
    context.lineWidth = 0.08;
    for (let slatX = box.x0 + 0.25; slatX < box.x1; slatX += 0.45) {
      context.beginPath();
      context.moveTo(slatX, box.y0 + 0.2);
      context.lineTo(slatX, box.y1 - 0.2);
      context.stroke();
    }
  });
  print.layer(
    [
      [box.x0 - 0.1, box.y1 - 0.75],
      [box.x1 + 0.1, box.y1 - 0.75],
      [box.x1 + 0.1, box.y1 - 0.4],
      [box.x0 - 0.1, box.y1 - 0.4],
    ],
    PALETTE.mustard,
    { depth: 0.6 },
  );
  print.felt(0.6);
}

export function buildParkSign(harness: Harness, worldX: number, worldZ: number): PlacedPiece {
  return harness.popup(signOutline(), paintSign, { x: worldX, z: worldZ });
}

export function buildPlaneTree(harness: Harness, worldX: number, worldZ: number, seed: number): PlacedPiece {
  const random = P2.rng(seed);
  const outline = P2.roughen(P2.shape.radial(random, { cx: 0, cy: 6.6, rx: 4.2, ry: 3.8, lobes: 7, depth: 0.18, stalk: { w: 1.1, base: 0 } }), random);
  return harness.popup(outline.map(([pointX, pointY]): Point => [pointX, pointY < 0.02 ? 0 : pointY]), paintPlaneTree(P2.rng(seed + 1)), { x: worldX, z: worldZ, cross: true, sway: 0.5 });
}

export function buildHedge(harness: Harness, worldX: number, worldZ: number, seed: number, scale = 1): PlacedPiece {
  const random = P2.rng(seed);
  const width = 6.2;
  const node = layeredCard(
    [
      { pts: P2.roughen(P2.shape.mound(random, { w: width, h: width * 0.46, lobes: 6, depth: 0.2 }), random), paint: paintHedge(FOLIAGE_DARK, false) },
      { pts: P2.roughen(P2.shape.mound(random, { w: width * 0.76, h: width * 0.32, lobes: 5, depth: 0.16 }), random), paint: paintHedge(FOLIAGE, true), z: 0.4 },
    ],
    harness.cardOpts(worldX, worldZ, scale),
  );
  return harness.popup(null, null, { node, height: width * 0.46, x: worldX, z: worldZ, scale, sway: 0.3 });
}

export function buildLitterBin(harness: Harness, worldX: number, worldZ: number): PlacedPiece {
  const footprint: Point[] = [...Array(8).keys()].map((corner): Point => {
    const angle = Math.PI / 8 - (corner / 8) * Math.PI * 2 - Math.PI / 2;
    return [Math.cos(angle) * 1.3, Math.sin(angle) * 1.3];
  });
  const options = harness.cardOpts(worldX, worldZ);
  const node = prismFold(footprint, { h: 3.2, roof: "none", paper: harness.paper, seed: 811, paints: { wall: paintBinWall }, print: { pxPerUnit: options.pxPerUnit, effects: options.effects } });
  return harness.popup(null, null, { node, height: 3.2, x: worldX, z: worldZ });
}

const LAMP_IRON = "#3f4a46";

function lampOutline(): Point[] {
  return P2.fromDrawing(
    (context) => {
      P2.draw2.rect(context, -0.5, 0, 1.0, 0.45, 0.1);
      P2.draw2.rect(context, -0.32, 0.3, 0.64, 6.2, 0.14);
      P2.draw2.rect(context, -0.75, 6.2, 1.5, 1.6, 0.25);
      P2.draw2.poly(context, [
        [-1.0, 7.7],
        [1.0, 7.7],
        [0, 8.5],
      ]);
    },
    { w: 2.2, h: 8.6, name: "lamp post" },
  );
}

function paintLamp(print: Print): void {
  print.gradient(P2.shade(LAMP_IRON, 0.15), P2.shade(LAMP_IRON, -0.2), 0.4);
  print.layer(
    [
      [-0.5, 6.4],
      [0.5, 6.4],
      [0.5, 7.55],
      [-0.5, 7.55],
    ],
    "#f3d48a",
    { depth: 0.7 },
  );
  print.draw((context) => {
    context.strokeStyle = P2.rgba(LAMP_IRON, 0.9);
    context.lineWidth = 0.12;
    context.beginPath();
    context.moveTo(0, 6.4);
    context.lineTo(0, 7.55);
    context.moveTo(-0.5, 6.97);
    context.lineTo(0.5, 6.97);
    context.stroke();
  });
  print.felt(0.6);
}

function paintFlowerBed(print: Print): void {
  const { box, r: random } = print;
  print.gradient(P2.shade(FOLIAGE, 0.05), FOLIAGE_DARK, 0.5);
  print.felt(0.7);
  print.layer((context) => {
    for (let stem = 0; stem < 9; stem++) {
      const stemX = box.x0 + 0.5 + (stem / 8) * (box.w - 1);
      P2.fillLeaf(context, stemX, box.y0, 1.3 + random() * 0.6, Math.PI / 2 + (random() - 0.5) * 0.5, 0.22);
    }
  }, P2.shade(FOLIAGE, 0.2), { depth: 0.6 });
  print.layer((context) => {
    for (let bloom = 0; bloom < 9; bloom++) {
      const bloomX = box.x0 + 0.5 + (bloom / 8) * (box.w - 1) + (random() - 0.5) * 0.3;
      const bloomY = box.y0 + 1.3 + random() * 0.7;
      context.fillStyle = bloom % 3 === 1 ? PALETTE.creamCore : bloom % 3 === 2 ? PALETTE.mustard : PALETTE.plum;
      for (let petal = 0; petal < 6; petal++) {
        const angle = (petal / 6) * Math.PI * 2;
        context.beginPath();
        context.ellipse(bloomX + Math.cos(angle) * 0.22, bloomY + Math.sin(angle) * 0.22, 0.2, 0.13, angle, 0, Math.PI * 2);
        context.fill();
      }
    }
  }, PALETTE.plum, { depth: 0.6 });
  print.innerShade("#24321e", { alpha: 0.3, blurPx: 10 });
}

function parkBenchOutline(): Point[] {
  return P2.fromDrawing(
    (context) => {
      P2.draw2.rect(context, -2.6, 0, 0.45, 1.6, 0.08);
      P2.draw2.rect(context, 2.15, 0, 0.45, 1.6, 0.08);
      P2.draw2.rect(context, -2.9, 1.3, 5.8, 0.5, 0.1);
      P2.draw2.rect(context, -2.7, 1.9, 5.4, 0.45, 0.1);
      P2.draw2.rect(context, -2.7, 2.5, 5.4, 0.45, 0.1);
      P2.draw2.rect(context, -2.4, 1.6, 0.35, 1.5, 0.06);
      P2.draw2.rect(context, 2.05, 1.6, 0.35, 1.5, 0.06);
    },
    { w: 6.0, h: 3.2, name: "park bench" },
  );
}

function paintParkBench(print: Print): void {
  const { box } = print;
  print.gradient(P2.shade(KRAFT_INKS.wood, 0.06), P2.shade(KRAFT_INKS.woodDark, -0.05), 0.4);
  print.layer((context) => {
    context.fillRect(box.x0, 0, 0.6, 1.6);
    context.fillRect(box.x1 - 0.6, 0, 0.6, 1.6);
  }, LAMP_IRON, { depth: 0.6 });
  print.draw((context) => {
    context.strokeStyle = P2.rgba(KRAFT_INKS.woodDark, 0.6);
    context.lineWidth = 0.06;
    for (const slatY of [1.55, 2.12, 2.72]) {
      context.beginPath();
      context.moveTo(box.x0 + 0.3, slatY);
      context.lineTo(box.x1 - 0.3, slatY + 0.03);
      context.stroke();
    }
  });
  print.felt(0.6);
}

export function buildLampPost(harness: Harness, worldX: number, worldZ: number): PlacedPiece {
  return harness.popup(lampOutline(), paintLamp, { x: worldX, z: worldZ, cross: true });
}

export function buildFlowerBed(harness: Harness, worldX: number, worldZ: number, seed: number): PlacedPiece {
  const random = P2.rng(seed);
  return harness.popup(P2.roughen(P2.shape.mound(random, { w: 5.2, h: 2.4, lobes: 9, depth: 0.22 }), random), paintFlowerBed, { x: worldX, z: worldZ, sway: 0.4 });
}

export function buildParkBench(harness: Harness, worldX: number, worldZ: number): PlacedPiece {
  return harness.popup(parkBenchOutline(), paintParkBench, { x: worldX, z: worldZ });
}
