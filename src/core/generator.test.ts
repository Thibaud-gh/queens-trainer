import { describe, expect, it } from 'vitest'
import linkedin from '../data/linkedin-puzzles.json'
import { rateDifficulty } from './deduction'
import {
  buildRegions,
  generatePuzzle,
  growRegions,
  randomSolution,
  repairUniqueness,
  resetGeneratorHistory,
  sampleStyle,
} from './generator-legacy'
import { boardStats } from './patterns'
import { isRegionConnected, symmetricCanonicalKey, validateRegions } from './puzzle'
import { makeRng } from './random'
import { countSolutions } from './solver'
import type { Puzzle } from './types'

const SIZES = [7, 8, 9, 10, 11]
const SEEDS = ['alpha', 'bravo', 'charlie', 'delta', 'echo']

describe('legacy generatePuzzle', () => {
  it(
    'produces valid, unique boards for sizes 7–11 across 5 seeds each',
    () => {
      resetGeneratorHistory()
      for (const size of SIZES) {
        for (const seed of SEEDS) {
          const p = generatePuzzle({ size, seed })
          expect(p.size).toBe(size)
          expect(p.regions.length).toBe(size)
          expect(validateRegions(p.regions), `${size} ${seed}`).toEqual([])
          const regionIds = new Set(p.regions.flat())
          expect(regionIds.size).toBe(size)
          for (let g = 0; g < size; g++) expect(isRegionConnected(p.regions, g)).toBe(true)
          expect(countSolutions(p, 2), `${size} ${seed}`).toBe(1)
          expect(p.id).toBe(`gen-${size}-${seed}`)
          expect(p.source).toBe('generated')
          expect(p.difficulty).toBeDefined()
          expect(p.name).toBe(`Generated ${size}×${size} · ${p.difficulty}`)
          expect(rateDifficulty(p)).toBe(p.difficulty)
        }
      }
    },
    120_000,
  )

  it('is deterministic: same seed → same board', () => {
    resetGeneratorHistory()
    const a = generatePuzzle({ size: 9, seed: 'repeat-me' })
    const b = generatePuzzle({ size: 9, seed: 'repeat-me' })
    expect(b.regions).toEqual(a.regions)
    expect(b.id).toBe(a.id)
    resetGeneratorHistory()
    const c = generatePuzzle({ size: 9, seed: 'repeat-me' })
    expect(c.regions).toEqual(a.regions)
  })

  it('gives different layouts for different seeds', () => {
    resetGeneratorHistory()
    const keys = new Set(SEEDS.map((seed) => symmetricCanonicalKey(generatePuzzle({ size: 8, seed }).regions)))
    expect(keys.size).toBe(SEEDS.length)
  })

  it('honours a requested difficulty when reachable and never throws otherwise', () => {
    resetGeneratorHistory()
    const easy = generatePuzzle({ size: 7, seed: 'easy-1', difficulty: 'easy' })
    expect(countSolutions(easy, 2)).toBe(1)
    expect(rateDifficulty(easy)).toBe(easy.difficulty)
    const hard = generatePuzzle({ size: 8, seed: 'hard-1', difficulty: 'hard' })
    expect(hard.difficulty).toBe('hard')
    // a tiny attempt budget must still return a valid board (with its real rating)
    const fallback = generatePuzzle({ size: 8, seed: 'fallback', difficulty: 'expert', maxAttempts: 1 })
    expect(countSolutions(fallback, 2)).toBe(1)
    expect(rateDifficulty(fallback)).toBe(fallback.difficulty)
  })

  it('clamps unusual sizes instead of throwing', () => {
    resetGeneratorHistory()
    const small = generatePuzzle({ size: 5, seed: 's' })
    expect(small.size).toBe(5)
    expect(countSolutions(small, 2)).toBe(1)
  })
})

describe('building blocks', () => {
  it('randomSolution places one queen per row/column with no touching queens', () => {
    const rng = makeRng('sol')
    for (let n = 7; n <= 11; n++) {
      const sol = randomSolution(n, rng)
      expect(new Set(sol).size).toBe(n)
      for (let r = 1; r < n; r++) expect(Math.abs(sol[r] - sol[r - 1])).toBeGreaterThan(1)
    }
  })

  it('growRegions (baseline flood fill) yields N connected regions each holding its queen', () => {
    const rng = makeRng('grow')
    const sol = randomSolution(8, rng)
    const regions = growRegions(8, sol, rng)
    expect(validateRegions(regions)).toEqual([])
    sol.forEach((c, r) => expect(regions[r][c]).toBe(r))
  })

  it('buildRegions yields N connected regions each holding its queen', () => {
    for (const size of SIZES) {
      const rng = makeRng(`build-${size}`)
      const sol = randomSolution(size, rng)
      const regions = buildRegions(size, sol, rng, sampleStyle(rng, size, 'any'))
      expect(validateRegions(regions), String(size)).toEqual([])
      sol.forEach((c, r) => expect(regions[r][c]).toBe(r))
    }
  })

  it('repairUniqueness keeps the board valid and reports uniqueness truthfully', () => {
    let successes = 0
    for (let i = 0; i < 10; i++) {
      const rng = makeRng(`repair-${i}`)
      const sol = randomSolution(8, rng)
      const regions = growRegions(8, sol, rng)
      const ok = repairUniqueness(regions, sol, rng)
      expect(validateRegions(regions)).toEqual([])
      expect(countSolutions({ size: 8, regions }, 2) === 1).toBe(ok)
      if (ok) successes++
    }
    expect(successes).toBeGreaterThan(0)
  })
})

describe('distribution vs LinkedIn', () => {
  it(
    'keeps tiny-region share and largest-region share close to LinkedIn (sizes 7–9)',
    () => {
      resetGeneratorHistory()
      const li = (linkedin as Puzzle[]).filter((p) => p.number !== 336 && p.size <= 9)
      const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length
      const liStats = li.map((p) => boardStats(p.regions))
      const gen: Puzzle[] = []
      for (let i = 0; i < 36; i++) gen.push(generatePuzzle({ size: 7 + (i % 3), seed: `dist-${i}` }))
      const genStats = gen.map((p) => boardStats(p.regions))
      const tinyDelta = mean(genStats.map((s) => s.tinyShare)) - mean(liStats.map((s) => s.tinyShare))
      const largestDelta = mean(genStats.map((s) => s.largestShare)) - mean(liStats.map((s) => s.largestShare))
      expect(Math.abs(tinyDelta)).toBeLessThan(0.12)
      expect(Math.abs(largestDelta)).toBeLessThan(0.12)
    },
    60_000,
  )
})
