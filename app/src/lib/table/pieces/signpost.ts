import type { Harness, PlacedPiece } from "papercraft/harness.js";
import * as P2 from "papercraft/lib/paperkit-2d.js";
import type { Point, Print } from "papercraft/lib/paperkit-2d.js";
import { KRAFT_INKS, PALETTE } from "../palette";

export type SignpostLook = {
  title: string;
  caption: string;
  board: string;
  ink: string;
  pointsLeft: boolean;
  scale: number;
  name: string;
};

const POST_HALF_WIDTH = 0.26;
const BOARD_BOTTOM = 2.7;
const BOARD_TOP = 4.5;
const BOARD_HALF_WIDTH = 2.6;
const ARROW_REACH = 0.8;

function boardOutline(pointsLeft: boolean): Point[] {
  const tip = pointsLeft ? -BOARD_HALF_WIDTH - ARROW_REACH : BOARD_HALF_WIDTH + ARROW_REACH;
  const tipSide = pointsLeft ? -BOARD_HALF_WIDTH : BOARD_HALF_WIDTH;
  const tailSide = -tipSide;
  const middle = (BOARD_BOTTOM + BOARD_TOP) / 2;
  return [
    [tailSide, BOARD_BOTTOM],
    [tipSide, BOARD_BOTTOM],
    [tip, middle],
    [tipSide, BOARD_TOP],
    [tailSide, BOARD_TOP],
  ];
}

function signpostOutline(look: SignpostLook): Point[] {
  const board = boardOutline(look.pointsLeft);
  return P2.fromDrawing(
    (context) => {
      P2.draw2.rect(context, -POST_HALF_WIDTH, 0, POST_HALF_WIDTH * 2, BOARD_TOP + 0.5, 0.08);
      P2.draw2.poly(context, board);
    },
    { w: (BOARD_HALF_WIDTH + ARROW_REACH) * 2 + 0.4, h: BOARD_TOP + 0.8, name: look.name },
  );
}

function paintSignpost(look: SignpostLook) {
  return (print: Print): void => {
    print.gradient(P2.shade(KRAFT_INKS.woodDark, 0.1), P2.shade(KRAFT_INKS.woodDark, -0.2), 0.5);
    const inset = 0.14;
    const board = boardOutline(look.pointsLeft).map(([pointX, pointY]): Point => [
      pointX * (1 - inset / BOARD_HALF_WIDTH),
      pointY < (BOARD_BOTTOM + BOARD_TOP) / 2 ? pointY + inset : pointY > (BOARD_BOTTOM + BOARD_TOP) / 2 ? pointY - inset : pointY,
    ]);
    print.layer(board, look.board, { depth: 1, rim: 0.5 });
    const textCentre = look.pointsLeft ? -ARROW_REACH / 2 : ARROW_REACH / 2;
    print.draw((context) => {
      context.save();
      context.scale(1, -1);
      context.fillStyle = look.ink;
      context.textAlign = "center";
      context.textBaseline = "middle";
      context.font = "700 0.62px Georgia, 'Times New Roman', serif";
      context.fillText(look.title, textCentre, -(BOARD_TOP - 0.62));
      context.font = "italic 400 0.4px Georgia, 'Times New Roman', serif";
      context.globalAlpha = 0.86;
      context.fillText(look.caption, textCentre, -(BOARD_BOTTOM + 0.5));
      context.restore();
    });
    print.marks("rivet", { color: PALETTE.ink, alpha: 0.7, size: 0.07, units: true, region: { ...print.box, x0: -0.1, x1: 0.1, y0: BOARD_TOP - 0.35, y1: BOARD_TOP - 0.25 } });
    print.felt(0.7);
  };
}

export function buildSignpost(harness: Harness, worldX: number, worldZ: number, look: SignpostLook): PlacedPiece {
  return harness.popup(signpostOutline(look), paintSignpost(look), { x: worldX, z: worldZ, scale: look.scale });
}
