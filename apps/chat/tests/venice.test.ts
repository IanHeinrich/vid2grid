import { describe, expect, it } from "vitest";
import { VENICE_BASE_URL, isVenice } from "../src/api/venice";

describe("isVenice", () => {
  it("matches the Venice host only", () => {
    expect(isVenice(VENICE_BASE_URL)).toBe(true);
    expect(isVenice("https://api.venice.ai/api/v1/")).toBe(true);
    expect(isVenice("http://localhost:11434/v1")).toBe(false);
    expect(isVenice("https://example.com/api.venice.ai")).toBe(false);
    expect(isVenice("not a url")).toBe(false);
  });
});
