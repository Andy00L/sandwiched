import { describe, expect, test } from "bun:test";
import { parseRecordedRound } from "./round-events";

const TIMING_TICKS = {
  lobbyTicks: 2000,
  drawTimeoutTicks: 500,
  hideTicks: 500,
  roundTicks: 4500,
  flightTicks: 50,
  peckCooldownTicks: 30,
  emptyBoxStunTicks: 200,
  swatWindupTicks: 35,
  swatCooldownTicks: 90,
  swatStunTicks: 150,
  switchCooldownTicks: 800,
};

function buildDuel(events: readonly unknown[]) {
  return {
    version: 1,
    seed: 1,
    tickMs: 10,
    boxCount: 3,
    timing: TIMING_TICKS,
    chipsPerAnte: 100,
    players: [
      { seat: 0, name: "Gary", variant: 0, temperament: "greedy" },
      { seat: 1, name: "Linda", variant: 1, temperament: "nervous" },
    ],
    events,
  };
}

const VALID_EVENTS = [
  { tick: 0, kind: "seatJoined", seat: 0 },
  { tick: 2, kind: "seatJoined", seat: 1 },
  { tick: 4, kind: "anted", seat: 0 },
  { tick: 5, kind: "anted", seat: 1 },
  { tick: 15, kind: "whaleDrawn", whaleSeat: 0, sandwichBox: 2, endTick: 4515 },
  { tick: 40, kind: "flew", seat: 1, box: 2, landsTick: 90 },
  { tick: 90, kind: "landed", seat: 1, box: 2 },
  { tick: 90, kind: "pecked", seat: 1, box: 2, outcome: "sandwichCrumb" },
];

describe("parseRecordedRound", () => {
  test("accepts a well-formed round", () => {
    const parsed = parseRecordedRound(buildDuel(VALID_EVENTS));
    expect(parsed.ok).toBe(true);
  });

  test.each([
    ["a file that is not an object", [], "round must be an object"],
    ["another schema version", { ...buildDuel(VALID_EVENTS), version: 2 }, "round.version"],
    ["a timing field that is missing", { ...buildDuel(VALID_EVENTS), timing: {} }, "round.timing.lobbyTicks"],
    ["an unknown event kind", buildDuel([{ tick: 0, kind: "danced", seat: 0 }]), "round.events[0].kind"],
    ["a tick written as text", buildDuel([{ tick: "0", kind: "seatJoined", seat: 0 }]), "round.events[0].tick"],
    ["an empty-box peck without its stun end", buildDuel([{ tick: 0, kind: "pecked", seat: 1, box: 0, outcome: "emptyBox" }]), "round.events[0].untilTick"],
    ["a swat hit without dropped crumbs", buildDuel([{ tick: 0, kind: "swatLanded", box: 0, swatNumber: 1, hits: [{ seat: 1, untilTick: 150 }] }]), "round.events[0].hits[0].droppedCrumbs"],
    ["a seat that is not at the table", buildDuel([{ tick: 0, kind: "seatJoined", seat: 7 }]), "seat 7"],
    ["a box the table does not have", buildDuel([{ tick: 0, kind: "landed", seat: 1, box: 3 }]), "box 3"],
    ["events out of order", buildDuel([VALID_EVENTS[1], VALID_EVENTS[0]]), "comes after tick 2"],
  ])("rejects %s with a reason", (_label, json, expectedReason) => {
    const parsed = parseRecordedRound(json);
    expect(parsed.ok).toBe(false);
    expect(parsed.ok ? "" : parsed.reason).toContain(expectedReason);
  });
});
