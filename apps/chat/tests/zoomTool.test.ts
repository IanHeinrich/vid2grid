import { buildRenderPlan, requestFromOptions } from "@vid2grid/core";
import { describe, expect, it, vi } from "vitest";
import { createMemoryStore } from "../src/chat/store";
import type { ImageArea, ImageRef, VideoAttachment, ZoomTarget } from "../src/types";
import type { PictureTools } from "../src/video/cropPicture";
import { sheetCacheKey } from "../src/video/sheetCache";
import type { SheetContext } from "../src/video/sheets";
import { runZoom, zoomCacheKey, type ZoomContext } from "../src/video/zoomTool";

const INFO = { durationSeconds: 120, width: 1920, height: 1080 };
const VIDEO: VideoAttachment = { name: "clip.mp4", fileKey: "clip.mp4|1|7", ...INFO };
const OTHER: VideoAttachment = { ...VIDEO, name: "dunes.mp4", fileKey: "dunes.mp4|1|7" };
const AREA: ImageArea = { left: 200, top: 300, right: 400, bottom: 700 };
const SHOWN: ImageArea = { left: 190, top: 280, right: 410, bottom: 720 };

function bitmap(width: number, height: number) {
  return { width, height, close: vi.fn() };
}

type ZoomSource = Extract<ImageRef["source"], { kind: "zoom" }>;

function zoomSource(ref: ImageRef | undefined): ZoomSource {
  if (ref?.source.kind !== "zoom") throw new Error("Not a zoom");
  return ref.source;
}

function setup(known: ImageRef[] = [], extra: Partial<ZoomContext> = {}) {
  const store = createMemoryStore();
  const frame = bitmap(INFO.width, INFO.height);
  const capture = vi.fn<NonNullable<SheetContext["capture"]>>(() => Promise.resolve(frame));
  const decoded = new Map<Blob, ReturnType<typeof bitmap>>();
  const decode = vi.fn<PictureTools["decode"]>((blob) => {
    const picture = bitmap(blob.size, blob.size);
    decoded.set(blob, picture);
    return Promise.resolve(picture);
  });
  const crop = vi.fn<PictureTools["crop"]>(() => Promise.resolve(new Blob(["jpeg"])));
  const sheets: SheetContext = {
    file: new File(["x"], VIDEO.name),
    info: INFO,
    video: VIDEO,
    resolution: 1536,
    maxImages: 10,
    store,
    capture,
  };
  const ctx: ZoomContext = {
    store,
    resolution: 1536,
    knownImages: () => known,
    videoOfImage: () => VIDEO,
    sheets,
    pictures: { decode, crop },
    ...extra,
  };
  return { ctx, store, frame, capture, decode, decoded, crop };
}

function withoutVideo(ctx: ZoomContext): ZoomContext {
  const unloaded = { ...ctx };
  delete unloaded.sheets;
  return unloaded;
}

function planSheet(frameCount: number, info = INFO, resolution = 1536) {
  const request = requestFromOptions(
    { startSeconds: 60, frameCount, framesPerGrid: frameCount, outputResolution: resolution },
    info,
  );
  const cells = buildRenderPlan(request, info).sheets[0]?.cells ?? [];
  const ref: ImageRef = {
    id: "sheet",
    pinned: true,
    source: {
      kind: "sheet",
      call: "look(60, 120)",
      name: "grid_0001",
      startSeconds: cells[0]?.timestampSeconds ?? 0,
      endSeconds: cells.at(-1)?.timestampSeconds ?? 0,
      frameCount,
      cellTimes: cells.map((cell) => cell.timestampSeconds),
      resolution,
    },
  };
  const areaOn = (index: number, part: ImageArea): ImageArea => {
    const cell = cells[index];
    if (!cell) throw new Error("No cell");
    const onSheet = (offset: number, size: number, share: number) =>
      ((offset + (share / 1000) * size) / resolution) * 1000;
    return {
      left: onSheet(cell.x, cell.width, part.left),
      top: onSheet(cell.y, cell.height, part.top),
      right: onSheet(cell.x, cell.width, part.right),
      bottom: onSheet(cell.y, cell.height, part.bottom),
    };
  };
  return { ref, cells, areaOn };
}

async function upload(
  store: ZoomContext["store"],
  sentPx: number,
  originalPx?: number,
): Promise<ImageRef> {
  const id = await store.putImage(new Blob(["x".repeat(sentPx)]));
  const originalId =
    originalPx === undefined ? undefined : await store.putImage(new Blob(["x".repeat(originalPx)]));
  return {
    id,
    pinned: true,
    source: {
      kind: "upload",
      name: "beach.jpg",
      ...(originalId === undefined ? {} : { originalId }),
    },
  };
}

describe("zoom into a moment", () => {
  it("crops the source frame, stores it and says what it shows", async () => {
    const { ctx, store, frame, capture, crop } = setup();
    const result = await runZoom(ctx, { t: 62.5, ...AREA });
    expect(capture).toHaveBeenCalledWith(ctx.sheets?.file, INFO, 62.5);
    expect(crop).toHaveBeenCalledWith(
      frame,
      { x: 365, y: 302, width: 422, height: 476 },
      { width: 908, height: 1024 },
    );
    expect(frame.close).toHaveBeenCalledTimes(1);
    const [image] = result.images;
    expect(image).toMatchObject({
      pinned: false,
      source: {
        kind: "zoom",
        name: "zoom(1:02.5, 200, 300, 400, 700)",
        target: { kind: "moment", seconds: 62.5, fileKey: VIDEO.fileKey },
        area: SHOWN,
        width: 908,
        height: 1024,
      },
    });
    expect(await store.getImage(image?.id ?? "")).toBeDefined();
    expect(result.text).toBe(
      [
        "zoom(1:02.5, 200, 300, 400, 700): part of 1:02.5, 190 to 410 across and 280 to 720 down, in thousandths",
        "1 image follows.",
      ].join("\n"),
    );
  });

  it("keeps the time inside the video", async () => {
    const { ctx, capture } = setup();
    await runZoom(ctx, { t: 500, ...AREA });
    expect(capture.mock.calls[0]?.[2]).toBe(119.95);
  });

  it("names neighbouring frames apart", async () => {
    const { ctx } = setup();
    const names = [];
    for (const t of [62.53, 62.567]) {
      names.push(zoomSource((await runZoom(ctx, { t, ...AREA })).images[0]).name);
    }
    expect(names).toEqual([
      "zoom(1:02.530, 200, 300, 400, 700)",
      "zoom(1:02.567, 200, 300, 400, 700)",
    ]);
  });

  it("ignores an image left null or empty", async () => {
    const { ctx } = setup();
    expect((await runZoom(ctx, { image: null, t: 1, ...AREA })).images).toHaveLength(1);
    expect((await runZoom(ctx, { image: "", t: 1, ...AREA })).images).toHaveLength(1);
  });
});

describe("zoom arguments", () => {
  it("needs exactly one of image and t", async () => {
    const { ctx } = setup();
    const both = await runZoom(ctx, { image: "beach.jpg", t: 1, ...AREA });
    const neither = await runZoom(ctx, { ...AREA });
    for (const { text } of [both, neither]) expect(text).toContain("exactly one of image");
    expect((await runZoom(ctx, { image: 3, ...AREA })).text).toContain("image's name");
    expect((await runZoom(ctx, { t: "1:02", ...AREA })).text).toContain(
      "t must be a finite number",
    );
  });

  it("refuses an area off the scale before anything else", async () => {
    const { ctx, capture } = setup();
    expect((await runZoom(ctx, { t: 1, ...AREA, right: 1920 })).text).toContain("0 to 1000");
    expect(capture).not.toHaveBeenCalled();
  });

  it("explains unknown and ambiguous names", async () => {
    const { ref } = planSheet(4);
    const source = { ...ref.source, call: "look(0, 60)" } as ImageRef["source"];
    const { ctx } = setup([ref, { ...ref, id: "sheet-2", source }]);
    expect((await runZoom(ctx, { image: "nope", ...AREA })).text).toContain(
      'No earlier image is named "nope"',
    );
    expect((await runZoom(ctx, { image: "grid_0001", ...AREA })).text).toContain(
      '"grid_0001" names 2 images',
    );
  });

  it("says t needs the video when none is loaded", async () => {
    const { ctx } = setup();
    expect((await runZoom(withoutVideo(ctx), { t: 1, ...AREA })).text).toContain("is not loaded");
  });

  it("reports a failed capture as text and closes what it opened", async () => {
    const { ctx, capture, crop, frame } = setup();
    capture.mockRejectedValueOnce(new Error("decoder died"));
    expect(await runZoom(ctx, { t: 1, ...AREA })).toEqual({
      text: "Error: Zooming failed: decoder died",
      images: [],
    });
    crop.mockRejectedValueOnce(new Error("no canvas"));
    expect((await runZoom(ctx, { t: 1, ...AREA })).text).toContain("no canvas");
    expect(frame.close).toHaveBeenCalledTimes(1);
  });
});

describe("zoom into a sheet", () => {
  const portrait = { ...INFO, width: 1080, height: 1920 };

  it.each([
    ["landscape", INFO, 1],
    ["landscape", INFO, 9],
    ["portrait", portrait, 1],
    ["portrait", portrait, 6],
    ["portrait", portrait, 20],
  ])("captures the frame it is aimed at: %s, %#", async (_name, info, frameCount) => {
    const { ref, cells, areaOn } = planSheet(frameCount, info);
    const { ctx, capture } = setup([ref]);
    if (ctx.sheets) ctx.sheets = { ...ctx.sheets, info };
    for (const [index, cell] of cells.entries()) {
      const { images, text } = await runZoom(ctx, { image: "grid_0001", ...areaOn(index, AREA) });
      const { target, name } = zoomSource(images[0]);
      expect(target).toEqual({
        kind: "moment",
        seconds: cell.timestampSeconds,
        fileKey: VIDEO.fileKey,
      });
      expect(name).toContain(", 200, 300, 400, 700)");
      expect(text).toContain("is the one in the middle of that area");
      expect(text).not.toContain("covered more");
    }
    expect(capture.mock.calls.map((call) => call[2])).toEqual(
      cells.map((cell) => cell.timestampSeconds),
    );
  });

  it("notes when the area covered more than one frame", async () => {
    const { ref } = planSheet(9);
    const { ctx } = setup([ref]);
    const whole = { left: 0, top: 0, right: 1000, bottom: 1000 };
    const { text, images } = await runZoom(ctx, {
      image: "grid_0001 from look(60, 120)",
      ...whole,
    });
    expect(text.split("\n")).toEqual([
      expect.stringContaining("part of 1:33.3"),
      "The frame at 1:33.333 is the one in the middle of that area.",
      "The area covered more than that one frame; only that frame is shown.",
      "1 image follows.",
    ]);
    expect(zoomSource(images[0]).area).toEqual(whole);
  });

  it("takes an older sheet's uneven times as they are", async () => {
    const { ref, areaOn } = planSheet(4);
    const source = { ...ref.source, endSeconds: 110 } as ImageRef["source"];
    if (source.kind === "sheet") delete source.cellTimes;
    const { ctx, capture } = setup([{ ...ref, source }]);
    const { text } = await runZoom(ctx, { image: "grid_0001", ...areaOn(1, AREA) });
    expect(capture.mock.calls.map((call) => call[2])).toEqual([60 + 50 / 3]);
    expect(text).not.toContain("No frame could be captured");
  });

  it("says when the middle is on no frame", async () => {
    const { ref } = planSheet(1);
    const { ctx } = setup([ref]);
    const bar = { left: 0, top: 0, right: 1000, bottom: 100 };
    const { text } = await runZoom(ctx, { image: "grid_0001", ...bar });
    expect(text).toContain("is not on a frame of grid_0001 from look(60, 120)");
  });

  it("measures the stored sheet when its resolution was not recorded", async () => {
    const { ref, areaOn } = planSheet(4);
    const { ctx, store, decode, decoded } = setup([ref]);
    if (ref.source.kind !== "sheet") throw new Error("Not a sheet");
    delete ref.source.resolution;
    const stored = new Blob(["x".repeat(1536)]);
    ref.id = await store.putImage(stored);
    const { images } = await runZoom(ctx, { image: "grid_0001", ...areaOn(2, AREA) });
    expect(zoomSource(images[0]).target).toMatchObject({ seconds: 90 });
    expect(decode).toHaveBeenCalledTimes(1);
    expect([...decoded.values()][0]?.close).toHaveBeenCalledTimes(1);
  });
});

describe("zoom into another video's sheet", () => {
  const { ref } = planSheet(4);

  it("fails when the sheet's message was about another video", async () => {
    const videoOfImage = vi.fn(() => OTHER);
    const { ctx, capture } = setup([ref], { videoOfImage });
    const { text, images } = await runZoom(ctx, { image: "grid_0001", ...AREA });
    expect(videoOfImage).toHaveBeenCalledWith("sheet");
    expect(text).toContain("shows dunes.mp4, which is not loaded");
    expect(text).toContain("The loaded video is clip.mp4.");
    expect(images).toEqual([]);
    expect(capture).not.toHaveBeenCalled();
  });

  it("fails when no video is loaded", async () => {
    const { ctx } = setup([ref]);
    const { text } = await runZoom(withoutVideo(ctx), { image: "grid_0001", ...AREA });
    expect(text).toContain("shows clip.mp4, which is not loaded");
    expect(text).toContain("The user can load it again.");
  });
});

describe("a sheet stamped with its video", () => {
  function stamped(fileKey: string): ImageRef {
    const { ref } = planSheet(4);
    return { ...ref, source: { ...ref.source, fileKey } as ImageRef["source"] };
  }

  it("is refused when its video is not the loaded one, whatever its message says", async () => {
    const { ctx, capture } = setup([stamped(OTHER.fileKey)]);
    const { text } = await runZoom(ctx, { image: "grid_0001", ...AREA });
    expect(text).toContain("shows another video, which is not loaded");
    expect(capture).not.toHaveBeenCalled();
  });

  it("is zoomed when its video is loaded, whatever its message says", async () => {
    const { ctx } = setup([stamped(VIDEO.fileKey)], { videoOfImage: () => OTHER });
    expect((await runZoom(ctx, { image: "grid_0001", ...AREA })).images).toHaveLength(1);
  });

  it("is told apart from a changed file of the same name", async () => {
    const changed = { ...VIDEO, fileKey: "clip.mp4|2|8" };
    const { ctx } = setup([stamped(changed.fileKey)], { videoOfImage: () => changed });
    const { text } = await runZoom(ctx, { image: "grid_0001", ...AREA });
    expect(text).toContain("shows clip.mp4, which is not loaded");
    expect(text).toContain("The loaded video is another file of that name.");
  });
});

describe("images sharing a name", () => {
  it("zooms into the latest and says so", async () => {
    const known: ImageRef[] = [];
    const { ctx, store } = setup(known);
    known.push(await upload(store, 640), await upload(store, 800));
    const { text, images } = await runZoom(ctx, { image: "beach.jpg", ...AREA });
    expect(zoomSource(images[0]).target).toMatchObject({ id: known[1]?.id });
    expect(text).toContain("2 images share the name beach.jpg; this is the latest.");
    known.shift();
    expect((await runZoom(ctx, { image: "beach.jpg", ...AREA })).text).not.toContain("share");
  });
});

describe("zoom by label", () => {
  it("accepts a zoom's own label", async () => {
    const known: ImageRef[] = [];
    const { ctx } = setup(known);
    const first = await runZoom(ctx, { t: 5, ...AREA });
    known.push(...first.images);
    const label = first.text.split("\n")[0];
    const again = await runZoom(ctx, { image: label, ...AREA });
    expect(zoomSource(again.images[0]).target).toMatchObject({ kind: "moment", seconds: 5 });
  });
});

describe("zoom where no frame can be captured", () => {
  function capturesUpTo(last: number) {
    const made = setup();
    made.capture.mockImplementation((_file, _info, seconds) =>
      Promise.resolve(seconds <= last ? made.frame : undefined),
    );
    return made;
  }

  it("uses the nearest earlier time that has one, and says so", async () => {
    const { ctx, capture, frame } = capturesUpTo(119.5);
    const result = await runZoom(ctx, { t: 120, ...AREA });
    expect(capture.mock.calls.map((call) => call[2])).toEqual([119.95, 119.85, 119.45]);
    expect(zoomSource(result.images[0])).toMatchObject({
      name: "zoom(1:59.450, 200, 300, 400, 700)",
      target: { kind: "moment", seconds: 119.45 },
    });
    expect(result.text).toContain(
      "No frame could be captured at 1:59.950, so this is the frame at 1:59.450.",
    );
    expect(frame.close).toHaveBeenCalledTimes(1);
  });

  it("says the same from the cache, and shares it with the time that worked", async () => {
    const { ctx, capture } = capturesUpTo(119.5);
    const first = await runZoom(ctx, { t: 120, ...AREA });
    expect(await runZoom(ctx, { t: 120, ...AREA })).toEqual(first);
    const direct = await runZoom(ctx, { t: 119.45, ...AREA });
    expect(direct.images).toEqual(first.images);
    expect(direct.text).not.toContain("No frame could be captured");
    expect(capture).toHaveBeenCalledTimes(3);
  });

  it("reuses a picture already made of the time that worked", async () => {
    const { ctx, crop } = capturesUpTo(119.5);
    const direct = await runZoom(ctx, { t: 119.45, ...AREA });
    const late = await runZoom(ctx, { t: 120, ...AREA });
    expect(late.images).toEqual(direct.images);
    expect(crop).toHaveBeenCalledTimes(1);
  });

  it("stays inside the video and suggests an earlier t when nothing works", async () => {
    const { ctx, capture } = capturesUpTo(-1);
    const { text, images } = await runZoom(ctx, { t: 0.7, ...AREA });
    expect(capture.mock.calls.map((call) => call[2])).toEqual([0.7, 0.6, 0.2]);
    expect(images).toEqual([]);
    expect(text).toContain("No frame could be captured at 0:00.7 or just before it");
    expect(text).toContain("Try an earlier t.");
  });
});

describe("zoom into an upload", () => {
  it("crops the larger original, with or without a video", async () => {
    const known: ImageRef[] = [];
    const { ctx, store, decoded, crop } = setup(known);
    known.push(await upload(store, 100, 2000));
    const { images, text } = await runZoom(withoutVideo(ctx), { image: "beach.jpg", ...AREA });
    expect([...decoded.keys()].map((blob) => blob.size)).toEqual([2000]);
    expect([...decoded.values()][0]?.close).toHaveBeenCalledTimes(1);
    expect(crop.mock.calls[0]?.[1]).toEqual({ x: 380, y: 560, width: 440, height: 880 });
    const target: ZoomTarget = { kind: "image", id: known[0]?.id ?? "", name: "beach.jpg" };
    expect(zoomSource(images[0])).toMatchObject({
      name: "zoom(beach.jpg, 200, 300, 400, 700)",
      target,
      area: SHOWN,
    });
    expect(text).toContain("part of beach.jpg");
  });

  it("falls back to the sent picture", async () => {
    const known: ImageRef[] = [];
    const { ctx, store, decoded } = setup(known);
    known.push(await upload(store, 640));
    await runZoom(ctx, { image: "beach.jpg", ...AREA });
    const gone = await upload(store, 800);
    if (gone.source.kind === "upload") gone.source.originalId = "gone";
    known.splice(0, 1, gone);
    await runZoom(ctx, { image: "beach.jpg", ...AREA });
    expect([...decoded.keys()].map((blob) => blob.size)).toEqual([640, 800]);
  });

  it("says when nothing of it is stored any more", async () => {
    const missing: ImageRef = {
      id: "gone",
      pinned: false,
      source: { kind: "upload", name: "beach.jpg" },
    };
    const { ctx } = setup([missing]);
    expect((await runZoom(ctx, { image: "beach.jpg", ...AREA })).text).toBe(
      "Error: beach.jpg is no longer stored.",
    );
  });
});

describe("zoom into a zoom", () => {
  it("crops the original frame again, at the composed area", async () => {
    const known: ImageRef[] = [];
    const { ctx, capture, decode } = setup(known);
    const first = (await runZoom(ctx, { t: 62.5, left: 0, top: 0, right: 500, bottom: 500 }))
      .images[0];
    if (!first) throw new Error("No zoom");
    known.push(first);
    expect(zoomSource(first).area).toEqual({ left: 0, top: 0, right: 525, bottom: 525 });
    const again = await runZoom(ctx, {
      image: "zoom(1:02.5, 0, 0, 500, 500)",
      left: 400,
      top: 0,
      right: 1000,
      bottom: 1000,
    });
    expect(zoomSource(again.images[0])).toMatchObject({
      name: "zoom(1:02.5, 210, 0, 525, 525)",
      target: { kind: "moment", seconds: 62.5 },
    });
    expect(capture).toHaveBeenCalledTimes(2);
    expect(decode).not.toHaveBeenCalled();
  });

  it("crops an upload's original again", async () => {
    const known: ImageRef[] = [];
    const { ctx, store, decode } = setup(known);
    known.push(await upload(store, 100, 2000));
    const first = (await runZoom(ctx, { image: "beach.jpg", ...AREA })).images[0];
    if (!first) throw new Error("No zoom");
    known.push(first);
    const again = await runZoom(ctx, { image: zoomSource(first).name, ...AREA });
    expect(zoomSource(again.images[0]).target).toEqual(zoomSource(first).target);
    expect(decode.mock.calls.map(([blob]) => blob.size)).toEqual([2000, 2000]);
  });

  it("fails when the zoomed moment is of a video that is not loaded", async () => {
    const known: ImageRef[] = [];
    const { ctx } = setup(known);
    const first = (await runZoom(ctx, { t: 5, ...AREA })).images[0];
    if (!first || !ctx.sheets) throw new Error("No zoom");
    known.push(first);
    const { name } = zoomSource(first);
    const other = { ...ctx, sheets: { ...ctx.sheets, video: OTHER } };
    expect((await runZoom(other, { image: name, ...AREA })).text).toContain(
      "shows another video, which is not loaded",
    );
    expect((await runZoom(withoutVideo(ctx), { image: name, ...AREA })).text).toContain(
      "shows a video, which is not loaded",
    );
  });
});

describe("zoom caching", () => {
  it("captures once for the same call, and again at another resolution", async () => {
    const { ctx, capture } = setup();
    const first = await runZoom(ctx, { t: 62.5, ...AREA });
    expect(await runZoom(ctx, { t: 62.5, ...AREA })).toEqual(first);
    expect(capture).toHaveBeenCalledTimes(1);
    await runZoom({ ...ctx, resolution: 768 }, { t: 62.5, ...AREA });
    await runZoom(ctx, { t: 62.5, ...AREA, left: 201 });
    expect(capture).toHaveBeenCalledTimes(3);
  });

  it("shares a picture between a sheet's frame and the same moment", async () => {
    const { ref, areaOn } = planSheet(4);
    const { ctx, capture } = setup([ref]);
    const fromSheet = await runZoom(ctx, { image: "grid_0001", ...areaOn(1, AREA) });
    const fromTime = await runZoom(ctx, { t: 75, ...AREA });
    expect(fromTime.images).toEqual(fromSheet.images);
    expect(capture).toHaveBeenCalledTimes(1);
  });

  it("keeps its keys apart from sheets and from each other", () => {
    const moment: ZoomTarget = { kind: "moment", seconds: 5, fileKey: VIDEO.fileKey };
    const image: ZoomTarget = { kind: "image", id: VIDEO.fileKey, name: "5" };
    const keys = [
      zoomCacheKey(moment, AREA, 1024),
      zoomCacheKey(image, AREA, 1024),
      zoomCacheKey({ ...moment, seconds: 6 }, AREA, 1024),
      zoomCacheKey(moment, SHOWN, 1024),
      zoomCacheKey(moment, AREA, 768),
      sheetCacheKey(VIDEO.fileKey, { startSeconds: 5 }),
      sheetCacheKey("zoom", {}),
    ];
    expect(new Set(keys).size).toBe(keys.length);
  });
});
