# Queens Trainer

A web clone of LinkedIn's daily **Queens** puzzle, built for practice: replay
historical LinkedIn boards, generate endless new ones at a chosen difficulty,
get rule-based hints, and share any board by link. Vite + React + TypeScript,
no backend — everything runs in the browser and deploys as a static site.

## The rules

An N×N grid is divided into N coloured regions. Place N queens so that

- every **row** has exactly one queen,
- every **column** has exactly one queen,
- every **region** has exactly one queen,
- no two queens **touch**, not even diagonally.

Every board in the library has exactly one solution (verified by the test
suite) and is meant to be solvable by deduction alone.

## Features

- **Play** — tap once for an X, again for a queen; optional *auto-X* marks the
  cells a placed queen rules out; drag/swipe to mark several cells at once.
- **Undo / redo**, mistake highlighting, a timer, and a solved-state check.
- **Hints** — a deduction engine explains the next logical step instead of just
  revealing a cell.
- **Library** — 855 historical LinkedIn boards (through #863, September 10, 2026) with
  dates, numbers and source colours, plus any community boards you add.
- **Generator** — new uniquely-solvable boards, seedable and graded
  easy / medium / hard / expert by the deduction solver. [Recalibrated v3](docs/generator-v3.md)
  uses expanded history with a 10% singleton-board target; v2 and legacy remain available.
- **Editor / import** — paint your own board, paste a grid as text, or import
  puzzles in bulk with the CLI importer; boards are validated (N connected
  regions, unique solution).
- **Share links** — a compact URL-safe code (`8:0011...`) reproduces any board.

## Getting started

Requires Node 22 (see `.github/workflows/ci.yml`).

```sh
npm install
npm run dev        # http://localhost:5173
npm test           # vitest: core engine + importer tests
npm run typecheck  # tsc -b
npm run lint       # oxlint
npm run build      # production build in dist/
npm run preview    # serve dist/ locally
```

## Scripts

Library maintenance tools, run with `tsx` (no build step). Pass arguments
after `--`. Details, formats and examples: [`scripts/README.md`](scripts/README.md).

| Command | What it does |
| --- | --- |
| `npm run import:linkedin` | Rebuild `src/data/linkedin-puzzles.json` from the samimsu/queens-game-linkedin git history (see [`docs/sources.md`](docs/sources.md)) |
| `npm run import:text -- <file-or-dir>` | Import puzzles from simple text grids or JSON, validate, de-duplicate, merge into `src/data/community-puzzles.json` |
| `npm run generate` | Generate new uniquely-solvable boards with difficulty ratings |
| `npm run import:recent` | Import validated newer LinkedIn boards from solved SVG pages; see [recent history](docs/recent-history.md) |
| `npm run analyze:history` | Compare the original and newly imported historical distributions |
| `npm run benchmark` | Compare frozen legacy and profile-v2 generators by size against historical distributions; see [generator documentation](docs/generator-v2.md) |
| `npm run analyze` | Region-shape and difficulty statistics over the LinkedIn archive; `--compare` checks the generator's output against them |

Adding boards from another source is a matter of writing them as text, one
character per cell:

```
# LinkedIn Queens #617 | 2026-01-07 | 617
AAABBBBB
ACABBDBB
...
```

then `npm run import:text -- my-boards/`. See `docs/sources.md` for where the
current boards come from, which archives were investigated, and the coverage
gap (LinkedIn #617 onward).

## Project layout

```
src/
  app/          React UI: board, controls, library, editor, share links
  core/         Pure TypeScript engine, no DOM
    types.ts      Puzzle / Board / Solution types
    puzzle.ts     validation, text ↔ regions, encode/decode, symmetry keys, rule checks
    solver.ts     backtracking solver (uniqueness check, solution enumeration)
    deduction.ts  human-style deduction steps used for hints and difficulty
    generator.ts  seeded puzzle generator
    patterns.ts   region-shape classification (analysis + generator style targets)
    random.ts     seedable PRNG
    *.test.ts     vitest unit tests
  data/
    linkedin-puzzles.json    frozen original 608 boards #1–#616
    linkedin-extra.json      247 verified later boards #617–#863
    archive.ts               combined playable history
    community-puzzles.json   boards added with import:text (created on first import)
scripts/        CLI tools (importers, generator, analysis) + fixtures and tests
docs/sources.md provenance of the puzzle data
public/         static assets
.github/workflows/
  ci.yml        typecheck, lint, test, build on every push and PR
  deploy.yml    build and publish dist/ to GitHub Pages on push to main
```

## Deployment (GitHub Pages)

`vite.config.ts` uses `base: './'`, so the built site works from any sub-path.
`.github/workflows/deploy.yml` builds `dist/` and publishes it with
`actions/configure-pages`, `actions/upload-pages-artifact` and
`actions/deploy-pages` on every push to `main`. One-time setup in the GitHub
repository: *Settings → Pages → Build and deployment → Source: GitHub Actions*.

After the first successful deployment, the public URL is:

```text
https://<github-user>.github.io/<repository>/
```

The deployed game is entirely static. Visitors do not need an account or an
installation, and their settings, custom puzzles, and game progress stay in
their own browser's local storage. Sharing a generated-game URL reproduces
that puzzle, but does not synchronize live play between browsers.

The regular test command excludes the old Playwright-based archive scraper,
which is development tooling and is not part of the website. To run that
optional integration test, install Playwright and its Chromium browser, then
run `npm run test:scraper`.
The site then appears at `https://<user>.github.io/<repo>/`.

## Data and licensing

The LinkedIn boards are LinkedIn's copyrighted content, included for personal
practice; see [`docs/sources.md`](docs/sources.md). The code in this repository
is the project's own.
