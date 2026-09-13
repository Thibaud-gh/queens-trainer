import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import type { Puzzle } from '../core/types'
import { EditorView } from './EditorView'
import { GenerateView } from './GenerateView'
import { buildGenerateOptions, generateAsync } from './generateAsync'
import { LibraryView } from './LibraryView'
import { PlayView } from './PlayView'
import { dailyNumber, findLinkedInByNumber, findPuzzleById, puzzleFromCode } from './puzzles'
import { isPlayRoute, parseHash, routeToHash } from './routes'
import { SettingsDialog } from './SettingsDialog'
import { loadLastPlayed, loadSettings, saveLastPlayed, saveSettings, type Settings } from './storage'
import { IconGear, IconLibrary, IconPencil, IconPlay, IconSparkles, Spinner, Toasts, type ToastKind, type ToastMessage } from './ui'

type PuzzleLoad =
  | { status: 'loading'; hash: string }
  | { status: 'ready'; hash: string; puzzle: Puzzle }
  | { status: 'error'; hash: string; message: string }

export function App() {
  const [hash, setHash] = useState(() => (typeof location !== 'undefined' ? location.hash : ''))
  useEffect(() => {
    const onChange = () => setHash(location.hash)
    window.addEventListener('hashchange', onChange)
    return () => window.removeEventListener('hashchange', onChange)
  }, [])
  const route = useMemo(() => parseHash(hash), [hash])

  const navigate = useCallback((h: string) => {
    if (location.hash === h) setHash(h)
    else location.hash = h
  }, [])

  /* ----- settings + theme --------------------------------------------- */
  const [settings, setSettings] = useState<Settings>(loadSettings)
  const updateSettings = useCallback((patch: Partial<Settings>) => setSettings((s) => ({ ...s, ...patch })), [])
  useEffect(() => {
    saveSettings(settings)
    const root = document.documentElement
    if (settings.theme === 'system') root.removeAttribute('data-theme')
    else root.setAttribute('data-theme', settings.theme)
  }, [settings])
  const [settingsOpen, setSettingsOpen] = useState(false)
  const closeSettings = useCallback(() => setSettingsOpen(false), [])
  const openSettings = useCallback(() => setSettingsOpen(true), [])

  /* ----- toasts ------------------------------------------------------- */
  const [toasts, setToasts] = useState<ToastMessage[]>([])
  const toastId = useRef(0)
  const toast = useCallback((text: string, kind: ToastKind = 'info') => {
    const id = ++toastId.current
    setToasts((t) => [...t, { id, text, kind }])
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), kind === 'error' ? 5000 : 3000)
  }, [])

  /* ----- puzzle resolution -------------------------------------------- */
  // Archive, custom and code puzzles resolve synchronously during render.
  const syncLoad = useMemo<PuzzleLoad | null>(() => {
    if (route.view === 'play') {
      const p = findPuzzleById(route.id)
      return p ? { status: 'ready', hash, puzzle: p } : { status: 'error', hash, message: `Puzzle "${route.id}" was not found.` }
    }
    if (route.view === 'code') {
      try {
        return { status: 'ready', hash, puzzle: puzzleFromCode(route.code) }
      } catch (err) {
        return { status: 'error', hash, message: err instanceof Error ? err.message : String(err) }
      }
    }
    return null
  }, [route, hash])

  // Generated puzzles are produced asynchronously (worker / deferred).
  const [genLoad, setGenLoad] = useState<PuzzleLoad | null>(null)
  useEffect(() => {
    if (route.view !== 'gen') return
    let cancelled = false
    const target = hash
    generateAsync(buildGenerateOptions(route.size, route.seed, route.difficulty ?? 'any', route.version ?? 'legacy'))
      .then((puzzle) => {
        if (!cancelled) setGenLoad({ status: 'ready', hash: target, puzzle })
      })
      .catch((err: unknown) => {
        if (!cancelled) setGenLoad({ status: 'error', hash: target, message: err instanceof Error ? err.message : String(err) })
      })
    return () => {
      cancelled = true
    }
  }, [route, hash])

  const load: PuzzleLoad | null =
    route.view === 'gen' ? (genLoad && genLoad.hash === hash ? genLoad : { status: 'loading', hash }) : syncLoad

  // Remember the last successfully opened puzzle so "Play" and "#/" return to it.
  const readyHash = load?.status === 'ready' ? load.hash : null
  useEffect(() => {
    if (readyHash) saveLastPlayed(readyHash)
  }, [readyHash])

  // "#/" goes to the last played puzzle, else today's puzzle, else #1.
  useEffect(() => {
    if (route.view !== 'home') return
    const daily = findLinkedInByNumber(dailyNumber())
    const target = loadLastPlayed() ?? routeToHash({ view: 'play', id: daily ? daily.id : 'li-1' })
    location.replace(target)
  }, [route])

  const inPlay = isPlayRoute(route)
  const playHash = inPlay ? hash : (loadLastPlayed() ?? '#/')

  let content: ReactNode
  if (inPlay) {
    if (load?.status === 'ready') {
      content = (
        <PlayView
          key={`${load.puzzle.id}:${hash}`}
          puzzle={load.puzzle}
          route={route.view === 'gen' ? route : { view: route.view === 'code' ? 'code' : 'play' }}
          settings={settings}
          onSettingsChange={updateSettings}
          navigate={navigate}
          toast={toast}
          openSettings={openSettings}
        />
      )
    } else {
      content = (
        <>
          <TopBar title="Queens Trainer" onSettings={openSettings} />
          <main className="centered">
            {load?.status === 'error' ? (
              <div className="card error-card">
                <h2>Can't open this puzzle</h2>
                <p>{load.message}</p>
                <div className="actions">
                  <button type="button" className="btn primary" onClick={() => navigate('#/library')}>
                    Open library
                  </button>
                </div>
              </div>
            ) : (
              <Spinner label={route.view === 'gen' ? `Generating a ${route.size}×${route.size} puzzle…` : 'Loading…'} />
            )}
          </main>
        </>
      )
    }
  } else if (route.view === 'library') {
    content = (
      <>
        <TopBar title="Library" onSettings={openSettings} />
        <LibraryView navigate={navigate} toast={toast} />
      </>
    )
  } else if (route.view === 'generate') {
    content = (
      <>
        <TopBar title="Generate" onSettings={openSettings} />
        <GenerateView navigate={navigate} toast={toast} />
      </>
    )
  } else {
    content = (
      <>
        <TopBar title="Editor" onSettings={openSettings} />
        <EditorView navigate={navigate} toast={toast} />
      </>
    )
  }

  return (
    <div className="app" data-view={inPlay ? 'play' : route.view}>
      {content}
      <nav className="bottomnav" aria-label="Main">
        <NavItem label="Play" active={inPlay} onClick={() => navigate(playHash)} icon={<IconPlay />} />
        <NavItem label="Library" active={route.view === 'library'} onClick={() => navigate('#/library')} icon={<IconLibrary />} />
        <NavItem label="Generate" active={route.view === 'generate'} onClick={() => navigate('#/generate')} icon={<IconSparkles />} />
        <NavItem label="Editor" active={route.view === 'editor'} onClick={() => navigate('#/editor')} icon={<IconPencil />} />
      </nav>
      {settingsOpen && <SettingsDialog settings={settings} onChange={updateSettings} onClose={closeSettings} />}
      <Toasts toasts={toasts} />
    </div>
  )
}

function NavItem({ label, active, onClick, icon }: { label: string; active: boolean; onClick: () => void; icon: ReactNode }) {
  return (
    <button type="button" className={`nav-item${active ? ' active' : ''}`} aria-current={active ? 'page' : undefined} onClick={onClick}>
      {icon}
      <span>{label}</span>
    </button>
  )
}

function TopBar({ title, onSettings }: { title: string; onSettings: () => void }) {
  return (
    <header className="topbar">
      <div className="topbar-text">
        <h1 className="app-title">Queens Trainer</h1>
        <div className="puzzle-meta">
          <span className="puzzle-name">{title}</span>
        </div>
      </div>
      <div className="topbar-right">
        <button type="button" className="iconbtn plain" aria-label="Settings" title="Settings" onClick={onSettings}>
          <IconGear />
        </button>
      </div>
    </header>
  )
}
