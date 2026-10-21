import { describe, expect, it } from "vitest";
import { Vid2GridError } from "../src/errors";
import { buildRenderPlan } from "../src/plan/buildRenderPlan";
import { sheetDrawOps } from "../src/render/drawOps";
import type { CollagePlanRequest } from "../src/plan/request";
import type { VideoInfo } from "../src/probe/videoInfo";

const INFO: VideoInfo = { durationSeconds: 3, width: 320, height: 240 };
const REQUEST: CollagePlanRequest = {
  startSeconds: 0,
  endSeconds: 3,
  targetFps: 2,
  framesPerGrid: 4,
  outputResolution: 512,
  jpegQuality: 85,
};

describe("sheetDrawOps", () => {
  const plan = buildRenderPlan(REQUEST, INFO);

  it("starts by filling the whole canvas with the background", () => {
    expect(sheetDrawOps(plan, 0)[0]).toEqual({
      kind: "fillRect",
      x: 0,
      y: 0,
      width: 512,
      height: 512,
      color: "black",
    });
  });

  it("draws each cell's image before its watermarks, in cell order", () => {
    const ops = sheetDrawOps(plan, 0);

    expect(ops.map((op) => op.kind)).toEqual([
      "fillRect",
      ...Array.from({ length: 4 }, () => ["image", "text", "text"]).flat(),
    ]);
    expect(ops.filter((op) => op.kind === "image")).toEqual([
      { kind: "image", cellIndex: 0, x: 8, y: 69, width: 244, height: 183 },
      { kind: "image", cellIndex: 1, x: 260, y: 69, width: 244, height: 183 },
      { kind: "image", cellIndex: 2, x: 8, y: 260, width: 244, height: 183 },
      { kind: "image", cellIndex: 3, x: 260, y: 260, width: 244, height: 183 },
    ]);
  });

  it("carries each watermark with its anchor unresolved and the plan's text style", () => {
    const [timestamp, frameIndex] = sheetDrawOps(plan, 0).filter((op) => op.kind === "text");

    expect(timestamp).toEqual({
      kind: "text",
      cellIndex: 0,
      text: "00.000",
      x: 12,
      y: 73,
      anchor: "top-left",
      baseline: "top",
      fontSizePx: 11,
      fontFamily: "sans-serif",
      fill: "black",
      stroke: "white",
      strokeWidthPx: 1,
    });
    expect(frameIndex).toMatchObject({ cellIndex: 0, text: "0", x: 248, anchor: "top-right" });
  });

  it("plans a later sheet from its own cells", () => {
    const texts = sheetDrawOps(plan, 1).flatMap((op) => (op.kind === "text" ? [op.text] : []));

    expect(texts).toEqual(["02.000", "4", "02.500", "5"]);
  });

  it("rejects a sheet index the plan does not have", () => {
    expect(() => sheetDrawOps(plan, 2)).toThrow(Vid2GridError);
    expect(() => sheetDrawOps(plan, 2)).toThrow("sheetIndex 2 is not one of this plan's 2 sheets");
  });
});
