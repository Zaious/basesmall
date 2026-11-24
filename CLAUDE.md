# CLAUDE.md: build, test and code style

For coding agents and people working on this repository. What the project accepts and why is in [CONTRIBUTING.md](CONTRIBUTING.md).

## Build and test

```bash
npm ci
npm test
npm run typecheck
npm run tauri dev
```

You need Node 24 (`.nvmrc`) and Rust 1.80 or later. `node scripts/probe/07-fixtures.mjs` records a few finished games into `fixtures/mlb/` (git-ignored, never committed) so the full test suite runs. `src/` imports with the `.ts` extension and uses no parameter properties, so Node 24 runs the source directly, e.g. `node scripts/m1-report.ts`.

## Code style

- Code, identifiers and commit messages are in English.
- The drawing side never reads MLB's JSON: league data becomes the model in `src/model/types.ts` first (`src/data/mlb/`).
- Tests compare against MLB's own numbers (line score, box score), as `tests/timeline.test.ts` does.
- One request to the data source at a time, with backoff on errors.
- Every feature has a switch and a sensible default.
- UI strings live in `src/i18n/index.ts`, in English and Traditional Chinese.
- Documents in `docs/` are in Traditional Chinese; `README.md`, `CONTRIBUTING.md` and `styles/README.md` are in English.
