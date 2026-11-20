import type { AbortSignalLike } from "@vid2grid/core";

export interface WorkerRequest<TPayload> {
  id: number;
  payload: TPayload;
}

export type WorkerReply<TProgress, TResult> =
  | { id: number; type: "progress"; progress: TProgress }
  | { id: number; type: "result"; result: TResult }
  | { id: number; type: "error"; message: string };

export interface WorkerRequestOptions<TProgress> {
  onProgress?: ((progress: TProgress) => void) | undefined;
  signal?: AbortSignalLike | undefined;
}

let lastRequestId = 0;

export function abortError(signal: AbortSignalLike): Error {
  return signal.reason instanceof Error
    ? signal.reason
    : new DOMException("The request was aborted.", "AbortError");
}

// Each request carries an id that every reply echoes, so overlapping callers of one shared
// worker never take each other's results. An aborted request's late reply is ignored.
export function requestFromWorker<TPayload, TProgress, TResult>(
  worker: Worker,
  payload: TPayload,
  transfer: Transferable[],
  options: WorkerRequestOptions<TProgress> = {},
): Promise<TResult> {
  const { onProgress, signal } = options;
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(abortError(signal));
      return;
    }
    const id = ++lastRequestId;

    const handleMessage = (event: MessageEvent<WorkerReply<TProgress, TResult>>) => {
      const reply = event.data;
      if (reply.id !== id) return;
      if (reply.type === "progress") {
        onProgress?.(reply.progress);
        return;
      }
      cleanup();
      if (reply.type === "error") reject(new Error(reply.message));
      else resolve(reply.result);
    };
    const handleError = (event: ErrorEvent) => {
      cleanup();
      reject(event.error instanceof Error ? event.error : new Error(event.message));
    };
    const handleAbort = () => {
      cleanup();
      if (signal) reject(abortError(signal));
    };
    function cleanup(): void {
      worker.removeEventListener("message", handleMessage);
      worker.removeEventListener("error", handleError);
      signal?.removeEventListener("abort", handleAbort);
    }

    worker.addEventListener("message", handleMessage);
    worker.addEventListener("error", handleError);
    signal?.addEventListener("abort", handleAbort);
    const request: WorkerRequest<TPayload> = { id, payload };
    worker.postMessage(request, transfer);
  });
}
