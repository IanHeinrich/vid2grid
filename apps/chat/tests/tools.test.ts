import { Vid2GridError, type AudioTrack } from "@vid2grid/core";
import { describe, expect, it, vi } from "vitest";
import { AudioDecodeError, type AnalyseAudio } from "../src/audio/videoAudio";
import { createMemoryStore } from "../src/chat/store";
import type { ImageRef, ImageStore, SheetCache, ToolCall, VideoAttachment } from "../src/types";
import type { RenderedSheet } from "../src/video/render";
import { sheetCacheKey } from "../src/video/sheetCache";
import {
  createToolRunner,
  renderOverview,
  toolOffer,
  type ToolContext,
  type ToolRunnerContext,
} from "../src/video/tools";
import { MAX_LISTEN_LINES } from "../src/video/listenTool";

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

const video: VideoAttachment = {
  name: "clip.mp4",
  fileKey: "clip.mp4|1|7",
  durationSeconds: 120,
  width: 1920,
  height: 1080,
};

function secondsFrom(start: number, count: number): number[] {
  return Array.from({ length: count }, (_, index) => start + index);
}

function sheet(name: string, startSeconds: number, endSeconds: number, frameCount: number) {
  const cellTimes = secondsFrom(startSeconds, frameCount);
  return { name, blob: new Blob([name]), startSeconds, endSeconds, frameCount, cellTimes };
}

const OFFER = toolOffer({ videoLoaded: true, images: true, vision: true, listen: false });

function runnerContext(sheets: ToolContext, extra: Partial<ToolRunnerContext> = {}) {
  const { store, resolution, maxImages } = sheets;
  return { store, resolution, maxImages, sheets, tools: OFFER.tools, ...extra };
}

function setup(sheets: RenderedSheet[] = [sheet("grid_0001", 60, 89, 16)]) {
  const store = new FakeStore();
  const render = vi.fn<NonNullable<ToolContext["render"]>>(() => Promise.resolve(sheets));
  const ctx: ToolContext = {
    file: new File(["x"], "clip.mp4"),
    info: { durationSeconds: 120, width: 1920, height: 1080 },
    video,
    resolution: 1568,
    maxImages: 10,
    store,
    render,
  };
  return { ctx, store, render, run: createToolRunner(runnerContext(ctx)) };
}

function call(name: string, args: unknown): ToolCall {
  return { id: "call-1", name, arguments: typeof args === "string" ? args : JSON.stringify(args) };
}

const LISTEN_LABELS = { labels: ["music", "applause"], backgroundLabels: ["silence"] };

const HEARD_AT_A_MINUTE: Pick<AudioTrack, "speech" | "events"> = {
  speech: [{ start: 62, end: 65, text: "Over here." }],
  events: [
    {
      startSeconds: 70,
      endSeconds: 80,
      label: "applause",
      score: 0.81,
      loudnessDb: 7,
      ratePerMinute: 90,
    },
  ],
};

function cues(count: number, everySeconds: number): Pick<AudioTrack, "speech" | "events"> {
  const speech = Array.from({ length: count }, (_, index) => ({
    start: index * everySeconds,
    end: index * everySeconds + 1,
    text: `line ${index}`,
  }));
  return { speech, events: [] };
}

function listenSetup(durationSeconds = 1800, heard = HEARD_AT_A_MINUTE) {
  const analyse = vi.fn<AnalyseAudio>((_file, request) => {
    const start = request.startSeconds ?? 0;
    const end = request.endSeconds ?? durationSeconds;
    const inside = (seconds: number) => seconds >= start && seconds < end;
    return Promise.resolve({
      speech: heard.speech.filter((cue) => inside(cue.start)),
      events: heard.events.filter((event) => inside(event.startSeconds)),
      startSeconds: start,
      durationSeconds: end - start,
    });
  });
  const { ctx } = setup();
  const audioStore = createMemoryStore();
  const listenCtx = runnerContext(
    { ...ctx, info: { ...ctx.info, durationSeconds } },
    { audio: { store: audioStore, labels: LISTEN_LABELS, analyse } },
  );
  return { analyse, audioStore, run: createToolRunner(listenCtx) };
}

function analysedSpans(analyse: ReturnType<typeof listenSetup>["analyse"]) {
  return analyse.mock.calls.map(([, request]) => [request.startSeconds, request.endSeconds]);
}

describe("listen", () => {
  it("analyses the piece holding the range and returns what was heard in it", async () => {
    const { run, analyse } = listenSetup();
    const result = await run(call("listen", { start: 60, end: 90 }));
    expect(analysedSpans(analyse)).toEqual([[0, 300]]);
    expect(result).toEqual({
      text: [
        "Heard from 1:00 to 1:30:",
        '[1:02] "Over here."',
        "[1:10-1:20] applause 0.81, loud (+7 dB), about 90/min",
      ].join("\n"),
      images: [],
    });
  });

  it("rejects bad times", async () => {
    const { run, analyse } = listenSetup(120);
    expect((await run(call("listen", { start: "a", end: 10 }))).text).toBe(
      "Error: start must be a finite number.",
    );
    expect((await run(call("listen", { start: 90, end: 30 }))).text).toBe(
      "Error: start must be before end, within 0 to 120 seconds (the video is 2:00 long).",
    );
    expect(analyse).not.toHaveBeenCalled();
  });

  it("says so when nothing was heard, or the range is too short to analyse", async () => {
    expect((await listenSetup().run(call("listen", { start: 0, end: 30 }))).text).toBe(
      "Nothing was heard from 0:00 to 0:30.",
    );
    const tiny = listenSetup(0.3);
    expect((await tiny.run(call("listen", { start: 0, end: 0.3 }))).text).toBe(
      "The audio from 0:00.0 to 0:00.3 is too short to analyse.",
    );
    expect(tiny.analyse).not.toHaveBeenCalled();
  });
});

describe("listen limits", () => {
  it("reads at most 10 minutes per call and says where to carry on", async () => {
    const { run, analyse } = listenSetup();
    const result = await run(call("listen", { start: 0, end: 1500 }));
    expect(analysedSpans(analyse)).toEqual([
      [0, 300],
      [300, 600],
    ]);
    expect(result.text).toContain("Heard from 0:00 to 10:00:");
    expect(result.text).toContain(
      "Only 10 minutes are read per call. Call listen from 600 for the rest.",
    );
  });

  it("caps the lines it returns and says where the rest starts", async () => {
    const { run } = listenSetup(1800, cues(MAX_LISTEN_LINES + 20, 3));
    const lines = (await run(call("listen", { start: 0, end: 1500 }))).text.split("\n");
    expect(lines).toHaveLength(MAX_LISTEN_LINES + 2);
    expect(lines[lines.length - 1]).toBe(
      `Showing the first ${MAX_LISTEN_LINES} of ${MAX_LISTEN_LINES + 20} lines. Call listen from ${MAX_LISTEN_LINES * 3} for the rest.`,
    );
  });
});

describe("listen without usable audio", () => {
  it("answers plainly for a video with no audio track", async () => {
    const { run, analyse } = listenSetup();
    analyse.mockRejectedValueOnce(new Vid2GridError("no_audio", "No audio."));
    expect(await run(call("listen", { start: 0, end: 30 }))).toEqual({
      text: "This video has no audio track, so there is nothing to hear.",
      images: [],
    });
  });

  it("says the audio could not be decoded, without recording it as missing", async () => {
    const { run, analyse, audioStore } = listenSetup();
    analyse.mockRejectedValueOnce(new AudioDecodeError("Unsupported codec."));
    expect((await run(call("listen", { start: 0, end: 30 }))).text).toBe(
      "Error: The audio from 0:00 to 0:30 could not be decoded.",
    );
    expect(await audioStore.getAudio(video.fileKey)).toBeUndefined();
  });

  it("reports a failed analysis and refuses when audio is off", async () => {
    const { run, analyse } = listenSetup();
    analyse.mockRejectedValueOnce(new Error("sound model failed to load"));
    expect((await run(call("listen", { start: 0, end: 30 }))).text).toBe(
      "Error: Audio analysis failed: sound model failed to load",
    );
    const off = await setup().run(call("listen", { start: 0, end: 30 }));
    expect(off.text).toBe(
      "Error: listen is not available: the user has audio turned off for this message.",
    );
  });
});

describe("look", () => {
  it("renders, stores each image and describes the sheets", async () => {
    const { run, store, render } = setup([
      sheet("grid_0001", 60, 74, 16),
      sheet("grid_0002", 75, 89, 1),
    ]);
    const result = await run(call("look", { start: 60, end: 90, frames: 17, perSheet: 16 }));
    expect(render.mock.calls[0]?.[2]).toEqual({
      startSeconds: 60,
      endSeconds: 90,
      frameCount: 30,
      framesPerGrid: 15,
      outputResolution: 1568,
    });
    expect(result.text).toBe(
      [
        "Rendered 30 frames, 15 per sheet (adjusted from 17 and 16 so every sheet is full).",
        "grid_0001: 1:00 to 1:14, 16 frames",
        "grid_0002: 1:15 to 1:29, 1 frame",
        "2 images follow.",
      ].join("\n"),
    );
    expect(result.images).toEqual([
      {
        id: "img-1",
        pinned: false,
        source: {
          kind: "sheet",
          call: "look(60, 90)",
          name: "grid_0001",
          startSeconds: 60,
          endSeconds: 74,
          frameCount: 16,
          cellTimes: secondsFrom(60, 16),
          resolution: 1568,
          fileKey: video.fileKey,
        },
      },
      {
        id: "img-2",
        pinned: false,
        source: {
          kind: "sheet",
          call: "look(60, 90)",
          name: "grid_0002",
          startSeconds: 75,
          endSeconds: 89,
          frameCount: 1,
          cellTimes: [75],
          resolution: 1568,
          fileKey: video.fileKey,
        },
      },
    ]);
    expect(await store.getImage("img-1")).toBeInstanceOf(Blob);
    expect(store.sheets.size).toBe(1);
  });
});

describe("look caching", () => {
  it("renders nothing when the sheets are cached", async () => {
    const { run, render } = setup();
    const args = { start: 60, end: 90, frames: 16, perSheet: 16 };
    const first = await run(call("look", args));
    const second = await run(call("look", { perSheet: 16, frames: 16, end: 90, start: 60 }));
    expect(render).toHaveBeenCalledTimes(1);
    expect(second).toEqual(first);
  });
});

describe("look arguments", () => {
  it("clamps the range inside the video, keeping the end margin", async () => {
    const { run, render } = setup();
    await run(call("look", { start: -5, end: 500, frames: 4, perSheet: 4 }));
    expect(render.mock.calls[0]?.[2]).toMatchObject({ startSeconds: 0, endSeconds: 119.95 });
  });

  it("clamps a start near the end to the margin too", async () => {
    const { run, render } = setup();
    await run(call("look", { start: 110, end: 120, frames: 4, perSheet: 4 }));
    expect(render.mock.calls[0]?.[2]).toMatchObject({ startSeconds: 110, endSeconds: 119.95 });
  });

  it("explains a range that collapses after clamping", async () => {
    const { run, render } = setup();
    const result = await run(call("look", { start: 119.97, end: 120, frames: 1, perSheet: 1 }));
    expect(result.text).toMatch(/^Error: start must be before end/);
    expect(render).not.toHaveBeenCalled();
  });
});

describe("look snapping", () => {
  it("snaps perSheet to the nearest full grid, preferring the larger, and rounds frames up", async () => {
    const { run, render } = setup();
    const result = await run(call("look", { start: 0, end: 60, frames: 20, perSheet: 5 }));
    expect(render.mock.calls[0]?.[2]).toMatchObject({ frameCount: 24, framesPerGrid: 6 });
    expect(result.text.split("\n")[0]).toBe(
      "Rendered 24 frames, 6 per sheet (adjusted from 20 and 5 so every sheet is full).",
    );
  });

  it("rounds frames up to fill the last sheet", async () => {
    const { run, render } = setup();
    await run(call("look", { start: 0, end: 60, frames: 10, perSheet: 4 }));
    expect(render.mock.calls[0]?.[2]).toMatchObject({ frameCount: 12, framesPerGrid: 4 });
  });

  it("says nothing when the request already fills every sheet", async () => {
    const { run, render } = setup();
    const result = await run(call("look", { start: 0, end: 60, frames: 12, perSheet: 4 }));
    expect(render.mock.calls[0]?.[2]).toMatchObject({ frameCount: 12, framesPerGrid: 4 });
    expect(result.text).not.toContain("adjusted");
  });

  it("stays within the frames cap", async () => {
    const { run, render } = setup();
    await run(call("look", { start: 0, end: 60, frames: 64, perSheet: 5 }));
    expect(render.mock.calls[0]?.[2]).toMatchObject({ frameCount: 60, framesPerGrid: 6 });
  });

  it("checks the image limit on the snapped sheet count", async () => {
    const { run, render } = setup();
    await run(call("look", { start: 0, end: 60, frames: 60, perSheet: 5 }));
    expect(render).toHaveBeenCalledTimes(1);
    const result = await run(call("look", { start: 0, end: 60, frames: 44, perSheet: 4 }));
    expect(result.text).toContain("11 images would not fit in one request, the limit is 10");
    expect(render).toHaveBeenCalledTimes(1);
  });
});

describe("look limits", () => {
  it("refuses more sheets than one request takes, without rendering", async () => {
    const { run, render, store } = setup();
    const result = await run(call("look", { start: 0, end: 60, frames: 64, perSheet: 4 }));
    expect(result.text).toBe(
      "Error: 16 images would not fit in one request, the limit is 10. " +
        "Use fewer frames, more frames per sheet, or a shorter range.",
    );
    expect(result.images).toEqual([]);
    expect(render).not.toHaveBeenCalled();
    expect(store.sheets.size).toBe(0);
  });

  it("accepts exactly the limit", async () => {
    const { run, render } = setup();
    await run(call("look", { start: 0, end: 60, frames: 40, perSheet: 4 }));
    expect(render).toHaveBeenCalledTimes(1);
  });

  it("explains empty and malformed arguments", async () => {
    const { run, render } = setup();
    const empty = await run(call("look", ""));
    expect(empty.text).toBe("Error: start must be a finite number.");
    const malformed = await run(call("look", "{oops"));
    expect(malformed.text).toMatch(/^Error: The arguments were not valid JSON/);
    expect(render).not.toHaveBeenCalled();
  });

  it.each([
    ["not JSON", "{oops"],
    ["not an object", "[1]"],
    ["a missing start", { end: 5, frames: 4, perSheet: 4 }],
    ["a string time", { start: "1", end: 5, frames: 4, perSheet: 4 }],
    ["fractional frames", { start: 0, end: 5, frames: 2.5, perSheet: 1 }],
    ["too many frames", { start: 0, end: 5, frames: 65, perSheet: 16 }],
    ["too many per sheet", { start: 0, end: 5, frames: 40, perSheet: 21 }],
    ["perSheet above frames", { start: 0, end: 5, frames: 4, perSheet: 8 }],
    ["start after end", { start: 50, end: 10, frames: 4, perSheet: 4 }],
    ["a range past the end", { start: 200, end: 300, frames: 4, perSheet: 4 }],
  ])("explains %s without throwing", async (_label, args) => {
    const { run, render } = setup();
    const result = await run(call("look", args));
    expect(result.text).toMatch(/^Error: /);
    expect(result.images).toEqual([]);
    expect(render).not.toHaveBeenCalled();
  });

  it("returns the render error as text", async () => {
    const { run, render, store } = setup();
    render.mockRejectedValue(new Error("decoder exploded"));
    const result = await run(call("look", { start: 0, end: 10, frames: 4, perSheet: 4 }));
    expect(result.text).toBe("Error: Rendering failed: decoder exploded");
    expect(result.images).toEqual([]);
    expect(store.sheets.size).toBe(0);
  });

  it("fails without caching when nothing could be captured", async () => {
    const { run, store } = setup([]);

    const result = await run(call("frames", { times: [119.95] }));

    expect(result).toEqual({
      text: "Error: Rendering failed: No frame was found there; try an earlier time.",
      images: [],
    });
    expect(store.sheets.size).toBe(0);
  });
});

describe("frames", () => {
  it("renders exactly the requested moments through the keyframe path", async () => {
    const { ctx, run, render } = setup([sheet("grid_0001", 102, 105.5, 2)]);
    const result = await run(call("frames", { times: [105.5, 102] }));
    expect(render.mock.calls[0]?.[1]).toEqual({
      ...ctx.info,
      keyframeTimestampsSeconds: [102, 105.5],
    });
    expect(render.mock.calls[0]?.[2]).toEqual({
      keyframeSampling: true,
      startSeconds: 102,
      endSeconds: 105.51,
      framesPerGrid: 2,
      outputResolution: 1568,
      targetFps: 2,
    });
    expect(result.text).toBe("grid_0001: 1:42.0 to 1:45.5, 2 frames\n1 image follows.");
    expect(result.images[0]?.source).toMatchObject({ kind: "sheet", call: "frames(1:42, 1:45.5)" });
  });

  it("keeps whole-second timestamps when every time is a whole second", async () => {
    const { run, render } = setup();
    await run(call("frames", { times: [10, 20] }));
    expect(render.mock.calls[0]?.[2]).not.toHaveProperty("targetFps");
  });

  it("clamps, sorts and drops times within 0.05 s of another", async () => {
    const { run, render } = setup();
    await run(call("frames", { times: [9999, 30, -3, 30.04, 120, 30.2] }));
    const times = render.mock.calls[0]?.[1].keyframeTimestampsSeconds ?? [];
    expect(times.slice(0, 3)).toEqual([0, 30, 30.2]);
    expect(times).toHaveLength(4);
    expect(times[3]).toBeCloseTo(119.95);
    expect(render.mock.calls[0]?.[2]).toMatchObject({ startSeconds: 0, framesPerGrid: 4 });
    expect(render.mock.calls[0]?.[2].endSeconds).toBeLessThan(120);
  });
});

describe("frames arguments", () => {
  it("caches by the times", async () => {
    const { run, render, store } = setup();
    await run(call("frames", { times: [10, 20] }));
    await run(call("frames", { times: [20, 10] }));
    expect(render).toHaveBeenCalledTimes(1);
    await run(call("frames", { times: [10, 25] }));
    expect(render).toHaveBeenCalledTimes(2);
    expect(store.sheets.size).toBe(2);
  });

  it("takes at most 9 times", async () => {
    const { run, render } = setup();
    const nine = await run(call("frames", { times: [1, 2, 3, 4, 5, 6, 7, 8, 9] }));
    expect(nine.text).not.toMatch(/^Error/);
    const ten = await run(call("frames", { times: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10] }));
    expect(ten.text).toBe("Error: times must be an array of 1 to 9 numbers in seconds.");
    expect(render).toHaveBeenCalledTimes(1);
  });

  it("explains missing, empty and non-numeric times", async () => {
    const { run, render } = setup();
    const problem = "Error: times must be an array of 1 to 9 numbers in seconds.";
    expect((await run(call("frames", {}))).text).toBe(problem);
    expect((await run(call("frames", { times: [] }))).text).toBe(problem);
    expect((await run(call("frames", { times: [1, "2"] }))).text).toBe(problem);
    expect((await run(call("frames", { times: 4 }))).text).toBe(problem);
    expect(render).not.toHaveBeenCalled();
  });

  it("maps the old frame(t) call to one time", async () => {
    const { ctx, run, render } = setup([sheet("grid_0001", 102, 102, 1)]);
    const result = await run(call("frame", { t: 102 }));
    expect(render.mock.calls[0]?.[1]).toEqual({ ...ctx.info, keyframeTimestampsSeconds: [102] });
    expect(render.mock.calls[0]?.[2]).toMatchObject({ startSeconds: 102, framesPerGrid: 1 });
    expect(result.images[0]?.source).toMatchObject({ call: "frames(1:42)" });
  });
});

describe("note", () => {
  it("returns the note without rendering", async () => {
    const { run, render } = setup();
    const result = await run(call("note", { t: 102.4, text: " red car enters " }));
    expect(result).toEqual({
      text: "Noted at 1:42.",
      images: [],
      note: { timeSeconds: 102.4, text: "red car enters" },
    });
    expect(render).not.toHaveBeenCalled();
  });

  it("explains empty text", async () => {
    const { run } = setup();
    expect((await run(call("note", { t: 3, text: "  " }))).text).toMatch(/^Error: /);
  });
});

describe("unknown tool", () => {
  it("explains the tools that exist", async () => {
    const { run } = setup();
    const result = await run(call("peek", {}));
    expect(result.text).toBe(
      'Error: Unknown tool "peek". The tools are look, frames, note, recall and zoom.',
    );
  });

  it("treats zoom as unknown for a model that was not offered it", async () => {
    const { ctx } = setup();
    const { tools } = toolOffer({ videoLoaded: true, images: true, vision: false, listen: true });
    const run = createToolRunner(runnerContext(ctx, { tools }));
    expect((await run(call("zoom", { t: 1, left: 0, top: 0, right: 10, bottom: 10 }))).text).toBe(
      'Error: Unknown tool "zoom". The tools are look, frames, note, recall and listen.',
    );
  });
});

describe("without a loaded video", () => {
  const { tools } = toolOffer({ videoLoaded: false, images: true, vision: true, listen: false });

  it.each(["look", "frames", "frame", "note", "listen"])("%s says what it needs", async (name) => {
    const run = createToolRunner({ store: new FakeStore(), resolution: 1024, maxImages: 4, tools });
    expect(await run(call(name, {}))).toEqual({
      text: `Error: ${name} needs the chat's video, which is not loaded. The tools are recall and zoom.`,
      images: [],
    });
  });

  it("still recalls", async () => {
    const store = new FakeStore();
    store.images.set("img-1", new Blob(["x"]));
    const photo: ImageRef = {
      id: "img-1",
      pinned: false,
      source: { kind: "upload", name: "beach.jpg" },
    };
    const run = createToolRunner({
      store,
      resolution: 1024,
      maxImages: 4,
      tools,
      knownImages: () => [photo],
    });
    expect((await run(call("recall", { names: ["beach.jpg"] }))).images).toEqual([photo]);
  });
});

function storedSheet(id: string, name: string, call: string, pinned = false): ImageRef {
  return {
    id,
    pinned,
    source: { kind: "sheet", call, name, startSeconds: 60, endSeconds: 90, frameCount: 16 },
  };
}

function recallSetup(known: ImageRef[], maxImages = 10) {
  const { ctx, store, render } = setup();
  for (const ref of known) store.images.set(ref.id, new Blob([ref.id]));
  const run = createToolRunner(runnerContext(ctx, { maxImages, knownImages: () => known }));
  return { run, store, render };
}

describe("recall", () => {
  const first = storedSheet("img-1", "grid_0001", "look(60, 90)");
  const second = storedSheet("img-2", "grid_0001", "look(0, 30)");
  const photo: ImageRef = {
    id: "img-3",
    pinned: false,
    source: { kind: "upload", name: "beach.jpg" },
  };

  it("attaches stored images by full name without rendering", async () => {
    const { run, render } = recallSetup([first, second, photo]);
    const result = await run(
      call("recall", { names: ["grid_0001 from look(0, 30)", "beach.jpg"] }),
    );
    expect(result.images).toEqual([second, photo]);
    expect(result.text).toBe(
      [
        "grid_0001 from look(0, 30): 1:00 to 1:30, 16 frames",
        "image beach.jpg",
        "2 images follow.",
      ].join("\n"),
    );
    expect(render).not.toHaveBeenCalled();
  });

  it("accepts a bare name only while one image has it", async () => {
    const { run } = recallSetup([first, second, photo]);
    const ambiguous = await run(call("recall", { names: ["grid_0001"] }));
    expect(ambiguous.images).toEqual([]);
    expect(ambiguous.text).toContain('"grid_0001" names 2 images');
    const unique = recallSetup([first]);
    expect((await unique.run(call("recall", { names: ["GRID_0001"] }))).images).toEqual([first]);
  });

  it.each([
    ["an upload's label", "image beach.jpg", photo],
    ["a sheet's label", "grid_0001 from look(0, 30): 1:00 to 1:30, 16 frames", second],
    ["a sheet's label misquoted after the colon", "grid_0001 from look(0, 30): all of it", second],
  ])("accepts %s as a name", async (_what, name, expected) => {
    const { run } = recallSetup([first, second, photo]);
    expect((await run(call("recall", { names: [name] }))).images).toEqual([expected]);
  });

  it("prefers a name over a label that reads the same", async () => {
    const named: ImageRef = { ...photo, id: "img-4", source: { ...photo.source, name: "image a" } };
    const labelled: ImageRef = { ...photo, id: "img-5", source: { ...photo.source, name: "a" } };
    const { run } = recallSetup([named, labelled]);
    expect((await run(call("recall", { names: ["image a"] }))).images).toEqual([named]);
  });

  it("keeps asking for the full name when a sheet's short label is ambiguous", async () => {
    const { run } = recallSetup([first, second]);
    const ambiguous = await run(call("recall", { names: ["grid_0001: 1:00 to 1:30, 16 frames"] }));
    expect(ambiguous.images).toEqual([]);
    expect(ambiguous.text).toContain("names 2 images");
    const { run: runOne } = recallSetup([first]);
    const one = await runOne(call("recall", { names: ["grid_0001: 1:00 to 1:30, 16 frames"] }));
    expect(one.images).toEqual([first]);
  });

  it("says when images share a full name, attaching the latest", async () => {
    const again = { ...first, id: "img-6" };
    const { run } = recallSetup([first, again, first]);
    const shared = await run(call("recall", { names: ["grid_0001 from look(60, 90)"] }));
    expect(shared.images).toEqual([first]);
    expect(shared.text).toContain(
      "2 images share the name grid_0001 from look(60, 90); this is the latest.",
    );
    const { run: repeated } = recallSetup([first, first]);
    const same = await repeated(call("recall", { names: ["grid_0001 from look(60, 90)"] }));
    expect(same.text).not.toContain("share the name");
  });

  it("says clearly when a name is unknown, while attaching the ones it found", async () => {
    const { run } = recallSetup([photo]);
    const unknown = await run(call("recall", { names: ["grid_0009 from look(1, 2)"] }));
    expect(unknown.text).toBe(
      'Error: No earlier image is named "grid_0009 from look(1, 2)". Use a name exactly as its stub gives it.',
    );
    const mixed = await run(call("recall", { names: ["nope", "beach.jpg"] }));
    expect(mixed.images).toEqual([photo]);
    expect(mixed.text).toContain('Error: No earlier image is named "nope".');
  });
});

describe("recall limits", () => {
  const first = storedSheet("img-1", "grid_0001", "look(60, 90)");
  const second = storedSheet("img-2", "grid_0001", "look(0, 30)");
  const photo: ImageRef = {
    id: "img-3",
    pinned: false,
    source: { kind: "upload", name: "beach.jpg" },
  };

  it("caps what it attaches at the slots the pins leave", async () => {
    const pinned = storedSheet("img-9", "grid_0009", "look(5, 9)", true);
    const { run } = recallSetup([first, second, photo, pinned], 3);
    const result = await run(
      call("recall", {
        names: ["grid_0001 from look(60, 90)", "grid_0001 from look(0, 30)", "beach.jpg"],
      }),
    );
    expect(result.images).toEqual([first, second]);
    expect(result.text).toContain("Only 2 images fit in one request");
  });

  it("reports an image whose blob is gone and refuses bad arguments", async () => {
    const { run, store } = recallSetup([first]);
    store.images.clear();
    expect((await run(call("recall", { names: ["grid_0001"] }))).text).toBe(
      "Error: grid_0001 from look(60, 90) is no longer stored.",
    );
    expect((await run(call("recall", { names: [] }))).text).toBe(
      "Error: names must be an array of one or more image names.",
    );
  });
});

describe("renderOverview", () => {
  it("samples the whole video and labels the images as the overview", async () => {
    const { ctx, render } = setup();
    const progress = vi.fn();
    const refs = await renderOverview(ctx, progress);
    expect(render.mock.calls[0]?.[2]).toEqual({
      startSeconds: 0,
      endSeconds: 120,
      frameCount: 80,
      framesPerGrid: 20,
      outputResolution: 1568,
    });
    expect(render.mock.calls[0]?.[3]).toBe(progress);
    expect(refs[0]?.source).toMatchObject({ kind: "sheet", call: "overview" });
  });

  it("renders and records the overview resolution chosen from its sheet count", async () => {
    const { ctx, render } = setup();
    const overviewResolution = vi.fn((sheets: number) => (sheets > 2 ? 1024 : 1568));
    const withOverview = { ...ctx, overviewResolution };
    const run = createToolRunner(runnerContext(withOverview));
    const refs = await renderOverview(withOverview);
    expect(overviewResolution).toHaveBeenCalledWith(4);
    expect(render.mock.calls[0]?.[2]).toMatchObject({
      frameCount: 80,
      framesPerGrid: 20,
      outputResolution: 1024,
    });
    expect(refs[0]?.source).toMatchObject({ call: "overview", resolution: 1024 });
    const look = await run(call("look", { start: 60, end: 90, frames: 16, perSheet: 16 }));
    const frames = await run(call("frames", { times: [10] }));
    expect(render.mock.calls[1]?.[2].outputResolution).toBe(1568);
    expect(render.mock.calls[2]?.[2].outputResolution).toBe(1568);
    expect(look.images[0]?.source).toMatchObject({ resolution: 1568 });
    expect(frames.images[0]?.source).toMatchObject({ resolution: 1568 });
  });

  it("reuses cached sheets, stamping older ones with their video", async () => {
    const { ctx, store, render } = setup();
    const cached = storedSheet("kept", "grid_0001", "overview");
    const key = sheetCacheKey(video.fileKey, {
      startSeconds: 0,
      endSeconds: 120,
      frameCount: 80,
      framesPerGrid: 20,
      outputResolution: 1568,
    });
    store.images.set(cached.id, new Blob(["kept"]));
    await store.putSheets(key, [cached]);
    expect(await renderOverview(ctx)).toEqual([
      { ...cached, source: { ...cached.source, fileKey: video.fileKey } },
    ]);
    expect(render).not.toHaveBeenCalled();
  });

  it("renders again when a cached sheet's image is no longer stored", async () => {
    const { ctx, store, render } = setup();
    const first = await renderOverview(ctx);
    expect(await renderOverview(ctx)).toEqual(first);
    expect(render).toHaveBeenCalledTimes(1);
    store.images.delete(first[0]?.id ?? "");
    const again = await renderOverview(ctx);
    expect(render).toHaveBeenCalledTimes(2);
    expect(store.images.has(again[0]?.id ?? "")).toBe(true);
    expect([...store.sheets.values()]).toEqual([again]);
  });
});
