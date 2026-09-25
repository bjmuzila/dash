import { useEffect, useMemo, useRef, useState, type MouseEvent as ReactMouseEvent } from 'react'
import { createPortal } from 'react-dom'
import { useQuery } from '@/data/api'
import { fmtPremium, fmtStrike, roundStrike } from '@/data/flowMath'
import { CopyShotButton, type CopyShotTarget } from '@/shell/CopyShot'
import voltickBolt from '@/assets/voltick-bolt.png'
import type { TopFlowRow } from './TopFlowCard'

/**
 * THE ALERT BEHIND THE CHART (2026-09-24) — for a probe opened from Tracked
 * contracts. Popped out, the panel becomes a TRADE CARD (layout D, picked by
 * Brandon): contract and print line on the left, the move as the hero number
 * on the right, the chart, then the note as a quote and the tracked date. The
 * 📸 photographs it BARE — no CB Edge caption band or mark — and the card
 * carries its own `voltick.io/bzila` line instead. Every word on it is fg
 * (white), never muted/faint: it is a picture for posting, not a panel.
 * Omitted everywhere else, so every other probe is unchanged.
 */
export interface ProbeAlertInfo {
  /** Stable CopyShot id, e.g. `tracked:42`. */
  shotId: string
  /** The CopyShot label (menu/tooltip). Nothing prints it — the shot is bare. */
  shotLabel: string
  /** Download stem when the clipboard refuses. */
  file?: string
  /** Under the title: "Whale print · $1.20M · 3,880 ct @ 3.10 · Sep 23 10:42 AM". */
  headline: string
  /** "22d", or null when the expiry cannot be read. */
  dteLabel: string | null
  /** Epoch ms the contract was tracked. */
  trackedAt: number
  note?: string
  /**
   * The pill on the card's bottom row. Defaults to "TRACKED <day>"; a surface
   * that is not a tracked contract names itself instead (Repeated flow prints
   * "REPEATED 7× · SEP 24").
   */
  badge?: string
  /**
   * LAYOUT A (2026-09-25, Brandon): the row's facts as separate tiles above
   * the chart — Contract, Expiry, Entry, Mark, Move, Size, Premium, Tracked.
   * Every trade card is layout A; omitted, the probe builds the eight tiles
   * from the row and its live bars (the D card is retired).
   */
  items?: Array<{ k: string; v: string; ink?: string; sub?: string }>
}

// ─────────────────────────────────────────────────────────────────────────────
// CONTRACT PROBE — what the print did after it printed.
//
// Opened by clicking a row in Top Flow. The treatment is the owner probe's
// (owner-vite/src/pages/Probe.tsx) and premarket's Core Contracts chart, so the
// same picture reads the same way on all three: ice line over a fading wash, a
// dashed break-even at the fill, the high marked green and the low red, a
// RIGHT-HAND price rail with the last mark in a pill tinted by P/L, and the
// contract's own volume sharing the x axis underneath.
//
// ── TWO SOURCES, AND THE CLIENT PICKS ────────────────────────────────────────
// A print from TODAY is drawn from /proxy/option-history — dxLink, the same feed
// the /flow drawer already rides, and the freshest thing available. Anything
// older comes from /api/lse/contract-candles, because option-history is anchored
// to the print's own session and will not reach back.
//
// The choice is made HERE rather than server-side for one reason: this component
// knows the print's timestamp, and the server would have to be told it anyway.
// Both routes answer the same `{ time, open, high, low, close, volume }` shape,
// so nothing below cares which one replied.
//
// It also FALLS BACK either way on an empty answer. That is not belt-and-braces:
// a contract that expired inside the vault's ~120-day window is gone from dxLink
// long before it is gone from the vault, and a 0DTE that printed an hour ago is
// in dxLink before the vault has it. Whichever we ask first, the other one is
// sometimes the one holding the bars.
//
// ── WHY IT CAN LEGITIMATELY HAVE NOTHING ─────────────────────────────────────
// The vault drops expired contracts about 120 days after expiry and its archive
// begins 2026-01-02 (md files/LSE-DATA-LIMITS.md). Past either edge there is no
// chart to draw and never will be, so the panel says which edge it hit instead
// of showing an empty frame that reads as a bug.
// ─────────────────────────────────────────────────────────────────────────────

export interface Bar {
  /** Epoch ms, bar open. */
  time: number
  open: number
  high: number
  low: number
  close: number
  volume: number
}
export interface BarsResponse { bars: Bar[]; count?: number; source?: string; error?: string }

type Range = '1d' | '3d' | '1w' | '1m'
const RANGES: Array<{ key: Range; label: string; days: number }> = [
  { key: '1d', label: '1D', days: 0 },
  { key: '3d', label: '3D', days: 2 },
  { key: '1w', label: '1W', days: 6 },
  { key: '1m', label: '1M', days: 29 },
]

const ymd = (ms: number) =>
  new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(new Date(ms))

const etTime = (ms: number) =>
  new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York', hour: '2-digit', minute: '2-digit', hour12: true,
  }).format(new Date(ms))

/** "Sep 24" in ET. */
const etDay = (ms: number) =>
  new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', month: 'short', day: 'numeric' }).format(new Date(ms))

/**
 * "Sep 24 09:30 AM". The DATE leads every time printed on a picture: a
 * snapshot cannot be hovered, so a bare "09:30 AM" posted a week later says
 * nothing about which session it was (2026-09-24).
 */
const etDayTime = (ms: number) => `${etDay(ms)} ${etTime(ms)}`

const fmtDate = (iso: string | null) => {
  if (!iso) return '—'
  const d = new Date(`${iso}T00:00:00Z`)
  if (Number.isNaN(d.getTime())) return iso
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: '2-digit', timeZone: 'UTC' })
}

/** ~120 days past expiry the vault drops the contract; before this there is nothing at all. */
const VAULT_FLOOR_MS = Date.parse('2026-01-02T00:00:00Z')
const VAULT_EXPIRY_GRACE_DAYS = 120

// ─────────────────────────────────────────────────────────────────────────────
// SOURCE PICKING, LIFTED OUT OF THE COMPONENT
//
// The Tracked contracts card has to load the SAME bars this panel loads, from
// outside a render — once to freeze the picture the moment a contract is
// tracked, and once per row to put a mark in the list. Two copies of "which
// route holds this contract" is two things to keep in step, and the copy that
// drifts is the one that quietly stops finding anything.
// ─────────────────────────────────────────────────────────────────────────────

/** The part of a row that decides where its bars come from. */
export interface ProbeKey {
  underlying: string | null
  expiry: string | null
  strike: number | null
  type: string | null
  osi: string | null
  /** The print's own moment — or "now" for a contract nobody printed into. */
  ts: number
}

/** Both routes that might hold this contract, best bet first. Either can be null. */
export function probeUrls(row: ProbeKey, startMs: number): Array<string | null> {
  // Rounded, not raw: this value goes into `?strike=` below, and the vault
  // matches on the exact string — `504.99999999999994` finds nothing.
  const strike = roundStrike(row.strike) ?? 0
  const hasParts = Boolean(row.underlying && row.expiry && strike > 0 && row.type)
  const proxy = hasParts
    ? `/proxy/option-history?${new URLSearchParams({
        ticker: row.underlying!, expiry: row.expiry!, strike: String(strike), type: row.type!,
        start: ymd(startMs), end: ymd(Date.now()),
      }).toString()}`
    : null
  const vault = row.osi
    ? `/api/lse/contract-candles?${new URLSearchParams({
        ticker: row.osi, start: ymd(startMs), end: ymd(Date.now() + 86_400_000),
      }).toString()}`
    : hasParts
      ? `/api/lse/contract-candles?${new URLSearchParams({
          underlying: row.underlying!, strike: String(strike), expiry: row.expiry!,
          type: row.type === 'C' ? 'call' : 'put',
          start: ymd(startMs), end: ymd(Date.now() + 86_400_000),
        }).toString()}`
      : null
  // Today's print reads dxLink first; anything older goes to the vault first.
  return ymd(row.ts) === ymd(Date.now()) ? [proxy, vault] : [vault, proxy]
}

/**
 * The bars, from whichever of the two routes has them. Same fallback the panel
 * does: an EMPTY answer is not an error, it is the other source's turn.
 *
 * `days` is how far back from the row's own moment to read — 0 is that session,
 * 2 is the 3D window the card freezes at.
 */
export async function loadProbeBars(row: ProbeKey, days = 2, signal?: AbortSignal): Promise<Bar[]> {
  const urls = probeUrls(row, row.ts - days * 86_400_000)
  for (const u of urls) {
    if (!u) continue
    try {
      const r = await fetch(u, { credentials: 'same-origin', signal })
      if (!r.ok) continue
      const j = (await r.json()) as BarsResponse
      const bars = (j?.bars ?? []).filter((b) => b && b.close > 0)
      if (bars.length) return bars
    } catch {
      /* try the other source; a dead route is not a dead contract */
    }
  }
  return []
}

export function ContractProbe({ row, onClose, entryAt, alertInfo: alertInfoProp, shareAs }: {
  row: TopFlowRow
  onClose: () => void
  /** Tracked-contract details for the pop-out strip and its snapshot. */
  alertInfo?: ProbeAlertInfo
  /**
   * Give an ordinary probe the pop-out trade card + 📸 Snapshot too, labelled
   * with this word ("Whale print", "Lookup"). Ignored when `alertInfo` is set.
   * The whale page passes it on every probe; the board's Top Flow does not.
   */
  shareAs?: string
  /**
   * When the entry price is NOT tied to a moment — a hand-typed cost basis on
   * the whale page's contract lookup, say — pass null and the chart draws the
   * entry as a rung with no marker. Left undefined it is the print's own
   * timestamp, which is the normal case.
   *
   * Without this a typed entry would be marked at `row.ts`, and a lookup's
   * `ts` is "now" — so the dot would land on the last bar of the day at a price
   * nothing traded at there.
   */
  entryAt?: number | null
}) {
  const [range, setRange] = useState<Range>('1d')

  // A probe opened with `shareAs` builds its own trade-card details from the
  // row: what printed, how big, at what, and WHEN — date first.
  const alertInfo = useMemo<ProbeAlertInfo | undefined>(() => {
    if (alertInfoProp) return alertInfoProp
    if (!shareAs) return undefined
    const bits = [shareAs]
    if (row.premium) bits.push(fmtPremium(row.premium))
    if (row.size) bits.push(`${row.size.toLocaleString()} ct${row.price != null ? ` @ ${row.price.toFixed(2)}` : ''}`)
    if (row.ts) bits.push(etDayTime(row.ts))
    const expMs = row.expiry ? Date.parse(`${String(row.expiry).slice(0, 10)}T16:00:00-04:00`) : NaN
    const days = Number.isFinite(expMs) ? Math.max(0, Math.ceil((expMs - Date.now()) / 864e5)) : null
    return {
      shotId: `probe:${row.id}`,
      shotLabel: shareAs,
      file: `${shareAs.toLowerCase().replace(/[^a-z0-9]+/g, '-')}-${row.underlying ?? ''}-${row.strike ?? ''}${row.type ?? ''}-${row.expiry ?? ''}`,
      headline: bits.join(' · '),
      dteLabel: days != null ? `${days}d` : null,
      trackedAt: row.ts || Date.now(),
      badge: `${shareAs.toUpperCase()} · ${etDay(row.ts || Date.now()).toUpperCase()}`,
    }
  }, [alertInfoProp, shareAs, row])
  // 0 = the source the print's age says to try; 1 = the other one. Reset on
  // every row and every range, or a fallback taken for one contract sticks to
  // the next.
  const [attempt, setAttempt] = useState(0)
  useEffect(() => { setAttempt(0) }, [row.id, range])

  const span = RANGES.find((r) => r.key === range) ?? RANGES[0]!
  const startMs = row.ts - span.days * 86_400_000

  const urls = useMemo(
    () => probeUrls(row, startMs),
    [row.underlying, row.expiry, row.strike, row.type, row.osi, row.ts, startMs],
  )

  const url = urls[attempt] ?? null
  const q = useQuery<BarsResponse>(url, { staleMs: 30_000 })
  const bars = useMemo(() => (q.data?.bars ?? []).filter((b) => b.close > 0), [q.data])

  // An empty answer is not an error — it is the other source's turn. Neither
  // is a FAILED one (2026-09-22): the vault answers 429 "too many concurrent
  // requests" while the whale page's HIGH column is reading it, and that used
  // to strand the panel on an error line when the other route had the bars.
  useEffect(() => {
    if (attempt !== 0 || !urls[1]) return
    if ((q.data && bars.length === 0) || (q.error && !q.loading)) setAttempt(1)
  }, [attempt, q.data, q.error, q.loading, bars.length, urls])

  // Why there is nothing, when there is nothing. Both of these are permanent
  // facts about the archive, not a failed request, and saying so is the
  // difference between "no data" and "this will never load".
  const expiredOut = useMemo(() => {
    if (!row.expiry) return false
    const exp = Date.parse(`${row.expiry}T00:00:00Z`)
    return Number.isFinite(exp) && Date.now() - exp > VAULT_EXPIRY_GRACE_DAYS * 86_400_000
  }, [row.expiry])
  const beforeArchive = row.ts < VAULT_FLOOR_MS

  const entry = row.price
  const last = bars.length ? bars[bars.length - 1]!.close : null
  const pct = entry != null && entry > 0 && last != null ? ((last - entry) / entry) * 100 : null
  const perCt = entry != null && last != null ? (last - entry) * 100 : null
  const dir = pct == null ? 0 : pct > 0 ? 1 : pct < 0 ? -1 : 0
  const ink = dir > 0 ? 'text-up' : dir < 0 ? 'text-down' : 'text-muted'

  // The probe lives in a ~330px column inside the card, which is where a chart
  // carrying an entry line, a high, a low, a price rail and a volume histogram
  // stops being readable. The ⤢ pops the SAME panel out over the page — see the
  // portal at the bottom of this return.
  const [expanded, setExpanded] = useState(false)
  // The popped-out panel — what the 📸 photographs. Resolved at click time,
  // as CopyShotTarget.resolve asks, because the portal mounts and unmounts.
  const panelRef = useRef<HTMLDivElement | null>(null)
  // The trade card itself, INSIDE the scrolling panel. The panel is capped at
  // 92vh with overflow:auto, and photographing it cropped the picture to what
  // was on screen — the TRACKED pill and the voltick.io/bzila footer fell off
  // the bottom (2026-09-24). This node is always its full natural height.
  const cardRef = useRef<HTMLDivElement | null>(null)
  const shotTarget = useMemo<CopyShotTarget | null>(
    () => alertInfo
      ? {
          id: alertInfo.shotId,
          icon: '📌',
          label: alertInfo.shotLabel,
          file: alertInfo.file,
          // No caption band, no CB Edge mark — the card signs itself.
          bare: true,
          resolve: () => cardRef.current ?? panelRef.current,
        }
      : null,
    [alertInfo],
  )
  useEffect(() => {
    if (!expanded) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setExpanded(false) }
    window.addEventListener('keydown', onKey)
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      window.removeEventListener('keydown', onKey)
      document.body.style.overflow = prev
    }
  }, [expanded])

  const body = (big: boolean) => (
    <>
      <div className="flex items-baseline gap-2">
        <span className={[big ? 'text-lg' : 'text-sm', 'font-bold tracking-[0.02em] text-fg'].join(' ')}>
          {row.underlying ?? '—'}
        </span>
        <span className={[
          'tabular rounded-sm border border-warn/50 bg-warn/10 px-1.5 py-px font-bold text-warn',
          big ? 'text-xs' : 'text-2xs',
        ].join(' ')}>
          {fmtStrike(row.strike)}{row.type ?? ''}
        </span>
        <span className="ml-auto flex items-center gap-2">
          <button
            type="button"
            onClick={() => setExpanded((v) => !v)}
            aria-label={big ? 'Collapse' : 'Expand'}
            title={big ? 'Collapse (Esc)' : 'Expand'}
            className="flex h-6 w-6 items-center justify-center rounded-sm border border-line text-muted hover:text-fg"
          >
            <ProbeExpandIcon size={12} collapse={big} />
          </button>
          <button
            type="button"
            onClick={() => (big ? setExpanded(false) : onClose())}
            aria-label="Close"
            className="text-sm leading-none text-muted hover:text-fg"
          >
            ✕
          </button>
        </span>
      </div>
      <div className="tabular -mt-1 text-2xs text-muted">{fmtDate(row.expiry)}</div>


      <div className="flex items-center gap-2">
        <span className={[big ? 'text-xl' : 'text-base', 'leading-none', ink].join(' ')}>{dir < 0 ? '▼' : '▲'}</span>
        <span className={['tabular font-bold leading-none', big ? 'text-4xl' : 'text-2xl', ink].join(' ')}>
          {pct == null ? '—' : `${Math.abs(pct).toFixed(1)}%`}
        </span>
      </div>

      <div className="tabular text-2xs text-muted">
        <span className="text-3xs text-faint">IN</span> <span className="text-fg">{entry?.toFixed(2) ?? '—'}</span>
        {' → '}
        <span className="text-3xs text-faint">NOW</span> <span className="text-fg">{last?.toFixed(2) ?? '—'}</span>
        {perCt != null && (
          <>
            {' · '}
            <span className={ink}>{perCt >= 0 ? '+' : '−'}${Math.abs(perCt).toFixed(0)}/ct</span>
          </>
        )}
      </div>
      <div className="tabular text-2xs text-muted">
        <span className="text-3xs text-faint">SIZE</span> <span className="text-fg">{row.size?.toLocaleString() ?? '—'}</span>
        {' · '}
        <span className="text-3xs text-faint">PREM</span> <span className="text-fg">{fmtPremium(row.premium)}</span>
        {/* Vol/OI are LIVE numbers, joined at serve time on the Top Flow card.
            An archived whale print carries neither — there is no "now" for it —
            so the pair is omitted rather than printed as two permanent dashes.
            A dash means "this should have a value and does not"; on that surface
            they never will, which is a different statement. Either both are
            present (Top Flow) or neither is (the archive). */}
        {row.vol !== null || row.oi !== null ? (
          <>
            {' · '}
            <span className="text-3xs text-faint">VOL</span> <span className="text-fg">{row.vol?.toLocaleString() ?? '—'}</span>
            {' · '}
            <span className="text-3xs text-faint">OI</span> <span className="text-fg">{row.oi?.toLocaleString() ?? '—'}</span>
          </>
        ) : null}
      </div>

      <div className="flex shrink-0 items-center gap-1.5 border-t border-line pt-2">
        {RANGES.map((r) => (
          <button
            key={r.key}
            type="button"
            onClick={() => setRange(r.key)}
            className={[
              'tabular rounded-sm border px-2 py-0.5 text-2xs transition-colors',
              range === r.key ? 'border-fg/25 bg-raised text-fg' : 'border-line text-muted hover:text-fg',
            ].join(' ')}
          >
            {r.label}
          </button>
        ))}
        <span className="ml-auto text-3xs text-faint">
          {q.loading && !bars.length ? 'loading…' : q.data?.source === 'lse' ? 'vault' : bars.length ? 'live' : ''}
        </span>
      </div>

      {bars.length >= 2 ? (
        <ProbeChart bars={bars} entry={entry} entryTs={entryAt === undefined ? row.ts : entryAt} size={row.size} wide={big} />
      ) : (
        <div className="px-1 py-6 text-2xs leading-relaxed text-faint">
          {q.loading
            ? 'Loading…'
            : beforeArchive
              ? 'This print is older than the contract archive, which begins 2026-01-02. There are no bars for it and there will not be.'
              : expiredOut
                ? 'This contract expired more than ~120 days ago and has aged out of the archive. Nothing to draw.'
                : q.error
                  // Never the raw message: api.ts puts the request URL in it,
                  // and a path with a query string is not something to show.
                  ? 'Could not load this contract’s bars right now — try again in a moment.'
                  : 'No bars for this contract in the window.'}
        </div>
      )}

      <div className="tabular text-3xs text-faint">
        Option price (mark) · contract volume · entry @ {entry?.toFixed(2) ?? '—'} · printed {etTime(row.ts)}
        {big ? ' · click outside or press Esc to close' : ''}
      </div>
    </>
  )

  // ── THE TRADE CARD (layout D) ─────────────────────────────────────────────
  // Only for a tracked contract, only popped out. The controls row and the
  // range buttons wear data-capture-hide: a stacked hidden row gives its
  // height back, so the PNG is the card and nothing else.
  const dollars = perCt != null && row.size ? perCt * row.size : null
  const tradeCard = (info: ProbeAlertInfo) => {
    const trackedDay = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', month: 'short', day: 'numeric' })
      .format(new Date(info.trackedAt)).toUpperCase()
    const stamp = new Intl.DateTimeFormat('en-US', {
      timeZone: 'America/New_York', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', hour12: true,
    }).format(new Date())
    // Bottom right on every card: the Voltick bolt and the handle. Same-origin
    // asset, so the capture inlines it (a cross-origin one would be dropped).
    const signature = (
      <div className="tabular flex items-center justify-between border-t border-line pt-2 text-xs text-fg">
        <span>{stamp} ET</span>
        <span className="flex items-center gap-2 text-sm font-bold tracking-[0.02em]">
          <img src={voltickBolt} alt="" className="h-6 w-6 rounded-sm" />
          voltick.io/bzila
        </span>
      </div>
    )
    const controls = (
        <div data-capture-hide className="flex items-center justify-end gap-2 px-5 pt-4">
          {shotTarget && (
            <CopyShotButton
              target={shotTarget}
              label="Snapshot"
              className="flex h-6 items-center rounded-sm border border-line px-2 text-2xs font-bold uppercase tracking-[0.08em] hover:text-fg"
            />
          )}
          <button
            type="button"
            onClick={() => setExpanded(false)}
            aria-label="Collapse"
            title="Collapse (Esc)"
            className="flex h-6 w-6 items-center justify-center rounded-sm border border-line text-fg"
          >
            <ProbeExpandIcon size={12} collapse />
          </button>
          <button
            type="button"
            onClick={() => setExpanded(false)}
            aria-label="Close"
            className="text-sm leading-none text-fg"
          >
            ✕
          </button>
        </div>
    )
    const ranges = (
        <div data-capture-hide className="flex shrink-0 items-center gap-1.5">
          {RANGES.map((r) => (
            <button
              key={r.key}
              type="button"
              onClick={() => setRange(r.key)}
              className={[
                'tabular rounded-sm border px-2 py-0.5 text-2xs text-fg transition-colors',
                range === r.key ? 'border-fg/25 bg-raised' : 'border-line',
              ].join(' ')}
            >
              {r.label}
            </button>
          ))}
          <span className="ml-auto text-3xs text-fg">
            {q.loading && !bars.length ? 'loading…' : ''}
          </span>
        </div>
    )
    const chart = bars.length >= 2 ? (
      <ProbeChart bars={bars} entry={entry} entryTs={entryAt === undefined ? row.ts : entryAt} size={row.size} wide />
    ) : (
      <div className="px-1 py-6 text-xs text-fg">
        {q.loading ? 'Loading…' : 'No bars for this contract in the window.'}
      </div>
    )

    // ── LAYOUT A — separate tiles on top (Brandon, 2026-09-25) ──────────────
    // Each fact is its own card with a gap between, not one joined grid; the
    // note is its own card under them; then the move, the chart, the bolt.
    // EVERY trade card is A — tracked, whale print, lookup, repeated flow. A
    // caller that passes no `items` (everything but Tracked contracts) gets
    // eight tiles built from the row and the live bars, and keeps its headline
    // line under the title, which is where a burst says "7 orders · 12:01 →".
    const derived = !info.items?.length
    const items: NonNullable<ProbeAlertInfo['items']> = info.items?.length ? info.items : [
      { k: 'Contract', v: `${row.underlying ?? '—'} ${fmtStrike(row.strike)}${row.type ?? ''}`, sub: info.shotLabel },
      { k: 'Expiry', v: fmtDate(row.expiry), sub: info.dteLabel ? `${info.dteLabel} to expiry` : undefined },
      { k: 'Entry', v: entry?.toFixed(2) ?? '—', sub: row.ts && entryAt !== null ? `printed ${etDayTime(row.ts)}` : undefined },
      { k: 'Mark', v: last?.toFixed(2) ?? '—' },
      {
        k: 'Move',
        v: pct == null ? '—' : `${pct >= 0 ? '+' : '−'}${Math.abs(pct).toFixed(1)}%`,
        sub: dollars != null ? `${dollars >= 0 ? '+' : '−'}${fmtPremium(Math.abs(dollars))}` : undefined,
        ink,
      },
      { k: 'Size', v: row.size ? `${row.size.toLocaleString()} ct` : '—' },
      { k: 'Premium', v: row.premium ? fmtPremium(row.premium) : '—' },
      { k: 'When', v: etDayTime(info.trackedAt) },
    ]
      return (
        <>
          {controls}
          <div ref={cardRef} data-capture-signed className="flex flex-col gap-3 bg-surface2 px-5 pb-5 pt-2">
            <div className="flex items-center gap-2">
              <span className="text-xl font-bold leading-none tracking-[0.02em] text-fg">{row.underlying ?? '—'}</span>
              <span className="tabular inline-flex h-5 items-center justify-center rounded-sm border border-warn/50 bg-warn/10 px-1.5 text-xs font-bold leading-none text-warn">
                {fmtStrike(row.strike)}{row.type ?? ''}
              </span>
              <span className="tabular text-sm text-fg">
                {fmtDate(row.expiry)}{info.dteLabel ? ` · ${info.dteLabel}` : ''}
              </span>
              <span className="tabular ml-auto inline-flex h-5 shrink-0 items-center justify-center rounded-sm bg-accent/15 px-1.5 text-2xs font-bold leading-none tracking-[0.08em] text-accent">
                {info.badge ?? `TRACKED ${trackedDay}`}
              </span>
            </div>
            {derived && info.headline ? (
              <div className="tabular -mt-1 text-xs text-fg">{info.headline}</div>
            ) : null}

            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              {items.map((it) => (
                <div key={it.k} className="min-w-0 rounded-md border border-line bg-surface px-3 py-2">
                  <div className="text-3xs font-bold uppercase tracking-[0.1em] text-fg">{it.k}</div>
                  <div className={['tabular mt-0.5 truncate text-base font-semibold', it.ink ?? 'text-fg'].join(' ')}>{it.v}</div>
                  {it.sub && <div className="tabular truncate text-2xs text-fg">{it.sub}</div>}
                </div>
              ))}
            </div>

            {info.note ? (
              <div className="rounded-md border border-line bg-surface px-3 py-2 text-sm text-fg">
                <span className="mr-2 text-3xs font-bold uppercase tracking-[0.1em] text-fg">Note</span>
                {info.note}
              </div>
            ) : null}

            <div className="flex items-baseline gap-2">
              <span className={['text-xl leading-none', ink].join(' ')}>{dir < 0 ? '▼' : '▲'}</span>
              <span className={['tabular text-4xl font-bold leading-none', ink].join(' ')}>
                {pct == null ? '—' : `${Math.abs(pct).toFixed(1)}%`}
              </span>
              <span className="tabular text-xs text-fg">
                IN {entry?.toFixed(2) ?? '—'} → NOW {last?.toFixed(2) ?? '—'}
                {perCt != null && (
                  <>
                    {' · '}
                    <span className={ink}>{perCt >= 0 ? '+' : '−'}${Math.abs(perCt).toFixed(0)}/ct</span>
                  </>
                )}
              </span>
            </div>

            {ranges}
            {chart}
            {signature}
          </div>
        </>
      )
  }

  return (
    <>
      <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto px-3 py-2">{body(false)}</div>

      {/* Popped out over the page. Portalled onto <body> because every ancestor —
          the probe column, the card, the board tile — clips or stacks, and an
          overlay drawn inside any of them is trimmed to that box. The four
          properties that decide whether it is visible at all are inline rather
          than utilities, for the same reason the notes clip lightbox does it:
          this node lives outside the app root, where a purged or shadowed class
          would leave it a 0×0 transparent box and the button would read dead. */}
      {expanded && typeof document !== 'undefined' && createPortal(
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Contract probe"
          onClick={() => setExpanded(false)}
          style={{
            position: 'fixed',
            inset: 0,
            zIndex: 9999,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: 24,
            background: 'color-mix(in srgb, var(--color-bg) 90%, transparent)',
          }}
        >
          <div
            ref={panelRef}
            onClick={(e) => e.stopPropagation()}
            className={[
              'flex flex-col rounded-md border border-line bg-surface2',
              // The trade card carries its own padding so the photograph has it.
              alertInfo ? 'gap-0 p-0' : 'gap-3 p-5',
            ].join(' ')}
            style={{
              width: 'min(1100px, 94vw)',
              maxHeight: '92vh',
              minHeight: 0,
              overflowY: 'auto',
            }}
          >
            {alertInfo ? tradeCard(alertInfo) : body(true)}
          </div>
        </div>,
        document.body,
      )}
    </>
  )
}

/** Four corner arrows out (expand) or in (collapse). */
function ProbeExpandIcon({ size = 12, collapse = false }: { size?: number; collapse?: boolean }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {collapse ? (
        <>
          <polyline points="20 10 14 10 14 4" />
          <polyline points="4 14 10 14 10 20" />
          <line x1="14" y1="10" x2="21" y2="3" />
          <line x1="10" y1="14" x2="3" y2="21" />
        </>
      ) : (
        <>
          <polyline points="15 3 21 3 21 9" />
          <polyline points="9 21 3 21 3 15" />
          <line x1="21" y1="3" x2="14" y2="10" />
          <line x1="3" y1="21" x2="10" y2="14" />
        </>
      )}
    </svg>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// The picture.
//
// Every label is `--color-fg` — not a white alpha. Chart type sits over a wash
// and a line, and an alpha that reads fine on a flat card turns to mud over the
// gradient. Colours go through `style`, never presentation attributes: a var()
// in stroke="" does not resolve and the chart falls back to black.
// ─────────────────────────────────────────────────────────────────────────────

const MONO = 'ui-monospace,Menlo,Consolas,monospace'

export function ProbeChart({ bars, entry, entryTs, size, wide = false }: {
  bars: Bar[]
  entry: number | null
  /** Epoch ms of the print. Places the entry MARKER on the line — the dashed
   *  rung says what was paid, the dot says when. */
  entryTs?: number | null
  size: number | null
  /** Popped out over the page — a bigger canvas, and type scaled to match it. */
  wide?: boolean
}) {
  const [hover, setHover] = useState<number | null>(null)

  // ── THE CANVAS IS MEASURED, NOT FIXED ───────────────────────────
  // The svg is `width: 100%`, so a fixed viewBox means the whole picture is
  // scaled by whatever box it lands in — and every size in here is in USER
  // units. A 320-unit viewBox in the ~990px pane of the tracked-alerts two-up
  // drew the 9px labels at nearly thirty, which is the same bug as the board
  // column drawing them at six, just the other way round. Measuring the
  // container and setting the viewBox width to it keeps one user unit at one
  // CSS pixel, so type is the size it was written at whatever the placement is.
  const boxRef = useRef<HTMLDivElement | null>(null)
  const [cw, setCw] = useState<number | null>(null)
  useEffect(() => {
    const el = boxRef.current
    if (!el || typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver((entries) => {
      const w = entries[0]?.contentRect.width
      if (w && w > 0) setCw(w)
    })
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  const clamp = (v: number, lo: number, hi: number) => (v < lo ? lo : v > hi ? hi : v)
  // The fallbacks are the old fixed widths, so the first paint before the
  // observer fires is the chart it always was rather than a collapsed one.
  const W = Math.round(clamp(cw ?? (wide ? 1000 : 320), wide ? 560 : 260, 1600))
  // Height tracks width so the picture does not letterbox, but it is CAPPED: a
  // wide pane should get a wider chart, not a taller page.
  const H = wide
    ? Math.round(clamp(W * 0.42, 300, 520))
    : Math.round(clamp(W * 0.78, 190, 320))
  // Padding is keyed off the type scale rather than a wide/narrow flag, so the
  // price rail always has exactly the room its own labels need.
  const PS = wide ? 1.3 : 1
  const PADL = Math.round(6 + 4 * PS)
  // Wide enough for the last-mark pill (38*S) plus its 2-unit offset.
  const PADR = Math.round(42 + 14 * PS)
  const PADT = Math.round(12 + 6 * PS)
  const PADB = Math.round(18 + 8 * PS)
  const GAP = Math.round(7 + 5 * PS)
  const volH = Math.round((H - PADT - PADB - GAP) * 0.24)
  const priceH = H - PADT - PADB - GAP - volH

  const n = bars.length
  const ys = bars.map((b) => b.close)
  const hi = Math.max(...ys), lo = Math.min(...ys)
  const hiI = ys.indexOf(hi), loI = ys.indexOf(lo)
  // The entry line is part of the picture, not an annotation on top of it — a
  // domain that excludes it draws it off-canvas.
  const dom = entry != null && entry > 0 ? [...ys, entry] : ys
  let minY = Math.min(...dom), maxY = Math.max(...dom)
  if (minY === maxY) { minY -= 1; maxY += 1 }
  const pad = (maxY - minY) * 0.13
  minY -= pad; maxY += pad

  const x = (i: number) => PADL + (n <= 1 ? 0 : i / (n - 1)) * (W - PADL - PADR)
  const y = (v: number) => PADT + ((maxY - v) / (maxY - minY || 1)) * priceH
  const pts = bars.map((b, i) => `${x(i).toFixed(1)},${y(b.close).toFixed(1)}`)
  const line = `M${pts.join(' L')}`
  const area = `${line} L${x(n - 1).toFixed(1)},${PADT + priceH} L${x(0).toFixed(1)},${PADT + priceH} Z`

  const last = ys[n - 1]!
  const up = entry != null ? last - entry : null
  const pillVar = up == null ? 'var(--color-accent)' : up >= 0 ? 'var(--color-up)' : 'var(--color-down)'

  // Volume. The bar the print landed in is the accent one (picked below, once
  // the print's bar index is known) — on a whale print it usually towers over
  // its neighbours, and that is the fastest tell between an opening trade and
  // one that joined a busy contract.
  const vols = bars.map((b) => b.volume)
  const vMax = Math.max(1, ...vols)
  const vAvg = vols.reduce((a, b) => a + b, 0) / (vols.length || 1)
  const vTop = PADT + priceH + GAP
  const vy = (v: number) => vTop + volH - (v / vMax) * volH
  const bw = Math.max(1, ((W - PADL - PADR) / n) * 0.62)

  // ── WHICH VOLUME BARS GET A NUMBER ──────────────────────────────────────
  // Only the ones that stand out. A number over every bar is a wall of type
  // nobody reads, and the reason to look at this pane at all is "which minute
  // did the size go through" — so the labels are the answer to that and
  // nothing else.
  //
  // A bar qualifies on BOTH counts: at least 3x the day's average bar, and at
  // least a third of the tallest. The average alone labels a dead contract's
  // every twitch; the fraction alone labels nothing on a session with one
  // enormous print. Capped at four, biggest first, and a label is dropped if it
  // would land on top of one already placed.
  const volLabels = useMemo(() => {
    if (n < 6) return [] as number[]
    const floor = Math.max(vAvg * 3, vMax * 0.33)
    const cand = vols
      .map((v, i) => ({ v, i }))
      .filter((c) => c.v > 0 && c.v >= floor)
      .sort((a, b) => b.v - a.v)
      .slice(0, 4)
    const kept: number[] = []
    const minGap = 30 * (wide ? 1.75 : 1)
    for (const c of cand) {
      if (kept.some((k) => Math.abs(x(k) - x(c.i)) < minGap)) continue
      kept.push(c.i)
    }
    return kept
    // x() and the sizing constants are derived from the same inputs, so the
    // bar list and the width are the whole dependency.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [vols, vAvg, vMax, n, W, PADL, PADR, wide])

  // WHERE the entry sits on the line. The print goes in the bar that CONTAINS
  // it — the last bar whose OPEN is at or before the print — not the bar whose
  // open is nearest to it.
  //
  // Nearest-open is only correct for one-minute bars. These are five-minute
  // bars, and a 09:44 print is one minute from the 09:45 open and four from the
  // 09:40 one, so nearest-open put the dot on 09:45 while the 4,450 contracts
  // sat in the 09:40 bar underneath it: the dot and its own volume spike a
  // whole bar apart, which is exactly how it looked (2026-09-18). A bar labelled
  // 09:40 covers 09:40–09:45, so 09:44 belongs to it, and the wider the bars the
  // worse nearest-open gets.
  //
  // Out of range (an entry before the window starts, on 3D/1W/1M) draws no
  // marker — pinning it to bar 0 would put the dot on a minute it was not
  // printed in.
  const entryI = useMemo(() => {
    if (entryTs == null || !Number.isFinite(entryTs) || n === 0) return null
    const first = bars[0]!.time, lastT = bars[n - 1]!.time
    const span = lastT - first
    // The nominal bar width, so the slack scales with the range being drawn
    // rather than assuming minutes.
    const slack = Math.max(60_000, span / Math.max(1, n - 1))
    if (entryTs < first - slack || entryTs > lastT + slack) return null
    let best = 0
    for (let i = 0; i < n; i++) {
      if (bars[i]!.time <= entryTs) best = i
      else break
    }
    return best
  }, [bars, entryTs, n])

  // The accented volume bar is the bar the PRINT landed in, not the tallest one
  // on the session. Those are usually the same bar on a whale print, which is
  // why the mismatch hid for so long — but when a later minute trades more, the
  // accent jumped to that minute while the entry dot stayed on the print, and
  // the two halves of the chart disagreed about when the trade happened
  // (2026-09-18). With no print in range there is nothing to point at, so it
  // falls back to the tallest bar.
  const fillIdx = entryI ?? vols.indexOf(vMax)
  /** Right edge of the "VOLUME · PRINT n" title, for the label collision test. */
  const volTitle = `VOLUME${size ? ` · PRINT ${size.toLocaleString()}` : ''}`

  const label = { fill: 'var(--color-fg)', fontFamily: MONO } as const
  const fmt = (v: number) => v.toFixed(2)
  // Type and glyph sizes are in USER units and the viewBox now displays at 1:1,
  // so this is no longer undoing a stretch — it is a gentle step up on a
  // roomier canvas, capped so a wide pane gets slightly larger labels instead
  // of the blown-up ones a fixed viewBox used to hand it.
  const S = wide
    ? clamp(1.15 + (W - 560) / 1600, 1.15, 1.45)
    : clamp(1 + (W - 320) / 1600, 1, 1.35)
  // 8*S mono at ~0.62em advance plus the 0.9 letter-spacing, from PADL + 2.
  const volTitleEnd = PADL + 2 + volTitle.length * (8 * S * 0.62 + 0.9)

  /** Keep a point label inside the plot when its point is near an edge. */
  const EDGE = 26 * S
  const edgeAnchor = (i: number) =>
    x(i) < PADL + EDGE ? 'start' : x(i) > W - PADR - EDGE ? 'end' : 'middle'
  const edgeX = (i: number) =>
    x(i) < PADL + EDGE ? PADL : x(i) > W - PADR - EDGE ? W - PADR : x(i)

  const onMove = (e: ReactMouseEvent<SVGSVGElement>) => {
    const box = e.currentTarget.getBoundingClientRect()
    const vx = ((e.clientX - box.left) / box.width) * W
    const i = Math.round(((vx - PADL) / (W - PADL - PADR)) * (n - 1))
    setHover(i < 0 ? 0 : i > n - 1 ? n - 1 : i)
  }
  const hp = hover == null ? null : bars[hover]!
  const hpl = hp == null || entry == null ? null : (hp.close - entry) * 100
  const hpct = hp == null || entry == null || entry <= 0 ? null : ((hp.close - entry) / entry) * 100

  // ── THE HOVER READOUT ──────────────────────────────────────────────────
  // A whale chart can answer a question a plain option chart cannot: what the
  // PRINT is worth at the minute under the cursor. Size is on the row, so the
  // position's value (mark x size x 100) and the open P/L against the entry are
  // both arithmetic — and they are the numbers actually being asked for when
  // someone scrubs a $9.78M print across the day.
  //
  // Every row is conditional on the input it needs. A lookup has no entry and
  // no size, so it renders as time + mark + volume and the box shrinks to fit
  // rather than printing four dashes.
  const dollars = (v: number) => {
    const a = Math.abs(v)
    const sign = v < 0 ? '\u2212' : ''
    if (a >= 1_000_000) return `${sign}$${(a / 1_000_000).toFixed(2)}M`
    if (a >= 1_000) return `${sign}$${(a / 1_000).toFixed(0)}K`
    return `${sign}$${a.toFixed(0)}`
  }
  const hrows: Array<{ k: string; v: string; ink?: string; big?: boolean }> = []
  if (hp) {
    hrows.push({ k: 'MARK', v: fmt(hp.close), big: true })
    if (hpl != null) {
      hrows.push({
        k: 'VS ENTRY',
        v: `${hpl >= 0 ? '+' : '\u2212'}$${Math.abs(hpl).toFixed(0)}/ct`,
        ink: hpl >= 0 ? 'var(--color-up)' : 'var(--color-down)',
      })
    }
    hrows.push({ k: 'BAR VOL', v: hp.volume >= 1000 ? `${(hp.volume / 1000).toFixed(1)}k` : String(hp.volume) })
    if (size && size > 0) {
      hrows.push({ k: 'POSITION', v: dollars(hp.close * size * 100), ink: 'var(--color-warn)' })
      if (entry != null && entry > 0) {
        const pl = (hp.close - entry) * size * 100
        hrows.push({ k: 'OPEN P/L', v: dollars(pl), ink: pl >= 0 ? 'var(--color-up)' : 'var(--color-down)' })
      }
    }
  }
  const BOXW = 132 * S
  const HEADH = 20 * S
  const ROWH = 15 * S
  const BOXH = HEADH + hrows.length * ROWH + 6 * S

  return (
    <div ref={boxRef} style={{ width: '100%' }}>
      <svg
        viewBox={`0 0 ${W} ${H}`}
        style={{ width: '100%', height: 'auto', display: 'block' }}
        onMouseMove={onMove}
        onMouseLeave={() => setHover(null)}
      >
      <defs>
        <linearGradient id="cbtf-wash" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" style={{ stopColor: 'var(--color-accent)' }} stopOpacity={0.20} />
          <stop offset="100%" style={{ stopColor: 'var(--color-accent)' }} stopOpacity={0} />
        </linearGradient>
      </defs>

      {/* Three rungs — high, entry, low. Five lines over a wash is fence, not
          scale, and these are the only prices the chart is asked about. */}
      {[hi, entry != null && entry > 0 ? entry : (hi + lo) / 2, lo].map((v, i) => (
        <g key={i}>
          <line x1={PADL} y1={y(v)} x2={W - PADR} y2={y(v)} style={{ stroke: 'var(--color-line)' }} strokeWidth={1} />
          <text x={W - PADR + 7 * S} y={y(v) + 3.4 * S} fontSize={9.5 * S} fontWeight={700} style={label}>{fmt(v)}</text>
        </g>
      ))}

      <path d={area} fill="url(#cbtf-wash)" />

      {entry != null && entry > 0 && (
        <>
          <line x1={PADL} y1={y(entry)} x2={W - PADR} y2={y(entry)}
            style={{ stroke: 'var(--color-fg)' }} strokeWidth={1} strokeDasharray="1 3" opacity={0.55} />
          {/* With no marker to hang it on, the rung keeps its left-edge label. */}
          {entryI == null && (
            <text x={PADL + 2} y={y(entry) - 5 * S} fontSize={9 * S} fontWeight={700} letterSpacing="0.6" style={label}>
              ENTRY {fmt(entry)}
            </text>
          )}
        </>
      )}

      <path d={line} fill="none" style={{ stroke: 'var(--color-accent)' }} strokeWidth={1.4 * S}
        strokeLinejoin="round" strokeLinecap="round" />

      {/* ENTRY MARKER. Same ring vocabulary as the high and the low, filled with
          the page ground so the price line reads THROUGH it rather than behind
          a blob. Sits on the print's bar, at the price paid. The label flips to
          the left inside the last fifth of the canvas and above the dot when the
          entry is in the bottom third, so it never runs off the rail or collides
          with the volume pane. */}
      {entry != null && entry > 0 && entryI != null && (() => {
        const ex = x(entryI)
        // ON THE RUNG, at the print's minute. The dot marks the TRADE — the
        // price paid at the moment it was paid — so it sits where the dashed
        // entry line crosses the print's bar. Parking it on the bar's mark
        // instead (the old behaviour) put it above or below its own 4.55 label
        // whenever the fill differed from the mark, which read as a chart that
        // could not agree with itself (2026-09-18). The gap between the dot and
        // the line at that minute is now the information: it is the edge the
        // fill got, or gave up, against the mark.
        // ON THE PRICE LINE (2026-09-21). The marker rides the blue mark line at
        // the print's bar so it reads as a point on the chart; the dashed rung
        // still carries the price paid, and the label still reads that price.
        const ey = y(bars[entryI]!.close)
        const flip = ex > PADL + (W - PADL - PADR) * 0.8
        const lowHalf = ey > PADT + priceH * 0.66
        return (
          <g>
            <circle cx={ex} cy={ey} r={4 * S} fill="none"
              style={{ stroke: 'var(--color-fg)' }} strokeWidth={1.4 * S} opacity={0.85} />
            <circle cx={ex} cy={ey} r={1.6 * S} style={{ fill: 'var(--color-fg)' }} />
            <text
              x={flip ? ex - 8 * S : ex + 8 * S}
              y={lowHalf ? ey - 8 * S : ey + 12 * S}
              textAnchor={flip ? 'end' : 'start'}
              fontSize={9 * S}
              fontWeight={700}
              letterSpacing="0.6"
              style={label}
            >
              ENTRY {fmt(entry)}
            </text>
          </g>
        )
      })()}

      {/* The high or the low is often the FIRST or LAST bar, and a centred label
          there hangs half off the canvas — "H 15.23" rendered as "15.23" with
          the H clipped. Anchor to the edge instead when it is close to one. */}
      <circle cx={x(hiI)} cy={y(hi)} r={2.6 * S} fill="none" style={{ stroke: 'var(--color-up)' }} strokeWidth={1.4 * S} />
      <text x={edgeX(hiI)} y={y(hi) - 8 * S} textAnchor={edgeAnchor(hiI)} fontSize={9 * S} fontWeight={700}
        style={{ fill: 'var(--color-up)', fontFamily: MONO }}>H {fmt(hi)}</text>
      <circle cx={x(loI)} cy={y(lo)} r={2.6 * S} fill="none" style={{ stroke: 'var(--color-down)' }} strokeWidth={1.4 * S} />
      <text x={edgeX(loI)} y={y(lo) + 13 * S} textAnchor={edgeAnchor(loI)} fontSize={9 * S} fontWeight={700}
        style={{ fill: 'var(--color-down)', fontFamily: MONO }}>L {fmt(lo)}</text>

      {/* Last mark, in the rail, tinted by where it sits against the entry. Pill
          type is the page ground, not white — it is on a solid green or red. */}
      <circle cx={x(n - 1)} cy={y(last)} r={2.8 * S} style={{ fill: pillVar }} />
      <rect x={W - PADR + 2} y={y(last) - 7.5 * S} width={38 * S} height={15 * S} rx={7.5 * S} style={{ fill: pillVar }} />
      <text x={W - PADR + 2 + 19 * S} y={y(last) + 3.2 * S} textAnchor="middle" fontSize={9.5 * S} fontWeight={700}
        style={{ fill: 'var(--color-bg)', fontFamily: MONO }}>{fmt(last)}</text>

      {/* ── volume ─────────────────────────────────────────────────────────── */}
      <line x1={PADL} y1={vTop + volH} x2={W - PADR} y2={vTop + volH}
        style={{ stroke: 'var(--color-line)' }} strokeWidth={1} />
      {bars.map((b, i) => (
        <rect
          key={b.time}
          x={x(i) - bw / 2}
          y={vy(b.volume)}
          width={bw}
          height={Math.max(0.6, vTop + volH - vy(b.volume))}
          style={{ fill: i === fillIdx ? 'var(--color-accent)' : 'var(--color-fg)' }}
          opacity={i === fillIdx ? 1 : 0.28}
        />
      ))}
      <line x1={PADL} y1={vy(vAvg)} x2={W - PADR} y2={vy(vAvg)}
        style={{ stroke: 'var(--color-fg)' }} strokeWidth={1} strokeDasharray="1 3" opacity={0.3} />

      {/* The standout bars, numbered. A tall bar's top is at the very edge of
          the pane, so its label goes INSIDE it in the page ground rather than
          above it in the gap, where it would collide with the price chart. */}
      {volLabels.map((i) => {
        const v = vols[i]!
        const top = vy(v)
        const inside = top < vTop + 11 * S
        const anchor = x(i) < PADL + 22 * S ? 'start' : x(i) > W - PADR - 22 * S ? 'end' : 'middle'
        const lx = anchor === 'start' ? PADL : anchor === 'end' ? W - PADR : x(i)
        // A label on the top line must not print over the VOLUME · PRINT title
        // (2026-09-24: "2.0k" landed on "PRINT"). Estimate both boxes in mono
        // advance widths and drop the label one line if they meet.
        const txt = v >= 10_000 ? `${(v / 1000).toFixed(0)}k` : v >= 1000 ? `${(v / 1000).toFixed(1)}k` : String(v)
        const lw = txt.length * 8.5 * S * 0.62
        const l0 = anchor === 'start' ? lx : anchor === 'end' ? lx - lw : lx - lw / 2
        const ly0 = inside ? top + 8.5 * S : top - 3 * S
        const hitsTitle = ly0 < vTop + 12 * S && l0 < volTitleEnd + 4 && l0 + lw > PADL
        return (
          <text
            key={`vl-${i}`}
            x={lx}
            y={hitsTitle ? vTop + 20 * S : ly0}
            textAnchor={anchor}
            fontSize={8.5 * S}
            fontWeight={700}
            // Inside the bar the ink is still WHITE, not the page ground: the
            // bar it sits on is the accent blue, and dark-on-accent was
            // unreadable at 8.5px (2026-09-14).
            style={{
              fill: inside || i !== fillIdx ? 'var(--color-fg)' : 'var(--color-accent)',
              fontFamily: MONO,
            }}
            opacity={inside || i === fillIdx ? 1 : 0.7}
          >
            {txt}
          </text>
        )
      })}
      <text x={W - PADR + 7 * S} y={vTop + 8 * S} fontSize={9 * S} fontWeight={700} style={label}>
        {vMax >= 1000 ? `${(vMax / 1000).toFixed(1)}k` : vMax}
      </text>
      <text x={PADL + 2} y={vTop + 8 * S} fontSize={8 * S} fontWeight={700} letterSpacing="0.9" style={label} opacity={0.8}>
        {volTitle}
      </text>

      <text x={PADL} y={H - 6 * S} fontSize={9 * S} fontWeight={700} style={label}>{etDayTime(bars[0]!.time)}</text>
      <text x={W - PADR} y={H - 6 * S} textAnchor="end" fontSize={9 * S} fontWeight={700} style={label}>
        {etDayTime(bars[n - 1]!.time)}
      </text>

      {hp && (
        <g>
          <line x1={x(hover as number)} y1={PADT} x2={x(hover as number)} y2={vTop + volH}
            style={{ stroke: 'var(--color-fg)' }} strokeWidth={1} strokeDasharray="2 3" opacity={0.4} />
          <circle cx={x(hover as number)} cy={y(hp.close)} r={3 * S}
            style={{ fill: 'var(--color-bg)', stroke: 'var(--color-accent)' }} strokeWidth={1.6 * S} />
          {/* Clamped on both ends. The box follows the cursor until it would
              cross the price rail, then stops — a readout sliding under the rail
              labels is worse than one that stops moving. */}
          <g transform={`translate(${Math.min(W - PADR - BOXW - 2, Math.max(PADL, x(hover as number) + 10))},${PADT + 2})`}>
            <rect width={BOXW} height={BOXH} rx={6 * S}
              style={{ fill: 'var(--color-surface2)', stroke: 'var(--color-line)' }} strokeWidth={1} />
            {/* Header band: the minute, and the move in percent. A rounded rect
                plus a square one, so only the TOP corners round. */}
            <rect width={BOXW} height={HEADH} rx={6 * S} style={{ fill: 'var(--color-raised)' }} />
            <rect y={HEADH - 6 * S} width={BOXW} height={6 * S} style={{ fill: 'var(--color-raised)' }} />
            <text x={9 * S} y={HEADH - 6 * S} fontSize={9 * S} fontWeight={700} style={label} opacity={0.65}>
              {etDayTime(hp.time)}
            </text>
            {hpct != null && (
              <text x={BOXW - 9 * S} y={HEADH - 6 * S} textAnchor="end" fontSize={9 * S} fontWeight={700}
                style={{ fill: hpct >= 0 ? 'var(--color-up)' : 'var(--color-down)', fontFamily: MONO }}>
                {hpct >= 0 ? '+' : '\u2212'}{Math.abs(hpct).toFixed(1)}%
              </text>
            )}
            {hrows.map((r, i) => {
              const ry = HEADH + (i + 1) * ROWH - 4 * S
              return (
                <g key={r.k}>
                  <text x={9 * S} y={ry} fontSize={8 * S} fontWeight={700} letterSpacing="0.08em"
                    style={label} opacity={0.45}>{r.k}</text>
                  <text x={BOXW - 9 * S} y={ry} textAnchor="end" fontSize={(r.big ? 11 : 9.5) * S} fontWeight={700}
                    style={{ fill: r.ink ?? 'var(--color-fg)', fontFamily: MONO }}>{r.v}</text>
                </g>
              )
            })}
          </g>
        </g>
      )}
      </svg>
    </div>
  )
}
