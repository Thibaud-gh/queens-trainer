/**
 * Region shape analysis shared by the pattern-analysis script, the generator
 * tests and (indirectly) the generator's style targets.
 *
 * Browser-safe: no Node APIs.
 */
import { ORTHO, canonicalKey } from './puzzle'
import type { Cell } from './types'

export type ShapeClass =
  | 'single' // 1 cell
  | 'domino' // 2 cells
  | 'full-line' // straight line spanning a whole row or column
  | 'segment' // straight line of ≥ 3 cells, shorter than the board
  | 'rectangle' // solid block, both sides ≥ 2
  | 'L' // two straight arms sharing a corner
  | 'ring' // thin region (no 2×2 block) that fully encloses other cells
  | 'snake' // thin region (no 2×2 block), not a line or an L
  | 'blob' // anything else (irregular, contains a 2×2 block)

export const SHAPE_CLASSES: readonly ShapeClass[] = [
  'single',
  'domino',
  'full-line',
  'segment',
  'rectangle',
  'L',
  'ring',
  'snake',
  'blob',
]

export interface RegionInfo {
  index: number
  size: number
  cells: Cell[]
  bbox: { r0: number; c0: number; r1: number; c1: number }
  shape: ShapeClass
  /** Has a 2×2 block of its own cells. */
  thick: boolean
  touchesBorder: boolean
  /** Regions completely enclosed by this region (no path to the border avoiding it). */
  encloses: number[]
  /** Number of distinct neighbouring regions. */
  neighbours: number
}

export type SymmetryName = 'mirror-h' | 'mirror-v' | 'rot90' | 'rot180' | 'diag' | 'anti-diag'

export interface BoardStats {
  size: number
  regions: RegionInfo[]
  sizes: number[]
  /** Fraction of regions with 1, 2 or 3 cells. */
  tinyShare: number
  /** Fraction of regions with 1 or 2 cells. */
  singleDominoShare: number
  /** Largest region as a fraction of N². */
  largestShare: number
  /** Some region covers ≥ 30 % of the board. */
  hasBackground: boolean
  shapeCounts: Record<ShapeClass, number>
  symmetries: SymmetryName[]
  /** Fraction of regions touching the border. */
  borderShare: number
  /** Number of unordered pairs of regions sharing an edge. */
  adjacencies: number
  /** Number of regions that fully enclose another region. */
  enclosingRegions: number
  /** Number of regions that fully enclose a single-cell region. */
  enclosingSingles: number
}

function transforms(regions: number[][]): Record<SymmetryName, number[][]> {
  const n = regions.length
  const make = (f: (r: number, c: number) => number) =>
    Array.from({ length: n }, (_, r) => Array.from({ length: n }, (_, c) => f(r, c)))
  return {
    'mirror-h': make((r, c) => regions[r][n - 1 - c]),
    'mirror-v': make((r, c) => regions[n - 1 - r][c]),
    rot90: make((r, c) => regions[n - 1 - c][r]),
    rot180: make((r, c) => regions[n - 1 - r][n - 1 - c]),
    diag: make((r, c) => regions[c][r]),
    'anti-diag': make((r, c) => regions[n - 1 - c][n - 1 - r]),
  }
}

/** Names of the non-trivial board symmetries that map the partition onto itself. */
export function boardSymmetries(regions: number[][]): SymmetryName[] {
  const key = canonicalKey(regions)
  const out: SymmetryName[] = []
  for (const [name, t] of Object.entries(transforms(regions)) as Array<[SymmetryName, number[][]]>) {
    if (canonicalKey(t) === key) out.push(name)
  }
  return out
}

function hasThickBlock(cells: Cell[], has: (r: number, c: number) => boolean): boolean {
  for (const { row, col } of cells) {
    if (has(row + 1, col) && has(row, col + 1) && has(row + 1, col + 1)) return true
  }
  return false
}

function isLShape(cells: Cell[], bbox: RegionInfo['bbox']): boolean {
  const h = bbox.r1 - bbox.r0 + 1
  const w = bbox.c1 - bbox.c0 + 1
  if (h < 2 || w < 2 || cells.length !== h + w - 1) return false
  const corners = [
    [bbox.r0, bbox.c0],
    [bbox.r0, bbox.c1],
    [bbox.r1, bbox.c0],
    [bbox.r1, bbox.c1],
  ]
  return corners.some(([cr, cc]) => cells.every((x) => x.row === cr || x.col === cc))
}

/** Regions fully enclosed by region `g` (their cells cannot reach the border without crossing `g`). */
function enclosedRegions(regions: number[][], g: number): number[] {
  const n = regions.length
  const seen = new Uint8Array(n * n)
  const enclosed = new Set<number>()
  for (let r = 0; r < n; r++) {
    for (let c = 0; c < n; c++) {
      if (regions[r][c] === g || seen[r * n + c]) continue
      // flood a component of non-g cells
      const stack = [r * n + c]
      seen[r * n + c] = 1
      const members = new Set<number>()
      let touchesBorder = false
      while (stack.length) {
        const k = stack.pop()!
        const kr = Math.floor(k / n)
        const kc = k % n
        members.add(regions[kr][kc])
        if (kr === 0 || kc === 0 || kr === n - 1 || kc === n - 1) touchesBorder = true
        for (const [dr, dc] of ORTHO) {
          const nr = kr + dr
          const nc = kc + dc
          if (nr < 0 || nc < 0 || nr >= n || nc >= n) continue
          if (regions[nr][nc] === g || seen[nr * n + nc]) continue
          seen[nr * n + nc] = 1
          stack.push(nr * n + nc)
        }
      }
      if (!touchesBorder) for (const m of members) enclosed.add(m)
    }
  }
  return [...enclosed].sort((a, b) => a - b)
}

/** Classify every region of a board. */
export function analyzeRegions(regions: number[][]): RegionInfo[] {
  const n = regions.length
  const cellsOf: Cell[][] = Array.from({ length: n }, () => [])
  const neighbourSets: Array<Set<number>> = Array.from({ length: n }, () => new Set())
  for (let r = 0; r < n; r++) {
    for (let c = 0; c < n; c++) {
      const g = regions[r][c]
      cellsOf[g].push({ row: r, col: c })
      for (const [dr, dc] of ORTHO) {
        const nr = r + dr
        const nc = c + dc
        if (nr < 0 || nc < 0 || nr >= n || nc >= n) continue
        if (regions[nr][nc] !== g) neighbourSets[g].add(regions[nr][nc])
      }
    }
  }
  return cellsOf.map((cells, g) => {
    const has = (r: number, c: number) => r >= 0 && c >= 0 && r < n && c < n && regions[r][c] === g
    const bbox = {
      r0: Math.min(...cells.map((x) => x.row)),
      c0: Math.min(...cells.map((x) => x.col)),
      r1: Math.max(...cells.map((x) => x.row)),
      c1: Math.max(...cells.map((x) => x.col)),
    }
    const h = bbox.r1 - bbox.r0 + 1
    const w = bbox.c1 - bbox.c0 + 1
    const thick = hasThickBlock(cells, has)
    const encloses = enclosedRegions(regions, g)
    const touchesBorder = cells.some((x) => x.row === 0 || x.col === 0 || x.row === n - 1 || x.col === n - 1)
    let shape: ShapeClass
    if (cells.length === 1) shape = 'single'
    else if (cells.length === 2) shape = 'domino'
    else if (h === 1 || w === 1) shape = cells.length === n ? 'full-line' : 'segment'
    else if (cells.length === h * w) shape = 'rectangle'
    else if (isLShape(cells, bbox)) shape = 'L'
    else if (encloses.length && !thick) shape = 'ring'
    else if (!thick) shape = 'snake'
    else shape = 'blob'
    return {
      index: g,
      size: cells.length,
      cells,
      bbox,
      shape,
      thick,
      touchesBorder,
      encloses,
      neighbours: neighbourSets[g].size,
    }
  })
}

export function emptyShapeCounts(): Record<ShapeClass, number> {
  const out = {} as Record<ShapeClass, number>
  for (const s of SHAPE_CLASSES) out[s] = 0
  return out
}

/** Full statistics for one board. */
export function boardStats(regions: number[][]): BoardStats {
  const n = regions.length
  const infos = analyzeRegions(regions)
  const sizes = infos.map((i) => i.size)
  const shapeCounts = emptyShapeCounts()
  let adjacencies = 0
  for (const i of infos) {
    shapeCounts[i.shape]++
    adjacencies += i.neighbours
  }
  const singleRegions = new Set(infos.filter((i) => i.size === 1).map((i) => i.index))
  return {
    size: n,
    regions: infos,
    sizes,
    tinyShare: sizes.filter((s) => s <= 3).length / n,
    singleDominoShare: sizes.filter((s) => s <= 2).length / n,
    largestShare: Math.max(...sizes) / (n * n),
    hasBackground: Math.max(...sizes) / (n * n) >= 0.3,
    shapeCounts,
    symmetries: boardSymmetries(regions),
    borderShare: infos.filter((i) => i.touchesBorder).length / n,
    adjacencies: adjacencies / 2,
    enclosingRegions: infos.filter((i) => i.encloses.length > 0).length,
    enclosingSingles: infos.filter((i) => i.encloses.some((e) => singleRegions.has(e))).length,
  }
}

/** ASCII rendering of a board: one letter per region, `Q` marks queens when a solution is given. */
export function renderAscii(regions: number[][], solution?: number[]): string {
  const letters = 'ABCDEFGHIJKLMNOP'
  return regions
    .map((row, r) =>
      row
        .map((g, c) => {
          const ch = letters[g] ?? '?'
          return solution && solution[r] === c ? ch.toLowerCase() + '*' : ch + ' '
        })
        .join('')
        .trimEnd(),
    )
    .join('\n')
}
