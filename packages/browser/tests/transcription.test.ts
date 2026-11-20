import { beforeAll, describe, expect, it, vi } from "vitest";
import { transcribeAudio, transcribeInPieces } from "../src/transcribe/transcription";
import type { TranscribeRequest } from "../src/transcribe/transcriptionWorker";
import { FakeWorker } from "./fakeWorker";

const created: FakeWorker<TranscribeRequest>[] = [];

function theWorker(): FakeWorker<TranscribeRequest> {
  const [worker] = created;
  if (!worker) throw new Error("no worker was created");
  return worker;
}

beforeAll(() => {
  vi.stubGlobal(
    "Worker",
    class extends FakeWorker<TranscribeRequest> {
      constructor() {
        super();
        created.push(this);
      }
    },
  );
});

describe("transcribeAudio", () => {
  it("transfers the samples and puts the cues on the video's timeline", async () => {
    const samples = new Float32Array(16000);
    const onProgress = vi.fn();
    const transcribing = transcribeAudio(samples, 10, onProgress);
    const id = theWorker().idOf(0);

    theWorker().reply({ id, type: "progress", progress: { stage: "model", done: 30, total: 100 } });
    theWorker().reply({
      id,
      type: "result",
      result: [{ start: 1, end: null, text: " hello there " }],
    });

    expect(await transcribing).toEqual([{ start: 11, end: 11, text: "hello there" }]);
    expect(theWorker().received[0]?.request.payload).toEqual({ samples, timestamps: true });
    expect(theWorker().received[0]?.request.payload.samples).toBe(samples);
    expect(theWorker().received[0]?.transfer).toEqual([samples.buffer]);
    expect(onProgress).toHaveBeenCalledWith({ stage: "model", done: 30, total: 100 });
  });

  it("keeps two overlapping transcriptions apart on the one worker", async () => {
    const first = transcribeAudio(new Float32Array(4), 0);
    const second = transcribeAudio(new Float32Array(4), 100);
    const [firstId, secondId] = [theWorker().idOf(1), theWorker().idOf(2)];

    theWorker().reply({ id: secondId, type: "result", result: [{ start: 0, end: 1, text: "b" }] });
    theWorker().reply({ id: firstId, type: "result", result: [{ start: 0, end: 1, text: "a" }] });

    expect((await first)[0]?.text).toBe("a");
    expect((await second)[0]).toEqual({ start: 100, end: 101, text: "b" });
    expect(created).toHaveLength(1);
  });

  it("stops waiting once aborted", async () => {
    const controller = new AbortController();
    const reason = new Error("stopped");
    const transcribing = transcribeAudio(new Float32Array(4), 0, undefined, controller.signal);

    controller.abort(reason);

    await expect(transcribing).rejects.toBe(reason);
  });
});

const RATE = 100;

function speech(seconds: number): Float32Array {
  return new Float32Array(seconds * RATE).fill(0.1);
}

async function nextRequest(count: number) {
  await vi.waitFor(() => expect(theWorker().received.length).toBe(count));
  const entry = theWorker().received.at(-1);
  if (!entry) throw new Error("nothing was posted");
  return entry;
}

describe("transcribeInPieces", () => {
  it("asks for each five second piece without timestamps and stamps its cue", async () => {
    const samples = speech(12);
    const onProgress = vi.fn();
    const before = theWorker().received.length;
    const transcribing = transcribeInPieces(samples, RATE, 100, onProgress);

    const first = await nextRequest(before + 1);
    expect(first.request.payload.timestamps).toBe(false);
    expect(first.request.payload.samples).toHaveLength(5 * RATE);
    expect(first.transfer).toEqual([first.request.payload.samples.buffer]);
    theWorker().reply({
      id: first.request.id,
      type: "progress",
      progress: { stage: "model", done: 50, total: 100 },
    });
    theWorker().reply({
      id: first.request.id,
      type: "progress",
      progress: { stage: "transcribe", done: 99, total: 100 },
    });
    theWorker().reply({
      id: first.request.id,
      type: "result",
      result: [{ start: 0, end: null, text: " Hello there." }],
    });

    const second = await nextRequest(before + 2);
    theWorker().reply({
      id: second.request.id,
      type: "result",
      result: [{ start: 0, end: null, text: " [BLANK_AUDIO]" }],
    });

    const third = await nextRequest(before + 3);
    expect(third.request.payload.samples).toHaveLength(2 * RATE);
    theWorker().reply({
      id: third.request.id,
      type: "result",
      result: [{ start: 0, end: null, text: " (laughter)" }],
    });

    expect(await transcribing).toEqual([
      { start: 100, end: 105, text: "Hello there." },
      { start: 110, end: 112, text: "(laughter)" },
    ]);
    expect(samples).toHaveLength(12 * RATE);
    expect(onProgress.mock.calls.map(([progress]: unknown[]) => progress)).toEqual([
      { stage: "model", done: 50, total: 100 },
      { stage: "transcribe", done: 1, total: 3 },
      { stage: "transcribe", done: 2, total: 3 },
      { stage: "transcribe", done: 3, total: 3 },
    ]);
  });

  it("skips near-silent pieces without asking Whisper, still counting them", async () => {
    const onProgress = vi.fn();
    const before = theWorker().received.length;

    const cues = await transcribeInPieces(new Float32Array(10 * RATE), RATE, 0, onProgress);

    expect(cues).toEqual([]);
    expect(theWorker().received).toHaveLength(before);
    expect(onProgress).toHaveBeenLastCalledWith({ stage: "transcribe", done: 2, total: 2 });
  });
});

describe("transcribeInPieces abort", () => {
  it("stops before the next piece once aborted", async () => {
    const controller = new AbortController();
    const reason = new Error("stopped");
    const before = theWorker().received.length;
    const transcribing = transcribeInPieces(speech(10), RATE, 0, undefined, controller.signal);

    const first = await nextRequest(before + 1);
    controller.abort(reason);
    theWorker().reply({ id: first.request.id, type: "result", result: [] });

    await expect(transcribing).rejects.toBe(reason);
    expect(theWorker().received).toHaveLength(before + 1);
  });

  it("stops at once when already aborted, even with only silent pieces", async () => {
    const controller = new AbortController();
    const reason = new Error("stopped");
    controller.abort(reason);

    await expect(
      transcribeInPieces(new Float32Array(10 * RATE), RATE, 0, undefined, controller.signal),
    ).rejects.toBe(reason);
  });
});
