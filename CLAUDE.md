# vid2grid

A browser-only tool that turns a video into "collage sheets": grid images
packing many timestamped frames into one JPEG, sized for feeding into AI vision
models. Plain TypeScript and Vite, no framework. Everything runs client-side
(`<video>`/`<canvas>`, WebCodecs, Web Workers, transformers.js) — there is no
server and nothing is uploaded.

## Commands — all of them run from the repo root, an npm workspaces monorepo

| Command             | What it is                                                                        |
| ------------------- | --------------------------------------------------------------------------------- |
| `npm ci`            | Install. Root `node_modules` and `package-lock.json`; nothing per-package.        |
| `npm test`          | `vitest run` across every workspace. The correctness gate.                        |
| `npm run typecheck` | `tsc -b` in each package. The **type-check gate**; `npm run build` runs it first. |
| `npm run build`     | Runs `typecheck`, then `vite build` for `web/`.                                   |
| `npm run format`    | `prettier --write .` from the root. There is still no lint step.                  |
| `npm run dev`       | Vite dev server for `web/`.                                                       |

`npm test` and `npm run build` must both pass before a change is done.

| Package            | What it is                                                                                                                                                                                                                             |
| ------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `packages/core`    | `@vid2grid/core`, DOM-free pure logic. `tsconfig` sets `lib: ["ES2022"]` and `types: []` so any browser API is a compile error, and it must have no `dependencies` (enforced by `packages/core/tests/dependencies.test.ts`).           |
| `packages/browser` | `@vid2grid/browser`, the browser executor: core's ports implemented with `<video>`/`<canvas>`, WebCodecs + mp4box, an OffscreenCanvas worker pool, Web Audio and a transformers.js Whisper worker. Owns every browser-only dependency. |
| `web/`             | The Vite app: UI markup, wiring, state, download. It calls `generateCollages` from `@vid2grid/core` with the ports from `@vid2grid/browser`.                                                                                           |

## Rules a worker may not read elsewhere

- **Never bump `web/package.json`'s `version`.** A bump landing on `main`
  triggers an automatic tagged release and Pages deploy. That is the
  maintainer's call, not part of a change. `web/package.json` is still the
  release key; `packages/core/package.json`'s version is not
  release-triggering. (`CONTRIBUTING.md`.)
- **`main` is protected.** No direct pushes, from anyone. Every change lands
  via a PR that needs the `test` check green and a review from the code owner
  in `.github/CODEOWNERS` (@IanHeinrich).
- **`tsc -b` does not typecheck the tests.** Each package's `tsconfig.json`
  `include` is `["src"]` (plus `web/`'s `vite.config.ts`/`vitest.config.ts`),
  so `tests/` is only ever exercised by vitest in every package. Do not assume
  a green build says anything about them.
- **Tests live in `<package>/tests/<module>.test.ts`**, flat, named after the
  module under test — not beside the source. `packages/core/src/grid/gridMaths.ts`
  is covered by `packages/core/tests/gridMaths.test.ts`.
- **All UI markup is in `web/index.html`.** There are no framework templates;
  `web/src/main.ts` wires that markup to the modules.
- **Style: self-documenting names over comments.** Match the surrounding code
  rather than introducing a new idiom. (`CONTRIBUTING.md`.)

## Commit attribution

Commits are authored by the repository owner alone. Do not add
`Co-Authored-By` trailers, session links, or any other AI attribution to commit
messages or PR bodies — `.claude/settings.json` sets `includeCoAuthoredBy` to
`false` and `.mailmap` is the backstop. Keep both in place.

## How work gets done here

The main Claude Code session is a coordinator, not the implementer. It breaks a
change into chunks that touch disjoint files, briefs a cheaper subagent for each
(`orchestrate:implementer`, `lean:code-writer`, `Explore`, `lean:bulk-reader`),
runs the checks through `orchestrate:verifier`, reviews diffs with
`orchestrate:reviewer`, and keeps for itself only what cannot be briefed:
commits, PRs, decisions for the maintainer, and one-file edits cheaper to make
than to describe. Config scaffolding, file moves and multi-file edits are
implementation work and go to an agent. The `orchestrate` plugin's session hook
restates the mechanics; this section is the rule for anyone reading without
the plugins.

## Claude Code plugins

`.claude/settings.json` enables the five `claude-toolkit` plugins (`lean`,
`guard`, `checks`, `verify`, `orchestrate`) and sets this repo's dials; see that
repo's `README.md` for what each does. `.claude/rules/parallel-work.md` is what a
subagent working beside others needs to know here.

The marketplace repo `IanHeinrich/claude-toolkit` is **private**, so a fork or an
outside contributor will see the marketplace fail to resolve and the plugins
simply will not load. Nothing in the build, test or CI path depends on them.
