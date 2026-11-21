import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  attachAndSend,
  attachmentFor,
  cleanUpVideoPanel,
  els,
  openChatWithVideo,
  panel,
  resetVideoPanel,
  settle,
  spies,
  state,
  video,
} from "./support/videoPanel";

beforeEach(resetVideoPanel);

afterEach(cleanUpVideoPanel);

describe("cueing the mini-player", () => {
  it("cues a moment without playing, for a player behind the lightbox", async () => {
    const play = vi
      .spyOn(HTMLMediaElement.prototype, "play")
      .mockImplementation(() => Promise.resolve());
    const pause = vi.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(() => undefined);
    const videos = panel();
    await videos.attach(video("beach.mp4"));
    play.mockClear();
    videos.cue(42);
    expect(els.miniPlayer.el.hidden).toBe(false);
    expect(els.miniPlayer.video.currentTime).toBe(42);
    await Promise.resolve();
    expect(play).not.toHaveBeenCalled();
    expect(pause).toHaveBeenCalled();
  });
});

describe("mini-player", () => {
  it("opens the mini-player at a timestamp and closes it", async () => {
    const play = vi
      .spyOn(HTMLMediaElement.prototype, "play")
      .mockImplementation(() => Promise.resolve());
    const videos = panel();
    await videos.attach(video("beach.mp4"));
    videos.seek(42);
    expect(els.miniPlayer.el.hidden).toBe(false);
    expect(els.miniPlayer.video.getAttribute("src")).toBe("blob:video");
    expect(els.miniPlayer.title.textContent).toBe("beach.mp4");
    await vi.waitFor(() => expect(play).toHaveBeenCalled());
    els.miniPlayer.close.click();
    expect(els.miniPlayer.el.hidden).toBe(true);
  });

  it("offers a loop around a clicked timestamp but not when the video is popped out", async () => {
    const videos = panel();
    await videos.attach(video("beach.mp4"));
    videos.openPlayer(10);
    expect(els.miniPlayer.loopAround.hidden).toBe(true);
    videos.seek(42);
    expect(els.miniPlayer.loopAround.hidden).toBe(false);
    expect(els.miniPlayer.loopAround.title).toBe("Loop 0:40.0 to 0:44.0 until turned off");
    els.miniPlayer.loopAround.click();
    expect(els.miniPlayer.loopRange.textContent).toBe("0:40.0 to 0:44.0");
    els.miniPlayer.close.click();
    expect(els.miniPlayer.loopAround.hidden).toBe(true);
    expect(els.miniPlayer.loopRange.hidden).toBe(true);
  });

  it("asks to reattach instead of opening a player with no file", async () => {
    await openChatWithVideo(attachmentFor(video("beach.mp4")));
    panel().seek(42);
    expect(els.miniPlayer.el.hidden).toBe(true);
    expect(spies.status.show).toHaveBeenCalledWith("Reattach the video to jump to 0:42.");
  });
});

describe("frame stepping", () => {
  it("steps between the frame times read from the renderer's own file", async () => {
    spies.readFrameTimes.mockResolvedValue([0, 0.5, 0.75, 2]);
    const file = video("beach.mp4");
    const videos = panel();
    await attachAndSend(videos, file);
    await settle();
    expect(spies.readFrameTimes).toHaveBeenCalledTimes(1);
    expect(spies.readFrameTimes.mock.calls[0]?.[0]).toBe(state.video?.file);
    videos.openPlayer(0.6);
    els.miniPlayer.stepForward.click();
    expect(els.miniPlayer.video.currentTime).toBeCloseTo(1.375);
  });

  it("drops the frame times when the video changes", async () => {
    spies.readFrameTimes.mockResolvedValueOnce([0, 0.5, 0.75, 2]);
    const videos = panel();
    await videos.attach(video("one.mp4", 1));
    await videos.attach(video("two.mp4", 2));
    await settle();
    videos.openPlayer(1);
    els.miniPlayer.stepForward.click();
    expect(els.miniPlayer.video.currentTime).toBeCloseTo(31.5 / 30);
  });

  it("falls back to an estimated frame when reading frame times fails", async () => {
    spies.readFrameTimes.mockRejectedValue(new Error("demux failed"));
    const videos = panel();
    await videos.attach(video("beach.mp4"));
    await settle();
    videos.openPlayer(1);
    els.miniPlayer.stepForward.click();
    expect(els.miniPlayer.video.currentTime).toBeCloseTo(31.5 / 30);
    expect(spies.status.show).not.toHaveBeenCalledWith(expect.stringContaining("demux"), "error");
  });
});

describe("timestamps from an earlier video", () => {
  const MISSING =
    "That moment is in one.mp4, which isn't attached now. Attach it again to jump there.";

  it("plays an earlier video loaded this session without changing the chat's video", async () => {
    let next = 0;
    URL.createObjectURL = vi.fn(() => `blob:video-${++next}`);
    const revoke = vi.fn();
    URL.revokeObjectURL = revoke;
    const first = video("one.mp4", 1);
    const videos = panel();
    await attachAndSend(videos, first);
    await attachAndSend(videos, video("two.mp4", 2));
    expect(els.miniPlayer.el.hidden).toBe(true);
    videos.seek(12, attachmentFor(first));
    await vi.waitFor(() => expect(els.miniPlayer.el.hidden).toBe(false));
    expect(els.miniPlayer.title.textContent).toBe("one.mp4");
    expect(els.miniPlayer.video.getAttribute("src")).toBe("blob:video-5");
    expect(els.miniPlayer.video.currentTime).toBe(12);
    expect(state.currentChat?.video?.name).toBe("two.mp4");
    expect(spies.loadCopy).not.toHaveBeenCalled();
    videos.seek(5, state.currentChat?.video);
    expect(els.miniPlayer.title.textContent).toBe("two.mp4");
    expect(els.miniPlayer.video.getAttribute("src")).toBe("blob:video-4");
    expect(revoke).toHaveBeenCalledWith("blob:video-5");
  });

  it("reports the attached video's playback time only while it is the one shown", async () => {
    const first = video("one.mp4", 1);
    const videos = panel();
    await attachAndSend(videos, first);
    await attachAndSend(videos, video("two.mp4", 2));
    videos.openPlayer(9);
    expect(videos.attachedPlaybackTime()).toBe(9);
    videos.seek(12, attachmentFor(first));
    await vi.waitFor(() => expect(els.miniPlayer.title.textContent).toBe("one.mp4"));
    expect(videos.attachedPlaybackTime()).toBeUndefined();
    els.miniPlayer.close.click();
    expect(videos.attachedPlaybackTime()).toBeDefined();
  });

  it("opens an earlier video from its stored copy", async () => {
    const first = video("one.mp4", 1);
    const videos = panel({ loadCopy: () => Promise.resolve(first) });
    await attachAndSend(videos, video("two.mp4", 2));
    videos.seek(7, attachmentFor(first));
    await vi.waitFor(() => expect(els.miniPlayer.title.textContent).toBe("one.mp4"));
    expect(els.miniPlayer.el.hidden).toBe(false);
    expect(state.currentChat?.video?.name).toBe("two.mp4");
  });

  it("says the earlier video needs attaching again when no copy is kept", async () => {
    const videos = panel();
    await videos.attach(video("two.mp4", 2));
    videos.seek(7, attachmentFor(video("one.mp4", 1)));
    await vi.waitFor(() => expect(spies.status.show).toHaveBeenCalledWith(MISSING));
    expect(els.miniPlayer.el.hidden).toBe(true);
  });
});

describe("timestamps from an earlier video that cannot be opened", () => {
  it("reports an earlier video that could not be opened", async () => {
    const first = video("one.mp4", 1);
    const videos = panel({ loadCopy: () => Promise.resolve(first) });
    await attachAndSend(videos, video("two.mp4", 2));
    URL.createObjectURL = vi.fn(() => {
      throw new Error("out of memory");
    });
    videos.seek(7, attachmentFor(first));
    await vi.waitFor(() =>
      expect(spies.status.show).toHaveBeenCalledWith(
        "Could not open one.mp4: out of memory",
        "error",
      ),
    );
  });
});
