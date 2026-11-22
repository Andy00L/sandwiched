export interface FrameTimeSummary {
  frames: number;
  medianMs: number;
  lowOnePercentMs: number;
  medianFps: number;
  lowOnePercentFps: number;
}

const LOW_PERCENTILE = 0.99;

export function summarizeFrameGaps(gapsMs: readonly number[]): FrameTimeSummary | null {
  const validGaps = gapsMs.filter((gap) => Number.isFinite(gap) && gap > 0);
  if (validGaps.length === 0) return null;
  const sorted = [...validGaps].sort((first, second) => first - second);
  const medianMs = sorted[Math.floor(sorted.length / 2)] ?? 0;
  const lowOnePercentMs = sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * LOW_PERCENTILE))] ?? 0;
  return {
    frames: sorted.length,
    medianMs,
    lowOnePercentMs,
    medianFps: 1000 / medianMs,
    lowOnePercentFps: 1000 / lowOnePercentMs,
  };
}

export function recordFrameTimes(durationMs: number): Promise<FrameTimeSummary | null> {
  return new Promise((resolve) => {
    const stamps: number[] = [];
    const recordFrame = (now: number) => {
      stamps.push(now);
      const firstStamp = stamps[0] ?? now;
      if (now - firstStamp < durationMs) {
        requestAnimationFrame(recordFrame);
        return;
      }
      const gaps = stamps.slice(1).map((stamp, index) => stamp - (stamps[index] ?? stamp));
      resolve(summarizeFrameGaps(gaps));
    };
    requestAnimationFrame(recordFrame);
  });
}
