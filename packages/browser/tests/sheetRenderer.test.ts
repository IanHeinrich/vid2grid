import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { buildRenderPlan, type SheetRenderJob } from "@vid2grid/core";
import type { RenderSheetResponse } from "../src/render/renderWorker";
import { renderSheetToBlob } from "../src/render/sheetRenderer";

// jsdom has neither `Worker` nor `OffscreenCanvas`, so the main-thread fallback runs unless
// a test stubs both. Plan-to-job routing is core's to test; this asks whether a JPEG Blob
// comes back and who frees the frames.
const PLAN = buildRenderPlan(
  {
    startSeconds: 0,
    endSeconds: 1,
    targetFps: 8,
    framesPerGrid: 4,
    outputResolution: 256,
    jpegQuality: 80,
  },
  { durationSeconds: 1, width: 640, height: 480 },
);

// jest-canvas-mock's drawImage validates its source is a real canvas-like
// element, and jsdom implements neither ImageBitmap nor createImageBitmap.
let closes: ReturnType<typeof vi.fn>[] = [];

function fakeImage(width: number, height: number): ImageBitmap {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const close = vi.fn();
  closes.push(close);
  return Object.assign(canvas, { close });
}

beforeEach(() => {
  closes = [];
});

afterEach(() => {
  vi.restoreAllMocks();
});

function job(sheetIndex: number, imageCount: number): SheetRenderJob<ImageBitmap> {
  const sheet = PLAN.sheets[sheetIndex];
  if (!sheet) throw new Error(`PLAN has no sheet ${sheetIndex}`);
  return {
    sheet,
    images: sheet.cells.map((_, i) =>
      i < imageCount ? fakeImage(PLAN.cell.width, PLAN.cell.height) : undefined,
    ),
  };
}

describe("renderSheetToBlob on the main thread", () => {
  it("encodes the sheet as a non-empty JPEG blob", async () => {
    const blob = await renderSheetToBlob(PLAN, job(1, 2));

    expect(blob).toBeInstanceOf(Blob);
    expect(blob.type).toBe("image/jpeg");
    expect(blob.size).toBeGreaterThan(0);
  });

  it("closes the sheet's images once it is encoded", async () => {
    await renderSheetToBlob(PLAN, job(0, 4));

    expect(closes).toHaveLength(4);
    for (const close of closes) expect(close).toHaveBeenCalledTimes(1);
  });

  it("closes the sheet's images when encoding fails", async () => {
    vi.spyOn(HTMLCanvasElement.prototype, "toBlob").mockImplementation((callback) =>
      callback(null),
    );

    await expect(renderSheetToBlob(PLAN, job(0, 4))).rejects.toThrowError("Failed to encode JPEG");

    expect(closes).toHaveLength(4);
    for (const close of closes) expect(close).toHaveBeenCalledTimes(1);
  });
});

const jpeg = new Blob(["jpeg"], { type: "image/jpeg" });
let workers: FakeWorker[];
let startableWorkers: number;
let reply: RenderSheetResponse;
let heldReplies: (() => void)[] | null;

class FakeWorker {
  onmessage: ((event: MessageEvent<RenderSheetResponse>) => void) | null = null;
  onerror: ((event: ErrorEvent) => void) | null = null;
  terminate = vi.fn();

  constructor() {
    if (workers.length >= startableWorkers) throw new Error("SecurityError");
    workers.push(this);
  }

  postMessage(): void {
    const data = reply;
    const send = () => this.onmessage?.({ data } as MessageEvent<RenderSheetResponse>);
    if (heldReplies) heldReplies.push(send);
    else void Promise.resolve().then(send);
  }
}

// A fresh module per test, so no pool or idle timer carries over between them.
async function loadRenderer() {
  vi.resetModules();
  return (await import("../src/render/sheetRenderer")).renderSheetToBlob;
}

const terminated = () => workers.filter((worker) => worker.terminate.mock.calls.length > 0);

function stubWorkerPool(): void {
  beforeEach(() => {
    workers = [];
    startableWorkers = Infinity;
    reply = { blob: jpeg };
    heldReplies = null;
    vi.useFakeTimers();
    vi.stubGlobal("Worker", FakeWorker);
    vi.stubGlobal("OffscreenCanvas", class {});
  });

  afterEach(() => {
    vi.runOnlyPendingTimers();
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });
}

describe("renderSheetToBlob on the worker pool", () => {
  stubWorkerPool();

  it("closes the sheet's images once the worker has encoded them", async () => {
    const renderOnPool = await loadRenderer();

    expect(await renderOnPool(PLAN, job(0, 4))).toBe(jpeg);
    expect(closes).toHaveLength(4);
    for (const close of closes) expect(close).toHaveBeenCalledTimes(1);
  });

  it("closes the sheet's images when the worker reports a failure", async () => {
    const renderOnPool = await loadRenderer();
    reply = { error: "paint failed" };

    await expect(renderOnPool(PLAN, job(0, 4))).rejects.toThrowError("paint failed");
    expect(closes).toHaveLength(4);
    for (const close of closes) expect(close).toHaveBeenCalledTimes(1);
  });
});

describe("render pool lifetime", () => {
  stubWorkerPool();

  it("reuses one pool across sheets and ends it 10 s after the last one", async () => {
    const renderOnPool = await loadRenderer();

    await renderOnPool(PLAN, job(0, 4));
    const poolSize = workers.length;
    vi.advanceTimersByTime(5_000);
    await renderOnPool(PLAN, job(1, 4));
    vi.advanceTimersByTime(9_999);

    expect(workers).toHaveLength(poolSize);
    expect(terminated()).toEqual([]);
    vi.advanceTimersByTime(1);
    expect(terminated()).toEqual(workers);
  });

  it("keeps the pool while a sheet is still in flight", async () => {
    const renderOnPool = await loadRenderer();
    heldReplies = [];

    const rendered = renderOnPool(PLAN, job(0, 4));
    vi.advanceTimersByTime(60_000);
    expect(terminated()).toEqual([]);

    for (const send of heldReplies) send();
    expect(await rendered).toBe(jpeg);
    vi.advanceTimersByTime(10_000);
    expect(terminated()).toEqual(workers);
  });

  it("renders on the main thread and frees the started workers when the pool fails", async () => {
    const renderOnPool = await loadRenderer();
    startableWorkers = 1;

    const rendered = renderOnPool(PLAN, job(0, 4));
    await vi.advanceTimersByTimeAsync(0);

    expect((await rendered).type).toBe("image/jpeg");
    expect(closes).toHaveLength(4);
    for (const close of closes) expect(close).toHaveBeenCalledTimes(1);
    expect(workers).toHaveLength(1);
    expect(terminated()).toEqual(workers);
  });

  it("leaves no sheet counted in flight after the pool fails to start", async () => {
    const renderOnPool = await loadRenderer();
    startableWorkers = 0;
    const fallback = renderOnPool(PLAN, job(0, 4));
    await vi.advanceTimersByTimeAsync(0);
    await fallback;

    startableWorkers = Infinity;
    await renderOnPool(PLAN, job(1, 4));
    vi.advanceTimersByTime(10_000);

    expect(workers.length).toBeGreaterThan(0);
    expect(terminated()).toEqual(workers);
  });
});
