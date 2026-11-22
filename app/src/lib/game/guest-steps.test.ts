import { describe, expect, test } from "bun:test";
import { failure, success } from "../chain/result";
import { type GuestChain, type GuestFacts, type GuestStage, type GuestStep, chooseLaneStep, prepareGuest } from "./guest-steps";

const NEEDS = { chipsToPlay: 100n, unitsPerBuyIn: 1_000_000n };
const FRESH: GuestFacts = { isSeatOnRollup: false, hasSession: false, seatIndex: null, chips: 0n, walletUnits: 0n, rollupUnits: 0n };

const createFakeGuestChain = (start: GuestFacts, refusing: ReadonlySet<GuestStep> = new Set()) => {
  const facts = { ...start };
  const ran: GuestStep[] = [];
  const effects: Record<GuestStep, () => void> = {
    sit: () => (facts.isSeatOnRollup = true),
    session: () => (facts.hasSession = true),
    join: () => (facts.seatIndex = 3),
    fund: () => (facts.walletUnits += 5_000_000n),
    deposit: () => {
      facts.walletUnits -= NEEDS.unitsPerBuyIn;
      facts.rollupUnits += NEEDS.unitsPerBuyIn;
    },
    buyIn: () => {
      facts.rollupUnits -= NEEDS.unitsPerBuyIn;
      facts.chips += 1_000n;
    },
  };
  const chain: GuestChain = {
    readFacts: async () => success({ ...facts }),
    run: async (step) => {
      ran.push(step);
      if (refusing.has(step)) return failure(`${step} refused`);
      effects[step]();
      return success(`${step}-signature`);
    },
  };
  return { chain, ran };
};

const runLoop = (chain: GuestChain) => {
  const stages: GuestStage[] = [];
  const outcome = prepareGuest(chain, {
    needs: NEEDS,
    maxAttemptsPerStep: 3,
    retryDelayMs: 1,
    settleDelayMs: 0,
    onStage: (stage) => stages.push(stage),
    wait: async () => undefined,
    isStopped: () => false,
  });
  return { outcome, stages };
};

describe("chooseLaneStep", () => {
  test("the seat lane goes sit, session, join", () => {
    expect(chooseLaneStep("seat", FRESH, NEEDS)).toBe("sit");
    expect(chooseLaneStep("seat", { ...FRESH, isSeatOnRollup: true }, NEEDS)).toBe("session");
    expect(chooseLaneStep("seat", { ...FRESH, isSeatOnRollup: true, hasSession: true }, NEEDS)).toBe("join");
    expect(chooseLaneStep("seat", { ...FRESH, isSeatOnRollup: true, hasSession: true, seatIndex: 2 }, NEEDS)).toBe("done");
  });

  test("the money lane funds and deposits without a seat, and buys in once the seat is on the rollup", () => {
    expect(chooseLaneStep("money", FRESH, NEEDS)).toBe("fund");
    expect(chooseLaneStep("money", { ...FRESH, walletUnits: 1_000_000n }, NEEDS)).toBe("deposit");
    expect(chooseLaneStep("money", { ...FRESH, rollupUnits: 1_000_000n }, NEEDS)).toBe("waiting");
    expect(chooseLaneStep("money", { ...FRESH, isSeatOnRollup: true, rollupUnits: 1_000_000n }, NEEDS)).toBe("buyIn");
    expect(chooseLaneStep("money", { ...FRESH, isSeatOnRollup: true, chips: 100n }, NEEDS)).toBe("done");
  });
});

describe("prepareGuest", () => {
  test("takes a fresh guest through every step once and ends ready", async () => {
    const { chain, ran } = createFakeGuestChain(FRESH);
    const { outcome } = runLoop(chain);
    expect(await outcome).toEqual({ kind: "ready" });
    expect(ran.toSorted()).toEqual(["buyIn", "deposit", "fund", "join", "session", "sit"]);
    expect(ran.indexOf("buyIn")).toBeGreaterThan(ran.indexOf("sit"));
  });

  test("after a reload with a seat and chips on the rollup, only opens the session", async () => {
    const { chain, ran } = createFakeGuestChain({ ...FRESH, isSeatOnRollup: true, seatIndex: 5, chips: 900n });
    expect(await runLoop(chain).outcome).toEqual({ kind: "ready" });
    expect(ran).toEqual(["session"]);
  });

  test("starts funding before the seat is taken", async () => {
    const { chain, ran } = createFakeGuestChain(FRESH);
    await runLoop(chain).outcome;
    expect(ran.slice(0, 2).toSorted()).toEqual(["fund", "sit"]);
  });

  test("stops with the failing step after the attempts run out", async () => {
    const { chain, ran } = createFakeGuestChain(FRESH, new Set<GuestStep>(["fund"]));
    const { outcome, stages } = runLoop(chain);
    expect(await outcome).toMatchObject({ kind: "failed", step: "fund" });
    expect(ran.filter((step) => step === "fund")).toHaveLength(3);
    expect(stages.at(-1)).toMatchObject({ kind: "failed", step: "fund" });
  });
});
