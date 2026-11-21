import { describe, expect, it } from "vitest";
import { latestCalls } from "../src/latest";

describe("latestCalls", () => {
  it("counts a call as the latest until another one starts", () => {
    const start = latestCalls();
    const first = start();
    expect(first()).toBe(true);
    const second = start();
    expect(first()).toBe(false);
    expect(second()).toBe(true);
  });

  it("keeps each set of calls apart", () => {
    const opens = latestCalls();
    const loads = latestCalls();
    const open = opens();
    loads();
    expect(open()).toBe(true);
  });
});
