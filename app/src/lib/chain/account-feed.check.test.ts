import { afterAll, beforeAll, expect, jest, spyOn, test } from "bun:test";
import { PublicKey } from "@solana/web3.js";
import { Buffer } from "buffer";
import { flushMicrotasks } from "../../../tests/fake-time";
import {
  type AccountChange,
  type AccountFeed,
  type FeedFetch,
  type FeedSocketHandlers,
  HEARTBEAT_MS,
  type OpenFeedSocket,
  createAccountFeed,
} from "./account-feed";

type TimerControl = { advanceTimersToNextTimer: () => void; getTimerCount: () => number; clearAllTimers: () => void };

const hasTimerControl = (candidate: object): candidate is TimerControl =>
  "advanceTimersToNextTimer" in candidate &&
  typeof candidate.advanceTimersToNextTimer === "function" &&
  "getTimerCount" in candidate &&
  typeof candidate.getTimerCount === "function" &&
  "clearAllTimers" in candidate &&
  typeof candidate.clearAllTimers === "function";

const readSetting = (name: string, fallback: number): number => {
  const parsed = Number(process.env[name]);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
};

const MAX_SILENT_LIVE_MS = HEARTBEAT_MS * 3;
const FRESHNESS_BOUND_MS = HEARTBEAT_MS * 4;
const MAX_SERVER_ACTIONS_PER_INSTANT = 200;
const FIRST_SLOT = 100;
const SAFETY_DEPTH = readSetting("FEED_CHECK_SAFETY_DEPTH", 6);
const FRESHNESS_DEPTH = readSetting("FEED_CHECK_FRESHNESS_DEPTH", 5);
const RANDOM_WALKS = readSetting("FEED_CHECK_WALKS", 1500);
const WALK_STEPS = 40;
const FIRST_SEED = readSetting("FEED_CHECK_SEED", 1);
const TEST_TIMEOUT_MS = 600_000;
const NO_COUNTEREXAMPLE = "no counterexample";

type AccountName = "table" | "seat";
type ChainValue = number | "missing";
type SeenValue = ChainValue | "nothing";

const ACCOUNT_ADDRESSES: Record<AccountName, PublicKey> = {
  table: new PublicKey(Buffer.alloc(32, 1)),
  seat: new PublicKey(Buffer.alloc(32, 2)),
};
const ACCOUNT_NAMES_BY_KEY = new Map<string, AccountName>([
  [ACCOUNT_ADDRESSES.table.toBase58(), "table"],
  [ACCOUNT_ADDRESSES.seat.toBase58(), "seat"],
]);
const OWNER_TEXT = new PublicKey(Buffer.alloc(32, 9)).toBase58();

type ServerSocket = {
  handlers: FeedSocketHandlers;
  isOpened: boolean;
  isDropped: boolean;
  isClosedByFeed: boolean;
  lastInboundAtMs: number;
  unansweredSubscribes: { requestId: number; name: AccountName }[];
  unansweredPings: number[];
  subscriptions: { subscriptionId: number; name: AccountName; notifiedValue: ChainValue }[];
  nextSubscriptionId: number;
};

type PendingRead = { slot: number; values: unknown[]; answer: (response: Response) => void; fail: (reason: Error) => void };

type Listener = { name: AccountName; lastSeen: SeenValue; isStopped: boolean; stop: () => void };

type WorldState = {
  startedAtMs: number;
  chain: Record<AccountName, ChainValue>;
  slot: number;
  nextMarker: number;
  sockets: ServerSocket[];
  reads: PendingRead[];
  listeners: Listener[];
  isClosedByUser: boolean;
  breaks: string[];
};

type World = WorldState & { feed: AccountFeed };

type FeedEvent =
  | { kind: "watch" | "unwatch" | "change" | "subscribeAcked" | "subscribeRefused" | "notified"; name: AccountName }
  | {
      kind:
        | "close"
        | "socketOpens"
        | "staleSocketOpens"
        | "socketCloses"
        | "staleSocketCloses"
        | "pingsAnswered"
        | "readAnswered"
        | "readFailed"
        | "timerFires";
    };

type Alphabet = { names: AccountName[]; canReadFail: boolean };

type SettleMode = { label: string; socketBehavior: "answers" | "silent" | "refuses" | "withholdsAcks"; isRpcAnswering: boolean };

type Broken = { property: string; detail: string };

type Counterexample = Broken & { path: string[]; alphabet: Alphabet; mode: SettleMode | null };

type Exploration = {
  depth: number;
  exhaustiveAlphabet: Alphabet;
  walkAlphabet: Alphabet;
  walks: number;
  modes: SettleMode[];
};

type ExplorationReport = { counterexample: Counterexample | null; exhaustivePaths: number; walks: number; worstFreshAfterMs: number };

const EVERYTHING_ANSWERS: SettleMode = {
  label: "the socket opens and answers every request, and the RPC node answers every read",
  socketBehavior: "answers",
  isRpcAnswering: true,
};
const SOCKET_SILENT: SettleMode = {
  label: "the socket says nothing (half-open, or never opening), and the RPC node answers every read",
  socketBehavior: "silent",
  isRpcAnswering: true,
};
const SUBSCRIBES_REFUSED: SettleMode = {
  label: "the socket answers pings but refuses every accountSubscribe, and the RPC node answers every read",
  socketBehavior: "refuses",
  isRpcAnswering: true,
};
const NOTHING_WORKS: SettleMode = {
  label: "the socket says nothing and every read fails",
  socketBehavior: "silent",
  isRpcAnswering: false,
};
const SUBSCRIBES_UNANSWERED: SettleMode = {
  label: "the socket answers pings but never answers an accountSubscribe, and the RPC node answers every read",
  socketBehavior: "withholdsAcks",
  isRpcAnswering: true,
};
const SUBSCRIBES_REFUSED_AND_READS_FAIL: SettleMode = {
  label: "the socket answers pings but refuses every accountSubscribe, and every read fails",
  socketBehavior: "refuses",
  isRpcAnswering: false,
};

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null;

const readTimerControl = (): TimerControl | null => (hasTimerControl(jest) ? jest : null);

const readElapsedMs = (world: WorldState): number => Math.round(performance.now() - world.startedAtMs);

const encodeAccount = (value: ChainValue) =>
  value === "missing" ? null : { owner: OWNER_TEXT, data: [Buffer.from([value]).toString("base64"), "base64"] };

const readSeenValue = (change: AccountChange): ChainValue => {
  const marker = change.account?.data[0];
  return marker === undefined ? "missing" : marker;
};

const describeValue = (value: SeenValue): string => (typeof value === "number" ? `marker ${value}` : value);

const readRequestedKeys = (init: RequestInit): string[] => {
  const body: unknown = JSON.parse(String(init.body));
  const [keys] = isRecord(body) && Array.isArray(body.params) ? body.params : [];
  return Array.isArray(keys) ? keys.filter((key) => typeof key === "string") : [];
};

const isServerOpen = (socket: ServerSocket): boolean => socket.isOpened && !socket.isDropped && !socket.isClosedByFeed;

const isActive = (listener: Listener): boolean => !listener.isStopped;

const isWatched = (world: WorldState, name: AccountName): boolean =>
  !world.isClosedByUser && world.listeners.some((listener) => isActive(listener) && listener.name === name);

const hasActiveListener = (world: WorldState): boolean => !world.isClosedByUser && world.listeners.some(isActive);

const receiveOnServer = (world: WorldState, socket: ServerSocket, text: string) => {
  if (world.isClosedByUser) world.breaks.push(`sent ${text} on the socket after close()`);
  if (!isServerOpen(socket)) return;
  const message: unknown = JSON.parse(text);
  if (!isRecord(message) || typeof message.id !== "number") return;
  const params: unknown[] = Array.isArray(message.params) ? message.params : [];
  const [firstParam] = params;
  if (message.method === "ping") socket.unansweredPings.push(message.id);
  if (message.method === "accountUnsubscribe") {
    socket.subscriptions = socket.subscriptions.filter((subscription) => subscription.subscriptionId !== firstParam);
  }
  const name = typeof firstParam === "string" ? ACCOUNT_NAMES_BY_KEY.get(firstParam) : undefined;
  if (message.method === "accountSubscribe" && name !== undefined) socket.unansweredSubscribes.push({ requestId: message.id, name });
};

const createWorld = (timers: TimerControl): World => {
  timers.clearAllTimers();
  const state: WorldState = {
    startedAtMs: performance.now(),
    chain: { table: 1, seat: "missing" },
    slot: FIRST_SLOT,
    nextMarker: 2,
    sockets: [],
    reads: [],
    listeners: [],
    isClosedByUser: false,
    breaks: [],
  };
  const openSocket: OpenFeedSocket = (_url, handlers) => {
    if (state.isClosedByUser) state.breaks.push("opened a socket after close()");
    const socket: ServerSocket = {
      handlers,
      isOpened: false,
      isDropped: false,
      isClosedByFeed: false,
      lastInboundAtMs: performance.now(),
      unansweredSubscribes: [],
      unansweredPings: [],
      subscriptions: [],
      nextSubscriptionId: 1,
    };
    state.sockets.push(socket);
    return {
      send: (text) => receiveOnServer(state, socket, text),
      close: () => {
        socket.isClosedByFeed = true;
        socket.subscriptions = [];
      },
    };
  };
  const fetchAccounts: FeedFetch = (_url, init) => {
    if (state.isClosedByUser) state.breaks.push("started a getMultipleAccounts read after close()");
    const values = readRequestedKeys(init).map((key) => {
      const name = ACCOUNT_NAMES_BY_KEY.get(key);
      return name === undefined ? null : encodeAccount(state.chain[name]);
    });
    const slot = state.slot;
    return new Promise<Response>((resolve, reject) => state.reads.push({ slot, values, answer: resolve, fail: reject }));
  };
  const feed = createAccountFeed({
    rpcUrl: "http://rpc.check",
    wsUrl: "ws://rpc.check",
    openSocket,
    fetch: fetchAccounts,
    onStatus: (status) => {
      if (state.isClosedByUser) state.breaks.push(`reported status ${status} after close()`);
    },
  });
  return Object.assign(state, { feed });
};

const watchAccount = (world: World, name: AccountName) => {
  const listener: Listener = { name, lastSeen: "nothing", isStopped: false, stop: () => undefined };
  world.listeners.push(listener);
  listener.stop = world.feed.watch(ACCOUNT_ADDRESSES[name], (change) => {
    if (listener.isStopped) world.breaks.push(`called a ${name} listener after its stop()`);
    else if (world.isClosedByUser) world.breaks.push(`called a ${name} listener after close()`);
    listener.lastSeen = readSeenValue(change);
  });
};

const sendToFeed = (socket: ServerSocket, message: Record<string, unknown>) => {
  socket.lastInboundAtMs = performance.now();
  socket.handlers.onMessage(JSON.stringify({ jsonrpc: "2.0", ...message }));
};

const readNewestSocket = (world: WorldState): ServerSocket | undefined => world.sockets.at(-1);

const readOpenSocket = (world: WorldState): ServerSocket | undefined => {
  const socket = readNewestSocket(world);
  return socket !== undefined && isServerOpen(socket) ? socket : undefined;
};

const readStaleSockets = (world: WorldState): ServerSocket[] => world.sockets.slice(0, -1);

const findOwedSubscription = (world: WorldState, socket: ServerSocket, name?: AccountName) =>
  socket.subscriptions.find((subscription) => (name === undefined || subscription.name === name) && subscription.notifiedValue !== world.chain[subscription.name]);

const changeAccount = (world: WorldState, name: AccountName) => {
  world.slot += 1;
  if (name === "seat" && world.chain.seat !== "missing") {
    world.chain.seat = "missing";
    return;
  }
  world.chain[name] = world.nextMarker;
  world.nextMarker += 1;
};

const describeEvent = (event: FeedEvent): string => {
  switch (event.kind) {
    case "watch":
      return `watch(${event.name})`;
    case "unwatch":
      return `the newest ${event.name} listener calls its stop()`;
    case "change":
      return event.name === "seat" ? "the seat account is created or closed on chain" : "the table account changes on chain";
    case "subscribeAcked":
      return `the server acks the ${event.name} accountSubscribe`;
    case "subscribeRefused":
      return `the server refuses the ${event.name} accountSubscribe`;
    case "notified":
      return `the server sends a ${event.name} accountNotification`;
    case "close":
      return "close()";
    case "socketOpens":
      return "the socket fires onOpen";
    case "staleSocketOpens":
      return "an old socket fires onOpen";
    case "socketCloses":
      return "the socket fires onClose";
    case "staleSocketCloses":
      return "an old socket fires onClose";
    case "pingsAnswered":
      return "the server answers the pings";
    case "readAnswered":
      return "the getMultipleAccounts read answers";
    case "readFailed":
      return "the getMultipleAccounts read fails";
    case "timerFires":
      return "time runs to the next timer";
  }
};

const listEnabledEvents = (world: World, alphabet: Alphabet, timers: TimerControl): FeedEvent[] => {
  const events: FeedEvent[] = [];
  for (const name of alphabet.names) {
    events.push({ kind: "watch", name });
    if (world.listeners.some((listener) => isActive(listener) && listener.name === name)) events.push({ kind: "unwatch", name });
    events.push({ kind: "change", name });
  }
  if (!world.isClosedByUser) events.push({ kind: "close" });
  const newest = readNewestSocket(world);
  if (newest !== undefined && !newest.isOpened && !newest.isDropped && !newest.isClosedByFeed) events.push({ kind: "socketOpens" });
  if (newest !== undefined && !newest.isDropped) events.push({ kind: "socketCloses" });
  const staleSockets = readStaleSockets(world);
  if (staleSockets.some((socket) => !socket.isOpened && !socket.isDropped)) events.push({ kind: "staleSocketOpens" });
  if (staleSockets.some((socket) => !socket.isDropped)) events.push({ kind: "staleSocketCloses" });
  const openSocket = readOpenSocket(world);
  if (openSocket !== undefined) {
    if (openSocket.unansweredPings.length > 0) events.push({ kind: "pingsAnswered" });
    for (const name of alphabet.names) {
      if (openSocket.unansweredSubscribes.some((request) => request.name === name)) {
        events.push({ kind: "subscribeAcked", name }, { kind: "subscribeRefused", name });
      }
      if (findOwedSubscription(world, openSocket, name) !== undefined) events.push({ kind: "notified", name });
    }
  }
  if (world.reads.length > 0) events.push({ kind: "readAnswered" });
  if (world.reads.length > 0 && alphabet.canReadFail) events.push({ kind: "readFailed" });
  if (timers.getTimerCount() > 0) events.push({ kind: "timerFires" });
  return events;
};

const answerSubscribe = (world: WorldState, name: AccountName, isAcked: boolean) => {
  const socket = readOpenSocket(world);
  const request = socket?.unansweredSubscribes.find((candidate) => candidate.name === name);
  if (socket === undefined || request === undefined) return;
  socket.unansweredSubscribes = socket.unansweredSubscribes.filter((candidate) => candidate !== request);
  if (!isAcked) {
    sendToFeed(socket, { id: request.requestId, error: { code: -32000, message: "subscription refused" } });
    return;
  }
  const subscriptionId = socket.nextSubscriptionId;
  socket.nextSubscriptionId += 1;
  socket.subscriptions.push({ subscriptionId, name, notifiedValue: world.chain[name] });
  sendToFeed(socket, { id: request.requestId, result: subscriptionId });
};

const openSocketOnFeed = (socket: ServerSocket | undefined) => {
  if (socket === undefined) return;
  socket.isOpened = true;
  socket.lastInboundAtMs = performance.now();
  socket.handlers.onOpen();
};

const closeSocketOnFeed = (socket: ServerSocket | undefined) => {
  if (socket === undefined) return;
  socket.isDropped = true;
  socket.subscriptions = [];
  socket.handlers.onClose();
};

const performEvent = (world: World, event: FeedEvent, timers: TimerControl) => {
  switch (event.kind) {
    case "watch":
      return watchAccount(world, event.name);
    case "unwatch": {
      const listener = world.listeners.findLast((candidate) => isActive(candidate) && candidate.name === event.name);
      if (listener === undefined) return;
      listener.isStopped = true;
      return listener.stop();
    }
    case "change":
      return changeAccount(world, event.name);
    case "close":
      world.feed.close();
      world.isClosedByUser = true;
      return;
    case "socketOpens":
      return openSocketOnFeed(readNewestSocket(world));
    case "staleSocketOpens":
      return openSocketOnFeed(readStaleSockets(world).find((socket) => !socket.isOpened && !socket.isDropped));
    case "socketCloses":
      return closeSocketOnFeed(readNewestSocket(world));
    case "staleSocketCloses":
      return closeSocketOnFeed(readStaleSockets(world).find((socket) => !socket.isDropped));
    case "subscribeAcked":
      return answerSubscribe(world, event.name, true);
    case "subscribeRefused":
      return answerSubscribe(world, event.name, false);
    case "pingsAnswered": {
      const socket = readOpenSocket(world);
      if (socket === undefined) return;
      const pingIds = socket.unansweredPings;
      socket.unansweredPings = [];
      for (const pingId of pingIds) sendToFeed(socket, { id: pingId, result: "pong" });
      return;
    }
    case "notified": {
      const socket = readOpenSocket(world);
      const subscription = socket === undefined ? undefined : findOwedSubscription(world, socket, event.name);
      if (socket === undefined || subscription === undefined) return;
      subscription.notifiedValue = world.chain[event.name];
      const result = { context: { slot: world.slot }, value: encodeAccount(world.chain[event.name]) };
      return sendToFeed(socket, { method: "accountNotification", params: { subscription: subscription.subscriptionId, result } });
    }
    case "readAnswered": {
      const read = world.reads.shift();
      return read?.answer(Response.json({ jsonrpc: "2.0", id: 1, result: { context: { slot: read.slot }, value: read.values } }));
    }
    case "readFailed":
      return world.reads.shift()?.fail(new Error("[accountFeedCheck] the RPC node did not answer"));
    case "timerFires":
      return timers.advanceTimersToNextTimer();
  }
};

const applyEvent = async (world: World, event: FeedEvent, timers: TimerControl) => {
  performEvent(world, event, timers);
  await flushMicrotasks();
  await flushMicrotasks();
};

const findLiveBreak = (world: World): Broken | null => {
  if (world.feed.status() !== "live") return null;
  const socket = readNewestSocket(world);
  if (socket === undefined || !isServerOpen(socket)) {
    return { property: "live only while the socket works", detail: "status() is live while its socket is closed or never opened" };
  }
  const silentMs = Math.round(performance.now() - socket.lastInboundAtMs);
  if (silentMs <= MAX_SILENT_LIVE_MS) return null;
  return { property: "live only while the socket works", detail: `status() is live after ${silentMs} ms without a message from the socket` };
};

const findLeakBreak = (world: World): Broken | null => {
  for (const socket of world.sockets.filter(isServerOpen)) {
    for (const name of new Set(socket.subscriptions.map((subscription) => subscription.name))) {
      const held = socket.subscriptions.filter((subscription) => subscription.name === name).map((subscription) => subscription.subscriptionId);
      if (held.length > 1) return { property: "no leaked subscription", detail: `the server holds ${held.length} ${name} subscriptions (${held.join(", ")})` };
      if (!isWatched(world, name)) return { property: "no leaked subscription", detail: `the server still holds ${name} subscription ${held.join(", ")} that nobody watches` };
    }
  }
  return null;
};

const findSafetyBreak = (world: World, timers: TimerControl): Broken | null => {
  const [recorded] = world.breaks;
  if (recorded !== undefined) return { property: "nothing fires after close() or stop()", detail: `the feed ${recorded}` };
  if (world.reads.length > 1) return { property: "one read at a time", detail: `${world.reads.length} getMultipleAccounts reads are in flight at once` };
  if (world.isClosedByUser && timers.getTimerCount() > 0) {
    return { property: "nothing fires after close() or stop()", detail: `${timers.getTimerCount()} timers are still pending after close()` };
  }
  return findLiveBreak(world) ?? findLeakBreak(world);
};

const pickFairEvent = (world: World, mode: SettleMode): FeedEvent | null => {
  const newest = readNewestSocket(world);
  if (newest !== undefined && mode.socketBehavior !== "silent") {
    if (!newest.isOpened && !newest.isDropped && !newest.isClosedByFeed) return { kind: "socketOpens" };
    if (isServerOpen(newest)) {
      if (newest.unansweredPings.length > 0) return { kind: "pingsAnswered" };
      const [request] = newest.unansweredSubscribes;
      if (request !== undefined && mode.socketBehavior === "answers") return { kind: "subscribeAcked", name: request.name };
      if (request !== undefined && mode.socketBehavior === "refuses") return { kind: "subscribeRefused", name: request.name };
      const owed = findOwedSubscription(world, newest);
      if (owed !== undefined) return { kind: "notified", name: owed.name };
    }
  }
  if (world.reads.length > 0) return mode.isRpcAnswering ? { kind: "readAnswered" } : { kind: "readFailed" };
  return null;
};

const listStaleListeners = (world: World): string[] =>
  world.listeners
    .filter((listener) => isActive(listener) && listener.lastSeen !== world.chain[listener.name])
    .map((listener) => `a ${listener.name} listener shows ${describeValue(listener.lastSeen)} while the chain holds ${describeValue(world.chain[listener.name])}`);

type SettleResult = { broken: Broken | null; freshAfterMs: number | null };

const settle = async (world: World, mode: SettleMode, timers: TimerControl): Promise<SettleResult> => {
  const bound = { isReached: false };
  setTimeout(() => {
    bound.isReached = true;
  }, FRESHNESS_BOUND_MS);
  const startedAtMs = performance.now();
  let freshAfterMs: number | null = null;
  for (;;) {
    let serverActions = 0;
    for (let event = pickFairEvent(world, mode); event !== null; event = pickFairEvent(world, mode)) {
      await applyEvent(world, event, timers);
      const broken = findSafetyBreak(world, timers);
      if (broken !== null) return { broken, freshAfterMs };
      serverActions += 1;
      if (serverActions > MAX_SERVER_ACTIONS_PER_INSTANT) {
        return { broken: { property: "no busy loop", detail: `the feed made the server act ${serverActions} times without time passing` }, freshAfterMs };
      }
    }
    const staleListeners = listStaleListeners(world);
    if (staleListeners.length === 0 && freshAfterMs === null) freshAfterMs = Math.round(performance.now() - startedAtMs);
    if (bound.isReached) {
      const isExcused = !mode.isRpcAnswering && world.feed.status() !== "live";
      if (staleListeners.length === 0 || isExcused) return { broken: null, freshAfterMs };
      const detail = `after ${FRESHNESS_BOUND_MS} ms, ${staleListeners.join("; ")}, and status() is ${world.feed.status()}`;
      return { broken: { property: "fresh data, or a status that says the feed is degraded", detail }, freshAfterMs };
    }
    await applyEvent(world, { kind: "timerFires" }, timers);
    const broken = findSafetyBreak(world, timers);
    if (broken !== null) return { broken, freshAfterMs };
  }
};

type PathRun = { world: World; broken: Broken | null; replayedSteps: number } | null;

type Narration = (stepNumber: number, label: string, world: World) => void;

const replayPath = async (alphabet: Alphabet, path: string[], timers: TimerControl, narrate?: Narration): Promise<PathRun> => {
  const world = createWorld(timers);
  for (const [stepIndex, label] of path.entries()) {
    const event = listEnabledEvents(world, alphabet, timers).find((candidate) => describeEvent(candidate) === label);
    if (event === undefined) return null;
    await applyEvent(world, event, timers);
    narrate?.(stepIndex + 1, label, world);
    const broken = findSafetyBreak(world, timers);
    if (broken !== null) return { world, broken, replayedSteps: stepIndex + 1 };
  }
  return { world, broken: null, replayedSteps: path.length };
};

const checkPath = async (alphabet: Alphabet, path: string[], mode: SettleMode | null, timers: TimerControl): Promise<Counterexample | null> => {
  const run = await replayPath(alphabet, path, timers);
  if (run === null) return null;
  if (run.broken !== null) return { ...run.broken, path: path.slice(0, run.replayedSteps), alphabet, mode: null };
  if (mode === null || !hasActiveListener(run.world)) return null;
  const settled = await settle(run.world, mode, timers);
  return settled.broken === null ? null : { ...settled.broken, path, alphabet, mode };
};

const shrinkCounterexample = async (found: Counterexample, timers: TimerControl): Promise<Counterexample> => {
  let shortest = found;
  for (let index = 0; index < shortest.path.length; ) {
    const candidatePath = [...shortest.path.slice(0, index), ...shortest.path.slice(index + 1)];
    const candidate = await checkPath(shortest.alphabet, candidatePath, shortest.mode, timers);
    if (candidate !== null && candidate.property === found.property) shortest = candidate;
    else index += 1;
  }
  return shortest;
};

const createRandom = (seed: number) => {
  let state = seed >>> 0;
  return (): number => {
    state = (state + 0x6d2b79f5) >>> 0;
    let mixed = Math.imul(state ^ (state >>> 15), state | 1);
    mixed ^= mixed + Math.imul(mixed ^ (mixed >>> 7), mixed | 61);
    return ((mixed ^ (mixed >>> 14)) >>> 0) / 4_294_967_296;
  };
};

const exploreExhaustively = async (exploration: Exploration, timers: TimerControl, report: ExplorationReport): Promise<Counterexample | null> => {
  const alphabet = exploration.exhaustiveAlphabet;
  let frontier: string[][] = [[]];
  for (let depth = 0; depth <= exploration.depth && frontier.length > 0; depth += 1) {
    const nextFrontier: string[][] = [];
    for (const path of frontier) {
      const run = await replayPath(alphabet, path, timers);
      if (run === null) continue;
      report.exhaustivePaths += 1;
      if (run.broken !== null) return { ...run.broken, path, alphabet, mode: null };
      const labels = depth < exploration.depth ? listEnabledEvents(run.world, alphabet, timers).map(describeEvent) : [];
      if (hasActiveListener(run.world)) {
        for (const [modeIndex, mode] of exploration.modes.entries()) {
          const world = modeIndex === 0 ? run.world : (await replayPath(alphabet, path, timers))?.world;
          if (world === undefined) continue;
          const settled = await settle(world, mode, timers);
          if (settled.broken !== null) return { ...settled.broken, path, alphabet, mode };
          report.worstFreshAfterMs = Math.max(report.worstFreshAfterMs, settled.freshAfterMs ?? 0);
        }
      }
      for (const label of labels) nextFrontier.push([...path, label]);
    }
    frontier = nextFrontier;
  }
  return null;
};

const walkRandomly = async (exploration: Exploration, timers: TimerControl, report: ExplorationReport): Promise<Counterexample | null> => {
  const alphabet = exploration.walkAlphabet;
  for (let walkIndex = 0; walkIndex < exploration.walks; walkIndex += 1) {
    const random = createRandom(FIRST_SEED * 1_000_003 + walkIndex);
    const pickIndex = (length: number) => Math.floor(random() * length);
    const world = createWorld(timers);
    const path: string[] = [];
    const length = 1 + pickIndex(WALK_STEPS);
    report.walks += 1;
    for (let step = 0; step < length; step += 1) {
      const enabled = listEnabledEvents(world, alphabet, timers);
      const event = enabled[pickIndex(enabled.length)];
      if (event === undefined) break;
      path.push(describeEvent(event));
      await applyEvent(world, event, timers);
      const broken = findSafetyBreak(world, timers);
      if (broken !== null) return shrinkCounterexample({ ...broken, path, alphabet, mode: null }, timers);
    }
    const mode = exploration.modes[pickIndex(exploration.modes.length)];
    if (mode === undefined || !hasActiveListener(world)) continue;
    const settled = await settle(world, mode, timers);
    if (settled.broken !== null) return shrinkCounterexample({ ...settled.broken, path, alphabet, mode }, timers);
    report.worstFreshAfterMs = Math.max(report.worstFreshAfterMs, settled.freshAfterMs ?? 0);
  }
  return null;
};

const explore = async (exploration: Exploration, timers: TimerControl): Promise<ExplorationReport> => {
  const report: ExplorationReport = { counterexample: null, exhaustivePaths: 0, walks: 0, worstFreshAfterMs: 0 };
  report.counterexample = (await exploreExhaustively(exploration, timers, report)) ?? (await walkRandomly(exploration, timers, report));
  return report;
};

const formatCounterexample = async (counterexample: Counterexample, timers: TimerControl): Promise<string> => {
  const lines = [`broken rule: ${counterexample.property}`];
  await replayPath(counterexample.alphabet, counterexample.path, timers, (stepNumber, label, world) =>
    lines.push(`  ${stepNumber}. ${label} (t=${readElapsedMs(world)} ms, status ${world.feed.status()})`),
  );
  if (counterexample.mode !== null) lines.push(`  then, for up to ${FRESHNESS_BOUND_MS} ms: ${counterexample.mode.label}`);
  lines.push(`  result: ${counterexample.detail}`);
  return lines.join("\n");
};

const describeOutcome = async (report: ExplorationReport, timers: TimerControl): Promise<string> =>
  report.counterexample === null ? NO_COUNTEREXAMPLE : formatCounterexample(report.counterexample, timers);

const runCheck = async (checkName: string, exploration: Exploration): Promise<string> => {
  const timers = readTimerControl();
  expect(timers).not.toBeNull();
  if (timers === null) return "fake timers are unavailable";
  const report = await explore(exploration, timers);
  const outcome = await describeOutcome(report, timers);
  const freshness = exploration.modes.length > 0 ? `, worst time to fresh ${report.worstFreshAfterMs} ms` : "";
  console.log(
    `[accountFeedCheck] ${checkName}: ${report.exhaustivePaths} paths up to ${exploration.depth} steps, ${report.walks} random walks of up to ${WALK_STEPS} steps${freshness}: ${outcome}`,
  );
  return outcome;
};

const ONE_ACCOUNT: Alphabet = { names: ["table"], canReadFail: false };
const TWO_ACCOUNTS: Alphabet = { names: ["table", "seat"], canReadFail: false };
const ONE_ACCOUNT_READS_FAIL: Alphabet = { names: ["table"], canReadFail: true };
const TWO_ACCOUNTS_READS_FAIL: Alphabet = { names: ["table", "seat"], canReadFail: true };

let restoreWarnings = () => undefined;

beforeAll(() => {
  jest.useFakeTimers();
  const warnSpy = spyOn(console, "warn").mockImplementation(() => undefined);
  restoreWarnings = () => {
    warnSpy.mockRestore();
  };
});

afterAll(() => {
  restoreWarnings();
  jest.useRealTimers();
});

test(
  "safety: one read at a time, live only while the socket works, no leaked subscription, nothing fires after close() or stop()",
  async () => {
    const outcome = await runCheck("safety", {
      depth: SAFETY_DEPTH,
      exhaustiveAlphabet: ONE_ACCOUNT_READS_FAIL,
      walkAlphabet: TWO_ACCOUNTS_READS_FAIL,
      walks: RANDOM_WALKS,
      modes: [],
    });
    expect(outcome).toBe(NO_COUNTEREXAMPLE);
  },
  TEST_TIMEOUT_MS,
);

test(
  "fresh data: within 20 s of the server and RPC node behaving, every watcher shows the chain, or status() is not live when no read can succeed",
  async () => {
    const outcome = await runCheck("fresh data", {
      depth: FRESHNESS_DEPTH,
      exhaustiveAlphabet: ONE_ACCOUNT,
      walkAlphabet: TWO_ACCOUNTS,
      walks: RANDOM_WALKS,
      modes: [EVERYTHING_ANSWERS, SOCKET_SILENT, SUBSCRIBES_REFUSED, NOTHING_WORKS],
    });
    expect(outcome).toBe(NO_COUNTEREXAMPLE);
  },
  TEST_TIMEOUT_MS,
);

test(
  "a read that fails while the feed is live is retried",
  async () => {
    const outcome = await runCheck("failed read while live", {
      depth: FRESHNESS_DEPTH,
      exhaustiveAlphabet: ONE_ACCOUNT_READS_FAIL,
      walkAlphabet: TWO_ACCOUNTS_READS_FAIL,
      walks: RANDOM_WALKS,
      modes: [EVERYTHING_ANSWERS],
    });
    expect(outcome).toBe(NO_COUNTEREXAMPLE);
  },
  TEST_TIMEOUT_MS,
);

test(
  "an accountSubscribe that never gets an answer is retried, and the account is read meanwhile",
  async () => {
    const outcome = await runCheck("unanswered accountSubscribe", {
      depth: FRESHNESS_DEPTH,
      exhaustiveAlphabet: ONE_ACCOUNT,
      walkAlphabet: TWO_ACCOUNTS,
      walks: RANDOM_WALKS,
      modes: [SUBSCRIBES_UNANSWERED],
    });
    expect(outcome).toBe(NO_COUNTEREXAMPLE);
  },
  TEST_TIMEOUT_MS,
);

test(
  "status() leaves live while every accountSubscribe is refused and every read fails",
  async () => {
    const outcome = await runCheck("refused and unreadable", {
      depth: FRESHNESS_DEPTH,
      exhaustiveAlphabet: ONE_ACCOUNT,
      walkAlphabet: TWO_ACCOUNTS,
      walks: RANDOM_WALKS,
      modes: [SUBSCRIBES_REFUSED_AND_READS_FAIL],
    });
    expect(outcome).toBe(NO_COUNTEREXAMPLE);
  },
  TEST_TIMEOUT_MS,
);
