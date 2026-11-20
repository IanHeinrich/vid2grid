import { beforeEach, describe, expect, it, vi } from "vitest";
import { AUDIO_PIECE_SECONDS, type AnalyseAudio } from "../src/audio/videoAudio";
import type * as StudyModule from "../src/video/study";
import { runStudy } from "../src/video/study";
import {
  VIDEO,
  analyseAudio,
  els,
  hangingStudy,
  progressingStudy,
  resetStudy,
  setup,
  startStudy,
  store,
} from "./studyHarness";

vi.mock("@vid2grid/browser", () => ({}));
vi.mock("../src/video/study", async (importOriginal) => {
  const actual = await importOriginal<typeof StudyModule>();
  return { ...actual, runStudy: vi.fn(), runZoom: vi.fn() };
});

beforeEach(resetStudy);

const hangingAnalysis: AnalyseAudio = (_file, _request, _speech, options) =>
  new Promise((_resolve, reject) => {
    options.onProgress?.({ stage: "sounds", done: 1, total: 4 });
    options.signal?.addEventListener("abort", () => reject(new Error("aborted")));
  });

function startFromDialog(): void {
  setup().open();
  startStudy();
}

const audioLine = () => els.study.progress.audio;

describe("audio alongside a study", () => {
  it("analyses the study's range with the loaded file while the pass runs", async () => {
    hangingStudy();
    startFromDialog();
    await vi.waitFor(() => expect(analyseAudio).toHaveBeenCalled());
    const [file, request] = analyseAudio.mock.calls[0] ?? [];
    expect(file?.name).toBe(VIDEO.name);
    expect(request?.startSeconds).toBe(0);
    expect(request?.endSeconds).toBe(AUDIO_PIECE_SECONDS);
    expect(runStudy).toHaveBeenCalled();
    await vi.waitFor(() => expect(audioLine().textContent).toBe("Audio analysed."));
    expect(audioLine().hidden).toBe(false);
    expect((await store.getAudio(VIDEO.fileKey))?.speechSpans).toEqual([
      { startSeconds: 0, endSeconds: VIDEO.durationSeconds },
    ]);
  });

  it("shows audio progress, and Pause aborts the audio along with the pass", async () => {
    analyseAudio.mockImplementationOnce(hangingAnalysis);
    progressingStudy(1);
    startFromDialog();
    await vi.waitFor(() => expect(audioLine().textContent).toBe("Listening for sounds… 25%"));
    els.study.progress.pauseButton.click();
    await vi.waitFor(() =>
      expect(audioLine().textContent).toBe("Audio paused. What was heard is kept."),
    );
    expect(els.study.progress.pauseButton.textContent).toBe("Resume");
    const signal = analyseAudio.mock.calls[0]?.[3].signal;
    expect(signal?.aborted).toBe(true);
  });

  it("notes an audio failure without failing the study", async () => {
    analyseAudio.mockRejectedValueOnce(new Error("decoder missing"));
    vi.mocked(runStudy).mockImplementationOnce((deps) =>
      Promise.resolve({ ...deps.timeline, nextWindow: deps.timeline.windowCount }),
    );
    startFromDialog();
    await vi.waitFor(() =>
      expect(audioLine().textContent).toBe("Audio not analysed: decoder missing"),
    );
    await vi.waitFor(() => expect(els.study.progress.title.textContent).toMatch(/^Study done/));
  });

  it("skips the audio when the checkbox is off", async () => {
    vi.mocked(runStudy).mockImplementationOnce((deps) => Promise.resolve(deps.timeline));
    setup().open();
    els.study.audioInput.checked = false;
    els.study.audioInput.dispatchEvent(new Event("change"));
    startStudy();
    await vi.waitFor(() => expect(runStudy).toHaveBeenCalled());
    expect(analyseAudio).not.toHaveBeenCalled();
    expect(audioLine().hidden).toBe(true);
  });
});
