import { beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_SETTINGS } from "../src/settings";
import { blankChat, removeChat, replaceChat, setCurrentChat } from "../src/state";
import type * as StudyModule from "../src/video/study";
import { runStudy } from "../src/video/study";
import {
  FLAGS,
  VIDEO,
  confirm,
  els,
  expectedPlan,
  flaggedStudy,
  hangingStudy,
  hangingZoom,
  menuToggle,
  offerFor,
  openPlayer,
  planFor,
  reloadPage,
  resetStudy,
  restartItem,
  setInput,
  setup,
  startStudy,
  state,
  store,
  timeline,
  zoomItem,
} from "./studyHarness";

vi.mock("@vid2grid/browser", () => ({}));
vi.mock("../src/video/study", async (importOriginal) => {
  const actual = await importOriginal<typeof StudyModule>();
  return { ...actual, runStudy: vi.fn(), runZoom: vi.fn() };
});

beforeEach(resetStudy);

describe("resuming after a reload", () => {
  const ranged = { windowSeconds: 60, framesPerWindow: 72, startSeconds: 60, endSeconds: 300 };

  function startRangedStudy(): void {
    setup().open();
    setInput(els.study.windowInput, "60");
    setInput(els.study.densityInput, "dense");
    setInput(els.study.fromInput, "1:00");
    setInput(els.study.toInput, "5:00");
    startStudy();
  }

  it("plans a ranged study's remaining windows from the plan saved on its timeline", async () => {
    const plan = planFor(DEFAULT_SETTINGS.defaultModelId, ranged);
    vi.mocked(runStudy).mockImplementationOnce(async (deps) => {
      const progress = { ...deps.timeline, nextWindow: 1 };
      await deps.saveTimeline(progress);
      return progress;
    });
    startRangedStudy();
    await vi.waitFor(async () =>
      expect((await store.getTimeline(VIDEO.fileKey))?.plan).toEqual(ranged),
    );
    reloadPage();
    setup();
    await vi.waitFor(() => expect(els.study.button.textContent).toBe("Resume"));
    vi.mocked(runStudy).mockImplementationOnce((deps) => Promise.resolve(deps.timeline));
    els.study.button.click();
    await vi.waitFor(() => expect(runStudy).toHaveBeenCalledTimes(2));
    const resumed = vi.mocked(runStudy).mock.calls[1]?.[0];
    expect(resumed?.plan.windows).toEqual(plan.windows);
    expect(resumed?.plan.framesPerWindow).toBe(plan.framesPerWindow);
    expect(resumed?.timeline.nextWindow).toBe(1);
    expect(els.study.dialog.open).toBe(false);
  });

  it("plans with the defaults for a timeline saved without a plan", async () => {
    const plan = expectedPlan();
    await store.putTimeline({
      ...timeline([{ startSeconds: 0, endSeconds: 5, text: "She walks in" }]),
      modelId: DEFAULT_SETTINGS.defaultModelId,
      nextWindow: 1,
      windowCount: plan.windows.length,
    });
    setup();
    await vi.waitFor(() => expect(els.study.button.textContent).toBe("Resume"));
    vi.mocked(runStudy).mockImplementationOnce((deps) => Promise.resolve(deps.timeline));
    els.study.button.click();
    await vi.waitFor(() => expect(runStudy).toHaveBeenCalled());
    expect(vi.mocked(runStudy).mock.calls[0]?.[0].plan.windows).toEqual(plan.windows);
  });
});

describe("the study control", () => {
  it("labels itself Study video, Restudy or Resume from the stored timeline", async () => {
    setup();
    expect(els.study.button.textContent).toBe("Study video");
    expect(menuToggle()?.hidden).toBe(true);
    await store.putTimeline({ ...timeline([]), fileKey: "done-key" });
    const doneChat = { ...blankChat("m", "done", 2), video: { ...VIDEO, fileKey: "done-key" } };
    replaceChat(state, doneChat);
    setCurrentChat(state, doneChat, []);
    const study = setup();
    await vi.waitFor(() => expect(els.study.button.textContent).toBe("Restudy"));
    await store.putTimeline({ ...timeline([]), fileKey: "paused-key", nextWindow: 1 });
    const pausedVideo = { ...VIDEO, fileKey: "paused-key" };
    const pausedChat = { ...blankChat("m", "paused", 3), video: pausedVideo };
    replaceChat(state, pausedChat);
    setCurrentChat(state, pausedChat, []);
    study.render();
    await vi.waitFor(() => expect(els.study.button.textContent).toBe("Resume"));
    expect(restartItem()?.hidden).toBe(false);
  });

  it("starts over from New study rather than resuming a paused study", async () => {
    const plan = expectedPlan();
    await store.putTimeline({
      ...timeline([{ startSeconds: 0, endSeconds: 5, text: "She walks in" }]),
      modelId: DEFAULT_SETTINGS.defaultModelId,
      nextWindow: 1,
      windowCount: plan.windows.length,
    });
    setup();
    await vi.waitFor(() => expect(els.study.button.textContent).toBe("Resume"));
    menuToggle()?.click();
    restartItem()?.click();
    expect(els.study.dialog.open).toBe(true);
    vi.mocked(runStudy).mockImplementationOnce((deps) => Promise.resolve(deps.timeline));
    startStudy();
    await vi.waitFor(() => expect(runStudy).toHaveBeenCalled());
    expect(confirm).toHaveBeenCalledWith("Replace the existing timeline with a new study?");
    expect(vi.mocked(runStudy).mock.calls[0]?.[0].timeline.nextWindow).toBe(0);
  });

  it("is disabled while another video is studied", async () => {
    const study = setup();
    const running = hangingStudy();
    study.open();
    startStudy();
    await vi.waitFor(() => expect(running.deps()).toBeDefined());
    const other = { ...blankChat("m", "other", 2), video: { ...VIDEO, fileKey: "other-key" } };
    replaceChat(state, other);
    setCurrentChat(state, other, []);
    study.render();
    expect(els.study.button.textContent).toBe("Study video");
    expect(els.study.button.disabled).toBe(true);
    study.pause();
  });
});

describe("the study menu and Escape", () => {
  it("claims the Escape that closes its menu, so the drawer and shortcuts leave it", async () => {
    await store.putTimeline({
      ...timeline([{ startSeconds: 0, endSeconds: 5, text: "She walks in" }]),
      nextWindow: 1,
      windowCount: 3,
    });
    setup();
    await vi.waitFor(() => expect(els.study.button.textContent).toBe("Resume"));
    menuToggle()?.click();
    const escape = new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true });
    menuToggle()?.dispatchEvent(escape);
    expect(escape.defaultPrevented).toBe(true);
    expect(restartItem()?.closest<HTMLElement>(".study-menu")?.hidden).toBe(true);
  });
});

describe("a running study", () => {
  it("stops the study when the chat's video is replaced", async () => {
    const study = setup();
    const running = hangingStudy();
    study.open();
    startStudy();
    await vi.waitFor(() => expect(running.deps()).toBeDefined());
    const chat = state.currentChat;
    if (!chat) throw new Error("No chat");
    replaceChat(state, { ...chat, video: { ...VIDEO, fileKey: "new-key" } });
    study.render();
    expect(running.deps()?.signal.aborted).toBe(true);
  });

  it("stops the study when its chat is deleted", async () => {
    const study = setup();
    const running = hangingStudy();
    study.open();
    startStudy();
    await vi.waitFor(() => expect(running.deps()).toBeDefined());
    removeChat(state, "chat");
    study.render();
    expect(running.deps()?.signal.aborted).toBe(true);
  });

  it("adds each window's entries while the timeline stays read-only", async () => {
    const study = setup();
    const running = hangingStudy();
    study.open();
    startStudy();
    await vi.waitFor(() => expect(running.deps()).toBeDefined());
    const deps = running.deps();
    if (!deps) throw new Error("No study");
    const first = {
      ...deps.timeline,
      entries: [{ startSeconds: 0, endSeconds: 5, text: "Old" }],
      nextWindow: 1,
    };
    await deps.saveTimeline(first);
    deps.onProgress(first);
    const edit = () => els.study.list.querySelector<HTMLButtonElement>(".note-edit");
    expect(edit()?.disabled).toBe(true);
    edit()?.click();
    expect(els.study.list.querySelector(".timeline-input")).toBeNull();
    const second = {
      ...first,
      entries: [...first.entries, { startSeconds: 5, endSeconds: 9, text: "New" }],
      nextWindow: 2,
    };
    await deps.saveTimeline(second);
    deps.onProgress(second);
    expect((await store.getTimeline(VIDEO.fileKey))?.entries.map((entry) => entry.text)).toEqual([
      "Old",
      "New",
    ]);
    expect(study.timeline()?.entries.map((entry) => entry.text)).toEqual(["Old", "New"]);
    study.pause();
    await vi.waitFor(() => expect(edit()?.disabled).toBe(false));
  });
});

describe("the zoom offer", () => {
  it("shows unzoomed unclear moments in the timeline and offers to zoom into them", async () => {
    await flaggedStudy(FLAGS);
    const offer = offerFor(FLAGS);
    expect(offer).toMatch(/^Zoom into 2 unclear moments, about /);
    expect(zoomItem()?.hidden).toBe(false);
    expect(zoomItem()?.textContent).toBe(offer);
    expect(menuToggle()?.hidden).toBe(false);
    expect(els.study.zoomButton.hidden).toBe(false);
    expect(els.study.zoomButton.textContent).toBe(offer);
    const rows = [...els.study.list.children].map((row) => row.textContent);
    expect(rows).toEqual([
      expect.stringContaining("She walks in"),
      "[0:04-0:06] Unclear: a quick gesture",
      expect.stringContaining("She sits"),
      "[5:00-5:02] Unclear: a sign too small to read",
    ]);
    const unclearRow = els.study.list.querySelector(".timeline-unclear");
    unclearRow?.querySelector<HTMLButtonElement>(".timestamp")?.click();
    expect(openPlayer).toHaveBeenCalledWith(4);
    expect(els.study.list.querySelectorAll(".timeline-zoomed")).toHaveLength(1);
  });

  it("is not offered once every unclear moment is zoomed", async () => {
    await flaggedStudy(FLAGS.map((span) => ({ ...span, zoomed: true })));
    expect(zoomItem()?.hidden).toBe(true);
    expect(els.study.zoomButton.hidden).toBe(true);
    expect(els.study.list.querySelectorAll(".timeline-unclear")).toHaveLength(0);
  });

  it("is not offered while a zoom runs, and comes back when it pauses", async () => {
    await flaggedStudy(FLAGS);
    const running = hangingZoom();
    els.study.zoomButton.click();
    await vi.waitFor(() => expect(running.deps()).toBeDefined());
    expect(running.deps()?.plan.zooms).toHaveLength(2);
    expect(zoomItem()?.hidden).toBe(true);
    expect(els.study.zoomButton.hidden).toBe(true);
    expect(els.study.button.textContent).toBe("Pause");
    els.study.button.click();
    await vi.waitFor(() => expect(els.study.zoomButton.hidden).toBe(false));
    expect(els.study.zoomButton.textContent).toBe(offerFor(FLAGS.slice(1)));
  });
});
