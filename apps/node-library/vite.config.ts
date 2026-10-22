import { defineConfig } from "vite";

// Node cannot resolve core's extensionless TypeScript imports, so core is bundled in;
// the packages carrying native binaries stay external and resolve from node_modules.
export default defineConfig({
  build: {
    ssr: true,
    target: "node20",
    outDir: "dist",
    emptyOutDir: true,
    lib: {
      entry: { index: "src/index.ts" },
      formats: ["es"],
    },
  },
  ssr: {
    noExternal: ["@vid2grid/core"],
  },
});
