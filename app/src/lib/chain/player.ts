import type { PublicKey, TransactionInstruction } from "@solana/web3.js";
import { findSeatAddress } from "./addresses";
import type { ChainClient } from "./client";
import {
  type SeatActor,
  buildAnteInstruction,
  buildBuyInInstruction,
  buildCashOutInstruction,
  buildEvictSeatInstruction,
  buildFaucetInstructions,
  buildFlyToInstruction,
  buildJoinInstruction,
  buildLandSwatInstruction,
  buildLeaveInstruction,
  buildPeckInstruction,
  buildRaiseHandInstruction,
  buildSettleInstruction,
  buildSitInstructions,
  buildStartRoundInstruction,
  buildTakeOffInstruction,
} from "./program";
import { type Result, attempt, failure, success } from "./result";
import type { SessionKeeper } from "./session";
import {
  type BaseSend,
  type RollupAck,
  type TransactionSigner,
  createKeypairSigner,
  refuseLocally,
  resolveFeePayer,
  sendOnBase,
  sendOnRollup,
} from "./transport";

const sendBuiltOnBase = async (
  client: ChainClient,
  label: string,
  build: () => Promise<TransactionInstruction[]>,
  wallet: TransactionSigner,
): Promise<Result<BaseSend>> => {
  const instructions = await attempt(build);
  if (!instructions.ok) return failure(`[${label}] build: ${instructions.reason}`);
  const sent = await sendOnBase(client.base, client.feePayment, instructions.value, [wallet]);
  return sent.ok ? sent : failure(`[${label}] ${sent.reason}`);
};

export const sitAtTable = (client: ChainClient, wallet: TransactionSigner, table: PublicKey) =>
  sendBuiltOnBase(
    client,
    "sitAtTable",
    () => buildSitInstructions(client.programs.sandwich, resolveFeePayer(client.feePayment, wallet.publicKey), wallet.publicKey, table),
    wallet,
  );

export const claimTestUsdc = (client: ChainClient, wallet: TransactionSigner) =>
  sendBuiltOnBase(
    client,
    "claimTestUsdc",
    () => buildFaucetInstructions(client.programs.sandwich, resolveFeePayer(client.feePayment, wallet.publicKey), wallet.publicKey),
    wallet,
  );

export type SeatActions = {
  join: () => Promise<RollupAck>;
  leave: () => Promise<RollupAck>;
  ante: () => Promise<RollupAck>;
  flyTo: (boxIndex: number) => Promise<RollupAck>;
  takeOff: () => Promise<RollupAck>;
  peck: () => Promise<RollupAck>;
  raiseHand: (boxIndex: number) => Promise<RollupAck>;
  buyIn: (chips: bigint) => Promise<RollupAck>;
  cashOut: (chips: bigint) => Promise<RollupAck>;
  startRound: () => Promise<RollupAck>;
  landSwat: (seats: PublicKey[]) => Promise<RollupAck>;
  settle: (seats: PublicKey[]) => Promise<RollupAck>;
  evictSeat: (wallet: PublicKey, paysOut: boolean) => Promise<RollupAck>;
};

export type SeatActionsSetup = {
  client: ChainClient;
  table: PublicKey;
  mint: PublicKey;
  wallet: TransactionSigner;
  sessions: SessionKeeper | null;
};

type ResolvedActor = { signer: TransactionSigner; actor: SeatActor };

export const createSeatActions = ({ client, table, mint, wallet, sessions }: SeatActionsSetup): SeatActions => {
  const program = client.programs.sandwich;
  const walletActor: SeatActor = { signer: wallet.publicKey, wallet: wallet.publicKey, table, seat: findSeatAddress(table, wallet.publicKey), sessionToken: null };

  const resolveSessionActor = async (): Promise<Result<ResolvedActor>> => {
    if (sessions === null) return success({ signer: wallet, actor: walletActor });
    const session = await sessions.resolve();
    if (!session.ok) return failure(`[createSeatActions] no usable session: ${session.reason}`);
    const signer = createKeypairSigner(session.value.signer);
    return success({ signer, actor: { ...walletActor, signer: signer.publicKey, sessionToken: session.value.token } });
  };

  const send = async (resolveActor: () => Promise<Result<ResolvedActor>>, build: (actor: SeatActor) => Promise<TransactionInstruction>) => {
    const resolved = await resolveActor();
    if (!resolved.ok) return refuseLocally(resolved.reason);
    const instruction = await attempt(() => build(resolved.value.actor));
    if (!instruction.ok) return refuseLocally(instruction.reason);
    return sendOnRollup(client.rollupUrl, client.rollupBlockhashes, [instruction.value], [resolved.value.signer]);
  };
  const sendAsSession = (build: (actor: SeatActor) => Promise<TransactionInstruction>) => send(resolveSessionActor, build);
  const sendAsWallet = (build: (actor: SeatActor) => Promise<TransactionInstruction>) =>
    send(async () => success({ signer: wallet, actor: walletActor }), build);

  return {
    join: () => sendAsSession((actor) => buildJoinInstruction(program, actor)),
    leave: () => sendAsSession((actor) => buildLeaveInstruction(program, actor)),
    ante: () => sendAsSession((actor) => buildAnteInstruction(program, actor)),
    flyTo: (boxIndex) => sendAsSession((actor) => buildFlyToInstruction(program, actor, boxIndex)),
    takeOff: () => sendAsSession((actor) => buildTakeOffInstruction(program, actor)),
    peck: () => sendAsSession((actor) => buildPeckInstruction(program, actor)),
    raiseHand: (boxIndex) => sendAsSession((actor) => buildRaiseHandInstruction(program, actor, boxIndex)),
    buyIn: (chips) => sendAsWallet((actor) => buildBuyInInstruction(program, actor, mint, chips)),
    cashOut: (chips) => sendAsSession((actor) => buildCashOutInstruction(program, actor, mint, chips)),
    startRound: () => sendAsSession((actor) => buildStartRoundInstruction(program, actor.signer, table)),
    landSwat: (seats) => sendAsSession(() => buildLandSwatInstruction(program, table, seats)),
    settle: (seats) => sendAsSession(() => buildSettleInstruction(program, table, seats)),
    evictSeat: (seatWallet, paysOut) => sendAsSession(() => buildEvictSeatInstruction(program, table, mint, seatWallet, paysOut)),
  };
};
