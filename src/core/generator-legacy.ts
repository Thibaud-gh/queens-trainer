/**
 * Pattern-aware random puzzle generator.
 *
 * Design (see docs/patterns.md for the LinkedIn statistics that drive it):
 *
 *  1. Pick a random valid queen placement (`randomSolution`). Region `r` will
 *     be the region that holds the queen of row `r`.
 *  2. Sample a per-seed *style*: how many tiny (1–3 cell) regions, how big the
 *     irregular "background" region should be, and weights for the shape
 *     templates (segments, rectangles, L-shapes, thin snakes, rings, blobs).
 *  3. Carve the rigid templates first (segment / rectangle / L / ring), then
 *     snakes (self-avoiding width-1 walks), then tiny regions, each around its
 *     own queen, from still-free cells. A carve is rejected when it would leave
 *     a pocket of free cells that contains no unassigned queen (such a pocket
 *     could never be filled by a region with exactly one queen).
 *  4. Grow the remaining "blob" regions to their target sizes with a random
 *     flood fill; the background region then absorbs every free cell it can
 *     reach. Free pockets it cannot reach are merged into an adjacent region
 *     (which keeps every region connected).
 *  5. Check uniqueness with the backtracking solver. When several solutions
 *     exist, *repair* by local search: reassign boundary cells lying on an
 *     alternative solution to a neighbouring region (keeping connectivity and
 *     the intended solution valid), preferring moves that lower the solution
 *     count, instead of starting over.
 *  6. Rate the board with the deduction solver, accept if it matches the
 *     requested difficulty (styles are biased toward the request), reject
 *     boards already produced in this session (symmetric canonical key).
 *
 * Browser-safe: no Node APIs. Deterministic for a given (size, seed).
 */
import { MAX_SIZE, MIN_SIZE, ORTHO, normalizeRegions, symmetricCanonicalKey } from './puzzle'
import { rateDifficulty } from './deduction'
import { makeRng, randomSeed, type Rng } from './random'
import { countSolutions } from './solver'
import type { Difficulty, Puzzle, Solution } from './types'

export interface GeneratorOptions {
  /** Board size, 7–11 like LinkedIn. Default 8. */
  size?: number
  /** Seed for reproducible output. Random when omitted. */
  seed?: string
  /**
   * Maximum construction attempts spent looking for the requested difficulty.
   * The first unique board found is kept as a fallback, so this bounds work,
   * never success. Default 60.
   */
  maxAttempts?: number
  /** Wanted difficulty; `'any'` (default) accepts the first unique board. */
  difficulty?: Difficulty | 'any'
}

/* ------------------------------------------------------------------------ */
/* Baseline helpers (kept for compatibility)                                */
/* ------------------------------------------------------------------------ */

/** Random permutation with no two consecutive rows in adjacent columns. */
export function randomSolution(n: number, rng: Rng): Solution {
  const cols: number[] = new Array<number>(n).fill(-1)
  const used = new Array<boolean>(n).fill(false)
  const tryRow = (row: number): boolean => {
    if (row === n) return true
    const order = rng.shuffle(Array.from({ length: n }, (_, i) => i))
    for (const c of order) {
      if (used[c]) continue
      if (row > 0 && Math.abs(c - cols[row - 1]) <= 1) continue
      used[c] = true
      cols[row] = c
      if (tryRow(row + 1)) return true
      used[c] = false
      cols[row] = -1
    }
    return false
  }
  tryRow(0)
  return cols
}

/**
 * Grow N regions from the queen cells with a random multi-source flood fill.
 * Regions stay orthogonally connected by construction. Used as the last-resort
 * fallback when template carving fails.
 */
export function growRegions(n: number, solution: Solution, rng: Rng): number[][] {
  const regions: number[][] = Array.from({ length: n }, () => new Array<number>(n).fill(-1))
  const frontier: Array<[number, number, number]> = []
  solution.forEach((c, r) => {
    regions[r][c] = r
    frontier.push([r, c, r])
  })
  let filled = n
  while (filled < n * n && frontier.length) {
    const i = rng.int(frontier.length)
    const [r, c, g] = frontier[i]
    const options: Array<[number, number]> = []
    for (const [dr, dc] of ORTHO) {
      const nr = r + dr
      const nc = c + dc
      if (nr < 0 || nc < 0 || nr >= n || nc >= n) continue
      if (regions[nr][nc] === -1) options.push([nr, nc])
    }
    if (!options.length) {
      frontier.splice(i, 1)
      continue
    }
    const [nr, nc] = rng.pick(options)
    regions[nr][nc] = g
    filled++
    frontier.push([nr, nc, g])
  }
  return regions
}

/* ------------------------------------------------------------------------ */
/* Style                                                                    */
/* ------------------------------------------------------------------------ */

type TemplateKind = 'segment' | 'rectangle' | 'L' | 'snake' | 'ring' | 'blob'
export type Role = TemplateKind | 'tiny' | 'background'
/** Roles whose shape is rigid; the uniqueness repair avoids touching them. */
const RIGID_ROLES: ReadonlySet<Role> = new Set<Role>(['segment', 'rectangle', 'ring', 'tiny'])

export interface Style {
  /** Number of 1–3 cell regions. */
  tinyCount: number
  /** Target size of the background region as a fraction of N². */
  backgroundShare: number
  /** Relative weights of the shaped (non-tiny, non-background) regions. */
  weights: Record<TemplateKind, number>
}

const BASE_WEIGHTS: Record<TemplateKind, number> = {
  segment: 7,
  rectangle: 6,
  L: 8,
  snake: 52,
  ring: 14,
  blob: 22,
}

function pickWeighted<T extends string>(rng: Rng, weights: Record<T, number>): T {
  const entries = Object.entries(weights) as Array<[T, number]>
  let total = 0
  for (const [, w] of entries) total += w
  let x = rng.next() * total
  for (const [k, w] of entries) {
    x -= w
    if (x < 0) return k
  }
  return entries[entries.length - 1][0]
}

/** Sample a board style; biased by the requested difficulty. */
export function sampleStyle(rng: Rng, n: number, difficulty: Difficulty | 'any'): Style {
  // LinkedIn: ~2.1 tiny regions per board at 7×7 falling to ~1.0–1.5 at 10–11.
  // (slightly below LinkedIn's mean because boards with more tiny regions are
  // easier to make unique and therefore over-represented among accepted boards)
  const tinyTable = [0.3, 0.35, 0.22, 0.1, 0.03]
  let tiny = 0
  {
    let x = rng.next()
    for (let i = 0; i < tinyTable.length; i++) {
      x -= tinyTable[i]
      if (x < 0) {
        tiny = i
        break
      }
    }
  }
  if (n <= 7 && rng.next() < 0.4) tiny++
  if (n >= 10 && tiny > 0 && rng.next() < 0.4) tiny--

  // Background share: mean ≈ 0.35, spread 0.2–0.55.
  let background = 0.2 + rng.next() * 0.35

  // Per-seed flavour: multiply the base weights by random factors so some seeds
  // are snake-heavy, others L-heavy, etc.
  const weights = { ...BASE_WEIGHTS }
  for (const k of Object.keys(weights) as TemplateKind[]) weights[k] *= 0.5 + rng.next() * 1.5

  switch (difficulty) {
    case 'easy':
      tiny += 2 + rng.int(2)
      background = 0.18 + rng.next() * 0.2
      weights.segment *= 3
      weights.rectangle *= 2
      break
    case 'medium':
      tiny += rng.int(2)
      weights.segment *= 2
      weights.L *= 1.5
      break
    case 'expert':
      tiny = rng.int(2)
      background = 0.25 + rng.next() * 0.3
      weights.blob *= 2
      weights.snake *= 1.5
      weights.segment *= 0.3
      weights.rectangle *= 0.5
      break
    default:
      break
  }
  tiny = Math.max(0, Math.min(tiny, Math.max(1, n - 3)))
  return { tinyCount: tiny, backgroundShare: background, weights }
}

/* ------------------------------------------------------------------------ */
/* Construction                                                             */
/* ------------------------------------------------------------------------ */

interface Build {
  n: number
  sol: Solution
  /** region id per cell key, -1 when free */
  cell: Int32Array
  /** key of the queen of region r */
  queenKey: number[]
  /** 1 when the cell is some queen's cell */
  isQueen: Uint8Array
  /** region r has been carved / seeded */
  assigned: boolean[]
  size: number[]
  role: Role[]
  target: number[]
}

function key(n: number, r: number, c: number): number {
  return r * n + c
}

function inBoard(n: number, r: number, c: number): boolean {
  return r >= 0 && c >= 0 && r < n && c < n
}

function freeNeighbours(b: Build, k: number): number[] {
  const n = b.n
  const r = Math.floor(k / n)
  const c = k % n
  const out: number[] = []
  for (const [dr, dc] of ORTHO) {
    const nr = r + dr
    const nc = c + dc
    if (inBoard(n, nr, nc) && b.cell[nr * n + nc] === -1) out.push(nr * n + nc)
  }
  return out
}

/** Cells a still-unassigned region needs at the very least, by role. */
function minCells(b: Build, g: number): number {
  const role = b.role[g]
  if (role === 'tiny') return b.target[g]
  if (role === 'background') return 2
  return Math.min(4, b.target[g])
}

/**
 * Every free component must contain at least one unassigned queen and enough
 * cells for the regions of the queens it contains (so no template squeezes a
 * later region into a 1–2 cell pocket by accident).
 */
function noDeadPockets(b: Build): boolean {
  const n = b.n
  const seen = new Uint8Array(n * n)
  for (let start = 0; start < n * n; start++) {
    if (b.cell[start] !== -1 || seen[start]) continue
    const stack = [start]
    seen[start] = 1
    let need = 0
    let queens = 0
    let cells = 0
    while (stack.length) {
      const k = stack.pop()!
      cells++
      if (b.isQueen[k]) {
        queens++
        need += minCells(b, Math.floor(k / n))
      }
      for (const j of freeNeighbours(b, k)) {
        if (!seen[j]) {
          seen[j] = 1
          stack.push(j)
        }
      }
    }
    if (queens === 0 || cells < need) return false
  }
  return true
}

/** Try to assign `cells` (which must contain the region's queen) to region g. */
function tryCarve(b: Build, g: number, cells: number[]): boolean {
  const q = b.queenKey[g]
  let hasQ = false
  for (const k of cells) {
    if (b.cell[k] !== -1) return false
    if (b.isQueen[k] && k !== q) return false
    if (k === q) hasQ = true
  }
  if (!hasQ) return false
  for (const k of cells) b.cell[k] = g
  if (!noDeadPockets(b)) {
    for (const k of cells) b.cell[k] = -1
    return false
  }
  b.assigned[g] = true
  b.size[g] = cells.length
  return true
}

function segmentCells(b: Build, g: number, rng: Rng, length: number): number[] | null {
  const n = b.n
  const q = b.queenKey[g]
  const qr = Math.floor(q / n)
  const qc = q % n
  const horizontal = rng.next() < 0.5
  const offsets = rng.shuffle(Array.from({ length }, (_, i) => i))
  for (const off of offsets) {
    const cells: number[] = []
    let ok = true
    for (let i = 0; i < length; i++) {
      const r = horizontal ? qr : qr - off + i
      const c = horizontal ? qc - off + i : qc
      if (!inBoard(n, r, c)) {
        ok = false
        break
      }
      cells.push(key(n, r, c))
    }
    if (ok) return cells
  }
  return null
}

function rectangleCells(b: Build, g: number, rng: Rng, targetSize: number): number[] | null {
  const n = b.n
  const q = b.queenKey[g]
  const qr = Math.floor(q / n)
  const qc = q % n
  const dims: Array<[number, number]> = [
    [2, 2],
    [2, 3],
    [3, 2],
    [2, 4],
    [4, 2],
    [3, 3],
    [3, 4],
    [4, 3],
  ]
  const sorted = rng
    .shuffle(dims.slice())
    .sort((a, c) => Math.abs(a[0] * a[1] - targetSize) - Math.abs(c[0] * c[1] - targetSize))
  for (const [h, w] of sorted.slice(0, 4)) {
    const placements = blockPlacements(b, g, h, w, qr, qc, false)
    if (placements.length) return rng.pick(placements)
  }
  return null
}

/**
 * All placements of an h×w block (or its frame when `frameOnly`) that contain
 * the queen (on the frame when `frameOnly`), lie on the board, and cover only
 * free non-queen cells. For frames the interior must hold another queen.
 */
function blockPlacements(b: Build, g: number, h: number, w: number, qr: number, qc: number, frameOnly: boolean): number[][] {
  const n = b.n
  const q = b.queenKey[g]
  const out: number[][] = []
  for (let r0 = qr - h + 1; r0 <= qr; r0++) {
    for (let c0 = qc - w + 1; c0 <= qc; c0++) {
      if (!inBoard(n, r0, c0) || !inBoard(n, r0 + h - 1, c0 + w - 1)) continue
      const onFrame = qr === r0 || qr === r0 + h - 1 || qc === c0 || qc === c0 + w - 1
      if (frameOnly && !onFrame) continue
      const cells: number[] = []
      let ok = true
      let interiorQueen = false
      for (let r = r0; r < r0 + h && ok; r++) {
        for (let c = c0; c < c0 + w; c++) {
          const k = key(n, r, c)
          const frame = r === r0 || r === r0 + h - 1 || c === c0 || c === c0 + w - 1
          if (frameOnly && !frame) {
            if (b.isQueen[k]) interiorQueen = true
            continue
          }
          if (b.cell[k] !== -1 || (b.isQueen[k] && k !== q)) {
            ok = false
            break
          }
          cells.push(k)
        }
      }
      if (ok && (!frameOnly || interiorQueen)) out.push(cells)
    }
  }
  return out
}

function lCells(b: Build, g: number, rng: Rng, targetSize: number): number[] | null {
  const n = b.n
  const q = b.queenKey[g]
  const qr = Math.floor(q / n)
  const qc = q % n
  const size = Math.max(3, Math.min(targetSize, 2 * n - 1))
  // arms a (horizontal, incl. corner) and c (vertical, incl. corner): a + c - 1 = size
  const a = 2 + rng.int(size - 2) // 2 .. size-1
  const c = size + 1 - a
  if (a < 2 || c < 2) return null
  const dirR = rng.next() < 0.5 ? 1 : -1
  const dirC = rng.next() < 0.5 ? 1 : -1
  // queen position on the L: index along horizontal arm (0 = corner) or vertical arm
  const onHorizontal = rng.next() < a / (a + c - 1)
  const i = onHorizontal ? rng.int(a) : 0
  const j = onHorizontal ? 0 : 1 + rng.int(c - 1)
  const cornerR = qr - dirR * j
  const cornerC = qc - dirC * i
  const cells: number[] = []
  for (let t = 0; t < a; t++) {
    const col = cornerC + dirC * t
    if (!inBoard(n, cornerR, col)) return null
    cells.push(key(n, cornerR, col))
  }
  for (let t = 1; t < c; t++) {
    const r = cornerR + dirR * t
    if (!inBoard(n, r, cornerC)) return null
    cells.push(key(n, r, cornerC))
  }
  return cells
}

function ringCells(b: Build, g: number, rng: Rng, targetSize: number): number[] | null {
  const n = b.n
  if (n < 6) return null
  const q = b.queenKey[g]
  const qr = Math.floor(q / n)
  const qc = q % n
  const dims: Array<[number, number]> = [
    [3, 4],
    [4, 3],
    [4, 4],
    [3, 5],
    [5, 3],
    [4, 5],
    [5, 4],
    [5, 5],
  ]
  const perimeter = ([h, w]: [number, number]) => 2 * (h + w) - 4
  const sorted = rng
    .shuffle(dims.slice())
    .sort((a, c) => Math.abs(perimeter(a) - targetSize) - Math.abs(perimeter(c) - targetSize))
  for (const [h, w] of sorted.slice(0, 4)) {
    // the interior must hold at least one queen, otherwise it would be a dead pocket
    const placements = blockPlacements(b, g, h, w, qr, qc, true)
    if (placements.length) return rng.pick(placements)
  }
  return null
}

/**
 * Self-avoiding width-1 walk through the queen: a new cell may touch only the
 * end it extends. Most snakes are confined to a band of 2–3 rows or columns,
 * which is how LinkedIn's coiled "C"/"S"/"U" regions look and what makes them
 * strong constraints (a region confined to two columns pins two queens).
 */
function snakeCells(b: Build, g: number, rng: Rng, length: number): number[] | null {
  const n = b.n
  const q = b.queenKey[g]
  const qr = Math.floor(q / n)
  const qc = q % n
  const inPath = new Set<number>([q])
  const path: number[] = [q]
  let head = q
  let tail = q
  // band: limit columns (vertical band) or rows (horizontal band)
  const x = rng.next()
  const bandWidth = x < 0.15 ? 2 : x < 0.7 ? 3 : x < 0.85 ? 4 : n
  const vertical = rng.next() < 0.5
  const centre = vertical ? qc : qr
  const bandLo = Math.max(0, Math.min(n - bandWidth, centre - rng.int(bandWidth)))
  const bandHi = bandLo + bandWidth - 1
  const inBand = (k: number) => {
    const v = vertical ? k % n : Math.floor(k / n)
    return v >= bandLo && v <= bandHi
  }
  const orthoInPath = (k: number) => {
    const r = Math.floor(k / n)
    const c = k % n
    let count = 0
    for (const [dr, dc] of ORTHO) {
      const nr = r + dr
      const nc = c + dc
      if (inBoard(n, nr, nc) && inPath.has(nr * n + nc)) count++
    }
    return count
  }
  let stuck = 0
  while (path.length < length && stuck < 2) {
    const fromHead = rng.next() < 0.5
    const end = fromHead ? head : tail
    let options = freeNeighbours(b, end).filter((k) => !b.isQueen[k] && !inPath.has(k) && orthoInPath(k) === 1)
    const banded = options.filter(inBand)
    if (banded.length || rng.next() < 0.85) options = banded
    if (!options.length) {
      stuck++
      continue
    }
    stuck = 0
    const k = rng.pick(options)
    inPath.add(k)
    if (fromHead) {
      path.push(k)
      head = k
    } else {
      path.unshift(k)
      tail = k
    }
  }
  return path.length >= 3 ? path : null
}

function tinyCells(b: Build, g: number, rng: Rng, size: number): number[] {
  const q = b.queenKey[g]
  const cells = [q]
  let cur = q
  while (cells.length < size) {
    const options = freeNeighbours(b, cur).filter((k) => !b.isQueen[k] && !cells.includes(k))
    if (!options.length) {
      const alt = cells.flatMap((c) => freeNeighbours(b, c)).filter((k) => !b.isQueen[k] && !cells.includes(k))
      if (!alt.length) break
      cells.push(rng.pick(alt))
      continue
    }
    cur = rng.pick(options)
    cells.push(cur)
  }
  return cells
}

/** Carve one region according to its role; returns false when the template could not be placed. */
function carve(b: Build, g: number, rng: Rng, tries: number): boolean {
  for (let t = 0; t < tries; t++) {
    let cells: number[] | null = null
    switch (b.role[g]) {
      case 'segment':
        cells = segmentCells(b, g, rng, Math.max(3, Math.min(b.target[g], b.n - 1 - rng.int(2))))
        break
      case 'rectangle':
        cells = rectangleCells(b, g, rng, b.target[g])
        break
      case 'L':
        cells = lCells(b, g, rng, b.target[g])
        break
      case 'ring':
        cells = ringCells(b, g, rng, b.target[g])
        break
      case 'snake':
        cells = snakeCells(b, g, rng, Math.max(4, b.target[g]))
        break
      case 'tiny':
        cells = tinyCells(b, g, rng, b.target[g])
        break
      default:
        return false
    }
    if (cells && tryCarve(b, g, cells)) return true
  }
  return false
}

/** Grow blob regions to their targets, then let the background absorb the rest; merge unreachable pockets. */
function fill(b: Build, rng: Rng): void {
  const n = b.n
  const growers: number[] = []
  for (let g = 0; g < n; g++) {
    if (!b.assigned[g]) {
      b.cell[b.queenKey[g]] = g
      b.size[g] = 1
      b.assigned[g] = true
      growers.push(g)
    }
  }
  const background = b.role.indexOf('background')
  const frontierOf = (g: number): number[] => {
    const out = new Set<number>()
    for (let k = 0; k < n * n; k++) if (b.cell[k] === g) for (const j of freeNeighbours(b, k)) out.add(j)
    return [...out]
  }
  // Phase 1: round-robin growth of every grower below its target (background target ∞).
  let active = growers.slice()
  while (active.length) {
    const g = rng.pick(active)
    const fr = frontierOf(g)
    if (!fr.length || (g !== background && b.size[g] >= b.target[g])) {
      active = active.filter((x) => x !== g)
      continue
    }
    // blobs prefer compact growth: cells with ≥2 own neighbours half of the time
    let pickFrom = fr
    if (g !== background && rng.next() < 0.5) {
      const compact = fr.filter((k) => {
        let own = 0
        const r = Math.floor(k / n)
        const c = k % n
        for (const [dr, dc] of ORTHO) {
          const nr = r + dr
          const nc = c + dc
          if (inBoard(n, nr, nc) && b.cell[nr * n + nc] === g) own++
        }
        return own >= 2
      })
      if (compact.length) pickFrom = compact
    }
    const k = rng.pick(pickFrom)
    b.cell[k] = g
    b.size[g]++
  }
  // Phase 2: leftover pockets → merge into an adjacent region (prefer background, then large flexible regions).
  const seen = new Uint8Array(n * n)
  for (let start = 0; start < n * n; start++) {
    if (b.cell[start] !== -1 || seen[start]) continue
    const comp: number[] = []
    const stack = [start]
    seen[start] = 1
    const adjacent = new Set<number>()
    while (stack.length) {
      const k = stack.pop()!
      comp.push(k)
      const r = Math.floor(k / n)
      const c = k % n
      for (const [dr, dc] of ORTHO) {
        const nr = r + dr
        const nc = c + dc
        if (!inBoard(n, nr, nc)) continue
        const j = nr * n + nc
        if (b.cell[j] === -1) {
          if (!seen[j]) {
            seen[j] = 1
            stack.push(j)
          }
        } else adjacent.add(b.cell[j])
      }
    }
    const adj = [...adjacent]
    let best = adj[0]
    const score = (g: number) => {
      if (g === background) return 1000
      return (b.role[g] === 'blob' ? 100 : 0) + b.size[g]
    }
    for (const g of adj) if (score(g) > score(best)) best = g
    for (const k of comp) b.cell[k] = best
    b.size[best] += comp.length
  }
}

/**
 * LinkedIn region sizes by rank (largest first) as [p25, p75] per board size,
 * measured on the 607-board archive (see docs/patterns.md). Rank 0 is the
 * background, which the generator fills with whatever is left.
 */
const SIZE_PROFILES: Record<number, Array<[number, number]>> = {
  7: [[13, 20], [8, 11], [6, 9], [4, 6], [3, 5], [2, 4], [1, 3]],
  8: [[18, 28], [9, 14], [6, 10], [5, 8], [4, 6], [4, 5], [3, 4], [2, 3]],
  9: [[21, 33], [11, 17], [7, 11], [6, 9], [5, 7], [4, 6], [4, 5], [3, 5], [2, 4]],
  10: [[23, 47], [10, 20], [7, 14], [5, 11], [5, 8], [5, 7], [4, 6], [4, 5], [3, 5], [2, 4]],
  11: [[31, 69], [11, 24], [11, 15], [7, 12], [6, 11], [5, 10], [5, 8], [4, 6], [3, 5], [3, 5], [1, 4]],
}

/** Size profile for any board size: measured for 7–11, scaled from the nearest one otherwise. */
export function sizeProfile(n: number): Array<[number, number]> {
  if (SIZE_PROFILES[n]) return SIZE_PROFILES[n]
  const ref = n < 7 ? 7 : 11
  const base = SIZE_PROFILES[ref]
  const scale = (n * n) / (ref * ref)
  const out: Array<[number, number]> = []
  for (let i = 0; i < n; i++) {
    const src = base[Math.min(base.length - 1, Math.round((i * (base.length - 1)) / Math.max(1, n - 1)))]
    out.push([Math.max(1, Math.round(src[0] * scale)), Math.max(1, Math.round(src[1] * scale))])
  }
  return out
}

/** Which templates can realise a region of `size` cells on an n×n board. */
function compatibleKinds(size: number, n: number): TemplateKind[] {
  const kinds: TemplateKind[] = []
  if (size >= 3 && size <= Math.min(6, n - 1)) kinds.push('segment')
  if ([4, 6, 8, 9, 12].includes(size)) kinds.push('rectangle')
  if (size >= 3 && size <= n + 3) kinds.push('L')
  if (size >= 8 && size <= 16 && n >= 7) kinds.push('ring')
  if (size >= 4) kinds.push('snake', 'blob')
  return kinds
}

/**
 * Build a region layout for `sol` following `style`; regions are indexed by
 * queen row. `debug`, when given, receives counters of carve attempts and
 * failures per role (used by scripts to tune the templates); `rolesOut`
 * receives the final role of every region.
 */
export function buildRegions(
  n: number,
  sol: Solution,
  rng: Rng,
  style: Style,
  debug?: Record<string, number>,
  rolesOut?: Role[],
): number[][] {
  const b: Build = {
    n,
    sol,
    cell: new Int32Array(n * n).fill(-1),
    queenKey: sol.map((c, r) => key(n, r, c)),
    isQueen: new Uint8Array(n * n),
    assigned: new Array<boolean>(n).fill(false),
    size: new Array<number>(n).fill(0),
    role: new Array<Role>(n).fill('blob'),
    target: new Array<number>(n).fill(4),
  }
  for (const k of b.queenKey) b.isQueen[k] = 1

  // Target sizes by rank from the LinkedIn profile; the style decides how many
  // of the smallest ranks are tiny (1–3 cells) and nudges the mid-size ranks.
  const profile = sizeProfile(n)
  const order = rng.shuffle(Array.from({ length: n }, (_, i) => i))
  const background = order[0]
  b.role[background] = 'background'
  const tinyCount = Math.max(0, Math.min(style.tinyCount, n - 2))
  const tinyRegions = order.slice(n - tinyCount)
  const shaped = order.slice(1, n - tinyCount)
  const midScale = 0.85 + (0.35 - style.backgroundShare) // bigger background → smaller mid regions
  shaped.forEach((g, i) => {
    const [lo, hi] = profile[i + 1]
    let t = lo + rng.int(hi - lo + 1)
    if (i < 2) t = Math.round(t * midScale)
    b.target[g] = Math.max(4, t)
  })
  for (const g of tinyRegions) {
    b.role[g] = 'tiny'
    const x = rng.next()
    b.target[g] = x < 0.12 ? 1 : x < 0.4 ? 2 : 3
  }
  let ringUsed = false
  for (const g of shaped) {
    const kinds = compatibleKinds(b.target[g], n)
    const weights = {} as Record<TemplateKind, number>
    for (const k of kinds) if (k !== 'ring' || !ringUsed) weights[k] = style.weights[k]
    let kind = pickWeighted(rng, weights)
    if (kind === 'ring') ringUsed = true
    if (kind === 'rectangle' && b.target[g] === 12 && rng.next() < 0.5) kind = 'blob'
    b.role[g] = kind
  }

  // Carve rigid templates first, then snakes, then tiny regions; failures fall back to blob growth.
  const phases: Role[][] = [['ring', 'rectangle', 'segment', 'L'], ['snake'], ['tiny']]
  for (const phase of phases) {
    for (const g of shaped.concat(tinyRegions)) {
      if (!phase.includes(b.role[g]) || b.assigned[g]) continue
      const ok = carve(b, g, rng, b.role[g] === 'tiny' ? 8 : 12)
      if (debug) {
        debug[`${b.role[g]}:tried`] = (debug[`${b.role[g]}:tried`] ?? 0) + 1
        if (!ok) debug[`${b.role[g]}:failed`] = (debug[`${b.role[g]}:failed`] ?? 0) + 1
      }
      if (!ok) {
        if (b.role[g] === 'tiny') {
          // step down 3 → 2 → 1; a single cell always works
          for (let t = b.target[g] - 1; t >= 1 && !b.assigned[g]; t--) {
            b.target[g] = t
            if (t === 1) tryCarve(b, g, [b.queenKey[g]])
            else carve(b, g, rng, 3)
          }
        } else {
          b.role[g] = 'blob'
          b.target[g] = Math.max(3, Math.min(b.target[g], 8))
        }
      }
    }
  }
  fill(b, rng)
  if (rolesOut) rolesOut.push(...b.role)

  const regions: number[][] = []
  for (let r = 0; r < n; r++) {
    const row: number[] = []
    for (let c = 0; c < n; c++) row.push(b.cell[r * n + c])
    regions.push(row)
  }
  return regions
}

/* ------------------------------------------------------------------------ */
/* Fast solution counting / sampling (for the repair loop)                  */
/* ------------------------------------------------------------------------ */

/**
 * Backtracking solver that always branches on the most constrained row or
 * region (fewest candidate cells). Several times faster than the plain
 * row-order solver on near-unique 10–11 boards, and able to draw random
 * solutions (random-restart DFS) for an unbiased picture of where alternative
 * queens live. The public `solve` from ./solver stays the reference used for
 * the final uniqueness check.
 */
class FastSolver {
  private readonly n: number
  private readonly reg: Int32Array
  private readonly regionCells: number[][]
  private readonly queens: Int32Array
  private readonly usedCol: Uint8Array
  private readonly usedReg: Uint8Array
  private placed = 0
  private out: Solution[] = []
  private cap = 1
  private rng: Rng | null = null

  constructor(regions: number[][]) {
    const n = regions.length
    this.n = n
    this.reg = new Int32Array(n * n)
    this.regionCells = Array.from({ length: n }, () => [])
    for (let r = 0; r < n; r++) {
      for (let c = 0; c < n; c++) {
        this.reg[r * n + c] = regions[r][c]
        this.regionCells[regions[r][c]].push(r * n + c)
      }
    }
    this.queens = new Int32Array(n).fill(-1)
    this.usedCol = new Uint8Array(n)
    this.usedReg = new Uint8Array(n)
  }

  /** Up to `cap` solutions in a deterministic order. */
  count(cap: number): Solution[] {
    this.out = []
    this.cap = cap
    this.rng = null
    this.search()
    return this.out
  }

  /** One random solution (random value ordering), or null when none exists. */
  sample(rng: Rng): Solution | null {
    this.out = []
    this.cap = 1
    this.rng = rng
    this.search()
    return this.out[0] ?? null
  }

  private ok(r: number, c: number): boolean {
    if (this.usedCol[c] || this.usedReg[this.reg[r * this.n + c]]) return false
    // unassigned rows hold -1, which must not count as "column -1"
    const up = r > 0 && this.queens[r - 1] >= 0 ? this.queens[r - 1] : -10
    const down = r < this.n - 1 && this.queens[r + 1] >= 0 ? this.queens[r + 1] : -10
    return Math.abs(up - c) > 1 && Math.abs(down - c) > 1
  }

  private search(): boolean {
    const n = this.n
    if (this.placed === n) {
      this.out.push(Array.from(this.queens))
      return this.out.length >= this.cap
    }
    // Most constrained unit (row or region) first.
    let best: number[] | null = null
    for (let r = 0; r < n && (best === null || best.length > 1); r++) {
      if (this.queens[r] >= 0) continue
      const cands: number[] = []
      for (let c = 0; c < n; c++) if (this.ok(r, c)) cands.push(r * n + c)
      if (cands.length === 0) return false
      if (best === null || cands.length < best.length) best = cands
    }
    for (let g = 0; g < n && (best === null || best.length > 1); g++) {
      if (this.usedReg[g]) continue
      const cands: number[] = []
      for (const k of this.regionCells[g]) {
        const r = Math.floor(k / n)
        if (this.queens[r] < 0 && this.ok(r, k % n)) cands.push(k)
      }
      if (cands.length === 0) return false
      if (best === null || cands.length < best.length) best = cands
    }
    if (best === null) return false
    if (this.rng) this.rng.shuffle(best)
    for (const k of best) {
      const r = Math.floor(k / n)
      const c = k % n
      this.queens[r] = c
      this.usedCol[c] = 1
      this.usedReg[this.reg[k]] = 1
      this.placed++
      const stop = this.search()
      this.placed--
      this.usedReg[this.reg[k]] = 0
      this.usedCol[c] = 0
      this.queens[r] = -1
      if (stop) return true
    }
    return false
  }
}

/* ------------------------------------------------------------------------ */
/* Uniqueness repair                                                        */
/* ------------------------------------------------------------------------ */

/** Is region g still connected once the cells in `skip` are removed from it? */
function regionConnectedWithout(regions: number[][], g: number, skip: ReadonlySet<number>): boolean {
  const n = regions.length
  let start = -1
  let total = 0
  for (let r = 0; r < n; r++) {
    for (let c = 0; c < n; c++) {
      if (regions[r][c] === g && !skip.has(r * n + c)) {
        total++
        if (start < 0) start = r * n + c
      }
    }
  }
  if (total === 0) return false
  const seen = new Uint8Array(n * n)
  seen[start] = 1
  const stack = [start]
  let count = 0
  while (stack.length) {
    const k = stack.pop()!
    count++
    const r = Math.floor(k / n)
    const c = k % n
    for (const [dr, dc] of ORTHO) {
      const nr = r + dr
      const nc = c + dc
      if (!inBoard(n, nr, nc)) continue
      const j = nr * n + nc
      if (regions[nr][nc] !== g || seen[j] || skip.has(j)) continue
      seen[j] = 1
      stack.push(j)
    }
  }
  return count === total
}

/** Reassign `cells` (all in region `from`) to region `to`. */
interface Move {
  cells: number[]
  from: number
  to: number
}

function regionSizes(regions: number[][]): number[] {
  const n = regions.length
  const sizes = new Array<number>(n).fill(0)
  for (const row of regions) for (const g of row) sizes[g]++
  return sizes
}

/** Apply (`forward`) or undo a move, keeping `sizes` in sync. */
function applyMove(regions: number[][], sizes: number[], m: Move, forward: boolean): void {
  const n = regions.length
  const to = forward ? m.to : m.from
  const from = forward ? m.from : m.to
  for (const k of m.cells) regions[Math.floor(k / n)][k % n] = to
  sizes[from] -= m.cells.length
  sizes[to] += m.cells.length
}

/**
 * Legal reassignments of cell `k` to a neighbouring region. The cell must not
 * be the intended queen, the source region must stay connected, keep at least
 * `minSize` cells and not belong to `protectedRegions` (rigid template
 * shapes). When `k` is an interior cell, two-cell moves through one bridging
 * neighbour are offered instead.
 */
function movesForCell(
  regions: number[][],
  sol: Solution,
  sizes: number[],
  k: number,
  minSize: number,
  protectedRegions?: ReadonlySet<number>,
): Move[] {
  const n = regions.length
  const r = Math.floor(k / n)
  const c = k % n
  if (sol[r] === c) return []
  const from = regions[r][c]
  if (sizes[from] <= minSize) return []
  if (protectedRegions?.has(from)) return []
  const otherRegionsAround = (kk: number): Set<number> => {
    const out = new Set<number>()
    const rr = Math.floor(kk / n)
    const cc = kk % n
    for (const [dr, dc] of ORTHO) {
      const nr = rr + dr
      const nc = cc + dc
      if (inBoard(n, nr, nc) && regions[nr][nc] !== from) out.add(regions[nr][nc])
    }
    return out
  }
  const targets = otherRegionsAround(k)
  if (targets.size) {
    if (!regionConnectedWithout(regions, from, new Set([k]))) return []
    return [...targets].map((to) => ({ cells: [k], from, to }))
  }
  // interior cell: bridge through a neighbour of the same region
  if (sizes[from] <= minSize + 1) return []
  const out: Move[] = []
  for (const [dr, dc] of ORTHO) {
    const nr = r + dr
    const nc = c + dc
    if (!inBoard(n, nr, nc) || sol[nr] === nc) continue
    const j = nr * n + nc
    const bridgeTargets = otherRegionsAround(j)
    if (!bridgeTargets.size) continue
    if (!regionConnectedWithout(regions, from, new Set([k, j]))) continue
    for (const to of bridgeTargets) out.push({ cells: [k, j], from, to })
  }
  return out
}

/**
 * Local search making the board uniquely solvable (in place), starting from the
 * intended solution `sol` (every region holds exactly one of its queens).
 *
 * Each iteration enumerates (a capped number of) solutions, ranks cells by how
 * many alternative solutions put a queen on them, and tries to reassign the
 * most-used cells to a neighbouring region. Reassigning a cell that carries an
 * alternative queen always kills that alternative (the target region would
 * hold two of its queens). The move leaving the fewest solutions wins; a tabu
 * list avoids cycles. When the alternatives' cells are unreachable the search
 * keeps one of them instead and attacks the previous favourite. Returns true
 * when the board ends up with exactly one solution (which may differ from `sol`).
 */
export function repairUniqueness(
  regions: number[][],
  sol: Solution,
  rng: Rng,
  options: {
    maxIters?: number
    /** Regions with a rigid designed shape: moves touching them are penalised. */
    protectedRegions?: ReadonlySet<number>
    trace?: (count: number, move: Move | null) => void
  } = {},
): boolean {
  const n = regions.length
  const maxIters = options.maxIters ?? 80
  const protectedRegions = options.protectedRegions ?? new Set<number>()
  const CAP = 40 // above this many solutions we rank cells from random samples
  const COARSE_CAP = 240 // cap used to compare moves while saturated
  const SAMPLES = 24
  const GIVE_UP_AFTER = 10 // non-improving iterations: the remaining alternatives are out of reach
  const TABU = 6
  const MAX_SWITCHES = 3
  // The solution we keep. It starts as `sol` but may switch to another current
  // solution when the alternatives' cells are out of reach (interior cells of
  // long strips): killing the original solution instead is just as good.
  let intended: Solution = sol.slice()
  let switches = 0
  const same = (a: Solution) => a.every((c, r) => c === intended[r])
  const sizes = regionSizes(regions)
  const recent: number[] = [] // recently moved cells (tabu)
  let stuck = 0
  let sols = new FastSolver(regions).count(CAP)
  options.trace?.(sols.length, null)

  // Moves keep every region ≥ 4 cells, so the repair never manufactures tiny
  // regions; strict moves additionally never take cells from rigid template
  // regions, relaxed ones (used when strict ones run out) may.
  const legalMoves = (k: number, relaxed: boolean) =>
    movesForCell(regions, intended, sizes, k, 4, relaxed ? undefined : protectedRegions)
  // Tie-breakers among equal solution counts (kept below 1 so a better count
  // always wins): avoid growing tiny regions, gutting small ones or touching
  // rigid shapes.
  const penalty = (m: Move) =>
    Math.min(
      0.95,
      (sizes[m.to] <= 3 ? 0.3 : 0) +
        (sizes[m.from] <= 5 ? 0.2 : 0) +
        (m.cells.length - 1) * 0.1 +
        (protectedRegions.has(m.from) ? 0.3 : 0) +
        (protectedRegions.has(m.to) ? 0.2 : 0),
    )

  for (let iter = 0; iter < maxIters && sols.length > 1; iter++) {
    const saturated = sols.length >= CAP
    if (stuck >= 3 && !saturated && switches < MAX_SWITCHES) {
      // Plateau: keep a different solution and attack the current one instead.
      const others = sols.filter((s) => !same(s))
      intended = rng.pick(others).slice()
      switches++
      stuck = 0
      recent.length = 0
    }
    // Rank cells by how often alternative solutions use them. When saturated,
    // the enumerated solutions share a common prefix, so use random samples.
    const pool: Solution[] = sols.slice()
    if (saturated) {
      const fs = new FastSolver(regions)
      for (let i = 0; i < SAMPLES; i++) {
        const s = fs.sample(rng)
        if (s) pool.push(s)
      }
    }
    const freq = new Map<number, number>()
    for (const s of pool) {
      if (same(s)) continue
      for (let r = 0; r < n; r++) if (s[r] !== intended[r]) freq.set(r * n + s[r], (freq.get(r * n + s[r]) ?? 0) + 1)
    }
    const ranked = [...freq.entries()].sort((a, b) => b[1] - a[1] || a[0] - b[0]).map(([k]) => k)
    const tabu = new Set(recent)
    const notTabu = (m: Move) => !m.cells.some((k) => tabu.has(k))
    const wantMoves = saturated ? 4 : 10
    let moves: Move[] = []
    for (const k of ranked) {
      moves.push(...legalMoves(k, false).filter(notTabu))
      if (moves.length >= wantMoves) break
    }
    if (moves.length < 3) {
      // An alternative queen sitting in a tiny region can only be killed by a
      // relaxed move (shrinking that region); allow it when nothing else works.
      for (const k of ranked) {
        moves.push(...legalMoves(k, true).filter(notTabu))
        if (moves.length >= wantMoves) break
      }
    }
    // Plateau or too few options: widen to every legal move, then relax tiny-region protection.
    if (!saturated && (stuck >= 2 || moves.length < 4)) {
      for (const relaxed of [false, true]) {
        const extra: Move[] = []
        for (let k = 0; k < n * n; k++) extra.push(...legalMoves(k, relaxed).filter(notTabu))
        rng.shuffle(extra)
        moves.push(...extra.slice(0, stuck >= 2 ? 24 : 12))
        if (moves.length >= 4) break
      }
    }
    if (!moves.length) {
      if (!saturated) return false
      for (let k = 0; k < n * n && moves.length < 4; k++) moves.push(...legalMoves(k, true))
      if (!moves.length) return false
    }
    rng.shuffle(moves)

    let best: Move | null = null
    let bestSols: Solution[] = sols
    if (saturated) {
      // Coarse evaluation of the few highest-frequency moves with a larger cap.
      let bestScore = Infinity
      for (const m of moves.slice(0, 6)) {
        applyMove(regions, sizes, m, true)
        const count = new FastSolver(regions).count(COARSE_CAP).length
        applyMove(regions, sizes, m, false)
        const score = count + penalty(m)
        if (score < bestScore) {
          bestScore = score
          best = m
        }
      }
      if (!best) return false
      applyMove(regions, sizes, best, true)
      bestSols = new FastSolver(regions).count(CAP)
    } else {
      let bestScore = Infinity
      for (const m of moves) {
        applyMove(regions, sizes, m, true)
        const trial = new FastSolver(regions).count(CAP)
        applyMove(regions, sizes, m, false)
        const score = trial.length + penalty(m)
        if (score < bestScore) {
          bestScore = score
          best = m
          bestSols = trial
        }
      }
      if (!best) return false
      applyMove(regions, sizes, best, true)
    }
    stuck = bestSols.length < sols.length ? 0 : stuck + 1
    if (stuck >= GIVE_UP_AFTER) return false // cheaper to build a fresh board
    sols = bestSols
    recent.push(...best.cells)
    while (recent.length > TABU) recent.shift()
    options.trace?.(sols.length, best)
  }
  return sols.length === 1 && countSolutions({ size: n, regions }, 2) === 1
}

/* ------------------------------------------------------------------------ */
/* Public API                                                               */
/* ------------------------------------------------------------------------ */

/** Layouts produced in this session (symmetric canonical key → puzzle id), for diversity. */
const history = new Map<string, string>()
const HISTORY_LIMIT = 5000

/** Forget the layouts produced so far (e.g. when starting a new batch). */
export function resetGeneratorHistory(): void {
  history.clear()
}

function puzzleName(size: number, difficulty: Difficulty): string {
  return `Generated ${size}×${size} · ${difficulty}`
}

/**
 * Generate a puzzle. Never throws for sizes 7–11 with the default options:
 * when the requested difficulty is not reached within `maxAttempts`, the first
 * unique board found is returned with its actual rating.
 */
export function generatePuzzle(options: GeneratorOptions = {}): Puzzle {
  const size = Math.max(MIN_SIZE, Math.min(MAX_SIZE, Math.round(options.size ?? 8)))
  const seed = options.seed ?? randomSeed()
  const maxAttempts = Math.max(1, options.maxAttempts ?? 60)
  const wanted = options.difficulty ?? 'any'
  const rng = makeRng(`${size}:${seed}`)
  const id = `gen-${size}-${seed}`

  const finish = (regions: number[][], difficulty: Difficulty): Puzzle => {
    if (history.size >= HISTORY_LIMIT) history.clear()
    history.set(symmetricCanonicalKey(regions), id)
    return {
      id,
      size,
      regions,
      source: 'generated',
      name: puzzleName(size, difficulty),
      difficulty,
      attribution: `seed:${seed}`,
    }
  }

  let fallback: { regions: number[][]; difficulty: Difficulty } | null = null
  // Hard cap so a pathological configuration cannot loop forever; unique boards
  // are found within a handful of attempts in practice.
  const hardCap = Math.max(maxAttempts * 20, 2000)
  for (let attempt = 0; attempt < hardCap; attempt++) {
    const solution = randomSolution(size, rng)
    const style = sampleStyle(rng, size, wanted)
    const roles: Role[] = []
    let regions = buildRegions(size, solution, rng, style, undefined, roles)
    if (regions.some((row) => row.some((g) => g < 0))) regions = growRegions(size, solution, rng)
    const protectedRegions = new Set<number>()
    roles.forEach((role, g) => {
      if (RIGID_ROLES.has(role)) protectedRegions.add(g)
    })
    if (!repairUniqueness(regions, solution, rng, { protectedRegions })) continue
    regions = normalizeRegions(regions)
    const prev = history.get(symmetricCanonicalKey(regions))
    if (prev !== undefined && prev !== id) continue // produced from another seed already
    const difficulty = rateDifficulty({ size, regions })
    // LinkedIn boards are almost never "expert" (≈1 %): with 'any' we accept an
    // expert board only after a few attempts failed to produce anything else.
    const accept = wanted === 'any' ? difficulty !== 'expert' || attempt >= 6 : difficulty === wanted
    if (accept) return finish(regions, difficulty)
    if (!fallback) fallback = { regions, difficulty }
    if (attempt + 1 >= maxAttempts) break
  }
  if (fallback) return finish(fallback.regions, fallback.difficulty)
  throw new Error(`Could not generate a unique ${size}×${size} puzzle from seed ${seed}`)
}

/** Number of solutions of a layout, capped at `limit` (exposed for scripts/tests). */
export function solutionCount(regions: number[][], limit = 2): number {
  return countSolutions({ size: regions.length, regions }, limit)
}
