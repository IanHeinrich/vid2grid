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

  run(request: TRequest, transfer: Transferable[] = []): Promise<TResponse> {
    return new Promise<TResponse>((resolve, reject) => {
      this.queue.push({ request, transfer, resolve, reject });
      this.pump();
    });
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
