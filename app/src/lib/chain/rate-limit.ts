export type RateWindow = { startedAtMs: number; count: number };
export type RateRule = { limit: number; windowMs: number };
export type RateLimits = { perIp: RateRule; perWallet: RateRule };
export type RateRequest = { ip: string; wallet: string | null };

export type RateDecision =
  | { isAllowed: true; windows: Map<string, RateWindow> }
  | { isAllowed: false; scope: "ip" | "wallet"; retryAfterMs: number };

const countInWindow = (
  windows: ReadonlyMap<string, RateWindow>,
  key: string,
  nowMs: number,
  rule: RateRule,
): { isAllowed: true; window: RateWindow } | { isAllowed: false; retryAfterMs: number } => {
  const previous = windows.get(key);
  const current = previous === undefined || nowMs - previous.startedAtMs >= rule.windowMs ? { startedAtMs: nowMs, count: 0 } : previous;
  if (current.count >= rule.limit) return { isAllowed: false, retryAfterMs: current.startedAtMs + rule.windowMs - nowMs };
  return { isAllowed: true, window: { startedAtMs: current.startedAtMs, count: current.count + 1 } };
};

export const decideRate = (
  windows: ReadonlyMap<string, RateWindow>,
  request: RateRequest,
  nowMs: number,
  limits: RateLimits,
): RateDecision => {
  const ipKey = `ip:${request.ip}`;
  const ipCount = countInWindow(windows, ipKey, nowMs, limits.perIp);
  if (!ipCount.isAllowed) return { isAllowed: false, scope: "ip", retryAfterMs: ipCount.retryAfterMs };
  const nextWindows = new Map(windows);
  nextWindows.set(ipKey, ipCount.window);
  if (request.wallet === null) return { isAllowed: true, windows: nextWindows };
  const walletKey = `wallet:${request.wallet}`;
  const walletCount = countInWindow(windows, walletKey, nowMs, limits.perWallet);
  if (!walletCount.isAllowed) return { isAllowed: false, scope: "wallet", retryAfterMs: walletCount.retryAfterMs };
  nextWindows.set(walletKey, walletCount.window);
  return { isAllowed: true, windows: nextWindows };
};

export const pruneRateWindows = (windows: ReadonlyMap<string, RateWindow>, nowMs: number, longestWindowMs: number): Map<string, RateWindow> =>
  new Map([...windows].filter(([, window]) => nowMs - window.startedAtMs < longestWindowMs));
