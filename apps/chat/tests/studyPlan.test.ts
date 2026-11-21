import { GUTTER_PX, countGridPackingBlanks, modelVisionProfile } from "@vid2grid/core";
import { describe, expect, it } from "vitest";
import { newTimeline, planStudy, planZoom } from "../src/video/studyPlan";
import { model } from "./support/factories";
import { WIDE, flag, spans, zoomInput } from "./support/studyFixtures";

describe("planStudy windows", () => {
  it("makes a short video one window", () => {
    const plan = planStudy({
      durationSeconds: 20,
      sourceAspect: WIDE,
      resolution: 1568,
      model: model("qwen3-6-27b"),
    });
    expect(plan.windows).toEqual([{ startSeconds: 0, endSeconds: 20 }]);
    expect(plan.sheetsPerWindow).toBe(1);
    expect(plan.framesPerWindow).toBe(plan.perSheet);
  });

  it("keeps a video under one and a half windows as one window", () => {
    const plan = planStudy({
      durationSeconds: 60,
      sourceAspect: WIDE,
      resolution: 1568,
      model: model("qwen3-6-27b"),
    });
    expect(plan.windows).toEqual([{ startSeconds: 0, endSeconds: 60 }]);
  });

  it("splits a long video into 45 s windows, the last absorbing a short remainder", () => {
    const input = { sourceAspect: WIDE, resolution: 1568, model: model("qwen3-6-27b") };
    expect(planStudy({ ...input, durationSeconds: 100 }).windows).toEqual([
      { startSeconds: 0, endSeconds: 45 },
      { startSeconds: 45, endSeconds: 100 },
    ]);
    expect(planStudy({ ...input, durationSeconds: 120 }).windows).toEqual([
      { startSeconds: 0, endSeconds: 45 },
      { startSeconds: 45, endSeconds: 90 },
      { startSeconds: 90, endSeconds: 120 },
    ]);
  });

  it("honours a custom window length", () => {
    const plan = planStudy({
      durationSeconds: 60,
      sourceAspect: WIDE,
      resolution: 1568,
      model: model("qwen3-6-27b"),
      windowSeconds: 20,
    });
    expect(plan.windows.map((range) => range.startSeconds)).toEqual([0, 20, 40]);
  });

  it("covers only the asked range, clamped to the video", () => {
    const input = { sourceAspect: WIDE, resolution: 1568, model: model("qwen3-6-27b") };
    expect(
      planStudy({ ...input, durationSeconds: 600, startSeconds: 100, endSeconds: 200 }).windows,
    ).toEqual([
      { startSeconds: 100, endSeconds: 145 },
      { startSeconds: 145, endSeconds: 200 },
    ]);
    expect(
      planStudy({ ...input, durationSeconds: 120, startSeconds: 90, endSeconds: 500 }).windows,
    ).toEqual([{ startSeconds: 90, endSeconds: 120 }]);
  });
});

describe("planStudy sheets", () => {
  it.each([WIDE, 9 / 16, 4 / 3])("fills every sheet with no blanks for aspect %d", (aspect) => {
    const plan = planStudy({
      durationSeconds: 600,
      sourceAspect: aspect,
      resolution: 1568,
      model: model("qwen3-6-27b"),
    });
    const blanks = countGridPackingBlanks(plan.perSheet, {
      sourceAspect: aspect,
      outputResolution: 1568,
      gutterPx: GUTTER_PX,
    });
    expect(blanks).toBe(0);
    expect(plan.perSheet).toBeGreaterThanOrEqual(12);
    expect(plan.perSheet).toBeLessThanOrEqual(20);
    expect(plan.sheetsPerWindow).toBe(2);
    expect(plan.framesPerWindow).toBe(2 * plan.perSheet);
  });

  it("uses one sheet per window for a model that keeps one image", () => {
    const plan = planStudy({
      durationSeconds: 600,
      sourceAspect: WIDE,
      resolution: 1568,
      model: model("qwen3-6-27b", { maxImages: 1 }),
    });
    expect(plan.sheetsPerWindow).toBe(1);
    expect(plan.framesPerWindow).toBe(plan.perSheet);
  });
});

describe("planStudy density", () => {
  const input = {
    durationSeconds: 600,
    sourceAspect: WIDE,
    resolution: 1568,
    model: model("qwen3-6-27b"),
  };

  it("uses one sheet for a light study and up to four for a dense one", () => {
    const light = planStudy({ ...input, framesPerWindow: 12 });
    expect(light.sheetsPerWindow).toBe(1);
    expect(light.framesPerWindow).toBe(light.perSheet);
    const dense = planStudy({ ...input, framesPerWindow: 72 });
    expect(dense.sheetsPerWindow).toBe(4);
    expect(dense.framesPerWindow).toBe(4 * dense.perSheet);
    expect(dense.estimate.images).toBe(4 * dense.windows.length);
  });

  it("keeps within the model's image cap", () => {
    const plan = planStudy({
      ...input,
      model: model("qwen3-6-27b", { maxImages: 3 }),
      framesPerWindow: 72,
    });
    expect(plan.sheetsPerWindow).toBe(3);
  });
});

describe("planStudy estimate", () => {
  it("counts image tokens from the model's formula", () => {
    const plan = planStudy({
      durationSeconds: 120,
      sourceAspect: WIDE,
      resolution: 1024,
      model: model("qwen3-6-27b"),
    });
    const perImage = modelVisionProfile("qwen3-6-27b").imageTokens?.(1024) ?? 0;
    expect(perImage).toBeGreaterThan(0);
    expect(plan.estimate).toEqual({
      requests: 3,
      images: 6,
      inputTokens: 6 * perImage + 3 * 600,
      outputTokens: 3 * 700,
      seconds: 3 * 20 + 6 * 3,
      approximate: false,
    });
  });

  it("falls back to 1500 tokens an image, marked approximate, and prices the run", () => {
    const plan = planStudy({
      durationSeconds: 45,
      sourceAspect: WIDE,
      resolution: 1024,
      model: model("mystery-model", { pricing: { inputPerMTok: 1, outputPerMTok: 4 } }),
    });
    expect(plan.estimate).toEqual({
      requests: 1,
      images: 2,
      inputTokens: 3600,
      outputTokens: 700,
      costUsd: (3600 * 1 + 700 * 4) / 1_000_000,
      seconds: 20 + 2 * 3,
      approximate: true,
    });
  });
});

describe("newTimeline", () => {
  it("starts empty at the first window", () => {
    const plan = planStudy({
      durationSeconds: 120,
      sourceAspect: WIDE,
      resolution: 1024,
      model: model("qwen3-6-27b"),
    });
    expect(newTimeline("clip|1|2", "qwen3-6-27b", plan, 5)).toEqual({
      fileKey: "clip|1|2",
      modelId: "qwen3-6-27b",
      entries: [],
      nextWindow: 0,
      windowCount: 3,
      updatedAt: 5,
    });
  });
});

describe("planZoom spans", () => {
  it("pads each span by a second within the video and merges overlapping or near ones", () => {
    const unclear = [
      flag(0.5, 2),
      flag(10, 12),
      flag(13.4, 14),
      flag(30, 31),
      flag(33.3, 34),
      flag(50, 51),
      flag(53.6, 54),
      flag(118, 119.5),
    ];
    expect(spans(zoomInput(unclear))).toEqual([
      [0, 3],
      [9, 15],
      [29, 35],
      [49, 52],
      [52.6, 55],
      [117, 120],
    ]);
  });

  it("splits a stretch longer than 15 s into even parts", () => {
    const parts = spans(zoomInput([flag(10, 40)]));
    expect(parts).toHaveLength(3);
    expect(parts[0]?.[0]).toBe(9);
    expect(parts.at(-1)?.[1]).toBe(41);
    for (const [start, end] of parts) expect(end - start).toBeCloseTo(32 / 3);
    expect(parts[1]?.[0]).toBe(parts[0]?.[1]);
  });

  it("pads only within the studied range when one is given", () => {
    const unclear = [flag(60.5, 62), flag(99, 100)];
    expect(spans(zoomInput(unclear))).toEqual([
      [59.5, 63],
      [98, 101],
    ]);
    expect(spans(zoomInput(unclear, { startSeconds: 60, endSeconds: 100 }))).toEqual([
      [60, 63],
      [98, 100],
    ]);
  });

  it("skips spans already zoomed", () => {
    expect(spans(zoomInput([flag(10, 11, { zoomed: true }), flag(50, 51)]))).toEqual([[49, 52]]);
    expect(planZoom(zoomInput([flag(10, 11, { zoomed: true })])).zooms).toEqual([]);
  });

  it("caps a pass at 20 zooms, leaving the rest for another pass", () => {
    const unclear = Array.from({ length: 25 }, (_, index) => flag(index * 10 + 2, index * 10 + 3));
    const zooms = planZoom(zoomInput(unclear, { durationSeconds: 600 })).zooms;
    expect(zooms).toHaveLength(20);
    expect(zooms.at(-1)?.startSeconds).toBe(191);
  });
});

describe("planZoom sheets", () => {
  it("renders up to 4 frames a second on fewer, larger cells, at most 3 sheets", () => {
    const plan = planZoom(zoomInput([flag(10, 11), flag(50, 63)]));
    const coarse = planStudy({ ...zoomInput([]), durationSeconds: 600 });
    expect(plan.perSheet).toBeGreaterThanOrEqual(4);
    expect(plan.perSheet).toBeLessThanOrEqual(9);
    expect(plan.perSheet).toBeLessThan(coarse.perSheet);
    const blanks = countGridPackingBlanks(plan.perSheet, {
      sourceAspect: WIDE,
      outputResolution: 1024,
      gutterPx: GUTTER_PX,
    });
    expect(blanks).toBe(0);
    const [short, long] = plan.zooms;
    expect(short?.sheets).toBe(Math.max(1, Math.round((3 * 4) / plan.perSheet)));
    expect(long?.sheets).toBe(3);
    expect(long?.frameCount).toBe(3 * plan.perSheet);
  });

  it.each([
    [2, 2],
    [1, 1],
  ])("never uses more sheets than a model with %d images allows", (maxImages, sheets) => {
    const input = zoomInput([flag(50, 63)], { model: model("qwen3-6-27b", { maxImages }) });
    expect(planZoom(input).zooms[0]?.sheets).toBe(sheets);
  });

  it("estimates the pass exactly from the planned zooms", () => {
    const plan = planZoom(zoomInput([flag(10, 11), flag(50, 63)]));
    const perImage = modelVisionProfile("qwen3-6-27b").imageTokens?.(1024) ?? 0;
    const images = plan.zooms.reduce((total, zoom) => total + zoom.sheets, 0);
    expect(plan.estimate).toEqual({
      requests: 2,
      images,
      inputTokens: images * perImage + 2 * 600,
      outputTokens: 2 * 700,
      seconds: 2 * 20 + images * 3,
      approximate: false,
    });
  });
});
