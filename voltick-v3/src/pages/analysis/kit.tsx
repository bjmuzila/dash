// ─────────────────────────────────────────────────────────────────────────────
// THE ANALYSIS KIT — Part B of docs/parity/analysis.md, transcribed.
//
// Every card on this page is built out of these. They are NOT general v3
// primitives and must not be imported from anywhere else: they carry v2's
// metrics (17px labels, 21px mono values, .08em tracking) and v2's palette,
// because the page they serve is a 1:1 port that is required to look like v2.
// The rest of v3 uses design/primitives/*.
//
// TRANSCRIBED, NOT RE-DERIVED. Sizes, opacities, rounding and empty strings are
// copied from v2's components/pages/Analytics.tsx. Where something looks like a
// mistake it is recorded as one in the parity doc and kept — the port is not the
// place to fix v2.
// ─────────────────────────────────────────────────────────────────────────────

import type { CSSProperties, ReactNode } from 'react'
import { useCallback, useEffect, useState } from 'react'
import { Card } from '@/design/primitives/Card'
import { alpha, V2, V2W } from '@/design/theme'

// ── The type scale ───────────────────────────────────────────────────────────

/**
 * v2's font sizes on this page, named once.
 *
 * WHY A PAGE-LOCAL SCALE AND NOT `--text-xs` … `--text-2xl`: v3's ramp is
 * 11 / 13 / 15 / 18 / 24 / 32 and v2's page uses 9, 10, 11, 12, 13, 14, 17, 18,
 * 20, 21, 22, 26, 28 and 34. They agree on almost nothing, and the colour
 * requirement ("keep colors the same as the v2 version") applies to the type
 * the colour is painted on too — a card title that is 18px instead of 17px, in
 * a different weight ramp, is not the same card.
 *
 * It is a CONSTANT rather than fourteen inline numbers because check-theme.mjs
 * rule 4 bans a bare `fontSize:` number outright — its own comment says the rule
 * is written narrowly so that "anything that interpolates a scale constant" is
 * fine. This is that constant.
 *
 * When v3's own ramp is settled, this is the table to reconcile against — one
 * file, fourteen numbers, every use site already pointing at it.
 */
export const FS = {
  /** 9 — the ladder's level tags and the spot-price chip. */
  tag: 9,
  /** 10 — updated stamps, pill buttons, badges, the BETA tag. */
  micro: 10,
  /** 11 — captions, picker rows, the replay bar, the disclaimer. */
  small: 11,
  /** 12 — card notes, chip names, section titles, rule detail. */
  caption: 12,
  /** 13 — ladder strike and value cells, the picker trigger. */
  row: 13,
  /** 14 — body copy: the bias sentence, "The read", level rows. */
  body: 14,
  /** 16 — the panes' "Net GEX" stat, and the Strategy card's entry/stop/target. */
  compact: 16,
  /** 17 — Label, CardTitle, list items, the bias pill. */
  label: 17,
  /** 18 — the three-up stat rows. */
  stat: 18,
  /** 20 — Multi Greek's peak strike. */
  peak: 20,
  /** 21 — the default `Value` size. */
  value: 21,
  /** 22 — Core, identity-line spot, the $SYMBOL. */
  lead: 22,
  /** 26 — a level chip's value. */
  chip: 26,
  /** 28 — a Net Greeks tile. */
  tile: 28,
  /** 34 — the Confidence score. */
  hero: 34,
} as const

// ── Type ─────────────────────────────────────────────────────────────────────

/** v2's `Label`: 17px/700, .08em, uppercase, muted at 70%. */
export function Label({ children }: { children: ReactNode }) {
  return (
    <span
      style={{
        fontSize: FS.label,
        fontWeight: 700,
        letterSpacing: '0.08em',
        textTransform: 'uppercase',
        color: V2.muted,
        opacity: 0.7,
      }}
    >
      {children}
    </span>
  )
}

/** v2's `Value`: mono, 800, default 21px, default white. */
export function Value({
  children,
  color = V2.text,
  size = FS.value,
}: {
  children: ReactNode
  color?: string
  size?: number
}) {
  return (
    <span style={{ fontFamily: 'var(--font-mono)', fontSize: size, fontWeight: 800, color }}>
      {children}
    </span>
  )
}

/** Label over Value, gap 3. */
export function Stat({
  label,
  value,
  color,
  size = FS.value,
}: {
  label: ReactNode
  value: ReactNode
  color?: string
  size?: number
}) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
      <Label>{label}</Label>
      <Value color={color} size={size}>
        {value}
      </Value>
    </div>
  )
}

/** Space-between row. */
export function Row({ children, style }: { children: ReactNode; style?: CSSProperties }) {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: 8,
        ...style,
      }}
    >
      {children}
    </div>
  )
}

/** The card-title span every card opens with: 17px/800, .08em, uppercase, cyan. */
export function CardTitle({ children }: { children: ReactNode }) {
  return (
    <span
      style={{
        fontSize: FS.label,
        fontWeight: 800,
        letterSpacing: '0.08em',
        textTransform: 'uppercase',
        color: V2.cyan,
      }}
    >
      {children}
    </span>
  )
}

/** The small right-aligned caption beside a card title: 12px mono, muted @60%. */
export function CardNote({
  children,
  color = V2.muted,
  opacity = 0.6,
  size = FS.caption,
  title,
}: {
  children: ReactNode
  color?: string
  opacity?: number
  size?: number
  title?: string
}) {
  return (
    <span style={{ fontSize: size, fontFamily: 'var(--font-mono)', color, opacity }} title={title}>
      {children}
    </span>
  )
}

/** The orange tag that follows a title — BETA, NOT FINANCIAL ADVICE. */
export function TitleTag({ children }: { children: ReactNode }) {
  return (
    <span
      style={{
        marginLeft: 6,
        fontSize: FS.micro,
        fontWeight: 800,
        letterSpacing: '0.1em',
        color: V2.orange,
        opacity: 0.85,
        verticalAlign: 'middle',
      }}
    >
      {children}
    </span>
  )
}

// ── Controls ─────────────────────────────────────────────────────────────────

/**
 * v2's `homeButtonStyle` / `homeSecondaryButtonStyle`. Every pill, expiry chip
 * and quick-row button on this page is one of these two, and the ACTIVE one is
 * the cyan gradient.
 *
 * They live here rather than in design/theme.ts because they carry METRICS —
 * padding, radius, a font size — and theme.ts is the colour bridge. Keeping the
 * type step next to FS is also what lets the size come from the scale.
 */
export const btn: CSSProperties = {
  padding: '5px 10px',
  borderRadius: 6,
  border: `1px solid ${alpha(V2.cyan, 0.25)}`,
  background: `linear-gradient(180deg, ${alpha(V2.cyan, 0.12)}, ${alpha(V2.cyan, 0.04)})`,
  color: V2.cyan,
  fontSize: FS.micro,
  fontWeight: 700,
  letterSpacing: '0.08em',
  textTransform: 'uppercase',
  cursor: 'pointer',
}

export const btnSecondary: CSSProperties = {
  ...btn,
  border: `1px solid ${V2W.border}`,
  background: V2W.wash04,
  color: V2.text,
}

/** Active option takes the cyan gradient, the rest the white wash. */
export function PillSelect<T extends string>({
  value,
  options,
  onChange,
}: {
  value: T
  options: readonly T[]
  onChange: (v: T) => void
}) {
  return (
    <div style={{ display: 'flex', gap: 4 }}>
      {options.map((o) => (
        <button key={o} onClick={() => onChange(o)} style={o === value ? btn : btnSecondary}>
          {o}
        </button>
      ))}
    </div>
  )
}

/**
 * The "More →" chip that links a card to its full page. v2 renders this with
 * next/link; here it is a plain anchor into the v3 SPA's sibling route, because
 * v3 has no Next router and the target pages are v2's.
 */
export function MoreLink({ href, children = 'More →' }: { href: string; children?: ReactNode }) {
  return (
    <a
      href={href}
      style={{
        fontSize: FS.micro,
        fontWeight: 800,
        letterSpacing: '0.08em',
        textTransform: 'uppercase',
        color: V2.cyan,
        textDecoration: 'none',
        border: `1px solid ${V2W.border}`,
        borderRadius: 6,
        padding: '3px 9px',
        whiteSpace: 'nowrap',
      }}
    >
      {children}
    </a>
  )
}

export const divider: CSSProperties = { height: 1, background: V2W.border, margin: '10px 0' }

// ── States ───────────────────────────────────────────────────────────────────

/** v2's dashed empty box. minHeight defaults to 70. */
export function Placeholder({
  children,
  minHeight = 70,
}: {
  children: ReactNode
  minHeight?: number
}) {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        minHeight,
        borderRadius: 10,
        border: `1px dashed ${V2W.border}`,
        color: V2.muted,
        fontSize: FS.caption,
        fontStyle: 'italic',
        textAlign: 'center',
        padding: '8px 12px',
        opacity: 0.8,
      }}
    >
      {children}
    </div>
  )
}

/**
 * Loading / error / empty for a card body. A card never looks broken — it says
 * which of the three it is.
 *
 * `empty` defaults to "No data yet", which every caller on this page overrides.
 */
export function CardState({
  loading,
  error,
  empty = 'No data yet',
}: {
  loading: boolean
  error: string | null
  empty?: ReactNode
}) {
  if (loading) return <Placeholder>Loading…</Placeholder>
  if (error)
    return (
      <Placeholder>
        <span style={{ color: V2.red }}>⚠ {error}</span>
      </Placeholder>
    )
  return <Placeholder>{empty}</Placeholder>
}

/** "updated 3:42:18 PM ET", pinned to the bottom of a card by marginTop:auto. */
export function UpdatedStamp({ at }: { at: number | null }) {
  const text =
    at == null
      ? '—'
      : new Intl.DateTimeFormat('en-US', {
          timeZone: 'America/New_York',
          hour: 'numeric',
          minute: '2-digit',
          second: '2-digit',
          hour12: true,
        }).format(at) + ' ET'
  return (
    <span
      style={{
        fontSize: FS.micro,
        fontFamily: 'var(--font-mono)',
        color: V2.muted,
        opacity: 0.55,
        marginTop: 'auto',
        paddingTop: 6,
        textAlign: 'right',
      }}
    >
      updated {text}
    </span>
  )
}

// ── The card shell ───────────────────────────────────────────────────────────

/**
 * THE SMALL-CARD HEIGHT. All eight cards under Ticker Lookup are exactly this
 * tall — not "about" this tall, and not sized to their content.
 *
 * The page is a four-column grid with `alignItems: start`. Without one fixed
 * number the tallest card in a row sets that row's height and the three beside
 * it sit in a box they do not fill, so the second row starts at a different y
 * from the first and the board reads as ragged. A card whose content is longer
 * than this scrolls INSIDE itself; nothing pushes anything else.
 */
export const CARD_H = 480

/**
 * One card.
 *
 * TWO MODES, and the difference is where the scrollbar lives:
 *
 *   height set (the eight small cards) — fixed box, and the card body is the
 *   scroller. This is the mode that keeps the grid square.
 *
 *   height="auto" (Ticker Lookup, Strategy Builder) — the card is as tall as its
 *   content and NEVER scrolls. Ticker Lookup in particular must show all of
 *   itself: the controls, the identity line, both panes, the read and the
 *   disclaimer. The only scrollers inside it are the two ladders, which own
 *   their own fixed-height pane. A scrollbar on the card as well as on the
 *   ladders inside it is two scrollbars for one gesture.
 *
 * ⚠ IT IS THE STRING 'auto', NOT `undefined`, AND THAT IS THE WHOLE POINT.
 * This prop used to be `height?: number` with a `= CARD_H` default, and the two
 * wide cards passed `height={undefined}` to mean "no height". A default
 * parameter fires on an explicit `undefined` exactly as it does on an omitted
 * one, so those cards silently got 480px and Ticker Lookup was clipped at the
 * seventh rung with a scrollbar of its own — the bug this prop was added to fix,
 * surviving the fix, because the opt-out was spelled as the thing that opts in.
 * A sentinel cannot be `undefined` when `undefined` already means "use the
 * default".
 */
export function AnalysisCard({
  children,
  flush = false,
  height = CARD_H,
  span,
  style,
}: {
  children: ReactNode
  /** Drop the padding + gap — for the econ calendar, which paints edge to edge. */
  flush?: boolean
  /** Fixed pane height, or 'auto' for a card that sizes to its content. */
  height?: number | 'auto'
  /** Full-width: `1 / -1`. */
  span?: boolean
  style?: CSSProperties
}) {
  const fixed = height !== 'auto'
  return (
    <Card
      plate="v2"
      flush
      style={{
        ...(span ? { gridColumn: '1 / -1' } : null),
        // min AND max, not just height: `height` alone is a suggestion to a flex
        // item whose content overflows, and one card growing by a row is the
        // whole reason this constant exists.
        ...(fixed ? { height, minHeight: height, maxHeight: height } : null),
        // A card that sizes to its content must not clip it — Card's own
        // `overflow-hidden` would cut the bottom off the ladders' pane.
        ...(fixed ? null : { overflow: 'visible' }),
        boxSizing: 'border-box',
        ...style,
      }}
    >
      <div
        style={
          flush
            ? { display: 'flex', flexDirection: 'column', minHeight: 0, flex: 1, overflow: 'hidden' }
            : {
                display: 'flex',
                flexDirection: 'column',
                gap: span ? 12 : 10,
                padding: 16,
                minHeight: 0,
                flex: 1,
                overflowY: fixed ? 'auto' : 'visible',
              }
        }
      >
        {children}
      </div>
    </Card>
  )
}

// ── Colour ───────────────────────────────────────────────────────────────────

/**
 * Sign → colour. Positive green, negative red, zero muted.
 *
 * Note the zero case is MUTED, not white — it differs from the Net Greeks
 * tiles, which colour a zero `V2.text`. Both are v2's behaviour and they are
 * genuinely different; do not unify them.
 */
export function signColor(n: number): string {
  if (n > 0) return V2.pos
  if (n < 0) return V2.red
  return V2.muted
}

// ── Numbers ──────────────────────────────────────────────────────────────────

/** Parse a stored level string ("6,112.5") or any numeric. */
export function numOr(v: unknown): number | null {
  if (v == null || v === '') return null
  const n = Number(String(v).replace(/,/g, ''))
  return Number.isFinite(n) ? n : null
}

/** Raw dollars → "+1.2B" / "-840M" / "—". */
export function fmtBig(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return '—'
  const sign = n >= 0 ? '+' : '-'
  const a = Math.abs(n)
  if (a >= 1e9) return `${sign}${(a / 1e9).toFixed(1)}B`
  if (a >= 1e6) return `${sign}${(a / 1e6).toFixed(0)}M`
  if (a >= 1e3) return `${sign}${(a / 1e3).toFixed(0)}K`
  return `${sign}${a.toFixed(0)}`
}

/** "Xm Ys" elapsed. */
export function fmtElapsed(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000))
  const m = Math.floor(s / 60)
  return m > 0 ? `${m}m ${s % 60}s` : `${s}s`
}

// ── ET clocks ────────────────────────────────────────────────────────────────

/** ET today as YYYY-MM-DD — the `?date=` param every snapshot endpoint takes. */
export function etDateISO(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(new Date())
}

/** ET weekday (0 = Sun) + minutes since ET midnight. */
export function nowEtClock(): { dow: number; mins: number; dateISO: string } {
  const p = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York',
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(new Date())
  const get = (t: string) => p.find((x) => x.type === t)?.value ?? ''
  const DOW: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 }
  return {
    dow: DOW[get('weekday')] ?? 0,
    mins: Number(get('hour')) * 60 + Number(get('minute')),
    dateISO: etDateISO(),
  }
}

/** ET minutes + seconds. `hour % 24` because en-US can format midnight as 24. */
export function nowEtMinutesSec(): { min: number; sec: number } {
  const p = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).formatToParts(new Date())
  const g = (t: string) => Number(p.find((x) => x.type === t)?.value ?? 0)
  return { min: (g('hour') % 24) * 60 + g('minute'), sec: g('second') }
}

/**
 * The next premarket session's date. The cron writes on weekdays around 08:00
 * ET, so after the 16:00 close — or at a weekend — roll forward to the next
 * weekday.
 *
 * The `-05:00` is v2's, and it is EST year-round where the session may be EDT.
 * The noon anchor absorbs the hour so the date never lands on the wrong day.
 * Transcribed rather than corrected: changing it is a behaviour change and
 * belongs in its own commit, not inside a parity port.
 */
export function nextPremarketDate(): string {
  const { dow, mins } = nowEtClock()
  const rollForward = mins >= 16 * 60 || dow === 0 || dow === 6
  const base = new Date(`${etDateISO()}T12:00:00-05:00`)
  let add = rollForward ? 1 : 0
  for (let i = 0; i < 7; i++) {
    const d = new Date(base.getTime() + add * 86400000)
    const wd = d.getUTCDay()
    if (wd !== 0 && wd !== 6) break
    add++
  }
  const target = new Date(base.getTime() + add * 86400000)
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(target)
}

/** True on a weekday between 09:00 and 16:00 ET. Gates the Strategy card. */
export function isStrategyWindow(): boolean {
  const p = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York',
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(new Date())
  const get = (t: string) => p.find((x) => x.type === t)?.value ?? ''
  const wd = get('weekday')
  if (wd === 'Sat' || wd === 'Sun') return false
  const mins = Number(get('hour')) * 60 + Number(get('minute'))
  return mins >= 9 * 60 && mins < 16 * 60
}

// ── Fetching ─────────────────────────────────────────────────────────────────

export interface LiveData<R> {
  data: R | null
  loading: boolean
  error: string | null
  lastUpdated: number | null
  reload: () => Promise<void>
}

/**
 * v2's `useLiveData`, transcribed — including the null-url behaviour.
 *
 * WHY NOT data/api.ts's useQuery: three reasons, all parity.
 *   1. This page stamps every card with the time of its LAST SUCCESSFUL fetch
 *      (`lastUpdated`). useQuery does not expose one.
 *   2. Its error is the string v2 renders — `json.error` when the body carries
 *      one, else `HTTP {status}` — wrapped by String(e), so it reaches the card
 *      with the "Error: " prefix v2 shows. useQuery throws a different shape.
 *   3. It polls unconditionally. useQuery suspends polling on a hidden tab,
 *      which is better behaviour and a different behaviour; adopting it here
 *      would change what the "updated" stamp means.
 *
 * ⚠ A null `url` leaves `loading` TRUE forever — the guard returns before the
 * finally. That is v2's, it is load-bearing for callers that gate on a second
 * signal (Net Greeks reads the chain's loading flag instead; Strategy Builder
 * checks its window first), and quietly "fixing" it here would change which
 * empty state those cards show.
 */
export function useLiveData<R>(url: string | null, refreshMs = 120_000): LiveData<R> {
  const [data, setData] = useState<R | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [lastUpdated, setLastUpdated] = useState<number | null>(null)

  const load = useCallback(async () => {
    if (!url) return
    try {
      const res = await fetch(url, { cache: 'no-store' })
      const json = (await res.json()) as R & { error?: string }
      if (!res.ok) throw new Error(json?.error || `HTTP ${res.status}`)
      setData(json as R)
      setError(null)
      setLastUpdated(Date.now())
    } catch (e) {
      setError(String(e))
    } finally {
      setLoading(false)
    }
  }, [url])

  useEffect(() => {
    void load()
    if (!url || !refreshMs) return
    const id = setInterval(() => void load(), refreshMs)
    return () => clearInterval(id)
  }, [load, url, refreshMs])

  return { data, loading, error, lastUpdated, reload: load }
}

/**
 * True for the first `ms` after mount. Used by the IB card to tell "still
 * loading" from "loaded but empty" on a feed that exposes no ready flag.
 */
export function useGrace(ms = 4000): boolean {
  const [grace, setGrace] = useState(true)
  useEffect(() => {
    const id = setTimeout(() => setGrace(false), ms)
    return () => clearTimeout(id)
  }, [ms])
  return grace
}

/** A 1s clock. `on = false` stops it — the Confidence card only ticks while a CB change is unresolved. */
export function useSecondTick(on = true): number {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (!on) return
    const id = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(id)
  }, [on])
  return now
}

// ── The refresh button ───────────────────────────────────────────────────────

export type RefreshState = 'idle' | 'refreshing' | 'success' | 'error'

/** v2's homeRefreshButtonStyle, by state. */
export function refreshStyle(state: RefreshState): CSSProperties {
  const edge = state === 'success' ? V2.refresh : state === 'error' ? V2.red : alpha(V2.cyan, 0.4)
  return {
    fontSize: FS.micro,
    padding: '2px 10px',
    border: `1px solid ${edge}`,
    borderRadius: 2,
    background:
      state === 'success'
        ? alpha(V2.refresh, 0.1)
        : state === 'error'
          ? alpha(V2.red, 0.1)
          : alpha(V2.cyan, 0.08),
    color:
      state === 'success'
        ? V2.refresh
        : state === 'error'
          ? V2.red
          : state === 'refreshing'
            ? V2.muted
            : V2.cyan,
    textShadow:
      state === 'success'
        ? `0 0 12px ${alpha(V2.refresh, 0.5)}`
        : state === 'error'
          ? `0 0 12px ${alpha(V2.red, 0.5)}`
          : 'none',
    cursor: state === 'refreshing' ? 'not-allowed' : 'pointer',
    opacity: state === 'refreshing' ? 0.6 : 1,
    fontWeight: 700,
    flexShrink: 0,
    transition: 'all 0.15s',
  }
}

/** v2's useRefreshButton: locked while running, reverts to idle after 1800ms. */
export function useRefreshButton(fn: () => Promise<void>) {
  const [state, setState] = useState<RefreshState>('idle')
  const [locked, setLocked] = useState(false)

  const trigger = useCallback(async () => {
    if (locked) return
    setLocked(true)
    setState('refreshing')
    try {
      await fn()
      setState('success')
    } catch {
      setState('error')
    } finally {
      setTimeout(() => {
        setState('idle')
        setLocked(false)
      }, 1800)
    }
  }, [fn, locked])

  const label =
    state === 'refreshing'
      ? '↻ Refreshing…'
      : state === 'success'
        ? '✓ Refreshed'
        : state === 'error'
          ? '✗ Failed'
          : '↻ Now'

  return { trigger, label, style: refreshStyle(state), state }
}
