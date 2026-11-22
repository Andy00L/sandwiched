export type BodyState = "up" | "flattened" | "bonked";
export type BodyAction = "flatten" | "releaseFlatten" | "bonk" | "releaseBonk";
export type BodyCommand = BodyAction | "appear" | "hide";

export interface BodyMemory {
  body: BodyState;
  isShown: boolean;
}

const BODY_STATES: readonly BodyState[] = ["up", "flattened", "bonked"];
const EXIT_ACTIONS: Record<BodyState, readonly BodyAction[]> = { up: [], flattened: ["releaseFlatten"], bonked: ["releaseBonk"] };
const ENTER_ACTIONS: Record<BodyState, readonly BodyAction[]> = { up: [], flattened: ["flatten"], bonked: ["bonk"] };
const NO_COMMANDS: readonly BodyCommand[] = [];
const HIDE_COMMANDS: readonly BodyCommand[] = ["hide"];

function transitionKey(from: BodyState, to: BodyState): string {
  return `${from}>${to}`;
}

const TRANSITION_ACTIONS = new Map<string, readonly BodyAction[]>(
  BODY_STATES.flatMap((from) => BODY_STATES.map((to): [string, readonly BodyAction[]] => [transitionKey(from, to), from === to ? [] : [...EXIT_ACTIONS[from], ...ENTER_ACTIONS[to]]])),
);
const APPEAR_COMMANDS = new Map<BodyState, readonly BodyCommand[]>(BODY_STATES.map((to): [BodyState, readonly BodyCommand[]] => [to, ["appear", ...ENTER_ACTIONS[to]]]));

export function bodyStateFor(stunCause: "bonk" | "swat" | null): BodyState {
  if (stunCause === "swat") return "flattened";
  if (stunCause === "bonk") return "bonked";
  return "up";
}

export function bodyTransitionActions(from: BodyState, to: BodyState): readonly BodyAction[] {
  return TRANSITION_ACTIONS.get(transitionKey(from, to)) ?? [];
}

export function createBodyMemory(): BodyMemory {
  return { body: "up", isShown: false };
}

export function stepBody(memory: BodyMemory, isHidden: boolean, stunCause: "bonk" | "swat" | null): readonly BodyCommand[] {
  if (isHidden) {
    if (!memory.isShown) return NO_COMMANDS;
    memory.isShown = false;
    return HIDE_COMMANDS;
  }
  const next = bodyStateFor(stunCause);
  const commands = memory.isShown ? bodyTransitionActions(memory.body, next) : (APPEAR_COMMANDS.get(next) ?? NO_COMMANDS);
  memory.isShown = true;
  memory.body = next;
  return commands;
}
