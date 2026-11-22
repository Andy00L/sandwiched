import * as THREE from "three";
import * as P2 from "papercraft/lib/paperkit-2d.js";
import type { Point, Print } from "papercraft/lib/paperkit-2d.js";
import { FlapSpring, Spring, hinge, makeCard } from "papercraft/lib/paperkit-3d.js";
import type { CardOptions, HingeHandle } from "papercraft/lib/paperkit-3d.js";
import { PALETTE } from "../palette";

export const HEAD_WIDTH_UNITS = 15.4;
export const HEAD_HEIGHT_UNITS = 9.6;
export const HEAD_BASE_UNITS = 12.4;
export const LAYER_GAP_UNITS = 0.18;
export const WHALE_SKIN_DARK = P2.shade(PALETTE.whaleSkin, -0.22);

export const WHALE_MOODS = ["smug", "alert", "angry", "panicked", "despair"] as const;
export type WhaleMood = (typeof WHALE_MOODS)[number];
export const EYE_PAIRS = ["lidded", "left", "right", "down", "wide", "spiral"] as const;
export type EyePair = (typeof EYE_PAIRS)[number];

export interface WhaleFace {
  setMood(mood: WhaleMood, crowdedGlance: EyePair): void;
  popSpout(nowMs: number): void;
  step(dtSeconds: number, nowMs: number): void;
  reset(): void;
}

const HEAD_Z_UNITS = LAYER_GAP_UNITS * 2;
const HEAD_TOP_RADIUS_UNITS = 4.2;
const SWEAT_DROP_HEIGHT_UNITS = 1.4;
const EYE_SPACING_UNITS = 3.9;
const EYE_HEIGHT_UNITS = 5.7;
const EYE_RADIUS_X_UNITS = 1.38;
const EYE_RADIUS_Y_UNITS = 1.05;
const EYE_DISC_INSET_UNITS = 1.84;
const EYE_DISC_DROP_UNITS = 1.54;
const EYE_DISC_RADIUS_UNITS = 3.9;
const EYE_PAIR_STEP_RAD = Math.PI / 3;
const EYE_TURN_MS = 40;
const DART_STEP_MS = 400;
const DART_PAIRS: readonly EyePair[] = ["left", "right", "down"];
const SMUG_LID_DROP = 0.1;
const BROW_HALF_LENGTH_UNITS = 1.45;
const BROW_HEIGHT_UNITS = EYE_HEIGHT_UNITS + 1.55;
const JAW_LEFT_UNITS = -4.9;
const JAW_RIGHT_UNITS = 5.5;
const JAW_TREMBLE_RAD = THREE.MathUtils.degToRad(1);
const JAW_TREMBLE_HZ = 6;
const SPOUT_STAGGER_S = 0.06;
const SPOUT_SHOW_MS = 600;
const DEGREES = THREE.MathUtils.degToRad;

interface FacePose {
  browLiftLeftRad: number;
  browLiftRightRad: number;
  jawOpenRad: number;
  eyes: EyePair | "darting" | "glance";
  sweatDrops: number;
  isJawTrembling: boolean;
}

const FACE_POSES: Record<WhaleMood, FacePose> = {
  smug: { browLiftLeftRad: DEGREES(4), browLiftRightRad: DEGREES(4), jawOpenRad: 0, eyes: "lidded", sweatDrops: 0, isJawTrembling: false },
  alert: { browLiftLeftRad: 0, browLiftRightRad: DEGREES(18), jawOpenRad: 0, eyes: "glance", sweatDrops: 0, isJawTrembling: false },
  angry: { browLiftLeftRad: DEGREES(-25), browLiftRightRad: DEGREES(-25), jawOpenRad: DEGREES(12), eyes: "wide", sweatDrops: 0, isJawTrembling: false },
  panicked: { browLiftLeftRad: DEGREES(22), browLiftRightRad: DEGREES(22), jawOpenRad: DEGREES(20), eyes: "darting", sweatDrops: 1, isJawTrembling: false },
  despair: { browLiftLeftRad: DEGREES(30), browLiftRightRad: DEGREES(30), jawOpenRad: DEGREES(8), eyes: "down", sweatDrops: 3, isJawTrembling: true },
};

export function roundedBlock(width: number, height: number, topRadius: number, bottomRadius: number): Point[] {
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

function ellipsePoints(centreX: number, centreY: number, radiusX: number, radiusY: number, count: number): Point[] {
  return [...Array(count).keys()].map((step): Point => {
    const angle = (step / count) * Math.PI * 2;
    return [centreX + Math.cos(angle) * radiusX, centreY + Math.sin(angle) * radiusY];
  });
}

function mouthLineY(pointX: number): number {
  const smirk = pointX > 2.2 ? (pointX - 2.2) * 0.32 : 0;
  return 3.05 + 0.018 * pointX * pointX + smirk;
}

function jawOutline(): Point[] {
  const steps = 20;
  return [
    [JAW_LEFT_UNITS + 0.5, 0.25],
    [JAW_RIGHT_UNITS - 0.5, 0.25],
    ...[...Array(steps + 1).keys()].map((step): Point => {
      const pointX = JAW_RIGHT_UNITS - ((JAW_RIGHT_UNITS - JAW_LEFT_UNITS) * step) / steps;
      return [pointX, mouthLineY(pointX)];
    }),
  ];
}

function paintHead(print: Print): void {
  const { box } = print;
  print.gradient(P2.shade(PALETTE.whaleSkin, 0.12), WHALE_SKIN_DARK, 0.55);
  print.layer((context) => {
    for (const [spotX, spotY, radius] of [
      [-5.2, 8.1, 0.32],
      [-4.2, 8.7, 0.22],
      [-6.1, 7.2, 0.24],
      [5.6, 8.2, 0.26],
      [4.7, 8.9, 0.18],
    ] as const) {
      context.beginPath();
      context.arc(spotX, spotY, radius, 0, Math.PI * 2);
      context.fill();
    }
  }, P2.mix(PALETTE.whaleSkin, PALETTE.creamCore, 0.45), { depth: 0.6 });
  print.layer((context) => {
    for (const [patchX, patchY, radiusX, radiusY] of [
      [-1.0, 8.6, 2.6, 0.7],
      [4.2, 7.6, 1.4, 0.55],
      [-6.2, 4.4, 0.9, 0.7],
    ] as const) {
      context.beginPath();
      context.ellipse(patchX, patchY, radiusX, radiusY, 0.15, 0, Math.PI * 2);
      context.fill();
    }
  }, WHALE_SKIN_DARK, { depth: 0.6, lip: 0.4 });
  print.layer((context) => {
    for (const side of [-1, 1]) {
      context.beginPath();
      context.ellipse(side * EYE_SPACING_UNITS, EYE_HEIGHT_UNITS, EYE_RADIUS_X_UNITS + 0.32, EYE_RADIUS_Y_UNITS + 0.3, 0, 0, Math.PI * 2);
      context.fill();
    }
  }, P2.shade(PALETTE.whaleSkin, -0.12), { depth: 0.7, lip: 0.4 });
  const belly: Point[] = [
    [box.x0 - 0.2, -0.2],
    [box.x1 + 0.2, -0.2],
    ...[...Array(25).keys()].map((step): Point => {
      const pointX = box.x1 + 0.2 - ((box.w + 0.4) * step) / 24;
      return [pointX, mouthLineY(pointX)];
    }),
  ];
  print.layer(belly, PALETTE.whaleBelly, { depth: 1.2 });
  print.layer(jawOutline(), P2.shade(PALETTE.creamCore, -0.06), { depth: 0.8 });
  print.layer((context) => {
    context.beginPath();
    context.ellipse(2.4, 1.5, 1.9, 0.95, -0.12, 0, Math.PI * 2);
    context.fill();
  }, PALETTE.tomato, { depth: 0.8, lip: 0.5 });
  print.draw((context) => {
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
  print.layer((context) => {
    context.beginPath();
    context.ellipse(-2.4, 8.75, 0.62, 0.24, -0.1, 0, Math.PI * 2);
    context.fill();
  }, P2.shade(PALETTE.whaleSkin, -0.45), { depth: 0.6, lip: 0.4 });
  print.felt(0.7);
  print.innerShade("#1c2a36", { alpha: 0.35, blurPx: 16 });
}

function paintJaw(print: Print): void {
  print.gradient(P2.shade(PALETTE.whaleBelly, 0.06), P2.shade(PALETTE.whaleBelly, -0.1), 0.5);
  print.draw((context) => {
    context.strokeStyle = P2.rgba(P2.shade(PALETTE.whaleBelly, -0.28), 0.85);
    context.lineWidth = 0.22;
    context.lineCap = "round";
    for (let groove = 0; groove < 5; groove++) {
      const grooveY = 0.65 + groove * 0.48;
      context.beginPath();
      context.moveTo(-4.4 + groove * 0.35, grooveY + 0.15);
      context.quadraticCurveTo(0.3, grooveY - 0.25, 5.0 - groove * 0.35, grooveY + 0.15);
      context.stroke();
    }
  });
  print.felt(0.7);
  print.innerShade(P2.shade(PALETTE.whaleBelly, -0.5), { alpha: 0.3, blurPx: 10 });
}

function holeOffset(side: -1 | 1): Point {
  return [side * EYE_DISC_INSET_UNITS, EYE_DISC_DROP_UNITS];
}

function traceEyeWindow(context: CanvasRenderingContext2D): void {
  context.beginPath();
  context.ellipse(0, 0, EYE_RADIUS_X_UNITS, EYE_RADIUS_Y_UNITS, 0, 0, Math.PI * 2);
}

function lidEdgeY(offsetX: number): number {
  const across = offsetX / EYE_RADIUS_X_UNITS;
  return -SMUG_LID_DROP + 0.16 * across - 0.12 * (1 - across * across);
}

function drawPupil(context: CanvasRenderingContext2D, centreX: number, centreY: number, radius: number): void {
  context.beginPath();
  context.arc(centreX, centreY, radius, 0, Math.PI * 2);
  context.fill();
}

const PUPIL_SPOTS: Record<Exclude<EyePair, "spiral">, { pupilX: number; pupilY: number; radius: number }> = {
  lidded: { pupilX: 0.45, pupilY: -0.28, radius: 0.56 },
  left: { pupilX: -0.55, pupilY: -0.05, radius: 0.56 },
  right: { pupilX: 0.55, pupilY: -0.05, radius: 0.56 },
  down: { pupilX: 0.05, pupilY: -0.55, radius: 0.56 },
  wide: { pupilX: 0, pupilY: 0.05, radius: 0.32 },
};

function withPairFrame(context: CanvasRenderingContext2D, side: -1 | 1, pairIndex: number, drawing: () => void): void {
  const [offsetX, offsetY] = holeOffset(side);
  context.save();
  context.rotate(pairIndex * EYE_PAIR_STEP_RAD);
  context.translate(offsetX, offsetY);
  drawing();
  context.restore();
}

function paintEyeDisc(side: -1 | 1): (print: Print) => void {
  return (print) => {
    print.gradient(PALETTE.creamCore, P2.shade(PALETTE.creamCore, -0.08), 0.5);
    print.layer((context) => {
      EYE_PAIRS.forEach((pair, pairIndex) => {
        if (pair === "spiral") return;
        const spot = PUPIL_SPOTS[pair];
        withPairFrame(context, side, pairIndex, () => drawPupil(context, spot.pupilX, spot.pupilY, spot.radius));
      });
    }, PALETTE.ink, { depth: 0.5, lip: 0.3 });
    print.draw((context) => {
      context.fillStyle = P2.rgba(PALETTE.creamCore, 0.95);
      EYE_PAIRS.forEach((pair, pairIndex) => {
        if (pair === "spiral" || pair === "wide") return;
        const spot = PUPIL_SPOTS[pair];
        withPairFrame(context, side, pairIndex, () => drawPupil(context, spot.pupilX - 0.2, spot.pupilY + 0.18, 0.15));
      });
      context.strokeStyle = P2.rgba(PALETTE.ink, 0.92);
      context.lineWidth = 0.16;
      context.lineCap = "round";
      withPairFrame(context, side, EYE_PAIRS.indexOf("spiral"), () => {
        context.beginPath();
        for (let step = 0; step <= 48; step++) {
          const angle = step * 0.32 * side;
          const radius = 0.05 + step * 0.016;
          if (step === 0) context.moveTo(Math.cos(angle) * radius, Math.sin(angle) * radius);
          else context.lineTo(Math.cos(angle) * radius, Math.sin(angle) * radius);
        }
        context.stroke();
      });
    });
    print.layer((context) => {
      withPairFrame(context, side, EYE_PAIRS.indexOf("lidded"), () => {
        context.save();
        traceEyeWindow(context);
        context.clip();
        context.beginPath();
        context.moveTo(-EYE_RADIUS_X_UNITS - 0.1, EYE_RADIUS_Y_UNITS + 0.2);
        context.lineTo(EYE_RADIUS_X_UNITS + 0.1, EYE_RADIUS_Y_UNITS + 0.2);
        for (let step = 0; step <= 16; step++) {
          const offsetX = EYE_RADIUS_X_UNITS + 0.1 - ((EYE_RADIUS_X_UNITS * 2 + 0.2) * step) / 16;
          context.lineTo(offsetX, lidEdgeY(offsetX));
        }
        context.closePath();
        context.fill();
        context.restore();
      });
    }, P2.shade(PALETTE.whaleSkin, -0.06), { depth: 1.0, lip: 0.5 });
    print.draw((context) => {
      context.strokeStyle = P2.rgba(PALETTE.ink, 0.92);
      context.lineWidth = 0.22;
      context.lineCap = "round";
      withPairFrame(context, side, EYE_PAIRS.indexOf("lidded"), () => {
        context.beginPath();
        for (let step = 0; step <= 16; step++) {
          const offsetX = EYE_RADIUS_X_UNITS * 0.98 - (EYE_RADIUS_X_UNITS * 1.96 * step) / 16;
          if (step === 0) context.moveTo(offsetX, lidEdgeY(offsetX));
          else context.lineTo(offsetX, lidEdgeY(offsetX));
        }
        context.stroke();
      });
    });
    print.felt(0.5);
  };
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

function spoutOutline(): Point[] {
  return P2.fromDrawing(
    (context) => {
      P2.draw2.rect(context, -0.22, 0, 0.44, 1.2, 0.2);
      P2.draw2.ell(context, 0, 1.5, 0.62, 0.5);
      P2.draw2.ell(context, -0.4, 1.95, 0.42, 0.38);
      P2.draw2.ell(context, 0.38, 2.05, 0.46, 0.4);
    },
    { w: 1.9, h: 2.6, name: "whale spout puff" },
  );
}

function paintSpout(print: Print): void {
  print.gradient(PALETTE.creamCore, P2.shade(PALETTE.creamCore, -0.1), 0.5);
  print.draw((context) => {
    context.strokeStyle = P2.rgba(P2.shade(PALETTE.creamCore, -0.35), 0.8);
    context.lineWidth = 0.09;
    context.beginPath();
    for (let step = 0; step <= 30; step++) {
      const angle = step * 0.36;
      const radius = 0.04 + step * 0.014;
      if (step === 0) context.moveTo(Math.cos(angle) * radius, 1.6 + Math.sin(angle) * radius);
      else context.lineTo(Math.cos(angle) * radius, 1.6 + Math.sin(angle) * radius);
    }
    context.stroke();
  });
  print.felt(0.6);
}

function sweatOutline(): Point[] {
  return P2.fromDrawing(
    (context) => {
      P2.draw2.ell(context, 0.58, 0.42, 0.42, 0.42);
      P2.draw2.poly(context, [
        [0.2, 0.55],
        [0.96, 0.55],
        [0.58, SWEAT_DROP_HEIGHT_UNITS],
      ]);
    },
    { w: 2.4, h: 1.6, name: "whale sweat drop" },
  );
}

function paintSweat(print: Print): void {
  print.gradient(PALETTE.creamCore, P2.shade(PALETTE.creamCore, -0.06), 0.4);
  print.layer((context) => {
    context.beginPath();
    context.ellipse(0.58, 0.3, 0.34, 0.2, 0, 0, Math.PI * 2);
    context.fill();
  }, P2.mix(PALETTE.creamCore, PALETTE.teal, 0.45), { depth: 0.5 });
  print.felt(0.5);
}

function headEdgeX(headY: number): number {
  const half = HEAD_WIDTH_UNITS / 2;
  const cornerCentreY = HEAD_HEIGHT_UNITS - HEAD_TOP_RADIUS_UNITS;
  if (headY <= cornerCentreY) return half;
  return half - HEAD_TOP_RADIUS_UNITS + Math.sqrt(HEAD_TOP_RADIUS_UNITS ** 2 - (headY - cornerCentreY) ** 2);
}

function placeCard(group: THREE.Object3D, outline: Point[], paint: (print: Print) => void, options: CardOptions, name: string, extra: Partial<CardOptions> = {}): THREE.Mesh {
  const card = makeCard(outline, { ...options, paint, back: "kraft", ...extra });
  card.name = name;
  group.add(card);
  return card;
}

function pivotAt(group: THREE.Group, headX: number, headY: number, depth: number): THREE.Group {
  const pivot = new THREE.Group();
  pivot.position.set(headX, HEAD_BASE_UNITS + headY, depth);
  group.add(pivot);
  return pivot;
}

function shortestTurnTarget(current: number, target: number): number {
  const fullTurn = Math.PI * 2;
  return target + Math.round((current - target) / fullTurn) * fullTurn;
}

function smoothstep(progress: number): number {
  const clamped = Math.min(1, Math.max(0, progress));
  return clamped * clamped * (3 - 2 * clamped);
}

export function buildWhaleFace(group: THREE.Group, options: CardOptions): WhaleFace {
  const eyeHoles = [-1, 1].map((side) => ellipsePoints(side * EYE_SPACING_UNITS, EYE_HEIGHT_UNITS, EYE_RADIUS_X_UNITS, EYE_RADIUS_Y_UNITS, 28));
  const head = placeCard(group, roundedBlock(HEAD_WIDTH_UNITS, HEAD_HEIGHT_UNITS, HEAD_TOP_RADIUS_UNITS, 2.6), paintHead, { ...options, seed: 709 }, "whale head", { holes: eyeHoles });
  head.position.set(0, HEAD_BASE_UNITS, HEAD_Z_UNITS);

  const eyeDiscs = ([-1, 1] as const).map((side) => {
    const [offsetX, offsetY] = holeOffset(side);
    const pivot = pivotAt(group, side * EYE_SPACING_UNITS - offsetX, EYE_HEIGHT_UNITS - offsetY, HEAD_Z_UNITS - LAYER_GAP_UNITS * (side < 0 ? 1 : 0.5));
    placeCard(pivot, ellipsePoints(0, 0, EYE_DISC_RADIUS_UNITS, EYE_DISC_RADIUS_UNITS, 40), paintEyeDisc(side), { ...options, seed: 741 + side }, `whale eye wheel ${side < 0 ? "left" : "right"}`, { folds: [] });
    return pivot;
  });

  const brows = ([-1, 1] as const).map((side) => {
    const pivot = pivotAt(group, side * (EYE_SPACING_UNITS + BROW_HALF_LENGTH_UNITS), BROW_HEIGHT_UNITS, LAYER_GAP_UNITS * 4);
    const outline = side < 0 ? browOutline() : browOutline().map(([pointX, pointY]): Point => [-pointX, pointY]).reverse();
    const card = placeCard(pivot, outline, paintBrow, { ...options, seed: 719 + side * 4 }, `whale brow ${side < 0 ? "left" : "right"}`);
    card.position.x = -side * BROW_HALF_LENGTH_UNITS;
    return { side, pivot, spring: new Spring({ value: FACE_POSES.smug.browLiftLeftRad, hz: 5, zeta: 0.55 }) };
  });

  const jawPivot = pivotAt(group, JAW_LEFT_UNITS, mouthLineY(JAW_LEFT_UNITS), HEAD_Z_UNITS + LAYER_GAP_UNITS);
  const jaw = placeCard(jawPivot, jawOutline(), paintJaw, { ...options, seed: 751 }, "whale jaw");
  jaw.position.set(-JAW_LEFT_UNITS, -mouthLineY(JAW_LEFT_UNITS), 0);

  const spoutOutlineShared = spoutOutline();
  const spouts: HingeHandle[] = (
    [
      [-4.4, 0.85],
      [-2.4, 1.15],
      [-0.4, 0.95],
    ] as const
  ).map(([headX, scale], spoutIndex) => {
    const puff = new THREE.Group();
    placeCard(puff, spoutOutlineShared, paintSpout, { ...options, seed: 761 + spoutIndex }, `whale spout ${spoutIndex}`);
    puff.scale.setScalar(scale);
    const handle = hinge(puff, { at: new THREE.Vector3(headX, HEAD_BASE_UNITS + HEAD_HEIGHT_UNITS - 0.5, HEAD_Z_UNITS - LAYER_GAP_UNITS * 1.5), open: 0, flat: -Math.PI, rest: 0, size: 0.2 });
    group.add(handle.group);
    return handle;
  });

  const sweatOutlineShared = sweatOutline();
  const sweatDrops = [6.6, 5.1, 3.6].map((headY, dropIndex) => {
    const pivot = pivotAt(group, headEdgeX(headY + SWEAT_DROP_HEIGHT_UNITS) - 0.1, headY, HEAD_Z_UNITS - LAYER_GAP_UNITS * 0.5);
    placeCard(pivot, sweatOutlineShared, paintSweat, { ...options, seed: 771 + dropIndex }, `whale sweat drop ${dropIndex}`);
    pivot.rotation.y = Math.PI;
    return { pivot, spring: new FlapSpring({ p: 0, size: 0.1 }) };
  });

  const jawSpring = new Spring({ value: 0, hz: 4, zeta: 0.5 });
  let mood: WhaleMood = "smug";
  let glance: EyePair = "down";
  let eyeAngle = 0;
  let eyeTurn = { fromAngle: 0, toAngle: 0, startMs: Number.NEGATIVE_INFINITY };
  let spoutHideMs = Number.NEGATIVE_INFINITY;
  let isSpoutUp = false;

  function eyePairNow(pose: FacePose, nowMs: number): EyePair {
    if (pose.eyes === "glance") return glance;
    if (pose.eyes === "darting") return DART_PAIRS[Math.floor(nowMs / DART_STEP_MS) % DART_PAIRS.length] ?? "down";
    return pose.eyes;
  }

  function turnEyes(pair: EyePair, nowMs: number): void {
    const target = shortestTurnTarget(eyeAngle, -EYE_PAIRS.indexOf(pair) * EYE_PAIR_STEP_RAD);
    if (Math.abs(target - eyeTurn.toAngle) > 1e-6) eyeTurn = { fromAngle: eyeAngle, toAngle: target, startMs: nowMs };
    eyeAngle = eyeTurn.fromAngle + (eyeTurn.toAngle - eyeTurn.fromAngle) * smoothstep((nowMs - eyeTurn.startMs) / EYE_TURN_MS);
    for (const disc of eyeDiscs) disc.rotation.z = eyeAngle;
  }

  return {
    setMood(nextMood, crowdedGlance) {
      mood = nextMood;
      glance = crowdedGlance;
    },
    popSpout(nowMs) {
      spoutHideMs = nowMs + SPOUT_SHOW_MS;
      isSpoutUp = true;
      spouts.forEach((spout, spoutIndex) => spout.set(1, spoutIndex * SPOUT_STAGGER_S));
    },
    step(dtSeconds, nowMs) {
      const pose = FACE_POSES[mood];
      for (const { side, pivot, spring } of brows) {
        spring.set(side < 0 ? pose.browLiftLeftRad : pose.browLiftRightRad);
        pivot.rotation.z = -side * spring.step(dtSeconds);
      }
      jawSpring.set(pose.jawOpenRad);
      const tremble = pose.isJawTrembling ? Math.sin((nowMs / 1000) * Math.PI * 2 * JAW_TREMBLE_HZ) * JAW_TREMBLE_RAD : 0;
      jawPivot.rotation.z = -(jawSpring.step(dtSeconds) + tremble);
      turnEyes(eyePairNow(pose, nowMs), nowMs);
      sweatDrops.forEach((drop, dropIndex) => {
        drop.spring.set(dropIndex < pose.sweatDrops ? 1 : 0);
        drop.pivot.rotation.y = (1 - drop.spring.step(dtSeconds)) * Math.PI;
      });
      if (isSpoutUp && nowMs >= spoutHideMs) {
        isSpoutUp = false;
        for (const spout of spouts) spout.set(0);
      }
      for (const spout of spouts) spout.update(dtSeconds);
    },
    reset() {
      mood = "smug";
      glance = "down";
      eyeAngle = 0;
      eyeTurn = { fromAngle: 0, toAngle: 0, startMs: Number.NEGATIVE_INFINITY };
      spoutHideMs = Number.NEGATIVE_INFINITY;
      isSpoutUp = false;
      for (const { spring } of brows) spring.reset(FACE_POSES.smug.browLiftLeftRad);
      jawSpring.reset(0);
      for (const spout of spouts) spout.reset(0);
      for (const drop of sweatDrops) {
        drop.spring.reset(0);
        drop.pivot.rotation.y = Math.PI;
      }
      for (const disc of eyeDiscs) disc.rotation.z = 0;
    },
  };
}
