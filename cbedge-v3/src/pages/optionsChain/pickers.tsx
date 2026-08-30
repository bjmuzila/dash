// ─────────────────────────────────────────────────────────────────────────────
// The chain's value dropdown — the % strikes picker and the replay date picker.
//
// Not design/primitives/Controls.tsx's Popover, deliberately: that one is a
// panel anchored to a card's cog and clamped to the viewport. This anchors to a
// toolbar button, re-anchors on scroll in the CAPTURE phase (the grid scrolls in
// its own container, and that scroll does not bubble to window) and is a LIST,
// which is a different job.
//
// The TICKER picker used to live here too. It is now
// design/primitives/TickerPicker.tsx, because the app toolbar owns the symbol
// and this page follows it rather than carrying a second control for the same
// thing.
//
// Spec: docs/parity/options-chain.md — Part C2.
// ─────────────────────────────────────────────────────────────────────────────

import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { alpha, SHADOW, T } from '@/design/theme'

/** Above every other layer this page can raise. */
const MENU_Z = 100010

/** Keeps a portal'd menu under its trigger through scrolls and resizes. */
function useAnchor(open: boolean, btnRef: React.RefObject<HTMLButtonElement | null>) {
  const [rect, setRect] = useState<{ left: number; top: number; width: number } | null>(null)
  useEffect(() => {
    if (!open) return
    const update = () => {
      const r = btnRef.current?.getBoundingClientRect()
      if (r) setRect({ left: r.left, top: r.bottom + 3, width: r.width })
    }
    update()
    // Capture phase: the grid scrolls in its own container, and that scroll does
    // not bubble to window.
    window.addEventListener('scroll', update, true)
    window.addEventListener('resize', update)
    return () => {
      window.removeEventListener('scroll', update, true)
      window.removeEventListener('resize', update)
    }
  }, [open, btnRef])
  return rect
}

/** Outside pointer-down closes. The trigger and the portal'd panel both count as inside. */
function useDismiss(hostRef: React.RefObject<HTMLElement | null>, menuRef: React.RefObject<HTMLElement | null>, close: () => void) {
  useEffect(() => {
    function h(e: MouseEvent) {
      const t = e.target as Node
      if (hostRef.current?.contains(t) || menuRef.current?.contains(t)) return
      close()
    }
    document.addEventListener('mousedown', h)
    return () => document.removeEventListener('mousedown', h)
  }, [hostRef, menuRef, close])
}

const menuPanelStyle = (extra: React.CSSProperties): React.CSSProperties => ({
  position: 'fixed',
  zIndex: MENU_Z,
  background: T.panel,
  border: `1px solid ${T.border}`,
  borderTop: `2px solid ${alpha(T.cyan, 0.5)}`,
  borderRadius: 6,
  boxShadow: `0 8px 32px ${alpha(SHADOW, 0.7)}`,
  ...extra,
})

const rowStyle = (active: boolean): React.CSSProperties => ({
  padding: '6px 12px',
  fontSize: 10,
  fontWeight: active ? 800 : 600,
  cursor: 'pointer',
  whiteSpace: 'nowrap',
  color: active ? T.cyan : T.text,
  background: active ? alpha(T.cyan, 0.1) : 'transparent',
  letterSpacing: '0.04em',
})

// ── A plain value dropdown ───────────────────────────────────────────────────

export function ChainDropdown<TValue extends string | number>({
  value,
  options,
  onChange,
  formatLabel,
  triggerLabel,
  accent = true,
}: {
  value: TValue
  options: readonly TValue[]
  onChange: (v: TValue) => void
  formatLabel?: (v: TValue) => string
  triggerLabel?: string
  accent?: boolean
}) {
  const [open, setOpen] = useState(false)
  const hostRef = useRef<HTMLDivElement>(null)
  const btnRef = useRef<HTMLButtonElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)
  const rect = useAnchor(open, btnRef)
  useDismiss(hostRef, menuRef, () => setOpen(false))

  const label = triggerLabel ?? (formatLabel ? formatLabel(value) : String(value))

  return (
    <div ref={hostRef} style={{ position: 'relative' }}>
      <button
        ref={btnRef}
        onClick={() => setOpen((o) => !o)}
        style={{
          fontSize: 10,
          fontWeight: 700,
          padding: '5px 10px',
          border: `1px solid ${accent ? alpha(T.cyan, 0.25) : T.border}`,
          borderRadius: 6,
          background: accent
            ? `linear-gradient(180deg,${alpha(T.cyan, 0.12)},${alpha(T.cyan, 0.04)})`
            : alpha(T.text, 0.04),
          color: accent ? T.cyan : T.text,
          cursor: 'pointer',
          outline: 'none',
          display: 'flex',
          alignItems: 'center',
          gap: 5,
          whiteSpace: 'nowrap',
          letterSpacing: '0.08em',
          textTransform: 'uppercase',
        }}
      >
        {label}
        <span style={{ fontSize: 10, opacity: 0.7 }}>▾</span>
      </button>
      {open &&
        rect &&
        typeof document !== 'undefined' &&
        createPortal(
          <div
            ref={menuRef}
            style={menuPanelStyle({
              left: rect.left,
              top: rect.top,
              minWidth: rect.width,
              padding: '3px 0',
              maxHeight: 320,
              overflowY: 'auto',
            })}
          >
            {options.map((opt) => {
              const active = opt === value
              return (
                <div
                  key={String(opt)}
                  onClick={() => {
                    onChange(opt)
                    setOpen(false)
                  }}
                  style={rowStyle(active)}
                >
                  {formatLabel ? formatLabel(opt) : String(opt)}
                </div>
              )
            })}
          </div>,
          document.body,
        )}
    </div>
  )
}
