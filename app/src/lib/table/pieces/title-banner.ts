import type { Harness, PlacedPiece } from "papercraft/harness.js";
import * as P2 from "papercraft/lib/paperkit-2d.js";
import type { Point, Print } from "papercraft/lib/paperkit-2d.js";
import { KRAFT_INKS, PALETTE } from "../palette";

const POLE_HALF_WIDTH = 0.3;
const POLE_HEIGHT = 15;
const CLOTH_TOP = 14.2;
const CLOTH_BOTTOM = 8.4;
const SCALLOP_COUNT = 9;
const SCALLOP_DEPTH = 0.55;

function clothOutline(halfWidth: number): Point[] {
  const inner = halfWidth - POLE_HALF_WIDTH;
  const scallops = Array.from({ length: SCALLOP_COUNT * 2 + 1 }, (_unused, index): Point => {
    const along = inner - (index / (SCALLOP_COUNT * 2)) * inner * 2;
    return [along, index % 2 === 0 ? CLOTH_BOTTOM : CLOTH_BOTTOM - SCALLOP_DEPTH];
  });
  return [[-inner, CLOTH_TOP], [inner, CLOTH_TOP], ...scallops];
}

function bannerOutline(halfWidth: number): Point[] {
  return P2.fromDrawing(
    (context) => {
      P2.draw2.rect(context, -halfWidth - POLE_HALF_WIDTH, 0, POLE_HALF_WIDTH * 2, POLE_HEIGHT, 0.1);
      P2.draw2.rect(context, halfWidth - POLE_HALF_WIDTH, 0, POLE_HALF_WIDTH * 2, POLE_HEIGHT, 0.1);
      P2.draw2.poly(context, clothOutline(halfWidth));
    },
    { w: halfWidth * 2 + 1.4, h: POLE_HEIGHT + 0.6, name: "title banner" },
  );
}

function paintBanner(halfWidth: number, title: string, subtitle: string) {
  return (print: Print): void => {
    print.gradient(P2.shade(KRAFT_INKS.woodDark, 0.12), P2.shade(KRAFT_INKS.woodDark, -0.18), 0.5);
    print.layer(clothOutline(halfWidth), PALETTE.tomato, { depth: 1, rim: 0.5 });
    print.draw((context) => {
      context.save();
      context.scale(1, -1);
      context.textAlign = "center";
      context.textBaseline = "middle";
      context.fillStyle = PALETTE.creamCore;
      context.font = "700 3.4px Georgia, 'Times New Roman', serif";
      context.fillText(title, 0, -(CLOTH_TOP - 2.3));
      context.font = "italic 400 0.95px Georgia, 'Times New Roman', serif";
      context.fillText(subtitle, 0, -(CLOTH_BOTTOM + 1.15));
      context.restore();
    });
    print.felt(0.75);
  };
}

export function buildTitleBanner(harness: Harness, worldX: number, worldZ: number, halfWidth: number): PlacedPiece {
  return harness.popup(bannerOutline(halfWidth), paintBanner(halfWidth, "SANDWICH", "One whale. Twenty pigeons. One sandwich."), { x: worldX, z: worldZ, sway: 0.15 });
}
