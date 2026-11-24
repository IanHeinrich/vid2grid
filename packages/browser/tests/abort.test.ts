import { describe, expect, it, vi } from "vitest";
import { throwIfAborted, untilAborted } from "../src/capture/abort";

const reason = new Error("stopped");

describe("throwIfAborted", () => {
  it("throws the reason once aborted, and nothing before or without a signal", () => {
    expect(() => throwIfAborted(AbortSignal.abort(reason))).toThrow(reason);
    expect(() => throwIfAborted(new AbortController().signal)).not.toThrow();
    expect(() => throwIfAborted(undefined)).not.toThrow();
  });
});

describe("untilAborted", () => {
  it("settles as the work does when nothing aborts, and stops listening", async () => {
    const { signal } = new AbortController();
    const remove = vi.spyOn(signal, "removeEventListener");

    expect(await untilAborted(Promise.resolve(1), signal)).toBe(1);
    expect(await untilAborted(Promise.resolve(2), undefined)).toBe(2);
    await expect(untilAborted(Promise.reject(new Error("failed")), signal)).rejects.toThrowError(
      "failed",
    );
    expect(remove).toHaveBeenCalledTimes(2);
  });

  it("rejects with the reason on abort, whatever the work does later", async () => {
    const controller = new AbortController();
    let fail: (error: Error) => void = () => {};
    const work = new Promise<never>((_resolve, reject) => {
      fail = reject;
    });
    const waiting = untilAborted(work, controller.signal);

    controller.abort(reason);
    await expect(waiting).rejects.toBe(reason);

    fail(new Error("too late"));
  });

  it("rejects at once when already aborted", async () => {
    await expect(
      untilAborted(new Promise(() => undefined), AbortSignal.abort(reason)),
    ).rejects.toBe(reason);
  });
});
