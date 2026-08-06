import { useEffect, useState } from 'react'
import { T, label, SERIF } from '../theme'

/**
 * The landing screen — the pencil drawing, shown on sign-in and once per app
 * open before Today.
 *
 * It is the actual scan, not a redrawn approximation: knocked out to white
 * strokes on transparency (see public/heart.png) so it sits on the app
 * background with no paper rectangle behind it.
 *
 * Rules this follows:
 *   - It NEVER blocks. Tapping anywhere dismisses it instantly. Five seconds is
 *     a long time when you opened the app to tick one thing off, so the tap
 *     target is the entire screen rather than a small "skip" control.
 *   - Once per page LOAD, not per navigation. Moving between tabs must not
 *     replay it.
 *   - Today is already mounted and painted behind this (see App.tsx), so
 *     dismissing early lands on a finished screen, never a spinner.
 *   - Respects prefers-reduced-motion: no rise-in, no fade, just the image.
 */

const HOLD_MS = 5000
const FADE_MS = 420

export default function Welcome({ onDone }: { onDone: () => void }) {
  const [leaving, setLeaving] = useState(false)
  const reduced = typeof window !== 'undefined'
    && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches

  useEffect(() => {
    const hold = setTimeout(() => setLeaving(true), HOLD_MS)
    return () => clearTimeout(hold)
  }, [])

  // The fade-out and the unmount are separate timers rather than a transitionend
  // handler: if the tab is backgrounded mid-transition the event never fires and
  // the splash would still be there when you came back.
  useEffect(() => {
    if (!leaving) return
    const go = setTimeout(onDone, reduced ? 0 : FADE_MS)
    return () => clearTimeout(go)
  }, [leaving, onDone, reduced])

  const dismiss = () => setLeaving(true)

  return (
    <div
      onClick={dismiss}
      role="button"
      tabIndex={0}
      aria-label="Continue"
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') dismiss() }}
      style={{
        position: 'fixed', inset: 0, zIndex: 50,
        background: T.paper, backgroundImage: T.glow,
        display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
        gap: 26, cursor: 'pointer',
        padding: 'max(28px, env(safe-area-inset-top)) 28px max(28px, env(safe-area-inset-bottom))',
        opacity: leaving ? 0 : 1,
        transition: reduced ? 'none' : `opacity ${FADE_MS}ms ease`,
      }}
    >
      <img
        src="/heart.png"
        alt="Brandon and Heather"
        style={{
          width: 'min(74vw, 300px)',
          height: 'auto',
          // The scan is warm-grey pencil; a touch of contrast keeps the thin
          // strokes from disappearing at phone size.
          filter: 'contrast(1.08)',
          animation: reduced ? undefined : 'hh-rise 900ms cubic-bezier(0.16, 1, 0.3, 1) both',
        }}
      />
      <div style={{
        ...label({ letterSpacing: '0.3em', color: T.muted }),
        animation: reduced ? undefined : 'hh-rise 900ms 260ms cubic-bezier(0.16, 1, 0.3, 1) both',
      }}>
        Home
      </div>

      <style>{`
        @keyframes hh-rise {
          from { opacity: 0; transform: translateY(10px) scale(0.985); }
          to   { opacity: 1; transform: none; }
        }
      `}</style>

      {/* Deliberately not a button: the whole screen is the target, and a
          "Skip" control would imply there is something to sit through. */}
      <div style={{ ...label({ color: T.faint, letterSpacing: '0.2em' }), position: 'absolute', bottom: 'max(30px, env(safe-area-inset-bottom))' }}>
        Tap to continue
      </div>
    </div>
  )
}

/** Font import kept local to this file — the splash is the only serif display use here. */
export const _serif = SERIF
