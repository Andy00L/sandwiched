import type { PublicKey, TransactionInstruction } from "@solana/web3.js";
import type { ChainClient } from "./client";
import {
  type SeatActor,
  buildAnteInstruction,
  buildBuyInInstruction,
  buildCashOutInstruction,
  buildFaucetInstructions,
  buildFlyToInstruction,
  buildJoinInstruction,
  buildLeaveInstruction,
  buildPeckInstruction,
  buildRaiseHandInstruction,
  buildSettleInstruction,
  buildSitInstructions,
  buildStartRoundInstruction,
  buildTakeOffInstruction,
} from "./program";
import { type Result, attempt, failure } from "./result";
import type { SessionKey } from "./session";
import {
  type BaseSend,
  type RollupAck,
  type TransactionSigner,
  createKeypairSigner,
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
  settle: (seats: PublicKey[]) => Promise<RollupAck>;
};

export type SeatActionsSetup = {
  client: ChainClient;
  table: PublicKey;
  mint: PublicKey;
  wallet: TransactionSigner;
  session: SessionKey | null;
};

export const createSeatActions = ({ client, table, mint, wallet, session }: SeatActionsSetup): SeatActions => {
  const program = client.programs.sandwich;
  const actionSigner = session === null ? wallet : createKeypairSigner(session.signer);
  const actor: SeatActor = {
    signer: actionSigner.publicKey,
    wallet: wallet.publicKey,
    table,
    sessionToken: session?.token ?? null,
  };
  const send = async (build: () => Promise<TransactionInstruction>, signer: TransactionSigner): Promise<RollupAck> => {
    const instruction = await attempt(build);
    if (!instruction.ok) {
      return { ok: false, kind: "client", errorCode: null, errorName: "client", detail: instruction.reason, ackMs: 0 };
    }
    return sendOnRollup(client.rollupUrl, client.rollupBlockhashes, [instruction.value], [signer]);
  };
  return {
    join: () => send(() => buildJoinInstruction(program, actor), actionSigner),
    leave: () => send(() => buildLeaveInstruction(program, actor), actionSigner),
    ante: () => send(() => buildAnteInstruction(program, actor), actionSigner),
    flyTo: (boxIndex) => send(() => buildFlyToInstruction(program, actor, boxIndex), actionSigner),
    takeOff: () => send(() => buildTakeOffInstruction(program, actor), actionSigner),
    peck: () => send(() => buildPeckInstruction(program, actor), actionSigner),
    raiseHand: (boxIndex) => send(() => buildRaiseHandInstruction(program, actor, boxIndex), actionSigner),
    buyIn: (chips) => send(() => buildBuyInInstruction(program, wallet.publicKey, table, mint, chips), wallet),
    cashOut: (chips) => send(() => buildCashOutInstruction(program, actor, mint, chips), actionSigner),
    startRound: () => send(() => buildStartRoundInstruction(program, actionSigner.publicKey, table), actionSigner),
    settle: (seats) => send(() => buildSettleInstruction(program, table, seats), actionSigner),
  };
};
