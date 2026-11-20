import { describe, expect, it } from "vitest";
import { audioWindows } from "../src/audio/windows";

describe("audioWindows", () => {
  it("lays two-second windows every second and cuts the last one at the end", () => {
    const windows = audioWindows(42, 4);

    expect(windows).toHaveLength(10);
    expect(windows[0]).toEqual({ startIndex: 0, endIndex: 8, startSeconds: 0, endSeconds: 2 });
    expect(windows[9]).toEqual({ startIndex: 36, endIndex: 42, startSeconds: 9, endSeconds: 10.5 });
  });

  it("ends exactly on the last sample when the audio fits the hops", () => {
    const windows = audioWindows(40, 4);

    expect(windows).toHaveLength(9);
    expect(windows.at(-1)?.endSeconds).toBe(10);
  });

  it("gives audio shorter than one window a single window", () => {
    expect(audioWindows(3, 4)).toEqual([
      { startIndex: 0, endIndex: 3, startSeconds: 0, endSeconds: 0.75 },
    ]);
  });

  it("gives no windows to empty audio", () => {
    expect(audioWindows(0, 16000)).toEqual([]);
  });

  it("takes its own window and hop lengths", () => {
    expect(audioWindows(10, 1, 4, 3).map((window) => window.startSeconds)).toEqual([0, 3, 6]);
  });
});
