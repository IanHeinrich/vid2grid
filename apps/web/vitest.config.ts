import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "jsdom",
    setupFiles: [fileURLToPath(new URL("./tests/support/setup.ts", import.meta.url))],
  },
});
