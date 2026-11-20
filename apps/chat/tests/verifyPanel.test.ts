import { describe, expect, it, vi } from "vitest";
import type { ClaimCheck } from "../src/types";
import { renderCheckProgress, renderVerification, verdictSummary } from "../src/ui/verifyPanel";

const CHECKS: ClaimCheck[] = [
  { claim: "A at [0:05].", seconds: [5], verdict: "confirmed", reason: "Seen." },
  { claim: "B at [0:10].", seconds: [10, 12.5], verdict: "contradicted", reason: "Not there." },
  { claim: "C at [0:20].", seconds: [20], verdict: "unclear", reason: "Too dark." },
];

describe("renderVerification", () => {
  it("marks each claim and links its times to the video", () => {
    const onSeek = vi.fn();
    const el = renderVerification(CHECKS, onSeek);
    const marks = [...el.querySelectorAll(".claim-mark")].map((mark) => mark.textContent);
    expect(marks).toEqual(["✓", "✗", "?"]);
    const times = [
      ...el.querySelectorAll<HTMLButtonElement>(".claim-check:nth-child(2) .timestamp"),
    ];
    expect(times.map((time) => time.textContent)).toEqual(["0:10", "0:12.5"]);
    times[1]?.click();
    expect(onSeek).toHaveBeenCalledWith(12.5);
    expect(el.querySelector(".claim-checks-heading")?.textContent).toBe(
      "Timestamp check: 1 confirmed, 1 contradicted, 1 unclear",
    );
  });

  it("says so when there was nothing to check", () => {
    expect(verdictSummary([])).toBe("");
    expect(renderVerification([], vi.fn()).textContent).toBe("No timestamps to check.");
  });
});

describe("renderCheckProgress", () => {
  it("counts the claims and stops on request", () => {
    const onStop = vi.fn();
    const el = renderCheckProgress(3, onStop);
    expect(el.textContent).toContain("Checking 3 claims against the video…");
    el.querySelector("button")?.click();
    expect(onStop).toHaveBeenCalled();
  });
});
