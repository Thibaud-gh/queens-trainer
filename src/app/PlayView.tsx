import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react'
import { randomSeed } from '../core/random'
import { solve } from '../core/solver'
import type { Puzzle } from '../core/types'
import { Board, type KeyAction } from './Board'
import { formatTime, copyToClipboard } from './format'
import { computeConflicts, createGameState, gameReducer, toSavedGame } from './gameState'
import { LINKEDIN_PUZZLES, nextLinkedIn, puzzleSubtitle, puzzleTitle, shareCode } from './puzzles'
import { absoluteUrl, routeToHash } from './routes'
import { loadProgress, loadProgressMap, recordSolve, saveProgress, type Settings } from './storage'
import { IconBulb, IconButton, IconCheck, IconGear, IconRedo, IconShare, IconTrash, IconUndo } from './ui'
import type { ToastKind } from './ui'

interface Props {
  puzzle: Puzzle
  /** The hash that produced this puzzle (used for "Next" on generated boards). */
  route: { view: 'gen'; size: number; seed: string } | { view: 'play' | 'code' }
  settings: Settings
  onSettingsChange: (patch: Partial<Settings>) => void
  navigate: (hash: string) => void
  toast: (text: string, kind?: ToastKind) => void
  openSettings: () => void
}

interface Result {
  ms: number
  hints: number
  bestMs: number
  newBest: boolean
}

export function PlayView({ puzzle, route, settings, onSettingsChange, navigate, toast, openSettings }: Props) {
  const saved = useMemo(() => loadProgress(puzzle.id), [puzzle.id])
  const [state, dispatch] = useReducer(gameReducer, undefined, () =>
    createGameState(puzzle, { autoXEnabled: settings.autoX, saved: saved?.game ?? null }),
  )
  const solution = useMemo(() => solve(puzzle, 2)[0] ?? null, [puzzle])
  const conflicts = useMemo(() => (settings.showConflicts ? computeConflicts(puzzle, state.board) : null), [puzzle, state.board, settings.showConflicts])

  /* ----- timer -------------------------------------------------------- */
  const initialElapsed = saved?.game ? saved.elapsedMs : 0
  const elapsedRef = useRef(initialElapsed)
  const runningSince = useRef<number | null>(null)
  const [elapsed, setElapsed] = useState(initialElapsed)
  const running = state.started && !state.solved
  const currentElapsed = useCallback(
    () => elapsedRef.current + (runningSince.current == null ? 0 : performance.now() - runningSince.current),
    [],
  )

  useEffect(() => {
    if (!running) return
    const start = () => {
      if (runningSince.current == null) runningSince.current = performance.now()
    }
    const stop = () => {
      if (runningSince.current == null) return
      elapsedRef.current += performance.now() - runningSince.current
      runningSince.current = null
      setElapsed(elapsedRef.current)
      saveProgress(puzzle.id, { elapsedMs: elapsedRef.current })
    }
    const onVisibility = () => (document.visibilityState === 'visible' ? start() : stop())
    if (document.visibilityState === 'visible') start()
    const id = setInterval(() => {
      if (runningSince.current != null) setElapsed(elapsedRef.current + performance.now() - runningSince.current)
    }, 250)
    document.addEventListener('visibilitychange', onVisibility)
    return () => {
      clearInterval(id)
      document.removeEventListener('visibilitychange', onVisibility)
      stop()
    }
  }, [running, puzzle.id])

  /* ----- persistence -------------------------------------------------- */
  useEffect(() => {
    dispatch({ type: 'setAutoX', enabled: settings.autoX })
  }, [settings.autoX])

  const { board, autoX, hintsUsed, started, solved } = state
  useEffect(() => {
    if (!started || solved) return
    saveProgress(puzzle.id, { game: toSavedGame({ board, autoX, hintsUsed }), elapsedMs: currentElapsed() })
  }, [board, autoX, hintsUsed, started, solved, puzzle.id, currentElapsed])

  // Best time before this attempt; refreshed by "Play again" so a second solve compares correctly.
  const [prevBest, setPrevBest] = useState<number | undefined>(() => saved?.bestMs)
  const recorded = useRef(false)
  useEffect(() => {
    if (!solved || recorded.current) return
    recorded.current = true
    recordSolve(puzzle.id, elapsedRef.current)
  }, [solved, puzzle.id])

  // Once solved, the timer effect's cleanup has flushed the final time into `elapsed`.
  const result: Result | null = solved
    ? {
        ms: elapsed,
        hints: hintsUsed,
        bestMs: prevBest === undefined ? elapsed : Math.min(prevBest, elapsed),
        newBest: prevBest === undefined || elapsed < prevBest,
      }
    : null

  /* ----- haptics ------------------------------------------------------ */
  useEffect(() => {
    if (state.queenPlacements === 0 || !settings.haptics) return
    try {
      navigator.vibrate?.(12)
    } catch {
      /* ignore */
    }
  }, [state.queenPlacements, settings.haptics])

  /* ----- actions ------------------------------------------------------ */
  const onKeyAction = (row: number, col: number, action: KeyAction) => {
    if (state.solved) return
    const current = state.board[row][col]
    if (action === 'cycle') dispatch({ type: 'tap', row, col })
    else if (action === 'empty') dispatch({ type: 'setMark', row, col, mark: 'empty' })
    else dispatch({ type: 'setMark', row, col, mark: current === action ? 'empty' : action })
  }

  const clear = () => {
    if (state.board.every((r) => r.every((m) => m === 'empty'))) return
    if (window.confirm('Clear the board? You can undo this.')) dispatch({ type: 'clear' })
  }

  const hint = () => {
    if (!solution) {
      toast('No unique solution is available for this puzzle', 'error')
      return
    }
    dispatch({ type: 'hint', solution })
  }

  const share = async () => {
    const url = absoluteUrl(routeToHash({ view: 'code', code: shareCode(puzzle) }))
    toast((await copyToClipboard(url)) ? 'Share link copied to clipboard' : 'Could not copy the link', 'success')
  }

  const playAgain = () => {
    elapsedRef.current = 0
    runningSince.current = null
    setElapsed(0)
    setPrevBest(loadProgress(puzzle.id)?.bestMs)
    recorded.current = false
    dispatch({ type: 'reset' })
  }

  const nextHash = (): string => {
    if (route.view === 'gen') return routeToHash({ view: 'gen', size: route.size, seed: randomSeed() })
    if (puzzle.source === 'linkedin') {
      const next = nextLinkedIn(puzzle.id)
      if (next) return routeToHash({ view: 'play', id: next.id })
    }
    const progress = loadProgressMap()
    const unsolved = LINKEDIN_PUZZLES.filter((p) => !progress[p.id]?.solved)
    const pool = unsolved.length ? unsolved : LINKEDIN_PUZZLES
    const pick = pool[Math.floor(Math.random() * pool.length)]
    return routeToHash({ view: 'play', id: pick.id })
  }

  const locked = state.solved
  const title = puzzleTitle(puzzle)

  return (
    <>
      <header className="topbar">
        <div className="topbar-text">
          <h1 className="app-title">Queens Trainer</h1>
          <div className="puzzle-meta">
            <span className="puzzle-name">{title}</span>
            <span className="puzzle-sub">{puzzleSubtitle(puzzle)}</span>
          </div>
        </div>
        <div className="topbar-right">
          {settings.showTimer && (
            <span className={`timer${state.solved ? ' done' : ''}`} aria-label="Elapsed time">
              {formatTime(elapsed)}
            </span>
          )}
          <button type="button" className="iconbtn plain" aria-label="Share puzzle" title="Share puzzle" onClick={share}>
            <IconShare />
          </button>
          <button type="button" className="iconbtn plain" aria-label="Settings" title="Settings" onClick={openSettings}>
            <IconGear />
          </button>
        </div>
      </header>

      <main className="play">
        <div className={`board-wrap${locked ? ' locked' : ''}`}>
          <Board
            size={puzzle.size}
            regions={puzzle.regions}
            colors={puzzle.colors}
            marks={state.board}
            autoX={state.autoX}
            conflicts={conflicts}
            interactive={!locked}
            onCellDown={(row, col) => dispatch({ type: 'dragStart', row, col })}
            onCellMove={(row, col) => dispatch({ type: 'dragMove', row, col })}
            onPointerEnd={() => dispatch({ type: 'dragEnd' })}
            onKeyAction={onKeyAction}
            ariaLabel={`${title}, ${puzzle.size} by ${puzzle.size} board`}
          />
        </div>

        {state.solved && result && (
          <section className="success" role="status" aria-live="polite">
            <h2>Solved!</h2>
            <p className="success-stats">
              <span>
                Time <strong>{formatTime(result.ms)}</strong>
              </span>
              <span>
                Hints <strong>{result.hints}</strong>
              </span>
              <span>
                Best <strong>{formatTime(result.bestMs)}</strong>
                {result.newBest && <em className="badge">new</em>}
              </span>
            </p>
            <div className="success-actions">
              <button type="button" className="btn primary" onClick={() => navigate(nextHash())}>
                Next puzzle
              </button>
              <button type="button" className="btn" onClick={playAgain}>
                Play again
              </button>
              <button type="button" className="btn" onClick={share}>
                Share
              </button>
            </div>
          </section>
        )}

        <div className="controls" role="toolbar" aria-label="Board controls">
          <IconButton label="Undo" onClick={() => dispatch({ type: 'undo' })} disabled={!state.past.length}>
            <IconUndo />
          </IconButton>
          <IconButton label="Redo" onClick={() => dispatch({ type: 'redo' })} disabled={!state.future.length}>
            <IconRedo />
          </IconButton>
          <IconButton label="Clear" onClick={clear} disabled={locked}>
            <IconTrash />
          </IconButton>
          <IconButton label={state.hintsUsed ? `Hint (${state.hintsUsed})` : 'Hint'} onClick={hint} disabled={locked}>
            <IconBulb />
          </IconButton>
          <IconButton label="Check" pressed={settings.showConflicts} onClick={() => onSettingsChange({ showConflicts: !settings.showConflicts })}>
            <IconCheck />
          </IconButton>
        </div>
        <p className="help">Tap: empty → × → queen. Drag to cross out many cells. Keyboard: arrows, Space, X, Q.</p>
      </main>
    </>
  )
}
