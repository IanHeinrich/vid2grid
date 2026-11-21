import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { addPending, currentPending, pendingFor, setCurrentChat } from "../src/state";
import type { ImageRef } from "../src/types";
import {
  attachmentFor,
  cleanUpVideoPanel,
  els,
  MODEL,
  openOther,
  panel,
  resetVideoPanel,
  state,
  video,
} from "./support/videoPanel";

beforeEach(resetVideoPanel);

afterEach(cleanUpVideoPanel);

describe("a pending video's thumbnail", () => {
  it("never hands out another chat's URL before the panel renders", async () => {
    let next = 0;
    URL.createObjectURL = vi.fn(() => `blob:video-${++next}`);
    const videos = panel();
    await videos.attach(video("one.mp4", 1));
    const first = state.currentChat;
    await openOther(videos, "new", MODEL);
    await videos.attach(video("two.mp4", 2));
    expect(videos.pendingView().url).toBe("blob:video-2");
    setCurrentChat(state, first, []);
    expect(videos.pendingView()).toEqual({ video: attachmentFor(video("one.mp4", 1)), url: null });
    videos.render();
    expect(videos.pendingView().url).toBe("blob:video-3");
  });
});

describe("a new chat", () => {
  it("shows no video, player or pending items from the chat left behind", async () => {
    const videos = panel();
    await videos.attach(video("beach.mp4"));
    const ref: ImageRef = { id: "i", pinned: false, source: { kind: "upload", name: "i" } };
    addPending(state, "chat", { kind: "image", ref });
    videos.openPlayer(1);
    expect(els.miniPlayer.el.hidden).toBe(false);
    await openOther(videos, "new", MODEL);
    expect(els.video.chip.hidden).toBe(true);
    expect(els.miniPlayer.el.hidden).toBe(true);
    expect(currentPending(state)).toEqual([]);
    expect(videos.view()).toEqual({ video: undefined, url: null });
    expect(videos.pendingView()).toEqual({ video: undefined, url: null });
    expect(pendingFor(state, "chat").map((attachment) => attachment.kind)).toEqual([
      "video",
      "image",
    ]);
  });
});
