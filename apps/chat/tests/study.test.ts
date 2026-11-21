import { describe, expect, it, vi } from "vitest";
import type {
  ChatRequest,
  ImageRef,
  ImageStore,
  SheetCache,
  StreamChat,
  StreamEvent,
  TokenUsage,
  VideoTimeline,
} from "../src/types";
import type { RenderedSheet } from "../src/video/render";
import {
  STUDY_SYSTEM_PROMPT,
  ZOOM_SYSTEM_PROMPT,
  newTimeline,
  planStudy,
  planZoom,
  runStudy,
  runZoom,
  type StudyDeps,
  type StudyPlan,
} from "../src/video/study";
import type { ToolContext } from "../src/video/tools";
import { model } from "./support/factories";
import { WIDE, flag, spans, zoomInput } from "./support/studyFixtures";

class FakeStore implements ImageStore, SheetCache {
  readonly images = new Map<string, Blob>();
  readonly sheets = new Map<string, ImageRef[]>();

  putImage(blob: Blob): Promise<string> {
    const id = `img-${this.images.size + 1}`;
    this.images.set(id, blob);
    return Promise.resolve(id);
  }

  getImage(id: string): Promise<Blob | undefined> {
    return Promise.resolve(this.images.get(id));
  }

  getSheets(key: string): Promise<ImageRef[] | undefined> {
    return Promise.resolve(this.sheets.get(key));
  }

  putSheets(key: string, refs: ImageRef[]): Promise<void> {
    this.sheets.set(key, refs);
    return Promise.resolve();
  }
}

describe("study prompts", () => {
  it("places UNCLEAR lines in time order beside the entry", () => {
    expect(STUDY_SYSTEM_PROMPT).toContain("in time order beside that entry");
    expect(STUDY_SYSTEM_PROMPT).toContain("UNCLEAR lines are the only other lines allowed");
  });

  it("explains the unclear context lines and keeps zoom output inside the stretch", () => {
    expect(ZOOM_SYSTEM_PROMPT).toContain("Lines marked unclear say what the coarse pass");
    expect(ZOOM_SYSTEM_PROMPT).toContain("Write entries only within this stretch.");
    expect(ZOOM_SYSTEM_PROMPT).toContain("the coarse timeline of the same stretch");
    expect(ZOOM_SYSTEM_PROMPT).toContain("say so inside that entry's text");
    expect(ZOOM_SYSTEM_PROMPT).not.toContain("correcting the coarse one");
  });
});

function textEvents(text: string, usage?: TokenUsage): StreamEvent[] {
  return [
    { type: "reasoning", delta: "[0:00] thinking aloud" },
    { type: "text", delta: text.slice(0, 5) },
    { type: "text", delta: text.slice(5) },
    ...(usage === undefined ? [] : [{ type: "usage", usage } satisfies StreamEvent]),
    { type: "done", finishReason: "stop" },
  ];
}

const REPLIES = [
  "[0:00.0-0:10.0] A man walks in.\n[0:10-0:45] He sits down.",
  "[0:45-1:30] He reads a letter.",
  "[1:30-2:00] He leaves.",
];

const fakeRender: NonNullable<ToolContext["render"]> = (_file, _info, values) => {
  const start = values.startSeconds ?? 0;
  const sheet: RenderedSheet = {
    name: `grid_${start}`,
    blob: new Blob([`sheet ${start}`], { type: "image/jpeg" }),
    startSeconds: start,
    endSeconds: values.endSeconds ?? start,
    frameCount: values.frameCount ?? 1,
  };
  return Promise.resolve([sheet]);
};

function studyContext(store: FakeStore): ToolContext {
  return {
    file: new File(["x"], "clip.mp4"),
    info: { durationSeconds: 120, width: 1920, height: 1080 },
    video: {
      name: "clip.mp4",
      fileKey: "clip|1|2",
      durationSeconds: 120,
      width: 1920,
      height: 1080,
    },
    resolution: 1024,
    maxImages: 10,
    store,
    render: vi.fn(fakeRender),
  };
}

function scriptedStream(
  replies: (string | Error)[],
  requests: ChatRequest[],
  usages: (TokenUsage | undefined)[] = [],
): StreamChat {
  const queue = [...replies];
  return async function* (_settings, request) {
    await Promise.resolve();
    const usage = usages[requests.length];
    requests.push(request);
    const reply = queue.shift() ?? "";
    if (reply instanceof Error) throw reply;
    yield* textEvents(reply, usage);
  };
}

function studySetup(
  options: {
    replies?: (string | Error)[];
    usages?: (TokenUsage | undefined)[];
    timeline?: Partial<VideoTimeline>;
    veniceParameters?: boolean;
  } = {},
) {
  const controller = new AbortController();
  const ctx = studyContext(new FakeStore());
  const render = vi.mocked(ctx.render ?? fakeRender);
  const studyModel = model("qwen3-6-27b");
  const plan: StudyPlan = planStudy({
    durationSeconds: 120,
    sourceAspect: WIDE,
    resolution: 1024,
    model: studyModel,
  });
  const requests: ChatRequest[] = [];
  const saved: VideoTimeline[] = [];
  const saveTimeline = vi.fn((timeline: VideoTimeline) => {
    saved.push(timeline);
    return Promise.resolve();
  });
  const onProgress = vi.fn<(timeline: VideoTimeline) => void>();
  const deps: StudyDeps = {
    ctx,
    plan,
    model: studyModel,
    api: { baseUrl: "https://example.test/v1", apiKey: "" },
    streamChat: scriptedStream(options.replies ?? REPLIES, requests, options.usages),
    veniceParameters: options.veniceParameters ?? false,
    timeline: { ...newTimeline("clip|1|2", studyModel.id, plan, 0), ...options.timeline },
    saveTimeline,
    signal: controller.signal,
    onProgress,
  };
  return { deps, controller, render, requests, saved, saveTimeline, onProgress, plan };
}

describe("runStudy", () => {
  it("studies every window, parsing the replies into the timeline", async () => {
    const { deps, saved, onProgress, render } = studySetup();
    const timeline = await runStudy(deps);
    expect(render).toHaveBeenCalledTimes(3);
    expect(timeline.entries).toEqual([
      { startSeconds: 0, endSeconds: 10, text: "A man walks in." },
      { startSeconds: 10, endSeconds: 45, text: "He sits down." },
      { startSeconds: 45, endSeconds: 90, text: "He reads a letter." },
      { startSeconds: 90, endSeconds: 120, text: "He leaves." },
    ]);
    expect(timeline.nextWindow).toBe(3);
    expect(saved.map((entry) => entry.nextWindow)).toEqual([1, 2, 3]);
    expect(saved.map((entry) => entry.entries.length)).toEqual([2, 3, 4]);
    expect(onProgress.mock.calls.map(([progress]) => progress)).toEqual(saved);
    expect(timeline.updatedAt).toBeGreaterThan(0);
  });
});

describe("runStudy over a range", () => {
  it("renders each window of a ranged plan at the plan's density", async () => {
    const { deps, render } = studySetup({ replies: ["[1:00-1:20] He reads."] });
    const plan = planStudy({
      durationSeconds: 120,
      sourceAspect: WIDE,
      resolution: 1024,
      model: deps.model,
      startSeconds: 60,
      endSeconds: 80,
      framesPerWindow: 12,
    });
    const timeline = await runStudy({
      ...deps,
      plan,
      timeline: newTimeline("clip|1|2", deps.model.id, plan, 0),
    });
    expect(render).toHaveBeenCalledTimes(1);
    expect(render.mock.calls[0]?.[2]).toMatchObject({
      startSeconds: 60,
      endSeconds: 80,
      frameCount: plan.perSheet,
      framesPerGrid: plan.perSheet,
    });
    expect(timeline.entries).toEqual([{ startSeconds: 60, endSeconds: 80, text: "He reads." }]);
    expect(timeline.nextWindow).toBe(1);
  });
});

describe("runStudy request shape", () => {
  it("sends each window alone, with no tools, the study prompt and labelled sheets", async () => {
    const { deps, requests, render, plan } = studySetup({ veniceParameters: true });
    await runStudy(deps);
    expect(render.mock.calls[1]?.[2]).toEqual({
      startSeconds: 45,
      endSeconds: 90,
      frameCount: plan.framesPerWindow,
      framesPerGrid: plan.perSheet,
      outputResolution: 1024,
    });
    const request = requests[1];
    expect(request).not.toHaveProperty("tools");
    expect(request).toMatchObject({
      model: "qwen3-6-27b",
      stream: true,
      venice_parameters: { include_venice_system_prompt: false },
    });
    expect(request?.messages[0]).toEqual({ role: "system", content: STUDY_SYSTEM_PROMPT });
    const user = request?.messages[1];
    expect(user?.role).toBe("user");
    const content = user?.role === "user" && Array.isArray(user.content) ? user.content : [];
    expect(content[0]).toEqual({ type: "text", text: "Frames from 0:45 to 1:30 of the video." });
    expect(content[1]).toEqual({
      type: "text",
      text: `grid_45: 0:45 to 1:30, ${plan.framesPerWindow} frames`,
    });
    const image = content[2];
    expect(image?.type === "image_url" ? image.image_url.url : "").toMatch(/^data:image\/jpeg/);
    expect(content).toHaveLength(3);
  });
});

describe("runStudy requests", () => {
  it("leaves out venice_parameters when not asked, and asks for usage", async () => {
    const { deps, requests } = studySetup();
    await runStudy(deps);
    expect(requests[0]).not.toHaveProperty("venice_parameters");
    expect(requests[0]?.stream_options).toEqual({ include_usage: true });
  });

  it("resumes from nextWindow", async () => {
    const earlier = { startSeconds: 0, endSeconds: 45, text: "Earlier." };
    const { deps, render, saved } = studySetup({
      replies: REPLIES.slice(1),
      timeline: { nextWindow: 1, entries: [earlier] },
    });
    const timeline = await runStudy(deps);
    expect(render.mock.calls.map((renderCall) => renderCall[2].startSeconds)).toEqual([45, 90]);
    expect(timeline.entries[0]).toEqual(earlier);
    expect(timeline.entries).toHaveLength(3);
    expect(saved).toHaveLength(2);
  });

  it("reuses cached sheets on a second study", async () => {
    const first = studySetup({ replies: [...REPLIES, ...REPLIES] });
    await runStudy(first.deps);
    await runStudy({ ...first.deps, timeline: { ...first.deps.timeline, nextWindow: 0 } });
    expect(first.render).toHaveBeenCalledTimes(3);
  });
});

describe("runStudy stopping", () => {
  it("returns the progress saved so far when aborted between windows", async () => {
    const { deps, controller, render, saved, onProgress } = studySetup();
    onProgress.mockImplementation(() => controller.abort());
    const timeline = await runStudy(deps);
    expect(render).toHaveBeenCalledTimes(1);
    expect(timeline.nextWindow).toBe(1);
    expect(timeline).toEqual(saved[0]);
  });

  it("discards a render that finishes after the abort", async () => {
    const { deps, controller, render, saveTimeline, requests } = studySetup();
    render.mockImplementationOnce(() => {
      controller.abort();
      return Promise.resolve([]);
    });
    const timeline = await runStudy(deps);
    expect(timeline).toEqual(deps.timeline);
    expect(saveTimeline).not.toHaveBeenCalled();
    expect(requests).toHaveLength(0);
  });

  it("returns saved progress when the stream fails because of the abort", async () => {
    const { deps, controller, saved } = studySetup();
    const scripted = deps.streamChat;
    const abortingStream: StreamChat = async function* (settings, request, signal) {
      if (saved.length === 1) {
        controller.abort();
        throw new Error("The operation was aborted.");
      }
      yield* scripted(settings, request, signal);
    };
    const timeline = await runStudy({ ...deps, streamChat: abortingStream });
    expect(timeline.nextWindow).toBe(1);
    expect(saved).toHaveLength(1);
  });

  it("throws an error naming the window, keeping earlier windows saved", async () => {
    const { deps, saved } = studySetup({ replies: [REPLIES[0] ?? "", new Error("boom")] });
    await expect(runStudy(deps)).rejects.toThrow("Study window 2 of 3 (0:45 to 1:30) failed: boom");
    expect(saved).toHaveLength(1);
    expect(saved[0]?.nextWindow).toBe(1);
  });

  it("fails a window whose reply is empty, so a resume studies it again", async () => {
    const { deps, saved } = studySetup({ replies: [REPLIES[0] ?? "", " \n"] });
    await expect(runStudy(deps)).rejects.toThrow(
      "Study window 2 of 3 (0:45 to 1:30) failed: The reply had nothing for this window.",
    );
    expect(saved).toHaveLength(1);
    expect(saved[0]?.nextWindow).toBe(1);
  });
});

describe("runStudy entries outside the window", () => {
  it("clamps entries to the window and drops those outside it", async () => {
    const { deps, saved } = studySetup({
      replies: [
        "[0:00-0:50] A man walks in.\n[1:40-1:50] He leaves.\n[0:44] He turns.",
        ...REPLIES.slice(1),
      ],
    });
    await runStudy(deps);
    expect(saved[0]?.entries).toEqual([
      { startSeconds: 0, endSeconds: 45, text: "A man walks in." },
      { startSeconds: 44, endSeconds: 44, text: "He turns." },
    ]);
  });

  it("fails a window whose entries all lie outside it", async () => {
    const { deps, saved } = studySetup({ replies: ["[1:40-1:50] He leaves."] });
    await expect(runStudy(deps)).rejects.toThrow("The reply had nothing for this window.");
    expect(saved).toHaveLength(0);
  });

  it("fails a window whose reply flags only moments outside it", async () => {
    const { deps, saved } = studySetup({ replies: ["UNCLEAR [1:40-1:50] a blur"] });
    await expect(runStudy(deps)).rejects.toThrow("The reply had nothing for this window.");
    expect(saved).toHaveLength(0);
  });
});

describe("runStudy usage", () => {
  it("adds each window's usage into the timeline before saving", async () => {
    const { deps, saved } = studySetup({
      usages: [
        { promptTokens: 1000, completionTokens: 100 },
        undefined,
        { promptTokens: 900, completionTokens: 50, cachedTokens: 400, reasoningTokens: 20 },
      ],
    });
    const timeline = await runStudy(deps);
    expect(saved.map((entry) => entry.usage)).toEqual([
      { promptTokens: 1000, completionTokens: 100 },
      { promptTokens: 1000, completionTokens: 100 },
      { promptTokens: 1900, completionTokens: 150, cachedTokens: 400, reasoningTokens: 20 },
    ]);
    expect(timeline.usage).toEqual(saved[2]?.usage);
  });

  it("adds to the usage of a resumed study", async () => {
    const { deps } = studySetup({
      replies: REPLIES.slice(2),
      usages: [{ promptTokens: 10, completionTokens: 1 }],
      timeline: { nextWindow: 2, usage: { promptTokens: 5, completionTokens: 2, cachedTokens: 3 } },
    });
    const timeline = await runStudy(deps);
    expect(timeline.usage).toEqual({ promptTokens: 15, completionTokens: 3, cachedTokens: 3 });
  });

  it("leaves usage out when the server never reports it", async () => {
    const { deps } = studySetup();
    expect(await runStudy(deps)).not.toHaveProperty("usage");
  });
});

describe("runStudy unclear moments", () => {
  it("collects each window's unclear spans on the timeline", async () => {
    const { deps, saved } = studySetup({
      replies: [
        "[0:00-0:45] A man walks in.\nUNCLEAR [0:20-0:22] what he drops",
        "[0:45-1:30] He reads a letter.",
        "[1:30-2:00] He leaves.\nUNCLEAR [1:50] a face at the window",
      ],
    });
    const timeline = await runStudy(deps);
    expect(saved[0]?.unclear).toEqual([
      { startSeconds: 20, endSeconds: 22, reason: "what he drops" },
    ]);
    expect(timeline.unclear).toEqual([
      { startSeconds: 20, endSeconds: 22, reason: "what he drops" },
      { startSeconds: 110, endSeconds: 110, reason: "a face at the window" },
    ]);
    expect(timeline.entries.map((entry) => entry.text)).toEqual([
      "A man walks in.",
      "He reads a letter.",
      "He leaves.",
    ]);
  });

  it("leaves unclear out when nothing was flagged", async () => {
    const { deps } = studySetup();
    expect(await runStudy(deps)).not.toHaveProperty("unclear");
  });
});

const COARSE: VideoTimeline["entries"] = [
  { startSeconds: 0, endSeconds: 10, text: "A man walks in." },
  { startSeconds: 10, endSeconds: 14, text: "He picks something up." },
  { startSeconds: 14, endSeconds: 45, text: "He sits down." },
  { startSeconds: 60, endSeconds: 62, text: "A blur." },
  { startSeconds: 62, endSeconds: 90, text: "He reads." },
];

const FLAGGED = [flag(11, 13, { reason: "what he picks up" }), flag(60, 62, { reason: "a shape" })];

const ZOOM_REPLIES = [
  "[0:10.0-0:12.0] He picks up a red key.\n[0:12-0:14] He pockets it.",
  "[0:59-1:03] A bird flies past the window.",
];

function zoomSetup(
  replies: (string | Error)[] = ZOOM_REPLIES,
  unclear = FLAGGED,
  usages: (TokenUsage | undefined)[] = [],
) {
  const setup = studySetup({ replies, usages });
  const timeline: VideoTimeline = { ...setup.deps.timeline, entries: COARSE, unclear };
  const plan = planZoom(zoomInput(unclear));
  return { ...setup, zoomDeps: { ...setup.deps, plan, timeline }, zoomPlan: plan };
}

describe("runZoom", () => {
  it("replaces the entries lying mostly inside each zoom and marks the zoom", async () => {
    const { zoomDeps, saved, onProgress } = zoomSetup();
    const timeline = await runZoom(zoomDeps);
    expect(timeline.entries).toEqual([
      COARSE[0],
      { startSeconds: 10, endSeconds: 12, text: "He picks up a red key.", zoomed: true },
      { startSeconds: 12, endSeconds: 14, text: "He pockets it.", zoomed: true },
      COARSE[2],
      { startSeconds: 59, endSeconds: 63, text: "A bird flies past the window.", zoomed: true },
      COARSE[4],
    ]);
    expect(timeline.unclear).toEqual(FLAGGED.map((span) => ({ ...span, zoomed: true })));
    expect(saved).toHaveLength(2);
    expect(saved[0]?.unclear?.map((span) => span.zoomed)).toEqual([true, undefined]);
    expect(onProgress.mock.calls.map(([progress]) => progress)).toEqual(saved);
  });

  it("renders each zoom densely and sends the coarse entries as context", async () => {
    const { zoomDeps, zoomPlan, render, requests } = zoomSetup();
    await runZoom(zoomDeps);
    expect(render.mock.calls[0]?.[2]).toMatchObject({
      startSeconds: 10,
      endSeconds: 14,
      frameCount: zoomPlan.zooms[0]?.frameCount,
      framesPerGrid: zoomPlan.perSheet,
    });
    expect(requests[0]?.messages[0]).toEqual({ role: "system", content: ZOOM_SYSTEM_PROMPT });
    const user = requests[0]?.messages[1];
    const content = user?.role === "user" && Array.isArray(user.content) ? user.content : [];
    expect(content[0]).toEqual({
      type: "text",
      text: "Frames from 0:10.0 to 0:14.0 of the video.",
    });
    const context = content[1]?.type === "text" ? content[1].text : "";
    expect(context).toContain("Coarse timeline for this stretch:");
    expect(context).toContain("[0:10.0 to 0:14.0] He picks something up.");
    expect(context).toContain("[0:11.0 to 0:13.0] unclear: what he picks up");
    expect(context).not.toContain("He reads.");
  });
});

describe("runZoom stopping and resuming", () => {
  it("saves after each zoom, so a fresh plan after an abort covers only what is left", async () => {
    const { zoomDeps, controller, onProgress, saved } = zoomSetup();
    onProgress.mockImplementationOnce(() => controller.abort());
    const paused = await runZoom(zoomDeps);
    expect(saved).toHaveLength(1);
    expect(paused).toEqual(saved[0]);
    const remaining = planZoom(zoomInput(paused.unclear ?? []));
    expect(remaining.zooms.map((zoom) => [zoom.startSeconds, zoom.endSeconds])).toEqual([[59, 63]]);
    const resumed = zoomSetup(ZOOM_REPLIES.slice(1), paused.unclear);
    const timeline = await runZoom({ ...resumed.zoomDeps, plan: remaining, timeline: paused });
    expect(resumed.render).toHaveBeenCalledTimes(1);
    expect(timeline.entries.filter((entry) => entry.zoomed === true)).toHaveLength(3);
    expect(timeline.unclear?.every((span) => span.zoomed === true)).toBe(true);
  });

  it("builds on the shown timeline, so an edit made meanwhile stays", async () => {
    const { zoomDeps } = zoomSetup();
    const edited = { startSeconds: 0, endSeconds: 10, text: "Edited" };
    const shown = { ...zoomDeps.timeline, entries: [edited, ...COARSE.slice(1)] };
    const timeline = await runZoom({ ...zoomDeps, current: () => shown });
    expect(timeline.entries[0]?.text).toBe("Edited");
  });

  it("plans exactly the rest of a split stretch after a pause", async () => {
    const stretch = [flag(10, 38, { reason: "a crowd" })];
    const { zoomDeps, zoomPlan, controller, onProgress } = zoomSetup(
      ["[0:09-0:24] People push forward."],
      stretch,
    );
    expect(zoomPlan.zooms.map((zoom) => [zoom.startSeconds, zoom.endSeconds])).toEqual([
      [9, 24],
      [24, 39],
    ]);
    onProgress.mockImplementationOnce(() => controller.abort());
    const paused = await runZoom(zoomDeps);
    expect(paused.unclear).toEqual([
      flag(10, 24, { reason: "a crowd", zoomed: true }),
      flag(24, 38, { reason: "a crowd" }),
    ]);
    expect(spans(zoomInput(paused.unclear ?? []))).toEqual([[24, 39]]);
  });
});

describe("runZoom replies", () => {
  it("keeps the coarse entries and the flag when a zoom comes back empty", async () => {
    const { zoomDeps } = zoomSetup(["", ZOOM_REPLIES[1] ?? ""]);
    const timeline = await runZoom(zoomDeps);
    expect(timeline.entries.slice(0, 3)).toEqual(COARSE.slice(0, 3));
    expect(timeline.unclear?.[0]).toEqual(FLAGGED[0]);
    expect(spans(zoomInput(timeline.unclear ?? []))).toEqual([[10, 14]]);
  });

  it("keeps the flag when a zoom reply has only UNCLEAR lines, adding its usage", async () => {
    const { zoomDeps } = zoomSetup(
      ["UNCLEAR [0:11-0:13] still a blur", ZOOM_REPLIES[1] ?? ""],
      FLAGGED,
      [{ promptTokens: 100, completionTokens: 10 }],
    );
    const timeline = await runZoom(zoomDeps);
    expect(timeline.entries.slice(0, 3)).toEqual(COARSE.slice(0, 3));
    expect(timeline.unclear?.[0]).toEqual(FLAGGED[0]);
    expect(timeline.usage).toEqual({ promptTokens: 100, completionTokens: 10 });
  });

  it("clamps reply entries to the zoom and drops those outside it", async () => {
    const { zoomDeps } = zoomSetup([
      "[0:08-0:12] He picks up a red key.\n[0:14-0:45] He sits down.\n[0:13] He looks up.",
      "",
    ]);
    const timeline = await runZoom(zoomDeps);
    expect(timeline.entries.slice(0, 4)).toEqual([
      COARSE[0],
      { startSeconds: 10, endSeconds: 12, text: "He picks up a red key.", zoomed: true },
      { startSeconds: 13, endSeconds: 13, text: "He looks up.", zoomed: true },
      COARSE[2],
    ]);
    expect(timeline.entries.filter((entry) => entry.text === "He sits down.")).toHaveLength(1);
  });

  it("keeps a coarse entry lying mostly outside a short zoom", async () => {
    const unclear = [flag(60, 62)];
    const { zoomDeps } = zoomSetup(["[0:59-1:03] A bird flies past."], unclear);
    const long = { startSeconds: 55, endSeconds: 65, text: "He waves." };
    const timeline = await runZoom({
      ...zoomDeps,
      timeline: { ...zoomDeps.timeline, entries: [long] },
    });
    expect(timeline.entries).toEqual([
      long,
      { startSeconds: 59, endSeconds: 63, text: "A bird flies past.", zoomed: true },
    ]);
  });

  it("throws an error naming the zoom", async () => {
    const { zoomDeps } = zoomSetup([new Error("boom")]);
    await expect(runZoom(zoomDeps)).rejects.toThrow("Zoom 1 of 2 (0:10.0 to 0:14.0) failed: boom");
  });
});
