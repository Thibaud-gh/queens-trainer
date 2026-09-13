/**
 * Human-style deduction solver for Queens.
 *
 * Applies logical techniques in increasing order of sophistication and never
 * guesses. Every step it takes is recorded with a plain-language explanation,
 * so the same engine drives difficulty rating, "explain the solution" and
 * in-game hints (`deduce` accepts a partially filled player board).
 *
 * Technique levels
 *  1. a placed queen rules out its row, column, region and the 8 neighbours
 *  2. a region / row / column with a single remaining candidate gets the queen
 *  3. a region confined to one row (column) rules out the rest of that row
 *     (column); dually a row (column) whose candidates all lie in one region
 *     rules out the rest of that region
 *  4. hidden sets: k regions whose candidates lie in k rows (columns) rule out
 *     other cells of those rows (columns), and the dual for k rows (columns)
 *     whose candidates lie in k regions, k ≤ 3
 *  5. a cell whose queen would wipe out every candidate of some region / row /
 *     column (through its row, column, region and neighbourhood) is impossible
 *  6. one level of trial: place a queen on a candidate cell, propagate levels
 *     1–3 to a fixpoint; a contradiction rules the cell out ("expert")
 *
 * Difficulty: easy = levels 1–2 only, medium = up to 3, hard = up to 5,
 * expert = needs 6 or cannot be finished by deduction at all.
 *
 * Browser-safe: no Node APIs.
 */
import { NEIGHBOURS8 } from './puzzle'
import type { Board, Cell, Difficulty, Puzzle, Solution } from './types'

export type TechniqueLevel = 1 | 2 | 3 | 4 | 5 | 6

export type TechniqueId =
  | 'queen-eliminations'
  | 'single-in-region'
  | 'single-in-row'
  | 'single-in-column'
  | 'region-confined-to-row'
  | 'region-confined-to-column'
  | 'row-confined-to-region'
  | 'column-confined-to-region'
  | 'regions-locked-in-rows'
  | 'regions-locked-in-columns'
  | 'rows-locked-in-regions'
  | 'columns-locked-in-regions'
  | 'would-empty-region'
  | 'would-empty-row'
  | 'would-empty-column'
  | 'trial-contradiction'

export interface Step {
  level: TechniqueLevel
  technique: TechniqueId
  /** Plain-language explanation, e.g. usable as a hint. */
  description: string
  /** Queen placed by this step, if any. */
  placed?: Cell
  /** Cells ruled out by this step. */
  eliminated: Cell[]
  /** Cells the reasoning is about (for highlighting): e.g. a region's remaining candidates. */
  focus: Cell[]
  /** Regions the reasoning is about (indices), when applicable. */
  regions?: number[]
}

export interface DeductionResult {
  /** True when all N queens were placed by pure deduction. */
  solved: boolean
  steps: Step[]
  /** Highest technique level used (0 when no step was needed/possible). */
  maxLevel: number
  /** The solution, when solved. */
  solution?: Solution
  /** True when the position (typically a player's board) is inconsistent. */
  contradiction: boolean
  /** Final candidate grid: `candidates[r][c]` is true if the cell may still hold a queen (queens included). */
  candidates: boolean[][]
  /** Final queens as `queens[row] = col` (−1 when the row has none). */
  queens: number[]
}

export interface DeductionOptions {
  /** Highest technique level allowed (1–6). Default 6. */
  maxLevel?: TechniqueLevel
  /** Start from a player's board: queens are taken as given and `x` marks as eliminated. */
  board?: Board
  /** Stop after the first recorded step (for hints). */
  singleStep?: boolean
}

export const LEVEL_NAMES: Record<TechniqueLevel, string> = {
  1: 'queen eliminations',
  2: 'single candidate',
  3: 'confined region / line',
  4: 'hidden set',
  5: 'cell would empty a group',
  6: 'trial and contradiction',
}

/* ------------------------------------------------------------------------ */
/* State                                                                    */
/* ------------------------------------------------------------------------ */

interface State {
  n: number
  regions: number[][]
  /** region index per cell key */
  regionOf: Int32Array
  /** cells (keys) of every region */
  regionCells: number[][]
  /** 1 when the cell may still hold a queen (queens keep 1) */
  cand: Uint8Array
  /** 1 when a queen stands on the cell */
  queen: Uint8Array
  /** 1 when the queen's eliminations (level 1) have been applied */
  propagated: Uint8Array
  rowQueen: Int32Array
  colQueen: Int32Array
  regionQueen: Int32Array
  placedCount: number
}

function createState(puzzle: Pick<Puzzle, 'size' | 'regions'>, board?: Board): State {
  const n = puzzle.size
  const regionOf = new Int32Array(n * n)
  const regionCells: number[][] = Array.from({ length: n }, () => [])
  for (let r = 0; r < n; r++) {
    for (let c = 0; c < n; c++) {
      const g = puzzle.regions[r][c]
      regionOf[r * n + c] = g
      regionCells[g].push(r * n + c)
    }
  }
  const s: State = {
    n,
    regions: puzzle.regions,
    regionOf,
    regionCells,
    cand: new Uint8Array(n * n).fill(1),
    queen: new Uint8Array(n * n),
    propagated: new Uint8Array(n * n),
    rowQueen: new Int32Array(n).fill(-1),
    colQueen: new Int32Array(n).fill(-1),
    regionQueen: new Int32Array(n).fill(-1),
    placedCount: 0,
  }
  if (board) {
    for (let r = 0; r < n; r++) {
      for (let c = 0; c < n; c++) {
        const m = board[r][c]
        if (m === 'x') s.cand[r * n + c] = 0
        else if (m === 'queen') placeQueen(s, r * n + c)
      }
    }
  }
  return s
}

function cloneState(s: State): State {
  return {
    n: s.n,
    regions: s.regions,
    regionOf: s.regionOf,
    regionCells: s.regionCells,
    cand: s.cand.slice(),
    queen: s.queen.slice(),
    propagated: s.propagated.slice(),
    rowQueen: s.rowQueen.slice(),
    colQueen: s.colQueen.slice(),
    regionQueen: s.regionQueen.slice(),
    placedCount: s.placedCount,
  }
}

function placeQueen(s: State, k: number): void {
  const n = s.n
  const r = Math.floor(k / n)
  const c = k % n
  s.queen[k] = 1
  s.cand[k] = 1
  s.rowQueen[r] = c
  s.colQueen[c] = r
  s.regionQueen[s.regionOf[k]] = k
  s.placedCount++
}

/** Apply level-1 eliminations of the queen on cell `k`; returns eliminated keys. */
function propagateQueen(s: State, k: number): number[] {
  const n = s.n
  const r = Math.floor(k / n)
  const c = k % n
  const g = s.regionOf[k]
  const out: number[] = []
  const kill = (j: number) => {
    if (j !== k && s.cand[j] && !s.queen[j]) {
      s.cand[j] = 0
      out.push(j)
    }
  }
  for (let i = 0; i < n; i++) {
    kill(r * n + i)
    kill(i * n + c)
  }
  for (const j of s.regionCells[g]) kill(j)
  for (const [dr, dc] of NEIGHBOURS8) {
    const nr = r + dr
    const nc = c + dc
    if (nr >= 0 && nc >= 0 && nr < n && nc < n) kill(nr * n + nc)
  }
  s.propagated[k] = 1
  return out
}

function regionCands(s: State, g: number): number[] {
  const out: number[] = []
  for (const k of s.regionCells[g]) if (s.cand[k]) out.push(k)
  return out
}

function rowCands(s: State, r: number): number[] {
  const out: number[] = []
  for (let c = 0; c < s.n; c++) if (s.cand[r * s.n + c]) out.push(r * s.n + c)
  return out
}

function colCands(s: State, c: number): number[] {
  const out: number[] = []
  for (let r = 0; r < s.n; r++) if (s.cand[r * s.n + c]) out.push(r * s.n + c)
  return out
}

/** True when some queen-less row / column / region has no candidate left, or queens conflict. */
function hasContradiction(s: State): boolean {
  const n = s.n
  for (let i = 0; i < n; i++) {
    if (s.rowQueen[i] < 0 && rowCands(s, i).length === 0) return true
    if (s.colQueen[i] < 0 && colCands(s, i).length === 0) return true
    if (s.regionQueen[i] < 0 && regionCands(s, i).length === 0) return true
  }
  return false
}

/** Queens that break a rule between themselves (only possible on a player board). */
function queensConflict(s: State): boolean {
  const n = s.n
  const qs: number[] = []
  for (let k = 0; k < n * n; k++) if (s.queen[k]) qs.push(k)
  for (let i = 0; i < qs.length; i++) {
    for (let j = i + 1; j < qs.length; j++) {
      const a = qs[i]
      const b = qs[j]
      const ar = Math.floor(a / n)
      const ac = a % n
      const br = Math.floor(b / n)
      const bc = b % n
      if (ar === br || ac === bc || s.regionOf[a] === s.regionOf[b]) return true
      if (Math.abs(ar - br) <= 1 && Math.abs(ac - bc) <= 1) return true
    }
  }
  return false
}

/* ------------------------------------------------------------------------ */
/* Naming helpers                                                           */
/* ------------------------------------------------------------------------ */

function toCell(n: number, k: number): Cell {
  return { row: Math.floor(k / n), col: k % n }
}

function toCells(n: number, keys: number[]): Cell[] {
  return keys.map((k) => toCell(n, k))
}

/** Human-readable cell name, 1-based: `r3c5`. */
export function cellName(cell: Cell): string {
  return `r${cell.row + 1}c${cell.col + 1}`
}

function cellNames(n: number, keys: number[], max = 6): string {
  const names = keys.slice(0, max).map((k) => cellName(toCell(n, k)))
  if (keys.length > max) names.push(`… (${keys.length} cells)`)
  return names.join(', ')
}

function regionName(g: number): string {
  return `region ${g + 1}`
}

function listNames(items: string[]): string {
  if (items.length <= 1) return items.join('')
  return `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`
}

/* ------------------------------------------------------------------------ */
/* Techniques                                                               */
/* ------------------------------------------------------------------------ */

type Finder = (s: State) => Step | null

/** Level 1: eliminations of a not-yet-propagated queen. */
const findQueenEliminations: Finder = (s) => {
  const n = s.n
  for (let k = 0; k < n * n; k++) {
    if (!s.queen[k] || s.propagated[k]) continue
    const out = propagateQueen(s, k)
    if (!out.length) continue
    const cell = toCell(n, k)
    return {
      level: 1,
      technique: 'queen-eliminations',
      description: `The queen at ${cellName(cell)} rules out its row, column, ${regionName(s.regionOf[k])} and the cells touching it.`,
      eliminated: toCells(n, out),
      focus: [cell],
      regions: [s.regionOf[k]],
    }
  }
  return null
}

function placeStep(s: State, k: number, technique: TechniqueId, reason: string, focus: number[], regions?: number[]): Step {
  placeQueen(s, k)
  const cell = toCell(s.n, k)
  return {
    level: 2,
    technique,
    description: `${reason}: place a queen at ${cellName(cell)}.`,
    placed: cell,
    eliminated: [],
    focus: toCells(s.n, focus),
    regions,
  }
}

/** Level 2: single candidate in a region, row or column. */
const findSingles: Finder = (s) => {
  const n = s.n
  for (let g = 0; g < n; g++) {
    if (s.regionQueen[g] >= 0) continue
    const cands = regionCands(s, g)
    if (cands.length === 1) {
      return placeStep(s, cands[0], 'single-in-region', `${capitalize(regionName(g))} has only one cell left`, cands, [g])
    }
  }
  for (let r = 0; r < n; r++) {
    if (s.rowQueen[r] >= 0) continue
    const cands = rowCands(s, r)
    if (cands.length === 1) return placeStep(s, cands[0], 'single-in-row', `Row ${r + 1} has only one cell left`, cands)
  }
  for (let c = 0; c < n; c++) {
    if (s.colQueen[c] >= 0) continue
    const cands = colCands(s, c)
    if (cands.length === 1) return placeStep(s, cands[0], 'single-in-column', `Column ${c + 1} has only one cell left`, cands)
  }
  return null
}

function eliminate(s: State, keys: number[]): void {
  for (const k of keys) s.cand[k] = 0
}

function capitalize(t: string): string {
  return t.charAt(0).toUpperCase() + t.slice(1)
}

/** Level 3: a region confined to one row/column, or a row/column confined to one region. */
const findConfinements: Finder = (s) => {
  const n = s.n
  for (let g = 0; g < n; g++) {
    if (s.regionQueen[g] >= 0) continue
    const cands = regionCands(s, g)
    if (!cands.length) continue
    const r0 = Math.floor(cands[0] / n)
    const c0 = cands[0] % n
    if (cands.every((k) => Math.floor(k / n) === r0)) {
      const elim = rowCands(s, r0).filter((k) => s.regionOf[k] !== g)
      if (elim.length) {
        eliminate(s, elim)
        return {
          level: 3,
          technique: 'region-confined-to-row',
          description: `Every remaining cell of ${regionName(g)} lies in row ${r0 + 1}, so that row's queen must be in ${regionName(g)}: rule out ${cellNames(n, elim)}.`,
          eliminated: toCells(n, elim),
          focus: toCells(n, cands),
          regions: [g],
        }
      }
    }
    if (cands.every((k) => k % n === c0)) {
      const elim = colCands(s, c0).filter((k) => s.regionOf[k] !== g)
      if (elim.length) {
        eliminate(s, elim)
        return {
          level: 3,
          technique: 'region-confined-to-column',
          description: `Every remaining cell of ${regionName(g)} lies in column ${c0 + 1}, so that column's queen must be in ${regionName(g)}: rule out ${cellNames(n, elim)}.`,
          eliminated: toCells(n, elim),
          focus: toCells(n, cands),
          regions: [g],
        }
      }
    }
  }
  for (let r = 0; r < n; r++) {
    if (s.rowQueen[r] >= 0) continue
    const cands = rowCands(s, r)
    if (!cands.length) continue
    const g = s.regionOf[cands[0]]
    if (cands.every((k) => s.regionOf[k] === g)) {
      const elim = regionCands(s, g).filter((k) => Math.floor(k / n) !== r)
      if (elim.length) {
        eliminate(s, elim)
        return {
          level: 3,
          technique: 'row-confined-to-region',
          description: `Every remaining cell of row ${r + 1} belongs to ${regionName(g)}, so that region's queen must be in row ${r + 1}: rule out ${cellNames(n, elim)}.`,
          eliminated: toCells(n, elim),
          focus: toCells(n, cands),
          regions: [g],
        }
      }
    }
  }
  for (let c = 0; c < n; c++) {
    if (s.colQueen[c] >= 0) continue
    const cands = colCands(s, c)
    if (!cands.length) continue
    const g = s.regionOf[cands[0]]
    if (cands.every((k) => s.regionOf[k] === g)) {
      const elim = regionCands(s, g).filter((k) => k % n !== c)
      if (elim.length) {
        eliminate(s, elim)
        return {
          level: 3,
          technique: 'column-confined-to-region',
          description: `Every remaining cell of column ${c + 1} belongs to ${regionName(g)}, so that region's queen must be in column ${c + 1}: rule out ${cellNames(n, elim)}.`,
          eliminated: toCells(n, elim),
          focus: toCells(n, cands),
          regions: [g],
        }
      }
    }
  }
  return null
}

function combinations(items: number[], k: number): number[][] {
  const out: number[][] = []
  const cur: number[] = []
  const rec = (start: number) => {
    if (cur.length === k) {
      out.push(cur.slice())
      return
    }
    for (let i = start; i <= items.length - (k - cur.length); i++) {
      cur.push(items[i])
      rec(i + 1)
      cur.pop()
    }
  }
  rec(0)
  return out
}

/** Level 4: hidden sets of size 2–3 between regions and rows/columns (both directions). */
const findHiddenSets: Finder = (s) => {
  const n = s.n
  const activeRegions: number[] = []
  const activeRows: number[] = []
  const activeCols: number[] = []
  for (let i = 0; i < n; i++) {
    if (s.regionQueen[i] < 0) activeRegions.push(i)
    if (s.rowQueen[i] < 0) activeRows.push(i)
    if (s.colQueen[i] < 0) activeCols.push(i)
  }
  const regionCandCache = new Map<number, number[]>()
  const rc = (g: number) => {
    let v = regionCandCache.get(g)
    if (!v) {
      v = regionCands(s, g)
      regionCandCache.set(g, v)
    }
    return v
  }
  const lineOf = (k: number, cols: boolean) => (cols ? k % n : Math.floor(k / n))

  for (let k = 2; k <= 3; k++) {
    // k regions confined to k rows / columns
    for (const cols of [false, true]) {
      for (const combo of combinations(activeRegions, k)) {
        const lines = new Set<number>()
        let tooMany = false
        for (const g of combo) {
          for (const cell of rc(g)) {
            lines.add(lineOf(cell, cols))
            if (lines.size > k) {
              tooMany = true
              break
            }
          }
          if (tooMany) break
        }
        if (tooMany || lines.size !== k) continue
        const inCombo = new Set(combo)
        const elim: number[] = []
        for (const line of lines) {
          for (const cell of cols ? colCands(s, line) : rowCands(s, line)) {
            if (!inCombo.has(s.regionOf[cell])) elim.push(cell)
          }
        }
        if (!elim.length) continue
        eliminate(s, elim)
        const lineWord = cols ? 'column' : 'row'
        const lineList = listNames([...lines].sort((a, b) => a - b).map((l) => `${lineWord} ${l + 1}`))
        const regionList = listNames(combo.map(regionName))
        const focus: number[] = []
        for (const g of combo) focus.push(...rc(g))
        return {
          level: 4,
          technique: cols ? 'regions-locked-in-columns' : 'regions-locked-in-rows',
          description: `${capitalize(regionList)} only have cells in ${lineList}, so those ${k} ${lineWord}s' queens must come from these regions: rule out ${cellNames(n, elim)}.`,
          eliminated: toCells(n, elim),
          focus: toCells(n, focus),
          regions: combo,
        }
      }
    }
    // k rows / columns whose candidates lie in k regions
    for (const cols of [false, true]) {
      const active = cols ? activeCols : activeRows
      for (const combo of combinations(active, k)) {
        const regs = new Set<number>()
        let tooMany = false
        const focus: number[] = []
        for (const line of combo) {
          for (const cell of cols ? colCands(s, line) : rowCands(s, line)) {
            focus.push(cell)
            regs.add(s.regionOf[cell])
            if (regs.size > k) {
              tooMany = true
              break
            }
          }
          if (tooMany) break
        }
        if (tooMany || regs.size !== k) continue
        const inCombo = new Set(combo)
        const elim: number[] = []
        for (const g of regs) {
          for (const cell of rc(g)) if (!inCombo.has(lineOf(cell, cols))) elim.push(cell)
        }
        if (!elim.length) continue
        eliminate(s, elim)
        const lineWord = cols ? 'column' : 'row'
        const lineList = listNames(combo.map((l) => `${lineWord} ${l + 1}`))
        const regionList = listNames([...regs].sort((a, b) => a - b).map(regionName))
        return {
          level: 4,
          technique: cols ? 'columns-locked-in-regions' : 'rows-locked-in-regions',
          description: `${capitalize(lineList)} only have cells in ${regionList}, so those regions' queens must be in these ${lineWord}s: rule out ${cellNames(n, elim)}.`,
          eliminated: toCells(n, elim),
          focus: toCells(n, focus),
          regions: [...regs],
        }
      }
    }
  }
  return null
}

/** Does a queen at `k` eliminate cell `j`? (same row/column/region or touching) */
function attacks(s: State, k: number, j: number): boolean {
  const n = s.n
  const kr = Math.floor(k / n)
  const kc = k % n
  const jr = Math.floor(j / n)
  const jc = j % n
  if (kr === jr || kc === jc) return true
  if (s.regionOf[k] === s.regionOf[j]) return true
  return Math.abs(kr - jr) <= 1 && Math.abs(kc - jc) <= 1
}

/** Level 5: cells whose queen would leave some region / row / column without a candidate. */
const findWouldEmpty: Finder = (s) => {
  const n = s.n
  const allCands: number[] = []
  for (let k = 0; k < n * n; k++) if (s.cand[k] && !s.queen[k]) allCands.push(k)

  const tryGroup = (
    cands: number[],
    exclude: (k: number) => boolean,
    technique: TechniqueId,
    groupName: string,
    regions?: number[],
  ): Step | null => {
    if (!cands.length) return null
    const elim: number[] = []
    for (const k of allCands) {
      if (exclude(k)) continue
      let coversAll = true
      for (const j of cands) {
        if (!attacks(s, k, j)) {
          coversAll = false
          break
        }
      }
      if (coversAll) elim.push(k)
    }
    if (!elim.length) return null
    eliminate(s, elim)
    return {
      level: 5,
      technique,
      description: `A queen at ${cellNames(n, elim)} would rule out every remaining cell of ${groupName}, so ${elim.length === 1 ? 'that cell is' : 'those cells are'} impossible.`,
      eliminated: toCells(n, elim),
      focus: toCells(n, cands),
      regions,
    }
  }

  for (let g = 0; g < n; g++) {
    if (s.regionQueen[g] >= 0) continue
    const step = tryGroup(regionCands(s, g), (k) => s.regionOf[k] === g, 'would-empty-region', regionName(g), [g])
    if (step) return step
  }
  for (let r = 0; r < n; r++) {
    if (s.rowQueen[r] >= 0) continue
    const step = tryGroup(rowCands(s, r), (k) => Math.floor(k / n) === r, 'would-empty-row', `row ${r + 1}`)
    if (step) return step
  }
  for (let c = 0; c < n; c++) {
    if (s.colQueen[c] >= 0) continue
    const step = tryGroup(colCands(s, c), (k) => k % n === c, 'would-empty-column', `column ${c + 1}`)
    if (step) return step
  }
  return null
}

/** Run levels 1–3 to a fixpoint on a scratch state; true when a contradiction appears. */
function propagateToContradiction(s: State): boolean {
  for (let guard = 0; guard < 4 * s.n * s.n; guard++) {
    if (hasContradiction(s)) return true
    if (s.placedCount === s.n) return false
    const step = findQueenEliminations(s) ?? findSingles(s) ?? findConfinements(s)
    if (!step) return false
  }
  return false
}

/** Level 6: one level of trial — a candidate whose placement propagates to a contradiction. */
const findTrialContradiction: Finder = (s) => {
  const n = s.n
  for (let k = 0; k < n * n; k++) {
    if (!s.cand[k] || s.queen[k]) continue
    const trial = cloneState(s)
    placeQueen(trial, k)
    if (!propagateToContradiction(trial)) continue
    eliminate(s, [k])
    const cell = toCell(n, k)
    return {
      level: 6,
      technique: 'trial-contradiction',
      description: `Try a queen at ${cellName(cell)}: following the forced moves leaves a row, column or region with no cell, so ${cellName(cell)} is impossible.`,
      eliminated: [cell],
      focus: [cell],
      regions: [s.regionOf[k]],
    }
  }
  return null
}

const FINDERS: Record<TechniqueLevel, Finder> = {
  1: findQueenEliminations,
  2: findSingles,
  3: findConfinements,
  4: findHiddenSets,
  5: findWouldEmpty,
  6: findTrialContradiction,
}

/* ------------------------------------------------------------------------ */
/* Public API                                                               */
/* ------------------------------------------------------------------------ */

/**
 * Solve (or advance) a puzzle by pure deduction, recording every step.
 */
export function deduce(puzzle: Pick<Puzzle, 'size' | 'regions'>, options: DeductionOptions = {}): DeductionResult {
  const maxLevel = options.maxLevel ?? 6
  const s = createState(puzzle, options.board)
  const n = s.n
  const steps: Step[] = []
  let highest = 0
  let contradiction = queensConflict(s)

  while (!contradiction && s.placedCount < n) {
    if (hasContradiction(s)) {
      contradiction = true
      break
    }
    let step: Step | null = null
    for (let level = 1 as number; level <= maxLevel && !step; level++) {
      step = FINDERS[level as TechniqueLevel](s)
    }
    if (!step) break
    steps.push(step)
    if (step.level > highest) highest = step.level
    if (options.singleStep) break
  }

  const solved = !contradiction && s.placedCount === n
  const candidates: boolean[][] = []
  for (let r = 0; r < n; r++) {
    const row: boolean[] = []
    for (let c = 0; c < n; c++) row.push(s.cand[r * n + c] === 1)
    candidates.push(row)
  }
  const result: DeductionResult = {
    solved,
    steps,
    maxLevel: highest,
    contradiction,
    candidates,
    queens: Array.from(s.rowQueen),
  }
  if (solved) result.solution = Array.from(s.rowQueen)
  return result
}

/** Map a deduction result to the four-level difficulty scale. */
export function difficultyFromResult(result: Pick<DeductionResult, 'solved' | 'maxLevel'>): Difficulty {
  if (!result.solved) return 'expert'
  if (result.maxLevel <= 2) return 'easy'
  if (result.maxLevel <= 3) return 'medium'
  if (result.maxLevel <= 5) return 'hard'
  return 'expert'
}

/** Rate a (uniquely solvable) puzzle by the hardest technique the deduction solver needs. */
export function rateDifficulty(puzzle: Pick<Puzzle, 'size' | 'regions'>): Difficulty {
  return difficultyFromResult(deduce(puzzle))
}

/**
 * Step-by-step explanation of the solution as plain text lines, usable as
 * hints. The last line reports when deduction alone cannot finish the board.
 */
export function explainSolution(puzzle: Pick<Puzzle, 'size' | 'regions'>): string[] {
  const res = deduce(puzzle)
  const lines = res.steps.map((step, i) => `${i + 1}. [${LEVEL_NAMES[step.level]}] ${step.description}`)
  if (res.contradiction) lines.push('The position is contradictory: some row, column or region has no cell left.')
  else if (!res.solved) lines.push('No further step can be found by pure deduction; the rest needs trial and error.')
  else lines.push(`Solved with techniques up to level ${res.maxLevel} (${LEVEL_NAMES[res.maxLevel as TechniqueLevel]}).`)
  return lines
}

/**
 * Next hint for a player's board: the first deduction step from that position,
 * or null when nothing can be deduced (or the board is contradictory).
 */
export function nextHint(puzzle: Pick<Puzzle, 'size' | 'regions'>, board: Board): Step | null {
  const res = deduce(puzzle, { board, singleStep: true })
  if (res.contradiction) return null
  return res.steps[0] ?? null
}
