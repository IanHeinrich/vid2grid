import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import indexHtml from "../index.html?raw";
import { queryElements, type AppElements } from "../src/dom";
import {
  clampPosition,
  clampWidth,
  frameIndexAt,
  frameStepSeconds,
  initMiniPlayer,
  loopAround,
  loopRestart,
  medianFrameDuration,
  parseLayout,
  presentedFrameDuration,
  resizeFromTopLeft,
  steppedFrameTime,
  steppedTime,
  videoAspect,
  withLoopPoint,
  type MiniPlayer,
  type MiniPlayerDeps,
} from "../src/ui/miniPlayer";

const VIEWPORT = { width: 1000, height: 800 };
const LIMITS = { aspect: 2, chromeHeight: 40, viewport: VIEWPORT };
const RECT = { left: 600, top: 500, width: 320, height: 220 };

describe("clampPosition", () => {
  it("keeps the player inside the viewport with a margin", () => {
    const size = { width: 300, height: 200 };
    expect(clampPosition({ x: -50, y: -10, ...size }, VIEWPORT)).toEqual({ x: 8, y: 8 });
    expect(clampPosition({ x: 900, y: 700, ...size }, VIEWPORT)).toEqual({ x: 692, y: 592 });
    expect(clampPosition({ x: 100, y: 120, ...size }, VIEWPORT)).toEqual({ x: 100, y: 120 });
  });

  it("pins a player larger than the viewport to the top left", () => {
    expect(clampPosition({ x: 50, y: 50, width: 1200, height: 900 }, VIEWPORT)).toEqual({
      x: 8,
      y: 8,
    });
  });
});

describe("clampWidth", () => {
  it("holds the width between the minimum and the largest that fits", () => {
    expect(clampWidth(100, LIMITS)).toBe(240);
    expect(clampWidth(500, LIMITS)).toBe(500);
    expect(clampWidth(5000, LIMITS)).toBe(960);
  });

  it("limits the width so the video's height fits the viewport", () => {
    const short = { ...LIMITS, viewport: { width: 1600, height: 300 } };
    expect(clampWidth(900, short)).toBe((300 - 16 - 40) * 2);
  });
});

describe("resizeFromTopLeft", () => {
  const start = { x: 500, y: 400, width: 300, height: 190 };

  it("grows up and left while the bottom-right corner stays put, keeping the aspect", () => {
    const grown = resizeFromTopLeft(start, { x: -100, y: 0 }, LIMITS);
    expect(grown.width).toBe(400);
    expect(grown.height).toBe(40 + 400 / 2);
    expect(grown.x + grown.width).toBe(800);
    expect(grown.y + grown.height).toBe(590);
  });

  it("follows whichever direction moved further", () => {
    expect(resizeFromTopLeft(start, { x: 10, y: -60 }, LIMITS).width).toBe(420);
    expect(resizeFromTopLeft(start, { x: 50, y: 5 }, LIMITS).width).toBe(250);
  });

  it("stops at the minimum width", () => {
    expect(resizeFromTopLeft(start, { x: 500, y: 0 }, LIMITS).width).toBe(240);
  });
});

describe("frame stepping", () => {
  const variable = [0, 0.1, 0.5, 0.6];

  it("uses the measured frame duration when known and 30 fps otherwise", () => {
    expect(frameStepSeconds(0.04)).toBe(0.04);
    expect(frameStepSeconds(undefined)).toBe(1 / 30);
    expect(frameStepSeconds(0)).toBe(1 / 30);
    expect(frameStepSeconds(Number.NaN)).toBe(1 / 30);
  });

  it("steps to the middle of the next or previous frame, within the video", () => {
    expect(steppedTime(1, 1, 0.04, 10)).toBeCloseTo(1.06);
    expect(steppedTime(1.06, -1, 0.04, 10)).toBeCloseTo(1.02);
    expect(steppedTime(0, -1, 0.04, 10)).toBe(0);
    expect(steppedTime(10, 1, 0.04, 10)).toBe(10);
  });

  it("finds the frame on screen, allowing for frame times rounded up", () => {
    const frames = [0, 0.033333, 0.066667, 0.5];
    expect(frameIndexAt(frames, 0)).toBe(0);
    expect(frameIndexAt(frames, 0.04)).toBe(1);
    expect(frameIndexAt(frames, 2 / 30)).toBe(2);
    expect(frameIndexAt(frames, 10)).toBe(3);
    expect(frameIndexAt([0.1, 0.2], 0)).toBe(0);
  });

  it("steps to the middle of the next or previous real frame, however long", () => {
    expect(steppedFrameTime(variable, 0.05, 1, 1)).toBeCloseTo(0.3);
    expect(steppedFrameTime(variable, 0.3, 1, 1)).toBeCloseTo(0.55);
    expect(steppedFrameTime(variable, 0.55, -1, 1)).toBeCloseTo(0.3);
  });

  it("stays on the first and last frames", () => {
    expect(steppedFrameTime(variable, 0, -1, 1)).toBeCloseTo(0.05);
    expect(steppedFrameTime(variable, 0.6, 1, 1)).toBeCloseTo(0.8);
    expect(steppedFrameTime(variable, 0.6, 1, 0)).toBe(0.6);
    expect(steppedFrameTime([], 0.5, 1, 1)).toBeUndefined();
  });

  it("measures a frame only between consecutive presented frames", () => {
    const at = (mediaTime: number, presentedFrames: number) => ({ mediaTime, presentedFrames });
    expect(presentedFrameDuration(at(1, 10), at(1.04, 11))).toBeCloseTo(0.04);
    expect(presentedFrameDuration(at(1, 10), at(1.08, 12))).toBeUndefined();
    expect(presentedFrameDuration(at(5, 10), at(1, 11))).toBeUndefined();
  });

  it("takes the median of a few measured frames", () => {
    expect(medianFrameDuration([0.04, 0.04])).toBeUndefined();
    expect(medianFrameDuration([0.04, 0.5, 0.04])).toBe(0.04);
    expect(medianFrameDuration([0.03, 0.06, 0.04, 0.05])).toBeCloseTo(0.045);
  });

  it("falls back to 16:9 when the video's size is unknown", () => {
    expect(videoAspect({ width: 640, height: 480 })).toBeCloseTo(4 / 3);
    expect(videoAspect({ width: 0, height: 0 })).toBeCloseTo(16 / 9);
    expect(videoAspect(undefined)).toBeCloseTo(16 / 9);
  });
});

describe("loop maths", () => {
  it("loops two seconds either side of a moment, inside the video", () => {
    expect(loopAround(30, 60)).toEqual({ start: 28, end: 32 });
    expect(loopAround(1, 60)).toEqual({ start: 0, end: 3 });
    expect(loopAround(59, 60)).toEqual({ start: 57, end: 60 });
  });

  it("sets loop in and out, filling the other end from the video's bounds", () => {
    expect(withLoopPoint(null, "in", 10, 60)).toEqual({ start: 10, end: 60 });
    expect(withLoopPoint(null, "out", 10, 60)).toEqual({ start: 0, end: 10 });
    expect(withLoopPoint({ start: 10, end: 20 }, "out", 15, 60)).toEqual({ start: 10, end: 15 });
    expect(withLoopPoint({ start: 10, end: 20 }, "in", 25, 60)).toEqual({ start: 25, end: 60 });
    expect(withLoopPoint({ start: 10, end: 20 }, "out", 5, 60)).toEqual({ start: 0, end: 5 });
  });

  it("refuses a loop too short to play", () => {
    expect(withLoopPoint(null, "in", 60, 60)).toBeNull();
    expect(withLoopPoint(null, "out", 0, 60)).toBeNull();
  });

  it("jumps back to the start once playback reaches the end", () => {
    const loop = { start: 28, end: 32 };
    expect(loopRestart(31.9, loop)).toBeUndefined();
    expect(loopRestart(32, loop)).toBe(28);
    expect(loopRestart(40, null)).toBeUndefined();
  });
});

describe("parseLayout", () => {
  it("reads a saved placement and docked state", () => {
    const raw = JSON.stringify({ docked: true, placement: { x: 10, y: 20, width: 400 } });
    expect(parseLayout(raw)).toEqual({ docked: true, placement: { x: 10, y: 20, width: 400 } });
  });

  it("falls back to floating in the default spot on anything unexpected", () => {
    expect(parseLayout(null)).toEqual({ docked: false });
    expect(parseLayout("not json")).toEqual({ docked: false });
    expect(parseLayout("[1]")).toEqual({ docked: false });
    expect(parseLayout(JSON.stringify({ placement: { x: "1", y: 2, width: 3 } }))).toEqual({
      docked: false,
    });
  });
});

let els: AppElements["video"];
let storage: Storage;
let player: MiniPlayer | undefined;

function start(overrides: Partial<MiniPlayerDeps> = {}): MiniPlayer {
  player = initMiniPlayer(els, {
    durationSeconds: () => 60,
    frameTimes: () => undefined,
    aspect: () => 16 / 9,
    storage,
    ...overrides,
  });
  els.miniPlayer.hidden = false;
  return player;
}

function pointer(target: EventTarget, type: string, clientX: number, clientY: number): void {
  target.dispatchEvent(new MouseEvent(type, { bubbles: true, button: 0, clientX, clientY }));
}

// jsdom has no requestVideoFrameCallback, so playback presents these frames by hand.
function presentFrames(video: HTMLVideoElement, mediaTimes: number[]): void {
  const callbacks: VideoFrameRequestCallback[] = [];
  Object.defineProperty(video, "requestVideoFrameCallback", {
    configurable: true,
    value: (callback: VideoFrameRequestCallback) => callbacks.push(callback),
  });
  Object.defineProperty(video, "paused", { configurable: true, get: () => false });
  video.dispatchEvent(new Event("play"));
  mediaTimes.forEach((mediaTime, index) => {
    const metadata = { mediaTime, presentedFrames: index + 1 } as VideoFrameCallbackMetadata;
    callbacks.shift()?.(0, metadata);
  });
}

function saved(): unknown {
  return JSON.parse(storage.getItem("vid2grid-chat-mini-player") ?? "null");
}

beforeEach(() => {
  document.body.innerHTML = indexHtml;
  els = queryElements().video;
  storage = window.localStorage;
  storage.clear();
  vi.spyOn(els.miniPlayer, "getBoundingClientRect").mockImplementation(() =>
    DOMRect.fromRect({ x: RECT.left, y: RECT.top, width: RECT.width, height: RECT.height }),
  );
  vi.spyOn(els.miniPlayerVideo, "getBoundingClientRect").mockImplementation(() =>
    DOMRect.fromRect({ width: RECT.width, height: RECT.width / (16 / 9) }),
  );
  vi.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(() => undefined);
});

afterEach(() => {
  player?.dispose();
  player = undefined;
  vi.restoreAllMocks();
});

describe("moving", () => {
  it("drags by the header, stays inside the viewport and remembers where it went", () => {
    start();
    pointer(els.miniPlayerBar, "pointerdown", 700, 510);
    pointer(window, "pointermove", 500, 310);
    expect(els.miniPlayer.classList.contains("is-placed")).toBe(true);
    expect(els.miniPlayer.style.left).toBe("400px");
    expect(els.miniPlayer.style.top).toBe("300px");
    pointer(window, "pointermove", -500, 310);
    expect(els.miniPlayer.style.left).toBe("8px");
    pointer(window, "pointerup", -500, 310);
    expect(saved()).toEqual({ docked: false, placement: { x: 8, y: 300, width: 320 } });
    pointer(window, "pointermove", 0, 0);
    expect(els.miniPlayer.style.top).toBe("300px");
  });

  it("does not start a drag from the header's buttons", () => {
    start();
    pointer(els.miniPlayerDock, "pointerdown", 700, 510);
    pointer(window, "pointermove", 500, 310);
    expect(els.miniPlayer.classList.contains("is-placed")).toBe(false);
  });

  it("pulls a saved placement back on screen after the window shrinks", () => {
    const placement = { x: 900, y: 600, width: 320 };
    storage.setItem("vid2grid-chat-mini-player", JSON.stringify({ docked: false, placement }));
    start().layout();
    expect(els.miniPlayer.style.left).toBe("696px");
    vi.spyOn(window, "innerWidth", "get").mockReturnValue(700);
    window.dispatchEvent(new Event("resize"));
    expect(els.miniPlayer.style.left).toBe("372px");
    expect(saved()).toEqual({ docked: false, placement });
  });
});

describe("docking", () => {
  it("docks above the conversation and undocks to where it floated", () => {
    storage.setItem(
      "vid2grid-chat-mini-player",
      JSON.stringify({ docked: false, placement: { x: 100, y: 100, width: 320 } }),
    );
    start().layout();
    els.miniPlayerDock.click();
    expect(els.miniPlayer.classList.contains("is-docked")).toBe(true);
    expect(els.miniPlayer.classList.contains("is-placed")).toBe(false);
    expect(els.miniPlayerDock.getAttribute("aria-pressed")).toBe("true");
    expect(els.miniPlayerResize.hidden).toBe(true);
    expect(els.miniPlayer.style.left).toBe("");
    pointer(els.miniPlayerBar, "pointerdown", 10, 10);
    pointer(window, "pointermove", 300, 300);
    expect(els.miniPlayer.style.left).toBe("");
    player?.dispose();
    start();
    expect(els.miniPlayer.classList.contains("is-docked")).toBe(true);
    els.miniPlayerDock.click();
    expect(els.miniPlayer.style.left).toBe("100px");
    expect(els.miniPlayerResize.hidden).toBe(false);
  });
});

describe("resizing", () => {
  it("resizes from the corner handle by pointer, keeping the aspect", () => {
    start();
    pointer(els.miniPlayerResize, "pointerdown", 600, 500);
    pointer(window, "pointermove", 520, 500);
    pointer(window, "pointerup", 520, 500);
    expect(els.miniPlayer.style.width).toBe("400px");
    const chrome = 220 - 320 / (16 / 9);
    const height = chrome + 400 / (16 / 9);
    expect(els.miniPlayer.style.left).toBe("520px");
    expect(els.miniPlayer.style.top).toBe(`${Math.round(720 - height)}px`);
  });

  it("resizes with the arrow keys on the handle", () => {
    start();
    els.miniPlayerResize.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowLeft" }));
    expect(els.miniPlayer.style.width).toBe("344px");
    expect(saved()).toMatchObject({ placement: { width: 344 } });
  });
});

describe("looping around a timestamp", () => {
  it("offers a loop around a clicked timestamp and loops it until turned off", () => {
    start();
    const video = els.miniPlayerVideo;
    expect(els.miniPlayerLoopAround.hidden).toBe(true);
    video.currentTime = 30;
    player?.offerLoopAround(30);
    expect(els.miniPlayerLoopAround.hidden).toBe(false);
    expect(els.miniPlayerLoopAround.title).toBe("Loop 0:28.0 to 0:32.0 until turned off");
    els.miniPlayerLoopAround.click();
    expect(els.miniPlayerLoopAround.getAttribute("aria-pressed")).toBe("true");
    expect(els.miniPlayerLoopRange.textContent).toBe("0:28.0 to 0:32.0");
    expect(els.miniPlayerLoopTrack.hidden).toBe(false);
    expect(els.miniPlayerLoopBand.style.left).toBe(`${(28 / 60) * 100}%`);
    video.currentTime = 32.2;
    video.dispatchEvent(new Event("timeupdate"));
    expect(video.currentTime).toBe(28);
    els.miniPlayerLoopAround.click();
    expect(els.miniPlayerLoopAround.getAttribute("aria-pressed")).toBe("false");
    expect(els.miniPlayerLoopRange.hidden).toBe(true);
    video.currentTime = 40;
    video.dispatchEvent(new Event("timeupdate"));
    expect(video.currentTime).toBe(40);
  });

  it("drops a loop around one moment when another timestamp is clicked", () => {
    start();
    player?.offerLoopAround(30);
    els.miniPlayerLoopAround.click();
    player?.offerLoopAround(31);
    expect(els.miniPlayerLoopRange.hidden).toBe(true);
    expect(els.miniPlayerLoopAround.getAttribute("aria-pressed")).toBe("false");
  });

  it("forgets the loop on reset", () => {
    start();
    player?.offerLoopAround(30);
    els.miniPlayerLoopAround.click();
    player?.reset();
    expect(els.miniPlayerLoopAround.hidden).toBe(true);
    expect(els.miniPlayerLoopRange.hidden).toBe(true);
  });
});

describe("loop in and out", () => {
  it("sets loop in and out at the current time and clears it", () => {
    start();
    const video = els.miniPlayerVideo;
    video.currentTime = 10;
    els.miniPlayerLoopIn.click();
    video.currentTime = 14;
    els.miniPlayerLoopOut.click();
    expect(els.miniPlayerLoopRange.textContent).toBe("0:10.0 to 0:14.0");
    expect(video.currentTime).toBe(10);
    els.miniPlayerLoopClear.click();
    expect(els.miniPlayerLoopRange.hidden).toBe(true);
    expect(els.miniPlayerLoopClear.hidden).toBe(true);
  });

  it("restarts the loop when it runs to the end of the video", () => {
    const play = vi
      .spyOn(HTMLMediaElement.prototype, "play")
      .mockImplementation(() => Promise.resolve());
    start();
    const video = els.miniPlayerVideo;
    video.currentTime = 50;
    els.miniPlayerLoopIn.click();
    video.currentTime = 60;
    video.dispatchEvent(new Event("ended"));
    expect(video.currentTime).toBe(50);
    return vi.waitFor(() => expect(play).toHaveBeenCalled());
  });
});

describe("frame stepping and speed", () => {
  it("steps between the video's own frames with the buttons", () => {
    const pause = vi.spyOn(HTMLMediaElement.prototype, "pause");
    start({ frameTimes: () => [0, 0.1, 0.5, 0.6] });
    els.miniPlayerVideo.currentTime = 0.05;
    els.miniPlayerStepForward.click();
    expect(els.miniPlayerVideo.currentTime).toBeCloseTo(0.3);
    els.miniPlayerStepBack.click();
    expect(els.miniPlayerVideo.currentTime).toBeCloseTo(0.05);
    expect(pause).toHaveBeenCalled();
  });

  it("steps by the frame measured during playback when there are no frame times", () => {
    start();
    const video = els.miniPlayerVideo;
    presentFrames(video, [0, 0.04, 0.08, 0.12]);
    video.currentTime = 1;
    els.miniPlayerStepForward.click();
    expect(video.currentTime).toBeCloseTo(1.06);
    video.dispatchEvent(new Event("loadstart"));
    els.miniPlayerStepBack.click();
    expect(video.currentTime).toBeCloseTo(30.5 / 30);
  });

  it("steps with , and . while hovered or focused, but not while typing elsewhere", () => {
    start();
    const video = els.miniPlayerVideo;
    const press = (target: EventTarget, key: string, init: KeyboardEventInit = {}) =>
      target.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, ...init }));
    video.currentTime = 1;
    press(document.body, ".");
    expect(video.currentTime).toBe(1);
    els.miniPlayer.dispatchEvent(new Event("pointerenter"));
    press(document.body, ".");
    expect(video.currentTime).toBeCloseTo(31.5 / 30);
    const textarea = document.createElement("textarea");
    document.body.append(textarea);
    press(textarea, ",");
    expect(video.currentTime).toBeCloseTo(31.5 / 30);
    press(document.body, ",", { ctrlKey: true });
    expect(video.currentTime).toBeCloseTo(31.5 / 30);
    els.miniPlayer.dispatchEvent(new Event("pointerleave"));
    press(els.miniPlayerStepBack, ",");
    expect(video.currentTime).toBeCloseTo(30.5 / 30);
  });

  it("changes the playback speed, the default rate included", () => {
    start();
    els.miniPlayerSpeed.value = "0.25";
    els.miniPlayerSpeed.dispatchEvent(new Event("change"));
    expect(els.miniPlayerVideo.playbackRate).toBe(0.25);
    expect(els.miniPlayerVideo.defaultPlaybackRate).toBe(0.25);
  });
});
