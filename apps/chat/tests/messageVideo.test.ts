import { describe, expect, it } from "vitest";
import type { ChatMessage, ImageRef, UserMessage, VideoAttachment } from "../src/types";
import { olderVideos, videoForImage, videoForMessage } from "../src/chat/messageVideo";

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
