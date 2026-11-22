import { afterEach, beforeEach, describe, expect, jest, test } from "bun:test";
import { advanceFakeTime } from "../../../tests/fake-time";
import { type Result, pollUntil } from "./result";

beforeEach(() => jest.useFakeTimers());
afterEach(() => jest.useRealTimers());

describe("pollUntil", () => {
  test("gives up at the deadline even when a probe never answers", async () => {
    const outcome: { settled: Result<number> | null } = { settled: null };
    void pollUntil("hung probe", () => new Promise<number | null>(() => undefined), 1_000, 100).then((polled) => {
      outcome.settled = polled;
    });
    await advanceFakeTime(1_100);
    expect(outcome.settled).toEqual({ ok: false, reason: "[pollUntil] hung probe not observed within 1000 ms" });
  });

  test("returns the first value a probe observes", async () => {
    let probeCount = 0;
    const outcome: { settled: Result<number> | null } = { settled: null };
    void pollUntil("third probe", async () => (++probeCount === 3 ? 42 : null), 1_000, 100).then((polled) => {
      outcome.settled = polled;
    });
    await advanceFakeTime(300);
    expect(outcome.settled).toEqual({ ok: true, value: 42 });
  });
});
