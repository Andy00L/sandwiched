import { DEFAULT_LEVELS } from "./mix";
import type { AudioBus, AudioLevels } from "./mix";

const LEVELS_STORAGE_KEY = "sandwich.audioLevels";

export const AUDIO_BUSES: readonly AudioBus[] = ["music", "sounds", "voices"];

function readLevel(stored: unknown, bus: AudioBus): number {
  if (typeof stored !== "object" || stored === null || !(bus in stored)) return DEFAULT_LEVELS[bus];
  const value: unknown = Object.getOwnPropertyDescriptor(stored, bus)?.value;
  return typeof value === "number" && Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : DEFAULT_LEVELS[bus];
}

export function parseAudioLevels(text: string | null): AudioLevels {
  if (text === null) return DEFAULT_LEVELS;
  try {
    const stored: unknown = JSON.parse(text);
    return { music: readLevel(stored, "music"), sounds: readLevel(stored, "sounds"), voices: readLevel(stored, "voices") };
  } catch {
    return DEFAULT_LEVELS;
  }
}

export function readAudioLevels(): AudioLevels {
  try {
    return parseAudioLevels(localStorage.getItem(LEVELS_STORAGE_KEY));
  } catch {
    return DEFAULT_LEVELS;
  }
}

export function storeAudioLevels(levels: AudioLevels): void {
  try {
    localStorage.setItem(LEVELS_STORAGE_KEY, JSON.stringify(levels));
  } catch {
    console.info("[storeAudioLevels] storage unavailable, the levels last for this visit");
  }
}
