function untilAborted(signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal.aborted) resolve();
    else signal.addEventListener("abort", () => resolve(), { once: true });
  });
}

// Settles with the fallback once the signal aborts, leaving work that cannot be cancelled behind.
export function orWhenAborted<T, F>(
  work: Promise<T>,
  signal: AbortSignal,
  fallback: F,
): Promise<T | F> {
  return Promise.race([work, untilAborted(signal).then(() => fallback)]);
}

// Rejects with the signal's reason once it aborts, so the caller need not wait for the work.
export function abortable<T>(work: Promise<T>, signal: AbortSignal | undefined): Promise<T> {
  if (!signal) return work;
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => reject(signal.reason as Error);
    if (signal.aborted) onAbort();
    signal.addEventListener("abort", onAbort, { once: true });
    void work.then(resolve, reject).finally(() => signal.removeEventListener("abort", onAbort));
  });
}

export function isAbortError(error: unknown): boolean {
  return (
    typeof error === "object" && error !== null && "name" in error && error.name === "AbortError"
  );
}
