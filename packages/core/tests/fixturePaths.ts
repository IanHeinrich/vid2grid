import { existsSync } from "node:fs";
import { dirname, join } from "node:path";

function findRepoRoot(): string {
  let dir = __dirname;
  for (;;) {
    if (existsSync(join(dir, "fixtures", "render-plans"))) return dir;
    const parent = dirname(dir);
    if (parent === dir) throw new Error("fixtures/ not found above the test file");
    dir = parent;
  }
}

export const repoRoot = findRepoRoot();

export function fixturesDir(kind: string): string {
  return join(repoRoot, "fixtures", kind);
}
