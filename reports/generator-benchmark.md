# Generator benchmark

Reference: holdout. 30 boards per size per batch per version. Batches: evaluation-a, evaluation-b.

| Size | Reference n | Legacy distance | V2 distance | V2−legacy 95% CI | Failures old/new | Mean ms old/new |
|---|---:|---:|---:|---|---|---|
| 7 | 19 | 0.0465 | 0.0422 | -0.0217 … 0.0151 | 0/0 | 5/44 |
| 8 | 59 | 0.0420 | 0.0355 | -0.0165 … 0.0063 | 0/0 | 12/165 |
| 9 | 37 | 0.0440 | 0.0426 | -0.0145 … 0.0153 | 0/0 | 46/439 |
| 10 | 17 | 0.0445 | 0.0384 | -0.0166 … 0.0060 | 0/0 | 138/830 |
| 11 | 5 | 0.0917 | 0.0814 | -0.0237 … 0.0171 | 0/0 | 274/1951 |

Lower distance is better. Small historical strata have substantial uncertainty. Inspect JSON for all per-feature distributions, correlations, timings, failures, and generated grids. No pooled size average is used.

## Selected feature means

| Size | Feature | Reference | Legacy | V2 |
|---|---|---:|---:|---:|
| 7 | hasSingleton | 0.421 | 0.467 | 0.283 |
| 7 | interior | 2.105 | 1.400 | 2.650 |
| 7 | shape:snake | 0.195 | 0.210 | 0.198 |
| 7 | shape:ring | 0.030 | 0.005 | 0.002 |
| 7 | shape:blob | 0.293 | 0.295 | 0.271 |
| 7 | background | 0.737 | 0.833 | 0.750 |
| 7 | difficulty:medium | 0.368 | 0.117 | 0.383 |
| 7 | advanced | 1.158 | 1.933 | 1.900 |
| 8 | hasSingleton | 0.153 | 0.433 | 0.167 |
| 8 | interior | 2.847 | 1.983 | 2.933 |
| 8 | shape:snake | 0.278 | 0.273 | 0.219 |
| 8 | shape:ring | 0.017 | 0.006 | 0.000 |
| 8 | shape:blob | 0.307 | 0.319 | 0.331 |
| 8 | background | 0.593 | 0.683 | 0.800 |
| 8 | difficulty:medium | 0.254 | 0.233 | 0.233 |
| 8 | advanced | 2.864 | 2.600 | 2.367 |
| 9 | hasSingleton | 0.243 | 0.450 | 0.133 |
| 9 | interior | 3.919 | 2.583 | 3.283 |
| 9 | shape:snake | 0.306 | 0.265 | 0.285 |
| 9 | shape:ring | 0.015 | 0.004 | 0.002 |
| 9 | shape:blob | 0.291 | 0.343 | 0.337 |
| 9 | background | 0.595 | 0.667 | 0.767 |
| 9 | difficulty:medium | 0.216 | 0.133 | 0.133 |
| 9 | advanced | 2.486 | 3.367 | 3.483 |
| 10 | hasSingleton | 0.235 | 0.433 | 0.350 |
| 10 | interior | 4.294 | 3.300 | 3.967 |
| 10 | shape:snake | 0.276 | 0.282 | 0.267 |
| 10 | shape:ring | 0.006 | 0.010 | 0.002 |
| 10 | shape:blob | 0.324 | 0.362 | 0.370 |
| 10 | background | 0.529 | 0.633 | 0.683 |
| 10 | difficulty:medium | 0.294 | 0.117 | 0.150 |
| 10 | advanced | 3.235 | 4.067 | 3.433 |
| 11 | hasSingleton | 0.200 | 0.400 | 0.300 |
| 11 | interior | 4.800 | 3.983 | 4.800 |
| 11 | shape:snake | 0.345 | 0.262 | 0.311 |
| 11 | shape:ring | 0.055 | 0.008 | 0.003 |
| 11 | shape:blob | 0.291 | 0.377 | 0.353 |
| 11 | background | 0.400 | 0.717 | 0.633 |
| 11 | difficulty:medium | 0.600 | 0.117 | 0.333 |
| 11 | advanced | 1.200 | 5.300 | 5.267 |

## Selection diagnostics

| Size | Relaxed construction selected | Target difficulty missed |
|---|---:|---:|
| 7 | 0 | 0 |
| 8 | 0 | 1 |
| 9 | 1 | 0 |
| 10 | 1 | 0 |
| 11 | 0 | 0 |

Feature shares are fractions (0–1); interior and advanced are counts. Difficulty labels are solver-based. Timing includes output validity checks. Generation is slower because v2 evaluates multiple unique candidates.
