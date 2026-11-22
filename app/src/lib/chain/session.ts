import { Keypair, type PublicKey } from "@solana/web3.js";
import { findSessionTokenAddress } from "./addresses";
import type { ChainClient } from "./client";
import { SESSION_RENEW_MARGIN_S, SESSION_VALIDITY_S } from "./config";
import { listSecretKeyBytes, restoreKeypair } from "./guest-key";
import type { KeyStore } from "./key-store";
import { buildCreateSessionInstruction } from "./program";
import { type Result, attempt, attemptSync, failure, success } from "./result";
import { type TransactionSigner, createKeypairSigner, resolveFeePayer, sendOnBase } from "./transport";

const SESSION_STORAGE_PREFIX = "sandwich.session.v1.";

export type SessionKey = { signer: Keypair; token: PublicKey; validUntilUnix: number };
export type OpenedSession = SessionKey & { isNew: boolean; signature: string | null };

const readNowUnix = (): number => Math.floor(Date.now() / 1000);

const nameSessionEntry = (wallet: PublicKey): string => `${SESSION_STORAGE_PREFIX}${wallet.toBase58()}`;

export const loadStoredSession = (store: KeyStore, wallet: PublicKey, nowUnix: number): SessionKey | null => {
  const storedText = store.read(nameSessionEntry(wallet));
  if (storedText === null) return null;
  const parsed = attemptSync((): unknown => JSON.parse(storedText));
  if (!parsed.ok || typeof parsed.value !== "object" || parsed.value === null) return null;
  const stored = parsed.value;
  if (!("validUntilUnix" in stored) || typeof stored.validUntilUnix !== "number" || !("secretKey" in stored)) return null;
  if (stored.validUntilUnix - SESSION_RENEW_MARGIN_S <= nowUnix) return null;
  const signer = restoreKeypair(stored.secretKey);
  if (signer === null) return null;
  return { signer, token: findSessionTokenAddress(signer.publicKey, wallet), validUntilUnix: stored.validUntilUnix };
};

export const openSession = async (
  client: ChainClient,
  wallet: TransactionSigner,
  store: KeyStore,
  nowUnix: number = readNowUnix(),
): Promise<Result<OpenedSession>> => {
  const stored = loadStoredSession(store, wallet.publicKey, nowUnix);
  if (stored !== null) {
    const tokenAccount = await attempt(() => client.base.getAccountInfo(stored.token, "confirmed"));
    if (tokenAccount.ok && tokenAccount.value !== null) return success({ ...stored, isNew: false, signature: null });
  }
  const signer = Keypair.generate();
  const validUntilUnix = nowUnix + SESSION_VALIDITY_S;
  const feePayer = resolveFeePayer(client.feePayment, wallet.publicKey);
  const instruction = await attempt(() =>
    buildCreateSessionInstruction(client.programs.session, feePayer, wallet.publicKey, signer.publicKey, validUntilUnix),
  );
  if (!instruction.ok) return failure(`[openSession] build: ${instruction.reason}`);
  const sent = await sendOnBase(client.base, client.feePayment, [instruction.value], [wallet, createKeypairSigner(signer)]);
  if (!sent.ok) return failure(`[openSession] ${sent.reason}`);
  store.write(nameSessionEntry(wallet.publicKey), JSON.stringify({ secretKey: listSecretKeyBytes(signer), validUntilUnix }));
  return success({
    signer,
    token: findSessionTokenAddress(signer.publicKey, wallet.publicKey),
    validUntilUnix,
    isNew: true,
    signature: sent.value.signature,
  });
};
