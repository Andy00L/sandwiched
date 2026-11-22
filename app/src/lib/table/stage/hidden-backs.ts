import * as THREE from "three";
import type { Harness } from "papercraft/harness.js";

const BACK_GROUP_MATERIAL_INDEX = 2;
const BACK_AWAY_DOT = -0.2;
const TRIM_AFTER_RISE_S = 4;
const MOVING_GROUP_NAMES: ReadonlySet<string> = new Set(["life"]);
const backNormal = new THREE.Vector3();
const toCamera = new THREE.Vector3();
const cardPosition = new THREE.Vector3();

export function markMoving(node: THREE.Object3D): void {
  node.userData.isMoving = true;
}

function isUnderMovingNode(object: THREE.Object3D): boolean {
  for (let node: THREE.Object3D | null = object; node; node = node.parent) {
    if (node.userData.isMoving === true || MOVING_GROUP_NAMES.has(node.name)) return true;
  }
  return false;
}

function trimHiddenBacks(harness: Harness): number {
  harness.scene.updateMatrixWorld(true);
  let trimmed = 0;
  harness.scene.traverse((object) => {
    if (!(object instanceof THREE.Mesh) || !Array.isArray(object.material) || isUnderMovingNode(object)) return;
    const material = object.material[BACK_GROUP_MATERIAL_INDEX];
    const geometry = object.geometry;
    if (!(material instanceof THREE.Material) || material.side !== THREE.FrontSide || !(geometry instanceof THREE.BufferGeometry)) return;
    const backGroup = geometry.groups.find((group) => group.materialIndex === BACK_GROUP_MATERIAL_INDEX);
    if (!backGroup) return;
    backNormal.set(0, 0, -1).transformDirection(object.matrixWorld);
    toCamera.copy(harness.camera.position).sub(object.getWorldPosition(cardPosition)).normalize();
    if (backNormal.dot(toCamera) > BACK_AWAY_DOT) return;
    geometry.groups = geometry.groups.filter((group) => group !== backGroup);
    trimmed += 1;
  });
  return trimmed;
}

export function trimHiddenBacksOnceRisen(harness: Harness): void {
  let isTrimmed = false;
  harness.onStep((timeSeconds) => {
    if (isTrimmed || timeSeconds < TRIM_AFTER_RISE_S) return;
    isTrimmed = true;
    console.info(`[trimHiddenBacksOnceRisen] ${trimHiddenBacks(harness)} card backs face away from the camera; their draw calls are skipped`);
  });
}

export interface BackToggle {
  setBacksDrawn(isDrawn: boolean): void;
}

export function createBackToggle(root: THREE.Object3D): BackToggle {
  const cards: Array<{ geometry: THREE.BufferGeometry; allGroups: THREE.BufferGeometry["groups"]; frontGroups: THREE.BufferGeometry["groups"] }> = [];
  root.traverse((object) => {
    if (!(object instanceof THREE.Mesh) || !Array.isArray(object.material) || !(object.geometry instanceof THREE.BufferGeometry)) return;
    const geometry = object.geometry;
    const frontGroups = geometry.groups.filter((group) => group.materialIndex !== BACK_GROUP_MATERIAL_INDEX);
    if (frontGroups.length !== geometry.groups.length) cards.push({ geometry, allGroups: geometry.groups, frontGroups });
  });
  let areBacksDrawn = true;
  return {
    setBacksDrawn(isDrawn) {
      if (isDrawn === areBacksDrawn) return;
      areBacksDrawn = isDrawn;
      for (const card of cards) card.geometry.groups = isDrawn ? card.allGroups : card.frontGroups;
    },
  };
}
