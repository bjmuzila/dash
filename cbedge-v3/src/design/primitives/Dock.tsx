import type { CSSProperties, ReactNode } from 'react'
import { useEffect, useRef } from 'react'
import { T, alpha, SHADOW } from '@/design/theme'

// ─────────────────────────────────────────────────────────────────────────────
// THE DOCK CONTROLS — the transport bar's buttons, sliders and segmented strip.
//
// Ported from v2's components/shared/DockToolbar.tsx, which is where the
// premarket replay transport, the ES-candles toolbar and the board docks all
// take their controls from. Only the three the premarket page actually mounts
// are here — a button, a slider and a segmented group — because a primitive
// nobody renders is a primitive nobody notices has rotted.
//
// These are NOT the same thing as design/primitives/Controls.tsx. Those are the
// small flat chips a CARD's header carries; these are the chunkier, glassier
// controls a floating transport bar carries, and the two have deliberately
// different weights. If a third surface ever wants a dock, it imports from
// here rather than restyling a Chip.
//
// Every colour is a token (design/theme.ts) or an alpha of one. Nothing below
// names a value.
// ─────────────────────────────────────────────────────────────────────────────

/* ---------- Segmented control ---------- */

export interface SegOption {
  label: string
  sub?: string
  value: string
}

export function DockSegGroup({
  options,
  active,
  onChange,
  accent = T.cyan,
  wrap = false,
}: {
  options: SegOption[]
  active: string
  onChange: (value: string) => void
  accent?: string
  /**
   * Let the tiles WRAP onto a second row instead of running off the end.
   *
   * Off by default: on a toolbar the strip sits in a row that scrolls, and a
   * second row there would change the bar's height. Inside a fixed-width panel
   * it is the opposite — a strip of six tiles has its last tile silently
   * CLIPPED, so the option exists but cannot be clicked.
   */
  wrap?: boolean
}) {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 'clamp(2px, 0.4vw, 5px)',
        rowGap: wrap ? 4 : undefined,
        flexWrap: wrap ? 'wrap' : 'nowrap',
        height: wrap ? undefined : 34,
        minHeight: 34,
        padding: 4,
        background: alpha(SHADOW, 0.22),
        borderRadius: 12,
        border: `1px solid ${alpha(T.text, 0.04)}`,
        flexShrink: 0,
        maxWidth: '100%',
        boxSizing: 'border-box',
      }}
    >
      {options.map((o) => {
        const on = o.value === active
        return (
          <button
            key={o.value}
            type="button"
            onClick={() => onChange(o.value)}
            style={{
              display: 'flex',
              flexDirection: 'row',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 'clamp(3px, 0.4vw, 5px)',
              flexShrink: 0,
              // `100%` of an auto-height wrapping box is meaningless, so the
              // wrapped tiles carry their own height.
              height: wrap ? 26 : '100%',
              padding: '0 clamp(7px, 1vw, 14px)',
              fontSize: 'clamp(10px, 0.85vw, 12px)',
              border: on ? `1px solid ${alpha(accent, 0.35)}` : '1px solid transparent',
              borderRadius: 8,
              whiteSpace: 'nowrap',
              background: on
                ? `linear-gradient(180deg,${alpha(accent, 0.18)},${alpha(accent, 0.05)})`
                : alpha(T.text, 0.04),
              color: on ? accent : T.text,
              fontWeight: 700,
              cursor: 'pointer',
              fontFamily: 'inherit',
              transition: 'background .14s, color .14s, border-color .14s',
              boxShadow: on
                ? `0 0 14px ${alpha(accent, 0.25)}, 0 2px 8px ${alpha(SHADOW, 0.35)}`
                : 'none',
            }}
          >
            <span>{o.label}</span>
            {o.sub && (
              <span style={{ fontSize: 'clamp(9px, 0.7vw, 10.5px)', opacity: 0.7, fontWeight: 600 }}>
                {o.sub}
              </span>
            )}
          </button>
        )
      })}
    </div>
  )
}

/* ---------- Action button ---------- */

export function DockButton({
  children,
  onClick,
  title,
  style,
  caret = false,
  open = false,
}: {
  children: ReactNode
  onClick?: () => void
  title?: string
  style?: CSSProperties
  caret?: boolean
  open?: boolean
}) {
  return (
    <button
      type="button"
      onClick={(e) => {
        // Drop focus so the UA ring cannot be mistaken for state. Standard for
        // icon/toolbar buttons; keyboard users still get the ring while
        // tabbing, because that path never fires a click.
        e.currentTarget.blur()
        onClick?.()
      }}
      title={title}
      aria-haspopup={caret ? 'menu' : undefined}
      aria-expanded={caret ? open : undefined}
      style={{
        minWidth: 34,
        height: 34,
        padding: '0 clamp(7px, 0.9vw, 11px)',
        borderRadius: 9,
        boxSizing: 'border-box',
        // A CLOSED menu button carries no border — the caret already says it
        // opens something, so a box around it is redundant chrome, and four of
        // them in a row read as a segmented control rather than four menus. The
        // border returns when the panel is open, the only state where it means
        // anything. Scoped to `caret`: plain DockButtons keep their box,
        // because for those the border IS the affordance.
        border: `1px solid ${caret && !open ? 'transparent' : alpha(T.text, 0.06)}`,
        background: `linear-gradient(180deg,${alpha(T.text, 0.06)},${alpha(T.text, 0.02)})`,
        color: T.text,
        fontSize: 'clamp(11px, 0.9vw, 13px)',
        fontWeight: 700,
        cursor: 'pointer',
        fontFamily: 'inherit',
        flexShrink: 0,
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 5,
        ...style,
      }}
    >
      {children}
      {caret && (
        <span
          aria-hidden
          style={{
            fontSize: 8,
            lineHeight: 1,
            marginLeft: 1,
            display: 'inline-block',
            opacity: open ? 0.95 : 0.45,
            transform: open ? 'rotate(180deg)' : 'none',
            transition: 'transform 120ms ease, opacity 120ms ease',
          }}
        >
          ▼
        </span>
      )}
    </button>
  )
}

/* ---------- Slider ---------- */

export function DockSlider({
  label,
  value,
  min,
  max,
  step = 0.01,
  onChange,
  format = (v) => v.toFixed(2),
  width = 90,
  accent = T.cyan,
  title,
  steppers = true,
  labelWidth,
  valueWidth = 34,
  disabled = false,
}: {
  label?: string
  value: number
  min: number
  max: number
  step?: number
  onChange: (v: number) => void
  format?: (v: number) => string
  /** Track width in px, or "auto" to flex-fill the remaining row width. */
  width?: number | 'auto'
  accent?: string
  title?: string
  steppers?: boolean
  /**
   * Fixed label column width. Set this on every slider in a stacked group and
   * the labels, tracks, values and steppers line up into real columns.
   */
  labelWidth?: number
  valueWidth?: number
  /**
   * Dim and inert — the control still SHOWS its value, it just cannot be moved.
   * For a setting something else is currently deciding. Hiding it instead would
   * be worse: the number it holds is the number that comes back the moment the
   * other thing lets go, and a control that vanishes takes that answer with it.
   */
  disabled?: boolean
}) {
  const fluid = width === 'auto'
  // Latest value for the hold-to-repeat timer, which would otherwise close over
  // the value from the render that started it and step only once.
  const valueRef = useRef(value)
  valueRef.current = value
  const holdRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const delayRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Snap to the step's own precision. Repeated float addition drifts
  // (0.5 + 0.05 → 0.55000000000000004), and a value that is not an exact
  // multiple of `step` makes the native input round it back on the next drag.
  const decimals = (String(step).split('.')[1] || '').length
  const bump = (dir: 1 | -1) => {
    const raw = valueRef.current + dir * step
    const next = Number(Math.min(max, Math.max(min, raw)).toFixed(decimals))
    if (next !== valueRef.current) onChange(next)
  }

  const stopHold = () => {
    if (delayRef.current) {
      clearTimeout(delayRef.current)
      delayRef.current = null
    }
    if (holdRef.current) {
      clearInterval(holdRef.current)
      holdRef.current = null
    }
  }
  // Fire once immediately, then repeat after a short delay — standard
  // press-and-hold feel, so a single click is still exactly one step.
  const startHold = (dir: 1 | -1) => {
    stopHold()
    bump(dir)
    delayRef.current = setTimeout(() => {
      holdRef.current = setInterval(() => bump(dir), 60)
    }, 350)
  }
  useEffect(() => stopHold, [])

  const atMin = disabled || value <= min
  const atMax = disabled || value >= max

  // One bordered pill split by a hairline, rather than two floating boxes —
  // reads as a single control and holds a tidy column in a stacked group.
  const stepBtn = (dir: 1 | -1, off: boolean) => (
    <button
      type="button"
      tabIndex={-1}
      disabled={off}
      aria-label={dir === 1 ? 'increase' : 'decrease'}
      onPointerDown={(e) => {
        e.preventDefault()
        if (!off) startHold(dir)
      }}
      onPointerUp={stopHold}
      onPointerLeave={stopHold}
      onPointerCancel={stopHold}
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        width: 15,
        height: 9,
        padding: 0,
        fontSize: 6,
        fontWeight: 900,
        border: 'none',
        background: 'transparent',
        borderBottom: dir === 1 ? `1px solid ${alpha(T.text, 0.1)}` : 'none',
        color: off ? alpha(T.text, 0.16) : accent,
        cursor: off ? 'default' : 'pointer',
      }}
    >
      {dir === 1 ? '▲' : '▼'}
    </button>
  )

  return (
    // Outer wrapper is NOT a <label>: a <button> inside a label forwards its
    // click to the labelled control, which would yank focus to the range input
    // on every step. The label/input/value stay wrapped so the text still
    // targets the slider.
    <span
      title={title}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 5,
        // minWidth:0 in fluid mode or this row becomes an un-shrinkable floor
        // for whatever grid/flex parent holds it, and its value + stepper spill
        // past the container's edge on a narrow viewport.
        ...(fluid ? { width: '100%', minWidth: 0 } : { flexShrink: 0 }),
        ...(disabled ? { opacity: 0.42, pointerEvents: 'none' as const } : null),
      }}
    >
      <style>{`
        input.dock-slider{-webkit-appearance:none;appearance:none;height:4px;border-radius:99px;background:${alpha(T.text, 0.12)};outline:none;cursor:pointer}
        input.dock-slider::-webkit-slider-thumb{-webkit-appearance:none;appearance:none;width:13px;height:13px;border-radius:99px;background:linear-gradient(180deg,${T.text},${T.cyan});border:1px solid ${alpha(T.text, 0.5)};box-shadow:0 0 8px ${alpha(T.cyan, 0.6)},0 1px 3px ${alpha(SHADOW, 0.5)};cursor:pointer}
        input.dock-slider::-moz-range-thumb{width:13px;height:13px;border-radius:99px;background:linear-gradient(180deg,${T.text},${T.cyan});border:1px solid ${alpha(T.text, 0.5)};box-shadow:0 0 8px ${alpha(T.cyan, 0.6)};cursor:pointer}
        input.dock-slider::-moz-range-track{height:4px;border-radius:99px;background:${alpha(T.text, 0.12)}}
      `}</style>
      <label
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 7,
          fontSize: 10,
          color: alpha(T.text, 0.55),
          fontWeight: 700,
          whiteSpace: 'nowrap',
          ...(fluid ? { flex: 1, minWidth: 0 } : { flexShrink: 0 }),
        }}
      >
        {label && <span style={labelWidth ? { width: labelWidth, flexShrink: 0 } : undefined}>{label}</span>}
        <input
          className="dock-slider"
          type="range"
          min={min}
          max={max}
          step={step}
          value={value}
          disabled={disabled}
          onChange={(e) => onChange(Number(e.target.value))}
          style={fluid ? { flex: 1, minWidth: 0, accentColor: accent } : { width, accentColor: accent }}
        />
        <span
          style={{
            width: valueWidth,
            flexShrink: 0,
            textAlign: 'right',
            fontVariantNumeric: 'tabular-nums',
            fontSize: 10,
            color: accent,
          }}
        >
          {format(value)}
        </span>
      </label>
      {steppers && (
        <span
          style={{
            display: 'flex',
            flexDirection: 'column',
            flexShrink: 0,
            borderRadius: 4,
            overflow: 'hidden',
            border: `1px solid ${alpha(T.text, 0.14)}`,
            background: alpha(T.text, 0.04),
          }}
        >
          {stepBtn(1, atMax)}
          {stepBtn(-1, atMin)}
        </span>
      )}
    </span>
  )
}

/**
 * v2 named the segmented strip `SegGroup`, and design/primitives/Controls.tsx
 * already exports a DIFFERENT control under that name. The alias keeps a ported
 * page's import list unchanged while the two stay distinguishable at the import
 * site by which module they come from.
 */
export { DockSegGroup as SegGroup }
