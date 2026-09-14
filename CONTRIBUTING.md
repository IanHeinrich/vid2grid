# Contributing to vid2grid

Contributions are welcome — bug reports, feature ideas, and PRs.

## Workflow

1. Fork the repo and create a branch off `main`.
2. Make your change in the package that owns it — pure logic in
   [packages/core/src](packages/core/src), the app in [web/src](web/src) —
   following the existing code style (plain TypeScript, no framework,
   self-documenting names over comments).
3. Add or update tests for behavioral changes in that package's flat `tests/`
   directory (see [packages/core/tests](packages/core/tests) and
   [web/tests](web/tests)) — then run `npm run format` and make sure `npm test` and `npm run build`
   both pass locally (all from the repo root; `npm run build` runs
   `npm run typecheck` first).
4. Open a PR against `main`.
5. **Don't bump `web/package.json`'s `version`** in your PR — that's reserved
   for maintainers, since a version bump landing on `main` triggers an
   automatic tagged release + Pages deploy.

For larger changes, consider opening an issue first to discuss the approach.

## Merge requirements

`main` is a protected branch — nobody, including maintainers, can push to it
directly. Every change lands via a pull request that must have:

- A passing `test` CI check (runs `npm test` from the repo root, from
  [.github/workflows/pages.yml](.github/workflows/pages.yml)).
- An approving review from the code owner defined in
  [.github/CODEOWNERS](.github/CODEOWNERS) (@IanHeinrich).
