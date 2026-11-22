import { hashSeed } from "papercraft/lib/paper-sound.js";
import type { HandRaisedEvent, RecordedRound, RoundEvent } from "../game/round-events";
import { hitStopMs } from "../table/motion/impact";
import { PECK_STRIKE_MS, REVEAL_LID_STAGGER_S, WHISTLE_S } from "../table/motion/motion-tokens";
import { createPaperGate, createPeckTickLimiter } from "./paper-gate";
import type { FlapRequest, PaperGate, PeckTickLimiter, ResolvedFlap } from "./paper-gate";
import { STEP_LENGTH_S, THUMP_LENGTH_S, voicingForTone } from "./paper-synth";
import type { FlapTone, PaperRecipe } from "./paper-synth";
import { createVoiceGate, seededUnit } from "./voice-gate";
import type { VoiceGate, VoicePlay } from "./voice-gate";
import type { VoiceCharacter, VoiceFile, VoiceNeed } from "./voices";

const STALE_S = 0.25;
const TIMER_TICK_SECONDS = 5;
export const PATTER_SPAN_S = 0.4;
export const PATTER_START_S = 0.35;
const WHALE_REWARD_SPACING_S = 0.25;

const PECK_STRIKE_S = PECK_STRIKE_MS / 1000;
const FOLD_ONTO_BACK_DELAY_S = 0.06;
const OW_DELAY_S = 0.05;
const GULP_DELAY_S = 0.25;
const DIZZY_DELAY_S = 0.1;
const FLATTENED_VOICE_DELAYS_S = [0.06, 0.16] as const;
const PATTER_MIN_TICKS = 6;
const PATTER_EXTRA_TICKS = 5;
const PATTER_GAIN = 0.6;
const PATTER_FALLOFF = 0.8;
const WHAT_DELAY_S = 0.3;
const FLIPPER_SHAKE_DELAY_S = 0.75;
const BIG_HIT_COUNT = 3;
const HUM_DELAY_S = 0.3;
const DRAW_NOTE_DELAY_S = 0.2;
const REACTION_DELAY_S = 0.35;
const WHALE_REACTION_AFTER_S = 0.55;
const BOX_PAN_SPREAD = 0.6;
const SIZE = { slam: 1, whoosh: 0.6, flattened: 0.4, lid: 0.35, knock: 0.3, pigeon: 0.25, timer: 0.1, tick: 0.08 } as const;

export type LevelSource = "slam" | "voice" | "risingFlap" | "closingFlap" | "tick" | "landing";

export type RewardRegister = "high" | "middle" | "low";

export type PlannedSound =
  | { kind: "paper"; isSlam: boolean; atS: number; pan: number; gain: number; recipe: PaperRecipe; source: LevelSource }
  | { kind: "voice"; atS: number; pan: number; play: VoicePlay; source: "voice" }
  | { kind: "reward"; atS: number; register: RewardRegister; noteCount: 1 | 2 }
  | { kind: "duck"; atS: number };

type SoundSink = (sound: PlannedSound) => void;

export type AudioClock = { nowTick: number; presentTick: number; endTick: number | null };

export type HeardLid = { boxIndex: number; tick: number };

type SoundPlanner = {
  beginRound: (round: RecordedRound) => void;
  planFrame: (clock: AudioClock, events: readonly RoundEvent[], lids: readonly HeardLid[], sink: SoundSink) => void;
};

type SoundPlannerOptions = { files: readonly VoiceFile[]; readOwnSeat: () => number | null };

type FoldPayload = { pan: number; source: LevelSource };

type PeckTick = { atS: number; isOwn: boolean; seed: number; pan: number };

type RoundMemory = {
  round: RecordedRound;
  frameTicks: PeckTick[];
  secondsPerTick: number;
  paper: PaperGate<FoldPayload>;
  voices: VoiceGate;
  pecks: PeckTickLimiter;
  seatBoxes: Map<number, number>;
  bonkedSeats: Set<number>;
  raise: HandRaisedEvent | null;
  whaleSeat: number | null;
  lastMsLeft: number | null;
};

const pigeonOf = (seat: number): VoiceCharacter => ({ kind: "pigeon", seat });
const WHALE: VoiceCharacter = { kind: "whale" };
const pigeonSeed = (seat: number): number => hashSeed("pigeon", seat);

function panForBox(box: number, boxCount: number): number {
  if (boxCount <= 1) return 0;
  return ((box / (boxCount - 1)) * 2 - 1) * BOX_PAN_SPREAD;
}

function crossedTimerSeconds(previousMsLeft: number, msLeft: number): number[] {
  const crossed: number[] = [];
  for (let second = TIMER_TICK_SECONDS; second >= 1; second--) {
    const markMs = second * 1000;
    if (previousMsLeft > markMs && msLeft <= markMs) crossed.push(second);
  }
  return crossed;
}

function createRoundMemory(round: RecordedRound, files: readonly VoiceFile[]): RoundMemory {
  return {
    round,
    frameTicks: [],
    secondsPerTick: round.tickMs / 1000,
    paper: createPaperGate<FoldPayload>(),
    voices: createVoiceGate(files, round.seed),
    pecks: createPeckTickLimiter(),
    seatBoxes: new Map(),
    bonkedSeats: new Set(),
    raise: null,
    whaleSeat: null,
    lastMsLeft: null,
  };
}

export function createSoundPlanner({ files, readOwnSeat }: SoundPlannerOptions): SoundPlanner {
  let memory: RoundMemory | null = null;

  function emitFlap(sink: SoundSink, flap: ResolvedFlap | null, tone: FlapTone, pan: number, source: LevelSource, isSlam = false, gain = 1): void {
    if (flap === null) return;
    const recipe: PaperRecipe = { kind: "flap", tone, size: flap.size, isUp: flap.isUp, pitch: flap.pitch, durS: flap.durS, synthSeed: flap.synthSeed, level: flap.level };
    sink({ kind: "paper", isSlam, atS: flap.atS, pan, gain, recipe, source });
  }

  function placeTick(state: RoundMemory, sink: SoundSink, request: FlapRequest, tone: FlapTone, pan: number, gain = 1): void {
    emitFlap(sink, state.paper.placeTick(request, voicingForTone(tone)), tone, pan, "tick", false, gain);
  }

  function emitVoice(state: RoundMemory, sink: SoundSink, need: VoiceNeed, character: VoiceCharacter, atS: number, pan = 0): void {
    const play = state.voices.request({ need, character, atS });
    if (play !== null) sink({ kind: "voice", atS, pan, play, source: "voice" });
  }

  function seatPan(state: RoundMemory, seat: number): number {
    const box = state.seatBoxes.get(seat);
    return box === undefined ? 0 : panForBox(box, state.round.boxCount);
  }

  function isDodging(state: RoundMemory, seat: number, tick: number): boolean {
    const { raise } = state;
    return raise !== null && tick >= raise.tick && tick <= raise.landsTick && state.seatBoxes.get(seat) === raise.box;
  }

  function voiceSwat(state: RoundMemory, sink: SoundSink, event: Extract<RoundEvent, { kind: "swatLanded" }>, atS: number): void {
    const releaseS = atS + hitStopMs(event.hits.length) / 1000;
    const pan = panForBox(event.box, state.round.boxCount);
    emitVoice(state, sink, "whaleGrunt", WHALE, atS);
    emitFlap(sink, state.paper.placeExemptFlap({ atS: releaseS, size: SIZE.slam, isUp: false, seed: hashSeed("flipper") }), "plain", pan, "slam", true);
    if (state.paper.reserveVoice(releaseS, THUMP_LENGTH_S)) {
      sink({ kind: "paper", isSlam: true, atS: releaseS, pan, gain: 1, recipe: { kind: "thump", seed: hashSeed("thump", event.swatNumber) }, source: "slam" });
    }
    sink({ kind: "duck", atS: releaseS });
    const [firstHit] = event.hits;
    if (firstHit !== undefined) {
      state.paper.offerFold({ request: { atS: releaseS, size: SIZE.flattened, isUp: false, seed: pigeonSeed(firstHit.seat) }, payload: { pan, source: "closingFlap" } });
    }
    for (const [hitIndex, delayS] of FLATTENED_VOICE_DELAYS_S.entries()) {
      const hit = event.hits[hitIndex];
      if (hit !== undefined) emitVoice(state, sink, "pigeonFlattened", pigeonOf(hit.seat), releaseS + delayS, pan);
    }
    const droppedCrumbs = event.hits.reduce((sum, hit) => sum + hit.droppedCrumbs, 0);
    if (droppedCrumbs > 0) {
      const tickCount = PATTER_MIN_TICKS + Math.floor(seededUnit(state.round.seed, "patter", event.swatNumber) * PATTER_EXTRA_TICKS);
      for (let tickIndex = 0; tickIndex < tickCount; tickIndex++) {
        const tickS = releaseS + PATTER_START_S + (tickIndex / (tickCount - 1)) * PATTER_SPAN_S;
        placeTick(state, sink, { atS: tickS, size: SIZE.tick, isUp: true, seed: hashSeed("patter", event.swatNumber, tickIndex) }, "tick", pan, PATTER_GAIN * Math.pow(PATTER_FALLOFF, tickIndex));
      }
    }
    if (event.hits.length === 0) emitVoice(state, sink, "whaleWhat", WHALE, releaseS + WHAT_DELAY_S);
    else emitVoice(state, sink, "whaleOwOw", WHALE, atS + FLIPPER_SHAKE_DELAY_S);
    const ownSeat = readOwnSeat();
    if (ownSeat === null || ownSeat !== state.whaleSeat || event.hits.length === 0) return;
    if (event.hits.length >= BIG_HIT_COUNT) {
      sink({ kind: "reward", atS: releaseS, register: "low", noteCount: 2 });
      return;
    }
    for (let hitIndex = 0; hitIndex < event.hits.length; hitIndex++) sink({ kind: "reward", atS: releaseS + hitIndex * WHALE_REWARD_SPACING_S, register: "low", noteCount: 1 });
  }

  function voiceSettlement(state: RoundMemory, sink: SoundSink, event: Extract<RoundEvent, { kind: "settled" }>, atS: number): void {
    emitVoice(state, sink, "refereeWhistle", { kind: "referee" }, atS);
    const reactionS = atS + WHISTLE_S + (state.round.boxCount - 1) * REVEAL_LID_STAGGER_S + REACTION_DELAY_S;
    const havePigeonsWon = event.pigeonCrumbs > event.whaleCrumbs;
    emitVoice(state, sink, havePigeonsWon ? "pigeonCheer" : "pigeonGroan", { kind: "crowd" }, reactionS);
    const whaleNeed: VoiceNeed = !havePigeonsWon ? "whalePleased" : event.pigeonCrumbs >= 2 * event.whaleCrumbs ? "whaleWhimper" : "whaleSigh";
    emitVoice(state, sink, whaleNeed, WHALE, reactionS + WHALE_REACTION_AFTER_S);
  }

  function voiceEvent(state: RoundMemory, sink: SoundSink, event: RoundEvent): void {
    const atS = event.tick * state.secondsPerTick;
    switch (event.kind) {
      case "seatJoined":
        return emitVoice(state, sink, "pigeonCoo", pigeonOf(event.seat), atS);
      case "anted":
        return;
      case "whaleDrawn":
        emitVoice(state, sink, "whaleHum", WHALE, atS + HUM_DELAY_S);
        return sink({ kind: "reward", atS: atS + DRAW_NOTE_DELAY_S, register: "low", noteCount: 1 });
      case "flew":
        if (isDodging(state, event.seat, event.tick)) emitVoice(state, sink, "pigeonHeh", pigeonOf(event.seat), atS, seatPan(state, event.seat));
        return;
      case "landed": {
        if (!state.paper.reserveVoice(atS, STEP_LENGTH_S)) return;
        const recipe: PaperRecipe = { kind: "step", seed: hashSeed("step", event.seat, event.tick), foot: event.tick % 2 };
        return sink({ kind: "paper", isSlam: false, atS, pan: panForBox(event.box, state.round.boxCount), gain: 1, recipe, source: "landing" });
      }
      case "tookOff": {
        const pan = seatPan(state, event.seat);
        if (isDodging(state, event.seat, event.tick)) return emitVoice(state, sink, "pigeonHeh", pigeonOf(event.seat), atS, pan);
        return emitVoice(state, sink, "pigeonTakeoff", { kind: "flock" }, atS, pan);
      }
      case "pecked": {
        const pan = panForBox(event.box, state.round.boxCount);
        if (event.outcome === "emptyBox") {
          emitFlap(sink, state.paper.placeExemptFlap({ atS, size: SIZE.knock, isUp: false, seed: hashSeed("lid", event.box) }), "knock", pan, "closingFlap");
          state.paper.offerFold({ request: { atS: atS + FOLD_ONTO_BACK_DELAY_S, size: SIZE.pigeon, isUp: false, seed: pigeonSeed(event.seat) }, payload: { pan, source: "closingFlap" } });
          return emitVoice(state, sink, "pigeonOw", pigeonOf(event.seat), atS + OW_DELAY_S, pan);
        }
        const strikeS = atS + PECK_STRIKE_S;
        const isOwn = event.seat === readOwnSeat();
        state.frameTicks.push({ atS: strikeS, isOwn, seed: hashSeed("peck", event.seat, event.tick), pan });
        if (isOwn) sink({ kind: "reward", atS: strikeS, register: event.outcome === "sandwichCrumb" ? "high" : "middle", noteCount: 1 });
        if (event.outcome === "sandwichCrumb") emitVoice(state, sink, "pigeonGulp", pigeonOf(event.seat), atS + GULP_DELAY_S, pan);
        return;
      }
      case "handRaised":
        emitFlap(sink, state.paper.placeExemptFlap({ atS, size: SIZE.whoosh, isUp: true, seed: hashSeed("flipper") }, voicingForTone("whoosh")), "whoosh", 0, "risingFlap");
        return emitVoice(state, sink, "whaleWindup", WHALE, atS);
      case "swatLanded":
        return voiceSwat(state, sink, event, atS);
      case "stunEnded": {
        const pan = seatPan(state, event.seat);
        state.paper.offerFold({ request: { atS, size: SIZE.pigeon, isUp: true, seed: pigeonSeed(event.seat) }, payload: { pan, source: "risingFlap" } });
        if (state.bonkedSeats.has(event.seat)) emitVoice(state, sink, "pigeonDizzy", pigeonOf(event.seat), atS + DIZZY_DELAY_S, pan);
        return;
      }
      case "settled":
        return voiceSettlement(state, sink, event, atS);
    }
  }

  function rememberEvent(state: RoundMemory, event: RoundEvent): void {
    switch (event.kind) {
      case "whaleDrawn":
        state.whaleSeat = event.whaleSeat;
        return;
      case "landed":
        state.seatBoxes.set(event.seat, event.box);
        return;
      case "flew":
      case "tookOff":
        state.seatBoxes.delete(event.seat);
        return;
      case "pecked":
        if (event.outcome === "emptyBox") state.bonkedSeats.add(event.seat);
        return;
      case "handRaised":
        state.raise = event;
        return;
      case "swatLanded":
        for (const hit of event.hits) state.bonkedSeats.delete(hit.seat);
        state.raise = null;
        return;
      case "stunEnded":
        state.bonkedSeats.delete(event.seat);
        return;
      case "seatJoined":
      case "anted":
      case "settled":
        return;
    }
  }

  function placePeckTicks(state: RoundMemory, sink: SoundSink): void {
    const ownFirst = state.frameTicks.sort((first, second) => Number(second.isOwn) - Number(first.isOwn) || first.atS - second.atS);
    for (const peck of ownFirst) {
      if (state.pecks.tryTake(peck.atS, peck.isOwn)) placeTick(state, sink, { atS: peck.atS, size: SIZE.tick, isUp: true, seed: peck.seed }, "tick", peck.pan);
    }
    state.frameTicks = [];
  }

  function planTimerTicks(state: RoundMemory, clock: AudioClock, frameS: number, sink: SoundSink): void {
    if (clock.endTick === null) {
      state.lastMsLeft = null;
      return;
    }
    const msLeft = (clock.endTick - clock.presentTick) * state.round.tickMs;
    if (state.lastMsLeft !== null) {
      for (const second of crossedTimerSeconds(state.lastMsLeft, msLeft)) {
        const atS = clock.endTick * state.secondsPerTick - second;
        if (atS >= frameS - STALE_S) placeTick(state, sink, { atS, size: SIZE.timer, isUp: true, seed: hashSeed("timer", second) }, "timer", 0);
      }
    }
    state.lastMsLeft = msLeft;
  }

  return {
    beginRound(round) {
      memory = createRoundMemory(round, files);
    },
    planFrame(clock, events, lids, sink) {
      const state = memory;
      if (state === null) return;
      const frameS = clock.nowTick * state.secondsPerTick;
      for (const event of events) {
        if (event.tick * state.secondsPerTick >= frameS - STALE_S) voiceEvent(state, sink, event);
        rememberEvent(state, event);
      }
      for (const lid of lids) {
        const atS = lid.tick * state.secondsPerTick;
        if (atS < frameS - STALE_S) continue;
        const request = { atS, size: SIZE.lid, isUp: true, seed: hashSeed("lid", lid.boxIndex) };
        emitFlap(sink, state.paper.placeExemptFlap(request), "plain", panForBox(lid.boxIndex, state.round.boxCount), "risingFlap");
      }
      placePeckTicks(state, sink);
      const fold = state.paper.flushFolds();
      if (fold !== null) emitFlap(sink, fold.flap, "plain", fold.payload.pan, fold.payload.source);
      planTimerTicks(state, clock, frameS, sink);
    },
  };
}
