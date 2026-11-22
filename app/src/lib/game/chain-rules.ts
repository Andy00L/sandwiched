import type { PigeonState, RoundSnapshot, SeatSnapshot } from "../chain/accounts";
import type { RoundTiming } from "./round-events";
import type { PigeonView } from "./view-state";

export const TICK_MS = 10;
export const CHIPS_PER_ANTE = 100;
const SWAT_DROP_PERCENT = 50;
const SWAT_HISTORY_LENGTH = 8;

const LOBBY_MS = 20_000;
const DRAW_TIMEOUT_MS = 5_000;
const HIDE_MS = 5_000;
const ROUND_MS = 45_000;
const FLIGHT_MS = 500;
const PECK_COOLDOWN_MS = 300;
const EMPTY_BOX_STUN_MS = 2_000;
const SWAT_WINDUP_MS = 350;
const SWAT_COOLDOWN_MS = 900;
const SWAT_STUN_MS = 1_500;
const SWITCH_COOLDOWN_MS = 8_000;

function convertMsToTicks(durationMs: number): number {
  return Math.max(1, Math.ceil(durationMs / TICK_MS));
}

export const LIVE_TIMING: RoundTiming = {
  lobbyTicks: convertMsToTicks(LOBBY_MS),
  drawTimeoutTicks: convertMsToTicks(DRAW_TIMEOUT_MS),
  hideTicks: convertMsToTicks(HIDE_MS),
  roundTicks: convertMsToTicks(ROUND_MS),
  flightTicks: convertMsToTicks(FLIGHT_MS),
  peckCooldownTicks: convertMsToTicks(PECK_COOLDOWN_MS),
  emptyBoxStunTicks: convertMsToTicks(EMPTY_BOX_STUN_MS),
  swatWindupTicks: convertMsToTicks(SWAT_WINDUP_MS),
  swatCooldownTicks: convertMsToTicks(SWAT_COOLDOWN_MS),
  swatStunTicks: convertMsToTicks(SWAT_STUN_MS),
  switchCooldownTicks: convertMsToTicks(SWITCH_COOLDOWN_MS),
};

export type ChainPigeon = { pigeon: PigeonView; beakCrumbs: number; lastSwatNumber: number };

export type SwatDrop = { box: number; crumbs: number };

export function readPigeonView(pigeonState: PigeonState): PigeonView {
  switch (pigeonState.state) {
    case "hovering":
      return { state: "hovering" };
    case "flying":
      return { state: "flying", box: pigeonState.box, landsTick: Number(pigeonState.landsTick) };
    case "perched":
      return { state: "perched", box: pigeonState.box };
    case "stunned":
      return { state: "stunned", box: pigeonState.box, untilTick: Number(pigeonState.untilTick) };
  }
}

export function readChainPigeon(seat: SeatSnapshot): ChainPigeon {
  return {
    pigeon: readPigeonView(seat.pigeon),
    beakCrumbs: Number(seat.beakCrumbs),
    lastSwatNumber: Number(seat.lastSwatNumber),
  };
}

export function settlePigeonAt(pigeon: PigeonView, tick: number): PigeonView {
  if (pigeon.state === "flying" && pigeon.landsTick <= tick) return { state: "perched", box: pigeon.box };
  if (pigeon.state === "stunned" && pigeon.untilTick <= tick) return { state: "perched", box: pigeon.box };
  return pigeon;
}

export function readPigeonBox(pigeon: PigeonView): number | null {
  return pigeon.state === "hovering" ? null : pigeon.box;
}

function isStandingOn(pigeon: PigeonView, box: number, tick: number): boolean {
  const settled = settlePigeonAt(pigeon, tick);
  return settled.state === "perched" && settled.box === box;
}

export function countDroppedCrumbs(beakCrumbs: number): number {
  return Math.ceil((beakCrumbs * SWAT_DROP_PERCENT) / 100);
}

export function applyLandedSwats(
  subject: ChainPigeon,
  round: RoundSnapshot,
  nowTick: number,
  timing: RoundTiming,
): { after: ChainPigeon; drops: SwatDrop[] } {
  const swatCount = Number(round.swatCount);
  const oldestKeptNumber = Math.max(1, swatCount - (SWAT_HISTORY_LENGTH - 1));
  const drops: SwatDrop[] = [];
  let { pigeon, beakCrumbs, lastSwatNumber } = subject;
  for (let swatNumber = Math.max(lastSwatNumber + 1, oldestKeptNumber); swatNumber <= swatCount; swatNumber += 1) {
    const swat = round.swats.find((candidate) => Number(candidate.number) === swatNumber);
    if (swat === undefined || Number(swat.landsTick) > nowTick) break;
    const landsTick = Number(swat.landsTick);
    if (isStandingOn(pigeon, swat.box, landsTick)) {
      const crumbs = countDroppedCrumbs(beakCrumbs);
      beakCrumbs -= crumbs;
      drops.push({ box: swat.box, crumbs });
      pigeon = { state: "stunned", box: swat.box, untilTick: landsTick + timing.swatStunTicks };
    }
    lastSwatNumber = swatNumber;
  }
  return { after: { pigeon: settlePigeonAt(pigeon, nowTick), beakCrumbs, lastSwatNumber }, drops };
}
