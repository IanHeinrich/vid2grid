import { describe, expect, it, vi } from "vitest";
import { modelDownloadProgress, type ModelLoadCallback } from "../src/shared/modelDownloadProgress";

type ProgressInfo = Parameters<ModelLoadCallback>[0];

describe("modelDownloadProgress", () => {
  it("weights each file by its bytes and counts a finished file as whole", () => {
    const onPercent = vi.fn<(percent: number) => void>();
    const report = modelDownloadProgress(onPercent);

    report({ status: "progress", file: "weights", loaded: 50, total: 900 } as ProgressInfo);
    report({ status: "progress", file: "config", loaded: 50, total: 100 } as ProgressInfo);
    report({ status: "done", file: "config" } as ProgressInfo);

    expect(onPercent.mock.calls.map(([percent]) => percent)).toEqual([(50 / 900) * 100, 10, 15]);
  });

  it("ignores other statuses and counts an unseen finished file as one byte", () => {
    const onPercent = vi.fn<(percent: number) => void>();
    const report = modelDownloadProgress(onPercent);

    report({ status: "initiate", file: "weights" } as ProgressInfo);
    report({ status: "done", file: "tokenizer" } as ProgressInfo);

    expect(onPercent.mock.calls).toEqual([[100]]);
  });

  it("reports nothing loaded while every total is still zero", () => {
    const onPercent = vi.fn<(percent: number) => void>();

    modelDownloadProgress(onPercent)({
      status: "progress",
      file: "weights",
      loaded: 0,
      total: 0,
    } as ProgressInfo);

    expect(onPercent).toHaveBeenCalledWith(0);
  });
});
