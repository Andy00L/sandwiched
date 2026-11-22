import { DEFAULT_LEVELS } from "./mix";
import type { AudioBus, AudioLevels } from "./mix";

export const AUDIO_BUSES: readonly AudioBus[] = ["music", "sounds", "voices"];

let levelsThisVisit: AudioLevels = DEFAULT_LEVELS;

export function readAudioLevels(): AudioLevels {
  return levelsThisVisit;
}

export function keepAudioLevels(levels: AudioLevels): void {
  levelsThisVisit = levels;
}
