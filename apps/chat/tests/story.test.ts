import { describe, expect, it } from "vitest";
import { storyForBranch } from "../src/chat/story";
import { storyHistory } from "./support/requestFixtures";

describe("storyForBranch", () => {
  const timed = storyHistory.map((message, index) => ({ ...message, createdAt: index + 1 }));
  const story = { text: "A dog ran.", throughMessageId: "t1", throughCreatedAt: 3, updatedAt: 0 };

  it("keeps the story when the branch copies its last message", () => {
    expect(storyForBranch(story, timed.slice(0, 3))).toBe(story);
  });

  it("keeps the story when its last message is gone but the branch reaches past it", () => {
    const copied = timed.filter((message) => message.id !== "t1").slice(0, 3);
    expect(storyForBranch(story, copied)).toBe(story);
  });

  it("drops the story when the branch ends before its last message", () => {
    expect(storyForBranch(story, timed.slice(0, 2))).toBeUndefined();
    const older = { text: "A dog ran.", throughMessageId: "t1", updatedAt: 0 };
    expect(storyForBranch(older, timed.slice(0, 2))).toBeUndefined();
    expect(storyForBranch(undefined, timed)).toBeUndefined();
  });
});
