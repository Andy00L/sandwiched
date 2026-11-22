import type { GuestStage, GuestStep } from "./guest-steps";
import type { RecordedRound } from "./round-events";
import type { TableListing } from "./table-listings";

export type Role = "whale" | "pigeon";

export type PigeonTally = { seat: number; name: string; crumbs: number };

export type RoundSummary = {
  roundNumber: number;
  whaleCrumbs: number;
  pigeonCrumbs: number;
  ownSeat: number;
  ownRole: Role;
  ownCrumbs: number;
  topPigeons: readonly PigeonTally[];
};

export type SeatSheet = { phase: "choosing" } | { phase: "seating"; step: GuestStep | null } | { phase: "failed"; step: GuestStep; reason: string };

export type TableOverlay = { kind: "none" } | { kind: "role"; role: Role; roundNumber: number } | { kind: "results"; summary: RoundSummary };

export type PlayFlow =
  | { kind: "home" }
  | { kind: "seat"; table: TableListing; sheet: SeatSheet }
  | { kind: "table"; table: TableListing; overlay: TableOverlay }
  | { kind: "fault"; reason: string };

export type Drawer = "help" | "settings";

export type PlayState = {
  flow: PlayFlow;
  drawer: Drawer | null;
  lastRoleRound: number | null;
  lastResultsRound: number | null;
  currentRole: Role | null;
  hasActed: boolean;
};

export type PlayEvent =
  | { kind: "pickTable"; table: TableListing }
  | { kind: "goHome" }
  | { kind: "playNow" }
  | { kind: "seatStage"; stage: GuestStage }
  | { kind: "roundLive"; roundNumber: number; role: Role }
  | { kind: "roleSeen"; roundNumber: number }
  | { kind: "roundSettled"; summary: RoundSummary }
  | { kind: "anteAgain" }
  | { kind: "acted" }
  | { kind: "toggleDrawer"; drawer: Drawer }
  | { kind: "closeDrawer" }
  | { kind: "fault"; reason: string };

export const INITIAL_PLAY_STATE: PlayState = { flow: { kind: "home" }, drawer: null, lastRoleRound: null, lastResultsRound: null, currentRole: null, hasActed: false };

const TOP_PIGEON_COUNT = 3;

const withFlow = (state: PlayState, flow: PlayFlow): PlayState => ({ ...state, flow });

function stepSeatStage(state: PlayState, stage: GuestStage): PlayState {
  const { flow } = state;
  if (flow.kind !== "seat" || flow.sheet.phase !== "seating") return state;
  switch (stage.kind) {
    case "preparing":
      return withFlow(state, { ...flow, sheet: { phase: "seating", step: stage.step } });
    case "ready":
      return withFlow(state, { kind: "table", table: flow.table, overlay: { kind: "none" } });
    case "failed":
      return withFlow(state, { ...flow, sheet: { phase: "failed", step: stage.step, reason: stage.reason } });
  }
}

export function stepPlay(state: PlayState, event: PlayEvent): PlayState {
  const { flow } = state;
  switch (event.kind) {
    case "pickTable":
      return flow.kind === "home" ? withFlow(state, { kind: "seat", table: event.table, sheet: { phase: "choosing" } }) : state;
    case "goHome":
      return flow.kind === "seat" && flow.sheet.phase !== "seating" ? withFlow(state, { kind: "home" }) : state;
    case "playNow":
      return flow.kind === "seat" && flow.sheet.phase !== "seating" ? withFlow(state, { ...flow, sheet: { phase: "seating", step: null } }) : state;
    case "seatStage":
      return stepSeatStage(state, event.stage);
    case "roundLive":
      if (flow.kind !== "table" || flow.overlay.kind !== "none" || state.lastRoleRound === event.roundNumber) return state;
      return { ...withFlow(state, { ...flow, overlay: { kind: "role", role: event.role, roundNumber: event.roundNumber } }), lastRoleRound: event.roundNumber, currentRole: event.role };
    case "roleSeen":
      return flow.kind === "table" && flow.overlay.kind === "role" && flow.overlay.roundNumber === event.roundNumber ? withFlow(state, { ...flow, overlay: { kind: "none" } }) : state;
    case "roundSettled":
      if (flow.kind !== "table" || state.lastResultsRound === event.summary.roundNumber) return state;
      return { ...withFlow(state, { ...flow, overlay: { kind: "results", summary: event.summary } }), lastResultsRound: event.summary.roundNumber };
    case "anteAgain":
      return flow.kind === "table" && flow.overlay.kind === "results" ? withFlow(state, { ...flow, overlay: { kind: "none" } }) : state;
    case "acted":
      return state.hasActed ? state : { ...state, hasActed: true };
    case "toggleDrawer":
      return { ...state, drawer: state.drawer === event.drawer ? null : event.drawer };
    case "closeDrawer":
      return state.drawer === null ? state : { ...state, drawer: null };
    case "fault":
      return withFlow(state, { kind: "fault", reason: event.reason });
  }
}

export function readHintRole(state: PlayState): Role | null {
  return state.hasActed || !isTableOpenForPlay(state) ? null : state.currentRole;
}

export function isTableOpenForPlay(state: PlayState): boolean {
  return state.drawer === null && state.flow.kind === "table" && state.flow.overlay.kind === "none";
}

export function summarizeRound(roundNumber: number, round: RecordedRound, ownSeat: number): RoundSummary | null {
  const settled = round.events.findLast((event) => event.kind === "settled");
  const drawn = round.events.find((event) => event.kind === "whaleDrawn");
  if (settled?.kind !== "settled" || drawn?.kind !== "whaleDrawn") return null;
  const isWhale = drawn.whaleSeat === ownSeat;
  const ownBeak = settled.beaks.find((beak) => beak.seat === ownSeat);
  if (!isWhale && ownBeak === undefined) return null;
  const nameOf = (seat: number) => round.players.find((player) => player.seat === seat)?.name ?? `Seat ${seat + 1}`;
  const topPigeons = settled.beaks
    .toSorted((left, right) => right.crumbs - left.crumbs)
    .slice(0, TOP_PIGEON_COUNT)
    .map((beak) => ({ seat: beak.seat, name: nameOf(beak.seat), crumbs: beak.crumbs }));
  return {
    roundNumber,
    whaleCrumbs: settled.whaleCrumbs,
    pigeonCrumbs: settled.pigeonCrumbs,
    ownSeat,
    ownRole: isWhale ? "whale" : "pigeon",
    ownCrumbs: isWhale ? settled.whaleCrumbs : (ownBeak?.crumbs ?? 0),
    topPigeons,
  };
}

export const ROUND_TITLES = {
  sandwiched: "THE WHALE GOT SANDWICHED",
  shared: "LUNCH WAS SHARED. NOT WILLINGLY.",
  mostly: "THE WHALE ATE MOST OF IT",
  hungry: "THE PIGEONS GO HUNGRY",
} as const;

export function chooseRoundTitle(summary: Pick<RoundSummary, "whaleCrumbs" | "pigeonCrumbs">): string {
  const pot = summary.whaleCrumbs + summary.pigeonCrumbs;
  const whaleShare = pot === 0 ? 1 : summary.whaleCrumbs / pot;
  if (whaleShare < 0.2) return ROUND_TITLES.sandwiched;
  if (whaleShare < 0.5) return ROUND_TITLES.shared;
  if (whaleShare <= 0.8) return ROUND_TITLES.mostly;
  return ROUND_TITLES.hungry;
}
