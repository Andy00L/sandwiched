import { getAssociatedTokenAddressSync } from "@solana/spl-token";
import { PublicKey } from "@solana/web3.js";
import { Buffer } from "buffer";
import { SANDWICH_PROGRAM_ID, SESSION_PROGRAM_ID } from "./config";

const findAddress = (seeds: Uint8Array[], programId: PublicKey = SANDWICH_PROGRAM_ID): PublicKey =>
  PublicKey.findProgramAddressSync(seeds, programId)[0];

export const findTableAddress = (tableId: bigint): PublicKey => {
  const idBytes = Buffer.alloc(8);
  idBytes.writeBigUInt64LE(tableId);
  return findAddress([Buffer.from("table"), idBytes]);
};

export const findSeatAddress = (table: PublicKey, wallet: PublicKey): PublicKey =>
  findAddress([Buffer.from("seat"), table.toBuffer(), wallet.toBuffer()]);

export const findCustodyAddress = (table: PublicKey): PublicKey => findAddress([Buffer.from("custody"), table.toBuffer()]);

export const findTestMintAddress = (): PublicKey => findAddress([Buffer.from("test_usdc")]);

export const findFaucetAuthorityAddress = (): PublicKey => findAddress([Buffer.from("faucet")]);

export const findFaucetClaimAddress = (wallet: PublicKey): PublicKey =>
  findAddress([Buffer.from("faucet_claim"), wallet.toBuffer()]);

export const findProgramIdentityAddress = (): PublicKey => findAddress([Buffer.from("identity")]);

export const findEscrowTokenAddress = (table: PublicKey, mint: PublicKey): PublicKey =>
  getAssociatedTokenAddressSync(mint, findCustodyAddress(table), true);

export const findWalletTokenAddress = (wallet: PublicKey, mint: PublicKey): PublicKey =>
  getAssociatedTokenAddressSync(mint, wallet);

export const findSessionTokenAddress = (sessionSigner: PublicKey, wallet: PublicKey): PublicKey =>
  findAddress(
    [Buffer.from("session_token_v2"), SANDWICH_PROGRAM_ID.toBuffer(), sessionSigner.toBuffer(), wallet.toBuffer()],
    SESSION_PROGRAM_ID,
  );
