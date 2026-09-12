# vid2grid

A browser-only tool that turns a video into "collage sheets": grid images
packing many timestamped frames into one JPEG, sized for feeding into AI vision
models. Plain TypeScript and Vite, no framework. Everything runs client-side
(`<video>`/`<canvas>`, WebCodecs, Web Workers, transformers.js) — there is no
server and nothing is uploaded.

## Commands — all of them run from `web/`, never the repo root

| Command | What it is |
|---|---|
| `npm ci` | Install. `web/node_modules` is not checked in. |
| `npm test` | `vitest run`. The correctness gate. |
| `npm run build` | `tsc -b && vite build`. The `tsc -b` half is the **type-check gate**. |
| `npm run format` | `prettier --write .`. The format step. There is still no lint step. |
| `npm run dev` | Vite dev server. |

`npm test` and `npm run build` must both pass before a change is done.

## Rules a worker may not read elsewhere

- **Never bump `web/package.json`'s `version`.** A bump landing on `main`
  triggers an automatic tagged release and Pages deploy. That is the
  maintainer's call, not part of a change. (`CONTRIBUTING.md`.)
- **`main` is protected.** No direct pushes, from anyone. Every change lands
  via a PR that needs the `test` check green and a review from the code owner
  in `.github/CODEOWNERS` (@IanHeinrich).
- **`tsc -b` does not typecheck the tests.** `web/tsconfig.json`'s `include` is
  `["src", "vite.config.ts", "vitest.config.ts"]`, so `web/tests/` is only ever
  exercised by vitest. Do not assume a green build says anything about them.
- **Tests live in `web/tests/<module>.test.ts`**, flat, named after the module
  under test — not beside the source. `web/src/grid/gridMaths.ts` is covered by
  `web/tests/gridMaths.test.ts`.
- **All UI markup is in `web/index.html`.** There are no framework templates;
  `web/src/main.ts` wires that markup to the modules.
- **Style: self-documenting names over comments.** Match the surrounding code
  rather than introducing a new idiom. (`CONTRIBUTING.md`.)

## Commit attribution

Commits are authored by the repository owner alone. Do not add
`Co-Authored-By` trailers, session links, or any other AI attribution to commit
messages or PR bodies — `.claude/settings.json` sets `includeCoAuthoredBy` to
`false` and `.mailmap` is the backstop. Keep both in place.

## Claude Code plugins

`.claude/settings.json` enables the five `claude-toolkit` plugins (`lean`,
`guard`, `checks`, `verify`, `orchestrate`) and sets this repo's dials; see that
repo's `README.md` for what each does. `.claude/rules/parallel-work.md` is what a
subagent working beside others needs to know here.

The marketplace repo `IanHeinrich/claude-toolkit` is **private**, so a fork or an
outside contributor will see the marketplace fail to resolve and the plugins
simply will not load. Nothing in the build, test or CI path depends on them.
