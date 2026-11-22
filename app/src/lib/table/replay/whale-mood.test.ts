import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parseRecordedRound } from "../../game/round-events";
import { viewStateAt } from "../../game/view-state";
import { createMoodGovernor, crowdedGlance, MOOD_HOLD_MS, moodForPotShare } from "./whale-mood";

const BALANCED = parseRecordedRound(JSON.parse(readFileSync(join(import.meta.dir, "../../../../tests/rounds/balanced.json"), "utf8")));

describe("whale mood", () => {
  test("follows the pot thresholds of plan/06", () => {
    expect([0.95, 0.81, 0.8, 0.51, 0.5, 0.21, 0.2, 0].map(moodForPotShare)).toEqual([
      "smug",
      "smug",
      "alert",
      "alert",
      "panicked",
      "panicked",
      "despair",
      "despair",
    ]);
  });

  test("changes at most once per hold window", () => {
    const governor = createMoodGovernor();
    expect(governor.moodAt(0.6, 0)).toBe("alert");
    expect(governor.moodAt(0.1, 500)).toBe("alert");
    expect(governor.moodAt(0.1, MOOD_HOLD_MS)).toBe("despair");
  });

  test("the glance never depends on where the sandwich is", () => {
    expect(BALANCED.ok).toBe(true);
    if (!BALANCED.ok) return;
    const round = BALANCED.round;
    for (const event of round.events) {
      const view = viewStateAt(round, event.tick);
      const elsewhere = { ...view, sandwichBox: view.sandwichBox === null ? 0 : (view.sandwichBox + 1) % round.boxCount };
      expect(crowdedGlance(elsewhere, round.boxCount)).toBe(crowdedGlance(view, round.boxCount));
    }
  });

  test("looks toward the box with the most pigeons", () => {
    expect(BALANCED.ok).toBe(true);
    if (!BALANCED.ok) return;
    const round = BALANCED.round;
    const crowdedRight = round.events.find((event) => {
      const view = viewStateAt(round, event.tick);
      const onRightBox = view.seats.filter((seat) => seat.pigeon.state === "perched" && seat.pigeon.box === 2).length;
      return onRightBox >= 3 && view.seats.every((seat) => seat.pigeon.state !== "perched" || seat.pigeon.box === 2);
    });
    expect(crowdedRight).toBeDefined();
    if (!crowdedRight) return;
    expect(crowdedGlance(viewStateAt(round, crowdedRight.tick), round.boxCount)).toBe("right");
  });
});
