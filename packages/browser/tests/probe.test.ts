import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { probeVideo } from "../src/probe";

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
});

const videoFile = (name: string, type: string) => new File([new Uint8Array([0])], name, { type });

afterEach(() => {
  vi.restoreAllMocks();
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

  it("omits keyframe timestamps when the file isn't demuxable here", async () => {
    stubVideo({ duration: 3, videoWidth: 640, videoHeight: 480 });

    const info = await probeVideo(videoFile("clip.webm", "video/webm"));
    expect("keyframeTimestampsSeconds" in info).toBe(false);
  });

  it("rejects when the element fails to load", async () => {
    stubVideo("error");

    await expect(probeVideo(videoFile("broken.mp4", "video/mp4"))).rejects.toThrowError(
      /loadedmetadata/,
    );
  });
});
