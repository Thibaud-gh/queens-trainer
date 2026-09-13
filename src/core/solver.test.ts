import { describe, expect, it } from 'vitest'
import linkedinPuzzles from '../data/linkedin-puzzles.json'
import { boardFromSolution, isSolved, parseTextGrid, validateRegions } from './puzzle'
import { countSolutions, hasUniqueSolution, solve, uniqueSolution } from './solver'

/** Two single-cell regions that touch diagonally can never both hold a queen. */
const IMPOSSIBLE4 = parseTextGrid(`
  A C C C
  C B C C
  C C C D
  D D D D
`)

/** Exactly one solution: queens at (0,1) (1,3) (2,0) (3,2). */
const UNIQUE4 = parseTextGrid(`
  A A B B
  C C B B
  C D D B
  C D D D
`)

/** Every row is a region: on 4×4 there are two no-touch permutations. */
const ROWS4 = parseTextGrid(`
  A A A A
  B B B B
  C C C C
  D D D D
`)

/** Every row is a region on 6×6: many solutions, used to exercise `limit`. */
const ROWS6 = Array.from({ length: 6 }, (_, r) => new Array<number>(6).fill(r))

describe('solve on hand-made boards', () => {
  it('fixtures are legal boards', () => {
    for (const regions of [IMPOSSIBLE4, UNIQUE4, ROWS4, ROWS6]) expect(validateRegions(regions)).toEqual([])
  })

  it('finds no solution for an impossible board', () => {
    const puzzle = { size: 4, regions: IMPOSSIBLE4 }
    expect(solve(puzzle)).toEqual([])
    expect(countSolutions(puzzle)).toBe(0)
    expect(hasUniqueSolution(puzzle)).toBe(false)
    expect(uniqueSolution(puzzle)).toBeNull()
  })

  it('finds exactly one solution for a unique board', () => {
    const puzzle = { size: 4, regions: UNIQUE4 }
    expect(solve(puzzle)).toEqual([[1, 3, 0, 2]])
    expect(countSolutions(puzzle)).toBe(1)
    expect(hasUniqueSolution(puzzle)).toBe(true)
    expect(uniqueSolution(puzzle)).toEqual([1, 3, 0, 2])
    expect(isSolved(puzzle, boardFromSolution(4, [1, 3, 0, 2]))).toBe(true)
  })

  it('finds both solutions for a two-solution board', () => {
    const puzzle = { size: 4, regions: ROWS4 }
    const solutions = solve(puzzle, 10)
    expect(solutions).toHaveLength(2)
    expect(solutions).toContainEqual([1, 3, 0, 2])
    expect(solutions).toContainEqual([2, 0, 3, 1])
    expect(countSolutions(puzzle)).toBe(2)
    expect(hasUniqueSolution(puzzle)).toBe(false)
    expect(uniqueSolution(puzzle)).toBeNull()
  })

  it('every returned solution satisfies the rules', () => {
    const puzzle = { size: 6, regions: ROWS6 }
    for (const s of solve(puzzle, 50)) {
      expect(s).toHaveLength(6)
      expect(isSolved(puzzle, boardFromSolution(6, s))).toBe(true)
    }
  })
})

describe('solve respects limit', () => {
  const puzzle = { size: 6, regions: ROWS6 }

  it('stops at the requested number of solutions', () => {
    expect(solve(puzzle, 1)).toHaveLength(1)
    expect(solve(puzzle, 2)).toHaveLength(2)
    expect(solve(puzzle, 3)).toHaveLength(3)
    expect(countSolutions(puzzle, 5)).toBe(5)
  })

  it('defaults to 2, enough for a uniqueness check', () => {
    expect(solve(puzzle)).toHaveLength(2)
  })

  it('returns everything when the limit exceeds the solution count', () => {
    const all = solve(puzzle, 10_000)
    expect(all.length).toBeGreaterThan(5)
    expect(solve(puzzle, all.length)).toHaveLength(all.length)
    // no duplicates
    expect(new Set(all.map((s) => s.join(','))).size).toBe(all.length)
  })

  it('a two-solution board with limit 1 returns only the first', () => {
    expect(solve({ size: 4, regions: ROWS4 }, 1)).toEqual([[1, 3, 0, 2]])
  })
})

describe('LinkedIn archive', () => {
  it('contains 608 boards numbered #1–#616', () => {
    expect(linkedinPuzzles).toHaveLength(608)
    const numbers = linkedinPuzzles.map((p) => p.number)
    expect(Math.min(...numbers)).toBe(1)
    expect(Math.max(...numbers)).toBe(616)
    expect(new Set(numbers).size).toBe(608)
    expect(new Set(linkedinPuzzles.map((p) => p.id)).size).toBe(608)
  })

  it('every board has exactly one solution (all 608)', () => {
    const start = performance.now()
    const failures: string[] = []
    for (const p of linkedinPuzzles) {
      const solutions = solve(p, 2)
      if (solutions.length !== 1) failures.push(`${p.id}: ${solutions.length} solutions`)
      else if (!isSolved(p, boardFromSolution(p.size, solutions[0]))) failures.push(`${p.id}: invalid solution`)
    }
    expect(failures).toEqual([])
    expect(performance.now() - start).toBeLessThan(5000)
  })

  it('every board is a legal layout, except the April Fools board #336 which has disconnected regions', () => {
    for (const p of linkedinPuzzles) {
      const problems = validateRegions(p.regions)
      expect(p.regions).toHaveLength(p.size)
      if (p.number === 336) {
        expect(problems.length).toBeGreaterThan(0)
        expect(problems.every((m) => /not connected/.test(m))).toBe(true)
        expect(p.attribution).toMatch(/disconnected/)
      } else {
        expect(problems, p.id).toEqual([])
      }
    }
  })
})
