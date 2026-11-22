import { choosePigeonMove, chooseSwatBox, observeBotView, settlePigeon } from "./bots";
import type { PlayerIntent } from "./click-intent";
import { TICK_MS } from "./chain-rules";
import type { RoundTiming, Temperament } from "./round-events";
import type { TableStore } from "./table-store";

export const BOT_REACTION_MIN_MS = 150;
export const BOT_REACTION_MAX_MS = 450;
const CLOCK_MARGIN_TICKS = 10;
export const BOT_WHALE_REST_MS = 1_800;

export type BotBrainPorts = {
  store: TableStore;
  perform: (intent: PlayerIntent) => void;
  temperament: Temperament;
  timing: RoundTiming;
  random: () => number;
};

export type BotMemory = { nextPeckTick: number; nextRaiseTick: number };

export function chooseBotIntent(store: TableStore, temperament: Temperament, timing: RoundTiming, memory: BotMemory): PlayerIntent | null {
  const { live, ownSeat } = store.getSnapshot();
  if (live === null || ownSeat === null || live.view.phase !== "live") return null;
  const seat = live.view.seats.find((candidate) => candidate.seat === ownSeat);
  if (seat === undefined || seat.presence !== "anted") return null;
  const tick = store.chainTick();
  const cautiousTick = tick - CLOCK_MARGIN_TICKS;
  const view = observeBotView(live.view, live.round.events, cautiousTick);
  if (view === null) return null;
  if (seat.role === "whale") {
    if (view.raisedHandBox !== null || tick < memory.nextRaiseTick) return null;
    const box = chooseSwatBox(view);
    if (box === null) return null;
    memory.nextRaiseTick = tick + timing.swatWindupTicks + timing.swatCooldownTicks + CLOCK_MARGIN_TICKS + BOT_WHALE_REST_MS / TICK_MS;
    return { actor: "whale", box };
  }
  const intent = choosePigeonMove(temperament, settlePigeon(seat.pigeon, cautiousTick), tick >= memory.nextPeckTick, view);
  if (intent === null) return null;
  if (intent.kind === "peck") memory.nextPeckTick = tick + timing.peckCooldownTicks + CLOCK_MARGIN_TICKS;
  return { actor: "pigeon", intent };
}

export function startBotBrain(ports: BotBrainPorts): () => void {
  const memory: BotMemory = { nextPeckTick: 0, nextRaiseTick: 0 };
  let isStopped = false;
  let thinkTimer: ReturnType<typeof setTimeout> | null = null;

  const scheduleThought = () => {
    if (isStopped) return;
    const reactionMs = BOT_REACTION_MIN_MS + ports.random() * (BOT_REACTION_MAX_MS - BOT_REACTION_MIN_MS);
    thinkTimer = setTimeout(think, reactionMs);
  };

  const think = () => {
    const intent = chooseBotIntent(ports.store, ports.temperament, ports.timing, memory);
    if (intent !== null) ports.perform(intent);
    scheduleThought();
  };

  scheduleThought();
  return () => {
    isStopped = true;
    if (thinkTimer !== null) clearTimeout(thinkTimer);
  };
}
