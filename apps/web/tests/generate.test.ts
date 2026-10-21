import { beforeEach, describe, expect, it, vi } from "vitest";
import indexHtml from "../index.html?raw";
import { queryElements } from "../src/dom";
import { createAppState, setVideoFile, setVideoInfo } from "../src/state";
import { buildRequest, initGenerate, overallProgress, progressLabel } from "../src/ui/generate";

const { generateCollages } = vi.hoisted(() => ({ generateCollages: vi.fn() }));

vi.mock("@vid2grid/browser", () => ({ createBrowserPorts: () => ({}) }));
vi.mock("@vid2grid/core", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  generateCollages,
}));

describe("overallProgress", () => {
  it("weights frames-only phases 70/30", () => {
    expect(overallProgress({ phase: "extracting", done: 1, total: 2 }, false)).toBeCloseTo(0.35);
    expect(overallProgress({ phase: "rendering", done: 2, total: 2 }, false)).toBeCloseTo(1);
  });

  it("leaves room for transcription when it is on", () => {
    expect(overallProgress({ phase: "rendering", done: 0, total: 1 }, true)).toBeCloseTo(0.5);
    expect(overallProgress({ phase: "transcribing", done: 1, total: 2 }, true)).toBeCloseTo(0.85);
  });
});

describe("progressLabel", () => {
  it("names each phase", () => {
    const progress = { done: 0, total: 1 };
    expect(progressLabel({ ...progress, phase: "extracting" })).toBe("Extracting frames...");
    expect(progressLabel({ ...progress, phase: "rendering" })).toBe("Rendering collage sheets...");
    expect(progressLabel({ ...progress, phase: "transcribing", stage: "model" })).toBe(
      "Downloading speech model (first use only)...",
    );
    expect(progressLabel({ ...progress, phase: "transcribing", stage: "transcribe" })).toBe(
      "Transcribing audio...",
    );
  });
});

describe("buildRequest", () => {
  beforeEach(() => {
    document.body.innerHTML = indexHtml;
  });

  it("reads the form into a plan request", () => {
    const { form } = queryElements();
    form.startTimeInput.value = "1.5";
    form.endTimeInput.value = "9";
    form.framesPerGridInput.value = "12.7";
    expect(buildRequest(form)).toEqual({
      startSeconds: 1.5,
      endSeconds: 9,
      targetFps: 1,
      keyframeSampling: false,
      framesPerGrid: 12,
      outputResolution: 1024,
      jpegQuality: 80,
    });
  });

  it("adds a transcript scope only when transcription is on", () => {
    const { form } = queryElements();
    form.transcriptModeInput.checked = true;
    expect(buildRequest(form).transcript).toEqual({ scope: "per-sheet" });
    form.transcriptCombinedInput.checked = true;
    expect(buildRequest(form).transcript).toEqual({ scope: "combined" });
  });
});

interface Settle {
  resolve: (value: unknown) => void;
  reject: (reason: unknown) => void;
}

describe("generating", () => {
  const sheets = [{ name: "a_grid_1.jpg", data: new Blob() }];

  function startGeneration(endTime = "10") {
    document.body.innerHTML = indexHtml;
    const els = queryElements();
    els.form.endTimeInput.value = endTime;
    const state = createAppState();
    const status = { show: vi.fn() };
    const controls = initGenerate(els, state, { status, gallery: { render: vi.fn() } });
    setVideoFile(state, new File([], "a.mp4"));
    setVideoInfo(state, { durationSeconds: 10, width: 640, height: 360 });
    controls.render();

    let settle: Settle = { resolve: () => {}, reject: () => {} };
    generateCollages.mockImplementation(
      () => new Promise((resolve, reject) => (settle = { resolve, reject })),
    );
    els.generate.generateButton.click();
    return { state, status, settle: () => settle };
  }

  it("reports an invalid request without generating", () => {
    generateCollages.mockClear();
    const { state, status } = startGeneration("0");
    expect(status.show).toHaveBeenLastCalledWith("end_time must be greater than start_time");
    expect(generateCollages).not.toHaveBeenCalled();
    expect(state.generating).toBe(false);
  });

  it("keeps the results when the same file is still loaded", async () => {
    const { state, settle } = startGeneration();
    settle().resolve({ plan: {}, sheets, transcriptFiles: [] });
    await vi.waitFor(() => expect(state.generating).toBe(false));
    expect(state.results?.sheets).toEqual(sheets);
  });

  it("drops results that finish after a different file was loaded", async () => {
    const { state, settle } = startGeneration();
    setVideoFile(state, new File([], "b.mp4"));
    settle().resolve({ plan: {}, sheets, transcriptFiles: [] });
    await vi.waitFor(() => expect(state.generating).toBe(false));
    expect(state.results).toBeNull();
  });

  it("drops a failure that arrives after a different file was loaded", async () => {
    const { state, status, settle } = startGeneration();
    setVideoFile(state, new File([], "b.mp4"));
    settle().reject(new Error("decoder crashed"));
    await vi.waitFor(() => expect(state.generating).toBe(false));
    expect(status.show).not.toHaveBeenCalledWith(expect.stringContaining("decoder crashed"));
  });
});
