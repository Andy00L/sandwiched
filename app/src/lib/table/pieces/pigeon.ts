import type * as THREE from "three";
import * as P2 from "papercraft/lib/paperkit-2d.js";
import type { Ink, PaintFn, Point, Print } from "papercraft/lib/paperkit-2d.js";
import { makeCard } from "papercraft/lib/paperkit-3d.js";
import type { CardOptions } from "papercraft/lib/paperkit-3d.js";
import { KRAFT_INKS, PALETTE } from "../palette";

const PIGEON_HEAD = "#6c7484";
const PIGEON_WING = "#b2b9c3";
const PIGEON_BELLY = "#c8cdd4";
const PIGEON_TAIL = "#4f5765";
const PIGEON_BAR = "#3f4654";
const FEATHER_COUNT = 3;
const KRAFT_CAP = "#8a6649";

function eggOutline(centreX: number, centreY: number, radiusX: number, radiusY: number, taperBack: number, steps = 48): Point[] {
  return [...Array(steps).keys()].map((step) => {
    const angle = (step / steps) * Math.PI * 2;
    const cosine = Math.cos(angle);
    const backness = Math.max(0, -cosine);
    const pointX = centreX + radiusX * cosine * (cosine < 0 ? 1.12 : 1);
    const pointY = centreY + radiusY * Math.sin(angle) * (1 - taperBack * backness);
    return [pointX, Math.max(0, pointY)];
  });
}

function fillPolygon(context: CanvasRenderingContext2D, pts: Point[]): void {
  P2.draw2.poly(context, pts);
}

function drawSittingPigeon(context: CanvasRenderingContext2D, ink: Ink): void {
  context.fillStyle = ink(PIGEON_TAIL);
  fillPolygon(context, [
    [-0.9, 1.0],
    [-2.35, 1.42],
    [-2.45, 1.05],
    [-2.3, 0.68],
    [-0.9, 0.42],
  ]);
  context.fillStyle = ink(P2.mix(PIGEON_TAIL, PALETTE.creamCore, 0.45));
  fillPolygon(context, [
    [-2.05, 1.34],
    [-2.35, 1.42],
    [-2.45, 1.05],
    [-2.3, 0.68],
    [-2.02, 0.74],
  ]);

  context.fillStyle = ink(PALETTE.pigeonGrey);
  fillPolygon(context, eggOutline(0.05, 1.0, 1.45, 1.1, 0.3));

  context.fillStyle = ink(PIGEON_BELLY);
  fillPolygon(context, eggOutline(0.55, 0.78, 0.82, 0.7, 0.1));

  context.fillStyle = ink(PALETTE.pigeonGrey);
  P2.draw2.ell(context, 1.0, 2.0, 0.58, 0.8, -0.35);
  context.fillStyle = ink(PALETTE.teal);
  P2.draw2.ell(context, 1.04, 1.92, 0.55, 0.48, -0.35);
  context.fillStyle = ink(PALETTE.plum);
  P2.draw2.ell(context, 1.16, 1.66, 0.42, 0.26, -0.2);

  context.fillStyle = ink(PIGEON_WING);
  fillPolygon(context, [
    [0.75, 1.72],
    [0.2, 1.98],
    [-0.75, 1.8],
    [-1.6, 1.2],
    [-1.85, 0.8],
    [-0.6, 0.66],
    [0.5, 1.0],
  ]);
  for (let feather = 0; feather < FEATHER_COUNT; feather++) {
    context.fillStyle = ink(P2.shade(PIGEON_WING, -0.12 - 0.07 * feather));
    P2.draw2.ell(context, -1.5 + feather * 0.46, 0.86 + feather * 0.1, 0.44, 0.26, 0.3);
  }
  context.fillStyle = ink(PIGEON_BAR);
  fillPolygon(context, [
    [0.02, 1.7],
    [0.36, 1.54],
    [-0.62, 1.0],
    [-0.96, 1.16],
  ]);
  fillPolygon(context, [
    [0.5, 1.38],
    [0.8, 1.2],
    [-0.08, 0.76],
    [-0.4, 0.92],
  ]);

  context.fillStyle = ink(PIGEON_HEAD);
  P2.draw2.ell(context, 1.2, 2.74, 0.64, 0.6);

  context.fillStyle = ink(PALETTE.mustard);
  fillPolygon(context, [
    [1.7, 2.9],
    [2.36, 2.7],
    [1.7, 2.5],
  ]);
  context.fillStyle = ink(PALETTE.creamCore);
  P2.draw2.ell(context, 1.78, 2.84, 0.15, 0.09, -0.2);
  context.fillStyle = ink(PALETTE.ink, "print");
  P2.draw2.ell(context, 2.24, 2.7, 0.1, 0.09);

  context.fillStyle = ink(PALETTE.mustard, "print");
  P2.draw2.ell(context, 1.36, 2.88, 0.23, 0.23);
  context.fillStyle = ink(PALETTE.ink, "print");
  P2.draw2.ell(context, 1.38, 2.88, 0.15, 0.15);
  context.fillStyle = ink(PALETTE.creamCore, "print");
  P2.draw2.ell(context, 1.33, 2.94, 0.055, 0.055);
}

export function sittingPigeonCard(): [Point[], PaintFn] {
  const [outline, paintParts] = P2.drawnPiece(drawSittingPigeon, { w: 5.0, h: 3.5, name: "sitting pigeon" });
  const paint: PaintFn = (print) => {
    paintParts(print);
    print.felt(0.7);
  };
  return [outline, paint];
}

const AMBIENT_PALE_SHARE = 0.32;

export function ambientPigeonCard(): [Point[], PaintFn] {
  const [outline, paintParts] = P2.drawnPiece(
    (context, ink) => drawSittingPigeon(context, (color, how) => ink(P2.mix(color, PALETTE.creamCore, AMBIENT_PALE_SHARE), how)),
    { w: 5.0, h: 3.5, name: "park pigeon" },
  );
  const paint: PaintFn = (print) => {
    paintParts(print);
    print.felt(0.7);
  };
  return [outline, paint];
}

export const PIGEON_VARIANTS = ["gary", "linda", "doug", "brenda", "keith", "sheila"] as const;
export type PigeonVariant = (typeof PIGEON_VARIANTS)[number];

export interface StandingShape {
  bodyRadiusX: number;
  bodyRadiusY: number;
  bellyScale: number;
  neckHeight: number;
  headRadius: number;
  tailLift: number;
  tailLength: number;
  sheen: string;
}

const STANDING_SHAPES: Record<PigeonVariant, StandingShape> = {
  gary: { bodyRadiusX: 1.45, bodyRadiusY: 1.1, bellyScale: 1, neckHeight: 0.62, headRadius: 0.6, tailLift: 0, tailLength: 1.45, sheen: PALETTE.teal },
  linda: { bodyRadiusX: 1.25, bodyRadiusY: 0.95, bellyScale: 1, neckHeight: 1.05, headRadius: 0.5, tailLift: 0, tailLength: 1.45, sheen: PALETTE.plum },
  doug: { bodyRadiusX: 1.6, bodyRadiusY: 1.0, bellyScale: 1, neckHeight: 0.6, headRadius: 0.58, tailLift: 0.75, tailLength: 1.3, sheen: PALETTE.teal },
  brenda: { bodyRadiusX: 1.15, bodyRadiusY: 0.9, bellyScale: 0.9, neckHeight: 0.85, headRadius: 0.5, tailLift: -0.1, tailLength: 2.1, sheen: PALETTE.plum },
  keith: { bodyRadiusX: 1.35, bodyRadiusY: 1.0, bellyScale: 1, neckHeight: 0.72, headRadius: 0.56, tailLift: 0.2, tailLength: 1.4, sheen: PALETTE.teal },
  sheila: { bodyRadiusX: 1.4, bodyRadiusY: 1.12, bellyScale: 1.35, neckHeight: 0.66, headRadius: 0.55, tailLift: 0.1, tailLength: 1.35, sheen: PALETTE.plum },
};

export interface PigeonAnchors {
  bodyY: number;
  neckX: number;
  neckY: number;
  headX: number;
  headY: number;
  eyeX: number;
  eyeY: number;
}

function pigeonAnchors(shape: StandingShape): PigeonAnchors {
  const bodyY = 1.0 + shape.bodyRadiusY * 0.82;
  const neckX = 0.85;
  const neckY = bodyY + shape.bodyRadiusY * 0.7;
  const headX = neckX + 0.22;
  const headY = neckY + shape.neckHeight * 0.75 + shape.headRadius * 0.55;
  return { bodyY, neckX, neckY, headX, headY, eyeX: headX + shape.headRadius * 0.28, eyeY: headY + shape.headRadius * 0.2 };
}

export const LEG_TOP_UNITS = 1.15;

function drawLeg(context: CanvasRenderingContext2D, ink: Ink): void {
  context.fillStyle = ink(PALETTE.plum);
  P2.draw2.rect(context, -0.11, 0.1, 0.22, LEG_TOP_UNITS - 0.1, 0.08);
  fillPolygon(context, [
    [-0.42, 0],
    [0.5, 0],
    [0.34, 0.18],
    [-0.3, 0.18],
  ]);
}

function drawTail(context: CanvasRenderingContext2D, ink: Ink, shape: StandingShape, bodyY: number): void {
  const tipX = -0.8 - shape.tailLength;
  const lift = shape.tailLift;
  context.fillStyle = ink(PIGEON_TAIL);
  fillPolygon(context, [
    [-0.55, bodyY + 0.15],
    [tipX + 0.05, bodyY - 0.35 + lift],
    [tipX - 0.02, bodyY - 0.7 + lift],
    [tipX + 0.2, bodyY - 0.95 + lift],
    [-0.55, bodyY - 0.45],
  ]);
  context.fillStyle = ink(P2.mix(PIGEON_TAIL, PALETTE.creamCore, 0.4));
  fillPolygon(context, [
    [tipX + 0.38, bodyY - 0.42 + lift * 0.8],
    [tipX + 0.05, bodyY - 0.35 + lift],
    [tipX - 0.02, bodyY - 0.7 + lift],
    [tipX + 0.2, bodyY - 0.95 + lift],
    [tipX + 0.5, bodyY - 0.86 + lift * 0.8],
  ]);
}

function drawBody(variant: PigeonVariant, context: CanvasRenderingContext2D, ink: Ink, shape: StandingShape, anchors: PigeonAnchors): void {
  const { bodyY, neckX, neckY } = anchors;
  if (variant === "linda") {
    context.fillStyle = ink(PALETTE.teal);
    P2.draw2.rect(context, -1.55, bodyY + 0.15, 1.15, 1.05, 0.22);
    context.fillStyle = ink(P2.shade(PALETTE.teal, -0.2));
    P2.draw2.rect(context, -1.5, bodyY + 0.2, 1.05, 0.3, 0.12);
  }
  context.fillStyle = ink(PALETTE.pigeonGrey);
  fillPolygon(context, eggOutline(0.05, bodyY, shape.bodyRadiusX, shape.bodyRadiusY, 0.3).map(([pointX, pointY]): Point => [pointX, Math.max(0.6, pointY)]));
  context.fillStyle = ink(PIGEON_BELLY);
  fillPolygon(
    context,
    eggOutline(0.5, bodyY - 0.15, shape.bodyRadiusX * 0.55 * shape.bellyScale, shape.bodyRadiusY * 0.62 * shape.bellyScale, 0.1).map(([pointX, pointY]): Point => [pointX, Math.max(0.6, pointY)]),
  );
  context.fillStyle = ink(PALETTE.pigeonGrey);
  P2.draw2.ell(context, neckX, neckY + shape.neckHeight * 0.35, 0.5, 0.45 + shape.neckHeight * 0.5, -0.3);
  context.fillStyle = ink(shape.sheen);
  P2.draw2.ell(context, neckX + 0.04, neckY + shape.neckHeight * 0.3, 0.48, 0.32 + shape.neckHeight * 0.32, -0.3);
  if (variant === "brenda") {
    context.fillStyle = ink(PALETTE.creamCore);
    for (let pearl = 0; pearl < 5; pearl++) {
      const angle = -0.9 + pearl * 0.42;
      P2.draw2.ell(context, neckX + Math.cos(angle) * 0.42, neckY + 0.1 + Math.sin(angle) * 0.2, 0.1, 0.1);
    }
  }
}

function drawWing(variant: PigeonVariant, context: CanvasRenderingContext2D, ink: Ink, bodyY: number): void {
  context.fillStyle = ink(PIGEON_WING);
  fillPolygon(context, [
    [0.65, bodyY + 0.65],
    [0.1, bodyY + 0.9],
    [-0.8, bodyY + 0.72],
    [-1.5, bodyY + 0.15],
    [-1.7, bodyY - 0.2],
    [-0.55, bodyY - 0.32],
    [0.45, bodyY - 0.02],
  ]);
  for (let feather = 0; feather < FEATHER_COUNT; feather++) {
    context.fillStyle = ink(P2.shade(PIGEON_WING, -0.1 - 0.07 * feather));
    P2.draw2.ell(context, -1.45 + feather * 0.42, bodyY - 0.12 + feather * 0.06, 0.4, 0.22, 0.3);
  }
  context.fillStyle = ink(PIGEON_BAR);
  fillPolygon(context, [
    [-0.05, bodyY + 0.62],
    [0.27, bodyY + 0.47],
    [-0.62, bodyY - 0.02],
    [-0.94, bodyY + 0.13],
  ]);
  fillPolygon(context, [
    [0.4, bodyY + 0.33],
    [0.7, bodyY + 0.16],
    [-0.12, bodyY - 0.24],
    [-0.43, bodyY - 0.09],
  ]);
  if (variant === "linda") {
    context.fillStyle = ink(P2.shade(PALETTE.teal, -0.3), "print");
    fillPolygon(context, [
      [0.2, bodyY + 0.95],
      [0.42, bodyY + 0.9],
      [0.1, bodyY - 0.25],
      [-0.12, bodyY - 0.2],
    ]);
  }
  if (variant === "keith") {
    context.fillStyle = ink(PIGEON_WING);
    P2.draw2.ell(context, -0.9, bodyY + 0.74, 0.42, 0.14, 0.9);
    P2.draw2.ell(context, -0.4, bodyY + 0.86, 0.36, 0.12, -0.7);
    context.fillStyle = ink(PALETTE.creamCore);
    P2.draw2.rect(context, 0.2, bodyY - 0.5, 0.5, 0.18, 0.05);
    P2.draw2.rect(context, 0.36, bodyY - 0.66, 0.18, 0.5, 0.05);
  }
}

function drawHead(variant: PigeonVariant, context: CanvasRenderingContext2D, ink: Ink, shape: StandingShape, anchors: PigeonAnchors): void {
  const { headX, headY, eyeX, eyeY } = anchors;
  context.fillStyle = ink(PIGEON_HEAD);
  P2.draw2.ell(context, headX, headY, shape.headRadius + 0.04, shape.headRadius);
  context.fillStyle = ink(PALETTE.pigeonGrey);
  P2.draw2.ell(context, headX - 0.12, headY - shape.headRadius * 0.7, shape.headRadius * 0.62, shape.headRadius * 0.5, -0.3);
  context.fillStyle = ink(PALETTE.mustard, "print");
  P2.draw2.ell(context, eyeX, eyeY, 0.21, 0.21);
  context.fillStyle = ink(PALETTE.ink, "print");
  P2.draw2.ell(context, eyeX + 0.03, eyeY, 0.13, 0.13);
  context.fillStyle = ink(PALETTE.creamCore, "print");
  P2.draw2.ell(context, eyeX - 0.02, eyeY + 0.06, 0.05, 0.05);
  if (variant === "gary") {
    context.fillStyle = ink(PALETTE.mustard);
    context.beginPath();
    context.arc(eyeX, eyeY, 0.36, 0, Math.PI * 2);
    context.arc(eyeX, eyeY, 0.25, 0, Math.PI * 2, true);
    context.fill();
  }
  if (variant === "doug") {
    context.fillStyle = ink(KRAFT_CAP);
    fillPolygon(context, [
      [headX - shape.headRadius - 0.05, headY + shape.headRadius * 0.45],
      [headX + shape.headRadius + 0.45, headY + shape.headRadius * 0.45],
      [headX + shape.headRadius * 0.6, headY + shape.headRadius + 0.22],
      [headX - shape.headRadius * 0.7, headY + shape.headRadius + 0.18],
    ]);
  }
  if (variant === "keith") {
    context.fillStyle = ink(PIGEON_HEAD);
    P2.draw2.ell(context, headX - 0.2, headY + shape.headRadius + 0.1, 0.12, 0.3, -0.4);
    P2.draw2.ell(context, headX + 0.08, headY + shape.headRadius + 0.14, 0.1, 0.26, 0.3);
  }
  if (variant === "sheila") {
    context.fillStyle = ink(PALETTE.tomato);
    fillPolygon(context, [
      [headX - 0.1, headY + shape.headRadius + 0.05],
      [headX - 0.62, headY + shape.headRadius + 0.32],
      [headX - 0.58, headY + shape.headRadius - 0.18],
    ]);
    fillPolygon(context, [
      [headX - 0.1, headY + shape.headRadius + 0.05],
      [headX + 0.42, headY + shape.headRadius + 0.36],
      [headX + 0.46, headY + shape.headRadius - 0.12],
    ]);
    context.fillStyle = ink(P2.shade(PALETTE.tomato, -0.25));
    P2.draw2.ell(context, headX - 0.08, headY + shape.headRadius + 0.08, 0.13, 0.13);
  }
}

function drawBeak(context: CanvasRenderingContext2D, ink: Ink, shape: StandingShape, anchors: PigeonAnchors): void {
  const beakBaseX = anchors.headX + shape.headRadius * 0.82;
  const { headY } = anchors;
  context.fillStyle = ink(PALETTE.mustard);
  fillPolygon(context, [
    [beakBaseX - 0.08, headY + 0.15],
    [beakBaseX + 0.62, headY - 0.04],
    [beakBaseX - 0.08, headY - 0.24],
  ]);
  context.fillStyle = ink(PALETTE.creamCore);
  P2.draw2.ell(context, beakBaseX + 0.06, headY + 0.08, 0.13, 0.08, -0.2);
  context.fillStyle = ink(PALETTE.ink, "print");
  P2.draw2.ell(context, beakBaseX + 0.52, headY - 0.04, 0.09, 0.08);
}

export type PigeonPartName = "leg" | "tail" | "body" | "wing" | "head" | "beak";

export interface PigeonPartPrint {
  outline: Point[];
  materials: THREE.Material | THREE.Material[];
}

export interface PigeonKit {
  parts: Record<PigeonPartName, PigeonPartPrint>;
  shape: StandingShape;
  anchors: PigeonAnchors;
}

type PartDrawing = (context: CanvasRenderingContext2D, ink: Ink) => void;

const PART_CANVAS = { w: 6.4, h: 4.9 };
const CUT_INK: Ink = (_color, how) => (how === "print" ? "rgba(0,0,0,0)" : "#000");

function finishPart(print: Print): void {
  print.marks("dot", { color: "#2a1608", alpha: 0.12, size: 0.025, density: 0.4 });
  print.innerShade("#3a2010", { alpha: 0.3, blurPx: 8 });
  print.felt(0.7);
}

function printPart(options: CardOptions, draw: PartDrawing, name: string): PigeonPartPrint {
  const outline = P2.fromDrawing((context) => draw(context, CUT_INK), { ...PART_CANVAS, name });
  const paint: PaintFn = (print) => {
    print.parts((context, ink) => draw(context, ink));
    finishPart(print);
  };
  const card = makeCard(outline, { ...options, paint, back: "kraft" });
  return { outline, materials: card.material };
}

export function printPigeonKit(options: CardOptions, variant: PigeonVariant): PigeonKit {
  const shape = STANDING_SHAPES[variant];
  const anchors = pigeonAnchors(shape);
  return {
    shape,
    anchors,
    parts: {
      leg: printPart(options, drawLeg, `pigeon ${variant} leg`),
      tail: printPart(options, (context, ink) => drawTail(context, ink, shape, anchors.bodyY), `pigeon ${variant} tail`),
      body: printPart(options, (context, ink) => drawBody(variant, context, ink, shape, anchors), `pigeon ${variant} body`),
      wing: printPart(options, (context, ink) => drawWing(variant, context, ink, anchors.bodyY), `pigeon ${variant} wing`),
      head: printPart(options, (context, ink) => drawHead(variant, context, ink, shape, anchors), `pigeon ${variant} head`),
      beak: printPart(options, (context, ink) => drawBeak(context, ink, shape, anchors), `pigeon ${variant} beak`),
    },
  };
}

export const CROP_BAG_STAGES = ["empty", "few", "half", "full", "bursting"] as const;
export type CropBagStage = (typeof CROP_BAG_STAGES)[number];
const CROP_BAG_FILL: Record<CropBagStage, number> = { empty: 0, few: 0.3, half: 0.55, full: 0.85, bursting: 1 };

export function cropBagStageFor(beakCrumbs: number): CropBagStage {
  if (beakCrumbs >= 50) return "bursting";
  if (beakCrumbs >= 25) return "full";
  if (beakCrumbs >= 10) return "half";
  if (beakCrumbs >= 1) return "few";
  return "empty";
}

const CROP_BAG_WIDTH_UNITS = 0.7;
const CROP_BAG_HEIGHT_UNITS = 0.8;

function cropBagOutline(): Point[] {
  const halfWidth = CROP_BAG_WIDTH_UNITS / 2;
  return [
    [-halfWidth, 0],
    [halfWidth, 0],
    [halfWidth + 0.05, CROP_BAG_HEIGHT_UNITS],
    [halfWidth * 0.5, CROP_BAG_HEIGHT_UNITS - 0.08],
    [0, CROP_BAG_HEIGHT_UNITS + 0.02],
    [-halfWidth * 0.5, CROP_BAG_HEIGHT_UNITS - 0.08],
    [-halfWidth - 0.05, CROP_BAG_HEIGHT_UNITS],
  ];
}

function paintCropBag(stage: CropBagStage): PaintFn {
  return (print) => {
    print.gradient(KRAFT_INKS.wood, KRAFT_INKS.woodDark, 0.5);
    const fill = CROP_BAG_FILL[stage];
    if (fill > 0) {
      print.layer((context) => {
        context.fillRect(-CROP_BAG_WIDTH_UNITS, 0.08, CROP_BAG_WIDTH_UNITS * 2, (CROP_BAG_HEIGHT_UNITS - 0.16) * fill);
      }, PALETTE.mustard, { depth: 0.5 });
    }
    if (stage === "bursting") {
      print.layer((context) => {
        P2.draw2.ell(context, -0.12, CROP_BAG_HEIGHT_UNITS - 0.05, 0.14, 0.1);
        P2.draw2.ell(context, 0.14, CROP_BAG_HEIGHT_UNITS - 0.02, 0.12, 0.09);
      }, P2.shade(PALETTE.mustard, 0.1), { depth: 0.6 });
    }
    print.draw((context) => {
      context.strokeStyle = P2.rgba(PALETTE.ink, 0.55);
      context.lineWidth = 0.05;
      context.beginPath();
      context.moveTo(-CROP_BAG_WIDTH_UNITS / 2 + 0.08, CROP_BAG_HEIGHT_UNITS - 0.2);
      context.lineTo(CROP_BAG_WIDTH_UNITS / 2 - 0.08, CROP_BAG_HEIGHT_UNITS - 0.2);
      context.stroke();
    });
    print.felt(0.6);
  };
}

export interface CropBagPrints {
  outline: Point[];
  materials: Record<CropBagStage, THREE.Material | THREE.Material[]>;
}

export function printCropBags(options: CardOptions): CropBagPrints {
  const outline = cropBagOutline();
  const printStage = (stage: CropBagStage) => makeCard(outline, { ...options, paint: paintCropBag(stage), back: "kraft" }).material;
  return {
    outline,
    materials: { empty: printStage("empty"), few: printStage("few"), half: printStage("half"), full: printStage("full"), bursting: printStage("bursting") },
  };
}
