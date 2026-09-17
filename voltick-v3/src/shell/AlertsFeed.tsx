import type { CSSProperties } from 'react'
import { Suspense, lazy, useEffect, useMemo, useRef, useState } from 'react'
import { alpha } from '@/design/theme'
import type { AlertItem } from '@/shell/alertTypes'
import type { AlertKind } from '@/shell/alertTypes'
import { ALERT_TYPES, TYPE_BY_ID } from '@/shell/alertTypes'

// ─────────────────────────────────────────────────────────────────────────────
// THE ALERTS PILL — the newest signal, in the toolbar, all the time.
//
// A bell with a number tells you SOMETHING happened. This tells you WHAT: the
// type's colour, its keyword, the headline, and how long ago. That is the whole
// argument for spending toolbar width on it — you can decide whether to look
// without clicking, which is the decision you make thirty times a session.
//
// Click it and the rest open underneath, scrollable, with one row of filter
// chips. There is no settings tab: whether a kind fires at all is the signals
// engine's own switchboard on the owner site, and it is owner-only at the
// server. See AlertsPanel.tsx.
//
// WHY THE PANEL IS LAZY: Shell.tsx is the ENTRY chunk, capped at 37.1KB brotli
// by budgets.json. The pill has to be in it — it is toolbar chrome and it draws
// on first paint. The panel (list, chips, settings switches) is several KB that
// only matters once someone clicks. Same split, same reason, as BzilaAlerts /
// BzilaPanel, BotAlert / BotAlertPanel and NotesDock.
//
// ── WHAT IS LIVE AND WHAT IS NOT (2026-09-15) ───────────────────────────────
// The SWITCHBOARD is wired: the Settings tab reads the signals engine's own
// per-kind master state from GET /proxy/signal-alerts, and a kind the owner has
// turned off is drawn locked. See alertTypes.ts.
//
// The FEED IS LIVE: `useAlertsFeed` polls GET /proxy/signals, which reads the
// `trade_signals` table the engine writes. Rows whose `kind` is not in
// ALERT_TYPES are dropped rather than drawn untyped — a new detector shipping
// server-side shows up here the moment its type is added to alertTypes.ts, and
// never as a colourless row nobody can filter.
// ─────────────────────────────────────────────────────────────────────────────

const AlertsPanel = lazy(() => import('@/shell/AlertsPanel'))

// ── Mapping a trade_signals row onto a feed item ────────────────────────────

/** serverKey → the type id the UI knows it by. Built once. */
const KIND_BY_SERVER_KEY: Record<string, AlertKind> = Object.fromEntries(
  ALERT_TYPES.map((t) => [t.serverKey, t.id]),
) as Record<string, AlertKind>

/**
 * The engine builds `reason` and `setup` by concatenating optional segments —
 * a size that may be null, an expiry that may be missing, an arrival side that
 * needs a prior frame. Every absent segment leaves the separator or the space
 * that was going to join it, which is where "SPX 6600 ,  · 3.4B" comes from.
 * Rather than make each detector defensive about its own punctuation, the text
 * is tidied once, here, on the way to the screen.
 */
function tidy(v: unknown): string {
  const parts = String(v ?? '')
    .replace(/\s+/g, ' ')
    // Split on the separator the engine joins segments with, clean each segment
    // on its own, then DROP the empty ones and rejoin. Doing it segment-wise is
    // why "A ·  · B" becomes "A · B" instead of losing the separator entirely —
    // a single regex pass over the whole string cannot tell a dangling dot from
    // a valid one, because both are " · ".
    .split('·')
    .map((part) =>
      part
        .replace(/\s+([,.;:%])/g, '$1')   // "6600 ," → "6600,"
        .replace(/([(\[])\s+/g, '$1')     // "( SPX" → "(SPX"
        .replace(/\s+([)\]])/g, '$1')     // "6600 )" → "6600)"
        .replace(/([,;:])\s*(?=[,;:])/g, '') // ", ," from two missing clauses
        .replace(/^[\s,;:]+/g, '')
        .replace(/[\s,;:]+$/g, '')        // a comma left hanging by a dropped clause
        .trim(),
    )
    .filter(Boolean)
  return parts.join(' · ').replace(/\s+/g, ' ').trim()
}

/** "10:37" in ET — the column the feed sorts and `age()` reads. */
function etClock(ts: unknown): string {
  const ms = Number(ts)
  if (!Number.isFinite(ms) || ms <= 0) return ''
  try {
    return new Intl.DateTimeFormat('en-US', {
      timeZone: 'America/New_York', hour: '2-digit', minute: '2-digit', hour12: false,
    }).format(new Date(ms))
  } catch {
    return ''
  }
}

interface SignalRow {
  id?: number
  ts?: number | string
  kind?: string
  direction?: string
  setup?: string
  level_name?: string | null
  level_spx?: number | null
  score?: number | null
  confluence?: string | null
  reason?: string | null
  meta?: Record<string, unknown> | string | null
}

/** `meta` arrives as a jsonb object, or as a string if the driver did not parse it. */
function metaOf(row: SignalRow): Record<string, unknown> {
  const m = row?.meta
  if (m && typeof m === 'object') return m as Record<string, unknown>
  if (typeof m === 'string') {
    try {
      const j = JSON.parse(m)
      return j && typeof j === 'object' ? (j as Record<string, unknown>) : {}
    } catch {
      return {}
    }
  }
  return {}
}

const num = (v: unknown): number | null => {
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}

/** "2026-09-18" → "09-18". The year is never the thing you are checking. */
function shortExpiry(v: unknown): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(v ?? ''))
  return m ? `${m[2]}-${m[3]}` : ''
}

/** `SPX` for the index detectors; the print's own underlying for the rest. */
function tickerOf(kind: AlertKind, m: Record<string, unknown>): string {
  if (kind === 'whale') return String(m.ticker ?? '').toUpperCase()
  if (kind === 'gexChangeTop') return String(m.symbol ?? '').toUpperCase()
  // Flip, core and IB are all read off the same index — the engine never puts a
  // symbol on them because there is only one it could be.
  return 'SPX'
}

const escapeRe = (v: string) => v.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/** Take the symbol out of a title that is about to be drawn behind it. */
function dropTicker(v: string, ticker: string): string {
  if (!ticker) return v
  return tidy(v.replace(new RegExp(`\\b${escapeRe(ticker)}\\b`, 'gi'), ' '))
}

function toItem(row: SignalRow): AlertItem | null {
  const kind = KIND_BY_SERVER_KEY[String(row?.kind ?? '')]
  if (!kind) return null
  const t = TYPE_BY_ID[kind]
  const m = metaOf(row)
  const ticker = tickerOf(kind, m)

  // ── The title ────────────────────────────────────────────────────────────
  // `setup` is what the detector called this event ("Core level ↑ 7650 → 7685",
  // "Whale put buy — QQQ 690P $1.0M"), and that IS the title. Two things come
  // out of it: the type's own name where `setup` opens by restating it, and the
  // ticker, which is now drawn in front rather than inside.
  let title = tidy(row.setup)
  if (title.toLowerCase().startsWith(t.name.toLowerCase())) title = title.slice(t.name.length)
  title = dropTicker(tidy(title), ticker)

  // The sentence the detector wrote, always the second line. It is the WHY, and
  // it is never the title — a title you have to read to the end of is a caption.
  const text = tidy(row.reason) || tidy(row.setup) || t.name

  const bits: string[] = []

  if (kind === 'whale') {
    // "Whale put buy" → "Put buy". The chip, the dot and the colour all already
    // say whale; with the ticker leading, the word is the third time.
    title = tidy(title.replace(/^whale\s+/i, ''))
    // `title[0]` is `string | undefined` under noUncheckedIndexedAccess — an
    // empty title indexes to nothing. Same behaviour as before (empty stays
    // empty), spelled so the compiler can see it.
    const head = title[0]
    title = head ? head.toUpperCase() + title.slice(1) : title
    // No level line: `level_name` is "QQQ 690P", which the title now carries,
    // and `level_spx` is null on an option print — the two together were what
    // printed "SPY 747P 0".
  } else if (kind === 'gexChangeTop') {
    // The CONTRACT is what you need off a scanner pick, so the title is the
    // strike and the expiry, and the Δ GEX that got it picked stays in `text`.
    const strike = num(m.strike)
    const exp = shortExpiry(m.expiry)
    const head = [strike != null ? String(strike) : '', exp].filter(Boolean).join(' ')
    const tail = m.live === true ? 'Live trigger' : 'Scanner pick'
    title = tidy([head, tail].filter(Boolean).join(' · '))
  } else {
    // The level, but never twice: `level_name` is often already "MU 1005", and
    // appending level_spx to it produced "MU 1005 1005". A zero or missing SPX
    // value is dropped rather than printed as "0".
    const lvl = num(row.level_spx)
    const name = row.level_name ? String(row.level_name) : ''
    if (name && lvl != null && lvl !== 0 && !name.includes(lvl.toFixed(0))) {
      bits.push(`${name} ${lvl.toFixed(0)}`)
    } else if (name) bits.push(name)
  }

  if (row.confluence) bits.push(`with ${row.confluence}`)
  // `row.score` is deliberately NOT drawn. It is the engine's internal ranking
  // number, on no scale the reader has been given — "score 5" answers nothing
  // you can act on, and a number with no units beside a real price reads as if
  // it were one. The field stays on SignalRow because the route still sends it.

  return {
    id: Number(row.id) || Number(row.ts) || 0,
    kind,
    ticker,
    title: title || t.name,
    text,
    // The pill leads with the ticker too, for the same reason the row does.
    short: tidy([ticker, title].filter(Boolean).join(' ')) || t.name,
    meta: bits.length ? tidy(bits.join(' · ')) : undefined,
    at: etClock(row.ts),
  }
}

// ── The poll ────────────────────────────────────────────────────────────────
// 20s, and only while the tab is visible: a parked dashboard should not be a
// request every twenty seconds all night. The catch-up happens on the way back,
// which is also when a returning trader most wants the list correct.
const FEED_POLL_MS = 20_000
const FEED_LIMIT = 50

// ── The arrival flash ───────────────────────────────────────────────────────
// Three beats of 800ms (see `.alert-flash`, design/tokens.css) and then the
// pill is quiet again. Bounded on purpose: the dot already marks "recent" for
// the next hour, so the flash only has to answer "did one just land while I was
// looking at the chart", and a ring that keeps going stops being read.
const FLASH_MS = 2400

export function useAlertsFeed(): AlertItem[] {
  const [items, setItems] = useState<AlertItem[]>([])
  const sigRef = useRef('')

  useEffect(() => {
    let alive = true

    const load = async () => {
      try {
        const r = await fetch(`/proxy/signals?limit=${FEED_LIMIT}`, {
          cache: 'no-store',
          credentials: 'same-origin',
        })
        if (!r.ok) return
        const j = (await r.json()) as { rows?: SignalRow[] }
        if (!alive || !Array.isArray(j?.rows)) return
        // The route already orders newest-first; the map only drops unknowns.
        const next = j.rows.map(toItem).filter((x): x is AlertItem => x !== null)
        // A poll that found nothing new must not hand React a new array — a new
        // array is a new render of the pill and the open panel every 20 seconds,
        // which is the other half of the flashing. `id` is the row's primary
        // key, so newest-id + count is enough to tell "same list" from "changed".
        const sig = `${next.length}:${next[0]?.id ?? 0}`
        if (sig === sigRef.current) return
        sigRef.current = sig
        setItems(next)
      } catch {
        // Offline, or a free account the proxy gate refuses. Keep what is on
        // screen — an empty toolbar is a worse lie than a slightly stale one.
      }
    }

    void load()
    const tick = () => {
      if (!document.hidden) void load()
    }
    const id = window.setInterval(tick, FEED_POLL_MS)
    document.addEventListener('visibilitychange', tick)
    return () => {
      alive = false
      window.clearInterval(id)
      document.removeEventListener('visibilitychange', tick)
    }
  }, [])

  return items
}

/** "18s", "4m", "2h" — the pill has room for three characters, not a clock. */
function age(at: string): string {
  const [h, m] = at.split(':').map(Number)
  // The null check is what NARROWS: `Number.isFinite` takes `unknown` and
  // returns a plain boolean, so it rejects NaN but leaves both halves typed
  // `number | undefined` — which is what a string with no colon in it destructures
  // to. Both guards are needed; neither covers the other's case.
  if (h == null || m == null || !Number.isFinite(h) || !Number.isFinite(m)) return ''
  const now = new Date()
  let mins = now.getHours() * 60 + now.getMinutes() - (h * 60 + m)
  if (mins < 0) mins += 24 * 60
  if (mins < 1) return 'now'
  if (mins < 60) return `${mins}m`
  return `${Math.floor(mins / 60)}h`
}

export function AlertsPill() {
  const items = useAlertsFeed()
  const [open, setOpen] = useState(false)
  const wrapRef = useRef<HTMLDivElement | null>(null)

  // pointerdown rather than click so a drag that starts outside closes too —
  // matching BzilaAlerts and BotAlert.
  useEffect(() => {
    if (!open) return
    const onDown = (e: PointerEvent) => {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false)
    }
    window.addEventListener('pointerdown', onDown)
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('pointerdown', onDown)
      window.removeEventListener('keydown', onKey)
    }
  }, [open])

  const latest = items[0]
  const type = latest ? TYPE_BY_ID[latest.kind] : null
  const rest = Math.max(0, items.length - 1)

  // Fresh = drawn in the type's colour with a pulsing dot. Older than an hour
  // and the pill goes quiet: a bar that is permanently lit stops meaning
  // anything, which is the failure mode of every notification badge.
  const fresh = useMemo(() => !!latest && !age(latest.at).endsWith('h'), [latest])

  // FLASH ON ARRIVAL. `latest.id` is the row's primary key, so a poll that
  // changed nothing cannot fire this — that was the old flashing bug, and the
  // signature check in `useAlertsFeed` plus this id compare are the two halves
  // of not repeating it.
  //
  // The first load never flashes: opening the dashboard at 2pm should not
  // announce a signal from 9:40 as if it just happened. `seenRef` starting at
  // null is what distinguishes "first list I have seen" from "a new top row".
  const [flash, setFlash] = useState(false)
  const seenRef = useRef<number | null>(null)
  const latestId = latest?.id ?? null

  useEffect(() => {
    if (latestId == null) return
    if (seenRef.current === null) {
      seenRef.current = latestId
      return
    }
    if (latestId === seenRef.current) return
    seenRef.current = latestId
    // Off for one frame first: re-applying a class that is already on does not
    // restart a CSS animation, so back-to-back alerts would flash once.
    setFlash(false)
    const raf = requestAnimationFrame(() => setFlash(true))
    const t = window.setTimeout(() => setFlash(false), FLASH_MS)
    return () => {
      cancelAnimationFrame(raf)
      window.clearTimeout(t)
    }
  }, [latestId])

  return (
    /* `min-w-0` + `shrink` is what lets this yield: without min-w-0 a flex item
       refuses to go below its content width, and the pill pushed the clock, the
       ticker picker and the account menu off the right edge of the toolbar on
       anything narrower than a wide desktop. It gives up its headline first,
       then its own width, and never the controls beside it. */
    <div ref={wrapRef} className="relative min-w-0 shrink">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="menu"
        aria-expanded={open}
        title={latest ? `${TYPE_BY_ID[latest.kind].name} — ${latest.text}` : 'Signal alerts'}
        style={{ '--alert-flash': type?.color ?? 'var(--color-warn)' } as CSSProperties}
        className={[
          // NO BOX. The coloured tag is the only edge in here: a bordered pill
          // beside the wordmark read as a second button competing with the
          // brand, and the tag already says what kind of alert this is. Hover
          // is the only affordance it needs — the row is still a button.
          //
          // THE FLASHING BORDER (2026-09-15) was the browser's default focus
          // ring. Clicking the pill focuses it, the ring stays after the panel
          // closes, and every poll that re-rendered the button made it blink.
          // `outline-none` kills the mouse case; `focus-visible` puts a proper
          // ring back for keyboard users only, where it belongs.
          'outline-none focus-visible:ring-1 focus-visible:ring-accent',
          'flex h-6 max-w-[7rem] items-center gap-1.5 overflow-hidden rounded-sm px-1.5 transition-colors lg:max-w-[13rem] xl:max-w-[16rem]',
          open ? 'bg-raised' : 'hover:bg-raised',
          fresh ? '' : 'opacity-90',
          // The arrival flash — the type's colour, three beats, then gone.
          flash ? 'alert-flash' : '',
        ].join(' ')}
      >
        {latest && type ? (
          <>
            {/* The dot. It is the only moving thing in the toolbar, and only
                while the newest alert is still recent. */}
            {fresh && (
              <span
                aria-hidden
                className="h-1.5 w-1.5 shrink-0 rounded-full"
                style={{ background: type.color, boxShadow: `0 0 6px ${alpha(type.color, 0.7)}` }}
              />
            )}
            <span
              className="shrink-0 rounded-[2px] border px-1 text-3xs font-bold uppercase leading-[13px] tracking-wide"
              style={{ borderColor: type.color, color: type.color }}
            >
              {type.tag}
            </span>
            {/* `short`, never `text`. A toolbar that truncates a sentence
                mid-word is a toolbar that was handed the wrong string. Under
                `lg` even this goes, leaving dot + tag + age + count. */}
            <span className="hidden truncate text-2xs text-fg lg:inline">{latest.short}</span>
            <span className="shrink-0 text-3xs tabular-nums text-fg">{age(latest.at)}</span>
            {rest > 0 && (
              <span className="ml-0.5 shrink-0 pl-1 text-3xs font-bold text-warn">+{rest}</span>
            )}
          </>
        ) : (
          <>
            <span className="shrink-0 text-3xs font-bold uppercase leading-[13px] tracking-wide text-fg">
              Alerts
            </span>
            <span className="hidden truncate text-2xs text-fg lg:inline">No signals yet</span>
          </>
        )}
        <span aria-hidden className="shrink-0 text-3xs text-fg">
          {open ? '▲' : '▾'}
        </span>
      </button>

      {open && (
        <Suspense fallback={null}>
          <AlertsPanel items={items} close={() => setOpen(false)} />
        </Suspense>
      )}
    </div>
  )
}

export default AlertsPill
