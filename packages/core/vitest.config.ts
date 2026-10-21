import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    coverage: {
      provider: "v8",
      include: ["src/**"],
      thresholds: {
        lines: 90,
        functions: 85,
        branches: 88,
        statements: 90,
      },
    },
  },
});
