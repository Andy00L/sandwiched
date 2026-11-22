import { describe, expect, test } from "bun:test";
import type { RecordedRound, RoundEvent } from "../../game/round-events";
import { createBodyMemory, stepBody } from "./pigeon-body";
import type { BodyCommand, BodyMemory } from "./pigeon-body";
import { createRoundDirector } from "./round-director";
import type { SeatPose } from "./round-director";

const SUBJECT_SEAT = 0;
const OTHER_SEAT = 1;
const TICK_STEP = 10;
const WAIT_TICKS = 100;
const MAX_DEPTH = 14;

type Step =
  | "seat joins"
  | "flies to box 0"
  | "lands"
  | "takes off"
  | "pecks crumbs"
  | "pecks an empty box"
  | "is swatted"
  | "stun ends"
  | "is drawn as the whale"
  | "time passes"
  | "a frame renders";

const STEPS: readonly Step[] = [
  "seat joins",
  "flies to box 0",
  "lands",
  "takes off",
  "pecks crumbs",
  "pecks an empty box",
  "is swatted",
  "stun ends",
  "is drawn as the whale",
  "time passes",
  "a frame renders",
];

interface SpringMirror {
  appearTarget: 0 | 1;
  swatWhipTarget: 0 | 1;
  bonkTarget: 0 | 1;
  rise: "appear" | "swatWhip";
  isTongueOut: boolean;
}

interface Node {
  path: readonly Step[];
  events: readonly RoundEvent[];
  tick: number;
  memory: BodyMemory;
  springs: SpringMirror;
}

const TIMING: RecordedRound["timing"] = {
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

function roundWith(events: readonly RoundEvent[]): RecordedRound {
  return {
    version: 1,
    seed: 1,
    tickMs: 10,
    boxCount: 3,
    timing: TIMING,
    chipsPerAnte: 10,
    players: [
      { seat: SUBJECT_SEAT, name: "subject", variant: 0, temperament: "greedy" },
      { seat: OTHER_SEAT, name: "other", variant: 1, temperament: "nervous" },
    ],
    events,
  };
}

function eventFor(step: Step, tick: number): RoundEvent | null {
  switch (step) {
    case "seat joins":
      return { tick, kind: "seatJoined", seat: SUBJECT_SEAT };
    case "flies to box 0":
      return { tick, kind: "flew", seat: SUBJECT_SEAT, box: 0, landsTick: tick + TIMING.flightTicks };
    case "lands":
      return { tick, kind: "landed", seat: SUBJECT_SEAT, box: 0 };
    case "takes off":
      return { tick, kind: "tookOff", seat: SUBJECT_SEAT };
    case "pecks crumbs":
      return { tick, kind: "pecked", seat: SUBJECT_SEAT, box: 0, outcome: "looseCrumb" };
    case "pecks an empty box":
      return { tick, kind: "pecked", seat: SUBJECT_SEAT, box: 0, outcome: "emptyBox", untilTick: tick + TIMING.emptyBoxStunTicks };
    case "is swatted":
      return { tick, kind: "swatLanded", box: 0, swatNumber: 1, hits: [{ seat: SUBJECT_SEAT, droppedCrumbs: 1, untilTick: tick + TIMING.swatStunTicks }] };
    case "stun ends":
      return { tick, kind: "stunEnded", seat: SUBJECT_SEAT };
    case "is drawn as the whale":
      return { tick, kind: "whaleDrawn", whaleSeat: SUBJECT_SEAT, sandwichBox: 1, endTick: tick + TIMING.roundTicks };
    case "time passes":
    case "a frame renders":
      return null;
  }
}

function applyCommand(springs: SpringMirror, command: BodyCommand): SpringMirror {
  switch (command) {
    case "appear":
      return { ...springs, appearTarget: 1, rise: "appear" };
    case "hide":
      return { ...springs, swatWhipTarget: 1, bonkTarget: 1, rise: "appear", isTongueOut: false };
    case "flatten":
      return { ...springs, swatWhipTarget: 0, rise: "swatWhip", isTongueOut: true };
    case "releaseFlatten":
      return { ...springs, swatWhipTarget: 1, isTongueOut: false };
    case "bonk":
      return { ...springs, bonkTarget: 0 };
    case "releaseBonk":
      return { ...springs, bonkTarget: 1 };
  }
}

function riseTarget(springs: SpringMirror): 0 | 1 {
  return springs.rise === "appear" ? springs.appearTarget : springs.swatWhipTarget;
}

function brokenRuleFor(pose: SeatPose, springs: SpringMirror): string | null {
  if (pose.kind === "hidden") return springs.isTongueOut ? "a hidden pigeon keeps its tongue out" : null;
  if (pose.kind === "stunned" && pose.cause === "swat") {
    const isFlat = springs.rise === "swatWhip" && springs.swatWhipTarget === 0;
    if (!isFlat) return "a swatted pigeon is not held flat";
    if (!springs.isTongueOut) return "a swatted pigeon has no tongue out";
    return springs.bonkTarget === 1 ? null : "a swatted pigeon is still tilted from a bonk";
  }
  if (pose.kind === "stunned") {
    if (springs.bonkTarget !== 0) return "a bonked pigeon is not tilted";
    if (springs.isTongueOut) return "a bonked pigeon has its tongue out";
    return riseTarget(springs) === 1 ? null : "a bonked pigeon stays flat from an earlier swat";
  }
  if (riseTarget(springs) !== 1) return `a ${pose.kind} pigeon stays flat`;
  if (springs.bonkTarget !== 1) return `a ${pose.kind} pigeon stays tilted`;
  return springs.isTongueOut ? `a ${pose.kind} pigeon keeps its tongue out` : null;
}

function poseAt(node: Node): SeatPose {
  const director = createRoundDirector(roundWith(node.events));
  director.advanceTo(node.tick);
  return director.poseOf(SUBJECT_SEAT, node.tick);
}

function poseKey(pose: SeatPose): string {
  switch (pose.kind) {
    case "flying":
      return `flying:${pose.from === "hover" ? "hover" : "perch"}>${pose.to === "hover" ? "hover" : "perch"}`;
    case "stunned":
      return `stunned:${pose.cause}`;
    default:
      return pose.kind;
  }
}

function stateKey(node: Node): string {
  const { memory, springs } = node;
  return [poseKey(poseAt(node)), memory.body, memory.isShown, springs.appearTarget, springs.swatWhipTarget, springs.bonkTarget, springs.rise, springs.isTongueOut].join("|");
}

function successor(node: Node, step: Step): { node: Node; brokenRule: string | null } {
  const tick = node.tick + (step === "time passes" ? WAIT_TICKS : step === "a frame renders" ? 0 : TICK_STEP);
  const event = eventFor(step, tick);
  const next: Node = { path: [...node.path, step], events: event ? [...node.events, event] : node.events, tick, memory: { ...node.memory }, springs: node.springs };
  if (step !== "a frame renders") return { node: next, brokenRule: null };
  const pose = poseAt(next);
  const commands = stepBody(next.memory, pose.kind === "hidden", pose.kind === "stunned" ? pose.cause : null);
  next.springs = commands.reduce(applyCommand, node.springs);
  return { node: next, brokenRule: brokenRuleFor(pose, next.springs) };
}

function explorePigeonLife(): { statesSeen: number; isExhausted: boolean; counterexample: { path: readonly Step[]; rule: string } | null } {
  const start: Node = {
    path: [],
    events: [],
    tick: 0,
    memory: createBodyMemory(),
    springs: { appearTarget: 1, swatWhipTarget: 1, bonkTarget: 1, rise: "appear", isTongueOut: false },
  };
  const seen = new Set<string>([stateKey(start)]);
  let frontier: Node[] = [start];
  for (let depth = 0; depth < MAX_DEPTH && frontier.length > 0; depth++) {
    const nextFrontier: Node[] = [];
    for (const node of frontier) {
      for (const step of STEPS) {
        const { node: next, brokenRule } = successor(node, step);
        if (brokenRule) return { statesSeen: seen.size, isExhausted: false, counterexample: { path: next.path, rule: brokenRule } };
        const key = stateKey(next);
        if (seen.has(key)) continue;
        seen.add(key);
        nextFrontier.push(next);
      }
    }
    frontier = nextFrontier;
  }
  return { statesSeen: seen.size, isExhausted: frontier.length === 0, counterexample: null };
}

function describeCounterexample(result: ReturnType<typeof explorePigeonLife>): string {
  if (!result.counterexample) return "no counterexample";
  return `${result.counterexample.rule}, after: ${result.counterexample.path.map((step, index) => `${index + 1}. ${step}`).join("; ")}`;
}

describe("a pigeon's body always matches what the chain says it is doing", () => {
  test("every reachable mix of round events and frames, including several events between two frames", () => {
    const result = explorePigeonLife();
    console.info(`[pigeonLifeCheck] ${result.statesSeen} states, every state explored: ${result.isExhausted}`);
    expect(describeCounterexample(result)).toBe("no counterexample");
    expect(result.isExhausted).toBe(true);
    expect(result.statesSeen).toBeGreaterThan(20);
  });
});

