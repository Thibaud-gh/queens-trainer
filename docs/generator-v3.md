# Recalibration with rare single-cell regions

The app and generation CLI default to `profile-v3`. The original `legacy` and
`profile-v2` remain selectable. Existing links and v2 golden outputs are unchanged.
For compatibility, calling the core API without a version still means v2;
new callers should pass `version: 'profile-v3'` explicitly.

V3 freezes the expanded archive through puzzle #863 (September 10, 2026):
854 training profiles, excluding the disconnected April Fools #336. Daily
reruns retain their historical frequency. The new 247 boards cover sizes
7–9; sizes 10–11 still use their original historical samples.

For each seed, v3 first selects whether the board will contain a single-cell
region with probability **10%**. This is the percentage of boards with at
least one single-cell region, not the percentage of regions. Small batches
can differ from 10%. It then samples a complete historical profile from that
group, matching the requested difficulty when available. Region areas,
shapes, interior regions and deduction characteristics come from that joint
profile. No historical grid or solution is used for construction.

Candidate selection follows v2's profile distance and uniqueness repair.
The final board must have the selected singleton presence, including after
relaxed construction. The default attempt cap is 180 (v2 remains 120), with
12 candidate outputs sought. An exhausted search throws instead of silently
violating the singleton choice. Explicit custom training pools need both
singleton groups. Difficulty remains the actual deduction-solver rating;
a missing requested difficulty is reported, never relabelled.

This deliberately changes the historical distribution. Suppressing single
cells also changes correlated features; matching every historical marginal
exactly would conflict with that preference. Other features are recalibrated
through the expanded joint profiles, without changing the scoring weights
based on the evaluation set. Fewer immediately forced queens does not alone
guarantee a harder puzzle.

## Reproduce the comparison

```sh
npm run benchmark -- --baseline profile-v2 --candidate profile-v3 --history expanded --count 20 --seeds calibration-a,calibration-b --out reports/generator-v3-benchmark.json
npm run generate -- --version profile-v3 --size 9 --count 30 --seed comparison --out reports/profile-v3.json
```

The comparison holds out complete canonical layouts by hash. V2 samples the
original training subset; v3 samples the expanded training subset. Both are
measured against the same expanded held-out archive, with identical size
and seed schedules. This evaluates recalibration, not just a construction
algorithm change. Production uses the full frozen corpus for each version.
The original legacy/v2 benchmark defaults and its saved report are preserved.

The report includes all historical distances plus a separate aggregate
excluding only the three explicit singleton metrics. Correlated metrics
remain included. The paired confidence interval still describes the full
historical distance. `--check` retains its strict historical-similarity gate,
which can reject an intentional singleton deviation; inspect policy and
other-feature results separately. Reported timings include validation.

## Measured result

The saved [400-board comparison](../reports/generator-v3-benchmark.md) uses
200 outputs per version, 40 per size across two seed batches. Every output
passed region connectivity and unique-solution validation. There were no
failures, historical copies or canonical duplicates, including across batches.
V3 had singleton regions on **18/200 boards (9%)**, versus **48/200 (24%)**
for v2. V3 singleton rates by size 7–11 were 10%, 10%, 5%, 12.5%, 7.5%.

Recalibration does **not** establish a general similarity improvement.
Distance excluding the three explicit singleton metrics increased at each
size: 0.0333→0.0488, 0.0297→0.0370, 0.0343→0.0391, 0.0351→0.0371,
and 0.0860→0.1006. All full-distance paired confidence intervals include
zero. The observed tradeoff includes background-region frequency and
solver-difficulty mix, with especially uncertain results for rare large boards.
The next calibration experiment should test explicit targets for those
features within the singleton constraint, using fresh evaluation seeds.
Do not tune against this held-out set and then present it as independent proof.
