export type Point = [number, number];
export type Rng = () => number;
export type Ink = (color: string, how?: "print") => string;

export interface Box {
  x0: number;
  x1: number;
  y0: number;
  y1: number;
  w: number;
  h: number;
}

export interface LayerOptions {
  shadow?: number;
  lip?: number;
  shade?: number;
  rim?: number;
  felt?: number;
  depth?: number;
  alpha?: number;
  light?: Point;
  shadowColor?: string;
  lipColor?: string;
  shadeColor?: string;
  rimColor?: string;
}

export type MarkKind =
  | "leaf"
  | "dab"
  | "dot"
  | "tick"
  | "scallop"
  | "scale"
  | "wave"
  | "hatch"
  | "brick"
  | "panel"
  | "rivet"
  | "stripe"
  | "window";

export interface MarkOptions {
  color?: string;
  alpha?: number;
  size?: number;
  units?: boolean;
  density?: number;
  angle?: number;
  region?: Box;
  width?: number;
  light?: string;
  lit?: number;
  dark?: string | null;
}

export interface Print {
  g: CanvasRenderingContext2D;
  r: Rng;
  box: Box;
  px: number;
  pts: Point[];
  U: number;
  fill(color: string | CanvasGradient): void;
  gradient(colorStart: string, colorEnd: string, angle?: number): void;
  innerShade(color: string, options?: { dx?: number; dy?: number; blurPx?: number; alpha?: number }): void;
  marks(kind: MarkKind, options?: MarkOptions): void;
  draw(drawing: (g: CanvasRenderingContext2D, print: Print) => void): void;
  layer(
    shape: Point[] | Path2D | ((g: CanvasRenderingContext2D, print: Print) => void),
    color?: string | CanvasGradient,
    options?: LayerOptions,
  ): void;
  parts(drawing: (g: CanvasRenderingContext2D, ink: Ink) => void, options?: LayerOptions): void;
  felt(amount?: number): void;
  glow(drawing: (g: CanvasRenderingContext2D, print: Print) => void): void;
  rim(options?: { width?: number; light?: Point; skip?: (x0: number, y0: number, x1: number, y1: number) => boolean }): void;
}

export type PaintFn = (print: Print) => void;

export function rng(seed?: number): Rng;
export function shade(color: string, amount: number): string;
export function mix(colorA: string, colorB: string, amount: number): string;
export function rgba(color: string, alpha: number): string;
export function bbox(pts: Point[]): Box;
export function roughen(
  pts: Point[],
  random: Rng,
  options?: { amp?: number | null; step?: number | null; period?: number; tear?: number; keepBase?: boolean },
): Point[];
export function tracePath(g: CanvasRenderingContext2D, pts: Point[]): void;
export function fillLeaf(g: CanvasRenderingContext2D, x: number, y: number, length: number, angle: number, widthFactor?: number): void;
export function fillLimb(
  g: CanvasRenderingContext2D,
  x0: number,
  y0: number,
  controlX: number,
  controlY: number,
  x1: number,
  y1: number,
  widthStart: number,
  widthEnd: number,
  steps?: number,
): void;
export function scallopTiles(print: Print, region: Box, options?: { color?: string; rows?: number }): void;
export function fromDrawing(
  drawing: (g: CanvasRenderingContext2D) => void,
  options?: { w?: number; h?: number; res?: number; simplify?: number; name?: string },
): Point[];
export function drawnPiece(
  drawing: (g: CanvasRenderingContext2D, ink: Ink) => void,
  options?: { w?: number; h?: number; res?: number; simplify?: number; finish?: boolean; layered?: boolean; layer?: LayerOptions; name?: string },
): [Point[], PaintFn];

export function pathLine(controlPoints: Point[], options?: { step?: number }): { pts: Point[]; dist(x: number, z: number): number };

export const shape: {
  rect(width: number, height: number): Point[];
  mound(random: Rng, options?: { w?: number; h?: number; lobes?: number; depth?: number; n?: number }): Point[];
  radial(
    random: Rng,
    options?: {
      cx?: number;
      cy?: number;
      rx?: number;
      ry?: number;
      lobes?: number;
      depth?: number;
      spiky?: boolean;
      wobble?: number;
      n?: number;
      stalk?: { w: number; base: number } | null;
    },
  ): Point[];
  hill(random: Rng, options?: { w?: number; h?: number; bumps?: number; n?: number }): Point[];
  waves(random: Rng, options?: { w?: number; h?: number; crests?: number; n?: number }): Point[];
};

export const draw2: {
  ell(g: CanvasRenderingContext2D, x: number, y: number, radiusX: number, radiusY: number, rotation?: number): void;
  rect(g: CanvasRenderingContext2D, x: number, y: number, width: number, height: number, cornerRadius?: number): void;
  poly(g: CanvasRenderingContext2D, pts: Point[]): void;
};
