import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { probeVideo, readKeyframeTimes } from "../src/probe/probe";

// The demuxing half of the probe is the extractor's; what matters here is whether
// probeVideo reaches for it at all.
const { readKeyframeTimestamps } = vi.hoisted(() => ({
  readKeyframeTimestamps: vi.fn<(file: File) => Promise<number[] | null>>(),
}));
vi.mock("../src/capture/webcodecsExtractor", () => ({ readKeyframeTimestamps }));

// jsdom's <video> never loads media, so the element is stubbed: what is under
// test is which values probeVideo reads and when it skips the demuxer.
interface FakeMetadata {
  duration: number;
  videoWidth: number;
  videoHeight: number;
}

function stubVideo(metadata: FakeMetadata | "error"): void {
  const element = {
    preload: "",
    src: "",
    ...(metadata === "error" ? {} : metadata),
    addEventListener(event: string, handler: () => void) {
      const wanted = metadata === "error" ? "error" : "loadedmetadata";
      if (event === wanted) setTimeout(handler, 0);
    },
    removeEventListener() {},
  };
  vi.spyOn(document, "createElement").mockReturnValue(element as unknown as HTMLElement);
}

// jsdom implements neither object-URL function.
const objectUrls = {
  createObjectURL: () => "blob:stub",
  revokeObjectURL: () => {},
};

beforeEach(() => {
  Object.assign(URL, objectUrls);
  readKeyframeTimestamps.mockReset();
  readKeyframeTimestamps.mockResolvedValue([0, 1, 2]);
  // jsdom has no VideoDecoder, and without one the probe skips the demuxer whatever the flag says.
  vi.stubGlobal("VideoDecoder", class {});
});

const videoFile = (name: string, type: string) => new File([new Uint8Array([0])], name, { type });

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  delete (URL as unknown as Record<string, unknown>).createObjectURL;
  delete (URL as unknown as Record<string, unknown>).revokeObjectURL;
});

describe("probeVideo", () => {
  it("reports the element's duration and display dimensions", async () => {
    // videoWidth/videoHeight are already display-oriented: the browser has
    // applied any container rotation, so a 90/270 clip arrives swapped.
    stubVideo({ duration: 12.5, videoWidth: 352, videoHeight: 640 });

    expect(await probeVideo(videoFile("portrait.webm", "video/webm"))).toEqual({
      durationSeconds: 12.5,
      width: 352,
      height: 640,
    });
  });

  it("reports a duration of 0 when the container has none", async () => {
    stubVideo({ duration: NaN, videoWidth: 640, videoHeight: 480 });

    expect(await probeVideo(videoFile("stream.webm", "video/webm"))).toMatchObject({
      durationSeconds: 0,
    });
  });

  it("leaves the demuxer alone", async () => {
    stubVideo({ duration: 3, videoWidth: 640, videoHeight: 480 });

    const info = await probeVideo(videoFile("clip.mp4", "video/mp4"));

    expect(readKeyframeTimestamps).not.toHaveBeenCalled();
    expect("keyframeTimestampsSeconds" in info).toBe(false);
  });

  it("rejects when the element fails to load", async () => {
    stubVideo("error");

    await expect(probeVideo(videoFile("broken.mp4", "video/mp4"))).rejects.toThrowError(
      /loadedmetadata/,
    );
  });
});

describe("readKeyframeTimes", () => {
  it("reports the demuxed keyframe timestamps", async () => {
    expect(await readKeyframeTimes(videoFile("clip.mp4", "video/mp4"))).toEqual([0, 1, 2]);
  });

  it("is undefined when the file isn't demuxable here", async () => {
    expect(await readKeyframeTimes(videoFile("clip.webm", "video/webm"))).toBeUndefined();
    expect(readKeyframeTimestamps).not.toHaveBeenCalled();
  });

  it("is undefined when the demuxer declines the file", async () => {
    readKeyframeTimestamps.mockResolvedValue(null);

    expect(await readKeyframeTimes(videoFile("clip.mp4", "video/mp4"))).toBeUndefined();
  });

  it("rejects with the demuxer's own error when it throws", async () => {
    const demuxFailure = new Error("chunk load failed");
    readKeyframeTimestamps.mockRejectedValue(demuxFailure);

    await expect(readKeyframeTimes(videoFile("clip.mp4", "video/mp4"))).rejects.toBe(demuxFailure);
  });
});
