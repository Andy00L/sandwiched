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

export const pollUntil = async <Value>(
  label: string,
  probe: () => Promise<Value | null>,
  timeoutMs: number,
  intervalMs: number,
): Promise<Result<Value>> => {
  const startedAt = performance.now();
  while (performance.now() - startedAt < timeoutMs) {
    const probed = await attempt(probe);
    if (probed.ok && probed.value !== null) return success(probed.value);
    await sleep(intervalMs);
  }
  return failure(`[pollUntil] ${label} not observed within ${timeoutMs} ms`);
};
