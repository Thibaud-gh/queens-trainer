/**
 * Import LinkedIn Queens boards from the samimsu/queens-game repository history.
 *
 * Background: https://github.com/samimsu/queens-game-linkedin shipped every
 * LinkedIn daily board as `src/utils/levels/level<N>.ts` (N = LinkedIn puzzle
 * number) until commit c57c95a ("Major Update", 2026-01-07) removed the folder.
 * The parent of that commit still contains 608 boards for puzzles #1–#616.
 *
 * Usage:
 *   npx tsx scripts/import-linkedin-archive.ts [--src <dir>] [--out <file>]
 *
 * With no `--src`, the script clones the repository into a temp folder and
 * extracts the folder from the last commit that still had it.
 *
 * Output: a JSON array of `Puzzle` objects (see src/core/types.ts) sorted by
 * LinkedIn number, written to src/data/linkedin-puzzles.json by default.
 * Every board is validated (N regions, connected) and checked for a unique
 * solution before being written; failures are reported and skipped.
 */
import { execSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { normalizeRegions, validateRegions } from '../src/core/puzzle.ts'
import { countSolutions } from '../src/core/solver.ts'
import type { Puzzle } from '../src/core/types.ts'

const REPO = 'https://github.com/samimsu/queens-game-linkedin.git'
const LAST_COMMIT_WITH_LEVELS = 'c57c95a^'
/** LinkedIn Queens #1 was published on 1 May 2024; one puzzle per day since. */
export const FIRST_PUZZLE_DATE = '2024-05-01'

const here = dirname(fileURLToPath(import.meta.url))
const DEFAULT_OUT = resolve(here, '../src/data/linkedin-puzzles.json')

export function dateForNumber(n: number): string {
  const d = new Date(`${FIRST_PUZZLE_DATE}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + (n - 1))
  return d.toISOString().slice(0, 10)
}

function parseArgs(argv: string[]): { src?: string; out: string } {
  const out: { src?: string; out: string } = { out: DEFAULT_OUT }
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--src') out.src = resolve(argv[++i])
    else if (argv[i] === '--out') out.out = resolve(argv[++i])
  }
  return out
}

/** Parse `colors.ts` into name → hex. */
export function parseColors(src: string): Map<string, string> {
  const map = new Map<string, string>()
  for (const m of src.matchAll(/export const (\w+)\s*=\s*"(#[0-9a-fA-F]{6})"/g)) map.set(m[1], m[2])
  return map
}

export interface ParsedLevel {
  size: number
  letters: string[][]
  regionColorNames: Record<string, string>
}

/** Parse one `level<N>.ts` file. Tolerant of formatting; ignores imports. */
export function parseLevelFile(src: string): ParsedLevel {
  const sizeM = /size:\s*(\d+)/.exec(src)
  if (!sizeM) throw new Error('no size')
  const size = parseInt(sizeM[1], 10)
  const regM = /colorRegions:\s*\[([\s\S]*?)\n\s*\],/.exec(src)
  if (!regM) throw new Error('no colorRegions')
  const letters = [...regM[1].matchAll(/\[([^\]]*)\]/g)].map((row) =>
    [...row[1].matchAll(/"([^"]+)"/g)].map((m) => m[1]),
  )
  const colorsM = /regionColors:\s*\{([\s\S]*?)\}/.exec(src)
  const regionColorNames: Record<string, string> = {}
  if (colorsM) {
    for (const m of colorsM[1].matchAll(/(\w+):\s*(\w+)/g)) regionColorNames[m[1]] = m[2]
  }
  return { size, letters, regionColorNames }
}

export function toPuzzle(n: number, level: ParsedLevel, colors: Map<string, string>): Puzzle {
  const labels = new Map<string, number>()
  const raw = level.letters.map((row) =>
    row.map((ch) => {
      let g = labels.get(ch)
      if (g === undefined) {
        g = labels.size
        labels.set(ch, g)
      }
      return g
    }),
  )
  const regions = normalizeRegions(raw)
  const colorList: string[] = new Array<string>(level.size).fill('')
  for (const [letter, idx] of labels) {
    const name = level.regionColorNames[letter]
    const hex = name ? colors.get(name) : undefined
    if (hex) colorList[idx] = hex
  }
  const puzzle: Puzzle = {
    id: `li-${n}`,
    size: level.size,
    regions,
    source: 'linkedin',
    number: n,
    date: dateForNumber(n),
    name: `LinkedIn Queens #${n}`,
  }
  if (colorList.every((c) => c)) puzzle.colors = colorList
  return puzzle
}

function obtainSource(src?: string): string {
  if (src) return src
  const tmp = mkdtempSync(join(tmpdir(), 'queens-archive-'))
  console.log(`Cloning ${REPO} into ${tmp} …`)
  execSync(`git clone -q --filter=blob:none ${REPO} repo`, { cwd: tmp, stdio: 'inherit' })
  const repo = join(tmp, 'repo')
  execSync(`git archive ${LAST_COMMIT_WITH_LEVELS} src/utils/levels src/utils/colors.ts | tar -x -C ..`, {
    cwd: repo,
    stdio: 'inherit',
    shell: '/bin/sh',
  })
  return join(tmp, 'src/utils')
}

export function importFromDir(utilsDir: string): { puzzles: Puzzle[]; skipped: string[] } {
  const colors = parseColors(readFileSync(join(utilsDir, 'colors.ts'), 'utf8'))
  const levelsDir = join(utilsDir, 'levels')
  const files = readdirSync(levelsDir).filter((f) => /^level\d+\.ts$/.test(f))
  const puzzles: Puzzle[] = []
  const skipped: string[] = []
  for (const f of files) {
    const n = parseInt(f.replace(/\D/g, ''), 10)
    try {
      const level = parseLevelFile(readFileSync(join(levelsDir, f), 'utf8'))
      const puzzle = toPuzzle(n, level, colors)
      const problems = validateRegions(puzzle.regions)
      // LinkedIn's April Fools board (#336, 2025-04-01) deliberately has
      // disconnected regions. Keep such boards as long as they are otherwise
      // valid and uniquely solvable, but record the quirk.
      const hard = problems.filter((p) => !/not connected/.test(p))
      if (hard.length) throw new Error(hard.join('; '))
      if (problems.length) puzzle.attribution = 'Special board: some regions are disconnected'
      const k = countSolutions(puzzle, 2)
      if (k !== 1) throw new Error(`${k === 0 ? 'no' : 'multiple'} solutions`)
      puzzles.push(puzzle)
    } catch (e) {
      skipped.push(`${f}: ${(e as Error).message}`)
    }
  }
  puzzles.sort((a, b) => a.number! - b.number!)
  return { puzzles, skipped }
}

const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)
if (isMain) {
  const args = parseArgs(process.argv.slice(2))
  const utilsDir = obtainSource(args.src)
  if (!existsSync(join(utilsDir, 'levels'))) {
    console.error(`No levels folder in ${utilsDir}`)
    process.exit(1)
  }
  const { puzzles, skipped } = importFromDir(utilsDir)
  mkdirSync(dirname(args.out), { recursive: true })
  writeFileSync(args.out, JSON.stringify(puzzles))
  console.log(`Wrote ${puzzles.length} puzzles to ${args.out}`)
  if (skipped.length) {
    console.log(`Skipped ${skipped.length}:`)
    for (const s of skipped) console.log('  ' + s)
  }
}
