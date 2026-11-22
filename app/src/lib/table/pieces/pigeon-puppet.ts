import * as THREE from "three";
import type { Harness, PlacedPiece } from "papercraft/harness.js";
import { hinge, makeCard } from "papercraft/lib/paperkit-3d.js";
import type { CardOptions, HingeHandle } from "papercraft/lib/paperkit-3d.js";
import { applyFlip } from "../motion/verbs";
import { TABLE_YAW_RAD } from "../stage/look";
import { LEG_TOP_UNITS } from "./pigeon";
import type { CropBagPrints, CropBagStage, PigeonKit, PigeonPartPrint, PressedProps } from "./pigeon";

export interface PigeonPuppet {
  root: THREE.Group;
  neck: THREE.Group;
  tail: THREE.Group;
  wings: readonly THREE.Group[];
  setCropStage(stage: CropBagStage): void;
}

const LEG_SPREAD_UNITS = 0.3;
const DEPTH = { farWing: -0.14, tail: -0.1, farLeg: -0.06, body: 0, head: 0.04, beak: 0.04, tongue: -0.03, nearLeg: 0.06, nearWing: 0.1, cropBag: 0.16, crease: 0.2 } as const;
const CREASE_TILT_RAD = -0.17;
const CREASE_FOLDED_RAD = Math.PI / 2 - 0.01;

function pivotAt(parent: THREE.Object3D, pointX: number, pointY: number, depth: number): THREE.Group {
  const pivot = new THREE.Group();
  pivot.position.set(pointX, pointY, depth);
  parent.add(pivot);
  return pivot;
}

function stamp(part: PigeonPartPrint, options: CardOptions, parent: THREE.Object3D, pivot: { pointX: number; pointY: number }, name: string): THREE.Mesh {
  const card = makeCard(part.outline, { ...options, materials: part.materials });
  card.position.set(-pivot.pointX, -pivot.pointY, 0);
  card.name = name;
  parent.add(card);
  return card;
}

export function buildPigeonPuppet(kit: PigeonKit, cropBags: CropBagPrints, options: CardOptions, name: string): PigeonPuppet {
  const { parts, anchors } = kit;
  const root = new THREE.Group();
  root.name = name;

  for (const [side, depth] of [
    [-1, DEPTH.farLeg],
    [1, DEPTH.nearLeg],
  ] as const) {
    const hip = { pointX: side * LEG_SPREAD_UNITS, pointY: LEG_TOP_UNITS };
    const legPivot = pivotAt(root, hip.pointX, hip.pointY, depth);
    stamp(parts.leg, options, legPivot, { pointX: 0, pointY: LEG_TOP_UNITS }, `${name} leg ${side < 0 ? "far" : "near"}`);
  }

  const rump = { pointX: -0.6, pointY: anchors.bodyY - 0.15 };
  const tail = pivotAt(root, rump.pointX, rump.pointY, DEPTH.tail);
  stamp(parts.tail, options, tail, rump, `${name} tail`);

  const body = pivotAt(root, 0, 0, DEPTH.body);
  stamp(parts.body, options, body, { pointX: 0, pointY: 0 }, `${name} body`);

  const shoulder = { pointX: 0.45, pointY: anchors.bodyY + 0.5 };
  const wings = [DEPTH.farWing, DEPTH.nearWing].map((depth, wingIndex) => {
    const wing = pivotAt(root, shoulder.pointX, shoulder.pointY, depth);
    stamp(parts.wing, options, wing, shoulder, `${name} wing ${wingIndex === 0 ? "far" : "near"}`);
    return wing;
  });

  const neckJoint = { pointX: anchors.neckX, pointY: anchors.neckY };
  const neck = pivotAt(root, neckJoint.pointX, neckJoint.pointY, DEPTH.head);
  stamp(parts.head, options, neck, neckJoint, `${name} head`);
  const beak = stamp(parts.beak, options, neck, neckJoint, `${name} beak`);
  beak.position.z = DEPTH.beak;

  const cropBag = makeCard(cropBags.outline, { ...options, materials: cropBags.materials.empty });
  cropBag.position.set(0.72, anchors.bodyY - 0.62, DEPTH.cropBag);
  cropBag.name = `${name} crop bag`;
  root.add(cropBag);
  let shownStage: CropBagStage = "empty";

  return {
    root,
    neck,
    tail,
    wings,
    setCropStage(stage) {
      if (stage === shownStage) return;
      shownStage = stage;
      cropBag.material = cropBags.materials[stage];
    },
  };
}

interface PressedPuppetProps {
  tongue: THREE.Mesh;
  crease: HingeHandle;
}

export function attachPressedProps(puppet: PigeonPuppet, kit: PigeonKit, pressed: PressedProps, options: CardOptions, name: string): PressedPuppetProps {
  const { anchors, shape } = kit;
  const tongue = makeCard(pressed.tongue.outline, { ...options, materials: pressed.tongue.materials });
  tongue.position.set(anchors.headX + shape.headRadius * 0.82 + 0.1 - anchors.neckX, anchors.headY - 0.12 - anchors.neckY, DEPTH.tongue);
  tongue.name = `${name} tongue`;
  tongue.visible = false;
  puppet.neck.add(tongue);

  const creaseTilt = pivotAt(puppet.root, -0.15, anchors.bodyY + 0.05, DEPTH.crease);
  creaseTilt.rotation.z = CREASE_TILT_RAD;
  const creaseCard = makeCard(pressed.crease.outline, { ...options, materials: pressed.crease.materials });
  creaseCard.name = `${name} crease`;
  const crease = hinge(creaseCard, { open: 0, size: 0.12, flat: CREASE_FOLDED_RAD });
  crease.group.visible = false;
  creaseTilt.add(crease.group);
  return { tongue, crease };
}

export const PIGEON_STANDING_HEIGHT_UNITS = 4.2;

export function placeStandingPigeon(
  harness: Harness,
  deck: THREE.Object3D | null,
  kit: PigeonKit,
  cropBags: CropBagPrints,
  placement: { along: number; deckZ: number; facing: "left" | "right"; order: number; name: string },
): PlacedPiece {
  const puppet = buildPigeonPuppet(kit, cropBags, harness.cardOpts(placement.along, placement.deckZ, 1, deck), placement.name);
  const turn = new THREE.Group();
  turn.rotation.y = deck ? -TABLE_YAW_RAD : 0;
  applyFlip(turn, placement.facing === "left" ? -1 : 1);
  turn.add(puppet.root);
  return harness.popup(null, null, { node: turn, height: PIGEON_STANDING_HEIGHT_UNITS, parent: deck, x: placement.along, z: placement.deckZ, yaw: 0, order: placement.order, level: true });
}
