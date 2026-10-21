# vid2grid

Turns a video into "collage sheets": grid images packing many timestamped
frames into one JPEG, sized for feeding into AI vision models. `apps/web/` is the
primary app: plain TypeScript and Vite, no framework, running entirely
client-side (`<video>`/`<canvas>`, WebCodecs, Web Workers, transformers.js).
No server, nothing uploaded. `python/` is a headless executor of the same
plan for use outside the browser.

## Commands (all run from the repo root of this npm workspaces monorepo)

| Command             | What it is                                                                     |
| ------------------- | ------------------------------------------------------------------------------ |
| `npm ci`            | Install. Root `node_modules` and `package-lock.json`; nothing per-package.     |
| `npm test`          | `vitest run` across every workspace. The correctness gate.                     |
| `npm run typecheck` | `tsc` over `src` and `tests` in each package. The **type-check gate**.         |
| `npm run lint`      | `eslint .` with typed rules; core may not import host packages or DOM globals. |
| `npm run build`     | Runs `typecheck`, then `vite build` for `apps/web/`.                           |
| `npm run format`    | `prettier --write .` from the root.                                            |
| `npm run dev`       | Vite dev server for `apps/web/`.                                               |
| `npm run fixtures`  | Regenerates `fixtures/render-plans/` from the planner.                         |
| `npm run bundle`    | Regenerates `python/src/vid2grid/_core.js`: core bundled for `python/`.        |

`npm test`, `npm run lint` and `npm run build` must all pass before a change is
done. CI also runs `npm run coverage --workspace packages/core`, which holds
core to its coverage thresholds.

The Python package is its own toolchain and does not go through npm: run its
checks from `python/`, per `python/README.md`.

| Package                  | What it is                                                                                                                                                                                                                                                                                                                                        |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `packages/core`          | `@vid2grid/core`, DOM-free pure logic. `tsconfig` sets `lib: ["ES2022"]` and `types: []` so any browser API is a compile error, and it must have no `dependencies` (enforced by `packages/core/tests/dependencies.test.ts`).                                                                                                                      |
| `packages/browser`       | `@vid2grid/browser`, the browser executor: core's ports implemented with `<video>`/`<canvas>`, WebCodecs + mp4box, an OffscreenCanvas worker pool, Web Audio and a transformers.js Whisper worker. Owns every browser-only dependency.                                                                                                            |
| `apps/web/`              | The Vite app: UI markup, wiring, state, download. It calls `generateCollages` from `@vid2grid/core` with the ports from `@vid2grid/browser`.                                                                                                                                                                                                      |
| `python/`                | `vid2grid`, the headless executor: core's own planner, bundled into `src/vid2grid/_core.js` and run through an embedded V8 (`mini-racer`), plus a PyAV/Pillow executor. `pip install`able and depending only on `av`, `Pillow` and `mini-racer`. No transcription.                                                                                |
| `fixtures/` + `scripts/` | `fixtures/render-plans/*.json` are golden `RenderPlan`s, written only by `scripts/generateRenderPlanFixtures.ts` (`npm run fixtures`) and read back by `packages/core/tests/renderPlanFixtures.test.ts` and by `python/tests/test_planner.py`, the Python package's conformance test. Generated and Prettier-ignored: nothing edits them by hand. |

## Rules a worker may not read elsewhere

- **Never bump `apps/web/package.json`'s `version`.** A bump landing on `main`
  triggers an automatic tagged release and Pages deploy. That is the
  maintainer's call, not part of a change. `apps/web/package.json` is still the
  release key; `packages/core/package.json`'s version is not
  release-triggering. (`CONTRIBUTING.md`.)
- **`main` is protected.** No direct pushes, from anyone. Every change lands
  via a PR that needs the `test` check green and a review from the code owner
  in `.github/CODEOWNERS` (@IanHeinrich).
- **Tests are typechecked through their own `tests/tsconfig.json`**, which
  extends the package's and adds `tests/`. Every package compiles with
  `noUncheckedIndexedAccess` and `exactOptionalPropertyTypes`: guard an index
  rather than assert it (lint bans `!`), and pass an optional property with a
  conditional spread rather than as `undefined`.
- **Tests live in `<package>/tests/<module>.test.ts`**, flat, named after the
  module under test, not beside the source. `packages/core/src/grid/gridMaths.ts`
  is covered by `packages/core/tests/gridMaths.test.ts`.
- **A core change carries its generated files.** Anything
  `buildRenderPlan` reaches under `packages/core/src/plan/`, plus
  `probe/videoInfo.ts` and the grid maths it uses, changes the
  `RenderPlan` contract, so the same PR carries the TypeScript and
  regenerated `fixtures/` (`npm run fixtures`). Any change to what
  `packages/core/src/embed.ts` reaches also reruns `npm run bundle`, which
  rewrites `python/src/vid2grid/_core.js`. CI diffs both, so either drifting
  fails it. `python/` runs that bundle, so it needs no matching edit.
  `docs/render-plan.md` is the contract's spec and moves with it.
- **All UI markup is in `apps/web/index.html`.** There are no framework templates;
  `apps/web/src/main.ts` wires that markup to the modules.
- **Style: names over comments.** A comment earns its place only for a
  non-obvious why (a platform quirk, a convention mismatch, a deliberate
  trade-off) and runs one or two lines. No JSDoc restating a signature,
  parameter list or return type; no prose narrating what the next lines do.
  Match the surrounding code rather than introducing a new idiom.
  (`CONTRIBUTING.md`.)

## Commit attribution

Commits are authored by the repository owner alone. Do not add
`Co-Authored-By` trailers, session links, or any other AI attribution to commit
messages or PR bodies. `.claude/settings.json` sets `includeCoAuthoredBy` to
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
will not load. Nothing in the build, test or CI path depends on them.
