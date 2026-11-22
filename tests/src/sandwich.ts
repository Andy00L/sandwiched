import { AnchorProvider, BN, Program, Wallet } from "@coral-xyz/anchor";
import {
  DELEGATION_PROGRAM_ID,
  delegateBufferPdaFromDelegatedAccountAndOwnerProgram,
  delegationMetadataPdaFromDelegatedAccount,
  delegationRecordPdaFromDelegatedAccount,
} from "@magicblock-labs/ephemeral-rollups-sdk";
import type { GplSession } from "@magicblock-labs/gum-sdk/lib/idl/gpl_session";
import gplSessionIdl from "@magicblock-labs/gum-sdk/lib/idl/gpl_session.json";
import { TOKEN_PROGRAM_ID, getAssociatedTokenAddressSync } from "@solana/spl-token";
import {
  type Connection,
  type Keypair,
  PublicKey,
  SystemProgram,
  type TransactionInstruction,
} from "@solana/web3.js";
import idlJson from "../../target/idl/sandwich.json";
import type { Sandwich } from "../../target/types/sandwich";

export const SANDWICH_PROGRAM_ID = new PublicKey(idlJson.address);

export type SandwichProgram = Program<Sandwich>;
export type SessionProgram = Program<GplSession>;

export const createPrograms = (connection: Connection, admin: Keypair) => {
  const provider = new AnchorProvider(connection, new Wallet(admin), {});
  return {
    sandwich: new Program<Sandwich>(idlJson as Sandwich, provider),
    session: new Program<GplSession>(gplSessionIdl as GplSession, provider),
  };
};

const findAddress = (seeds: Buffer[], programId: PublicKey = SANDWICH_PROGRAM_ID): PublicKey =>
  PublicKey.findProgramAddressSync(seeds, programId)[0];

export const tablePda = (tableId: bigint): PublicKey => {
  const idBytes = Buffer.alloc(8);
  idBytes.writeBigUInt64LE(tableId);
  return findAddress([Buffer.from("table"), idBytes]);
};

export const seatPda = (table: PublicKey, wallet: PublicKey): PublicKey =>
  findAddress([Buffer.from("seat"), table.toBuffer(), wallet.toBuffer()]);

export const custodyPda = (table: PublicKey): PublicKey => findAddress([Buffer.from("custody"), table.toBuffer()]);

export const testMintPda = (): PublicKey => findAddress([Buffer.from("test_usdc")]);

const faucetAuthorityPda = (): PublicKey => findAddress([Buffer.from("faucet")]);

const faucetClaimPda = (wallet: PublicKey): PublicKey => findAddress([Buffer.from("faucet_claim"), wallet.toBuffer()]);

export const escrowAta = (table: PublicKey, mint: PublicKey): PublicKey =>
  getAssociatedTokenAddressSync(mint, custodyPda(table), true);

export const walletAta = (wallet: PublicKey, mint: PublicKey): PublicKey => getAssociatedTokenAddressSync(mint, wallet);

export const sessionTokenPda = (sessionSigner: PublicKey, wallet: PublicKey): PublicKey =>
  findAddress(
    [Buffer.from("session_token_v2"), SANDWICH_PROGRAM_ID.toBuffer(), sessionSigner.toBuffer(), wallet.toBuffer()],
    new PublicKey(gplSessionIdl.address),
  );

const delegationAccounts = (delegated: PublicKey) => ({
  ownerProgram: SANDWICH_PROGRAM_ID,
  delegationProgram: DELEGATION_PROGRAM_ID,
  systemProgram: SystemProgram.programId,
  buffer: delegateBufferPdaFromDelegatedAccountAndOwnerProgram(delegated, SANDWICH_PROGRAM_ID),
  record: delegationRecordPdaFromDelegatedAccount(delegated),
  metadata: delegationMetadataPdaFromDelegatedAccount(delegated),
});

export const buildCreateTestMintIx = (program: SandwichProgram, payer: PublicKey) =>
  program.methods
    .createTestMint()
    .accountsStrict({
      payer,
      testMint: testMintPda(),
      faucetAuthority: faucetAuthorityPda(),
      tokenProgram: TOKEN_PROGRAM_ID,
      systemProgram: SystemProgram.programId,
    })
    .instruction();

export const buildFaucetIx = (program: SandwichProgram, payer: PublicKey, wallet: PublicKey) =>
  program.methods
    .faucet()
    .accountsStrict({
      payer,
      wallet,
      claim: faucetClaimPda(wallet),
      testMint: testMintPda(),
      faucetAuthority: faucetAuthorityPda(),
      walletToken: walletAta(wallet, testMintPda()),
      tokenProgram: TOKEN_PROGRAM_ID,
      systemProgram: SystemProgram.programId,
    })
    .instruction();

type TableConfig = { tableId: bigint; anteUnits: bigint; boxCount: number; validator: PublicKey; mint: PublicKey };

export const buildCreateTableIxs = async (program: SandwichProgram, payer: PublicKey, config: TableConfig) => {
  const table = tablePda(config.tableId);
  const delegation = delegationAccounts(table);
  return [
    await program.methods
      .createTable(new BN(config.tableId.toString()), new BN(config.anteUnits.toString()), config.boxCount, config.validator)
      .accountsStrict({ payer, table, mint: config.mint, systemProgram: SystemProgram.programId })
      .instruction(),
    await program.methods
      .delegateTable()
      .accountsStrict({
        payer,
        table,
        bufferTable: delegation.buffer,
        delegationRecordTable: delegation.record,
        delegationMetadataTable: delegation.metadata,
        ownerProgram: delegation.ownerProgram,
        delegationProgram: delegation.delegationProgram,
        systemProgram: delegation.systemProgram,
      })
      .instruction(),
  ];
};

export const buildSitIxs = async (program: SandwichProgram, payer: PublicKey, wallet: PublicKey, table: PublicKey) => {
  const seat = seatPda(table, wallet);
  const delegation = delegationAccounts(seat);
  return [
    await program.methods
      .sit()
      .accountsStrict({ payer, wallet, table, seat, systemProgram: SystemProgram.programId })
      .instruction(),
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
        ownerProgram: delegation.ownerProgram,
        delegationProgram: delegation.delegationProgram,
        systemProgram: delegation.systemProgram,
      })
      .instruction(),
  ];
};

export type SeatActor = { signer: PublicKey; wallet: PublicKey; table: PublicKey; sessionToken: PublicKey | null };

const seatActionAccounts = (actor: SeatActor) => ({
  signer: actor.signer,
  table: actor.table,
  seat: seatPda(actor.table, actor.wallet),
  sessionToken: actor.sessionToken,
});

export const buildJoinIx = (program: SandwichProgram, actor: SeatActor) =>
  program.methods.join().accountsStrict(seatActionAccounts(actor)).instruction();

export const buildAnteIx = (program: SandwichProgram, actor: SeatActor) =>
  program.methods.ante().accountsStrict(seatActionAccounts(actor)).instruction();

export const buildFlyToIx = (program: SandwichProgram, actor: SeatActor, boxIndex: number) =>
  program.methods.flyTo(boxIndex).accountsStrict(seatActionAccounts(actor)).instruction();

export const buildTakeOffIx = (program: SandwichProgram, actor: SeatActor) =>
  program.methods.takeOff().accountsStrict(seatActionAccounts(actor)).instruction();

export const buildPeckIx = (program: SandwichProgram, actor: SeatActor) =>
  program.methods.peck().accountsStrict(seatActionAccounts(actor)).instruction();

export const buildRaiseHandIx = (program: SandwichProgram, actor: SeatActor, boxIndex: number) =>
  program.methods.raiseHand(boxIndex).accountsStrict(seatActionAccounts(actor)).instruction();

export const buildBuyInIx = (program: SandwichProgram, wallet: PublicKey, table: PublicKey, mint: PublicKey, chips: bigint) =>
  program.methods
    .buyIn(new BN(chips.toString()))
    .accountsStrict({
      wallet,
      table,
      seat: seatPda(table, wallet),
      walletToken: walletAta(wallet, mint),
      escrowToken: escrowAta(table, mint),
      tokenProgram: TOKEN_PROGRAM_ID,
    })
    .instruction();

export const buildCashOutIx = (program: SandwichProgram, actor: SeatActor, mint: PublicKey, chips: bigint) =>
  program.methods
    .cashOut(new BN(chips.toString()))
    .accountsStrict({
      ...seatActionAccounts(actor),
      custody: custodyPda(actor.table),
      walletToken: walletAta(actor.wallet, mint),
      escrowToken: escrowAta(actor.table, mint),
      tokenProgram: TOKEN_PROGRAM_ID,
    })
    .instruction();

export const buildStartRoundIx = (program: SandwichProgram, payer: PublicKey, table: PublicKey) =>
  program.methods
    .startRound()
    .accountsPartial({ payer, table, programIdentity: findAddress([Buffer.from("identity")]) })
    .instruction();

const toRosterAccounts = (seats: PublicKey[]) => seats.map((seat) => ({ pubkey: seat, isSigner: false, isWritable: true }));

export const buildLandSwatIx = (program: SandwichProgram, table: PublicKey, seats: PublicKey[]): Promise<TransactionInstruction> =>
  program.methods.landSwat().accountsStrict({ table }).remainingAccounts(toRosterAccounts(seats)).instruction();

export const buildSettleIx = (program: SandwichProgram, table: PublicKey, seats: PublicKey[]): Promise<TransactionInstruction> =>
  program.methods.settle().accountsStrict({ table }).remainingAccounts(toRosterAccounts(seats)).instruction();

export const buildCreateSessionIx = (session: SessionProgram, payer: PublicKey, wallet: PublicKey, sessionSigner: PublicKey, validUntilUnix: number) =>
  session.methods
    .createSessionV2(false, new BN(validUntilUnix), null)
    .accountsStrict({
      sessionToken: sessionTokenPda(sessionSigner, wallet),
      sessionSigner,
      feePayer: payer,
      authority: wallet,
      targetProgram: SANDWICH_PROGRAM_ID,
      systemProgram: SystemProgram.programId,
    })
    .instruction();

export const buildRevokeSessionIx = async (session: SessionProgram, payer: PublicKey, wallet: PublicKey, sessionSigner: PublicKey) => {
  const revoke = await session.methods
    .revokeSessionV2()
    .accountsStrict({ sessionToken: sessionTokenPda(sessionSigner, wallet), feePayer: payer, authority: wallet, systemProgram: SystemProgram.programId })
    .instruction();
  revoke.keys = revoke.keys.map((key) => (key.pubkey.equals(wallet) ? { ...key, isSigner: true } : key));
  return revoke;
};

type PigeonView =
  | { kind: "hovering" }
  | { kind: "flying"; boxIndex: number; landsTick: bigint }
  | { kind: "perched"; boxIndex: number }
  | { kind: "stunned"; boxIndex: number; untilTick: bigint };

export type SeatView = { wallet: PublicKey; seatIndex: number | null; chips: bigint; beakCrumbs: bigint; pigeon: PigeonView };

export type TableView = {
  roundNumber: bigint;
  chipUnits: bigint;
  seats: PublicKey[];
  anted: number;
  phase: { kind: "lobby" } | { kind: "drawing"; requestedTick: bigint } | { kind: "live"; whaleSeat: number };
  sandwichBox: number;
  endTick: bigint;
  potCrumbs: bigint;
  looseCrumbs: bigint[];
  swatCount: bigint;
  hand: { kind: "idle" } | { kind: "raised"; boxIndex: number; landsTick: bigint };
  lastResult: { whaleWallet: PublicKey; whaleCrumbs: bigint; pigeonCrumbs: bigint } | null;
};

const toBigInt = (value: BN): bigint => BigInt(value.toString());

type DecodedTable = Awaited<ReturnType<SandwichProgram["account"]["table"]["fetch"]>>;
type DecodedSeat = Awaited<ReturnType<SandwichProgram["account"]["seat"]["fetch"]>>;

const viewPhase = (phase: DecodedTable["phase"]): TableView["phase"] => {
  if (phase.live !== undefined) return { kind: "live", whaleSeat: phase.live.whaleSeat };
  if (phase.drawing !== undefined) return { kind: "drawing", requestedTick: toBigInt(phase.drawing.requestedTick) };
  return { kind: "lobby" };
};

const viewHand = (hand: DecodedTable["round"]["hand"]): TableView["hand"] =>
  hand.raised === undefined ? { kind: "idle" } : { kind: "raised", boxIndex: hand.raised.boxIndex, landsTick: toBigInt(hand.raised.landsTick) };

const viewPigeon = (state: DecodedSeat["pigeon"]["state"]): PigeonView => {
  if (state.flying !== undefined) return { kind: "flying", boxIndex: state.flying.boxIndex, landsTick: toBigInt(state.flying.landsTick) };
  if (state.perched !== undefined) return { kind: "perched", boxIndex: state.perched.boxIndex };
  if (state.stunned !== undefined) return { kind: "stunned", boxIndex: state.stunned.boxIndex, untilTick: toBigInt(state.stunned.untilTick) };
  return { kind: "hovering" };
};

export const decodeTable = (program: SandwichProgram, data: Buffer): TableView => {
  const decoded: DecodedTable = program.coder.accounts.decode("table", data);
  return {
    roundNumber: toBigInt(decoded.roundNumber),
    chipUnits: toBigInt(decoded.chipUnits),
    seats: decoded.seats,
    anted: decoded.anted,
    phase: viewPhase(decoded.phase),
    sandwichBox: decoded.round.sandwichBox,
    endTick: toBigInt(decoded.round.endTick),
    potCrumbs: toBigInt(decoded.round.potCrumbs),
    looseCrumbs: decoded.round.looseCrumbs.map(toBigInt),
    swatCount: toBigInt(decoded.round.swatCount),
    hand: viewHand(decoded.round.hand),
    lastResult:
      decoded.lastResult === null
        ? null
        : {
            whaleWallet: decoded.lastResult.whaleWallet,
            whaleCrumbs: toBigInt(decoded.lastResult.whaleCrumbs),
            pigeonCrumbs: toBigInt(decoded.lastResult.pigeonCrumbs),
          },
  };
};

export const decodeSeat = (program: SandwichProgram, data: Buffer): SeatView => {
  const decoded: DecodedSeat = program.coder.accounts.decode("seat", data);
  return {
    wallet: decoded.wallet,
    seatIndex: decoded.seatIndex,
    chips: toBigInt(decoded.chips),
    beakCrumbs: toBigInt(decoded.pigeon.beakCrumbs),
    pigeon: viewPigeon(decoded.pigeon.state),
  };
};

export const fetchTable = async (program: SandwichProgram, connection: Connection, table: PublicKey): Promise<TableView | null> => {
  const info = await connection.getAccountInfo(table, "processed");
  return info === null || !info.owner.equals(SANDWICH_PROGRAM_ID) ? null : decodeTable(program, info.data);
};

export const fetchSeat = async (program: SandwichProgram, connection: Connection, seat: PublicKey): Promise<SeatView | null> => {
  const info = await connection.getAccountInfo(seat, "processed");
  return info === null || !info.owner.equals(SANDWICH_PROGRAM_ID) ? null : decodeSeat(program, info.data);
};

const ERROR_NAMES = new Map<number, string>([
  ...idlJson.errors.map((entry): [number, string] => [entry.code, entry.name]),
  ...gplSessionIdl.errors.map((entry): [number, string] => [entry.code, `session.${entry.name}`]),
]);

export const nameError = (errorCode: number | null): string =>
  errorCode === null ? "unknown" : (ERROR_NAMES.get(errorCode) ?? `code ${errorCode}`);
