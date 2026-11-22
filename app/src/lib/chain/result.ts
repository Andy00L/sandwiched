export type Failure = { ok: false; reason: string };

export type Result<Value> = { ok: true; value: Value } | Failure;

export const success = <Value>(value: Value): Result<Value> => ({ ok: true, value });

export const failure = (reason: string): Failure => ({ ok: false, reason });

const describeError = (error: unknown): string => {
  if (error instanceof Error) {
    const logs = "logs" in error && Array.isArray(error.logs) ? ` | logs: ${error.logs.slice(-6).join(" / ")}` : "";
    return `${error.name}: ${error.message}${logs}`;
  }
  return typeof error === "string" ? error : JSON.stringify(error);
};

export const attempt = async <Value>(operation: () => Promise<Value>): Promise<Result<Value>> => {
  try {
    return success(await operation());
  } catch (error) {
    return failure(describeError(error));
  }
};

export const attemptSync = <Value>(operation: () => Value): Result<Value> => {
  try {
    return success(operation());
  } catch (error) {
    return failure(describeError(error));
  }
};

export const sleep = (milliseconds: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, milliseconds));

export const raceDeadline = <Value>(pending: Promise<Result<Value>>, timeoutMs: number, label: string): Promise<Result<Value>> => {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const expired = new Promise<Result<Value>>((resolve) => {
    timer = setTimeout(() => resolve(failure(`[raceDeadline] ${label} took longer than ${Math.round(timeoutMs)} ms`)), Math.max(0, timeoutMs));
  });
  return Promise.race([pending, expired]).finally(() => clearTimeout(timer));
};

export const pollUntil = async <Value>(
  label: string,
  probe: () => Promise<Value | null>,
  timeoutMs: number,
  intervalMs: number,
): Promise<Result<Value>> => {
  const deadlineMs = performance.now() + timeoutMs;
  const readRemainingMs = () => deadlineMs - performance.now();
  while (readRemainingMs() > 0) {
    const probed = await raceDeadline(attempt(probe), readRemainingMs(), label);
    if (probed.ok && probed.value !== null) return success(probed.value);
    if (readRemainingMs() <= 0) break;
    await sleep(Math.min(intervalMs, readRemainingMs()));
  }
  return failure(`[pollUntil] ${label} not observed within ${timeoutMs} ms`);
};
