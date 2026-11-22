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
import { type TransactionSigner, readTokenUnits, resolveFeePayer, sendOnBase, sendOnRollup } from "./transport";

const PENDING_DEPOSITS_PREFIX = "sandwich.pending-deposits.v1.";
const DEPOSIT_LANDING_TIMEOUT_MS = 10_000;
const SHUTTLE_VISIBLE_TIMEOUT_MS = 30_000;
const BALANCE_POLL_MS = 250;

export type PendingDeposit = { shuttleId: number; units: string; signature: string; confirmedAtMs: number };

export type DepositOutcome =
  | { state: "landed"; signature: string; units: bigint; landedMs: number }
  | { state: "pending"; signature: string; shuttleId: number };

export type RecoveryOutcome = { shuttleId: number; state: "merged" | "waiting" | "gone"; detail: string };

export type DepositQueue = {
  deposit: (units: bigint) => Promise<Result<DepositOutcome>>;
  recoverPending: () => Promise<RecoveryOutcome[]>;
  listPending: () => PendingDeposit[];
};

export type DepositQueueSetup = {
  client: ChainClient;
  owner: TransactionSigner;
  mint: PublicKey;
  validator: PublicKey;
  store: KeyStore;
};

const isPendingDeposit = (value: unknown): value is PendingDeposit =>
  typeof value === "object" &&
  value !== null &&
  "shuttleId" in value &&
  typeof value.shuttleId === "number" &&
  "units" in value &&
  typeof value.units === "string" &&
  "signature" in value &&
  typeof value.signature === "string" &&
  "confirmedAtMs" in value &&
  typeof value.confirmedAtMs === "number";

const drawShuttleId = (): number => crypto.getRandomValues(new Uint32Array(1))[0] ?? 0;

export const createDepositQueue = ({ client, owner, mint, validator, store }: DepositQueueSetup): DepositQueue => {
  const storageKey = `${PENDING_DEPOSITS_PREFIX}${owner.publicKey.toBase58()}`;
  const ownerToken = findWalletTokenAddress(owner.publicKey, mint);
  const feePayer = resolveFeePayer(client.feePayment, owner.publicKey);
  let queueTail: Promise<unknown> = Promise.resolve();

  const enqueue = <Value>(task: () => Promise<Value>): Promise<Value> => {
    const run = queueTail.then(task);
    queueTail = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  };

  const listPending = (): PendingDeposit[] => {
    const storedText = store.read(storageKey);
    const parsed = storedText === null ? null : attemptSync((): unknown => JSON.parse(storedText));
    if (parsed === null || !parsed.ok || !Array.isArray(parsed.value)) return [];
    const entries: unknown[] = parsed.value;
    return entries.filter(isPendingDeposit);
  };

  const savePending = (pending: PendingDeposit[]) => {
    if (pending.length === 0) store.remove(storageKey);
    else store.write(storageKey, JSON.stringify(pending));
  };

  const forgetPending = (shuttleId: number) => savePending(listPending().filter((entry) => entry.shuttleId !== shuttleId));

  const runDeposit = async (units: bigint): Promise<Result<DepositOutcome>> => {
    const before = await readTokenUnits(client.rollup, ownerToken);
    if (!before.ok) return failure(`[runDeposit] rollup balance: ${before.reason}`);
    const shuttleId = drawShuttleId();
    const instructions = await attempt(() => delegateSpl(owner.publicKey, mint, units, { validator, payer: feePayer, shuttleId }));
    if (!instructions.ok) return failure(`[runDeposit] build: ${instructions.reason}`);
    const sent = await sendOnBase(client.base, client.feePayment, instructions.value, [owner]);
    if (!sent.ok) return failure(`[runDeposit] ${sent.reason}`);
    const confirmedAtMs = Date.now();
    savePending([...listPending(), { shuttleId, units: units.toString(), signature: sent.value.signature, confirmedAtMs }]);
    const landed = await pollUntil(
      "deposit on the rollup",
      async () => {
        const current = await readTokenUnits(client.rollup, ownerToken);
        return current.ok && current.value !== before.value ? current.value : null;
      },
      DEPOSIT_LANDING_TIMEOUT_MS,
      BALANCE_POLL_MS,
    );
    if (!landed.ok) return success({ state: "pending", signature: sent.value.signature, shuttleId });
    forgetPending(shuttleId);
    return success({ state: "landed", signature: sent.value.signature, units, landedMs: Date.now() - confirmedAtMs });
  };

  const mergeShuttle = async (pending: PendingDeposit, shuttleEphemeralAta: PublicKey, shuttleWalletAta: PublicKey): Promise<RecoveryOutcome> => {
    const merge = mergeShuttleIntoAtaIx(owner.publicKey, ownerToken, shuttleEphemeralAta, shuttleWalletAta, mint);
    const ack = await sendOnRollup(client.rollupUrl, client.rollupBlockhashes, [merge], [owner]);
    if (!ack.ok) return { shuttleId: pending.shuttleId, state: "waiting", detail: `merge refused: ${ack.errorName} ${ack.detail}` };
    forgetPending(pending.shuttleId);
    return { shuttleId: pending.shuttleId, state: "merged", detail: ack.signature };
  };

  const recoverOne = async (pending: PendingDeposit): Promise<RecoveryOutcome> => {
    const [shuttleEphemeralAta] = deriveShuttleEphemeralAta(owner.publicKey, mint, pending.shuttleId);
    const [shuttleAta] = deriveShuttleAta(shuttleEphemeralAta, mint);
    const shuttleWalletAta = deriveShuttleWalletAta(mint, shuttleEphemeralAta);
    const readShuttleUnits = async () => {
      const units = await readTokenUnits(client.rollup, shuttleWalletAta);
      return units.ok && units.value > 0n ? units.value : null;
    };
    if ((await readShuttleUnits()) !== null) return mergeShuttle(pending, shuttleEphemeralAta, shuttleWalletAta);
    const record = await attempt(() => client.base.getAccountInfo(shuttleAta, "confirmed"));
    if (!record.ok) return { shuttleId: pending.shuttleId, state: "waiting", detail: record.reason };
    if (record.value === null) {
      forgetPending(pending.shuttleId);
      return { shuttleId: pending.shuttleId, state: "gone", detail: "the shuttle record is closed on base" };
    }
    if (record.value.owner.equals(DELEGATION_PROGRAM_ID)) {
      return { shuttleId: pending.shuttleId, state: "waiting", detail: "the shuttle is still delegated and the rollup has not taken it" };
    }
    if (!record.value.owner.equals(EPHEMERAL_SPL_TOKEN_PROGRAM_ID)) {
      return { shuttleId: pending.shuttleId, state: "waiting", detail: `unexpected shuttle owner ${record.value.owner.toBase58()}` };
    }
    const redelegate = delegateShuttleEphemeralAtaIx(feePayer, shuttleEphemeralAta, shuttleAta, validator);
    const sent = await sendOnBase(client.base, client.feePayment, [redelegate], [owner]);
    if (!sent.ok) return { shuttleId: pending.shuttleId, state: "waiting", detail: sent.reason };
    const visible = await pollUntil("shuttle on the rollup", readShuttleUnits, SHUTTLE_VISIBLE_TIMEOUT_MS, BALANCE_POLL_MS);
    if (!visible.ok) return { shuttleId: pending.shuttleId, state: "waiting", detail: visible.reason };
    return mergeShuttle(pending, shuttleEphemeralAta, shuttleWalletAta);
  };

  const recoverPending = async (): Promise<RecoveryOutcome[]> => {
    const outcomes: RecoveryOutcome[] = [];
    for (const pending of listPending()) outcomes.push(await recoverOne(pending));
    return outcomes;
  };

  return {
    deposit: (units) => enqueue(() => runDeposit(units)),
    recoverPending: () => enqueue(recoverPending),
    listPending,
  };
};
