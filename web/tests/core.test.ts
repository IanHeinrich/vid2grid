import { describe, expect, it } from "vitest";
import { generateCollages } from "../src/core";
import type { ExtractedFrame } from "../src/extraction/extractor";
import type { TranscriptCue } from "../src/transcription/transcription";
import type { CollageRequest } from "../src/types";

/**
 * Outside-in tests for core.generateCollages, mirroring tests/test_core.py's
 * approach: the video/frame-extraction boundary is stubbed (via
 * extractFramesImpl) rather than driving a real <video> element, exactly like
 * the Python suite stubs cv2.VideoCapture. Transcription is stubbed the same
 * way (via transcribeImpl) since real audio decode/Whisper inference aren't
 * available in jsdom.
 */

// jest-canvas-mock's drawImage validates its source is a real canvas-like
// element, so stand in with an actual (mocked) HTMLCanvasElement rather than
// a plain object - jsdom doesn't implement ImageBitmap/createImageBitmap.
function fakeBitmap(width: number, height: number): ImageBitmap {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  return canvas as unknown as ImageBitmap;
}

// jsdom's Blob doesn't implement `.text()`/`.arrayBuffer()`, so read content
// back out via FileReader (which jsdom does support) instead.
function readBlobText(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(reader.error);
    reader.readAsText(blob);
  });
}

function stubExtractedFrames(count: number, width = 640, height = 480): ExtractedFrame[] {
  return Array.from({ length: count }, (_, i) => ({
    timestamp: i,
    frameIndex: i,
    bitmap: fakeBitmap(width, height),
  }));
}

function baseConfig(overrides: Partial<CollageRequest> = {}): CollageRequest {
  return {
    videoFile: new File([], "dummy.mp4"),
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
  it("splits extracted frames into ceil(count / framesPerGrid) JPEG sheets", async () => {
    const frames = stubExtractedFrames(10);
    const { sheets, transcriptFiles } = await generateCollages(baseConfig(), {
      extractFramesImpl: async () => frames,
    });

    expect(sheets).toHaveLength(3); // ceil(10 / 4)
    for (const blob of sheets) {
      expect(blob).toBeInstanceOf(Blob);
      expect(blob.type).toBe("image/jpeg");
      expect(blob.size).toBeGreaterThan(0);
    }
    expect(transcriptFiles).toEqual([]);
  });

  it("returns an empty array when no frames are extracted", async () => {
    const { sheets, transcriptFiles } = await generateCollages(baseConfig(), {
      extractFramesImpl: async () => [],
    });
    expect(sheets).toEqual([]);
    expect(transcriptFiles).toEqual([]);
  });

  it("reports extracting then rendering progress phases in order", async () => {
    const frames = stubExtractedFrames(8);
    const phases: string[] = [];

    await generateCollages(baseConfig(), {
      extractFramesImpl: async (_config, onProgress) => {
        onProgress?.(1, 1);
        return frames;
      },
      onProgress: (phase) => {
        if (phases[phases.length - 1] !== phase) phases.push(phase);
      },
    });

    expect(phases).toEqual(["extracting", "rendering"]);
  });

  it("skips transcription entirely when the transcript option is omitted", async () => {
    const frames = stubExtractedFrames(4);
    let called = false;
    const { transcriptFiles } = await generateCollages(baseConfig(), {
      extractFramesImpl: async () => frames,
      transcribeImpl: async () => {
        called = true;
        return [];
      },
    });
    expect(called).toBe(false);
    expect(transcriptFiles).toEqual([]);
  });

  it("produces a single combined transcript.vtt for scope 'combined'", async () => {
    const frames = stubExtractedFrames(8); // timestamps 0..7, framesPerGrid 4 -> 2 sheets
    const cues: TranscriptCue[] = [
      { start: 0, end: 1, text: "hello" },
      { start: 5, end: 6, text: "world" },
    ];
    const { transcriptFiles } = await generateCollages(baseConfig({ framesPerGrid: 4 }), {
      extractFramesImpl: async () => frames,
      transcript: { scope: "combined" },
      transcribeImpl: async () => cues,
    });

    expect(transcriptFiles).toHaveLength(1);
    expect(transcriptFiles[0].name).toBe("transcript.vtt");
    const text = await readBlobText(transcriptFiles[0].blob);
    expect(text).toContain("hello");
    expect(text).toContain("world");
  });

  it("splits cues into per-sheet transcripts by frame time window for scope 'per-sheet'", async () => {
    // 8 frames at timestamps 0..7, framesPerGrid=4 -> sheet0 covers frames 0-3
    // (timestamps 0..3), sheet1 covers frames 4-7 (timestamps 4..7). The
    // midpoint between sheets sits at (3 + 4) / 2 = 3.5.
    const frames = stubExtractedFrames(8);
    const cues: TranscriptCue[] = [
      { start: 0, end: 1, text: "early" },
      { start: 5, end: 6, text: "late" },
    ];
    const { transcriptFiles } = await generateCollages(baseConfig({ framesPerGrid: 4, endTime: 8 }), {
      extractFramesImpl: async () => frames,
      transcript: { scope: "per-sheet" },
      transcribeImpl: async () => cues,
    });

    expect(transcriptFiles.map((f) => f.name)).toEqual(["grid_0001.vtt", "grid_0002.vtt"]);
    const [first, second] = await Promise.all(transcriptFiles.map((f) => readBlobText(f.blob)));
    expect(first).toContain("early");
    expect(first).not.toContain("late");
    expect(second).toContain("late");
    expect(second).not.toContain("early");
  });

  it("produces only the combined transcript for scope 'combined', not per-sheet files too", async () => {
    const frames = stubExtractedFrames(8);
    const { transcriptFiles } = await generateCollages(baseConfig({ framesPerGrid: 4, endTime: 8 }), {
      extractFramesImpl: async () => frames,
      transcript: { scope: "combined" },
      transcribeImpl: async () => [{ start: 0, end: 1, text: "hi" }],
    });

    expect(transcriptFiles.map((f) => f.name)).toEqual(["transcript.vtt"]);
  });

  it("reports transcription as a non-fatal warning and still returns the rendered sheets", async () => {
    const frames = stubExtractedFrames(4);
    const warnings: string[] = [];
    const { sheets, transcriptFiles } = await generateCollages(baseConfig(), {
      extractFramesImpl: async () => frames,
      transcript: { scope: "combined" },
      transcribeImpl: async () => {
        throw new Error("no audio track");
      },
      onWarning: (message) => warnings.push(message),
    });

    expect(sheets).toHaveLength(1);
    expect(transcriptFiles).toEqual([]);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain("no audio track");
  });
});
