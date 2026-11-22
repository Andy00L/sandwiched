import type { HarnessOptions, LensOptions, LightOptions, Vector3Tuple } from "papercraft/harness.js";
import { PALETTE } from "../palette";

export const PIGEON_HEIGHT_UNITS = 3.6;

const KEY_AZIMUTH_DEG = 55;
const KEY_ELEVATION_DEG = 50;

function directionFromAngles(azimuthDeg: number, elevationDeg: number): Vector3Tuple {
  const azimuth = (azimuthDeg * Math.PI) / 180;
  const elevation = (elevationDeg * Math.PI) / 180;
  return [-Math.sin(azimuth), Math.tan(elevation), Math.cos(azimuth)];
}

export const PARK_LIGHT: LightOptions = {
  key: "#ffe2c0",
  keyIntensity: 3.0,
  keyDir: directionFromAngles(KEY_AZIMUTH_DEG, KEY_ELEVATION_DEG),
  fill: "#f2e0c8",
  fillIntensity: 0.8,
  sky: "#fff0da",
  ground: "#b39a78",
  skyIntensity: 0.42,
  leak: PALETTE.shadowTint,
};

export const PARK_LENS: LensOptions = {
  focusBand: 0.3,
  ramp: 0.3,
  maxBlur: 16,
  exposure: 0.82,
  contrast: 1.18,
  tint: [1.02, 0.99, 0.985],
  saturation: 0.96,
  greenDesat: 0.1,
  aoTint: PALETTE.contactTint,
  grain: 0.01,
  vignette: 0.03,
  haze: "#c9c39a",
};

export const TABLE_YAW_RAD = (26 * Math.PI) / 180;

export const PARK_VIEW: NonNullable<HarnessOptions["view"]> = {
  fov: 26,
  pitch: 47,
  dist: 76,
  target: [1.5, 7.5, -8.5],
};

export const TEST_CARD_SPOT: [number, number] = [-20, 20];

export const PARK_TEST_VIEW: NonNullable<HarnessOptions["testView"]> = {
  dist: 15,
  target: [TEST_CARD_SPOT[0], 1.5, TEST_CARD_SPOT[1]],
};

export const PAPER_STOCK = "#f5f1e8";
