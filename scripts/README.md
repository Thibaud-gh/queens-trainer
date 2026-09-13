# Scripts

Command-line tooling for maintaining the puzzle library. Everything runs with
`tsx` (no build step) and imports the same core code as the app
(`src/core/puzzle.ts`, `src/core/solver.ts`), so a board that a script accepts
is guaranteed to load and solve in the UI.

| npm script | File | Purpose |
| --- | --- | --- |
| `npm run import:linkedin` | `import-linkedin-archive.ts` | Rebuild `src/data/linkedin-puzzles.json` from the samimsu/queens-game-linkedin git history |
| `npm run import:text` | `import-text-puzzles.ts` | Add puzzles from text or JSON files into `src/data/community-puzzles.json` |
| `npm run generate` | `generate-puzzles.ts` | Generate new uniquely-solvable boards with the built-in generator |
| `npm run import:recent` | `import-recent-queens.ts` | Fetch/cache solved SVG pages and validate/import newer daily boards without Playwright |
| `npm run analyze:history` | `analyze-history.ts` | Compare original and imported board distributions by size before recalibration |
| `npm run analyze` | `analyze-patterns.ts` | Region-shape and difficulty statistics over the LinkedIn archive; `--compare <n>` also generates boards and fails if their statistics drift from LinkedIn's |
| `npm run benchmark` | `benchmark-generators.ts` | Paired legacy/v2 comparison by size, with holdout profiles, full distribution distances, uncertainty, validity checks, and JSON/Markdown reports |

Extra arguments go after `--`, e.g. `npm run import:text -- boards/ --dry-run`.

Tests for the importers live next to them (`*.test.ts`) and run with
`npm test`; fixtures are in `fixtures/`.

## `import-linkedin-archive.ts`

```
npx tsx scripts/import-linkedin-archive.ts [--src <dir>] [--out <file>]
```

Without `--src` the script clones
<https://github.com/samimsu/queens-game-linkedin> (blobless clone, a few MB)
into a temp folder and extracts `src/utils/levels` and `src/utils/colors.ts`
from commit `c57c95a^`, the last commit that still shipped the level files.
Each `level<N>.ts` becomes a `Puzzle` with `id: li-<N>`, `number: N`,
`date` derived from `N` (#1 = 2024-05-01, one per day) and the original
LinkedIn colours. Boards that are not square, do not have N regions or do not
have exactly one solution are skipped and listed at the end. Disconnected
regions are tolerated (LinkedIn #336, the April Fools board, has them) and
flagged in `attribution`.

Use `--src` to point at an already extracted `src/utils` folder, e.g. when
working offline. See [`docs/sources.md`](../docs/sources.md) for provenance.

## `import-text-puzzles.ts`

A generic importer so puzzles from any source (another archive, a screenshot
you transcribed, the in-app editor's export) can be added to the library.

```
npx tsx scripts/import-text-puzzles.ts <file-or-dir> [...more] [options]

  --out <file>           output JSON (default src/data/community-puzzles.json)
  --source <name>        `source` field for imported puzzles (default community)
  --allow-disconnected   accept boards whose regions are not connected
  --dry-run              validate and report, but do not write
  --strict               exit with code 1 when any puzzle is rejected
```

Directories are scanned recursively for `.txt`, `.queens` and `.json` files
(in name order). Every board is:

1. parsed and renumbered so regions are `0..N-1` by first appearance;
2. validated: square, 4–16 cells wide, N regions, each orthogonally connected
   (unless `--allow-disconnected`);
3. solved: exactly one solution required;
4. de-duplicated by `symmetricCanonicalKey`, i.e. the same layout under any
   rotation, reflection or relabelling is considered the same puzzle — against
   `src/data/linkedin-puzzles.json`, against the existing output file and
   against earlier boards in the same run.

Survivors get a stable id (`<source>-<hash of the canonical layout>`) and are
appended to the output file, which is written one puzzle per line so diffs stay
readable. Running the importer twice on the same input is a no-op.

### Text format

Blocks separated by blank lines. A block may begin with a header line; every
other line is a row of the grid, one character per cell (letters, digits or
symbols). Cells may also be separated by spaces or commas, which allows
multi-character labels. Lines starting with `//` are comments.

```
# <name> | <date YYYY-MM-DD> | <number>     ← header, every field optional
AABBBCCC
ADBDBECC
...
```

Example (`scripts/fixtures/community-sample.txt` has more):

```
# LinkedIn Queens #617 | 2026-01-07 | 617
AAABBBBB
ACABBDBB
ACAAADBB
ACCCADDB
AEEEADDB
FFFEAGGB
FHHEAGGB
FFFFFFFB

# Just a name
1 1 2 2
3 3 2 2
3 4 4 2
3 4 4 4
```

(The 8×8 above is illustrative, not the real #617.)

### JSON format

A single object, an array of objects, or `{ "puzzles": [ ... ] }`. Each object
needs `regions` — either `number[][]` (region index per cell, as stored in
`src/data/*.json`) or `string[]` (one text row per entry, same syntax as the
text format) — and may carry `name`, `date`, `number`, `colors` (one hex per
region) and `attribution`. `Puzzle` objects exported from the app can be fed
back in unchanged; `id` and `source` are replaced.

```json
{
  "puzzles": [
    { "name": "Diagonal twist", "date": "2026-02-02", "regions": ["AAABB", "AAACC", "AAACC", "DEEEC", "DECCC"] },
    { "regions": [[0, 0, 1, 1], [2, 2, 1, 1], [2, 3, 3, 1], [2, 3, 3, 3]] }
  ]
}
```

### Typical session

```sh
# check what would happen
npm run import:text -- ~/queens/new-boards --dry-run
# import, fail CI-style if anything is malformed
npm run import:text -- ~/queens/new-boards --strict
# import into a separate file with a different source label
npm run import:text -- puzzles.json --out src/data/my-puzzles.json --source custom
```

## `generate-puzzles.ts` and `analyze-patterns.ts`

Both accept `--version legacy|profile-v2` (default `profile-v2`). For the stronger
comparison, run `npm run benchmark -- --count 50 --seeds a,b`. See
[`docs/generator-v2.md`](../docs/generator-v2.md) for the algorithms, reproducible
commands, benchmark interpretation, and difficulty/link behavior.
