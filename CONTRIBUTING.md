# Contributing to vid2grid

Contributions are welcome — bug reports, feature ideas, and PRs.

This is an npm workspaces monorepo with four areas: [packages/core](packages/core)
(DOM-free pure logic and the `RenderPlan` planner), [packages/browser](packages/browser)
(the browser executor), [web](web) (the Vite app), and [python](python) (the
headless Python executor, its own toolchain outside npm).

## Workflow

1. Fork the repo and create a branch off `main`.
2. Make your change in the package that owns it, following the existing code
   style (plain TypeScript or Python, no framework, self-documenting names
   over comments).
3. Add or update tests for behavioral changes in that package's flat `tests/`
   directory (see [packages/core/tests](packages/core/tests) and
   [web/tests](web/tests)) — then run `npm run format` and make sure `npm test`
   and `npm run build` both pass locally (all from the repo root; `npm run build`
   runs `npm run typecheck` first).
4. A change under `packages/core/src/plan/` (or a helper it uses) changes the
   `RenderPlan` contract, so it isn't done until the same PR also runs
   `npm run fixtures` to regenerate `fixtures/render-plans/` and updates the
   matching planner logic in `python/src/vid2grid/planner.py` — see
   [docs/render-plan.md](docs/render-plan.md).
5. Open a PR against `main`.
6. **Don't bump `web/package.json`'s `version`** in your PR — that's reserved
   for maintainers, since a version bump landing on `main` triggers an
   automatic tagged release + Pages deploy.

For larger changes, consider opening an issue first to discuss the approach.

## Contributing to the Python package

From [python](python): `uv sync --all-groups && uv run pytest && uv run ruff
check . && uv run ruff format --check .` (or a venv: `pip install -e . pytest ruff`,
then `pytest`, `ruff check .` and `ruff format --check .`). All three must be clean
before opening a PR.
`python/tests/test_planner.py` checks the planner against the same
`fixtures/render-plans/` goldens as the TypeScript planner, so a planner
change must keep both in sync (see step 4 above).

## Merge requirements

`main` is a protected branch — nobody, including maintainers, can push to it
directly. Every change lands via a pull request that must have:

- A passing `test` CI check (runs `npm test` from the repo root, from
  [.github/workflows/pages.yml](.github/workflows/pages.yml)).
- An approving review from the code owner defined in
  [.github/CODEOWNERS](.github/CODEOWNERS) (@IanHeinrich).
