import { describe, expect, it } from "vitest";
import { buildRenderPlan } from "../src/plan/buildRenderPlan";
import type { CollagePlanRequest, VideoInfo } from "../src/types";

// The hand-verified worked example: a 3s 320x240 clip at 2fps, 4 frames per
// 512px sheet. Every number below was computed by hand from the layout rules.
const WORKED_INFO: VideoInfo = { durationSeconds: 3, width: 320, height: 240 };

function workedRequest(overrides: Partial<CollagePlanRequest> = {}): CollagePlanRequest {
  return {
    startSeconds: 0,
    endSeconds: 3,
    targetFps: 2,
    framesPerGrid: 4,
    outputResolution: 512,
    jpegQuality: 85,
    ...overrides,
  };
}

describe("buildRenderPlan, worked example", () => {
  const plan = buildRenderPlan(workedRequest({ transcript: { scope: "per-sheet" } }), WORKED_INFO);

  it("stamps the contract version, canvas and jpeg quality", () => {
    expect(plan.version).toBe(1);
    expect(plan.canvas).toEqual({ width: 512, height: 512 });
    expect(plan.jpegQuality).toBe(85);
  });

  it("packs a 2x2 grid of 244x183 cells centred vertically", () => {
    expect(plan.layout).toEqual({ cols: 2, rows: 2, offsetX: 0, offsetY: 61 });
    expect(plan.cell).toEqual({ width: 244, height: 183 });
  });

  it("plans 6 frames from 0 to 2.5s across 2 sheets", () => {
    expect(plan.frames.map((frame) => frame.timestampSeconds)).toEqual([0, 0.5, 1, 1.5, 2, 2.5]);
    expect(plan.sheets.map((sheet) => sheet.fileName)).toEqual(["grid_0001.jpg", "grid_0002.jpg"]);
    expect(plan.sheets[1].cells.map((cell) => cell.frameIndex)).toEqual([4, 5]);
  });

  it("places cells at the gutter-stepped pixel positions", () => {
    expect(plan.sheets[0].cells.map((cell) => [cell.x, cell.y])).toEqual([
      [8, 69],
      [260, 69],
      [8, 260],
      [260, 260],
    ]);
    for (const cell of plan.sheets[0].cells) {
      expect([cell.width, cell.height]).toEqual([244, 183]);
    }
  });

  it("shows milliseconds only, at 11px text with a 1px stroke", () => {
    expect(plan.timestampFormat).toEqual({
      showHours: false,
      showMinutes: false,
      showMilliseconds: true,
    });
    expect(plan.sheets[0].cells[0].watermarks).toEqual([
      {
        text: "00.000",
        anchor: "top-left",
        x: 12,
        y: 73,
        fontSizePx: 11,
        strokeWidthPx: 1,
      },
      {
        text: "0",
        anchor: "top-right",
        x: 248,
        y: 73,
        fontSizePx: 11,
        strokeWidthPx: 1,
      },
    ]);
  });

  it("anchors the frame index at the cell's right edge and the timestamp at its left", () => {
    const [timestamp, index] = plan.sheets[1].cells[1].watermarks;
    expect(timestamp).toMatchObject({ text: "02.500", anchor: "top-left", x: 264 });
    expect(index).toMatchObject({ text: "5", anchor: "top-right", x: 500 });
  });

  it("splits the transcript windows at the midpoint between sheets", () => {
    expect(plan.sheets.map((sheet) => sheet.transcript)).toEqual([
      { startSeconds: 0, endSeconds: 1.75, fileName: "grid_0001.vtt" },
      { startSeconds: 1.75, endSeconds: 3, fileName: "grid_0002.vtt" },
    ]);
    expect(plan.combinedTranscript).toBeUndefined();
  });
});

describe("buildRenderPlan", () => {
  it("uses the fixed black-on-white-stroke style", () => {
    expect(buildRenderPlan(workedRequest(), WORKED_INFO).style).toEqual({
      background: "black",
      textFill: "black",
      textStroke: "white",
      fontFamily: "sans-serif",
      textBaseline: "top",
    });
  });

  it("keeps the full layout on a trailing partial sheet", () => {
    const plan = buildRenderPlan(
      workedRequest({ endSeconds: 3.5, targetFps: 2, framesPerGrid: 4 }),
      { ...WORKED_INFO, durationSeconds: 4 },
    );

    expect(plan.frames).toHaveLength(7);
    expect(plan.layout).toMatchObject({ cols: 2, rows: 2 });
    expect(plan.sheets[1].cells).toHaveLength(3);
    expect(plan.sheets[1].cells.map((cell) => [cell.x, cell.y])).toEqual([
      [8, 69],
      [260, 69],
      [8, 260],
    ]);
  });

  it("clamps tiny cells' text to the minimum font size and a 1px stroke", () => {
    const plan = buildRenderPlan(
      workedRequest({ framesPerGrid: 16, outputResolution: 256 }),
      WORKED_INFO,
    );

    expect(plan.cell.height).toBeLessThan(8 * 16);
    expect(plan.sheets[0].cells[0].watermarks[0]).toMatchObject({
      fontSizePx: 8,
      strokeWidthPx: 1,
    });
  });

  it("emits one combined window instead of per-sheet ones for scope 'combined'", () => {
    const plan = buildRenderPlan(
      workedRequest({ transcript: { scope: "combined" }, startSeconds: 0.5 }),
      WORKED_INFO,
    );

    expect(plan.combinedTranscript).toEqual({
      startSeconds: 0.5,
      endSeconds: 3,
      fileName: "transcript.vtt",
    });
    expect(plan.sheets.every((sheet) => sheet.transcript === undefined)).toBe(true);
  });

  it("omits transcript windows entirely when no transcript was asked for", () => {
    const plan = buildRenderPlan(workedRequest(), WORKED_INFO);
    expect(plan.combinedTranscript).toBeUndefined();
    expect(plan.sheets[0].transcript).toBeUndefined();
  });

  it("plans the source's keyframes when keyframe sampling is on", () => {
    const plan = buildRenderPlan(workedRequest({ keyframeSampling: true, maxKeyframes: 2 }), {
      ...WORKED_INFO,
      keyframeTimestampsSeconds: [0, 1, 2, 2.9],
    });

    expect(plan.frames).toEqual([
      { frameIndex: 0, timestampSeconds: 0 },
      { frameIndex: 1, timestampSeconds: 2 },
    ]);
  });

  it("plans no sheets when no frame falls in the range", () => {
    const plan = buildRenderPlan(workedRequest({ keyframeSampling: true }), {
      ...WORKED_INFO,
      keyframeTimestampsSeconds: [],
    });

    expect(plan.frames).toEqual([]);
    expect(plan.sheets).toEqual([]);
    expect(plan.timestampFormat).toEqual({
      showHours: false,
      showMinutes: false,
      showMilliseconds: false,
    });
  });

  it("rejects an invalid request", () => {
    expect(() => buildRenderPlan(workedRequest({ endSeconds: 0 }), WORKED_INFO)).toThrowError(
      /end_time/,
    );
    expect(() => buildRenderPlan(workedRequest({ frameCount: 2.5 }), WORKED_INFO)).toThrowError(
      /frame_count/,
    );
    expect(() => buildRenderPlan(workedRequest({ maxKeyframes: 0 }), WORKED_INFO)).toThrowError(
      /max_keyframes/,
    );
  });

  it("rejects an output resolution too small for the grid", () => {
    expect(() =>
      buildRenderPlan(workedRequest({ framesPerGrid: 64, outputResolution: 64 }), WORKED_INFO),
    ).toThrowError(/output_resolution/);
  });
});
