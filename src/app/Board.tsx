import { useCallback, useMemo, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react'
import type { Board as Marks } from '../core/types'
import type { AutoXMap, Conflicts } from './gameState'
import { regionColor } from './palette'

export type KeyAction = 'cycle' | 'x' | 'queen' | 'empty'

export interface BoardProps {
  size: number
  regions: number[][]
  colors?: readonly string[]
  /** Cell marks; defaults to an empty board (e.g. previews and the editor). */
  marks?: Marks
  /** Auto-placed x marks are drawn slightly lighter. */
  autoX?: AutoXMap
  /** Conflict highlighting; pass null/undefined to hide. */
  conflicts?: Conflicts | null
  /** Print the region index in each cell (editor). */
  showLabels?: boolean
  /** Enables pointer and keyboard handling. */
  interactive?: boolean
  onCellDown?: (row: number, col: number) => void
  onCellMove?: (row: number, col: number) => void
  onPointerEnd?: () => void
  onKeyAction?: (row: number, col: number, action: KeyAction) => void
  className?: string
  ariaLabel?: string
}

const MARK_LABEL = { empty: 'empty', x: 'crossed out', queen: 'queen' } as const

export function Board({
  size,
  regions,
  colors,
  marks,
  autoX,
  conflicts,
  showLabels,
  interactive,
  onCellDown,
  onCellMove,
  onPointerEnd,
  onKeyAction,
  className,
  ariaLabel,
}: BoardProps) {
  const ref = useRef<HTMLDivElement>(null)
  const pointerId = useRef<number | null>(null)
  const lastKey = useRef(-1)
  const [focus, setFocus] = useState<{ row: number; col: number }>({ row: 0, col: 0 })
  const [hasFocus, setHasFocus] = useState(false)

  const borders = useMemo(() => buildBorderPaths(size, regions), [size, regions])

  const cellAt = useCallback(
    (e: { clientX: number; clientY: number }): { row: number; col: number } | null => {
      const el = ref.current
      if (!el) return null
      const rect = el.getBoundingClientRect()
      if (rect.width <= 0 || rect.height <= 0) return null
      const col = Math.floor(((e.clientX - rect.left) / rect.width) * size)
      const row = Math.floor(((e.clientY - rect.top) / rect.height) * size)
      if (row < 0 || col < 0 || row >= size || col >= size) return null
      return { row, col }
    },
    [size],
  )

  const handleDown = (e: PointerEvent<HTMLDivElement>) => {
    if (!interactive) return
    if (e.pointerType === 'mouse' && e.button !== 0) return
    const cell = cellAt(e)
    if (!cell) return
    e.preventDefault()
    pointerId.current = e.pointerId
    lastKey.current = cell.row * size + cell.col
    try {
      ref.current?.setPointerCapture(e.pointerId)
    } catch {
      /* capture is best effort */
    }
    setFocus(cell)
    onCellDown?.(cell.row, cell.col)
  }

  const handleMove = (e: PointerEvent<HTMLDivElement>) => {
    if (!interactive || pointerId.current !== e.pointerId) return
    e.preventDefault()
    const cell = cellAt(e)
    if (!cell) return
    const key = cell.row * size + cell.col
    if (key === lastKey.current) return
    lastKey.current = key
    onCellMove?.(cell.row, cell.col)
  }

  const handleUp = (e: PointerEvent<HTMLDivElement>) => {
    if (!interactive || pointerId.current !== e.pointerId) return
    pointerId.current = null
    lastKey.current = -1
    try {
      ref.current?.releasePointerCapture(e.pointerId)
    } catch {
      /* ignore */
    }
    onPointerEnd?.()
  }

  const handleKey = (e: KeyboardEvent<HTMLDivElement>) => {
    if (!interactive) return
    const { row, col } = focus
    const move = (dr: number, dc: number) => {
      e.preventDefault()
      setFocus({ row: (row + dr + size) % size, col: (col + dc + size) % size })
    }
    switch (e.key) {
      case 'ArrowUp':
        return move(-1, 0)
      case 'ArrowDown':
        return move(1, 0)
      case 'ArrowLeft':
        return move(0, -1)
      case 'ArrowRight':
        return move(0, 1)
      case 'Home':
        e.preventDefault()
        return setFocus({ row, col: 0 })
      case 'End':
        e.preventDefault()
        return setFocus({ row, col: size - 1 })
      case ' ':
      case 'Enter':
        e.preventDefault()
        return onKeyAction?.(row, col, 'cycle')
      case 'x':
      case 'X':
        e.preventDefault()
        return onKeyAction?.(row, col, 'x')
      case 'q':
      case 'Q':
        e.preventDefault()
        return onKeyAction?.(row, col, 'queen')
      case 'Backspace':
      case 'Delete':
        e.preventDefault()
        return onKeyAction?.(row, col, 'empty')
      default:
        return
    }
  }

  const cells = []
  for (let r = 0; r < size; r++) {
    for (let c = 0; c < size; c++) {
      const key = r * size + c
      const g = regions[r]?.[c] ?? 0
      const mark = marks?.[r]?.[c] ?? 'empty'
      const isConflict = conflicts?.queens.has(key) ?? false
      const warn = conflicts ? conflicts.rows.has(r) || conflicts.cols.has(c) || conflicts.regions.has(g) : false
      const isAuto = mark === 'x' && autoX?.[key] !== undefined
      const focused = interactive && hasFocus && focus.row === r && focus.col === c
      const cls =
        'cell' +
        (mark === 'queen' ? ' has-queen' : mark === 'x' ? ' has-x' : '') +
        (isAuto ? ' auto' : '') +
        (isConflict ? ' conflict' : '') +
        (warn ? ' warn' : '') +
        (focused ? ' focused' : '')
      cells.push(
        <div
          key={key}
          className={cls}
          role="gridcell"
          aria-label={`Row ${r + 1}, column ${c + 1}, region ${g + 1}: ${MARK_LABEL[mark]}`}
          aria-selected={focused || undefined}
          data-row={r}
          data-col={c}
          data-mark={mark}
          style={{ background: regionColor(colors, g) }}
        >
          {mark === 'queen' && <QueenIcon />}
          {mark === 'x' && <XIcon />}
          {showLabels && <span className="cell-label">{g}</span>}
        </div>,
      )
    }
  }

  return (
    <div
      ref={ref}
      className={`board${interactive ? ' interactive' : ''}${className ? ` ${className}` : ''}`}
      style={{ gridTemplateColumns: `repeat(${size}, 1fr)`, ['--n' as string]: size }}
      role="grid"
      aria-label={ariaLabel ?? `${size} by ${size} Queens board`}
      tabIndex={interactive ? 0 : -1}
      onPointerDown={handleDown}
      onPointerMove={handleMove}
      onPointerUp={handleUp}
      onPointerCancel={handleUp}
      onKeyDown={handleKey}
      onFocus={() => setHasFocus(true)}
      onBlur={() => setHasFocus(false)}
      onContextMenu={(e) => interactive && e.preventDefault()}
    >
      {cells}
      <svg className="board-lines" viewBox={`0 0 ${size} ${size}`} preserveAspectRatio="none" aria-hidden="true">
        <path d={borders.thin} className="line-thin" vectorEffect="non-scaling-stroke" />
        <path d={borders.thick} className="line-thick" vectorEffect="non-scaling-stroke" />
      </svg>
    </div>
  )
}

/** Thin grid lines inside regions and thick lines between regions, in board units. */
function buildBorderPaths(n: number, regions: number[][]): { thin: string; thick: string } {
  let thin = ''
  let thick = ''
  for (let r = 0; r < n; r++) {
    for (let c = 0; c < n; c++) {
      const g = regions[r]?.[c]
      if (c > 0) {
        const seg = `M${c} ${r}v1`
        if (regions[r]?.[c - 1] !== g) thick += seg
        else thin += seg
      }
      if (r > 0) {
        const seg = `M${c} ${r}h1`
        if (regions[r - 1]?.[c] !== g) thick += seg
        else thin += seg
      }
    }
  }
  return { thin, thick }
}

export function QueenIcon() {
  return (
    <svg className="queen" viewBox="0 0 24 24" aria-hidden="true">
      <path d="M4 19.5h16v2H4zM4.6 17.5 2.4 7.2l5.4 3.6L12 3.4l4.2 7.4 5.4-3.6-2.2 10.3z" />
    </svg>
  )
}

export function XIcon() {
  return (
    <svg className="xmark" viewBox="0 0 24 24" aria-hidden="true">
      <path d="M7 7l10 10M17 7 7 17" vectorEffect="non-scaling-stroke" />
    </svg>
  )
}
