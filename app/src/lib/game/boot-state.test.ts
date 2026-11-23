import { expect, test } from "bun:test";
import { type BootState, nextBootState } from "./boot-state";

const LOADING: BootState = { kind: "loading" };

test("the second drawn frame lifts the curtain", () => {
  expect(nextBootState(LOADING, { kind: "drawn" })).toEqual({ kind: "ready" });
});

test("a scene that fails while loading shows its reason", () => {
  expect(nextBootState(LOADING, { kind: "failed", reason: "webgl lost" })).toEqual({ kind: "failed", reason: "webgl lost" });
});

test("a park that draws after the deadline fired still lifts the curtain", () => {
  const failed = nextBootState(LOADING, { kind: "failed", reason: "no frame in 20 s" });
  expect(nextBootState(failed, { kind: "drawn" })).toEqual({ kind: "ready" });
});

test("a failure after the park drew does not bring the curtain back", () => {
  const ready = nextBootState(LOADING, { kind: "drawn" });
  expect(nextBootState(ready, { kind: "failed", reason: "late deadline" })).toBe(ready);
});
