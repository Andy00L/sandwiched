import type * as THREE from "three";
import type { Harness } from "papercraft/harness.js";
import * as P2 from "papercraft/lib/paperkit-2d.js";
import type { Point, Print } from "papercraft/lib/paperkit-2d.js";
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

function crumbOutline(random: () => number): Point[] {
  const size = 0.38 + random() * 0.22;
  return [
    [-size, 0],
    [size * 0.9, 0],
    [size * 0.7, size * 0.75],
    [-size * 0.2, size * 0.95],
    [-size * 0.85, size * 0.5],
  ];
}

function paintCrumb(print: Print): void {
  print.gradient(P2.shade(PALETTE.mustard, 0.12), P2.shade(PALETTE.mustard, -0.22), 0.3);
  print.felt(0.5);
}

export function buildLunchClutter(harness: Harness, deck: THREE.Object3D, crumbsAlong: number, crumbsDeckZ: number, order: number): void {
  harness.popup(appleOutline(), paintApple, { parent: deck, x: -11.8, z: -1.6, yaw: -0.3, order });
  harness.popup(juiceOutline(), paintJuice, { parent: deck, x: 13.6, z: -1.8, yaw: -0.5, order: order + 0.1 });
  const random = P2.rng(907);
  for (let crumb = 0; crumb < 7; crumb++) {
    const angle = random() * Math.PI * 2;
    const reach = 0.8 + random() * 1.6;
    harness.popup(crumbOutline(random), paintCrumb, {
      parent: deck,
      x: crumbsAlong + Math.cos(angle) * reach,
      z: crumbsDeckZ + Math.sin(angle) * reach * 0.6,
      yaw: (random() - 0.5) * 1.2,
      order: order + 0.2 + crumb * 0.03,
    });
  }
}
