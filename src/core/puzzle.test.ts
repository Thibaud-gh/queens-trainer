import { describe, expect, it } from 'vitest'
import {
  boardFromSolution,
  canonicalKey,
  cellsEliminatedBy,
  cloneBoard,
  conflictingQueens,
  decodeRegions,
  emptyBoard,
  encodeRegions,
  isRegionConnected,
  isSolved,
  normalizeRegions,
  parseTextGrid,
  queensOf,
  shortHash,
  symmetricCanonicalKey,
  symmetries,
  validateRegions,
} from './puzzle'
import type { Board } from './types'

/**
 * 4×4 board with a single solution: queens at (0,1) (1,3) (2,0) (3,2).
 *
 *   A A B B
 *   C C B B
 *   C D D B
 *   C D D D
 */
const UNIQUE4 = [
  [0, 0, 1, 1],
  [2, 2, 1, 1],
  [2, 3, 3, 1],
  [2, 3, 3, 3],
]
const UNIQUE4_SOLUTION = [1, 3, 0, 2]

/** Every row is its own region; on 4×4 this has two solutions. */
const ROWS4 = [
  [0, 0, 0, 0],
  [1, 1, 1, 1],
  [2, 2, 2, 2],
  [3, 3, 3, 3],
]

/** Board with no symmetry at all (all 8 transforms are distinct). */
const ASYMMETRIC5 = parseTextGrid(`
  a a b b b
  a c c b d
  a c e e d
  a c c e d
  a a a e d
`)

function placeQueens(size: number, cells: Array<[number, number]>): Board {
  const b = emptyBoard(size)
  for (const [r, c] of cells) b[r][c] = 'queen'
  return b
}

describe('encodeRegions / decodeRegions', () => {
  it('round-trips a board', () => {
    const code = encodeRegions(UNIQUE4)
    expect(code).toBe('4:0011221123312333')
    expect(decodeRegions(code)).toEqual(UNIQUE4)
  })

  it('round-trips a board using letters for indices above 9', () => {
    const n = 12
    const regions = Array.from({ length: n }, (_, r) => new Array<number>(n).fill(r))
    const code = encodeRegions(regions)
    expect(code.startsWith('12:')).toBe(true)
    expect(code).toContain('b')
    expect(decodeRegions(code)).toEqual(regions)
  })

  it('is tolerant of surrounding whitespace and upper case', () => {
    expect(decodeRegions('  4:0011221123312333 \n')).toEqual(UNIQUE4)
    const n = 11
    const regions = Array.from({ length: n }, (_, r) => new Array<number>(n).fill(r))
    expect(decodeRegions(encodeRegions(regions).toUpperCase())).toEqual(regions)
  })

  it('rejects malformed codes', () => {
    expect(() => decodeRegions('nope')).toThrow('Invalid puzzle code')
    expect(() => decodeRegions('4:0011')).toThrow('Expected 16 cells, got 4')
    expect(() => decodeRegions('4:00112211233123334')).toThrow('Expected 16 cells, got 17')
    expect(() => decodeRegions('4:00112211233123!3')).toThrow('Invalid puzzle code')
  })
})

describe('parseTextGrid', () => {
  it('parses one character per cell', () => {
    expect(parseTextGrid('AABB\nCCBB\nCDDB\nCDDD')).toEqual(UNIQUE4)
  })

  it('parses space-separated tokens and renumbers by first appearance', () => {
    const text = 'x x y y\nz z y y\nz w w y\nz w w w'
    expect(parseTextGrid(text)).toEqual(UNIQUE4)
  })

  it('parses comma-separated (and mixed) tokens, including multi-char labels', () => {
    const text = 'r1,r1,r2,r2\nr3, r3, r2, r2\nr3;r4;r4;r2\nr3 | r4 | r4 | r4'
    expect(parseTextGrid(text)).toEqual(UNIQUE4)
  })

  it('ignores blank lines, indentation and CRLF line endings', () => {
    const text = '\r\n  AABB \r\n\r\n  CCBB\r\n  CDDB\r\n  CDDD\r\n\r\n'
    expect(parseTextGrid(text)).toEqual(UNIQUE4)
  })

  it('throws for a non-square grid', () => {
    expect(() => parseTextGrid('AAB\nCCB\nCDB\nCDD')).toThrow(/not square/)
    expect(() => parseTextGrid('AABB\nCCB\nCDDB\nCDDD')).toThrow(/not square/)
  })
})

describe('validateRegions', () => {
  it('accepts a legal board', () => {
    expect(validateRegions(UNIQUE4)).toEqual([])
    expect(validateRegions(ASYMMETRIC5)).toEqual([])
  })

  it('reports the wrong number of regions', () => {
    const threeRegions = [
      [0, 0, 1, 1],
      [0, 0, 1, 1],
      [2, 2, 1, 1],
      [2, 2, 2, 2],
    ]
    expect(validateRegions(threeRegions)).toEqual(['Board has 3 regions, expected 4'])
  })

  it('reports disconnected regions', () => {
    const split = [
      [0, 1, 1, 0],
      [2, 2, 2, 2],
      [3, 3, 3, 3],
      [1, 1, 1, 1],
    ]
    const problems = validateRegions(split)
    expect(problems).toContain('Region 0 is not connected')
    expect(problems).toContain('Region 1 is not connected')
    expect(problems).toHaveLength(2)
  })

  it('reports an out-of-range or non-integer region index and stops', () => {
    const tooBig = UNIQUE4.map((row) => row.slice())
    tooBig[3][3] = 4
    expect(validateRegions(tooBig)).toEqual(['Cell (4,4) has invalid region 4'])

    const negative = UNIQUE4.map((row) => row.slice())
    negative[0][0] = -1
    expect(validateRegions(negative)).toEqual(['Cell (1,1) has invalid region -1'])

    const fractional = UNIQUE4.map((row) => row.slice())
    fractional[1][1] = 1.5
    expect(validateRegions(fractional)).toEqual(['Cell (2,2) has invalid region 1.5'])
  })

  it('reports ragged rows', () => {
    const ragged = [[0, 0, 1, 1], [2, 2, 1], [2, 3, 3, 1], [2, 3, 3, 3]]
    expect(validateRegions(ragged)).toEqual(['Row 2 has 3 cells, expected 4'])
  })

  it('reports boards outside the supported size range', () => {
    expect(validateRegions([[0, 0], [1, 1]])).toContain('Board size must be between 4 and 16')
    expect(validateRegions([])).toEqual(['Board size must be between 4 and 16'])
  })

  it('isRegionConnected is false for an absent region', () => {
    expect(isRegionConnected(UNIQUE4, 7)).toBe(false)
    expect(isRegionConnected(UNIQUE4, 0)).toBe(true)
  })
})

describe('normalizeRegions / canonicalKey', () => {
  it('renumbers labels by first appearance in row-major order', () => {
    const relabelled = [
      [7, 7, 2, 2],
      [5, 5, 2, 2],
      [5, 9, 9, 2],
      [5, 9, 9, 9],
    ]
    expect(normalizeRegions(relabelled)).toEqual(UNIQUE4)
  })

  it('leaves an already-normalised board unchanged', () => {
    expect(normalizeRegions(UNIQUE4)).toEqual(UNIQUE4)
  })

  it('canonicalKey ignores labels but not orientation', () => {
    const relabelled = UNIQUE4.map((row) => row.map((g) => 3 - g))
    expect(canonicalKey(relabelled)).toBe(canonicalKey(UNIQUE4))
    const mirrored = UNIQUE4.map((row) => row.slice().reverse())
    expect(canonicalKey(mirrored)).not.toBe(canonicalKey(UNIQUE4))
  })
})

describe('symmetries / symmetricCanonicalKey', () => {
  it('returns 8 distinct boards for an asymmetric layout', () => {
    const all = symmetries(ASYMMETRIC5)
    expect(all).toHaveLength(8)
    expect(new Set(all.map((s) => canonicalKey(s))).size).toBe(8)
    // every transform is still a legal board
    for (const s of all) expect(validateRegions(s)).toEqual([])
  })

  it('includes the identity, the horizontal mirror and the 90° rotation', () => {
    const all = symmetries(ASYMMETRIC5).map((s) => canonicalKey(s))
    const n = ASYMMETRIC5.length
    const mirror = ASYMMETRIC5.map((row) => row.slice().reverse())
    const rot90 = Array.from({ length: n }, (_, r) => Array.from({ length: n }, (_, c) => ASYMMETRIC5[n - 1 - c][r]))
    expect(all).toContain(canonicalKey(ASYMMETRIC5))
    expect(all).toContain(canonicalKey(mirror))
    expect(all).toContain(canonicalKey(rot90))
  })

  it('symmetricCanonicalKey is invariant under every rotation, reflection and relabelling', () => {
    const key = symmetricCanonicalKey(ASYMMETRIC5)
    for (const s of symmetries(ASYMMETRIC5)) {
      expect(symmetricCanonicalKey(s)).toBe(key)
      const relabelled = s.map((row) => row.map((g) => (g + 2) % 5))
      expect(symmetricCanonicalKey(relabelled)).toBe(key)
    }
  })

  it('symmetricCanonicalKey differs for genuinely different layouts', () => {
    expect(symmetricCanonicalKey(UNIQUE4)).not.toBe(symmetricCanonicalKey(ROWS4))
  })
})

describe('cellsEliminatedBy', () => {
  it('covers row, column, region and neighbours exactly once, excluding the queen itself', () => {
    const puzzle = { size: 4, regions: UNIQUE4 }
    const cells = cellsEliminatedBy(puzzle, 1, 1)
    const keys = cells.map((c) => c.row * 4 + c.col)
    expect(new Set(keys).size).toBe(keys.length)
    expect(cells).not.toContainEqual({ row: 1, col: 1 })
    // row 1: (1,0) (1,2) (1,3); col 1: (0,1) (2,1) (3,1); region 2: (1,0) (2,0) (3,0)
    // neighbours: (0,0) (0,2) (2,2) plus already-listed cells
    const expected = new Set([
      [1, 0], [1, 2], [1, 3],
      [0, 1], [2, 1], [3, 1],
      [2, 0], [3, 0],
      [0, 0], [0, 2], [2, 2],
    ].map(([r, c]) => r * 4 + c))
    expect(new Set(keys)).toEqual(expected)
    expect(cells).toHaveLength(11)
  })

  it('handles a corner queen without going off the board', () => {
    const puzzle = { size: 4, regions: ROWS4 }
    const cells = cellsEliminatedBy(puzzle, 0, 0)
    for (const c of cells) {
      expect(c.row).toBeGreaterThanOrEqual(0)
      expect(c.col).toBeGreaterThanOrEqual(0)
      expect(c.row).toBeLessThan(4)
      expect(c.col).toBeLessThan(4)
    }
    // row 0 (3 others, same as region 0) + column 0 (3 others) + diagonal neighbour (1,1)
    expect(cells).toHaveLength(7)
    expect(cells).toContainEqual({ row: 1, col: 1 })
  })
})

describe('conflictingQueens', () => {
  const puzzle = { size: 4, regions: UNIQUE4 }

  it('is empty for the unique solution', () => {
    expect(conflictingQueens(puzzle, boardFromSolution(4, UNIQUE4_SOLUTION)).size).toBe(0)
  })

  it('flags two queens sharing a row', () => {
    const bad = conflictingQueens(puzzle, placeQueens(4, [[0, 0], [0, 3]]))
    expect([...bad].sort()).toEqual([0, 3])
  })

  it('flags two queens sharing a column', () => {
    const bad = conflictingQueens(puzzle, placeQueens(4, [[0, 0], [3, 0]]))
    expect([...bad].sort((a, b) => a - b)).toEqual([0, 12])
  })

  it('flags two queens sharing a region even when far apart', () => {
    // (0,3) and (2,3) are both region 1
    const bad = conflictingQueens(puzzle, placeQueens(4, [[0, 3], [2, 3]]))
    expect([...bad].sort((a, b) => a - b)).toEqual([3, 11])
  })

  it('flags diagonally touching queens in different rows, columns and regions', () => {
    // (0,1) is region 0, (1,2) is region 1 – they only conflict by touching
    const bad = conflictingQueens(puzzle, placeQueens(4, [[0, 1], [1, 2]]))
    expect([...bad].sort((a, b) => a - b)).toEqual([1, 6])
  })

  it('only marks the queens involved in a conflict', () => {
    const board = placeQueens(4, [[0, 1], [1, 3], [2, 0], [3, 0]])
    const bad = conflictingQueens(puzzle, board)
    expect([...bad].sort((a, b) => a - b)).toEqual([8, 12])
  })
})

describe('isSolved', () => {
  const puzzle = { size: 4, regions: UNIQUE4 }

  it('is true for the unique solution', () => {
    expect(isSolved(puzzle, boardFromSolution(4, UNIQUE4_SOLUTION))).toBe(true)
  })

  it('is false with fewer than N queens', () => {
    expect(isSolved(puzzle, placeQueens(4, [[0, 1], [1, 3], [2, 0]]))).toBe(false)
    expect(isSolved(puzzle, emptyBoard(4))).toBe(false)
  })

  it('is false with N queens that conflict', () => {
    expect(isSolved(puzzle, boardFromSolution(4, [2, 0, 3, 1]))).toBe(false)
  })

  it('ignores X marks', () => {
    const board = boardFromSolution(4, UNIQUE4_SOLUTION)
    board[0][0] = 'x'
    board[3][3] = 'x'
    expect(isSolved(puzzle, board)).toBe(true)
  })
})

describe('board helpers', () => {
  it('emptyBoard, cloneBoard and queensOf', () => {
    const b = emptyBoard(3)
    expect(b).toEqual([
      ['empty', 'empty', 'empty'],
      ['empty', 'empty', 'empty'],
      ['empty', 'empty', 'empty'],
    ])
    const copy = cloneBoard(b)
    copy[1][1] = 'queen'
    expect(b[1][1]).toBe('empty')
    expect(queensOf(copy)).toEqual([{ row: 1, col: 1 }])
  })

  it('shortHash is deterministic and differs across inputs', () => {
    expect(shortHash('abc')).toBe(shortHash('abc'))
    expect(shortHash('abc')).not.toBe(shortHash('abd'))
    expect(shortHash('')).toMatch(/^[0-9a-z]+$/)
  })
})
