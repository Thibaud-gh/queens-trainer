/** Access to the LinkedIn archive, custom puzzles and puzzle codes. */
import { decodeRegions, encodeRegions, shortHash, validateRegions } from '../core/puzzle'
import { countSolutions } from '../core/solver'
import type { Puzzle } from '../core/types'
import { LINKEDIN_ARCHIVE } from '../data/archive'
import { loadCustomPuzzles } from './storage'

export const LINKEDIN_PUZZLES: readonly Puzzle[] = LINKEDIN_ARCHIVE

const byId = new Map<string, Puzzle>(LINKEDIN_PUZZLES.map((p) => [p.id, p]))
const byNumber = new Map<number, Puzzle>(LINKEDIN_PUZZLES.filter((p) => p.number != null).map((p) => [p.number!, p]))

export function findLinkedIn(id: string): Puzzle | undefined {
  return byId.get(id)
}

export function findLinkedInByNumber(n: number): Puzzle | undefined {
  return byNumber.get(n)
}

/** LinkedIn Queens #1 was published on 2024-05-01; one puzzle per day since. */
export const LINKEDIN_EPOCH = Date.UTC(2024, 4, 1)

export function dailyNumber(now: Date = new Date()): number {
  const todayUtc = Date.UTC(now.getFullYear(), now.getMonth(), now.getDate())
  return Math.floor((todayUtc - LINKEDIN_EPOCH) / 86_400_000) + 1
}

export function latestLinkedIn(): Puzzle | undefined {
  return LINKEDIN_PUZZLES[LINKEDIN_PUZZLES.length - 1]
}

/** The archive puzzle following `id` by number (wrapping to the first). */
export function nextLinkedIn(id: string): Puzzle | undefined {
  const idx = LINKEDIN_PUZZLES.findIndex((p) => p.id === id)
  if (idx < 0) return LINKEDIN_PUZZLES[0]
  return LINKEDIN_PUZZLES[(idx + 1) % LINKEDIN_PUZZLES.length]
}

export function findCustom(id: string): Puzzle | undefined {
  return loadCustomPuzzles().find((p) => p.id === id)
}

/** Resolve any playable puzzle id (`li-N` or `custom-…`). */
export function findPuzzleById(id: string): Puzzle | undefined {
  return findLinkedIn(id) ?? findCustom(id)
}

/** Build a puzzle from an `encodeRegions` code. Throws with a readable message on failure. */
export function puzzleFromCode(code: string): Puzzle {
  const regions = decodeRegions(code)
  const problems = validateRegions(regions)
  if (problems.length) throw new Error(problems.join('; '))
  const count = countSolutions({ size: regions.length, regions }, 2)
  if (count === 0) throw new Error('This puzzle has no solution')
  if (count > 1) throw new Error('This puzzle has more than one solution')
  const size = regions.length
  return {
    id: `code-${shortHash(encodeRegions(regions))}`,
    size,
    regions,
    source: 'community',
    name: `Shared ${size}×${size} puzzle`,
  }
}

export function shareCode(puzzle: Pick<Puzzle, 'regions'>): string {
  return encodeRegions(puzzle.regions)
}

export function puzzleTitle(p: Puzzle): string {
  if (p.name) return p.name
  if (p.source === 'linkedin' && p.number != null) return `LinkedIn Queens #${p.number}`
  return `${p.size}×${p.size} puzzle`
}

export function puzzleSubtitle(p: Puzzle): string {
  const bits: string[] = [`${p.size}×${p.size}`]
  if (p.date) bits.push(formatDate(p.date))
  if (p.difficulty) bits.push(p.difficulty)
  return bits.join(' · ')
}

export function formatDate(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso)
  if (!m) return iso
  const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]))
  return d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric', timeZone: 'UTC' })
}
