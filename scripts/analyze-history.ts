/** Compare archive eras by size before recalibrating a new generator version. */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { analyzeBoards, summarize } from './analyze-patterns.ts'
import type { Puzzle } from '../src/core/types.ts'

export function analyzeHistory() {
  const load = (name: string) => (JSON.parse(readFileSync(new URL(`../src/data/${name}.json`, import.meta.url), 'utf8')) as Puzzle[]).filter(p => p.number !== 336)
  const original = analyzeBoards(load('linkedin-puzzles'))
  const recent = analyzeBoards(load('linkedin-extra'))
  const sizes = [...new Set([...original, ...recent].map(b => b.puzzle.size))].sort((a, b) => a - b)
  const groups = sizes.map(size => ({ size, original: summarize(original.filter(b => b.puzzle.size === size)), recent: summarize(recent.filter(b => b.puzzle.size === size)) }))
  mkdirSync('reports', { recursive: true })
  writeFileSync('reports/history-distribution.json', JSON.stringify({ original: summarize(original), recent: summarize(recent), groups }, null, 2))
  const pct = (n: number) => (100 * n).toFixed(1) + '%'
  const lines = ['# Historical distribution update', '', `${original.length} original boards (excluding #336), ${recent.length} imported boards.`, '', '| Size | Old/new count | Singleton boards old/new | Interior regions old/new | Largest area old/new | Medium old/new |', '|---|---:|---|---|---|---|']
  for (const { size, original: a, recent: b } of groups) {
    if (!b.boards) continue
    lines.push(`| ${size} | ${a.boards}/${b.boards} | ${pct(a.boardsWithSingle)}/${pct(b.boardsWithSingle)} | ${a.interiorRegionsPerBoard.toFixed(2)}/${b.interiorRegionsPerBoard.toFixed(2)} | ${pct(a.largestMean)}/${pct(b.largestMean)} | ${pct(a.difficultyCounts.medium / a.boards)}/${pct(b.difficultyCounts.medium / b.boards)} |`)
  }
  lines.push('', 'These are descriptive era comparisons using the same solver and feature definitions. They are not evidence of a causal change in puzzle design. New-history boards are playable, but the v2 training corpus remains frozen for seed compatibility.', '', 'To experiment with recalibration without changing the app: `npm run benchmark -- --history expanded --count 30 --seeds recalibration-a,recalibration-b --out reports/recalibration.json`.', '', 'That command trains the profile proposals on the expanded training split and evaluates on its holdout. Keep it separate from the original benchmark. A production recalibration should receive a new generator version and a fixed corpus.', '')
  writeFileSync('reports/history-distribution.md', lines.join('\n'))
  console.log(lines.join('\n'))
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) analyzeHistory()
