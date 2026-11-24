import type { AbortSignalLike } from "@vid2grid/core";

// The signal's own reason is thrown as given, so a caller sees the AbortError it expects.
function abortReason(signal: AbortSignalLike): unknown {
  return signal.reason ?? new Error("Frame capture was aborted.");
}

export function throwIfAborted(signal: AbortSignalLike | undefined): void {
  if (signal?.aborted) throw abortReason(signal);
}

// Returns what stops listening.
export function onAbort(
  signal: AbortSignalLike | undefined,
  stop: (reason: unknown) => void,
): () => void {
  if (!signal) return () => undefined;
  const listener = (): void => stop(abortReason(signal));
  signal.addEventListener("abort", listener);
  return () => signal.removeEventListener("abort", listener);
}
