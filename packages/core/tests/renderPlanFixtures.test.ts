import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { buildRenderPlan } from "../src/plan/buildRenderPlan";
import type { RenderPlan } from "../src/plan/renderPlan";
import type { CollagePlanRequest } from "../src/plan/request";
import type { VideoInfo } from "../src/probe/videoInfo";
import { fixturesDir } from "./fixturePaths";

interface Fixture {
  name: string;
  request: CollagePlanRequest;
  info: VideoInfo;
  plan: RenderPlan;
}

// The same fixtures the Python planner is tested against, so both ports of
// buildRenderPlan are pinned to one set of numbers.
const renderPlansDir = fixturesDir("render-plans");
const fixtureFiles = readdirSync(renderPlansDir).filter((name) => name.endsWith(".json"));

describe("fixtures/render-plans", () => {
  it("has fixtures to check", () => {
    expect(fixtureFiles.length).toBeGreaterThan(0);
  });

  it.each(fixtureFiles)("%s matches buildRenderPlan", (fileName) => {
    const fixture = JSON.parse(readFileSync(join(renderPlansDir, fileName), "utf-8")) as Fixture;

    expect(fixture.name).toBe(fileName.replace(/\.json$/, ""));
    expect(buildRenderPlan(fixture.request, fixture.info)).toStrictEqual(fixture.plan);
  });
});
