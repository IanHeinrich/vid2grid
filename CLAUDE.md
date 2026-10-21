# vid2grid

Turns a video into "collage sheets": grid images packing many timestamped
frames into one JPEG, sized for feeding into AI vision models. One DOM-free
planner in `packages/core` decides everything; executors for the browser,
Node.js and Python only move pixels. Ways in: the website, a Python library,
CLI and MCP server, and a Node.js library and CLI. `docs/architecture.md` is
the map.

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
| `npm run fixtures`  | Regenerates `fixtures/render-plans/` and `fixtures/draw-ops/` from core.       |
| `npm run bundle`    | Regenerates `apps/python-library/src/vid2grid/_core.js`: core for Python.      |

`npm test`, `npm run lint` and `npm run build` must all pass before a change is
done. CI also runs `npm run coverage --workspace packages/core`, which holds
core to its coverage thresholds.

The root workspaces are `packages/*`, `apps/web`, `apps/node-library` and
`apps/node-cli`. The three Python apps are not npm workspaces: each is its own
uv project, checked from its own folder with `uv sync --all-groups`,
`uv run pytest`, `uv run ruff check .`, `uv run ruff format --check .` and
`uv run mypy`.

| Folder                   | What it is                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `packages/core`          | `@vid2grid/core`, the DOM-free planner. `tsconfig` sets `lib: ["ES2022"]` and `types: []` so any browser API is a compile error, and it must have no `dependencies` (enforced by `packages/core/tests/dependencies.test.ts`).                                                                                                                                                                                                                                             |
| `packages/browser`       | `@vid2grid/browser`, the browser executor: core's ports with `<video>`/`<canvas>`, WebCodecs + mp4box, an OffscreenCanvas worker pool, Web Audio and a transformers.js Whisper worker. Owns every browser-only dependency.                                                                                                                                                                                                                                                |
| `apps/web`               | The Vite website: plain TypeScript, no framework, entirely client-side, nothing uploaded. UI markup, wiring, state, download. Calls `generateCollages` from core with the browser ports. Its `package.json` version is the release key.                                                                                                                                                                                                                                   |
| `apps/node-library`      | `@vid2grid/node`, the Node.js executor: ffprobe/ffmpeg and `@napi-rs/canvas`, core bundled into `dist/`. `tests/conformance.test.ts` holds it to the draw-op and frame goldens. No transcription.                                                                                                                                                                                                                                                                         |
| `apps/node-cli`          | `@vid2grid/node-cli`, the `vid2grid-node` command, flags from `OPTION_SPECS`. Vite inlines core and keeps `@vid2grid/node` external, so build the library before running it.                                                                                                                                                                                                                                                                                              |
| `apps/python-library`    | `vid2grid`, the Python executor: PyAV and Pillow, with core bundled into `src/vid2grid/_core.js` and run in `mini-racer`. The `transcribe` extra adds faster-whisper. `options.py` has `plan_from_options` and `render_from_options`, which the Python CLI and MCP server share.                                                                                                                                                                                          |
| `apps/python-cli`        | `vid2grid-cli`, module `vid2grid_cli`, the `vid2grid` command.                                                                                                                                                                                                                                                                                                                                                                                                            |
| `apps/mcp-server`        | `vid2grid-mcp`, module `vid2grid_mcp`, an MCP server.                                                                                                                                                                                                                                                                                                                                                                                                                     |
| `fixtures/` + `scripts/` | Goldens. `scripts/generateRenderPlanFixtures.ts` (`npm run fixtures`) alone writes `fixtures/render-plans/` and `fixtures/draw-ops/`; generated and Prettier-ignored. `scripts/recordFrameFixtures.py` records `fixtures/frames/` over `fixtures/videos/` (the second video is made by `scripts/makeKeyframeVideo.py`). Read by core's fixture tests, the Node conformance test and the Python planner and conformance tests. A new host follows `docs/adding-a-host.md`. |

`apps/python-cli` and `apps/mcp-server` depend on `vid2grid` by a git
reference, and `[tool.uv.sources]` points it at `../python-library`, so local
work and `uvx --from git+...` both use the library from the same commit.

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
  regenerated `fixtures/` (`npm run fixtures`). So does anything
  `packages/core/src/render/drawOps.ts` reaches, which moves
  `fixtures/draw-ops/`. Any change to what
  `packages/core/src/embed.ts` reaches also reruns `npm run bundle`, which
  rewrites `apps/python-library/src/vid2grid/_core.js`. CI diffs both, so
  either drifting fails it. The Python apps run that bundle, so they need no
  matching edit.
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
