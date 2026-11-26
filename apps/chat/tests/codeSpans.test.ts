import { describe, expect, it } from "vitest";
import { outsideCode, splitCode } from "../src/chat/codeSpans";

function codeOf(text: string): string[] {
  return splitCode(text).flatMap((part) => (part.code ? [part.text] : []));
}

describe("splitCode", () => {
  it("splits fenced blocks and inline spans from prose, losing nothing", () => {
    const text = "Use `look` like this:\n```js\nlook(1, 2);\n```\nor this:\n~~~\nx\n~~~\ndone.";
    expect(codeOf(text)).toEqual(["`look`", "\n```js\nlook(1, 2);\n```", "\n~~~\nx\n~~~"]);
    expect(
      splitCode(text)
        .map((part) => part.text)
        .join(""),
    ).toBe(text);
  });

  it("closes a fence on its own line only, and an empty one at once", () => {
    expect(codeOf("```\n```\nafter")).toEqual(["```\n```"]);
    expect(codeOf("```\na ```b``` c\n````\nafter")).toEqual(["```\na ```b``` c\n````"]);
  });

  it("runs an unclosed fence to the end", () => {
    expect(codeOf("Before\n```\nstill code")).toEqual(["\n```\nstill code"]);
  });

  it("reads backticks on one line with text after them as inline code", () => {
    expect(codeOf("```x``` and ``a ` b``")).toEqual(["```x```", "``a ` b``"]);
  });

  it("leaves an unmatched backtick, or one whose pair is past a blank line, as prose", () => {
    expect(codeOf("A ` alone.")).toEqual([]);
    expect(codeOf("A `start\n\nend` here.")).toEqual([]);
  });
});

describe("outsideCode", () => {
  it("changes prose and keeps code as written", () => {
    expect(outsideCode("a `a` a", (prose) => prose.replace(/a/g, "b"))).toBe("b `a` b");
  });
});
