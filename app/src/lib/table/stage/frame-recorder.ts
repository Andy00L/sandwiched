export interface FrameCost {
  readonly stepMs: number;
  readonly renderMs: number;
}

export interface MainThreadSummary {
  stepMedianMs: number;
  stepP95Ms: number;
  renderMedianMs: number;
  renderP95Ms: number;
}

export interface FrameTimeSummary {
  frames: number;
  medianMs: number;
  lowOnePercentMs: number;
  medianFps: number;
  lowOnePercentFps: number;
  mainThread: MainThreadSummary | null;
}

const LOW_PERCENTILE = 0.99;
const HIGH_PERCENTILE = 0.95;

function percentileOf(sorted: readonly number[], share: number): number {
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * share))] ?? 0;
}

function sortedFinite(samples: readonly number[]): number[] {
  return samples.filter((sample) => Number.isFinite(sample) && sample >= 0).sort((first, second) => first - second);
}

export function summarizeMainThread(costs: readonly FrameCost[]): MainThreadSummary | null {
  const steps = sortedFinite(costs.map((cost) => cost.stepMs));
  const renders = sortedFinite(costs.map((cost) => cost.renderMs));
  if (steps.length === 0 || renders.length === 0) return null;
  return {
    stepMedianMs: percentileOf(steps, 0.5),
    stepP95Ms: percentileOf(steps, HIGH_PERCENTILE),
    renderMedianMs: percentileOf(renders, 0.5),
    renderP95Ms: percentileOf(renders, HIGH_PERCENTILE),
  };
}

export function summarizeFrameGaps(gapsMs: readonly number[], costs: readonly FrameCost[] = []): FrameTimeSummary | null {
  const sorted = sortedFinite(gapsMs).filter((gap) => gap > 0);
  if (sorted.length === 0) return null;
  const medianMs = percentileOf(sorted, 0.5);
  const lowOnePercentMs = percentileOf(sorted, LOW_PERCENTILE);
  return {
    frames: sorted.length,
    medianMs,
    lowOnePercentMs,
    medianFps: 1000 / medianMs,
    lowOnePercentFps: 1000 / lowOnePercentMs,
    mainThread: summarizeMainThread(costs),
  };
}

export function recordFrameTimes(durationMs: number, frameCost: FrameCost | null = null): Promise<FrameTimeSummary | null> {
  return new Promise((resolve) => {
    const stamps: number[] = [];
    const costs: FrameCost[] = [];
    const recordFrame = (now: number) => {
      stamps.push(now);
      if (frameCost) costs.push({ stepMs: frameCost.stepMs, renderMs: frameCost.renderMs });
      const firstStamp = stamps[0] ?? now;
      if (now - firstStamp < durationMs) {
        requestAnimationFrame(recordFrame);
        return;
      }
      const gaps = stamps.slice(1).map((stamp, index) => stamp - (stamps[index] ?? stamp));
      resolve(summarizeFrameGaps(gaps, costs.slice(1)));
    };
    requestAnimationFrame(recordFrame);
  });
}
