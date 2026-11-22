import { expect, test } from "bun:test";
import { loadGuestKey } from "./guest-key";
import { createMemoryKeyStore } from "./key-store";

test("a guest key held only in memory reports that a reload loses it", () => {
  const store = createMemoryKeyStore();
  expect(loadGuestKey(store).isPersisted).toBe(false);
  expect(loadGuestKey(store).isPersisted).toBe(false);
});

test("a guest key whose storage write fails reports that a reload loses it", () => {
  expect(loadGuestKey({ ...createMemoryKeyStore(), isDurable: true, write: () => false }).isPersisted).toBe(false);
});

test("a guest key restored from durable storage reports that it survives a reload", () => {
  const store = { ...createMemoryKeyStore(), isDurable: true };
  const created = loadGuestKey(store);
  const restored = loadGuestKey(store);
  expect(created.isPersisted).toBe(true);
  expect(restored).toMatchObject({ isNew: false, isPersisted: true });
  expect(restored.keypair.publicKey.equals(created.keypair.publicKey)).toBe(true);
});
