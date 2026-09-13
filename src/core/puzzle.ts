import type { Board, Cell, CellMark, Puzzle, Solution } from './types'

/** Characters used to encode region indices in compact strings (0-9, a-z). */
const ALPHABET = '0123456789abcdefghijklmnopqrstuvwxyz'

export const MIN_SIZE = 4
export const MAX_SIZE = 16

/**
 * Validate that `regions` describes a legal Queens board:
 * square N×N, exactly N regions indexed 0..N-1, each non-empty and
 * orthogonally connected. Returns a list of human-readable problems
 * (empty when valid).
 */
export function validateRegions(regions: number[][]): string[] {
  const problems: string[] = []
  const n = regions.length
  if (n < MIN_SIZE || n > MAX_SIZE) problems.push(`Board size must be between ${MIN_SIZE} and ${MAX_SIZE}`)
  for (let r = 0; r < n; r++) {
    if (regions[r].length !== n) {
      problems.push(`Row ${r + 1} has ${regions[r].length} cells, expected ${n}`)
      return problems
    }
  }
  const counts = new Array<number>(n).fill(0)
  for (let r = 0; r < n; r++) {
    for (let c = 0; c < n; c++) {
      const g = regions[r][c]
      if (!Number.isInteger(g) || g < 0 || g >= n) {
        problems.push(`Cell (${r + 1},${c + 1}) has invalid region ${g}`)
        return problems
      }
      counts[g]++
    }
  }
  const empty = counts.map((k, i) => (k === 0 ? i : -1)).filter((i) => i >= 0)
  if (empty.length) problems.push(`Board has ${n - empty.length} regions, expected ${n}`)
  for (let g = 0; g < n; g++) {
    if (counts[g] > 0 && !isRegionConnected(regions, g)) problems.push(`Region ${g} is not connected`)
  }
  return problems
}

export function isRegionConnected(regions: number[][], g: number): boolean {
  const n = regions.length
  let start: Cell | null = null
  let total = 0
  for (let r = 0; r < n; r++) {
    for (let c = 0; c < n; c++) {
      if (regions[r][c] === g) {
        total++
        if (!start) start = { row: r, col: c }
      }
    }
  }
  if (!start) return false
  const seen = new Set<number>([start.row * n + start.col])
  const stack: Cell[] = [start]
  while (stack.length) {
    const { row, col } = stack.pop()!
    for (const [dr, dc] of ORTHO) {
      const r = row + dr
      const c = col + dc
      if (r < 0 || c < 0 || r >= n || c >= n) continue
      if (regions[r][c] !== g) continue
      const key = r * n + c
      if (seen.has(key)) continue
      seen.add(key)
      stack.push({ row: r, col: c })
    }
  }
  return seen.size === total
}

export const ORTHO: ReadonlyArray<readonly [number, number]> = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
]

export const NEIGHBOURS8: ReadonlyArray<readonly [number, number]> = [
  [-1, -1],
  [-1, 0],
  [-1, 1],
  [0, -1],
  [0, 1],
  [1, -1],
  [1, 0],
  [1, 1],
]

/**
 * Compact, URL-safe encoding: `<size>:<cells>` where cells are the region
 * indices in row-major order using 0-9a-z. Example for a 4×4 board:
 * `4:0011022132213333`.
 */
export function encodeRegions(regions: number[][]): string {
  const n = regions.length
  let out = `${n}:`
  for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) out += ALPHABET[regions[r][c]]
  return out
}

export function decodeRegions(code: string): number[][] {
  const m = /^(\d+):([0-9a-z]+)$/i.exec(code.trim())
  if (!m) throw new Error('Invalid puzzle code')
  const n = parseInt(m[1], 10)
  const cells = m[2].toLowerCase()
  if (cells.length !== n * n) throw new Error(`Expected ${n * n} cells, got ${cells.length}`)
  const regions: number[][] = []
  for (let r = 0; r < n; r++) {
    const row: number[] = []
    for (let c = 0; c < n; c++) row.push(ALPHABET.indexOf(cells[r * n + c]))
    regions.push(row)
  }
  return regions
}

/**
 * Parse a free-form text grid where each row is a line and each cell is a
 * single character (letters, digits or any symbol), optionally separated by
 * spaces or commas. Region labels are renumbered to 0..N-1 in order of first
 * appearance. Blank lines are ignored.
 */
export function parseTextGrid(text: string): number[][] {
  const lines = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0)
  const rows = lines.map((l) => {
    const tokens = /[\s,;|]/.test(l) ? l.split(/[\s,;|]+/).filter(Boolean) : Array.from(l)
    return tokens
  })
  const n = rows.length
  const labels = new Map<string, number>()
  const regions: number[][] = []
  for (const tokens of rows) {
    if (tokens.length !== n) throw new Error(`Grid is not square: ${n} rows but a row has ${tokens.length} cells`)
    const row: number[] = []
    for (const t of tokens) {
      let g = labels.get(t)
      if (g === undefined) {
        g = labels.size
        labels.set(t, g)
      }
      row.push(g)
    }
    regions.push(row)
  }
  return regions
}

/** Renumber regions to 0..k-1 by first appearance (row-major). */
export function normalizeRegions(regions: number[][]): number[][] {
  const map = new Map<number, number>()
  return regions.map((row) =>
    row.map((g) => {
      let v = map.get(g)
      if (v === undefined) {
        v = map.size
        map.set(g, v)
      }
      return v
    }),
  )
}

/** A canonical key that identifies the same layout regardless of region labels. */
export function canonicalKey(regions: number[][]): string {
  return encodeRegions(normalizeRegions(regions))
}

/** All 8 symmetries (rotations + reflections) of a board. */
export function symmetries(regions: number[][]): number[][][] {
  const n = regions.length
  const out: number[][][] = []
  let cur = regions
  for (let i = 0; i < 4; i++) {
    out.push(cur)
    out.push(cur.map((row) => row.slice().reverse()))
    // rotate 90° clockwise
    const rot: number[][] = []
    for (let r = 0; r < n; r++) {
      const row: number[] = []
      for (let c = 0; c < n; c++) row.push(cur[n - 1 - c][r])
      rot.push(row)
    }
    cur = rot
  }
  return out
}

/** Canonical key invariant under the 8 board symmetries and region relabelling. */
export function symmetricCanonicalKey(regions: number[][]): string {
  return symmetries(regions)
    .map((s) => canonicalKey(s))
    .sort()[0]
}

export function emptyBoard(size: number): Board {
  return Array.from({ length: size }, () => new Array<CellMark>(size).fill('empty'))
}

export function cloneBoard(board: Board): Board {
  return board.map((row) => row.slice())
}

export function queensOf(board: Board): Cell[] {
  const out: Cell[] = []
  for (let r = 0; r < board.length; r++) {
    for (let c = 0; c < board.length; c++) if (board[r][c] === 'queen') out.push({ row: r, col: c })
  }
  return out
}

/**
 * Cells that a queen at (row,col) rules out: its row, its column, its region
 * and the 8 surrounding cells. The queen's own cell is excluded.
 */
export function cellsEliminatedBy(puzzle: Pick<Puzzle, 'size' | 'regions'>, row: number, col: number): Cell[] {
  const n = puzzle.size
  const g = puzzle.regions[row][col]
  const seen = new Set<number>()
  const out: Cell[] = []
  const add = (r: number, c: number) => {
    if (r < 0 || c < 0 || r >= n || c >= n) return
    if (r === row && c === col) return
    const key = r * n + c
    if (seen.has(key)) return
    seen.add(key)
    out.push({ row: r, col: c })
  }
  for (let i = 0; i < n; i++) {
    add(row, i)
    add(i, col)
  }
  for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) if (puzzle.regions[r][c] === g) add(r, c)
  for (const [dr, dc] of NEIGHBOURS8) add(row + dr, col + dc)
  return out
}

/**
 * Cells holding a queen that violates a rule against another queen: shared
 * row, column or region, or touching. Returns a set of `row*size+col` keys.
 */
export function conflictingQueens(puzzle: Pick<Puzzle, 'size' | 'regions'>, board: Board): Set<number> {
  const n = puzzle.size
  const qs = queensOf(board)
  const bad = new Set<number>()
  for (let i = 0; i < qs.length; i++) {
    for (let j = i + 1; j < qs.length; j++) {
      const a = qs[i]
      const b = qs[j]
      const touching = Math.abs(a.row - b.row) <= 1 && Math.abs(a.col - b.col) <= 1
      if (
        a.row === b.row ||
        a.col === b.col ||
        puzzle.regions[a.row][a.col] === puzzle.regions[b.row][b.col] ||
        touching
      ) {
        bad.add(a.row * n + a.col)
        bad.add(b.row * n + b.col)
      }
    }
  }
  return bad
}

/** True when the board holds exactly N queens and none conflict. */
export function isSolved(puzzle: Pick<Puzzle, 'size' | 'regions'>, board: Board): boolean {
  const qs = queensOf(board)
  if (qs.length !== puzzle.size) return false
  return conflictingQueens(puzzle, board).size === 0
}

export function boardFromSolution(size: number, solution: Solution): Board {
  const b = emptyBoard(size)
  solution.forEach((c, r) => {
    b[r][c] = 'queen'
  })
  return b
}

/** Deterministic short hash of a string (FNV-1a, base36). */
export function shortHash(s: string): string {
  let h = 0x811c9dc5
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 0x01000193) >>> 0
  }
  return h.toString(36)
}
