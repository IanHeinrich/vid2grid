import { describe, expect, it } from "vitest";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { buildRenderPlan } from "../src/plan/buildRenderPlan";
import type { RenderPlan } from "../src/plan/renderPlan";
import type { CollagePlanRequest, VideoInfo } from "../src/types";

interface Fixture {
  name: string;
  request: CollagePlanRequest;
  info: VideoInfo;
  plan: RenderPlan;
}

// The same fixtures the Python planner is tested against, so both ports of
// buildRenderPlan are pinned to one set of numbers.
function findFixturesDir(): string {
  let dir = __dirname;
  for (;;) {
    const candidate = join(dir, "fixtures", "render-plans");
    if (existsSync(candidate)) return candidate;
    const parent = dirname(dir);
    if (parent === dir) throw new Error("fixtures/render-plans not found above the test file");
    dir = parent;
  }
}

const fixturesDir = findFixturesDir();
const fixtureFiles = readdirSync(fixturesDir).filter((name) => name.endsWith(".json"));

describe("fixtures/render-plans", () => {
  it("has fixtures to check", () => {
    expect(fixtureFiles.length).toBeGreaterThan(0);
  });

  it.each(fixtureFiles)("%s matches buildRenderPlan", (fileName) => {
    const fixture: Fixture = JSON.parse(readFileSync(join(fixturesDir, fileName), "utf-8"));

    expect(fixture.name).toBe(fileName.replace(/\.json$/, ""));
    expect(buildRenderPlan(fixture.request, fixture.info)).toStrictEqual(fixture.plan);
  });
});
