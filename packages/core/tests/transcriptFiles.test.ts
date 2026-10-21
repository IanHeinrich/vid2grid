import { describe, expect, it } from "vitest";
import { buildRenderPlan } from "../src/plan/buildRenderPlan";
import type { CollagePlanRequest, TranscriptScope } from "../src/plan/request";
import type { VideoInfo } from "../src/probe/videoInfo";
import {
  NO_TRANSCRIPTION_PORT,
  transcriptFiles,
  transcriptionFailedWarning,
  transcriptWindows,
} from "../src/transcript/transcriptFiles";
import type { TranscriptCue } from "../src/transcript/vtt";

const INFO: VideoInfo = { durationSeconds: 40, width: 1280, height: 720 };

function planFor(scope: TranscriptScope) {
  const request: CollagePlanRequest = {
    startSeconds: 5,
    endSeconds: 35,
    targetFps: 1,
    framesPerGrid: 6,
    outputResolution: 512,
    jpegQuality: 85,
    transcript: { scope },
  };
  return buildRenderPlan(request, INFO);
}

describe("transcriptWindows", () => {
  it("is the plan's own sheet windows when every sheet rendered", () => {
    const plan = planFor("per-sheet");
    expect(transcriptWindows(plan, plan.sheets.length, 35)).toEqual(
      plan.sheets.map((sheet) => sheet.transcript),
    );
  });

  it("runs the last rendered sheet's window out to the end when later sheets were dropped", () => {
    const windows = transcriptWindows(planFor("per-sheet"), 2, 35);
    expect(windows).toEqual([
      { startSeconds: 5, endSeconds: 10.5, fileName: "grid_0001.vtt" },
      { startSeconds: 10.5, endSeconds: 35, fileName: "grid_0002.vtt" },
    ]);
  });

  it("is the one combined window whatever rendered", () => {
    expect(transcriptWindows(planFor("combined"), 1, 35)).toEqual([
      { startSeconds: 5, endSeconds: 35, fileName: "transcript.vtt" },
    ]);
  });

  it("is empty when no sheet rendered", () => {
    expect(transcriptWindows(planFor("per-sheet"), 0, 35)).toEqual([]);
  });
});

describe("transcriptFiles", () => {
  const cues: TranscriptCue[] = [
    { start: 6, end: 7, text: "first" },
    { start: 30, end: 31, text: "late" },
  ];

  it("writes each window's overlapping cues as WebVTT under its file name", () => {
    expect(transcriptFiles(planFor("per-sheet"), 2, 35, cues)).toEqual([
      { fileName: "grid_0001.vtt", vtt: "WEBVTT\n\n00:00:06.000 --> 00:00:07.000\nfirst\n" },
      { fileName: "grid_0002.vtt", vtt: "WEBVTT\n\n00:00:30.000 --> 00:00:31.000\nlate\n" },
    ]);
  });

  it("writes a header-only file for a window with no cues", () => {
    const files = transcriptFiles(planFor("per-sheet"), 5, 35, cues);
    expect(files[1]).toEqual({ fileName: "grid_0002.vtt", vtt: "WEBVTT\n" });
  });
});

describe("transcription warnings", () => {
  it("tags a no_audio failure with its own code", () => {
    expect(transcriptionFailedWarning("no audio track", "no_audio")).toEqual({
      code: "no_audio",
      message: "Transcript generation failed: no audio track",
    });
  });

  it("tags any other failure as transcription_failed", () => {
    expect(transcriptionFailedWarning("decoder crashed")).toEqual({
      code: "transcription_failed",
      message: "Transcript generation failed: decoder crashed",
    });
    expect(transcriptionFailedWarning("bad", "internal").code).toBe("transcription_failed");
  });

  it("names a host with no transcription support", () => {
    expect(NO_TRANSCRIPTION_PORT).toEqual({
      code: "no_transcription_port",
      message: "Transcript generation failed: this host has no transcription support",
    });
  });
});
