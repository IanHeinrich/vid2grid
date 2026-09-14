# Parallel work in this repo

What a subagent working beside others must know that `CLAUDE.md` states for a
single pair of hands. Each line names where the full rule lives.

- **Singletons.** `npm run dev` is one Vite dev server per machine (port 5173).
  The orchestrator owns it; a worker that needs to see the app in a browser asks
  for the running URL rather than starting a second one.
- **Steps that run once, after the workers return.** `npm ci` and
  `npm run format` are root singletons. Two workers running either at once
  fight over root `node_modules/` and root `package-lock.json`, and a
  half-written lockfile fails CI's `npm ci`. A worker that needs a new
  dependency stops and reports; the orchestrator adds it and installs once.
  (`CLAUDE.md`, "Commands".)
- **Chunk boundaries that do not collide.** A worker can own one
  `web/src/ui/` directory plus the `web/tests/*.test.ts` files covering it,
  `packages/core/src/` plus its `packages/core/tests/*.test.ts` files, or one
  `packages/browser/src/<area>/` directory (`extraction/`, `rendering/` or
  `transcription/`) plus the `packages/browser/tests/*.test.ts` files
  covering it. Shared files no two workers may touch at once:
  `web/index.html` (all UI markup), `web/src/main.ts` (the wiring),
  `web/src/style.css`, `web/src/state.ts`, `web/package.json`, root
  `package.json`, root `package-lock.json`, `.prettierignore`,
  `.prettierrc.json`, `packages/core/package.json`,
  `packages/core/src/index.ts`, `packages/core/src/pipeline/ports.ts`,
  `packages/browser/package.json`, `packages/browser/src/index.ts`,
  `packages/core/src/plan/renderPlan.ts` (the contract types),
  `scripts/generateRenderPlanFixtures.ts` and `fixtures/render-plans/**`
  (generated: one worker regenerates them, via `npm run fixtures`).
  A worker can also own `python/src/vid2grid/` plus the
  `python/tests/test_*.py` files covering it, but
  `python/src/vid2grid/contract.py` and `python/src/vid2grid/planner.py`
  are **contract twins** of `packages/core/src/plan/`: they only move
  together with the TypeScript and the regenerated fixtures, so they
  belong to whoever owns that change and to no second worker at the same
  time. Route edits to any of these through the orchestrator.
- **Checks a worker runs, and checks it must not.** A worker runs only its own
  targeted tests: `npx vitest run tests/<module>.test.ts` from the owning
  package directory (`packages/core`, `packages/browser` or `web`), or
  `uv run pytest tests/test_<module>.py` from `python/`. The
  whole-project runs belong to one verifier at the end:
  `npm test`, `npm run typecheck` and `npm run build` typecheck every
  source file, including the ones other workers are still editing.
  A build failing on a file the worker does not own
  is noise, not a finding. (`CLAUDE.md`, "Commands".)
- **Shell quirks.** npm commands now run from the repo root, where there is a
  root `package.json`, not from `web/`; every Python command runs from
  `python/`. A brief must name the repo root as the
  working directory or the command fails with a misleading error.
