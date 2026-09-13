import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterAll, describe, expect, it } from 'vitest'
import { symmetricCanonicalKey, validateRegions } from '../src/core/puzzle'
import { countSolutions } from '../src/core/solver'
import type { Puzzle } from '../src/core/types'
import {
  importCandidates,
  listInputFiles,
  loadLibrary,
  main,
  parseArgs,
  parseHeader,
  parseJsonFile,
  parseTextFile,
  readCandidates,
  serializeLibrary,
} from './import-text-puzzles'

const here = dirname(fileURLToPath(import.meta.url))
const FIXTURES = resolve(here, 'fixtures')
const LINKEDIN_JSON = resolve(here, '../src/data/linkedin-puzzles.json')

const FOUR_CORNERS = [
  [0, 0, 1, 1],
  [2, 2, 1, 1],
  [2, 3, 3, 1],
  [2, 3, 3, 3],
]

describe('parseHeader', () => {
  it('reads name, date and number, each optional', () => {
    expect(parseHeader('# LinkedIn Queens #700 | 2026-03-31 | 700')).toEqual({
      name: 'LinkedIn Queens #700',
      date: '2026-03-31',
      number: 700,
    })
    expect(parseHeader('#My board')).toEqual({ name: 'My board' })
    expect(parseHeader('# | 2026-01-01')).toEqual({ date: '2026-01-01' })
    expect(parseHeader('# | | 12')).toEqual({ number: 12 })
    expect(parseHeader('#')).toEqual({})
  })

  it('rejects malformed dates and numbers', () => {
    expect(() => parseHeader('# x | 31/03/2026')).toThrow(/Invalid date/)
    expect(() => parseHeader('# x | 2026-03-31 | seven')).toThrow(/Invalid puzzle number/)
    expect(() => parseHeader('# x | | 0')).toThrow(/Invalid puzzle number/)
  })
})

describe('parseTextFile', () => {
  it('splits blocks on blank lines, reads headers and skips // comments', () => {
    const text = readFileSync(join(FIXTURES, 'community-sample.txt'), 'utf8')
    const candidates = parseTextFile(text, 'sample.txt')
    expect(candidates.map((c) => c.origin)).toEqual(['sample.txt#1', 'sample.txt#2', 'sample.txt#3', 'sample.txt#4'])
    expect(candidates[0]).toEqual({
      origin: 'sample.txt#1',
      name: 'Four corners',
      date: '2026-02-01',
      number: 1,
      regions: FOUR_CORNERS,
    })
    expect(candidates[1].name).toBe('Mirror of LinkedIn #1')
    expect(candidates[1].regions).toHaveLength(8)
    expect(candidates[3]).toEqual({ origin: 'sample.txt#4', regions: FOUR_CORNERS })
  })

  it('handles CRLF, indentation and a trailing block without newline', () => {
    const text = '  AABB\r\n  CCBB\r\n  CDDB\r\n  CDDD\r\n\r\n\r\n# two\r\nAABB\r\nCCBB\r\nCDDB\r\nCDDD'
    const candidates = parseTextFile(text)
    expect(candidates).toHaveLength(2)
    expect(candidates[1].name).toBe('two')
    expect(candidates[1].regions).toEqual(FOUR_CORNERS)
  })

  it('throws on non-square grids and header-only blocks', () => {
    expect(() => parseTextFile('AAB\nCCB\nCDB\nCDD')).toThrow(/not square/)
    expect(() => parseTextFile('# lonely header')).toThrow(/no grid/)
  })
})

describe('parseJsonFile', () => {
  it('accepts { puzzles: [...] } with string rows and number[][] regions', () => {
    const text = readFileSync(join(FIXTURES, 'community-sample.json'), 'utf8')
    const candidates = parseJsonFile(text, 'sample.json')
    expect(candidates).toHaveLength(2)
    expect(candidates[0]).toMatchObject({
      origin: 'sample.json#1',
      name: 'Diagonal twist',
      date: '2026-02-02',
      number: 2,
      attribution: 'Hand-made fixture',
    })
    expect(candidates[0].regions).toHaveLength(5)
    expect(candidates[1].regions).toEqual(FOUR_CORNERS)
    expect(candidates[1].colors).toEqual(['#96BEFF', '#FFC992', '#B3DFA0', '#DFDFDF'])
  })

  it('accepts a bare array and a single object', () => {
    expect(parseJsonFile(JSON.stringify([{ regions: FOUR_CORNERS }]))).toHaveLength(1)
    expect(parseJsonFile(JSON.stringify({ regions: FOUR_CORNERS }))).toHaveLength(1)
  })

  it('rejects invalid JSON and bad shapes', () => {
    expect(() => parseJsonFile('{ nope', 'x.json')).toThrow(/x\.json/)
    expect(() => parseJsonFile('42')).toThrow(/expected an object or an array/)
    expect(() => parseJsonFile(JSON.stringify([{ regions: 'AABB' }]))).toThrow(/must be a non-empty array/)
    expect(() => parseJsonFile(JSON.stringify([{ regions: [[0, 'a']] }]))).toThrow(/number\[\]\[\] or string\[\]/)
    expect(() => parseJsonFile(JSON.stringify([{ size: 5, regions: FOUR_CORNERS }]))).toThrow(/size 5 does not match 4/)
    expect(() => parseJsonFile(JSON.stringify([{ regions: FOUR_CORNERS, date: 'yesterday' }]))).toThrow(/invalid date/)
  })
})

describe('listInputFiles / readCandidates', () => {
  it('lists .txt and .json files in a directory, sorted, and passes files through', () => {
    const files = listInputFiles(FIXTURES).map((f) => f.slice(FIXTURES.length + 1))
    expect(files).toEqual(['community-sample.json', 'community-sample.txt', 'disconnected.txt'])
    expect(listInputFiles(join(FIXTURES, 'disconnected.txt'))).toEqual([join(FIXTURES, 'disconnected.txt')])
  })

  it('reads every candidate with a relative origin', () => {
    const candidates = readCandidates([FIXTURES], FIXTURES)
    expect(candidates).toHaveLength(7)
    expect(candidates[0].origin).toBe('community-sample.json#1')
    expect(candidates.at(-1)?.origin).toBe('disconnected.txt#1')
  })
})

describe('importCandidates', () => {
  const linkedin = loadLibrary(LINKEDIN_JSON)

  it('validates, de-duplicates (within the batch and against the library) and builds Puzzle objects', () => {
    const candidates = readCandidates([join(FIXTURES, 'community-sample.txt'), join(FIXTURES, 'community-sample.json')], FIXTURES)
    const result = importCandidates(candidates, { existingKeys: linkedin.keys, existingIds: linkedin.ids })

    expect(result.puzzles.map((p) => p.name)).toEqual(['Four corners', 'Diagonal twist'])
    expect(result.rejected).toEqual([{ origin: 'community-sample.txt#3', reason: 'multiple solutions' }])
    expect(result.duplicates).toEqual([
      { origin: 'community-sample.txt#2', of: 'library' },
      { origin: 'community-sample.txt#4', of: result.puzzles[0].id },
      { origin: 'community-sample.json#2', of: result.puzzles[0].id },
    ])

    const [four, five] = result.puzzles
    expect(four).toEqual({
      id: expect.stringMatching(/^community-[0-9a-z]+$/),
      size: 4,
      regions: FOUR_CORNERS,
      source: 'community',
      number: 1,
      date: '2026-02-01',
      name: 'Four corners',
    })
    expect(five).toMatchObject({ size: 5, source: 'community', number: 2, date: '2026-02-02', attribution: 'Hand-made fixture' })
    for (const p of result.puzzles) {
      expect(validateRegions(p.regions)).toEqual([])
      expect(countSolutions(p, 2)).toBe(1)
      expect(linkedin.keys.has(symmetricCanonicalKey(p.regions))).toBe(false)
    }
  })

  it('the mirrored fixture really is LinkedIn #1', () => {
    const [, mirror] = parseTextFile(readFileSync(join(FIXTURES, 'community-sample.txt'), 'utf8'))
    const li1 = (JSON.parse(readFileSync(LINKEDIN_JSON, 'utf8')) as Puzzle[]).find((p) => p.number === 1)!
    expect(symmetricCanonicalKey(mirror.regions)).toBe(symmetricCanonicalKey(li1.regions))
  })

  it('rejects disconnected regions unless allowDisconnected is set', () => {
    const candidates = readCandidates([join(FIXTURES, 'disconnected.txt')], FIXTURES)
    const strict = importCandidates(candidates)
    expect(strict.puzzles).toEqual([])
    expect(strict.rejected[0].reason).toMatch(/not connected/)

    const lenient = importCandidates(candidates, { allowDisconnected: true })
    expect(lenient.puzzles).toHaveLength(1)
    expect(lenient.puzzles[0].attribution).toMatch(/disconnected/)
    expect(lenient.puzzles[0].date).toBe('2026-04-01')
  })

  it('rejects boards with no solution and keeps colours only when they match the size', () => {
    const impossible = [
      [0, 2, 2, 2],
      [2, 1, 2, 2],
      [2, 2, 2, 3],
      [3, 3, 3, 3],
    ]
    const result = importCandidates([
      { origin: 'a', regions: impossible },
      { origin: 'b', regions: FOUR_CORNERS, colors: ['#000000'] },
    ])
    expect(result.rejected).toEqual([{ origin: 'a', reason: 'no solution' }])
    expect(result.puzzles[0].colors).toBeUndefined()
  })

  it('uses the requested source and avoids id collisions', () => {
    const first = importCandidates([{ origin: 'a', regions: FOUR_CORNERS }], { source: 'custom' })
    const id = first.puzzles[0].id
    expect(id.startsWith('custom-')).toBe(true)
    const second = importCandidates([{ origin: 'a', regions: FOUR_CORNERS }], { source: 'custom', existingIds: [id] })
    expect(second.puzzles[0].id).toBe(`${id}-2`)
  })
})

describe('CLI', () => {
  const dir = mkdtempSync(join(tmpdir(), 'queens-text-import-'))
  afterAll(() => rmSync(dir, { recursive: true, force: true }))

  it('parseArgs understands every option', () => {
    const args = parseArgs(['a.txt', '--out', 'x.json', '--source', 'custom', '--allow-disconnected', '--dry-run', '--strict', 'b'])
    expect(args.inputs).toEqual(['a.txt', 'b'])
    expect(args.out).toBe(resolve('x.json'))
    expect(args.source).toBe('custom')
    expect(args.allowDisconnected).toBe(true)
    expect(args.dryRun).toBe(true)
    expect(args.strict).toBe(true)
    expect(() => parseArgs(['--bogus'])).toThrow(/Unknown option/)
  })

  it('writes a merged library and is idempotent on a second run', () => {
    const out = join(dir, 'community.json')
    const quiet = { log: console.log }
    console.log = () => {}
    try {
      expect(main([FIXTURES, '--out', out])).toBe(0)
      const first = JSON.parse(readFileSync(out, 'utf8')) as Puzzle[]
      // Files are processed in name order, so the JSON copy of the 4×4 layout is kept.
      expect(first.map((p) => p.name)).toEqual(['Diagonal twist', 'Numeric regions (duplicate of Four corners)'])

      // Second run: everything is now a duplicate of the output file; --strict still passes
      // because duplicates are not rejections, but the ambiguous/disconnected boards are.
      expect(main([FIXTURES, '--out', out])).toBe(0)
      expect(main([FIXTURES, '--out', out, '--strict'])).toBe(1)
      const second = JSON.parse(readFileSync(out, 'utf8')) as Puzzle[]
      expect(second).toEqual(first)

      // Adding a genuinely new board appends to the existing file.
      const extra = join(dir, 'extra.txt')
      writeFileSync(extra, '# Split | 2026-04-01\nDCCB\nDDAB\nDCAB\nDCAB\n')
      expect(main([extra, '--out', out, '--allow-disconnected'])).toBe(0)
      const third = JSON.parse(readFileSync(out, 'utf8')) as Puzzle[]
      expect(third).toHaveLength(3)
      expect(third.slice(0, 2)).toEqual(first)
      expect(third[2].name).toBe('Split')

      // --dry-run does not touch the file; no inputs prints usage and returns 2.
      expect(main([extra, '--out', join(dir, 'never.json'), '--dry-run', '--allow-disconnected'])).toBe(0)
      expect(() => readFileSync(join(dir, 'never.json'))).toThrow()
      expect(main([])).toBe(2)
    } finally {
      console.log = quiet.log
    }
  })

  it('serializeLibrary writes one puzzle per line', () => {
    expect(serializeLibrary([])).toBe('[]\n')
    const text = serializeLibrary([{ id: 'a', size: 4, regions: FOUR_CORNERS, source: 'custom' }])
    expect(text.split('\n')).toHaveLength(4)
    expect(JSON.parse(text)).toHaveLength(1)
  })
})
