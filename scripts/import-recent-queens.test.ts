import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import original from '../src/data/linkedin-puzzles.json'
import extra from '../src/data/linkedin-extra.json'
import crosschecks from './test-data/recent-queens/crosschecks.json'
import { LINKEDIN_ARCHIVE } from '../src/data/archive'
import { countSolutions } from '../src/core/solver'
import { symmetricCanonicalKey, validateRegions } from '../src/core/puzzle'
import { historicalProfiles } from '../src/core/generator-profile'
import { dateForNumber, parseSolvedSvg } from './import-recent-queens'

const fixture = (n: number) => readFileSync(new URL(`./test-data/recent-queens/${n}.html`, import.meta.url), 'utf8')

describe('source SVG extraction', () => {
  it('matches a known historical puzzle and accepts newer complete boards', () => {
    const parsed = parseSolvedSvg(fixture(600), 600)
    expect(symmetricCanonicalKey(parsed.regions)).toBe(symmetricCanonicalKey(original.find(p => p.number === 600)!.regions))
    for (const n of [617, 863]) {
      const p = parseSolvedSvg(fixture(n), n)
      expect(p.date).toBe(dateForNumber(n))
      expect(validateRegions(p.regions)).toEqual([])
      expect(countSolutions(p, 2)).toBe(1)
    }
  })
  it('rejects wrong puzzle identity, date, missing cells, and incorrect supplied solutions', () => {
    const html = fixture(617)
    expect(() => parseSolvedSvg(html, 618)).toThrow('No solved board')
    expect(() => parseSolvedSvg(html.replace('January 7, 2026', 'January 8, 2026'), 617)).toThrow('date')
    expect(() => parseSolvedSvg(html.replace(/<rect x="0" y="0" width="1"[^>]*><\/rect>/, ''), 617)).toThrow()
    expect(() => parseSolvedSvg(html.replace('R1C1', 'R1C2'), 617)).toThrow('Source answer')
  })
})

it('all imported boards are dated, connected, uniquely solvable, and included in the playable archive', () => {
  const numbers = new Set(original.map(p => p.number))
  for (const p of extra) {
    expect(numbers.has(p.number)).toBe(false)
    numbers.add(p.number)
    expect(p.date).toBe(dateForNumber(p.number))
    expect(p.attribution).toContain('https://linkedinzip.solutions/')
    expect(validateRegions(p.regions)).toEqual([])
    expect(countSolutions(p, 2)).toBe(1)
    expect(LINKEDIN_ARCHIVE.find(x => x.number === p.number)?.regions).toEqual(p.regions)
  }
  expect(LINKEDIN_ARCHIVE.length).toBe(original.length + extra.length)
  // Loading new playable boards cannot recalibrate v2 implicitly.
  expect(historicalProfiles()).toHaveLength(607)
})

it('matches independent structured region data for sampled recent puzzles', () => {
  for (const check of crosschecks) {
    const local = extra.find(p => p.number === check.number)
    expect(local, `Missing #${check.number}`).toBeDefined()
    expect(symmetricCanonicalKey(local!.regions), `Source disagreement for #${check.number}`).toBe(symmetricCanonicalKey(check.regions))
  }
})
