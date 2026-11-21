import eslint from "@eslint/js";
import tseslint from "typescript-eslint";

export default tseslint.config(
  {
    ignores: [
      "**/dist/",
      "**/node_modules/",
      "**/coverage/",
      "fixtures/",
      "apps/python-library/",
      "apps/python-cli/",
      "apps/mcp-server/",
      ".claude/",
    ],
  },
  {
    files: [
      "packages/*/src/**/*.ts",
      "packages/*/tests/**/*.ts",
      "apps/web/src/**/*.ts",
      "apps/web/tests/**/*.ts",
      "apps/chat/src/**/*.ts",
      "apps/chat/tests/**/*.ts",
      "apps/node-library/src/**/*.ts",
      "apps/node-library/tests/**/*.ts",
      "apps/node-cli/src/**/*.ts",
      "apps/node-cli/tests/**/*.ts",
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
    files: ["**/tests/**/*.ts"],
    rules: {
      "max-lines-per-function": "off",
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
  {
    files: ["apps/chat/src/api/**/*.ts"],
    rules: {
      "@typescript-eslint/no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: ["**/chat/**", "**/video/**", "**/audio/**", "**/app/**", "**/ui/**"],
              message: "api is the provider layer; it imports only utilities.",
            },
          ],
        },
      ],
    },
  },
  {
    files: [
      "apps/chat/src/chat/**/*.ts",
      "apps/chat/src/video/**/*.ts",
      "apps/chat/src/audio/**/*.ts",
    ],
    rules: {
      "@typescript-eslint/no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: ["**/app/**", "**/ui/**"],
              message: "chat, video and audio are domain layers; app and ui depend on them.",
            },
          ],
        },
      ],
    },
  },
  {
    files: ["apps/chat/src/app/**/*.ts"],
    rules: {
      "@typescript-eslint/no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: ["**/ui/**"],
              // Use cases take UI components as typed dependencies; only runtime imports are banned.
              allowTypeImports: true,
              message: "app may describe ui components by type but not import ui code.",
            },
          ],
        },
      ],
    },
  },
);
