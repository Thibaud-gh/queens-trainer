/**
 * Pure game model for playing a Queens puzzle. No React here so it can be
 * unit-tested directly. Everything is immutable: every reducer call returns a
 * fresh state and never mutates the previous one.
 */
import { cellsEliminatedBy, cloneBoard, conflictingQueens, emptyBoard, isSolved, queensOf } from '../core/puzzle'
import type { Board, CellMark, Puzzle, Solution } from '../core/types'

/** `cellKey -> keys of the queens whose placement auto-marked that cell`. */
export type AutoXMap = Record<number, number[]>

export interface Snapshot {
  board: Board
  autoX: AutoXMap
}

export interface DragState {
  startRow: number
  startCol: number
  /** Paint x's on empty cells, or erase x's, decided by the cell the drag started on. */
  mode: 'paint' | 'erase'
  /** Becomes true as soon as the pointer enters a second cell. */
  moved: boolean
  lastKey: number
}

export interface GameState {
  puzzle: Puzzle
  board: Board
  autoX: AutoXMap
  past: Snapshot[]
  future: Snapshot[]
  hintsUsed: number
  autoXEnabled: boolean
  solved: boolean
  /** True once the player has changed the board at least once (starts the timer). */
  started: boolean
  /** Counter bumped every time a queen is placed; the UI uses it for haptics. */
  queenPlacements: number
  drag: DragState | null
}

export type GameAction =
  | { type: 'tap'; row: number; col: number }
  | { type: 'setMark'; row: number; col: number; mark: CellMark }
  | { type: 'dragStart'; row: number; col: number }
  | { type: 'dragMove'; row: number; col: number }
  | { type: 'dragEnd' }
  | { type: 'undo' }
  | { type: 'redo' }
  | { type: 'clear' }
  | { type: 'hint'; solution: Solution }
  | { type: 'setAutoX'; enabled: boolean }
  | { type: 'reset' }

export interface SavedGame {
  board: Board
  autoX: AutoXMap
  hintsUsed: number
}

export function cellKey(size: number, row: number, col: number): number {
  return row * size + col
}

export function createGameState(puzzle: Puzzle, options: { autoXEnabled?: boolean; saved?: SavedGame | null } = {}): GameState {
  const n = puzzle.size
  const saved = options.saved && isValidSavedBoard(options.saved, n) ? options.saved : null
  const board = saved ? cloneBoard(saved.board) : emptyBoard(n)
  return {
    puzzle,
    board,
    autoX: saved ? { ...(saved.autoX ?? {}) } : {},
    past: [],
    future: [],
    hintsUsed: saved?.hintsUsed ?? 0,
    autoXEnabled: options.autoXEnabled ?? true,
    solved: isSolved(puzzle, board),
    started: saved ? !isBoardEmpty(board) : false,
    queenPlacements: 0,
    drag: null,
  }
}

function isValidSavedBoard(saved: SavedGame, n: number): boolean {
  if (!Array.isArray(saved.board) || saved.board.length !== n) return false
  return saved.board.every(
    (row) => Array.isArray(row) && row.length === n && row.every((m) => m === 'empty' || m === 'x' || m === 'queen'),
  )
}

export function isBoardEmpty(board: Board): boolean {
  return board.every((row) => row.every((m) => m === 'empty'))
}

export function toSavedGame(state: Pick<GameState, 'board' | 'autoX' | 'hintsUsed'>): SavedGame {
  return { board: state.board, autoX: state.autoX, hintsUsed: state.hintsUsed }
}

/* ------------------------------------------------------------------------ */
/* Draft helpers (operate on a cloned snapshot)                              */
/* ------------------------------------------------------------------------ */

interface Draft {
  board: Board
  autoX: AutoXMap
  queenPlaced: boolean
}

function draftOf(state: GameState): Draft {
  return { board: cloneBoard(state.board), autoX: { ...state.autoX }, queenPlaced: false }
}

function placeQueen(draft: Draft, puzzle: Puzzle, row: number, col: number, autoXEnabled: boolean): void {
  const n = puzzle.size
  const qk = cellKey(n, row, col)
  delete draft.autoX[qk]
  draft.board[row][col] = 'queen'
  draft.queenPlaced = true
  if (!autoXEnabled) return
  for (const cell of cellsEliminatedBy(puzzle, row, col)) {
    const k = cellKey(n, cell.row, cell.col)
    const mark = draft.board[cell.row][cell.col]
    if (mark === 'empty') {
      draft.board[cell.row][cell.col] = 'x'
      draft.autoX[k] = [qk]
    } else if (mark === 'x' && draft.autoX[k] && !draft.autoX[k].includes(qk)) {
      draft.autoX[k] = [...draft.autoX[k], qk]
    }
  }
}

function removeQueen(draft: Draft, puzzle: Puzzle, row: number, col: number): void {
  const n = puzzle.size
  const qk = cellKey(n, row, col)
  draft.board[row][col] = 'empty'
  for (const keyStr of Object.keys(draft.autoX)) {
    const k = Number(keyStr)
    const owners = draft.autoX[k]
    if (!owners.includes(qk)) continue
    const rest = owners.filter((o) => o !== qk)
    if (rest.length) {
      draft.autoX[k] = rest
    } else {
      delete draft.autoX[k]
      const r = Math.floor(k / n)
      const c = k % n
      if (draft.board[r][c] === 'x') draft.board[r][c] = 'empty'
    }
  }
}

/** Set a cell to `mark`, keeping the auto-X bookkeeping consistent. Returns true when something changed. */
function setMark(draft: Draft, puzzle: Puzzle, row: number, col: number, mark: CellMark, autoXEnabled: boolean): boolean {
  const n = puzzle.size
  const current = draft.board[row][col]
  if (current === mark) return false
  if (current === 'queen') removeQueen(draft, puzzle, row, col)
  if (current === 'x') delete draft.autoX[cellKey(n, row, col)]
  if (mark === 'queen') placeQueen(draft, puzzle, row, col, autoXEnabled)
  else draft.board[row][col] = mark
  return true
}

export function nextMark(mark: CellMark): CellMark {
  return mark === 'empty' ? 'x' : mark === 'x' ? 'queen' : 'empty'
}

function commit(state: GameState, draft: Draft, extra: Partial<GameState> = {}): GameState {
  return {
    ...state,
    board: draft.board,
    autoX: draft.autoX,
    past: [...state.past, { board: state.board, autoX: state.autoX }],
    future: [],
    solved: isSolved(state.puzzle, draft.board),
    started: true,
    queenPlacements: state.queenPlacements + (draft.queenPlaced ? 1 : 0),
    ...extra,
  }
}

function applyPaint(draft: Draft, puzzle: Puzzle, mode: DragState['mode'], row: number, col: number): void {
  const current = draft.board[row][col]
  if (current === 'queen') return
  if (mode === 'paint' && current === 'empty') draft.board[row][col] = 'x'
  if (mode === 'erase' && current === 'x') {
    draft.board[row][col] = 'empty'
    delete draft.autoX[cellKey(puzzle.size, row, col)]
  }
}

/* ------------------------------------------------------------------------ */
/* Reducer                                                                   */
/* ------------------------------------------------------------------------ */

export function gameReducer(state: GameState, action: GameAction): GameState {
  const { puzzle } = state
  const n = puzzle.size
  switch (action.type) {
    case 'tap': {
      if (!inBounds(n, action.row, action.col)) return state
      const draft = draftOf(state)
      const mark = nextMark(state.board[action.row][action.col])
      setMark(draft, puzzle, action.row, action.col, mark, state.autoXEnabled)
      return commit(state, draft, { drag: null })
    }
    case 'setMark': {
      if (!inBounds(n, action.row, action.col)) return state
      const draft = draftOf(state)
      if (!setMark(draft, puzzle, action.row, action.col, action.mark, state.autoXEnabled)) return state
      return commit(state, draft, { drag: null })
    }
    case 'dragStart': {
      if (!inBounds(n, action.row, action.col)) return state
      const startMark = state.board[action.row][action.col]
      return {
        ...state,
        drag: {
          startRow: action.row,
          startCol: action.col,
          mode: startMark === 'x' ? 'erase' : 'paint',
          moved: false,
          lastKey: cellKey(n, action.row, action.col),
        },
      }
    }
    case 'dragMove': {
      const drag = state.drag
      if (!drag || !inBounds(n, action.row, action.col)) return state
      const key = cellKey(n, action.row, action.col)
      if (key === drag.lastKey) return state
      const draft = draftOf(state)
      if (!drag.moved) {
        applyPaint(draft, puzzle, drag.mode, drag.startRow, drag.startCol)
        applyPaint(draft, puzzle, drag.mode, action.row, action.col)
        // The first movement opens a single history entry for the whole stroke.
        return commit(state, draft, { drag: { ...drag, moved: true, lastKey: key } })
      }
      applyPaint(draft, puzzle, drag.mode, action.row, action.col)
      return {
        ...state,
        board: draft.board,
        autoX: draft.autoX,
        drag: { ...drag, lastKey: key },
      }
    }
    case 'dragEnd': {
      const drag = state.drag
      if (!drag) return state
      if (!drag.moved) return gameReducer({ ...state, drag: null }, { type: 'tap', row: drag.startRow, col: drag.startCol })
      return { ...state, drag: null }
    }
    case 'undo': {
      if (!state.past.length) return state
      const prev = state.past[state.past.length - 1]
      return {
        ...state,
        board: prev.board,
        autoX: prev.autoX,
        past: state.past.slice(0, -1),
        future: [{ board: state.board, autoX: state.autoX }, ...state.future],
        solved: isSolved(puzzle, prev.board),
        drag: null,
      }
    }
    case 'redo': {
      if (!state.future.length) return state
      const next = state.future[0]
      return {
        ...state,
        board: next.board,
        autoX: next.autoX,
        past: [...state.past, { board: state.board, autoX: state.autoX }],
        future: state.future.slice(1),
        solved: isSolved(puzzle, next.board),
        drag: null,
      }
    }
    case 'clear': {
      if (isBoardEmpty(state.board)) return { ...state, drag: null }
      const draft: Draft = { board: emptyBoard(n), autoX: {}, queenPlaced: false }
      return commit(state, draft, { drag: null })
    }
    case 'hint': {
      const target = pickHint(state, action.solution)
      if (!target) return state
      const draft = draftOf(state)
      // Remove queens that contradict the revealed queen; they are necessarily wrong.
      for (const q of queensOf(draft.board)) {
        if (q.row === target.row && q.col === target.col) continue
        const touching = Math.abs(q.row - target.row) <= 1 && Math.abs(q.col - target.col) <= 1
        if (
          q.row === target.row ||
          q.col === target.col ||
          puzzle.regions[q.row][q.col] === puzzle.regions[target.row][target.col] ||
          touching
        ) {
          removeQueen(draft, puzzle, q.row, q.col)
        }
      }
      setMark(draft, puzzle, target.row, target.col, 'queen', state.autoXEnabled)
      return commit(state, draft, { hintsUsed: state.hintsUsed + 1, drag: null })
    }
    case 'setAutoX':
      return state.autoXEnabled === action.enabled ? state : { ...state, autoXEnabled: action.enabled }
    case 'reset':
      return createGameState(puzzle, { autoXEnabled: state.autoXEnabled })
    default:
      return state
  }
}

function inBounds(n: number, row: number, col: number): boolean {
  return Number.isInteger(row) && Number.isInteger(col) && row >= 0 && col >= 0 && row < n && col < n
}

/** First row (top-down) whose correct queen is missing, preferring rows that hold a wrong queen. */
function pickHint(state: GameState, solution: Solution): { row: number; col: number } | null {
  const n = state.puzzle.size
  if (solution.length !== n) return null
  let firstMissing: { row: number; col: number } | null = null
  for (let r = 0; r < n; r++) {
    const c = solution[r]
    if (state.board[r][c] === 'queen') continue
    const wrongQueenInRow = state.board[r].some((m) => m === 'queen')
    if (wrongQueenInRow) return { row: r, col: c }
    if (!firstMissing) firstMissing = { row: r, col: c }
  }
  return firstMissing
}

/* ------------------------------------------------------------------------ */
/* Derived data for rendering                                                */
/* ------------------------------------------------------------------------ */

export interface Conflicts {
  /** Cell keys of queens that violate a rule. */
  queens: Set<number>
  rows: Set<number>
  cols: Set<number>
  regions: Set<number>
}

export function computeConflicts(puzzle: Pick<Puzzle, 'size' | 'regions'>, board: Board): Conflicts {
  const n = puzzle.size
  const rows = new Map<number, number>()
  const cols = new Map<number, number>()
  const regions = new Map<number, number>()
  for (const q of queensOf(board)) {
    rows.set(q.row, (rows.get(q.row) ?? 0) + 1)
    cols.set(q.col, (cols.get(q.col) ?? 0) + 1)
    const g = puzzle.regions[q.row][q.col]
    regions.set(g, (regions.get(g) ?? 0) + 1)
  }
  const dup = (m: Map<number, number>) => new Set([...m.entries()].filter(([, k]) => k >= 2).map(([i]) => i))
  return {
    queens: conflictingQueens({ size: n, regions: puzzle.regions }, board),
    rows: dup(rows),
    cols: dup(cols),
    regions: dup(regions),
  }
}
