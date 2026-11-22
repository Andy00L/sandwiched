import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { parseRecordedRound, type RecordedRound } from "../../game/round-events";
import { createRoundDirector, PERCH_SLOT_COUNT, type SeatPose } from "./round-director";

const ROUNDS_DIRECTORY = join(import.meta.dir, "../../../../tests/rounds");

const CANONICAL_ROUNDS = readdirSync(ROUNDS_DIRECTORY).flatMap((fileName): [string, RecordedRound][] => {
  const parsed = parseRecordedRound(JSON.parse(readFileSync(join(ROUNDS_DIRECTORY, fileName), "utf8")));
  return parsed.ok ? [[fileName, parsed.round]] : [];
});

function perchKey(pose: SeatPose): string | null {
  if (pose.kind === "perched" || pose.kind === "stunned") return `${pose.at.box}:${pose.at.slot}`;
  if (pose.kind === "flying" && pose.to !== "hover") return `${pose.to.box}:${pose.to.slot}`;
  return null;
}

describe("round director", () => {
  test("loads all five canonical rounds", () => {
    expect(CANONICAL_ROUNDS.length).toBe(5);
  });

  test.each(CANONICAL_ROUNDS)("%s: no two pigeons share a perch slot and every slot exists", (_fileName, round) => {
    const director = createRoundDirector(round);
    for (const event of round.events) {
      director.advanceTo(event.tick);
      const keys = round.players.map((player) => perchKey(director.poseOf(player.seat, event.tick))).filter((key) => key !== null);
      expect(new Set(keys).size).toBe(keys.length);
      for (const key of keys) expect(Number(key.split(":")[1])).toBeLessThan(PERCH_SLOT_COUNT);
    }
  });

  test.each(CANONICAL_ROUNDS)("%s: every landing perches the pigeon on the box it flew to", (_fileName, round) => {
    const director = createRoundDirector(round);
    for (const event of round.events) {
      director.advanceTo(event.tick);
      if (event.kind !== "landed") continue;
      const pose = director.poseOf(event.seat, event.tick);
      expect(pose.kind === "perched" || pose.kind === "stunned" ? pose.at.box : null).toBe(event.box);
    }
  });

  test("a pigeon that takes off flies back and then hovers", () => {
    const [, round] = CANONICAL_ROUNDS.find(([, candidate]) => candidate.events.some((event) => event.kind === "tookOff")) ?? [];
    const takeOff = round?.events.find((event) => event.kind === "tookOff");
    expect(takeOff?.kind).toBe("tookOff");
    if (!round || takeOff?.kind !== "tookOff") return;
    const director = createRoundDirector(round);
    director.advanceTo(takeOff.tick);
    expect(director.poseOf(takeOff.seat, takeOff.tick)).toMatchObject({ kind: "flying", to: "hover" });
    expect(director.poseOf(takeOff.seat, takeOff.tick + round.timing.flightTicks)).toEqual({ kind: "hovering" });
  });

  test("the drawn seat folds and then leaves the table", () => {
    const [, round] = CANONICAL_ROUNDS[0] ?? [];
    const draw = round?.events.find((event) => event.kind === "whaleDrawn");
    expect(draw?.kind).toBe("whaleDrawn");
    if (!round || draw?.kind !== "whaleDrawn") return;
    const director = createRoundDirector(round);
    director.advanceTo(draw.tick);
    expect(director.poseOf(draw.whaleSeat, draw.tick).kind).toBe("drawn");
    expect(director.poseOf(draw.whaleSeat, draw.tick + 1000).kind).toBe("hidden");
  });
});
