import { describe, expect, it } from 'vitest'
import { generatePuzzle, resetGeneratorHistory } from './generator'
import { historicalProfiles, isHistoricalLayout } from './generator-profile'
import { encodeRegions, validateRegions } from './puzzle'
import { countSolutions } from './solver'
import { rateDifficulty } from './deduction'

describe('versioned generators', () => {
  it('preserves pre-change legacy boards exactly', () => {
    const golden = [
      [7, '7:0111111012123301222340155334015004400006660000066', 'hard'],
      [8, '8:0111022201000222000000003405060034555600345556003475660077755550', 'hard'],
      [9, '9:000112333000012333400012355466612335463663335433333377338883377333383777333383777', 'hard'],
      [10, '10:0000111112030112222233444255526442222522664422777766422228876999222887669622277769966622226666222222', 'hard'],
      [11, '11:001100022220001034225200110344552000003342520600000222266700008822600009008290000090888900099999989a9999999999aa999999999', 'medium'],
    ] as const
    for (const [size, code, difficulty] of golden) {
      resetGeneratorHistory()
      const puzzle = generatePuzzle({ size, seed: 'legacy-golden', version: 'legacy' })
      expect(encodeRegions(puzzle.regions)).toBe(code)
      expect(puzzle.difficulty).toBe(difficulty)
    }
  })

  it('generates connected, unique, original puzzles at every historical size', () => {
    for (const size of [7, 8, 9, 10, 11]) {
      for (const seed of ['validation-a', 'validation-b']) {
        const p = generatePuzzle({ size, seed })
        expect(validateRegions(p.regions)).toEqual([])
        expect(countSolutions(p, 2)).toBe(1)
        expect(isHistoricalLayout(p.regions)).toBe(false)
        expect(p.difficulty).toBe(rateDifficulty(p))
        expect(p.generation?.attempts).toBeLessThanOrEqual(120)
        expect(p.generation?.version).toBe('profile-v2')
      }
    }
  }, 120_000)

  it('is independent of generation order and isolates legacy history', () => {
    const opts = { size: 8, seed: 'replay', difficulty: 'medium' as const }
    const a = generatePuzzle(opts)
    generatePuzzle({ size: 8, seed: 'unrelated' })
    generatePuzzle({ size: 8, seed: 'unrelated', version: 'legacy' })
    expect(generatePuzzle(opts)).toEqual(a)
    resetGeneratorHistory()
    expect(generatePuzzle(opts)).toEqual(a)
  }, 30_000)

  it('samples only supplied training profiles and reports difficulty misses honestly', () => {
    const target = historicalProfiles().find(p => p.size === 7 && p.difficulty === 'medium')!
    const p = generatePuzzle({ size: 7, seed: 'training', profiles: [target], candidates: 2 })
    expect(p.generation?.targetDifficulty).toBe('medium')
    expect(p.generation?.difficultyMatched).toBe(p.difficulty === 'medium')
    expect(() => generatePuzzle({ size: 8, profiles: [target] })).toThrow('No training profiles')
  })

  it('rejects non-finite budgets rather than looping indefinitely', () => {
    expect(() => generatePuzzle({ size: NaN })).toThrow('finite')
    expect(() => generatePuzzle({ maxAttempts: NaN })).toThrow('finite')
  })

  it('can reach every requested difficulty and distinguishes legacy progress IDs', () => {
    for (const difficulty of ['easy', 'medium', 'hard', 'expert'] as const) {
      const p = generatePuzzle({ size: 9, seed: 'difficulty-check', difficulty })
      expect(p.difficulty).toBe(difficulty)
    }
    const easy = generatePuzzle({ size: 7, seed: 'progress', version: 'legacy', difficulty: 'easy' })
    const hard = generatePuzzle({ size: 7, seed: 'progress', version: 'legacy', difficulty: 'hard' })
    expect(easy.id).not.toBe(hard.id)
  }, 30_000)
})
