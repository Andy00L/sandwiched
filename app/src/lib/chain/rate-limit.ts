type RateWindow = { startedAtMs: number; count: number };
type RateRule = { limit: number; windowMs: number };
export type RateLimits = { perIp: RateRule; perWallet: RateRule };
export type RateRequest = { ip: string; wallet: string | null };

export type RateDecision = { isAllowed: true } | { isAllowed: false; scope: "ip" | "wallet" | "limiter"; retryAfterMs: number };

export type RateLimiter = { decide: (request: RateRequest, nowMs: number) => RateDecision; countEntries: () => number };

type WindowCount = { isAllowed: true; window: RateWindow } | { isAllowed: false; retryAfterMs: number };

const countInWindow = (previous: RateWindow | undefined, nowMs: number, rule: RateRule): WindowCount => {
  const current = previous === undefined || nowMs - previous.startedAtMs >= rule.windowMs ? { startedAtMs: nowMs, count: 0 } : previous;
  if (current.count >= rule.limit) return { isAllowed: false, retryAfterMs: current.startedAtMs + rule.windowMs - nowMs };
  return { isAllowed: true, window: { startedAtMs: current.startedAtMs, count: current.count + 1 } };
};

export const createRateLimiter = (limits: RateLimits, maxEntries: number): RateLimiter => {
  const windows = new Map<string, RateWindow>();
  const longestWindowMs = Math.max(limits.perIp.windowMs, limits.perWallet.windowMs);

  const makeRoom = (nowMs: number, incomingCount: number) => {
    if (windows.size + incomingCount <= maxEntries) return;
    for (const [key, window] of windows) {
      if (nowMs - window.startedAtMs >= longestWindowMs) windows.delete(key);
    }
    for (const key of windows.keys()) {
      if (windows.size + incomingCount <= maxEntries) return;
      windows.delete(key);
    }
  };

  const decide = (request: RateRequest, nowMs: number): RateDecision => {
    const ipKey = `ip:${request.ip}`;
    const ipCount = countInWindow(windows.get(ipKey), nowMs, limits.perIp);
    if (!ipCount.isAllowed) return { isAllowed: false, scope: "ip", retryAfterMs: ipCount.retryAfterMs };
    const walletKey = request.wallet === null ? null : `wallet:${request.wallet}`;
    const walletCount = walletKey === null ? null : countInWindow(windows.get(walletKey), nowMs, limits.perWallet);
    if (walletCount !== null && !walletCount.isAllowed) return { isAllowed: false, scope: "wallet", retryAfterMs: walletCount.retryAfterMs };
    const incomingKeys = [ipKey, walletKey].filter((key) => key !== null && !windows.has(key));
    makeRoom(nowMs, incomingKeys.length);
    windows.set(ipKey, ipCount.window);
    if (walletKey !== null && walletCount !== null) windows.set(walletKey, walletCount.window);
    return { isAllowed: true };
  };

  return { decide, countEntries: () => windows.size };
};
