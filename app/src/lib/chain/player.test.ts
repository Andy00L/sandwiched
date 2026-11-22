import { afterEach, expect, jest, test } from "bun:test";
import { Keypair, Transaction } from "@solana/web3.js";
import { Buffer } from "buffer";
import { createFakeChainClient } from "../../../tests/fake-chain-client";
import { stubFetch } from "../../../tests/fake-fetch";
import { SESSION_VALIDITY_S } from "./config";
import { createMemoryKeyStore } from "./key-store";
import { createSeatActions } from "./player";
import { createSessionKeeper } from "./session";
import { createKeypairSigner } from "./transport";

afterEach(() => jest.restoreAllMocks());

const recordRollupSigners = () => {
  const signers: string[] = [];
  stubFetch(async (_input, init) => {
    const body: unknown = JSON.parse(String(init?.body));
    const params = typeof body === "object" && body !== null && "params" in body && Array.isArray(body.params) ? body.params : [];
    const [encoded] = params;
    signers.push(typeof encoded === "string" ? (Transaction.from(Buffer.from(encoded, "base64")).feePayer?.toBase58() ?? "") : "");
    return Response.json({ result: `rollup-signature-${signers.length}` });
  });
  return signers;
};

test("seat actions sign with a fresh session once the previous one reaches its renewal margin", async () => {
  const signers = recordRollupSigners();
  const base = { isConfirming: true, hasAccounts: false, sentTransactions: [] };
  const client = createFakeChainClient(base);
  const wallet = createKeypairSigner(Keypair.generate());
  let nowUnix = 1_000_000;
  const sessions = createSessionKeeper(client, wallet, createMemoryKeyStore(), () => nowUnix);
  const actions = createSeatActions({ client, table: Keypair.generate().publicKey, mint: Keypair.generate().publicKey, wallet, sessions });

  expect((await actions.join()).ok).toBe(true);
  nowUnix += SESSION_VALIDITY_S;
  expect((await actions.peck()).ok).toBe(true);
  client.rollupBlockhashes.stop();

  const [firstSigner, secondSigner] = signers;
  expect(signers).toHaveLength(2);
  expect(firstSigner).not.toBe(secondSigner);
  expect(signers).not.toContain(wallet.publicKey.toBase58());
  expect(base.sentTransactions).toHaveLength(2);
});
