import { describe, expect, it } from "vitest";
import { readInteger, readNumber } from "../src/inputs";

describe("readNumber", () => {
  it("parses the input's value", () => {
    expect(readNumber({ value: "2.5" })).toBe(2.5);
  });

  it("reads an empty value as zero, like Number()", () => {
    expect(readNumber({ value: "" }, 9)).toBe(0);
  });

  it("returns the fallback only for an unparseable value", () => {
    expect(readNumber({ value: "abc" }, 9)).toBe(9);
    expect(readNumber({ value: "abc" })).toBeNaN();
  });
});

describe("readInteger", () => {
  it("truncates toward zero", () => {
    expect(readInteger({ value: "9.9" })).toBe(9);
    expect(readInteger({ value: "-2.5" })).toBe(-2);
  });
});
