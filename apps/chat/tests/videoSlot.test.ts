import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { initConversation } from "../src/ui/conversation/conversation";
import { upload, user } from "./support/factories";
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
    expect(list().querySelector(".inline-video-caption")?.textContent).toBe(
      "beach.mp4 · 1:30 (replaced)",
    );
  });
});

describe("removing a video from its inline slot", () => {
  const views: [string, () => void][] = [
    ["playing", () => setView({ video: beach, url: "blob:beach" })],
    ["missing", () => setView({ video: beach, url: null })],
    ["replaced", () => setView({ video: undefined, url: null })],
  ];

  it.each(views)("offers it on a %s video", (_name, show) => {
    show();
    initConversation(els, deps()).show(userWithVideo(beach));
    const [remove] = buttonsLabelled("Remove from chat");
    expect(remove?.title).toContain("beach.mp4");
    remove?.click();
    expect(spies.onRemoveVideo).toHaveBeenCalledWith(beach);
  });

  it("is disabled with the reason while a reply runs, and again usable after", () => {
    const conversation = initConversation(els, deps());
    conversation.show(userWithVideo(beach));
    const player = list().querySelector(".inline-video video");
    spies.removeBlocker.mockReturnValue("Wait for the reply.");
    conversation.setRunning(true);
    const [remove] = buttonsLabelled("Remove from chat");
    expect(remove?.disabled).toBe(true);
    expect(remove?.title).toBe("Wait for the reply.");
    spies.removeBlocker.mockReturnValue(undefined);
    conversation.setRunning(false);
    expect(remove?.disabled).toBe(false);
    expect(list().querySelector(".inline-video video")).toBe(player);
  });

  it("follows a study that starts or ends, on the next refresh", () => {
    const conversation = initConversation(els, deps());
    conversation.show(userWithVideo(beach));
    spies.removeBlocker.mockReturnValue("Wait for the study.");
    conversation.refreshVideos();
    expect(buttonsLabelled("Remove from chat")[0]?.disabled).toBe(true);
  });

  it("leaves a quiet line and the message text, and the slot again once put back", () => {
    const conversation = initConversation(els, deps());
    conversation.show(user("u1", "Look", { removedVideo: beach }));
    expect(list().querySelector(".inline-video")?.textContent).toBe(
      "beach.mp4, removed from this chat",
    );
    expect(list().querySelector(".message-text")?.textContent).toBe("Look");
    expect(buttonsLabelled("Remove from chat")).toHaveLength(0);
    conversation.show(userWithVideo(beach));
    expect(list().querySelector(".inline-video video")).not.toBeNull();
  });

  it("follows a removal and its Undo under an open editor, keeping the rest", () => {
    const conversation = initConversation(els, deps());
    conversation.show(userWithVideo(beach));
    buttonsLabelled("Edit message")[0]?.click();
    const player = list().querySelector(".inline-video video");
    conversation.show(userWithVideo(beach));
    expect(list().querySelector(".inline-video video")).toBe(player);
    conversation.show(user("u1", "Look", { removedVideo: beach }));
    expect(list().querySelector(".inline-video")?.textContent).toContain("removed from this chat");
    expect(list().querySelector(".message-editor")).not.toBeNull();
    conversation.show(userWithVideo(beach));
    expect(list().querySelector(".inline-video video")).not.toBeNull();
    setView({ video: beach, url: null });
    conversation.refreshVideos();
    expect(buttonsLabelled("Reattach video")).toHaveLength(1);
  });

  it.each([
    ["a removal", { video: beach }, { removedVideo: beach }],
    ["its Undo", { removedVideo: beach }, { video: beach }],
  ])("keeps %s when an image is pinned under an open editor", (_what, before, after) => {
    const images = [upload("p1")];
    const conversation = initConversation(els, deps());
    conversation.show(user("u1", "Look", { images, ...before }));
    buttonsLabelled("Edit message")[0]?.click();
    conversation.show(user("u1", "Look", { images, ...after }));
    list().querySelector<HTMLButtonElement>(".pin-toggle")?.click();
    const pinned = [{ ...upload("p1"), pinned: true }];
    expect(spies.onMessageChanged).toHaveBeenCalledWith(
      user("u1", "Look", { images: pinned, ...after }),
    );
  });

  it("does not bring the video back by saving an edit that was open meanwhile", () => {
    const conversation = initConversation(els, deps());
    conversation.show(userWithVideo(beach));
    buttonsLabelled("Edit message")[0]?.click();
    const removed = user("u1", "Look", { removedVideo: beach });
    conversation.show(removed);
    const input = list().querySelector<HTMLTextAreaElement>(".message-editor textarea");
    if (input) input.value = "Look again";
    buttonsLabelled("Save")[0]?.click();
    expect(spies.onEdit).toHaveBeenCalledWith(removed, "Look again", expect.any(Function));
  });
});
