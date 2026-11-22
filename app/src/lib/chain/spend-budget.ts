export type SpendRule = { windowMs: number; limitLamports: number };
export type BalanceReading = { lamports: number; readAtMs: number };
type SpendDecision = { isAllowed: true } | { isAllowed: false; retryAfterMs: number };

type SpendWindow = { startedAtMs: number; startLamports: number };

export type SpendBudget = { decide: (balance: BalanceReading, nowMs: number) => SpendDecision };

export const createSpendBudget = (rules: readonly SpendRule[], reservedLamportsPerTransaction: number): SpendBudget => {
  const windows = new Map<SpendRule, SpendWindow>();
  let reservedLamports = 0;
  let reservedSinceReadAtMs: number | null = null;

  const decide = (balance: BalanceReading, nowMs: number): SpendDecision => {
    if (reservedSinceReadAtMs !== balance.readAtMs) {
      reservedSinceReadAtMs = balance.readAtMs;
      reservedLamports = 0;
    }
    for (const rule of rules) {
      const previous = windows.get(rule);
      const isExpired = previous === undefined || nowMs - previous.startedAtMs >= rule.windowMs;
      const window = isExpired ? { startedAtMs: nowMs, startLamports: balance.lamports } : previous;
      const toppedUp = balance.lamports > window.startLamports ? { ...window, startLamports: balance.lamports } : window;
      windows.set(rule, toppedUp);
      const spentLamports = toppedUp.startLamports - balance.lamports + reservedLamports + reservedLamportsPerTransaction;
      if (spentLamports > rule.limitLamports) return { isAllowed: false, retryAfterMs: toppedUp.startedAtMs + rule.windowMs - nowMs };
    }
    reservedLamports += reservedLamportsPerTransaction;
    return { isAllowed: true };
  };

  return { decide };
};
