import { afterAll, beforeAll, describe, expect, jest, spyOn, test } from "bun:test";
import { Keypair } from "@solana/web3.js";
import { type BaseShuttle, type DepositChain, type DepositRecord, type ShuttleSighting, createDepositQueue } from "./deposits";
import type { KeyStore } from "./key-store";
import { type Result, failure, success } from "./result";
import type { BaseConfirmation, BaseSubmission, RollupAck } from "./transport";

const CHECK_ENV = "DEPOSIT_SHUTTLE_CHECK";
const OWNER = Keypair.generate().publicKey;
const STARTING_UNITS = 5_000n;
const DEPOSIT_UNITS = 1_000n;
const CASH_OUT_UNITS = DEPOSIT_UNITS;
const BUY_IN_UNITS = 500n;
const EPOCH_MS = 1_000_000;
const POLL_STEP_MS = 250;
const PAST_LANDING_TIMEOUT_MS = 10_250;
const PAST_UNSEEN_GRACE_MS = 120_000;
const BLOCKHASH_LIFETIME_MS = 90_000;
const SEARCH_TIMEOUT_MS = 900_000;
const TICK_LIMIT_MS = 9_000;
const PASSED = "no orphaned shuttle";

type BaseKind = Exclude<BaseShuttle["kind"], "foreign">;
type TxStatus = "sending" | "neverSent" | "inFlight" | "landed" | "failedOnBase";
type TokenPlace = "wallet" | "shuttle" | "player";

type ShuttleTruth = {
  label: string;
  shuttleId: number;
  units: bigint;
  expiresAtMs: number;
  tx: TxStatus;
  base: BaseKind;
  sighting: ShuttleSighting;
  tokens: TokenPlace;
};

type TabJob = "deposit" | "recover";
type Tab = { name: string; job: TabJob; isAlive: boolean; isDone: boolean; observations: string[]; seenThisWait: Set<string> };

type Choice = { label: string; isPossible?: boolean; apply: () => Promise<void> | void };
type Outcome<Value> = { label: string; value: Value; isPossible?: boolean; effect?: () => void };
type PendingCall = { tab: Tab; call: string; listAnswers: () => Choice[] };

type Budget = {
  recoveryTabs: number;
  crashes: number;
  cashOuts: number;
  buyIns: number;
  handBacks: number;
  tenSecondWaits: number;
  twoMinuteWaits: number;
};

type RecoveryStart = "afterDepositsEnd" | "anytime";

type Scenario = { name: string; depositTabs: number; recoveryStart: RecoveryStart; budget: Budget };

type Run = {
  recoveryStart: RecoveryStart;
  clockMs: number;
  tickedSinceLongWaitMs: number;
  ownerUnits: bigint;
  shuttles: ShuttleTruth[];
  budget: Budget;
  tabs: Tab[];
  pending: PendingCall[];
  entries: Map<string, string>;
  worldAtLastPoll: string;
};

type Step = { label: string; summary: string };
type Visit = { choices: Choice[]; key: string; steps: Step[]; broken: string | null };
type Exploration = { states: number; replays: number; depth: number; story: string };

type TimerControl = { clearAllTimers: () => void; advanceTimersByTime: (milliseconds: number) => void };

const hasTimerControl = (candidate: object): candidate is TimerControl =>
  "clearAllTimers" in candidate &&
  typeof candidate.clearAllTimers === "function" &&
  "advanceTimersByTime" in candidate &&
  typeof candidate.advanceTimersByTime === "function";

const resetFakeTimers = (): void => {
  jest.useFakeTimers();
  if (hasTimerControl(jest)) jest.clearAllTimers();
};

const advanceFakeTimers = (milliseconds: number): void => {
  if (hasTimerControl(jest)) jest.advanceTimersByTime(milliseconds);
};

const drainMicrotasks = (): Promise<void> => new Promise<void>((resolve) => setImmediate(resolve));

const neverSettles = <Value>(): Promise<Value> => new Promise<Value>(() => undefined);

const MERGE_REFUSED: RollupAck = { ok: false, kind: "program", errorCode: null, errorName: "fakeRefusal", detail: "refused", ackMs: 1 };
const MERGE_ACCEPTED: RollupAck = { ok: true, signature: "merge-signature", ackMs: 1 };

const IDLE_CHAIN: DepositChain = {
  readShuttle: () => neverSettles(),
  readBaseShuttle: () => neverSettles(),
  submitDeposit: () => neverSettles(),
  confirmDeposit: () => neverSettles(),
  redelegateShuttle: () => neverSettles(),
  mergeShuttle: () => neverSettles(),
};

const stampEpoch = (run: Run): string => `@wait${run.budget.tenSecondWaits}.${run.budget.twoMinuteWaits}`;

const findShuttle = (run: Run, shuttleId: number): ShuttleTruth | undefined => run.shuttles.find((shuttle) => shuttle.shuttleId === shuttleId);

const labelShuttle = (run: Run, shuttleId: number): string => findShuttle(run, shuttleId)?.label ?? "unregistered";

const describeSignature = (shuttle: ShuttleTruth): string => `signature-${shuttle.label}`;

const describeSubmission = (shuttle: ShuttleTruth): BaseSubmission => ({
  signature: describeSignature(shuttle),
  blockhash: "fake-blockhash",
  lastValidBlockHeight: 1,
  submittedAtMs: 0,
});

const canStillLand = (run: Run, shuttle: ShuttleTruth): boolean => (shuttle.tx === "sending" || shuttle.tx === "inFlight") && run.clockMs < shuttle.expiresAtMs;

const hasLeft = (shuttle: ShuttleTruth): boolean => shuttle.tx === "inFlight" || shuttle.tx === "landed" || shuttle.tx === "failedOnBase";

const isAtRisk = (run: Run, shuttle: ShuttleTruth): boolean => shuttle.tokens === "shuttle" || canStillLand(run, shuttle);

const isMergeable = (shuttle: ShuttleTruth): boolean => shuttle.tokens === "shuttle" && shuttle.base === "delegated" && shuttle.sighting === "funded";

const registerShuttle = (run: Run, shuttleId: number, units: bigint): ShuttleTruth => {
  const known = findShuttle(run, shuttleId);
  if (known !== undefined) return known;
  const shuttle: ShuttleTruth = {
    label: `#${run.shuttles.length + 1}`,
    shuttleId,
    units,
    expiresAtMs: run.clockMs + BLOCKHASH_LIFETIME_MS,
    tx: "sending",
    base: "missing",
    sighting: "absent",
    tokens: "wallet",
  };
  run.shuttles.push(shuttle);
  return shuttle;
};

const creditPlayer = (run: Run, shuttle: ShuttleTruth, sightingAfter: ShuttleSighting, baseAfter: BaseKind): void => {
  shuttle.tokens = "player";
  shuttle.sighting = sightingAfter;
  shuttle.base = baseAfter;
  run.ownerUnits += shuttle.units;
};

const waitForScheduler = <Value>(run: Run, tab: Tab, call: string, listOutcomes: () => Outcome<Value>[]): Promise<Value> => {
  if (!tab.isAlive) return neverSettles();
  return new Promise<Value>((resolve) => {
    const pendingCall: PendingCall = {
      tab,
      call,
      listAnswers: () =>
        listOutcomes()
          .filter((outcome) => outcome.isPossible !== false)
          .map((outcome) => ({
            label: `${tab.name} ${call}: ${outcome.label}`,
            apply: () => {
              run.pending = run.pending.filter((candidate) => candidate !== pendingCall);
              outcome.effect?.();
              tab.seenThisWait.clear();
              tab.observations.push(`${call}->${outcome.label}${stampEpoch(run)}`);
              resolve(outcome.value);
            },
          })),
    };
    run.pending.push(pendingCall);
  });
};

const createTabChain = (run: Run, tab: Tab): DepositChain => {
  const observe = <Value>(call: string, value: Value, shown: string): Promise<Value> => {
    if (!tab.isAlive) return neverSettles();
    const observation = `${call}=${shown}`;
    if (!tab.seenThisWait.has(observation)) tab.observations.push(tab.seenThisWait.size === 0 ? `${observation}${stampEpoch(run)}` : observation);
    tab.seenThisWait.add(observation);
    return Promise.resolve(value);
  };
  return {
    readShuttle: (shuttleId) => {
      const sighting = findShuttle(run, shuttleId)?.sighting ?? "absent";
      return observe<Result<ShuttleSighting>>(`readShuttle(${labelShuttle(run, shuttleId)})`, success(sighting), sighting);
    },
    readBaseShuttle: (shuttleId) => {
      const kind = findShuttle(run, shuttleId)?.base ?? "missing";
      const baseShuttle: BaseShuttle = { kind };
      return observe<Result<BaseShuttle>>(`readBaseShuttle(${labelShuttle(run, shuttleId)})`, success(baseShuttle), kind);
    },
    submitDeposit: (units, shuttleId) => {
      const shuttle = registerShuttle(run, shuttleId, units);
      const markNeverSent = () => {
        shuttle.tx = "neverSent";
      };
      return waitForScheduler<Result<BaseSubmission>>(run, tab, `submitDeposit(${shuttle.label})`, () => [
        { label: "it returns the signature", isPossible: hasLeft(shuttle), value: success(describeSubmission(shuttle)) },
        { label: "it fails before anything leaves", isPossible: shuttle.tx === "sending", value: failure("[fakeChain] send refused"), effect: markNeverSent },
        { label: "it fails after the deposit left", isPossible: hasLeft(shuttle), value: failure("[fakeChain] send timed out") },
      ]);
    },
    confirmDeposit: (submission) => {
      const shuttle = run.shuttles.find((candidate) => describeSignature(candidate) === submission.signature);
      if (shuttle === undefined) return Promise.resolve({ ok: false, reason: "[fakeChain] unknown signature", hasLanded: false });
      return waitForScheduler<BaseConfirmation>(run, tab, `confirmDeposit(${shuttle.label})`, () => [
        {
          label: "base confirms the deposit",
          isPossible: shuttle.tx === "landed",
          value: { ok: true, value: { signature: submission.signature, confirmMs: 1 } },
        },
        {
          label: "base reports the deposit failed",
          isPossible: shuttle.tx === "failedOnBase",
          value: { ok: false, reason: "[fakeChain] InstructionError", hasLanded: true },
        },
        { label: "the confirmation times out", value: { ok: false, reason: "[fakeChain] block height exceeded", hasLanded: false } },
      ]);
    },
    mergeShuttle: (shuttleId) => {
      const shuttle = findShuttle(run, shuttleId);
      const call = `mergeShuttle(${labelShuttle(run, shuttleId)})`;
      if (shuttle === undefined) return waitForScheduler<RollupAck>(run, tab, call, () => [{ label: "the rollup refuses the merge", value: MERGE_REFUSED }]);
      const mergeInto = () => creditPlayer(run, shuttle, "emptied", shuttle.base);
      return waitForScheduler<RollupAck>(run, tab, call, () => [
        { label: "the merge lands", isPossible: isMergeable(shuttle), value: MERGE_ACCEPTED, effect: mergeInto },
        { label: "the merge lands but its reply is lost", isPossible: isMergeable(shuttle), value: MERGE_REFUSED, effect: mergeInto },
        { label: "the rollup refuses the merge", value: MERGE_REFUSED },
      ]);
    },
    redelegateShuttle: (shuttleId) => {
      const shuttle = findShuttle(run, shuttleId);
      const call = `redelegateShuttle(${labelShuttle(run, shuttleId)})`;
      const refusal = { label: "the redelegation fails", value: failure("[fakeChain] redelegation refused") };
      if (shuttle === undefined) return waitForScheduler<Result<unknown>>(run, tab, call, () => [refusal]);
      const delegateAgain = () => {
        shuttle.base = "delegated";
      };
      return waitForScheduler<Result<unknown>>(run, tab, call, () => [
        { label: "the redelegation lands", isPossible: shuttle.base === "undelegated", value: success(null), effect: delegateAgain },
        {
          label: "the redelegation lands but its confirmation fails",
          isPossible: shuttle.base === "undelegated",
          value: failure("[fakeChain] confirmation timed out"),
          effect: delegateAgain,
        },
        refusal,
      ]);
    },
  };
};

const createTabStore = (run: Run, tab: Tab): KeyStore => ({
  isDurable: true,
  read: (key) => (tab.isAlive ? (run.entries.get(key) ?? null) : null),
  write: (key, value) => {
    if (!tab.isAlive) return false;
    run.entries.set(key, value);
    return true;
  },
  remove: (key) => {
    if (!tab.isAlive) return false;
    run.entries.delete(key);
    return true;
  },
  listKeys: (prefix) => (tab.isAlive ? [...run.entries.keys()].filter((key) => key.startsWith(prefix)) : []),
});

const observeRecords = (run: Run): DepositRecord[] => {
  const observer: Tab = { name: "observer", job: "recover", isAlive: true, isDone: false, observations: [], seenThisWait: new Set() };
  return createDepositQueue({ chain: IDLE_CHAIN, owner: OWNER, store: createTabStore(run, observer) }).listPending();
};

const openTab = (run: Run, job: TabJob): void => {
  const tab: Tab = { name: `tab ${run.tabs.length + 1}`, job, isAlive: true, isDone: false, observations: [], seenThisWait: new Set() };
  run.tabs.push(tab);
  const queue = createDepositQueue({ chain: createTabChain(run, tab), owner: OWNER, store: createTabStore(run, tab), readNowMs: () => EPOCH_MS + run.clockMs });
  const finish = (summary: string) => {
    if (!tab.isAlive) return;
    tab.isDone = true;
    tab.observations.push(`done ${summary}${stampEpoch(run)}`);
  };
  if (job === "deposit") {
    void queue.deposit(DEPOSIT_UNITS).then((outcome) => finish(outcome.ok ? outcome.value.state : "failed"));
    return;
  }
  void queue.recoverPending().then((outcomes) => finish(outcomes.map((outcome) => outcome.state).join(",")));
};

const closeTab = (run: Run, tab: Tab): void => {
  run.budget.crashes -= 1;
  tab.isAlive = false;
  run.pending = run.pending.filter((call) => call.tab !== tab);
};

const isSleeping = (run: Run, tab: Tab): boolean => tab.isAlive && !tab.isDone && !run.pending.some((call) => call.tab === tab);

const advanceClock = async (run: Run, totalMs: number): Promise<void> => {
  if (!run.tabs.some((tab) => isSleeping(run, tab))) {
    run.clockMs += totalMs;
    advanceFakeTimers(totalMs);
    await drainMicrotasks();
    return;
  }
  for (let elapsedMs = 0; elapsedMs < totalMs; elapsedMs += POLL_STEP_MS) {
    const stepMs = Math.min(POLL_STEP_MS, totalMs - elapsedMs);
    run.clockMs += stepMs;
    advanceFakeTimers(stepMs);
    await drainMicrotasks();
  }
};

const describeShuttle = (run: Run, shuttle: ShuttleTruth): string => {
  const tx = (shuttle.tx === "sending" || shuttle.tx === "inFlight") && !canStillLand(run, shuttle) ? `${shuttle.tx}, expired` : shuttle.tx;
  return `${shuttle.label} tx ${tx}, tokens in ${shuttle.tokens}, base ${shuttle.base}, rollup ${shuttle.sighting}`;
};

const describeWorld = (run: Run): string => [`balance ${run.ownerUnits}`, ...run.shuttles.map((shuttle) => describeShuttle(run, shuttle))].join("; ");

const summarize = (run: Run): string => {
  const records = observeRecords(run).map((record) => `${labelShuttle(run, record.shuttleId)} ${record.state}`);
  return `t=${run.clockMs / 1000}s; ${describeWorld(run)}; records: ${records.join(", ") || "none"}`;
};

const describeState = (run: Run): string =>
  JSON.stringify({
    world: describeWorld(run),
    worldAtLastPoll: run.worldAtLastPoll,
    budget: run.budget,
    records: observeRecords(run).map((record) => ({ ...record, shuttleId: labelShuttle(run, record.shuttleId), units: record.units.toString() })),
    tabs: run.tabs.map((tab) => ({
      name: tab.name,
      isAlive: tab.isAlive,
      isDone: tab.isDone,
      observations: tab.observations,
      pending: run.pending.filter((call) => call.tab === tab).map((call) => call.call),
    })),
  });

const findBrokenRule = (run: Run): string | null =>
  run.tickedSinceLongWaitMs >= TICK_LIMIT_MS
    ? `[harness] polls alone moved the clock ${run.tickedSinceLongWaitMs} ms, so wait counts no longer decide which deadlines passed`
    : findOrphanedShuttle(run);

const findOrphanedShuttle = (run: Run): string | null => {
  const recorded = new Set(observeRecords(run).map((record) => record.shuttleId));
  const orphan = run.shuttles.find((shuttle) => isAtRisk(run, shuttle) && !recorded.has(shuttle.shuttleId));
  if (orphan === undefined) return null;
  const where =
    orphan.tokens === "shuttle"
      ? `sit in shuttle ${orphan.label} (base ${orphan.base}, rollup ${orphan.sighting})`
      : `${orphan.tx === "sending" ? "are being sent" : "are in flight"} to shuttle ${orphan.label} and can still land`;
  return `${orphan.units} units ${where} and no deposit record names the shuttle`;
};

const listShuttleEvents = (run: Run, shuttle: ShuttleTruth): Choice[] => {
  const canRollupAct = shuttle.tokens === "shuttle" && shuttle.base === "delegated";
  const isFunded = canRollupAct && shuttle.sighting === "funded";
  return [
    {
      label: `deposit ${shuttle.label} reaches the network`,
      isPossible: shuttle.tx === "sending",
      apply: () => {
        shuttle.tx = "inFlight";
      },
    },
    {
      label: `deposit ${shuttle.label} lands on base`,
      isPossible: shuttle.tx === "inFlight" && canStillLand(run, shuttle),
      apply: () => {
        shuttle.tx = "landed";
        shuttle.tokens = "shuttle";
        shuttle.base = "delegated";
      },
    },
    {
      label: `deposit ${shuttle.label} fails on base and moves nothing`,
      isPossible: shuttle.tx === "inFlight" && canStillLand(run, shuttle),
      apply: () => {
        shuttle.tx = "failedOnBase";
      },
    },
    {
      label: `the rollup picks up shuttle ${shuttle.label}`,
      isPossible: canRollupAct && shuttle.sighting === "absent",
      apply: () => {
        shuttle.sighting = "funded";
      },
    },
    { label: `the rollup merges shuttle ${shuttle.label} and closes it`, isPossible: isFunded, apply: () => creditPlayer(run, shuttle, "absent", "missing") },
    { label: `the rollup merges shuttle ${shuttle.label} and leaves it empty`, isPossible: isFunded, apply: () => creditPlayer(run, shuttle, "emptied", "delegated") },
    {
      label: `the rollup hands shuttle ${shuttle.label} back to base unmerged`,
      isPossible: isFunded && run.budget.handBacks > 0,
      apply: () => {
        run.budget.handBacks -= 1;
        shuttle.base = "undelegated";
        shuttle.sighting = "absent";
      },
    },
  ];
};

const listChainEvents = (run: Run): Choice[] => [
  ...run.shuttles.flatMap((shuttle) => listShuttleEvents(run, shuttle)),
  {
    label: `a cash-out credits ${CASH_OUT_UNITS} units to the rollup balance`,
    isPossible: run.budget.cashOuts > 0,
    apply: () => {
      run.budget.cashOuts -= 1;
      run.ownerUnits += CASH_OUT_UNITS;
    },
  },
  {
    label: `a buy-in takes ${BUY_IN_UNITS} units from the rollup balance`,
    isPossible: run.budget.buyIns > 0 && run.ownerUnits >= BUY_IN_UNITS,
    apply: () => {
      run.budget.buyIns -= 1;
      run.ownerUnits -= BUY_IN_UNITS;
    },
  },
];

const isDepositRunning = (run: Run): boolean => run.tabs.some((tab) => tab.job === "deposit" && tab.isAlive && !tab.isDone);

const listTabEvents = (run: Run): Choice[] => [
  ...run.tabs.map((tab) => ({
    label: `${tab.name} closes mid-deposit (crash or reload)`,
    isPossible: tab.job === "deposit" && tab.isAlive && !tab.isDone && run.budget.crashes > 0,
    apply: () => closeTab(run, tab),
  })),
  {
    label: `tab ${run.tabs.length + 1} opens and calls recoverPending()`,
    isPossible: run.budget.recoveryTabs > 0 && (run.recoveryStart === "anytime" || !isDepositRunning(run)),
    apply: () => {
      run.budget.recoveryTabs -= 1;
      openTab(run, "recover");
    },
  },
];

const passTime = async (run: Run, totalMs: number): Promise<void> => {
  run.worldAtLastPoll = describeWorld(run);
  run.tickedSinceLongWaitMs = totalMs === POLL_STEP_MS ? run.tickedSinceLongWaitMs + totalMs : 0;
  await advanceClock(run, totalMs);
};

const listTimeEvents = (run: Run): Choice[] => [
  {
    label: `${POLL_STEP_MS} ms pass and every waiting tab polls again`,
    isPossible: describeWorld(run) !== run.worldAtLastPoll && run.tabs.some((tab) => isSleeping(run, tab)),
    apply: () => passTime(run, POLL_STEP_MS),
  },
  {
    label: "10 seconds pass",
    isPossible: run.budget.tenSecondWaits > 0,
    apply: () => {
      run.budget.tenSecondWaits -= 1;
      return passTime(run, PAST_LANDING_TIMEOUT_MS);
    },
  },
  {
    label: "two minutes pass",
    isPossible: run.budget.twoMinuteWaits > 0,
    apply: () => {
      run.budget.twoMinuteWaits -= 1;
      return passTime(run, PAST_UNSEEN_GRACE_MS);
    },
  },
];

const listChoices = (run: Run): Choice[] =>
  [...run.pending.flatMap((call) => call.listAnswers()), ...listChainEvents(run), ...listTabEvents(run), ...listTimeEvents(run)].filter(
    (choice) => choice.isPossible !== false,
  );

const startRun = (scenario: Scenario): Run => {
  const run: Run = {
    recoveryStart: scenario.recoveryStart,
    clockMs: 0,
    tickedSinceLongWaitMs: 0,
    ownerUnits: STARTING_UNITS,
    shuttles: [],
    budget: { ...scenario.budget },
    tabs: [],
    pending: [],
    entries: new Map(),
    worldAtLastPoll: "",
  };
  for (let opened = 0; opened < scenario.depositTabs; opened += 1) openTab(run, "deposit");
  return run;
};

const replay = async (scenario: Scenario, path: number[], isTelling: boolean): Promise<Visit> => {
  resetFakeTimers();
  const run = startRun(scenario);
  await drainMicrotasks();
  run.worldAtLastPoll = describeWorld(run);
  const describeStep = (label: string): Step => ({ label, summary: isTelling ? summarize(run) : "" });
  const steps: Step[] = [describeStep(`${scenario.depositTabs} tab(s) call deposit(${DEPOSIT_UNITS}n)`)];
  for (const choiceIndex of path) {
    const choice = listChoices(run)[choiceIndex];
    if (choice === undefined) return { choices: [], key: "", steps, broken: "[replay] the run left its recorded path, so the harness is not deterministic" };
    await choice.apply();
    await drainMicrotasks();
    steps.push(describeStep(choice.label));
  }
  return { choices: listChoices(run), key: describeState(run), steps, broken: findBrokenRule(run) };
};

const tellStory = (visit: Visit): string =>
  [`broken rule: ${visit.broken}`, ...visit.steps.map((step, index) => `  ${index}. ${step.label}\n     ${step.summary}`)].join("\n");

const findBoundProblem = (scenario: Scenario): string | null =>
  scenario.budget.tenSecondWaits * PAST_LANDING_TIMEOUT_MS + TICK_LIMIT_MS < BLOCKHASH_LIFETIME_MS
    ? null
    : "[harness] ten-second waits plus polls could reach the blockhash lifetime, so wait counts no longer decide which deadlines passed";

const exploreScenario = async (scenario: Scenario): Promise<Exploration> => {
  const boundProblem = findBoundProblem(scenario);
  if (boundProblem !== null) return { states: 0, replays: 0, depth: 0, story: boundProblem };
  const seen = new Set<number | bigint>();
  let frontier: number[][] = [[]];
  let replays = 0;
  let depth = 0;
  while (frontier.length > 0) {
    const nextFrontier: number[][] = [];
    for (const path of frontier) {
      const visit = await replay(scenario, path, false);
      replays += 1;
      if (visit.broken !== null) return { states: seen.size, replays, depth, story: tellStory(await replay(scenario, path, true)) };
      const fingerprint = Bun.hash(visit.key);
      if (seen.has(fingerprint)) continue;
      seen.add(fingerprint);
      nextFrontier.push(...Array.from({ length: visit.choices.length }, (_unused, index) => [...path, index]));
    }
    frontier = nextFrontier;
    depth += 1;
  }
  return { states: seen.size, replays, depth, story: PASSED };
};

const NO_EVENTS: Budget = { recoveryTabs: 0, crashes: 0, cashOuts: 0, buyIns: 0, handBacks: 0, tenSecondWaits: 0, twoMinuteWaits: 0 };

const SCENARIOS: Scenario[] = [
  {
    name: "one deposit, a crash at any point, then two reloads recover",
    depositTabs: 1,
    recoveryStart: "afterDepositsEnd",
    budget: { ...NO_EVENTS, recoveryTabs: 2, crashes: 1, tenSecondWaits: 1, twoMinuteWaits: 1 },
  },
  {
    name: "a second tab recovers while the first one deposits",
    depositTabs: 1,
    recoveryStart: "anytime",
    budget: { ...NO_EVENTS, recoveryTabs: 1, tenSecondWaits: 1, twoMinuteWaits: 1 },
  },
  {
    name: "one deposit while a cash-out or a buy-in moves the rollup balance",
    depositTabs: 1,
    recoveryStart: "afterDepositsEnd",
    budget: { ...NO_EVENTS, recoveryTabs: 1, cashOuts: 1, buyIns: 1, tenSecondWaits: 1 },
  },
  {
    name: "two tabs deposit at once into one rollup balance",
    depositTabs: 2,
    recoveryStart: "afterDepositsEnd",
    budget: { ...NO_EVENTS },
  },
  {
    name: "the rollup hands a funded shuttle back to base",
    depositTabs: 1,
    recoveryStart: "afterDepositsEnd",
    budget: { ...NO_EVENTS, recoveryTabs: 1, handBacks: 1, tenSecondWaits: 4 },
  },
];

describe.skipIf(process.env[CHECK_ENV] !== "1")("deposit shuttle lifecycle, every interleaving within the bounds", () => {
  beforeAll(() => {
    spyOn(console, "warn").mockImplementation(() => undefined);
  });

  afterAll(() => {
    jest.restoreAllMocks();
    jest.useRealTimers();
  });

  for (const scenario of SCENARIOS) {
    test(
      scenario.name,
      async () => {
        const exploration = await exploreScenario(scenario);
        const verdict = exploration.story === PASSED ? "pass" : `FAIL\n${exploration.story}`;
        console.log(`[exploreScenario] ${scenario.name}: ${exploration.states} states, ${exploration.replays} replays, depth ${exploration.depth}, ${verdict}`);
        expect(exploration.story).toBe(PASSED);
      },
      SEARCH_TIMEOUT_MS,
    );
  }
});
