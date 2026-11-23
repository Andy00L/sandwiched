"use client";

import dynamic from "next/dynamic";
import { BootCurtain } from "./BootCurtain";

const GameScreen = dynamic(() => import("./GameScreen").then((loaded) => loaded.GameScreen), { ssr: false });

export function GameScreenLoader() {
  return (
    <>
      <GameScreen />
      <BootCurtain />
    </>
  );
}
