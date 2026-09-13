/** Paired, size-stratified benchmark. See docs/generator-v2.md for interpretation. */
import { createHash } from 'node:crypto'
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { generatePuzzle, resetGeneratorHistory, type GeneratorVersion } from '../src/core/generator.ts'
import { profileBoard, type BoardProfile } from '../src/core/generator-profile.ts'
import { hashSeed, makeRng } from '../src/core/random.ts'
import { symmetricCanonicalKey, validateRegions } from '../src/core/puzzle.ts'
import { countSolutions } from '../src/core/solver.ts'
import type { Puzzle } from '../src/core/types.ts'

export const mean = (xs: number[]) => xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0
export function quantile(xs: number[], p: number): number {
  if (!xs.length) return 0
  const sorted = xs.slice().sort((a, b) => a - b)
  const index = (sorted.length - 1) * p
  const lo = Math.floor(index)
  return sorted[lo] + (sorted[Math.ceil(index)] - sorted[lo]) * (index - lo)
}

/** Exact one-dimensional Wasserstein-1 for empirical samples of unequal sizes. */
export function wasserstein(a: number[], b: number[]): number {
  if (!a.length || !b.length) throw new Error('Cannot compare empty samples')
  const x = a.slice().sort((u, v) => u - v), y = b.slice().sort((u, v) => u - v)
  let i = 0, j = 0, last = Math.min(x[0], y[0]), distance = 0
  while (i < x.length || j < y.length) {
    const next = Math.min(x[i] ?? Infinity, y[j] ?? Infinity)
    distance += Math.abs(i / x.length - j / y.length) * (next - last)
    while (i < x.length && x[i] === next) i++
    while (j < y.length && y[j] === next) j++
    last = next
  }
  return distance
}

/** Same canonical board always belongs to the same split, including reruns. */
export function isHoldout(p: Pick<Puzzle, 'regions'>): boolean {
  return hashSeed(`queens-holdout-v1:${symmetricCanonicalKey(p.regions)}`) % 5 === 0
}

export function correlation(a: number[], b: number[]): number {
  const am = mean(a), bm = mean(b)
  const cov = mean(a.map((x, i) => (x - am) * (b[i] - bm)))
  const variance = mean(a.map(x => (x - am) ** 2)) * mean(b.map(x => (x - bm) ** 2))
  return variance > 0 ? cov / Math.sqrt(variance) : 0
}

// Fixed natural scales keep error units comparable without dividing by zero
// for rare events. The score is a diagnostic, not a claim of human similarity.
export function metricScale(key: string, size: number): number {
  if (key.startsWith('rank:') || key.startsWith('shape:') || key.startsWith('difficulty:')) return 1
  if (['largest', 'hasSingleton', 'background', 'enclosure', 'symmetry', 'solved'].includes(key)) return 1
  if (key === 'perimeter') return 4 * size * size
  if (['steps', 'firstQueen'].includes(key)) return 4 * size
  if (key === 'level') return 6
  if (key === 'adjacency') return 2 * size
  return size
}

const pairs = [['largest', 'tinyCount'], ['interior', 'shape:snake'], ['singletonCount', 'advanced'], ['largest', 'enclosure']]
function describe(profiles: BoardProfile[], metrics: string[]) {
  return Object.fromEntries(metrics.map(key => {
    const xs = profiles.map(p => p.features[key])
    return [key, { mean: mean(xs), p10: quantile(xs, .1), p50: quantile(xs, .5), p90: quantile(xs, .9) }]
  }))
}
function distances(reference: BoardProfile[], generated: BoardProfile[], metrics: string[], size: number) {
  return Object.fromEntries(metrics.map(key => [key, wasserstein(reference.map(p => p.features[key]), generated.map(p => p.features[key])) / metricScale(key, size)]))
}

export interface BenchmarkArgs { baseline: GeneratorVersion; candidate: GeneratorVersion; history: 'original' | 'expanded'; count: number; seeds: string[]; sizes: number[]; out: string; reference: 'holdout' | 'all'; candidates?: number; attempts?: number; check: boolean }
export function parseArgs(argv: string[]): BenchmarkArgs {
  const args: BenchmarkArgs = { baseline: 'legacy', candidate: 'profile-v2', history: 'original', count: 50, seeds: ['benchmark-a', 'benchmark-b'], sizes: [7, 8, 9, 10, 11], out: 'reports/generator-benchmark.json', reference: 'holdout', check: false }
  for (let i = 0; i < argv.length; i++) {
    const flag = argv[i]
    if (flag === '--check') { args.check = true; continue }
    if (flag === '--help') {
      console.log('Usage: npm run benchmark -- --count 50 --seeds a,b --sizes 7,8,9,10,11 --reference holdout|all --baseline legacy|profile-v2|profile-v3 --candidate legacy|profile-v2|profile-v3 --history original|expanded --out reports/result.json [--candidates 12] [--attempts 120] [--check]')
      process.exit(0)
    }
    const value = argv[++i]
    if (value === undefined) throw new Error(`Missing value for ${flag}`)
    if (flag === '--history' && ['original', 'expanded'].includes(value)) args.history = value as 'original' | 'expanded'
    else if ((flag === '--baseline' || flag === '--candidate') && ['legacy', 'profile-v2', 'profile-v3'].includes(value)) args[flag === '--baseline' ? 'baseline' : 'candidate'] = value as GeneratorVersion
    else if (flag === '--count') args.count = Number(value)
    else if (flag === '--seeds') args.seeds = value.split(',').filter(Boolean)
    else if (flag === '--sizes') args.sizes = value.split(',').map(Number)
    else if (flag === '--out') args.out = value
    else if (flag === '--reference' && ['all', 'holdout'].includes(value)) args.reference = value as 'holdout' | 'all'
    else if (flag === '--candidates') args.candidates = Number(value)
    else if (flag === '--attempts') args.attempts = Number(value)
    else throw new Error(`Unknown option or invalid value: ${flag} ${value}`)
  }
  for (const n of [args.count, args.candidates ?? 12, args.attempts ?? 120]) if (!Number.isInteger(n) || n < 1) throw new Error('Counts and budgets must be positive integers')
  if (!args.seeds.length || !args.sizes.length || args.sizes.some(n => ![7, 8, 9, 10, 11].includes(n))) throw new Error('Need seeds and sizes within 7–11')
  if (new Set(args.seeds).size !== args.seeds.length || new Set(args.sizes).size !== args.sizes.length) throw new Error('Seeds and sizes must be distinct')
  if (args.baseline === args.candidate) throw new Error('Choose different baseline and candidate versions')
  return args
}

interface BenchmarkGroup {
  size: number
  referenceBoards: number
  reference: ReturnType<typeof describe>
  delta95: number[]
  versions: Record<string, {
    meanDistance: number
    nonSingletonDistance?: number
    failures: number
    timing: { mean: number }
    features: ReturnType<typeof describe>
    relaxed?: number
    difficultyMisses?: number
  }>
}

export function writeMarkdownReport(args: BenchmarkArgs, groups: BenchmarkGroup[], out: string): void {
  const baseline = args.baseline ?? 'legacy', candidate = args.candidate ?? 'profile-v2'
  const lines = ['# Generator benchmark', '', `Corpus: ${args.history ?? 'original'}. Reference: ${args.reference}. ${args.count} boards per size per batch per version. Batches: ${args.seeds.join(', ')}.`, '', `| Size | Reference n | ${baseline} distance | ${candidate} distance | Candidate−baseline 95% CI | Failures old/new | Mean ms old/new |`, '|---|---:|---:|---:|---|---|---|']
  for (const g of groups) {
    const a = g.versions[baseline], b = g.versions[candidate]
    lines.push(`| ${g.size} | ${g.referenceBoards} | ${a.meanDistance.toFixed(4)} | ${b.meanDistance.toFixed(4)} | ${g.delta95.map(x => x.toFixed(4)).join(' … ')} | ${a.failures}/${b.failures} | ${a.timing.mean.toFixed(0)}/${b.timing.mean.toFixed(0)} |`)
  }
  lines.push('', 'Lower distance is better. Small historical strata have substantial uncertainty. Inspect JSON for all per-feature distributions, correlations, timings, failures, and generated grids. No pooled size average is used.', '')
  lines.push('## Selected feature means', '', `| Size | Feature | Reference | ${baseline} | ${candidate} |`, '|---|---|---:|---:|---:|')
  for (const g of groups) {
    for (const key of ['hasSingleton', 'interior', 'shape:snake', 'shape:ring', 'shape:blob', 'background', 'difficulty:medium', 'advanced']) {
      lines.push(`| ${g.size} | ${key} | ${g.reference[key].mean.toFixed(3)} | ${g.versions[baseline].features[key].mean.toFixed(3)} | ${g.versions[candidate].features[key].mean.toFixed(3)} |`)
    }
  }
  if (groups.every(g => g.versions[candidate].nonSingletonDistance !== undefined)) {
    lines.push('', '## Distance excluding explicit singleton metrics', '', `| Size | ${baseline} | ${candidate} |`, '|---|---:|---:|')
    for (const g of groups) lines.push(`| ${g.size} | ${g.versions[baseline].nonSingletonDistance?.toFixed(4)} | ${g.versions[candidate].nonSingletonDistance?.toFixed(4)} |`)
    lines.push('', 'Excludes hasSingleton, singletonCount and shape:single only. Correlated shape, region area and difficulty metrics remain. V3 deliberately targets 10% singleton boards rather than the historical rate.')
  }
  lines.push('', '## Selection diagnostics', '', '| Size | Relaxed construction selected | Target difficulty missed |', '|---|---:|---:|')
  for (const g of groups) lines.push(`| ${g.size} | ${g.versions[candidate].relaxed ?? 'not recorded'} | ${g.versions[candidate].difficultyMisses ?? 'not recorded'} |`)
  lines.push('', 'Feature shares are fractions (0–1); interior and advanced are counts. Difficulty labels are solver-based. Timing includes output validity checks. Generation is slower because profile generation evaluates multiple unique candidates.', '')
  writeFileSync(out.replace(/\.json$/, '') + '.md', lines.join('\n'))
  console.log(lines.join('\n'))
}

function main() {
  if (process.argv[2] === '--summarize') {
    const out = resolve(process.argv[3] ?? 'reports/generator-benchmark.json')
    const report = JSON.parse(readFileSync(out, 'utf8')) as { configuration: BenchmarkArgs; groups: BenchmarkGroup[] }
    writeMarkdownReport(report.configuration, report.groups, out)
    return
  }
  const args = parseArgs(process.argv.slice(2))
  const sourceHashes = Object.fromEntries(['../src/core/generator.ts', '../src/core/generator-legacy.ts', '../src/core/generator-profile.ts', '../src/core/generator-calibration.ts', '../src/data/linkedin-puzzles.json', ...(args.history === 'expanded' ? ['../src/data/linkedin-extra.json'] : [])].map(path => [path, createHash('sha256').update(readFileSync(new URL(path, import.meta.url))).digest('hex')]))
  const environment = { node: process.version, platform: process.platform, architecture: process.arch }
  const original = JSON.parse(readFileSync(new URL('../src/data/linkedin-puzzles.json', import.meta.url), 'utf8')) as Puzzle[]
  const extra = args.history === 'expanded' ? JSON.parse(readFileSync(new URL('../src/data/linkedin-extra.json', import.meta.url), 'utf8')) as Puzzle[] : []
  const archive = original.concat(extra).filter(p => p.number !== 336)
  const originalTrain = original.filter(p => p.number !== 336 && !isHoldout(p)).map(profileBoard)
  const train = archive.filter(p => !isHoldout(p)).map(profileBoard)
  const reference = archive.filter(p => args.reference === 'all' || isHoldout(p)).map(profileBoard)
  const historicalKeys = new Set(archive.map(p => symmetricCanonicalKey(p.regions)))
  const groups = []
  const records: Array<{ version: GeneratorVersion; size: number; batch: string; seed: string; ms: number; error?: string; profile?: BoardProfile; regions?: number[][]; historicalCopy?: boolean; duplicate?: boolean; attribution?: string; generation?: Puzzle['generation'] }> = []
  for (const size of args.sizes) {
    const ref = reference.filter(p => p.size === size)
    const metrics = Object.keys(ref[0].features)
    for (const version of [args.baseline, args.candidate]) {
      for (const batch of args.seeds) {
        resetGeneratorHistory()
        const seen = new Set<string>()
        for (let i = 0; i < args.count; i++) {
          const seed = `${batch}-${size}-${i}`
          const start = performance.now()
          try {
            const p = generatePuzzle({ size, seed, version, profiles: version === 'profile-v2' && args.candidate === 'profile-v3' ? originalTrain : train, candidates: args.candidates, maxAttempts: args.attempts })
            const errors = validateRegions(p.regions)
            if (errors.length || countSolutions(p, 2) !== 1) throw new Error(`Invalid output: ${errors.join('; ')}`)
            const key = symmetricCanonicalKey(p.regions)
            const ms = performance.now() - start
            records.push({ version, size, batch, seed, ms, profile: profileBoard(p), regions: p.regions, historicalCopy: historicalKeys.has(key), duplicate: seen.has(key), attribution: p.attribution, generation: p.generation })
            seen.add(key)
          } catch (error) {
            records.push({ version, size, batch, seed, ms: performance.now() - start, error: String(error) })
          }
          if ((i + 1) % 10 === 0) console.log(`${size}×${size} ${version} ${batch}: ${i + 1}/${args.count}`)
        }
      }
    }
    const versions = Object.fromEntries(([args.baseline, args.candidate]).map(version => {
      const rows = records.filter(r => r.size === size && r.version === version)
      const profiles = rows.flatMap(r => r.profile ? [r.profile] : [])
      if (!profiles.length) throw new Error(`No successful ${version} output for ${size}`)
      const ds = distances(ref, profiles, metrics, size)
      return [version, {
        relaxed: rows.filter(r => r.generation?.relaxed).length, difficultyMisses: rows.filter(r => r.generation && !r.generation.difficultyMatched).length,
        count: profiles.length, failures: rows.filter(r => r.error).length, duplicates: rows.filter(r => r.duplicate).length, historicalCopies: rows.filter(r => r.historicalCopy).length,
        timing: { mean: mean(rows.map(r => r.ms)), p50: quantile(rows.map(r => r.ms), .5), p95: quantile(rows.map(r => r.ms), .95) },
        features: describe(profiles, metrics), distances: ds, nonSingletonDistance: mean(Object.entries(ds).filter(([key]) => !['hasSingleton', 'singletonCount', 'shape:single'].includes(key)).map(([, value]) => value)), meanDistance: mean(Object.values(ds)),
        correlations: Object.fromEntries(pairs.map(([a, b]) => [`${a}/${b}`, correlation(profiles.map(p => p.features[a]), profiles.map(p => p.features[b]))])),
        batches: args.seeds.map(batch => {
          const ps = rows.filter(r => r.batch === batch).flatMap(r => r.profile ? [r.profile] : [])
          return { batch, count: ps.length, meanDistance: ps.length ? mean(Object.values(distances(ref, ps, metrics, size))) : null }
        }),
      }]
    }))
    // Paired bootstrap: resample the same seeds in both arms and independently
    // resample reference boards. Conditional on this fixed training split.
    const rng = makeRng(`bootstrap:${size}`)
    const old = records.filter(r => r.size === size && r.version === args.baseline)
    const next = records.filter(r => r.size === size && r.version === args.candidate)
    const paired = old.flatMap((r, i) => r.profile && next[i]?.profile ? [[r.profile, next[i].profile!] as const] : [])
    const deltas: number[] = []
    for (let rep = 0; rep < 200 && paired.length; rep++) {
      const sample = Array.from({ length: paired.length }, () => rng.pick(paired))
      const refs = Array.from({ length: ref.length }, () => rng.pick(ref))
      deltas.push(mean(Object.values(distances(refs, sample.map(p => p[1]), metrics, size))) - mean(Object.values(distances(refs, sample.map(p => p[0]), metrics, size))))
    }
    groups.push({ size, trainingBoards: train.filter(p => p.size === size).length, referenceBoards: ref.length, reference: describe(ref, metrics), referenceCorrelations: Object.fromEntries(pairs.map(([a, b]) => [`${a}/${b}`, correlation(ref.map(p => p.features[a]), ref.map(p => p.features[b]))])), versions, delta95: [quantile(deltas, .025), quantile(deltas, .975)] })
  }
  const out = resolve(args.out)
  mkdirSync(dirname(out), { recursive: true })
  writeFileSync(out, JSON.stringify({ configuration: args, sourceHashes, environment, split: 'canonical-hash-v1: modulo 5 = 0 held out; training always excludes holdout', notes: 'Distances are normalized Wasserstein-1; lower is better. CI is paired bootstrap conditional on training split. Aggregate weights are heuristic. Historical daily reruns retain their frequency. When comparing v2 to v3, v2 uses original training history and v3 expanded training history. V3 intentionally underweights singleton boards; nonSingletonDistance excludes only the three explicit singleton metrics, retaining correlated features. All generated outputs checked for connectivity and unique solution.', groups, records }, null, 2))
  writeMarkdownReport(args, groups, out)
  if (args.check && groups.some(g => g.versions[args.candidate].failures > 0 || g.versions[args.candidate].duplicates > 0 || g.versions[args.candidate].historicalCopies > 0 || g.delta95[0] > 0)) process.exitCode = 1
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main()
