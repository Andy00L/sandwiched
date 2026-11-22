import * as THREE from "three";
import type { Harness } from "papercraft/harness.js";

const FLIPPER_SHADOW_HALF_LENGTH_UNITS = 1.7;
const FLIPPER_SHADOW_HALF_WIDTH_UNITS = 1.15;
const FLIPPER_SHADOW_MIN_HEIGHT_UNITS = 0.35;

export interface FlipperShadow {
  show(contactInDeck: THREE.Vector3, heightUnits: number): void;
  hide(): void;
}

export function buildFlipperShadow(harness: Harness, deck: THREE.Object3D): FlipperShadow {
  const outline = new THREE.Shape().absellipse(0, 0, FLIPPER_SHADOW_HALF_LENGTH_UNITS, FLIPPER_SHADOW_HALF_WIDTH_UNITS, 0, Math.PI * 2, false, 0);
  const caster = new THREE.Mesh(new THREE.ShapeGeometry(outline, 24), new THREE.MeshBasicMaterial({ side: THREE.DoubleSide }));
  caster.name = "flipper shadow caster";
  caster.rotation.x = -Math.PI / 2;
  caster.visible = false;
  harness.castShadowOnly(caster);
  deck.add(caster);
  const deckRotationInverse = new THREE.Quaternion();
  const towardLightInDeck = new THREE.Vector3();

  return {
    show(contactInDeck, heightUnits) {
      const keyLight = harness.keyLight;
      if (!keyLight) return;
      deck.getWorldQuaternion(deckRotationInverse).invert();
      towardLightInDeck.subVectors(keyLight.position, keyLight.target.position).normalize().applyQuaternion(deckRotationInverse);
      caster.position.copy(contactInDeck).addScaledVector(towardLightInDeck, Math.max(FLIPPER_SHADOW_MIN_HEIGHT_UNITS, heightUnits));
      caster.visible = true;
    },
    hide() {
      caster.visible = false;
    },
  };
}
