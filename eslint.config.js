import eslint from "@eslint/js";
import tseslint from "typescript-eslint";

export default tseslint.config(
  {
    ignores: ["**/dist/", "**/node_modules/", "**/coverage/", "fixtures/", "python/", ".claude/"],
  },
  {
    files: [
      "packages/*/src/**/*.ts",
      "packages/*/tests/**/*.ts",
      "apps/web/src/**/*.ts",
      "apps/web/tests/**/*.ts",
      "scripts/**/*.ts",
    ],
    extends: [eslint.configs.recommended, ...tseslint.configs.recommendedTypeChecked],
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      "@typescript-eslint/no-floating-promises": "error",
      "@typescript-eslint/no-non-null-assertion": "error",
      "@typescript-eslint/consistent-type-imports": "error",
      "@typescript-eslint/switch-exhaustiveness-check": "error",
      "@typescript-eslint/no-explicit-any": "error",
      "max-lines-per-function": ["warn", { max: 60, skipBlankLines: true, skipComments: true }],
    },
  },
  {
    files: ["scripts/**/*.ts"],
    languageOptions: {
      parserOptions: {
        projectService: false,
        project: "./tsconfig.scripts.json",
      },
    },
  },
  {
    files: ["packages/core/src/**/*.ts", "packages/core/tests/**/*.ts"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: [
                "@vid2grid/browser",
                "@vid2grid/browser/*",
                "@vid2grid/node",
                "@vid2grid/node/*",
              ],
              message:
                "core is DOM-free and host-agnostic; hosts depend on core, never the reverse.",
            },
          ],
        },
      ],
      "no-restricted-globals": [
        "error",
        ...["window", "document", "navigator", "self"].map((name) => ({
          name,
          message: "core must not touch browser globals; go through a port.",
        })),
      ],
    },
  },
);
