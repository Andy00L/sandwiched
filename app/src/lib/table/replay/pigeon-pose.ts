import { HOVER_HEIGHT_UNITS } from "../motion/motion-tokens";
import type { PigeonPose } from "./pigeon-actor";
import type { PerchSpot } from "./perches";
import { PERCH_SLOT_COUNT } from "./round-director";
import type { FlightEnd, SeatPose } from "./round-director";

export type PerchSpotTable = readonly (readonly PerchSpot[])[];

function heightOf(end: FlightEnd): number {
  return end === "hover" ? HOVER_HEIGHT_UNITS : 0;
}

function perchSpotOf(end: FlightEnd, hover: PerchSpot, perchSpots: PerchSpotTable): PerchSpot {
  return end === "hover" ? hover : (perchSpots[end.box]?.[end.slot % PERCH_SLOT_COUNT] ?? hover);
}

export function toPigeonPose(pose: SeatPose, hover: PerchSpot, perchSpots: PerchSpotTable): PigeonPose {
  switch (pose.kind) {
    case "hidden":
      return pose;
    case "hovering":
      return { kind: "hovering", spot: hover };
    case "drawn":
      return { kind: "folding", spot: hover, sinceTick: pose.sinceTick };
    case "flying":
      return {
        kind: "flying",
        from: perchSpotOf(pose.from, hover, perchSpots),
        to: perchSpotOf(pose.to, hover, perchSpots),
        fromHeight: heightOf(pose.from),
        toHeight: heightOf(pose.to),
        startTick: pose.startTick,
        landsTick: pose.landsTick,
      };
    case "perched":
      return { kind: "perched", spot: perchSpotOf(pose.at, hover, perchSpots) };
    case "stunned":
      return { kind: "stunned", spot: perchSpotOf(pose.at, hover, perchSpots), cause: pose.cause, sinceTick: pose.sinceTick, untilTick: pose.untilTick };
  }
}
