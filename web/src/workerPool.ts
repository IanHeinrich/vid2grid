/**
 * A minimal fixed-size Web Worker pool that load-balances independent jobs
 * across its workers: each worker handles one job at a time, and queued jobs are
 * handed to whichever worker frees up next. Correlation is by worker identity
 * (one in-flight job per worker), so no per-message ids are needed.
 */
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
    for (let i = 0; i < size; i++) {
      const worker = createWorker();
      worker.onmessage = (event: MessageEvent<TResponse>) =>
        this.finish(worker, (task) => task.resolve(event.data));
      worker.onerror = (event) =>
        this.finish(worker, (task) => task.reject(event.error ?? new Error(event.message)));
      this.idle.push(worker);
    }
  }

  run(request: TRequest, transfer: Transferable[] = []): Promise<TResponse> {
    return new Promise<TResponse>((resolve, reject) => {
      this.queue.push({ request, transfer, resolve, reject });
      this.pump();
    });
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
    while (this.idle.length > 0 && this.queue.length > 0) {
      const worker = this.idle.pop()!;
      const task = this.queue.shift()!;
      this.inFlight.set(worker, task);
      worker.postMessage(task.request, task.transfer);
    }
  }
}
