import type { RecordedRound, RoundEvent } from "../game/round-events";
import { REVEAL_LID_STAGGER_S, WHISTLE_S } from "../table/motion/motion-tokens";
import type { OfflinePlan } from "./offline-mix";
import { createSoundPlanner } from "./sound-plan";
import type { HeardLid, PlannedSound } from "./sound-plan";
import type { VoiceFile } from "./voices";
import { FINAL_STRETCH_S } from "./waltz";

const OFFLINE_FRAME_RATE = 60;
const TAIL_S = 4;
const MUSIC_LEAD_S = 30;

type OfflineRoundOptions = { files: readonly VoiceFile[]; ownSeat: number | null };

function listRevealLids(round: RecordedRound): HeardLid[] {
  const settled = round.events.find((event) => event.kind === "settled");
  if (settled === undefined) return [];
  const whistleTicks = (WHISTLE_S * 1000) / round.tickMs;
  const staggerTicks = (REVEAL_LID_STAGGER_S * 1000) / round.tickMs;
  return Array.from({ length: round.boxCount }, (_unused, rank) => ({ boxIndex: rank, tick: settled.tick + whistleTicks + rank * staggerTicks }));
}

export function planRoundOffline(round: RecordedRound, { files, ownSeat }: OfflineRoundOptions): OfflinePlan {
  const planner = createSoundPlanner({ files, readOwnSeat: () => ownSeat });
  planner.beginRound(round);
  const sounds: PlannedSound[] = [];
  const lids = listRevealLids(round);
  const lastTick = round.events.at(-1)?.tick ?? 0;
  const durationS = (lastTick * round.tickMs) / 1000 + TAIL_S;
  const ticksPerFrame = 1000 / OFFLINE_FRAME_RATE / round.tickMs;
  const frameCount = Math.ceil(durationS * OFFLINE_FRAME_RATE);
  let nextEvent = 0;
  let nextLid = 0;
  let endTick: number | null = null;
  for (let frame = 0; frame <= frameCount; frame++) {
    const nowTick = frame * ticksPerFrame;
    const frameEvents: RoundEvent[] = [];
    while (nextEvent < round.events.length && (round.events[nextEvent]?.tick ?? Number.POSITIVE_INFINITY) <= Math.floor(nowTick)) {
      const event = round.events[nextEvent];
      if (event !== undefined) frameEvents.push(event);
      if (event?.kind === "whaleDrawn") endTick = event.endTick;
      nextEvent++;
    }
    const frameLids: HeardLid[] = [];
    while (nextLid < lids.length && (lids[nextLid]?.tick ?? Number.POSITIVE_INFINITY) <= nowTick) {
      const lid = lids[nextLid];
      if (lid !== undefined) frameLids.push({ boxIndex: lid.boxIndex, tick: nowTick });
      nextLid++;
    }
    planner.planFrame({ nowTick, presentTick: nowTick, endTick }, frameEvents, frameLids, (sound) => sounds.push(sound));
  }
  const endS = endTick === null ? null : (endTick * round.tickMs) / 1000;
  return {
    sounds,
    durationS,
    musicStartS: -MUSIC_LEAD_S,
    finalStretch: endS === null ? null : { fromS: endS - FINAL_STRETCH_S, untilS: endS },
  };
}
