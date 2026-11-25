import { describe, expect, it } from "vitest";
import { speechWindows } from "../src/transcribe/speechWindows";

const RATE = 10;
const windowsOf = (seconds: number) =>
  [...speechWindows(seconds * RATE, RATE)].map(({ startIndex, endIndex, strideSeconds }) => [
    startIndex / RATE,
    endIndex / RATE,
    strideSeconds,
  ]);

describe("speechWindows", () => {
  it("hears a short clip in one window with nothing to join", () => {
    expect(windowsOf(12)).toEqual([[0, 12, [12, 0, 0]]]);
    expect(windowsOf(30)).toEqual([[0, 30, [30, 0, 0]]]);
  });

  it("steps 20 seconds, overlapping each neighbour by 10 and keeping the middle", () => {
    expect(windowsOf(65)).toEqual([
      [0, 30, [30, 0, 5]],
      [20, 50, [30, 5, 5]],
      [40, 65, [25, 5, 0]],
    ]);
  });

  it("ends at the window that reaches the end of the audio", () => {
    expect(windowsOf(50)).toHaveLength(2);
    expect(windowsOf(50.1)).toHaveLength(3);
  });

  it("has no window for no audio", () => {
    expect(windowsOf(0)).toEqual([]);
  });
});
