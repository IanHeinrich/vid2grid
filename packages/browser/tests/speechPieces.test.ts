import { describe, expect, it } from "vitest";
import { speechPieces, spokenText } from "../src/transcribe/speechPieces";

const RATE = 100;

function seconds(length: number, level: number): Float32Array {
  return new Float32Array(length * RATE).fill(level);
}

function joined(...parts: Float32Array[]): Float32Array {
  const samples = new Float32Array(parts.reduce((total, part) => total + part.length, 0));
  let offset = 0;
  for (const part of parts) {
    samples.set(part, offset);
    offset += part.length;
  }
  return samples;
}

describe("speechPieces", () => {
  it("cuts five second pieces and keeps a tail of a second or more as its own piece", () => {
    const pieces = speechPieces(seconds(12, 0.1), RATE);

    expect(pieces.map((piece) => [piece.startSeconds, piece.endSeconds])).toEqual([
      [0, 5],
      [5, 10],
      [10, 12],
    ]);
    expect(pieces[2]).toMatchObject({ startIndex: 1000, endIndex: 1200 });
  });

  it("folds a tail under a second into the piece before it", () => {
    const pieces = speechPieces(seconds(10.5, 0.1), RATE);

    expect(pieces.map((piece) => [piece.startSeconds, piece.endSeconds])).toEqual([
      [0, 5],
      [5, 10.5],
    ]);
  });

  it("marks a near-silent piece as not audible", () => {
    const pieces = speechPieces(joined(seconds(5, 0.0001), seconds(5, 0.05)), RATE);

    expect(pieces.map((piece) => piece.audible)).toEqual([false, true]);
  });

  it("gives no pieces for no samples", () => {
    expect(speechPieces(new Float32Array(0), RATE)).toEqual([]);
  });
});

describe("spokenText", () => {
  it("joins the segments and drops Whisper's placeholders for silence", () => {
    expect(spokenText([{ text: " Hello" }, { text: "there. " }])).toBe("Hello there.");
    expect(spokenText([{ text: " [BLANK_AUDIO]" }])).toBe("");
    expect(spokenText([{ text: "[SOUND] (noise)" }])).toBe("");
    expect(spokenText([{ text: "[ Silence ] Thanks. (no speech)" }])).toBe("Thanks.");
  });

  it("keeps tags for sounds Whisper heard", () => {
    expect(spokenText([{ text: " (laughter)" }])).toBe("(laughter)");
  });
});
