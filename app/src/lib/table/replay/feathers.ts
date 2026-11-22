import * as THREE from "three";
import { makeCard } from "papercraft/lib/paperkit-3d.js";
import type { CardOptions } from "papercraft/lib/paperkit-3d.js";
import { FEATHER_DRIFT_MS } from "../motion/motion-tokens";
import type { PigeonPartPrint } from "../pieces/pigeon";
import { markMoving } from "../stage/hidden-backs";
import { TABLE_YAW_RAD } from "../stage/look";

const FEATHER_POOL_SIZE = 40;
const FEATHER_RISE_MS = 260;
const FEATHER_SETTLE_MS = 260;
const FEATHER_REST_MS = 900;
const FEATHER_LAUNCH_HEIGHT_UNITS = 1.8;
const FEATHER_RISE_UNITS = 1.7;
const FEATHER_REST_HEIGHT_UNITS = 0.03;
const FEATHER_SPREAD_UNITS = 1.6;
const FEATHER_SWAY_UNITS = 0.45;
const FEATHER_SWAY_HZ = 1.7;
const FEATHER_ROLL_RAD = 0.7;
const FEATHER_FLAT_RAD = -Math.PI / 2 + 0.02;

interface FeatherFlight {
  fromAlong: number;
  fromDeckZ: number;
  startTick: number;
  heading: number;
  phase: number;
}

interface Feather {
  node: THREE.Group;
  flight: FeatherFlight | null;
}

export interface FeatherPool {
  launch(fromAlong: number, fromDeckZ: number, startTick: number, seed: number): void;
  place(presentTick: number, tickMs: number): void;
  reset(): void;
}

function seededUnit(seed: number): number {
  const wave = Math.sin(seed * 12.9898 + 78.233) * 43758.5453;
  return wave - Math.floor(wave);
}

function easeOut(progress: number): number {
  const clamped = Math.min(1, Math.max(0, progress));
  return 1 - (1 - clamped) * (1 - clamped);
}

function smoothstep(progress: number): number {
  const clamped = Math.min(1, Math.max(0, progress));
  return clamped * clamped * (3 - 2 * clamped);
}

function placeFeather(feather: Feather, flight: FeatherFlight, elapsedMs: number): void {
  const peakUnits = FEATHER_LAUNCH_HEIGHT_UNITS + FEATHER_RISE_UNITS;
  const fallProgress = Math.min(1, Math.max(0, (elapsedMs - FEATHER_RISE_MS) / (FEATHER_DRIFT_MS - FEATHER_RISE_MS)));
  const height =
    elapsedMs < FEATHER_RISE_MS
      ? FEATHER_LAUNCH_HEIGHT_UNITS + FEATHER_RISE_UNITS * easeOut(elapsedMs / FEATHER_RISE_MS)
      : peakUnits + (FEATHER_REST_HEIGHT_UNITS - peakUnits) * fallProgress;
  const swayEnvelope = 4 * fallProgress * (1 - fallProgress);
  const swing = Math.sin((elapsedMs / 1000) * Math.PI * 2 * FEATHER_SWAY_HZ + flight.phase) * swayEnvelope;
  const spread = FEATHER_SPREAD_UNITS * easeOut(elapsedMs / FEATHER_DRIFT_MS);
  feather.node.position.set(
    flight.fromAlong + Math.cos(flight.heading) * spread + swing * FEATHER_SWAY_UNITS,
    height,
    flight.fromDeckZ + Math.sin(flight.heading) * spread,
  );
  feather.node.rotation.set(FEATHER_FLAT_RAD * smoothstep((elapsedMs - (FEATHER_DRIFT_MS - FEATHER_SETTLE_MS)) / FEATHER_SETTLE_MS), -TABLE_YAW_RAD + flight.heading * 0.3, swing * FEATHER_ROLL_RAD);
}

export function buildFeatherPool(print: PigeonPartPrint, options: CardOptions, deck: THREE.Object3D): FeatherPool {
  const feathers: Feather[] = Array.from({ length: FEATHER_POOL_SIZE }, (_unused, featherIndex) => {
    const card = makeCard(print.outline, { ...options, materials: print.materials });
    card.name = `feather ${featherIndex}`;
    const node = new THREE.Group();
    node.rotation.order = "YXZ";
    node.visible = false;
    node.add(card);
    markMoving(node);
    deck.add(node);
    return { node, flight: null };
  });
  let nextFeather = 0;

  return {
    launch(fromAlong, fromDeckZ, startTick, seed) {
      const feather = feathers[nextFeather];
      nextFeather = (nextFeather + 1) % FEATHER_POOL_SIZE;
      if (!feather) return;
      feather.flight = { fromAlong, fromDeckZ, startTick, heading: seededUnit(seed) * Math.PI * 2, phase: seededUnit(seed + 0.5) * Math.PI * 2 };
    },
    place(presentTick, tickMs) {
      for (const feather of feathers) {
        const flight = feather.flight;
        const elapsedMs = flight ? (presentTick - flight.startTick) * tickMs : -1;
        const isAlive = flight !== null && elapsedMs >= 0 && elapsedMs < FEATHER_DRIFT_MS + FEATHER_REST_MS;
        feather.node.visible = isAlive;
        if (flight && isAlive) placeFeather(feather, flight, elapsedMs);
        else if (flight && elapsedMs >= FEATHER_DRIFT_MS + FEATHER_REST_MS) feather.flight = null;
      }
    },
    reset() {
      nextFeather = 0;
      for (const feather of feathers) {
        feather.flight = null;
        feather.node.visible = false;
      }
    },
  };
}
