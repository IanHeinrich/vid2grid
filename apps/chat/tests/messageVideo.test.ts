import { describe, expect, it } from "vitest";
import type { ChatMessage, ImageRef, UserMessage, VideoAttachment } from "../src/types";
import {
  olderVideos,
  removalKeys,
  videoForImage,
  videoForMessage,
  wasRemoved,
  withVideoBack,
  withVideoRemoved,
} from "../src/chat/messageVideo";

function attachment(name: string): VideoAttachment {
  return { name, fileKey: `${name}-key`, durationSeconds: 60, width: 640, height: 360 };
}

function user(id: string, video?: VideoAttachment): UserMessage {
  return { id, createdAt: 0, role: "user", text: "", images: [], ...(video ? { video } : {}) };
}

function reply(id: string): ChatMessage {
  return { id, createdAt: 0, role: "assistant", text: "", toolCalls: [] };
}

const beach = attachment("beach.mp4");
const dunes = attachment("dunes.mp4");
const messages = [user("u0"), user("u1", beach), reply("a1"), user("u2", dunes), reply("a2")];

describe("videoForMessage", () => {
  it("gives an earlier attachment to the messages it governs", () => {
    expect(videoForMessage(messages, "u1", dunes)).toBe(beach);
    expect(videoForMessage(messages, "a1", dunes)).toBe(beach);
  });

  it("gives the current video to messages under the latest attachment, even after a reattach", () => {
    const changed = { ...dunes, fileKey: "dunes-changed" };
    expect(videoForMessage(messages, "u2", changed)).toBe(changed);
    expect(videoForMessage(messages, "a2", changed)).toBe(changed);
  });

  it("gives the current video to messages under an earlier attachment of the latest file", () => {
    const again = [...messages, user("u3", { ...beach })];
    const changed = { ...beach, fileKey: "beach-changed" };
    expect(videoForMessage(again, "u1", changed)).toBe(changed);
    expect(videoForMessage(again, "u2", changed)).toBe(dunes);
  });

  it("gives the current video before any attachment and for an unknown message", () => {
    expect(videoForMessage(messages, "u0", dunes)).toBe(dunes);
    expect(videoForMessage(messages, "missing", dunes)).toBe(dunes);
    expect(videoForMessage(messages, undefined, undefined)).toBeUndefined();
  });
});

describe("videoForImage", () => {
  const sheet: ImageRef = { id: "s1", pinned: false, source: { kind: "upload", name: "s1" } };
  const holding = (id: string): ChatMessage => ({
    id,
    createdAt: 0,
    role: "tool",
    toolCallId: "c1",
    text: "",
    images: [sheet],
  });

  it("uses the message that first held the image, not one that recalled it", () => {
    const recalled = holding("t3");
    const all = [user("u1", beach), holding("t1"), user("u2", dunes), recalled];
    expect(videoForImage(all, "s1", dunes)).toBe(beach);
    expect(videoForImage([...messages, recalled], "s1", dunes)).toBe(dunes);
  });

  it("keeps the earlier video in a branch made before the current one was attached", () => {
    expect(videoForImage([user("u1", beach), holding("t1")], "s1", dunes)).toBe(beach);
  });

  it("keeps the earlier video once the message that attached the current one is deleted", () => {
    const all = [user("u1", beach), holding("t1"), user("u3"), reply("a3")];
    expect(videoForImage(all, "s1", dunes)).toBe(beach);
  });

  it("does not take a reattached, changed file for the one the message names", () => {
    const changed = { ...beach, fileKey: "beach-changed" };
    expect(videoForImage([user("u1", beach), holding("t1")], "s1", changed)).toBe(beach);
  });

  it("falls back to the current video only when no message names one", () => {
    expect(videoForImage([user("u1"), holding("t1")], "s1", dunes)).toBe(dunes);
    const before = [user("u1"), holding("t1"), user("u2", beach)];
    expect(videoForImage(before, "s1", dunes)).toBeUndefined();
  });
});

describe("olderVideos", () => {
  it("lists earlier videos newest first, each once, without the one the current stands for", () => {
    const again = [...messages, user("u3", beach), user("u4", attachment("cove.mp4"))];
    const changed = { ...attachment("cove.mp4"), fileKey: "cove-changed" };
    expect(olderVideos(again, changed)).toEqual([beach, dunes]);
  });

  it("lists every attachment while no video is attached", () => {
    expect(olderVideos(messages, undefined)).toEqual([dunes, beach]);
  });
});

function removed(id: string, video: VideoAttachment): UserMessage {
  return withVideoRemoved(user(id, video));
}

describe("a removed video", () => {
  it("moves to another field of the message, and back", () => {
    const message = user("u1", beach);
    expect(withVideoRemoved(message)).toEqual({ ...user("u1"), removedVideo: beach });
    expect(withVideoBack(withVideoRemoved(message))).toEqual(message);
    expect(withVideoRemoved(user("u0"))).toEqual(user("u0"));
    expect(withVideoBack(message)).toEqual(message);
  });

  it("is still what its messages are about, whatever the chat has now", () => {
    const all = [user("u1", beach), reply("a1"), removed("u2", dunes), reply("a2")];
    expect(videoForMessage(all, "a2", undefined)).toBe(dunes);
    expect(videoForMessage(all, "a1", undefined)).toBe(beach);
    expect(videoForMessage(all, "a2", attachment("cove.mp4"))).toBe(dunes);
  });

  it("is the current video again for its messages once attached again", () => {
    const again = [removed("u1", beach), reply("a1"), user("u2", { ...beach })];
    const changed = { ...beach, fileKey: "beach-changed" };
    expect(videoForMessage(again, "a1", changed)).toBe(changed);
  });

  it("names the latest attachment left when the chat has no video", () => {
    expect(videoForMessage([user("u1", beach), reply("a1")], "a1", undefined)).toBe(beach);
  });

  it("still names its sheets, rather than the video attached later", () => {
    const sheet: ImageRef = { id: "s1", pinned: false, source: { kind: "upload", name: "s1" } };
    const holding: ChatMessage = { ...user("t1"), images: [sheet] };
    expect(videoForImage([removed("u1", beach), holding], "s1", undefined)).toBe(beach);
    expect(videoForImage([removed("u1", beach), holding], "s1", dunes)).toBe(beach);
  });

  it("is not listed among the chat's earlier videos", () => {
    const all = [removed("u1", beach), user("u2", attachment("cove.mp4")), user("u3", dunes)];
    expect(olderVideos(all, dunes).map((video) => video.name)).toEqual(["cove.mp4"]);
    expect(olderVideos([removed("u1", beach)], undefined)).toEqual([]);
  });

  it("counts as removed only until it is attached again", () => {
    const key = beach.fileKey;
    const kept = { removedVideos: [{ video: beach, throughCreatedAt: 1 }] };
    expect(wasRemoved({}, [removed("u1", beach)], key)).toBe(true);
    expect(wasRemoved(kept, [], key)).toBe(true);
    expect(wasRemoved(kept, [removed("u1", beach), user("u2", beach)], key)).toBe(false);
    expect(wasRemoved({ ...kept, video: beach }, [], key)).toBe(false);
    expect(wasRemoved({}, [], key)).toBe(false);
  });
});

describe("a removed video no message names", () => {
  const at = (message: ChatMessage, createdAt: number): ChatMessage => ({ ...message, createdAt });
  const kept = [{ video: beach, throughCreatedAt: 2 }];
  const before = [at(user("u1"), 1), at(reply("a1"), 2)];
  const sheet: ImageRef = { id: "s1", pinned: false, source: { kind: "upload", name: "s1" } };

  it("is what the messages up to its removal are about, and no later ones", () => {
    const all = [...before, at(user("u2"), 3), at(user("u3", dunes), 4), at(reply("a3"), 5)];
    expect(videoForMessage(all, "a1", undefined, kept)).toBe(beach);
    expect(videoForMessage(all, "a1", dunes, kept)).toBe(beach);
    expect(videoForMessage(all, "u2", dunes, kept)).toBe(dunes);
    expect(videoForMessage(all, "a3", dunes, kept)).toBe(dunes);
  });

  it("gives each message the video removed first after it", () => {
    const twice = [...kept, { video: dunes, throughCreatedAt: 4 }];
    const all = [...before, at(user("u2"), 4)];
    expect(videoForMessage(all, "a1", undefined, twice)).toBe(beach);
    expect(videoForMessage(all, "u2", undefined, twice)).toBe(dunes);
  });

  it("leaves messages with another video of their own, and takes those it stood in for", () => {
    const own = [{ video: dunes, throughCreatedAt: 2 }];
    const named = [at(user("u1", beach), 1), at(removed("u2", dunes), 2)];
    expect(videoForMessage(named, "u1", undefined, own)).toBe(beach);
    const unnamed = [at(user("u1", beach), 1), at(reply("a2"), 2)];
    expect(videoForMessage(unnamed, "a2", undefined, own)).toBe(dunes);
  });

  it("names its sheets, but not one whose message names a video", () => {
    const holding: ChatMessage = { ...user("t1"), createdAt: 2, images: [sheet] };
    expect(videoForImage([...before, holding], "s1", dunes, kept)).toBe(beach);
    const later = [...before, holding, at(user("u3", dunes), 4)];
    expect(videoForImage(later, "s1", dunes, kept)).toBe(beach);
    expect(videoForImage([at(user("u1", dunes), 1), holding], "s1", dunes, kept)).toBe(dunes);
    expect(videoForImage([{ ...holding, createdAt: 3 }], "s1", dunes, kept)).toBe(dunes);
  });
});

describe("removalKeys", () => {
  it("is the one key for the current or an earlier video", () => {
    expect([...removalKeys(messages, dunes, dunes.fileKey)]).toEqual([dunes.fileKey]);
    expect([...removalKeys(messages, dunes, beach.fileKey)]).toEqual([beach.fileKey]);
  });

  it("takes a reattached, changed file together with the attachment it stands for", () => {
    const changed = { ...dunes, fileKey: "dunes-changed" };
    const both = ["dunes-changed", dunes.fileKey];
    expect([...removalKeys(messages, changed, dunes.fileKey)]).toEqual(both);
    expect([...removalKeys(messages, changed, changed.fileKey)]).toEqual(both);
  });

  it("leaves an earlier video alone when the message with the current one is gone", () => {
    const keys = removalKeys([user("u1", beach)], dunes, dunes.fileKey);
    expect([...keys]).toEqual([dunes.fileKey]);
  });
});
