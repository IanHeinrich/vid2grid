import { describe, expect, it } from "vitest";
import {
  findCitations,
  findTimestamps,
  formatSpan,
  formatTimestamp,
  parseTimestamp,
} from "../src/time";

describe("formatTimestamp", () => {
  it("formats minutes and seconds", () => {
    expect(formatTimestamp(0)).toBe("0:00");
    expect(formatTimestamp(102.9)).toBe("1:42");
  });

  it("adds hours past an hour", () => {
    expect(formatTimestamp(3725)).toBe("1:02:05");
  });

  it("clamps negatives to zero", () => {
    expect(formatTimestamp(-3)).toBe("0:00");
  });

  it("adds tenths when asked", () => {
    expect(formatTimestamp(102.47, true)).toBe("1:42.4");
    expect(formatTimestamp(3725, true)).toBe("1:02:05.0");
  });

  it("prints the tenth a value is written with", () => {
    expect(formatTimestamp(1.2, true)).toBe("0:01.2");
    expect(formatTimestamp(3.4, true)).toBe("0:03.4");
    expect(formatTimestamp(65.3, true)).toBe("1:05.3");
    for (let i = 0; i < 6000; i++) {
      expect(formatTimestamp(i / 10, true).endsWith(`.${i % 10}`)).toBe(true);
    }
  });
});

describe("formatSpan", () => {
  it("joins two timestamps", () => {
    expect(formatSpan(60, 90)).toBe("1:00 to 1:30");
  });

  it("gives one time for a single instant", () => {
    expect(formatSpan(102, 102)).toBe("1:42");
    expect(formatSpan(1.5, 1.5)).toBe("0:01.5");
  });

  it("uses tenths for spans under ten seconds", () => {
    expect(formatSpan(0, 0.5)).toBe("0:00.0 to 0:00.5");
  });
});

describe("findTimestamps", () => {
  it("finds bracketed m:ss and h:mm:ss times with their positions", () => {
    const text = "She turns at [1:42], then leaves at [1:02:05].";
    expect(findTimestamps(text)).toEqual([
      { index: 13, length: 6, seconds: 102 },
      { index: 36, length: 9, seconds: 3725 },
    ]);
  });

  it("reads tenths", () => {
    expect(findTimestamps("[0:01.5]")).toEqual([{ index: 0, length: 8, seconds: 1.5 }]);
  });

  it("ignores unbracketed and malformed times", () => {
    expect(findTimestamps("at 1:42 or [1:4] or [abc]", { bare: false })).toEqual([]);
  });
});

describe("findCitations", () => {
  it("finds both ends of a range joined by a hyphen, en dash, em dash or to", () => {
    expect(findCitations("Seen [0:43–0:48].")).toEqual([
      {
        index: 5,
        length: 11,
        times: [
          { index: 6, length: 4, seconds: 43 },
          { index: 11, length: 4, seconds: 48 },
        ],
      },
    ]);
    expect(findCitations("[1:02:03 to 1:02:10]")).toEqual([
      {
        index: 0,
        length: 20,
        times: [
          { index: 1, length: 7, seconds: 3723 },
          { index: 12, length: 7, seconds: 3730 },
        ],
      },
    ]);
    for (const range of ["[0:43-0:48]", "[0:43 — 0:48]", "[0:43 – 0:48]", "[0:43to0:48]"]) {
      expect(findTimestamps(range).map((match) => match.seconds)).toEqual([43, 48]);
    }
  });

  it("gives a single time the whole bracketed span", () => {
    expect(findCitations("[1:42]")).toEqual([
      { index: 0, length: 6, times: [{ index: 0, length: 6, seconds: 102 }] },
    ]);
  });

  it("ignores ranges with a malformed end or another separator", () => {
    expect(findCitations("[0:43-0:4] [0:43 or 0:48] [0:43–]", { bare: false })).toEqual([]);
  });
});

describe("parenthesised times", () => {
  it("finds (m:ss) and ranges like the bracketed forms", () => {
    expect(findCitations("Then (0:26) and (0:26–0:31).")).toEqual([
      { index: 5, length: 6, times: [{ index: 5, length: 6, seconds: 26 }] },
      {
        index: 16,
        length: 11,
        times: [
          { index: 17, length: 4, seconds: 26 },
          { index: 22, length: 4, seconds: 31 },
        ],
      },
    ]);
  });

  it("does not pair a bracket with a parenthesis", () => {
    expect(findCitations("[0:26) (0:26]", { bare: false })).toEqual([]);
  });
});

describe("bare times", () => {
  const seconds = (text: string) => findTimestamps(text).map((match) => match.seconds);

  it("finds m:ss and h:mm:ss in prose with the time as the whole span", () => {
    expect(findCitations("She leaves at 0:26 and 1:02:03.")).toEqual([
      { index: 14, length: 4, times: [{ index: 14, length: 4, seconds: 26 }] },
      { index: 23, length: 7, times: [{ index: 23, length: 7, seconds: 3723 }] },
    ]);
  });

  it("finds bare ranges joined by a dash or to", () => {
    expect(seconds("from 0:26–0:31, 0:26-0:31, 0:26 to 0:31 and 1:02:03 — 1:02:10")).toEqual([
      26, 31, 26, 31, 26, 31, 3723, 3730,
    ]);
    expect(findCitations("0:26 to 0:31")).toEqual([
      {
        index: 0,
        length: 12,
        times: [
          { index: 0, length: 4, seconds: 26 },
          { index: 8, length: 4, seconds: 31 },
        ],
      },
    ]);
  });

  it("reads tenths and allows punctuation around the time", () => {
    expect(seconds("(see 0:01.5), then 2:00.")).toEqual([1.5, 120]);
    expect(seconds("at 0:26, 0:31; 0:40!")).toEqual([26, 31, 40]);
  });

  it("requires two-digit seconds, and two-digit minutes after hours", () => {
    expect(seconds("1:2 or 1:4 or 1:2:03 or 1:02:3")).toEqual([]);
  });

  it("ignores times touching a digit, colon, letter or slash", () => {
    const rejected = [
      "12:30:45:10",
      "v1:22",
      "a1:22",
      "1:22s",
      "1:225",
      "11:22:",
      "https://example.com/12:30",
      "id/0:26",
      "x:1:22",
    ];
    for (const text of rejected) expect(seconds(text)).toEqual([]);
  });

  it("lets a bracketed or parenthesised form claim the times inside it", () => {
    expect(findCitations("[0:26] (0:26) [0:26–0:31]")).toHaveLength(3);
    expect(seconds("[0:26] (0:26–0:31)")).toEqual([26, 26, 31]);
  });

  it("falls back to a single time when the range end is malformed", () => {
    expect(seconds("0:26 to 0:3 and 0:26-0:31x")).toEqual([26, 26]);
  });

  it("can be switched off so only bracketed and parenthesised forms remain", () => {
    expect(findTimestamps("at 0:26 and [0:31]", { bare: false })).toEqual([
      { index: 12, length: 6, seconds: 31 },
    ]);
  });
});

describe("implausible times", () => {
  const seconds = (text: string, options = {}) =>
    findTimestamps(text, options).map((match) => match.seconds);

  it("rejects seconds or minutes after hours of 60 or more in every form", () => {
    for (const text of [
      "[1:75]",
      "(1:75)",
      "1:75",
      "[1:60:00]",
      "(1:60:00)",
      "1:60:00",
      "1:02:75",
    ]) {
      expect(seconds(text)).toEqual([]);
    }
    expect(seconds("[0:59] (1:02:59) 0:59 1:59:59")).toEqual([59, 3779, 59, 7199]);
  });

  it("rejects bare times followed by am or pm in any case, with or without dots", () => {
    for (const text of [
      "at 4:30 pm",
      "4:30 PM",
      "4:30 P.M.",
      "6:00 a.m.",
      "6:00am",
      "5:30 to 6:00 pm",
    ]) {
      expect(seconds(text)).toEqual([]);
    }
    expect(seconds("at 4:30 amazing, [4:30] pm")).toEqual([270, 270]);
  });

  it("drops bare times beyond maxSeconds plus a second, and the whole range with them", () => {
    const options = { maxSeconds: 60 };
    expect(seconds("0:26, 1:00, 1:01 and 1:02", options)).toEqual([26, 60, 61]);
    expect(seconds("open 5:30 to 6:00 and 0:10 to 0:20 and 0:30 to 5:00", options)).toEqual([
      10, 20,
    ]);
    expect(seconds("open 5:30 to 6:00")).toEqual([330, 360]);
  });

  it("does not filter bracketed or parenthesised times by maxSeconds", () => {
    expect(seconds("[5:00] and (5:00–6:00)", { maxSeconds: 60 })).toEqual([300, 300, 360]);
  });
});

describe("parseTimestamp", () => {
  it("reads m:ss, h:mm:ss, bracketed times and plain seconds", () => {
    expect(parseTimestamp("1:05")).toBe(65);
    expect(parseTimestamp("[1:02:03]")).toBe(3723);
    expect(parseTimestamp(" 42 ")).toBe(42);
    expect(parseTimestamp("1:5")).toBe(65);
    expect(parseTimestamp("soon")).toBeUndefined();
  });
});
