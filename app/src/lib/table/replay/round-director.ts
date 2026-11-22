import type { HandRaisedEvent, RecordedRound, RoundEvent } from "../../game/round-events";
import { applyRoundEvent, createViewState } from "../../game/view-state";
import type { RoundViewState } from "../../game/view-state";

export const PERCH_SLOT_COUNT = 8;
const DRAWN_FOLD_TICKS = 40;

type PerchSlot = { box: number; slot: number };
export type FlightEnd = PerchSlot | "hover";

type SeatStage =
  | { kind: "away" }
  | { kind: "hovering" }
  | { kind: "flying"; from: FlightEnd; to: FlightEnd; startTick: number; landsTick: number }
  | { kind: "perched"; at: PerchSlot }
  | { kind: "stunned"; at: PerchSlot; cause: "bonk" | "swat"; sinceTick: number; untilTick: number }
  | { kind: "drawn"; sinceTick: number };

export type SeatPose = Exclude<SeatStage, { kind: "away" }> | { kind: "hidden" };

interface RoundDirector {
  readonly round: RecordedRound;
  view(): RoundViewState;
  advanceTo(tick: number): readonly RoundEvent[];
  poseOf(seat: number, tick: number): SeatPose;
  latestRaises(): readonly HandRaisedEvent[];
  reset(): void;
}

const AWAY: SeatStage = { kind: "away" };
const HOVERING: SeatStage = { kind: "hovering" };

function stagePerch(stage: SeatStage): PerchSlot | null {
  if (stage.kind === "perched" || stage.kind === "stunned") return stage.at;
  if (stage.kind === "flying" && stage.to !== "hover") return stage.to;
  return null;
}

function resolvePose(stage: SeatStage, tick: number): SeatPose {
  switch (stage.kind) {
    case "away":
      return { kind: "hidden" };
    case "drawn":
      return tick - stage.sinceTick < DRAWN_FOLD_TICKS ? stage : { kind: "hidden" };
    case "flying":
      return stage.to === "hover" && tick >= stage.landsTick ? { kind: "hovering" } : stage;
    default:
      return stage;
  }
}

export function createRoundDirector(round: RecordedRound): RoundDirector {
  let view = createViewState(round);
  let cursor = 0;
  const stages = new Map<number, SeatStage>();
  const occupants = new Map<number, Array<number | null>>();
  const raisesByBox = new Map<number, HandRaisedEvent>();

  function releasePerch(seat: number): void {
    const perch = stagePerch(stages.get(seat) ?? AWAY);
    if (!perch) return;
    const slots = occupants.get(perch.box);
    if (slots && slots[perch.slot] === seat) slots[perch.slot] = null;
  }

  function reservePerch(seat: number, box: number): PerchSlot {
    const slots = occupants.get(box) ?? Array.from({ length: PERCH_SLOT_COUNT }, () => null);
    occupants.set(box, slots);
    const freeSlot = slots.indexOf(null);
    if (freeSlot === -1) return { box, slot: PERCH_SLOT_COUNT + seat };
    slots[freeSlot] = seat;
    return { box, slot: freeSlot };
  }

  function stunAt(seat: number, cause: "bonk" | "swat", sinceTick: number, untilTick: number): void {
    const stage = stages.get(seat) ?? AWAY;
    if (stage.kind === "perched" || stage.kind === "stunned") stages.set(seat, { kind: "stunned", at: stage.at, cause, sinceTick, untilTick });
  }

  function stageEvent(event: RoundEvent): void {
    switch (event.kind) {
      case "seatJoined":
        stages.set(event.seat, HOVERING);
        return;
      case "whaleDrawn":
        releasePerch(event.whaleSeat);
        stages.set(event.whaleSeat, { kind: "drawn", sinceTick: event.tick });
        return;
      case "flew": {
        const from = stagePerch(stages.get(event.seat) ?? AWAY) ?? "hover";
        releasePerch(event.seat);
        const to = reservePerch(event.seat, event.box);
        stages.set(event.seat, { kind: "flying", from, to, startTick: event.tick, landsTick: event.landsTick });
        return;
      }
      case "landed": {
        const stage = stages.get(event.seat) ?? AWAY;
        if (stage.kind === "flying" && stage.to !== "hover") stages.set(event.seat, { kind: "perched", at: stage.to });
        return;
      }
      case "tookOff": {
        const from = stagePerch(stages.get(event.seat) ?? AWAY);
        releasePerch(event.seat);
        stages.set(
          event.seat,
          from ? { kind: "flying", from, to: "hover", startTick: event.tick, landsTick: event.tick + round.timing.flightTicks } : HOVERING,
        );
        return;
      }
      case "pecked":
        if (event.outcome === "emptyBox") stunAt(event.seat, "bonk", event.tick, event.untilTick);
        return;
      case "handRaised":
        raisesByBox.set(event.box, event);
        return;
      case "swatLanded":
        for (const hit of event.hits) stunAt(hit.seat, "swat", event.tick, hit.untilTick);
        return;
      case "stunEnded": {
        const stage = stages.get(event.seat) ?? AWAY;
        if (stage.kind === "stunned") stages.set(event.seat, { kind: "perched", at: stage.at });
        return;
      }
      case "anted":
      case "settled":
        return;
    }
  }

  return {
    round,
    view: () => view,
    advanceTo(tick) {
      const applied: RoundEvent[] = [];
      for (let event = round.events[cursor]; event !== undefined && event.tick <= tick; event = round.events[cursor]) {
        stageEvent(event);
        view = applyRoundEvent(view, event);
        applied.push(event);
        cursor += 1;
      }
      return applied;
    },
    poseOf: (seat, tick) => resolvePose(stages.get(seat) ?? AWAY, tick),
    latestRaises: () => [...raisesByBox.values()],
    reset() {
      view = createViewState(round);
      cursor = 0;
      stages.clear();
      occupants.clear();
      raisesByBox.clear();
    },
  };
}
