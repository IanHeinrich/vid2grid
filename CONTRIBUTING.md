# Contributing to vid2grid

Contributions are welcome — bug reports, feature ideas, and PRs.

## Workflow

1. Fork the repo and create a branch off `main`.
2. Make your change under `web/`, following the existing code style (see
   [web/src](web/src) — plain TypeScript, no framework, self-documenting
   names over comments).
3. Add or update tests for behavioral changes — see [web/tests](web/tests)
   — and make sure `npm test` and `npm run build` both pass locally
   (from `web/`).
4. Open a PR against `main`.
5. **Don't bump `web/package.json`'s `version`** in your PR — that's reserved
   for maintainers, since a version bump landing on `main` triggers an
   automatic tagged release + Pages deploy.

For larger changes, consider opening an issue first to discuss the approach.

## Merge requirements

`main` is a protected branch — nobody, including maintainers, can push to it
directly. Every change lands via a pull request that must have:

- A passing `test` CI check (runs `npm test` in `web/`, from
  [.github/workflows/pages.yml](.github/workflows/pages.yml)).
- An approving review from the code owner defined in
  [.github/CODEOWNERS](.github/CODEOWNERS) (@IanHeinrich).
