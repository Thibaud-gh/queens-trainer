# Comparing the two generators

The app also offers [recalibrated v3](generator-v3.md), now selected by default.
This document records the preserved v2/original comparison. Their API equivalents are `version: 'profile-v2'`
(default) and `version: 'legacy'`.

`src/core/generator-legacy.ts` is a byte-for-byte copy of the pre-change
generator. SHA-256:
`1b899a21e99b78168c27ea25ef8b2ed9aa860565c29671a91ddb6b7294fd6f64`.
Keep it frozen. Golden tests record original boards at all five historical
sizes, in addition to the original generator test suite. Both algorithms use
the same reference solver and difficulty rater.

## Run a comparison

```sh
# Paired versions, 2 seed batches, 50 boards per size per batch per version.
# 1,000 boards total; allow several minutes, especially at 10–11.
npm run benchmark -- --count 50 --seeds benchmark-a,benchmark-b

# A smaller exploratory run (100 boards total).
npm run benchmark -- --count 10 --seeds quick --out reports/quick.json

# Generate separate libraries with the same size and seeds.
npm run generate -- --version legacy --size 9 --count 30 --seed comparison --out reports/legacy.json
npm run generate -- --version profile-v2 --size 9 --count 30 --seed comparison --out reports/profile-v2.json

# The original descriptive analysis also accepts a version.
npm run analyze -- --version legacy --compare 200 --examples 0
npm run analyze -- --version profile-v2 --compare 200 --examples 0
```

Benchmark JSON contains the configuration, every generated grid, failures,
timings, per-batch results, reference and generated feature distributions,
normalized distribution distances, and correlations. A companion Markdown
file summarizes results. The old `analyze` script's three loose tolerance
checks remain for compatibility; use `benchmark` for substantive comparison.
Regenerate the readable report without generating boards again with
`npm run benchmark -- --summarize reports/generator-benchmark.json`.
The default `--history original` preserves the original corpus. Use
`--history expanded` to experiment with newly imported history; see
[recent-history.md](recent-history.md). This overrides training profiles for
the experiment and does not change the app's frozen v2 corpus.

Optional benchmark flags: `--sizes 7,8,9`, `--candidates 12`, `--attempts 120`,
`--reference holdout|all`, `--out path.json`, and `--check`.
`--count` is **per size, per batch, per version**. The candidate setting affects
only profile-v2. An explicitly supplied attempt budget goes to both versions,
whose original attempt semantics differ. Without it, each uses its defaults.
`--check` fails on any v2 generation failure, duplicate, historical copy, or a statistically supported
aggregate regression in any size (lower bound of the bootstrap delta > 0).
A passing check is not proof that every feature matches.

## What profile-v2 changes

1. Sample a historical board's complete feature profile at the requested
   size. Retain joint ranked region areas/shapes, interior-region indicators,
   and difficulty. No source cell coordinates or queen solutions are used.
2. Assign intended interior regions to interior queens first. Reserve exact
   1/2/3-cell regions before large templates. If tiny carving cannot preserve
   its sampled size, reject that construction rather than shrinking it.
3. Carve shapes and grow regions. Thin regions may branch, and interior-region
   templates avoid the border. A 3×3 frame supports the smallest ring.
   Failed large templates keep their area targets when falling back to blob
   growth. Background growth initially respects its own area target before
   absorbing remaining pockets.
4. Repair uniqueness, preserving tiny recipients and preferring the sampled
   areas when solution counts tie. Strict moves protect rigid recipients as
   well as donors. Relaxation can still change larger rigid regions.
5. Collect up to a target of 12 distinct unique candidates, bounded by 120
   construction attempts. If difficulty has not matched, continue to the
   attempt cap. Select a candidate near the **sampled profile**, rather than
   making every board resemble the average. Difficulty matches take priority.
6. Reject exact historical copies under rotations/reflections. Return actual
   difficulty plus diagnostics in `puzzle.generation`: sampled target
   difficulty, whether it matched, construction attempts, candidate count,
   distance from the target, and whether relaxed construction was selected.

If no unique candidate exists after half the construction budget, broaden
proposals using the flexible style builder. Continue evaluating against the
same sampled profile; do not resample a more convenient target or silently
dispatch to legacy. This prevents difficult-to-realize profiles from causing
systematic failures. The benchmark records selected relaxed proposals and
target-difficulty misses. A unique relaxed candidate can still be replaced by
a better subsequent profile-guided candidate.

Profile distance includes ranked areas, all shape shares, singleton/domino/
tiny counts, interior regions, enclosures, branched snakes, and deduction
step counts. Its weights are explicit heuristics in `generator-profile.ts`.
Some properties remain soft targets: growth and repair may distort them.
The generator can still miss a requested difficulty, and if no unique board
is found within its attempt cap it reports an error. No silent switch to
legacy occurs for sizes 7–11. Sizes outside the historical 7–11 range retain
the original implementation for compatibility.

V2 is stateless: earlier generated puzzles cannot change seed replay. Batch
duplicates are measured by the benchmark instead of altering later outputs.
Legacy retains its original session-history behavior. Budgets, profile corpus,
and difficulty are part of reproducibility alongside the seed/version; keep
them fixed for comparisons. Treat future changes to the v2 algorithm or
default corpus as a version migration if existing seed links must remain exact.

## Benchmark interpretation

The archive excludes #336, leaving 607 boards. Daily reruns keep their daily
frequency, but a canonical layout and all its rotations/reflections always
belong to the same train/holdout split. A deterministic hash assigns roughly
20% to holdout. V2 receives only the other profiles during benchmarking.
The app uses the full archive. `--reference all` changes the evaluation set,
not the training set. The original generator's hard-coded quartiles were
already tuned on the full archive; its baseline cannot retrospectively be
made independent of the holdout without changing the old algorithm.

Each version gets identical size/seed schedules. Results are reported by
size, so different size mixes cannot disguise an error. Every successful
output is checked for valid connected regions and exactly one solution;
failures, duplicates, and historical copies are counted rather than dropped
silently. Feature summaries use each board as one observation.

Measured features include all ranked areas and shape frequencies; singleton,
domino and tiny counts; background frequency; border/interior structure;
enclosures, adjacency, symmetry, perimeter, branches and confinement;
difficulty categories; and deduction levels, step counts, advanced steps,
and steps before the first queen. Four correlations provide additional checks
on joint structure rather than marginal distributions alone.

Wasserstein-1 compares complete empirical distributions, including spread
and tails. Fixed natural scales put errors into comparable units. The overall
score averages those normalized errors; it is an engineering diagnostic,
not a calibrated measure of visual or human-solving similarity. Inspect
individual features even if that score improves.

The 95% interval comes from 200 paired bootstrap resamples of generated seeds
and independent resamples of reference boards, conditional on this one fixed
training split. It does not cover training-set or parameter-selection
uncertainty. Reruns in the reference are not independent puzzles, and the
11×11 holdout is just five daily boards: interpret its interval cautiously.
Multiple feature comparisons are exploratory, not corrected hypothesis tests.

## Difficulty and the Play-link fix

Difficulty labels are unchanged so old/new comparisons remain meaningful:

| Label | Highest required technique in this solver's chosen trace |
|---|---|
| Easy | Queen eliminations and singles (levels 1–2) |
| Medium | Confined-region/line deductions (level 3) |
| Hard | Hidden sets or a placement that immediately empties a group (levels 4–5) |
| Expert | Trial placement followed by contradiction, or not completed (level 6 / unsolved) |

These are solver-based categories, not measured human solving time. One trial
step can earn Expert while many difficult deductions still earn Hard. Any
samples a historical profile and its difficulty in v2; it is not a distinct
difficulty level. Bounded generation may return another rating, which the
preview now explicitly reports if a specific difficulty was requested.

Previously the preview respected Expert, but its Play/share link omitted
difficulty and regenerated with Any. New links include version and requested
difficulty: `#/gen/9/seed/profile-v2/expert`. Original unversioned links retain
`legacy`/`any` behavior. Route tests regenerate an Expert preview through its
link and check the exact board is preserved.

## Validation

The saved [evaluation report](../reports/generator-benchmark.md) compares 300
boards per version (60 per size, seeds `evaluation-a` and `evaluation-b`).
It was run after inspecting a separate development batch and fixing five
generation failures; this is an exploratory development holdout, not an
untouched final test set. Reproduce it with:

```sh
npm run benchmark -- --count 30 --seeds evaluation-a,evaluation-b --out reports/generator-benchmark.json
```

Both versions produced 300 valid, unique-solution puzzles with no generation
failures. V2 had no duplicate outputs or historical copies. Mean normalized
distribution error fell by 9.2%, 15.7%, 3.2%, 13.8%, and 11.2% for sizes 7–11,
respectively. Every bootstrap interval overlaps zero: do not interpret the
point estimates as statistically established superiority. Individual metrics
remain mixed, especially ring frequency. Two selected v2 boards used relaxed
construction, and one missed its sampled target difficulty. Mean generation
plus validity-check time rose from 5/12/46/138/274 ms to 44/165/439/830/1951 ms.

The original golden boards, v2 connectivity/uniqueness at all historical
sizes, stateless replay, custom training profiles, input budgets, route replay,
and benchmark distribution mathematics have automated coverage. The existing
scraper suite separately requires the missing `playwright` package; that
pre-existing dependency issue is outside the generator changes.
