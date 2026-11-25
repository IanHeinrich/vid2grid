import { beforeAll, describe, expect, it, vi } from "vitest";
import { transcribeInPieces, transcribeTimed } from "../src/transcribe/transcription";
import type { TranscribeRequest } from "../src/transcribe/transcriptionWorker";
import { FakeWorker } from "./fakeWorker";

const created: FakeWorker<TranscribeRequest>[] = [];

function theWorker(): FakeWorker<TranscribeRequest> {
  const [worker] = created;
  if (!worker) throw new Error("no worker was created");
  return worker;
}

function receivedCount(): number {
  return created[0]?.received.length ?? 0;
}

async function nextRequest(count: number) {
  await vi.waitFor(() => expect(receivedCount()).toBe(count));
  const entry = theWorker().received.at(-1);
  if (!entry) throw new Error("nothing was posted");
  return entry;
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

const SPEECH_RATE = 16000;

function speechAudio(seconds: number) {
  const read = vi.fn((startIndex: number, endIndex: number) =>
    Promise.resolve(new Float32Array(endIndex - startIndex)),
  );
  return { sampleCount: seconds * SPEECH_RATE, read };
}

describe("transcribeTimed", () => {
  it("reads and sends one window at a time, then joins their tokens into cues", async () => {
    const audio = speechAudio(45);
    const onProgress = vi.fn();
    const before = receivedCount();
    const transcribing = transcribeTimed(audio, 10, onProgress);

    const first = await nextRequest(before + 1);
    expect(first.request.payload).toEqual({
      kind: "window",
      samples: new Float32Array(30 * SPEECH_RATE),
    });
    expect(first.transfer).toHaveLength(1);
    expect(audio.read).toHaveBeenCalledTimes(1);
    const firstId = first.request.id;
    theWorker().reply({
      id: firstId,
      type: "progress",
      progress: { stage: "model", done: 30, total: 100 },
    });
    theWorker().reply({ id: firstId, type: "result", result: [1, 2] });

    const second = await nextRequest(before + 2);
    expect(audio.read.mock.calls.map((call) => call.slice(0, 2))).toEqual([
      [0, 30 * SPEECH_RATE],
      [20 * SPEECH_RATE, 45 * SPEECH_RATE],
    ]);
    theWorker().reply({ id: second.request.id, type: "result", result: [2, 3] });

    const join = await nextRequest(before + 3);
    expect(join.request.payload).toEqual({
      kind: "join",
      windows: [
        { tokens: [1, 2], stride: [30, 0, 5] },
        { tokens: [2, 3], stride: [25, 5, 0] },
      ],
    });
    expect(join.transfer).toEqual([]);
    theWorker().reply({
      id: join.request.id,
      type: "result",
      result: [
        { start: 1, end: 2, text: " hello there " },
        { start: 44, end: null, text: " bye" },
      ],
    });

    expect(await transcribing).toEqual([
      { start: 11, end: 12, text: "hello there" },
      { start: 54, end: 54, text: "bye" },
    ]);
    expect(onProgress.mock.calls.map(([progress]: unknown[]) => progress)).toEqual([
      { stage: "model", done: 30, total: 100 },
      { stage: "transcribe", done: 1, total: 2 },
      { stage: "transcribe", done: 2, total: 2 },
    ]);
  });

  it("keeps two overlapping transcriptions apart on the one worker", async () => {
    const before = receivedCount();
    const first = transcribeTimed(speechAudio(1), 0);
    const second = transcribeTimed(speechAudio(1), 100);
    await nextRequest(before + 2);
    const ids = [theWorker().idOf(before), theWorker().idOf(before + 1)];
    theWorker().reply({ id: ids[1] ?? 0, type: "result", result: [2] });
    theWorker().reply({ id: ids[0] ?? 0, type: "result", result: [1] });
    await nextRequest(before + 4);

    for (const { request } of theWorker().received.slice(before + 2)) {
      const tokens = request.payload.kind === "join" ? request.payload.windows[0]?.tokens : [];
      const text = tokens?.[0] === 1 ? "a" : "b";
      const result = [{ start: 0, end: 1, text }];
      theWorker().reply({ id: request.id, type: "result", result });
    }

    expect((await first)[0]).toEqual({ start: 0, end: 1, text: "a" });
    expect((await second)[0]).toEqual({ start: 100, end: 101, text: "b" });
    expect(created).toHaveLength(1);
  });

  it("asks nothing for audio with no samples", async () => {
    const before = receivedCount();

    expect(await transcribeTimed(speechAudio(0), 0)).toEqual([]);
    expect(receivedCount()).toBe(before);
  });

  it("stops waiting once aborted and reads no further window", async () => {
    const controller = new AbortController();
    const reason = new Error("stopped");
    const audio = speechAudio(100);
    const before = receivedCount();
    const transcribing = transcribeTimed(audio, 0, undefined, controller.signal);
    await nextRequest(before + 1);

    controller.abort(reason);

    await expect(transcribing).rejects.toBe(reason);
    expect(audio.read).toHaveBeenCalledTimes(1);
    expect(audio.read.mock.calls[0]).toEqual([0, 30 * SPEECH_RATE, controller.signal]);
  });
});

const RATE = 100;

function speech(seconds: number): Float32Array {
  return new Float32Array(seconds * RATE).fill(0.1);
}

function clipOf(payload: TranscribeRequest): Float32Array {
  if (payload.kind !== "clip") throw new Error(`Expected a clip, got a ${payload.kind}`);
  return payload.samples;
}

describe("transcribeInPieces", () => {
  it("asks for each five second piece without timestamps and stamps its cue", async () => {
    const samples = speech(12);
    const onProgress = vi.fn();
    const before = receivedCount();
    const transcribing = transcribeInPieces(samples, RATE, 100, onProgress);

    const first = await nextRequest(before + 1);
    const firstClip = clipOf(first.request.payload);
    expect(firstClip).toHaveLength(5 * RATE);
    expect(first.transfer).toEqual([firstClip.buffer]);
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
    expect(clipOf(third.request.payload)).toHaveLength(2 * RATE);
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
    const before = receivedCount();

    const cues = await transcribeInPieces(new Float32Array(10 * RATE), RATE, 0, onProgress);

    expect(cues).toEqual([]);
    expect(receivedCount()).toBe(before);
    expect(onProgress).toHaveBeenLastCalledWith({ stage: "transcribe", done: 2, total: 2 });
  });
});

describe("transcribeInPieces abort", () => {
  it("stops before the next piece once aborted", async () => {
    const controller = new AbortController();
    const reason = new Error("stopped");
    const before = receivedCount();
    const transcribing = transcribeInPieces(speech(10), RATE, 0, undefined, controller.signal);

    const first = await nextRequest(before + 1);
    controller.abort(reason);
    theWorker().reply({ id: first.request.id, type: "result", result: [] });

    await expect(transcribing).rejects.toBe(reason);
    expect(receivedCount()).toBe(before + 1);
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
