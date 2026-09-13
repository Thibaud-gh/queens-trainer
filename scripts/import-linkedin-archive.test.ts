import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import {
  FIRST_PUZZLE_DATE,
  dateForNumber,
  importFromDir,
  parseColors,
  parseLevelFile,
  toPuzzle,
} from './import-linkedin-archive'

/** Trimmed-down copy of samimsu/queens-game-linkedin `src/utils/colors.ts`. */
const COLORS_TS = `
export const lightBlue = "#96BEFF";
export const lightOrange = "#FFC992";
export const lightGreen = "#B3DFA0";
export const lightGray = "#DFDFDF";
export const notAColor = "#12345"; // invalid length, must be ignored
`

/** A `level<N>.ts` file in the shape used by the archived repository. */
const LEVEL_TS = `
import { lightBlue, lightGray, lightGreen, lightOrange } from "../colors";

const level = {
  size: 4,
  colorRegions: [
    ["A", "A", "B", "B"],
    ["C", "C", "B", "B"],
    ["C", "D", "D", "B"],
    ["C", "D", "D", "D"],
  ],
  regionColors: {
    A: lightBlue,
    B: lightOrange,
    C: lightGreen,
    D: lightGray,
  },
};

export default level;
`

/** Same layout, but with labels in a different order and one unknown colour. */
const LEVEL_TS_UNKNOWN_COLOR = LEVEL_TS.replace('D: lightGray', 'D: mysteryPurple')

/** Every row is its own region → two solutions; the importer must skip it. */
const LEVEL_TS_AMBIGUOUS = `
const level = {
  size: 4,
  colorRegions: [
    ["A", "A", "A", "A"],
    ["B", "B", "B", "B"],
    ["C", "C", "C", "C"],
    ["D", "D", "D", "D"],
  ],
  regionColors: { A: lightBlue, B: lightOrange, C: lightGreen, D: lightGray },
};
export default level;
`

describe('dateForNumber', () => {
  it('maps #1 to the first LinkedIn Queens date', () => {
    expect(FIRST_PUZZLE_DATE).toBe('2024-05-01')
    expect(dateForNumber(1)).toBe('2024-05-01')
  })

  it('advances one day per puzzle number, across month and year boundaries', () => {
    expect(dateForNumber(2)).toBe('2024-05-02')
    expect(dateForNumber(31)).toBe('2024-05-31')
    expect(dateForNumber(32)).toBe('2024-06-01')
    expect(dateForNumber(245)).toBe('2024-12-31')
    expect(dateForNumber(246)).toBe('2025-01-01')
    expect(dateForNumber(336)).toBe('2025-04-01') // April Fools board
    expect(dateForNumber(616)).toBe('2026-01-06')
  })
})

describe('parseColors', () => {
  it('extracts name → hex pairs and ignores malformed entries', () => {
    const colors = parseColors(COLORS_TS)
    expect(colors.get('lightBlue')).toBe('#96BEFF')
    expect(colors.get('lightGray')).toBe('#DFDFDF')
    expect(colors.has('notAColor')).toBe(false)
    expect(colors.size).toBe(4)
  })
})

describe('parseLevelFile', () => {
  it('reads size, letter grid and region colour names', () => {
    const level = parseLevelFile(LEVEL_TS)
    expect(level.size).toBe(4)
    expect(level.letters).toEqual([
      ['A', 'A', 'B', 'B'],
      ['C', 'C', 'B', 'B'],
      ['C', 'D', 'D', 'B'],
      ['C', 'D', 'D', 'D'],
    ])
    expect(level.regionColorNames).toEqual({ A: 'lightBlue', B: 'lightOrange', C: 'lightGreen', D: 'lightGray' })
  })

  it('throws on files without a size or grid', () => {
    expect(() => parseLevelFile('export default {}')).toThrow('no size')
    expect(() => parseLevelFile('const level = { size: 4 }')).toThrow('no colorRegions')
  })
})

describe('toPuzzle', () => {
  const colors = parseColors(COLORS_TS)

  it('builds a Puzzle with id, number, date, normalised regions and colours', () => {
    const puzzle = toPuzzle(42, parseLevelFile(LEVEL_TS), colors)
    expect(puzzle).toEqual({
      id: 'li-42',
      size: 4,
      regions: [
        [0, 0, 1, 1],
        [2, 2, 1, 1],
        [2, 3, 3, 1],
        [2, 3, 3, 3],
      ],
      source: 'linkedin',
      number: 42,
      date: '2024-06-11',
      name: 'LinkedIn Queens #42',
      colors: ['#96BEFF', '#FFC992', '#B3DFA0', '#DFDFDF'],
    })
  })

  it('omits colours when any region colour is unknown', () => {
    const puzzle = toPuzzle(7, parseLevelFile(LEVEL_TS_UNKNOWN_COLOR), colors)
    expect(puzzle.colors).toBeUndefined()
    expect(puzzle.id).toBe('li-7')
  })
})

describe('importFromDir', () => {
  const dir = mkdtempSync(join(tmpdir(), 'queens-import-test-'))
  afterAll(() => rmSync(dir, { recursive: true, force: true }))

  it('imports valid levels sorted by number and reports skipped ones', () => {
    mkdirSync(join(dir, 'levels'))
    writeFileSync(join(dir, 'colors.ts'), COLORS_TS)
    writeFileSync(join(dir, 'levels', 'level10.ts'), LEVEL_TS)
    writeFileSync(join(dir, 'levels', 'level2.ts'), LEVEL_TS_UNKNOWN_COLOR)
    writeFileSync(join(dir, 'levels', 'level3.ts'), LEVEL_TS_AMBIGUOUS)
    writeFileSync(join(dir, 'levels', 'level4.ts'), 'export default {}')
    writeFileSync(join(dir, 'levels', 'notes.md'), 'ignored')

    const { puzzles, skipped } = importFromDir(dir)
    expect(puzzles.map((p) => p.number)).toEqual([2, 10])
    expect(puzzles[0].colors).toBeUndefined()
    expect(puzzles[1].colors).toHaveLength(4)
    expect(skipped).toHaveLength(2)
    expect(skipped).toContain('level3.ts: multiple solutions')
    expect(skipped).toContain('level4.ts: no size')
  })
})
