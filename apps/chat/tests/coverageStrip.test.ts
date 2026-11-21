import { describe, expect, it, vi } from "vitest";
import type { ChatMessage, ImageRef } from "../src/types";
import {
  clippedSpans,
  createCoverageStrip,
  densityShade,
  densityText,
  seenShare,
} from "../src/ui/video/coverageStrip";

function sheet(id: string, call: string, start: number, end: number, frameCount: number): ImageRef {
  return {
    id,
    pinned: false,
    source: { kind: "sheet", call, name: id, startSeconds: start, endSeconds: end, frameCount },
  };
}

function toolWith(images: ImageRef[]): ChatMessage {
  return { id: "t1", createdAt: 1, role: "tool", toolCallId: "c1", text: "ok", images };
}

describe("coverage strip keyboard", () => {
  it("can be reached and used from the keyboard", () => {
    const onSeek = vi.fn();
    const strip = createCoverageStrip({ onSeek });
    strip.update([toolWith([sheet("s1", "look(10, 30)", 10, 30, 8)])], 100);
    const video = document.createElement("video");
    strip.follow(video);
    Object.defineProperty(video, "currentTime", { value: 5 });
    video.dispatchEvent(new Event("timeupdate"));
    const track = strip.el.querySelector<HTMLElement>(".coverage-track");
    if (!track) throw new Error("No track");
    expect(track.tabIndex).toBe(0);
    expect(track.getAttribute("role")).toBe("slider");
    expect(track.getAttribute("aria-description")).toContain("Enter jumps");
    track.dispatchEvent(new FocusEvent("focus"));
    expect(track.getAttribute("aria-valuetext")).toBe("0:05, not seen yet");
    const right = new KeyboardEvent("keydown", { key: "ArrowRight", cancelable: true });
    track.dispatchEvent(right);
    expect(right.defaultPrevented).toBe(true);
    expect(track.getAttribute("aria-valuenow")).toBe("10");
    expect(track.getAttribute("aria-valuetext")).toBe("0:10, seen");
    track.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter" }));
    expect(onSeek).toHaveBeenCalledWith(10);
    track.dispatchEvent(new KeyboardEvent("keydown", { key: "End" }));
    track.dispatchEvent(new KeyboardEvent("keydown", { key: " " }));
    expect(onSeek).toHaveBeenLastCalledWith(100);
  });
});

describe("density", () => {
  it("shades sparse overviews faintly and close looks solidly", () => {
    expect(densityShade(0.001)).toBeCloseTo(0.3);
    expect(densityShade(0.5)).toBeGreaterThan(densityShade(0.05));
    expect(densityShade(100)).toBe(1);
  });

  it("describes the density in words", () => {
    expect(densityText(2)).toBe("2 frames a second");
    expect(densityText(0.1)).toBe("a frame every 10 s");
  });
});

describe("spans", () => {
  it("clips spans to the video and measures the share seen", () => {
    const spans = [
      { startSeconds: 0, endSeconds: 30, framesPerSecond: 1 },
      { startSeconds: 80, endSeconds: 120, framesPerSecond: 1 },
      { startSeconds: 150, endSeconds: 160, framesPerSecond: 1 },
    ];
    expect(clippedSpans(spans, 100)).toEqual([
      { startSeconds: 0, endSeconds: 30, framesPerSecond: 1 },
      { startSeconds: 80, endSeconds: 100, framesPerSecond: 1 },
    ]);
    expect(seenShare(spans, 100)).toBeCloseTo(0.5);
    expect(seenShare(spans, 0)).toBe(0);
  });
});

describe("createCoverageStrip", () => {
  it("draws a segment per seen span, positioned across the duration", () => {
    const strip = createCoverageStrip({ onSeek: vi.fn() });
    strip.update([toolWith([sheet("s1", "look(10, 30)", 10, 30, 8)])], 100);
    expect(strip.el.hidden).toBe(false);
    const segments = strip.el.querySelectorAll<HTMLElement>(".coverage-segment");
    expect(segments).toHaveLength(1);
    expect(segments[0]?.style.left).toBe("9.5%");
    expect(segments[0]?.style.width).toBe("21%");
    expect(strip.el.querySelector(".coverage-track")?.getAttribute("aria-label")).toBe(
      "The model has seen 21% of the video.",
    );
  });

  it("says when nothing is seen and hides without a duration", () => {
    const strip = createCoverageStrip({ onSeek: vi.fn() });
    strip.update([], 60);
    expect(strip.el.querySelector(".coverage-track")?.getAttribute("aria-label")).toBe(
      "The model has not seen any of the video yet.",
    );
    strip.update([], undefined);
    expect(strip.el.hidden).toBe(true);
  });

  it("seeks to the clicked point of the track", () => {
    const onSeek = vi.fn();
    const strip = createCoverageStrip({ onSeek });
    strip.update([], 200);
    const track = strip.el.querySelector<HTMLElement>(".coverage-track");
    if (!track) throw new Error("No track");
    track.getBoundingClientRect = () => ({ left: 100, width: 400 }) as DOMRect;
    track.dispatchEvent(new MouseEvent("click", { clientX: 200 }));
    expect(onSeek).toHaveBeenCalledWith(50);
  });

  it("moves the playhead with the video", () => {
    const strip = createCoverageStrip({ onSeek: vi.fn() });
    strip.update([], 100);
    const video = document.createElement("video");
    strip.follow(video);
    Object.defineProperty(video, "currentTime", { value: 25 });
    video.dispatchEvent(new Event("timeupdate"));
    const playhead = strip.el.querySelector<HTMLElement>(".coverage-playhead");
    expect(playhead?.hidden).toBe(false);
    expect(playhead?.style.left).toBe("25%");
    expect(playhead?.title).toBe("Playing at 0:25");
  });
});
