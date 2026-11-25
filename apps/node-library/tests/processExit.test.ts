import { Vid2GridError } from "@vid2grid/core";
import { describe, expect, it } from "vitest";
import { exitFailure, isCrash } from "../src/processExit";

function crashes(code: number | null, signal: NodeJS.Signals | null): boolean {
  const cause = exitFailure("ffmpeg", code, signal);
  return isCrash(new Vid2GridError("internal", "failed", { cause }));
}

describe("exitFailure", () => {
  it("is nothing for a clean exit", () => {
    expect(exitFailure("ffmpeg", 0, null)).toBeUndefined();
  });

  it("names the code or the signal", () => {
    expect(exitFailure("ffmpeg", 1, null)?.message).toBe("ffmpeg exited with code 1");
    expect(exitFailure("ffprobe", null, "SIGTERM")?.message).toBe("ffprobe was killed by SIGTERM");
  });
});

describe("isCrash", () => {
  it.each(["SIGSEGV", "SIGBUS", "SIGILL", "SIGFPE", "SIGABRT", "SIGTRAP"] as const)(
    "takes %s as a crash",
    (signal) => {
      expect(crashes(null, signal)).toBe(true);
    },
  );

  it.each(["SIGKILL", "SIGTERM", "SIGINT"] as const)("takes %s as sent on purpose", (signal) => {
    expect(crashes(null, signal)).toBe(false);
  });

  it.each([0xc0000005, 0xc00000fd, 0xc0000374, 0xc0000409])(
    "takes Windows exit code %d as a crash",
    (code) => {
      expect(crashes(code, null)).toBe(true);
    },
  );

  // The last two are ffmpeg's AVERROR(EINVAL) and AVERROR_INVALIDDATA as Windows reports them.
  it.each([1, 69, 0xc000013a, 0xc0000135, 4294967274, 3199971767])(
    "takes exit code %d as an ordinary failure",
    (code) => {
      expect(crashes(code, null)).toBe(false);
    },
  );

  it("looks only at an error's cause", () => {
    expect(isCrash(exitFailure("ffmpeg", null, "SIGSEGV"))).toBe(false);
    expect(isCrash(undefined)).toBe(false);
  });
});
