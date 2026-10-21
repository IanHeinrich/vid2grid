import { describe, expect, it } from "vitest";
import { Vid2GridError } from "../src/errors";
import {
  generateCollages,
  streamCollages,
  type GeneratedFile,
  type GenerationTimings,
  type Vid2GridWarning,
} from "../src/pipeline/generateCollages";
import type {
  CollagePorts,
  Progress,
  SheetEncoderPort,
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
  onCapture?: (plan: RenderPlan, info: VideoInfo) => void;
  // Runs inside every pull, the one that finds the end included; throw to fail the capture.
  onPull?: (pullIndex: number) => void;
  onYield?: (image: string) => void;
  onRelease?: (image: string) => void;
  onReturn?: () => void;
  onEncode?: (job: SheetRenderJob<string>) => void;
  encode?: SheetEncoderPort<string, string>["encode"];
  concurrency?: number;
  transcribe?: TranscriptPort<string>["transcribe"];
  omitTranscriptPort?: boolean;
  probeInfo?: VideoInfo;
  keyframeTimes?: number[];
  keyframeReadError?: Error;
  onProbe?: () => void;
  onReadKeyframeTimes?: () => void;
}

function fakeFrames(
  plan: RenderPlan,
  overrides: FakePortOverrides,
): AsyncIterator<string> & AsyncIterable<string> {
  const frames = plan.frames.slice(0, overrides.captureCount ?? plan.frames.length);
  let pulls = 0;
  const iterator: AsyncIterator<string> & AsyncIterable<string> = {
    [Symbol.asyncIterator]: () => iterator,
    next: () => {
      try {
        overrides.onPull?.(pulls);
      } catch (err) {
        return Promise.reject(err instanceof Error ? err : new Error(String(err)));
      }
      const frame = frames[pulls++];
      if (!frame) return Promise.resolve({ done: true, value: undefined });
      const image = `frame-${frame.frameIndex}`;
      overrides.onYield?.(image);
      return Promise.resolve({ done: false, value: image });
    },
    return: () => {
      overrides.onReturn?.();
      return Promise.resolve({ done: true, value: undefined });
    },
  };
  return iterator;
}

function fakeSheets(overrides: FakePortOverrides): FakePorts["sheets"] {
  const sheets: FakePorts["sheets"] = {
    encode:
      overrides.encode ??
      ((plan, job) => {
        overrides.onEncode?.(job);
        return Promise.resolve(`jpeg:${plan.jpegQuality}:${job.images.join(",")}`);
      }),
  };
  if (overrides.concurrency !== undefined) sheets.concurrency = overrides.concurrency;
  return sheets;
}

function fakePorts(overrides: FakePortOverrides = {}): FakePorts {
  const { onRelease } = overrides;
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
      capture: (_source, plan, info) => {
        overrides.onCapture?.(plan, info);
        return fakeFrames(plan, overrides);
      },
      ...(onRelease ? { release: onRelease } : {}),
    },
    sheets: fakeSheets(overrides),
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
    const seenJobs: SheetRenderJob<string>[] = [];
    const { sheets } = await generateCollages(
      "video",
      baseRequest(),
      fakePorts({ captureCount: 6, onEncode: (job) => seenJobs.push(job) }),
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

  it("hands the capture port the info the plan was built from, keyframes included", async () => {
    const seenInfo: VideoInfo[] = [];
    await generateCollages(
      "video",
      baseRequest({ keyframeSampling: true }),
      fakePorts({ keyframeTimes: [0, 0.5], onCapture: (_plan, info) => seenInfo.push(info) }),
      { videoInfo: VIDEO_INFO },
    );

    expect(seenInfo).toEqual([{ ...VIDEO_INFO, keyframeTimestampsSeconds: [0, 0.5] }]);
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

  it("counts frames pulled and sheets encoded against the plan, interleaving the phases", async () => {
    const progress: Progress[] = [];

    await generateCollages("video", baseRequest(), fakePorts(), {
      videoInfo: VIDEO_INFO,
      onProgress: (update) => progress.push(update),
    });

    const counts = (phase: Progress["phase"]) =>
      progress.filter((update) => update.phase === phase).map(({ done, total }) => [done, total]);
    expect(counts("extracting")).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((n) => [n, 10]));
    expect(counts("rendering")).toEqual([1, 2, 3].map((n) => [n, 3]));
    const firstSheetEncoded = progress.findIndex((update) => update.phase === "rendering");
    const lastFramePulled = progress.findIndex(
      (update) => update.phase === "extracting" && update.done === 10,
    );
    expect(firstSheetEncoded).toBeLessThan(lastFramePulled);
  });

  it.each([
    [5, 2],
    [6, 2],
    [8, 2],
    [10, 3],
  ])(
    "ends both phases at done === total when capture stops after %i frames",
    async (captureCount, sheetCount) => {
      const progress: Progress[] = [];

      await generateCollages("video", baseRequest(), fakePorts({ captureCount }), {
        videoInfo: VIDEO_INFO,
        onProgress: (update) => progress.push(update),
      });

      const last = (phase: Progress["phase"]) =>
        progress.filter((update) => update.phase === phase).at(-1);
      expect(last("extracting")).toEqual({
        phase: "extracting",
        done: captureCount,
        total: captureCount,
      });
      expect(last("rendering")).toEqual({
        phase: "rendering",
        done: sheetCount,
        total: sheetCount,
      });
    },
  );

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
    // Each frame costs 10 and each sheet's paint 20: 6 frames make sheet 1 and half of sheet 2.
    let now = 0;
    const ports = fakePorts({
      captureCount: 6,
      onYield: () => (now += 10),
      encode: (_plan, job) => {
        now += 20;
        return Promise.resolve(job.sheet.fileName);
      },
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
        phaseMs: { extracting: 60, rendering: 40, transcribing: 7 },
        frameCount: 6,
        sheetCount: 2,
      },
    ]);
  });

  it("reports timing on the empty-capture path too", async () => {
    let now = 0;
    const ports = fakePorts({ captureCount: 0, onPull: () => (now += 40) });
    ports.clock = { now: () => now };
    const timings: GenerationTimings[] = [];

    await generateCollages("video", baseRequest(), ports, {
      videoInfo: VIDEO_INFO,
      onTiming: (reported) => timings.push(reported),
    });

    expect(timings).toEqual([{ phaseMs: { extracting: 40 }, frameCount: 0, sheetCount: 0 }]);
  });
});

function nextTask(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve));
}

async function tasks(count: number): Promise<void> {
  for (let i = 0; i < count; i++) await nextTask();
}

function definedImages(job: SheetRenderJob<string>): string[] {
  return job.images.filter((image) => image !== undefined);
}

// 200 frames, 50 sheets of 4.
const LONG_VIDEO: VideoInfo = { durationSeconds: 120, width: 640, height: 480 };
const LONG_REQUEST = baseRequest({ endSeconds: 100, targetFps: 2 });

describe("streamCollages", () => {
  it("hands each sheet to onSheet in order and keeps none", async () => {
    const delivered: GeneratedFile<string>[] = [];
    const result = await streamCollages("video", baseRequest(), fakePorts(), {
      videoInfo: VIDEO_INFO,
      onSheet: (sheet) => {
        delivered.push(sheet);
      },
    });

    expect(delivered.map((sheet) => sheet.name)).toEqual([
      "grid_0001.jpg",
      "grid_0002.jpg",
      "grid_0003.jpg",
    ]);
    expect(delivered[0]?.data).toBe("jpeg:80:frame-0,frame-1,frame-2,frame-3");
    expect(Object.keys(result).sort()).toEqual(["plan", "sheetCount", "transcriptFiles"]);
    expect(result.sheetCount).toBe(3);
  });
});

describe("streamCollages memory and concurrency", () => {
  it.each([1, 2, 3])(
    "holds at most (concurrency + 1) sheets of frames over a long plan (concurrency %i)",
    async (concurrency) => {
      let live = 0;
      let peak = 0;
      const ports = fakePorts({
        concurrency,
        onYield: () => (peak = Math.max(peak, ++live)),
        encode: async (_plan, job) => {
          await nextTask();
          live -= definedImages(job).length;
          return job.sheet.fileName;
        },
      });

      const { sheetCount } = await streamCollages("video", LONG_REQUEST, ports, {
        videoInfo: LONG_VIDEO,
        onSheet: () => undefined,
      });

      expect(sheetCount).toBe(50);
      expect(live).toBe(0);
      expect(peak).toBeLessThanOrEqual((concurrency + 1) * 4);
    },
  );

  it.each([
    [undefined, 1],
    [2, 2],
    [3, 3],
  ])("runs up to the encoder's concurrency at once (%s)", async (concurrency, expected) => {
    let active = 0;
    let mostActive = 0;
    const ports = fakePorts({
      ...(concurrency === undefined ? {} : { concurrency }),
      encode: async (_plan, job) => {
        mostActive = Math.max(mostActive, ++active);
        await nextTask();
        active--;
        return job.sheet.fileName;
      },
    });

    await streamCollages("video", LONG_REQUEST, ports, {
      videoInfo: LONG_VIDEO,
      onSheet: () => undefined,
    });

    expect(mostActive).toBe(expected);
  });
});

describe("streamCollages delivery order", () => {
  it("delivers sheets in order when their encodes finish out of order", async () => {
    const finished: string[] = [];
    const delivered: string[] = [];
    const ports = fakePorts({
      concurrency: 3,
      encode: async (_plan, job) => {
        await tasks(3 - job.sheet.sheetIndex);
        finished.push(job.sheet.fileName);
        return job.sheet.fileName;
      },
    });

    await streamCollages("video", baseRequest(), ports, {
      videoInfo: VIDEO_INFO,
      onSheet: (sheet) => {
        delivered.push(sheet.data);
      },
    });

    expect(finished).toEqual(["grid_0003.jpg", "grid_0002.jpg", "grid_0001.jpg"]);
    expect(delivered).toEqual(["grid_0001.jpg", "grid_0002.jpg", "grid_0003.jpg"]);
  });

  it("encodes the sheet a short capture was part way through, with its missing cells empty", async () => {
    const delivered: string[] = [];
    const { sheetCount } = await streamCollages(
      "video",
      baseRequest(),
      fakePorts({ captureCount: 5 }),
      { videoInfo: VIDEO_INFO, onSheet: (sheet) => void delivered.push(sheet.data) },
    );

    expect(sheetCount).toBe(2);
    expect(delivered[1]).toBe("jpeg:80:frame-4,,,");
  });
});

describe("streamCollages rendering time", () => {
  it("sums each encode's own time, so concurrent encodes count as busy time", async () => {
    // Three encodes each paint for 20 and then settle together: 60 of wall time, 120 busy.
    let now = 0;
    const ports = fakePorts({
      concurrency: 3,
      encode: async (_plan, job) => {
        now += 20;
        await nextTask();
        return job.sheet.fileName;
      },
    });
    ports.clock = { now: () => now };
    const timings: GenerationTimings[] = [];

    await streamCollages("video", baseRequest(), ports, {
      videoInfo: VIDEO_INFO,
      onSheet: () => undefined,
      onTiming: (reported) => timings.push(reported),
    });

    expect(timings[0]?.phaseMs.rendering).toBe(120);
  });

  it("leaves the time spent in onSheet out of rendering", async () => {
    let now = 0;
    const ports = fakePorts({
      encode: (_plan, job) => {
        now += 20;
        return Promise.resolve(job.sheet.fileName);
      },
    });
    ports.clock = { now: () => now };
    const timings: GenerationTimings[] = [];

    await streamCollages("video", baseRequest(), ports, {
      videoInfo: VIDEO_INFO,
      onSheet: async () => {
        await nextTask();
        now += 1000;
      },
      onTiming: (reported) => timings.push(reported),
    });

    expect(timings[0]?.phaseMs.rendering).toBe(60);
  });
});

interface RunLedger {
  pulled: string[];
  handed: string[];
  released: string[];
  returns: number;
  unsettled: number;
}

interface PlannedFailure {
  atPull?: number;
  encodeOf?: string;
  onReturn?: () => void;
}

// Twenty frames, five sheets, two encodes at once, each finishing on a later task.
function trackedPorts(failure: PlannedFailure, error: Error) {
  const ledger: RunLedger = { pulled: [], handed: [], released: [], returns: 0, unsettled: 0 };
  const ports = fakePorts({
    concurrency: 2,
    onPull: (pullIndex) => {
      if (pullIndex === failure.atPull) throw error;
    },
    onYield: (image) => ledger.pulled.push(image),
    onRelease: (image) => ledger.released.push(image),
    onReturn: () => {
      ledger.returns++;
      failure.onReturn?.();
    },
    encode: async (_plan, job) => {
      ledger.handed.push(...definedImages(job));
      ledger.unsettled++;
      await nextTask();
      ledger.unsettled--;
      if (job.sheet.fileName === failure.encodeOf) throw error;
      return job.sheet.fileName;
    },
  });
  return { ports, ledger };
}

async function runToFailure(
  ports: FakePorts,
  ledger: RunLedger,
  onSheet: (sheet: GeneratedFile<string>) => void = () => undefined,
) {
  return streamCollages("video", baseRequest({ endSeconds: 2 }), ports, {
    videoInfo: VIDEO_INFO,
    onSheet,
  }).then(
    () => ({ error: undefined as unknown, unsettledAtFailure: ledger.unsettled }),
    (error: unknown) => ({ error, unsettledAtFailure: ledger.unsettled }),
  );
}

function expectCleanedUp(ledger: RunLedger, unsettledAtFailure: number) {
  expect(ledger.returns).toBe(1);
  expect([...ledger.handed, ...ledger.released].sort()).toEqual([...ledger.pulled].sort());
  expect(unsettledAtFailure).toBe(0);
}

describe("streamCollages when a run fails", () => {
  it("releases the frames a failed capture left unencoded and rethrows its error", async () => {
    const error = new Error("demuxer gave up");
    const { ports, ledger } = trackedPorts({ atPull: 9 }, error);

    const outcome = await runToFailure(ports, ledger);

    expect(outcome.error).toBe(error);
    expect(ledger.released).toEqual(["frame-8"]);
    expectCleanedUp(ledger, outcome.unsettledAtFailure);
  });

  it("stops at a rejected encode and delivers no sheet after it", async () => {
    const error = new Error("encoder crashed");
    const { ports, ledger } = trackedPorts({ encodeOf: "grid_0002.jpg" }, error);
    const delivered: string[] = [];

    const outcome = await runToFailure(ports, ledger, (sheet) => void delivered.push(sheet.name));

    expect(outcome.error).toBe(error);
    expect(delivered).toEqual(["grid_0001.jpg"]);
    expectCleanedUp(ledger, outcome.unsettledAtFailure);
  });

  it("stops when onSheet throws", async () => {
    const error = new Error("disk full");
    const { ports, ledger } = trackedPorts({}, error);

    const outcome = await runToFailure(ports, ledger, () => {
      throw error;
    });

    expect(outcome.error).toBe(error);
    expectCleanedUp(ledger, outcome.unsettledAtFailure);
  });
});

describe("streamCollages closing the capture", () => {
  it("rethrows the first error when closing the capture fails too", async () => {
    const error = new Error("demuxer gave up");
    const { ports, ledger } = trackedPorts(
      {
        atPull: 9,
        onReturn: () => {
          throw new Error("already closed");
        },
      },
      error,
    );

    const outcome = await runToFailure(ports, ledger);

    expect(outcome.error).toBe(error);
    expectCleanedUp(ledger, outcome.unsettledAtFailure);
  });

  it("rejects without releasing when the host has no release", async () => {
    const error = new Error("demuxer gave up");
    const ports = fakePorts({
      onPull: (pullIndex) => {
        if (pullIndex === 2) throw error;
      },
    });

    await expect(
      streamCollages("video", baseRequest(), ports, {
        videoInfo: VIDEO_INFO,
        onSheet: () => undefined,
      }),
    ).rejects.toBe(error);
  });

  it("leaves a clean run's iterator alone and releases nothing", async () => {
    const { ports, ledger } = trackedPorts({}, new Error("unused"));

    const outcome = await runToFailure(ports, ledger);

    expect(outcome.error).toBeUndefined();
    expect(ledger.returns).toBe(0);
    expect(ledger.released).toEqual([]);
    expect(ledger.handed).toEqual(ledger.pulled);
  });
});
