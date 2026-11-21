import { describe, expect, it } from "vitest";
import { overviewText } from "../src/ui/video/overviewText";

describe("overviewText", () => {
  it("is empty once the overview is ready and shows progress or failure otherwise", () => {
    expect(overviewText(undefined)).toBe("");
    expect(overviewText({ kind: "ready", fileKey: "k", sheets: 4 })).toBe("");
    expect(overviewText({ kind: "rendering", fileKey: "k", done: 1, total: 4 })).toBe(
      "Overview 25%",
    );
    expect(overviewText({ kind: "rendering", fileKey: "k", done: 0, total: 0 })).toBe(
      "Rendering overview",
    );
    expect(overviewText({ kind: "failed", fileKey: "k", error: "boom" })).toBe("Overview failed");
  });

  it("says when the overview waits for a model or was reused", () => {
    expect(overviewText({ kind: "needsModel", fileKey: "k" })).toBe(
      "Choose a model to prepare the overview",
    );
    expect(overviewText({ kind: "ready", fileKey: "k", sheets: 4, reused: true })).toBe(
      "Seen before, overview reused",
    );
  });
});
