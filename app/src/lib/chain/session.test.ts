import { describe, expect, test } from "bun:test";
import { Keypair } from "@solana/web3.js";
import { createFakeChainClient } from "../../../tests/fake-chain-client";
import { SESSION_VALIDITY_S } from "./config";
import { type KeyStore, createMemoryKeyStore } from "./key-store";
import { createSessionKeeper, openSession } from "./session";
import { createKeypairSigner } from "./transport";

const NOW_UNIX = 1_000_000;

describe("openSession", () => {
  test("stores the session key before paying for it, so a failed confirmation is reused instead of bought again", async () => {
    const store = createMemoryKeyStore();
    const wallet = createKeypairSigner(Keypair.generate());
    const base = { isConfirming: false, hasAccounts: false, sentTransactions: [] };
    const first = await openSession(createFakeChainClient(base), wallet, store, NOW_UNIX);
    expect(first.ok).toBe(false);

    const landed = { isConfirming: true, hasAccounts: true, sentTransactions: [] };
    const second = await openSession(createFakeChainClient(landed), wallet, store, NOW_UNIX);
    expect(second).toMatchObject({ ok: true, value: { isNew: false } });
    expect(landed.sentTransactions).toHaveLength(0);
  });

  test("sends nothing when the session key cannot be stored", async () => {
    const refusingStore: KeyStore = { ...createMemoryKeyStore(), write: () => false };
    const base = { isConfirming: true, hasAccounts: false, sentTransactions: [] };
    const opened = await openSession(createFakeChainClient(base), createKeypairSigner(Keypair.generate()), refusingStore, NOW_UNIX);
    expect(opened.ok).toBe(false);
    expect(base.sentTransactions).toHaveLength(0);
  });
});

describe("createSessionKeeper", () => {
  test("reuses the session while it is valid and opens a new one inside the renewal margin", async () => {
    const base = { isConfirming: true, hasAccounts: false, sentTransactions: [] };
    let nowUnix = NOW_UNIX;
    const keeper = createSessionKeeper(createFakeChainClient(base), createKeypairSigner(Keypair.generate()), createMemoryKeyStore(), () => nowUnix);
    const first = await keeper.resolve();
    const reused = await keeper.resolve();
    nowUnix += SESSION_VALIDITY_S;
    const renewed = await keeper.resolve();
    expect([first.ok, reused.ok, renewed.ok]).toEqual([true, true, true]);
    if (!first.ok || !reused.ok || !renewed.ok) return;
    expect(reused.value.signer.publicKey.equals(first.value.signer.publicKey)).toBe(true);
    expect(renewed.value.signer.publicKey.equals(first.value.signer.publicKey)).toBe(false);
    expect(base.sentTransactions).toHaveLength(2);
  });

  test("shares one renewal between concurrent callers", async () => {
    const base = { isConfirming: true, hasAccounts: false, sentTransactions: [] };
    const keeper = createSessionKeeper(createFakeChainClient(base), createKeypairSigner(Keypair.generate()), createMemoryKeyStore(), () => NOW_UNIX);
    await Promise.all([keeper.resolve(), keeper.resolve(), keeper.resolve()]);
    expect(base.sentTransactions).toHaveLength(1);
  });
});
