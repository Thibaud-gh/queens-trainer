/**
 * Scrape LinkedIn Queens boards from a third-party archive site to fill the
 * gap between our last imported board (#616, 2026-01-06) and today.
 *
 * This sandbox cannot reach the real archive hosts (network policy blocks
 * them), so the extraction logic below is deliberately *generic and
 * site-agnostic* rather than tuned to any one page's markup: it tries a few
 * "sources of truth" in order (embedded JSON, `data-*` attributes, then a
 * pixel-geometry + background-colour heuristic) and only accepts a board
 * once it independently validates as a legal, uniquely-solvable Queens
 * puzzle. See docs/scraping.md for how to run this against a real site and
 * for what to do with pages it cannot read automatically.
 *
 * Usage:
 *   npx tsx scripts/scrape-archive.ts --base https://www.archivedqueens.com
 *   npx tsx scripts/scrape-archive.ts \
 *     --url-template "https://www.archivedqueens.com/puzzle/{n}" \
 *     --from 617 --to 860
 *
 * Run `npx tsx scripts/scrape-archive.ts --help` for the full flag list.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium, type Page } from 'playwright'
import { symmetricCanonicalKey, validateRegions } from '../src/core/puzzle.ts'
import { countSolutions } from '../src/core/solver.ts'
import type { Puzzle } from '../src/core/types.ts'

const here = dirname(fileURLToPath(import.meta.url))

/** LinkedIn Queens #1 was published 2024-05-01; one puzzle per day since. */
export const FIRST_PUZZLE_DATE = '2024-05-01'

const DEFAULT_OUT = resolve(here, '../src/data/linkedin-puzzles.json')
const DEFAULT_SHOTS = resolve(here, 'shots')

const USER_AGENT =
  'QueensTrainerArchiveBot/1.0 (+local script that fills gaps in a LinkedIn Queens puzzle archive; ' +
  'see docs/scraping.md for contact and details) Playwright'

export function dateForNumber(n: number): string {
  const d = new Date(`${FIRST_PUZZLE_DATE}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + (n - 1))
  return d.toISOString().slice(0, 10)
}

/** Inverse of {@link dateForNumber}. Returns null for an unparseable or pre-#1 date. */
export function numberForDate(dateStr: string): number | null {
  const d = new Date(`${dateStr}T00:00:00Z`)
  if (Number.isNaN(d.getTime())) return null
  const start = new Date(`${FIRST_PUZZLE_DATE}T00:00:00Z`)
  const days = Math.round((d.getTime() - start.getTime()) / 86_400_000)
  const n = days + 1
  return n >= 1 ? n : null
}

/**
 * Best-effort extraction of a LinkedIn puzzle number from a link's text or
 * href: an explicit `#617`, a path/slug segment like `/617`, `puzzle-617`,
 * `queens_617`, or an ISO date (converted via {@link numberForDate}).
 */
export function extractNumberFromString(s: string): number | null {
  if (!s) return null
  const dateMatch = /\b(20\d{2}-\d{2}-\d{2})\b/.exec(s)
  if (dateMatch) {
    const n = numberForDate(dateMatch[1])
    if (n !== null) return n
  }
  const patterns = [
    /#\s*(\d{1,5})\b/,
    /\b(?:puzzle|queens|level|archive|day|li)[\s#_-]*(\d{1,5})\b/i,
    /[/-](\d{1,5})(?:[/.]|$)/,
  ]
  for (const re of patterns) {
    const m = re.exec(s)
    if (m) {
      const n = Number(m[1])
      if (Number.isInteger(n) && n > 0) return n
    }
  }
  return null
}

export interface ScrapeOptions {
  base?: string
  urlTemplate?: string
  from?: number
  to?: number
  onlyMissing: boolean
  shotsDir: string
  outFile: string
  delayMs: number
  headless: boolean
  listSelector?: string
}

const DEFAULTS: ScrapeOptions = {
  onlyMissing: true,
  shotsDir: DEFAULT_SHOTS,
  outFile: DEFAULT_OUT,
  delayMs: 800,
  headless: true,
}

const HELP = `Scrape LinkedIn Queens boards from an archive site into src/data/linkedin-puzzles.json.

Usage:
  npx tsx scripts/scrape-archive.ts --base <url> [options]
  npx tsx scripts/scrape-archive.ts --url-template "<url with {n}>" --from <n> --to <n> [options]

Discovery mode (--base):
  Loads <url>, collects same-origin links whose text or href contains a
  puzzle number (e.g. "#617", "/617", "queens-617", or a publish date), and
  visits each in turn. Narrow the crawl with --from/--to; omit them to visit
  everything discovered.

Direct mode (--url-template):
  Visits "<url-template>" with "{n}" replaced by each number from --from to
  --to. Requires both --from and --to.

Options:
  --base <url>            Archive index/listing page to discover links from.
  --url-template <tpl>    URL template containing "{n}"; skips discovery.
  --from <n>              First puzzle number to consider.
  --to <n>                Last puzzle number to consider.
  --only-missing          Skip numbers already present in --out (default: on).
  --no-only-missing       Re-visit numbers already present in --out.
  --shots <dir>           Screenshot directory (default: scripts/shots).
  --out <file>            Puzzle JSON to read/merge/write (default: src/data/linkedin-puzzles.json).
  --delay-ms <n>          Delay between page visits, in ms (default: 800).
  --headless <true|false> Run Chromium headless or visibly (default: true).
  --list-selector <css>   CSS selector for discovery links (default: "a").
  --help                  Show this help.

Every extracted board is validated (legal region layout, exactly one
solution) and deduplicated against existing boards before being written.
Boards that fail extraction or validation are logged with a saved
screenshot and left out of the archive so a human can transcribe them by
hand; see docs/scraping.md.
`

export function parseArgs(argv: string[]): ScrapeOptions | 'help' {
  if (argv.includes('--help') || argv.includes('-h')) return 'help'
  const opts: ScrapeOptions = { ...DEFAULTS }
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    const eq = arg.indexOf('=')
    const flag = eq >= 0 ? arg.slice(0, eq) : arg
    const inline = eq >= 0 ? arg.slice(eq + 1) : undefined
    const next = (): string => {
      if (inline !== undefined) return inline
      const v = argv[++i]
      if (v === undefined) throw new Error(`Missing value for ${flag}`)
      return v
    }
    switch (flag) {
      case '--base':
        opts.base = next()
        break
      case '--url-template':
        opts.urlTemplate = next()
        break
      case '--from':
        opts.from = Number(next())
        break
      case '--to':
        opts.to = Number(next())
        break
      case '--only-missing':
        opts.onlyMissing = inline === undefined ? true : inline !== 'false'
        break
      case '--no-only-missing':
        opts.onlyMissing = false
        break
      case '--shots':
        opts.shotsDir = resolve(next())
        break
      case '--out':
        opts.outFile = resolve(next())
        break
      case '--delay-ms':
        opts.delayMs = Number(next())
        break
      case '--headless':
        opts.headless = next() !== 'false'
        break
      case '--list-selector':
        opts.listSelector = next()
        break
      default:
        throw new Error(`Unknown argument: ${arg} (see --help)`)
    }
  }
  if (opts.from !== undefined && !Number.isFinite(opts.from)) throw new Error('--from must be a number')
  if (opts.to !== undefined && !Number.isFinite(opts.to)) throw new Error('--to must be a number')
  return opts
}

// ---------------------------------------------------------------------------
// Board extraction. Runs inside the page (via page.evaluate), so it must be
// self-contained: no references to outer closures, only what Playwright
// serialises across. Kept as plain functions (no DOM lib types) so it can be
// stringified and executed unmodified in the browser.
// ---------------------------------------------------------------------------

export interface ExtractedBoard {
  size: number
  regions: number[][]
  colors?: string[]
  method: string
}

interface ExtractFailure {
  error: string
  size?: number
}

export type RawExtraction = ExtractedBoard | ExtractFailure

export function isExtractFailure(r: RawExtraction): r is ExtractFailure {
  return !('regions' in r)
}

/** The heuristic board-finder, executed in-page via `page.evaluate`. */
/* c8 ignore start -- exercised only inside a real browser context */
function extractBoardInPage(): RawExtraction {
  const MIN_N = 4
  const MAX_N = 16

  function normalizeColor(cssColor: string | null): string | null {
    if (!cssColor) return null
    const m = /rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)\s*(?:,\s*([\d.]+)\s*)?\)/.exec(cssColor)
    if (!m) return null
    const r = Number(m[1])
    const g = Number(m[2])
    const b = Number(m[3])
    const a = m[4] === undefined ? 1 : Number(m[4])
    if (a === 0) return null
    const round8 = (v: number) => Math.max(0, Math.min(255, Math.round(v / 8) * 8))
    const hex = (v: number) => round8(v).toString(16).padStart(2, '0')
    return `#${hex(r)}${hex(g)}${hex(b)}`
  }

  function clusterCoords(values: number[], tolerance: number): number[] {
    const sorted = values.slice().sort((a, b) => a - b)
    const clusters: { mean: number; values: number[] }[] = []
    for (const v of sorted) {
      const last = clusters[clusters.length - 1]
      if (last && v - last.mean <= tolerance) {
        last.values.push(v)
        last.mean = last.values.reduce((s, x) => s + x, 0) / last.values.length
      } else {
        clusters.push({ mean: v, values: [v] })
      }
    }
    return clusters.map((c) => c.mean)
  }

  function nearestClusterIndex(clusters: number[], v: number): number {
    let best = 0
    let bestDist = Infinity
    for (let i = 0; i < clusters.length; i++) {
      const d = Math.abs(clusters[i] - v)
      if (d < bestDist) {
        bestDist = d
        best = i
      }
    }
    return best
  }

  /** Align `elements` into an N×N grid by bounding-box centre, N = sqrt(count). */
  function layoutGrid(
    elements: Element[],
    readValue: (el: Element) => unknown,
  ): { n: number; grid: unknown[][] } | null {
    const count = elements.length
    const n = Math.round(Math.sqrt(count))
    if (n < MIN_N || n > MAX_N || n * n !== count) return null
    const rects = elements.map((el) => el.getBoundingClientRect())
    const avgSize = rects.reduce((s, r) => s + (r.width + r.height) / 2, 0) / rects.length
    const tol = avgSize * 0.2
    const xs = rects.map((r) => r.left + r.width / 2)
    const ys = rects.map((r) => r.top + r.height / 2)
    const xClusters = clusterCoords(xs, tol)
    const yClusters = clusterCoords(ys, tol)
    if (xClusters.length !== n || yClusters.length !== n) return null
    const grid: unknown[][] = Array.from({ length: n }, () => new Array(n).fill(undefined))
    for (let i = 0; i < elements.length; i++) {
      const col = nearestClusterIndex(xClusters, xs[i])
      const row = nearestClusterIndex(yClusters, ys[i])
      if (grid[row][col] !== undefined) return null // two cells claim the same slot
      grid[row][col] = readValue(elements[i])
    }
    for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) if (grid[r][c] === undefined) return null // a gap
    return { n, grid }
  }

  /** Renumber raw cell labels to 0..n-1 by first appearance; requires exactly n distinct labels. */
  function normalizeLabels(
    grid: unknown[][],
    n: number,
  ): { regions: number[][]; order: string[] } | null {
    const map = new Map<string, number>()
    const regions = grid.map((row) =>
      row.map((v) => {
        const key = String(v)
        let idx = map.get(key)
        if (idx === undefined) {
          idx = map.size
          map.set(key, idx)
        }
        return idx
      }),
    )
    if (map.size !== n) return null
    return { regions, order: [...map.keys()] }
  }

  // 1) An embedded JSON payload containing an N×N array of region labels.
  function tryScriptJson(): RawExtraction | null {
    function search(node: unknown, depth: number): { size: number; regions: number[][] } | null {
      if (depth > 6 || node == null) return null
      if (Array.isArray(node)) {
        const n = node.length
        if (
          n >= MIN_N &&
          n <= MAX_N &&
          node.every(
            (row) =>
              Array.isArray(row) &&
              row.length === n &&
              row.every((v) => typeof v === 'number' || typeof v === 'string'),
          )
        ) {
          const norm = normalizeLabels(node as unknown[][], n)
          if (norm) return { size: n, regions: norm.regions }
        }
        for (const item of node) {
          const r = search(item, depth + 1)
          if (r) return r
        }
        return null
      }
      if (typeof node === 'object') {
        for (const k of Object.keys(node as Record<string, unknown>)) {
          const r = search((node as Record<string, unknown>)[k], depth + 1)
          if (r) return r
        }
      }
      return null
    }
    const scripts = Array.from(document.querySelectorAll('script'))
    for (const s of scripts) {
      const text = s.textContent || ''
      if (!text.trim()) continue
      if (s.type && !/json|javascript|ecmascript/i.test(s.type)) continue
      try {
        const found = search(JSON.parse(text), 0)
        if (found) return { size: found.size, regions: found.regions, method: 'script-json' }
      } catch {
        const matches = text.match(/\[\s*\[[\s\S]*?\]\s*\]/g)
        if (matches) {
          for (const m of matches) {
            try {
              const found = search(JSON.parse(m), 0)
              if (found) return { size: found.size, regions: found.regions, method: 'script-json' }
            } catch {
              /* not JSON, ignore */
            }
          }
        }
      }
    }
    return null
  }

  // 2) Explicit per-cell data attributes.
  function tryDataAttrs(): RawExtraction | null {
    for (const attr of ['data-region', 'data-color', 'data-cell']) {
      const els = Array.from(document.querySelectorAll(`[${attr}]`))
      if (els.length < MIN_N * MIN_N) continue
      const layout = layoutGrid(els, (el) => el.getAttribute(attr))
      if (!layout) continue
      const norm = normalizeLabels(layout.grid, layout.n)
      if (!norm) continue
      return { size: layout.n, regions: norm.regions, method: `data-attr:${attr}` }
    }
    return null
  }

  // 3) Generic heuristic: bucket leaf elements by size, find an N×N grid of
  // distinct background colours.
  function tryColorGrid(): RawExtraction | null {
    const candidates: { el: Element; rect: DOMRect; hex: string }[] = []
    for (const el of Array.from(document.querySelectorAll('*'))) {
      if (el.childElementCount > 0) continue
      const rect = el.getBoundingClientRect()
      if (rect.width * rect.height <= 100) continue
      const hex = normalizeColor(getComputedStyle(el).backgroundColor)
      if (!hex) continue
      candidates.push({ el, rect, hex })
    }
    const buckets = new Map<string, typeof candidates>()
    for (const c of candidates) {
      const key = `${Math.round(c.rect.width)}x${Math.round(c.rect.height)}`
      const b = buckets.get(key)
      if (b) b.push(c)
      else buckets.set(key, [c])
    }
    const bucketList = [...buckets.values()].sort((a, b) => b.length - a.length)
    let bestError: RawExtraction | null = null
    for (const bucket of bucketList) {
      const n = Math.round(Math.sqrt(bucket.length))
      if (n < MIN_N || n > MAX_N || n * n !== bucket.length) continue
      const hexByEl = new Map(bucket.map((c) => [c.el, c.hex] as const))
      const layout = layoutGrid(
        bucket.map((c) => c.el),
        (el) => hexByEl.get(el),
      )
      if (!layout) continue
      const norm = normalizeLabels(layout.grid, layout.n)
      if (!norm) {
        const distinct = new Set(layout.grid.flat()).size
        bestError = {
          size: layout.n,
          error: `found a ${layout.n}x${layout.n} grid of coloured cells but ${distinct} distinct colours (expected ${layout.n})`,
        }
        continue
      }
      return { size: layout.n, regions: norm.regions, colors: norm.order, method: 'color-grid' }
    }
    return bestError
  }

  return tryScriptJson() ?? tryDataAttrs() ?? tryColorGrid() ?? { error: 'no grid found (tried embedded JSON, data attributes, colour heuristic)' }
}
/* c8 ignore stop */

async function extractBoardOnPage(page: Page): Promise<RawExtraction> {
  return page.evaluate(extractBoardInPage)
}

// ---------------------------------------------------------------------------
// Orchestration
// ---------------------------------------------------------------------------

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms))
}

export function buildPuzzle(n: number, extracted: ExtractedBoard, url: string): Puzzle {
  const puzzle: Puzzle = {
    id: `li-${n}`,
    size: extracted.size,
    regions: extracted.regions,
    source: 'linkedin',
    number: n,
    date: dateForNumber(n),
    name: `LinkedIn Queens #${n}`,
    attribution: `scraped from ${url}`,
  }
  if (extracted.colors && extracted.colors.length === extracted.size) puzzle.colors = extracted.colors
  return puzzle
}

export function loadExisting(outFile: string): Puzzle[] {
  if (!existsSync(outFile)) return []
  const raw = readFileSync(outFile, 'utf8').trim()
  if (!raw) return []
  return JSON.parse(raw) as Puzzle[]
}

export function mergeAndWrite(existing: Puzzle[], accepted: Puzzle[], outFile: string): Puzzle[] {
  const byId = new Map(existing.map((p) => [p.id, p]))
  for (const p of accepted) byId.set(p.id, p)
  const merged = [...byId.values()].sort((a, b) => (a.number ?? 0) - (b.number ?? 0))
  mkdirSync(dirname(outFile), { recursive: true })
  writeFileSync(outFile, JSON.stringify(merged))
  return merged
}

export interface Target {
  number: number
  url: string
}

/** Discover numbered same-origin links on `base` using `listSelector` (default "a"). */
export async function discoverTargets(
  page: Page,
  base: string,
  listSelector: string | undefined,
): Promise<Target[]> {
  await page.goto(base, { waitUntil: 'domcontentloaded' })
  const links = await page.evaluate(
    (sel) =>
      Array.from(document.querySelectorAll(sel)).map((a) => ({
        href: a.getAttribute('href') || '',
        text: (a.textContent || '').trim(),
      })),
    listSelector || 'a',
  )
  const baseUrl = new URL(base)
  const found = new Map<number, string>()
  for (const link of links) {
    if (!link.href) continue
    let abs: URL
    try {
      abs = new URL(link.href, baseUrl)
    } catch {
      continue
    }
    if (abs.origin !== baseUrl.origin) continue
    const n = extractNumberFromString(link.text) ?? extractNumberFromString(link.href)
    if (n === null) continue
    if (!found.has(n)) found.set(n, abs.toString())
  }
  console.log(`Discovered ${found.size} numbered link(s) on ${base}`)
  return [...found.entries()]
    .map(([number, url]) => ({ number, url }))
    .sort((a, b) => a.number - b.number)
}

export interface SkipRecord {
  number: number
  url: string
  reason: string
}
export interface FailRecord {
  number: number
  url: string
  reason: string
  screenshot?: string
}

export interface ScrapeSummary {
  accepted: Puzzle[]
  skipped: SkipRecord[]
  failed: FailRecord[]
  merged: Puzzle[]
}

export async function runScrape(opts: ScrapeOptions): Promise<ScrapeSummary> {
  if (!opts.base && !opts.urlTemplate) throw new Error('Provide --base or --url-template (see --help)')
  if (opts.urlTemplate && (opts.from === undefined || opts.to === undefined)) {
    throw new Error('--url-template requires --from and --to')
  }

  const existing = loadExisting(opts.outFile)
  const existingNumbers = new Set(existing.map((p) => p.number).filter((n): n is number => n !== undefined))
  const existingKeys = new Set(existing.map((p) => symmetricCanonicalKey(p.regions)))

  const execPath = process.env.PW_CHROMIUM ?? '/opt/pw-browsers/chromium'
  const browser = await chromium.launch({
    headless: opts.headless,
    ...(existsSync(execPath) ? { executablePath: execPath } : {}),
  })
  const context = await browser.newContext({ userAgent: USER_AGENT })

  const accepted: Puzzle[] = []
  const skipped: SkipRecord[] = []
  const failed: FailRecord[] = []

  try {
    let targets: Target[]
    if (opts.urlTemplate) {
      targets = []
      for (let n = opts.from!; n <= opts.to!; n++) {
        targets.push({ number: n, url: opts.urlTemplate.replace('{n}', String(n)) })
      }
    } else {
      const discoveryPage = await context.newPage()
      targets = await discoverTargets(discoveryPage, opts.base!, opts.listSelector)
      await discoveryPage.close()
      targets = targets.filter(
        (t) => (opts.from === undefined || t.number >= opts.from) && (opts.to === undefined || t.number <= opts.to),
      )
    }

    if (opts.onlyMissing) {
      const before = targets.length
      targets = targets.filter((t) => {
        if (existingNumbers.has(t.number)) {
          skipped.push({ number: t.number, url: t.url, reason: 'already present in output (--only-missing)' })
          return false
        }
        return true
      })
      console.log(`${before - targets.length} number(s) already present, skipped by --only-missing`)
    }

    mkdirSync(opts.shotsDir, { recursive: true })

    for (let i = 0; i < targets.length; i++) {
      const { number, url } = targets[i]
      console.log(`[${i + 1}/${targets.length}] #${number}: ${url}`)
      const page = await context.newPage()
      let shotPath: string | undefined
      try {
        await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30_000 })
        await page.waitForTimeout(150) // let any client-side rendering settle
        shotPath = join(opts.shotsDir, `li-${number}.png`)
        await page.screenshot({ path: shotPath })

        const raw = await extractBoardOnPage(page)
        if (isExtractFailure(raw)) {
          failed.push({ number, url, reason: raw.error, screenshot: shotPath })
          console.log(`  FAILED: ${raw.error} (screenshot: ${shotPath})`)
          continue
        }

        const problems = validateRegions(raw.regions)
        if (problems.length) {
          failed.push({ number, url, reason: problems.join('; '), screenshot: shotPath })
          console.log(`  FAILED: ${problems.join('; ')} (screenshot: ${shotPath})`)
          continue
        }

        const solCount = countSolutions({ size: raw.size, regions: raw.regions }, 2)
        if (solCount !== 1) {
          const reason = solCount === 0 ? 'no solution' : 'multiple solutions'
          failed.push({ number, url, reason, screenshot: shotPath })
          console.log(`  FAILED: ${reason} (screenshot: ${shotPath})`)
          continue
        }

        const key = symmetricCanonicalKey(raw.regions)
        if (existingKeys.has(key)) {
          skipped.push({ number, url, reason: 'duplicate of an existing board layout' })
          console.log(`  SKIPPED: duplicate of an existing board layout`)
          continue
        }

        existingKeys.add(key)
        existingNumbers.add(number)
        accepted.push(buildPuzzle(number, raw, url))
        console.log(`  OK: ${raw.size}x${raw.size} via ${raw.method}`)
      } catch (e) {
        failed.push({ number, url, reason: (e as Error).message, screenshot: shotPath })
        console.log(`  FAILED: ${(e as Error).message}`)
      } finally {
        await page.close()
      }
      if (i < targets.length - 1 && opts.delayMs > 0) await sleep(opts.delayMs)
    }
  } finally {
    await browser.close()
  }

  const merged = mergeAndWrite(existing, accepted, opts.outFile)
  console.log('')
  console.log(
    `Accepted ${accepted.length}, skipped ${skipped.length}, failed ${failed.length}. ` +
      `${opts.outFile} now has ${merged.length} puzzle(s).`,
  )
  if (failed.length) {
    console.log('Failed pages (screenshot saved; transcribe by hand, see docs/scraping.md):')
    for (const f of failed) console.log(`  #${f.number} ${f.url}: ${f.reason}`)
  }
  return { accepted, skipped, failed, merged }
}

const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)
if (isMain) {
  const parsed = parseArgs(process.argv.slice(2))
  if (parsed === 'help') {
    console.log(HELP)
    process.exit(0)
  }
  try {
    await runScrape(parsed)
  } catch (e) {
    console.error(`Error: ${(e as Error).message}`)
    process.exit(1)
  }
  process.exit(0)
}
