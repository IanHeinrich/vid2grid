import { defineConfig } from "vite";

// Vite bundles linked workspace packages by default: core is wanted inline, as in the
// library, but the library itself stays external so the CLI runs its built dist/.
export default defineConfig({
  build: {
    ssr: true,
    target: "node20",
    outDir: "dist",
    emptyOutDir: true,
    lib: {
      entry: { cli: "src/cli.ts" },
      formats: ["es"],
    },
    rollupOptions: {
      output: { banner: "#!/usr/bin/env node" },
    },
  },
  ssr: {
    noExternal: ["@vid2grid/core"],
    external: ["@vid2grid/node"],
  },
});
