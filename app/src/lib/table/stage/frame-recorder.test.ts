import { describe, expect, test } from "bun:test";
import { summarizeFrameGaps, summarizeMainThread } from "./frame-recorder";

describe("summarizeFrameGaps", () => {
  test("reports the median and the 1% low of the frame gaps", () => {
    const gaps = [...Array(99).fill(16.7), 50];
    const summary = summarizeFrameGaps(gaps);
    expect(summary?.frames).toBe(100);
    expect(summary?.medianMs).toBeCloseTo(16.7);
    expect(summary?.lowOnePercentMs).toBe(50);
    expect(summary?.lowOnePercentFps).toBeCloseTo(20);
  });

  test("ignores gaps that are not positive and returns null when none remain", () => {
    expect(summarizeFrameGaps([0, -3, Number.NaN])).toBeNull();
  });

  test("summarizes the main-thread cost of step and render, or null when the harness gave none", () => {
    const costs = Array.from({ length: 100 }, (_unused, index) => ({ stepMs: index < 95 ? 1 : 9, renderMs: 3 }));
    expect(summarizeMainThread(costs)).toEqual({ stepMedianMs: 1, stepP95Ms: 9, renderMedianMs: 3, renderP95Ms: 3 });
    expect(summarizeFrameGaps([16.7])?.mainThread).toBeNull();
  });
});
