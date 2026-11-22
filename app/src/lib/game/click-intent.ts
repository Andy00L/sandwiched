import type { PigeonIntent } from "./table-store";
import type { RoundViewState } from "./view-state";

export type ClickTarget = { kind: "box"; box: number } | { kind: "ground" };

export type PlayerIntent = { actor: "pigeon"; intent: PigeonIntent } | { actor: "whale"; box: number };

export function intentForClick(view: RoundViewState, ownSeat: number | null, target: ClickTarget): PlayerIntent | null {
  if (ownSeat === null || view.phase !== "live") return null;
  const seat = view.seats.find((candidate) => candidate.seat === ownSeat);
  if (seat === undefined || seat.presence !== "anted") return null;
  if (seat.role === "whale") return target.kind === "box" && view.hand.state === "idle" ? { actor: "whale", box: target.box } : null;
  const pigeon = seat.pigeon;
  if (pigeon.state === "stunned") return null;
  if (target.kind === "ground") return pigeon.state === "hovering" ? null : { actor: "pigeon", intent: { kind: "takeOff" } };
  if (pigeon.state === "perched" && pigeon.box === target.box) return { actor: "pigeon", intent: { kind: "peck" } };
  if (pigeon.state === "flying" && pigeon.box === target.box) return null;
  return { actor: "pigeon", intent: { kind: "flyTo", box: target.box } };
}
