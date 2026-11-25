import { describe, expect, it } from "vitest";
import { createSeekJudge } from "../src/seekJudge";

// What the judge takes 30 fps video to decode in 100 ms before it has measured anything.
const SKIPPED_SECONDS = 10;

function judgeWith(framesPerSecond: number | undefined) {
  const judge = createSeekJudge(framesPerSecond);
  return {
    judge,
    seeksTook: (...ms: number[]) => ms.map((m) => judge.seekTook(SKIPPED_SECONDS, m)),
  };
}

describe("createSeekJudge", () => {
  it("keeps seeking while seeks are quicker than decoding the skipped video", () => {
    const { seeksTook } = judgeWith(30);
    expect(seeksTook(90, 90, 90, 90, 90)).not.toContain(true);
  });

  it("tries decoding at the third slow seek in a row", () => {
    const { seeksTook } = judgeWith(30);
    expect(seeksTook(110, 110, 110)).toEqual([false, false, true]);
  });

  it("starts counting again after a quick seek", () => {
    const { seeksTook } = judgeWith(30);
    expect(seeksTook(110, 110, 90, 110, 110, 110)).toEqual([
      ...[false, false, false],
      ...[false, false, true],
    ]);
  });

  it("takes low frame rates to decode more quickly, and an unknown one as 30 fps", () => {
    expect(judgeWith(1).seeksTook(10, 10, 10)).toContain(true);
    expect(judgeWith(30).seeksTook(10, 10, 10)).not.toContain(true);
    expect(judgeWith(undefined).seeksTook(90, 90, 90)).not.toContain(true);
    expect(judgeWith(undefined).seeksTook(110, 110, 110)).toContain(true);
  });

  it("needs decoding to win by a margin, since a try measures quick", () => {
    const { seeksTook, judge } = judgeWith(30);
    seeksTook(300, 300, 300);
    judge.decoded(SKIPPED_SECONDS, 210);
    expect(judge.decodingWon()).toBe(false);
  });

  it("gives decoding the win when it covers the video faster than the seeks did", () => {
    const { seeksTook, judge } = judgeWith(30);
    seeksTook(300, 300, 300);
    judge.decoded(SKIPPED_SECONDS / 2, 95);
    judge.decoded(SKIPPED_SECONDS / 2, 95);
    expect(judge.decodingWon()).toBe(true);
  });

  it("goes back to seeking, by what it measured, when decoding is slower", () => {
    const { seeksTook, judge } = judgeWith(30);
    seeksTook(300, 300, 300);
    judge.decoded(SKIPPED_SECONDS, 400);
    expect(judge.decodingWon()).toBe(false);
    expect(seeksTook(300, 390, 390, 390)).not.toContain(true);
    expect(seeksTook(410, 410, 410)).toEqual([false, false, true]);
  });

  it("goes back to seeking when the try measured nothing", () => {
    const { seeksTook, judge } = judgeWith(30);
    seeksTook(300, 300, 300);
    expect(judge.decodingWon()).toBe(false);
    expect(seeksTook(110, 110, 110)).toEqual([false, false, true]);
  });
});
