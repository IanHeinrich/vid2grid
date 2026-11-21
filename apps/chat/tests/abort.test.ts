import { describe, expect, it } from "vitest";
import { abortable, isAbortError, orWhenAborted } from "../src/abort";

const never = new Promise<string>(() => {});

describe("orWhenAborted", () => {
  it("settles with the work when it finishes first", async () => {
    const controller = new AbortController();
    await expect(
      orWhenAborted(Promise.resolve("done"), controller.signal, "stopped"),
    ).resolves.toBe("done");
  });

  it("settles with the fallback once the signal aborts, without waiting for the work", async () => {
    const controller = new AbortController();
    const raced = orWhenAborted(never, controller.signal, "stopped");
    controller.abort();
    await expect(raced).resolves.toBe("stopped");
  });

  it("settles with the fallback at once when already aborted", async () => {
    await expect(orWhenAborted(never, AbortSignal.abort(), undefined)).resolves.toBeUndefined();
  });
});

describe("abortable", () => {
  it("passes the work through without a signal", async () => {
    await expect(abortable(Promise.resolve(1), undefined)).resolves.toBe(1);
  });

  it("rejects with an AbortError once the signal aborts", async () => {
    const controller = new AbortController();
    const work = abortable(never, controller.signal);
    controller.abort();
    const error: unknown = await work.catch((reason: unknown) => reason);
    expect(isAbortError(error)).toBe(true);
  });

  it("keeps the work's own result or failure when it settles first", async () => {
    const { signal } = new AbortController();
    await expect(abortable(Promise.resolve("ok"), signal)).resolves.toBe("ok");
    await expect(abortable(Promise.reject(new Error("broke")), signal)).rejects.toThrow("broke");
  });
});

describe("isAbortError", () => {
  it("knows an abort from other failures", () => {
    expect(isAbortError(new DOMException("stopped", "AbortError"))).toBe(true);
    expect(isAbortError(new Error("broke"))).toBe(false);
    expect(isAbortError("AbortError")).toBe(false);
  });
});
