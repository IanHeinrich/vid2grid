import { describe, expect, it } from "vitest";
import { generateCollages } from "../src/pipeline/generateCollages";
import type { CollagePorts, SheetRenderJob } from "../src/pipeline/ports";
import type { RenderPlan } from "../src/plan/renderPlan";
import type { CollagePlanRequest, VideoInfo } from "../src/types";
import type { TranscriptCue } from "../src/transcript/vtt";

// Images and encoded files are plain strings here: real Blob/ImageBitmap behaviour is the
// browser package's to test, so only the pipeline's own decisions are under test.
type FakePorts = CollagePorts<string, string, string>;

const VIDEO_INFO: VideoInfo = { durationSeconds: 10, width: 640, height: 480 };

interface FakePortOverrides {
  captureCount?: number;
  onCapture?: (plan: RenderPlan) => void;
  captureProgress?: boolean;
  onJobs?: (jobs: SheetRenderJob<string>[]) => void;
  transcribe?: () => Promise<TranscriptCue[]>;
  omitTranscriptPort?: boolean;
}

function fakePorts(overrides: FakePortOverrides = {}): FakePorts {
  const ports: FakePorts = {
    probe: { probe: async () => VIDEO_INFO },
    frames: {
      capture: async (_source, plan, onProgress) => {
        overrides.onCapture?.(plan);
        const count = overrides.captureCount ?? plan.frames.length;
        if (overrides.captureProgress) onProgress?.(count, count);
        return plan.frames.slice(0, count).map((frame) => `frame-${frame.frameIndex}`);
      },
    },
    sheets: {
      encodeSheets: async (plan, jobs, onProgress) => {
        overrides.onJobs?.(jobs);
        onProgress?.(jobs.length, jobs.length);
        return jobs.map((job) => `jpeg:${plan.jpegQuality}:${job.images.join(",")}`);
      },
    },
    text: { encodeText: (text, mimeType) => `${mimeType}\n${text}` },
    clock: { now: () => 0 },
  };
  if (!overrides.omitTranscriptPort) {
    ports.transcript = { transcribe: overrides.transcribe ?? (async () => []) };
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
    expect(sheets[0].data).toBe("jpeg:80:frame-0,frame-1,frame-2,frame-3");
    expect(sheets[2].data).toBe("jpeg:80:frame-8,frame-9");
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
    expect(seenJobs[1].images).toEqual(["frame-4", "frame-5", undefined, undefined]);
    expect(sheets.map((sheet) => sheet.name)).toEqual(["grid_0001.jpg", "grid_0002.jpg"]);
  });

  it("rejects an invalid request before touching any port", async () => {
    let probed = false;
    const ports = fakePorts();
    ports.probe = {
      probe: async () => {
        probed = true;
        return VIDEO_INFO;
      },
    };

    await expect(
      generateCollages("video", baseRequest({ endSeconds: 0 }), ports),
    ).rejects.toThrowError(/end_time/);
    expect(probed).toBe(false);
  });

  it("probes the source only when the caller didn't supply videoInfo", async () => {
    let probeCalls = 0;
    const ports = fakePorts();
    ports.probe = {
      probe: async () => {
        probeCalls++;
        return VIDEO_INFO;
      },
    };

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
    expect(seenPlans[0].cell).toEqual({ width: 116, height: 87 });
    expect(seenPlans[0].frames.map((frame) => frame.timestampSeconds)).toEqual([0, 0.5, 0.75]);
  });

  it("reports extracting then rendering progress phases in order", async () => {
    const phases: string[] = [];

    await generateCollages("video", baseRequest(), fakePorts({ captureProgress: true }), {
      videoInfo: VIDEO_INFO,
      onProgress: (phase) => {
        if (phases[phases.length - 1] !== phase) phases.push(phase);
      },
    });

    expect(phases).toEqual(["extracting", "rendering"]);
  });

  it("skips transcription entirely when the request asks for none", async () => {
    let called = false;
    const { transcriptFiles } = await generateCollages(
      "video",
      baseRequest(),
      fakePorts({
        transcribe: async () => {
          called = true;
          return [];
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
      fakePorts({ transcribe: async () => cues }),
      { videoInfo: VIDEO_INFO },
    );

    expect(transcriptFiles.map((file) => file.name)).toEqual(["transcript.vtt"]);
    expect(transcriptFiles[0].data).toContain("text/vtt");
    expect(transcriptFiles[0].data).toContain("hello");
    expect(transcriptFiles[0].data).toContain("world");
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
      fakePorts({ transcribe: async () => cues }),
      { videoInfo: VIDEO_INFO },
    );

    expect(transcriptFiles.map((file) => file.name)).toEqual(["grid_0001.vtt", "grid_0002.vtt"]);
    const [first, second] = transcriptFiles.map((file) => file.data);
    expect(first).toContain("early");
    expect(first).not.toContain("late");
    expect(second).toContain("late");
    expect(second).not.toContain("early");
  });

  it("transcribes the request's own time range", async () => {
    const seen: [number, number][] = [];
    const ports = fakePorts();
    ports.transcript = {
      transcribe: async (_source, startSeconds, endSeconds) => {
        seen.push([startSeconds, endSeconds]);
        return [];
      },
    };

    await generateCollages(
      "video",
      baseRequest({ startSeconds: 2, endSeconds: 8, transcript: { scope: "combined" } }),
      ports,
      { videoInfo: VIDEO_INFO },
    );

    expect(seen).toEqual([[2, 8]]);
  });

  it("reports transcription as a non-fatal warning and still returns the rendered sheets", async () => {
    const warnings: string[] = [];
    const { sheets, transcriptFiles } = await generateCollages(
      "video",
      baseRequest({ transcript: { scope: "combined" } }),
      fakePorts({
        transcribe: async () => {
          throw new Error("no audio track");
        },
      }),
      { videoInfo: VIDEO_INFO, onWarning: (message) => warnings.push(message) },
    );

    expect(sheets).toHaveLength(3);
    expect(transcriptFiles).toEqual([]);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain("no audio track");
  });

  it("warns instead of throwing when the host has no transcript port", async () => {
    const warnings: string[] = [];
    const { sheets } = await generateCollages(
      "video",
      baseRequest({ transcript: { scope: "combined" } }),
      fakePorts({ omitTranscriptPort: true }),
      { videoInfo: VIDEO_INFO, onWarning: (message) => warnings.push(message) },
    );

    expect(sheets).toHaveLength(3);
    expect(warnings[0]).toContain("no transcription support");
  });

  it("reports captured frame and encoded sheet counts through onTiming", async () => {
    let frameCount = 0;
    let sheetCount = 0;
    await generateCollages("video", baseRequest(), fakePorts({ captureCount: 6 }), {
      videoInfo: VIDEO_INFO,
      onTiming: (timings) => {
        frameCount = timings.frameCount;
        sheetCount = timings.sheetCount;
      },
    });

    expect(frameCount).toBe(6);
    expect(sheetCount).toBe(2);
  });
});
