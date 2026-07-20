import { describe, expect, it } from "vitest";
import { cuesToVtt, formatVttTimestamp, vttToPlainText, type TranscriptCue } from "../src/transcription/transcription";

describe("formatVttTimestamp", () => {
  it("formats a fixed-width HH:MM:SS.mmm timestamp", () => {
    expect(formatVttTimestamp(0)).toBe("00:00:00.000");
    expect(formatVttTimestamp(5)).toBe("00:00:05.000");
    expect(formatVttTimestamp(65.25)).toBe("00:01:05.250");
    expect(formatVttTimestamp(3661.5)).toBe("01:01:01.500");
  });

  it("clamps negative timestamps to zero", () => {
    expect(formatVttTimestamp(-1)).toBe("00:00:00.000");
  });
});

describe("cuesToVtt", () => {
  it("produces a header-only document for no cues", () => {
    expect(cuesToVtt([])).toBe("WEBVTT\n");
  });

  it("emits one cue block per cue with fixed-width timecodes", () => {
    const cues: TranscriptCue[] = [
      { start: 0, end: 1.5, text: "hello there" },
      { start: 2, end: 3, text: "general kenobi" },
    ];
    const vtt = cuesToVtt(cues);
    expect(vtt).toBe(
      "WEBVTT\n\n" +
        "00:00:00.000 --> 00:00:01.500\nhello there\n\n" +
        "00:00:02.000 --> 00:00:03.000\ngeneral kenobi\n",
    );
  });
});

describe("vttToPlainText", () => {
  it("strips the header and timecode lines, joining cue text with spaces", () => {
    const vtt = cuesToVtt([
      { start: 0, end: 1, text: "hello there" },
      { start: 2, end: 3, text: "general kenobi" },
    ]);
    expect(vttToPlainText(vtt)).toBe("hello there general kenobi");
  });

  it("returns an empty string for a header-only document", () => {
    expect(vttToPlainText("WEBVTT\n")).toBe("");
  });
});
