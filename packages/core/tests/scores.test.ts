import { describe, expect, it } from "vitest";
import { mergeWindowScores, softmax, type WindowScores } from "../src/audio/scores";

const LABELS = ["applause", "music", "silence"];

function windows(...scores: number[][]): WindowScores[] {
  return scores.map((row, index) => ({ startSeconds: index, endSeconds: index + 2, scores: row }));
}

describe("softmax", () => {
  it("turns logits into probabilities that sum to one", () => {
    const probabilities = softmax([1, 2, 3]);

    expect(probabilities.reduce((sum, value) => sum + value, 0)).toBeCloseTo(1, 10);
    expect(probabilities[2]).toBeCloseTo(0.665, 3);
  });

  it("stays finite for large logits", () => {
    expect(softmax([1000, 1000])).toEqual([0.5, 0.5]);
  });

  it("gives nothing for no logits", () => {
    expect(softmax([])).toEqual([]);
  });
});

describe("mergeWindowScores", () => {
  it("merges consecutive windows with the same top label and keeps the best score", () => {
    const spans = mergeWindowScores(
      windows([0.7, 0.2, 0.1], [0.8, 0.1, 0.1], [0.6, 0.3, 0.1], [0.1, 0.8, 0.1]),
      LABELS,
      { minScore: 0.5 },
    );

    expect(spans).toEqual([
      { startSeconds: 0, endSeconds: 4, label: "applause", score: 0.8 },
      { startSeconds: 3, endSeconds: 5, label: "music", score: 0.8 },
    ]);
  });

  it("drops windows under the threshold and splits a run around them", () => {
    const spans = mergeWindowScores(
      windows([0.7, 0.2, 0.1], [0.4, 0.3, 0.3], [0.7, 0.2, 0.1]),
      LABELS,
      { minScore: 0.5 },
    );

    expect(spans.map((span) => [span.label, span.startSeconds, span.endSeconds])).toEqual([
      ["applause", 0, 2],
      ["applause", 2, 4],
    ]);
  });

  it("never reports a background label, which still breaks a run", () => {
    const spans = mergeWindowScores(
      windows([0.7, 0.2, 0.1], [0.1, 0.1, 0.8], [0.1, 0.1, 0.8], [0.7, 0.2, 0.1]),
      LABELS,
      { minScore: 0.5, backgroundLabels: ["silence"] },
    );

    expect(spans.map((span) => span.startSeconds)).toEqual([0, 3]);
  });

  it("does not join windows with a gap between them", () => {
    const gapped: WindowScores[] = [
      { startSeconds: 0, endSeconds: 2, scores: [0.9, 0.1, 0] },
      { startSeconds: 5, endSeconds: 7, scores: [0.9, 0.1, 0] },
    ];

    expect(mergeWindowScores(gapped, LABELS, { minScore: 0.5 })).toHaveLength(2);
  });

  it("ignores scores with no label to name them", () => {
    expect(mergeWindowScores(windows([0.1, 0.1, 0.1, 0.7]), LABELS, { minScore: 0 })).toEqual([
      { startSeconds: 0, endSeconds: 2, label: "applause", score: 0.1 },
    ]);
  });
});
