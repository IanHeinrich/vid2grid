import { errorMessage } from "./errors";
import type { WorkerReply, WorkerRequest } from "./workerRequest";
import { getWorkerScope } from "./workerScope";

// Requests run one at a time, since a model's inference is a single sequential job. The
// returned function reports progress against whichever request is running.
export function serveWorkerRequests<TPayload, TProgress, TResult>(
  handle: (payload: TPayload) => Promise<TResult>,
): (progress: TProgress) => void {
  const scope = getWorkerScope<WorkerRequest<TPayload>, WorkerReply<TProgress, TResult>>();
  let activeId: number | null = null;
  let queue = Promise.resolve();

  scope.onmessage = (event) => {
    const { id, payload } = event.data;
    queue = queue.then(async () => {
      activeId = id;
      try {
        scope.postMessage({ id, type: "result", result: await handle(payload) });
      } catch (err) {
        scope.postMessage({ id, type: "error", message: errorMessage(err) });
      }
    });
  };

  return (progress) => {
    if (activeId !== null) scope.postMessage({ id: activeId, type: "progress", progress });
  };
}
