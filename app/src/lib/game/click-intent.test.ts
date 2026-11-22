import { describe, expect, test } from "bun:test";
import { intentForClick } from "./click-intent";
import type { PigeonView, RoundViewState, SeatView } from "./view-state";

const OWN_SEAT = 2;
const WHALE_SEAT = 0;

const seatOf = (seat: number, pigeon: PigeonView, role: SeatView["role"] = "pigeon", presence: SeatView["presence"] = "anted"): SeatView => ({
  seat,
  name: `seat ${seat}`,
  variant: seat,
  presence,
  role,
  pigeon,
  beakCrumbs: 0,
});

const viewWith = (ownPigeon: PigeonView, overrides: Partial<RoundViewState> = {}): RoundViewState => ({
  phase: "live",
  tick: 100,
  endTick: 4_600,
  whaleSeat: WHALE_SEAT,
  sandwichBox: 1,
  chipsPerAnte: 100,
  pot: 300,
  looseCrumbs: [0, 0, 0],
  hand: { state: "idle" },
  seats: [seatOf(WHALE_SEAT, { state: "hovering" }, "whale"), seatOf(1, { state: "hovering" }), seatOf(OWN_SEAT, ownPigeon)],
  settlement: null,
  ...overrides,
});

describe("intentForClick", () => {
  test("a pigeon flies to a box it is not on, pecks the box it perches on, and takes off from anywhere else", () => {
    expect(intentForClick(viewWith({ state: "hovering" }), OWN_SEAT, { kind: "box", box: 2 })).toEqual({ actor: "pigeon", intent: { kind: "flyTo", box: 2 } });
    expect(intentForClick(viewWith({ state: "perched", box: 2 }), OWN_SEAT, { kind: "box", box: 2 })).toEqual({ actor: "pigeon", intent: { kind: "peck" } });
    expect(intentForClick(viewWith({ state: "perched", box: 2 }), OWN_SEAT, { kind: "box", box: 0 })).toEqual({ actor: "pigeon", intent: { kind: "flyTo", box: 0 } });
    expect(intentForClick(viewWith({ state: "perched", box: 2 }), OWN_SEAT, { kind: "ground" })).toEqual({ actor: "pigeon", intent: { kind: "takeOff" } });
  });

  test("a stunned pigeon, a hovering pigeon clicking the ground, and a pigeon already flying to that box do nothing", () => {
    expect(intentForClick(viewWith({ state: "stunned", box: 2, untilTick: 300 }), OWN_SEAT, { kind: "box", box: 0 })).toBeNull();
    expect(intentForClick(viewWith({ state: "hovering" }), OWN_SEAT, { kind: "ground" })).toBeNull();
    expect(intentForClick(viewWith({ state: "flying", box: 1, landsTick: 150 }), OWN_SEAT, { kind: "box", box: 1 })).toBeNull();
  });

  test("the whale swats the clicked box only while its hand is down", () => {
    const view = viewWith({ state: "hovering" });
    expect(intentForClick(view, WHALE_SEAT, { kind: "box", box: 1 })).toEqual({ actor: "whale", box: 1 });
    expect(intentForClick({ ...view, hand: { state: "raised", box: 1, landsTick: 160 } }, WHALE_SEAT, { kind: "box", box: 2 })).toBeNull();
    expect(intentForClick(view, WHALE_SEAT, { kind: "ground" })).toBeNull();
  });

  test("nothing happens in the lobby, after the settle, for a spectator, or for a seat that did not ante", () => {
    expect(intentForClick(viewWith({ state: "hovering" }, { phase: "lobby" }), OWN_SEAT, { kind: "box", box: 0 })).toBeNull();
    expect(intentForClick(viewWith({ state: "hovering" }, { phase: "settled" }), OWN_SEAT, { kind: "box", box: 0 })).toBeNull();
    expect(intentForClick(viewWith({ state: "hovering" }), null, { kind: "box", box: 0 })).toBeNull();
    const seatedOnly = viewWith({ state: "hovering" }, { seats: [seatOf(OWN_SEAT, { state: "hovering" }, "pigeon", "seated")] });
    expect(intentForClick(seatedOnly, OWN_SEAT, { kind: "box", box: 0 })).toBeNull();
  });
});
