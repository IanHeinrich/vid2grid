import { describe, expect, it } from "vitest";
import { safeFilename } from "../src/ui/download";

describe("safeFilename", () => {
  it("makes titles safe to use as file names", () => {
    expect(safeFilename('a/b\\c:d*e?f"g<h>i|j')).toBe("a b c d e f g h i j");
    expect(safeFilename("  ...  ")).toBe("chat");
    expect(safeFilename("tab\there")).toBe("tab here");
    expect(safeFilename("x".repeat(200))).toHaveLength(80);
  });
});
