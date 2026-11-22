import { BN, BorshInstructionCoder, type Idl } from "@coral-xyz/anchor";
import { EPHEMERAL_SPL_TOKEN_PROGRAM_ID, deriveEphemeralAta } from "@magicblock-labs/ephemeral-rollups-sdk";
import gplSessionIdl from "@magicblock-labs/gum-sdk/lib/idl/gpl_session.json";
import { ASSOCIATED_TOKEN_PROGRAM_ID, TOKEN_PROGRAM_ID, getAssociatedTokenAddressSync } from "@solana/spl-token";
import { ComputeBudgetInstruction, ComputeBudgetProgram, type PublicKey, Transaction, type TransactionInstruction } from "@solana/web3.js";
import { Buffer } from "buffer";
import { BASE_COMPUTE_UNITS, SANDWICH_PROGRAM_ID, SESSION_PROGRAM_ID } from "./config";
import sandwichIdl from "./idl/sandwich.json";
import { type Result, attemptSync, failure, success } from "./result";

export type SponsorPolicy = { sponsor: PublicKey; testMint: PublicKey };
export type SponsorApproval = { wallet: PublicKey | null; labels: string[] };

const MAX_INSTRUCTIONS = 8;
const MAX_TRANSACTION_BASE64_LENGTH = 1_700;
const ATA_CREATE_IDEMPOTENT = 1;
const ESPL_INIT_EPHEMERAL_ATA = 0;
const ESPL_DELEGATE_EPHEMERAL_ATA = 4;
const ESPL_DELEGATE_SHUTTLE = 13;
const ESPL_SETUP_AND_DELEGATE_SHUTTLE_WITH_MERGE = 24;
const ESPL_WITHDRAW_THROUGH_DELEGATED_SHUTTLE_WITH_MERGE = 26;
const PUBLIC_KEY_BYTES = 32;

type InstructionRule = {
  label: string;
  programId: PublicKey;
  matches: (instruction: TransactionInstruction) => boolean;
  minimumAccounts: number;
  sponsorSlots: number[];
  walletSlot: number | null;
  needsWalletSignature?: boolean;
  findRefusal?: (instruction: TransactionInstruction, policy: SponsorPolicy) => string | null;
  findWalletRefusal?: (instruction: TransactionInstruction, wallet: PublicKey, policy: SponsorPolicy) => string | null;
};

const findSandwichDiscriminator = (instructionName: string): Buffer | null => {
  const entry = sandwichIdl.instructions.find((instruction) => instruction.name === instructionName);
  return entry === undefined ? null : Buffer.from(entry.discriminator);
};

const findSessionDiscriminator = (instructionName: string): Buffer | null => {
  const entry = gplSessionIdl.instructions.find((instruction) => instruction.name === instructionName);
  return entry === undefined ? null : Buffer.from(entry.discriminator);
};

const startsWith = (discriminator: Buffer | null) => (instruction: TransactionInstruction) =>
  discriminator !== null && instruction.data.subarray(0, discriminator.length).equals(discriminator);

const hasTag = (tag: number, allowedLengths: number[]) => (instruction: TransactionInstruction) =>
  instruction.data[0] === tag && allowedLengths.includes(instruction.data.length);

const requireKey = (instruction: TransactionInstruction, slot: number, expected: PublicKey, label: string): string | null =>
  instruction.keys[slot]?.pubkey.equals(expected) === true ? null : `${label} must be ${expected.toBase58()}`;

const sessionCoder = new BorshInstructionCoder(gplSessionIdl as Idl);

const findSessionArgsRefusal = (instruction: TransactionInstruction): string | null => {
  const decoded = attemptSync(() => sessionCoder.decode(Buffer.from(instruction.data)));
  if (!decoded.ok || decoded.value === null) return "create_session_v2 arguments do not decode";
  const args: object = decoded.value.data;
  const topUp = "top_up" in args ? args.top_up : undefined;
  const lamports = "lamports" in args ? args.lamports : undefined;
  if (topUp !== null && topUp !== false) return "a sponsored session cannot top up the session signer";
  if (lamports !== null && !(lamports instanceof BN && lamports.isZero())) return "a sponsored session cannot move lamports";
  return null;
};

const findComputeLimitRefusal = (instruction: TransactionInstruction): string | null => {
  const decoded = attemptSync(() => ComputeBudgetInstruction.decodeSetComputeUnitLimit(instruction));
  if (!decoded.ok) return "compute unit limit does not decode";
  return decoded.value.units <= BASE_COMPUTE_UNITS ? null : `compute unit limit above ${BASE_COMPUTE_UNITS}`;
};

const isComputeLimit = (instruction: TransactionInstruction): boolean => {
  const kind = attemptSync(() => ComputeBudgetInstruction.decodeInstructionType(instruction));
  return kind.ok && kind.value === "SetComputeUnitLimit";
};

const INSTRUCTION_RULES: InstructionRule[] = [
  {
    label: "compute_unit_limit",
    programId: ComputeBudgetProgram.programId,
    matches: isComputeLimit,
    minimumAccounts: 0,
    sponsorSlots: [],
    walletSlot: null,
    findRefusal: findComputeLimitRefusal,
  },
  {
    label: "sit",
    programId: SANDWICH_PROGRAM_ID,
    matches: startsWith(findSandwichDiscriminator("sit")),
    minimumAccounts: 5,
    sponsorSlots: [0],
    walletSlot: 1,
  },
  {
    label: "delegate_seat",
    programId: SANDWICH_PROGRAM_ID,
    matches: startsWith(findSandwichDiscriminator("delegate_seat")),
    minimumAccounts: 10,
    sponsorSlots: [0],
    walletSlot: 1,
  },
  {
    label: "faucet",
    programId: SANDWICH_PROGRAM_ID,
    matches: startsWith(findSandwichDiscriminator("faucet")),
    minimumAccounts: 8,
    sponsorSlots: [0],
    walletSlot: 1,
  },
  {
    label: "create_token_account",
    programId: ASSOCIATED_TOKEN_PROGRAM_ID,
    matches: hasTag(ATA_CREATE_IDEMPOTENT, [1]),
    minimumAccounts: 6,
    sponsorSlots: [0],
    walletSlot: 2,
    needsWalletSignature: true,
    findRefusal: (instruction, policy) =>
      requireKey(instruction, 3, policy.testMint, "the token account mint") ??
      requireKey(instruction, 5, TOKEN_PROGRAM_ID, "the token program"),
  },
  {
    label: "create_session_v2",
    programId: SESSION_PROGRAM_ID,
    matches: startsWith(findSessionDiscriminator("create_session_v2")),
    minimumAccounts: 6,
    sponsorSlots: [2],
    walletSlot: 3,
    findRefusal: (instruction) =>
      requireKey(instruction, 4, SANDWICH_PROGRAM_ID, "the session target program") ?? findSessionArgsRefusal(instruction),
  },
  {
    label: "deposit_init_ephemeral_ata",
    programId: EPHEMERAL_SPL_TOKEN_PROGRAM_ID,
    matches: hasTag(ESPL_INIT_EPHEMERAL_ATA, [1]),
    minimumAccounts: 5,
    sponsorSlots: [1],
    walletSlot: 2,
    findRefusal: (instruction, policy) => requireKey(instruction, 3, policy.testMint, "the deposit mint"),
  },
  {
    label: "deposit_delegate_ephemeral_ata",
    programId: EPHEMERAL_SPL_TOKEN_PROGRAM_ID,
    matches: hasTag(ESPL_DELEGATE_EPHEMERAL_ATA, [1, 1 + PUBLIC_KEY_BYTES]),
    minimumAccounts: 8,
    sponsorSlots: [0],
    walletSlot: null,
    findWalletRefusal: (instruction, wallet, policy) =>
      requireKey(instruction, 1, deriveEphemeralAta(wallet, policy.testMint)[0], "the delegated ephemeral token account"),
  },
  {
    label: "deposit_shuttle",
    programId: EPHEMERAL_SPL_TOKEN_PROGRAM_ID,
    matches: hasTag(ESPL_SETUP_AND_DELEGATE_SHUTTLE_WITH_MERGE, [13, 13 + PUBLIC_KEY_BYTES]),
    minimumAccounts: 19,
    sponsorSlots: [0],
    walletSlot: 5,
    findRefusal: (instruction, policy) => requireKey(instruction, 14, policy.testMint, "the deposit mint"),
  },
  {
    label: "withdraw_shuttle",
    programId: EPHEMERAL_SPL_TOKEN_PROGRAM_ID,
    matches: hasTag(ESPL_WITHDRAW_THROUGH_DELEGATED_SHUTTLE_WITH_MERGE, [13, 13 + PUBLIC_KEY_BYTES]),
    minimumAccounts: 16,
    sponsorSlots: [0],
    walletSlot: 5,
    needsWalletSignature: true,
    findRefusal: (instruction, policy) =>
      requireKey(instruction, 14, policy.testMint, "the withdrawal mint") ?? requireKey(instruction, 15, TOKEN_PROGRAM_ID, "the token program"),
    findWalletRefusal: (instruction, wallet, policy) =>
      requireKey(instruction, 13, getAssociatedTokenAddressSync(policy.testMint, wallet), "the withdrawal destination"),
  },
  {
    label: "redelegate_shuttle",
    programId: EPHEMERAL_SPL_TOKEN_PROGRAM_ID,
    matches: hasTag(ESPL_DELEGATE_SHUTTLE, [1, 1 + PUBLIC_KEY_BYTES]),
    minimumAccounts: 9,
    sponsorSlots: [0],
    walletSlot: null,
  },
];

const findRule = (instruction: TransactionInstruction): InstructionRule | undefined =>
  INSTRUCTION_RULES.find((rule) => instruction.programId.equals(rule.programId) && rule.matches(instruction));

const isSignedBy = (transaction: Transaction, wallet: PublicKey): boolean => {
  const message = attemptSync(() => transaction.compileMessage());
  if (!message.ok) return false;
  return message.value.accountKeys.slice(0, message.value.header.numRequiredSignatures).some((key) => key.equals(wallet));
};

export const parseSponsorRequest = (body: unknown): Result<Transaction> => {
  if (typeof body !== "object" || body === null || !("transaction" in body) || typeof body.transaction !== "string") {
    return failure("the body must be { transaction: base64 }");
  }
  const encoded = body.transaction;
  if (encoded.length > MAX_TRANSACTION_BASE64_LENGTH) return failure("the transaction is too large");
  const bytes = Buffer.from(encoded, "base64");
  const parsed = attemptSync(() => Transaction.from(bytes));
  if (!parsed.ok) return failure("the transaction does not parse");
  const reserialized = attemptSync(() => parsed.value.serialize({ requireAllSignatures: false, verifySignatures: false }));
  if (!reserialized.ok || !Buffer.from(reserialized.value).equals(bytes)) return failure("only canonical legacy transactions are sponsored");
  return parsed;
};

export const reviewSponsoredTransaction = (transaction: Transaction, policy: SponsorPolicy): Result<SponsorApproval> => {
  if (transaction.feePayer === undefined || !transaction.feePayer.equals(policy.sponsor)) return failure("the sponsor must be the fee payer");
  const instructions = transaction.instructions;
  if (instructions.length === 0 || instructions.length > MAX_INSTRUCTIONS) return failure(`a transaction carries 1 to ${MAX_INSTRUCTIONS} instructions`);
  const matched: { instruction: TransactionInstruction; rule: InstructionRule }[] = [];
  for (const [position, instruction] of instructions.entries()) {
    const rule = findRule(instruction);
    if (rule === undefined) return failure(`instruction ${position} is not on the allowlist`);
    if (instruction.keys.length < rule.minimumAccounts) return failure(`instruction ${position} (${rule.label}) is missing accounts`);
    const sponsorMisuse = instruction.keys.findIndex((key, slot) => key.pubkey.equals(policy.sponsor) && !rule.sponsorSlots.includes(slot));
    if (sponsorMisuse !== -1) return failure(`instruction ${position} (${rule.label}) uses the sponsor outside its payer slot`);
    const refusal = rule.findRefusal?.(instruction, policy) ?? null;
    if (refusal !== null) return failure(`instruction ${position} (${rule.label}): ${refusal}`);
    matched.push({ instruction, rule });
  }
  const wallets = matched.flatMap(({ instruction, rule }) => {
    const walletKey = rule.walletSlot === null ? undefined : instruction.keys[rule.walletSlot]?.pubkey;
    return walletKey === undefined ? [] : [walletKey];
  });
  const [wallet] = wallets;
  if (wallets.some((candidate) => wallet !== undefined && !candidate.equals(wallet))) return failure("a sponsored transaction acts for one wallet");
  const unsignedRule = matched.find(({ rule }) => rule.needsWalletSignature === true && (wallet === undefined || !isSignedBy(transaction, wallet)));
  if (unsignedRule !== undefined) return failure(`${unsignedRule.rule.label} is sponsored only when the wallet's signature is on the transaction`);
  for (const { instruction, rule } of matched) {
    if (rule.findWalletRefusal === undefined) continue;
    if (wallet === undefined) return failure(`${rule.label} needs a wallet named in the same transaction`);
    const refusal = rule.findWalletRefusal(instruction, wallet, policy);
    if (refusal !== null) return failure(`${rule.label}: ${refusal}`);
  }
  return success({ wallet: wallet ?? null, labels: matched.map(({ rule }) => rule.label) });
};
