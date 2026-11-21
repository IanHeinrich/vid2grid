import { describe, expect, it } from "vitest";
import {
  LOOP_SENTENCE_REPEATS,
  LOOP_WINDOW_SENTENCES,
  REASONING_LIMIT_CHARS,
  reasoningLimit,
  reasoningLoopWatch,
} from "../src/chat/reasoningWatch";

describe("reasoningLoopWatch", () => {
  it("trips once a long sentence comes back the fourth time, whatever its case and spacing", () => {
    const looping = reasoningLoopWatch(REASONING_LIMIT_CHARS);
    expect(looping("Maybe the dog is chasing the ball. Or not. ")).toBe(false);
    expect(looping("maybe  the dog is chasing the ball!\nOr not.")).toBe(false);
    expect(looping("MAYBE the dog is chasing the ball. ")).toBe(false);
    expect(looping(" Maybe the dog is chasing")).toBe(false);
    expect(looping(" the ball? ")).toBe(true);
    expect(LOOP_SENTENCE_REPEATS).toBe(4);
  });

  it("trips on two or three sentences cycling", () => {
    const looping = reasoningLoopWatch(REASONING_LIMIT_CHARS);
    const cycle =
      "So the ball must be under the bench. But the bench looks empty in this frame. Let me check the bench again. ";
    const trips = Array.from({ length: LOOP_SENTENCE_REPEATS }, () => looping(cycle));
    expect(trips).toEqual([false, false, false, true]);
  });

  it("lets filler repeat now and then across a long honest trace", () => {
    const looping = reasoningLoopWatch(REASONING_LIMIT_CHARS);
    const filler = "But wait, let me double-check that. ";
    const stretch = (from: number) =>
      Array.from({ length: LOOP_WINDOW_SENTENCES }, (_, index) => {
        const frame = from + index;
        return `Frame ${frame} shows the dog ${frame % 2 === 0 ? "near" : "away from"} the water. `;
      }).join("");
    const trace = [filler, stretch(1), filler, stretch(41), filler, stretch(81), filler];
    expect(trace.map(looping)).toEqual(trace.map(() => false));
  });

  it("does not trip on a per-frame checklist", () => {
    const looping = reasoningLoopWatch(REASONING_LIMIT_CHARS);
    const checklist = Array.from(
      { length: 30 },
      (_, index) => `- Frame at 0:${String(index).padStart(2, "0")}: check the dog and the ball.\n`,
    );
    expect(checklist.some(looping)).toBe(false);
  });

  it("splits sentences that arrive across many small deltas", () => {
    const looping = reasoningLoopWatch(REASONING_LIMIT_CHARS);
    const text = "Maybe the dog is chasing the ball across the sand. ".repeat(4);
    const results = [...text].map(looping);
    expect(results.indexOf(true)).toBe(text.length - 2);
  });

  it("ignores short sentences repeating and trips past the size limit", () => {
    const short = reasoningLoopWatch(REASONING_LIMIT_CHARS);
    expect(["Hmm. ", "Hmm. ", "Hmm. ", "Hmm. "].some(short)).toBe(false);
    const long = reasoningLoopWatch(10);
    expect(long("0123456789")).toBe(false);
    expect(long("x")).toBe(true);
  });

  it("allows higher tiers more reasoning", () => {
    expect(reasoningLimit("normal")).toBe(REASONING_LIMIT_CHARS);
    expect(reasoningLimit("thorough")).toBeGreaterThan(reasoningLimit("normal"));
    expect(reasoningLimit("exhaustive")).toBeGreaterThan(reasoningLimit("thorough"));
  });
});
