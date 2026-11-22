"use client";

let hasMountedScene = false;

function mountScene(node: HTMLDivElement | null) {
  if (!node || hasMountedScene) return;
  hasMountedScene = true;
  void import("@/lib/table/scene").then(({ buildTableScene }) => buildTableScene());
}

export function TableStage() {
  return <div ref={mountScene} />;
}
