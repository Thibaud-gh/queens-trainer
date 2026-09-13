import { useEffect, useRef, useState } from 'react'
import { randomSeed } from '../core/random'
import type { GeneratorVersion } from '../core/generator'
import type { Puzzle } from '../core/types'
import { Board } from './Board'
import { copyToClipboard } from './format'
import { buildGenerateOptions, generateAsync } from './generateAsync'
import type { DifficultyChoice } from './generateTypes'
import { absoluteUrl, routeToHash } from './routes'
import { IconDice, IconPlay, IconShare, IconSparkles, Spinner } from './ui'
import type { ToastKind } from './ui'

interface Props {
  navigate: (hash: string) => void
  toast: (text: string, kind?: ToastKind) => void
}

const SIZES = [7, 8, 9, 10, 11]
const DIFFICULTIES: { value: DifficultyChoice; label: string }[] = [
  { value: 'any', label: 'Any' },
  { value: 'easy', label: 'Easy' },
  { value: 'medium', label: 'Medium' },
  { value: 'hard', label: 'Hard' },
  { value: 'expert', label: 'Expert' },
]
const MAX_RETRIES = 3

export function GenerateView({ navigate, toast }: Props) {
  const [size, setSize] = useState(8)
  const [seedInput, setSeedInput] = useState('')
  const [difficulty, setDifficulty] = useState<DifficultyChoice>('any')
  const [version, setVersion] = useState<GeneratorVersion>('profile-v3')
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState<{ puzzle: Puzzle; seed: string; size: number; ms: number; version: GeneratorVersion; difficulty: DifficultyChoice } | null>(null)
  const alive = useRef(true)
  useEffect(() => {
    alive.current = true
    return () => {
      alive.current = false
    }
  }, [])

  const generate = async () => {
    setBusy(true)
    let seed = seedInput.trim() || randomSeed()
    const userSeed = seedInput.trim().length > 0
    for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
      const t0 = performance.now()
      try {
        const puzzle = await generateAsync(buildGenerateOptions(size, seed, difficulty, version))
        if (!alive.current) return
        setResult({ puzzle, seed, size, ms: performance.now() - t0, version, difficulty })
        setBusy(false)
        return
      } catch (err) {
        if (!alive.current) return
        const msg = err instanceof Error ? err.message : String(err)
        if (userSeed || attempt === MAX_RETRIES - 1) {
          toast(msg, 'error')
          setBusy(false)
          return
        }
        toast(`${msg} — retrying with a new seed`, 'error')
        seed = randomSeed()
      }
    }
    setBusy(false)
  }

  const shareHash = result ? routeToHash({ view: 'gen', size: result.size, seed: result.seed, version: result.version, difficulty: result.difficulty }) : ''

  const copyLink = async () => {
    if (!result) return
    toast((await copyToClipboard(absoluteUrl(shareHash))) ? 'Link copied to clipboard' : 'Could not copy the link', 'success')
  }

  return (
    <main className="generate">
      <section className="card">
        <h2>Generate a puzzle</h2>
        <div className="form-grid">
          <label>
            Generator
            <select value={version} onChange={(e) => setVersion(e.target.value as GeneratorVersion)} disabled={busy}>
              <option value="profile-v3">Recent history · fewer single cells</option>
              <option value="profile-v2">Historical profiles (v2)</option>
              <option value="legacy">Original generator</option>
            </select>
          </label>
          <label>
            Size
            <select value={size} onChange={(e) => setSize(Number(e.target.value))} disabled={busy}>
              {SIZES.map((s) => (
                <option key={s} value={s}>
                  {s}×{s}
                </option>
              ))}
            </select>
          </label>
          <label>
            Difficulty
            <select value={difficulty} onChange={(e) => setDifficulty(e.target.value as DifficultyChoice)} disabled={busy}>
              {DIFFICULTIES.map((d) => (
                <option key={d.value} value={d.value}>
                  {d.label}
                </option>
              ))}
            </select>
          </label>
          <label className="span2">
            Seed <span className="muted">(optional — same seed and settings, same puzzle)</span>
            <input type="text" value={seedInput} onChange={(e) => setSeedInput(e.target.value)} placeholder="random" disabled={busy} spellCheck={false} />
          </label>
        </div>
        <p className="muted">Difficulty reflects the hardest solving technique, not expected solving time.</p>
        <div className="actions">
          <button type="button" className="btn primary" onClick={generate} disabled={busy}>
            {busy ? <Spinner label="Generating…" /> : (
              <>
                <IconSparkles /> Generate
              </>
            )}
          </button>
        </div>
      </section>

      {result && (
        <section className="card result">
          <div className="preview">
            <Board size={result.puzzle.size} regions={result.puzzle.regions} colors={result.puzzle.colors} />
          </div>
          <div className="result-text">
            <h3>{result.puzzle.name ?? `Generated ${result.size}×${result.size}`}</h3>
            <p className="muted">
              Seed <code>{result.seed}</code> · {result.puzzle.difficulty ?? 'unrated'} · {Math.round(result.ms)} ms
            </p>
            {result.difficulty !== 'any' && result.puzzle.difficulty !== result.difficulty && (
              <p className="muted">Requested {result.difficulty}; the closest puzzle found is rated {result.puzzle.difficulty}.</p>
            )}
            <p className="share-link">
              <code>{absoluteUrl(shareHash)}</code>
            </p>
            <div className="actions">
              <button type="button" className="btn primary" onClick={() => navigate(shareHash)}>
                <IconPlay /> Play
              </button>
              <button type="button" className="btn" onClick={copyLink}>
                <IconShare /> Copy link
              </button>
              <button type="button" className="btn" onClick={generate} disabled={busy}>
                <IconDice /> Another
              </button>
            </div>
          </div>
        </section>
      )}
    </main>
  )
}
