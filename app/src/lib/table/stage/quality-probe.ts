import type { Harness } from "papercraft/harness.js";
import { recordFrameTimes } from "./frame-recorder";

type QualityTier = "high" | "medium";

const QUALITY_STORAGE_KEY = "sandwich.qualityTier";
const RENDER_SCALE_BY_TIER: Record<QualityTier, number> = { high: 1, medium: 0.67 };
const PROBE_DELAY_MS = 2500;
const PROBE_DURATION_MS = 2000;
const HIGH_TIER_MEDIAN_FRAME_MS = 18;

function isQualityTier(value: string | null): value is QualityTier {
  return value === "high" || value === "medium";
}

function readStoredTier(): QualityTier | null {
  try {
    const stored = localStorage.getItem(QUALITY_STORAGE_KEY);
    return isQualityTier(stored) ? stored : null;
  } catch {
    return null;
  }
}

function storeTier(tier: QualityTier): void {
  try {
    localStorage.setItem(QUALITY_STORAGE_KEY, tier);
  } catch {
    console.info(`[storeTier] storage unavailable, the ${tier} tier lasts for this visit`);
  }
}

function isTierForcedOrMeasured(): boolean {
  const query = new URLSearchParams(location.search);
  return query.has("scale") || query.has("fps") || navigator.webdriver;
}

export function storedRenderScale(): number {
  const tier = readStoredTier();
  return tier && !isTierForcedOrMeasured() ? RENDER_SCALE_BY_TIER[tier] : RENDER_SCALE_BY_TIER.high;
}

export function probeQualityTier(harness: Harness): void {
  if (isTierForcedOrMeasured() || readStoredTier()) return;
  window.setTimeout(() => {
    void recordFrameTimes(PROBE_DURATION_MS).then((summary) => {
      if (!summary) return;
      const tier: QualityTier = summary.medianMs > HIGH_TIER_MEDIAN_FRAME_MS ? "medium" : "high";
      console.info(`[probeQualityTier] median ${summary.medianMs.toFixed(1)} ms over ${summary.frames} frames: ${tier} tier`);
      storeTier(tier);
      harness.setRenderScale(RENDER_SCALE_BY_TIER[tier]);
    });
  }, PROBE_DELAY_MS);
}
