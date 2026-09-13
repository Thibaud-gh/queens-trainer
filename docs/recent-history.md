# Importing history after January 6, 2026

The playable library combines the original `src/data/linkedin-puzzles.json`
with `src/data/linkedin-extra.json`. The original file remains unchanged so
legacy comparisons and profile-v2 seed links remain reproducible.

## Verified source

`https://linkedinzip.solutions/linkedin-queens-puzzle-<number>-answer/`
serves a complete solved board as SVG, including one colored rectangle per
cell. The importer reads those exact coordinates and colors; it does not
guess a region layout from queen positions or use image recognition.
Imported colors reflect the archive's SVG palette, which may differ from
LinkedIn's original display; region membership is what is cross-checked.

The importer checks the SVG's puzzle identity and dimensions, the displayed
date, complete cell coverage, exactly N connected regions, exactly one
solution, and agreement with the page's stated queen coordinates. It checks
overlapping puzzle numbers against the existing archive and rejects conflicts.
Historical reruns are retained by daily puzzle number and recorded as reruns,
rather than being discarded as duplicate geometry.

Each imported board records the source URL and SVG SHA-256. The import report
records full-page hashes, successes, failures, and rerun references. These are
third-party transcriptions with independently verified mathematical validity;
the checks do not by themselves prove official provenance. Existing-board and
second-source comparisons provide additional evidence.

The first sampled source pages #600 and #616 matched our original boards.
The #863 board also matched the structured `colorGrid` from
`https://www.linkedinpinpointanswer.today/linkedin-queens-answers/863`.
That second site does not have all January pages. The public JSON used by
`archivedqueens.com` currently stops at #353 and cannot fill this gap.

## Reproduce and extend

```sh
# First import: fetch missing cache files, verify overlap, then import newer boards.
npm run import:recent -- --from 600 --to 863 --fetch

# Re-validate the saved pages offline. No Playwright or browser installation needed.
npm run import:recent -- --from 600 --to 863

# Extend later, replacing the ending number with one verified as published.
npm run import:recent -- --from 864 --to 870 --fetch

# Compare original and newly imported historical distributions by size.
npm run analyze:history
```

Cache defaults to `/tmp/queens-history-cache`, output to
`src/data/linkedin-extra.json`, and report to `reports/history-import.json`.
Use `--cache`, `--out`, and `--report` to override. The script waits 600 ms
after network requests, caches successful page responses, and saves progress
after every puzzle. It exits nonzero if any puzzle fails. Inspect the report;
do not invent missing boards or silently replace an existing daily number.
For an outdated cached page, remove that one cache file before retrying.

## Recalibration

The expanded corpus now informs [profile-v3](generator-v3.md), with a deliberate
10% singleton-board target. The following command retains the earlier v2
expanded-training experiment for comparison. First compare eras
with `analyze:history`, since board-size and difficulty frequencies may shift.
Then run a distinct expanded-history experiment:

```sh
npm run benchmark -- --history expanded --count 30 --seeds recalibration-a,recalibration-b --out reports/recalibration.json
```

This passes expanded training profiles to the new generator and evaluates
against the expanded holdout. It is an experimental recalibration, not an
automatic change to the application's v2 generator. `--history original`
(the default) reproduces the previous benchmark.

Future production recalibrations should likewise have a new version and
fixed corpus. Do not update `historicalProfiles()` or its novelty reference in
place: either change could change an existing seed link's board.
