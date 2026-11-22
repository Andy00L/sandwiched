import { PublicKey } from "@solana/web3.js";
import { Buffer } from "buffer";
import { type Result, attempt, attemptSync, failure, success } from "./result";

export type FeedAccount = { owner: PublicKey; data: Buffer };
export type AccountChange = { address: PublicKey; slot: number; account: FeedAccount | null };
export type FeedStatus = "idle" | "connecting" | "live" | "polling" | "closed";

export type AccountFeed = {
  watch: (address: PublicKey, onChange: (change: AccountChange) => void) => () => void;
  status: () => FeedStatus;
  close: () => void;
};

export type AccountFeedOptions = {
  rpcUrl: string;
  wsUrl: string;
  pollIntervalMs?: number;
  onStatus?: (status: FeedStatus) => void;
};

const DEFAULT_POLL_INTERVAL_MS = 250;
const HEARTBEAT_MS = 5_000;
const RECONNECT_BASE_MS = 500;
const RECONNECT_MAX_MS = 10_000;
const MAX_ACCOUNTS_PER_READ = 100;
const PING_MESSAGE = JSON.stringify({ jsonrpc: "2.0", method: "ping" });

type ChangeListener = (change: AccountChange) => void;

type Watcher = {
  address: PublicKey;
  listeners: Set<ChangeListener>;
  subscriptionId: number | null;
  lastSlot: number;
  lastFingerprint: string | null;
  lastChange: AccountChange | null;
};

type AccountRead = { key: string; slot: number; value: unknown };

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null;

const parseAccountValue = (value: unknown): Result<{ fingerprint: string; account: FeedAccount | null }> => {
  if (value === null) return success({ fingerprint: "missing", account: null });
  if (!isRecord(value) || typeof value.owner !== "string" || !Array.isArray(value.data)) {
    return failure("[parseAccountValue] malformed account value");
  }
  const [dataBase64] = value.data;
  if (typeof dataBase64 !== "string") return failure("[parseAccountValue] account data is not base64");
  const ownerText = value.owner;
  const owner = attemptSync(() => new PublicKey(ownerText));
  if (!owner.ok) return owner;
  return success({ fingerprint: `${ownerText}:${dataBase64}`, account: { owner: owner.value, data: Buffer.from(dataBase64, "base64") } });
};

const readAccounts = async (rpcUrl: string, keys: string[]): Promise<Result<AccountRead[]>> => {
  const reads: AccountRead[] = [];
  for (let start = 0; start < keys.length; start += MAX_ACCOUNTS_PER_READ) {
    const chunk = keys.slice(start, start + MAX_ACCOUNTS_PER_READ);
    const answer = await attempt(async () => {
      const response = await fetch(rpcUrl, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          method: "getMultipleAccounts",
          params: [chunk, { encoding: "base64", commitment: "processed" }],
        }),
      });
      const body: unknown = await response.json();
      return body;
    });
    if (!answer.ok) return answer;
    const result = isRecord(answer.value) ? answer.value.result : undefined;
    if (!isRecord(result) || !isRecord(result.context) || typeof result.context.slot !== "number" || !Array.isArray(result.value)) {
      return failure("[readAccounts] malformed getMultipleAccounts answer");
    }
    const slot = result.context.slot;
    const values: unknown[] = result.value;
    chunk.forEach((key, index) => reads.push({ key, slot, value: values[index] ?? null }));
  }
  return success(reads);
};

export const createAccountFeed = (options: AccountFeedOptions): AccountFeed => {
  const pollIntervalMs = options.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS;
  const watchers = new Map<string, Watcher>();
  const pendingSubscriptions = new Map<number, string>();
  const subscriptionOwners = new Map<number, string>();
  let socket: WebSocket | null = null;
  let currentStatus: FeedStatus = "idle";
  let requestCounter = 0;
  let reconnectAttempts = 0;
  let heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  let pollTimer: ReturnType<typeof setInterval> | null = null;
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  let isClosed = false;

  const setStatus = (nextStatus: FeedStatus) => {
    if (currentStatus === nextStatus) return;
    currentStatus = nextStatus;
    options.onStatus?.(nextStatus);
  };

  const sendRequest = (method: string, params: unknown[]): number | null => {
    const openSocket = socket;
    if (openSocket === null || openSocket.readyState !== WebSocket.OPEN) return null;
    requestCounter += 1;
    const requestId = requestCounter;
    const sent = attemptSync(() => openSocket.send(JSON.stringify({ jsonrpc: "2.0", id: requestId, method, params })));
    return sent.ok ? requestId : null;
  };

  const deliver = (watcher: Watcher, slot: number, value: unknown) => {
    if (slot < watcher.lastSlot) return;
    const parsed = parseAccountValue(value);
    if (!parsed.ok) {
      console.warn(`[createAccountFeed] ${watcher.address.toBase58()}: ${parsed.reason}`);
      return;
    }
    watcher.lastSlot = slot;
    if (parsed.value.fingerprint === watcher.lastFingerprint) return;
    watcher.lastFingerprint = parsed.value.fingerprint;
    const change: AccountChange = { address: watcher.address, slot, account: parsed.value.account };
    watcher.lastChange = change;
    for (const listener of watcher.listeners) listener(change);
  };

  const refresh = async (keys: string[]) => {
    if (keys.length === 0) return;
    const read = await readAccounts(options.rpcUrl, keys);
    if (!read.ok) {
      console.warn(`[createAccountFeed] read failed: ${read.reason}`);
      return;
    }
    for (const accountRead of read.value) {
      const watcher = watchers.get(accountRead.key);
      if (watcher !== undefined) deliver(watcher, accountRead.slot, accountRead.value);
    }
  };

  const refreshAll = () => refresh([...watchers.keys()]);

  const subscribe = (key: string) => {
    const requestId = sendRequest("accountSubscribe", [key, { encoding: "base64", commitment: "processed" }]);
    if (requestId !== null) pendingSubscriptions.set(requestId, key);
  };

  const unsubscribe = (subscriptionId: number) => {
    subscriptionOwners.delete(subscriptionId);
    sendRequest("accountUnsubscribe", [subscriptionId]);
  };

  const stopTimer = (timer: ReturnType<typeof setInterval> | null) => {
    if (timer !== null) clearInterval(timer);
    return null;
  };

  const handleSubscriptionAnswer = (requestId: number, result: unknown) => {
    const key = pendingSubscriptions.get(requestId);
    pendingSubscriptions.delete(requestId);
    if (key === undefined) return;
    if (typeof result !== "number") {
      console.warn(`[createAccountFeed] accountSubscribe refused for ${key}`);
      return;
    }
    const watcher = watchers.get(key);
    if (watcher === undefined) {
      unsubscribe(result);
      return;
    }
    watcher.subscriptionId = result;
    subscriptionOwners.set(result, key);
  };

  const handleNotification = (params: unknown) => {
    if (!isRecord(params) || typeof params.subscription !== "number" || !isRecord(params.result)) return;
    const key = subscriptionOwners.get(params.subscription);
    const watcher = key === undefined ? undefined : watchers.get(key);
    const context = params.result.context;
    if (watcher === undefined || !isRecord(context) || typeof context.slot !== "number") return;
    deliver(watcher, context.slot, params.result.value);
  };

  const handleMessage = (text: string) => {
    const parsed = attemptSync((): unknown => JSON.parse(text));
    if (!parsed.ok || !isRecord(parsed.value)) return;
    const message = parsed.value;
    if (typeof message.id === "number") {
      handleSubscriptionAnswer(message.id, message.result);
      return;
    }
    if (message.method === "accountNotification") handleNotification(message.params);
  };

  const handleDrop = () => {
    socket = null;
    heartbeatTimer = stopTimer(heartbeatTimer);
    pendingSubscriptions.clear();
    subscriptionOwners.clear();
    for (const watcher of watchers.values()) watcher.subscriptionId = null;
    if (isClosed) return;
    setStatus("polling");
    if (pollTimer === null) pollTimer = setInterval(() => void refreshAll(), pollIntervalMs);
    void refreshAll();
    const delayMs = Math.min(RECONNECT_MAX_MS, RECONNECT_BASE_MS * 2 ** reconnectAttempts);
    reconnectAttempts += 1;
    reconnectTimer = setTimeout(() => {
      reconnectTimer = null;
      connect();
    }, delayMs);
  };

  const connect = () => {
    if (isClosed || socket !== null || reconnectTimer !== null) return;
    if (pollTimer === null) setStatus("connecting");
    const created = attemptSync(() => new WebSocket(options.wsUrl));
    if (!created.ok) {
      handleDrop();
      return;
    }
    const openingSocket = created.value;
    socket = openingSocket;
    openingSocket.onopen = () => {
      reconnectAttempts = 0;
      pollTimer = stopTimer(pollTimer);
      setStatus("live");
      heartbeatTimer = setInterval(() => attemptSync(() => openingSocket.send(PING_MESSAGE)), HEARTBEAT_MS);
      for (const key of watchers.keys()) subscribe(key);
      void refreshAll();
    };
    openingSocket.onmessage = (event: MessageEvent) => {
      if (typeof event.data === "string") handleMessage(event.data);
    };
    openingSocket.onclose = () => {
      if (socket === openingSocket) handleDrop();
    };
  };

  const watch = (address: PublicKey, onChange: ChangeListener) => {
    const key = address.toBase58();
    const existing = watchers.get(key);
    const watcher: Watcher = existing ?? {
      address,
      listeners: new Set(),
      subscriptionId: null,
      lastSlot: 0,
      lastFingerprint: null,
      lastChange: null,
    };
    watcher.listeners.add(onChange);
    if (existing === undefined) {
      watchers.set(key, watcher);
      subscribe(key);
      void refresh([key]);
    } else if (watcher.lastChange !== null) {
      onChange(watcher.lastChange);
    }
    connect();
    return () => {
      watcher.listeners.delete(onChange);
      if (watcher.listeners.size > 0 || watchers.get(key) !== watcher) return;
      watchers.delete(key);
      if (watcher.subscriptionId !== null) unsubscribe(watcher.subscriptionId);
    };
  };

  const close = () => {
    isClosed = true;
    heartbeatTimer = stopTimer(heartbeatTimer);
    pollTimer = stopTimer(pollTimer);
    if (reconnectTimer !== null) clearTimeout(reconnectTimer);
    reconnectTimer = null;
    const closingSocket = socket;
    socket = null;
    if (closingSocket !== null) attemptSync(() => closingSocket.close());
    watchers.clear();
    setStatus("closed");
  };

  return { watch, status: () => currentStatus, close };
};
