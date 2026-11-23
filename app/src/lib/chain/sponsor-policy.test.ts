import { describe, expect, test } from "bun:test";
import { BN } from "@coral-xyz/anchor";
import { delegateShuttleEphemeralAtaIx, delegateSpl, deriveShuttleAta, deriveShuttleEphemeralAta, withdrawSpl } from "@magicblock-labs/ephemeral-rollups-sdk";
import { createAssociatedTokenAccountIdempotentInstruction, getAssociatedTokenAddressSync } from "@solana/spl-token";
import {
  ComputeBudgetProgram,
  Connection,
  Keypair,
  PublicKey,
  SystemProgram,
  Transaction,
  type TransactionInstruction,
  TransactionMessage,
  VersionedTransaction,
} from "@solana/web3.js";
import { Buffer } from "buffer";
import { findSeatAddress, findSessionTokenAddress, findTableAddress, findTestMintAddress } from "./addresses";
import { SANDWICH_PROGRAM_ID } from "./config";
import {
  buildCashOutInstruction,
  buildCreateSessionInstruction,
  buildFaucetInstructions,
  buildSitInstructions,
  createChainPrograms,
} from "./program";
import { buildPayoutInstructions } from "./player";
import { parseSponsorRequest, reviewSponsoredTransaction } from "./sponsor-policy";

const programs = createChainPrograms(new Connection("http://127.0.0.1:8899"));
const sponsor = Keypair.generate();
const guest = Keypair.generate();
const otherGuest = Keypair.generate();
const sessionSigner = Keypair.generate();
const testMint = findTestMintAddress();
const otherMint = Keypair.generate().publicKey;
const table = findTableAddress(1n);
const validator = new PublicKey("MUS3hc9TCw4cGC12vHNoYcCGzJG1txjgQLZWVoeNHNd");
const policy = { sponsor: sponsor.publicKey, testMint };
const RECENT_BLOCKHASH = Keypair.generate().publicKey.toBase58();
const VALID_UNTIL_UNIX = 1_800_000_000;

const buildTransaction = (feePayer: PublicKey, instructions: TransactionInstruction[]): Transaction =>
  new Transaction({ feePayer, recentBlockhash: RECENT_BLOCKHASH }).add(
    ComputeBudgetProgram.setComputeUnitLimit({ units: 400_000 }),
    ...instructions,
  );

const buildSponsoredSession = (topUp: boolean, lamports: bigint | null) =>
  programs.session.methods
    .createSessionV2(topUp, new BN(VALID_UNTIL_UNIX), lamports === null ? null : new BN(lamports.toString()))
    .accountsStrict({
      sessionToken: findSessionTokenAddress(sessionSigner.publicKey, guest.publicKey),
      sessionSigner: sessionSigner.publicKey,
      feePayer: sponsor.publicKey,
      authority: guest.publicKey,
      targetProgram: SANDWICH_PROGRAM_ID,
      systemProgram: SystemProgram.programId,
    })
    .instruction();

const expectApproved = (transaction: Transaction) => {
  const review = reviewSponsoredTransaction(transaction, policy);
  expect(review.ok ? null : review.reason).toBeNull();
  return review.ok ? review.value : null;
};

const expectRefused = (transaction: Transaction, reasonFragment: string) => {
  const review = reviewSponsoredTransaction(transaction, policy);
  expect(review.ok).toBe(false);
  if (!review.ok) expect(review.reason).toContain(reasonFragment);
};

describe("reviewSponsoredTransaction accepts the guest path", () => {
  test("sit with delegate_seat, paid by the sponsor, for the guest wallet", async () => {
    const instructions = await buildSitInstructions(programs.sandwich, sponsor.publicKey, guest.publicKey, table);
    const approval = expectApproved(buildTransaction(sponsor.publicKey, instructions));
    expect(approval?.wallet?.equals(guest.publicKey)).toBe(true);
    expect(approval?.labels).toEqual(["compute_unit_limit", "sit", "delegate_seat"]);
  });

  test("the test USDC token account with the faucet", async () => {
    const instructions = await buildFaucetInstructions(programs.sandwich, sponsor.publicKey, guest.publicKey);
    expect(expectApproved(buildTransaction(sponsor.publicKey, instructions))?.labels).toEqual([
      "compute_unit_limit",
      "create_token_account",
      "faucet",
    ]);
  });

  test("a V2 session for our program with the sponsor as rent payer", async () => {
    const instruction = await buildCreateSessionInstruction(
      programs.session,
      sponsor.publicKey,
      guest.publicKey,
      sessionSigner.publicKey,
      VALID_UNTIL_UNIX,
    );
    expect(expectApproved(buildTransaction(sponsor.publicKey, [instruction]))?.wallet?.equals(guest.publicKey)).toBe(true);
  });

  test("a test USDC deposit to the rollup built by the SDK", async () => {
    const instructions = await delegateSpl(guest.publicKey, testMint, 1_000_000n, { validator, payer: sponsor.publicKey, shuttleId: 7 });
    const approval = expectApproved(buildTransaction(sponsor.publicKey, instructions));
    expect(approval?.labels).toEqual([
      "compute_unit_limit",
      "deposit_init_ephemeral_ata",
      "deposit_delegate_ephemeral_ata",
      "deposit_shuttle",
    ]);
  });

  test("a test USDC withdrawal from the guest's Magic ATA to its own token account, built by the SDK", async () => {
    const instructions = await withdrawSpl(guest.publicKey, testMint, 1_000_000n, { validator, payer: sponsor.publicKey, magicAtaSource: true, shuttleId: 9 });
    const approval = expectApproved(buildTransaction(sponsor.publicKey, instructions));
    expect(approval?.wallet?.equals(guest.publicKey)).toBe(true);
    expect(approval?.labels).toEqual(["compute_unit_limit", "create_token_account", "withdraw_shuttle"]);
  });

  test("a test USDC withdrawal from a plain rollup token account, built by the SDK", async () => {
    const instructions = await withdrawSpl(guest.publicKey, testMint, 1_000_000n, { validator, payer: sponsor.publicKey, shuttleId: 9 });
    expect(expectApproved(buildTransaction(sponsor.publicKey, instructions))?.labels).toEqual([
      "compute_unit_limit",
      "deposit_init_ephemeral_ata",
      "deposit_delegate_ephemeral_ata",
      "withdraw_shuttle",
    ]);
  });

  test("a payout of the guest's test USDC to a connected wallet, with that wallet's token account", () => {
    const instructions = buildPayoutInstructions(sponsor.publicKey, guest.publicKey, testMint, otherGuest.publicKey, 1_000_000n);
    const transaction = buildTransaction(sponsor.publicKey, instructions);
    transaction.partialSign(guest);
    const approval = expectApproved(transaction);
    expect(approval?.wallet?.equals(guest.publicKey)).toBe(true);
    expect(approval?.labels).toEqual(["compute_unit_limit", "create_token_account", "payout_transfer"]);
  });

  test("the re-delegation of a stuck deposit shuttle", () => {
    const [shuttleEphemeralAta] = deriveShuttleEphemeralAta(guest.publicKey, testMint, 7);
    const [shuttleAta] = deriveShuttleAta(shuttleEphemeralAta, testMint);
    const instruction = delegateShuttleEphemeralAtaIx(sponsor.publicKey, shuttleEphemeralAta, shuttleAta, validator);
    expect(expectApproved(buildTransaction(sponsor.publicKey, [instruction]))?.wallet).toBeNull();
  });
});

describe("reviewSponsoredTransaction refuses", () => {
  test("a withdrawal whose tokens land in another wallet's token account", async () => {
    const [withdrawal] = (await withdrawSpl(guest.publicKey, testMint, 1_000_000n, { validator, payer: sponsor.publicKey, magicAtaSource: true, shuttleId: 9 })).slice(-1);
    if (withdrawal === undefined) return expect(withdrawal).toBeDefined();
    const redirected = withdrawal.keys.map((key, slot) => (slot === 13 ? { ...key, pubkey: getAssociatedTokenAddressSync(testMint, otherGuest.publicKey) } : key));
    expectRefused(buildTransaction(sponsor.publicKey, [{ ...withdrawal, keys: redirected }]), "the withdrawal destination");
  });

  test("a withdrawal of another mint", async () => {
    const instructions = await withdrawSpl(guest.publicKey, otherMint, 1_000_000n, { validator, payer: sponsor.publicKey, magicAtaSource: true, shuttleId: 9 });
    expectRefused(buildTransaction(sponsor.publicKey, instructions.slice(-1)), "the withdrawal mint");
  });

  test("a transaction whose fee payer is not the sponsor", async () => {
    const instructions = await buildSitInstructions(programs.sandwich, guest.publicKey, guest.publicKey, table);
    expectRefused(buildTransaction(guest.publicKey, instructions), "fee payer");
  });

  test("a transfer out of the sponsor", () => {
    const transfer = SystemProgram.transfer({ fromPubkey: sponsor.publicKey, toPubkey: otherGuest.publicKey, lamports: 1_000_000_000 });
    expectRefused(buildTransaction(sponsor.publicKey, [transfer]), "not on the allowlist");
  });

  test("an allowlisted instruction that names the sponsor as the player", async () => {
    const instructions = await buildFaucetInstructions(programs.sandwich, sponsor.publicKey, sponsor.publicKey);
    expectRefused(buildTransaction(sponsor.publicKey, instructions), "outside its payer slot");
  });

  test("a player action of the program that is not on the allowlist", async () => {
    const actor = { signer: guest.publicKey, wallet: guest.publicKey, table, seat: findSeatAddress(table, guest.publicKey), sessionToken: null };
    const cashOut = await buildCashOutInstruction(programs.sandwich, actor, testMint, 10n);
    expectRefused(buildTransaction(sponsor.publicKey, [cashOut]), "not on the allowlist");
  });

  test("a session that tops up its signer from the sponsor", async () => {
    expectRefused(buildTransaction(sponsor.publicKey, [await buildSponsoredSession(true, 10_000_000n)]), "top up");
    expectRefused(buildTransaction(sponsor.publicKey, [await buildSponsoredSession(false, 1n)]), "lamports");
  });

  test("a session for another program", async () => {
    const instruction = await buildSponsoredSession(false, null);
    instruction.keys[4] = { pubkey: SystemProgram.programId, isSigner: false, isWritable: false };
    expectRefused(buildTransaction(sponsor.publicKey, [instruction]), "target program");
  });

  test("a token account or a deposit for another mint", async () => {
    const otherToken = getAssociatedTokenAddressSync(otherMint, guest.publicKey);
    const createOther = createAssociatedTokenAccountIdempotentInstruction(sponsor.publicKey, otherToken, guest.publicKey, otherMint);
    expectRefused(buildTransaction(sponsor.publicKey, [createOther]), "mint");
    const deposit = await delegateSpl(guest.publicKey, otherMint, 1_000_000n, { validator, payer: sponsor.publicKey, shuttleId: 7 });
    expectRefused(buildTransaction(sponsor.publicKey, deposit), "mint");
  });

  test("a test USDC token account the wallet does not sign for, since its owner could close it and keep the rent", () => {
    const guestToken = getAssociatedTokenAddressSync(testMint, guest.publicKey);
    const create = createAssociatedTokenAccountIdempotentInstruction(sponsor.publicKey, guestToken, guest.publicKey, testMint);
    expectRefused(buildTransaction(sponsor.publicKey, [create]), "signature");
  });

  test("a payout out of another wallet's token account or of another mint", () => {
    const [, transfer] = buildPayoutInstructions(sponsor.publicKey, guest.publicKey, testMint, otherGuest.publicKey, 1_000_000n);
    if (transfer === undefined) return expect(transfer).toBeDefined();
    const fromStranger = transfer.keys.map((key, slot) => (slot === 0 ? { ...key, pubkey: getAssociatedTokenAddressSync(testMint, otherGuest.publicKey) } : key));
    const stolen = buildTransaction(sponsor.publicKey, [{ ...transfer, keys: fromStranger }]);
    stolen.partialSign(guest);
    expectRefused(stolen, "the payout source");
    const [, otherMintTransfer] = buildPayoutInstructions(sponsor.publicKey, guest.publicKey, otherMint, otherGuest.publicKey, 1_000_000n);
    if (otherMintTransfer === undefined) return expect(otherMintTransfer).toBeDefined();
    const wrongMint = buildTransaction(sponsor.publicKey, [otherMintTransfer]);
    wrongMint.partialSign(guest);
    expectRefused(wrongMint, "the payout source");
  });

  test("a stranger's token account that no payout fills, since its owner could close it and keep the rent", () => {
    const strangerToken = getAssociatedTokenAddressSync(testMint, otherGuest.publicKey);
    const [, transfer] = buildPayoutInstructions(sponsor.publicKey, guest.publicKey, testMint, guest.publicKey, 1_000_000n);
    if (transfer === undefined) return expect(transfer).toBeDefined();
    const create = createAssociatedTokenAccountIdempotentInstruction(sponsor.publicKey, strangerToken, otherGuest.publicKey, testMint);
    const transaction = buildTransaction(sponsor.publicKey, [create, transfer]);
    transaction.partialSign(guest);
    expectRefused(transaction, "receive its payout");
  });

  test("a priority fee or a compute limit above the base budget", () => {
    const priced = buildTransaction(sponsor.publicKey, [ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 1_000_000 })]);
    expectRefused(priced, "not on the allowlist");
    const oversized = new Transaction({ feePayer: sponsor.publicKey, recentBlockhash: RECENT_BLOCKHASH }).add(
      ComputeBudgetProgram.setComputeUnitLimit({ units: 1_400_000 }),
    );
    expectRefused(oversized, "compute unit limit");
  });

  test("one transaction acting for two wallets", async () => {
    const sit = await buildSitInstructions(programs.sandwich, sponsor.publicKey, guest.publicKey, table);
    const faucet = await buildFaucetInstructions(programs.sandwich, sponsor.publicKey, otherGuest.publicKey);
    expectRefused(buildTransaction(sponsor.publicKey, [...sit, ...faucet]), "one wallet");
  });

  test("a delegated ephemeral token account that belongs to nobody in the transaction", async () => {
    const [, delegateOther] = await delegateSpl(otherGuest.publicKey, testMint, 0n, { validator, payer: sponsor.publicKey, shuttleId: 7 });
    const sit = await buildSitInstructions(programs.sandwich, sponsor.publicKey, guest.publicKey, table);
    if (delegateOther === undefined) return;
    expectRefused(buildTransaction(sponsor.publicKey, [delegateOther]), "needs a wallet");
    expectRefused(buildTransaction(sponsor.publicKey, [...sit, delegateOther]), "delegated ephemeral token account");
  });

  test("more than eight instructions", async () => {
    const sit = await buildSitInstructions(programs.sandwich, sponsor.publicKey, guest.publicKey, table);
    expectRefused(buildTransaction(sponsor.publicKey, [...sit, ...sit, ...sit, ...sit]), "1 to 8 instructions");
  });
});

describe("parseSponsorRequest", () => {
  test("reads back a partially signed legacy transaction", async () => {
    const transaction = buildTransaction(sponsor.publicKey, await buildSitInstructions(programs.sandwich, sponsor.publicKey, guest.publicKey, table));
    transaction.partialSign(guest);
    const encoded = Buffer.from(transaction.serialize({ requireAllSignatures: false })).toString("base64");
    const parsed = parseSponsorRequest({ transaction: encoded });
    expect(parsed.ok ? null : parsed.reason).toBeNull();
    if (parsed.ok) expect(parsed.value.serializeMessage().equals(transaction.serializeMessage())).toBe(true);
  });

  test("refuses a missing field, garbage, an oversized body and a versioned transaction", () => {
    expect(parseSponsorRequest({}).ok).toBe(false);
    expect(parseSponsorRequest({ transaction: Buffer.from("not a transaction").toString("base64") }).ok).toBe(false);
    expect(parseSponsorRequest({ transaction: "A".repeat(4_000) }).ok).toBe(false);
    const message = new TransactionMessage({
      payerKey: sponsor.publicKey,
      recentBlockhash: RECENT_BLOCKHASH,
      instructions: [ComputeBudgetProgram.setComputeUnitLimit({ units: 1_000 })],
    }).compileToV0Message();
    const versioned = Buffer.from(new VersionedTransaction(message).serialize()).toString("base64");
    expect(parseSponsorRequest({ transaction: versioned }).ok).toBe(false);
  });
});
