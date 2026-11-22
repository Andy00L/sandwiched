import type * as THREE from "three";
import type { Harness } from "papercraft/harness.js";
import * as P2 from "papercraft/lib/paperkit-2d.js";
import type { PaintFn, Point, Print } from "papercraft/lib/paperkit-2d.js";
import { prismFold } from "papercraft/lib/paperkit-3d.js";
import { PIGEON_HEIGHT_UNITS } from "../stage/look";
import { PALETTE } from "../palette";

export const LUNCHBOX_WIDTH_UNITS = 1.6 * PIGEON_HEIGHT_UNITS;
export const LUNCHBOX_DEPTH_UNITS = 1.1 * PIGEON_HEIGHT_UNITS;
export const LUNCHBOX_HEIGHT_UNITS = 0.9 * PIGEON_HEIGHT_UNITS;

export type LunchboxPattern = "stripes" | "dots" | "check";

interface LunchboxLook {
  base: string;
  motif: string;
  pattern: LunchboxPattern;
}

export const LUNCHBOX_LOOKS = [
  { base: PALETTE.tomato, motif: PALETTE.creamCore, pattern: "stripes" },
  { base: PALETTE.mustard, motif: PALETTE.ink, pattern: "dots" },
  { base: PALETTE.teal, motif: PALETTE.creamCore, pattern: "check" },
] as const satisfies readonly LunchboxLook[];

export type LunchboxIndex = 0 | 1 | 2;

function printCorrugation(print: Print, color: string): void {
  const { box } = print;
  print.draw((context) => {
    context.strokeStyle = P2.rgba(P2.shade(color, -0.35), 0.28);
    context.lineWidth = 0.05;
    for (let ribX = box.x0 + 0.12; ribX < box.x1; ribX += 0.24) {
      context.beginPath();
      context.moveTo(ribX, box.y0);
      context.lineTo(ribX, box.y1);
      context.stroke();
    }
  });
}

function printPattern(print: Print, look: LunchboxLook): void {
  const { box } = print;
  if (look.pattern === "stripes") {
    print.layer((context) => {
      for (let stripeX = box.x0 + 0.35; stripeX < box.x1; stripeX += 1.05) {
        context.fillRect(stripeX, box.y0 - 0.1, 0.42, box.h + 0.2);
      }
    }, look.motif, { depth: 0.5, lip: 0.6 });
    return;
  }
  if (look.pattern === "dots") {
    print.layer((context) => {
      let row = 0;
      for (let dotY = box.y0 + 0.45; dotY < box.y1 - 0.2; dotY += 0.8) {
        const offset = row % 2 ? 0.45 : 0;
        for (let dotX = box.x0 + 0.4 + offset; dotX < box.x1 - 0.2; dotX += 0.9) {
          context.beginPath();
          context.arc(dotX, dotY, 0.17, 0, Math.PI * 2);
          context.fill();
        }
        row += 1;
      }
    }, look.motif, { depth: 0.4, lip: 0.3 });
    return;
  }
  print.draw((context) => {
    context.fillStyle = P2.rgba(look.motif, 0.42);
    for (let checkX = box.x0; checkX < box.x1; checkX += 1.1) context.fillRect(checkX, box.y0, 0.55, box.h);
    for (let checkY = box.y0; checkY < box.y1; checkY += 1.1) context.fillRect(box.x0, checkY, box.w, 0.55);
  });
}

function printLabel(print: Print): void {
  const { box } = print;
  const labelWidth = box.w * 0.46;
  const labelHeight = box.h * 0.26;
  const left = (box.x0 + box.x1) / 2 - labelWidth / 2;
  const bottom = box.y0 + box.h * 0.36;
  print.layer((context) => {
    context.beginPath();
    context.roundRect(left, bottom, labelWidth, labelHeight, 0.18);
    context.fill();
  }, PALETTE.creamCore, { depth: 0.8, rim: 0.4 });
  print.draw((context) => {
    context.strokeStyle = P2.rgba(PALETTE.ink, 0.7);
    context.lineWidth = 0.07;
    context.beginPath();
    context.roundRect(left + 0.14, bottom + 0.14, labelWidth - 0.28, labelHeight - 0.28, 0.1);
    context.stroke();
    context.lineWidth = 0.06;
    context.beginPath();
    context.moveTo(left + 0.4, bottom + labelHeight * 0.42);
    context.lineTo(left + labelWidth - 0.4, bottom + labelHeight * 0.42);
    context.stroke();
  });
}

function printLatch(print: Print): void {
  const { box } = print;
  const centreX = (box.x0 + box.x1) / 2;
  print.layer(
    [
      [centreX - 0.45, box.y1 - 0.9],
      [centreX + 0.45, box.y1 - 0.9],
      [centreX + 0.45, box.y1 + 0.1],
      [centreX - 0.45, box.y1 + 0.1],
    ],
    P2.shade(PALETTE.ink, 0.25),
    { depth: 0.9 },
  );
  print.draw((context) => {
    context.fillStyle = P2.rgba(PALETTE.creamCore, 0.8);
    context.beginPath();
    context.arc(centreX, box.y1 - 0.55, 0.12, 0, Math.PI * 2);
    context.fill();
  });
}

function paintWall(look: LunchboxLook, isFront: boolean): PaintFn {
  return (print) => {
    print.gradient(P2.shade(look.base, 0.08), P2.shade(look.base, -0.12), 0.5);
    printCorrugation(print, look.base);
    printPattern(print, look);
    if (isFront) {
      printLabel(print);
      printLatch(print);
    }
    print.felt(0.7);
    print.innerShade(P2.shade(look.base, -0.6), { alpha: 0.3, blurPx: 10 });
  };
}

function paintLid(look: LunchboxLook): PaintFn {
  return (print) => {
    print.gradient(P2.shade(look.base, 0.16), P2.shade(look.base, -0.04), 0.4);
    printPattern(print, look);
    print.felt(0.7);
    print.innerShade(P2.shade(look.base, -0.55), { alpha: 0.35, blurPx: 8 });
  };
}

function handleOutline(): Point[] {
  return P2.fromDrawing(
    (context) => {
      context.lineWidth = 0.32;
      context.strokeStyle = "#000";
      context.beginPath();
      context.moveTo(-0.9, 0);
      context.bezierCurveTo(-0.9, 1.15, 0.9, 1.15, 0.9, 0);
      context.stroke();
      P2.draw2.rect(context, -1.1, 0, 0.45, 0.22, 0.05);
      P2.draw2.rect(context, 0.65, 0, 0.45, 0.22, 0.05);
    },
    { w: 2.4, h: 1.1, name: "lunchbox handle" },
  );
}

function paintHandle(print: Print): void {
  print.gradient(P2.shade(PALETTE.creamCore, 0.04), P2.shade(PALETTE.creamCore, -0.14), 0.3);
  print.felt(0.6);
}

export function buildLunchbox(harness: Harness, lookIndex: LunchboxIndex, deck: THREE.Object3D, along: number, acrossDeck: number, order: number): THREE.Group {
  const look: LunchboxLook = LUNCHBOX_LOOKS[lookIndex];
  const halfWidth = LUNCHBOX_WIDTH_UNITS / 2;
  const footprint: Point[] = [
    [-halfWidth, 0],
    [halfWidth, 0],
    [halfWidth, -LUNCHBOX_DEPTH_UNITS],
    [-halfWidth, -LUNCHBOX_DEPTH_UNITS],
  ];
  const options = harness.cardOpts(0, 0, 1, deck);
  const box = prismFold(footprint, {
    h: LUNCHBOX_HEIGHT_UNITS,
    roof: "flat",
    paper: harness.paper,
    seed: 500 + lookIndex * 17,
    paints: { wall: [paintWall(look, true), paintWall(look, false), paintWall(look, false), paintWall(look, false)], roof: paintLid(look) },
    print: { pxPerUnit: options.pxPerUnit, effects: options.effects },
  });
  harness.popup(null, null, { node: box, height: LUNCHBOX_HEIGHT_UNITS, parent: deck, x: along, z: acrossDeck, yaw: 0, order });
  const lidTop = box.userData.top as THREE.Object3D | undefined;
  if (lidTop) harness.popup(handleOutline(), paintHandle, { parent: lidTop, x: 0, z: 0.2, yaw: 0, order: order + 0.6, scale: 1 });
  return box;
}
