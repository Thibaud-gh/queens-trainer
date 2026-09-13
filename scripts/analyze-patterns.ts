/**
 * Analyse the LinkedIn Queens archive and print region-pattern statistics per
 * board size, plus the deduction-solver difficulty distribution. Optionally
 * generates boards with our generator and checks that their region-size
 * statistics stay close to LinkedIn's.
 *
 * Usage:
 *   npx tsx scripts/analyze-patterns.ts [--compare <count>] [--no-compare] [--examples <n>] [--seed <s>]
 *
 * `--compare` (default 200 boards) exits with code 1 when the generated
 * distribution drifts outside the tolerance, so it doubles as a regression check.
 */
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { deduce, difficultyFromResult } from '../src/core/deduction.ts'
import { generatePuzzle, resetGeneratorHistory, type GeneratorVersion } from '../src/core/generator.ts'
import { SHAPE_CLASSES, boardStats, renderAscii, type BoardStats, type ShapeClass } from '../src/core/patterns.ts'
import { uniqueSolution } from '../src/core/solver.ts'
import type { Difficulty, Puzzle } from '../src/core/types.ts'

const here = dirname(fileURLToPath(import.meta.url))
const DATA = resolve(here, '../src/data/linkedin-puzzles.json')

/** LinkedIn's April Fools board (#336) has disconnected regions: excluded from statistics. */
const EXCLUDED_NUMBERS = new Set([336])

interface Args {
  history: 'original' | 'expanded'
  version: GeneratorVersion
  compare: number
  examples: number
  seed: string
}

function parseArgs(argv: string[]): Args {
  const args: Args = { history: 'original', version: 'profile-v2', compare: 200, examples: 4, seed: 'analyze' }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--history') {
      const history = argv[++i]
      if (history !== 'original' && history !== 'expanded') throw new Error('History must be original or expanded')
      args.history = history
    } else if (a === '--version') {
      const version = argv[++i]
      if (version !== 'legacy' && version !== 'profile-v2' && version !== 'profile-v3') throw new Error('Version must be legacy, profile-v2 or profile-v3')
      args.version = version
    } else if (a === '--compare') args.compare = parseInt(argv[++i], 10)
    else if (a === '--no-compare') args.compare = 0
    else if (a === '--examples') args.examples = parseInt(argv[++i], 10)
    else if (a === '--seed') args.seed = argv[++i]
  }
  return args
}

export function loadLinkedIn(history: 'original' | 'expanded' = 'original'): Puzzle[] {
  const all = JSON.parse(readFileSync(DATA, 'utf8')) as Puzzle[]
  if (history === 'expanded') all.push(...JSON.parse(readFileSync(resolve(here, '../src/data/linkedin-extra.json'), 'utf8')) as Puzzle[])
  return all.filter((p) => !EXCLUDED_NUMBERS.has(p.number ?? -1))
}

const pct = (x: number, digits = 0) => `${(100 * x).toFixed(digits)}%`
const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0)
function median(xs: number[]): number {
  if (!xs.length) return 0
  const s = xs.slice().sort((a, b) => a - b)
  const m = s.length >> 1
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2
}

export interface Summary {
  boards: number
  sizeMin: number
  sizeMedian: number
  sizeMax: number
  sizeMean: number
  share1: number
  share2: number
  share3: number
  tinyShare: number
  boardsWithSingle: number
  boardsWithTiny: number
  tinyPerBoard: number
  largestMean: number
  largestMedian: number
  backgroundBoards: number
  shapeShare: Record<ShapeClass, number>
  enclosingBoards: number
  enclosingSingleBoards: number
  symmetricBoards: number
  symmetryCounts: Record<string, number>
  borderShare: number
  interiorRegionsPerBoard: number
  adjacenciesPerBoard: number
  levelCounts: Record<string, number>
  difficultyCounts: Record<Difficulty, number>
}

export function summarize(boards: Array<{ stats: BoardStats; level: number | 'unsolved'; difficulty: Difficulty }>): Summary {
  const allSizes = boards.flatMap((b) => b.stats.sizes)
  const shapeShare = {} as Record<ShapeClass, number>
  for (const s of SHAPE_CLASSES) shapeShare[s] = allSizes.length ? mean(boards.map((b) => b.stats.shapeCounts[s] / b.stats.size)) : 0
  const symmetryCounts: Record<string, number> = {}
  const levelCounts: Record<string, number> = {}
  const difficultyCounts: Record<Difficulty, number> = { easy: 0, medium: 0, hard: 0, expert: 0 }
  for (const b of boards) {
    for (const s of b.stats.symmetries) symmetryCounts[s] = (symmetryCounts[s] ?? 0) + 1
    const key = String(b.level)
    levelCounts[key] = (levelCounts[key] ?? 0) + 1
    difficultyCounts[b.difficulty]++
  }
  return {
    boards: boards.length,
    sizeMin: Math.min(...allSizes),
    sizeMedian: median(allSizes),
    sizeMax: Math.max(...allSizes),
    sizeMean: mean(allSizes),
    share1: allSizes.filter((s) => s === 1).length / allSizes.length,
    share2: allSizes.filter((s) => s === 2).length / allSizes.length,
    share3: allSizes.filter((s) => s === 3).length / allSizes.length,
    tinyShare: allSizes.filter((s) => s <= 3).length / allSizes.length,
    boardsWithSingle: mean(boards.map((b) => (b.stats.sizes.includes(1) ? 1 : 0))),
    boardsWithTiny: mean(boards.map((b) => (b.stats.sizes.some((s) => s <= 3) ? 1 : 0))),
    tinyPerBoard: mean(boards.map((b) => b.stats.sizes.filter((s) => s <= 3).length)),
    largestMean: mean(boards.map((b) => b.stats.largestShare)),
    largestMedian: median(boards.map((b) => b.stats.largestShare)),
    backgroundBoards: mean(boards.map((b) => (b.stats.hasBackground ? 1 : 0))),
    shapeShare,
    enclosingBoards: mean(boards.map((b) => (b.stats.enclosingRegions > 0 ? 1 : 0))),
    enclosingSingleBoards: mean(boards.map((b) => (b.stats.enclosingSingles > 0 ? 1 : 0))),
    symmetricBoards: mean(boards.map((b) => (b.stats.symmetries.length ? 1 : 0))),
    symmetryCounts,
    borderShare: mean(boards.map((b) => b.stats.borderShare)),
    interiorRegionsPerBoard: mean(boards.map((b) => b.stats.size * (1 - b.stats.borderShare))),
    adjacenciesPerBoard: mean(boards.map((b) => b.stats.adjacencies)),
    levelCounts,
    difficultyCounts,
  }
}

export function analyzeBoards(puzzles: Puzzle[]) {
  return puzzles.map((p) => {
    const res = deduce(p)
    return {
      puzzle: p,
      stats: boardStats(p.regions),
      level: res.solved ? res.maxLevel : ('unsolved' as const),
      difficulty: difficultyFromResult(res),
    }
  })
}

function printSummary(title: string, s: Summary): void {
  console.log(`\n== ${title} (${s.boards} boards) ==`)
  console.log(
    `  region size: min ${s.sizeMin} / median ${s.sizeMedian} / max ${s.sizeMax} / mean ${s.sizeMean.toFixed(1)}`,
  )
  console.log(
    `  regions with 1 cell ${pct(s.share1, 1)}, 2 cells ${pct(s.share2, 1)}, 3 cells ${pct(s.share3, 1)}  (≤3 cells: ${pct(s.tinyShare, 1)}, ${s.tinyPerBoard.toFixed(2)} per board)`,
  )
  console.log(
    `  boards with a 1-cell region ${pct(s.boardsWithSingle)}, with any ≤3-cell region ${pct(s.boardsWithTiny)}`,
  )
  console.log(
    `  largest region / N²: mean ${pct(s.largestMean, 1)}, median ${pct(s.largestMedian, 1)}; boards with a ≥30% background region: ${pct(s.backgroundBoards)}`,
  )
  console.log(
    '  shape classes (share of regions): ' +
      SHAPE_CLASSES.map((c) => `${c} ${pct(s.shapeShare[c], 1)}`).join(', '),
  )
  console.log(
    `  boards with a region enclosing another region ${pct(s.enclosingBoards)}; enclosing a 1-cell region ${pct(s.enclosingSingleBoards)}`,
  )
  const sym = Object.entries(s.symmetryCounts)
    .map(([k, v]) => `${k} ${v}`)
    .join(', ')
  console.log(`  symmetric boards ${pct(s.symmetricBoards, 1)}${sym ? ` (${sym})` : ''}`)
  console.log(
    `  regions touching the border ${pct(s.borderShare)}; interior regions per board ${s.interiorRegionsPerBoard.toFixed(2)}`,
  )
  console.log(`  region adjacencies (pairs) per board ${s.adjacenciesPerBoard.toFixed(1)}`)
  const lv = Object.entries(s.levelCounts)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => `L${k}: ${v}`)
    .join(', ')
  console.log(`  deduction max level: ${lv}`)
  const d = s.difficultyCounts
  console.log(
    `  difficulty: easy ${d.easy} (${pct(d.easy / s.boards)}), medium ${d.medium} (${pct(d.medium / s.boards)}), hard ${d.hard} (${pct(d.hard / s.boards)}), expert ${d.expert} (${pct(d.expert / s.boards)})`,
  )
}

/** Compare tolerance (absolute difference of shares). */
export const TOLERANCE = { tinyShare: 0.1, largestShare: 0.1, singleDominoShare: 0.1 }

export function compareDistributions(
  linkedin: ReturnType<typeof analyzeBoards>,
  generated: ReturnType<typeof analyzeBoards>,
): { ok: boolean; lines: string[] } {
  const lines: string[] = []
  let ok = true
  const metrics: Array<[keyof typeof TOLERANCE, (s: BoardStats) => number]> = [
    ['tinyShare', (s) => s.tinyShare],
    ['largestShare', (s) => s.largestShare],
    ['singleDominoShare', (s) => s.singleDominoShare],
  ]
  for (const [name, f] of metrics) {
    const a = mean(linkedin.map((b) => f(b.stats)))
    const b = mean(generated.map((x) => f(x.stats)))
    const pass = Math.abs(a - b) <= TOLERANCE[name]
    ok &&= pass
    lines.push(
      `  ${name.padEnd(18)} LinkedIn ${pct(a, 1).padStart(6)}  generated ${pct(b, 1).padStart(6)}  Δ ${pct(b - a, 1).padStart(7)}  (tol ±${pct(TOLERANCE[name])}) ${pass ? 'OK' : 'FAIL'}`,
    )
  }
  return { ok, lines }
}

function main(): void {
  const args = parseArgs(process.argv.slice(2))
  const puzzles = loadLinkedIn(args.history)
  console.log(`Loaded ${puzzles.length} LinkedIn boards (excluding #${[...EXCLUDED_NUMBERS].join(', #')})`)
  const t0 = Date.now()
  const analyzed = analyzeBoards(puzzles)
  const sizes = [...new Set(puzzles.map((p) => p.size))].sort((a, b) => a - b)
  for (const n of sizes) printSummary(`${n}×${n}`, summarize(analyzed.filter((b) => b.puzzle.size === n)))
  printSummary('All sizes', summarize(analyzed))
  console.log(`\nAnalysed in ${Date.now() - t0} ms`)

  if (args.examples > 0) {
    console.log('\n== Examples (lower-case + * marks the solution queen) ==')
    const wanted = ['li-1', 'li-2', 'li-52', 'li-100']
    const picks = wanted.map((id) => analyzed.find((b) => b.puzzle.id === id)).filter(Boolean).slice(0, args.examples)
    for (const b of picks) {
      if (!b) continue
      const s = b.stats
      console.log(
        `\n${b.puzzle.name} (${b.puzzle.size}×${b.puzzle.size}) — sizes ${s.sizes.slice().sort((x, y) => y - x).join('/')}, largest ${pct(s.largestShare)}, level ${b.level} → ${b.difficulty}`,
      )
      console.log(renderAscii(b.puzzle.regions, uniqueSolution(b.puzzle) ?? undefined))
    }
  }

  if (args.compare > 0) {
    console.log(`\n== Generated boards vs LinkedIn (${args.compare} boards, ${args.version}, seed "${args.seed}") ==`)
    resetGeneratorHistory()
    // Sample sizes with LinkedIn's size mix.
    const mix = puzzles.map((p) => p.size)
    const gen: Puzzle[] = []
    const times: number[] = []
    const perSize: Record<number, number[]> = {}
    for (let i = 0; i < args.compare; i++) {
      const size = mix[(i * 7919) % mix.length]
      const t = Date.now()
      const p = generatePuzzle({ size, version: args.version, seed: `${args.seed}-${i}` })
      const dt = Date.now() - t
      times.push(dt)
      ;(perSize[size] ??= []).push(dt)
      gen.push(p)
    }
    const genAnalyzed = analyzeBoards(gen)
    for (const n of sizes) {
      const subset = genAnalyzed.filter((b) => b.puzzle.size === n)
      if (subset.length) printSummary(`generated ${n}×${n}`, summarize(subset))
    }
    printSummary('generated, all sizes', summarize(genAnalyzed))
    console.log(
      `\n  generation time: mean ${mean(times).toFixed(0)} ms, max ${Math.max(...times)} ms; per size ` +
        Object.entries(perSize)
          .map(([n, ts]) => `${n}×${n}: mean ${mean(ts).toFixed(0)} / max ${Math.max(...ts)} ms`)
          .join(', '),
    )
    const cmp = compareDistributions(analyzed, genAnalyzed)
    console.log('\n  Distribution check:')
    for (const l of cmp.lines) console.log(l)
    if (!cmp.ok) {
      console.error('\nDistribution check FAILED')
      process.exitCode = 1
    } else console.log('\n  Distribution check passed')
  }
}

const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)
if (isMain) main()
