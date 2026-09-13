import { expect, it } from 'vitest'
import { isHoldout, parseArgs, wasserstein, correlation } from './benchmark-generators.ts'
import archive from '../src/data/linkedin-puzzles.json'
import { profileBoard } from '../src/core/generator-profile.ts'
import { generatePuzzle } from '../src/core/generator.ts'
import { countSolutions } from '../src/core/solver.ts'

it('compares full distributions even when means are identical', () => {
  expect(wasserstein([0, 2], [1, 1])).toBe(1)
  expect(wasserstein([0, 1], [0, 0, 1, 1])).toBe(0)
  expect(wasserstein([0], [1, 2])).toBe(1.5)
  expect(() => wasserstein([], [1])).toThrow()
})

it('keeps rotations and label changes in the same training/holdout group', () => {
  const regions = [[0, 0, 1, 1], [2, 0, 1, 1], [2, 2, 3, 1], [2, 3, 3, 3]]
  const rotated = regions.map((row, r) => row.map((_, c) => 3 - regions[3 - c][r]))
  expect(isHoldout({ regions })).toBe(isHoldout({ regions: rotated }))
})

it('detects relationships and validates benchmark budgets', () => {
  expect(correlation([0, 1, 2], [0, 2, 4])).toBeCloseTo(1)
  expect(correlation([1, 1], [0, 1])).toBe(0)
  expect(parseArgs(['--count', '10', '--seeds', 'a,b']).seeds).toEqual(['a', 'b'])
  expect(() => parseArgs(['--count', 'NaN'])).toThrow()
  expect(() => parseArgs(['--sizes', '6'])).toThrow()
})

it('recovers the five unproductive profiles found in the first development batch', () => {
  const profiles = archive.filter(p => p.number !== 336 && !isHoldout(p)).map(profileBoard)
  for (const [size, seed] of [[8, 'validation-a-8-3'], [9, 'validation-a-9-4'], [9, 'validation-b-9-1'], [10, 'validation-a-10-5'], [10, 'validation-b-10-23']] as const) {
    const p = generatePuzzle({ size, seed, profiles })
    expect(countSolutions(p, 2)).toBe(1)
    expect(p.generation?.attempts).toBeLessThanOrEqual(120)
  }
}, 60_000)

it('supports reproducible version comparisons without identical arms', () => {
  const args = parseArgs(['--baseline', 'profile-v2', '--candidate', 'profile-v3', '--history', 'expanded'])
  expect(args.baseline).toBe('profile-v2')
  expect(args.candidate).toBe('profile-v3')
  expect(args.history).toBe('expanded')
  expect(() => parseArgs(['--baseline', 'profile-v2', '--candidate', 'profile-v2'])).toThrow('different')
})
