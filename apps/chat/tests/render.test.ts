import { beforeEach, describe, expect, it, vi } from "vitest";
import { generateCollages, type RenderPlan } from "@vid2grid/core";
import { fileKey, probeAttachment, renderSheets } from "../src/video/render";

const { probeVideo, readFrameTimes } = vi.hoisted(() => ({
  probeVideo: vi.fn(),
  readFrameTimes: vi.fn(),
}));

vi.mock("@vid2grid/browser", () => ({
  createBrowserPorts: () => ({}),
  probeVideo,
  readFrameTimes,
}));
vi.mock("@vid2grid/core", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  generateCollages: vi.fn(),
}));

const info = { durationSeconds: 60, width: 1920, height: 1080 };
const file = new File(["x"], "clip.mp4", { type: "video/mp4", lastModified: 7 });

function planWithSheets(sheets: Record<string, number[]>): RenderPlan {
  return {
    sheets: Object.entries(sheets).map(([fileName, times], sheetIndex) => ({
      sheetIndex,
      fileName,
      cells: times.map((timestampSeconds, frameIndex) => ({ frameIndex, timestampSeconds })),
    })),
  } as unknown as RenderPlan;
}

beforeEach(() => {
  vi.mocked(generateCollages).mockReset();
  readFrameTimes.mockReset().mockResolvedValue(undefined);
});

describe("fileKey", () => {
  it("joins name, size and last modified", () => {
    expect(fileKey(file)).toBe("clip.mp4|1|7");
  });
});

describe("probeAttachment", () => {
  it("describes the file from the probed info", async () => {
    probeVideo.mockResolvedValue(info);
    const result = await probeAttachment(file);
    expect(result.info).toBe(info);
    expect(result.attachment).toEqual({
      name: "clip.mp4",
      fileKey: "clip.mp4|1|7",
      durationSeconds: 60,
      width: 1920,
      height: 1080,
    });
  });
});

describe("renderSheets", () => {
  it("takes each sheet's start and end from its first and last cell", async () => {
    const first = new Blob(["a"]);
    const second = new Blob(["b"]);
    vi.mocked(generateCollages).mockResolvedValue({
      plan: planWithSheets({ grid_0001: [0, 5, 10], grid_0002: [15, 20] }),
      sheets: [
        { name: "grid_0002", data: second },
        { name: "grid_0001", data: first },
      ],
      transcriptFiles: [],
    });
    const sheets = await renderSheets(file, info, { frameCount: 5, framesPerGrid: 3 });
    expect(sheets).toEqual([
      {
        name: "grid_0001",
        blob: first,
        startSeconds: 0,
        endSeconds: 10,
        frameCount: 3,
        cellTimes: [0, 5, 10],
      },
      {
        name: "grid_0002",
        blob: second,
        startSeconds: 15,
        endSeconds: 20,
        frameCount: 2,
        cellTimes: [15, 20],
      },
    ]);
  });

  it("asks for nothing after the video's last frame", async () => {
    vi.mocked(generateCollages).mockResolvedValue({
      plan: planWithSheets({}),
      sheets: [],
      transcriptFiles: [],
    });
    readFrameTimes.mockResolvedValue([0, 30, 58]);
    await renderSheets(file, info, { timestampsSeconds: [10, 59.9], framesPerGrid: 2 });
    const [, request] = vi.mocked(generateCollages).mock.calls[0] ?? [];
    expect(request).toMatchObject({ timestampsSeconds: [10, 58] });
  });

  it("renders as asked when the frame times cannot be read", async () => {
    vi.mocked(generateCollages).mockResolvedValue({
      plan: planWithSheets({}),
      sheets: [],
      transcriptFiles: [],
    });
    readFrameTimes.mockRejectedValue(new Error("demux failed"));
    await renderSheets(file, info, { frameCount: 2, framesPerGrid: 2 });
    const [, , , options] = vi.mocked(generateCollages).mock.calls[0] ?? [];
    expect(options).toMatchObject({ videoInfo: info });
  });

  it("defaults the JPEG quality to 80 and passes the probed info", async () => {
    vi.mocked(generateCollages).mockResolvedValue({
      plan: planWithSheets({}),
      sheets: [],
      transcriptFiles: [],
    });
    await renderSheets(file, info, { frameCount: 2, framesPerGrid: 2 });
    const [, request, , options] = vi.mocked(generateCollages).mock.calls[0] ?? [];
    expect(request).toMatchObject({ jpegQuality: 80, frameCount: 2, endSeconds: 60 });
    expect(options).toMatchObject({ videoInfo: info });
  });

  it("keeps a quality the caller gives", async () => {
    vi.mocked(generateCollages).mockResolvedValue({
      plan: planWithSheets({}),
      sheets: [],
      transcriptFiles: [],
    });
    await renderSheets(file, info, { jpegQuality: 60 });
    expect(vi.mocked(generateCollages).mock.calls[0]?.[1]).toMatchObject({ jpegQuality: 60 });
  });

  it("reports extraction progress", async () => {
    const onProgress = vi.fn();
    vi.mocked(generateCollages).mockImplementation((_file, _request, _ports, options) => {
      options?.onProgress?.({ phase: "extracting", done: 2, total: 4 });
      options?.onProgress?.({ phase: "rendering", done: 1, total: 1 });
      return Promise.resolve({ plan: planWithSheets({}), sheets: [], transcriptFiles: [] });
    });
    await renderSheets(file, info, {}, onProgress);
    expect(onProgress.mock.calls).toEqual([[2, 4]]);
  });

  it("fails when a sheet is missing from the plan", async () => {
    vi.mocked(generateCollages).mockResolvedValue({
      plan: planWithSheets({}),
      sheets: [{ name: "grid_0001", data: new Blob(["a"]) }],
      transcriptFiles: [],
    });
    await expect(renderSheets(file, info, {})).rejects.toThrow("grid_0001");
  });
});
