import type { Puzzle, Solution } from './types'

/**
 * Enumerate solutions of a Queens puzzle with plain backtracking, row by row.
 *
 * Constraints enforced:
 *  - one queen per row (implicit), column and region
 *  - no two queens in adjacent cells (including diagonals). Since rows are
 *    filled top-down and each row holds exactly one queen, the only adjacency
 *    that can occur is between consecutive rows with |Δcol| ≤ 1.
 *
 * @param limit stop after this many solutions (default 2, enough to test uniqueness)
 */
export function solve(puzzle: Pick<Puzzle, 'size' | 'regions'>, limit = 2): Solution[] {
  const n = puzzle.size
  const regions = puzzle.regions
  const solutions: Solution[] = []
  const usedCol = new Array<boolean>(n).fill(false)
  const usedRegion = new Array<boolean>(n).fill(false)
  const cols: number[] = new Array<number>(n).fill(-1)

  // Cheap pruning: a region whose cells all lie in rows already passed can no
  // longer receive a queen. Precompute the last row each region appears in.
  const lastRowOfRegion = new Array<number>(n).fill(-1)
  for (let r = 0; r < n; r++) {
    for (let c = 0; c < n; c++) lastRowOfRegion[regions[r][c]] = r
  }
  // regionsEndingAt[r] = regions whose last row is r; after placing row r all
  // of these must already be used.
  const regionsEndingAt: number[][] = Array.from({ length: n }, () => [])
  for (let g = 0; g < n; g++) {
    if (lastRowOfRegion[g] >= 0) regionsEndingAt[lastRowOfRegion[g]].push(g)
  }

  function place(row: number): boolean {
    if (row === n) {
      solutions.push(cols.slice())
      return solutions.length >= limit
    }
    const prev = row > 0 ? cols[row - 1] : -10
    for (let c = 0; c < n; c++) {
      if (usedCol[c]) continue
      if (Math.abs(c - prev) <= 1) continue
      const g = regions[row][c]
      if (usedRegion[g]) continue
      usedCol[c] = true
      usedRegion[g] = true
      cols[row] = c
      let ok = true
      for (const eg of regionsEndingAt[row]) {
        if (!usedRegion[eg]) {
          ok = false
          break
        }
      }
      if (ok && place(row + 1)) return true
      usedCol[c] = false
      usedRegion[g] = false
      cols[row] = -1
    }
    return false
  }

  place(0)
  return solutions
}

/** Number of solutions, capped at `limit`. */
export function countSolutions(puzzle: Pick<Puzzle, 'size' | 'regions'>, limit = 2): number {
  return solve(puzzle, limit).length
}

/** True when the puzzle has exactly one solution. */
export function hasUniqueSolution(puzzle: Pick<Puzzle, 'size' | 'regions'>): boolean {
  return countSolutions(puzzle, 2) === 1
}

/** The unique solution, or null when there are zero or several. */
export function uniqueSolution(puzzle: Pick<Puzzle, 'size' | 'regions'>): Solution | null {
  const s = solve(puzzle, 2)
  return s.length === 1 ? s[0] : null
}
