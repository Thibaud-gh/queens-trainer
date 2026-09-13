# LinkedIn Queens board patterns

The generator discussion and generated comparison below describe the original
algorithm, now frozen as `generator-legacy.ts`. For the new default, version
selection, and stronger benchmark, see [generator-v2.md](generator-v2.md).

Statistics over the 607 genuine LinkedIn daily boards in
`src/data/linkedin-puzzles.json` (#1–#616 minus gaps; #336, the April Fools
board with disconnected regions, is excluded). Reproduce with
`npx tsx scripts/analyze-patterns.ts` (add `--no-compare` to skip generating
200 boards for the comparison at the end).

Sizes in the archive: 7×7: 83 boards, 8×8: 219, 9×9: 199, 10×10: 74, 11×11: 32.

## Region sizes

Every board has N regions on N² cells, so the mean region size is N. The
distribution is strongly skewed: one big irregular "background" region plus
many small ones.

| size | median region | tiny (≤3 cells) share of regions | tiny regions per board | boards with a 1-cell region | largest region / N² (mean) | boards with a ≥30 % background |
|------|---------------|----------------------------------|------------------------|-----------------------------|----------------------------|-------------------------------|
| 7×7  | 5 | 29.9 % (1: 6.4 %, 2: 9.6 %, 3: 13.9 %) | 2.10 | 36 % | 36.0 % | 65 % |
| 8×8  | 5 | 20.5 % (1: 3.5 %, 2: 6.1 %, 3: 11.0 %) | 1.64 | 22 % | 36.2 % | 62 % |
| 9×9  | 6 | 15.4 % (1: 2.6 %, 2: 4.1 %, 3: 8.7 %)  | 1.38 | 20 % | 34.4 % | 55 % |
| 10×10| 6 | 10.5 % (1: 2.2 %, 2: 2.6 %, 3: 5.8 %)  | 1.05 | 20 % | 36.2 % | 59 % |
| 11×11| 6 | 14.2 % (1: 2.8 %, 2: 2.6 %, 3: 8.8 %)  | 1.56 | 28 % | 36.6 % | 53 % |
| all  | 6 | 18.0 % (1: 3.3 %, 2: 5.1 %, 3: 9.6 %)  | 1.54 | 23 % | 35.6 % | 59 % |

73 % of all boards contain at least one region of ≤ 3 cells. The largest
region ranges from ~20 % to ~70 % of the board (median 32.7 %).

Region sizes by rank (largest first), p25 / median / p75 — this is the profile
the generator samples from:

| size | rank 1 | rank 2 | rank 3 | rank 4 | rank 5 | rank 6 | rank 7 | rank 8 | rank 9 | rank 10 | rank 11 |
|------|--------|--------|--------|--------|--------|--------|--------|--------|--------|---------|---------|
| 7×7  | 13/16/20 | 8/10/11 | 6/7/9 | 4/5/6 | 3/4/5 | 2/3/4 | 1/2/3 | | | | |
| 8×8  | 18/22/28 | 9/11/14 | 6/8/10 | 5/6/8 | 4/5/6 | 4/4/5 | 3/4/4 | 2/3/3 | | | |
| 9×9  | 21/25/33 | 11/14/17 | 7/10/11 | 6/7/9 | 5/6/7 | 4/5/6 | 4/5/5 | 3/4/5 | 2/3/4 | | |
| 10×10| 23/34/47 | 10/16/20 | 7/11/14 | 5/8/11 | 5/6/8 | 5/6/7 | 4/5/6 | 4/4/5 | 3/4/5 | 2/3/4 | |
| 11×11| 31/38/69 | 11/17/24 | 11/12/15 | 7/11/12 | 6/9/11 | 5/8/10 | 5/6/8 | 4/5/6 | 3/5/5 | 3/4/5 | 1/3/4 |

## Region shapes

Classification (see `src/core/patterns.ts`): `single` (1 cell), `domino`
(2), `full-line` (a whole row/column), `segment` (straight, ≥ 3 cells),
`rectangle` (solid block ≥ 2×2), `L` (two straight arms sharing a corner),
`ring` (thin region — no 2×2 block — that fully encloses other cells),
`snake` (any other thin region), `blob` (everything else).

| size | single | domino | full-line | segment | rectangle | L | ring | snake | blob |
|------|--------|--------|-----------|---------|-----------|---|------|-------|------|
| 7×7  | 6.4 % | 9.6 % | 0.3 % | 8.3 % | 5.2 % | 19.4 % | 1.7 % | 21.7 % | 27.4 % |
| 8×8  | 3.5 % | 6.1 % | 0.1 % | 6.2 % | 5.9 % | 20.8 % | 1.5 % | 27.2 % | 28.7 % |
| 9×9  | 2.6 % | 4.1 % | 0.1 % | 5.2 % | 3.1 % | 18.3 % | 1.7 % | 35.1 % | 29.8 % |
| 10×10| 2.2 % | 2.6 % | 0.1 % | 6.5 % | 5.5 % | 17.0 % | 0.3 % | 31.6 % | 34.2 % |
| 11×11| 2.8 % | 2.6 % | 0.0 % | 5.4 % | 3.7 % | 13.4 % | 2.6 % | 40.6 % | 29.0 % |
| all  | 3.4 % | 5.3 % | 0.1 % | 6.1 % | 4.7 % | 18.9 % | 1.5 % | 30.3 % | 29.6 % |

Take-aways:

* Thin winding regions ("snakes") and irregular blobs make up 60 % of all
  regions; L-shapes another 19 %. Snakes are typically *coiled inside a band of
  2–3 rows or columns* (C/S/U shapes), which is what makes them useful
  constraints for the solver.
* Straight lines spanning a full row or column are essentially absent
  (0.1 %); short segments of 3–5 cells are common (6 %).
* 23 % of boards have a region that completely encloses another region
  (usually the background around a small region); 7 % enclose a single cell.
* Symmetry is practically never used: 2 boards out of 607 (both 180°
  rotational), 0.3 %.
* 64 % of regions touch the border; a board has on average 3.2 interior
  regions (2.0 at 7×7, 3.9 at 10×10/11×11).
* Regions share an edge with each other in 14.6 pairs per board on average
  (10.9 at 7×7 → 18.4 at 11×11), i.e. roughly 1.6·N adjacencies.

## Difficulty by pure deduction

`src/core/deduction.ts` solves every one of the 607 boards without guessing
and its solution agrees with the backtracking solver on all of them. Hardest
technique needed (levels: 1 queen eliminations, 2 singles, 3 confined
region/line, 4 hidden sets, 5 "cell would empty a group", 6 one-level trial):

| size | L2 | L3 | L4 | L5 | L6 | easy | medium | hard | expert |
|------|----|----|----|----|----|------|--------|------|--------|
| 7×7  | 7 | 31 | 7 | 38 | 0 | 8 % | 37 % | 54 % | 0 % |
| 8×8  | 8 | 54 | 34 | 122 | 1 | 4 % | 25 % | 71 % | 0 % |
| 9×9  | 4 | 30 | 37 | 126 | 2 | 2 % | 15 % | 82 % | 1 % |
| 10×10| 0 | 16 | 17 | 41 | 0 | 0 % | 22 % | 78 % | 0 % |
| 11×11| 0 | 11 | 4 | 14 | 3 | 0 % | 34 % | 56 % | 9 % |
| all  | 19 | 142 | 99 | 341 | 6 | 3 % | 23 % | 72 % | 1 % |

(easy = levels 1–2 only, medium = up to 3, hard = up to 5, expert = needs 6 or
cannot be finished by deduction.)

## Typical boards

Lower-case letter + `*` marks the solution queen.

LinkedIn Queens #1 (8×8) — sizes 14/11/10/9/7/7/5/1, largest 22 %, level 3 → medium.
A thin column strip, an L, a single cell (E) and two blobs:

```
A A B b*B C C C
A D B D B e*C C
A d*B D B C C C
A D D D B F G c*
a*D D D B F G G
A D h*D B F G G
H D H D B F f*G
H H H H g*G G G
```

LinkedIn Queens #2 (9×9) — sizes 57/3×8, largest 70 %, level 5 → hard.
The archetypal "background + tiny segments" board:

```
A A A A A A b*B B
A A A A A A A A c*
A D d*D E A A A C
A A A A e*A A A C
a*A A A E A A A A
A A A A A f*F F A
A A A A A A G g*G
A A H h*H A A A A
A i*I I A A A A A
```

LinkedIn Queens #52 (10×10) — sizes 54/6/5×8, largest 54 %, level 5 → hard.
Small snakes and L's scattered in a big background:

```
A A A A A A A B b*B
A A C A A d*A A B B
A C C e*E D D A A B
c*C E E F F D D A A
G G E F f*A A H H A
A g*G F A A H H A A
A A G A A A h*A A A
A A A A I A A A J a*
A A A I I A A j*J A
A A i*I A A J J A A
```

LinkedIn Queens #100 (11×11) — sizes 37/12/12/12/11/10/8/7/6/3/3, largest 31 %,
level 5 → hard. Coiled snakes confined to 2–3 columns (B, C, E) next to a
moderate background:

```
A A B B C C C c*D D D
A A B B E E E C D f*D
A A G B E h*E C D F D
A g*G B E H E C D F D
A A G B E H E C d*D D
A A G B E E e*I I I I
A A G B b*I I I A A A
A A i*I I I A A A A J
a*A A A A A A A J J J
A A A A A J J J J K k*
A A J j*J J K K K K K
```

## How the generator uses this

`src/core/generator.ts`:

1. Random valid queen placement; region *r* holds the queen of row *r*.
2. Per-seed style: number of tiny regions (mean ≈ 1.3, more for 7×7, more when
   `difficulty: 'easy'` is requested, fewer for `'expert'`), a background share
   (0.2–0.55), and randomly perturbed template weights (segment 7, rectangle 6,
   L 8, snake 52, ring 14, blob 22 — snakes and L's also arise from other
   templates, so the final mix lands near the table above).
3. Region target sizes are sampled rank by rank from the p25–p75 profile above.
   The largest becomes the background (filled with whatever is left).
4. Templates are carved around each queen, rigid ones first (ring, rectangle,
   segment, L), then band-limited snakes, then tiny regions. A carve is
   rejected if it would leave a pocket of free cells without a queen or with
   too few cells for the queens inside it.
5. Blob regions grow to their targets by flood fill; the background absorbs
   the remaining cells; unreachable pockets are merged into an adjacent region.
6. Uniqueness repair by local search (`repairUniqueness`): cells carrying
   alternative queens are reassigned to a neighbouring region (regions stay
   connected and ≥ 4 cells, rigid shapes are protected), guided by a fast
   most-constrained-first solver and random solution samples; when the
   alternatives' cells are unreachable the search keeps one of them instead.
7. Difficulty rating with the deduction solver; symmetric-canonical-key
   de-duplication within a session.

### Generated boards vs LinkedIn (200 boards, LinkedIn size mix)

From `npx tsx scripts/analyze-patterns.ts --compare 200`:

| metric | LinkedIn | generated | Δ | tolerance |
|--------|----------|-----------|---|-----------|
| share of ≤3-cell regions | 18.6 % | 17.4 % | −1.2 | ±10 |
| largest region / N² | 35.6 % | 36.0 % | +0.3 | ±10 |
| share of 1–2-cell regions | 8.7 % | 8.5 % | −0.2 | ±10 |

Shape mix of generated regions: single 4.7 %, domino 3.8 %, segment 7.5 %,
rectangle 2.7 %, L 21.3 %, ring 0.4 %, snake 24.6 %, blob 35.1 % (LinkedIn:
3.4 / 5.3 / 6.1 / 4.7 / 18.9 / 1.5 / 30.3 / 29.6). Generated boards are a bit
heavier on blobs and lighter on rings and snakes than LinkedIn; boards have
slightly fewer interior regions (2.3 vs 3.2 per board).

Difficulty of generated boards with `difficulty: 'any'`: easy 1 %, medium
14 %, hard 81 %, expert 4 % (LinkedIn: 3 / 23 / 72 / 1). Every requested
difficulty is reachable: over 12 seeds per size, `easy`, `medium` and `expert`
were hit 12/12 at 7×7–9×9 and mostly at 10×10–11×11 (11×11: easy 6/12, medium
6/12, expert 10/12 within the default 60 attempts; misses fall back to the
best board found and carry their true rating).

Generation time in Node (mean / max over the 200-board run): 7×7 10 / 36 ms,
8×8 23 / 98 ms, 9×9 80 / 375 ms, 10×10 174 / 553 ms, 11×11 375 / 948 ms. A
requested difficulty costs more (roughly 0.3 s for 9×9, 2–3 s for 11×11).
