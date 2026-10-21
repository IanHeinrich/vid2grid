import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { EmbeddedCore } from "../src/embed";
import { OPTION_SPECS, optionSpecsFor } from "../src/plan/options";
import "../src/embed";

const { vid2gridCore } = globalThis as unknown as { vid2gridCore: EmbeddedCore };

function call(name: string, ...args: unknown[]): unknown {
  return JSON.parse(vid2gridCore.call(name, JSON.stringify(args)));
}

interface Fixture {
  request: Record<string, unknown>;
  info: Record<string, unknown>;
  plan: unknown;
}

const fixturePath = join(
  __dirname,
  "..",
  "..",
  "..",
  "fixtures",
  "render-plans",
  "landscape-3s-fps2-4up-512.json",
);
const fixture = JSON.parse(readFileSync(fixturePath, "utf-8")) as Fixture;

describe("vid2gridCore.call", () => {
  it("returns a fixture's plan in an ok envelope", () => {
    expect(call("buildRenderPlan", fixture.request, fixture.info)).toEqual({
      ok: true,
      value: fixture.plan,
    });
  });

  it("reports the contract version", () => {
    expect(call("version")).toEqual({ ok: true, value: 1 });
  });

  it("sends an absent result as null rather than dropping the value", () => {
    expect(call("collagePlanRequestProblem", fixture.request)).toEqual({ ok: true, value: null });
    expect(call("validateCollagePlanRequest", fixture.request)).toEqual({ ok: true, value: null });
  });

  it("maps a Vid2GridError onto its own code and message", () => {
    expect(call("validateCollagePlanRequest", { ...fixture.request, jpegQuality: 0 })).toEqual({
      ok: false,
      code: "invalid_request",
      message: "jpeg_quality must be between 1 and 100",
    });
  });

  it("maps any other throw to internal, carrying its message", () => {
    expect(call("buildRenderPlan", fixture.request)).toMatchObject({ ok: false, code: "internal" });
    expect(JSON.parse(vid2gridCore.call("version", "not json"))).toMatchObject({
      ok: false,
      code: "internal",
      message: expect.stringContaining("JSON") as unknown,
    });
  });

  it("rejects arguments that are not a JSON array", () => {
    expect(JSON.parse(vid2gridCore.call("version", "{}"))).toEqual({
      ok: false,
      code: "internal",
      message: "argsJson must be a JSON array of positional arguments",
    });
  });

  it("rejects an unknown function name, inherited object keys included", () => {
    expect(call("paintSheetFromPlan")).toEqual({
      ok: false,
      code: "internal",
      message: 'unknown function "paintSheetFromPlan"',
    });
    expect(call("toString")).toMatchObject({ ok: false, code: "internal" });
  });
});

describe("the functions vid2gridCore exposes", () => {
  it("include the draw ops, the keyframe decision and the probe helpers", () => {
    const drawOps = call("sheetDrawOps", fixture.plan, 0) as { ok: boolean; value: unknown[] };
    expect(drawOps.ok).toBe(true);
    expect(drawOps.value[0]).toMatchObject({ kind: "fillRect", width: 512, height: 512 });
    expect(
      call("resolveKeyframeSampling", { ...fixture.request, keyframeSampling: true }, fixture.info),
    ).toMatchObject({
      ok: true,
      value: { request: { keyframeSampling: false }, warning: { code: "keyframes_unavailable" } },
    });
    expect(call("displaySize", 720, 480, { numerator: 32, denominator: 27 }, 90)).toEqual({
      ok: true,
      value: { width: 480, height: 853 },
    });
    expect(call("normalizeRotationClockwise", -90)).toEqual({ ok: true, value: 90 });
    expect(call("gridsFolderName", "my clip.mp4", "2026-10-21T09:08:07.000Z")).toEqual({
      ok: true,
      value: "my clip_grids_2026-10-21_090807",
    });
  });

  it("include the option spec and the request built from options", () => {
    expect(call("optionSpecs")).toEqual({ ok: true, value: optionSpecsFor() });
    expect(call("optionSpecs", ["transcription"])).toEqual({ ok: true, value: OPTION_SPECS });
    expect(call("requestFromOptions", { targetFps: 2 }, fixture.info)).toMatchObject({
      ok: true,
      value: { targetFps: 2, endSeconds: 3 },
    });
    expect(call("requestFromOptions", { fps: 2 }, fixture.info)).toEqual({
      ok: false,
      code: "invalid_request",
      message: 'unknown option "fps"',
    });
    expect(
      call("requestFromOptions", { transcript: "combined" }, fixture.info, ["transcription"]),
    ).toMatchObject({ ok: true, value: { transcript: { scope: "combined" } } });
    expect(call("requestFromOptions", { transcript: "combined" }, fixture.info)).toMatchObject({
      ok: false,
      code: "invalid_request",
    });
  });
});

describe("the transcript helpers vid2gridCore exposes", () => {
  const perSheet = { ...fixture.request, transcript: { scope: "per-sheet" } };
  const plan = (call("buildRenderPlan", perSheet, fixture.info) as { value: unknown }).value;

  it("map recogniser segments onto the video's timeline", () => {
    expect(call("cuesFromSegments", [{ start: 0, end: null, text: " hi " }], 2)).toEqual({
      ok: true,
      value: [{ start: 2, end: 2, text: "hi" }],
    });
  });

  it("name and write the transcript files for the sheets that rendered", () => {
    expect(call("transcriptFiles", plan, 1, 3, [{ start: 2.5, end: 2.9, text: "late" }])).toEqual({
      ok: true,
      value: [
        { fileName: "grid_0001.vtt", vtt: "WEBVTT\n\n00:00:02.500 --> 00:00:02.900\nlate\n" },
      ],
    });
  });

  it("build the transcription warnings", () => {
    expect(call("transcriptionFailedWarning", "no audio track", "no_audio")).toEqual({
      ok: true,
      value: { code: "no_audio", message: "Transcript generation failed: no audio track" },
    });
    expect(call("transcriptionFailedWarning", "boom")).toMatchObject({
      value: { code: "transcription_failed" },
    });
    expect(call("noTranscriptionPortWarning")).toMatchObject({
      value: { code: "no_transcription_port" },
    });
  });
});
