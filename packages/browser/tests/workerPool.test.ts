import { describe, expect, it } from "vitest";
import { WorkerPool } from "../src/render/workerPool";

class FakeWorker {
  onmessage: ((event: MessageEvent<string>) => void) | null = null;
  onerror: ((event: ErrorEvent) => void) | null = null;
  readonly received: { message: string; transfer: Transferable[] | undefined }[] = [];

  postMessage(message: string, transfer?: Transferable[]): void {
    this.received.push({ message, transfer });
  }

  reply(data: string): void {
    this.onmessage?.({ data } as MessageEvent<string>);
  }

  fail(message: string, error?: Error): void {
    this.onerror?.({ message, error } as ErrorEvent);
  }
}

function createPool(size: number) {
  const workers: FakeWorker[] = [];
  const pool = new WorkerPool<string, string>(() => {
    const worker = new FakeWorker();
    workers.push(worker);
    return worker as unknown as Worker;
  }, size);
  return { pool, workers };
}

const dispatched = (workers: FakeWorker[]) => workers.flatMap((worker) => worker.received);

describe("WorkerPool dispatch", () => {
  it("creates one worker per slot up front", () => {
    expect(createPool(3).workers).toHaveLength(3);
  });

  it("hands each request to a different worker while some are idle", () => {
    const { pool, workers } = createPool(2);

    void pool.run("a");
    void pool.run("b");

    expect(workers.map((worker) => worker.received.map((r) => r.message))).toEqual([["b"], ["a"]]);
  });

  it("queues work beyond the pool size until a worker frees up", async () => {
    const { pool, workers } = createPool(1);
    const [worker] = workers;

    const first = pool.run("a");
    const second = pool.run("b");
    expect(dispatched(workers).map((r) => r.message)).toEqual(["a"]);

    worker?.reply("done a");
    expect(await first).toBe("done a");
    expect(dispatched(workers).map((r) => r.message)).toEqual(["a", "b"]);

    worker?.reply("done b");
    expect(await second).toBe("done b");
  });

  it("serves queued requests in the order they were submitted", () => {
    const { pool, workers } = createPool(1);
    const [worker] = workers;

    void pool.run("a");
    void pool.run("b");
    void pool.run("c");
    worker?.reply("");
    worker?.reply("");

    expect(dispatched(workers).map((r) => r.message)).toEqual(["a", "b", "c"]);
  });

  it("reuses a worker that has gone idle", async () => {
    const { pool, workers } = createPool(2);

    const first = pool.run("a");
    workers[1]?.reply("done");
    await first;
    void pool.run("b");

    expect(workers[1]?.received.map((r) => r.message)).toEqual(["a", "b"]);
    expect(workers[0]?.received).toEqual([]);
  });

  it("passes the transfer list along with the request", () => {
    const { pool, workers } = createPool(1);
    const buffer = new ArrayBuffer(8);

    void pool.run("a", [buffer]);

    expect(workers[0]?.received[0]?.transfer).toEqual([buffer]);
  });
});

describe("WorkerPool failures", () => {
  it("rejects with the worker's error and keeps serving the queue", async () => {
    const { pool, workers } = createPool(1);
    const [worker] = workers;
    const boom = new Error("boom");

    const failing = pool.run("a");
    const next = pool.run("b");
    worker?.fail("boom", boom);

    await expect(failing).rejects.toBe(boom);
    expect(dispatched(workers).map((r) => r.message)).toEqual(["a", "b"]);

    worker?.reply("done b");
    expect(await next).toBe("done b");
  });

  it("wraps an error event that carries no error object", async () => {
    const { pool, workers } = createPool(1);

    const failing = pool.run("a");
    workers[0]?.fail("script failed");

    await expect(failing).rejects.toThrowError("script failed");
  });

  it("ignores a stray reply from a worker with nothing in flight", () => {
    const { pool, workers } = createPool(1);

    workers[0]?.reply("unexpected");
    void pool.run("a");

    expect(workers[0]?.received.map((r) => r.message)).toEqual(["a"]);
  });
});
