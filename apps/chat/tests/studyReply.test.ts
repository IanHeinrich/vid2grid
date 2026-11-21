import { describe, expect, it } from "vitest";
import { parseStudyReply } from "../src/video/studyReply";

const RANGE = { startSeconds: 60, endSeconds: 105 };

describe("parseStudyReply entries", () => {
  it("accepts hyphens, en dashes and 'to' between times", () => {
    const lines = ["[1:00.0-1:05.5] One.", "[1:05.5 – 1:10] Two.", "[1:10 to 1:20.25] Three."];
    const reply = lines.join("\n");
    expect(parseStudyReply(reply, RANGE).entries).toEqual([
      { startSeconds: 60, endSeconds: 65.5, text: "One." },
      { startSeconds: 65.5, endSeconds: 70, text: "Two." },
      { startSeconds: 70, endSeconds: 80.25, text: "Three." },
    ]);
  });

  it("reads hours and a single moment", () => {
    expect(parseStudyReply("[1:02:03.5-1:02:10] Late.\n[1:02:11] Blink.", RANGE).entries).toEqual([
      { startSeconds: 3723.5, endSeconds: 3730, text: "Late." },
      { startSeconds: 3731, endSeconds: 3731, text: "Blink." },
    ]);
  });

  it("tolerates bullets, missing brackets and a separator before the text", () => {
    expect(parseStudyReply("- [1:00-1:02]: Bullet.\n1:02-1:04 - Bare.", RANGE).entries).toEqual([
      { startSeconds: 60, endSeconds: 62, text: "Bullet." },
      { startSeconds: 62, endSeconds: 64, text: "Bare." },
    ]);
  });

  it("attaches lines without a timestamp to the previous entry and drops a preamble", () => {
    const reply = "Here is the timeline:\n\n[1:00-1:04] A door opens.\nA dog runs through.\n";
    expect(parseStudyReply(reply, RANGE).entries).toEqual([
      { startSeconds: 60, endSeconds: 64, text: "A door opens. A dog runs through." },
    ]);
  });

  it("gives a timestamp alone on its line the text that follows", () => {
    expect(parseStudyReply("[1:00-1:04]\nA door opens.", RANGE).entries).toEqual([
      { startSeconds: 60, endSeconds: 64, text: "A door opens." },
    ]);
  });

  it("turns a reply with no usable lines into one entry covering the window", () => {
    expect(parseStudyReply("  A man stands in a field.\nIt rains. ", RANGE).entries).toEqual([
      { startSeconds: 60, endSeconds: 105, text: "A man stands in a field.\nIt rains." },
    ]);
  });

  it("returns nothing for an empty reply", () => {
    expect(parseStudyReply(" \n ", RANGE).entries).toEqual([]);
  });
});

describe("parseStudyReply unclear moments", () => {
  it("reads UNCLEAR lines as spans clamped to the window, never as entries", () => {
    const reply = [
      "[1:00-1:10] A man crosses the road.",
      "UNCLEAR [1:04.5-1:06] the sign he holds is too small to read",
      "- unclear: [0:55-1:02] something falls",
      "maybe a hat",
      "UNCLEAR [1:40-2:00] a fast cut",
    ].join("\n");
    expect(parseStudyReply(reply, RANGE)).toEqual({
      entries: [{ startSeconds: 60, endSeconds: 70, text: "A man crosses the road." }],
      unclear: [
        { startSeconds: 64.5, endSeconds: 66, reason: "the sign he holds is too small to read" },
        { startSeconds: 60, endSeconds: 62, reason: "something falls maybe a hat" },
        { startSeconds: 100, endSeconds: 105, reason: "a fast cut" },
      ],
    });
  });

  it("drops UNCLEAR spans lying wholly outside the window, with their continuation lines", () => {
    const reply = "UNCLEAR [0:10-0:20] before it\nstill before\nUNCLEAR [1:45] at its end";
    expect(parseStudyReply(reply, RANGE)).toEqual({
      entries: [],
      unclear: [{ startSeconds: 105, endSeconds: 105, reason: "at its end" }],
    });
    expect(parseStudyReply("UNCLEAR [0:10-0:20] before it", RANGE)).toEqual({
      entries: [],
      unclear: [],
    });
  });

  it("keeps a reply of only UNCLEAR lines out of the entries", () => {
    expect(parseStudyReply("UNCLEAR [1:01] a blur", RANGE)).toEqual({
      entries: [],
      unclear: [{ startSeconds: 61, endSeconds: 61, reason: "a blur" }],
    });
  });
});
