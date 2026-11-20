import { afterEach, describe, expect, it, vi } from "vitest";
import { serveWorkerRequests } from "../src/shared/serveWorkerRequests";
import type { WorkerReply, WorkerRequest } from "../src/shared/workerRequest";

type Reply = WorkerReply<string, string>;

function stubScope() {
  const scope = {
    onmessage: null as ((event: { data: WorkerRequest<string> }) => void) | null,
    posted: [] as Reply[],
    postMessage(message: Reply) {
      scope.posted.push(message);
    },
    send(id: number, payload: string) {
      scope.onmessage?.({ data: { id, payload } });
    },
  };
  vi.stubGlobal("self", scope);
  return scope;
}

// Lets every queued job and its replies run.
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("serveWorkerRequests", () => {
  it("runs requests one at a time and tags each reply with its request's id", async () => {
    const scope = stubScope();
    const started: string[] = [];
    let finishFirst = (): void => {};
    serveWorkerRequests<string, string, string>((payload) => {
      started.push(payload);
      if (payload !== "a") return Promise.resolve(`did ${payload}`);
      return new Promise((resolve) => {
        finishFirst = () => resolve("did a");
      });
    });

    scope.send(1, "a");
    scope.send(2, "b");
    await settle();
    expect(started).toEqual(["a"]);

    finishFirst();
    await settle();
    expect(started).toEqual(["a", "b"]);
    expect(scope.posted).toEqual([
      { id: 1, type: "result", result: "did a" },
      { id: 2, type: "result", result: "did b" },
    ]);
  });

  it("reports progress against the running request and errors against their own", async () => {
    const scope = stubScope();
    const reportProgress = serveWorkerRequests<string, string, string>((payload) => {
      reportProgress(`working on ${payload}`);
      return Promise.reject(new Error(`could not do ${payload}`));
    });
    reportProgress("before any request");

    scope.send(7, "a");
    await settle();

    expect(scope.posted).toEqual([
      { id: 7, type: "progress", progress: "working on a" },
      { id: 7, type: "error", message: "could not do a" },
    ]);
  });
});
