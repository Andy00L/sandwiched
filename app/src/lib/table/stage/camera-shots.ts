import * as THREE from "three";
import type { Harness } from "papercraft/harness.js";

export type CameraShot = "overview" | "table";

type ShotFraming = { dist: number; targetShiftZ: number; focus: THREE.Vector3 | null };

const OVERVIEW_DIST = 96;
const OVERVIEW_SHIFT_Z = -7;
const OVERVIEW_FOCUS: readonly [number, number, number] = [0, 4, -12];
export const SHOT_GLIDE_S = 0.9;

const easeInOutCubic = (progress: number): number => (progress < 0.5 ? 4 * progress ** 3 : 1 - (-2 * progress + 2) ** 3 / 2);

export function directCameraShots(harness: Harness, readShot: () => CameraShot): void {
  const tableDist = harness.view.dist;
  const tableTargetZ = harness.target.z;
  const framings: Record<CameraShot, ShotFraming> = {
    overview: { dist: OVERVIEW_DIST, targetShiftZ: OVERVIEW_SHIFT_Z, focus: new THREE.Vector3(...OVERVIEW_FOCUS) },
    table: { dist: tableDist, targetShiftZ: 0, focus: null },
  };
  let shownShot: CameraShot = readShot();
  let fromDist = framings[shownShot].dist;
  let fromShiftZ = framings[shownShot].targetShiftZ;
  let glideProgress = 1;
  let isHoldingOverviewFocus = false;
  const focusPoint = new THREE.Vector3();

  const place = (dist: number, shiftZ: number) => {
    harness.view.dist = dist;
    harness.target.z = tableTargetZ + shiftZ;
  };
  place(fromDist, fromShiftZ);

  harness.onStep((_timeSeconds, dtSeconds) => {
    const wanted = readShot();
    if (wanted !== shownShot) {
      fromDist = harness.view.dist;
      fromShiftZ = harness.target.z - tableTargetZ;
      shownShot = wanted;
      glideProgress = 0;
    }
    const goal = framings[shownShot];
    if (glideProgress < 1) {
      glideProgress = Math.min(1, glideProgress + dtSeconds / SHOT_GLIDE_S);
      const eased = easeInOutCubic(glideProgress);
      place(fromDist + (goal.dist - fromDist) * eased, fromShiftZ + (goal.targetShiftZ - fromShiftZ) * eased);
    }
    const overviewFocus = framings.overview.focus;
    if (shownShot === "overview" && overviewFocus !== null) {
      harness.focusOn(focusPoint.copy(overviewFocus));
      isHoldingOverviewFocus = true;
    } else if (isHoldingOverviewFocus) {
      harness.focusOn(null);
      isHoldingOverviewFocus = false;
    }
  });
}
