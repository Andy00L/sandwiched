import type { Result } from "../chain/result";

export type GuestStep = "sit" | "session" | "join" | "fund" | "deposit" | "buyIn";

export type GuestFacts = {
  isSeatOnRollup: boolean;
  hasSession: boolean;
  seatIndex: number | null;
  chips: bigint;
  walletUnits: bigint;
  rollupUnits: bigint;
};

export type GuestNeeds = { chipsToPlay: bigint; unitsPerBuyIn: bigint };

export type GuestStage =
  | { kind: "preparing"; step: GuestStep; attempt: number }
  | { kind: "ready" }
  | { kind: "failed"; step: GuestStep; reason: string };

export type GuestChain = {
  readFacts: () => Promise<Result<GuestFacts>>;
  run: (step: GuestStep) => Promise<Result<string>>;
};

export type GuestLane = "seat" | "money";

export function chooseLaneStep(lane: GuestLane, facts: GuestFacts, needs: GuestNeeds): GuestStep | "done" | "waiting" {
  switch (lane) {
    case "seat":
      if (!facts.isSeatOnRollup) return "sit";
      if (!facts.hasSession) return "session";
      return facts.seatIndex === null ? "join" : "done";
    case "money":
      if (facts.isSeatOnRollup && facts.chips >= needs.chipsToPlay) return "done";
      if (facts.rollupUnits >= needs.unitsPerBuyIn) return facts.isSeatOnRollup ? "buyIn" : "waiting";
      return facts.walletUnits >= needs.unitsPerBuyIn ? "deposit" : "fund";
  }
}

export type GuestLoopOptions = {
  needs: GuestNeeds;
  maxAttemptsPerStep: number;
  retryDelayMs: number;
  settleDelayMs: number;
  onStage: (stage: GuestStage) => void;
  wait: (milliseconds: number) => Promise<void>;
  isStopped: () => boolean;
};

const FIRST_LANE_STEP: Record<GuestLane, GuestStep> = { seat: "sit", money: "fund" };

export type LaneEnd = { kind: "done" } | { kind: "stopped" } | { kind: "failed"; step: GuestStep; reason: string };

type LaneGoal = "ready" | "funded";

async function runLane(chain: GuestChain, lane: GuestLane, options: GuestLoopOptions, goal: LaneGoal): Promise<LaneEnd> {
  let lastStep: GuestStep | null = null;
  let attempt = 0;
  for (;;) {
    if (options.isStopped()) return { kind: "stopped" };
    const facts = await chain.readFacts();
    const step: GuestStep | "done" | "waiting" = facts.ok ? chooseLaneStep(lane, facts.value, options.needs) : (lastStep ?? FIRST_LANE_STEP[lane]);
    if (step === "done") return { kind: "done" };
    if (step === "waiting") {
      if (goal === "funded") return { kind: "done" };
      await options.wait(options.settleDelayMs);
      continue;
    }
    attempt = step === lastStep ? attempt + 1 : 1;
    lastStep = step;
    if (attempt > options.maxAttemptsPerStep) return { kind: "failed", step, reason: facts.ok ? `${step} did not take effect` : facts.reason };
    options.onStage({ kind: "preparing", step, attempt });
    const ran = facts.ok ? await chain.run(step) : facts;
    if (ran.ok) {
      await options.wait(options.settleDelayMs);
      continue;
    }
    console.warn(`[runLane] ${step} attempt ${attempt}: ${ran.reason}`);
    await options.wait(options.retryDelayMs * attempt);
  }
}

export async function prepareGuest(chain: GuestChain, options: GuestLoopOptions): Promise<GuestStage> {
  let failed: GuestStage | null = null;
  const laneOptions: GuestLoopOptions = { ...options, isStopped: () => options.isStopped() || failed !== null };
  const runUntilFailed = async (lane: GuestLane) => {
    const end = await runLane(chain, lane, laneOptions, "ready");
    if (end.kind === "failed" && failed === null) failed = { kind: "failed", step: end.step, reason: end.reason };
    return end;
  };
  const ends = await Promise.all([runUntilFailed("seat"), runUntilFailed("money")]);
  const outcome: GuestStage = failed ?? (ends.every((end) => end.kind === "done") ? { kind: "ready" } : { kind: "failed", step: "sit", reason: "stopped" });
  options.onStage(outcome);
  return outcome;
}

export async function fundAheadOfSeat(chain: GuestChain, options: GuestLoopOptions): Promise<LaneEnd> {
  return runLane(chain, "money", options, "funded");
}
