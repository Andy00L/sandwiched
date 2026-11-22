import * as THREE from "three";
import type { Harness, PlacedPiece } from "papercraft/harness.js";
import * as P2 from "papercraft/lib/paperkit-2d.js";
import type { Point, Print } from "papercraft/lib/paperkit-2d.js";
import { makeCard } from "papercraft/lib/paperkit-3d.js";
import { PALETTE } from "../palette";
import { roundedBlock } from "./whale-face";

const BODY_WIDTH_UNITS = 3.5;
const BODY_HEIGHT_UNITS = 4.0;
const DIAL_CENTRE_Y_UNITS = 2.05;
const DIAL_RADIUS_UNITS = 1.35;
const HAND_LENGTH_UNITS = 1.16;
const LAYER_GAP_UNITS = 0.04;
const TICK_COUNT = 12;
const FULL_TURN_RAD = Math.PI * 2;

export interface KitchenTimer {
  piece: PlacedPiece;
  pose(sweep: number, kickRad: number): void;
}

function dialPoint(sweep: number, radius: number): Point {
  const angle = sweep * FULL_TURN_RAD;
  return [Math.sin(angle) * radius, DIAL_CENTRE_Y_UNITS + Math.cos(angle) * radius];
}

function wedgePoints(wedgeShare: number): Point[] {
  const steps = 18;
  const arc = Array.from({ length: steps + 1 }, (_unused, step) => dialPoint(1 - wedgeShare + (wedgeShare * step) / steps, DIAL_RADIUS_UNITS * 0.92));
  return [[0, DIAL_CENTRE_Y_UNITS], ...arc];
}

function circlePoints(radius: number, count: number): Point[] {
  return Array.from({ length: count }, (_unused, index) => dialPoint(index / count, radius));
}

function paintBody(wedgeShare: number): (print: Print) => void {
  return (print) => {
    print.gradient(P2.shade(PALETTE.tomato, 0.12), P2.shade(PALETTE.tomato, -0.16), 0.35);
    print.layer(circlePoints(DIAL_RADIUS_UNITS + 0.12, 48), P2.shade(PALETTE.tomato, -0.28), { depth: 0.3 });
    print.layer(circlePoints(DIAL_RADIUS_UNITS, 48), PALETTE.creamCore, { depth: 0.6, lip: 0.5 });
    print.layer(wedgePoints(wedgeShare), PALETTE.tomato, { depth: 0.3 });
    print.draw((context) => {
      context.strokeStyle = P2.rgba(PALETTE.ink, 0.85);
      for (let tick = 0; tick < TICK_COUNT; tick++) {
        const isQuarter = tick % 3 === 0;
        const [outerX, outerY] = dialPoint(tick / TICK_COUNT, DIAL_RADIUS_UNITS * 0.9);
        const [innerX, innerY] = dialPoint(tick / TICK_COUNT, DIAL_RADIUS_UNITS * (isQuarter ? 0.68 : 0.76));
        context.lineWidth = isQuarter ? 0.09 : 0.05;
        context.beginPath();
        context.moveTo(outerX, outerY);
        context.lineTo(innerX, innerY);
        context.stroke();
      }
    });
    print.felt(0.4);
  };
}

function handOutline(): Point[] {
  return [
    [-0.09, -0.2],
    [0.09, -0.2],
    [0.06, HAND_LENGTH_UNITS - 0.16],
    [0, HAND_LENGTH_UNITS],
    [-0.06, HAND_LENGTH_UNITS - 0.16],
  ];
}

function paintHand(print: Print): void {
  print.fill(PALETTE.ink);
  print.layer(circlePoints(0.17, 16).map(([pointX, pointY]): Point => [pointX, pointY - DIAL_CENTRE_Y_UNITS]), P2.shade(PALETTE.mustard, -0.05), { depth: 0.4 });
}

export function buildKitchenTimer(
  harness: Harness,
  deck: THREE.Object3D,
  placement: { x: number; z: number; yaw: number; order: number },
  wedgeShare: number,
): KitchenTimer {
  const options = harness.cardOpts(0, 0, 1, deck);
  const root = new THREE.Group();
  const kickPivot = new THREE.Group();
  root.add(kickPivot);
  const body = makeCard(roundedBlock(BODY_WIDTH_UNITS, BODY_HEIGHT_UNITS, BODY_WIDTH_UNITS / 2, 0.3), { ...options, paint: paintBody(wedgeShare), back: "kraft", seed: 881 });
  body.name = "kitchen timer body";
  kickPivot.add(body);
  const handPivot = new THREE.Group();
  handPivot.position.set(0, DIAL_CENTRE_Y_UNITS, LAYER_GAP_UNITS * 3);
  kickPivot.add(handPivot);
  const hand = makeCard(handOutline(), { ...options, paint: paintHand, back: "kraft", seed: 883, folds: [] });
  hand.name = "kitchen timer hand";
  handPivot.add(hand);
  const piece = harness.popup(null, null, { node: root, height: BODY_HEIGHT_UNITS, parent: deck, x: placement.x, z: placement.z, yaw: placement.yaw, order: placement.order, level: true });
  return {
    piece,
    pose(sweep, kickRad) {
      handPivot.rotation.z = -Math.min(1, Math.max(0, sweep)) * FULL_TURN_RAD;
      kickPivot.rotation.z = kickRad;
    },
  };
}
