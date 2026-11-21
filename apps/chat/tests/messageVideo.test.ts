import { describe, expect, it } from "vitest";
import type { ChatMessage, UserMessage, VideoAttachment } from "../src/types";
import { olderVideos, videoForMessage } from "../src/ui/conversation/messageVideo";

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
