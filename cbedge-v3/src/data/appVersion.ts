import { useEffect, useState } from 'react'

// ─────────────────────────────────────────────────────────────────────────────
// "THERE IS A NEWER BUILD" — how a phone finds out.
//
// ── The problem, stated properly ────────────────────────────────────────────
// Nothing here is a caching bug, and clearing cookies never fixed it. The SPA
// shell is served by lib/serveSpaShell.ts with `cache-control: no-store`, and
// every asset under /v3/assets/ is content-hashed, so a RELOAD always lands on
// the current build. The problem is narrower than that: a tab that never
// reloads. On a phone the browser is not closed, it is backgrounded — the tab
// from Tuesday is still there on Friday, still running Tuesday's JavaScript,
// and nothing in the browser is ever going to ask the server whether that is
// still the newest one.
//
// So: ask. Once in a while, and whenever the tab comes back to the foreground.
//
// ── How the build is identified ─────────────────────────────────────────────
// By the entry chunk's own filename. Vite content-hashes it
// (/v3/assets/index-qlRQ5y_H.js), so the name changes when — and only when —
// the bundle changes. The RUNNING build's name is read off this document's own
// <script type="module">, and the LATEST one by fetching the shell with
// `cache: 'no-store'` and reading the same tag out of it. Two strings; if they
// differ, the server has moved on.
//
// No version file, no build-time constant, no endpoint. A stamp written at
// build time is a second thing that can be forgotten or go stale against the
// bundle it claims to describe; the filename cannot, because the bundler owns
// it. Nothing on the server changes to support this.
//
// ── Related, but not the same thing ─────────────────────────────────────────
// The `vite:preloadError` handler in main.tsx catches the OTHER half: a stale
// tab that asks for a lazy chunk the deploy has already deleted. That one is
// reactive and only fires when you tap something; this is the half that tells
// you before you tap. Both stay.
// ─────────────────────────────────────────────────────────────────────────────

/** The shell to ask. Answered by app/v3/route.ts, always `no-store`. */
const SHELL_URL = '/v3'

/** First check after mount. Long enough to stay out of the cold-load budget. */
const FIRST_CHECK_MS = 30_000

/** While the tab is visible. A deploy is a few times a day at most. */
const INTERVAL_MS = 10 * 60_000

/** Don't re-ask on every quick app-switch. */
const MIN_GAP_MS = 60_000

/**
 * The entry chunk is always `/v3/assets/index-<hash>.js`. Both sides of the
 * comparison look for THAT path specifically, and both are normalised to a
 * bare pathname, so the two strings can only differ when the build does.
 *
 * Why not "the first module script": since holdEntryForPrefs (vite.config.ts)
 * the built shell has no `<script type="module" src>` tag at all — the entry
 * is a modulepreload link plus a loader that appends the script late. So the
 * FIRST module script in the live DOM can be anything else that got there
 * earlier (a browser extension, a CDN injection), which never equals the
 * shell's entry, and the toast came back every session no matter how often
 * Update was pressed.
 */
const ENTRY_RE = /\/assets\/index-[A-Za-z0-9_-]+\.js$/

function normalise(src: string): string {
  try {
    const path = new URL(src, window.location.href).pathname
    return ENTRY_RE.test(path) ? path : ''
  } catch {
    return ''
  }
}

/**
 * The entry chunk's path, as written in a shell document. '' when it cannot be
 * found — which the caller treats as "don't know", never as "there is an
 * update", or a parse change would show every user a permanent nag.
 */
function entryFrom(html: string): string {
  const m = html.match(/["']([^"']*\/assets\/index-[A-Za-z0-9_-]+\.js)["']/)
  return m?.[1] ? normalise(m[1]) : ''
}

/** The entry chunk THIS page booted from. */
function runningEntry(): string {
  if (typeof document === 'undefined') return ''
  const els = document.querySelectorAll<HTMLScriptElement | HTMLLinkElement>(
    'script[type="module"][src], link[rel="modulepreload"][href]',
  )
  for (const el of Array.from(els)) {
    const raw = el.getAttribute(el instanceof HTMLLinkElement ? 'href' : 'src') ?? ''
    const path = normalise(raw)
    if (path) return path
  }
  return ''
}

async function latestEntry(): Promise<string> {
  const res = await fetch(SHELL_URL, {
    cache: 'no-store',
    credentials: 'same-origin',
    headers: { accept: 'text/html' },
  })
  // A redirect to the landing page or to /home means the session lapsed or the
  // gate moved. That is not a new build, and reporting it as one would put an
  // "Update" button in front of someone whose reload lands on a sign-in page.
  if (!res.ok || !(res.headers.get('content-type') ?? '').includes('text/html')) return ''
  return entryFrom(await res.text())
}

/** Dismissals are per build, so clearing one never hides the NEXT one. */
const DISMISSED_KEY = 'cb-v3-update-dismissed'

function dismissedFor(): string {
  try {
    return sessionStorage.getItem(DISMISSED_KEY) ?? ''
  } catch {
    return ''
  }
}

export function dismissUpdate(build: string): void {
  try {
    sessionStorage.setItem(DISMISSED_KEY, build)
  } catch {
    /* private mode — it comes back on the next check, which is acceptable */
  }
}

/**
 * The newest build's entry chunk, when it is not the one running. '' the rest
 * of the time — which is nearly always.
 *
 * Off in DEV: the dev shell's script src is `/src/main.tsx` at every revision,
 * so the comparison could never be true, and HMR already does this job.
 */
export function useUpdateAvailable(): string {
  const [available, setAvailable] = useState('')

  useEffect(() => {
    if (import.meta.env.DEV) return
    const mine = runningEntry()
    // Nothing to compare against — an unrecognised shell, or a document this
    // module was loaded into some other way. Stay quiet rather than guess.
    if (!mine) return

    let alive = true
    let last = 0

    const check = async () => {
      if (!alive) return
      if (document.visibilityState !== 'visible') return
      const now = Date.now()
      if (now - last < MIN_GAP_MS) return
      last = now
      try {
        const latest = await latestEntry()
        if (!alive || !latest || latest === mine) return
        if (dismissedFor() === latest) return
        setAvailable(latest)
      } catch {
        // Offline, or the request was cut off. Silence is right: the app is
        // still working, and there is nothing the user could do about it.
      }
    }

    const first = window.setTimeout(check, FIRST_CHECK_MS)
    const timer = window.setInterval(check, INTERVAL_MS)
    // THE ONE THAT MATTERS ON A PHONE. A backgrounded tab's timers are throttled
    // or stopped outright, so the interval above may not have run for a day.
    // Coming back to the foreground is the moment to ask.
    const onVisible = () => {
      if (document.visibilityState === 'visible') void check()
    }
    document.addEventListener('visibilitychange', onVisible)

    return () => {
      alive = false
      window.clearTimeout(first)
      window.clearInterval(timer)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [])

  return available
}

/**
 * Take the new build.
 *
 * `location.reload()` and nothing else — no cache API to empty, no cookies to
 * clear, no service worker to unregister (v3 registers none). The shell is
 * no-store and the assets are content-hashed, so one reload is the whole of it.
 */
export function applyUpdate(): void {
  window.location.reload()
}
