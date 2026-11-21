import { describe, expect, it } from "vitest";
import { blankChat, titleFromMessage } from "../src/chat/chats";

describe("blankChat", () => {
  it("uses the default model and the Auto sheet resolution", () => {
    expect(blankChat("m", "id", 5)).toEqual({
      id: "id",
      title: "New chat",
      createdAt: 5,
      updatedAt: 5,
      settings: { systemPrompt: "", modelId: "m", sheetResolution: "auto" },
      sceneLog: [],
    });
  });
});

describe("titleFromMessage", () => {
  it("keeps short messages and cuts long ones near 40 characters", () => {
    expect(titleFromMessage("  What happens\nnext?  ")).toBe("What happens next?");
    const title = titleFromMessage("a".repeat(30) + " " + "b".repeat(30));
    expect(title).toBe(`${"a".repeat(30)} ${"b".repeat(9)}…`);
  });
});
