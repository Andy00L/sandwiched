import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parseRecordedRound } from "../../game/round-events";
import { viewStateAt } from "../../game/view-state";
import { createMoodGovernor, crowdedGlance, MOOD_HOLD_MS, moodForPotShare } from "./whale-mood";

const ROUNDS_FOLDER = join(import.meta.dir, "../../../../tests/rounds");
const RECORDED_ROUND_NAMES = ["balanced", "crowd", "duel", "pigeons-feast", "slam-showcase", "whale-keeps"] as const;
const BALANCED = parseRecordedRound(JSON.parse(readFileSync(join(ROUNDS_FOLDER, "balanced.json"), "utf8")));

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

  test("looks toward an end box when every perched pigeon is there", () => {
    const rounds = RECORDED_ROUND_NAMES.flatMap((name) => {
      const parsed = parseRecordedRound(JSON.parse(readFileSync(join(ROUNDS_FOLDER, `${name}.json`), "utf8")));
      return parsed.ok ? [parsed.round] : [];
    });
    expect(rounds).toHaveLength(RECORDED_ROUND_NAMES.length);
    const crowdedEnd = rounds.flatMap((round) => {
      const lastBox = round.boxCount - 1;
      return round.events.flatMap((event) => {
      const perched = viewStateAt(round, event.tick).seats.flatMap((seat) => (seat.role === "pigeon" && seat.pigeon.state === "perched" ? [seat.pigeon.box] : []));
      const [firstBox] = perched;
      const isOneEndBox = perched.length >= 2 && (firstBox === 0 || firstBox === lastBox) && perched.every((box) => box === firstBox);
        return isOneEndBox && firstBox !== undefined ? [{ round, tick: event.tick, box: firstBox }] : [];
      });
    });
    expect(crowdedEnd.length).toBeGreaterThan(0);
    for (const moment of crowdedEnd) {
      expect(crowdedGlance(viewStateAt(moment.round, moment.tick), moment.round.boxCount)).toBe(moment.box === 0 ? "left" : "right");
    }
  });
});
