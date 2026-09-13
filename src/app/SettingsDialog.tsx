import { useEffect, useRef, type RefObject } from 'react'
import type { Settings, Theme } from './storage'
import { IconClose } from './ui'

interface Props {
  settings: Settings
  onChange: (patch: Partial<Settings>) => void
  onClose: () => void
}

const HAS_VIBRATE = typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function'

function Toggle({
  id,
  label,
  hint,
  value,
  onToggle,
  disabled,
  inputRef,
}: {
  id: string
  label: string
  hint?: string
  value: boolean
  onToggle: (v: boolean) => void
  disabled?: boolean
  inputRef?: RefObject<HTMLInputElement | null>
}) {
  return (
    <label className="setting" htmlFor={id}>
      <span className="setting-text">
        <span className="setting-label">{label}</span>
        {hint && <span className="setting-hint">{hint}</span>}
      </span>
      <input
        ref={inputRef}
        id={id}
        type="checkbox"
        role="switch"
        className="switch"
        checked={value}
        disabled={disabled}
        onChange={(e) => onToggle(e.target.checked)}
      />
    </label>
  )
}

export function SettingsDialog({ settings, onChange, onClose }: Props) {
  const first = useRef<HTMLInputElement>(null)
  useEffect(() => {
    first.current?.focus()
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" role="dialog" aria-modal="true" aria-labelledby="settings-title" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <h2 id="settings-title">Settings</h2>
          <button type="button" className="iconbtn plain" aria-label="Close settings" onClick={onClose}>
            <IconClose />
          </button>
        </div>
        <Toggle
          id="s-autox"
          inputRef={first}
          label="Auto-X"
          hint="Placing a queen crosses out every cell it rules out"
          value={settings.autoX}
          onToggle={(v) => onChange({ autoX: v })}
        />
        <Toggle
          id="s-conflicts"
          label="Show conflicts"
          hint="Highlight queens that break a rule while you play"
          value={settings.showConflicts}
          onToggle={(v) => onChange({ showConflicts: v })}
        />
        <Toggle id="s-timer" label="Show timer" value={settings.showTimer} onToggle={(v) => onChange({ showTimer: v })} />
        <Toggle
          id="s-haptics"
          label="Haptics"
          hint={HAS_VIBRATE ? 'Vibrate briefly when a queen is placed' : 'Not supported on this device'}
          value={settings.haptics && HAS_VIBRATE}
          disabled={!HAS_VIBRATE}
          onToggle={(v) => onChange({ haptics: v })}
        />
        <label className="setting" htmlFor="s-theme">
          <span className="setting-text">
            <span className="setting-label">Theme</span>
          </span>
          <select id="s-theme" value={settings.theme} onChange={(e) => onChange({ theme: e.target.value as Theme })}>
            <option value="system">System</option>
            <option value="light">Light</option>
            <option value="dark">Dark</option>
          </select>
        </label>
        <div className="modal-foot">
          <button type="button" className="btn primary" onClick={onClose}>
            Done
          </button>
        </div>
      </div>
    </div>
  )
}
