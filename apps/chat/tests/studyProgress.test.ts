import { beforeEach, describe, expect, it, vi } from "vitest";
import { zoomOfferText } from "../src/ui/study/studyProgress";
import type * as StudyModule from "../src/video/study";
import { runStudy, runZoom, type ZoomDeps } from "../src/video/study";
import {
  FLAGS,
  els,
  expectedPlan,
  flaggedStudy,
  hangingZoom,
  offerFor,
  openTimeline,
  pricedModels,
  progressingStudy,
  resetStudy,
  setup,
  STUDY_MODEL_ID,
  startStudy,
  store,
  VIDEO,
} from "./studyHarness";

vi.mock("@vid2grid/browser", () => ({}));
vi.mock("../src/video/study", async (importOriginal) => {
  const actual = await importOriginal<typeof StudyModule>();
  return { ...actual, runStudy: vi.fn(), runZoom: vi.fn() };
});

beforeEach(resetStudy);

describe("zoomOfferText", () => {
  const zoom = { startSeconds: 2, endSeconds: 8, frameCount: 24, sheets: 2 };
  const estimate = { requests: 1, images: 2, inputTokens: 3000, outputTokens: 400, seconds: 30 };

  it("marks an approximate cost the way the study estimate does", () => {
    expect(
      zoomOfferText({
        zooms: [zoom],
        perSheet: 12,
        estimate: { ...estimate, costUsd: 0.051, approximate: true },
      }),
    ).toBe("Zoom into 1 unclear moment, about $0.05 (approximate)");
    expect(
      zoomOfferText({
        zooms: [zoom, zoom],
        perSheet: 12,
        estimate: { ...estimate, approximate: false },
      }),
    ).toBe("Zoom into 2 unclear moments, about 3,000 input tokens");
  });
});

describe("the progress card", () => {
  it("shows the window being studied with tokens and cost, and pauses and resumes", async () => {
    pricedModels();
    const windows = expectedPlan().windows.length;
    const running = progressingStudy(1);
    const study = setup();
    const card = els.study.progress;
    expect(card.el.hidden).toBe(true);
    study.open();
    startStudy();
    await vi.waitFor(() => expect(running.deps()).toBeDefined());
    expect(card.el.hidden).toBe(false);
    expect(card.title.textContent).toBe("Studying the video");
    expect(card.detail.textContent).toBe(
      `Window 2 of ${windows}, 0:45 to 1:30. 1,234 tokens, $0.12 so far.`,
    );
    expect(card.bar.value).toBe(1);
    expect(card.bar.max).toBe(windows);
    expect(card.openButton.hidden).toBe(true);
    card.pauseButton.click();
    expect(running.deps()?.signal.aborted).toBe(true);
    await vi.waitFor(() => expect(card.pauseButton.textContent).toBe("Resume"));
    expect(card.title.textContent).toBe(`Study paused at 1 of ${windows}`);
    expect(card.detail.textContent).toBe("1 timeline entry. 1,234 tokens, $0.12 so far.");
    vi.mocked(runStudy).mockImplementationOnce((deps) => Promise.resolve(deps.timeline));
    card.pauseButton.click();
    await vi.waitFor(() => expect(runStudy).toHaveBeenCalledTimes(2));
    expect(vi.mocked(runStudy).mock.calls[1]?.[0].timeline.nextWindow).toBe(1);
  });
});

describe("the progress card when the study ends", () => {
  it("stops the study for good, keeping the windows done, and opens the timeline", async () => {
    const windows = expectedPlan().windows.length;
    const running = progressingStudy(2);
    const study = setup();
    const card = els.study.progress;
    study.open();
    startStudy();
    await vi.waitFor(() => expect(running.deps()).toBeDefined());
    card.stopButton.click();
    expect(running.deps()?.signal.aborted).toBe(true);
    await vi.waitFor(() =>
      expect(card.title.textContent).toBe(`Study stopped after 2 of ${windows} windows`),
    );
    const saved = await store.getTimeline(VIDEO.fileKey);
    expect(saved?.nextWindow).toBe(2);
    expect(saved?.windowCount).toBe(2);
    expect(els.study.button.textContent).toBe("Restudy");
    expect(card.stopButton.hidden).toBe(true);
    card.openButton.click();
    expect(openTimeline).toHaveBeenCalled();
    card.closeButton.click();
    expect(card.el.hidden).toBe(true);
  });

  it("sums up a finished study", async () => {
    const windows = expectedPlan().windows.length;
    vi.mocked(runStudy).mockImplementationOnce((deps) =>
      Promise.resolve({
        ...deps.timeline,
        entries: [
          { startSeconds: 0, endSeconds: 5, text: "She walks in" },
          { startSeconds: 5, endSeconds: 9, text: "She sits" },
        ],
        nextWindow: windows,
      }),
    );
    const study = setup();
    study.open();
    startStudy();
    const card = els.study.progress;
    await vi.waitFor(() => expect(card.title.textContent).toBe(`Study done: ${windows} windows`));
    expect(card.detail.textContent).toBe("2 timeline entries.");
    expect(card.pauseButton.hidden).toBe(true);
    expect(card.openButton.hidden).toBe(false);
  });
});

const ALL_ZOOMED = FLAGS.map((span) => ({ ...span, zoomed: true as const }));

describe("the zoom pass in the progress card", () => {
  it("offers a zoom when the study finishes, then pauses, resumes and sums it up", async () => {
    const windows = expectedPlan().windows.length;
    vi.mocked(runStudy).mockImplementationOnce((deps) =>
      Promise.resolve({
        ...deps.timeline,
        entries: [{ startSeconds: 0, endSeconds: 5, text: "She walks in" }],
        unclear: FLAGS,
        nextWindow: windows,
      }),
    );
    const study = setup();
    study.open();
    startStudy();
    const card = els.study.progress;
    await vi.waitFor(() => expect(card.title.textContent).toBe(`Study done: ${windows} windows`));
    expect(card.zoomButton.hidden).toBe(false);
    expect(card.zoomButton.textContent).toBe(offerFor(FLAGS, STUDY_MODEL_ID));
    const running = hangingZoom();
    card.zoomButton.click();
    await vi.waitFor(() => expect(card.title.textContent).toBe("Zooming into unclear moments"));
    expect(card.detail.textContent).toBe("Moment 2 of 2, 4:59.0 to 5:03.0.");
    expect(study.status()).toBe("Zooming 2 of 2");
    expect(card.zoomButton.hidden).toBe(true);
    card.pauseButton.click();
    expect(running.deps()?.signal.aborted).toBe(true);
    await vi.waitFor(() => expect(card.title.textContent).toBe("Zoom paused at 1 of 2"));
    expect(card.pauseButton.textContent).toBe("Resume");
    vi.mocked(runZoom).mockImplementationOnce((deps) => {
      const done = { ...deps.timeline, unclear: ALL_ZOOMED };
      deps.onProgress(done);
      return Promise.resolve(done);
    });
    card.pauseButton.click();
    await vi.waitFor(() => expect(card.title.textContent).toBe("Zoom done: 2 moments"));
    expect(vi.mocked(runZoom).mock.calls[1]?.[0].plan.zooms).toHaveLength(1);
    expect(card.zoomButton.hidden).toBe(true);
    expect(card.openButton.hidden).toBe(false);
  });

  it("stops a paused zoom, leaving the rest flagged", async () => {
    await flaggedStudy(FLAGS);
    const running = hangingZoom();
    els.study.zoomButton.click();
    await vi.waitFor(() => expect(running.deps()).toBeDefined());
    const card = els.study.progress;
    card.stopButton.click();
    await vi.waitFor(() =>
      expect(card.title.textContent).toBe("Zoom stopped after 1 of 2 moments"),
    );
    expect(card.zoomButton.hidden).toBe(false);
    expect(card.zoomButton.textContent).toBe(offerFor(FLAGS.slice(1)));
  });
});

describe("a resumed zoom in the progress card", () => {
  it("counts a resumed zoom on from where it paused", async () => {
    const study = await flaggedStudy(FLAGS);
    const first = hangingZoom();
    els.study.zoomButton.click();
    await vi.waitFor(() => expect(first.deps()).toBeDefined());
    const card = els.study.progress;
    card.pauseButton.click();
    await vi.waitFor(() => expect(card.title.textContent).toBe("Zoom paused at 1 of 2"));
    const resumed: { deps?: ZoomDeps; finish?: () => void } = {};
    vi.mocked(runZoom).mockImplementationOnce(
      (deps) =>
        new Promise((resolve) => {
          resumed.deps = deps;
          resumed.finish = () => {
            const done = { ...deps.timeline, unclear: ALL_ZOOMED };
            deps.onProgress(done);
            resolve(done);
          };
        }),
    );
    card.pauseButton.click();
    await vi.waitFor(() => expect(resumed.finish).toBeDefined());
    expect(resumed.deps?.plan.zooms).toHaveLength(1);
    expect(card.detail.textContent).toBe("Moment 2 of 2, 4:59.0 to 5:03.0.");
    expect(study.status()).toBe("Zooming 2 of 2");
    expect(card.bar.value).toBe(1);
    expect(card.bar.max).toBe(2);
    resumed.finish?.();
    await vi.waitFor(() => expect(card.title.textContent).toBe("Zoom done: 2 moments"));
    expect(card.bar.value).toBe(2);
  });
});
