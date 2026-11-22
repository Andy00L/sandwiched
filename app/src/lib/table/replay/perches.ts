import { LUNCHBOX_WIDTH_UNITS } from "../pieces/lunchbox";
import { TABLE_DEPTH_UNITS, TABLE_LENGTH_UNITS } from "../layout";

export const BOX_SPACING_UNITS = LUNCHBOX_WIDTH_UNITS + 4.4;
export const BOX_ROW_DECK_Z = -TABLE_DEPTH_UNITS * 0.36;

export type Facing = "left" | "right";

export interface PerchSpot {
  along: number;
  deckZ: number;
  facing: Facing;
}

export function boxAlong(boxIndex: number, boxCount: number): number {
  return (boxIndex - (boxCount - 1) / 2) * BOX_SPACING_UNITS;
}

const PERCH_OFFSETS: ReadonlyArray<readonly [number, number, Facing]> = [
  [-(LUNCHBOX_WIDTH_UNITS / 2 + 1.3), -0.7, "right"],
  [LUNCHBOX_WIDTH_UNITS / 2 + 1.3, -0.7, "left"],
  [-1.9, 1.2, "right"],
  [1.9, 1.2, "left"],
  [-(LUNCHBOX_WIDTH_UNITS / 2 + 1.1), -2.7, "right"],
  [LUNCHBOX_WIDTH_UNITS / 2 + 1.1, -2.7, "left"],
  [-0.6, 2.3, "right"],
  [0.6, 2.3, "left"],
];

export function perchSpot(boxIndex: number, boxCount: number, slot: number): PerchSpot {
  const [alongOffset, zOffset, facing] = PERCH_OFFSETS[slot % PERCH_OFFSETS.length] ?? [0, 1.2, "right"];
  return { along: boxAlong(boxIndex, boxCount) + alongOffset, deckZ: BOX_ROW_DECK_Z + zOffset, facing };
}

const HOVER_GAP_CENTRES = [-1.5, -0.5, 0.5, 1.5].map((gap) => gap * BOX_SPACING_UNITS);
const HOVER_ROWS = 2;
const HOVER_SPREAD_UNITS = 0.9;

export function hoverSpot(seat: number): PerchSpot {
  const gap = HOVER_GAP_CENTRES[seat % HOVER_GAP_CENTRES.length] ?? 0;
  const row = Math.floor(seat / HOVER_GAP_CENTRES.length) % HOVER_ROWS;
  const layer = Math.floor(seat / (HOVER_GAP_CENTRES.length * HOVER_ROWS));
  const spread = layer === 0 ? 0 : (layer % 2 === 1 ? 1 : -1) * Math.ceil(layer / 2) * HOVER_SPREAD_UNITS;
  const along = Math.max(-TABLE_LENGTH_UNITS / 2 + 2, Math.min(TABLE_LENGTH_UNITS / 2 - 2, gap + spread));
  return { along, deckZ: BOX_ROW_DECK_Z + 0.6 - row * 2.2, facing: along < 0 ? "right" : "left" };
}
