import type { RenderPlan, VideoInfo } from "@vid2grid/core";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createBrowserPorts } from "../src/index";

const { extractFramesAuto, openSpeechAudio, transcribeTimed } = vi.hoisted(() => ({
  extractFramesAuto: vi.fn(),
  openSpeechAudio: vi.fn(),
  transcribeTimed: vi.fn(),
}));
vi.mock("../src/capture/frameExtraction", () => ({ extractFramesAuto }));
vi.mock("../src/capture/audioExtraction", () => ({ openSpeechAudio, decodeAudioRange: vi.fn() }));
vi.mock("../src/transcribe/transcription", () => ({
  transcribeTimed,
  transcribeInPieces: vi.fn(),
}));

const file = new File([], "clip.mp4");
const { signal } = new AbortController();

beforeEach(() => {
  vi.resetAllMocks();
});

describe("createBrowserPorts", () => {
  it("passes the signal to the capture", () => {
    const plan = {} as RenderPlan;

    createBrowserPorts().frames.capture(file, plan, {} as VideoInfo, signal);

    expect(extractFramesAuto).toHaveBeenCalledWith(file, plan, signal);
  });

  it("transcribes the range's audio piece by piece, with the signal", async () => {
    const audio = { sampleCount: 0, read: vi.fn() };
    const cues = [{ start: 1, end: 2, text: "hello" }];
    const onProgress = vi.fn();
    openSpeechAudio.mockResolvedValue(audio);
    transcribeTimed.mockResolvedValue(cues);

    const { transcript } = createBrowserPorts();

    expect(await transcript?.transcribe(file, 10, 20, onProgress, signal)).toBe(cues);
    expect(openSpeechAudio).toHaveBeenCalledWith(file, 10, 20, signal);
    expect(transcribeTimed).toHaveBeenCalledWith(audio, 10, onProgress, signal);
  });
});
