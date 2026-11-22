"use client";

import dynamic from "next/dynamic";

const GameScreen = dynamic(() => import("./GameScreen").then((loaded) => loaded.GameScreen), { ssr: false });

export function GameScreenLoader() {
  return <GameScreen />;
}
