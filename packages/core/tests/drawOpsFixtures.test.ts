import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { sheetDrawOps, type DrawOp } from "../src/render/drawOps";
import type { RenderPlan } from "../src/plan/renderPlan";
import { fixturesDir } from "./fixturePaths";

interface DrawOpsFixture {
  name: string;
  sheets: DrawOp[][];
}

function readJson<T>(path: string): T {
  return JSON.parse(readFileSync(path, "utf-8")) as T;
}

const jsonFiles = (kind: string): string[] =>
  readdirSync(fixturesDir(kind)).filter((name) => name.endsWith(".json"));
const fixtureFiles = jsonFiles("draw-ops");

describe("fixtures/draw-ops", () => {
  it("has one fixture per render plan", () => {
    expect(fixtureFiles.length).toBeGreaterThan(0);
    expect(fixtureFiles).toEqual(jsonFiles("render-plans"));
  });

  it.each(fixtureFiles)("%s matches sheetDrawOps over its plan's sheets", (fileName) => {
    const fixture = readJson<DrawOpsFixture>(join(fixturesDir("draw-ops"), fileName));
    const { plan } = readJson<{ plan: RenderPlan }>(join(fixturesDir("render-plans"), fileName));

    expect(fixture.name).toBe(fileName.replace(/\.json$/, ""));
    expect(plan.sheets.map((_, sheetIndex) => sheetDrawOps(plan, sheetIndex))).toStrictEqual(
      fixture.sheets,
    );
  });
});
