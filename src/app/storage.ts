/**
 * localStorage persistence: settings, per-puzzle progress and custom puzzles.
 * Every access is wrapped in try/catch — storage can be missing, full or
 * blocked, and the app must keep working without it.
 */
import type { Puzzle } from '../core/types'
import type { SavedGame } from './gameState'

export type Theme = 'system' | 'light' | 'dark'

export interface Settings {
  autoX: boolean
  showConflicts: boolean
  showTimer: boolean
  haptics: boolean
  theme: Theme
}

export const DEFAULT_SETTINGS: Settings = {
  autoX: true,
  showConflicts: true,
  showTimer: true,
  haptics: true,
  theme: 'system',
}

export interface PuzzleProgress {
  /** In-progress board, kept until the puzzle is solved or cleared. */
  game?: SavedGame
  elapsedMs: number
  solved: boolean
  bestMs?: number
  solves: number
  lastPlayed: number
}

export type ProgressMap = Record<string, PuzzleProgress>

const KEYS = {
  settings: 'qt:settings',
  progress: 'qt:progress',
  custom: 'qt:custom',
  lastPlayed: 'qt:lastPlayed',
} as const

function readJSON<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key)
    if (raw == null) return fallback
    return JSON.parse(raw) as T
  } catch {
    return fallback
  }
}

function writeJSON(key: string, value: unknown): boolean {
  try {
    localStorage.setItem(key, JSON.stringify(value))
    return true
  } catch {
    return false
  }
}

export function loadSettings(): Settings {
  const s = readJSON<Partial<Settings>>(KEYS.settings, {})
  return { ...DEFAULT_SETTINGS, ...(s && typeof s === 'object' ? s : {}) }
}

export function saveSettings(s: Settings): void {
  writeJSON(KEYS.settings, s)
}

export function loadProgressMap(): ProgressMap {
  const m = readJSON<ProgressMap>(KEYS.progress, {})
  return m && typeof m === 'object' ? m : {}
}

export function loadProgress(id: string): PuzzleProgress | undefined {
  return loadProgressMap()[id]
}

export function saveProgress(id: string, update: Partial<PuzzleProgress>): PuzzleProgress {
  const map = loadProgressMap()
  const prev: PuzzleProgress = map[id] ?? { elapsedMs: 0, solved: false, solves: 0, lastPlayed: 0 }
  const next: PuzzleProgress = { ...prev, ...update, lastPlayed: Date.now() }
  if (next.game === undefined) delete next.game
  map[id] = next
  writeJSON(KEYS.progress, map)
  return next
}

/** Record a completed solve and update the best time. */
export function recordSolve(id: string, elapsedMs: number): PuzzleProgress {
  const prev = loadProgress(id)
  const best = prev?.bestMs === undefined ? elapsedMs : Math.min(prev.bestMs, elapsedMs)
  return saveProgress(id, { solved: true, solves: (prev?.solves ?? 0) + 1, bestMs: best, elapsedMs, game: undefined })
}

export function loadCustomPuzzles(): Puzzle[] {
  const list = readJSON<Puzzle[]>(KEYS.custom, [])
  return Array.isArray(list) ? list.filter((p) => p && typeof p.id === 'string' && Array.isArray(p.regions)) : []
}

export function saveCustomPuzzle(p: Puzzle): boolean {
  const list = loadCustomPuzzles().filter((q) => q.id !== p.id)
  list.unshift(p)
  return writeJSON(KEYS.custom, list)
}

export function deleteCustomPuzzle(id: string): void {
  writeJSON(
    KEYS.custom,
    loadCustomPuzzles().filter((q) => q.id !== id),
  )
}

export function loadLastPlayed(): string | null {
  try {
    return localStorage.getItem(KEYS.lastPlayed)
  } catch {
    return null
  }
}

export function saveLastPlayed(route: string): void {
  try {
    localStorage.setItem(KEYS.lastPlayed, route)
  } catch {
    /* ignore */
  }
}
