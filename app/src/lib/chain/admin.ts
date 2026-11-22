import { BN } from "@coral-xyz/anchor";
import {
  DELEGATION_PROGRAM_ID,
  deriveVault,
  deriveVaultAta,
  ensureMagicAtaDestinationIx,
  initVaultAtaIx,
  initVaultIx,
} from "@magicblock-labs/ephemeral-rollups-sdk";
import { TOKEN_PROGRAM_ID } from "@solana/spl-token";
import { type Connection, PublicKey, SystemProgram, type TransactionInstruction } from "@solana/web3.js";
import { fetchTable } from "./accounts";
import { findCustodyAddress, findEscrowTokenAddress, findFaucetAuthorityAddress, findTableAddress, findTestMintAddress } from "./addresses";
import type { ChainClient } from "./client";
import { SANDWICH_PROGRAM_ID } from "./config";
import { type SandwichProgram, findDelegationAccounts } from "./program";
import { type Result, attempt, attemptSync, failure, pollUntil, success } from "./result";
import { type TransactionSigner, resolveFeePayer, sendOnBase, sendOnRollup } from "./transport";

const TABLE_VISIBLE_TIMEOUT_MS = 90_000;
const TABLE_POLL_MS = 100;

export type TableSetup = { tableId: bigint; anteUnits: bigint; boxCount: number; validator: PublicKey; mint: PublicKey };

export type OpenedTable = { table: PublicKey; escrow: PublicKey };

export const buildCreateTestMintInstruction = (program: SandwichProgram, payer: PublicKey): Promise<TransactionInstruction> =>
  program.methods
    .createTestMint()
    .accountsStrict({
      payer,
      testMint: findTestMintAddress(),
      faucetAuthority: findFaucetAuthorityAddress(),
      tokenProgram: TOKEN_PROGRAM_ID,
      systemProgram: SystemProgram.programId,
    })
    .instruction();

export const buildCreateTableInstructions = async (
  program: SandwichProgram,
  payer: PublicKey,
  setup: TableSetup,
): Promise<TransactionInstruction[]> => {
  const table = findTableAddress(setup.tableId);
  const delegation = findDelegationAccounts(table);
  return [
    await program.methods
      .createTable(new BN(setup.tableId.toString()), new BN(setup.anteUnits.toString()), setup.boxCount, setup.validator)
      .accountsStrict({ payer, table, mint: setup.mint, systemProgram: SystemProgram.programId })
      .instruction(),
    await program.methods
      .delegateTable()
      .accountsStrict({
        payer,
        table,
        bufferTable: delegation.buffer,
        delegationRecordTable: delegation.record,
        delegationMetadataTable: delegation.metadata,
        ownerProgram: SANDWICH_PROGRAM_ID,
        delegationProgram: DELEGATION_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
      })
      .instruction(),
  ];
};

const sendSetupOnBase = async (
  client: ChainClient,
  label: string,
  build: () => Promise<TransactionInstruction[]>,
  admin: TransactionSigner,
): Promise<Result<string>> => {
  const instructions = await attempt(build);
  if (!instructions.ok) return failure(`[${label}] build: ${instructions.reason}`);
  const sent = await sendOnBase(client.base, client.feePayment, instructions.value, [admin]);
  return sent.ok ? success(sent.value.signature) : failure(`[${label}] ${sent.reason}`);
};

const readIsMissingOnBase = async (client: ChainClient, address: PublicKey): Promise<Result<boolean>> => {
  const account = await attempt(() => client.base.getAccountInfo(address, "confirmed"));
  return account.ok ? success(account.value === null) : failure(`[readIsMissingOnBase] ${address.toBase58()}: ${account.reason}`);
};

export const ensureTestMintAndVault = async (client: ChainClient, admin: TransactionSigner): Promise<Result<PublicKey>> => {
  const payer = resolveFeePayer(client.feePayment, admin.publicKey);
  const mint = findTestMintAddress();
  const isMintMissing = await readIsMissingOnBase(client, mint);
  if (!isMintMissing.ok) return isMintMissing;
  if (isMintMissing.value) {
    const created = await sendSetupOnBase(client, "ensureTestMintAndVault", async () => [await buildCreateTestMintInstruction(client.programs.sandwich, payer)], admin);
    if (!created.ok) return created;
  }
  const [vault] = deriveVault(mint);
  const isVaultMissing = await readIsMissingOnBase(client, vault);
  if (!isVaultMissing.ok) return isVaultMissing;
  if (isVaultMissing.value) {
    const vaultAta = deriveVaultAta(mint, vault);
    const initialized = await sendSetupOnBase(
      client,
      "ensureTestMintAndVault",
      async () => [initVaultIx(vault, mint, payer), initVaultAtaIx(payer, vaultAta, vault, mint)],
      admin,
    );
    if (!initialized.ok) return initialized;
  }
  return success(mint);
};

export const openTable = async (client: ChainClient, admin: TransactionSigner, setup: TableSetup): Promise<Result<OpenedTable>> => {
  const payer = resolveFeePayer(client.feePayment, admin.publicKey);
  const table = findTableAddress(setup.tableId);
  const created = await sendSetupOnBase(client, "openTable", () => buildCreateTableInstructions(client.programs.sandwich, payer, setup), admin);
  if (!created.ok) return created;
  const tableVisible = await pollUntil(
    "table on the rollup",
    async () => {
      const snapshot = await fetchTable(client.programs.sandwich, client.rollup, table);
      return snapshot.ok ? snapshot.value : null;
    },
    TABLE_VISIBLE_TIMEOUT_MS,
    TABLE_POLL_MS,
  );
  if (!tableVisible.ok) return tableVisible;
  const escrowOpened = await sendOnRollup(
    client.rollupUrl,
    client.rollupBlockhashes,
    [ensureMagicAtaDestinationIx(admin.publicKey, findCustodyAddress(table), setup.mint)],
    [admin],
  );
  if (!escrowOpened.ok) return failure(`[openTable] escrow Magic ATA: ${escrowOpened.errorName} ${escrowOpened.detail}`);
  const escrow = findEscrowTokenAddress(table, setup.mint);
  const escrowVisible = await pollUntil(
    "escrow on the rollup",
    async () => ((await client.rollup.getAccountInfo(escrow, "processed")) === null ? null : true),
    TABLE_VISIBLE_TIMEOUT_MS,
    TABLE_POLL_MS,
  );
  return escrowVisible.ok ? success({ table, escrow }) : escrowVisible;
};

export const fetchValidatorIdentity = async (rollup: Connection): Promise<Result<PublicKey>> => {
  // An ephemeral rollup runs one validator, so its slot leader is the validator identity that delegations name.
  const leader = await attempt(() => rollup.getSlotLeader("processed"));
  if (!leader.ok) return failure(`[fetchValidatorIdentity] ${leader.reason}`);
  const leaderText = leader.value;
  return attemptSync(() => new PublicKey(leaderText));
};
