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
      entry: { index: "src/index.ts", cli: "src/cli.ts" },
      formats: ["es"],
    },
    rollupOptions: {
      output: {
        banner: (chunk) => (chunk.name === "cli" ? "#!/usr/bin/env node" : ""),
      },
    },
  },
  ssr: {
    noExternal: ["@vid2grid/core"],
  },
});
