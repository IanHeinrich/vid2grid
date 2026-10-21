import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PlannedSheet, RenderPlan } from "@vid2grid/core";
import type { RenderSheetRequest, RenderSheetResponse } from "../src/render/renderWorker";

const { paintSheetFromPlan } = vi.hoisted(() => ({ paintSheetFromPlan: vi.fn() }));
vi.mock("@vid2grid/core", () => ({ paintSheetFromPlan }));

type Handler = (event: { data: RenderSheetRequest }) => Promise<void>;

const posted: RenderSheetResponse[] = [];
const PLAN = { canvas: { width: 8, height: 8 }, jpegQuality: 50 } as unknown as RenderPlan;
const SHEET = {} as PlannedSheet;

let convertToBlob: ReturnType<typeof vi.fn>;

function request(images: ImageBitmap[]): { data: RenderSheetRequest } {
  return { data: { plan: PLAN, sheet: SHEET, images } };
}

function fakeImages(count: number) {
  const images = Array.from({ length: count }, () => ({ close: vi.fn() }));
  return { images: images as unknown as ImageBitmap[], closes: images.map((i) => i.close) };
}

async function loadHandler(): Promise<Handler> {
  vi.resetModules();
  await import("../src/render/renderWorker");
  return (self as unknown as { onmessage: Handler }).onmessage;
}

beforeEach(() => {
  posted.length = 0;
  paintSheetFromPlan.mockReset();
  convertToBlob = vi.fn(() => Promise.resolve(new Blob(["jpeg"])));
  vi.stubGlobal(
    "OffscreenCanvas",
    class {
      getContext = () => ({});
      convertToBlob = convertToBlob;
    },
  );
  vi.stubGlobal("postMessage", (message: RenderSheetResponse) => posted.push(message));
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("render worker", () => {
  it("encodes the sheet at the plan's quality and closes the frames it was handed", async () => {
    const handler = await loadHandler();
    const { images, closes } = fakeImages(2);

    await handler(request(images));

    expect(convertToBlob).toHaveBeenCalledWith({ type: "image/jpeg", quality: 0.5 });
    expect(posted).toHaveLength(1);
    expect(posted[0]?.blob).toBeInstanceOf(Blob);
    for (const close of closes) expect(close).toHaveBeenCalledTimes(1);
  });

  it("reports the failure and still closes the frames when painting throws", async () => {
    const handler = await loadHandler();
    paintSheetFromPlan.mockImplementation(() => {
      throw new Error("paint failed");
    });
    const { images, closes } = fakeImages(2);

    await handler(request(images));

    expect(posted).toEqual([{ error: "paint failed" }]);
    for (const close of closes) expect(close).toHaveBeenCalledTimes(1);
  });

  it("closes the frames when encoding rejects", async () => {
    const handler = await loadHandler();
    convertToBlob.mockRejectedValue(new Error("encode failed"));
    const { images, closes } = fakeImages(1);

    await handler(request(images));

    expect(posted).toEqual([{ error: "encode failed" }]);
    expect(closes[0]).toHaveBeenCalledTimes(1);
  });
});
