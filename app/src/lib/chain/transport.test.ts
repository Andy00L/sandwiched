import { afterEach, describe, expect, jest, test } from "bun:test";
import { Keypair, PublicKey, TransactionInstruction } from "@solana/web3.js";
import { Buffer } from "buffer";
import { hangUntilAborted, stubFetch } from "../../../tests/fake-fetch";
import { advanceFakeTime, advanceTimers } from "../../../tests/fake-time";
import { RPC_REQUEST_TIMEOUT_MS } from "./config";
import { type BlockhashSource, type RollupAck, createBlockhashCache, createKeypairSigner, sendOnRollup } from "./transport";

const REFRESH_MS = 1_000;
const ROLLUP_URL = "http://rollup.test";

const createCountingSource = () => {
  let fetchCount = 0;
  const source: BlockhashSource = {
    getLatestBlockhash: async () => {
      fetchCount += 1;
      return { blockhash: Keypair.generate().publicKey.toBase58(), lastValidBlockHeight: 1 };
    },
  };
  return { source, readFetchCount: () => fetchCount };
};

const buildNoopInstruction = (signer: PublicKey | null = null) =>
  new TransactionInstruction({
    programId: PublicKey.default,
    keys: signer === null ? [] : [{ pubkey: signer, isSigner: true, isWritable: false }],
    data: Buffer.alloc(1),
  });

const answerRollup = (answers: unknown[]) => {
  let sendCount = 0;
  stubFetch(async () => Response.json(answers[Math.min(sendCount++, answers.length - 1)]));
  return () => sendCount;
};

afterEach(() => {
  jest.useRealTimers();
  jest.restoreAllMocks();
});

describe("createBlockhashCache", () => {
  test("refetches a blockhash older than two refresh periods when the refresh timer did not run", async () => {
    jest.useFakeTimers();
    const { source, readFetchCount } = createCountingSource();
    const cache = createBlockhashCache(source, REFRESH_MS);
    const first = await cache.ready();
    cache.stop();
    advanceTimers(REFRESH_MS * 5);
    const second = await cache.ready();
    cache.stop();
    expect(readFetchCount()).toBe(2);
    expect(second).not.toBe(first);
  });

  test("serves concurrent first reads from one fetch", async () => {
    const { source, readFetchCount } = createCountingSource();
    const cache = createBlockhashCache(source, REFRESH_MS);
    const [left, right] = await Promise.all([cache.ready(), cache.ready()]);
    cache.stop();
    expect(readFetchCount()).toBe(1);
    expect(left).toBe(right);
  });
});

describe("sendOnRollup", () => {
  test("refetches the blockhash and sends once more when the validator does not know it", async () => {
    const { source, readFetchCount } = createCountingSource();
    const cache = createBlockhashCache(source, REFRESH_MS);
    const readSendCount = answerRollup([
      { error: { code: -32002, message: "Transaction simulation failed: Blockhash not found" } },
      { result: "second-signature" },
    ]);
    const ack = await sendOnRollup(ROLLUP_URL, cache, [buildNoopInstruction()], [createKeypairSigner(Keypair.generate())]);
    cache.stop();
    expect(ack).toMatchObject({ ok: true, signature: "second-signature" });
    expect(readSendCount()).toBe(2);
    expect(readFetchCount()).toBe(2);
  });

  test("does not resend after a program error", async () => {
    const { source } = createCountingSource();
    const cache = createBlockhashCache(source, REFRESH_MS);
    const readSendCount = answerRollup([{ error: { code: -32002, message: "custom program error: 0x1770" } }]);
    const ack = await sendOnRollup(ROLLUP_URL, cache, [buildNoopInstruction()], [createKeypairSigner(Keypair.generate())]);
    cache.stop();
    expect(ack).toMatchObject({ ok: false, kind: "program", errorCode: 6000 });
    expect(readSendCount()).toBe(1);
  });

  test("refuses locally, without throwing, when an instruction needs a signer nobody provided", async () => {
    const { source } = createCountingSource();
    const cache = createBlockhashCache(source, REFRESH_MS);
    const readSendCount = answerRollup([{ result: "never" }]);
    const ack = await sendOnRollup(ROLLUP_URL, cache, [buildNoopInstruction(Keypair.generate().publicKey)], [createKeypairSigner(Keypair.generate())]);
    cache.stop();
    expect(ack).toMatchObject({ ok: false, kind: "client" });
    expect(readSendCount()).toBe(0);
  });

  test("reports a transport failure when the rollup never answers", async () => {
    const { source } = createCountingSource();
    const cache = createBlockhashCache(source, REFRESH_MS);
    await cache.ready();
    cache.stop();
    jest.useFakeTimers();
    stubFetch(hangUntilAborted);
    const outcome: { ack: RollupAck | null } = { ack: null };
    void sendOnRollup(ROLLUP_URL, cache, [buildNoopInstruction()], [createKeypairSigner(Keypair.generate())]).then((ack) => {
      outcome.ack = ack;
    });
    await advanceFakeTime(RPC_REQUEST_TIMEOUT_MS + 100, 100);
    expect(outcome.ack).toMatchObject({ ok: false, kind: "transport" });
  });
});
