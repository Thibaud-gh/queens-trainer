/**
 * Core data model for the Queens trainer.
 *
 * A puzzle is an N×N grid partitioned into exactly N connected colour regions.
 * The goal is to place N queens so that every row, column and region contains
 * exactly one queen and no two queens touch, not even diagonally.
 */

/** Where a puzzle came from. */
export type PuzzleSource = 'linkedin' | 'generated' | 'custom' | 'community'

export interface Puzzle {
  /** Stable unique id, e.g. `li-123`, `gen-k3f9a2`, `custom-...`. */
  id: string
  /** Board side length N (LinkedIn uses 7–11, mostly 8–10). */
  size: number
  /**
   * `regions[row][col]` is the region index in `0..size-1`.
   * There are exactly `size` regions and every region is orthogonally connected.
   */
  regions: number[][]
  source: PuzzleSource
  /** LinkedIn daily puzzle number, when known. */
  number?: number
  /** ISO date (YYYY-MM-DD) the puzzle was published, when known. */
  date?: string
  /** Human-readable title. */
  name?: string
  /**
   * Optional per-region colours (hex), indexed by region. When absent the UI
   * assigns colours from its default palette.
   */
  colors?: string[]
  /** Optional difficulty rating produced by the deduction solver. */
  difficulty?: Difficulty
  /** Free-form provenance note (e.g. import source URL). */
  attribution?: string
  /** Diagnostics for profile generation; omitted on historical and legacy boards. */
  generation?: {
    version: 'profile-v2' | 'profile-v3'
    singletonAllowed?: boolean
    relaxed: boolean
    targetDifficulty: Difficulty
    difficultyMatched: boolean
    attempts: number
    candidates: number
    distance: number
  }
}

export type Difficulty = 'easy' | 'medium' | 'hard' | 'expert'

/** State of a single cell while playing. */
export type CellMark = 'empty' | 'x' | 'queen'

/** `board[row][col]` mark for every cell. */
export type Board = CellMark[][]

/** A solution as the queen's column for each row. `solution[row] = col`. */
export type Solution = number[]

export interface Cell {
  row: number
  col: number
}
