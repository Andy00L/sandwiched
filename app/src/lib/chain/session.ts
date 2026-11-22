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

export type SessionKeeper = { resolve: () => Promise<Result<OpenedSession>> };

const readNowUnix = (): number => Math.floor(Date.now() / 1000);

const nameSessionEntry = (wallet: PublicKey): string => `${SESSION_STORAGE_PREFIX}${wallet.toBase58()}`;

const isUsableAt = (session: SessionKey, nowUnix: number): boolean => session.validUntilUnix - SESSION_RENEW_MARGIN_S > nowUnix;

const loadStoredSession = (store: KeyStore, wallet: PublicKey, nowUnix: number): SessionKey | null => {
  const storedText = store.read(nameSessionEntry(wallet));
  if (storedText === null) return null;
  const parsed = attemptSync((): unknown => JSON.parse(storedText));
  if (!parsed.ok || typeof parsed.value !== "object" || parsed.value === null) return null;
  const stored = parsed.value;
  if (!("validUntilUnix" in stored) || typeof stored.validUntilUnix !== "number" || !("secretKey" in stored)) return null;
  const signer = restoreKeypair(stored.secretKey);
  if (signer === null) return null;
  const session = { signer, token: findSessionTokenAddress(signer.publicKey, wallet), validUntilUnix: stored.validUntilUnix };
  return isUsableAt(session, nowUnix) ? session : null;
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
  const isStored = store.write(nameSessionEntry(wallet.publicKey), JSON.stringify({ secretKey: listSecretKeyBytes(signer), validUntilUnix }));
  if (!isStored) return failure("[openSession] the session key cannot be stored, so no session was paid for");
  const sent = await sendOnBase(client.base, client.feePayment, [instruction.value], [wallet, createKeypairSigner(signer)]);
  if (!sent.ok) return failure(`[openSession] ${sent.reason}`);
  return success({
    signer,
    token: findSessionTokenAddress(signer.publicKey, wallet.publicKey),
    validUntilUnix,
    isNew: true,
    signature: sent.value.signature,
  });
};

export const createSessionKeeper = (
  client: ChainClient,
  wallet: TransactionSigner,
  store: KeyStore,
  readNow: () => number = readNowUnix,
): SessionKeeper => {
  let current: SessionKey | null = null;
  let renewing: Promise<Result<OpenedSession>> | null = null;
  return {
    resolve: () => {
      if (current !== null && isUsableAt(current, readNow())) return Promise.resolve(success({ ...current, isNew: false, signature: null }));
      if (renewing !== null) return renewing;
      renewing = openSession(client, wallet, store, readNow()).then((opened) => {
        renewing = null;
        if (opened.ok) current = opened.value;
        return opened;
      });
      return renewing;
    },
  };
};
