import { beforeEach, describe, expect, it, vi } from "vitest";
import { blankChat } from "../src/chat/chats";
import {
  removeChat,
  replaceChat,
  setCurrentChat,
  setLookingModels,
  setSettings,
} from "../src/state";
import { pickRow } from "./support/picker";
import type * as StudyModule from "../src/video/study";
import { runStudy } from "../src/video/study";
import {
  FLAGS,
  VIDEO,
  confirm,
  els,
  expectedPlan,
  flaggedStudy,
  focusComposer,
  hangingStudy,
  hangingZoom,
  menuToggle,
  model,
  onRemoveVideo,
  offerFor,
  openPlayer,
  planFor,
  reloadPage,
  removeBlocker,
  removeItem,
  resetStudy,
  restartItem,
  setInput,
  setup,
  shownItems,
  STUDY_MODEL_ID,
  startStudy,
  state,
  status,
  store,
  timeline,
  zoomItem,
} from "./support/study";

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
    const plan = planFor(STUDY_MODEL_ID, ranged);
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
      modelId: STUDY_MODEL_ID,
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
    expect(shownItems()).toEqual(["Remove from chat"]);
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
      modelId: STUDY_MODEL_ID,
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

describe("removing the video from the study menu", () => {
  it("hands over the chat's video, naming it on the item", () => {
    setup();
    menuToggle()?.click();
    expect(removeItem()?.title).toContain(VIDEO.name);
    expect(removeItem()?.getAttribute("aria-disabled")).toBe("false");
    removeItem()?.click();
    expect(onRemoveVideo).toHaveBeenCalledWith(VIDEO);
  });

  it("shows the reason it cannot be used, as of when the menu opens", () => {
    setup();
    removeBlocker.mockReturnValue("Stop or wait for the reply.");
    menuToggle()?.click();
    expect(removeItem()?.getAttribute("aria-disabled")).toBe("true");
    expect(removeItem()?.title).toBe("Stop or wait for the reply.");
  });

  it("says in which chat a study runs", () => {
    const study = setup();
    hangingStudy();
    study.open();
    startStudy();
    expect(study.isRunningIn("chat")).toBe(true);
    expect(study.isRunningIn("other")).toBe(false);
  });

  it("moves focus to the composer when the menu it was in goes", () => {
    const study = setup();
    onRemoveVideo.mockImplementation(() => {
      replaceChat(state, blankChat("m", "chat", 1));
      study.render();
    });
    menuToggle()?.click();
    removeItem()?.click();
    expect(focusComposer).toHaveBeenCalledTimes(1);
  });

  it("leaves focus on the menu's button when nothing was removed", () => {
    const study = setup();
    menuToggle()?.click();
    removeItem()?.click();
    study.render();
    expect(document.activeElement).toBe(menuToggle());
    expect(focusComposer).not.toHaveBeenCalled();
  });

  it("hides the control once the chat has no video", () => {
    const study = setup();
    menuToggle()?.click();
    const chat = blankChat("m", "chat", 1);
    replaceChat(state, chat);
    study.render();
    expect(menuToggle()?.closest<HTMLElement>(".study-control")?.hidden).toBe(true);
    expect(menuToggle()?.getAttribute("aria-expanded")).toBe("false");
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

describe("studying with a looking model", () => {
  const own = "http://localhost:5001/v1";

  function lookingChat(): void {
    setSettings(state, { ...state.settings, lookingBaseUrl: own, apiKeys: { [own]: "key" } });
    setLookingModels(state, [model("eyes"), model("other-eyes")]);
    const chat = { ...blankChat(STUDY_MODEL_ID, "chat", 1, "eyes", own), video: VIDEO };
    replaceChat(state, chat);
    setCurrentChat(state, chat, []);
  }

  it("studies with it, on its own connection", async () => {
    lookingChat();
    vi.mocked(runStudy).mockImplementationOnce((deps) => Promise.resolve(deps.timeline));
    setup().open();
    startStudy();
    await vi.waitFor(() => expect(runStudy).toHaveBeenCalled());
    expect(vi.mocked(runStudy).mock.calls[0]?.[0]).toMatchObject({
      api: { baseUrl: own, apiKey: "key" },
      model: { id: "eyes" },
      timeline: { modelId: "eyes" },
      veniceParameters: false,
    });
  });

  it("goes on with another model picked for it, and prices no mix", async () => {
    lookingChat();
    vi.mocked(runStudy).mockImplementationOnce(async (deps) => {
      const usage = { promptTokens: 10, completionTokens: 1 };
      const progress = { ...deps.timeline, nextWindow: 1, usage };
      await deps.saveTimeline(progress);
      return progress;
    });
    setup().open();
    pickRow(els.study.modelPicker, "other-eyes");
    startStudy();
    await vi.waitFor(() => expect(els.study.button.textContent).toBe("Resume"));
    vi.mocked(runStudy).mockImplementationOnce((deps) => Promise.resolve(deps.timeline));
    els.study.button.click();
    await vi.waitFor(() => expect(runStudy).toHaveBeenCalledTimes(2));
    expect(vi.mocked(runStudy).mock.calls[1]?.[0].model.id).toBe("other-eyes");
    reloadPage();
    setup();
    await vi.waitFor(() => expect(els.study.button.textContent).toBe("Resume"));
    vi.mocked(runStudy).mockImplementationOnce((deps) => Promise.resolve(deps.timeline));
    els.study.button.click();
    await vi.waitFor(() => expect(runStudy).toHaveBeenCalledTimes(3));
    const again = vi.mocked(runStudy).mock.calls[2]?.[0];
    expect(again?.model.id).toBe("eyes");
    expect(again?.timeline.modelId).toBe("other-eyes");
    expect((await store.getTimeline(VIDEO.fileKey))?.modelId).toBe("other-eyes");
    if (!again) throw new Error("No study");
    await again.saveTimeline({ ...again.timeline, nextWindow: 2 });
    expect(await store.getTimeline(VIDEO.fileKey)).toMatchObject({
      modelId: "eyes",
      mixedModels: true,
    });
  });

  it("plans again to resume with a model that takes fewer pictures", async () => {
    lookingChat();
    vi.mocked(runStudy).mockImplementationOnce(async (deps) => {
      const progress = { ...deps.timeline, nextWindow: 1 };
      await deps.saveTimeline(progress);
      return progress;
    });
    setup().open();
    setInput(els.study.densityInput, "dense");
    startStudy();
    await vi.waitFor(() => expect(els.study.button.textContent).toBe("Resume"));
    const studied = vi.mocked(runStudy).mock.calls[0]?.[0].plan;
    expect(studied?.sheetsPerWindow).toBeGreaterThan(1);
    const other = "http://localhost:5002/v1";
    setSettings(state, { ...state.settings, lookingBaseUrl: other, apiKeys: { [other]: "key" } });
    setLookingModels(state, [{ ...model("narrow"), maxImages: 1 }]);
    const chat = { ...blankChat(STUDY_MODEL_ID, "chat", 1, "narrow", other), video: VIDEO };
    replaceChat(state, chat);
    vi.mocked(runStudy).mockImplementationOnce((deps) => Promise.resolve(deps.timeline));
    els.study.button.click();
    await vi.waitFor(() => expect(runStudy).toHaveBeenCalledTimes(2));
    const resumed = vi.mocked(runStudy).mock.calls[1]?.[0];
    expect(resumed?.model.id).toBe("narrow");
    expect(resumed?.plan.sheetsPerWindow).toBe(1);
    expect(resumed?.plan.windows).toEqual(studied?.windows);
  });

  it("confirms and changes nothing when its server is no longer set up", async () => {
    const done = timeline([{ startSeconds: 0, endSeconds: 5, text: "She walks in" }]);
    await store.putTimeline(done);
    lookingChat();
    setSettings(state, { ...state.settings, lookingBaseUrl: "" });
    setup().open();
    await vi.waitFor(() => expect(els.study.list.children).toHaveLength(1));
    startStudy();
    await vi.waitFor(() =>
      expect(status.show).toHaveBeenCalledWith(
        expect.stringContaining("picked on localhost:5001"),
        "error",
      ),
    );
    expect(confirm).not.toHaveBeenCalled();
    expect(runStudy).not.toHaveBeenCalled();
    expect(await store.getTimeline(VIDEO.fileKey)).toEqual(done);
  });

  it("resumes another model's study with it", async () => {
    lookingChat();
    const plan = planFor("eyes");
    await store.putTimeline({
      ...timeline([{ startSeconds: 0, endSeconds: 5, text: "She walks in" }]),
      modelId: STUDY_MODEL_ID,
      nextWindow: 1,
      windowCount: plan.windows.length,
    });
    setup();
    await vi.waitFor(() => expect(els.study.button.textContent).toBe("Resume"));
    vi.mocked(runStudy).mockImplementationOnce((deps) => Promise.resolve(deps.timeline));
    els.study.button.click();
    await vi.waitFor(() => expect(runStudy).toHaveBeenCalled());
    expect(vi.mocked(runStudy).mock.calls[0]?.[0].model.id).toBe("eyes");
  });
});
