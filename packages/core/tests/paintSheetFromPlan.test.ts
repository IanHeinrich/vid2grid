import { describe, expect, it } from "vitest";
import { buildRenderPlan } from "../src/plan/buildRenderPlan";
import { paintSheetFromPlan } from "../src/render/paintSheetFromPlan";
import type { SheetContext2D } from "../src/render/sheetContext";
import type { CollagePlanRequest, VideoInfo } from "../src/types";

const INFO: VideoInfo = { durationSeconds: 3, width: 320, height: 240 };
const REQUEST: CollagePlanRequest = {
  startSeconds: 0,
  endSeconds: 3,
  targetFps: 2,
  framesPerGrid: 4,
  outputResolution: 512,
  jpegQuality: 85,
};

// Each measured character is 7px wide, so a right-anchored x shifts by a known
// amount the plan itself never knows.
const CHARACTER_WIDTH = 7;

type Call =
  | { call: "fillRect"; args: number[]; fillStyle: unknown }
  | { call: "drawImage"; args: [string, number, number, number, number] }
  | { call: "strokeText"; args: [string, number, number]; lineWidth: number; strokeStyle: unknown }
  | { call: "fillText"; args: [string, number, number]; font: string; fillStyle: unknown };

function recordingContext(): { ctx: SheetContext2D<string>; calls: Call[] } {
  const calls: Call[] = [];
  const ctx: SheetContext2D<string> = {
    fillStyle: undefined,
    strokeStyle: undefined,
    lineWidth: 0,
    lineJoin: "miter",
    textBaseline: "alphabetic",
    imageSmoothingEnabled: false,
    imageSmoothingQuality: "low",
    font: "",
    fillRect: (x, y, w, h) =>
      calls.push({ call: "fillRect", args: [x, y, w, h], fillStyle: ctx.fillStyle }),
    drawImage: (image, x, y, w, h) => calls.push({ call: "drawImage", args: [image, x, y, w, h] }),
    measureText: (text) => ({ width: text.length * CHARACTER_WIDTH }),
    strokeText: (text, x, y) =>
      calls.push({
        call: "strokeText",
        args: [text, x, y],
        lineWidth: ctx.lineWidth,
        strokeStyle: ctx.strokeStyle,
      }),
    fillText: (text, x, y) =>
      calls.push({
        call: "fillText",
        args: [text, x, y],
        font: ctx.font,
        fillStyle: ctx.fillStyle,
      }),
  };
  return { ctx, calls };
}

describe("paintSheetFromPlan", () => {
  const plan = buildRenderPlan(REQUEST, INFO);
  const sheet = plan.sheets[0];

  it("fills the whole canvas with the background before drawing anything", () => {
    const { ctx, calls } = recordingContext();
    paintSheetFromPlan(ctx, plan, sheet, ["a", "b", "c", "d"]);

    expect(calls[0]).toEqual({ call: "fillRect", args: [0, 0, 512, 512], fillStyle: "black" });
    expect(ctx.imageSmoothingEnabled).toBe(true);
    expect(ctx.imageSmoothingQuality).toBe("high");
  });

  it("draws each image into its planned cell rectangle", () => {
    const { ctx, calls } = recordingContext();
    paintSheetFromPlan(ctx, plan, sheet, ["a", "b", "c", "d"]);

    expect(calls.filter((call) => call.call === "drawImage")).toEqual([
      { call: "drawImage", args: ["a", 8, 69, 244, 183] },
      { call: "drawImage", args: ["b", 260, 69, 244, 183] },
      { call: "drawImage", args: ["c", 8, 260, 244, 183] },
      { call: "drawImage", args: ["d", 260, 260, 244, 183] },
    ]);
  });

  it("strokes each watermark before filling it, at twice the planned stroke width", () => {
    const { ctx, calls } = recordingContext();
    paintSheetFromPlan(ctx, plan, sheet, ["a", undefined, undefined, undefined]);

    expect(calls.map((call) => call.call)).toEqual([
      "fillRect",
      "drawImage",
      "strokeText",
      "fillText",
      "strokeText",
      "fillText",
    ]);
    const [stroke] = calls.filter((call) => call.call === "strokeText");
    expect(stroke).toEqual({
      call: "strokeText",
      args: ["00.000", 12, 73],
      lineWidth: 2 * plan.sheets[0].cells[0].watermarks[0].strokeWidthPx,
      strokeStyle: "white",
    });
    expect(calls.find((call) => call.call === "fillText")).toEqual({
      call: "fillText",
      args: ["00.000", 12, 73],
      font: "11px sans-serif",
      fillStyle: "black",
    });
    expect(ctx.textBaseline).toBe("top");
    expect(ctx.lineJoin).toBe("round");
  });

  it("shifts a top-right watermark left by the measured text width", () => {
    const { ctx, calls } = recordingContext();
    paintSheetFromPlan(ctx, plan, sheet, ["a", undefined, undefined, undefined]);

    const indexFill = calls.filter((call) => call.call === "fillText")[1];
    // Planned right edge 248, minus one measured character.
    expect(indexFill.args).toEqual(["0", 248 - CHARACTER_WIDTH, 73]);
  });

  it("leaves a cell with no captured image untouched", () => {
    const { ctx, calls } = recordingContext();
    paintSheetFromPlan(ctx, plan, sheet, ["a", undefined, "c", undefined]);

    expect(calls.filter((call) => call.call === "drawImage").map((call) => call.args[0])).toEqual([
      "a",
      "c",
    ]);
    expect(calls.filter((call) => call.call === "fillText").map((call) => call.args[0])).toEqual([
      "00.000",
      "0",
      "01.000",
      "2",
    ]);
  });
});
