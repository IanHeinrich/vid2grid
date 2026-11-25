import { describe, expect, it } from "vitest";
import { errorText } from "../src/text";

describe("errorText", () => {
  it("is the message of an error, or anything else as text", () => {
    expect(errorText(new Error("Network down"))).toBe("Network down");
    expect(errorText("odd")).toBe("odd");
  });

  it("clips a server's whole page", () => {
    const text = errorText(new Error(`Bad gateway ${"x".repeat(5000)}`));
    expect(text).toHaveLength(501);
    expect(text).toMatch(/^Bad gateway x+…$/);
  });
});
