import type { Point } from "papercraft/lib/paperkit-2d.js";
import { PIGEON_HEIGHT_UNITS, TABLE_YAW_RAD } from "./stage/look";

export const TABLE_LENGTH_UNITS = 9.2 * PIGEON_HEIGHT_UNITS;
export const TABLE_DEPTH_UNITS = 4.2 * PIGEON_HEIGHT_UNITS;
export const TABLE_HEIGHT_UNITS = 1.1 * PIGEON_HEIGHT_UNITS;

export const PICNIC_PAD_LENGTH_UNITS = TABLE_LENGTH_UNITS + 8;
export const PICNIC_PAD_DEPTH_UNITS = TABLE_DEPTH_UNITS + 12;

export const PATH_CONTROL_POINTS: Point[] = [
  [-62, 34],
  [-40, 22],
  [-30, 4],
  [-14, -16],
  [8, -21],
  [24, -30],
  [34, -48],
  [56, -66],
];
export const PATH_HALF_WIDTH_UNITS = 2.6;

export function placeOnTable([alongTable, acrossTable]: Point): Point {
  const cosine = Math.cos(TABLE_YAW_RAD);
  const sine = Math.sin(TABLE_YAW_RAD);
  return [alongTable * cosine + acrossTable * sine, -alongTable * sine + acrossTable * cosine];
}
