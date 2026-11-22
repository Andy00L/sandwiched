import { PaperSound } from "papercraft/lib/paper-sound.js";
import { fetchWithTimeout } from "../chain/rpc";
import type { RecordedRound, RoundEvent } from "../game/round-events";
import { HALL_WET, PIANO_SAMPLE_RATE, buildHallImpulse, notePlayback, synthFeltPianoNote } from "./felt-piano";
import { DEFAULT_LEVELS, DUCK_GAIN, DUCK_HOLD_S, DUCK_ATTACK_S, MUSIC_FADE_IN_S, MUSIC_GAIN, MUTE_FADE_S, PAN_SCALE, VOICE_CUT_FADE_S, duckTimeConstantS, voiceGainFor } from "./mix";
import type { AudioBus, AudioLevels } from "./mix";
import { renderPaperRecipe } from "./paper-synth";
import { createSoundPlanner } from "./sound-plan";
import type { AudioClock, HeardLid, PlannedSound } from "./sound-plan";
import { VOICE_FILES } from "./voice-files.generated";
import { FINAL_STRETCH_S, createRewardNotes, listRewardPitches, listWaltzNotes, listWaltzPitches } from "./waltz";
import type { WaltzNote } from "./waltz";

const SCHEDULE_EVERY_MS = 60;
const LOOKAHEAD_S = 1.2;
const START_LEAD_S = 0.01;
const VOICE_FETCH_TIMEOUT_MS = 8000;
const PIANO_LOWPASS_Q = 0.5;
const MUSIC_START_DELAY_S = 0.1;

export type AudioEngine = {
  unlock: () => boolean;
  beginRound: (round: RecordedRound) => void;
  hear: (event: RoundEvent) => void;
  hearLidOpened: (boxIndex: number, tick: number) => void;
  atFrame: (clock: AudioClock) => void;
  setLevels: (levels: AudioLevels) => void;
  toggleMute: () => boolean;
  followOwnSeat: (readOwnSeat: () => number | null) => void;
};

type Graph = {
  context: AudioContext;
  buses: Record<AudioBus, GainNode>;
  paperDuck: GainNode;
  voiceDuck: GainNode;
  musicDuck: GainNode;
  musicFade: GainNode;
};

type PlayingVoice = { source: AudioBufferSourceNode; gain: GainNode };

function buildGraph(kit: PaperSound): Graph | null {
  const context = kit.unlock();
  const chain = kit.chain;
  if (chain === undefined) return null;
  const gainNode = (value: number) => {
    const node = context.createGain();
    node.gain.value = value;
    return node;
  };
  const buses: Record<AudioBus, GainNode> = { music: gainNode(0), sounds: gainNode(0), voices: gainNode(0) };
  const paperDuck = gainNode(1);
  const voiceDuck = gainNode(1);
  const musicDuck = gainNode(1);
  const musicFade = gainNode(0);
  paperDuck.connect(buses.sounds);
  voiceDuck.connect(buses.voices);
  buses.sounds.connect(chain.bus);
  buses.voices.connect(chain.bus);
  const hall = context.createConvolver();
  hall.normalize = false;
  const [hallLeft, hallRight] = buildHallImpulse(context.sampleRate);
  const impulse = context.createBuffer(2, hallLeft.length, context.sampleRate);
  impulse.copyToChannel(hallLeft, 0);
  impulse.copyToChannel(hallRight, 1);
  hall.buffer = impulse;
  const hallSend = gainNode(HALL_WET);
  musicDuck.connect(musicFade);
  musicFade.connect(buses.music);
  musicFade.connect(hallSend);
  hallSend.connect(hall);
  hall.connect(buses.music);
  buses.music.connect(context.destination);
  return { context, buses, paperDuck, voiceDuck, musicDuck, musicFade };
}

export function createAudioEngine(initialLevels: AudioLevels = DEFAULT_LEVELS): AudioEngine {
  const kit = new PaperSound();
  let graph: Graph | null = null;
  let levels = initialLevels;
  let isMuted = false;
  let readOwnSeat: () => number | null = () => null;
  const planner = createSoundPlanner({ files: VOICE_FILES, readOwnSeat: () => readOwnSeat() });
  const rewards = createRewardNotes();
  const voiceBuffers = new Map<string, AudioBuffer>();
  const noteBuffers = new Map<number, AudioBuffer>();
  const playingVoices = new Map<number, PlayingVoice>();
  const scorePitches = listWaltzPitches();
  const pitchesToWarm = [...scorePitches, ...listRewardPitches().filter((midi) => !scorePitches.includes(midi))];
  let heardEvents: RoundEvent[] = [];
  let heardLids: HeardLid[] = [];
  let tickMs = 0;
  let frameOffsetS = 0;
  let musicStartAt: number | null = null;
  let musicScheduledUntil = 0;
  let finalStretchFrom = Number.POSITIVE_INFINITY;
  let finalStretchUntil = Number.NEGATIVE_INFINITY;

  const isRunning = (): boolean => graph !== null && graph.context.state === "running";

  function applyLevels(fadeS: number): void {
    if (graph === null) return;
    const now = graph.context.currentTime;
    for (const bus of ["music", "sounds", "voices"] as const) {
      const target = isMuted ? 0 : bus === "music" ? levels[bus] * MUSIC_GAIN : levels[bus];
      graph.buses[bus].gain.setTargetAtTime(target, now, fadeS);
    }
  }

  function loadVoiceFiles(context: AudioContext): void {
    for (const file of VOICE_FILES) {
      void fetchWithTimeout(file.url, {}, VOICE_FETCH_TIMEOUT_MS)
        .then((response) => (response.ok ? response.arrayBuffer() : Promise.reject(new Error(`HTTP ${response.status}`))))
        .then((bytes) => context.decodeAudioData(bytes))
        .then(
          (buffer) => voiceBuffers.set(file.id, buffer),
          (error: unknown) => console.warn(`[loadVoiceFiles] ${file.id}: ${String(error)}`),
        );
    }
  }

  function startAt(atS: number): number {
    const now = graph?.context.currentTime ?? 0;
    return Math.max(now + START_LEAD_S, atS + frameOffsetS);
  }

  function playPaper(sound: Extract<PlannedSound, { kind: "paper" }>, active: Graph): void {
    const { context } = active;
    const rendered = renderPaperRecipe(sound.recipe, context.sampleRate);
    const buffer = context.createBuffer(1, rendered.samples.length, context.sampleRate);
    buffer.copyToChannel(rendered.samples, 0);
    const source = context.createBufferSource();
    source.buffer = buffer;
    const gain = context.createGain();
    gain.gain.value = rendered.level * sound.gain;
    const panner = context.createStereoPanner();
    panner.pan.value = sound.pan * PAN_SCALE;
    source.connect(gain).connect(panner).connect(sound.isSlam ? active.buses.sounds : active.paperDuck);
    source.start(startAt(sound.atS));
  }

  function playVoice(sound: Extract<PlannedSound, { kind: "voice" }>, active: Graph): void {
    const { context } = active;
    const at = startAt(sound.atS);
    for (const playId of sound.play.cuts) {
      const playing = playingVoices.get(playId);
      if (playing === undefined) continue;
      playing.gain.gain.setTargetAtTime(0, at, VOICE_CUT_FADE_S / 3);
      playing.source.stop(at + VOICE_CUT_FADE_S * 3);
    }
    const buffer = voiceBuffers.get(sound.play.file.id);
    if (buffer === undefined) return;
    const source = context.createBufferSource();
    source.buffer = buffer;
    source.playbackRate.value = sound.play.rate;
    const gain = context.createGain();
    gain.gain.value = voiceGainFor(sound.play.file);
    const panner = context.createStereoPanner();
    panner.pan.value = sound.pan * PAN_SCALE;
    source.connect(gain).connect(panner).connect(sound.play.isUnducked ? active.buses.voices : active.voiceDuck);
    source.addEventListener("ended", () => playingVoices.delete(sound.play.playId));
    playingVoices.set(sound.play.playId, { source, gain });
    source.start(at);
  }

  function duckAt(atS: number, active: Graph): void {
    const at = startAt(atS);
    for (const node of [active.paperDuck, active.voiceDuck, active.musicDuck]) {
      node.gain.cancelScheduledValues(at);
      node.gain.setTargetAtTime(DUCK_GAIN, at, duckTimeConstantS(true));
      node.gain.setTargetAtTime(1, at + DUCK_ATTACK_S + DUCK_HOLD_S, duckTimeConstantS(false));
    }
  }

  function playNote(note: WaltzNote, at: number, active: Graph): void {
    const buffer = noteBuffers.get(note.midi);
    if (buffer === undefined) return;
    const { context } = active;
    const playback = notePlayback(note.midi, note.velocity);
    const source = context.createBufferSource();
    source.buffer = buffer;
    const lowpass = context.createBiquadFilter();
    lowpass.type = "lowpass";
    lowpass.frequency.value = playback.lowpassHz;
    lowpass.Q.value = PIANO_LOWPASS_Q;
    const gain = context.createGain();
    gain.gain.value = playback.gain;
    const panner = context.createStereoPanner();
    panner.pan.value = playback.pan;
    source.connect(lowpass).connect(gain).connect(panner).connect(active.musicDuck);
    source.start(Math.max(context.currentTime + START_LEAD_S, at));
  }

  function playReward(sound: Extract<PlannedSound, { kind: "reward" }>, active: Graph): void {
    if (musicStartAt === null) return;
    const at = startAt(sound.atS);
    const notes = rewards.pick(sound.register, sound.noteCount, at, at - musicStartAt, (midi) => noteBuffers.has(midi));
    for (const note of notes) playNote(note, note.atS, active);
  }

  function playPlanned(sound: PlannedSound): void {
    if (graph === null || !isRunning()) return;
    if (sound.kind === "paper") playPaper(sound, graph);
    else if (sound.kind === "voice") playVoice(sound, graph);
    else if (sound.kind === "reward") playReward(sound, graph);
    else duckAt(sound.atS, graph);
  }

  function warmNextPitch(active: Graph): void {
    const midi = pitchesToWarm.find((candidate) => !noteBuffers.has(candidate));
    if (midi === undefined) return;
    const samples = synthFeltPianoNote(midi, PIANO_SAMPLE_RATE);
    const buffer = active.context.createBuffer(1, samples.length, PIANO_SAMPLE_RATE);
    buffer.copyToChannel(samples, 0);
    noteBuffers.set(midi, buffer);
  }

  function startMusicWhenWarm(active: Graph): void {
    if (musicStartAt !== null) return;
    const isScoreWarm = scorePitches.every((midi) => noteBuffers.has(midi));
    if (!isScoreWarm) return;
    const now = active.context.currentTime;
    musicStartAt = now + MUSIC_START_DELAY_S;
    musicScheduledUntil = 0;
    active.musicFade.gain.setValueAtTime(0, now);
    active.musicFade.gain.linearRampToValueAtTime(1, musicStartAt + MUSIC_FADE_IN_S);
  }

  function scheduleMusic(active: Graph): void {
    if (musicStartAt === null) return;
    const startedAt = musicStartAt;
    const untilS = active.context.currentTime + LOOKAHEAD_S - startedAt;
    if (untilS <= musicScheduledUntil) return;
    const isFinalStretchAt = (musicS: number) => startedAt + musicS >= finalStretchFrom && startedAt + musicS < finalStretchUntil;
    for (const note of listWaltzNotes(musicScheduledUntil, untilS, isFinalStretchAt)) playNote(note, startedAt + note.atS, active);
    musicScheduledUntil = untilS;
  }

  function followClock(clock: AudioClock, now: number): void {
    frameOffsetS = now - (clock.nowTick * tickMs) / 1000;
    const secondsLeft = clock.endTick === null ? null : ((clock.endTick - clock.presentTick) * tickMs) / 1000;
    finalStretchFrom = secondsLeft === null ? Number.POSITIVE_INFINITY : now + secondsLeft - FINAL_STRETCH_S;
    finalStretchUntil = secondsLeft === null ? Number.NEGATIVE_INFINITY : now + secondsLeft;
  }

  function tickScheduler(): void {
    if (graph === null || !isRunning()) return;
    warmNextPitch(graph);
    startMusicWhenWarm(graph);
    scheduleMusic(graph);
  }

  return {
    unlock() {
      if (graph === null) {
        graph = buildGraph(kit);
        if (graph === null) {
          console.warn("[unlock] the paper sound kit built no chain");
          return false;
        }
        applyLevels(MUTE_FADE_S);
        loadVoiceFiles(graph.context);
        setInterval(tickScheduler, SCHEDULE_EVERY_MS);
      } else if (graph.context.state === "suspended") {
        void graph.context.resume();
      }
      return true;
    },
    beginRound(round) {
      tickMs = round.tickMs;
      heardEvents = [];
      heardLids = [];
      planner.beginRound(round);
    },
    hear(event) {
      heardEvents.push(event);
    },
    hearLidOpened(boxIndex, tick) {
      heardLids.push({ boxIndex, tick });
    },
    atFrame(clock) {
      const events = heardEvents;
      const lids = heardLids;
      heardEvents = [];
      heardLids = [];
      if (tickMs <= 0) return;
      if (graph !== null) followClock(clock, graph.context.currentTime);
      planner.planFrame(clock, events, lids, playPlanned);
    },
    setLevels(next) {
      levels = next;
      applyLevels(MUTE_FADE_S);
    },
    toggleMute() {
      isMuted = !isMuted;
      applyLevels(MUTE_FADE_S);
      return isMuted;
    },
    followOwnSeat(next) {
      readOwnSeat = next;
    },
  };
}
