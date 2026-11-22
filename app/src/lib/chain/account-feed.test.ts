import { afterEach, beforeEach, describe, expect, jest, test } from "bun:test";
import { Keypair, type PublicKey } from "@solana/web3.js";
import { Buffer } from "buffer";
import { advanceFakeTime, flushMicrotasks } from "../../../tests/fake-time";
import {
  type AccountChange,
  type FeedFetch,
  type FeedSocketHandlers,
  type FeedStatus,
  HEARTBEAT_MS,
  type OpenFeedSocket,
  createAccountFeed,
} from "./account-feed";

const POLL_MS = 250;
const OWNER_TEXT = Keypair.generate().publicKey.toBase58();

type SentMessage = { id: number | null; method: string; params: unknown[] };

type FakeSocket = { handlers: FeedSocketHandlers; sent: SentMessage[]; isClosed: boolean };

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null;

const parseSent = (text: string): SentMessage => {
  const parsed: unknown = JSON.parse(text);
  if (!isRecord(parsed)) return { id: null, method: "", params: [] };
  return {
    id: typeof parsed.id === "number" ? parsed.id : null,
    method: typeof parsed.method === "string" ? parsed.method : "",
    params: Array.isArray(parsed.params) ? parsed.params : [],
  };
};

const readRequestedKeys = (init: RequestInit): string[] => {
  const body: unknown = JSON.parse(String(init.body));
  const [keys] = isRecord(body) && Array.isArray(body.params) ? body.params : [];
  return Array.isArray(keys) ? keys.filter((key) => typeof key === "string") : [];
};

const encodeAccount = (marker: number) => ({ owner: OWNER_TEXT, data: [Buffer.from([marker]).toString("base64"), "base64"] });

function createHarness() {
  const sockets: FakeSocket[] = [];
  const statuses: FeedStatus[] = [];
  const accounts = new Map<string, number>();
  const rpc = { slot: 100, fetchCount: 0, inFlight: 0, maxInFlight: 0, isHanging: false, release: () => undefined as void };
  const openSocket: OpenFeedSocket = (_url, handlers) => {
    const socket: FakeSocket = { handlers, sent: [], isClosed: false };
    sockets.push(socket);
    return {
      send: (text) => socket.sent.push(parseSent(text)),
      close: () => {
        socket.isClosed = true;
      },
    };
  };
  const fetchFake: FeedFetch = async (_url, init) => {
    rpc.fetchCount += 1;
    rpc.inFlight += 1;
    rpc.maxInFlight = Math.max(rpc.maxInFlight, rpc.inFlight);
    if (rpc.isHanging) await new Promise<void>((resolve) => (rpc.release = resolve));
    rpc.inFlight -= 1;
    const values = readRequestedKeys(init).map((key) => {
      const marker = accounts.get(key);
      return marker === undefined ? null : encodeAccount(marker);
    });
    return Response.json({ jsonrpc: "2.0", id: 1, result: { context: { slot: rpc.slot }, value: values } });
  };
  const feed = createAccountFeed({ rpcUrl: "http://rpc.test", wsUrl: "ws://rpc.test", pollIntervalMs: POLL_MS, onStatus: (status) => statuses.push(status), openSocket, fetch: fetchFake });
  const readSocket = (index = 0): FakeSocket => {
    const socket = sockets[index];
    expect(socket).toBeDefined();
    return socket ?? { handlers: { onOpen: () => undefined, onMessage: () => undefined, onClose: () => undefined }, sent: [], isClosed: true };
  };
  const listSent = (socket: FakeSocket, method: string) => socket.sent.filter((message) => message.method === method);
  const answer = (socket: FakeSocket, id: number | null, result: unknown) => socket.handlers.onMessage(JSON.stringify({ jsonrpc: "2.0", id, result }));
  const notify = (socket: FakeSocket, subscription: number, slot: number, marker: number) =>
    socket.handlers.onMessage(
      JSON.stringify({ jsonrpc: "2.0", method: "accountNotification", params: { subscription, result: { context: { slot }, value: encodeAccount(marker) } } }),
    );
  return { feed, sockets, statuses, accounts, rpc, readSocket, listSent, answer, notify };
}

const watchAddress = (feed: ReturnType<typeof createHarness>["feed"], address: PublicKey) => {
  const changes: AccountChange[] = [];
  const stop = feed.watch(address, (change) => changes.push(change));
  return { changes, stop, readMarkers: () => changes.map((change) => change.account?.data[0] ?? null) };
};

beforeEach(() => jest.useFakeTimers());
afterEach(() => jest.useRealTimers());

describe("createAccountFeed connection", () => {
  test("polls while the first connection is still opening, and stops once it is live", async () => {
    const harness = createHarness();
    watchAddress(harness.feed, Keypair.generate().publicKey);
    await advanceFakeTime(POLL_MS * 4);
    expect(harness.feed.status()).toBe("connecting");
    expect(harness.rpc.fetchCount).toBeGreaterThanOrEqual(4);

    harness.readSocket().handlers.onOpen();
    const fetchesWhenLive = harness.rpc.fetchCount;
    await advanceFakeTime(POLL_MS * 4);
    expect(harness.feed.status()).toBe("live");
    expect(harness.rpc.fetchCount).toBe(fetchesWhenLive);
  });

  test("drops a socket that stays silent for two heartbeats and falls back to polling", async () => {
    const harness = createHarness();
    watchAddress(harness.feed, Keypair.generate().publicKey);
    const socket = harness.readSocket();
    socket.handlers.onOpen();
    await advanceFakeTime(HEARTBEAT_MS * 3 + 100, 100);
    expect(harness.statuses).toEqual(["connecting", "live", "polling"]);
    expect(socket.isClosed).toBe(true);
    const fetchesAfterDrop = harness.rpc.fetchCount;
    await advanceFakeTime(POLL_MS * 2);
    expect(harness.rpc.fetchCount).toBeGreaterThan(fetchesAfterDrop);
  });

  test("stays live while the server answers its pings", async () => {
    const harness = createHarness();
    watchAddress(harness.feed, Keypair.generate().publicKey);
    const socket = harness.readSocket(0);
    socket.handlers.onOpen();
    for (let beat = 0; beat < 6; beat += 1) {
      await advanceFakeTime(HEARTBEAT_MS, 100);
      for (const ping of harness.listSent(socket, "ping").filter((message) => message.id !== null)) harness.answer(socket, ping.id, "pong");
    }
    expect(harness.feed.status()).toBe("live");
  });

  test("registers nothing when asked to watch after close", async () => {
    const harness = createHarness();
    harness.feed.close();
    const watched = watchAddress(harness.feed, Keypair.generate().publicKey);
    await advanceFakeTime(POLL_MS * 4);
    expect(harness.rpc.fetchCount).toBe(0);
    expect(harness.sockets).toHaveLength(0);
    expect(watched.changes).toEqual([]);
  });

  test("never runs two polls at once when a read is slow", async () => {
    const harness = createHarness();
    harness.rpc.isHanging = true;
    watchAddress(harness.feed, Keypair.generate().publicKey);
    harness.readSocket().handlers.onClose();
    await advanceFakeTime(POLL_MS * 8);
    expect(harness.feed.status()).not.toBe("live");
    expect(harness.rpc.maxInFlight).toBe(1);
    harness.rpc.isHanging = false;
    harness.rpc.release();
    await advanceFakeTime(POLL_MS * 2);
    expect(harness.rpc.maxInFlight).toBe(1);
  });
});

describe("createAccountFeed subscriptions", () => {
  test("re-reads the account when the subscription is acknowledged, so a change before the ack is not missed", async () => {
    const harness = createHarness();
    const address = Keypair.generate().publicKey;
    harness.accounts.set(address.toBase58(), 1);
    const watched = watchAddress(harness.feed, address);
    const socket = harness.readSocket(0);
    socket.handlers.onOpen();
    await flushMicrotasks();
    harness.accounts.set(address.toBase58(), 2);
    harness.rpc.slot += 1;
    const [subscribeRequest] = harness.listSent(socket, "accountSubscribe");
    harness.answer(socket, subscribeRequest?.id ?? null, 900);
    await flushMicrotasks();
    expect(watched.readMarkers().at(-1)).toBe(2);
  });

  test("retries a refused subscription with a growing delay, then delivers its notifications", async () => {
    const harness = createHarness();
    const watched = watchAddress(harness.feed, Keypair.generate().publicKey);
    const socket = harness.readSocket(0);
    socket.handlers.onOpen();
    const [firstRequest] = harness.listSent(socket, "accountSubscribe");
    socket.handlers.onMessage(JSON.stringify({ jsonrpc: "2.0", id: firstRequest?.id, error: { code: -32000, message: "busy" } }));
    await advanceFakeTime(400);
    expect(harness.listSent(socket, "accountSubscribe")).toHaveLength(1);
    await advanceFakeTime(200);
    const retries = harness.listSent(socket, "accountSubscribe");
    expect(retries).toHaveLength(2);
    harness.answer(socket, retries[1]?.id ?? null, 901);
    harness.notify(socket, 901, 500, 7);
    expect(watched.readMarkers().at(-1)).toBe(7);
  });

  test("watch, unwatch and watch again before the acks leaves exactly one live subscription", async () => {
    const harness = createHarness();
    const address = Keypair.generate().publicKey;
    harness.feed.watch(Keypair.generate().publicKey, () => undefined);
    const socket = harness.readSocket(0);
    socket.handlers.onOpen();
    const first = watchAddress(harness.feed, address);
    first.stop();
    const second = watchAddress(harness.feed, address);
    const [, staleRequest, currentRequest] = harness.listSent(socket, "accountSubscribe");
    harness.answer(socket, staleRequest?.id ?? null, 801);
    harness.answer(socket, currentRequest?.id ?? null, 802);
    expect(harness.listSent(socket, "accountUnsubscribe").map((message) => message.params)).toEqual([[801]]);
    harness.notify(socket, 801, 600, 3);
    harness.notify(socket, 802, 601, 4);
    expect(second.readMarkers()).toEqual([4]);
    expect(first.changes).toEqual([]);
  });

  test("decodes a repeated notification once and accepts a slot far below the last one after a rollup restart", async () => {
    const harness = createHarness();
    const watched = watchAddress(harness.feed, Keypair.generate().publicKey);
    const socket = harness.readSocket(0);
    socket.handlers.onOpen();
    const [request] = harness.listSent(socket, "accountSubscribe");
    harness.answer(socket, request?.id ?? null, 700);
    await flushMicrotasks();
    const deliveriesBefore = watched.changes.length;
    harness.notify(socket, 700, 50_000, 5);
    harness.notify(socket, 700, 50_001, 5);
    harness.notify(socket, 700, 49_990, 6);
    harness.notify(socket, 700, 3, 8);
    expect(watched.readMarkers().slice(deliveriesBefore)).toEqual([5, 8]);
  });
});
