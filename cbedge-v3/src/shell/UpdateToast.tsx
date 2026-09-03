import { useState } from 'react'
import { useLocation } from 'react-router-dom'
import { applyUpdate, dismissUpdate, useUpdateAvailable } from '@/data/appVersion'
import { isMobilePath } from '@/mobile/mobileNav'

// ─────────────────────────────────────────────────────────────────────────────
// "New version — Update".
//
// The one piece of chrome in the app that appears without being asked for, so
// it is small, it is dismissible, and it never appears twice for the same
// build (see dismissUpdate in data/appVersion.ts).
//
// WHY IT EXISTS. A phone tab is backgrounded, not closed, so the copy of the
// app someone opened on Tuesday is still the copy they are looking at on
// Friday. There was no way to find that out from inside the app and no
// reasonable way to fix it from a phone — pull-to-refresh works, but only if
// you already know you need it, and "clear your browser data" is not a thing
// to ask a customer to do on a handset. So the app checks, and says so.
//
// It is NOT auto-reload. A reload mid-session throws away scroll position,
// an open ladder, a half-typed ticker — and on a chart page it is indistinguishable
// from a crash. The user decides when.
//
// PLACEMENT. Bottom centre, because that is where a thumb is. On /m/* it sits
// ABOVE the tab bar and its safe-area padding rather than on top of it; the
// offset is inline because it is arithmetic over an env() value, which is not
// something a utility class can express.
// ─────────────────────────────────────────────────────────────────────────────

/** Tab-bar height (52px) + its safe-area pad + a gap. */
const MOBILE_BOTTOM = 'calc(env(safe-area-inset-bottom, 0px) + 64px)'
const DESKTOP_BOTTOM = '18px'

export function UpdateToast() {
  const build = useUpdateAvailable()
  const mobile = isMobilePath(useLocation().pathname)
  // Dismissal is remembered in sessionStorage so the NEXT check stays quiet
  // too, and held here so this render goes away immediately — the hook keeps
  // reporting the build it found, which is correct: it is still available.
  const [hidden, setHidden] = useState('')
  if (!build || hidden === build) return null

  return (
    <div
      role="status"
      className="pointer-events-none fixed inset-x-0 z-50 flex justify-center px-3"
      style={{ bottom: mobile ? MOBILE_BOTTOM : DESKTOP_BOTTOM }}
    >
      <div className="pointer-events-auto flex max-w-full items-center gap-2 rounded-md border border-line bg-raised px-3 py-2 shadow-lg">
        <span className="truncate text-sm text-fg">New version available</span>
        <button
          type="button"
          onClick={applyUpdate}
          className="shrink-0 rounded-sm bg-accent px-3 py-1.5 text-sm font-semibold text-bg"
        >
          Update
        </button>
        <button
          type="button"
          onClick={() => {
            dismissUpdate(build)
            setHidden(build)
          }}
          aria-label="Not now"
          title="Not now — it will come back on the next build"
          className="shrink-0 rounded-sm px-2 py-1.5 text-sm text-muted hover:text-fg"
        >
          ✕
        </button>
      </div>
    </div>
  )
}

export default UpdateToast
