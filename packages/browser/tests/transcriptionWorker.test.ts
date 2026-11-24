import { beforeEach, describe, expect, it, vi } from "vitest";
import type { TranscribeRequest, WindowTokens } from "../src/transcribe/transcriptionWorker";

// The model is the library's to test; this asks what the worker gives each of its parts.
const { pipeline } = vi.hoisted(() => ({ pipeline: vi.fn() }));
vi.mock("@huggingface/transformers", () => ({ pipeline }));

type Handler = (event: { data: { id: number; payload: TranscribeRequest } }) => void;

const features = { features: true };
const processor = Object.assign(
  vi.fn(() => Promise.resolve({ input_features: features })),
  { feature_extractor: { config: { chunk_length: 30 } } },
);
const model = {
  config: { max_source_positions: 1500 },
  generate: vi.fn(() => Promise.resolve({ tolist: () => [[50363n, 7n, 50863n]] })),
};
const decodeAsr = vi.fn(() => [
  " Hello. Bye.",
  {
    chunks: [
      { text: " Hello.", timestamp: [0, 2.5] },
      { text: " Bye.", timestamp: [2.5, null] },
    ],
  },
]);

let postMessage: ReturnType<typeof vi.fn>;
let handler: Handler;

beforeEach(async () => {
  const transcriber = vi.fn(() => Promise.resolve({ text: " Hello." }));
  pipeline.mockResolvedValue(
    Object.assign(transcriber, { processor, model, tokenizer: { _decode_asr: decodeAsr } }),
  );
  const scope = { onmessage: undefined as unknown, postMessage: vi.fn() };
  postMessage = scope.postMessage;
  vi.stubGlobal("self", scope);
  vi.resetModules();
  await import("../src/transcribe/transcriptionWorker");
  handler = scope.onmessage as Handler;
  vi.unstubAllGlobals();
});

async function resultOf(payload: TranscribeRequest): Promise<unknown> {
  handler({ data: { id: 1, payload } });
  await vi.waitFor(() => expect(postMessage).toHaveBeenCalled());
  return postMessage.mock.calls[0]?.[0];
}

describe("the transcription worker", () => {
  it("decodes a window to tokens, with Whisper's own timestamps", async () => {
    const samples = new Float32Array(8);

    expect(await resultOf({ kind: "window", samples })).toEqual({
      id: 1,
      type: "result",
      result: [50363, 7, 50863],
    });
    expect(processor).toHaveBeenCalledWith(samples);
    expect(model.generate).toHaveBeenCalledWith({ inputs: features, return_timestamps: true });
  });

  it("joins windows as the library's own long-audio call does", async () => {
    const windows: WindowTokens[] = [{ tokens: [50363, 7, 50863], stride: [30, 0, 5] }];

    expect(await resultOf({ kind: "join", windows })).toEqual({
      id: 1,
      type: "result",
      result: [
        { text: " Hello.", start: 0, end: 2.5 },
        { text: " Bye.", start: 2.5, end: null },
      ],
    });
    expect(decodeAsr).toHaveBeenCalledWith(windows, {
      time_precision: 0.02,
      return_timestamps: true,
      force_full_sequences: false,
    });
  });

  it("hears a clip as one untimed segment", async () => {
    expect(await resultOf({ kind: "clip", samples: new Float32Array(8) })).toMatchObject({
      result: [{ text: " Hello.", start: 0, end: null }],
    });
  });
});
