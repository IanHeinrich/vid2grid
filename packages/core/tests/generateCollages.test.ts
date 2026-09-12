import { describe, expect, it } from "vitest";
import { generateCollages } from "../src/pipeline/generateCollages";
import type { CapturedFrame, CollagePorts } from "../src/pipeline/ports";
import type { CollageRequest, VideoInfo } from "../src/types";
import type { TranscriptCue } from "../src/transcript/vtt";

// Images and encoded files are plain strings here: real Blob/ImageBitmap behaviour is the
// browser package's to test, so only the pipeline's own decisions are under test.
type FakePorts = CollagePorts<string, string, string>;

const VIDEO_INFO: VideoInfo = { durationSeconds: 10, width: 640, height: 480 };

function capturedFrames(count: number): CapturedFrame<string>[] {
  return Array.from({ length: count }, (_, i) => ({
    timestamp: i,
    frameIndex: i,
    image: `frame-${i}`,
  }));
}

interface FakePortOverrides {
  frames?: CapturedFrame<string>[];
  onCapture?: (cell: { width: number; height: number }, keyframeSampling: boolean) => void;
  captureProgress?: boolean;
  transcribe?: () => Promise<TranscriptCue[]>;
  omitTranscriptPort?: boolean;
}

function fakePorts(overrides: FakePortOverrides = {}): FakePorts {
  const frames = overrides.frames ?? capturedFrames(10);
  const ports: FakePorts = {
    probe: { probe: async () => VIDEO_INFO },
    frames: {
      capture: async (_source, _request, cell, keyframeSampling, onProgress) => {
        overrides.onCapture?.(cell, keyframeSampling);
        if (overrides.captureProgress) onProgress?.(frames.length, frames.length);
        return frames;
      },
    },
    sheets: {
      encodeSheets: async (sheets, jpegQuality, onProgress) => {
        onProgress?.(sheets.length, sheets.length);
        return sheets.map((sheet) => `jpeg:${jpegQuality}:${sheet.images.join(",")}`);
      },
    },
    text: { encodeText: (text, mimeType) => `${mimeType}\n${text}` },
    clock: { now: () => 0 },
  };
  if (!overrides.omitTranscriptPort) {
    ports.transcript = {
      transcribe: overrides.transcribe ?? (async () => []),
    };
  }
  return ports;
}

function baseRequest(overrides: Partial<CollageRequest> = {}): CollageRequest {
  return {
    startTime: 0,
    endTime: 1,
    targetFps: 10,
    framesPerGrid: 4,
    outputResolution: 256,
    jpegQuality: 80,
    ...overrides,
  };
}

describe("generateCollages", () => {
  it("splits captured frames into ceil(count / framesPerGrid) named sheets", async () => {
    const { sheets, transcriptFiles } = await generateCollages(
      "video",
      baseRequest(),
      fakePorts({ frames: capturedFrames(10) }),
      { videoInfo: VIDEO_INFO },
    );

    expect(sheets).toHaveLength(3); // ceil(10 / 4)
    expect(sheets.map((sheet) => sheet.name)).toEqual([
      "grid_0001.jpg",
      "grid_0002.jpg",
      "grid_0003.jpg",
    ]);
    expect(sheets[0].data).toBe("jpeg:80:frame-0,frame-1,frame-2,frame-3");
    expect(sheets[2].data).toBe("jpeg:80:frame-8,frame-9");
    expect(transcriptFiles).toEqual([]);
  });

  it("returns an empty result when no frames are captured", async () => {
    const { sheets, transcriptFiles } = await generateCollages(
      "video",
      baseRequest(),
      fakePorts({ frames: [] }),
      { videoInfo: VIDEO_INFO },
    );
    expect(sheets).toEqual([]);
    expect(transcriptFiles).toEqual([]);
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
      generateCollages("video", baseRequest({ endTime: 0 }), ports),
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

  it("captures at the computed cell size and passes keyframe mode through", async () => {
    let seenCell: { width: number; height: number } | null = null;
    let seenKeyframeSampling: boolean | null = null;
    await generateCollages(
      "video",
      baseRequest(),
      fakePorts({
        onCapture: (cell, keyframeSampling) => {
          seenCell = cell;
          seenKeyframeSampling = keyframeSampling;
        },
      }),
      { videoInfo: VIDEO_INFO, keyframeSampling: true },
    );

    // 4 frames of a 4:3 source into 256px, 8px gutters: a 2x2 grid of 116x87 cells.
    expect(seenCell).toEqual({ width: 116, height: 87 });
    expect(seenKeyframeSampling).toBe(true);
  });

  it("reports extracting then rendering progress phases in order", async () => {
    const phases: string[] = [];

    await generateCollages(
      "video",
      baseRequest(),
      fakePorts({ frames: capturedFrames(8), captureProgress: true }),
      {
        videoInfo: VIDEO_INFO,
        onProgress: (phase) => {
          if (phases[phases.length - 1] !== phase) phases.push(phase);
        },
      },
    );

    expect(phases).toEqual(["extracting", "rendering"]);
  });

  it("skips transcription entirely when the transcript option is omitted", async () => {
    let called = false;
    const { transcriptFiles } = await generateCollages(
      "video",
      baseRequest(),
      fakePorts({
        frames: capturedFrames(4),
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
      baseRequest({ framesPerGrid: 4 }),
      fakePorts({ frames: capturedFrames(8), transcribe: async () => cues }),
      { videoInfo: VIDEO_INFO, transcript: { scope: "combined" } },
    );

    expect(transcriptFiles).toHaveLength(1);
    expect(transcriptFiles[0].name).toBe("transcript.vtt");
    expect(transcriptFiles[0].data).toContain("text/vtt");
    expect(transcriptFiles[0].data).toContain("hello");
    expect(transcriptFiles[0].data).toContain("world");
  });

  it("splits cues into per-sheet transcripts by frame time window for scope 'per-sheet'", async () => {
    // Sheets cover timestamps 0..3 and 4..7, so the window boundary lands at (3 + 4) / 2 = 3.5.
    const cues: TranscriptCue[] = [
      { start: 0, end: 1, text: "early" },
      { start: 5, end: 6, text: "late" },
    ];
    const { transcriptFiles } = await generateCollages(
      "video",
      baseRequest({ framesPerGrid: 4, endTime: 8 }),
      fakePorts({ frames: capturedFrames(8), transcribe: async () => cues }),
      { videoInfo: VIDEO_INFO, transcript: { scope: "per-sheet" } },
    );

    expect(transcriptFiles.map((f) => f.name)).toEqual(["grid_0001.vtt", "grid_0002.vtt"]);
    const [first, second] = transcriptFiles.map((f) => f.data);
    expect(first).toContain("early");
    expect(first).not.toContain("late");
    expect(second).toContain("late");
    expect(second).not.toContain("early");
  });

  it("produces only the combined transcript for scope 'combined', not per-sheet files too", async () => {
    const { transcriptFiles } = await generateCollages(
      "video",
      baseRequest({ framesPerGrid: 4, endTime: 8 }),
      fakePorts({
        frames: capturedFrames(8),
        transcribe: async () => [{ start: 0, end: 1, text: "hi" }],
      }),
      { videoInfo: VIDEO_INFO, transcript: { scope: "combined" } },
    );

    expect(transcriptFiles.map((f) => f.name)).toEqual(["transcript.vtt"]);
  });

  it("transcribes the request's own time range", async () => {
    const seen: [number, number][] = [];
    const ports = fakePorts({ frames: capturedFrames(8) });
    ports.transcript = {
      transcribe: async (_source, startSeconds, endSeconds) => {
        seen.push([startSeconds, endSeconds]);
        return [];
      },
    };
    await generateCollages("video", baseRequest({ startTime: 2, endTime: 8 }), ports, {
      videoInfo: VIDEO_INFO,
      transcript: { scope: "combined" },
    });

    expect(seen).toEqual([[2, 8]]);
  });

  it("reports transcription as a non-fatal warning and still returns the rendered sheets", async () => {
    const warnings: string[] = [];
    const { sheets, transcriptFiles } = await generateCollages(
      "video",
      baseRequest(),
      fakePorts({
        frames: capturedFrames(4),
        transcribe: async () => {
          throw new Error("no audio track");
        },
      }),
      {
        videoInfo: VIDEO_INFO,
        transcript: { scope: "combined" },
        onWarning: (message) => warnings.push(message),
      },
    );

    expect(sheets).toHaveLength(1);
    expect(transcriptFiles).toEqual([]);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain("no audio track");
  });

  it("warns instead of throwing when the host has no transcript port", async () => {
    const warnings: string[] = [];
    const { sheets } = await generateCollages(
      "video",
      baseRequest(),
      fakePorts({ frames: capturedFrames(4), omitTranscriptPort: true }),
      {
        videoInfo: VIDEO_INFO,
        transcript: { scope: "combined" },
        onWarning: (message) => warnings.push(message),
      },
    );

    expect(sheets).toHaveLength(1);
    expect(warnings[0]).toContain("no transcription support");
  });

  it("reports frame and sheet counts through onTiming", async () => {
    let frameCount = 0;
    let sheetCount = 0;
    await generateCollages("video", baseRequest(), fakePorts({ frames: capturedFrames(10) }), {
      videoInfo: VIDEO_INFO,
      onTiming: (timings) => {
        frameCount = timings.frameCount;
        sheetCount = timings.sheetCount;
      },
    });

    expect(frameCount).toBe(10);
    expect(sheetCount).toBe(3);
  });
});
