import type { AbortSignalLike } from "@vid2grid/core";
import { abortError } from "../shared/workerRequest";

export function throwIfAborted(signal: AbortSignalLike | undefined): void {
  if (signal?.aborted) throw abortError(signal);
}

// Stops waiting on abort for work that cannot be stopped, whose late failure is then ignored.
export async function untilAborted<T>(
  work: Promise<T>,
  signal: AbortSignalLike | undefined,
): Promise<T> {
  if (!signal) return work;
  let stopListening = (): void => {};
  const aborted = new Promise<never>((_resolve, reject) => {
    const onAbort = (): void => reject(abortError(signal));
    if (signal.aborted) onAbort();
    signal.addEventListener("abort", onAbort);
    stopListening = () => signal.removeEventListener("abort", onAbort);
  });
  try {
    return await Promise.race([work, aborted]);
  } finally {
    stopListening();
  }
}
