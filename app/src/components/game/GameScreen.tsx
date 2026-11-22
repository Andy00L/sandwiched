"use client";

import { useState } from "react";
import { PlaySheets } from "@/components/sheets/PlaySheets";
import { type GameSession, createGameSession } from "@/lib/game/game-session";

let startedSession: GameSession | null = null;

function mountScene(session: GameSession) {
  return (node: HTMLDivElement | null) => {
    if (node === null || startedSession !== null) return;
    startedSession = session;
    session.start();
  };
}

export function GameScreen() {
  const [session] = useState(() => startedSession ?? createGameSession());
  return (
    <>
      <div ref={mountScene(session)} />
      <PlaySheets controller={session.controller} />
    </>
  );
}
