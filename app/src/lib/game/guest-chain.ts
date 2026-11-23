import type { PublicKey } from "@solana/web3.js";
import { type TableSnapshot, fetchSeat } from "../chain/accounts";
import { findSeatAddress, findWalletTokenAddress } from "../chain/addresses";
import type { ChainClient } from "../chain/client";
import { readDelegationStatus } from "../chain/delegation";
import { createDepositChain, createDepositQueue } from "../chain/deposits";
import type { KeyStore } from "../chain/key-store";
import { type PreparedLeave, claimTestUsdc, createSeatActions, sitAtTable, withdrawToBase } from "../chain/player";
import { type Result, failure, success } from "../chain/result";
import { createSessionKeeper } from "../chain/session";
import { type RollupAck, type TransactionSigner, readTokenUnits } from "../chain/transport";
import { CHIPS_PER_ANTE } from "./chain-rules";
import type { GuestChain, GuestFacts, GuestNeeds, GuestStep } from "./guest-steps";
import type { PlayerActions } from "./table-player";

export const BUY_IN_ANTES = 10n;
export const DEFAULT_BUY_IN_CHIPS = BUY_IN_ANTES * BigInt(CHIPS_PER_ANTE);

export type ActionSigner = "session" | "wallet";

export type GuestChainSetup = {
  client: ChainClient;
  wallet: TransactionSigner;
  table: PublicKey;
  tableSnapshot: TableSnapshot;
  keyStore: KeyStore;
  signsWith: ActionSigner;
  buyInChips: bigint;
};

export type CashOutReceipt =
  | { kind: "withdrawn"; chips: bigint; units: bigint; baseSignature: string | null }
  | { kind: "onRollup"; chips: bigint; units: bigint; reason: string }
  | { kind: "untouched"; reason: string };

export type GuestPlayChain = {
  guest: GuestChain;
  actions: PlayerActions;
  needs: GuestNeeds;
  cashOut: () => Promise<Result<CashOutReceipt>>;
  prepareLeave: () => Promise<Result<PreparedLeave>>;
};

const fromAck = (label: string, ack: RollupAck): Result<string> =>
  ack.ok ? success(ack.signature) : failure(`[${label}] ${ack.errorName} ${ack.detail}`);

export function createGuestPlayChain({ client, wallet, table, tableSnapshot, keyStore, signsWith, buyInChips }: GuestChainSetup): GuestPlayChain {
  const mint = tableSnapshot.mint;
  const seatAddress = findSeatAddress(table, wallet.publicKey);
  const walletToken = findWalletTokenAddress(wallet.publicKey, mint);
  const sessions = signsWith === "session" ? createSessionKeeper(client, wallet, keyStore) : null;
  const seatActions = createSeatActions({ client, table, mint, wallet, sessions });
  const deposits = createDepositQueue({ chain: createDepositChain({ client, owner: wallet, mint, validator: tableSnapshot.validator }), owner: wallet.publicKey, store: keyStore });
  const chipsPerBuyIn = buyInChips;
  const needs: GuestNeeds = { chipsToPlay: BigInt(CHIPS_PER_ANTE), unitsPerBuyIn: chipsPerBuyIn * tableSnapshot.chipUnits };
  let hasSession = sessions === null;

  const readFacts = async (): Promise<Result<GuestFacts>> => {
    const [seatDelegated, tokenDelegated, seat, walletUnits] = await Promise.all([
      readDelegationStatus(client.rollupUrl, seatAddress),
      readDelegationStatus(client.rollupUrl, walletToken),
      fetchSeat(client.programs.sandwich, client.rollup, seatAddress),
      readTokenUnits(client.base, walletToken),
    ]);
    if (!seatDelegated.ok) return seatDelegated;
    if (!tokenDelegated.ok) return tokenDelegated;
    if (!seat.ok) return failure(`[readFacts] seat: ${seat.reason}`);
    const rollupUnits = tokenDelegated.value ? await readTokenUnits(client.rollup, walletToken) : success(0n);
    const isSeatOnRollup = seatDelegated.value && seat.value !== null;
    return success({
      isSeatOnRollup,
      hasSession,
      seatIndex: isSeatOnRollup ? (seat.value?.seatIndex ?? null) : null,
      chips: isSeatOnRollup ? (seat.value?.chips ?? 0n) : 0n,
      walletUnits: walletUnits.ok ? walletUnits.value : 0n,
      rollupUnits: rollupUnits.ok ? rollupUnits.value : 0n,
    });
  };

  const run = async (step: GuestStep): Promise<Result<string>> => {
    switch (step) {
      case "sit": {
        const seated = await sitAtTable(client, wallet, table);
        return seated.ok ? success(seated.value.signature) : seated;
      }
      case "session": {
        if (sessions === null) return failure("[createGuestPlayChain] a wallet-signed player opens no session");
        const opened = await sessions.resolve();
        if (!opened.ok) return opened;
        hasSession = true;
        return success(opened.value.signature ?? "stored session");
      }
      case "join":
        return fromAck("join", await seatActions.join());
      case "fund": {
        const funded = await claimTestUsdc(client, wallet);
        return funded.ok ? success(funded.value.signature) : funded;
      }
      case "deposit": {
        if (deposits.listPending().length > 0) {
          const recovered = await deposits.recoverPending();
          const merged = recovered.filter((outcome) => outcome.state === "merged" || outcome.state === "landed");
          if (merged.length > 0) return success(merged.map((outcome) => `${outcome.shuttleId}:${outcome.state}`).join(", "));
        }
        const deposited = await deposits.deposit(needs.unitsPerBuyIn);
        return deposited.ok ? success(deposited.value.signature) : deposited;
      }
      case "buyIn":
        return fromAck("buyIn", await seatActions.buyIn(chipsPerBuyIn));
    }
  };

  const actions: PlayerActions = {
    ante: seatActions.ante,
    flyTo: seatActions.flyTo,
    takeOff: seatActions.takeOff,
    peck: seatActions.peck,
    raiseHand: seatActions.raiseHand,
    startRound: seatActions.startRound,
    landSwat: seatActions.landSwat,
    settle: seatActions.settle,
    evictSeat: async (seatWallet) => {
      const paidOut = await seatActions.evictSeat(seatWallet, true);
      return paidOut.ok ? paidOut : seatActions.evictSeat(seatWallet, false);
    },
  };

  const cashOut = async (): Promise<Result<CashOutReceipt>> => {
    const seat = await fetchSeat(client.programs.sandwich, client.rollup, seatAddress);
    if (!seat.ok) return failure(`[cashOut] seat: ${seat.reason}`);
    const chips = seat.value?.chips ?? 0n;
    if (chips > 0n) {
      const cashed = await seatActions.cashOut(chips);
      if (!cashed.ok) return failure(`[cashOut] ${cashed.errorName} ${cashed.detail}`);
    }
    const isAtTable = seat.value !== null && seat.value.seatIndex !== null;
    const left = isAtTable ? await seatActions.leave() : null;
    if (left !== null && !left.ok) console.warn(`[cashOut] leave refused: ${left.errorName} ${left.detail}`);
    const withdrawn = await withdrawToBase(client, wallet, mint, tableSnapshot.validator);
    if (!withdrawn.ok) return success({ kind: "onRollup", chips, units: chips * tableSnapshot.chipUnits, reason: withdrawn.reason });
    return success({ kind: "withdrawn", chips, units: withdrawn.value.units, baseSignature: withdrawn.value.signature });
  };

  const prepareLeave = async (): Promise<Result<PreparedLeave>> => {
    const seat = await fetchSeat(client.programs.sandwich, client.rollup, seatAddress);
    if (!seat.ok) return failure(`[prepareLeave] seat: ${seat.reason}`);
    return seatActions.prepareLeave(seat.value?.chips ?? 0n);
  };

  return { guest: { readFacts, run, readDecline: wallet.readDecline }, actions, needs, cashOut, prepareLeave };
}
