import * as THREE from "three";
import type { Harness } from "papercraft/harness.js";
import type { ClickTarget } from "../../game/click-intent";
import type { LunchboxModel } from "../pieces/lunchbox";

const CLICK_MAX_MOVE_PX = 6;
const POINTER_CURSOR = "pointer";
const DEFAULT_CURSOR = "";

export type PickableSignpost = { node: THREE.Object3D; canPick: () => boolean; onPick: () => void };

export type TableClickPorts = { boxes: readonly LunchboxModel[]; signposts: readonly PickableSignpost[]; onClick: (target: ClickTarget) => void };

export function listenForTableClicks(harness: Harness, ports: TableClickPorts): () => void {
  const canvas = harness.renderer.domElement;
  const raycaster = new THREE.Raycaster();
  const pointer = new THREE.Vector2();
  const boxNodes = ports.boxes.map((box) => box.node);
  const signpostNodes = ports.signposts.map((signpost) => signpost.node);

  const findNodeUnder = (event: PointerEvent, nodes: readonly THREE.Object3D[]): number | null => {
    const bounds = canvas.getBoundingClientRect();
    if (bounds.width === 0 || bounds.height === 0 || nodes.length === 0) return null;
    pointer.set(((event.clientX - bounds.left) / bounds.width) * 2 - 1, -((event.clientY - bounds.top) / bounds.height) * 2 + 1);
    raycaster.setFromCamera(pointer, harness.camera);
    const [nearest] = raycaster.intersectObjects([...nodes], true);
    if (nearest === undefined) return null;
    const nodeIndex = nodes.findIndex((node) => {
      let ancestor: THREE.Object3D | null = nearest.object;
      while (ancestor !== null && ancestor !== node) ancestor = ancestor.parent;
      return ancestor === node;
    });
    return nodeIndex === -1 ? null : nodeIndex;
  };

  const findBoxUnder = (event: PointerEvent): number | null => findNodeUnder(event, boxNodes);

  const findSignpostUnder = (event: PointerEvent): PickableSignpost | null => {
    const signpostIndex = findNodeUnder(event, signpostNodes);
    const signpost = signpostIndex === null ? undefined : ports.signposts[signpostIndex];
    return signpost !== undefined && signpost.canPick() ? signpost : null;
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
    const signpost = findSignpostUnder(event);
    if (signpost !== null) {
      signpost.onPick();
      return;
    }
    const boxIndex = findBoxUnder(event);
    ports.onClick(boxIndex === null ? { kind: "ground" } : { kind: "box", box: boxIndex });
  };

  const handlePointerMove = (event: PointerEvent) => {
    canvas.style.cursor = findSignpostUnder(event) === null && findBoxUnder(event) === null ? DEFAULT_CURSOR : POINTER_CURSOR;
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
