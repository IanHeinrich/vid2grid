import type { AbortSignalLike } from "@vid2grid/core";
import { abortError } from "../shared/workerRequest";

// One in-flight job per worker, so replies correlate by worker identity and need no message ids.
interface PoolTask<TRequest, TResponse> {
  request: TRequest;
  transfer: Transferable[];
  resolve: (response: TResponse) => void;
  reject: (error: unknown) => void;
}

export class WorkerPool<TRequest, TResponse> {
  private readonly idle: Worker[] = [];
  private readonly queue: PoolTask<TRequest, TResponse>[] = [];
  private readonly inFlight = new Map<Worker, PoolTask<TRequest, TResponse>>();

  constructor(createWorker: () => Worker, size: number) {
    try {
      for (let i = 0; i < size; i++) this.idle.push(this.adopt(createWorker()));
    } catch (err) {
      this.terminate();
      throw err;
    }
  }

  // An abort drops a task still waiting for a worker; one a worker already has runs on.
  async run(
    request: TRequest,
    transfer: Transferable[] = [],
    signal?: AbortSignalLike,
  ): Promise<TResponse> {
    if (signal?.aborted) throw abortError(signal);
    let drop = (): void => {};
    const response = new Promise<TResponse>((resolve, reject) => {
      const task = { request, transfer, resolve, reject };
      drop = () => {
        if (signal && this.unqueue(task)) reject(abortError(signal));
      };
      this.queue.push(task);
      this.pump();
    });
    signal?.addEventListener("abort", drop);
    try {
      return await response;
    } finally {
      signal?.removeEventListener("abort", drop);
    }
  }

  private unqueue(task: PoolTask<TRequest, TResponse>): boolean {
    const index = this.queue.indexOf(task);
    if (index !== -1) this.queue.splice(index, 1);
    return index !== -1;
  }

  terminate(): void {
    for (const worker of [...this.idle, ...this.inFlight.keys()]) worker.terminate();
    const abandoned = [...this.queue, ...this.inFlight.values()];
    this.idle.length = 0;
    this.queue.length = 0;
    this.inFlight.clear();
    for (const task of abandoned) task.reject(new Error("Worker pool terminated"));
  }

  private adopt(worker: Worker): Worker {
    worker.onmessage = (event: MessageEvent<TResponse>) =>
      this.finish(worker, (task) => task.resolve(event.data));
    worker.onerror = (event) =>
      this.finish(worker, (task) => task.reject(event.error ?? new Error(event.message)));
    return worker;
  }

  private finish(worker: Worker, settle: (task: PoolTask<TRequest, TResponse>) => void): void {
    const task = this.inFlight.get(worker);
    if (!task) return;
    this.inFlight.delete(worker);
    this.idle.push(worker);
    settle(task);
    this.pump();
  }

  private pump(): void {
    for (;;) {
      const worker = this.idle.at(-1);
      const task = this.queue[0];
      if (!worker || !task) return;
      this.idle.pop();
      this.queue.shift();
      this.inFlight.set(worker, task);
      try {
        worker.postMessage(task.request, task.transfer);
      } catch (err) {
        // Nothing reached the worker (a DataCloneError, say), so it is still free.
        this.inFlight.delete(worker);
        this.idle.push(worker);
        task.reject(err);
      }
    }
  }
}
