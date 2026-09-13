import { useMemo, useState } from 'react'
import { encodeRegions, isRegionConnected, normalizeRegions, parseTextGrid, shortHash, validateRegions } from '../core/puzzle'
import { countSolutions } from '../core/solver'
import type { Puzzle } from '../core/types'
import { Board } from './Board'
import { copyToClipboard } from './format'
import { PALETTE, regionColor } from './palette'
import { absoluteUrl, routeToHash } from './routes'
import { saveCustomPuzzle } from './storage'
import { IconPlay, IconShare } from './ui'
import type { ToastKind } from './ui'

interface Props {
  navigate: (hash: string) => void
  toast: (text: string, kind?: ToastKind) => void
}

type Tab = 'paint' | 'text' | 'json'
const SIZES = [7, 8, 9, 10, 11]

function stripedRegions(n: number): number[][] {
  return Array.from({ length: n }, (_, r) => new Array<number>(n).fill(r))
}

interface Validation {
  problems: string[]
  regionCount: number
  disconnected: number[]
  solutions: number | null // null when structurally invalid
}

function validate(regions: number[][]): Validation {
  const n = regions.length
  const problems = validateRegions(regions)
  const present = new Set(regions.flat())
  const disconnected: number[] = []
  for (const g of present) if (g >= 0 && g < n && !isRegionConnected(regions, g)) disconnected.push(g)
  const solutions = problems.length ? null : countSolutions({ size: n, regions }, 2)
  return { problems, regionCount: present.size, disconnected, solutions }
}

export function EditorView({ navigate, toast }: Props) {
  const [tab, setTab] = useState<Tab>('paint')
  const [size, setSize] = useState(8)
  const [regions, setRegions] = useState<number[][]>(() => stripedRegions(8))
  const [brush, setBrush] = useState(0)
  const [name, setName] = useState('')
  const [text, setText] = useState('')
  const [json, setJson] = useState('')

  const validation = useMemo(() => validate(regions), [regions])
  const valid = validation.problems.length === 0 && validation.solutions === 1
  const code = useMemo(() => encodeRegions(regions), [regions])

  const textParsed = useMemo(() => {
    if (!text.trim()) return null
    try {
      const parsed = parseTextGrid(text)
      return { regions: parsed, error: null, validation: validate(parsed) }
    } catch (err) {
      return { regions: null, error: err instanceof Error ? err.message : String(err), validation: null }
    }
  }, [text])

  const paint = (row: number, col: number) => {
    if (regions[row][col] === brush) return
    setRegions((prev) => {
      const next = prev.map((r) => r.slice())
      next[row][col] = brush
      return next
    })
  }

  const changeSize = (n: number) => {
    if (n === size) return
    if (!window.confirm('Changing the size resets the board. Continue?')) return
    setSize(n)
    setRegions(stripedRegions(n))
    setBrush(0)
  }

  const useText = () => {
    if (!textParsed?.regions) return
    const r = textParsed.regions
    setSize(r.length)
    setRegions(r)
    setBrush(0)
    setTab('paint')
    toast('Grid loaded into the editor')
  }

  const save = (): Puzzle | null => {
    if (!valid) return null
    const norm = normalizeRegions(regions)
    const puzzle: Puzzle = {
      id: `custom-${shortHash(encodeRegions(norm))}`,
      size,
      regions: norm,
      source: 'custom',
      name: name.trim() || `Custom ${size}×${size}`,
      colors: PALETTE.slice(0, size),
      date: new Date().toISOString().slice(0, 10),
    }
    if (!saveCustomPuzzle(puzzle)) {
      toast('Could not save (storage unavailable)', 'error')
      return null
    }
    toast(`Saved "${puzzle.name}" to your library`, 'success')
    return puzzle
  }

  const playNow = () => {
    if (!valid) return
    navigate(routeToHash({ view: 'code', code }))
  }

  const share = async () => {
    const ok = await copyToClipboard(absoluteUrl(routeToHash({ view: 'code', code })))
    toast(ok ? 'Share link copied to clipboard' : 'Could not copy the link', ok ? 'success' : 'error')
  }

  const importJson = () => {
    let data: unknown
    try {
      data = JSON.parse(json)
    } catch (err) {
      toast(`Invalid JSON: ${err instanceof Error ? err.message : String(err)}`, 'error')
      return
    }
    const items = Array.isArray(data) ? data : [data]
    let imported = 0
    const errors: string[] = []
    let last: Puzzle | null = null
    items.forEach((item, i) => {
      const label = `Item ${i + 1}`
      if (!item || typeof item !== 'object') {
        errors.push(`${label}: not an object`)
        return
      }
      const obj = item as Record<string, unknown>
      let regs = obj.regions
      if (typeof regs === 'string') {
        try {
          regs = parseTextGrid(regs)
        } catch (err) {
          errors.push(`${label}: ${err instanceof Error ? err.message : String(err)}`)
          return
        }
      }
      if (!Array.isArray(regs) || !regs.every((row) => Array.isArray(row) && row.every((v) => typeof v === 'number'))) {
        errors.push(`${label}: "regions" must be an array of number rows`)
        return
      }
      const r = normalizeRegions(regs as number[][])
      const v = validate(r)
      if (v.problems.length) {
        errors.push(`${label}: ${v.problems.join('; ')}`)
        return
      }
      if (v.solutions !== 1) {
        errors.push(`${label}: ${v.solutions === 0 ? 'no solution' : 'multiple solutions'}`)
        return
      }
      const n = r.length
      const colors = Array.isArray(obj.colors) && obj.colors.every((c) => typeof c === 'string') ? (obj.colors as string[]) : PALETTE.slice(0, n)
      const p: Puzzle = {
        id: `custom-${shortHash(encodeRegions(r))}`,
        size: n,
        regions: r,
        source: 'custom',
        name: typeof obj.name === 'string' && obj.name.trim() ? obj.name : typeof obj.number === 'number' ? `Imported #${obj.number}` : `Imported ${n}×${n}`,
        colors,
        date: typeof obj.date === 'string' ? obj.date : undefined,
        number: typeof obj.number === 'number' ? obj.number : undefined,
      }
      if (saveCustomPuzzle(p)) {
        imported++
        last = p
      } else errors.push(`${label}: could not save`)
    })
    if (imported) toast(`Imported ${imported} puzzle${imported === 1 ? '' : 's'}`, 'success')
    if (errors.length) toast(errors.slice(0, 3).join(' · ') + (errors.length > 3 ? ` · +${errors.length - 3} more` : ''), 'error')
    if (imported === 1 && last) {
      const p: Puzzle = last
      setSize(p.size)
      setRegions(p.regions)
      setTab('paint')
    }
  }

  return (
    <main className="editor">
      <div className="tabs" role="tablist">
        {(['paint', 'text', 'json'] as Tab[]).map((t) => (
          <button key={t} type="button" role="tab" aria-selected={tab === t} className={tab === t ? 'active' : ''} onClick={() => setTab(t)}>
            {t === 'paint' ? 'Paint' : t === 'text' ? 'Text grid' : 'Import JSON'}
          </button>
        ))}
      </div>

      {tab === 'paint' && (
        <>
          <div className="editor-toolbar">
            <label>
              Size
              <select value={size} onChange={(e) => changeSize(Number(e.target.value))}>
                {SIZES.map((s) => (
                  <option key={s} value={s}>
                    {s}×{s}
                  </option>
                ))}
              </select>
            </label>
            <div className="swatches" role="radiogroup" aria-label="Region brush">
              {Array.from({ length: size }, (_, g) => (
                <button
                  key={g}
                  type="button"
                  role="radio"
                  aria-checked={brush === g}
                  aria-label={`Region ${g}`}
                  className={`swatch${brush === g ? ' active' : ''}`}
                  style={{ background: regionColor(undefined, g) }}
                  onClick={() => setBrush(g)}
                >
                  {g}
                </button>
              ))}
            </div>
          </div>
          <div className="board-wrap editor-board">
            <Board
              size={size}
              regions={regions}
              showLabels
              interactive
              onCellDown={paint}
              onCellMove={paint}
              onKeyAction={(r, c) => paint(r, c)}
              ariaLabel="Region editor"
            />
          </div>
        </>
      )}

      {tab === 'text' && (
        <section className="card">
          <p className="muted">One row per line, one character per cell (letters or digits). Spaces or commas between cells are fine.</p>
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            rows={10}
            spellCheck={false}
            placeholder={'AABBB\nAABBB\nCCDDD\nCCDDE\nCCEEE'}
            aria-label="Text grid"
          />
          {textParsed?.error && <p className="problem">{textParsed.error}</p>}
          {textParsed?.validation && <ValidationList v={textParsed.validation} />}
          <div className="actions">
            <button type="button" className="btn primary" onClick={useText} disabled={!textParsed?.regions}>
              Load into editor
            </button>
          </div>
        </section>
      )}

      {tab === 'json' && (
        <section className="card">
          <p className="muted">
            Paste a puzzle object or an array of them, LinkedIn-archive style: <code>{'{"size":8,"regions":[[0,0,…],…],"name":"…"}'}</code>. Valid
            puzzles are saved to your custom library.
          </p>
          <textarea value={json} onChange={(e) => setJson(e.target.value)} rows={10} spellCheck={false} aria-label="Puzzle JSON" />
          <div className="actions">
            <button type="button" className="btn primary" onClick={importJson} disabled={!json.trim()}>
              Import
            </button>
          </div>
        </section>
      )}

      {tab === 'paint' && (
        <section className="card validation">
          <ValidationList v={validation} />
          <label className="name-field">
            Name
            <input type="text" value={name} onChange={(e) => setName(e.target.value)} placeholder={`Custom ${size}×${size}`} />
          </label>
          <div className="actions">
            <button type="button" className="btn primary" onClick={playNow} disabled={!valid}>
              <IconPlay /> Play
            </button>
            <button
              type="button"
              className="btn"
              onClick={() => {
                const p = save()
                if (p) navigate(routeToHash({ view: 'play', id: p.id }))
              }}
              disabled={!valid}
            >
              Save &amp; play
            </button>
            <button type="button" className="btn" onClick={save} disabled={!valid}>
              Save to library
            </button>
            <button type="button" className="btn" onClick={share} disabled={!valid}>
              <IconShare /> Share
            </button>
            <button
              type="button"
              className="btn"
              onClick={() => {
                if (window.confirm('Reset the board?')) setRegions(stripedRegions(size))
              }}
            >
              Reset
            </button>
          </div>
        </section>
      )}
    </main>
  )
}

function ValidationList({ v }: { v: Validation }) {
  const n = v.regionCount
  return (
    <ul className="checks">
      <li className={v.problems.some((p) => p.includes('regions, expected')) ? 'bad' : 'ok'}>
        {n} region{n === 1 ? '' : 's'} painted
      </li>
      <li className={v.disconnected.length ? 'bad' : 'ok'}>
        {v.disconnected.length ? `Not connected: region${v.disconnected.length > 1 ? 's' : ''} ${v.disconnected.join(', ')}` : 'All regions connected'}
      </li>
      {v.problems
        .filter((p) => !p.includes('regions, expected') && !p.includes('not connected'))
        .map((p) => (
          <li key={p} className="bad">
            {p}
          </li>
        ))}
      <li className={v.solutions === 1 ? 'ok' : v.solutions === null ? 'muted' : 'bad'}>
        {v.solutions === null
          ? 'Solutions: fix the problems above first'
          : v.solutions === 0
            ? 'No solution — every row, column and region needs a queen'
            : v.solutions === 1
              ? 'Exactly one solution'
              : '2+ solutions — the puzzle must have a unique answer'}
      </li>
    </ul>
  )
}
