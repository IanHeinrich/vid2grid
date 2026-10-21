import { describe, expect, it } from "vitest";
import { Vid2GridError } from "@vid2grid/core";
import { toUserMessage } from "../src/errors";

describe("toUserMessage", () => {
  it("uses an Error's message", () => {
    expect(toUserMessage(new Error("Video is unreadable"))).toBe("Video is unreadable");
  });

  it("passes a core error's message through", () => {
    const err = new Vid2GridError("invalid_request", "target_fps must be positive");
    expect(toUserMessage(err)).toBe("target_fps must be positive");
  });

  it("flags an internal core error as a bug", () => {
    const err = new Vid2GridError("internal", "a sheet has no frame timestamps");
    expect(toUserMessage(err)).toBe(
      "Internal error (please report it): a sheet has no frame timestamps",
    );
  });

  it("falls back to the error's name when the message is empty", () => {
    expect(toUserMessage(new DOMException("", "NotAllowedError"))).toBe("NotAllowedError");
  });

  it("passes a thrown string through", () => {
    expect(toUserMessage("decoder crashed")).toBe("decoder crashed");
  });

  it("stringifies anything else", () => {
    expect(toUserMessage(42)).toBe("42");
    expect(toUserMessage(undefined)).toBe("undefined");
  });
});
