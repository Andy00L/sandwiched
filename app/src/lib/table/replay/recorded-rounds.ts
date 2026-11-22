import { parseRecordedRound } from "../../game/round-events";
import type { RoundParseResult } from "../../game/round-events";

const ROUND_FILES = {
  duel: () => import("../../../../tests/rounds/duel.json"),
  balanced: () => import("../../../../tests/rounds/balanced.json"),
  crowd: () => import("../../../../tests/rounds/crowd.json"),
  "whale-keeps": () => import("../../../../tests/rounds/whale-keeps.json"),
  "pigeons-feast": () => import("../../../../tests/rounds/pigeons-feast.json"),
  "slam-showcase": () => import("../../../../tests/rounds/slam-showcase.json"),
} as const;

type RoundName = keyof typeof ROUND_FILES;

function isRoundName(name: string): name is RoundName {
  return Object.hasOwn(ROUND_FILES, name);
}

export async function loadRecordedRound(name: string): Promise<RoundParseResult> {
  if (!isRoundName(name)) return { ok: false, reason: `no recorded round named "${name}" (${Object.keys(ROUND_FILES).join(", ")})` };
  return ROUND_FILES[name]()
    .then((module): RoundParseResult => parseRecordedRound(module.default))
    .catch((error: unknown): RoundParseResult => ({ ok: false, reason: `loading ${name} failed: ${String(error)}` }));
}
