# Historical distribution update

607 original boards (excluding #336), 247 imported boards.

| Size | Old/new count | Singleton boards old/new | Interior regions old/new | Largest area old/new | Medium old/new |
|---|---:|---|---|---|---|
| 7 | 83/66 | 36.1%/57.6% | 2.01/2.14 | 36.0%/39.8% | 37.3%/47.0% |
| 8 | 219/83 | 21.9%/25.3% | 2.79/2.41 | 36.2%/36.8% | 24.7%/28.9% |
| 9 | 199/98 | 19.6%/21.4% | 3.58/2.98 | 34.4%/33.3% | 15.1%/11.2% |

These are descriptive era comparisons using the same solver and feature definitions. They are not evidence of a causal change in puzzle design. New-history boards are playable, but the v2 training corpus remains frozen for seed compatibility.

To experiment with recalibration without changing the app: `npm run benchmark -- --history expanded --count 30 --seeds recalibration-a,recalibration-b --out reports/recalibration.json`.

That command trains the profile proposals on the expanded training split and evaluates on its holdout. Keep it separate from the original benchmark. A production recalibration should receive a new generator version and a fixed corpus.
