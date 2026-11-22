import * as THREE from "three";
import type { Harness, PlacedPiece } from "papercraft/harness.js";
import type { Point } from "papercraft/lib/paperkit-2d.js";
import { FlapSpring, Spring, makeCard } from "papercraft/lib/paperkit-3d.js";
import type { PigeonVariant } from "../pieces/pigeon";
import { standingPigeonCard } from "../pieces/pigeon";
import {
  BONK_TILT_RAD,
  FLATTEN_MS,
  FLIGHT_ARC_HEIGHT_UNITS,
  HOVER_BOB_HZ,
  HOVER_BOB_UNITS,
  HOVER_HEIGHT_UNITS,
  PECK_RECOVER_MS,
  PECK_STRIKE_MS,
  PECK_TILT_RAD,
} from "../motion/motion-tokens";
import { TABLE_YAW_RAD } from "../stage/look";
import type { Facing, PerchSpot } from "./perches";

const FLAT_RAD = Math.PI / 2 - 0.03;
const PECK_HOLD_REPLAY_MS = 40;
const FOLD_AWAY_MS = 240;

export type PigeonPose =
  | { kind: "hidden" }
  | { kind: "hovering"; spot: PerchSpot }
  | { kind: "flying"; from: PerchSpot; to: PerchSpot; fromHeight: number; toHeight: number; startTick: number; landsTick: number }
  | { kind: "perched"; spot: PerchSpot }
  | { kind: "stunned"; spot: PerchSpot; cause: "bonk" | "swat"; sinceTick: number; untilTick: number }
  | { kind: "folding"; spot: PerchSpot; sinceTick: number };

export interface PigeonActor {
  readonly piece: PlacedPiece;
  update(pose: PigeonPose, nowTick: number, tickMs: number, dtSeconds: number): void;
  peck(atTick: number): void;
  reset(): void;
}

export interface PigeonPrint {
  outline: Point[];
  materials: THREE.Material | THREE.Material[];
}

export function printPigeonVariant(harness: Harness, deck: THREE.Object3D, variant: PigeonVariant): PigeonPrint {
  const [outline, paint] = standingPigeonCard(variant, "right");
  const [, paintFacingLeft] = standingPigeonCard(variant, "left");
  const card = makeCard(outline, { ...harness.cardOpts(0, 0, 1, deck), paint, back: paintFacingLeft, backRes: 1 });
  return { outline, materials: card.material };
}

function smoothstep(progress: number): number {
  const clamped = Math.min(1, Math.max(0, progress));
  return clamped * clamped * (3 - 2 * clamped);
}

function facingAngle(facing: Facing): number {
  return -TABLE_YAW_RAD + (facing === "left" ? Math.PI : 0);
}

function peckTilt(elapsedMs: number): number {
  if (elapsedMs < 0) return 0;
  if (elapsedMs < PECK_STRIKE_MS) return -PECK_TILT_RAD * smoothstep(elapsedMs / PECK_STRIKE_MS);
  const recoverStart = PECK_STRIKE_MS + PECK_HOLD_REPLAY_MS;
  if (elapsedMs < recoverStart) return -PECK_TILT_RAD;
  const recover = (elapsedMs - recoverStart) / PECK_RECOVER_MS;
  if (recover >= 1.6) return 0;
  const overshoot = Math.sin(Math.min(1, recover) * Math.PI) * 0.08 * PECK_TILT_RAD;
  return -PECK_TILT_RAD * (1 - smoothstep(recover)) + overshoot;
}

export function createPigeonActor(harness: Harness, deck: THREE.Object3D, print: PigeonPrint, seat: number, order: number): PigeonActor {
  const options = harness.cardOpts(0, 0, 1, deck);
  const card = makeCard(print.outline, { ...options, materials: print.materials, seed: 900 + seat });
  card.name = `pigeon seat ${seat}`;
  const turnPivot = new THREE.Group();
  const tiltPivot = new THREE.Group();
  const foldPivot = new THREE.Group();
  tiltPivot.add(card);
  turnPivot.add(tiltPivot);
  foldPivot.add(turnPivot);
  const piece = harness.popup(null, null, { node: foldPivot, height: 3.6, parent: deck, x: 0, z: 0, yaw: 0, order, level: true });

  const turnSpring = new Spring({ value: facingAngle("right"), hz: 3.2, zeta: 0.75 });
  const riseSpring = new FlapSpring({ p: 1, size: 0.3 });
  const bonkSpring = new FlapSpring({ p: 1, size: 0.3 });
  let lastPeckTick = Number.NEGATIVE_INFINITY;
  let wasStunnedBy: "bonk" | "swat" | null = null;
  let wasHidden = true;

  function placeAt(along: number, height: number, deckZ: number): void {
    piece.group.position.set(along, 0.01 + height, deckZ);
  }

  function applyStun(pose: Extract<PigeonPose, { kind: "stunned" }>, nowTick: number, tickMs: number, dtSeconds: number): void {
    const elapsedMs = (nowTick - pose.sinceTick) * tickMs;
    if (pose.cause === "swat") {
      const flatness = smoothstep(elapsedMs / FLATTEN_MS);
      foldPivot.rotation.x = flatness * FLAT_RAD;
      riseSpring.reset(0);
    } else {
      if (wasStunnedBy !== "bonk") bonkSpring.set(0);
      tiltPivot.rotation.z = (1 - bonkSpring.step(dtSeconds)) * BONK_TILT_RAD;
    }
    wasStunnedBy = pose.cause;
  }

  function settleAfterStun(dtSeconds: number): void {
    if (wasStunnedBy === "swat") riseSpring.set(1);
    if (wasStunnedBy === "bonk") bonkSpring.set(1);
    wasStunnedBy = null;
    foldPivot.rotation.x = (1 - riseSpring.step(dtSeconds)) * FLAT_RAD;
    tiltPivot.rotation.z = (1 - bonkSpring.step(dtSeconds)) * BONK_TILT_RAD;
  }

  return {
    piece,
    peck(atTick) {
      lastPeckTick = atTick;
    },
    reset() {
      lastPeckTick = Number.NEGATIVE_INFINITY;
      wasStunnedBy = null;
      wasHidden = true;
      riseSpring.reset(1);
      bonkSpring.reset(1);
      turnSpring.reset(facingAngle("right"));
      foldPivot.rotation.set(0, 0, 0);
      tiltPivot.rotation.set(0, 0, 0);
      piece.group.visible = true;
    },
    update(pose, nowTick, tickMs, dtSeconds) {
      piece.group.visible = pose.kind !== "hidden";
      if (pose.kind === "hidden") {
        wasHidden = true;
        return;
      }
      if (wasHidden) {
        wasHidden = false;
        riseSpring.reset(0);
        riseSpring.set(1);
      }
      let facing: Facing = "right";
      if (pose.kind === "flying") {
        const progress = (nowTick - pose.startTick) / Math.max(1, pose.landsTick - pose.startTick);
        const eased = smoothstep(progress);
        const arc = Math.sin(Math.min(1, Math.max(0, progress)) * Math.PI) * FLIGHT_ARC_HEIGHT_UNITS;
        placeAt(
          pose.from.along + (pose.to.along - pose.from.along) * eased,
          pose.fromHeight + (pose.toHeight - pose.fromHeight) * eased + arc,
          pose.from.deckZ + (pose.to.deckZ - pose.from.deckZ) * eased,
        );
        facing = pose.to.along >= pose.from.along ? "right" : "left";
      } else if (pose.kind === "folding") {
        placeAt(pose.spot.along, HOVER_HEIGHT_UNITS, pose.spot.deckZ);
        foldPivot.rotation.x = smoothstep(((nowTick - pose.sinceTick) * tickMs) / FOLD_AWAY_MS) * FLAT_RAD;
        return;
      } else if (pose.kind === "hovering") {
        const bob = Math.sin(((nowTick * tickMs) / 1000) * Math.PI * 2 * HOVER_BOB_HZ + pose.spot.along) * HOVER_BOB_UNITS;
        placeAt(pose.spot.along, HOVER_HEIGHT_UNITS + bob, pose.spot.deckZ);
        facing = pose.spot.facing;
      } else {
        placeAt(pose.spot.along, 0, pose.spot.deckZ);
        facing = pose.spot.facing;
      }
      turnSpring.set(facingAngle(facing));
      turnPivot.rotation.y = turnSpring.step(dtSeconds);
      if (pose.kind === "stunned") {
        applyStun(pose, nowTick, tickMs, dtSeconds);
        return;
      }
      settleAfterStun(dtSeconds);
      if (pose.kind === "perched") tiltPivot.rotation.z += peckTilt((nowTick - lastPeckTick) * tickMs);
    },
  };
}
