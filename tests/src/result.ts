export type Result<T> = { ok: true; value: T } | { ok: false; reason: string };

export const success = <T>(value: T): Result<T> => ({ ok: true, value });

export const failure = <T>(reason: string): Result<T> => ({ ok: false, reason });

const describeError = (error: unknown): string => {
  if (error instanceof Error) {
    const logs = "logs" in error && Array.isArray(error.logs) ? ` | logs: ${error.logs.slice(-6).join(" / ")}` : "";
    return `${error.name}: ${error.message}${logs}`;
  }
  return typeof error === "string" ? error : JSON.stringify(error);
};

export const attempt = async <T>(operation: () => Promise<T>): Promise<Result<T>> => {
  try {
    return success(await operation());
  } catch (error) {
    return failure(describeError(error));
  }
};

export const sleep = (milliseconds: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, milliseconds));

export const pollUntil = async <T>(
  label: string,
  probe: () => Promise<T | null>,
  timeoutMs: number,
  intervalMs: number,
): Promise<Result<T>> => {
  const startedAt = performance.now();
  while (performance.now() - startedAt < timeoutMs) {
    const probed = await attempt(probe);
    if (probed.ok && probed.value !== null) return success(probed.value);
    await sleep(intervalMs);
  }
  return failure(`[pollUntil] ${label} not observed within ${timeoutMs} ms`);
};

type Distribution = { count: number; p50: number; p95: number; p99: number; max: number };

const percentileOfSorted = (sortedValues: number[], fraction: number): number => {
  if (sortedValues.length === 0) return Number.NaN;
  const rank = Math.min(sortedValues.length - 1, Math.ceil(fraction * sortedValues.length) - 1);
  return sortedValues[Math.max(0, rank)] ?? Number.NaN;
};

const roundToTenth = (value: number): number => Math.round(value * 10) / 10;

export const summarize = (values: number[]): Distribution => {
  const sortedValues = [...values].sort((left, right) => left - right);
  return {
    count: sortedValues.length,
    p50: roundToTenth(percentileOfSorted(sortedValues, 0.5)),
    p95: roundToTenth(percentileOfSorted(sortedValues, 0.95)),
    p99: roundToTenth(percentileOfSorted(sortedValues, 0.99)),
    max: roundToTenth(sortedValues[sortedValues.length - 1] ?? Number.NaN),
  };
};
