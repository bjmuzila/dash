// ─────────────────────────────────────────────────────────────────────────────
// SERVER RESTARTED → REFRESH THE DATA, by itself.
//
// 2026-10-09 02:44, Brandon: "it just came up. i hit reconnect feed and
// everything showed. is there a way to make sure this does not happen. server
// just should have restarted".
//
// When server-v2 restarts (a deploy, the box rebooting, a crash), the socket
// reconnects on its own, but the REST reads a page made while the server was
// down or still warming up — an empty basis, an empty ladder, a 502 — sit in the
// query cache for their whole staleMs (up to ten minutes for the ES basis and a
// past session's ladder). A chart's studies redraw from those, so the Path and
// the rail stay empty until the cache runs out or someone presses the toolbar's
// Refresh (which is refreshAll + reconnectSocket).
//
// This watches for the restart and does the same thing, twice: once shortly
// after the server answers again, and once more when it has had time to warm
// (the chain, the basis and the ladders fill in over the first minute or two).
//
// HOW IT KNOWS: GET /api/healthz/ready carries the process's uptime
// (server-v2/healthz.cjs; public, held 5 s on the server, a few hundred bytes).
// Uptime going DOWN between two reads is a restart. Read once a minute while
// the tab is visible, and at once when a hidden tab comes back. A failed read
// (the server is down) is remembered too, so the first good read after it
// counts as coming back.
// ─────────────────────────────────────────────────────────────────────────────

import { refreshAll } from '@/data/api'

const READY_URL = '/api/healthz/ready'
const POLL_MS = 60_000
/** After a restart: refresh once it answers, and again when it has warmed. */
const REFRESH_AFTER_MS = [5_000, 90_000]

let users = 0
let timer: ReturnType<typeof setInterval> | null = null
let lastUptime: number | null = null
let wasDown = false
const pending: Array<ReturnType<typeof setTimeout>> = []

function scheduleRefresh(): void {
  while (pending.length) clearTimeout(pending.pop())
  for (const ms of REFRESH_AFTER_MS) pending.push(setTimeout(() => refreshAll(), ms))
}

async function check(): Promise<void> {
  if (typeof document !== 'undefined' && document.hidden) return
  let up: number | null = null
  try {
    // never through the query cache: this read is about the server, not data
    const r = await fetch(READY_URL, { cache: 'no-store', credentials: 'same-origin' })
    // 503 is "not ready" (the feed or the DB), still an answer with an uptime
    const j = (await r.json().catch(() => null)) as { uptimeSec?: unknown } | null
    const u = Number(j?.uptimeSec)
    up = Number.isFinite(u) ? u : null
  } catch {
    up = null
  }
  if (up == null) {
    // down, restarting, or a build without /api/healthz/ready: remember, do nothing
    wasDown = true
    return
  }
  const restarted = lastUptime != null && up < lastUptime
  if (restarted || wasDown) scheduleRefresh()
  lastUptime = up
  wasDown = false
}

const onVisible = () => {
  if (!document.hidden) void check()
}

/** Watch for server restarts while this page is up. Returns the stop. Shared: one poll however many callers. */
export function watchServerRestart(): () => void {
  users++
  if (users === 1) {
    void check()
    timer = setInterval(() => void check(), POLL_MS)
    document.addEventListener('visibilitychange', onVisible)
  }
  let stopped = false
  return () => {
    if (stopped) return
    stopped = true
    users--
    if (users > 0) return
    if (timer) clearInterval(timer)
    timer = null
    document.removeEventListener('visibilitychange', onVisible)
    while (pending.length) clearTimeout(pending.pop())
    lastUptime = null
    wasDown = false
  }
}
