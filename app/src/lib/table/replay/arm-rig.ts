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

function orientAlong(direction: THREE.Vector3, towardCamera: THREE.Vector3): THREE.Quaternion {
  const cardUp = direction.clone().negate().normalize();
  const cardNormal = towardCamera.clone().addScaledVector(cardUp, -towardCamera.dot(cardUp)).normalize();
  const cardRight = new THREE.Vector3().crossVectors(cardUp, cardNormal).normalize();
  return new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(cardRight, cardUp, cardNormal));
}

function elbowPole(side: -1 | 1): THREE.Vector3 {
  return new THREE.Vector3(side, -0.3, -0.8).normalize();
}

export function poseArm(rig: ArmRig, hand: THREE.Vector3, towardCamera: THREE.Vector3): void {
  const toHand = hand.clone().sub(rig.shoulder);
  const minimumReach = Math.abs(UPPER_ARM_UNITS - FOREARM_UNITS) + REACH_MARGIN_UNITS;
  const maximumReach = UPPER_ARM_UNITS + FOREARM_UNITS - REACH_MARGIN_UNITS;
  const reach = Math.min(maximumReach, Math.max(minimumReach, toHand.length()));
  const direction = toHand.normalize();
  const alongReach = (UPPER_ARM_UNITS * UPPER_ARM_UNITS + reach * reach - FOREARM_UNITS * FOREARM_UNITS) / (2 * reach);
  const elbowLift = Math.sqrt(Math.max(0, UPPER_ARM_UNITS * UPPER_ARM_UNITS - alongReach * alongReach));
  const pole = elbowPole(rig.side);
  const poleAcross = pole.addScaledVector(direction, -pole.dot(direction)).normalize();
  const elbow = rig.shoulder.clone().addScaledVector(direction, alongReach).addScaledVector(poleAcross, elbowLift);
  const reachedHand = rig.shoulder.clone().addScaledVector(direction, reach);
  rig.upper.position.copy(rig.shoulder);
  rig.upper.quaternion.copy(orientAlong(elbow.clone().sub(rig.shoulder), towardCamera));
  rig.fore.position.copy(elbow).addScaledVector(towardCamera, FOREARM_LAYER_UNITS);
  rig.fore.quaternion.copy(orientAlong(reachedHand.sub(elbow), towardCamera));
}
