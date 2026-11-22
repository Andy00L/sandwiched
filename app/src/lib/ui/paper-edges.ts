import * as P2 from "papercraft/lib/paperkit-2d.js";
import type { Point } from "papercraft/lib/paperkit-2d.js";

export const SCISSOR_CUT = 0.008;
export const TORN_EDGE = 0.022;

export function buildDeckledClipPath(seed: number, aspect: number, amplitude: number): string {
  const inset = 1.5 * amplitude;
  const outline = P2.roughen(P2.shape.rect(aspect - 2 * inset, 1 - 2 * inset), P2.rng(seed), { amp: amplitude, step: 0.02, tear: amplitude * 0.4, keepBase: false });
  const corners = outline.map(([pointX, pointY]) => `${(50 + (pointX / aspect) * 100).toFixed(2)}% ${(100 - (pointY + inset) * 100).toFixed(2)}%`);
  return `polygon(${corners.join(",")})`;
}

const NEATLINE_POINTS_PER_SIDE = 7;
const TICKS_PER_SIDE = 12;

function jitterSide(random: () => number, from: Point, to: Point, wobble: number): Point[] {
  return Array.from({ length: NEATLINE_POINTS_PER_SIDE + 1 }, (_unused, index) => {
    const share = index / NEATLINE_POINTS_PER_SIDE;
    return [from[0] + (to[0] - from[0]) * share + (random() - 0.5) * wobble, from[1] + (to[1] - from[1]) * share + (random() - 0.5) * wobble];
  });
}

export function buildInkedFramePath(seed: number, inset: number, wobble: number): string {
  const random = P2.rng(seed);
  const low = inset;
  const high = 100 - inset;
  const corners: Point[] = [
    [low, low],
    [high, low],
    [high, high],
    [low, high],
  ];
  const sides = corners.map((corner, index) => jitterSide(random, corner, corners[(index + 1) % corners.length] ?? corner, wobble));
  return sides
    .map((points) => {
      const [first, ...rest] = points;
      if (first === undefined) return "";
      const curves = rest.map(([pointX, pointY], index) => {
        const [previousX, previousY] = points[index] ?? first;
        const bulge = (random() - 0.5) * 0.22;
        const controlX = (previousX + pointX) / 2 - (pointY - previousY) * bulge;
        const controlY = (previousY + pointY) / 2 + (pointX - previousX) * bulge;
        return `Q${controlX.toFixed(2)} ${controlY.toFixed(2)} ${pointX.toFixed(2)} ${pointY.toFixed(2)}`;
      });
      return `M${first[0].toFixed(2)} ${first[1].toFixed(2)} ${curves.join(" ")}`;
    })
    .join(" ");
}

export function buildFrameTicksPath(inset: number, tickLength: number): string {
  const low = inset;
  const high = 100 - inset;
  return Array.from({ length: TICKS_PER_SIDE - 1 }, (_unused, index) => {
    const along = low + ((high - low) * (index + 1)) / TICKS_PER_SIDE;
    return [
      `M${along.toFixed(2)} ${low} v${tickLength}`,
      `M${along.toFixed(2)} ${high} v${-tickLength}`,
      `M${low} ${along.toFixed(2)} h${tickLength}`,
      `M${high} ${along.toFixed(2)} h${-tickLength}`,
    ].join(" ");
  }).join(" ");
}
