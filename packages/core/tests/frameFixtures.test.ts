import { describe, expect, it } from "vitest";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { buildRenderPlan } from "../src/plan/buildRenderPlan";
import type { CollagePlanRequest } from "../src/plan/request";
import type { VideoInfo } from "../src/probe/videoInfo";
import { fixturesDir, repoRoot } from "./fixturePaths";

interface FrameFixture {
  name: string;
  video: string;
  request: CollagePlanRequest;
  info: VideoInfo;
  sourceFrameSeconds: number[];
  frames: { frameIndex: number; plannedSeconds: number; decodedSeconds: number }[];
}

const framesDir = fixturesDir("frames");
const fixtureFiles = readdirSync(framesDir).filter((name) => name.endsWith(".json"));

function readFixture(fileName: string): FrameFixture {
  return JSON.parse(readFileSync(join(framesDir, fileName), "utf-8")) as FrameFixture;
}

// The source frame times come from a plain decode by scripts/recordFrameFixtures.py; here
// core's plan and the pick rule are checked against them, so neither can drift from the goldens.
describe("fixtures/frames", () => {
  it("has fixtures to check", () => {
    expect(fixtureFiles.length).toBeGreaterThan(0);
  });

  it.each(fixtureFiles)("%s plans the times it records", (fileName) => {
    const fixture = readFixture(fileName);
    const plan = buildRenderPlan(fixture.request, fixture.info);

    expect(fixture.name).toBe(fileName.replace(/\.json$/, ""));
    expect(existsSync(join(repoRoot, fixture.video))).toBe(true);
    expect(
      fixture.frames.map(({ frameIndex, plannedSeconds }) => [frameIndex, plannedSeconds]),
    ).toEqual(
      plan.frames.map(({ frameIndex, timestampSeconds }) => [frameIndex, timestampSeconds]),
    );
  });

  it.each(fixtureFiles)("%s lists its source frame times in order", (fileName) => {
    const { sourceFrameSeconds } = readFixture(fileName);
    expect(sourceFrameSeconds.length).toBeGreaterThan(0);
    expect(sourceFrameSeconds).toEqual([...new Set(sourceFrameSeconds)].sort((a, b) => a - b));
  });

  it.each(fixtureFiles)("%s picks the first source frame at or after each time", (fileName) => {
    const { sourceFrameSeconds, frames } = readFixture(fileName);
    for (const { plannedSeconds, decodedSeconds } of frames) {
      const firstAtOrAfter = sourceFrameSeconds.find((seconds) => seconds >= plannedSeconds);
      expect(decodedSeconds).toBe(firstAtOrAfter);
    }
  });
});
