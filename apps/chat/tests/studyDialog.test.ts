import { beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_SETTINGS } from "../src/settings";
import { setModels } from "../src/state";
import { estimateText, planSummaryText } from "../src/ui/study/studyDialog";
import type * as StudyModule from "../src/video/study";
import { runStudy, type StudyDeps as RunDeps } from "../src/video/study";
import {
  els,
  expectedPlan,
  model,
  planFor,
  reloadPage,
  resetStudy,
  setInput,
  setup,
  startStudy,
  state,
} from "./studyHarness";

vi.mock("@vid2grid/browser", () => ({}));
vi.mock("../src/video/study", async (importOriginal) => {
  const actual = await importOriginal<typeof StudyModule>();
  return { ...actual, runStudy: vi.fn(), runZoom: vi.fn() };
});

beforeEach(resetStudy);

const withAudio = (estimate: string) => `${estimate} Audio is free and analysed on this computer.`;

describe("estimateText", () => {
  it("lists windows, images, tokens and time, with cost only when priced", () => {
    const base = { requests: 12, images: 36, inputTokens: 52000, outputTokens: 900 };
    expect(estimateText({ ...base, seconds: 348, approximate: false })).toBe(
      "12 windows, 36 images, about 52,000 input tokens, about 6 minutes.",
    );
    expect(estimateText({ ...base, costUsd: 0.214, seconds: 20, approximate: true })).toBe(
      "12 windows, 36 images, about 52,000 input tokens, about $0.21, under a minute (approximate).",
    );
  });
});

describe("study dialog", () => {
  it("shows the estimate for the chat's model", () => {
    setup().open();
    expect(els.study.dialog.open).toBe(true);
    expect(els.study.modelPicker.querySelector(".model-trigger-name")?.textContent).toBe(
      DEFAULT_SETTINGS.defaultModelId,
    );
    expect(els.study.estimate.textContent).toBe(withAudio(estimateText(expectedPlan().estimate)));
  });

  it("studies with the model picked in the dialog and updates the estimate", async () => {
    setModels(state, [model(DEFAULT_SETTINGS.defaultModelId), model("claude-opus-4-7")]);
    vi.mocked(runStudy).mockImplementationOnce((deps) => Promise.resolve(deps.timeline));
    setup().open();
    const mount = els.study.modelPicker;
    mount.querySelector<HTMLButtonElement>(".model-trigger")?.click();
    mount.querySelector<HTMLElement>('.model-row[data-id="claude-opus-4-7"]')?.click();
    expect(mount.querySelector(".model-trigger-name")?.textContent).toBe("claude-opus-4-7");
    expect(els.study.estimate.textContent).toBe(
      withAudio(estimateText(planFor("claude-opus-4-7").estimate)),
    );
    els.study.dialog.returnValue = "start";
    els.study.dialog.dispatchEvent(new Event("close"));
    await vi.waitFor(() => expect(runStudy).toHaveBeenCalled());
    expect(vi.mocked(runStudy).mock.calls[0]?.[0].model.id).toBe("claude-opus-4-7");
  });

  it("studies, pauses after the current window and resumes from there", async () => {
    const windows = expectedPlan().windows.length;
    let first: RunDeps | undefined;
    vi.mocked(runStudy).mockImplementationOnce(
      (deps) =>
        new Promise((resolve) => {
          first = deps;
          const progress = { ...deps.timeline, nextWindow: 1 };
          deps.onProgress(progress);
          deps.signal.addEventListener("abort", () => resolve(progress));
        }),
    );
    const study = setup();
    study.open();
    els.study.dialog.returnValue = "start";
    els.study.dialog.dispatchEvent(new Event("close"));
    await vi.waitFor(() => expect(first).toBeDefined());
    expect(study.status()).toBe(`Studying 2 of ${windows}`);
    expect(els.study.button.textContent).toBe("Pause");
    els.study.button.click();
    expect(first?.signal.aborted).toBe(true);
    await vi.waitFor(() => expect(els.study.button.textContent).toBe("Resume"));
    expect(study.status()).toBe(`Study paused at 1 of ${windows}`);
    vi.mocked(runStudy).mockImplementationOnce((deps) =>
      Promise.resolve({ ...deps.timeline, nextWindow: windows }),
    );
    els.study.button.click();
    await vi.waitFor(() => expect(study.status()).toBe("Timeline ready"));
    expect(vi.mocked(runStudy).mock.calls[1]?.[0].timeline.nextWindow).toBe(1);
  });
});

describe("study audio checkbox", () => {
  it("is on by default, drops the audio note from the estimate and is remembered", () => {
    setup().open();
    const { audioInput, estimate } = els.study;
    expect(audioInput.checked).toBe(true);
    audioInput.checked = false;
    audioInput.dispatchEvent(new Event("change"));
    expect(estimate.textContent).toBe(estimateText(expectedPlan().estimate));
    reloadPage();
    setup().open();
    expect(els.study.audioInput.checked).toBe(false);
  });
});

describe("study dialog settings", () => {
  it("plans with the window length, density and range set in the dialog", async () => {
    vi.mocked(runStudy).mockImplementationOnce((deps) => Promise.resolve(deps.timeline));
    setup().open();
    expect(els.study.windowValue.textContent).toBe("45 s");
    expect(els.study.planSummary.textContent).toBe(planSummaryText(expectedPlan()));
    setInput(els.study.windowInput, "60");
    setInput(els.study.densityInput, "dense");
    setInput(els.study.fromInput, "1:00");
    setInput(els.study.toInput, "5:00");
    const plan = planFor(DEFAULT_SETTINGS.defaultModelId, {
      windowSeconds: 60,
      framesPerWindow: 72,
      startSeconds: 60,
      endSeconds: 300,
    });
    expect(els.study.windowValue.textContent).toBe("60 s");
    expect(els.study.planSummary.textContent).toBe(planSummaryText(plan));
    expect(els.study.estimate.textContent).toBe(withAudio(estimateText(plan.estimate)));
    startStudy();
    await vi.waitFor(() => expect(runStudy).toHaveBeenCalled());
    const used = vi.mocked(runStudy).mock.calls[0]?.[0].plan;
    expect(used?.windows).toEqual(plan.windows);
    expect(used?.windows[0]).toEqual({ startSeconds: 60, endSeconds: 120 });
    expect(used?.framesPerWindow).toBe(plan.framesPerWindow);
    expect(vi.mocked(runStudy).mock.calls[0]?.[0].timeline.plan).toEqual({
      windowSeconds: 60,
      framesPerWindow: 72,
      startSeconds: 60,
      endSeconds: 300,
    });
  });

  it("takes the playback time, resets to the whole video and blocks a backwards range", () => {
    setup().open();
    els.study.fromCurrentButton.click();
    expect(els.study.fromInput.value).toBe("1:15");
    setInput(els.study.toInput, "1:00");
    expect(els.study.startButton.disabled).toBe(true);
    expect(els.study.toInput.getAttribute("aria-invalid")).toBe("true");
    els.study.wholeVideoButton.click();
    expect(els.study.fromInput.value).toBe("");
    expect(els.study.toInput.value).toBe("");
    expect(els.study.startButton.disabled).toBe(false);
    expect(els.study.toInput.hasAttribute("aria-invalid")).toBe(false);
    expect(els.study.estimate.textContent).toBe(withAudio(estimateText(expectedPlan().estimate)));
  });
});
