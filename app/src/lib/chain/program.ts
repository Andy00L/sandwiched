import { BN, Program } from "@coral-xyz/anchor";
import {
  DELEGATION_PROGRAM_ID,
  delegateBufferPdaFromDelegatedAccountAndOwnerProgram,
  delegationMetadataPdaFromDelegatedAccount,
  delegationRecordPdaFromDelegatedAccount,
} from "@magicblock-labs/ephemeral-rollups-sdk";
import type { GplSession } from "@magicblock-labs/gum-sdk/lib/idl/gpl_session";
import gplSessionIdl from "@magicblock-labs/gum-sdk/lib/idl/gpl_session.json";
import { TOKEN_PROGRAM_ID, createAssociatedTokenAccountIdempotentInstruction } from "@solana/spl-token";
import { type Connection, PublicKey, SystemProgram, type TransactionInstruction } from "@solana/web3.js";
import {
  findCustodyAddress,
  findEscrowTokenAddress,
  findFaucetAuthorityAddress,
  findFaucetClaimAddress,
  findProgramIdentityAddress,
  findSeatAddress,
  findSessionTokenAddress,
  findTestMintAddress,
  findWalletTokenAddress,
} from "./addresses";
import { SANDWICH_PROGRAM_ID } from "./config";
import type { Sandwich } from "./idl/sandwich";
import sandwichIdl from "./idl/sandwich.json";

export type SandwichProgram = Program<Sandwich>;
export type SessionProgram = Program<GplSession>;
export type ChainPrograms = { sandwich: SandwichProgram; session: SessionProgram };

export const createChainPrograms = (connection: Connection): ChainPrograms => ({
  sandwich: new Program<Sandwich>(sandwichIdl as Sandwich, { connection }),
  session: new Program<GplSession>(gplSessionIdl as GplSession, { connection }),
});

export type SeatActor = { signer: PublicKey; wallet: PublicKey; table: PublicKey; seat: PublicKey; sessionToken: PublicKey | null };

const toBN = (value: bigint): BN => new BN(value.toString());

const findDelegationAccounts = (delegated: PublicKey) => ({
  buffer: delegateBufferPdaFromDelegatedAccountAndOwnerProgram(delegated, SANDWICH_PROGRAM_ID),
  record: delegationRecordPdaFromDelegatedAccount(delegated),
  metadata: delegationMetadataPdaFromDelegatedAccount(delegated),
});

export const buildSitInstructions = async (
  program: SandwichProgram,
  payer: PublicKey,
  wallet: PublicKey,
  table: PublicKey,
): Promise<TransactionInstruction[]> => {
  const seat = findSeatAddress(table, wallet);
  const delegation = findDelegationAccounts(seat);
  return [
    await program.methods.sit().accountsStrict({ payer, wallet, table, seat, systemProgram: SystemProgram.programId }).instruction(),
    await program.methods
      .delegateSeat()
      .accountsStrict({
        payer,
        wallet,
        table,
        seat,
        bufferSeat: delegation.buffer,
        delegationRecordSeat: delegation.record,
        delegationMetadataSeat: delegation.metadata,
        ownerProgram: SANDWICH_PROGRAM_ID,
        delegationProgram: DELEGATION_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
      })
      .instruction(),
  ];
};

export const buildFaucetInstructions = async (
  program: SandwichProgram,
  payer: PublicKey,
  wallet: PublicKey,
): Promise<TransactionInstruction[]> => {
  const testMint = findTestMintAddress();
  const walletToken = findWalletTokenAddress(wallet, testMint);
  return [
    createAssociatedTokenAccountIdempotentInstruction(payer, walletToken, wallet, testMint),
    await program.methods
      .faucet()
      .accountsStrict({
        payer,
        wallet,
        claim: findFaucetClaimAddress(wallet),
        testMint,
        faucetAuthority: findFaucetAuthorityAddress(),
        walletToken,
        tokenProgram: TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
      })
      .instruction(),
  ];
};

const seatActionAccounts = (actor: SeatActor) => ({
  signer: actor.signer,
  table: actor.table,
  seat: actor.seat,
  sessionToken: actor.sessionToken,
});

export const buildJoinInstruction = (program: SandwichProgram, actor: SeatActor) =>
  program.methods.join().accountsStrict(seatActionAccounts(actor)).instruction();

export const buildLeaveInstruction = (program: SandwichProgram, actor: SeatActor) =>
  program.methods.leave().accountsStrict(seatActionAccounts(actor)).instruction();

export const buildAnteInstruction = (program: SandwichProgram, actor: SeatActor) =>
  program.methods.ante().accountsStrict(seatActionAccounts(actor)).instruction();

export const buildFlyToInstruction = (program: SandwichProgram, actor: SeatActor, boxIndex: number) =>
  program.methods.flyTo(boxIndex).accountsStrict(seatActionAccounts(actor)).instruction();

export const buildTakeOffInstruction = (program: SandwichProgram, actor: SeatActor) =>
  program.methods.takeOff().accountsStrict(seatActionAccounts(actor)).instruction();

export const buildPeckInstruction = (program: SandwichProgram, actor: SeatActor) =>
  program.methods.peck().accountsStrict(seatActionAccounts(actor)).instruction();

export const buildRaiseHandInstruction = (program: SandwichProgram, actor: SeatActor, boxIndex: number) =>
  program.methods.raiseHand(boxIndex).accountsStrict(seatActionAccounts(actor)).instruction();

export const buildBuyInInstruction = (program: SandwichProgram, actor: SeatActor, mint: PublicKey, chips: bigint) =>
  program.methods
    .buyIn(toBN(chips))
    .accountsStrict({
      wallet: actor.wallet,
      table: actor.table,
      seat: actor.seat,
      walletToken: findWalletTokenAddress(actor.wallet, mint),
      escrowToken: findEscrowTokenAddress(actor.table, mint),
      tokenProgram: TOKEN_PROGRAM_ID,
    })
    .instruction();

export const buildCashOutInstruction = (program: SandwichProgram, actor: SeatActor, mint: PublicKey, chips: bigint) =>
  program.methods
    .cashOut(toBN(chips))
    .accountsStrict({
      ...seatActionAccounts(actor),
      custody: findCustodyAddress(actor.table),
      walletToken: findWalletTokenAddress(actor.wallet, mint),
      escrowToken: findEscrowTokenAddress(actor.table, mint),
      tokenProgram: TOKEN_PROGRAM_ID,
    })
    .instruction();

export const buildStartRoundInstruction = (program: SandwichProgram, payer: PublicKey, table: PublicKey) =>
  program.methods
    .startRound()
    .accountsPartial({ payer, table, programIdentity: findProgramIdentityAddress() })
    .instruction();

const toRosterAccounts = (seats: PublicKey[]) => seats.map((seat) => ({ pubkey: seat, isSigner: false, isWritable: true }));

export const buildLandSwatInstruction = (program: SandwichProgram, table: PublicKey, seats: PublicKey[]) =>
  program.methods.landSwat().accountsStrict({ table }).remainingAccounts(toRosterAccounts(seats)).instruction();

export const buildSettleInstruction = (program: SandwichProgram, table: PublicKey, seats: PublicKey[]) =>
  program.methods.settle().accountsStrict({ table }).remainingAccounts(toRosterAccounts(seats)).instruction();

export const buildCreateSessionInstruction = (
  session: SessionProgram,
  feePayer: PublicKey,
  wallet: PublicKey,
  sessionSigner: PublicKey,
  validUntilUnix: number,
) =>
  session.methods
    .createSessionV2(false, new BN(validUntilUnix), null)
    .accountsStrict({
      sessionToken: findSessionTokenAddress(sessionSigner, wallet),
      sessionSigner,
      feePayer,
      authority: wallet,
      targetProgram: SANDWICH_PROGRAM_ID,
      systemProgram: SystemProgram.programId,
    })
    .instruction();
