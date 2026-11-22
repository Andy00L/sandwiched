import type { RoundSnapshot, SeatSnapshot, TableSnapshot } from "../chain/accounts";
import { applyLandedSwats, countDroppedCrumbs, readChainPigeon, readPigeonBox, readPigeonView, settlePigeonAt } from "./chain-rules";
import type { PeckedEvent, RoundEvent, RoundTiming, SwatLandedEvent } from "./round-events";
import { applyRoundEvent, type PigeonView, type RoundViewState, type SeatView } from "./view-state";

export type ChainFrame = {
  tick: number;
  table: TableSnapshot | null;
  seats: ReadonlyMap<number, SeatSnapshot>;
};

export const EMPTY_CHAIN_FRAME: ChainFrame = { tick: 0, table: null, seats: new Map() };

type ActionStep = "join" | "ante" | "draw" | "raise" | "seat" | "settle";

const STEP_ORDER: Readonly<Record<ActionStep, number>> = { join: 0, ante: 1, draw: 2, raise: 3, seat: 4, settle: 5 };

type SettleAction = { tick: number; step: "settle"; whaleCrumbs: number; pigeonCrumbs: number; round: RoundSnapshot };

type ChainAction =
  | { tick: number; step: Exclude<ActionStep, "seat" | "settle">; event: RoundEvent }
  | SettleAction
  | { tick: number; step: "seat"; seat: number; before: SeatSnapshot | null; after: SeatSnapshot };

type TickBounds = { floor: number; ceiling: number };

function clampTick(tick: number, bounds: TickBounds): number {
  return Math.min(Math.max(tick, bounds.floor), bounds.ceiling);
}

function isSettlement(previousTable: TableSnapshot | null, table: TableSnapshot): boolean {
  return (
    previousTable !== null &&
    previousTable.phase.state === "live" &&
    table.lastResult !== null &&
    table.lastResult.roundNumber === previousTable.roundNumber
  );
}

function countKnownSwats(previousTable: TableSnapshot | null, table: TableSnapshot): number {
  if (previousTable === null) {
    const latestSwat = table.round.swats.find((swat) => swat.number === table.round.swatCount);
    const isLatestSwatInTheAir = latestSwat !== undefined && Number(latestSwat.landsTick) > table.slot;
    return Number(table.round.swatCount) - (isLatestSwatInTheAir ? 1 : 0);
  }
  const isSameLiveRound = previousTable.roundNumber === table.roundNumber && previousTable.phase.state === "live";
  return isSameLiveRound ? Number(previousTable.round.swatCount) : 0;
}

function listRaiseActions(previousTable: TableSnapshot | null, table: TableSnapshot, timing: RoundTiming, bounds: TickBounds): ChainAction[] {
  if (table.phase.state !== "live") return [];
  const knownSwatCount = countKnownSwats(previousTable, table);
  return table.round.swats
    .filter((swat) => Number(swat.number) > knownSwatCount)
    .sort((left, right) => Number(left.number - right.number))
    .map((swat): ChainAction => {
      const landsTick = Number(swat.landsTick);
      const tick = clampTick(landsTick - timing.swatWindupTicks, bounds);
      return {
        tick,
        step: "raise",
        event: { tick, kind: "handRaised", box: swat.box, swatNumber: Number(swat.number), landsTick },
      };
    });
}

function listTableActions(previousTable: TableSnapshot | null, table: TableSnapshot | null, timing: RoundTiming, bounds: TickBounds): ChainAction[] {
  if (table === null || table === previousTable) return [];
  const actions: ChainAction[] = [];
  const isSameRound = previousTable !== null && previousTable.roundNumber === table.roundNumber;
  const wasLive = isSameRound && previousTable.phase.state === "live";
  const drawTick = table.phase.state === "live" && !wasLive ? Number(table.round.endTick) - timing.roundTicks : null;
  const lobbyTick = clampTick(drawTick === null ? table.slot : Math.min(table.slot, drawTick), bounds);
  table.seats.forEach((wallet, seat) => {
    const previousWallet = previousTable?.seats[seat] ?? null;
    if (wallet !== null && (previousWallet === null || !previousWallet.equals(wallet))) {
      actions.push({ tick: lobbyTick, step: "join", event: { tick: lobbyTick, kind: "seatJoined", seat } });
    }
  });
  const previouslyAnted = new Set(isSameRound ? previousTable.antedSeatIndexes : []);
  for (const seat of table.antedSeatIndexes.filter((antedSeat) => !previouslyAnted.has(antedSeat))) {
    actions.push({ tick: lobbyTick, step: "ante", event: { tick: lobbyTick, kind: "anted", seat } });
  }
  if (drawTick !== null && table.phase.state === "live") {
    const tick = clampTick(drawTick, bounds);
    actions.push({
      tick,
      step: "draw",
      event: {
        tick,
        kind: "whaleDrawn",
        whaleSeat: table.phase.whaleSeat,
        sandwichBox: table.round.sandwichBox,
        endTick: Number(table.round.endTick),
      },
    });
  }
  actions.push(...listRaiseActions(previousTable, table, timing, bounds));
  if (isSettlement(previousTable, table) && table.lastResult !== null) {
    actions.push({
      tick: clampTick(table.slot, bounds),
      step: "settle",
      whaleCrumbs: Number(table.lastResult.whaleCrumbs),
      pigeonCrumbs: Number(table.lastResult.pigeonCrumbs),
      round: table.round,
    });
  }
  return actions;
}

function hasPecked(before: SeatSnapshot | null, after: SeatSnapshot): boolean {
  return before !== null && after.nextPeckTick > before.nextPeckTick;
}

function deriveSeatActionTick(before: SeatSnapshot | null, after: SeatSnapshot, timing: RoundTiming): number {
  if (hasPecked(before, after)) return Number(after.nextPeckTick) - timing.peckCooldownTicks;
  if (after.pigeon.state === "flying") return Number(after.pigeon.landsTick) - timing.flightTicks;
  return after.slot;
}

function listSeatActions(previous: ChainFrame, next: ChainFrame, timing: RoundTiming, bounds: TickBounds): ChainAction[] {
  const actions: ChainAction[] = [];
  for (const [seat, after] of next.seats) {
    const before = previous.seats.get(seat) ?? null;
    if (after === before) continue;
    actions.push({ tick: clampTick(deriveSeatActionTick(before, after, timing), bounds), step: "seat", seat, before, after });
  }
  return actions;
}

function compareActions(left: ChainAction, right: ChainAction): number {
  if (left.tick !== right.tick) return left.tick - right.tick;
  const stepGap = STEP_ORDER[left.step] - STEP_ORDER[right.step];
  if (stepGap !== 0) return stepGap;
  return left.step === "seat" && right.step === "seat" ? left.seat - right.seat : 0;
}

function isRoundPigeon(seat: SeatView): boolean {
  return seat.role === "pigeon" && seat.presence === "anted";
}

export function findNextDueTick(view: RoundViewState): number | null {
  if (view.phase !== "live") return null;
  const dueTicks = view.seats.flatMap((seat) => {
    if (seat.pigeon.state === "flying") return [seat.pigeon.landsTick];
    if (seat.pigeon.state === "stunned") return [seat.pigeon.untilTick];
    return [];
  });
  if (view.hand.state === "raised") dueTicks.push(view.hand.landsTick);
  return dueTicks.length === 0 ? null : Math.min(...dueTicks);
}

function listArrivals(view: RoundViewState, tick: number): RoundEvent[] {
  return view.seats.flatMap((seat): RoundEvent[] => {
    if (seat.pigeon.state === "flying" && seat.pigeon.landsTick <= tick) {
      return [{ tick, kind: "landed", seat: seat.seat, box: seat.pigeon.box }];
    }
    if (seat.pigeon.state === "stunned" && seat.pigeon.untilTick <= tick) return [{ tick, kind: "stunEnded", seat: seat.seat }];
    return [];
  });
}

function findSwatNumber(table: TableSnapshot | null, box: number, landsTick: number): number {
  const swat = table?.round.swats.find((candidate) => candidate.box === box && Number(candidate.landsTick) === landsTick);
  return Number(swat?.number ?? table?.round.swatCount ?? 0n);
}

function deriveSwatLanding(view: RoundViewState, table: TableSnapshot | null, tick: number, timing: RoundTiming): SwatLandedEvent | null {
  if (view.hand.state !== "raised" || view.hand.landsTick > tick) return null;
  const { box, landsTick } = view.hand;
  const isBeforeRoundEnd = view.endTick === null || landsTick <= view.endTick;
  const hits = isBeforeRoundEnd
    ? view.seats
        .filter((seat) => isRoundPigeon(seat) && seat.pigeon.state === "perched" && seat.pigeon.box === box)
        .map((seat) => ({ seat: seat.seat, droppedCrumbs: countDroppedCrumbs(seat.beakCrumbs), untilTick: landsTick + timing.swatStunTicks }))
    : [];
  return { tick, kind: "swatLanded", box, swatNumber: findSwatNumber(table, box, landsTick), hits };
}

function countOwedCrumbs(view: RoundViewState, frame: ChainFrame, peckingSeat: number, box: number, peckTick: number, timing: RoundTiming): number {
  const table = frame.table;
  if (table === null) return 0;
  const roundPigeonSeats = new Set(view.seats.filter(isRoundPigeon).map((seat) => seat.seat));
  let owedCrumbs = 0;
  for (const [seatIndex, seat] of frame.seats) {
    if (seatIndex === peckingSeat || !roundPigeonSeats.has(seatIndex)) continue;
    const { drops } = applyLandedSwats(readChainPigeon(seat), table.round, peckTick, timing);
    owedCrumbs += drops.filter((drop) => drop.box === box).reduce((total, drop) => total + drop.crumbs, 0);
  }
  return owedCrumbs;
}

function derivePeck(
  view: RoundViewState,
  frame: ChainFrame,
  seatView: SeatView,
  after: SeatSnapshot,
  tick: number,
  timing: RoundTiming,
): PeckedEvent | null {
  const chainPigeon = readPigeonView(after.pigeon);
  const box = readPigeonBox(seatView.pigeon) ?? readPigeonBox(chainPigeon);
  if (box === null) return null;
  const peckTick = Number(after.nextPeckTick) - timing.peckCooldownTicks;
  if (chainPigeon.state === "stunned" && chainPigeon.untilTick === peckTick + timing.emptyBoxStunTicks) {
    return { tick, kind: "pecked", seat: seatView.seat, box, outcome: "emptyBox", untilTick: chainPigeon.untilTick };
  }
  const reachableLooseCrumbs = (view.looseCrumbs[box] ?? 0) - countOwedCrumbs(view, frame, seatView.seat, box, peckTick, timing);
  return { tick, kind: "pecked", seat: seatView.seat, box, outcome: reachableLooseCrumbs > 0 ? "looseCrumb" : "sandwichCrumb" };
}

function reconcilePosition(seat: number, viewPigeon: PigeonView, chainPigeon: PigeonView, tick: number): RoundEvent[] {
  switch (chainPigeon.state) {
    case "hovering":
      return viewPigeon.state === "hovering" ? [] : [{ tick, kind: "tookOff", seat }];
    case "flying": {
      const isSameFlight =
        viewPigeon.state === "flying" && viewPigeon.box === chainPigeon.box && viewPigeon.landsTick === chainPigeon.landsTick;
      return isSameFlight ? [] : [{ tick, kind: "flew", seat, box: chainPigeon.box, landsTick: chainPigeon.landsTick }];
    }
    case "perched":
    case "stunned": {
      return readPigeonBox(viewPigeon) === chainPigeon.box
        ? []
        : [
            { tick, kind: "flew", seat, box: chainPigeon.box, landsTick: tick },
            { tick, kind: "landed", seat, box: chainPigeon.box },
          ];
    }
  }
}

function readSettledBeak(
  seat: SeatView,
  before: SeatSnapshot | undefined,
  after: SeatSnapshot | undefined,
  settle: SettleAction,
  timing: RoundTiming,
): number {
  if (before !== undefined && after !== undefined && after !== before && after.wallet.equals(before.wallet)) {
    return Number(after.chips - before.chips);
  }
  const endTick = Number(settle.round.endTick);
  if (before === undefined || before.slot >= endTick) return seat.beakCrumbs;
  return applyLandedSwats(readChainPigeon(before), settle.round, endTick, timing).after.beakCrumbs;
}

export function deriveRoundEvents(view: RoundViewState, previous: ChainFrame, next: ChainFrame, timing: RoundTiming): RoundEvent[] {
  const bounds: TickBounds = { floor: previous.tick, ceiling: next.tick };
  const actions = [
    ...listTableActions(previous.table, next.table, timing, bounds),
    ...listSeatActions(previous, next, timing, bounds),
  ].sort(compareActions);
  const events: RoundEvent[] = [];
  let working = view;
  const emit = (event: RoundEvent) => {
    events.push(event);
    working = applyRoundEvent(working, event);
  };
  const findSeatView = (seat: number) => working.seats.find((seatView) => seatView.seat === seat);
  const applyAction = (action: ChainAction) => {
    switch (action.step) {
      case "join":
      case "ante":
      case "draw":
      case "raise":
        emit(action.event);
        return;
      case "settle":
        emit({
          tick: action.tick,
          kind: "settled",
          whaleCrumbs: action.whaleCrumbs,
          pigeonCrumbs: action.pigeonCrumbs,
          beaks: working.seats.filter(isRoundPigeon).map((seat) => ({
            seat: seat.seat,
            crumbs: readSettledBeak(seat, previous.seats.get(seat.seat), next.seats.get(seat.seat), action, timing),
          })),
        });
        return;
      case "seat": {
        const seatView = findSeatView(action.seat);
        if (working.phase !== "live" || seatView === undefined || !isRoundPigeon(seatView)) return;
        const peck = hasPecked(action.before, action.after) ? derivePeck(working, next, seatView, action.after, action.tick, timing) : null;
        if (peck !== null) emit(peck);
        const chainPigeon = settlePigeonAt(readPigeonView(action.after.pigeon), action.tick);
        const settledSeatView = findSeatView(action.seat);
        if (settledSeatView === undefined) return;
        for (const event of reconcilePosition(action.seat, settledSeatView.pigeon, chainPigeon, action.tick)) emit(event);
        return;
      }
    }
  };
  let cursor = previous.tick;
  let actionIndex = 0;
  for (;;) {
    const nextAction = actions[actionIndex];
    const dueTick = findNextDueTick(working);
    const candidateTicks = [nextAction?.tick, dueTick ?? undefined].filter((tick) => tick !== undefined);
    if (candidateTicks.length === 0) break;
    const tick = Math.max(cursor, Math.min(...candidateTicks));
    if (tick > next.tick) break;
    cursor = tick;
    if (dueTick !== null && dueTick <= tick) {
      for (const arrival of listArrivals(working, tick)) emit(arrival);
      const swatLanding = deriveSwatLanding(working, next.table, tick, timing);
      if (swatLanding !== null) emit(swatLanding);
      continue;
    }
    if (nextAction === undefined) break;
    applyAction(nextAction);
    actionIndex += 1;
  }
  return events;
}
