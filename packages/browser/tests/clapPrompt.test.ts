import { describe, expect, it } from "vitest";
import { clapPrompt } from "../src/audio/clapPrompt";

describe("clapPrompt", () => {
  it("puts a one or two word wording in the template", () => {
    expect(clapPrompt("applause")).toBe("This is a sound of applause.");
    expect(clapPrompt("piano music")).toBe("This is a sound of piano music.");
  });

  it("uses a longer phrase as typed", () => {
    expect(clapPrompt("people walking on a wooden floor")).toBe("people walking on a wooden floor");
  });
});
