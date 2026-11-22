import type { RoundEvent, Temperament } from "./round-events";
import type { PigeonIntent } from "./table-store";
import type { PigeonView, RoundViewState } from "./view-state";

export const PERCHES_PER_BOX = 8;

export type BotView = {
  boxCount: number;
  sandwichBox: number;
  pot: number;
  standingPigeons: readonly number[];
  perchClaims: readonly number[];
  looseCrumbs: readonly number[];
  raisedHandBox: number | null;
  lastCrumbBox: number | null;
};

export type SettledPigeon = { state: "hovering" } | { state: "flying"; box: number } | { state: "perched"; box: number } | { state: "stunned"; box: number };

export function settlePigeon(pigeon: PigeonView, tick: number): SettledPigeon {
  if (pigeon.state === "flying") return pigeon.landsTick <= tick ? { state: "perched", box: pigeon.box } : { state: "flying", box: pigeon.box };
  if (pigeon.state === "stunned") return pigeon.untilTick <= tick ? { state: "perched", box: pigeon.box } : { state: "stunned", box: pigeon.box };
  return pigeon;
}

const findLastCrumbBox = (events: readonly RoundEvent[]): number | null => {
  const peck = events.findLast((event) => event.kind === "pecked" && event.outcome !== "emptyBox");
  return peck?.kind === "pecked" ? peck.box : null;
};

export function observeBotView(view: RoundViewState, events: readonly RoundEvent[], tick: number): BotView | null {
  if (view.sandwichBox === null) return null;
  const boxCount = view.looseCrumbs.length;
  const standingPigeons = Array.from({ length: boxCount }, () => 0);
  const perchClaims = Array.from({ length: boxCount }, () => 0);
  for (const seat of view.seats) {
    if (seat.role !== "pigeon" || seat.presence !== "anted" || seat.pigeon.state === "hovering") continue;
    const settled = settlePigeon(seat.pigeon, tick);
    perchClaims[seat.pigeon.box] = (perchClaims[seat.pigeon.box] ?? 0) + 1;
    if (settled.state === "perched") standingPigeons[settled.box] = (standingPigeons[settled.box] ?? 0) + 1;
  }
  const raisedHandBox = view.hand.state === "raised" && view.hand.landsTick > tick ? view.hand.box : null;
  return { boxCount, sandwichBox: view.sandwichBox, pot: view.pot, standingPigeons, perchClaims, looseCrumbs: view.looseCrumbs, raisedHandBox, lastCrumbBox: findLastCrumbBox(events) };
}

const looseOn = (view: BotView, box: number) => view.looseCrumbs[box] ?? 0;
const hasRoomOn = (view: BotView, box: number) => (view.perchClaims[box] ?? PERCHES_PER_BOX) < PERCHES_PER_BOX;
const hasFoodOn = (view: BotView, box: number) => looseOn(view, box) > 0 || (box === view.sandwichBox && view.pot > 0);
const isHandOver = (view: BotView, box: number) => view.raisedHandBox === box;
const peckWhenReady = (canPeck: boolean): PigeonIntent | null => (canPeck ? { kind: "peck" } : null);
const flyWhenRoom = (view: BotView, box: number): PigeonIntent | null => (hasRoomOn(view, box) ? { kind: "flyTo", box } : null);

function chooseGreedyMove(pigeon: SettledPigeon, canPeck: boolean, view: BotView): PigeonIntent | null {
  const targetBox = view.lastCrumbBox ?? view.sandwichBox;
  if (pigeon.state === "perched" && (pigeon.box === targetBox || hasFoodOn(view, pigeon.box))) return peckWhenReady(canPeck);
  if (pigeon.state === "hovering" || pigeon.state === "perched") return flyWhenRoom(view, targetBox);
  return null;
}

function chooseNervousMove(pigeon: SettledPigeon, canPeck: boolean, view: BotView): PigeonIntent | null {
  const homeBox = view.sandwichBox;
  if ((pigeon.state === "perched" || pigeon.state === "flying") && isHandOver(view, pigeon.box)) return { kind: "takeOff" };
  if (pigeon.state === "hovering" && isHandOver(view, homeBox)) return null;
  if (pigeon.state === "perched" && hasFoodOn(view, pigeon.box)) return peckWhenReady(canPeck);
  if (pigeon.state === "hovering" || pigeon.state === "perched") return flyWhenRoom(view, homeBox);
  return null;
}

function findRichestLooseBox(view: BotView): number | null {
  let richest: number | null = null;
  for (let box = 0; box < view.boxCount; box++) {
    if (looseOn(view, box) === 0 || !hasRoomOn(view, box)) continue;
    if (richest === null || looseOn(view, box) > looseOn(view, richest)) richest = box;
  }
  return richest;
}

function chooseVultureMove(pigeon: SettledPigeon, canPeck: boolean, view: BotView): PigeonIntent | null {
  if (pigeon.state === "hovering") {
    const richest = findRichestLooseBox(view);
    return richest === null ? null : { kind: "flyTo", box: richest };
  }
  if (pigeon.state === "perched") return looseOn(view, pigeon.box) > 0 ? peckWhenReady(canPeck) : { kind: "takeOff" };
  return null;
}

export function choosePigeonMove(temperament: Temperament, pigeon: SettledPigeon, canPeck: boolean, view: BotView): PigeonIntent | null {
  switch (temperament) {
    case "greedy":
      return chooseGreedyMove(pigeon, canPeck, view);
    case "nervous":
      return chooseNervousMove(pigeon, canPeck, view);
    case "vulture":
      return chooseVultureMove(pigeon, canPeck, view);
  }
}

export function chooseSwatBox(view: BotView): number | null {
  let chosen: number | null = null;
  const rank = (box: number) => (view.standingPigeons[box] ?? 0) * 2 + (box === view.sandwichBox ? 1 : 0);
  for (let box = 0; box < view.boxCount; box++) {
    if ((view.standingPigeons[box] ?? 0) === 0) continue;
    if (chosen === null || rank(box) > rank(chosen)) chosen = box;
  }
  return chosen;
}
