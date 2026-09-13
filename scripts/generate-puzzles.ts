/**
 * Generate a batch of puzzles as JSON.
 *
 * Usage:
 *   npx tsx scripts/generate-puzzles.ts --version profile-v2 --size 9 --count 50 --difficulty hard --seed base --out file.json
 *
 *   --version     legacy | profile-v2 | profile-v3 (default profile-v3)
 *   --size        board size, or a comma list to mix sizes (default 8)
 *   --count       number of puzzles (default 20)
 *   --difficulty  easy | medium | hard | expert | any (default any)
 *   --seed        base seed; puzzle i uses `<seed>-<i>` (default: random)
 *   --out         output file (default generated-<size>-<difficulty>.json)
 *   --attempts    max construction attempts per puzzle when a difficulty is requested
 *
 * Prints a difficulty histogram, how often the requested difficulty was hit,
 * and timing statistics.
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { generatePuzzle, resetGeneratorHistory, type GeneratorVersion } from '../src/core/generator.ts'
import { randomSeed } from '../src/core/random.ts'
import type { Difficulty, Puzzle } from '../src/core/types.ts'

interface Args {
  version: GeneratorVersion
  sizes: number[]
  count: number
  difficulty: Difficulty | 'any'
  seed: string
  out: string
  attempts?: number
}

const DIFFICULTIES: ReadonlyArray<Difficulty | 'any'> = ['easy', 'medium', 'hard', 'expert', 'any']

export function parseArgs(argv: string[]): Args {
  const args: Args = { version: 'profile-v3', sizes: [8], count: 20, difficulty: 'any', seed: randomSeed(), out: '' }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    const next = () => {
      const v = argv[++i]
      if (v === undefined) throw new Error(`Missing value for ${a}`)
      return v
    }
    switch (a) {
      case '--version': {
        const version = next()
        if (version !== 'legacy' && version !== 'profile-v2' && version !== 'profile-v3') throw new Error('Version must be legacy, profile-v2 or profile-v3')
        args.version = version
        break
      }
      case '--size':
        args.sizes = next()
          .split(',')
          .map((s) => parseInt(s.trim(), 10))
          .filter((n) => Number.isFinite(n))
        if (!args.sizes.length) throw new Error('--size needs at least one number')
        break
      case '--count':
        args.count = parseInt(next(), 10)
        break
      case '--difficulty': {
        const d = next() as Difficulty | 'any'
        if (!DIFFICULTIES.includes(d)) throw new Error(`Unknown difficulty ${d}`)
        args.difficulty = d
        break
      }
      case '--seed':
        args.seed = next()
        break
      case '--out':
        args.out = next()
        break
      case '--attempts':
        args.attempts = parseInt(next(), 10)
        break
      case '--help':
      case '-h':
        console.log(
          'Usage: npx tsx scripts/generate-puzzles.ts --version profile-v2 --size 9 --count 50 --difficulty hard --seed base --out file.json',
        )
        process.exit(0)
        break
      default:
        throw new Error(`Unknown argument ${a}`)
    }
  }
  if (!args.out) args.out = `generated-${args.version}-${args.sizes.join('_')}-${args.difficulty}.json`
  return args
}

function main(): void {
  const args = parseArgs(process.argv.slice(2))
  resetGeneratorHistory()
  const puzzles: Puzzle[] = []
  const times: number[] = []
  const histogram: Record<Difficulty, number> = { easy: 0, medium: 0, hard: 0, expert: 0 }
  const t0 = Date.now()
  for (let i = 0; i < args.count; i++) {
    const size = args.sizes[i % args.sizes.length]
    const t = performance.now()
    const p = generatePuzzle({ size, version: args.version, seed: `${args.seed}-${i}`, difficulty: args.difficulty, maxAttempts: args.attempts })
    times.push(performance.now() - t)
    puzzles.push(p)
    histogram[p.difficulty!]++
  }
  const total = Date.now() - t0
  const out = resolve(args.out)
  mkdirSync(dirname(out), { recursive: true })
  writeFileSync(out, JSON.stringify(puzzles))

  const sorted = times.slice().sort((a, b) => a - b)
  const pct = (f: number) => sorted[Math.min(sorted.length - 1, Math.floor(f * sorted.length))]
  console.log(`Wrote ${puzzles.length} puzzles (${args.sizes.map((s) => `${s}×${s}`).join(', ')}) to ${out}`)
  console.log(`Seed base "${args.seed}", generator: ${args.version}, requested difficulty: ${args.difficulty}`)
  console.log('Difficulty histogram:')
  for (const d of ['easy', 'medium', 'hard', 'expert'] as Difficulty[]) {
    const k = histogram[d]
    const bar = '#'.repeat(Math.round((40 * k) / Math.max(1, puzzles.length)))
    console.log(`  ${d.padEnd(7)} ${String(k).padStart(4)}  ${bar}`)
  }
  if (args.difficulty !== 'any') {
    const hit = histogram[args.difficulty]
    console.log(`Requested difficulty reached for ${hit}/${puzzles.length} puzzles (others fell back to their real rating)`)
  }
  console.log(
    `Time: ${total} ms total, ${(total / Math.max(1, puzzles.length)).toFixed(0)} ms per puzzle (median ${pct(0.5).toFixed(0)} ms, p90 ${pct(0.9).toFixed(0)} ms, max ${sorted[sorted.length - 1].toFixed(0)} ms)`,
  )
}

const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)
if (isMain) main()
