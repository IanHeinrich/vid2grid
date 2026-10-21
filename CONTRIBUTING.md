# Contributing to vid2grid

Contributions are welcome: bug reports, feature ideas, and PRs.

## Where things live

[packages/](packages) holds the internal building blocks:
[packages/core](packages/core), the DOM-free `RenderPlan` planner, and
[packages/browser](packages/browser), the browser executor. [apps/](apps)
holds every way to use vid2grid: the website, the Node.js library and CLI,
and the Python library, CLI and MCP server.
[docs/architecture.md](docs/architecture.md) is the map of how they fit
together.

The JavaScript parts are an npm workspaces monorepo run from the repo root. The
Python apps are uv projects, each checked from its own folder.

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
   `fixtures/draw-ops/` (a change to `render/drawOps.ts` moves the latter) and
   `npm run bundle` to regenerate `apps/python-library/src/vid2grid/_core.js`,
   the copy of core the Python library runs. CI fails if either is stale. The
   Python apps need no matching edit. See
   [docs/render-plan.md](docs/render-plan.md).
5. Open a PR against `main`.
6. **Don't bump `apps/web/package.json`'s `version`** in your PR. That's reserved
   for maintainers, since a version bump landing on `main` triggers an
   automatic tagged release + Pages deploy.

For larger changes, consider opening an issue first to discuss the approach.

## Contributing to the Python apps

[apps/python-library](apps/python-library), [apps/python-cli](apps/python-cli)
and [apps/mcp-server](apps/mcp-server) live outside npm. Run each one's checks
from its own folder:

```
uv sync --all-groups
uv run pytest
uv run ruff check .
uv run ruff format --check .
uv run mypy
```

All must be clean before opening a PR. The CLI and the MCP server use the
library in `../python-library` through `[tool.uv.sources]`, so a library change
shows up in them straight away.

The library plans by running core's own code, bundled into
`apps/python-library/src/vid2grid/_core.js` by `npm run bundle`, through an
embedded V8 (`mini-racer`), so there is no Python planner to keep in sync.
Never edit `_core.js` by hand. `apps/python-library/tests/test_planner.py` runs
every `fixtures/render-plans/` golden through that bundle (see step 4 above).

## Merge requirements

`main` is a protected branch: nobody, including maintainers, can push to it
directly. Every change lands via a pull request that must have:

- A passing `test` CI check (tests, typecheck, lint, core coverage and the
  fixtures and core bundle diffs from the repo root, from
  [.github/workflows/pages.yml](.github/workflows/pages.yml)).
- An approving review from the code owner defined in
  [.github/CODEOWNERS](.github/CODEOWNERS) (@IanHeinrich).

The same workflow also runs `python-library` (the library on Ubuntu, Windows
and macOS with Python 3.11 to 3.13), `python-apps` (the Python CLI and MCP
server) and `node` (both Node.js apps on Windows and macOS). They are not
required checks, but a PR should not break them.
