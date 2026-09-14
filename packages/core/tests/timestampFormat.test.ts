import { describe, expect, it } from "vitest";
import { chooseTimestampFormat, formatTimestamp } from "../src/render/timestampFormat";

describe("chooseTimestampFormat", () => {
  it("shows minutes from 60s and hours from 3600s, not a moment before", () => {
    expect(chooseTimestampFormat(59.999, 1)).toMatchObject({
      showHours: false,
      showMinutes: false,
    });
    expect(chooseTimestampFormat(60, 1)).toMatchObject({ showHours: false, showMinutes: true });
    expect(chooseTimestampFormat(3599.999, 1)).toMatchObject({
      showHours: false,
      showMinutes: true,
    });
    expect(chooseTimestampFormat(3600, 1)).toMatchObject({ showHours: true, showMinutes: true });
  });

  it("shows milliseconds only above 1 frame per second", () => {
    expect(chooseTimestampFormat(10, 1).showMilliseconds).toBe(false);
    expect(chooseTimestampFormat(10, 0.5).showMilliseconds).toBe(false);
    expect(chooseTimestampFormat(10, 1.0001).showMilliseconds).toBe(true);
    expect(chooseTimestampFormat(10, 2).showMilliseconds).toBe(true);
  });

  it("drops every component when there is no last timestamp", () => {
    expect(chooseTimestampFormat(undefined, 30)).toEqual({
      showHours: false,
      showMinutes: false,
      showMilliseconds: false,
    });
  });
});

describe("formatTimestamp", () => {
  it("renders each chosen combination of components", () => {
    expect(formatTimestamp(2.5, chooseTimestampFormat(2.5, 2))).toBe("02.500");
    expect(formatTimestamp(2.5, chooseTimestampFormat(2.5, 1))).toBe("02");
    expect(formatTimestamp(95.25, chooseTimestampFormat(95.25, 2))).toBe("01:35.250");
    expect(formatTimestamp(3725.5, chooseTimestampFormat(3725.5, 0.5))).toBe("01:02:05");
  });
});
