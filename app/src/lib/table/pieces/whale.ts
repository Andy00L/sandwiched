import * as THREE from "three";
import type { Harness, PlacedPiece } from "papercraft/harness.js";
import * as P2 from "papercraft/lib/paperkit-2d.js";
import type { PaintFn, Point, Print } from "papercraft/lib/paperkit-2d.js";
import { makeCard } from "papercraft/lib/paperkit-3d.js";
import type { CardOptions } from "papercraft/lib/paperkit-3d.js";
import { PALETTE } from "../palette";
import { buildWhaleFace, HEAD_BASE_UNITS, HEAD_HEIGHT_UNITS, LAYER_GAP_UNITS, roundedBlock, WHALE_SKIN_DARK } from "./whale-face";
import type { WhaleFace } from "./whale-face";
import { FOREARM_UNITS, UPPER_ARM_UNITS, poseArm } from "../replay/arm-rig";
import type { ArmRig } from "../replay/arm-rig";

const SEAT_HEIGHT_UNITS = 2.3;
const TORSO_WIDTH_UNITS = 16.8;
const TORSO_HEIGHT_UNITS = 11.4;
const SUIT_LIGHT = "#3e4c66";
const WHALE_HEIGHT_UNITS = HEAD_BASE_UNITS + HEAD_HEIGHT_UNITS;

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

const FLIPPER_HAND_TOP_UNITS = 2.3;
const FLIPPER_CUFF_TOP_UNITS = 3.3;

const SHOULDER_HEIGHT_UNITS = 12.4;
const SHOULDER_INSET_UNITS = 0.5;
const ARM_OVERLAP_UNITS = 0.5;
const TABLE_TOP_LOCAL_UNITS = 3.96;
const REST_HAND_FORWARD_UNITS = 6.4;
export const TOWARD_CAMERA_IN_WHALE = new THREE.Vector3(-0.14, 0.73, 0.67).normalize();

export function restHandPosition(side: -1 | 1): THREE.Vector3 {
  return new THREE.Vector3(side * (TORSO_WIDTH_UNITS / 2 + 1.2), TABLE_TOP_LOCAL_UNITS + 0.35, REST_HAND_FORWARD_UNITS);
}

function forearmOutline(): Point[] {
  return P2.fromDrawing(
    (context) => {
      P2.draw2.ell(context, 0.15, 1.2, 2.05, 1.3, 0.08);
      P2.draw2.rect(context, -1.6, FLIPPER_HAND_TOP_UNITS - 0.3, 3.2, FOREARM_UNITS - FLIPPER_HAND_TOP_UNITS + 0.3 + ARM_OVERLAP_UNITS, 0.6);
    },
    { w: 4.4, h: FOREARM_UNITS + ARM_OVERLAP_UNITS + 0.2, name: "whale forearm" },
  );
}

function upperArmOutline(): Point[] {
  return P2.fromDrawing((context) => P2.draw2.rect(context, -1.7, 0, 3.4, UPPER_ARM_UNITS + ARM_OVERLAP_UNITS, 1.0), {
    w: 3.6,
    h: UPPER_ARM_UNITS + ARM_OVERLAP_UNITS + 0.1,
    name: "whale upper arm",
  });
}

function paintSleeve(print: Print): void {
  const { box } = print;
  print.gradient(SUIT_LIGHT, P2.shade(PALETTE.suit, -0.2), 0.5);
  print.draw((context) => {
    context.strokeStyle = P2.rgba(PALETTE.creamCore, 0.22);
    context.lineWidth = 0.16;
    for (let stripeX = box.x0 + 0.45; stripeX < box.x1; stripeX += 1.15) {
      context.beginPath();
      context.moveTo(stripeX, box.y0);
      context.lineTo(stripeX + 0.12, box.y1);
      context.stroke();
    }
  });
  print.felt(0.7);
  print.innerShade("#141a26", { alpha: 0.35, blurPx: 10 });
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

function addCard(group: THREE.Group, outline: Point[], paint: PaintFn, options: CardOptions, position: [number, number, number], name: string): THREE.Mesh {
  const card = makeCard(outline, { ...options, paint, back: "kraft" });
  card.position.set(...position);
  card.name = name;
  group.add(card);
  return card;
}

export interface WhaleModel {
  whale: PlacedPiece;
  face: WhaleFace;
  group: THREE.Group;
  leftArm: ArmRig;
  rightArm: ArmRig;
}

export function buildWhale(harness: Harness, worldX: number, worldZ: number, yaw: number): WhaleModel {
  const group = new THREE.Group();
  const options = harness.cardOpts(worldX, worldZ, 1, null, 1);
  addCard(group, roundedBlock(TORSO_WIDTH_UNITS, TORSO_HEIGHT_UNITS, 3.4, 0.4), paintTorso, { ...options, seed: 701 }, [0, SEAT_HEIGHT_UNITS, 0], "whale torso");
  const face = buildWhaleFace(group, options);
  const buildArm = (side: -1 | 1): ArmRig => {
    const name = side < 0 ? "whale arm left" : "whale arm right";
    const upper = new THREE.Group();
    const fore = new THREE.Group();
    const upperCard = makeCard(upperArmOutline(), { ...options, paint: paintSleeve, back: "kraft", seed: 731 + side });
    upperCard.position.set(0, -UPPER_ARM_UNITS, 0);
    upperCard.name = `${name} upper`;
    upper.add(upperCard);
    const foreCard = makeCard(forearmOutline(), { ...options, paint: paintFlipper, back: "kraft", seed: 737 + side });
    foreCard.position.set(0, -FOREARM_UNITS, 0);
    foreCard.name = `${name} forearm`;
    fore.add(foreCard);
    group.add(upper, fore);
    const rig: ArmRig = {
      upper,
      fore,
      side,
      shoulder: new THREE.Vector3(side * (TORSO_WIDTH_UNITS / 2 - SHOULDER_INSET_UNITS), SHOULDER_HEIGHT_UNITS, LAYER_GAP_UNITS * 3),
    };
    poseArm(rig, restHandPosition(side), TOWARD_CAMERA_IN_WHALE);
    return rig;
  };
  const leftArm = buildArm(-1);
  const rightArm = buildArm(1);
  const whale = harness.popup(null, null, { node: group, height: WHALE_HEIGHT_UNITS, x: worldX, z: worldZ, yaw, level: true });
  return { whale, group, face, leftArm, rightArm };
}

export function buildWhaleFluke(harness: Harness, worldX: number, worldZ: number): PlacedPiece {
  return harness.popup(flukeOutline(), paintFluke, { x: worldX, z: worldZ, cross: "half", sway: 0.3 });
}
