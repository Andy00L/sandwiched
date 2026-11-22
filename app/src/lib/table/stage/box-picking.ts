import * as THREE from "three";
import type { Harness } from "papercraft/harness.js";
import type { ClickTarget } from "../../game/click-intent";
import type { LunchboxModel } from "../pieces/lunchbox";

const CLICK_MAX_MOVE_PX = 6;
const POINTER_CURSOR = "pointer";
const DEFAULT_CURSOR = "";

export function listenForBoxClicks(harness: Harness, boxes: readonly LunchboxModel[], onClick: (target: ClickTarget) => void): () => void {
  const canvas = harness.renderer.domElement;
  const raycaster = new THREE.Raycaster();
  const pointer = new THREE.Vector2();
  const boxNodes = boxes.map((box) => box.node);

  const findBoxUnder = (event: PointerEvent): number | null => {
    const bounds = canvas.getBoundingClientRect();
    if (bounds.width === 0 || bounds.height === 0) return null;
    pointer.set(((event.clientX - bounds.left) / bounds.width) * 2 - 1, -((event.clientY - bounds.top) / bounds.height) * 2 + 1);
    raycaster.setFromCamera(pointer, harness.camera);
    const [nearest] = raycaster.intersectObjects(boxNodes, true);
    if (nearest === undefined) return null;
    const boxIndex = boxNodes.findIndex((node) => {
      let ancestor: THREE.Object3D | null = nearest.object;
      while (ancestor !== null && ancestor !== node) ancestor = ancestor.parent;
      return ancestor === node;
    });
    return boxIndex === -1 ? null : boxIndex;
  };

  const press = { isDown: false, startX: 0, startY: 0 };

  const handlePointerDown = (event: PointerEvent) => {
    if (event.button !== 0) return;
    press.isDown = true;
    press.startX = event.clientX;
    press.startY = event.clientY;
  };

  const handlePointerUp = (event: PointerEvent) => {
    if (!press.isDown) return;
    press.isDown = false;
    if (Math.hypot(event.clientX - press.startX, event.clientY - press.startY) > CLICK_MAX_MOVE_PX) return;
    const boxIndex = findBoxUnder(event);
    onClick(boxIndex === null ? { kind: "ground" } : { kind: "box", box: boxIndex });
  };

  const handlePointerMove = (event: PointerEvent) => {
    canvas.style.cursor = findBoxUnder(event) === null ? DEFAULT_CURSOR : POINTER_CURSOR;
  };

  canvas.addEventListener("pointerdown", handlePointerDown);
  canvas.addEventListener("pointerup", handlePointerUp);
  canvas.addEventListener("pointermove", handlePointerMove);
  return () => {
    canvas.removeEventListener("pointerdown", handlePointerDown);
    canvas.removeEventListener("pointerup", handlePointerUp);
    canvas.removeEventListener("pointermove", handlePointerMove);
    canvas.style.cursor = DEFAULT_CURSOR;
  };
}
