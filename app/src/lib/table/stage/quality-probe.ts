import type { Harness } from "papercraft/harness.js";
import { recordFrameTimes } from "./frame-recorder";

type QualityTier = "high" | "medium" | "low";

export interface QualitySettings {
  renderScale: number;
  shadowMapSize: number;
  dofTaps: number;
  blockerSamples: number;
  filterSamples: number;
}

const QUALITY_STORAGE_KEY = "sandwich.qualityTier";
const QUALITY_BY_TIER: Record<QualityTier, QualitySettings> = {
  high: { renderScale: 1, shadowMapSize: 4096, dofTaps: 40, blockerSamples: 16, filterSamples: 24 },
  medium: { renderScale: 0.8, shadowMapSize: 2048, dofTaps: 24, blockerSamples: 8, filterSamples: 16 },
  low: { renderScale: 0.6, shadowMapSize: 2048, dofTaps: 24, blockerSamples: 8, filterSamples: 16 },
};
const LOWER_TIER: Record<QualityTier, QualityTier | null> = { high: "medium", medium: "low", low: null };
const PROBE_DELAY_MS = 2500;
const PROBE_DURATION_MS = 2000;
const PROBE_SETTLE_MS = 500;
const SMOOTH_MEDIAN_FRAME_MS = 18;

function isQualityTier(value: string | null): value is QualityTier {
  return value === "high" || value === "medium" || value === "low";
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

function requestedTier(): QualityTier | null {
  const requested = new URLSearchParams(location.search).get("tier");
  return isQualityTier(requested) ? requested : null;
}

function isTierForcedOrMeasured(): boolean {
  const query = new URLSearchParams(location.search);
  return query.has("scale") || query.has("fps") || query.has("tier") || navigator.webdriver;
}

export function storedQuality(): QualitySettings {
  const tier = requestedTier() ?? (isTierForcedOrMeasured() ? null : readStoredTier());
  return QUALITY_BY_TIER[tier ?? "high"];
}

function probeTier(harness: Harness, tier: QualityTier, delayMs: number): void {
  window.setTimeout(() => {
    void recordFrameTimes(PROBE_DURATION_MS).then((summary) => {
      if (!summary) return;
      const lowerTier = summary.medianMs > SMOOTH_MEDIAN_FRAME_MS ? LOWER_TIER[tier] : null;
      console.info(`[probeTier] ${tier}: median ${summary.medianMs.toFixed(1)} ms over ${summary.frames} frames${lowerTier ? `, trying ${lowerTier}` : ""}`);
      if (!lowerTier) {
        storeTier(tier);
        return;
      }
      harness.setQuality(QUALITY_BY_TIER[lowerTier]);
      probeTier(harness, lowerTier, PROBE_SETTLE_MS);
    });
  }, delayMs);
}

export function probeQualityTier(harness: Harness): void {
  if (isTierForcedOrMeasured() || readStoredTier()) return;
  probeTier(harness, "high", PROBE_DELAY_MS);
}
