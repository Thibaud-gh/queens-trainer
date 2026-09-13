import { describe, expect, it } from 'vitest'
import { cellsEliminatedBy, emptyBoard } from '../core/puzzle'
import { solve } from '../core/solver'
import type { Puzzle } from '../core/types'
import { cellKey, computeConflicts, createGameState, gameReducer, type GameAction, type GameState } from './gameState'

// LinkedIn Queens #1 (8×8), unique solution.
const puzzle: Puzzle = {
  id: 'li-1',
  size: 8,
  source: 'linkedin',
  regions: [
    [0, 0, 1, 1, 1, 2, 2, 2],
    [0, 3, 1, 3, 1, 4, 2, 2],
    [0, 3, 1, 3, 1, 2, 2, 2],
    [0, 3, 3, 3, 1, 5, 6, 2],
    [0, 3, 3, 3, 1, 5, 6, 6],
    [0, 3, 7, 3, 1, 5, 6, 6],
    [7, 3, 7, 3, 1, 5, 5, 6],
    [7, 7, 7, 7, 6, 6, 6, 6],
  ],
}

function run(state: GameState, ...actions: GameAction[]): GameState {
  return actions.reduce(gameReducer, state)
}

function countMarks(state: GameState, mark: string): number {
  return state.board.flat().filter((m) => m === mark).length
}

describe('tap cycling', () => {
  it('cycles empty → x → queen → empty', () => {
    let s = createGameState(puzzle, { autoXEnabled: false })
    s = gameReducer(s, { type: 'tap', row: 0, col: 0 })
    expect(s.board[0][0]).toBe('x')
    s = gameReducer(s, { type: 'tap', row: 0, col: 0 })
    expect(s.board[0][0]).toBe('queen')
    s = gameReducer(s, { type: 'tap', row: 0, col: 0 })
    expect(s.board[0][0]).toBe('empty')
    expect(s.started).toBe(true)
  })

  it('ignores out-of-range cells', () => {
    const s = createGameState(puzzle)
    expect(gameReducer(s, { type: 'tap', row: 8, col: 0 })).toBe(s)
    expect(gameReducer(s, { type: 'tap', row: -1, col: 0 })).toBe(s)
  })

  it('does not mutate the previous state', () => {
    const s0 = createGameState(puzzle)
    const before = JSON.stringify(s0.board)
    gameReducer(s0, { type: 'tap', row: 2, col: 2 })
    expect(JSON.stringify(s0.board)).toBe(before)
  })
})

describe('auto-X', () => {
  it('marks every eliminated empty cell when a queen is placed', () => {
    const s = gameReducer(createGameState(puzzle), { type: 'setMark', row: 3, col: 3, mark: 'queen' })
    const eliminated = cellsEliminatedBy(puzzle, 3, 3)
    for (const c of eliminated) {
      expect(s.board[c.row][c.col]).toBe('x')
      expect(s.autoX[cellKey(8, c.row, c.col)]).toEqual([cellKey(8, 3, 3)])
    }
    expect(countMarks(s, 'x')).toBe(eliminated.length)
    expect(s.queenPlacements).toBe(1)
  })

  it('does not overwrite manual x marks and does not claim them', () => {
    let s = createGameState(puzzle)
    s = gameReducer(s, { type: 'tap', row: 0, col: 5 }) // manual x in row 0
    s = gameReducer(s, { type: 'setMark', row: 0, col: 0, mark: 'queen' })
    expect(s.board[0][5]).toBe('x')
    expect(s.autoX[cellKey(8, 0, 5)]).toBeUndefined()
    // Removing the queen keeps the manual x.
    s = gameReducer(s, { type: 'setMark', row: 0, col: 0, mark: 'empty' })
    expect(s.board[0][5]).toBe('x')
  })

  it('removes auto x marks when their queen is removed, unless another queen also eliminates them', () => {
    let s = createGameState(puzzle)
    s = gameReducer(s, { type: 'setMark', row: 0, col: 0, mark: 'queen' })
    s = gameReducer(s, { type: 'setMark', row: 7, col: 7, mark: 'queen' })
    // (0,7) is eliminated by both queens (row 0 and column 7).
    expect(s.autoX[cellKey(8, 0, 7)]).toEqual([cellKey(8, 0, 0), cellKey(8, 7, 7)])
    // Remove the first queen by cycling queen → empty.
    s = gameReducer(s, { type: 'tap', row: 0, col: 0 })
    expect(s.board[0][0]).toBe('empty')
    expect(s.board[0][1]).toBe('empty') // only eliminated by the removed queen
    expect(s.board[0][7]).toBe('x') // still eliminated by the queen at (7,7)
    expect(s.autoX[cellKey(8, 0, 7)]).toEqual([cellKey(8, 7, 7)])
    // Remove the second queen: everything is clear again.
    s = gameReducer(s, { type: 'tap', row: 7, col: 7 })
    expect(countMarks(s, 'x')).toBe(0)
    expect(Object.keys(s.autoX)).toHaveLength(0)
  })

  it('tapping an auto x turns it into a queen and forgets the auto bookkeeping', () => {
    let s = createGameState(puzzle)
    s = gameReducer(s, { type: 'setMark', row: 0, col: 0, mark: 'queen' })
    s = gameReducer(s, { type: 'tap', row: 0, col: 4 }) // auto x → queen (same row: conflict, allowed)
    expect(s.board[0][4]).toBe('queen')
    expect(s.autoX[cellKey(8, 0, 4)]).toBeUndefined()
    s = gameReducer(s, { type: 'setMark', row: 0, col: 0, mark: 'empty' })
    expect(s.board[0][4]).toBe('queen')
  })

  it('places no x marks when disabled', () => {
    const s = gameReducer(createGameState(puzzle, { autoXEnabled: false }), { type: 'tap', row: 0, col: 0 })
    const s2 = gameReducer(s, { type: 'tap', row: 0, col: 0 })
    expect(s2.board[0][0]).toBe('queen')
    expect(countMarks(s2, 'x')).toBe(0)
  })
})

describe('drag painting', () => {
  it('a press and release without movement is a tap', () => {
    const s = run(createGameState(puzzle), { type: 'dragStart', row: 1, col: 1 }, { type: 'dragEnd' })
    expect(s.board[1][1]).toBe('x')
    expect(s.drag).toBeNull()
    expect(s.past).toHaveLength(1)
  })

  it('paints x on every empty cell passed over, including the start cell, as one history entry', () => {
    const s = run(
      createGameState(puzzle),
      { type: 'dragStart', row: 2, col: 0 },
      { type: 'dragMove', row: 2, col: 1 },
      { type: 'dragMove', row: 2, col: 2 },
      { type: 'dragMove', row: 2, col: 3 },
      { type: 'dragEnd' },
    )
    expect(s.board[2].slice(0, 4)).toEqual(['x', 'x', 'x', 'x'])
    expect(s.board[2][4]).toBe('empty')
    expect(s.past).toHaveLength(1)
    const undone = gameReducer(s, { type: 'undo' })
    expect(undone.board[2].slice(0, 4)).toEqual(['empty', 'empty', 'empty', 'empty'])
  })

  it('skips queens while painting', () => {
    let s = gameReducer(createGameState(puzzle, { autoXEnabled: false }), { type: 'setMark', row: 2, col: 1, mark: 'queen' })
    s = run(s, { type: 'dragStart', row: 2, col: 0 }, { type: 'dragMove', row: 2, col: 1 }, { type: 'dragMove', row: 2, col: 2 }, { type: 'dragEnd' })
    expect(s.board[2]).toEqual(['x', 'queen', 'x', 'empty', 'empty', 'empty', 'empty', 'empty'])
  })

  it('erases x marks when the drag starts on an x', () => {
    let s = createGameState(puzzle)
    s = run(s, { type: 'dragStart', row: 5, col: 0 }, { type: 'dragMove', row: 5, col: 1 }, { type: 'dragMove', row: 5, col: 2 }, { type: 'dragEnd' })
    expect(s.board[5].slice(0, 3)).toEqual(['x', 'x', 'x'])
    s = run(s, { type: 'dragStart', row: 5, col: 2 }, { type: 'dragMove', row: 5, col: 1 }, { type: 'dragMove', row: 5, col: 0 }, { type: 'dragEnd' })
    expect(s.board[5].slice(0, 3)).toEqual(['empty', 'empty', 'empty'])
    expect(s.past).toHaveLength(2)
  })

  it('erasing an auto x removes its bookkeeping', () => {
    let s = gameReducer(createGameState(puzzle), { type: 'setMark', row: 0, col: 0, mark: 'queen' })
    s = run(s, { type: 'dragStart', row: 0, col: 3 }, { type: 'dragMove', row: 0, col: 4 }, { type: 'dragEnd' })
    expect(s.board[0][3]).toBe('empty')
    expect(s.board[0][4]).toBe('empty')
    expect(s.autoX[cellKey(8, 0, 3)]).toBeUndefined()
  })

  it('moving back over the same cell is a no-op', () => {
    const s = run(createGameState(puzzle), { type: 'dragStart', row: 4, col: 4 }, { type: 'dragMove', row: 4, col: 5 })
    expect(gameReducer(s, { type: 'dragMove', row: 4, col: 5 })).toBe(s)
  })
})

describe('undo / redo', () => {
  it('walks the full history back and forth', () => {
    const s0 = createGameState(puzzle, { autoXEnabled: false })
    const s1 = gameReducer(s0, { type: 'tap', row: 0, col: 0 })
    const s2 = gameReducer(s1, { type: 'tap', row: 1, col: 2 })
    const s3 = gameReducer(s2, { type: 'tap', row: 1, col: 2 })
    expect(s3.past).toHaveLength(3)
    const u1 = gameReducer(s3, { type: 'undo' })
    expect(u1.board).toEqual(s2.board)
    const u2 = gameReducer(u1, { type: 'undo' })
    expect(u2.board).toEqual(s1.board)
    const u3 = gameReducer(u2, { type: 'undo' })
    expect(u3.board).toEqual(s0.board)
    expect(gameReducer(u3, { type: 'undo' })).toBe(u3) // nothing left
    const r1 = gameReducer(u3, { type: 'redo' })
    expect(r1.board).toEqual(s1.board)
    const r2 = run(r1, { type: 'redo' }, { type: 'redo' })
    expect(r2.board).toEqual(s3.board)
    expect(gameReducer(r2, { type: 'redo' })).toBe(r2)
  })

  it('a new move clears the redo stack and restores auto-x bookkeeping on undo', () => {
    let s = gameReducer(createGameState(puzzle), { type: 'setMark', row: 3, col: 3, mark: 'queen' })
    s = gameReducer(s, { type: 'undo' })
    expect(Object.keys(s.autoX)).toHaveLength(0)
    expect(s.future).toHaveLength(1)
    s = gameReducer(s, { type: 'tap', row: 7, col: 0 })
    expect(s.future).toHaveLength(0)
    s = gameReducer(s, { type: 'redo' })
    expect(s.board[7][0]).toBe('x')
  })

  it('clear wipes the board as one undoable step', () => {
    let s = gameReducer(createGameState(puzzle), { type: 'setMark', row: 3, col: 3, mark: 'queen' })
    s = gameReducer(s, { type: 'clear' })
    expect(s.board).toEqual(emptyBoard(8))
    expect(s.autoX).toEqual({})
    s = gameReducer(s, { type: 'undo' })
    expect(s.board[3][3]).toBe('queen')
  })
})

describe('hints and solving', () => {
  const solution = solve(puzzle, 2)[0]

  it('reveals correct queens one at a time and solves the puzzle', () => {
    let s = createGameState(puzzle)
    for (let i = 0; i < 8; i++) {
      s = gameReducer(s, { type: 'hint', solution })
      expect(s.hintsUsed).toBe(i + 1)
    }
    expect(s.solved).toBe(true)
    expect(gameReducer(s, { type: 'hint', solution })).toBe(s)
    solution.forEach((c, r) => expect(s.board[r][c]).toBe('queen'))
  })

  it('a hint replaces a wrong queen in the same row', () => {
    const wrongCol = (solution[0] + 2) % 8
    let s = gameReducer(createGameState(puzzle), { type: 'setMark', row: 0, col: wrongCol, mark: 'queen' })
    s = gameReducer(s, { type: 'hint', solution })
    expect(s.board[0][wrongCol]).toBe('x') // eliminated by the correct queen
    expect(s.board[0][solution[0]]).toBe('queen')
  })

  it('flags conflicting queens and duplicated lines', () => {
    const s = run(
      createGameState(puzzle, { autoXEnabled: false }),
      { type: 'setMark', row: 0, col: 0, mark: 'queen' },
      { type: 'setMark', row: 0, col: 5, mark: 'queen' },
    )
    const c = computeConflicts(puzzle, s.board)
    expect(c.queens).toEqual(new Set([cellKey(8, 0, 0), cellKey(8, 0, 5)]))
    expect(c.rows).toEqual(new Set([0]))
    expect(c.cols.size).toBe(0)
  })

  it('restores a saved game', () => {
    const played = gameReducer(createGameState(puzzle), { type: 'setMark', row: 3, col: 3, mark: 'queen' })
    const restored = createGameState(puzzle, { saved: { board: played.board, autoX: played.autoX, hintsUsed: 2 } })
    expect(restored.board).toEqual(played.board)
    expect(restored.hintsUsed).toBe(2)
    expect(restored.started).toBe(true)
    // Auto x bookkeeping survives, so removing the queen clears its marks.
    const cleared = gameReducer(restored, { type: 'tap', row: 3, col: 3 })
    expect(countMarks(cleared, 'x')).toBe(0)
  })

  it('rejects a saved board of the wrong size', () => {
    const restored = createGameState(puzzle, { saved: { board: emptyBoard(7), autoX: {}, hintsUsed: 0 } })
    expect(restored.board).toEqual(emptyBoard(8))
  })
})
