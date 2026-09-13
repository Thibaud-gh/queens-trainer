# Puzzle sources

**September 11 update:** newer solved SVG boards can now be imported from
`linkedinzip.solutions`, with overlap and solver verification. New boards live
in `linkedin-extra.json`; the original file stays frozen for v2. See
[recent-history.md](recent-history.md) and the generated import/distribution
reports for coverage. The earlier investigation below describes the original
608-board corpus and access limitations at that time.

Where the boards in `src/data/` come from, what was tried and did not work,
and how to add more. Research done on 2026-09-07.

## Copyright note

LinkedIn Queens boards are LinkedIn's copyrighted content. They are included
here only so that a player can practise past dailies privately; they are not
ours to relicense. If you publish a build of this trainer, keep the LinkedIn
library for personal use or replace it with generated/community boards.

## 1. LinkedIn archive (`src/data/linkedin-puzzles.json`)

**Source:** the git history of <https://github.com/samimsu/queens-game-linkedin>,
an open-source clone that shipped every LinkedIn daily board as a TypeScript
file `src/utils/levels/level<N>.ts` (N = LinkedIn puzzle number), together with
`src/utils/colors.ts` for the palette.

**What happened to it:** commit `c57c95a` ("Major Update", 2026-01-07) removed
the `levels` folder. Its parent, `c57c95a^`, is the last commit that still
contains the boards: **608 files for puzzles #1–#616**. Eight numbers are
absent from the repository (#4, #7, #9, #13, #14, #18, #19, #20, all in the
first three weeks); the reason is not recorded there.

**Extraction:** `scripts/import-linkedin-archive.ts` reproduces the whole
process: blobless clone, `git archive c57c95a^ src/utils/levels src/utils/colors.ts`,
parse each level file (size, letter grid, region → colour name), renumber
regions by first appearance, keep the original hex colours, validate (square,
N regions) and require exactly one solution. `npm run import:linkedin`
regenerates the JSON; `npm test` re-verifies that all 608 boards have exactly
one solution.

**Numbering → date:** puzzle #1 was published on **2024-05-01** and there has
been one puzzle per day since, so `date = 2024-05-01 + (N − 1) days`. The
anchor was checked against the commit dates of the level files in that
repository (boards were committed on the day they appeared; #616 → 2026-01-06,
the day before the folder was removed). The mapping is implemented in
`dateForNumber()` and covered by tests.

**Quirks worth knowing:**

- **#336 (2025-04-01)** is LinkedIn's April Fools board: two of its regions are
  deliberately disconnected. The importer keeps it (it still has a unique
  solution) and records the quirk in `attribution`; `validateRegions` reports
  it as invalid, so the UI/editor should treat "not connected" as a warning
  for library boards.
- 17 boards are re-runs of earlier ones, 15 of them in the stretch #474–#500
  (e.g. #60 = #483, #72 = #113, #87 = #499). They are identical under
  `symmetricCanonicalKey` but kept as separate entries because they are
  distinct daily puzzles with their own numbers and dates. (The text importer
  would skip them as duplicates; the LinkedIn importer deliberately does not
  de-duplicate.)
- Sizes: 7×7 (83 boards), 8×8 (219), 9×9 (200), 10×10 (74), 11×11 (32).

## 2. Other archives that were investigated

The user suggested <https://www.archivedqueens.com>. That and three similar
sites were candidate sources for the boards published after the samimsu
repository stopped tracking them:

| Site | Claim | Status from this sandbox |
| --- | --- | --- |
| <https://www.archivedqueens.com> | Archive of past LinkedIn Queens boards, playable | **Unreachable** (egress blocked) |
| <https://linkedinzip.solutions/archive/queens/> | Archive listing 641 boards with answers | **Unreachable** (egress blocked) |
| <https://www.playqueensgame.com/linkedin-queens-archive> | Titled "LinkedIn Queens archive", but understood to offer its own puzzles in the same style, **not** LinkedIn's boards | **Unreachable** (egress blocked) |
| <https://queensgame.vercel.app> | Playable Queens clone (the samimsu project's own deployment) | **Unreachable** (egress blocked) |

All four sites were blocked by the network policy of the environment this
project was built in, so none of them could be inspected, and no scraper could
be written or tested against them. The "claim" column repeats what the sites
advertise or what earlier research notes said; it has not been verified here.
No importer for them exists; the generic text importer below is the intended
path.

### How to add an archive as a source

1. Open a puzzle page in a browser and look at how the grid is represented:
   usually either an HTML table/grid of cells with a colour class per region,
   or an embedded JSON/JS array. Check the site's terms of use first.
2. Extract the grid into region labels — one letter per cell, row by row. A
   few lines of browser-console JavaScript typically suffice, e.g. map each
   cell's background colour to a letter in order of first appearance.
3. Write one block per puzzle in the text format understood by
   `scripts/import-text-puzzles.ts` (see [`scripts/README.md`](../scripts/README.md)):

   ```
   # LinkedIn Queens #617 | 2026-01-07 | 617
   AAABBBBB
   ...
   ```

   For LinkedIn dailies the date follows from the number
   (`2024-05-01 + (N − 1)` days), so either field can be filled from the other.
4. Run `npm run import:text -- <folder> --dry-run`, fix anything reported as
   rejected (non-square, wrong region count, disconnected, not uniquely
   solvable — usually a transcription slip), then run it again without
   `--dry-run`. Boards already in the library are skipped automatically, so
   overlapping archives can be imported freely.
5. If you automate the fetching, put the fetch + extraction in a new script
   under `scripts/` that writes the text format, and keep validation and
   de-duplication in `import-text-puzzles.ts` so all sources share one code path.

## 3. Coverage gap

The LinkedIn library stops at **#616 (2026-01-06)**. LinkedIn has kept
publishing one board per day, so as of 2026-09-07 (#860 by the numbering
formula) roughly **#617–#860, about 244 boards**, are missing. They can be
added with:

- the text importer above (from an archive site or from your own transcription
  of each day's board), or
- the in-app editor, which validates a board as you paint it; its share code
  or grid can be pasted into the text format above to add it to the library.

Imported boards land in `src/data/community-puzzles.json` with
`source: "community"`; use `--source linkedin --out src/data/linkedin-extra.json`
(or similar) if you want to keep officially transcribed LinkedIn boards apart.

## 4. Generated and custom puzzles

`src/core/generator.ts` produces fresh uniquely-solvable boards (seedable, so a
share link reproduces the exact board) and `scripts/generate-puzzles.ts` can
batch-generate a library graded by the deduction solver. These carry
`source: "generated"`. Boards made in the editor are `source: "custom"`.
