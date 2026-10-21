# Contributing to vid2grid

Contributions are welcome: bug reports, feature ideas, and PRs.

This is an npm workspaces monorepo with four areas: [packages/core](packages/core)
(DOM-free pure logic and the `RenderPlan` planner), [packages/browser](packages/browser)
(the browser executor), [apps/web](apps/web) (the Vite app), and [python](python) (the
headless Python executor, its own toolchain outside npm).

## Workflow

1. Fork the repo and create a branch off `main`.
2. Make your change in the package that owns it, following the existing code
   style (plain TypeScript or Python, no framework, self-documenting names
   over comments).
3. Add or update tests for behavioral changes in that package's flat `tests/`
   directory (see [packages/core/tests](packages/core/tests) and
   [apps/web/tests](apps/web/tests)). Then run `npm run format` and make sure
   `npm test`, `npm run lint` and `npm run build` all pass locally (all from
   the repo root; `npm run build` runs `npm run typecheck`, which covers the
   tests too).
4. A change under `packages/core/src/plan/` (or a helper it uses) changes the
   `RenderPlan` contract, so it isn't done until the same PR also runs
   `npm run fixtures` to regenerate `fixtures/render-plans/` and
   `npm run bundle` to regenerate `python/src/vid2grid/_core.js`, the copy of
   core the Python package runs. CI fails if either is stale. The Python
   package needs no matching edit. See
   [docs/render-plan.md](docs/render-plan.md).
5. Open a PR against `main`.
6. **Don't bump `apps/web/package.json`'s `version`** in your PR. That's reserved
   for maintainers, since a version bump landing on `main` triggers an
   automatic tagged release + Pages deploy.

For larger changes, consider opening an issue first to discuss the approach.

## Contributing to the Python package

Its toolchain lives outside npm and runs from [python](python).
[python/README.md](python/README.md) has the commands; pytest, both ruff
checks and mypy must be clean before opening a PR.
It plans by running core's own code, bundled into
`python/src/vid2grid/_core.js` by `npm run bundle`, through an embedded V8
(`mini-racer`), so there is no Python planner to keep in sync. Never edit
`_core.js` by hand. `python/tests/test_planner.py` runs every
`fixtures/render-plans/` golden through that bundle (see step 4 above).

## Merge requirements

`main` is a protected branch: nobody, including maintainers, can push to it
directly. Every change lands via a pull request that must have:

- A passing `test` CI check (tests, typecheck, lint, core coverage and the
  fixtures and core bundle diffs from the repo root, from
  [.github/workflows/pages.yml](.github/workflows/pages.yml)).
- A passing `python` CI check (pytest, ruff and mypy for `python/` across Ubuntu,
  Windows and macOS, from the same workflow).
- An approving review from the code owner defined in
  [.github/CODEOWNERS](.github/CODEOWNERS) (@IanHeinrich).
