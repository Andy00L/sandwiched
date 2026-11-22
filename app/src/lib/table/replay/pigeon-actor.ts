import * as THREE from "three";
import type { Harness, PlacedPiece } from "papercraft/harness.js";
import { FlapSpring, hinge, makeCard } from "papercraft/lib/paperkit-3d.js";
import type { HingeHandle } from "papercraft/lib/paperkit-3d.js";
import { cropBagStageFor, printPigeonKit } from "../pieces/pigeon";
import type { CropBagPrints, PigeonKit, PigeonPartPrint, PigeonVariant } from "../pieces/pigeon";
import { buildPigeonPuppet } from "../pieces/pigeon-puppet";
import { BONK_TILT_RAD, FLATTEN_MS, FLINCH_MS, HOVER_BOB_HZ, HOVER_BOB_UNITS, HOVER_HEIGHT_UNITS } from "../motion/motion-tokens";
import { flightPlacement, peckDepth } from "../motion/pigeon-clips";
import { applyFlip, stepFlip } from "../motion/verbs";
import type { FlipTarget } from "../motion/verbs";
import { TABLE_YAW_RAD } from "../stage/look";
import type { Facing, PerchSpot } from "./perches";

const FLAT_RAD = Math.PI / 2 - 0.03;
const FOLD_AWAY_MS = 240;
const NECK_PECK_RAD = 0.85;
const TAIL_COUNTER_RAD = THREE.MathUtils.degToRad(10);
const BODY_PECK_RAD = 0.12;
const WING_FLAP_RAD = THREE.MathUtils.degToRad(32);
const WING_FLAP_HZ = 9;
const FLINCH_WING_RAD = THREE.MathUtils.degToRad(20);
const STAR_SPOTS: ReadonlyArray<readonly [number, number]> = [
  [-1.5, 0.9],
  [0.1, 1.8],
  [1.6, 0.7],
];

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
  flinch(atTick: number): void;
  showBeakCrumbs(beakCrumbs: number): void;
  reset(): void;
}

export function printPigeonVariant(harness: Harness, deck: THREE.Object3D, variant: PigeonVariant): PigeonKit {
  return printPigeonKit(harness.cardOpts(0, 0, 1, deck), variant);
}

function smoothstep(progress: number): number {
  const clamped = Math.min(1, Math.max(0, progress));
  return clamped * clamped * (3 - 2 * clamped);
}

function flipTarget(facing: Facing): FlipTarget {
  return facing === "left" ? -1 : 1;
}

export function createPigeonActor(
  harness: Harness,
  deck: THREE.Object3D,
  prints: { kit: PigeonKit; cropBags: CropBagPrints; star: PigeonPartPrint },
  seat: number,
  order: number,
): PigeonActor {
  const cardOptions = harness.cardOpts(0, 0, 1, deck);
  const puppet = buildPigeonPuppet(prints.kit, prints.cropBags, cardOptions, `pigeon seat ${seat}`);
  const turnPivot = new THREE.Group();
  const tiltPivot = new THREE.Group();
  const foldPivot = new THREE.Group();
  tiltPivot.add(puppet.root);
  turnPivot.add(tiltPivot);
  foldPivot.add(turnPivot);
  const piece = harness.popup(null, null, { node: foldPivot, height: 3.6, parent: deck, x: 0, z: 0, yaw: 0, order, level: true });

  let flip = 1;
  turnPivot.rotation.y = -TABLE_YAW_RAD;
  const riseSpring = new FlapSpring({ p: 1, size: 0.3 });
  const bonkSpring = new FlapSpring({ p: 1, size: 0.3 });
  const stars: HingeHandle[] = STAR_SPOTS.map(([starX, starZ], starIndex) => {
    const card = makeCard(prints.star.outline, { ...cardOptions, materials: prints.star.materials });
    card.name = `pigeon seat ${seat} star ${starIndex}`;
    const handle = hinge(card, { at: new THREE.Vector3(starX, 0.02, starZ), yaw: -TABLE_YAW_RAD, open: 0, size: 0.1 });
    handle.group.visible = false;
    piece.group.add(handle.group);
    return handle;
  });
  const starTargets = stars.map(() => 0);
  let lastPeckTick = Number.NEGATIVE_INFINITY;
  let lastFlinchTick = Number.NEGATIVE_INFINITY;

  function updateStars(pose: PigeonPose, nowTick: number, tickMs: number, dtSeconds: number): void {
    const stunElapsedMs = pose.kind === "stunned" ? (nowTick - pose.sinceTick) * tickMs : -1;
    const foldEveryMs = pose.kind === "stunned" ? ((pose.untilTick - pose.sinceTick) * tickMs) / stars.length : 0;
    stars.forEach((star, starIndex) => {
      const target = stunElapsedMs >= 0 && stunElapsedMs < foldEveryMs * (stars.length - starIndex) ? 1 : 0;
      if (target !== starTargets[starIndex]) {
        starTargets[starIndex] = target;
        star.set(target, 0);
      }
      star.update(dtSeconds);
      star.group.visible = target === 1 || star.p > 0.02;
    });
  }
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
    flinch(atTick) {
      lastFlinchTick = atTick;
    },
    showBeakCrumbs(beakCrumbs) {
      puppet.setCropStage(cropBagStageFor(beakCrumbs));
    },
    reset() {
      lastPeckTick = Number.NEGATIVE_INFINITY;
      lastFlinchTick = Number.NEGATIVE_INFINITY;
      for (const star of stars) {
        star.reset(0);
        star.group.visible = false;
      }
      starTargets.fill(0);
      wasStunnedBy = null;
      wasHidden = true;
      riseSpring.reset(1);
      bonkSpring.reset(1);
      flip = 1;
      applyFlip(turnPivot, flip);
      foldPivot.rotation.set(0, 0, 0);
      tiltPivot.rotation.set(0, 0, 0);
      puppet.neck.rotation.set(0, 0, 0);
      puppet.tail.rotation.set(0, 0, 0);
      for (const wing of puppet.wings) wing.rotation.set(0, 0, 0);
      puppet.setCropStage("empty");
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
      updateStars(pose, nowTick, tickMs, dtSeconds);
      let facing: Facing = "right";
      if (pose.kind === "flying") {
        const placement = flightPlacement(pose.from, pose.to, pose, { startTick: pose.startTick, landsTick: pose.landsTick, nowTick });
        placeAt(placement.along, placement.height, placement.deckZ);
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
      flip = stepFlip(flip, flipTarget(facing), dtSeconds);
      applyFlip(turnPivot, flip);
      if (pose.kind === "stunned") {
        applyStun(pose, nowTick, tickMs, dtSeconds);
        return;
      }
      settleAfterStun(dtSeconds);
      const isAirborne = pose.kind === "flying" || pose.kind === "hovering";
      const flap = isAirborne ? Math.sin(((nowTick * tickMs) / 1000) * Math.PI * 2 * WING_FLAP_HZ + seat) * WING_FLAP_RAD : 0;
      const flinch = pose.kind === "perched" && (nowTick - lastFlinchTick) * tickMs < FLINCH_MS ? -FLINCH_WING_RAD : 0;
      for (const wing of puppet.wings) wing.rotation.z = flap + flinch;
      const depth = pose.kind === "perched" ? peckDepth((nowTick - lastPeckTick) * tickMs) : 0;
      puppet.neck.rotation.z = -depth * NECK_PECK_RAD;
      puppet.tail.rotation.z = -depth * TAIL_COUNTER_RAD;
      tiltPivot.rotation.z += -depth * BODY_PECK_RAD;
    },
  };
}
