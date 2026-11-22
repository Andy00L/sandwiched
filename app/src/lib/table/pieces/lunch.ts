import type * as THREE from "three";
import type { Harness } from "papercraft/harness.js";
import * as P2 from "papercraft/lib/paperkit-2d.js";
import type { Ink, PaintFn, Point, Print } from "papercraft/lib/paperkit-2d.js";
import { PALETTE } from "../palette";

const APPLE_RED = "#c43d2c";
const LEAF_GREEN = "#6e8a4e";

function appleOutline(): Point[] {
  return P2.fromDrawing(
    (context) => {
      P2.draw2.ell(context, 0, 0.78, 0.82, 0.78);
      P2.draw2.rect(context, -0.05, 1.4, 0.12, 0.42, 0.04);
      P2.draw2.ell(context, 0.32, 1.66, 0.3, 0.14, 0.5);
    },
    { w: 1.9, h: 1.9, name: "apple" },
  ).filter(([pointX, pointY]) => !(pointX > 0.42 && pointY > 0.55 && pointY < 1.15 && Math.hypot(pointX - 0.95, pointY - 0.85) < 0.4));
}

function paintApple(print: Print): void {
  print.gradient(P2.shade(APPLE_RED, 0.14), P2.shade(APPLE_RED, -0.2), 0.6);
  print.layer((context) => {
    context.beginPath();
    context.ellipse(0.62, 0.86, 0.3, 0.3, 0, 0, Math.PI * 2);
    context.fill();
  }, PALETTE.creamCore, { depth: 0.6 });
  print.layer((context) => {
    context.beginPath();
    context.ellipse(0.32, 1.66, 0.3, 0.14, 0.5, 0, Math.PI * 2);
    context.fill();
  }, LEAF_GREEN, { depth: 0.5 });
  print.felt(0.6);
}

function juiceOutline(): Point[] {
  return P2.fromDrawing(
    (context) => {
      P2.draw2.rect(context, -0.6, 0, 1.2, 1.7, 0.1);
      P2.draw2.rect(context, 0.15, 1.6, 0.12, 0.55, 0.03);
    },
    { w: 1.4, h: 2.2, name: "juice box" },
  );
}

function paintJuice(print: Print): void {
  print.gradient(P2.shade(PALETTE.creamCore, 0.02), P2.shade(PALETTE.creamCore, -0.12), 0.4);
  print.layer((context) => {
    context.beginPath();
    context.arc(0, 0.8, 0.42, 0, Math.PI * 2);
    context.fill();
  }, PALETTE.mustard, { depth: 0.6 });
  print.layer((context) => {
    context.fillRect(-0.6, 0, 1.2, 0.3);
  }, PALETTE.teal, { depth: 0.6 });
  print.layer((context) => context.fillRect(0.15, 1.6, 0.12, 0.55), PALETTE.tomato, { depth: 0.4 });
  print.felt(0.6);
}

export function crumbOutline(random: () => number, sizeFactor = 1): Point[] {
  const size = (0.38 + random() * 0.22) * sizeFactor;
  return [
    [-size, 0],
    [size * 0.9, 0],
    [size * 0.7, size * 0.75],
    [-size * 0.2, size * 0.95],
    [-size * 0.85, size * 0.5],
  ];
}

export function paintCrumb(print: Print): void {
  print.gradient(P2.shade(PALETTE.mustard, 0.12), P2.shade(PALETTE.mustard, -0.22), 0.3);
  print.felt(0.5);
}

export function buildLunchClutter(harness: Harness, deck: THREE.Object3D, order: number): void {
  harness.popup(appleOutline(), paintApple, { parent: deck, x: -11.8, z: -1.6, yaw: -0.3, order });
  harness.popup(juiceOutline(), paintJuice, { parent: deck, x: 13.6, z: -1.8, yaw: -0.5, order: order + 0.1 });
}

export function buildCrumbScatter(harness: Harness, deck: THREE.Object3D, crumbsAlong: number, crumbsDeckZ: number, order: number): void {
  const random = P2.rng(907);
  for (let crumb = 0; crumb < 7; crumb++) {
    const angle = random() * Math.PI * 2;
    const reach = 0.8 + random() * 1.6;
    harness.popup(crumbOutline(random), paintCrumb, {
      parent: deck,
      x: crumbsAlong + Math.cos(angle) * reach,
      z: crumbsDeckZ + Math.sin(angle) * reach * 0.6,
      yaw: (random() - 0.5) * 1.2,
      order: order + crumb * 0.03,
    });
  }
}

export const SANDWICH_BITE_STAGES = 10;
const SANDWICH_HALF_WIDTH_UNITS = 1.9;
const BREAD_CRUMB = "#ecd29c";

function drawSandwich(context: CanvasRenderingContext2D, ink: Ink): void {
  const halfWidth = SANDWICH_HALF_WIDTH_UNITS;
  context.fillStyle = ink(PALETTE.kraftWood);
  P2.draw2.rect(context, -halfWidth, 0, halfWidth * 2, 0.86, 0.28);
  context.fillStyle = ink(BREAD_CRUMB);
  P2.draw2.rect(context, -halfWidth + 0.16, 0.14, halfWidth * 2 - 0.32, 0.56, 0.16);
  context.fillStyle = ink(PALETTE.mustard);
  P2.draw2.poly(context, [
    [-halfWidth - 0.1, 0.8],
    [halfWidth + 0.1, 0.8],
    [halfWidth + 0.1, 1.08],
    [1.4, 1.08],
    [1.18, 0.5],
    [0.95, 1.08],
    [-0.2, 1.08],
    [-0.44, 0.58],
    [-0.68, 1.08],
    [-halfWidth - 0.1, 1.08],
  ]);
  context.fillStyle = ink(PALETTE.tomato);
  P2.draw2.rect(context, -halfWidth + 0.08, 1.04, halfWidth * 2 - 0.16, 0.42, 0.2);
  context.fillStyle = ink(LEAF_GREEN);
  for (let frill = 0; frill < 9; frill++) P2.draw2.ell(context, -halfWidth + 0.05 + frill * 0.475, 1.56, 0.36, 0.24, (frill % 2) * 0.4 - 0.2);
  context.fillStyle = ink(PALETTE.kraftWood);
  context.beginPath();
  context.moveTo(-halfWidth - 0.05, 1.62);
  context.bezierCurveTo(-halfWidth - 0.05, 3.3, halfWidth + 0.05, 3.3, halfWidth + 0.05, 1.62);
  context.closePath();
  context.fill();
  context.fillStyle = ink(PALETTE.creamCore, "print");
  for (const [seedX, seedY] of [[-1.1, 2.2], [-0.4, 2.6], [0.35, 2.45], [1.05, 2.15], [0.0, 2.0], [-0.8, 1.9]] as const) {
    P2.draw2.ell(context, seedX, seedY, 0.1, 0.06, 0.4);
  }
}

function eraseBites(context: CanvasRenderingContext2D, biteStage: number): void {
  if (biteStage <= 0) return;
  const biteEdge = SANDWICH_HALF_WIDTH_UNITS + 0.4 - (biteStage / SANDWICH_BITE_STAGES) * (SANDWICH_HALF_WIDTH_UNITS * 2 - 0.4);
  context.globalCompositeOperation = "destination-out";
  context.fillRect(biteEdge, -0.2, SANDWICH_HALF_WIDTH_UNITS * 2, 4);
  for (let bite = 0; bite < 7; bite++) P2.draw2.ell(context, biteEdge, 0.1 + bite * 0.52, 0.38, 0.34);
  context.globalCompositeOperation = "source-over";
}

export function sandwichCard(biteStage: number): [Point[], PaintFn] {
  const outline = P2.fromDrawing(
    (context) => {
      drawSandwich(context, () => "#000");
      eraseBites(context, biteStage);
    },
    { w: 4.6, h: 3.4, name: `sandwich bite ${biteStage}` },
  );
  const paint: PaintFn = (print) => {
    print.parts((context, ink) => drawSandwich(context, ink));
    print.felt(0.7);
    print.innerShade(P2.shade(PALETTE.kraftWood, -0.6), { alpha: 0.3, blurPx: 8 });
  };
  return [outline, paint];
}

const MOTH_WING = P2.mix(PALETTE.creamCore, PALETTE.pigeonDark, 0.32);

export function mothCard(): [Point[], PaintFn] {
  const [outline, paintParts] = P2.drawnPiece(
    (context, ink) => {
      context.fillStyle = ink(P2.shade(MOTH_WING, -0.12));
      P2.draw2.ell(context, -0.5, 0.55, 0.5, 0.36, 0.5);
      P2.draw2.ell(context, 0.5, 0.55, 0.5, 0.36, -0.5);
      context.fillStyle = ink(MOTH_WING);
      P2.draw2.ell(context, -0.66, 1.08, 0.72, 0.46, -0.35);
      P2.draw2.ell(context, 0.66, 1.08, 0.72, 0.46, 0.35);
      context.fillStyle = ink(PALETTE.plum, "print");
      P2.draw2.ell(context, -0.78, 1.12, 0.16, 0.16);
      P2.draw2.ell(context, 0.78, 1.12, 0.16, 0.16);
      context.strokeStyle = ink(PALETTE.ink);
      context.lineWidth = 0.1;
      context.lineCap = "round";
      context.beginPath();
      context.moveTo(-0.08, 1.45);
      context.quadraticCurveTo(-0.2, 1.85, -0.5, 1.95);
      context.moveTo(0.08, 1.45);
      context.quadraticCurveTo(0.2, 1.85, 0.5, 1.95);
      context.stroke();
      context.fillStyle = ink(PALETTE.kraftWoodDark);
      P2.draw2.ell(context, 0, 0.8, 0.17, 0.7);
    },
    { w: 2.6, h: 2.2, name: "moth" },
  );
  const paint: PaintFn = (print) => {
    paintParts(print);
    print.felt(0.6);
  };
  return [outline, paint];
}
