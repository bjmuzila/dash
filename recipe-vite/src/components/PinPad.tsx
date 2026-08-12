import { useEffect } from 'react'
import { T, label, MONO } from '../theme'

/**
 * The 4-digit keypad. Shared by the sign-in screen and PIN setup, so entering a
 * PIN and choosing one feel like the same control.
 *
 * Why an on-screen pad instead of an <input inputMode="numeric">:
 *   - A text input on iOS pulls up the full keyboard with a predictive bar,
 *     shoves the layout up, and offers to autofill a password into a field that
 *     takes four digits. The pad has none of that.
 *   - It gives real 60px targets. This gets used one-handed, standing up.
 *   - Nothing is ever in a form field, so no password manager, no autocomplete
 *     history, no "save this?" prompt for a device-scoped secret.
 *
 * A physical keyboard still works — digits, Backspace, Escape — because on a
 * laptop typing 4 digits is faster than clicking them, and the pad would
 * otherwise be the only control on the page you can't touch-type.
 *
 * The parent owns `value` and reacts to it reaching `length`. Auto-submitting
 * on the fourth digit is the whole point of a fixed-length PIN: a confirm
 * button would be one tap of pure ceremony.
 */

const KEYS = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '', '0', '⌫']

export default function PinPad({
  value,
  onChange,
  disabled = false,
  length = 4,
  /** Flashes the dots red — set on a wrong PIN, cleared by the next keypress. */
  shake = false,
}: {
  value: string
  onChange: (next: string) => void
  disabled?: boolean
  length?: number
  shake?: boolean
}) {
  const press = (k: string) => {
    if (disabled) return
    if (k === '⌫') { onChange(value.slice(0, -1)); return }
    if (!k) return
    if (value.length >= length) return
    onChange(value + k)
  }

  // Physical keyboard. Bound to the window rather than a focused element so it
  // works the instant the screen appears, with nothing to click first.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (disabled) return
      if (e.key >= '0' && e.key <= '9') { e.preventDefault(); press(e.key) }
      else if (e.key === 'Backspace') { e.preventDefault(); press('⌫') }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  return (
    <div style={{ opacity: disabled ? 0.45 : 1, transition: 'opacity 140ms' }}>
      {/* Dots. Filled = entered. Deliberately not showing the digits: this gets
          typed in a kitchen with someone standing next to you. */}
      <div
        aria-hidden
        style={{
          display: 'flex', justifyContent: 'center', gap: 16, marginBottom: 26,
          animation: shake ? 'hh-shake 380ms cubic-bezier(.36,.07,.19,.97)' : undefined,
        }}
      >
        {Array.from({ length }, (_, i) => {
          const on = i < value.length
          return (
            <span key={i} style={{
              width: 13, height: 13, borderRadius: '50%',
              background: on ? (shake ? T.bad : T.ink) : 'transparent',
              border: `1.5px solid ${shake ? T.bad : on ? T.ink : T.ruleStrong}`,
              transition: 'background 120ms, border-color 120ms, transform 120ms',
              transform: on ? 'scale(1.06)' : 'none',
            }} />
          )
        })}
      </div>

      <div style={{
        display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 12,
        maxWidth: 268, margin: '0 auto',
      }}>
        {KEYS.map((k, i) => k === '' ? <span key={i} /> : (
          <button
            key={i}
            type="button"
            onClick={() => press(k)}
            disabled={disabled}
            aria-label={k === '⌫' ? 'Delete' : k}
            style={{
              appearance: 'none',
              height: 62,
              borderRadius: 12,
              cursor: disabled ? 'default' : 'pointer',
              // Digits get the raised surface; delete is bare, so the one
              // destructive key never looks like the primary action.
              background: k === '⌫' ? 'transparent' : T.paperRaised,
              border: `1px solid ${k === '⌫' ? 'transparent' : T.rule}`,
              color: k === '⌫' ? T.muted : T.ink,
              fontFamily: MONO,
              fontSize: k === '⌫' ? 19 : 23,
              fontWeight: 400,
              letterSpacing: '0.02em',
              // No tap-highlight rectangle on iOS, and no double-tap-to-zoom
              // delay on a control you press four times in a row.
              WebkitTapHighlightColor: 'transparent',
              touchAction: 'manipulation',
              userSelect: 'none',
            }}
          >
            {k}
          </button>
        ))}
      </div>

      <style>{`
        @keyframes hh-shake {
          10%, 90% { transform: translateX(-2px); }
          20%, 80% { transform: translateX(4px); }
          30%, 50%, 70% { transform: translateX(-7px); }
          40%, 60% { transform: translateX(7px); }
        }
      `}</style>
    </div>
  )
}

/** The one-line error style shared by the PIN screens. */
export const pinError = (text: string) => (
  <div role="alert" style={{
    ...label({ color: T.bad, letterSpacing: '0.06em' }),
    textAlign: 'center', marginTop: 18, lineHeight: 1.5,
  }}>
    {text}
  </div>
)
