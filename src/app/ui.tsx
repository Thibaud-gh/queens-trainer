import type { ReactNode } from 'react'

export type ToastKind = 'info' | 'success' | 'error'
export interface ToastMessage {
  id: number
  text: string
  kind: ToastKind
}

export function Toasts({ toasts }: { toasts: ToastMessage[] }) {
  if (!toasts.length) return null
  return (
    <div className="toasts" role="status" aria-live="polite">
      {toasts.map((t) => (
        <div key={t.id} className={`toast toast-${t.kind}`}>
          {t.text}
        </div>
      ))}
    </div>
  )
}

export function Spinner({ label }: { label?: string }) {
  return (
    <span className="spinner-wrap" role="status" aria-live="polite">
      <span className="spinner" aria-hidden="true" />
      {label && <span>{label}</span>}
    </span>
  )
}

export function IconButton({
  label,
  onClick,
  disabled,
  pressed,
  children,
  className,
}: {
  label: string
  onClick?: () => void
  disabled?: boolean
  pressed?: boolean
  children: ReactNode
  className?: string
}) {
  return (
    <button
      type="button"
      className={`iconbtn${pressed ? ' pressed' : ''}${className ? ` ${className}` : ''}`}
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      aria-pressed={pressed}
      title={label}
    >
      {children}
      <span className="iconbtn-label">{label}</span>
    </button>
  )
}

function Svg({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <svg className={`icon${className ? ` ${className}` : ''}`} viewBox="0 0 24 24" aria-hidden="true">
      {children}
    </svg>
  )
}

export function IconUndo() {
  return (
  <Svg>
    <path d="M9 14 4 9l5-5" />
    <path d="M4 9h10.5a5.5 5.5 0 0 1 0 11H11" />
  </Svg>
  )
}

export function IconRedo() {
  return (
  <Svg>
    <path d="m15 14 5-5-5-5" />
    <path d="M20 9H9.5a5.5 5.5 0 0 0 0 11H13" />
  </Svg>
  )
}

export function IconTrash() {
  return (
  <Svg>
    <path d="M3 6h18M8 6V4h8v2M6 6l1 14h10l1-14M10 11v5M14 11v5" />
  </Svg>
  )
}

export function IconBulb() {
  return (
  <Svg>
    <path d="M9 18h6M10 21h4M12 3a6 6 0 0 0-3.5 10.9c.6.5 1 1.3 1 2.1h5c0-.8.4-1.6 1-2.1A6 6 0 0 0 12 3z" />
  </Svg>
  )
}

export function IconCheck() {
  return (
  <Svg>
    <path d="M12 3 4 7v5c0 5 3.4 8.2 8 9 4.6-.8 8-4 8-9V7z" />
    <path d="m9 12 2 2 4-4" />
  </Svg>
  )
}

export function IconGear() {
  return (
  <Svg>
    <circle cx="12" cy="12" r="3" />
    <path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z" />
  </Svg>
  )
}

export function IconShare() {
  return (
  <Svg>
    <path d="M4 12v7a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-7M16 6l-4-4-4 4M12 2v13" />
  </Svg>
  )
}

export function IconPlay() {
  return (
  <Svg className="filled">
    <path d="M4 19.5h16v2H4zM4.6 17.5 2.4 7.2l5.4 3.6L12 3.4l4.2 7.4 5.4-3.6-2.2 10.3z" />
  </Svg>
  )
}

export function IconLibrary() {
  return (
  <Svg>
    <path d="M4 4h4v16H4zM10 4h4v16h-4zM16.5 4.5l3.9 1-3.5 14.5-3.9-1z" />
  </Svg>
  )
}

export function IconSparkles() {
  return (
  <Svg>
    <path d="M12 3v4M12 17v4M3 12h4M17 12h4M5.6 5.6l2.8 2.8M15.6 15.6l2.8 2.8M18.4 5.6l-2.8 2.8M8.4 15.6l-2.8 2.8" />
  </Svg>
  )
}

export function IconPencil() {
  return (
  <Svg>
    <path d="M4 20h4l10.5-10.5a2.1 2.1 0 0 0-3-3L5 17z" />
    <path d="m13.5 6.5 3 3" />
  </Svg>
  )
}

export function IconDice() {
  return (
  <Svg>
    <rect x="3" y="3" width="18" height="18" rx="3" />
    <circle cx="8" cy="8" r="1.2" fill="currentColor" />
    <circle cx="16" cy="8" r="1.2" fill="currentColor" />
    <circle cx="12" cy="12" r="1.2" fill="currentColor" />
    <circle cx="8" cy="16" r="1.2" fill="currentColor" />
    <circle cx="16" cy="16" r="1.2" fill="currentColor" />
  </Svg>
  )
}

export function IconClose() {
  return (
  <Svg>
    <path d="M6 6l12 12M18 6 6 18" />
  </Svg>
  )
}

export function IconTick() {
  return (
  <Svg>
    <path d="m5 12 5 5L20 7" />
  </Svg>
  )
}
