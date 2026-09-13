/**
 * Generic puzzle importer: add Queens boards from any source.
 *
 * Reads one or more files/directories containing puzzles in either of two
 * formats, validates them, drops duplicates of boards already in the library
 * and merges the survivors into `src/data/community-puzzles.json`.
 *
 * Text format (`.txt`, or any non-JSON extension): blocks separated by one or
 * more blank lines. A block may start with a header line
 *
 *     # <name> | <date YYYY-MM-DD> | <number>
 *
 * (every field optional, e.g. `# LinkedIn Queens #700 | 2026-03-31 | 700` or
 * just `# My board`). Every other line of the block is one row of the grid,
 * one character per cell (letters, digits or symbols); cells may also be
 * separated by spaces or commas. Lines starting with `//` are comments.
 *
 *     # LinkedIn Queens #617 | 2026-01-07 | 617
 *     AABBBCCC
 *     ADBDBECC
 *     ...
 *
 * JSON format (`.json`): a single object, an array of objects, or
 * `{ "puzzles": [...] }`. Each object needs `regions` — either `number[][]`
 * (region index per cell) or `string[]` (one text row per entry, same syntax
 * as the text format) — and may carry `name`, `date`, `number`, `colors` and
 * `attribution`. Exported `Puzzle` objects from this app are accepted as-is.
 *
 * Usage:
 *   npx tsx scripts/import-text-puzzles.ts <file-or-dir> [...more] [options]
 *
 * Options:
 *   --out <file>           output JSON (default src/data/community-puzzles.json)
 *   --source <name>        `source` field for imported puzzles (default community)
 *   --allow-disconnected   accept boards whose regions are not connected
 *   --dry-run              validate and report, but do not write
 *   --strict               exit with code 1 when any puzzle is rejected
 *
 * Every board must be square, have N regions indexed 0..N-1 and exactly one
 * solution. Boards whose layout (up to rotation, reflection and relabelling)
 * already exists in src/data/linkedin-puzzles.json, in the output file, or
 * earlier in the same batch are reported as duplicates and skipped.
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { dirname, extname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { normalizeRegions, parseTextGrid, shortHash, symmetricCanonicalKey, validateRegions } from '../src/core/puzzle.ts'
import { countSolutions } from '../src/core/solver.ts'
import type { Puzzle, PuzzleSource } from '../src/core/types.ts'

const here = dirname(fileURLToPath(import.meta.url))
export const LINKEDIN_JSON = resolve(here, '../src/data/linkedin-puzzles.json')
export const DEFAULT_OUT = resolve(here, '../src/data/community-puzzles.json')

/** A puzzle as read from an input file, before validation. */
export interface Candidate {
  /** Where it came from, e.g. `boards/march.txt#3` (1-based block index). */
  origin: string
  regions: number[][]
  name?: string
  date?: string
  number?: number
  colors?: string[]
  attribution?: string
}

export interface ImportOptions {
  /** `source` field written on every imported puzzle. */
  source?: PuzzleSource
  /** Accept boards with disconnected regions (LinkedIn's April Fools style). */
  allowDisconnected?: boolean
  /** Canonical keys (see `symmetricCanonicalKey`) of boards already known. */
  existingKeys?: Iterable<string>
  /** Ids already in use; imported ids are made unique against them. */
  existingIds?: Iterable<string>
}

export interface ImportResult {
  puzzles: Puzzle[]
  rejected: Array<{ origin: string; reason: string }>
  duplicates: Array<{ origin: string; of: string }>
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/

/** Parse `# name | date | number` (any field may be empty or absent). */
export function parseHeader(line: string): Pick<Candidate, 'name' | 'date' | 'number'> {
  const fields = line.replace(/^#+\s*/, '').split('|').map((f) => f.trim())
  const out: Pick<Candidate, 'name' | 'date' | 'number'> = {}
  const [name, date, number] = fields
  if (name) out.name = name
  if (date) {
    if (!DATE_RE.test(date)) throw new Error(`Invalid date "${date}" (expected YYYY-MM-DD)`)
    out.date = date
  }
  if (number) {
    const n = Number(number)
    if (!Number.isInteger(n) || n <= 0) throw new Error(`Invalid puzzle number "${number}"`)
    out.number = n
  }
  return out
}

/** Split a text file into candidate puzzles. Malformed blocks throw. */
export function parseTextFile(text: string, origin = 'text'): Candidate[] {
  const blocks: string[][] = []
  let current: string[] = []
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim()
    if (line === '') {
      if (current.length) blocks.push(current)
      current = []
    } else if (!line.startsWith('//')) {
      current.push(line)
    }
  }
  if (current.length) blocks.push(current)

  return blocks.map((lines, i) => {
    const blockOrigin = `${origin}#${i + 1}`
    let header: Pick<Candidate, 'name' | 'date' | 'number'> = {}
    const rows: string[] = []
    for (const line of lines) {
      if (line.startsWith('#')) {
        if (rows.length === 0 && !header.name && !header.date && !header.number) header = parseHeader(line)
        continue
      }
      rows.push(line)
    }
    if (rows.length === 0) throw new Error(`${blockOrigin}: block has a header but no grid`)
    return { origin: blockOrigin, regions: parseTextGrid(rows.join('\n')), ...header }
  })
}

type JsonPuzzle = {
  regions?: unknown
  size?: unknown
  name?: unknown
  date?: unknown
  number?: unknown
  colors?: unknown
  attribution?: unknown
}

function regionsFromJson(value: unknown, origin: string): number[][] {
  if (!Array.isArray(value) || value.length === 0) throw new Error(`${origin}: "regions" must be a non-empty array`)
  if (value.every((row) => typeof row === 'string')) return parseTextGrid((value as string[]).join('\n'))
  if (value.every((row) => Array.isArray(row) && row.every((g) => typeof g === 'number'))) return value as number[][]
  throw new Error(`${origin}: "regions" must be number[][] or string[]`)
}

/** Parse a JSON file: one object, an array, or `{ puzzles: [...] }`. */
export function parseJsonFile(text: string, origin = 'json'): Candidate[] {
  let data: unknown
  try {
    data = JSON.parse(text)
  } catch (e) {
    throw new Error(`${origin}: ${(e as Error).message}`)
  }
  let list: unknown[]
  if (Array.isArray(data)) list = data
  else if (data && typeof data === 'object' && Array.isArray((data as { puzzles?: unknown }).puzzles))
    list = (data as { puzzles: unknown[] }).puzzles
  else if (data && typeof data === 'object') list = [data]
  else throw new Error(`${origin}: expected an object or an array`)

  return list.map((item, i) => {
    const itemOrigin = `${origin}#${i + 1}`
    if (!item || typeof item !== 'object') throw new Error(`${itemOrigin}: expected an object`)
    const p = item as JsonPuzzle
    const regions = regionsFromJson(p.regions, itemOrigin)
    if (p.size !== undefined && p.size !== regions.length)
      throw new Error(`${itemOrigin}: size ${String(p.size)} does not match ${regions.length} rows`)
    const c: Candidate = { origin: itemOrigin, regions }
    if (typeof p.name === 'string' && p.name) c.name = p.name
    if (typeof p.date === 'string') {
      if (!DATE_RE.test(p.date)) throw new Error(`${itemOrigin}: invalid date "${p.date}"`)
      c.date = p.date
    }
    if (typeof p.number === 'number' && Number.isInteger(p.number) && p.number > 0) c.number = p.number
    if (Array.isArray(p.colors) && p.colors.every((x) => typeof x === 'string')) c.colors = p.colors as string[]
    if (typeof p.attribution === 'string' && p.attribution) c.attribution = p.attribution
    return c
  })
}

/** Recursively list importable files under a path (a file is returned as-is). */
export function listInputFiles(path: string): string[] {
  const st = statSync(path)
  if (st.isFile()) return [path]
  const out: string[] = []
  for (const entry of readdirSync(path, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
    if (entry.name.startsWith('.')) continue
    const full = join(path, entry.name)
    if (entry.isDirectory()) out.push(...listInputFiles(full))
    else if (/\.(txt|json|queens)$/i.test(entry.name)) out.push(full)
  }
  return out
}

/** Read every candidate from a list of files/directories. */
export function readCandidates(paths: string[], baseDir = process.cwd()): Candidate[] {
  const out: Candidate[] = []
  for (const p of paths) {
    for (const file of listInputFiles(resolve(p))) {
      const text = readFileSync(file, 'utf8')
      const origin = relative(baseDir, file) || file
      out.push(...(extname(file).toLowerCase() === '.json' ? parseJsonFile(text, origin) : parseTextFile(text, origin)))
    }
  }
  return out
}

/** Load canonical keys and ids of every puzzle in a JSON library file (missing file → empty). */
export function loadLibrary(file: string): { keys: Set<string>; ids: Set<string>; puzzles: Puzzle[] } {
  const keys = new Set<string>()
  const ids = new Set<string>()
  if (!existsSync(file)) return { keys, ids, puzzles: [] }
  const puzzles = JSON.parse(readFileSync(file, 'utf8')) as Puzzle[]
  if (!Array.isArray(puzzles)) throw new Error(`${file} does not contain a JSON array`)
  for (const p of puzzles) {
    keys.add(symmetricCanonicalKey(p.regions))
    ids.add(p.id)
  }
  return { keys, ids, puzzles }
}

/** Validate, de-duplicate and convert candidates into `Puzzle` objects. */
export function importCandidates(candidates: Candidate[], options: ImportOptions = {}): ImportResult {
  const source: PuzzleSource = options.source ?? 'community'
  const seen = new Map<string, string>() // canonical key → origin/id it was first seen under
  for (const k of options.existingKeys ?? []) seen.set(k, 'library')
  const usedIds = new Set(options.existingIds ?? [])
  const result: ImportResult = { puzzles: [], rejected: [], duplicates: [] }

  for (const c of candidates) {
    const problems = validateRegions(c.regions)
    const hard = options.allowDisconnected ? problems.filter((p) => !/not connected/.test(p)) : problems
    if (hard.length) {
      result.rejected.push({ origin: c.origin, reason: hard.join('; ') })
      continue
    }
    const regions = normalizeRegions(c.regions)
    const size = regions.length
    const solutions = countSolutions({ size, regions }, 2)
    if (solutions !== 1) {
      result.rejected.push({ origin: c.origin, reason: solutions === 0 ? 'no solution' : 'multiple solutions' })
      continue
    }
    const key = symmetricCanonicalKey(regions)
    const first = seen.get(key)
    if (first) {
      result.duplicates.push({ origin: c.origin, of: first })
      continue
    }

    const base = `${source}-${shortHash(key)}`
    let id = base
    for (let i = 2; usedIds.has(id); i++) id = `${base}-${i}`
    usedIds.add(id)
    seen.set(key, id)

    const puzzle: Puzzle = { id, size, regions, source }
    if (c.number !== undefined) puzzle.number = c.number
    if (c.date) puzzle.date = c.date
    if (c.name) puzzle.name = c.name
    if (c.colors && c.colors.length === size) puzzle.colors = c.colors
    const notes: string[] = []
    if (c.attribution) notes.push(c.attribution)
    if (problems.length) notes.push('Special board: some regions are disconnected')
    if (notes.length) puzzle.attribution = notes.join(' — ')
    result.puzzles.push(puzzle)
  }
  return result
}

/** Serialise a library with one puzzle per line (diff-friendly). */
export function serializeLibrary(puzzles: Puzzle[]): string {
  if (puzzles.length === 0) return '[]\n'
  return `[\n${puzzles.map((p) => '  ' + JSON.stringify(p)).join(',\n')}\n]\n`
}

interface CliArgs {
  inputs: string[]
  out: string
  source: PuzzleSource
  allowDisconnected: boolean
  dryRun: boolean
  strict: boolean
}

export function parseArgs(argv: string[]): CliArgs {
  const args: CliArgs = {
    inputs: [],
    out: DEFAULT_OUT,
    source: 'community',
    allowDisconnected: false,
    dryRun: false,
    strict: false,
  }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--out') args.out = resolve(argv[++i] ?? '')
    else if (a === '--source') args.source = (argv[++i] ?? 'community') as PuzzleSource
    else if (a === '--allow-disconnected') args.allowDisconnected = true
    else if (a === '--dry-run') args.dryRun = true
    else if (a === '--strict') args.strict = true
    else if (a === '--help' || a === '-h') args.inputs.length = 0
    else if (a.startsWith('--')) throw new Error(`Unknown option ${a}`)
    else args.inputs.push(a)
  }
  return args
}

function usage(): void {
  console.log(
    [
      'Usage: npx tsx scripts/import-text-puzzles.ts <file-or-dir> [...more] [options]',
      '',
      'Options:',
      '  --out <file>           output JSON (default src/data/community-puzzles.json)',
      '  --source <name>        source field for imported puzzles (default community)',
      '  --allow-disconnected   accept boards whose regions are not connected',
      '  --dry-run              validate and report, but do not write',
      '  --strict               exit with code 1 when any puzzle is rejected',
      '',
      'See scripts/README.md for the text and JSON input formats.',
    ].join('\n'),
  )
}

export function main(argv: string[]): number {
  const args = parseArgs(argv)
  if (args.inputs.length === 0) {
    usage()
    return 2
  }
  const candidates = readCandidates(args.inputs)
  const linkedin = existsSync(LINKEDIN_JSON) ? loadLibrary(LINKEDIN_JSON) : { keys: new Set<string>(), ids: new Set<string>() }
  const existing = loadLibrary(args.out)
  const result = importCandidates(candidates, {
    source: args.source,
    allowDisconnected: args.allowDisconnected,
    existingKeys: [...linkedin.keys, ...existing.keys],
    existingIds: [...linkedin.ids, ...existing.ids],
  })

  console.log(`Read ${candidates.length} puzzle(s) from ${args.inputs.length} path(s)`)
  for (const r of result.rejected) console.log(`  rejected  ${r.origin}: ${r.reason}`)
  for (const d of result.duplicates) console.log(`  duplicate ${d.origin} (same layout as ${d.of})`)
  console.log(`${result.puzzles.length} new, ${result.duplicates.length} duplicate(s), ${result.rejected.length} rejected`)

  if (!args.dryRun && result.puzzles.length) {
    mkdirSync(dirname(args.out), { recursive: true })
    writeFileSync(args.out, serializeLibrary([...existing.puzzles, ...result.puzzles]))
    console.log(`Wrote ${existing.puzzles.length + result.puzzles.length} puzzle(s) to ${args.out}`)
  } else if (args.dryRun) {
    console.log('Dry run: nothing written')
  }
  return args.strict && result.rejected.length ? 1 : 0
}

const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)
if (isMain) {
  try {
    process.exit(main(process.argv.slice(2)))
  } catch (e) {
    console.error((e as Error).message)
    process.exit(1)
  }
}
