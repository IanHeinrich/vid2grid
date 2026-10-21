import { beforeEach, describe, expect, it, vi } from "vitest";
import indexHtml from "../index.html?raw";
import { queryElements } from "../src/dom";
import { createAppState, setVideoFile, setVideoInfo } from "../src/state";
import type { Progress } from "@vid2grid/core";
import { advanceProgress, buildRequest, initGenerate, startProgress } from "../src/ui/generate";

const { generateCollages } = vi.hoisted(() => ({ generateCollages: vi.fn() }));

vi.mock("@vid2grid/browser", () => ({ createBrowserPorts: () => ({}) }));
vi.mock("@vid2grid/core", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  generateCollages,
}));

function runProgress(events: Progress[], withTranscript: boolean) {
  const steps: { fraction: number; label: string }[] = [];
  let state = startProgress(withTranscript);
  for (const event of events) {
    state = advanceProgress(state, event);
    steps.push({ fraction: state.fraction, label: state.label });
  }
  return steps;
}

const extracting = (done: number, total = 4): Progress => ({ phase: "extracting", done, total });
const rendering = (done: number, total = 2): Progress => ({ phase: "rendering", done, total });
const transcribing = (done: number, total = 2): Progress => ({
  phase: "transcribing",
  done,
  total,
  stage: "transcribe",
});

const interleavedCapture = [
  extracting(1),
  extracting(2),
  rendering(1),
  extracting(3),
  extracting(4),
  rendering(2),
];

describe("advanceProgress", () => {
  it("never moves the bar backwards when frames and sheets interleave", () => {
    const fractions = runProgress(interleavedCapture, false).map((step) => step.fraction);
    fractions
      .slice(1)
      .forEach((fraction, i) => expect(fraction).toBeGreaterThanOrEqual(fractions[i] ?? 0));
  });

  it("does not drop when the second phase reports its first event", () => {
    const [afterFrames, afterSheet] = runProgress([extracting(4), rendering(0)], false);
    expect(afterSheet?.fraction).toBeGreaterThanOrEqual(afterFrames?.fraction ?? 1);
  });

  it("holds the bar when an event reports less than before", () => {
    const [first, second] = runProgress([extracting(3), extracting(2)], false);
    expect(second?.fraction).toBe(first?.fraction);
  });

  it("ends at 1 without transcription", () => {
    const steps = runProgress(interleavedCapture, false);
    expect(steps.at(-1)?.fraction).toBeCloseTo(1);
  });

  it("reserves the transcript share when transcription is on", () => {
    const steps = runProgress([...interleavedCapture, transcribing(0)], true);
    expect(steps.at(-2)?.fraction).toBeCloseTo(0.7);
    expect(steps.at(-1)?.fraction).toBeCloseTo(0.7);
    expect(
      runProgress([...interleavedCapture, transcribing(1)], true).at(-1)?.fraction,
    ).toBeCloseTo(0.85);
  });

  it("ends at 1 with transcription", () => {
    const steps = runProgress([...interleavedCapture, transcribing(1), transcribing(2)], true);
    expect(steps.at(-1)?.fraction).toBeCloseTo(1);
  });

  it("does not count a phase with no total as progress", () => {
    expect(runProgress([extracting(0, 0)], false)[0]?.fraction).toBe(0);
  });
});

describe("progress label", () => {
  it("says what is happening while frames and sheets both move", () => {
    const labels = runProgress(interleavedCapture, false).map((step) => step.label);
    expect(labels[0]).toBe("Extracting frames...");
    expect(labels[2]).toBe("Extracting frames and rendering sheets...");
    expect(labels[3]).toBe("Extracting frames and rendering sheets...");
  });

  it("names rendering once every frame is out", () => {
    const labels = runProgress(
      [extracting(2), rendering(0), extracting(4), rendering(1)],
      false,
    ).map((step) => step.label);
    expect(labels.at(-1)).toBe("Rendering collage sheets...");
  });

  it("keeps the transcription labels", () => {
    const model: Progress = { phase: "transcribing", done: 0, total: 1, stage: "model" };
    expect(runProgress([model], true)[0]?.label).toBe(
      "Downloading speech model (first use only)...",
    );
    expect(runProgress([transcribing(1)], true)[0]?.label).toBe("Transcribing audio...");
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
      outputResolution: 2048,
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
