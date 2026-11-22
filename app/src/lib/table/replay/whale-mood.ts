import type { RoundViewState } from "../../game/view-state";
import type { EyePair, WhaleMood } from "../pieces/whale-face";

export const MOOD_HOLD_MS = 1500;
const SMUG_ABOVE_SHARE = 0.8;
const ALERT_ABOVE_SHARE = 0.5;
const PANICKED_ABOVE_SHARE = 0.2;

export function moodForPotShare(potShare: number): Exclude<WhaleMood, "angry"> {
  if (potShare > SMUG_ABOVE_SHARE) return "smug";
  if (potShare > ALERT_ABOVE_SHARE) return "alert";
  if (potShare > PANICKED_ABOVE_SHARE) return "panicked";
  return "despair";
}

export function crowdedGlance(view: RoundViewState, boxCount: number): EyePair {
  const perchedByBox = Array.from({ length: boxCount }, () => 0);
  for (const seat of view.seats) {
    if (seat.role !== "pigeon" || (seat.pigeon.state !== "perched" && seat.pigeon.state !== "stunned")) continue;
    perchedByBox[seat.pigeon.box] = (perchedByBox[seat.pigeon.box] ?? 0) + 1;
  }
  const mostPerched = Math.max(...perchedByBox);
  const crowdedBoxes = perchedByBox.flatMap((count, boxIndex) => (count === mostPerched && count > 0 ? [boxIndex] : []));
  const [crowdedBox] = crowdedBoxes;
  if (crowdedBoxes.length !== 1 || crowdedBox === undefined) return "down";
  return glanceTowardBox(crowdedBox, boxCount);
}

export function glanceTowardBox(boxIndex: number, boxCount: number): EyePair {
  const middleBox = (boxCount - 1) / 2;
  if (boxIndex < middleBox) return "left";
  if (boxIndex > middleBox) return "right";
  return "down";
}

export interface MoodGovernor {
  moodAt(potShare: number, nowMs: number): Exclude<WhaleMood, "angry">;
  reset(): void;
}

export function createMoodGovernor(): MoodGovernor {
  let shownMood: Exclude<WhaleMood, "angry"> = "smug";
  let changedAtMs = Number.NEGATIVE_INFINITY;
  return {
    moodAt(potShare, nowMs) {
      const wanted = moodForPotShare(potShare);
      if (wanted !== shownMood && nowMs - changedAtMs >= MOOD_HOLD_MS) {
        shownMood = wanted;
        changedAtMs = nowMs;
      }
      return shownMood;
    },
    reset() {
      shownMood = "smug";
      changedAtMs = Number.NEGATIVE_INFINITY;
    },
  };
}
