import { createServer, type Server } from 'node:http'
import { mkdtempSync, readFile, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, extname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { Puzzle } from '../src/core/types'
import {
  FIRST_PUZZLE_DATE,
  dateForNumber,
  extractNumberFromString,
  numberForDate,
  parseArgs,
  runScrape,
} from './scrape-archive'

const here = dirname(fileURLToPath(import.meta.url))
const FIXTURES_DIR = resolve(here, 'fixtures/fake-archive')

const MIME: Record<string, string> = { '.html': 'text/html; charset=utf-8' }

/** Minimal static file server for the fake-archive fixtures. */
function startFixtureServer(): Promise<{ server: Server; base: string }> {
  return new Promise((resolveReady, reject) => {
    const server = createServer((req, res) => {
      const url = new URL(req.url || '/', 'http://localhost')
      const rel = url.pathname === '/' ? '/index.html' : url.pathname
      const filePath = join(FIXTURES_DIR, rel)
      if (!filePath.startsWith(FIXTURES_DIR)) {
        res.writeHead(403)
        res.end()
        return
      }
      readFile(filePath, (err, data) => {
        if (err) {
          res.writeHead(404)
          res.end('not found')
          return
        }
        res.writeHead(200, { 'content-type': MIME[extname(filePath)] || 'application/octet-stream' })
        res.end(data)
      })
    })
    server.on('error', reject)
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address()
      if (!addr || typeof addr === 'string') return reject(new Error('no server address'))
      resolveReady({ server, base: `http://127.0.0.1:${addr.port}/` })
    })
  })
}

/** A small, real subset of src/data/linkedin-puzzles.json to seed a temp output file. */
function loadRealSubset(numbers: number[]): Puzzle[] {
  const all = JSON.parse(readFileSync(resolve(here, '../src/data/linkedin-puzzles.json'), 'utf8')) as Puzzle[]
  const byN = new Map(all.map((p) => [p.number, p]))
  return numbers.map((n) => {
    const p = byN.get(n)
    if (!p) throw new Error(`fixture setup: puzzle #${n} not found in linkedin-puzzles.json`)
    return p
  })
}

describe('dateForNumber / numberForDate', () => {
  it('round-trips #1 to the known first-puzzle date', () => {
    expect(dateForNumber(1)).toBe(FIRST_PUZZLE_DATE)
    expect(numberForDate(FIRST_PUZZLE_DATE)).toBe(1)
  })

  it('advances one day per number', () => {
    expect(dateForNumber(617)).toBe('2026-01-07')
    expect(numberForDate('2026-01-07')).toBe(617)
  })

  it('rejects unparseable or pre-#1 dates', () => {
    expect(numberForDate('not-a-date')).toBeNull()
    expect(numberForDate('2020-01-01')).toBeNull()
  })
})

describe('extractNumberFromString', () => {
  it('reads a hash-prefixed number', () => {
    expect(extractNumberFromString('Queens #620 (broken board)')).toBe(620)
  })

  it('reads a slug-embedded number', () => {
    expect(extractNumberFromString('puzzle-617.html')).toBe(617)
    expect(extractNumberFromString('queens-619')).toBe(619)
  })

  it('reads a path segment', () => {
    expect(extractNumberFromString('/puzzle/861')).toBe(861)
  })

  it('converts an embedded ISO date', () => {
    expect(extractNumberFromString('Published 2026-01-07')).toBe(617)
  })

  it('returns null when nothing matches', () => {
    expect(extractNumberFromString('Unrelated external link')).toBeNull()
  })
})

describe('parseArgs', () => {
  it('returns "help" for --help', () => {
    expect(parseArgs(['--help'])).toBe('help')
  })

  it('applies defaults', () => {
    const opts = parseArgs(['--base', 'https://example.com'])
    if (opts === 'help') throw new Error('unexpected help')
    expect(opts.onlyMissing).toBe(true)
    expect(opts.headless).toBe(true)
    expect(opts.delayMs).toBe(800)
    expect(opts.outFile.endsWith('src/data/linkedin-puzzles.json')).toBe(true)
  })

  it('parses flags, including --headless false and --no-only-missing', () => {
    const opts = parseArgs([
      '--url-template',
      'https://example.com/{n}',
      '--from',
      '617',
      '--to',
      '620',
      '--headless',
      'false',
      '--no-only-missing',
      '--delay-ms',
      '10',
    ])
    if (opts === 'help') throw new Error('unexpected help')
    expect(opts.from).toBe(617)
    expect(opts.to).toBe(620)
    expect(opts.headless).toBe(false)
    expect(opts.onlyMissing).toBe(false)
    expect(opts.delayMs).toBe(10)
  })

  it('rejects an unknown flag', () => {
    expect(() => parseArgs(['--nope'])).toThrow(/Unknown argument/)
  })
})

describe('runScrape against a local fixture archive', () => {
  let server: Server
  let base: string
  let workDir: string

  beforeAll(async () => {
    ;({ server, base } = await startFixtureServer())
    workDir = mkdtempSync(join(tmpdir(), 'scrape-archive-test-'))
  }, 30_000)

  afterAll(async () => {
    await new Promise((r) => server.close(r))
    rmSync(workDir, { recursive: true, force: true })
  })

  it(
    'discovers, extracts, validates, dedupes and reports failures',
    async () => {
      const outFile = join(workDir, 'puzzles.json')
      const shotsDir = join(workDir, 'shots')
      // Seed the output with a small real subset. Puzzle #1 is in here on
      // purpose: puzzle-618.html on the fake archive renders the exact same
      // board, so it should come back as a duplicate, not a new puzzle.
      const seed = loadRealSubset([1, 2, 3, 5])
      writeFileSync(outFile, JSON.stringify(seed))

      const summary = await runScrape({
        base,
        onlyMissing: true,
        shotsDir,
        outFile,
        delayMs: 10,
        headless: true,
      })

      // #617 (colour-grid, new) and #619 (data-region attributes, new) are accepted.
      const acceptedNumbers = summary.accepted.map((p) => p.number).sort((a, b) => a! - b!)
      expect(acceptedNumbers).toEqual([617, 619])

      const p617 = summary.accepted.find((p) => p.number === 617)!
      expect(p617.id).toBe('li-617')
      expect(p617.date).toBe(dateForNumber(617))
      expect(p617.name).toBe('LinkedIn Queens #617')
      expect(p617.source).toBe('linkedin')
      expect(p617.attribution).toContain(base)
      expect(p617.colors?.length).toBe(p617.size)

      const p619 = summary.accepted.find((p) => p.number === 619)!
      expect(p619.id).toBe('li-619')
      expect(p619.date).toBe(dateForNumber(619))
      // Extracted via the data-region path: no colours read off the page.
      expect(p619.colors).toBeUndefined()

      // #618 reproduces puzzle #1's exact layout, already in the seed -> skipped.
      expect(summary.skipped.some((s) => s.number === 618 && /duplicate/.test(s.reason))).toBe(true)

      // #620 has two regions sharing a colour -> extraction fails gracefully.
      const failure = summary.failed.find((f) => f.number === 620)
      expect(failure).toBeDefined()
      expect(failure!.reason).toMatch(/distinct colour/)
      expect(failure!.screenshot).toBeTruthy()

      // Screenshots exist for every attempted page, valid or not.
      for (const n of [617, 618, 619, 620]) {
        const shot = join(shotsDir, `li-${n}.png`)
        expect(statSync(shot).size).toBeGreaterThan(0)
      }

      // Output file merges the seed with the two accepted boards, sorted by number.
      const written = JSON.parse(readFileSync(outFile, 'utf8')) as Puzzle[]
      expect(written.map((p) => p.number)).toEqual([1, 2, 3, 5, 617, 619])
      expect(summary.merged).toHaveLength(6)
    },
    30_000,
  )

  it(
    '--only-missing skips a number already present in --out',
    async () => {
      const outFile = join(workDir, 'puzzles-only-missing.json')
      const shotsDir = join(workDir, 'shots-only-missing')
      const seed = loadRealSubset([6])
      // Pretend #617 was already scraped previously (any valid-shaped entry works
      // here: --only-missing filters by number before extraction ever runs).
      const already: Puzzle = { ...seed[0], id: 'li-617', number: 617, date: dateForNumber(617) }
      writeFileSync(outFile, JSON.stringify([already]))

      const summary = await runScrape({
        urlTemplate: `${base}puzzle-{n}.html`,
        from: 617,
        to: 617,
        onlyMissing: true,
        shotsDir,
        outFile,
        delayMs: 10,
        headless: true,
      })

      expect(summary.accepted).toHaveLength(0)
      expect(summary.skipped).toEqual([
        { number: 617, url: `${base}puzzle-617.html`, reason: 'already present in output (--only-missing)' },
      ])
    },
    30_000,
  )
})
