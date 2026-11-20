import { beforeAll, describe, expect, it, vi } from "vitest";
import { CLAP_SAMPLE_RATE, scoreSoundWindows } from "../src/audio/soundClassification";
import type { SoundScoreRequest } from "../src/audio/soundClassificationWorker";
import { FakeWorker } from "./fakeWorker";

const created: FakeWorker<SoundScoreRequest>[] = [];

function theWorker(): FakeWorker<SoundScoreRequest> {
  const [worker] = created;
  if (!worker) throw new Error("no worker was created");
  return worker;
}

function lastRequest() {
  const entry = theWorker().received.at(-1);
  if (!entry) throw new Error("nothing was posted");
  return entry;
}

beforeAll(() => {
  vi.stubGlobal(
    "Worker",
    class extends FakeWorker<SoundScoreRequest> {
      constructor() {
        super();
        created.push(this);
      }
    },
  );
});

describe("scoreSoundWindows", () => {
  it("resamples each window to CLAP's rate and transfers the copies, not the originals", async () => {
    const window = new Float32Array(16000).fill(0.25);
    const scoring = scoreSoundWindows([window], 16000, [["applause", "clapping"], ["music"]]);

    const { request, transfer } = lastRequest();
    expect(request.payload.labels).toEqual([["applause", "clapping"], ["music"]]);
    expect(request.payload.windows[0]).toHaveLength(CLAP_SAMPLE_RATE);
    expect(transfer).toEqual([request.payload.windows[0]?.buffer]);
    expect(transfer).not.toContain(window.buffer);

    theWorker().reply({ id: request.id, type: "result", result: [[3, 1]] });
    expect(await scoring).toEqual([[3, 1]]);
    expect(window).toHaveLength(16000);
  });

  it("passes model loading progress on and keeps one worker across calls", async () => {
    const onProgress = vi.fn();
    const scoring = scoreSoundWindows([new Float32Array(4)], 48000, [["music"]], { onProgress });
    const { id } = lastRequest().request;

    theWorker().reply({ id, type: "progress", progress: { done: 40, total: 100 } });
    theWorker().reply({ id, type: "result", result: [[0]] });
    await scoring;

    expect(onProgress).toHaveBeenCalledWith({ done: 40, total: 100 });
    expect(created).toHaveLength(1);
  });

  it("stops waiting once aborted", async () => {
    const controller = new AbortController();
    const reason = new Error("stopped");
    const scoring = scoreSoundWindows([new Float32Array(4)], 48000, [["music"]], {
      signal: controller.signal,
    });

    controller.abort(reason);

    await expect(scoring).rejects.toBe(reason);
    expect(theWorker().listenerCount()).toBe(0);
  });
});
