import { PublicKey } from "@solana/web3.js";
import { Buffer } from "buffer";
import { RPC_REQUEST_TIMEOUT_MS, SLOT_REGRESSION_SLOTS } from "./config";
import { type Result, attempt, attemptSync, failure, success } from "./result";
import { fetchWithTimeout } from "./rpc";

export type FeedAccount = { owner: PublicKey; data: Buffer };
export type AccountChange = { address: PublicKey; slot: number; account: FeedAccount | null };

type FeedSocket = { send: (text: string) => void; close: () => void };
export type FeedSocketHandlers = { onOpen: () => void; onMessage: (text: string) => void; onClose: () => void };
export type OpenFeedSocket = (url: string, handlers: FeedSocketHandlers) => FeedSocket;
export type FeedFetch = (url: string, init: RequestInit) => Promise<Response>;

type Interval = ReturnType<typeof setInterval>;
type Timeout = ReturnType<typeof setTimeout>;

type FeedLink =
  | { status: "idle" }
  | { status: "connecting"; socket: FeedSocket }
  | { status: "live"; socket: FeedSocket; heartbeat: Interval; lastInboundAtMs: number }
  | { status: "polling"; reconnect: Timeout }
  | { status: "closed" };

export type FeedStatus = FeedLink["status"];

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
  openSocket?: OpenFeedSocket;
  fetch?: FeedFetch;
};

const DEFAULT_POLL_INTERVAL_MS = 250;
export const HEARTBEAT_MS = 5_000;
const SILENT_HEARTBEATS_BEFORE_DROP = 2;
const RECONNECT_BASE_MS = 500;
const RECONNECT_MAX_MS = 10_000;
const SUBSCRIBE_RETRY_BASE_MS = 500;
const SUBSCRIBE_RETRY_MAX_MS = 10_000;
const MAX_ACCOUNTS_PER_READ = 100;

type ChangeListener = (change: AccountChange) => void;

type Watcher = {
  key: string;
  address: PublicKey;
  listeners: Set<ChangeListener>;
  subscriptionId: number | null;
  subscribeAttempts: number;
  subscribeRetry: Timeout | null;
  lastSlot: number;
  lastOwnerText: string | null;
  lastDataBase64: string | null;
  lastChange: AccountChange | null;
};

type AccountRead = { key: string; slot: number; value: unknown };

type RawAccount = { ownerText: string; dataBase64: string } | null;

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null;

const readRawAccount = (value: unknown): Result<RawAccount> => {
  if (value === null) return success(null);
  if (!isRecord(value) || typeof value.owner !== "string" || !Array.isArray(value.data)) {
    return failure("[readRawAccount] malformed account value");
  }
  const [dataBase64] = value.data;
  if (typeof dataBase64 !== "string") return failure("[readRawAccount] account data is not base64");
  return success({ ownerText: value.owner, dataBase64 });
};

const decodeRawAccount = (raw: NonNullable<RawAccount>): Result<FeedAccount> => {
  const owner = attemptSync(() => new PublicKey(raw.ownerText));
  return owner.ok ? success({ owner: owner.value, data: Buffer.from(raw.dataBase64, "base64") }) : owner;
};

const readAccounts = async (fetchJson: FeedFetch, rpcUrl: string, keys: string[]): Promise<Result<AccountRead[]>> => {
  const reads: AccountRead[] = [];
  for (let start = 0; start < keys.length; start += MAX_ACCOUNTS_PER_READ) {
    const chunk = keys.slice(start, start + MAX_ACCOUNTS_PER_READ);
    const answer = await attempt(async (): Promise<unknown> => {
      const response = await fetchJson(rpcUrl, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "getMultipleAccounts", params: [chunk, { encoding: "base64", commitment: "processed" }] }),
      });
      return response.json();
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

const openBrowserSocket: OpenFeedSocket = (url, handlers) => {
  const socket = new WebSocket(url);
  socket.onopen = () => handlers.onOpen();
  socket.onmessage = (event: MessageEvent) => {
    if (typeof event.data === "string") handlers.onMessage(event.data);
  };
  socket.onclose = () => handlers.onClose();
  return { send: (text) => socket.send(text), close: () => socket.close() };
};

const fetchWithRpcTimeout: FeedFetch = (url, init) => fetchWithTimeout(url, init, RPC_REQUEST_TIMEOUT_MS);

const readBackoffMs = (attemptIndex: number, baseMs: number, maxMs: number): number => Math.min(maxMs, baseMs * 2 ** attemptIndex);

export const createAccountFeed = (options: AccountFeedOptions): AccountFeed => {
  const pollIntervalMs = options.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS;
  const openSocket = options.openSocket ?? openBrowserSocket;
  const fetchJson = options.fetch ?? fetchWithRpcTimeout;
  const watchers = new Map<string, Watcher>();
  const pendingSubscriptions = new Map<number, Watcher>();
  const subscriptionOwners = new Map<number, Watcher>();
  const pendingReadKeys = new Set<string>();
  let link: FeedLink = { status: "idle" };
  let requestCounter = 0;
  let reconnectAttempts = 0;
  let pollTimer: Interval | null = null;
  let isReading = false;

  const sendRequest = (method: string, params?: unknown[]): number | null => {
    if (link.status !== "live") return null;
    const socket = link.socket;
    requestCounter += 1;
    const requestId = requestCounter;
    const message = params === undefined ? { jsonrpc: "2.0", id: requestId, method } : { jsonrpc: "2.0", id: requestId, method, params };
    return attemptSync(() => socket.send(JSON.stringify(message))).ok ? requestId : null;
  };

  const deliver = (watcher: Watcher, slot: number, value: unknown) => {
    const isStale = slot < watcher.lastSlot && watcher.lastSlot - slot <= SLOT_REGRESSION_SLOTS;
    if (isStale) return;
    const raw = readRawAccount(value);
    if (!raw.ok) {
      console.warn(`[createAccountFeed] ${watcher.key}: ${raw.reason}`);
      return;
    }
    watcher.lastSlot = slot;
    const ownerText = raw.value?.ownerText ?? null;
    const dataBase64 = raw.value?.dataBase64 ?? null;
    if (watcher.lastChange !== null && ownerText === watcher.lastOwnerText && dataBase64 === watcher.lastDataBase64) return;
    const account = raw.value === null ? success(null) : decodeRawAccount(raw.value);
    if (!account.ok) {
      console.warn(`[createAccountFeed] ${watcher.key}: ${account.reason}`);
      return;
    }
    watcher.lastOwnerText = ownerText;
    watcher.lastDataBase64 = dataBase64;
    const change: AccountChange = { address: watcher.address, slot, account: account.value };
    watcher.lastChange = change;
    for (const listener of watcher.listeners) listener(change);
  };

  const readStatus = (): FeedStatus => link.status;

  const deliverReads = (reads: AccountRead[]) => {
    for (const accountRead of reads) {
      const watcher = watchers.get(accountRead.key);
      if (watcher !== undefined) deliver(watcher, accountRead.slot, accountRead.value);
    }
  };

  const drainReads = async (): Promise<void> => {
    if (isReading || pendingReadKeys.size === 0 || readStatus() === "closed") return;
    isReading = true;
    const keys = [...pendingReadKeys];
    pendingReadKeys.clear();
    const read = await readAccounts(fetchJson, options.rpcUrl, keys);
    isReading = false;
    if (readStatus() === "closed") return;
    if (read.ok) deliverReads(read.value);
    else console.warn(`[createAccountFeed] read failed: ${read.reason}`);
    void drainReads();
  };

  const requestRead = (keys: Iterable<string>) => {
    for (const key of keys) if (watchers.has(key)) pendingReadKeys.add(key);
    void drainReads();
  };

  const syncPolling = () => {
    const shouldPoll = link.status === "connecting" || link.status === "polling";
    if (shouldPoll && pollTimer === null) {
      pollTimer = setInterval(() => requestRead(watchers.keys()), pollIntervalMs);
      requestRead(watchers.keys());
    }
    if (!shouldPoll && pollTimer !== null) {
      clearInterval(pollTimer);
      pollTimer = null;
    }
  };

  const forgetSubscriptions = () => {
    pendingSubscriptions.clear();
    subscriptionOwners.clear();
    for (const watcher of watchers.values()) {
      watcher.subscriptionId = null;
      if (watcher.subscribeRetry !== null) clearTimeout(watcher.subscribeRetry);
      watcher.subscribeRetry = null;
    }
  };

  const moveTo = (next: FeedLink) => {
    const previous = link;
    if (previous.status === "live") clearInterval(previous.heartbeat);
    if (previous.status === "polling") clearTimeout(previous.reconnect);
    const isSocketCarried = "socket" in previous && "socket" in next && previous.socket === next.socket;
    if ("socket" in previous && !isSocketCarried) {
      const leftSocket = previous.socket;
      attemptSync(() => leftSocket.close());
      forgetSubscriptions();
    }
    link = next;
    if (previous.status !== next.status) options.onStatus?.(next.status);
    syncPolling();
  };

  const subscribe = (watcher: Watcher) => {
    const requestId = sendRequest("accountSubscribe", [watcher.key, { encoding: "base64", commitment: "processed" }]);
    if (requestId !== null) pendingSubscriptions.set(requestId, watcher);
  };

  const isPendingSubscription = (watcher: Watcher): boolean => [...pendingSubscriptions.values()].includes(watcher);

  const scheduleSubscribeRetry = (watcher: Watcher) => {
    const delayMs = readBackoffMs(watcher.subscribeAttempts, SUBSCRIBE_RETRY_BASE_MS, SUBSCRIBE_RETRY_MAX_MS);
    watcher.subscribeAttempts += 1;
    watcher.subscribeRetry = setTimeout(() => {
      watcher.subscribeRetry = null;
      const isStillWanted = watchers.get(watcher.key) === watcher && watcher.subscriptionId === null && !isPendingSubscription(watcher);
      if (link.status === "live" && isStillWanted) subscribe(watcher);
    }, delayMs);
  };

  const handleAnswer = (requestId: number, result: unknown) => {
    const watcher = pendingSubscriptions.get(requestId);
    if (watcher === undefined) return;
    pendingSubscriptions.delete(requestId);
    const isCurrent = watchers.get(watcher.key) === watcher && watcher.subscriptionId === null;
    if (typeof result !== "number") {
      if (!isCurrent) return;
      console.warn(`[createAccountFeed] accountSubscribe refused for ${watcher.key}, retrying`);
      scheduleSubscribeRetry(watcher);
      requestRead([watcher.key]);
      return;
    }
    if (!isCurrent) {
      sendRequest("accountUnsubscribe", [result]);
      return;
    }
    watcher.subscriptionId = result;
    watcher.subscribeAttempts = 0;
    subscriptionOwners.set(result, watcher);
    requestRead([watcher.key]);
  };

  const handleNotification = (params: unknown) => {
    if (!isRecord(params) || typeof params.subscription !== "number" || !isRecord(params.result)) return;
    const watcher = subscriptionOwners.get(params.subscription);
    const context = params.result.context;
    if (watcher === undefined || watchers.get(watcher.key) !== watcher || !isRecord(context) || typeof context.slot !== "number") return;
    deliver(watcher, context.slot, params.result.value);
  };

  const handleDrop = () => {
    if (link.status === "closed") return;
    const delayMs = readBackoffMs(reconnectAttempts, RECONNECT_BASE_MS, RECONNECT_MAX_MS);
    reconnectAttempts += 1;
    moveTo({ status: "polling", reconnect: setTimeout(connect, delayMs) });
  };

  const checkHeartbeat = () => {
    if (link.status !== "live") return;
    if (performance.now() - link.lastInboundAtMs > HEARTBEAT_MS * SILENT_HEARTBEATS_BEFORE_DROP) {
      console.warn("[createAccountFeed] the socket went silent, falling back to polling");
      handleDrop();
      return;
    }
    if (sendRequest("ping") === null) handleDrop();
  };

  const goLive = (socket: FeedSocket) => {
    if (link.status !== "connecting" || link.socket !== socket) return;
    reconnectAttempts = 0;
    moveTo({ status: "live", socket, heartbeat: setInterval(checkHeartbeat, HEARTBEAT_MS), lastInboundAtMs: performance.now() });
    for (const watcher of watchers.values()) subscribe(watcher);
  };

  const receive = (socket: FeedSocket, text: string) => {
    if (link.status !== "live" || link.socket !== socket) return;
    link.lastInboundAtMs = performance.now();
    const parsed = attemptSync((): unknown => JSON.parse(text));
    if (!parsed.ok || !isRecord(parsed.value)) return;
    const message = parsed.value;
    if (typeof message.id === "number") handleAnswer(message.id, message.result);
    else if (message.method === "accountNotification") handleNotification(message.params);
  };

  const connect = () => {
    if (link.status !== "idle" && link.status !== "polling") return;
    const opened: { socket: FeedSocket | null } = { socket: null };
    const isOpenedSocket = () => opened.socket !== null && "socket" in link && link.socket === opened.socket;
    const created = attemptSync(() =>
      openSocket(options.wsUrl, {
        onOpen: () => {
          if (opened.socket !== null) goLive(opened.socket);
        },
        onMessage: (text) => {
          if (opened.socket !== null) receive(opened.socket, text);
        },
        onClose: () => {
          if (isOpenedSocket()) handleDrop();
        },
      }),
    );
    if (!created.ok) {
      handleDrop();
      return;
    }
    opened.socket = created.value;
    moveTo({ status: "connecting", socket: created.value });
  };

  const unwatchWatcher = (watcher: Watcher) => {
    watchers.delete(watcher.key);
    pendingReadKeys.delete(watcher.key);
    if (watcher.subscribeRetry !== null) clearTimeout(watcher.subscribeRetry);
    watcher.subscribeRetry = null;
    if (watcher.subscriptionId === null) return;
    subscriptionOwners.delete(watcher.subscriptionId);
    sendRequest("accountUnsubscribe", [watcher.subscriptionId]);
    watcher.subscriptionId = null;
  };

  const watch = (address: PublicKey, onChange: ChangeListener) => {
    if (link.status === "closed") return () => undefined;
    const key = address.toBase58();
    const existing = watchers.get(key);
    const watcher: Watcher = existing ?? {
      key,
      address,
      listeners: new Set(),
      subscriptionId: null,
      subscribeAttempts: 0,
      subscribeRetry: null,
      lastSlot: 0,
      lastOwnerText: null,
      lastDataBase64: null,
      lastChange: null,
    };
    watcher.listeners.add(onChange);
    if (existing === undefined) {
      watchers.set(key, watcher);
      if (link.status === "live") subscribe(watcher);
      else requestRead([key]);
    } else if (watcher.lastChange !== null) {
      onChange(watcher.lastChange);
    }
    connect();
    return () => {
      watcher.listeners.delete(onChange);
      if (watcher.listeners.size === 0 && watchers.get(key) === watcher) unwatchWatcher(watcher);
    };
  };

  const close = () => {
    if (link.status === "closed") return;
    for (const watcher of [...watchers.values()]) unwatchWatcher(watcher);
    moveTo({ status: "closed" });
  };

  return { watch, status: () => link.status, close };
};
