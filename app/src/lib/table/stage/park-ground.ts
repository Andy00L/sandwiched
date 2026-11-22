import type { GroundTools } from "papercraft/harness.js";
import * as P2 from "papercraft/lib/paperkit-2d.js";
import type { Point } from "papercraft/lib/paperkit-2d.js";
import {
  PATH_CONTROL_POINTS,
  PATH_HALF_WIDTH_UNITS,
  PICNIC_PAD_DEPTH_UNITS,
  PICNIC_PAD_LENGTH_UNITS,
  placeOnTable,
} from "../layout";
import { GROUND_INKS, PALETTE } from "../palette";

const MOW_STRIPE_WIDTH_UNITS = 7;
const FLAGSTONE_SIZE_UNITS = 3.2;
const FLAGSTONE_GAP_UNITS = 0.34;
const PAD_GRAVEL = GROUND_INKS.padGravel;
const PAD_STONE = GROUND_INKS.padStone;
const LEAF_LITTER_CENTRES: Point[] = [
  [-34, -26],
  [30, 8],
  [-42, 14],
  [40, -44],
];

const PATH_LINE = P2.pathLine(PATH_CONTROL_POINTS);

export function distanceFromPath(worldX: number, worldZ: number): number {
  return PATH_LINE.dist(worldX, worldZ);
}

function printMowStripes({ torn, bounds, rnd }: GroundTools & { bounds: { x0: number; x1: number; z0: number; z1: number } }): void {
  for (let stripeX = bounds.x0; stripeX < bounds.x1; stripeX += MOW_STRIPE_WIDTH_UNITS * 2) {
    const lean = (rnd() - 0.5) * 3;
    torn(
      [
        [stripeX, bounds.z1],
        [stripeX + MOW_STRIPE_WIDTH_UNITS, bounds.z1],
        [stripeX + MOW_STRIPE_WIDTH_UNITS + lean + 9, bounds.z0],
        [stripeX + lean + 9, bounds.z0],
      ],
      P2.rgba(GROUND_INKS.lawnShade, 0.16),
      "rgba(0,0,0,0)",
    );
  }
}

function irregularStone(centreX: number, centreZ: number, radius: number, rnd: () => number): Point[] {
  const corners = 7 + Math.floor(rnd() * 4);
  const phase = rnd() * Math.PI * 2;
  return [...Array(corners).keys()].map((corner) => {
    const angle = phase + (corner / corners) * Math.PI * 2;
    const reach = radius * (0.7 + rnd() * 0.42);
    return placeOnTable([centreX + Math.cos(angle) * reach, centreZ + Math.sin(angle) * reach * 0.86]);
  });
}

function printPicnicPad({ g: context, ppu, X: sheetX, Z: sheetZ, rnd }: GroundTools): void {
  const halfLength = PICNIC_PAD_LENGTH_UNITS / 2;
  const halfDepth = PICNIC_PAD_DEPTH_UNITS / 2;
  const stoneTones = [PAD_STONE, P2.shade(PAD_STONE, -0.06), P2.mix(PAD_STONE, "#c4bfae", 0.5)];
  const traceStone = (stone: Point[]) => {
    context.beginPath();
    stone.forEach(([stoneX, stoneZ], index) => (index ? context.lineTo(sheetX(stoneX), sheetZ(stoneZ)) : context.moveTo(sheetX(stoneX), sheetZ(stoneZ))));
    context.closePath();
  };
  for (let along = -halfLength + 1.6; along < halfLength - 1.2; along += FLAGSTONE_SIZE_UNITS) {
    for (let across = -halfDepth + 1.6; across < halfDepth - 1.2; across += FLAGSTONE_SIZE_UNITS) {
      const edgeness = Math.max(Math.abs(along) / halfLength, Math.abs(across) / halfDepth);
      if (edgeness > 0.8 && rnd() < 0.5) continue;
      const stone = irregularStone(along + (rnd() - 0.5) * 0.7, across + (rnd() - 0.5) * 0.7, FLAGSTONE_SIZE_UNITS * 0.5 - FLAGSTONE_GAP_UNITS, rnd);
      const shadowOffset = 0.12 * ppu;
      context.save();
      context.translate(shadowOffset, shadowOffset * 0.6);
      traceStone(stone);
      context.fillStyle = P2.rgba(PAD_GRAVEL, 0.9);
      context.fill();
      context.restore();
      traceStone(stone);
      context.fillStyle = stoneTones[Math.floor(rnd() * stoneTones.length)] ?? PAD_STONE;
      context.fill();
      context.strokeStyle = P2.rgba("#fff6e2", 0.55);
      context.lineWidth = 0.06 * ppu;
      context.stroke();
    }
  }
}

function printPath({ g: context, ppu, X: sheetX, Z: sheetZ, torn, bandOf, rnd }: GroundTools): void {
  torn(bandOf(PATH_LINE.pts, PATH_HALF_WIDTH_UNITS + 0.5), P2.rgba(P2.shade(GROUND_INKS.lawnShade, -0.12), 0.32), "rgba(0,0,0,0)");
  torn(bandOf(PATH_LINE.pts, PATH_HALF_WIDTH_UNITS), GROUND_INKS.path);
  for (const [pathX, pathZ] of PATH_LINE.pts) {
    for (let grit = 0; grit < 9; grit++) {
      const gritX = pathX + (rnd() - 0.5) * PATH_HALF_WIDTH_UNITS * 1.7;
      const gritZ = pathZ + (rnd() - 0.5) * 1.2;
      const radius = (0.05 + rnd() * 0.07) * ppu;
      context.fillStyle = rnd() < 0.6 ? P2.rgba(P2.shade(GROUND_INKS.path, -0.32), 0.5) : P2.rgba("#fff6e2", 0.65);
      context.beginPath();
      context.ellipse(sheetX(gritX), sheetZ(gritZ), radius * 1.3, radius, rnd() * 3, 0, Math.PI * 2);
      context.fill();
    }
  }
}

function printLeafLitter({ g: context, ppu, X: sheetX, Z: sheetZ, rnd }: GroundTools): void {
  const leafTones = [PALETTE.mustard, PALETTE.tomato, P2.shade(PALETTE.mustard, -0.2), PALETTE.kraftWood];
  for (const [centreX, centreZ] of LEAF_LITTER_CENTRES) {
    for (let leaf = 0; leaf < 70; leaf++) {
      const radius = Math.sqrt(rnd()) * 9;
      const angle = rnd() * Math.PI * 2;
      const leafX = centreX + Math.cos(angle) * radius;
      const leafZ = centreZ + Math.sin(angle) * radius * 0.7;
      context.fillStyle = P2.rgba(leafTones[Math.floor(rnd() * leafTones.length)] ?? PALETTE.mustard, 0.75);
      P2.fillLeaf(context, sheetX(leafX), sheetZ(leafZ), (0.35 + rnd() * 0.3) * ppu, rnd() * Math.PI * 2, 0.42);
    }
  }
}

function printDaisies({ g: context, drifts, rnd }: GroundTools): void {
  drifts(
    (px, py) => {
      const isClover = rnd() < 0.55;
      context.fillStyle = isClover ? P2.rgba(P2.shade(GROUND_INKS.lawnShade, -0.25), 0.55) : P2.rgba(PALETTE.creamCore, 0.85);
      for (let petal = 0; petal < (isClover ? 3 : 5); petal++) {
        const angle = (petal / (isClover ? 3 : 5)) * Math.PI * 2 + rnd();
        context.beginPath();
        context.arc(px + Math.cos(angle) * 2.4, py + Math.sin(angle) * 2.4, isClover ? 2.2 : 1.7, 0, Math.PI * 2);
        context.fill();
      }
      if (!isClover) {
        context.fillStyle = P2.rgba(PALETTE.mustard, 0.9);
        context.beginPath();
        context.arc(px, py, 1.2, 0, Math.PI * 2);
        context.fill();
      }
    },
    { n: 5000, inside: 0.35, threshold: 0.7 },
  );
}

function printGrassTicks({ g: context, drifts, rnd }: GroundTools): void {
  drifts((px, py) => {
    context.strokeStyle = P2.rgba(rnd() < 0.5 ? P2.shade(GROUND_INKS.lawnShade, -0.18) : GROUND_INKS.lawnShade, 0.7);
    context.lineWidth = 1.6;
    context.beginPath();
    context.moveTo(px, py);
    context.lineTo(px + (rnd() - 0.5) * 3, py - 4 - rnd() * 4);
    context.stroke();
  });
}

export function printParkGround(tools: GroundTools, bounds: { x0: number; x1: number; z0: number; z1: number }): void {
  tools.washes([GROUND_INKS.lawn, GROUND_INKS.lawn, P2.mix(GROUND_INKS.lawn, GROUND_INKS.lawnShade, 0.5), P2.mix(GROUND_INKS.lawn, "#b9bfa6", 0.5)]);
  printMowStripes({ ...tools, bounds });
  printGrassTicks(tools);
  printDaisies(tools);
  printLeafLitter(tools);
  printPath(tools);
  printPicnicPad(tools);
}
