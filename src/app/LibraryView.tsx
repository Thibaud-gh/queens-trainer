import { useMemo, useState } from 'react'
import type { Puzzle } from '../core/types'
import { formatTime } from './format'
import { LINKEDIN_PUZZLES, dailyNumber, findLinkedInByNumber, formatDate, latestLinkedIn, puzzleTitle } from './puzzles'
import { routeToHash } from './routes'
import { deleteCustomPuzzle, loadCustomPuzzles, loadProgressMap, type ProgressMap } from './storage'
import { IconDice, IconTick, IconTrash } from './ui'
import type { ToastKind } from './ui'

interface Props {
  navigate: (hash: string) => void
  toast: (text: string, kind?: ToastKind) => void
}

type StatusFilter = 'all' | 'unsolved' | 'solved'
type Tab = 'linkedin' | 'custom'

const SIZES = [7, 8, 9, 10, 11]

export function LibraryView({ navigate, toast }: Props) {
  const [progress, setProgress] = useState<ProgressMap>(() => loadProgressMap())
  const [custom, setCustom] = useState<Puzzle[]>(() => loadCustomPuzzles())
  const [tab, setTab] = useState<Tab>('linkedin')
  const [size, setSize] = useState<number | 'all'>('all')
  const [status, setStatus] = useState<StatusFilter>('all')
  const [query, setQuery] = useState('')

  const daily = useMemo(() => {
    const n = dailyNumber()
    return { number: n, puzzle: findLinkedInByNumber(n) }
  }, [])

  const source = tab === 'linkedin' ? LINKEDIN_PUZZLES : custom
  const filtered = useMemo(() => {
    const q = query.trim().replace(/^#/, '')
    return source.filter((p) => {
      if (size !== 'all' && p.size !== size) return false
      const solved = progress[p.id]?.solved ?? false
      if (status === 'solved' && !solved) return false
      if (status === 'unsolved' && solved) return false
      if (q) {
        const num = p.number != null ? String(p.number) : ''
        const hay = `${num} ${p.name ?? ''} ${p.date ?? ''}`.toLowerCase()
        if (/^\d+$/.test(q)) return num === q || num.startsWith(q)
        return hay.includes(q.toLowerCase())
      }
      return true
    })
  }, [source, size, status, query, progress])

  const solvedCount = useMemo(() => source.filter((p) => progress[p.id]?.solved).length, [source, progress])

  const randomUnsolved = () => {
    const pool = source.filter((p) => !progress[p.id]?.solved && (size === 'all' || p.size === size))
    if (!pool.length) {
      toast('Everything here is solved — nice!', 'success')
      return
    }
    const pick = pool[Math.floor(Math.random() * pool.length)]
    navigate(routeToHash({ view: 'play', id: pick.id }))
  }

  const removeCustom = (p: Puzzle) => {
    if (!window.confirm(`Delete "${puzzleTitle(p)}" from your custom puzzles?`)) return
    deleteCustomPuzzle(p.id)
    setCustom(loadCustomPuzzles())
    setProgress(loadProgressMap())
  }

  const latest = latestLinkedIn()

  return (
    <main className="library">
      <section className="card daily">
        <div className="daily-text">
          <h2>Today's LinkedIn Queens</h2>
          {daily.puzzle ? (
            <p>
              #{daily.number} · {daily.puzzle.size}×{daily.puzzle.size}
              {progress[daily.puzzle.id]?.solved && <span className="tag solved">Solved</span>}
            </p>
          ) : (
            <p>
              Today's puzzle would be #{daily.number}, but it isn't in the archive
              {latest ? ` (latest is #${latest.number}, ${latest.date ? formatDate(latest.date) : ''})` : ''}.
            </p>
          )}
        </div>
        {daily.puzzle ? (
          <button type="button" className="btn primary" onClick={() => navigate(routeToHash({ view: 'play', id: daily.puzzle!.id }))}>
            Play daily
          </button>
        ) : latest ? (
          <button type="button" className="btn" onClick={() => navigate(routeToHash({ view: 'play', id: latest.id }))}>
            Play latest
          </button>
        ) : null}
      </section>

      <div className="tabs" role="tablist">
        <button type="button" role="tab" aria-selected={tab === 'linkedin'} className={tab === 'linkedin' ? 'active' : ''} onClick={() => setTab('linkedin')}>
          LinkedIn <span className="count">{LINKEDIN_PUZZLES.length}</span>
        </button>
        <button type="button" role="tab" aria-selected={tab === 'custom'} className={tab === 'custom' ? 'active' : ''} onClick={() => setTab('custom')}>
          Custom <span className="count">{custom.length}</span>
        </button>
      </div>

      <div className="filters">
        <input
          type="search"
          inputMode="numeric"
          placeholder={tab === 'linkedin' ? 'Search by number' : 'Search by name'}
          aria-label="Search puzzles"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <select aria-label="Filter by size" value={size} onChange={(e) => setSize(e.target.value === 'all' ? 'all' : Number(e.target.value))}>
          <option value="all">Any size</option>
          {SIZES.map((s) => (
            <option key={s} value={s}>
              {s}×{s}
            </option>
          ))}
        </select>
        <select aria-label="Filter by status" value={status} onChange={(e) => setStatus(e.target.value as StatusFilter)}>
          <option value="all">All</option>
          <option value="unsolved">Unsolved</option>
          <option value="solved">Solved</option>
        </select>
        <button type="button" className="btn" onClick={randomUnsolved}>
          <IconDice /> Random unsolved
        </button>
      </div>

      <p className="summary">
        {filtered.length} puzzle{filtered.length === 1 ? '' : 's'} · {solvedCount}/{source.length} solved
      </p>

      {tab === 'custom' && !custom.length && (
        <p className="empty">
          No custom puzzles yet.{' '}
          <button type="button" className="link" onClick={() => navigate(routeToHash({ view: 'editor' }))}>
            Create one in the editor
          </button>
          .
        </p>
      )}

      <ul className="puzzle-list">
        {filtered.map((p) => {
          const pr = progress[p.id]
          const inProgress = !!pr?.game && !pr.solved
          return (
            <li key={p.id} className={pr?.solved ? 'solved' : ''}>
              <button type="button" className="puzzle-row" onClick={() => navigate(routeToHash({ view: 'play', id: p.id }))}>
                <span className={`status-dot${pr?.solved ? ' ok' : inProgress ? ' progress' : ''}`} aria-hidden="true">
                  {pr?.solved && <IconTick />}
                </span>
                <span className="row-main">
                  <span className="row-title">{tab === 'linkedin' && p.number != null ? `#${p.number}` : puzzleTitle(p)}</span>
                  <span className="row-sub">
                    {p.date ? formatDate(p.date) : p.source === 'custom' ? 'Custom' : ''}
                    {inProgress && ' · in progress'}
                  </span>
                </span>
                <span className="row-size">
                  {p.size}×{p.size}
                </span>
                <span className="row-best">{pr?.bestMs !== undefined ? formatTime(pr.bestMs) : '—'}</span>
              </button>
              {tab === 'custom' && (
                <button type="button" className="iconbtn plain small" aria-label={`Delete ${puzzleTitle(p)}`} onClick={() => removeCustom(p)}>
                  <IconTrash />
                </button>
              )}
            </li>
          )
        })}
      </ul>
    </main>
  )
}
