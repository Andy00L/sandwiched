import { describe, expect, test } from "bun:test";
import { type BotView, PERCHES_PER_BOX, choosePigeonMove, chooseSwatBox, settlePigeon } from "./bots";

const quietTable = (overrides: Partial<BotView> = {}): BotView => ({
  boxCount: 3,
  sandwichBox: 1,
  pot: 300,
  standingPigeons: [0, 0, 0],
  perchClaims: [0, 0, 0],
  looseCrumbs: [0, 0, 0],
  raisedHandBox: null,
  lastCrumbBox: null,
  ...overrides,
});

describe("practice bot temperaments", () => {
  test("a greedy pigeon heads for the last box that gave crumbs and pecks there without dodging", () => {
    const view = quietTable({ lastCrumbBox: 2, raisedHandBox: 2 });
    expect(choosePigeonMove("greedy", { state: "hovering" }, true, view)).toEqual({ kind: "flyTo", box: 2 });
    expect(choosePigeonMove("greedy", { state: "perched", box: 2 }, true, view)).toEqual({ kind: "peck" });
    expect(choosePigeonMove("greedy", { state: "perched", box: 2 }, false, view)).toBeNull();
  });

  test("a nervous pigeon leaves the box under the hand and waits for it to land before going home", () => {
    const handOverHome = quietTable({ raisedHandBox: 1 });
    expect(choosePigeonMove("nervous", { state: "perched", box: 1 }, true, handOverHome)).toEqual({ kind: "takeOff" });
    expect(choosePigeonMove("nervous", { state: "flying", box: 1 }, true, handOverHome)).toEqual({ kind: "takeOff" });
    expect(choosePigeonMove("nervous", { state: "hovering" }, true, handOverHome)).toBeNull();
    expect(choosePigeonMove("nervous", { state: "hovering" }, true, quietTable())).toEqual({ kind: "flyTo", box: 1 });
  });

  test("a vulture lands only where loose crumbs lie and leaves a picked-clean box", () => {
    expect(choosePigeonMove("vulture", { state: "hovering" }, true, quietTable())).toBeNull();
    expect(choosePigeonMove("vulture", { state: "hovering" }, true, quietTable({ looseCrumbs: [4, 0, 9] }))).toEqual({ kind: "flyTo", box: 2 });
    expect(choosePigeonMove("vulture", { state: "hovering" }, true, quietTable({ looseCrumbs: [4, 0, 9], perchClaims: [0, 0, PERCHES_PER_BOX] }))).toEqual({ kind: "flyTo", box: 0 });
    expect(choosePigeonMove("vulture", { state: "perched", box: 0 }, true, quietTable())).toEqual({ kind: "takeOff" });
  });

  test("the bot whale slams the most crowded box and breaks ties toward the sandwich", () => {
    expect(chooseSwatBox(quietTable())).toBeNull();
    expect(chooseSwatBox(quietTable({ standingPigeons: [3, 2, 0] }))).toBe(0);
    expect(chooseSwatBox(quietTable({ standingPigeons: [2, 2, 2] }))).toBe(1);
    expect(chooseSwatBox(quietTable({ standingPigeons: [2, 0, 2], sandwichBox: 1 }))).toBe(0);
  });

  test("a pigeon counts as perched once its flight lands or its stun wears off", () => {
    expect(settlePigeon({ state: "flying", box: 2, landsTick: 50 }, 49)).toEqual({ state: "flying", box: 2 });
    expect(settlePigeon({ state: "flying", box: 2, landsTick: 50 }, 50)).toEqual({ state: "perched", box: 2 });
    expect(settlePigeon({ state: "stunned", box: 0, untilTick: 80 }, 80)).toEqual({ state: "perched", box: 0 });
  });
});
