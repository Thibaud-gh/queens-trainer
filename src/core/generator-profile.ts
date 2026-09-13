/** Features used both for profile sampling and independent output measurement. */
// Intentionally frozen: importing playable extra history must not alter v2 seed replay.
import archive from '../data/linkedin-puzzles.json'
import { deduce, difficultyFromResult } from './deduction'
import { boardStats, SHAPE_CLASSES, type ShapeClass } from './patterns'
import { symmetricCanonicalKey } from './puzzle'
import type { Difficulty, Puzzle } from './types'

export interface BoardProfile {
  size: number
  difficulty: Difficulty
  /** Joint, ranked region areas and shapes; no cell coordinates or solutions. */
  regions: Array<{ area: number; shape: ShapeClass; interior: boolean }>
  features: Record<string, number>
}

export function profileBoard(puzzle: Pick<Puzzle, 'size' | 'regions'>): BoardProfile {
  const s = boardStats(puzzle.regions)
  const d = deduce(puzzle)
  const n = s.size
  const ranked = s.regions.slice().sort((a, b) => b.size - a.size)
  const features: Record<string, number> = {
    largest: s.largestShare,
    singletonCount: s.sizes.filter(a => a === 1).length,
    dominoCount: s.sizes.filter(a => a === 2).length,
    tinyCount: s.sizes.filter(a => a <= 3).length,
    hasSingleton: +s.sizes.includes(1),
    background: +s.hasBackground,
    interior: s.regions.filter(r => !r.touchesBorder).length,
    enclosure: +(s.enclosingRegions > 0),
    adjacency: s.adjacencies,
    symmetry: +(s.symmetries.length > 0),
    steps: d.steps.length,
    advanced: d.steps.filter(step => step.level >= 4).length,
    firstQueen: d.steps.findIndex(step => step.placed !== undefined),
    solved: +d.solved,
    level: d.maxLevel,
    branches: 0,
    confined: 0,
    perimeter: 0,
  }
  for (const r of s.regions) {
    if (Math.min(r.bbox.r1 - r.bbox.r0 + 1, r.bbox.c1 - r.bbox.c0 + 1) <= 2) features.confined++
    let branched = false
    for (const { row, col } of r.cells) {
      const degree = [[1, 0], [-1, 0], [0, 1], [0, -1]].filter(([dr, dc]) => puzzle.regions[row + dr]?.[col + dc] === r.index).length
      features.perimeter += 4 - degree
      if (degree >= 3) branched = true
    }
    if (r.shape === 'snake' && branched) features.branches++
  }
  for (const shape of SHAPE_CLASSES) features[`shape:${shape}`] = s.shapeCounts[shape] / n
  for (const difficulty of ['easy', 'medium', 'hard', 'expert']) features[`difficulty:${difficulty}`] = +(difficultyFromResult(d) === difficulty)
  for (let i = 0; i < n; i++) features[`rank:${i + 1}`] = ranked[i].size / (n * n)
  for (let level = 1; level <= 6; level++) features[`level:${level}`] = d.steps.filter(step => step.level === level).length
  return {
    size: n,
    difficulty: difficultyFromResult(d),
    regions: ranked.map(r => ({ area: r.size, shape: r.shape, interior: !r.touchesBorder })),
    features,
  }
}

let profiles: BoardProfile[] | undefined
let archiveKeys: Set<string> | undefined
export function historicalProfiles(): readonly BoardProfile[] {
  return profiles ??= (archive as Puzzle[]).filter(p => p.number !== 336).map(profileBoard)
}

/** Prevent a newly generated puzzle from being an exact historical rerun. */
export function isHistoricalLayout(regions: number[][]): boolean {
  archiveKeys ??= new Set((archive as Puzzle[]).map(p => symmetricCanonicalKey(p.regions)))
  return archiveKeys.has(symmetricCanonicalKey(regions))
}

/** Distance to a sampled board profile, rather than to an average board. */
export function profileDistance(actual: BoardProfile, target: BoardProfile): number {
  const a = actual.features
  const b = target.features
  let loss = 0
  for (let i = 1; i <= target.size; i++) loss += 5 * Math.abs(a[`rank:${i}`] - b[`rank:${i}`])
  for (const shape of SHAPE_CLASSES) loss += 2 * Math.abs(a[`shape:${shape}`] - b[`shape:${shape}`])
  loss += 1.8 * Math.abs(a.singletonCount - b.singletonCount)
  loss += 0.7 * Math.abs(a.dominoCount - b.dominoCount)
  loss += 0.5 * Math.abs(a.tinyCount - b.tinyCount)
  loss += 0.5 * Math.abs(a.interior - b.interior)
  loss += 0.7 * Math.abs(a.enclosure - b.enclosure)
  loss += 0.15 * Math.abs(a.branches - b.branches)
  loss += 0.08 * Math.abs(a.advanced - b.advanced)
  loss += 0.03 * Math.abs(a.steps - b.steps)
  return loss
}
