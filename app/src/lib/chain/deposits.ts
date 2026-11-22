import {
  DELEGATION_PROGRAM_ID,
  EPHEMERAL_SPL_TOKEN_PROGRAM_ID,
  delegateShuttleEphemeralAtaIx,
  delegateSpl,
  deriveShuttleAta,
  deriveShuttleEphemeralAta,
  deriveShuttleWalletAta,
  mergeShuttleIntoAtaIx,
} from "@magicblock-labs/ephemeral-rollups-sdk";
import type { PublicKey } from "@solana/web3.js";
import { findWalletTokenAddress } from "./addresses";
import type { ChainClient } from "./client";
import type { KeyStore } from "./key-store";
import { type Result, attempt, attemptSync, failure, pollUntil, success } from "./result";
import {
  type BaseConfirmation,
  type BaseSubmission,
  type RollupAck,
  type TransactionSigner,
  confirmOnBase,
  readTokenAccountUnits,
  resolveFeePayer,
  sendOnBase,
  sendOnRollup,
  submitOnBase,
} from "./transport";

const DEPOSIT_KEY_PREFIX = "sandwich.deposit.v2.";
const DEPOSIT_LANDING_TIMEOUT_MS = 10_000;
const SHUTTLE_VISIBLE_TIMEOUT_MS = 30_000;
const SHUTTLE_POLL_MS = 250;
const UNSEEN_ON_BASE_GRACE_MS = 120_000;

type DepositBase = { shuttleId: number; units: bigint; createdAtMs: number };
type IntentRecord = DepositBase & { state: "intent" };
type SentRecord = DepositBase & { state: "sent"; signature: string };
type StrandedRecord = DepositBase & { state: "stranded"; signature: string | null; detail: string };

export type DepositRecord = IntentRecord | SentRecord | StrandedRecord;

export type DepositOutcome =
  | { state: "landed"; signature: string; units: bigint; landedMs: number }
  | { state: "pending"; signature: string; shuttleId: number };

export type RecoveryOutcome = { shuttleId: number; state: "merged" | "landed" | "closed" | "waiting"; detail: string };

export type ShuttleSighting = "absent" | "funded" | "emptied";

export type BaseShuttle = { kind: "missing" } | { kind: "delegated" } | { kind: "undelegated" } | { kind: "foreign"; owner: string };

export type DepositChain = {
  readShuttle: (shuttleId: number) => Promise<Result<ShuttleSighting>>;
  readBaseShuttle: (shuttleId: number) => Promise<Result<BaseShuttle>>;
  submitDeposit: (units: bigint, shuttleId: number) => Promise<Result<BaseSubmission>>;
  confirmDeposit: (submission: BaseSubmission) => Promise<BaseConfirmation>;
  redelegateShuttle: (shuttleId: number) => Promise<Result<unknown>>;
  mergeShuttle: (shuttleId: number) => Promise<RollupAck>;
};

export type DepositQueue = {
  deposit: (units: bigint) => Promise<Result<DepositOutcome>>;
  recoverPending: () => Promise<RecoveryOutcome[]>;
  listPending: () => DepositRecord[];
};

export type DepositChainSetup = { client: ChainClient; owner: TransactionSigner; mint: PublicKey; validator: PublicKey };

export type DepositQueueSetup = { chain: DepositChain; owner: PublicKey; store: KeyStore; readNowMs?: () => number };

export const createDepositChain = ({ client, owner, mint, validator }: DepositChainSetup): DepositChain => {
  const ownerToken = findWalletTokenAddress(owner.publicKey, mint);
  const feePayer = resolveFeePayer(client.feePayment, owner.publicKey);
  const deriveShuttle = (shuttleId: number) => {
    const [ephemeralAta] = deriveShuttleEphemeralAta(owner.publicKey, mint, shuttleId);
    const [record] = deriveShuttleAta(ephemeralAta, mint);
    return { ephemeralAta, record, walletAta: deriveShuttleWalletAta(mint, ephemeralAta) };
  };
  return {
    readShuttle: async (shuttleId) => {
      const units = await readTokenAccountUnits(client.rollup, deriveShuttle(shuttleId).walletAta);
      if (!units.ok) return units;
      if (units.value === null) return success("absent");
      return success(units.value > 0n ? "funded" : "emptied");
    },
    readBaseShuttle: async (shuttleId) => {
      const record = await attempt(() => client.base.getAccountInfo(deriveShuttle(shuttleId).record, "confirmed"));
      if (!record.ok) return record;
      if (record.value === null) return success({ kind: "missing" });
      if (record.value.owner.equals(DELEGATION_PROGRAM_ID)) return success({ kind: "delegated" });
      if (record.value.owner.equals(EPHEMERAL_SPL_TOKEN_PROGRAM_ID)) return success({ kind: "undelegated" });
      return success({ kind: "foreign", owner: record.value.owner.toBase58() });
    },
    submitDeposit: async (units, shuttleId) => {
      const instructions = await attempt(() => delegateSpl(owner.publicKey, mint, units, { validator, payer: feePayer, shuttleId }));
      if (!instructions.ok) return failure(`[submitDeposit] build: ${instructions.reason}`);
      return submitOnBase(client.base, client.feePayment, instructions.value, [owner]);
    },
    confirmDeposit: (submission) => confirmOnBase(client.base, submission),
    redelegateShuttle: (shuttleId) => {
      const shuttle = deriveShuttle(shuttleId);
      return sendOnBase(client.base, client.feePayment, [delegateShuttleEphemeralAtaIx(feePayer, shuttle.ephemeralAta, shuttle.record, validator)], [owner]);
    },
    mergeShuttle: (shuttleId) => {
      const shuttle = deriveShuttle(shuttleId);
      const merge = mergeShuttleIntoAtaIx(owner.publicKey, ownerToken, shuttle.ephemeralAta, shuttle.walletAta, mint);
      return sendOnRollup(client.rollupUrl, client.rollupBlockhashes, [merge], [owner]);
    },
  };
};

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null;

const parseDepositRecord = (text: string): DepositRecord | null => {
  const parsed = attemptSync((): unknown => JSON.parse(text));
  if (!parsed.ok || !isRecord(parsed.value)) return null;
  const { shuttleId, units, createdAtMs, state, signature, detail } = parsed.value;
  if (typeof shuttleId !== "number" || typeof units !== "string" || typeof createdAtMs !== "number") return null;
  const unitCount = attemptSync(() => BigInt(units));
  if (!unitCount.ok) return null;
  const base: DepositBase = { shuttleId, units: unitCount.value, createdAtMs };
  if (state === "intent") return { ...base, state };
  if (state === "sent" && typeof signature === "string") return { ...base, state, signature };
  if (state === "stranded" && (typeof signature === "string" || signature === null) && typeof detail === "string") {
    return { ...base, state, signature, detail };
  }
  return null;
};

const serializeDepositRecord = (record: DepositRecord): string => JSON.stringify({ ...record, units: record.units.toString() });

const createDepositLedger = (store: KeyStore, owner: PublicKey) => {
  const prefix = `${DEPOSIT_KEY_PREFIX}${owner.toBase58()}.`;
  const nameEntry = (shuttleId: number) => `${prefix}${shuttleId}`;
  const readStored = (shuttleId: number): DepositRecord | null => {
    const text = store.read(nameEntry(shuttleId));
    return text === null ? null : parseDepositRecord(text);
  };
  const isStillAt = (record: DepositRecord): boolean => {
    const stored = readStored(record.shuttleId);
    return stored !== null && stored.state === record.state && stored.createdAtMs === record.createdAtMs;
  };
  const replace = <Next extends DepositRecord>(from: DepositRecord, next: Next): Result<Next> => {
    if (!isStillAt(from)) return failure(`[createDepositLedger] shuttle ${from.shuttleId} moved past ${from.state} elsewhere`);
    return store.write(nameEntry(next.shuttleId), serializeDepositRecord(next)) ? success(next) : failure("[createDepositLedger] storage refused the write");
  };
  return {
    list: (): DepositRecord[] =>
      store.listKeys(prefix).flatMap((key) => {
        const text = store.read(key);
        const record = text === null ? null : parseDepositRecord(text);
        return record === null ? [] : [record];
      }),
    recordIntent: (shuttleId: number, units: bigint, createdAtMs: number): Result<IntentRecord> => {
      if (store.read(nameEntry(shuttleId)) !== null) return failure(`[createDepositLedger] shuttle ${shuttleId} is already recorded`);
      const record: IntentRecord = { shuttleId, units, createdAtMs, state: "intent" };
      return store.write(nameEntry(shuttleId), serializeDepositRecord(record)) ? success(record) : failure("[createDepositLedger] storage refused the write");
    },
    markSent: (record: IntentRecord, signature: string) => replace(record, { ...record, state: "sent", signature }),
    markStranded: (record: DepositRecord, detail: string) =>
      replace(record, { ...record, state: "stranded", signature: record.state === "intent" ? null : record.signature, detail }),
    settle: (record: DepositRecord): Result<null> => {
      if (!isStillAt(record)) return failure(`[createDepositLedger] shuttle ${record.shuttleId} moved past ${record.state} elsewhere`);
      return store.remove(nameEntry(record.shuttleId)) ? success(null) : failure("[createDepositLedger] storage refused the removal");
    },
  };
};

const drawShuttleId = (): number => crypto.getRandomValues(new Uint32Array(1))[0] ?? 0;

export const createDepositQueue = ({ chain, owner, store, readNowMs = Date.now }: DepositQueueSetup): DepositQueue => {
  const ledger = createDepositLedger(store, owner);
  let queueTail: Promise<unknown> = Promise.resolve();

  const reportLedgerFailure = (outcome: Result<unknown>): void => {
    if (!outcome.ok) console.warn(`[createDepositQueue] ${outcome.reason}`);
  };

  const enqueue = <Value>(task: () => Promise<Value>): Promise<Value> => {
    const run = queueTail.then(task);
    queueTail = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  };

  const waitForLanding = (shuttleId: number, hasConfirmedOnBase: boolean) => {
    let hasSeenInFlight = hasConfirmedOnBase;
    return pollUntil(
      "deposit on the rollup",
      async () => {
        const shuttle = await chain.readShuttle(shuttleId);
        if (!shuttle.ok) return null;
        if (shuttle.value === "emptied") return true;
        if (shuttle.value === "funded") {
          hasSeenInFlight = true;
          return null;
        }
        const base = await chain.readBaseShuttle(shuttleId);
        if (!base.ok) return null;
        if (base.value.kind === "delegated") hasSeenInFlight = true;
        return base.value.kind === "missing" && hasSeenInFlight ? true : null;
      },
      DEPOSIT_LANDING_TIMEOUT_MS,
      SHUTTLE_POLL_MS,
    );
  };

  const runDeposit = async (units: bigint): Promise<Result<DepositOutcome>> => {
    const createdAtMs = readNowMs();
    const intent = ledger.recordIntent(drawShuttleId(), units, createdAtMs);
    if (!intent.ok) return failure(`[runDeposit] nothing was sent, the deposit cannot be recorded first: ${intent.reason}`);
    const submitted = await chain.submitDeposit(units, intent.value.shuttleId);
    if (!submitted.ok) return failure(`[runDeposit] ${submitted.reason}`);
    const signature = submitted.value.signature;
    const sent = ledger.markSent(intent.value, signature);
    reportLedgerFailure(sent);
    const current: DepositRecord = sent.ok ? sent.value : intent.value;
    const confirmed = await chain.confirmDeposit(submitted.value);
    if (!confirmed.ok && confirmed.hasLanded) {
      reportLedgerFailure(ledger.settle(current));
      return failure(`[runDeposit] the deposit failed on base and moved nothing: ${confirmed.reason}`);
    }
    const landed = await waitForLanding(intent.value.shuttleId, confirmed.ok);
    if (!landed.ok) {
      reportLedgerFailure(ledger.markStranded(current, landed.reason));
      return success({ state: "pending", signature, shuttleId: intent.value.shuttleId });
    }
    reportLedgerFailure(ledger.settle(current));
    return success({ state: "landed", signature, units, landedMs: readNowMs() - createdAtMs });
  };

  const settleAs = (record: DepositRecord, state: RecoveryOutcome["state"], detail: string): RecoveryOutcome => {
    reportLedgerFailure(ledger.settle(record));
    return { shuttleId: record.shuttleId, state, detail };
  };

  const keepWaiting = (record: DepositRecord, detail: string): RecoveryOutcome => ({ shuttleId: record.shuttleId, state: "waiting", detail });

  const mergeShuttle = async (record: DepositRecord): Promise<RecoveryOutcome> => {
    const ack = await chain.mergeShuttle(record.shuttleId);
    if (ack.ok) return settleAs(record, "merged", ack.signature);
    const detail = `merge refused: ${ack.errorName} ${ack.detail}`;
    reportLedgerFailure(ledger.markStranded(record, detail));
    return keepWaiting(record, detail);
  };

  const recoverOne = async (record: DepositRecord): Promise<RecoveryOutcome> => {
    const shuttle = await chain.readShuttle(record.shuttleId);
    if (!shuttle.ok) return keepWaiting(record, shuttle.reason);
    if (shuttle.value === "funded") return mergeShuttle(record);
    if (shuttle.value === "emptied") return settleAs(record, "landed", "the rollup already merged the shuttle");
    const base = await chain.readBaseShuttle(record.shuttleId);
    if (!base.ok) return keepWaiting(record, base.reason);
    switch (base.value.kind) {
      case "missing":
        return readNowMs() - record.createdAtMs < UNSEEN_ON_BASE_GRACE_MS
          ? keepWaiting(record, "the deposit is not on base yet")
          : settleAs(record, "closed", "no shuttle on base two minutes after the deposit was recorded");
      case "delegated":
        return keepWaiting(record, "the shuttle is delegated and the rollup has not taken it yet");
      case "foreign":
        return keepWaiting(record, `unexpected shuttle owner ${base.value.owner}`);
      case "undelegated": {
        const redelegated = await chain.redelegateShuttle(record.shuttleId);
        if (!redelegated.ok) return keepWaiting(record, redelegated.reason);
        const visible = await pollUntil(
          "shuttle on the rollup",
          async () => {
            const sighting = await chain.readShuttle(record.shuttleId);
            return sighting.ok && sighting.value === "funded" ? true : null;
          },
          SHUTTLE_VISIBLE_TIMEOUT_MS,
          SHUTTLE_POLL_MS,
        );
        return visible.ok ? mergeShuttle(record) : keepWaiting(record, visible.reason);
      }
    }
  };

  const recoverPending = async (): Promise<RecoveryOutcome[]> => {
    const outcomes: RecoveryOutcome[] = [];
    for (const record of ledger.list()) outcomes.push(await recoverOne(record));
    return outcomes;
  };

  return {
    deposit: (units) => enqueue(() => runDeposit(units)),
    recoverPending: () => enqueue(recoverPending),
    listPending: ledger.list,
  };
};
