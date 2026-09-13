import { expect, it } from 'vitest'
import { generatePuzzle } from './generator'
import { calibratedProfiles, isCalibrationLayout } from './generator-calibration'
import { profileBoard } from './generator-profile'
import { validateRegions } from './puzzle'
import { countSolutions } from './solver'
import golden from '../../scripts/test-data/v2-replay.json'

it('keeps the five frozen v2 seed outputs unchanged', () => {
  for (const p of golden) expect(generatePuzzle({ size: p.size, seed: 'v3-compat', version: 'profile-v2' })).toEqual(p)
}, 60_000)

it('uses the expanded frozen profile corpus', () => {
  expect(calibratedProfiles()).toHaveLength(854)
})

it('enforces singleton selection through construction and repair at every size', () => {
  for (const size of [7, 8, 9, 10, 11]) {
    for (const seed of ['v3-validation-a', 'v3-validation-b']) {
      const p = generatePuzzle({ size, seed, version: 'profile-v3' })
      expect(validateRegions(p.regions)).toEqual([])
      expect(countSolutions(p, 2)).toBe(1)
      expect(isCalibrationLayout(p.regions)).toBe(false)
      expect(Boolean(profileBoard(p).features.hasSingleton)).toBe(p.generation?.singletonAllowed)
      expect(p.generation?.version).toBe('profile-v3')
    }
  }
}, 120_000)

it('replays v3 independently of intervening requests', () => {
  const options = { size: 7, seed: 'v3-replay', version: 'profile-v3' as const }
  const puzzle = generatePuzzle(options)
  generatePuzzle({ ...options, seed: 'intervening' })
  expect(generatePuzzle(options)).toEqual(puzzle)
}, 30_000)

it('retains occasional singleton boards and never silently switches groups', () => {
  const options = { size: 7, seed: 'singleton-2', version: 'profile-v3' as const }
  const p = generatePuzzle(options)
  expect(p.generation?.singletonAllowed).toBe(true)
  expect(profileBoard(p).features.hasSingleton).toBe(1)
  const withoutSingles = calibratedProfiles().filter(p => p.features.hasSingleton === 0)
  expect(() => generatePuzzle({ ...options, profiles: withoutSingles })).toThrow('No training profiles')
}, 30_000)
