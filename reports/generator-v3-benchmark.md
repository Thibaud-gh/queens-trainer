# Generator benchmark

Corpus: expanded. Reference: holdout. 20 boards per size per batch per version. Batches: calibration-a, calibration-b.

| Size | Reference n | profile-v2 distance | profile-v3 distance | Candidate−baseline 95% CI | Failures old/new | Mean ms old/new |
|---|---:|---:|---:|---|---|---|
| 7 | 32 | 0.0381 | 0.0599 | -0.0006 … 0.0361 | 0/0 | 52/38 |
| 8 | 73 | 0.0307 | 0.0377 | -0.0102 … 0.0224 | 0/0 | 177/180 |
| 9 | 59 | 0.0353 | 0.0416 | -0.0075 … 0.0166 | 0/0 | 417/481 |
| 10 | 17 | 0.0352 | 0.0376 | -0.0132 … 0.0216 | 0/0 | 1129/1176 |
| 11 | 5 | 0.0825 | 0.0974 | -0.0092 … 0.0352 | 0/0 | 1782/2696 |

Lower distance is better. Small historical strata have substantial uncertainty. Inspect JSON for all per-feature distributions, correlations, timings, failures, and generated grids. No pooled size average is used.

## Selected feature means

| Size | Feature | Reference | profile-v2 | profile-v3 |
|---|---|---:|---:|---:|
| 7 | hasSingleton | 0.563 | 0.350 | 0.100 |
| 7 | interior | 2.000 | 2.500 | 2.350 |
| 7 | shape:snake | 0.201 | 0.182 | 0.196 |
| 7 | shape:ring | 0.036 | 0.011 | 0.000 |
| 7 | shape:blob | 0.295 | 0.307 | 0.300 |
| 7 | background | 0.781 | 0.775 | 0.675 |
| 7 | difficulty:medium | 0.375 | 0.275 | 0.450 |
| 7 | advanced | 0.969 | 1.375 | 1.675 |
| 8 | hasSingleton | 0.205 | 0.300 | 0.100 |
| 8 | interior | 2.671 | 2.600 | 3.000 |
| 8 | shape:snake | 0.264 | 0.244 | 0.237 |
| 8 | shape:ring | 0.014 | 0.000 | 0.000 |
| 8 | shape:blob | 0.324 | 0.350 | 0.322 |
| 8 | background | 0.589 | 0.650 | 0.725 |
| 8 | difficulty:medium | 0.247 | 0.200 | 0.175 |
| 8 | advanced | 2.753 | 2.700 | 2.900 |
| 9 | hasSingleton | 0.237 | 0.125 | 0.050 |
| 9 | interior | 3.644 | 3.650 | 3.625 |
| 9 | shape:snake | 0.305 | 0.311 | 0.344 |
| 9 | shape:ring | 0.019 | 0.003 | 0.000 |
| 9 | shape:blob | 0.322 | 0.342 | 0.317 |
| 9 | background | 0.542 | 0.675 | 0.750 |
| 9 | difficulty:medium | 0.169 | 0.175 | 0.125 |
| 9 | advanced | 2.814 | 3.225 | 2.775 |
| 10 | hasSingleton | 0.235 | 0.150 | 0.125 |
| 10 | interior | 4.294 | 4.800 | 4.650 |
| 10 | shape:snake | 0.276 | 0.283 | 0.275 |
| 10 | shape:ring | 0.006 | 0.000 | 0.003 |
| 10 | shape:blob | 0.324 | 0.378 | 0.370 |
| 10 | background | 0.529 | 0.675 | 0.700 |
| 10 | difficulty:medium | 0.294 | 0.275 | 0.225 |
| 10 | advanced | 3.235 | 2.525 | 3.325 |
| 11 | hasSingleton | 0.200 | 0.275 | 0.075 |
| 11 | interior | 4.800 | 5.125 | 4.675 |
| 11 | shape:snake | 0.345 | 0.336 | 0.359 |
| 11 | shape:ring | 0.055 | 0.000 | 0.005 |
| 11 | shape:blob | 0.291 | 0.330 | 0.336 |
| 11 | background | 0.400 | 0.625 | 0.625 |
| 11 | difficulty:medium | 0.600 | 0.250 | 0.125 |
| 11 | advanced | 1.200 | 4.150 | 6.825 |

## Distance excluding explicit singleton metrics

| Size | profile-v2 | profile-v3 |
|---|---:|---:|
| 7 | 0.0333 | 0.0488 |
| 8 | 0.0297 | 0.0370 |
| 9 | 0.0343 | 0.0391 |
| 10 | 0.0351 | 0.0371 |
| 11 | 0.0860 | 0.1006 |

Excludes hasSingleton, singletonCount and shape:single only. Correlated shape, region area and difficulty metrics remain. V3 deliberately targets 10% singleton boards rather than the historical rate.

## Selection diagnostics

| Size | Relaxed construction selected | Target difficulty missed |
|---|---:|---:|
| 7 | 0 | 0 |
| 8 | 1 | 1 |
| 9 | 1 | 1 |
| 10 | 0 | 2 |
| 11 | 0 | 0 |

Feature shares are fractions (0–1); interior and advanced are counts. Difficulty labels are solver-based. Timing includes output validity checks. Generation is slower because profile generation evaluates multiple unique candidates.
