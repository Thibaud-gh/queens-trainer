/** Import actual solved SVG boards, with source identity and solution checks. */
import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { normalizeRegions, symmetricCanonicalKey, validateRegions } from '../src/core/puzzle.ts'
import { solve } from '../src/core/solver.ts'
import type { Puzzle } from '../src/core/types.ts'

export const sourceUrl = (n: number) => `https://linkedinzip.solutions/linkedin-queens-puzzle-${n}-answer/`
export function dateForNumber(n: number): string {
  const date = new Date('2024-05-01T00:00:00Z')
  date.setUTCDate(date.getUTCDate() + n - 1)
  return date.toISOString().slice(0, 10)
}
function attributes(tag: string): Record<string, string> {
  return Object.fromEntries([...tag.matchAll(/([\w-]+)="([^"]*)"/g)].map(m => [m[1], m[2]]))
}

export function parseSolvedSvg(html: string, number: number): Puzzle {
  const svg = [...html.matchAll(/<svg\b[^>]*>[\s\S]*?<\/svg>/g)]
    .map(m => m[0]).find(s => s.includes(`aria-label="The solved board for LinkedIn Queens puzzle #${number},`))
  if (!svg) throw new Error(`No solved board identified as #${number}`)
  const label = attributes(svg.slice(0, svg.indexOf('>') + 1))['aria-label']
  const match = /, (\d+)x(\d+)$/.exec(label)
  if (!match || match[1] !== match[2]) throw new Error('Missing square board dimensions')
  const size = Number(match[1])
  if (size < 4 || size > 16) throw new Error('Unsupported size')
  const date = dateForNumber(number)
  const expectedDisplay = new Intl.DateTimeFormat('en-US', { timeZone: 'UTC', month: 'long', day: 'numeric', year: 'numeric' }).format(new Date(date))
  const heading = html.slice(html.indexOf('<h1'), html.indexOf('</header>', html.indexOf('<h1')))
  if (!heading.includes(expectedDisplay)) throw new Error(`Page date does not agree with puzzle number (${date})`)
  const palette: string[] = []
  const regions = Array.from({ length: size }, () => new Array<number>(size).fill(-1))
  for (const m of svg.matchAll(/<rect\b[^>]*>/g)) {
    const a = attributes(m[0])
    if (a.width !== '1' || a.height !== '1') continue
    const row = Number(a.y), col = Number(a.x)
    if (!Number.isInteger(row) || !Number.isInteger(col) || row < 0 || col < 0 || row >= size || col >= size || !/^#[0-9a-f]{6}$/i.test(a.fill ?? '')) throw new Error('Invalid cell rectangle')
    if (regions[row][col] !== -1) throw new Error('Duplicate cell rectangle')
    if (!palette.includes(a.fill)) palette.push(a.fill)
    regions[row][col] = palette.indexOf(a.fill)
  }
  const errors = validateRegions(regions)
  if (errors.length) throw new Error(errors.join('; '))
  const puzzle: Puzzle = { id: `li-${number}`, number, date, size, regions: normalizeRegions(regions), colors: palette, source: 'linkedin', name: `LinkedIn Queens #${number}`, attribution: `Transcribed from ${sourceUrl(number)}; independently validated; SHA-256:${createHash('sha256').update(svg).digest('hex')}` }
  const solutions = solve(puzzle, 2)
  if (solutions.length !== 1) throw new Error(`Expected unique solution, found ${solutions.length}`)
  // Verify the independent source's stated answer, not just that some solution exists.
  const intro = heading.match(/<p[^>]*>LinkedIn Queens #[\s\S]*?<\/p>/)?.[0] ?? ''
  const coordinates = [...intro.matchAll(/R(\d+)C(\d+)/g)].map(m => [Number(m[1]) - 1, Number(m[2]) - 1])
  if (coordinates.length !== size || new Set(coordinates.map(([r]) => r)).size !== size || coordinates.some(([r, c]) => solutions[0][r] !== c)) throw new Error('Source answer does not match independent solver')
  return puzzle
}

/** Parse JSON transport only; never execute page scripts. Used for cross-checks. */
export function parseFlightBoards(html: string): Array<{ number: number; regions: number[][] }> {
  let flight = ''
  for (const m of html.matchAll(/self\.__next_f\.push\((.*?)\)<\/script>/g)) {
    const chunk = JSON.parse(m[1]) as unknown[]
    if (typeof chunk[1] === 'string') flight += chunk[1]
  }
  const result = new Map<number, number[][]>()
  function walk(value: unknown) {
    if (!value || typeof value !== 'object') return
    const record = value as Record<string, unknown>
    if (Number.isInteger(record.puzzleNo) && Array.isArray(record.colorGrid)) result.set(record.puzzleNo as number, normalizeRegions(record.colorGrid as number[][]))
    for (const child of Object.values(record)) walk(child)
  }
  for (const line of flight.split('\n')) {
    const json = line.slice(line.indexOf(':') + 1)
    if (!json.startsWith('[') && !json.startsWith('{')) continue
    try { walk(JSON.parse(json)) } catch { /* Non-JSON flight records are ignored. */ }
  }
  return [...result].map(([number, regions]) => ({ number, regions }))
}

function main() {
  const opts = { from: 617, to: 863, cache: '/tmp/queens-history-cache', out: 'src/data/linkedin-extra.json', report: 'reports/history-import.json', fetch: false }
  for (let i = 2; i < process.argv.length; i++) {
    const flag = process.argv[i]
    if (flag === '--fetch') { opts.fetch = true; continue }
    if (flag === '--help') { console.log('Usage: npm run import:recent -- --from 617 --to 863 --cache /tmp/queens-history-cache [--fetch] [--out src/data/linkedin-extra.json] [--report reports/history-import.json]'); return }
    const value = process.argv[++i]
    if (value === undefined) throw new Error(`Missing ${flag}`)
    if (flag === '--from') opts.from = Number(value)
    else if (flag === '--to') opts.to = Number(value)
    else if (flag === '--cache') opts.cache = value
    else if (flag === '--out') opts.out = value
    else if (flag === '--report') opts.report = value
    else throw new Error(`Unknown option ${flag}`)
  }
  if (!Number.isInteger(opts.from) || !Number.isInteger(opts.to) || opts.from < 1 || opts.to < opts.from || opts.to - opts.from > 1000) throw new Error('Invalid range')
  const original = JSON.parse(readFileSync(new URL('../src/data/linkedin-puzzles.json', import.meta.url), 'utf8')) as Puzzle[]
  const existing = existsSync(opts.out) ? JSON.parse(readFileSync(opts.out, 'utf8')) as Puzzle[] : []
  const known = new Map(original.concat(existing).map(p => [p.number!, p]))
  const accepted = new Map(existing.map(p => [p.number!, p]))
  const layoutNumbers = new Map<string, number>()
  for (const [n, p] of known) { const key = symmetricCanonicalKey(p.regions); if (!layoutNumbers.has(key)) layoutNumbers.set(key, n) }
  const records: Array<{ number: number; status: string; detail?: string; url: string; sha256?: string; rerunOf?: number }> = []
  mkdirSync(opts.cache, { recursive: true })
  const save = () => {
    for (const path of [opts.out, opts.report]) mkdirSync(dirname(resolve(path)), { recursive: true })
    writeFileSync(opts.out, JSON.stringify([...accepted.values()].sort((a, b) => a.number! - b.number!)) + '\n')
    writeFileSync(opts.report, JSON.stringify({ source: 'linkedinzip.solutions', retrievedAt: new Date().toISOString(), range: [opts.from, opts.to], records }, null, 2) + '\n')
  }
  for (let number = opts.from; number <= opts.to; number++) {
    const url = sourceUrl(number), file = resolve(opts.cache, `${number}.html`)
    try {
      if (!existsSync(file)) {
        if (!opts.fetch) throw new Error('Not cached; use --fetch')
        const html = execFileSync('curl', ['--fail', '--location', '--max-time', '30', '--silent', '--show-error', url], { maxBuffer: 5_000_000, encoding: 'utf8' })
        writeFileSync(file, html)
        Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 600)
      }
      const html = readFileSync(file, 'utf8'), puzzle = parseSolvedSvg(html, number)
      const key = symmetricCanonicalKey(puzzle.regions)
      const previous = known.get(number)
      if (previous && symmetricCanonicalKey(previous.regions) !== key) throw new Error('Conflicts with existing board for same number')
      const sameLayoutNumber = layoutNumbers.get(key)
      const rerunOf = sameLayoutNumber !== number ? sameLayoutNumber : undefined
      if (!previous) { accepted.set(number, puzzle); known.set(number, puzzle); if (!layoutNumbers.has(key)) layoutNumbers.set(key, number) }
      records.push({ number, url, status: previous ? 'verified-existing' : 'imported', sha256: createHash('sha256').update(html).digest('hex'), ...(rerunOf ? { rerunOf } : {}) })
    } catch (error) { records.push({ number, url, status: 'failed', detail: String(error) }) }
    save()
    console.log(`#${number} ${records.at(-1)!.status}${records.at(-1)!.detail ? ': ' + records.at(-1)!.detail : ''}`)
  }
  console.log(`Imported ${records.filter(r => r.status === 'imported').length}; verified ${records.filter(r => r.status === 'verified-existing').length}; failed ${records.filter(r => r.status === 'failed').length}`)
  if (records.some(r => r.status === 'failed')) process.exitCode = 1
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main()
