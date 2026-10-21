import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    // Every test here spawns ffprobe or ffmpeg, which a cold CI runner starts slowly.
    testTimeout: 30_000,
  },
});
