import { describe, expect, it } from "vitest";
import { audioTrackLines, type AudioTrack } from "../src/audio/audioTrack";

const track: AudioTrack = {
  startSeconds: 0,
  durationSeconds: 130,
  speech: [
    { start: 100, end: 103, text: "hello there" },
    { start: 104, end: 105, text: "" },
  ],
  events: [
    {
      startSeconds: 102,
      endSeconds: 110,
      label: "applause",
      score: 0.8123,
      loudnessDb: 9.4,
      ratePerMinute: 119.6,
    },
    { startSeconds: 20, endSeconds: 22, label: "dog barking", score: 0.5, loudnessDb: -7 },
    { startSeconds: 60, endSeconds: 63, label: "music", score: 0.6, loudnessDb: -0.2 },
  ],
};

describe("audioTrackLines", () => {
  it("interleaves speech and sound events in time order", () => {
    expect(audioTrackLines(track)).toEqual([
      "[0:20-0:22] dog barking 0.50, quiet (-7 dB)",
      "[1:00-1:03] music 0.60, moderate (0 dB)",
      '[1:40] "hello there"',
      "[1:42-1:50] applause 0.81, loud (+9 dB), about 120/min",
    ]);
  });

  it("keeps only lines that overlap the range", () => {
    expect(audioTrackLines(track, { startSeconds: 61, endSeconds: 101 })).toEqual([
      "[1:00-1:03] music 0.60, moderate (0 dB)",
      '[1:40] "hello there"',
    ]);
  });

  it("writes a cue that is one bracketed tag as a sound, and keeps mixed text as speech", () => {
    const tagged: AudioTrack = {
      startSeconds: 0,
      durationSeconds: 30,
      events: [],
      speech: [
        { start: 0, end: 5, text: "(laughter)" },
        { start: 5, end: 10, text: " [ music ] " },
        { start: 10, end: 15, text: "(laughter) That was fun." },
        { start: 15, end: 20, text: "[music] (applause)" },
        { start: 20, end: 25, text: "( )" },
      ],
    };

    expect(audioTrackLines(tagged)).toEqual([
      "[0:00] sound: laughter",
      "[0:05] sound: music",
      '[0:10] "(laughter) That was fun."',
      '[0:15] "[music] (applause)"',
      '[0:20] "( )"',
    ]);
  });

  it("gives an empty track no lines", () => {
    expect(
      audioTrackLines({ startSeconds: 0, durationSeconds: 0, speech: [], events: [] }),
    ).toEqual([]);
  });
});
