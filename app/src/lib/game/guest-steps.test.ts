import { describe, expect, test } from "bun:test";
import { failure, success } from "../chain/result";
import { type GuestChain, type GuestFacts, type GuestStage, type GuestStep, chooseGuestStep, prepareGuest } from "./guest-steps";

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

describe("chooseGuestStep", () => {
  test("goes seat, session, join, then money only as far as the chips to play need", () => {
    expect(chooseGuestStep(FRESH, NEEDS)).toBe("sit");
    expect(chooseGuestStep({ ...FRESH, isSeatOnRollup: true }, NEEDS)).toBe("session");
    expect(chooseGuestStep({ ...FRESH, isSeatOnRollup: true, hasSession: true }, NEEDS)).toBe("join");
    const joined = { ...FRESH, isSeatOnRollup: true, hasSession: true, seatIndex: 2 };
    expect(chooseGuestStep(joined, NEEDS)).toBe("fund");
    expect(chooseGuestStep({ ...joined, walletUnits: 1_000_000n }, NEEDS)).toBe("deposit");
    expect(chooseGuestStep({ ...joined, rollupUnits: 1_000_000n }, NEEDS)).toBe("buyIn");
    expect(chooseGuestStep({ ...joined, chips: 100n }, NEEDS)).toBe("ready");
  });
});

describe("prepareGuest", () => {
  test("takes a fresh guest through every step once and ends ready", async () => {
    const { chain, ran } = createFakeGuestChain(FRESH);
    const { outcome } = runLoop(chain);
    expect(await outcome).toEqual({ kind: "ready" });
    expect(ran).toEqual(["sit", "session", "join", "fund", "deposit", "buyIn"]);
  });

  test("after a reload with a seat and chips on the rollup, only opens the session", async () => {
    const { chain, ran } = createFakeGuestChain({ ...FRESH, isSeatOnRollup: true, seatIndex: 5, chips: 900n });
    expect(await runLoop(chain).outcome).toEqual({ kind: "ready" });
    expect(ran).toEqual(["session"]);
  });

  test("stops with the failing step after the attempts run out", async () => {
    const { chain, ran } = createFakeGuestChain(FRESH, new Set<GuestStep>(["fund"]));
    const { outcome, stages } = runLoop(chain);
    expect(await outcome).toMatchObject({ kind: "failed", step: "fund" });
    expect(ran.filter((step) => step === "fund")).toHaveLength(3);
    expect(stages.at(-1)).toMatchObject({ kind: "failed", step: "fund" });
  });
});
