import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { initConversation } from "../src/ui/conversation/conversation";
import {
  beach,
  buttonsLabelled,
  deps,
  els,
  list,
  resetConversation,
  setView,
  spies,
  userWithVideo,
} from "./support/conversation";

beforeEach(resetConversation);

afterEach(() => {
  vi.restoreAllMocks();
});

describe("inline video", () => {
  it("plays the attached video in the message and pops it out at the current time", () => {
    const conversation = initConversation(els, deps());
    conversation.show(userWithVideo(beach));
    const player = list().querySelector<HTMLVideoElement>(".inline-video video");
    expect(player?.getAttribute("src")).toBe("blob:beach");
    expect(list().querySelector(".inline-video-caption")?.textContent).toBe("beach.mp4 · 1:30");
    buttonsLabelled("Pop out")[0]?.click();
    expect(spies.onPopOut).toHaveBeenCalledWith(0);
    expect(buttonsLabelled("Study video")).toHaveLength(0);
  });

  it("offers Reattach when the file is not loaded, and the player once it is", () => {
    setView({ video: beach, url: null });
    const conversation = initConversation(els, deps());
    conversation.show(userWithVideo(beach));
    expect(list().querySelector(".inline-video video")).toBeNull();
    buttonsLabelled("Reattach video")[0]?.click();
    expect(spies.onReattach).toHaveBeenCalled();
    setView({ video: beach, url: "blob:beach" });
    conversation.refreshVideos();
    expect(list().querySelector(".inline-video video")).not.toBeNull();
  });

  it("shows a replaced video by name only", () => {
    setView({ video: { ...beach, name: "park.mp4", fileKey: "park-key" }, url: "blob:park" });
    const conversation = initConversation(els, deps());
    conversation.show(userWithVideo(beach));
    expect(list().querySelector(".inline-video video")).toBeNull();
    expect(list().querySelector(".inline-video")?.textContent).toBe("beach.mp4 · 1:30 (replaced)");
  });
});
