import { describe, expect, it, vi } from "vitest";
import { requestFromWorker } from "../src/shared/workerRequest";
import { FakeWorker } from "./fakeWorker";

function setUp() {
  const fake = new FakeWorker<string>();
  const request = (payload: string, options = {}) =>
    requestFromWorker<string, number, string>(fake as unknown as Worker, payload, [], options);
  return { fake, request };
}

describe("requestFromWorker", () => {
  it("gives overlapping requests their own results, whatever order the replies come in", async () => {
    const { fake, request } = setUp();
    const first = request("a");
    const second = request("b");

    fake.reply({ id: fake.idOf(1), type: "result", result: "for b" });
    fake.reply({ id: fake.idOf(0), type: "result", result: "for a" });

    expect(await first).toBe("for a");
    expect(await second).toBe("for b");
    expect(fake.idOf(0)).not.toBe(fake.idOf(1));
    expect(fake.listenerCount()).toBe(0);
  });

  it("sends progress only to the request it belongs to", async () => {
    const { fake, request } = setUp();
    const firstProgress = vi.fn();
    const secondProgress = vi.fn();
    const first = request("a", { onProgress: firstProgress });
    const second = request("b", { onProgress: secondProgress });

    fake.reply({ id: fake.idOf(1), type: "progress", progress: 40 });
    fake.reply({ id: fake.idOf(0), type: "error", message: "model failed to load" });
    fake.reply({ id: fake.idOf(1), type: "result", result: "done" });

    await expect(first).rejects.toThrow("model failed to load");
    expect(await second).toBe("done");
    expect(firstProgress).not.toHaveBeenCalled();
    expect(secondProgress).toHaveBeenCalledWith(40);
  });

  it("posts the payload under its id with the transfer list", () => {
    const fake = new FakeWorker<Float32Array>();
    const samples = new Float32Array(4);

    void requestFromWorker(fake as unknown as Worker, samples, [samples.buffer]);

    expect(fake.received[0]?.request.payload).toBe(samples);
    expect(fake.received[0]?.transfer).toEqual([samples.buffer]);
  });
});

describe("requestFromWorker abort", () => {
  it("rejects at once on abort and ignores the late reply", async () => {
    const { fake, request } = setUp();
    const controller = new AbortController();
    const reason = new Error("stopped");
    const pending = request("a", { signal: controller.signal });

    controller.abort(reason);
    fake.reply({ id: fake.idOf(0), type: "result", result: "too late" });

    await expect(pending).rejects.toBe(reason);
    expect(fake.listenerCount()).toBe(0);
  });

  it("gives an abort without an Error reason an AbortError", async () => {
    const { request } = setUp();
    const controller = new AbortController();
    const pending = request("a", { signal: controller.signal });

    controller.abort("stop");

    await expect(pending).rejects.toMatchObject({ name: "AbortError" });
  });

  it("never posts a request that is already aborted", async () => {
    const { fake, request } = setUp();
    const controller = new AbortController();
    controller.abort(new Error("stopped"));

    await expect(request("a", { signal: controller.signal })).rejects.toThrow("stopped");
    expect(fake.received).toHaveLength(0);
  });
});

describe("requestFromWorker failures", () => {
  it("rejects every pending request when the worker itself fails", async () => {
    const { fake, request } = setUp();
    const crash = new Error("worker crashed");
    const first = request("a");
    const second = request("b");

    fake.emit("error", { message: "worker crashed", error: crash });
    await expect(first).rejects.toBe(crash);
    await expect(second).rejects.toBe(crash);

    const third = request("c");
    fake.emit("error", { message: "script error" });
    await expect(third).rejects.toThrow("script error");
  });
});
