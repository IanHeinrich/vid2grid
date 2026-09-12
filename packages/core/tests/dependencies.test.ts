import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const packageRoot = join(__dirname, "..");

function listFilesRecursively(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const entryPath = join(dir, entry);
    return statSync(entryPath).isDirectory() ? listFilesRecursively(entryPath) : [entryPath];
  });
}

function importSpecifiersIn(source: string): string[] {
  const specifiers: string[] = [];
  const patterns = [
    /\b(?:import|export)\b[^;]*?\bfrom\s+["']([^"']+)["']/g,
    /\bimport\s+["']([^"']+)["']/g,
    /\bimport\s*\(\s*["']([^"']+)["']\s*\)/g,
  ];
  for (const pattern of patterns) {
    for (const match of source.matchAll(pattern)) {
      specifiers.push(match[1]);
    }
  }
  return specifiers;
}

describe("@vid2grid/core package boundaries", () => {
  it("declares no runtime dependencies", () => {
    const packageJson = JSON.parse(readFileSync(join(packageRoot, "package.json"), "utf-8"));

    expect(packageJson.dependencies).toBeUndefined();
  });

  it("imports only relative specifiers within src", () => {
    const srcRoot = join(packageRoot, "src");
    const sourceFiles = listFilesRecursively(srcRoot);

    for (const file of sourceFiles) {
      const specifiers = importSpecifiersIn(readFileSync(file, "utf-8"));

      for (const specifier of specifiers) {
        expect(specifier.startsWith(".")).toBe(true);
      }
    }
  });
});
