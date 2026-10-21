import { describe, expect, it } from "vitest";
import { clamp, roundToTenth } from "../src/math";

describe("clamp", () => {
  it("keeps a value inside the bounds and pins one outside them", () => {
    expect(clamp(5, 0, 10)).toBe(5);
    expect(clamp(-1, 0, 10)).toBe(0);
    expect(clamp(11, 0, 10)).toBe(10);
  });

  it("lets the lower bound win when the bounds cross", () => {
    expect(clamp(5, 8, 6)).toBe(8);
  });
});

describe("roundToTenth", () => {
  it("rounds to one decimal place, halves up", () => {
    expect(roundToTenth(1.24)).toBe(1.2);
    expect(roundToTenth(1.25)).toBe(1.3);
    expect(roundToTenth(-1.25)).toBe(-1.2);
    expect(roundToTenth(3)).toBe(3);
  });
});
