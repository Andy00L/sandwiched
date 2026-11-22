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

export function chooseGuestStep(facts: GuestFacts, needs: GuestNeeds): GuestStep | "ready" {
  if (!facts.isSeatOnRollup) return "sit";
  if (!facts.hasSession) return "session";
  if (facts.seatIndex === null) return "join";
  if (facts.chips >= needs.chipsToPlay) return "ready";
  if (facts.rollupUnits >= needs.unitsPerBuyIn) return "buyIn";
  if (facts.walletUnits >= needs.unitsPerBuyIn) return "deposit";
  return "fund";
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

export async function prepareGuest(chain: GuestChain, options: GuestLoopOptions): Promise<GuestStage> {
  let lastStep: GuestStep | null = null;
  let attempt = 0;
  for (;;) {
    if (options.isStopped()) return { kind: "failed", step: lastStep ?? "sit", reason: "stopped" };
    const facts = await chain.readFacts();
    const step: GuestStep | "ready" = facts.ok ? chooseGuestStep(facts.value, options.needs) : (lastStep ?? "sit");
    if (step === "ready") {
      options.onStage({ kind: "ready" });
      return { kind: "ready" };
    }
    attempt = step === lastStep ? attempt + 1 : 1;
    lastStep = step;
    if (attempt > options.maxAttemptsPerStep) {
      const failed: GuestStage = { kind: "failed", step, reason: facts.ok ? `${step} did not take effect` : facts.reason };
      options.onStage(failed);
      return failed;
    }
    options.onStage({ kind: "preparing", step, attempt });
    const ran = facts.ok ? await chain.run(step) : facts;
    if (ran.ok) {
      await options.wait(options.settleDelayMs);
      continue;
    }
    console.warn(`[prepareGuest] ${step} attempt ${attempt}: ${ran.reason}`);
    await options.wait(options.retryDelayMs * attempt);
  }
}
