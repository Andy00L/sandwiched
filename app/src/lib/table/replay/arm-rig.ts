import * as THREE from "three";

export const UPPER_ARM_UNITS = 6.4;
export const FOREARM_UNITS = 7.2;
const FOREARM_LAYER_UNITS = 0.25;
const REACH_MARGIN_UNITS = 0.05;

export interface ArmRig {
  upper: THREE.Group;
  fore: THREE.Group;
  shoulder: THREE.Vector3;
  side: -1 | 1;
}

const ELBOW_POLES: Record<-1 | 1, THREE.Vector3> = {
  [-1]: new THREE.Vector3(-1, -0.3, -0.8).normalize(),
  [1]: new THREE.Vector3(1, -0.3, -0.8).normalize(),
};
const scratchToHand = new THREE.Vector3();
const scratchPoleAcross = new THREE.Vector3();
const scratchElbow = new THREE.Vector3();
const scratchReachedHand = new THREE.Vector3();
const scratchSegment = new THREE.Vector3();
const scratchCardUp = new THREE.Vector3();
const scratchCardNormal = new THREE.Vector3();
const scratchCardRight = new THREE.Vector3();
const scratchBasis = new THREE.Matrix4();

function orientAlong(target: THREE.Quaternion, direction: THREE.Vector3, towardCamera: THREE.Vector3): void {
  const cardUp = scratchCardUp.copy(direction).negate().normalize();
  const cardNormal = scratchCardNormal.copy(towardCamera).addScaledVector(cardUp, -towardCamera.dot(cardUp)).normalize();
  const cardRight = scratchCardRight.crossVectors(cardUp, cardNormal).normalize();
  target.setFromRotationMatrix(scratchBasis.makeBasis(cardRight, cardUp, cardNormal));
}

export function poseArm(rig: ArmRig, hand: THREE.Vector3, towardCamera: THREE.Vector3): void {
  const toHand = scratchToHand.subVectors(hand, rig.shoulder);
  const minimumReach = Math.abs(UPPER_ARM_UNITS - FOREARM_UNITS) + REACH_MARGIN_UNITS;
  const maximumReach = UPPER_ARM_UNITS + FOREARM_UNITS - REACH_MARGIN_UNITS;
  const reach = Math.min(maximumReach, Math.max(minimumReach, toHand.length()));
  const direction = toHand.normalize();
  const alongReach = (UPPER_ARM_UNITS * UPPER_ARM_UNITS + reach * reach - FOREARM_UNITS * FOREARM_UNITS) / (2 * reach);
  const elbowLift = Math.sqrt(Math.max(0, UPPER_ARM_UNITS * UPPER_ARM_UNITS - alongReach * alongReach));
  const pole = ELBOW_POLES[rig.side];
  const poleAcross = scratchPoleAcross.copy(pole).addScaledVector(direction, -pole.dot(direction)).normalize();
  const elbow = scratchElbow.copy(rig.shoulder).addScaledVector(direction, alongReach).addScaledVector(poleAcross, elbowLift);
  const reachedHand = scratchReachedHand.copy(rig.shoulder).addScaledVector(direction, reach);
  rig.upper.position.copy(rig.shoulder);
  orientAlong(rig.upper.quaternion, scratchSegment.subVectors(elbow, rig.shoulder), towardCamera);
  rig.fore.position.copy(elbow).addScaledVector(towardCamera, FOREARM_LAYER_UNITS);
  orientAlong(rig.fore.quaternion, scratchSegment.subVectors(reachedHand, elbow), towardCamera);
}
