import * as THREE from "three";
import type { Harness, PlacedPiece } from "papercraft/harness.js";
import * as P2 from "papercraft/lib/paperkit-2d.js";
import type { PaintFn, Point, Print } from "papercraft/lib/paperkit-2d.js";
import { makeCard } from "papercraft/lib/paperkit-3d.js";
import type { CardOptions } from "papercraft/lib/paperkit-3d.js";
import { PALETTE } from "../palette";

const SEAT_HEIGHT_UNITS = 2.3;
const TORSO_WIDTH_UNITS = 16.8;
const TORSO_HEIGHT_UNITS = 11.4;
const HEAD_WIDTH_UNITS = 15.4;
const HEAD_HEIGHT_UNITS = 9.6;
const HEAD_BASE_UNITS = 12.4;
const FLIPPER_REACH_UNITS = 2.6;
const TABLE_TOP_UNITS = 3.95;
const LAYER_GAP_UNITS = 0.18;
const EYE_SPACING_UNITS = 3.9;
const EYE_HEIGHT_UNITS = 5.7;
const SUIT_LIGHT = "#3e4c66";
const WHALE_SKIN_DARK = P2.shade(PALETTE.whaleSkin, -0.22);

export const WHALE_HEIGHT_UNITS = HEAD_BASE_UNITS + HEAD_HEIGHT_UNITS;

function roundedBlock(width: number, height: number, topRadius: number, bottomRadius: number): Point[] {
  const half = width / 2;
  const arc = (centreX: number, centreY: number, radius: number, fromAngle: number, toAngle: number): Point[] =>
    [...Array(9).keys()].map((step) => {
      const angle = fromAngle + ((toAngle - fromAngle) * step) / 8;
      return [centreX + Math.cos(angle) * radius, centreY + Math.sin(angle) * radius];
    });
  return [
    ...arc(-half + bottomRadius, bottomRadius, bottomRadius, Math.PI, Math.PI * 1.5).map(([pointX, pointY]): Point => [pointX, Math.max(0, pointY)]),
    ...arc(half - bottomRadius, bottomRadius, bottomRadius, Math.PI * 1.5, Math.PI * 2).map(([pointX, pointY]): Point => [pointX, Math.max(0, pointY)]),
    ...arc(half - topRadius, height - topRadius, topRadius, 0, Math.PI / 2),
    ...arc(-half + topRadius, height - topRadius, topRadius, Math.PI / 2, Math.PI),
  ];
}

function paintTorso(print: Print): void {
  const { box } = print;
  const top = box.y1;
  print.gradient(SUIT_LIGHT, P2.shade(PALETTE.suit, -0.18), 0.6);
  print.draw((context) => {
    context.strokeStyle = P2.rgba(PALETTE.creamCore, 0.22);
    context.lineWidth = 0.16;
    for (let stripeX = box.x0 + 0.6; stripeX < box.x1; stripeX += 1.15) {
      context.beginPath();
      context.moveTo(stripeX, box.y0);
      context.lineTo(stripeX + 0.25, top);
      context.stroke();
    }
  });
  print.layer(
    [
      [-2.7, top + 0.1],
      [2.7, top + 0.1],
      [0, top - 6.6],
    ],
    PALETTE.creamCore,
    { depth: 1 },
  );
  print.layer((context) => {
    P2.draw2.poly(context, [
      [-0.5, top + 0.1],
      [-4.6, top - 0.2],
      [-3.4, top - 5.4],
      [-0.2, top - 6.9],
      [-1.6, top - 3.2],
    ]);
    P2.draw2.poly(context, [
      [0.5, top + 0.1],
      [4.6, top - 0.2],
      [3.4, top - 5.4],
      [0.2, top - 6.9],
      [1.6, top - 3.2],
    ]);
  }, P2.mix(SUIT_LIGHT, "#55658a", 0.4), { depth: 1.1 });
  print.layer(
    [
      [-0.62, top - 1.3],
      [0.62, top - 1.3],
      [0.95, top - 6.4],
      [0, top - 7.4],
      [-0.95, top - 6.4],
    ],
    PALETTE.tomato,
    { depth: 1.1 },
  );
  print.layer(
    [
      [-0.85, top + 0.05],
      [0.85, top + 0.05],
      [0.55, top - 1.35],
      [-0.55, top - 1.35],
    ],
    P2.shade(PALETTE.tomato, -0.22),
    { depth: 1.2 },
  );
  print.draw((context) => {
    context.save();
    P2.tracePath(context, [
      [-0.62, top - 1.3],
      [0.62, top - 1.3],
      [0.95, top - 6.4],
      [0, top - 7.4],
      [-0.95, top - 6.4],
    ]);
    context.clip();
    context.strokeStyle = P2.rgba(P2.shade(PALETTE.tomato, -0.4), 0.8);
    context.lineWidth = 0.34;
    for (const stripeY of [top - 3.0, top - 4.6]) {
      context.beginPath();
      context.moveTo(-1.2, stripeY - 0.5);
      context.lineTo(1.2, stripeY + 0.5);
      context.stroke();
    }
    context.restore();
  });
  print.layer(
    [
      [3.3, top - 3.6],
      [5.4, top - 3.6],
      [5.2, top - 2.6],
      [4.75, top - 3.05],
      [4.35, top - 2.4],
      [3.95, top - 3.05],
      [3.5, top - 2.6],
    ],
    PALETTE.mustard,
    { depth: 1 },
  );
  print.layer((context) => {
    for (const buttonY of [top - 8.2, top - 9.6]) {
      context.beginPath();
      context.arc(0, buttonY, 0.32, 0, Math.PI * 2);
      context.fill();
    }
  }, P2.shade(PALETTE.ink, 0.15), { depth: 0.8 });
  print.felt(0.7);
  print.innerShade("#141a26", { alpha: 0.4, blurPx: 16 });
}

function mouthLineY(pointX: number): number {
  const smirk = pointX > 2.2 ? (pointX - 2.2) * 0.32 : 0;
  return 3.05 + 0.018 * pointX * pointX + smirk;
}

function paintHead(print: Print): void {
  const { box } = print;
  print.gradient(P2.shade(PALETTE.whaleSkin, 0.12), WHALE_SKIN_DARK, 0.55);
  print.layer((context) => {
    const spots: Array<[number, number, number]> = [
      [-5.2, 8.1, 0.32],
      [-4.2, 8.7, 0.22],
      [-6.1, 7.2, 0.24],
      [5.6, 8.2, 0.26],
      [4.7, 8.9, 0.18],
    ];
    for (const [spotX, spotY, radius] of spots) {
      context.beginPath();
      context.arc(spotX, spotY, radius, 0, Math.PI * 2);
      context.fill();
    }
  }, P2.mix(PALETTE.whaleSkin, PALETTE.creamCore, 0.45), { depth: 0.6 });
  print.layer((context) => {
    const patches: Array<[number, number, number, number]> = [
      [-1.0, 8.6, 2.6, 0.7],
      [4.2, 6.9, 1.4, 0.55],
      [-5.4, 5.0, 1.0, 0.8],
    ];
    for (const [patchX, patchY, radiusX, radiusY] of patches) {
      context.beginPath();
      context.ellipse(patchX, patchY, radiusX, radiusY, 0.15, 0, Math.PI * 2);
      context.fill();
    }
  }, WHALE_SKIN_DARK, { depth: 0.6, lip: 0.4 });
  const jaw: Point[] = [
    [box.x0 - 0.2, -0.2],
    [box.x1 + 0.2, -0.2],
    ...[...Array(25).keys()].map((step): Point => {
      const pointX = box.x1 + 0.2 - ((box.w + 0.4) * step) / 24;
      return [pointX, mouthLineY(pointX)];
    }),
  ];
  print.layer(jaw, PALETTE.whaleBelly, { depth: 1.2 });
  print.draw((context) => {
    context.save();
    P2.tracePath(context, jaw);
    context.clip();
    context.strokeStyle = P2.rgba(P2.shade(PALETTE.whaleBelly, -0.28), 0.85);
    context.lineWidth = 0.22;
    context.lineCap = "round";
    for (let groove = 0; groove < 5; groove++) {
      const grooveY = 0.55 + groove * 0.48;
      context.beginPath();
      context.moveTo(-4.8 + groove * 0.35, grooveY + 0.15);
      context.quadraticCurveTo(0, grooveY - 0.25, 4.8 - groove * 0.35, grooveY + 0.15);
      context.stroke();
    }
    context.restore();
    context.strokeStyle = P2.rgba(PALETTE.ink, 0.9);
    context.lineWidth = 0.26;
    context.beginPath();
    for (let step = 0; step <= 24; step++) {
      const pointX = -4.6 + (9.9 * step) / 24;
      if (step === 0) context.moveTo(pointX, mouthLineY(pointX) + 0.05);
      else context.lineTo(pointX, mouthLineY(pointX) + 0.05);
    }
    context.stroke();
    context.lineWidth = 0.2;
    context.beginPath();
    context.moveTo(5.15, mouthLineY(5.3) + 0.05);
    context.quadraticCurveTo(5.6, mouthLineY(5.3) + 0.25, 5.65, mouthLineY(5.3) + 0.75);
    context.stroke();
  });
  for (const side of [-1, 1]) printSmugEye(print, side * EYE_SPACING_UNITS, EYE_HEIGHT_UNITS);
  print.layer((context) => {
    context.beginPath();
    context.ellipse(-2.4, 8.75, 0.62, 0.24, -0.1, 0, Math.PI * 2);
    context.fill();
  }, P2.shade(PALETTE.whaleSkin, -0.45), { depth: 0.6, lip: 0.4 });
  print.felt(0.7);
  print.innerShade("#1c2a36", { alpha: 0.35, blurPx: 16 });
}

const EYE_RADIUS_X_UNITS = 1.38;
const EYE_RADIUS_Y_UNITS = 1.05;
const SMUG_LID_DROP = 0.1;

function traceEye(context: CanvasRenderingContext2D, centreX: number, centreY: number): void {
  context.beginPath();
  context.ellipse(centreX, centreY, EYE_RADIUS_X_UNITS, EYE_RADIUS_Y_UNITS, 0, 0, Math.PI * 2);
}

function lidEdgeY(centreY: number, offsetX: number): number {
  const across = offsetX / EYE_RADIUS_X_UNITS;
  return centreY - SMUG_LID_DROP + 0.16 * across - 0.12 * (1 - across * across);
}

function printSmugEye(print: Print, centreX: number, centreY: number): void {
  print.layer((context) => {
    traceEye(context, centreX, centreY);
    context.fill();
  }, PALETTE.creamCore, { depth: 0.9 });
  print.layer((context) => {
    context.beginPath();
    context.arc(centreX + 0.5, centreY - 0.28, 0.56, 0, Math.PI * 2);
    context.fill();
  }, PALETTE.ink, { depth: 0.5, lip: 0.3 });
  print.draw((context) => {
    context.fillStyle = P2.rgba(PALETTE.creamCore, 0.95);
    context.beginPath();
    context.arc(centreX + 0.3, centreY - 0.1, 0.15, 0, Math.PI * 2);
    context.fill();
  });
  print.layer((context) => {
    context.save();
    traceEye(context, centreX, centreY);
    context.clip();
    context.beginPath();
    context.moveTo(centreX - EYE_RADIUS_X_UNITS - 0.1, centreY + EYE_RADIUS_Y_UNITS + 0.2);
    context.lineTo(centreX + EYE_RADIUS_X_UNITS + 0.1, centreY + EYE_RADIUS_Y_UNITS + 0.2);
    for (let step = 0; step <= 16; step++) {
      const offsetX = EYE_RADIUS_X_UNITS + 0.1 - ((EYE_RADIUS_X_UNITS * 2 + 0.2) * step) / 16;
      context.lineTo(centreX + offsetX, lidEdgeY(centreY, offsetX));
    }
    context.closePath();
    context.fill();
    context.restore();
  }, P2.shade(PALETTE.whaleSkin, -0.06), { depth: 1.0, lip: 0.5 });
  print.draw((context) => {
    context.strokeStyle = P2.rgba(PALETTE.ink, 0.92);
    context.lineWidth = 0.22;
    context.lineCap = "round";
    context.beginPath();
    for (let step = 0; step <= 16; step++) {
      const offsetX = EYE_RADIUS_X_UNITS * 0.98 - ((EYE_RADIUS_X_UNITS * 1.96) * step) / 16;
      if (step === 0) context.moveTo(centreX + offsetX, lidEdgeY(centreY, offsetX));
      else context.lineTo(centreX + offsetX, lidEdgeY(centreY, offsetX));
    }
    context.stroke();
    context.lineWidth = 0.12;
    context.strokeStyle = P2.rgba(PALETTE.ink, 0.6);
    traceEye(context, centreX, centreY);
    context.stroke();
  });
}

function browOutline(): Point[] {
  return [
    [-1.45, 0],
    [-0.4, 0.12],
    [1.05, 0.06],
    [1.5, 0.32],
    [1.25, 0.62],
    [-0.35, 0.74],
    [-1.35, 0.48],
  ];
}

function paintBrow(print: Print): void {
  print.gradient(P2.shade(PALETTE.ink, 0.12), P2.shade(PALETTE.ink, -0.08), 0.4);
  print.felt(0.6);
}

const FLIPPER_HAND_TOP_UNITS = 2.3;
const FLIPPER_CUFF_TOP_UNITS = 3.3;

function flipperOutline(): Point[] {
  return P2.fromDrawing(
    (context) => {
      P2.draw2.ell(context, 0.15, 1.2, 2.05, 1.3, 0.08);
      P2.draw2.rect(context, -1.7, FLIPPER_HAND_TOP_UNITS - 0.3, 3.4, 6.5, 0.5);
    },
    { w: 4.4, h: 8.6, name: "whale flipper" },
  );
}

function paintFlipper(print: Print): void {
  const { box } = print;
  print.gradient(SUIT_LIGHT, P2.shade(PALETTE.suit, -0.18), 0.5);
  print.draw((context) => {
    context.strokeStyle = P2.rgba(PALETTE.creamCore, 0.22);
    context.lineWidth = 0.16;
    for (let stripeX = box.x0 + 0.5; stripeX < box.x1; stripeX += 1.15) {
      context.beginPath();
      context.moveTo(stripeX, FLIPPER_CUFF_TOP_UNITS);
      context.lineTo(stripeX + 0.15, box.y1);
      context.stroke();
    }
  });
  print.layer(
    [
      [box.x0 - 0.2, FLIPPER_HAND_TOP_UNITS - 0.25],
      [box.x1 + 0.2, FLIPPER_HAND_TOP_UNITS - 0.25],
      [box.x1 + 0.2, FLIPPER_HAND_TOP_UNITS + 0.3],
      [box.x0 - 0.2, FLIPPER_HAND_TOP_UNITS + 0.3],
    ],
    PALETTE.creamCore,
    { depth: 1 },
  );
  print.layer(
    [
      [box.x0 - 0.2, FLIPPER_HAND_TOP_UNITS + 0.3],
      [box.x1 + 0.2, FLIPPER_HAND_TOP_UNITS + 0.3],
      [box.x1 + 0.2, FLIPPER_CUFF_TOP_UNITS],
      [box.x0 - 0.2, FLIPPER_CUFF_TOP_UNITS],
    ],
    P2.mix(SUIT_LIGHT, "#55658a", 0.4),
    { depth: 1.1 },
  );
  print.layer((context) => {
    context.beginPath();
    context.arc(0.95, (FLIPPER_HAND_TOP_UNITS + FLIPPER_CUFF_TOP_UNITS) / 2 + 0.15, 0.22, 0, Math.PI * 2);
    context.fill();
  }, PALETTE.mustard, { depth: 0.6 });
  print.layer((context) => {
    context.beginPath();
    context.ellipse(0.15, 1.2, 2.05, 1.3, 0.08, 0, Math.PI * 2);
    context.fill();
  }, P2.shade(PALETTE.whaleSkin, 0.06), { depth: 1.2 });
  print.layer((context) => {
    context.beginPath();
    context.ellipse(0.25, 0.75, 1.55, 0.62, 0.08, 0, Math.PI * 2);
    context.fill();
  }, PALETTE.whaleBelly, { depth: 0.8 });
  print.draw((context) => {
    context.strokeStyle = P2.rgba(WHALE_SKIN_DARK, 0.8);
    context.lineWidth = 0.14;
    context.lineCap = "round";
    for (const fingerX of [-0.7, 0.15, 1.0]) {
      context.beginPath();
      context.moveTo(fingerX, 0.35);
      context.lineTo(fingerX + 0.1, 1.05);
      context.stroke();
    }
  });
  print.felt(0.7);
  print.innerShade("#1c2a36", { alpha: 0.32, blurPx: 10 });
}

function flukeOutline(): Point[] {
  return P2.fromDrawing(
    (context) => {
      P2.draw2.rect(context, -0.55, 0, 1.1, 3.6, 0.3);
      P2.draw2.ell(context, -1.55, 4.2, 1.9, 0.95, 0.42);
      P2.draw2.ell(context, 1.55, 4.2, 1.9, 0.95, -0.42);
    },
    { w: 7.0, h: 5.4, name: "whale fluke" },
  );
}

function paintFluke(print: Print): void {
  print.gradient(P2.shade(PALETTE.whaleSkin, 0.1), WHALE_SKIN_DARK, 0.4);
  print.layer((context) => {
    context.beginPath();
    context.ellipse(0, 4.0, 2.4, 0.42, 0, 0, Math.PI * 2);
    context.fill();
  }, PALETTE.whaleBelly, { depth: 0.6 });
  print.felt(0.7);
}

function addCard(group: THREE.Group, outline: Point[], paint: PaintFn, options: CardOptions, position: [number, number, number], name: string, tiltRad = 0): THREE.Mesh {
  const card = makeCard(outline, { ...options, paint, back: "kraft" });
  card.position.set(...position);
  card.rotation.z = tiltRad;
  card.name = name;
  group.add(card);
  return card;
}

export interface WhaleModel {
  whale: PlacedPiece;
  browLeft: THREE.Mesh;
  browRight: THREE.Mesh;
}

export function buildWhale(harness: Harness, worldX: number, worldZ: number, yaw: number): WhaleModel {
  const group = new THREE.Group();
  const options = harness.cardOpts(worldX, worldZ, 1, null, 1);
  addCard(group, roundedBlock(TORSO_WIDTH_UNITS, TORSO_HEIGHT_UNITS, 3.4, 0.4), paintTorso, { ...options, seed: 701 }, [0, SEAT_HEIGHT_UNITS, 0], "whale torso");
  addCard(group, roundedBlock(HEAD_WIDTH_UNITS, HEAD_HEIGHT_UNITS, 4.2, 2.6), paintHead, { ...options, seed: 709 }, [0, HEAD_BASE_UNITS, LAYER_GAP_UNITS * 2], "whale head");
  const browBaseY = HEAD_BASE_UNITS + EYE_HEIGHT_UNITS + 1.55;
  const browLeft = addCard(group, browOutline(), paintBrow, { ...options, seed: 719 }, [-EYE_SPACING_UNITS, browBaseY, LAYER_GAP_UNITS * 4], "whale brow left", 0.06);
  const browRight = addCard(group, browOutline().map(([pointX, pointY]): Point => [-pointX, pointY]).reverse(), paintBrow, { ...options, seed: 727 }, [EYE_SPACING_UNITS, browBaseY, LAYER_GAP_UNITS * 4], "whale brow right", -0.06);
  for (const side of [-1, 1]) {
    addCard(
      group,
      flipperOutline(),
      paintFlipper,
      { ...options, seed: 733 + side },
      [side * (TORSO_WIDTH_UNITS / 2 + 0.6), TABLE_TOP_UNITS, FLIPPER_REACH_UNITS],
      side < 0 ? "whale flipper left" : "whale flipper right",
      side * 0.16,
    );
  }
  const whale = harness.popup(null, null, { node: group, height: WHALE_HEIGHT_UNITS, x: worldX, z: worldZ, yaw, level: true });
  return { whale, browLeft, browRight };
}

export function buildWhaleFluke(harness: Harness, worldX: number, worldZ: number): PlacedPiece {
  return harness.popup(flukeOutline(), paintFluke, { x: worldX, z: worldZ, cross: "half", sway: 0.3 });
}
