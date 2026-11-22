import type {
  PeckedEvent,
  RecordedRound,
  RoundEvent,
  SwatLandedEvent,
} from "./round-events";

export type RoundPhase = "lobby" | "live" | "settled";

export type PigeonView =
  | { state: "hovering" }
  | { state: "flying"; box: number; landsTick: number }
  | { state: "perched"; box: number }
  | { state: "stunned"; box: number; untilTick: number };

export type HandView = { state: "idle" } | { state: "raised"; box: number; landsTick: number };

export type SeatPresence = "away" | "seated" | "anted";

export type SeatView = {
  seat: number;
  name: string;
  variant: number;
  presence: SeatPresence;
  role: "whale" | "pigeon";
  pigeon: PigeonView;
  beakCrumbs: number;
};

export type RoundViewState = {
  phase: RoundPhase;
  tick: number;
  endTick: number | null;
  whaleSeat: number | null;
  sandwichBox: number | null;
  chipsPerAnte: number;
  pot: number;
  looseCrumbs: readonly number[];
  hand: HandView;
  seats: readonly SeatView[];
  settlement: { whaleCrumbs: number; pigeonCrumbs: number } | null;
};

const IDLE_HAND: HandView = { state: "idle" };
const HOVERING: PigeonView = { state: "hovering" };

export function createViewState(round: RecordedRound): RoundViewState {
  return {
    phase: "lobby",
    tick: 0,
    endTick: null,
    whaleSeat: null,
    sandwichBox: null,
    chipsPerAnte: round.chipsPerAnte,
    pot: 0,
    looseCrumbs: Array.from({ length: round.boxCount }, () => 0),
    hand: IDLE_HAND,
    seats: round.players.map((player) => ({
      seat: player.seat,
      name: player.name,
      variant: player.variant,
      presence: "away",
      role: "pigeon",
      pigeon: HOVERING,
      beakCrumbs: 0,
    })),
    settlement: null,
  };
}

function updateSeat(
  seats: readonly SeatView[],
  seatNumber: number,
  update: (seat: SeatView) => SeatView,
): readonly SeatView[] {
  return seats.map((seat) => (seat.seat === seatNumber ? update(seat) : seat));
}

function addToBox(looseCrumbs: readonly number[], boxIndex: number, crumbs: number): readonly number[] {
  return looseCrumbs.map((loose, index) => (index === boxIndex ? loose + crumbs : loose));
}

function applyPeck(state: RoundViewState, event: PeckedEvent): RoundViewState {
  switch (event.outcome) {
    case "looseCrumb":
      return {
        ...state,
        looseCrumbs: addToBox(state.looseCrumbs, event.box, -1),
        seats: updateSeat(state.seats, event.seat, (seat) => ({
          ...seat,
          beakCrumbs: seat.beakCrumbs + 1,
        })),
      };
    case "sandwichCrumb":
      return {
        ...state,
        pot: state.pot - 1,
        seats: updateSeat(state.seats, event.seat, (seat) => ({
          ...seat,
          beakCrumbs: seat.beakCrumbs + 1,
        })),
      };
    case "emptyBox":
      return {
        ...state,
        seats: updateSeat(state.seats, event.seat, (seat) => ({
          ...seat,
          pigeon: { state: "stunned", box: event.box, untilTick: event.untilTick },
        })),
      };
  }
}

function applySwat(state: RoundViewState, event: SwatLandedEvent): RoundViewState {
  const droppedCrumbs = event.hits.reduce((total, hit) => total + hit.droppedCrumbs, 0);
  const hitBySeat = new Map(event.hits.map((hit) => [hit.seat, hit]));
  return {
    ...state,
    hand: IDLE_HAND,
    looseCrumbs: addToBox(state.looseCrumbs, event.box, droppedCrumbs),
    seats: state.seats.map((seat) => {
      const hit = hitBySeat.get(seat.seat);
      return hit === undefined
        ? seat
        : {
            ...seat,
            beakCrumbs: seat.beakCrumbs - hit.droppedCrumbs,
            pigeon: { state: "stunned", box: event.box, untilTick: hit.untilTick },
          };
    }),
  };
}

function endStun(seat: SeatView): SeatView {
  return seat.pigeon.state === "stunned"
    ? { ...seat, pigeon: { state: "perched", box: seat.pigeon.box } }
    : seat;
}

export function applyRoundEvent(state: RoundViewState, event: RoundEvent): RoundViewState {
  const advanced: RoundViewState = { ...state, tick: event.tick };
  switch (event.kind) {
    case "seatJoined":
      return {
        ...advanced,
        seats: updateSeat(state.seats, event.seat, (seat) => ({ ...seat, presence: "seated" })),
      };
    case "anted":
      return {
        ...advanced,
        pot: state.pot + state.chipsPerAnte,
        seats: updateSeat(state.seats, event.seat, (seat) => ({ ...seat, presence: "anted" })),
      };
    case "whaleDrawn":
      return {
        ...advanced,
        phase: "live",
        endTick: event.endTick,
        whaleSeat: event.whaleSeat,
        sandwichBox: event.sandwichBox,
        seats: updateSeat(state.seats, event.whaleSeat, (seat) => ({ ...seat, role: "whale" })),
      };
    case "flew":
      return {
        ...advanced,
        seats: updateSeat(state.seats, event.seat, (seat) => ({
          ...seat,
          pigeon: { state: "flying", box: event.box, landsTick: event.landsTick },
        })),
      };
    case "landed":
      return {
        ...advanced,
        seats: updateSeat(state.seats, event.seat, (seat) => ({
          ...seat,
          pigeon: { state: "perched", box: event.box },
        })),
      };
    case "tookOff":
      return {
        ...advanced,
        seats: updateSeat(state.seats, event.seat, (seat) => ({ ...seat, pigeon: HOVERING })),
      };
    case "pecked":
      return applyPeck(advanced, event);
    case "handRaised":
      return {
        ...advanced,
        hand: { state: "raised", box: event.box, landsTick: event.landsTick },
      };
    case "swatLanded":
      return applySwat(advanced, event);
    case "stunEnded":
      return { ...advanced, seats: updateSeat(state.seats, event.seat, endStun) };
    case "settled":
      return {
        ...advanced,
        phase: "settled",
        hand: IDLE_HAND,
        settlement: { whaleCrumbs: event.whaleCrumbs, pigeonCrumbs: event.pigeonCrumbs },
      };
  }
}

export function viewStateAt(round: RecordedRound, tick: number): RoundViewState {
  let state = createViewState(round);
  for (const event of round.events) {
    if (event.tick > tick) {
      break;
    }
    state = applyRoundEvent(state, event);
  }
  return { ...state, tick };
}
