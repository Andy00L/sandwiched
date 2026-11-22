import type { RecordedRound, RoundEvent } from "../game/round-events";
import { createAudioEngine } from "./audio-engine";
import type { AudioEngine } from "./audio-engine";
import { keepAudioLevels, readAudioLevels } from "./audio-levels";
import type { AudioLevels } from "./mix";
import type { AudioClock } from "./sound-plan";

type GameAudio = {
  beginRound: (round: RecordedRound) => void;
  hear: (event: RoundEvent) => void;
  hearLidOpened: (boxIndex: number, tick: number) => void;
  atFrame: (nowTick: number, presentTick: number, endTick: number | null) => void;
  toggleMute: () => void;
  followOwnSeat: (readOwnSeat: () => number | null) => void;
};

const ignore = (): void => undefined;

const SILENT_AUDIO: GameAudio = { beginRound: ignore, hear: ignore, hearLidOpened: ignore, atFrame: ignore, toggleMute: ignore, followOwnSeat: ignore };

let installedEngine: AudioEngine | null = null;
let installedAudio: GameAudio = SILENT_AUDIO;

export function readGameAudio(): GameAudio {
  return installedAudio;
}

export function changeAudioLevels(levels: AudioLevels): void {
  keepAudioLevels(levels);
  installedEngine?.setLevels(levels);
}

function wrapEngine(engine: AudioEngine): GameAudio {
  const clock: AudioClock = { nowTick: 0, presentTick: 0, endTick: null };
  return {
    beginRound: engine.beginRound,
    hear: engine.hear,
    hearLidOpened: engine.hearLidOpened,
    atFrame(nowTick, presentTick, endTick) {
      clock.nowTick = nowTick;
      clock.presentTick = presentTick;
      clock.endTick = endTick;
      engine.atFrame(clock);
    },
    toggleMute: () => void engine.toggleMute(),
    followOwnSeat: engine.followOwnSeat,
  };
}

export function installGameAudio(): void {
  if (installedEngine !== null) return;
  const engine = createAudioEngine(readAudioLevels());
  installedEngine = engine;
  installedAudio = wrapEngine(engine);
  const unlockOnGesture = () => void engine.unlock();
  window.addEventListener("pointerdown", unlockOnGesture, true);
  window.addEventListener("keydown", unlockOnGesture, true);
}
