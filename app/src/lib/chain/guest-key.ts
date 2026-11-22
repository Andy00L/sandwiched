import { Keypair } from "@solana/web3.js";
import type { KeyStore } from "./key-store";
import { attemptSync } from "./result";

const GUEST_KEY_STORAGE_KEY = "sandwich.guest-key.v1";
const SECRET_KEY_LENGTH = 64;

export type GuestKey = { keypair: Keypair; isNew: boolean; isPersisted: boolean };

export const restoreKeypair = (secretKey: unknown): Keypair | null => {
  if (!Array.isArray(secretKey) || secretKey.length !== SECRET_KEY_LENGTH) return null;
  const bytes: unknown[] = secretKey;
  if (!bytes.every((byte) => typeof byte === "number" && Number.isInteger(byte) && byte >= 0 && byte <= 255)) return null;
  const restored = attemptSync(() => Keypair.fromSecretKey(Uint8Array.from(bytes.map(Number))));
  return restored.ok ? restored.value : null;
};

export const listSecretKeyBytes = (keypair: Keypair): number[] => Array.from(keypair.secretKey);

export const loadGuestKey = (store: KeyStore): GuestKey => {
  const storedText = store.read(GUEST_KEY_STORAGE_KEY);
  const parsed = storedText === null ? null : attemptSync((): unknown => JSON.parse(storedText));
  const stored = parsed?.ok === true ? restoreKeypair(parsed.value) : null;
  if (stored !== null) return { keypair: stored, isNew: false, isPersisted: true };
  const created = Keypair.generate();
  const isPersisted = store.write(GUEST_KEY_STORAGE_KEY, JSON.stringify(listSecretKeyBytes(created)));
  return { keypair: created, isNew: true, isPersisted };
};
