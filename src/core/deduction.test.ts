import { describe, expect, it } from 'vitest'
import linkedin from '../data/linkedin-puzzles.json'
import { deduce, difficultyFromResult, explainSolution, nextHint, rateDifficulty } from './deduction'
import { emptyBoard } from './puzzle'
import { uniqueSolution } from './solver'
import type { Difficulty, Puzzle } from './types'

const boards = (linkedin as Puzzle[]).filter((p) => p.number !== 336)
const byId = (id: string) => boards.find((p) => p.id === id)!

describe('deduction solver', () => {
  it('solves LinkedIn #1 by pure deduction and agrees with backtracking', () => {
    const p = byId('li-1')
    const res = deduce(p)
    expect(res.solved).toBe(true)
    expect(res.contradiction).toBe(false)
    expect(res.solution).toEqual(uniqueSolution(p))
    expect(res.steps.length).toBeGreaterThan(0)
    expect(res.maxLevel).toBeGreaterThanOrEqual(2)
    // every recorded step either places a queen or eliminates something
    for (const step of res.steps) expect(step.placed !== undefined || step.eliminated.length > 0).toBe(true)
  })

  it('agrees with backtracking on 50 LinkedIn boards', () => {
    for (const p of boards.slice(0, 50)) {
      const res = deduce(p)
      expect(res.solved, p.id).toBe(true)
      expect(res.solution, p.id).toEqual(uniqueSolution(p))
    }
  })

  it('rates every difficulty level somewhere in the LinkedIn set', () => {
    const seen = new Set<Difficulty>()
    for (const p of boards) seen.add(rateDifficulty(p))
    expect([...seen].sort()).toEqual(['easy', 'expert', 'hard', 'medium'])
  })

  it('maps deduction results to difficulties', () => {
    expect(difficultyFromResult({ solved: true, maxLevel: 2 })).toBe('easy')
    expect(difficultyFromResult({ solved: true, maxLevel: 3 })).toBe('medium')
    expect(difficultyFromResult({ solved: true, maxLevel: 4 })).toBe('hard')
    expect(difficultyFromResult({ solved: true, maxLevel: 5 })).toBe('hard')
    expect(difficultyFromResult({ solved: true, maxLevel: 6 })).toBe('expert')
    expect(difficultyFromResult({ solved: false, maxLevel: 3 })).toBe('expert')
  })

  it('respects the maxLevel cap', () => {
    // #2 needs level 5 with the full engine, so levels ≤ 3 must get stuck
    const p = byId('li-2')
    expect(deduce(p).maxLevel).toBe(5)
    const capped = deduce(p, { maxLevel: 3 })
    expect(capped.solved).toBe(false)
    expect(capped.contradiction).toBe(false)
    expect(capped.maxLevel).toBeLessThanOrEqual(3)
  })

  it('explains the solution as text lines ending with a summary', () => {
    const lines = explainSolution(byId('li-1'))
    expect(lines.length).toBeGreaterThan(1)
    expect(lines[0]).toMatch(/^1\. \[/)
    expect(lines[lines.length - 1]).toMatch(/^Solved with techniques up to level/)
  })

  it('gives a hint from a player board and detects contradictions', () => {
    const p = byId('li-1')
    const hint = nextHint(p, emptyBoard(p.size))
    expect(hint).not.toBeNull()
    expect(hint!.level).toBeGreaterThanOrEqual(2)

    // player marks and queens are honoured
    const sol = uniqueSolution(p)!
    const board = emptyBoard(p.size)
    board[0][sol[0]] = 'queen'
    const res = deduce(p, { board })
    expect(res.solved).toBe(true)
    expect(res.solution).toEqual(sol)
    expect(res.steps[0].level).toBe(1) // the given queen's eliminations come first

    // two queens in one row is a contradiction
    const bad = emptyBoard(p.size)
    bad[0][0] = 'queen'
    bad[0][5] = 'queen'
    const badRes = deduce(p, { board: bad })
    expect(badRes.contradiction).toBe(true)
    expect(badRes.solved).toBe(false)
    expect(nextHint(p, bad)).toBeNull()
  })
})
