import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { Canvas, createCanvas, type SKRSContext2D } from "@napi-rs/canvas";
import {
  buildRenderPlan,
  type CollagePlanRequest,
  type DrawOp,
  type RenderPlan,
  type VideoInfo,
} from "@vid2grid/core";
import { describe, expect, it } from "vitest";
import { fixturesDir, repoRoot } from "../../../packages/core/tests/fixturePaths";
import type { RgbaFrame } from "../src/capture";
import { createNodePorts } from "../src/index";
import { paintSheet } from "../src/render";

interface FrameFixture {
  name: string;
  video: string;
  request: CollagePlanRequest;
  info: VideoInfo;
  frames: { frameIndex: number; plannedSeconds: number; decodedSeconds: number }[];
}

type Painted = Record<string, unknown>;

function fixtureFiles(kind: string): string[] {
  return readdirSync(fixturesDir(kind)).filter((name) => name.endsWith(".json"));
}

function readJson<T>(kind: string, fileName: string): T {
  return JSON.parse(readFileSync(join(fixturesDir(kind), fileName), "utf-8")) as T;
}

const frameFixtures = fixtureFiles("frames");
const drawOpFixtures = fixtureFiles("draw-ops");

async function probeLikeTheFixture(video: string, request: CollagePlanRequest) {
  const ports = createNodePorts();
  const info = await ports.probe.probe(video);
  const keyframes = request.keyframeSampling
    ? await ports.probe.readKeyframeTimes(video)
    : undefined;
  return { ports, info: keyframes ? { ...info, keyframeTimestampsSeconds: keyframes } : info };
}

describe("fixtures/frames", () => {
  it("has fixtures to check", () => {
    expect(frameFixtures.length).toBeGreaterThan(0);
  });

  it.each(frameFixtures)("%s: probe, plan and capture match the goldens", async (fileName) => {
    const fixture = readJson<FrameFixture>("frames", fileName);
    const video = join(repoRoot, fixture.video);
    const { ports, info } = await probeLikeTheFixture(video, fixture.request);
    expect(info).toEqual(fixture.info);

    const plan = buildRenderPlan(fixture.request, info);
    expect(plan.frames.map((frame) => frame.timestampSeconds)).toEqual(
      fixture.frames.map((frame) => frame.plannedSeconds),
    );
    const decoded: number[] = [];
    for await (const image of ports.frames.capture(video, plan, info)) {
      decoded.push(image.decodedTimestampSeconds);
    }
    expect(decoded).toEqual(fixture.frames.map((frame) => frame.decodedSeconds));
  });
});

// Each style the painter sets must hold on the real context, or the canvas would draw
// with a stale one.
const STYLE_PROPERTIES = new Set([
  "font",
  "textBaseline",
  "fillStyle",
  "strokeStyle",
  "lineWidth",
  "lineJoin",
  "imageSmoothingEnabled",
  "imageSmoothingQuality",
]);

interface Recording {
  painted: Painted[];
  // A style that read back differently from what was set on the real context.
  unheld: Painted[];
}

function recordCall(target: SKRSContext2D, method: string, args: unknown[]): Painted | undefined {
  if (method === "fillRect") {
    const [x, y, width, height] = args;
    return { kind: "fillRect", x, y, width, height, color: target.fillStyle };
  }
  if (method === "drawImage") {
    const [image, x, y, width, height] = args;
    const source = image instanceof Canvas ? [image.width, image.height] : "not a canvas";
    return { kind: "image", x, y, width, height, source };
  }
  if (method !== "strokeText" && method !== "fillText") return undefined;
  const [text, x, y] = args;
  const measured = target.measureText(typeof text === "string" ? text : "").width;
  const color = method === "strokeText" ? target.strokeStyle : target.fillStyle;
  const stroke = method === "strokeText" ? { lineWidth: target.lineWidth } : {};
  const common = { text, font: target.font, baseline: target.textBaseline, color };
  return { kind: method, ...common, ...stroke, x, measured, y };
}

// Calls through to the real @napi-rs/canvas context and records what reaches it.
function recordingContext(real: SKRSContext2D, recording: Recording): SKRSContext2D {
  return new Proxy(real, {
    set(target, property, value: unknown) {
      const accepted = Reflect.set(target, property, value);
      if (typeof property === "string" && STYLE_PROPERTIES.has(property)) {
        const held: unknown = Reflect.get(target, property);
        if (held !== value) recording.unheld.push({ property, value, held });
      }
      return accepted;
    },
    get(target, property) {
      const member: unknown = Reflect.get(target, property);
      if (typeof member !== "function") return member;
      return (...args: unknown[]): unknown => {
        const call = typeof property === "string" ? recordCall(target, property, args) : undefined;
        if (call) recording.painted.push(call);
        const result: unknown = Reflect.apply(member, target, args);
        return result;
      };
    },
  });
}

// Core's draw op as a canvas host must carry it out: text stroked at lineWidth
// 2 * strokeWidthPx, then filled, with a top-right anchor at x minus the measured width.
function expectedCalls(op: DrawOp, plan: RenderPlan): Painted[] {
  if (op.kind === "fillRect") return [{ ...op }];
  if (op.kind === "image") {
    const { x, y, width, height } = op;
    return [{ kind: "image", x, y, width, height, source: [plan.cell.width, plan.cell.height] }];
  }
  const font = `${op.fontSizePx}px ${op.fontFamily}`;
  const common = { text: op.text, font, baseline: op.baseline };
  return [
    { kind: "strokeText", ...common, color: op.stroke, lineWidth: 2 * op.strokeWidthPx },
    { kind: "fillText", ...common, color: op.fill },
  ].map((call) => ({ ...call, anchor: op.anchor, anchorX: op.x, y: op.y }));
}

// Resolves each recorded text call's anchor point the way its golden op asks for.
function anchored(painted: Painted[], expected: Painted[]): Painted[] {
  return painted.map((call, i) => {
    const { x, measured, ...rest } = call;
    if (typeof x !== "number" || typeof measured !== "number") return call;
    const anchor = expected[i]?.anchor;
    const anchorX = anchor === "top-right" ? x + measured : x;
    return { ...rest, anchor, anchorX: Math.round(anchorX * 1e6) / 1e6 };
  });
}

function blankFrame(plan: RenderPlan): RgbaFrame {
  const { width, height } = plan.cell;
  return {
    width,
    height,
    data: new Uint8ClampedArray(width * height * 4),
    decodedTimestampSeconds: 0,
  };
}

function paintRecorded(plan: RenderPlan, sheetIndex: number, captured: number): Recording {
  const sheet = plan.sheets[sheetIndex];
  if (!sheet) throw new Error(`no sheet ${sheetIndex}`);
  const images = sheet.cells.map((_, i) => (i < captured ? blankFrame(plan) : undefined));
  const recording: Recording = { painted: [], unheld: [] };
  const real = createCanvas(plan.canvas.width, plan.canvas.height).getContext("2d");
  paintSheet(recordingContext(real, recording), plan, { sheet, images });
  return recording;
}

function expectPaintedExactly(
  plan: RenderPlan,
  sheetIndex: number,
  ops: DrawOp[],
  captured: number,
) {
  const { painted, unheld } = paintRecorded(plan, sheetIndex, captured);
  const expected = ops.flatMap((op) => expectedCalls(op, plan));
  expect(unheld).toEqual([]);
  expect(anchored(painted, expected)).toEqual(expected);
}

function goldenCase(fileName: string) {
  const { sheets } = readJson<{ sheets: DrawOp[][] }>("draw-ops", fileName);
  const { plan } = readJson<{ plan: RenderPlan }>("render-plans", fileName);
  return { sheets, plan };
}

describe("fixtures/draw-ops", () => {
  it("has a render plan for every draw-op golden", () => {
    expect(drawOpFixtures.length).toBeGreaterThan(0);
    expect(drawOpFixtures).toEqual(fixtureFiles("render-plans"));
  });

  it.each(drawOpFixtures)("%s: the canvas receives exactly the golden ops", (fileName) => {
    const { sheets, plan } = goldenCase(fileName);
    for (const sheetIndex of new Set([0, sheets.length - 1])) {
      const cellCount = plan.sheets[sheetIndex]?.cells.length ?? 0;
      expectPaintedExactly(plan, sheetIndex, sheets[sheetIndex] ?? [], cellCount);
    }
  });

  it("skips both the image and the text of a cell with no captured frame", () => {
    const [fileName] = drawOpFixtures;
    if (!fileName) throw new Error("no draw-op fixtures");
    const { sheets, plan } = goldenCase(fileName);
    const kept = (sheets[0] ?? []).filter((op) => op.kind === "fillRect" || op.cellIndex === 0);
    expectPaintedExactly(plan, 0, kept, 1);
  });
});
