import { afterEach, beforeEach, describe, expect, jest, test } from "bun:test";
import { Keypair } from "@solana/web3.js";
import { advanceFakeTime } from "../../../tests/fake-time";
import { type BaseShuttle, type DepositChain, type DepositOutcome, type ShuttleSighting, createDepositQueue } from "./deposits";
import { type KeyStore, createMemoryKeyStore } from "./key-store";
import type { Result } from "./result";
import type { BaseConfirmation } from "./transport";

const DEPOSIT_UNITS = 1_000n;
const LANDING_WAIT_MS = 11_000;
const TWO_MINUTES_MS = 120_000;
const OWNER = Keypair.generate().publicKey;

type FakeChainScript = {
  ownerUnits?: (readIndex: number) => bigint;
  shuttle?: (readIndex: number) => ShuttleSighting;
  baseShuttle?: BaseShuttle;
  confirmation?: BaseConfirmation;
  onSubmit?: () => void;
};

const createFakeDepositChain = (script: FakeChainScript = {}) => {
  let ownerReads = 0;
  let shuttleReads = 0;
  const calls = { submits: 0, merges: 0, redelegates: 0 };
  const chain: DepositChain = {
    readOwnerUnits: async () => ({ ok: true, value: script.ownerUnits?.(ownerReads++) ?? 0n }),
    readShuttle: async () => ({ ok: true, value: script.shuttle?.(shuttleReads++) ?? "absent" }),
    readBaseShuttle: async () => ({ ok: true, value: script.baseShuttle ?? { kind: "missing" } }),
    submitDeposit: async () => {
      calls.submits += 1;
      script.onSubmit?.();
      return { ok: true, value: { signature: "deposit-signature", blockhash: "hash", lastValidBlockHeight: 1, submittedAtMs: 0 } };
    },
    confirmDeposit: async () => script.confirmation ?? { ok: true, value: { signature: "deposit-signature", confirmMs: 1 } },
    redelegateShuttle: async () => {
      calls.redelegates += 1;
      return { ok: true, value: null };
    },
    mergeShuttle: async () => {
      calls.merges += 1;
      return { ok: true, signature: "merge-signature", ackMs: 1 };
    },
  };
  return { chain, calls };
};

const settleWithFakeTime = async <Value>(pending: Promise<Value>, waitMs: number = LANDING_WAIT_MS): Promise<Value> => {
  await advanceFakeTime(waitMs, 250);
  return pending;
};

const readState = (outcome: Result<DepositOutcome>) => (outcome.ok ? outcome.value.state : outcome.reason);

beforeEach(() => jest.useFakeTimers());
afterEach(() => jest.useRealTimers());

describe("createDepositQueue deposit", () => {
  test("records the shuttle before the transaction leaves, so a reload mid-send can still find it", async () => {
    const store = createMemoryKeyStore();
    let recordedAtSend: string[] = [];
    const { chain } = createFakeDepositChain({ onSubmit: () => (recordedAtSend = createDepositQueue({ chain, owner: OWNER, store }).listPending().map((record) => record.state)) });
    await settleWithFakeTime(createDepositQueue({ chain, owner: OWNER, store }).deposit(DEPOSIT_UNITS));
    expect(recordedAtSend).toEqual(["intent"]);
  });

  test("keeps a deposit whose confirmation never resolved as stranded, with its signature", async () => {
    const store = createMemoryKeyStore();
    const { chain } = createFakeDepositChain({ confirmation: { ok: false, reason: "block height exceeded", hasLanded: false } });
    const queue = createDepositQueue({ chain, owner: OWNER, store });
    const outcome = await settleWithFakeTime(queue.deposit(DEPOSIT_UNITS));
    expect(readState(outcome)).toBe("pending");
    expect(queue.listPending()).toMatchObject([{ state: "stranded", signature: "deposit-signature", units: DEPOSIT_UNITS }]);
  });

  test("sends nothing when the storage refuses to record the deposit", async () => {
    const refusingStore: KeyStore = { ...createMemoryKeyStore(), write: () => false };
    const { chain, calls } = createFakeDepositChain();
    const outcome = await settleWithFakeTime(createDepositQueue({ chain, owner: OWNER, store: refusingStore }).deposit(DEPOSIT_UNITS));
    expect(outcome.ok).toBe(false);
    expect(calls.submits).toBe(0);
  });

  test("forgets a deposit that failed on base, since it moved nothing", async () => {
    const store = createMemoryKeyStore();
    const { chain } = createFakeDepositChain({ confirmation: { ok: false, reason: "InstructionError", hasLanded: true } });
    const queue = createDepositQueue({ chain, owner: OWNER, store });
    const outcome = await settleWithFakeTime(queue.deposit(DEPOSIT_UNITS));
    expect(outcome.ok).toBe(false);
    expect(queue.listPending()).toEqual([]);
  });

  test("does not count a buy-in during the landing window as the deposit landing", async () => {
    const store = createMemoryKeyStore();
    const { chain } = createFakeDepositChain({ ownerUnits: (readIndex) => (readIndex === 0 ? 5_000n : 4_000n), shuttle: () => "funded" });
    const queue = createDepositQueue({ chain, owner: OWNER, store });
    const outcome = await settleWithFakeTime(queue.deposit(DEPOSIT_UNITS));
    expect(readState(outcome)).toBe("pending");
    expect(queue.listPending()).toMatchObject([{ state: "stranded" }]);
  });

  test("lands when the shuttle empties, even though a buy-in lowered the balance meanwhile", async () => {
    const store = createMemoryKeyStore();
    const { chain } = createFakeDepositChain({
      ownerUnits: (readIndex) => (readIndex === 0 ? 5_000n : 4_500n),
      shuttle: (readIndex) => (readIndex < 2 ? "funded" : "emptied"),
    });
    const queue = createDepositQueue({ chain, owner: OWNER, store });
    expect(readState(await settleWithFakeTime(queue.deposit(DEPOSIT_UNITS)))).toBe("landed");
    expect(queue.listPending()).toEqual([]);
  });

  test("lands when the balance rose by the deposited units", async () => {
    const store = createMemoryKeyStore();
    const { chain } = createFakeDepositChain({ ownerUnits: (readIndex) => (readIndex < 2 ? 5_000n : 6_000n) });
    expect(readState(await settleWithFakeTime(createDepositQueue({ chain, owner: OWNER, store }).deposit(DEPOSIT_UNITS)))).toBe("landed");
  });

  test("two tabs depositing at once keep both records", async () => {
    const store = createMemoryKeyStore();
    const { chain } = createFakeDepositChain();
    const [firstTab, secondTab] = [createDepositQueue({ chain, owner: OWNER, store }), createDepositQueue({ chain, owner: OWNER, store })];
    await settleWithFakeTime(Promise.all([firstTab.deposit(DEPOSIT_UNITS), secondTab.deposit(DEPOSIT_UNITS * 2n)]));
    expect(firstTab.listPending().map((record) => record.units).sort()).toEqual([DEPOSIT_UNITS, DEPOSIT_UNITS * 2n]);
  });
});

describe("createDepositQueue recoverPending", () => {
  const strandOneDeposit = async (store: KeyStore, nowMs: { value: number }) => {
    const { chain } = createFakeDepositChain();
    await settleWithFakeTime(createDepositQueue({ chain, owner: OWNER, store, readNowMs: () => nowMs.value }).deposit(DEPOSIT_UNITS));
  };

  test("waits for a deposit missing on base until it is two minutes old, then closes it", async () => {
    const store = createMemoryKeyStore();
    const nowMs = { value: 1_000 };
    await strandOneDeposit(store, nowMs);
    const { chain } = createFakeDepositChain({ baseShuttle: { kind: "missing" } });
    const queue = createDepositQueue({ chain, owner: OWNER, store, readNowMs: () => nowMs.value });
    expect(await queue.recoverPending()).toMatchObject([{ state: "waiting" }]);
    expect(queue.listPending()).toHaveLength(1);
    nowMs.value += TWO_MINUTES_MS;
    expect(await queue.recoverPending()).toMatchObject([{ state: "closed" }]);
    expect(queue.listPending()).toEqual([]);
  });

  test("merges a shuttle the rollup holds and forgets it", async () => {
    const store = createMemoryKeyStore();
    await strandOneDeposit(store, { value: 1_000 });
    const { chain, calls } = createFakeDepositChain({ shuttle: () => "funded" });
    const queue = createDepositQueue({ chain, owner: OWNER, store });
    expect(await queue.recoverPending()).toMatchObject([{ state: "merged", detail: "merge-signature" }]);
    expect(calls.merges).toBe(1);
    expect(queue.listPending()).toEqual([]);
  });

  test("redelegates a shuttle that came back to base, then merges it once the rollup shows it", async () => {
    const store = createMemoryKeyStore();
    await strandOneDeposit(store, { value: 1_000 });
    const { chain, calls } = createFakeDepositChain({ baseShuttle: { kind: "undelegated" }, shuttle: (readIndex) => (readIndex < 2 ? "absent" : "funded") });
    const queue = createDepositQueue({ chain, owner: OWNER, store });
    expect(await settleWithFakeTime(queue.recoverPending(), 2_000)).toMatchObject([{ state: "merged" }]);
    expect(calls.redelegates).toBe(1);
  });
});
