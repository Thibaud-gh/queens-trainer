import { expect, it } from 'vitest'
import { parseHash, routeToHash } from './routes'
import { buildGenerateOptions } from './generateAsync'
import { generatePuzzle } from '../core/generator'

it('preserves unversioned links as legacy/any', () => {
  expect(parseHash('#/gen/9/old-seed')).toEqual({ view: 'gen', size: 9, seed: 'old-seed', version: 'legacy', difficulty: 'any' })
})

it('plays the same expert puzzle shown in the preview', () => {
  const route = { view: 'gen' as const, size: 7, seed: 'expert/replay', version: 'profile-v2' as const, difficulty: 'expert' as const }
  const parsed = parseHash(routeToHash(route))
  expect(parsed).toEqual(route)
  if (parsed.view !== 'gen') throw new Error('Invalid test route')
  const preview = generatePuzzle(buildGenerateOptions(route.size, route.seed, route.difficulty, route.version))
  const played = generatePuzzle(buildGenerateOptions(parsed.size, parsed.seed, parsed.difficulty ?? 'any', parsed.version))
  expect(played.regions).toEqual(preview.regions)
  expect(played.difficulty).toBe(preview.difficulty)
}, 30_000)

it('rejects unknown generator versions and difficulties', () => {
  expect(parseHash('#/gen/8/seed/future/expert')).toEqual({ view: 'generate' })
  expect(parseHash('#/gen/8/seed/profile-v2/typo')).toEqual({ view: 'generate' })
})

it('roundtrips the recalibrated generator and difficulty', () => {
  const route = { view: 'gen' as const, size: 8, seed: 'new-history', version: 'profile-v3' as const, difficulty: 'hard' as const }
  expect(parseHash(routeToHash(route))).toEqual(route)
})
