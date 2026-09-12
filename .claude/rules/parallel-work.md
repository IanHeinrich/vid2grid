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
  `web/src/<area>/` directory — `extraction/`, `grid/`, `rendering/`,
  `transcription/`, `ui/` — plus the `web/tests/*.test.ts` files covering it,
  or `packages/core/src/` plus its `packages/core/tests/*.test.ts` files.
  Shared files no two workers may touch at once: `web/index.html` (all UI
  markup), `web/src/main.ts` (the wiring), `web/src/style.css`,
  `web/src/state.ts`, `web/src/types.ts`, `web/src/core.ts`,
  `web/package.json`, root `package.json`, root `package-lock.json`,
  `.prettierignore`, `.prettierrc.json`, `packages/core/package.json` and
  `packages/core/src/index.ts`. Route edits to those through the orchestrator.
- **Checks a worker runs, and checks it must not.** A worker runs only its own
  targeted tests: `npx vitest run tests/<module>.test.ts` from the owning
  package directory (`packages/core` or `web`). The whole-project runs —
  `npm test`, `npm run typecheck` and `npm run build`, which typecheck every
  source file including the ones other workers are still editing — belong to
  one verifier at the end. A build failing on a file the worker does not own
  is noise, not a finding. (`CLAUDE.md`, "Commands".)
- **Shell quirks.** npm commands now run from the repo root — there is a root
  `package.json` — not from `web/`. A brief must name the repo root as the
  working directory or the command fails with a misleading error.
