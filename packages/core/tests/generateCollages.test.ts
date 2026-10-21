import { describe, expect, it } from "vitest";
import { Vid2GridError } from "../src/errors";
import {
  generateCollages,
  type GenerationTimings,
  type Vid2GridWarning,
} from "../src/pipeline/generateCollages";
import type {
  CollagePorts,
  PortProgress,
  Progress,
  SheetRenderJob,
  TranscriptPort,
} from "../src/pipeline/ports";
import type { RenderPlan } from "../src/plan/renderPlan";
import type { CollagePlanRequest } from "../src/plan/request";
import type { VideoInfo } from "../src/probe/videoInfo";
import type { TranscriptCue } from "../src/transcript/vtt";

// Images and encoded files are plain strings here: real Blob/ImageBitmap behaviour is the
// browser package's to test, so only the pipeline's own decisions are under test.
type FakePorts = CollagePorts<string, string, string>;

const VIDEO_INFO: VideoInfo = { durationSeconds: 10, width: 640, height: 480 };

interface FakePortOverrides {
  captureCount?: number;
  onCapture?: (plan: RenderPlan) => void;
  captureProgress?: PortProgress;
  onJobs?: (jobs: SheetRenderJob<string>[]) => void;
  transcribe?: TranscriptPort<string>["transcribe"];
  omitTranscriptPort?: boolean;
  probeInfo?: VideoInfo;
  keyframeTimes?: number[];
  keyframeReadError?: Error;
  onProbe?: () => void;
  onReadKeyframeTimes?: () => void;
}

function fakePorts(overrides: FakePortOverrides = {}): FakePorts {
  const ports: FakePorts = {
    probe: {
      probe: () => {
        overrides.onProbe?.();
        return Promise.resolve(overrides.probeInfo ?? VIDEO_INFO);
      },
      readKeyframeTimes: () => {
        overrides.onReadKeyframeTimes?.();
        if (overrides.keyframeReadError) return Promise.reject(overrides.keyframeReadError);
        return Promise.resolve(overrides.keyframeTimes);
      },
    },
    frames: {
      capture: (_source, plan, onProgress) => {
        overrides.onCapture?.(plan);
        const count = overrides.captureCount ?? plan.frames.length;
        if (overrides.captureProgress) onProgress?.(overrides.captureProgress);
        return Promise.resolve(
          plan.frames.slice(0, count).map((frame) => `frame-${frame.frameIndex}`),
        );
      },
    },
    sheets: {
      encode: (plan, jobs, onProgress) => {
        overrides.onJobs?.(jobs);
        onProgress?.({ done: jobs.length, total: jobs.length });
        return Promise.resolve(
          jobs.map((job) => `jpeg:${plan.jpegQuality}:${job.images.join(",")}`),
        );
      },
    },
    text: { encodeText: (text, mimeType) => `${mimeType}\n${text}` },
    clock: { now: () => 0 },
  };
  if (!overrides.omitTranscriptPort) {
    ports.transcript = { transcribe: overrides.transcribe ?? (() => Promise.resolve([])) };
  }
  return ports;
}

function baseRequest(overrides: Partial<CollagePlanRequest> = {}): CollagePlanRequest {
  return {
    startSeconds: 0,
    endSeconds: 1,
    targetFps: 10,
    framesPerGrid: 4,
    outputResolution: 256,
    jpegQuality: 80,
    ...overrides,
  };
}

describe("generateCollages", () => {
  it("encodes one file per planned sheet, named by the plan", async () => {
    const { plan, sheets, transcriptFiles } = await generateCollages(
      "video",
      baseRequest(),
      fakePorts(),
      { videoInfo: VIDEO_INFO },
    );

    expect(plan.frames).toHaveLength(10);
    expect(sheets.map((sheet) => sheet.name)).toEqual([
      "grid_0001.jpg",
      "grid_0002.jpg",
      "grid_0003.jpg",
    ]);
    expect(sheets[0]?.data).toBe("jpeg:80:frame-0,frame-1,frame-2,frame-3");
    expect(sheets[2]?.data).toBe("jpeg:80:frame-8,frame-9");
    expect(transcriptFiles).toEqual([]);
  });

  it("returns the plan with no sheets when nothing was captured", async () => {
    const { plan, sheets, transcriptFiles } = await generateCollages(
      "video",
      baseRequest(),
      fakePorts({ captureCount: 0 }),
      { videoInfo: VIDEO_INFO },
    );

    expect(plan.sheets).toHaveLength(3);
    expect(sheets).toEqual([]);
    expect(transcriptFiles).toEqual([]);
  });

  it("drops sheets the short capture never reached and leaves their missing cells undefined", async () => {
    let seenJobs: SheetRenderJob<string>[] = [];
    const { sheets } = await generateCollages(
      "video",
      baseRequest(),
      fakePorts({ captureCount: 6, onJobs: (jobs) => (seenJobs = jobs) }),
      { videoInfo: VIDEO_INFO },
    );

    expect(seenJobs.map((job) => job.sheet.fileName)).toEqual(["grid_0001.jpg", "grid_0002.jpg"]);
    expect(seenJobs[1]?.images).toEqual(["frame-4", "frame-5", undefined, undefined]);
    expect(sheets.map((sheet) => sheet.name)).toEqual(["grid_0001.jpg", "grid_0002.jpg"]);
  });

  it("rejects an invalid request with an invalid_request error before touching any port", async () => {
    let probed = false;
    const ports = fakePorts({ onProbe: () => (probed = true) });

    const failure = generateCollages("video", baseRequest({ endSeconds: 0 }), ports);
    await expect(failure).rejects.toThrowError(Vid2GridError);
    await expect(failure).rejects.toMatchObject({
      code: "invalid_request",
      message: "end_time must be greater than start_time",
    });
    expect(probed).toBe(false);
  });

  it("probes the source only when the caller didn't supply videoInfo", async () => {
    let probeCalls = 0;
    const ports = fakePorts({ onProbe: () => probeCalls++ });

    await generateCollages("video", baseRequest(), ports);
    expect(probeCalls).toBe(1);

    await generateCollages("video", baseRequest(), ports, { videoInfo: VIDEO_INFO });
    expect(probeCalls).toBe(1);
  });

  it("hands the capture port a plan carrying the cell size and keyframe mode", async () => {
    const seenPlans: RenderPlan[] = [];
    await generateCollages(
      "video",
      baseRequest({ keyframeSampling: true, targetFps: 2 }),
      fakePorts({ onCapture: (plan) => seenPlans.push(plan) }),
      { videoInfo: { ...VIDEO_INFO, keyframeTimestampsSeconds: [0, 0.5, 0.75] } },
    );

    // 4 frames of a 4:3 source into 256px, 8px gutters: a 2x2 grid of 116x87 cells.
    expect(seenPlans[0]?.cell).toEqual({ width: 116, height: 87 });
    expect(seenPlans[0]?.frames.map((frame) => frame.timestampSeconds)).toEqual([0, 0.5, 0.75]);
  });

  it("reads keyframe times only when keyframe mode needs them", async () => {
    let reads = 0;
    const onReadKeyframeTimes = () => reads++;

    await generateCollages("video", baseRequest(), fakePorts({ onReadKeyframeTimes }));
    expect(reads).toBe(0);

    await generateCollages(
      "video",
      baseRequest({ keyframeSampling: true }),
      fakePorts({ onReadKeyframeTimes, keyframeTimes: [0, 0.5] }),
    );
    expect(reads).toBe(1);
  });

  it("reads the keyframe times a supplied videoInfo is missing without probing again", async () => {
    let probes = 0;
    let reads = 0;
    const seenPlans: RenderPlan[] = [];

    await generateCollages(
      "video",
      baseRequest({ keyframeSampling: true }),
      fakePorts({
        onProbe: () => probes++,
        onReadKeyframeTimes: () => reads++,
        keyframeTimes: [0, 0.25, 0.75],
        onCapture: (plan) => seenPlans.push(plan),
      }),
      { videoInfo: VIDEO_INFO },
    );

    expect([probes, reads]).toEqual([0, 1]);
    expect(seenPlans[0]?.frames.map((frame) => frame.timestampSeconds)).toEqual([0, 0.25, 0.75]);
  });

  it("skips reading keyframe times the supplied videoInfo already carries", async () => {
    let reads = 0;
    await generateCollages(
      "video",
      baseRequest({ keyframeSampling: true }),
      fakePorts({ onReadKeyframeTimes: () => reads++ }),
      { videoInfo: { ...VIDEO_INFO, keyframeTimestampsSeconds: [0, 0.5] } },
    );

    expect(reads).toBe(0);
  });

  it("samples by target FPS with a warning when no keyframe timestamps can be read", async () => {
    const warnings: Vid2GridWarning[] = [];
    const seenPlans: RenderPlan[] = [];

    await generateCollages(
      "video",
      baseRequest({ keyframeSampling: true, targetFps: 2 }),
      fakePorts({ onCapture: (plan) => seenPlans.push(plan) }),
      { videoInfo: VIDEO_INFO, onWarning: (warning) => warnings.push(warning) },
    );

    expect(warnings).toEqual([
      {
        code: "keyframes_unavailable",
        message: "Keyframes unavailable; sampled by target FPS instead",
      },
    ]);
    expect(seenPlans[0]?.frames.map((frame) => frame.timestampSeconds)).toEqual([0, 0.5]);
  });

  it("carries the reason keyframe times could not be read in the warning", async () => {
    const warnings: Vid2GridWarning[] = [];
    const seenPlans: RenderPlan[] = [];

    const { sheets } = await generateCollages(
      "video",
      baseRequest({ keyframeSampling: true, targetFps: 2 }),
      fakePorts({
        keyframeReadError: new Error("moov box truncated"),
        onCapture: (plan) => seenPlans.push(plan),
      }),
      { videoInfo: VIDEO_INFO, onWarning: (warning) => warnings.push(warning) },
    );

    expect(warnings).toEqual([
      {
        code: "keyframes_unavailable",
        message: "Keyframes unavailable (moov box truncated); sampled by target FPS instead",
      },
    ]);
    expect(seenPlans[0]?.frames.map((frame) => frame.timestampSeconds)).toEqual([0, 0.5]);
    expect(sheets).toHaveLength(1);
  });

  it("samples by target FPS with a warning when no keyframe falls in the range", async () => {
    const warnings: Vid2GridWarning[] = [];
    const seenPlans: RenderPlan[] = [];
    let touchedProbe = false;

    await generateCollages(
      "video",
      baseRequest({ startSeconds: 2, endSeconds: 3, keyframeSampling: true, targetFps: 2 }),
      fakePorts({
        onProbe: () => (touchedProbe = true),
        onReadKeyframeTimes: () => (touchedProbe = true),
        onCapture: (plan) => seenPlans.push(plan),
      }),
      {
        videoInfo: { ...VIDEO_INFO, keyframeTimestampsSeconds: [0, 5] },
        onWarning: (warning) => warnings.push(warning),
      },
    );

    expect(touchedProbe).toBe(false);
    expect(warnings.map((warning) => warning.code)).toEqual(["keyframes_unavailable"]);
    expect(seenPlans[0]?.frames.map((frame) => frame.timestampSeconds)).toEqual([2, 2.5]);
  });

  it("reports each port's counts tagged with the phase, in order", async () => {
    const progress: Progress[] = [];

    await generateCollages(
      "video",
      baseRequest(),
      fakePorts({ captureProgress: { done: 10, total: 10 } }),
      { videoInfo: VIDEO_INFO, onProgress: (update) => progress.push(update) },
    );

    expect(progress).toEqual([
      { phase: "extracting", done: 10, total: 10 },
      { phase: "rendering", done: 3, total: 3 },
    ]);
  });

  it("passes the transcription stage through with its done/total counts", async () => {
    const progress: Progress[] = [];

    await generateCollages(
      "video",
      baseRequest({ transcript: { scope: "combined" } }),
      fakePorts({
        transcribe: (_source, _start, _end, onProgress) => {
          onProgress?.({ done: 40, total: 200, stage: "model" });
          return Promise.resolve([]);
        },
      }),
      { videoInfo: VIDEO_INFO, onProgress: (update) => progress.push(update) },
    );

    expect(progress.filter((update) => update.phase === "transcribing")).toEqual([
      { phase: "transcribing", done: 40, total: 200, stage: "model" },
    ]);
  });

  it("skips transcription entirely when the request asks for none", async () => {
    let called = false;
    const { transcriptFiles } = await generateCollages(
      "video",
      baseRequest(),
      fakePorts({
        transcribe: () => {
          called = true;
          return Promise.resolve([]);
        },
      }),
      { videoInfo: VIDEO_INFO },
    );

    expect(called).toBe(false);
    expect(transcriptFiles).toEqual([]);
  });

  it("produces a single combined transcript.vtt for scope 'combined'", async () => {
    const cues: TranscriptCue[] = [
      { start: 0, end: 1, text: "hello" },
      { start: 5, end: 6, text: "world" },
    ];
    const { transcriptFiles } = await generateCollages(
      "video",
      baseRequest({ endSeconds: 8, targetFps: 1, transcript: { scope: "combined" } }),
      fakePorts({ transcribe: () => Promise.resolve(cues) }),
      { videoInfo: VIDEO_INFO },
    );

    expect(transcriptFiles.map((file) => file.name)).toEqual(["transcript.vtt"]);
    expect(transcriptFiles[0]?.data).toContain("text/vtt");
    expect(transcriptFiles[0]?.data).toContain("hello");
    expect(transcriptFiles[0]?.data).toContain("world");
  });

  it("splits cues into per-sheet transcripts by the plan's windows", async () => {
    // 8 frames at 0..7s, 4 per sheet: the midpoint between sheets sits at 3.5.
    const cues: TranscriptCue[] = [
      { start: 0, end: 1, text: "early" },
      { start: 5, end: 6, text: "late" },
    ];
    const { transcriptFiles } = await generateCollages(
      "video",
      baseRequest({ endSeconds: 8, targetFps: 1, transcript: { scope: "per-sheet" } }),
      fakePorts({ transcribe: () => Promise.resolve(cues) }),
      { videoInfo: VIDEO_INFO },
    );

    expect(transcriptFiles.map((file) => file.name)).toEqual(["grid_0001.vtt", "grid_0002.vtt"]);
    const [first, second] = transcriptFiles.map((file) => file.data);
    expect(first).toContain("early");
    expect(first).not.toContain("late");
    expect(second).toContain("late");
    expect(second).not.toContain("early");
  });

  it("runs the last surviving sheet's transcript window out to the request's end", async () => {
    // 10 frames at 0..9s, 4 per sheet: a 6-frame capture drops grid_0003, whose cues
    // the 3.5..7.5 window of grid_0002 would otherwise leave in no file.
    const cues: TranscriptCue[] = [{ start: 8, end: 9, text: "trailing" }];
    const { plan, transcriptFiles } = await generateCollages(
      "video",
      baseRequest({ endSeconds: 10, targetFps: 1, transcript: { scope: "per-sheet" } }),
      fakePorts({ captureCount: 6, transcribe: () => Promise.resolve(cues) }),
      { videoInfo: VIDEO_INFO },
    );

    expect(transcriptFiles.map((file) => file.name)).toEqual(["grid_0001.vtt", "grid_0002.vtt"]);
    expect(transcriptFiles[1]?.data).toContain("trailing");
    expect(plan.sheets[1]?.transcript).toEqual({
      startSeconds: 3.5,
      endSeconds: 7.5,
      fileName: "grid_0002.vtt",
    });
  });

  it("transcribes the request's own time range", async () => {
    const seen: [number, number][] = [];

    await generateCollages(
      "video",
      baseRequest({ startSeconds: 2, endSeconds: 8, transcript: { scope: "combined" } }),
      fakePorts({
        transcribe: (_source, startSeconds, endSeconds) => {
          seen.push([startSeconds, endSeconds]);
          return Promise.resolve([]);
        },
      }),
      { videoInfo: VIDEO_INFO },
    );

    expect(seen).toEqual([[2, 8]]);
  });

  it("reports a failed transcription as a warning and still returns the rendered sheets", async () => {
    const warnings: Vid2GridWarning[] = [];
    const { sheets, transcriptFiles } = await generateCollages(
      "video",
      baseRequest({ transcript: { scope: "combined" } }),
      fakePorts({ transcribe: () => Promise.reject(new Error("decoder crashed")) }),
      { videoInfo: VIDEO_INFO, onWarning: (warning) => warnings.push(warning) },
    );

    expect(sheets).toHaveLength(3);
    expect(transcriptFiles).toEqual([]);
    expect(warnings).toEqual([
      {
        code: "transcription_failed",
        message: "Transcript generation failed: decoder crashed",
      },
    ]);
  });

  it("tags a transcription that found no audio with the no_audio code", async () => {
    const warnings: Vid2GridWarning[] = [];
    await generateCollages(
      "video",
      baseRequest({ transcript: { scope: "combined" } }),
      fakePorts({
        transcribe: () => Promise.reject(new Vid2GridError("no_audio", "no audio track")),
      }),
      { videoInfo: VIDEO_INFO, onWarning: (warning) => warnings.push(warning) },
    );

    expect(warnings).toEqual([
      { code: "no_audio", message: "Transcript generation failed: no audio track" },
    ]);
  });

  it("describes a non-Error rejection in the warning", async () => {
    const warnings: Vid2GridWarning[] = [];
    await generateCollages(
      "video",
      baseRequest({ transcript: { scope: "combined" } }),
      fakePorts({
        transcribe: () => {
          const reason: unknown = "worker gone";
          throw reason;
        },
      }),
      { videoInfo: VIDEO_INFO, onWarning: (warning) => warnings.push(warning) },
    );

    expect(warnings[0]?.message).toBe("Transcript generation failed: worker gone");
  });

  it("warns instead of throwing when the host has no transcript port", async () => {
    const warnings: Vid2GridWarning[] = [];
    const { sheets } = await generateCollages(
      "video",
      baseRequest({ transcript: { scope: "combined" } }),
      fakePorts({ omitTranscriptPort: true }),
      { videoInfo: VIDEO_INFO, onWarning: (warning) => warnings.push(warning) },
    );

    expect(sheets).toHaveLength(3);
    expect(warnings).toEqual([
      {
        code: "no_transcription_port",
        message: "Transcript generation failed: this host has no transcription support",
      },
    ]);
  });

  it("reports per-phase durations and counts through onTiming", async () => {
    let now = 0;
    const ports = fakePorts({
      captureCount: 6,
      onCapture: () => (now += 100),
      onJobs: () => (now += 20),
      transcribe: () => {
        now += 7;
        return Promise.resolve([]);
      },
    });
    ports.clock = { now: () => now };
    const timings: GenerationTimings[] = [];

    await generateCollages("video", baseRequest({ transcript: { scope: "combined" } }), ports, {
      videoInfo: VIDEO_INFO,
      onTiming: (reported) => timings.push(reported),
    });

    expect(timings).toEqual([
      {
        phaseMs: { extracting: 100, rendering: 20, transcribing: 7 },
        frameCount: 6,
        sheetCount: 2,
      },
    ]);
  });

  it("reports timing on the empty-capture path too", async () => {
    let now = 0;
    const ports = fakePorts({ captureCount: 0, onCapture: () => (now += 40) });
    ports.clock = { now: () => now };
    const timings: GenerationTimings[] = [];

    await generateCollages("video", baseRequest(), ports, {
      videoInfo: VIDEO_INFO,
      onTiming: (reported) => timings.push(reported),
    });

    expect(timings).toEqual([{ phaseMs: { extracting: 40 }, frameCount: 0, sheetCount: 0 }]);
  });
});
