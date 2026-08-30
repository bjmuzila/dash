import { useMemo, useState } from 'react'
import { Page } from '@/design/primitives/Page'
import { Card, CardToolbar } from '@/design/primitives/Card'
import { Table, type Column } from '@/design/primitives/Table'
import { Stat } from '@/design/primitives/Stat'
import { SegGroup, Chip } from '@/design/primitives/Controls'
import { useQuery } from '@/data/api'
import { usePageSymbol } from '@/data/symbol'

// ─────────────────────────────────────────────────────────────────────────────
// OPTIONS CHAIN — replaces v2's components/pages/OptionsChain.tsx at
// /app/options-chain, routed here at /v3/options-chain.
//
// v2's page was not a chain table at all: it was a seven-column GEX MATRIX —
// one column per expiration, each cell painted by a heat skin, with a replay
// transport that rewinds the whole grid to a recorded snapshot, a day-over-day
// OI mover popover, a per-strike flow-GEX sparkline, and a settings cog with
// six greek tabs (GEX/DEX/CHEX/VEX/OI/VOL) crossed with two data bases and two
// skins. That machinery (ChainMatrix, HEAT_SKINS, GREEK_MODES beyond GEX/OI/
// VOL, the ReplayFrame transport, StrikeHoverCard's DoD panel, the flow-GEX
// popup) lives in lib/calculations files this port does not have, and is
// simply too large to bring across in one page file — see the TODO note in
// the empty-state Card below for exactly what is deferred and why.
//
// What DOES port cleanly, and is what "options chain" means everywhere outside
// this one v2 page: a single expiration's ladder, calls on the left of the
// strike and puts on the right, mirrored column-for-column, with the ATM
// strike picked out and the session's key levels (Core Bullseye / call wall /
// put wall) marked on the rows they fall on. That is what this file builds,
// against the same three endpoints v2 used for that data (/api/expirations,
// /api/chains, /api/levels) — just without the matrix wrapped around it.
//
// The ticker is NOT a control on this page — see src/data/symbol.tsx. This
// chain follows the board's one symbol like every other card that can.
// ─────────────────────────────────────────────────────────────────────────────

// ── Wire types ───────────────────────────────────────────────────────────────
// v2's /api/expirations and /api/chains responses are confirmed from the
// source being ported (both read `json.data.items`, and expirations items
// carry a hyphenated "expiration-date" key — see the effect that builds v2's
// `expiries` state). The per-contract fields inside a /api/chains item are
// NOT confirmed — v2 hands its raw items straight to a `parseExpiration()`
// helper that lives in lib/calculations/optionChain.ts, which this port does
// not have. The field names read below (`strike`, `option-type`,
// `open-interest`, `volume`, `last`) are the conventional shape for that kind
// of feed; every read is defensive (`Number(...) || 0`, `String(... ?? '')`)
// so a differently-named or missing field degrades to a blank cell rather
// than a crash or a fabricated number.

interface ExpirationItem {
  'expiration-date'?: string
}
interface ExpirationsResponse {
  data?: { items?: ExpirationItem[] }
}

interface ChainItem {
  [key: string]: unknown
}
interface ChainsResponse {
  data?: { underlyingPrice?: number | string; items?: ChainItem[] }
}

// v2 read only `close`/`em` off this endpoint for this particular page (the
// call wall / put wall / Core Bullseye it draws come from a client-side
// gamma-exposure computation over the whole chain, in lib/calculations/
// heatLevels.ts, which this port does not have). tokens.css's level-cb/cw/pw
// trio is documented there as "shared... and any future levels rail," so a
// consolidated /api/levels that also names the walls directly — as this page
// contract asks for — is the reasonable v3 shape. Every field is read
// optionally: a v3 backend that hasn't grown the wall fields yet just shows
// no wall tags rather than guessing at strikes.
interface LevelsResponse {
  close?: number
  em?: number
  callWall?: number
  putWall?: number
  cb?: number
}

interface Expiration {
  value: string
  label: string
}

// One strike's ladder row: both sides, mirrored around the strike.
interface StrikeRow {
  strike: number
  callOI: number
  callVol: number
  callPrem: number
  putOI: number
  putVol: number
  putPrem: number
}

// ── Formatting ───────────────────────────────────────────────────────────────
// Never a raw float on screen — every numeric cell goes through one of these.

function fmtStrike(n: number): string {
  return Number.isInteger(n) ? n.toLocaleString() : n.toFixed(1)
}

// Open interest / volume are contract counts, not dollars: unsigned, compact.
function fmtCount(n: number): string {
  const abs = Math.abs(n)
  if (abs >= 1_000_000) return `${(abs / 1_000_000).toFixed(2)}M`
  if (abs >= 1_000) return `${(abs / 1_000).toFixed(1)}K`
  return abs.toFixed(0)
}

// Net premium — signed, compact, dollar-prefixed. Ported from v2's fmtMoney.
function fmtPrem(n: number): string {
  if (!Number.isFinite(n) || n === 0) return '—'
  const sign = n >= 0 ? '+' : '-'
  const abs = Math.abs(n)
  if (abs >= 1_000_000) return `${sign}$${(abs / 1_000_000).toFixed(2)}M`
  if (abs >= 1_000) return `${sign}$${(abs / 1_000).toFixed(1)}K`
  return `${sign}$${abs.toFixed(0)}`
}

function fmtPrice(n: number): string {
  return n > 0 ? n.toFixed(2) : '—'
}

// ── Expiration list + the "key expirations" shortcut ───────────────────────
// Ported near-verbatim from v2's pickKeyExpirations: given every listed
// expiration, claim 0DTE, 1DTE, the nearest weekly (Friday) and the nearest
// monthly (third Friday) as four independent slots, so a Friday 0DTE doesn't
// also swallow that week's "weekly" slot. v2 compared dates against its own
// ET-aware market-session helpers (lib/marketSession); those aren't part of
// this port, so this compares against the browser's local calendar date
// instead — expirations are ISO date strings already, so the only place that
// can disagree with true ET is within a few hours of midnight.
function todayKey(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function isFriday(iso: string): boolean {
  return new Date(`${iso}T12:00:00`).getDay() === 5
}

function isThirdFriday(iso: string): boolean {
  const d = new Date(`${iso}T12:00:00`)
  if (d.getDay() !== 5) return false
  const day = d.getDate()
  return day >= 15 && day <= 21
}

function pickKeyExpirations(all: Expiration[]): Expiration[] {
  const today = todayKey()
  const future = [...all].filter((e) => e.value >= today).sort((a, b) => a.value.localeCompare(b.value))
  if (!future.length) return []

  const claimed = new Set<string>()
  const out: Expiration[] = []
  const take = (e: Expiration | undefined) => {
    if (!e) return
    claimed.add(e.value)
    out.push(e)
  }

  take(future[0]) // 0DTE
  take(future.find((e) => !claimed.has(e.value))) // 1DTE
  take(future.find((e) => !claimed.has(e.value) && isFriday(e.value)) ?? future.find((e) => !claimed.has(e.value))) // weekly
  take(
    future.find((e) => !claimed.has(e.value) && isThirdFriday(e.value)) ??
      future.find((e) => !claimed.has(e.value) && isFriday(e.value)) ??
      future.find((e) => !claimed.has(e.value)),
  ) // monthly

  return out
}

// Snap a target price to the nearest strike actually listed — used for both
// the ATM row and for placing the CB/CW/PW level tags on real rows.
function nearestStrikeTo(target: number, strikes: number[]): number | null {
  const first = strikes[0]
  if (!Number.isFinite(target) || first === undefined) return null
  let best = first
  let bestD = Math.abs(first - target)
  for (const s of strikes) {
    const d = Math.abs(s - target)
    if (d < bestD) {
      bestD = d
      best = s
    }
  }
  return best
}

// ── Chain parsing ────────────────────────────────────────────────────────────
// Groups raw /api/chains items into one row per strike, both sides. `last *
// volume * 100` approximates the day's traded notional premium per side (the
// standard $100 equity/index-option multiplier) — v2's real callPrem/putPrem
// came out of parseExpiration() in a lib file this port doesn't have, so this
// is a documented stand-in for the same quantity rather than an invented one:
// every input (last, volume) is a real fetched field.
function parseChainItems(items: ChainItem[]): StrikeRow[] {
  const byStrike = new Map<number, StrikeRow>()
  for (const it of items) {
    const strike = Number(it['strike'] ?? it['strike-price'] ?? NaN)
    if (!Number.isFinite(strike)) continue
    const side = String(it['option-type'] ?? it['side'] ?? '').toLowerCase()
    const oi = Number(it['open-interest'] ?? it['oi'] ?? 0) || 0
    const vol = Number(it['volume'] ?? it['vol'] ?? 0) || 0
    const last = Number(it['last'] ?? it['bid'] ?? 0) || 0
    const prem = last * vol * 100

    const row: StrikeRow =
      byStrike.get(strike) ?? { strike, callOI: 0, callVol: 0, callPrem: 0, putOI: 0, putVol: 0, putPrem: 0 }
    if (side.startsWith('c')) {
      row.callOI += oi
      row.callVol += vol
      row.callPrem += prem
    } else if (side.startsWith('p')) {
      row.putOI += oi
      row.putVol += vol
      row.putPrem += prem
    }
    byStrike.set(strike, row)
  }
  return [...byStrike.values()].sort((a, b) => a.strike - b.strike)
}

// Strike-range control options — a trimmed version of v2's DISPLAY_PERCENTS
// (which ran up to 100% for the multi-column matrix; a single ladder never
// needs that much air before hitting the Table primitive's own ~200-row
// virtualisation note).
const RANGE_PERCENTS = [5, 10, 15, 20, 30] as const
type RangePercent = (typeof RANGE_PERCENTS)[number]

// Cap the ladder around spot within the chosen percent band. Two limits stack
// here on purpose: the percent band answers "how far from spot," and the flat
// row cap answers "never hand the Table primitive more than it says it wants,"
// which matters most on illiquid names where every dollar has a listed strike.
const MAX_VISIBLE_ROWS = 120

function visibleRows(rows: StrikeRow[], spot: number, pct: RangePercent): StrikeRow[] {
  if (!spot) return rows.slice(0, MAX_VISIBLE_ROWS)
  const lo = spot * (1 - pct / 100)
  const hi = spot * (1 + pct / 100)
  const inBand = rows.filter((r) => r.strike >= lo && r.strike <= hi)
  if (inBand.length <= MAX_VISIBLE_ROWS) return inBand
  // Band still too wide for the row cap (a huge %, or strikes packed tight) —
  // trim symmetrically around the nearest-to-spot strike rather than just
  // truncating one end, so the cap never quietly drops the ATM row itself.
  const centerIdx = inBand.reduce(
    (best, r, i) => (Math.abs(r.strike - spot) < Math.abs((inBand[best]?.strike ?? spot) - spot) ? i : best),
    0,
  )
  const half = Math.floor(MAX_VISIBLE_ROWS / 2)
  const start = Math.max(0, Math.min(inBand.length - MAX_VISIBLE_ROWS, centerIdx - half))
  return inBand.slice(start, start + MAX_VISIBLE_ROWS)
}

// ── Small pieces of the control strip ───────────────────────────────────────

function ExpirationPicker({
  all,
  selected,
  onSelect,
}: {
  all: Expiration[]
  selected: string | null
  onSelect: (v: string) => void
}) {
  const keyExps = useMemo(() => pickKeyExpirations(all), [all])
  return (
    <div className="flex items-center gap-1.5">
      {keyExps.length > 0 && (
        <SegGroup
          title="Jump to a key expiration: 0DTE, 1DTE, this week's weekly, this month's monthly"
          options={keyExps.map((e, i) => ({
            label: ['0DTE', '1DTE', 'WKLY', 'MTHLY'][i] ?? e.label,
            value: e.value,
            title: e.label,
          }))}
          value={selected ?? ''}
          onChange={onSelect}
        />
      )}
      {/* Full listing — a plain select rather than a second SegGroup, since a
          liquid name can list a dozen-plus expirations and a segmented control
          that long stops being scannable. */}
      <select
        value={selected ?? ''}
        onChange={(e) => onSelect(e.target.value)}
        className="rounded-sm border border-line bg-surface px-1.5 py-0.5 text-[11px] text-fg outline-none focus:border-accent"
      >
        {all.length === 0 && <option value="">Loading…</option>}
        {all.map((e) => (
          <option key={e.value} value={e.value}>
            {e.label}
          </option>
        ))}
      </select>
    </div>
  )
}

function StrikeRangeControl({ value, onChange }: { value: RangePercent; onChange: (v: RangePercent) => void }) {
  return (
    <SegGroup
      title="How far from spot the ladder extends"
      options={RANGE_PERCENTS.map((p) => ({ label: `±${p}%`, value: String(p) }))}
      value={String(value)}
      onChange={(v) => onChange(Number(v) as RangePercent)}
    />
  )
}

// ── Page ─────────────────────────────────────────────────────────────────────

export default function OptionsChain() {
  const { symbol } = usePageSymbol()
  const [expOverride, setExpOverride] = useState<string | null>(null)
  const [rangePct, setRangePct] = useState<RangePercent>(10)

  // All three requests fire together — none waits on another's component to
  // mount. The chain fetch's URL depends on knowing an expiration, but that is
  // resolved from THIS render's already-in-flight expirations data below, not
  // from a nested child's effect, so there is no request waterfall: the chain
  // request starts on the very next render after expirations resolve, same as
  // every other useQuery here.
  const expirationsQ = useQuery<ExpirationsResponse>(
    `/api/expirations?ticker=${encodeURIComponent(symbol)}`,
    { staleMs: 5 * 60_000 },
  )
  const levelsQ = useQuery<LevelsResponse>(`/api/levels?ticker=${encodeURIComponent(symbol)}`, {
    staleMs: 30_000,
    pollMs: 60_000,
  })

  const expirations: Expiration[] = useMemo(() => {
    const items = expirationsQ.data?.data?.items ?? []
    const seen = new Set<string>()
    const dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
    return items
      .map((it) => String(it['expiration-date'] ?? ''))
      .filter((d) => d && !seen.has(d) && (seen.add(d), true))
      .sort()
      .map((value) => {
        const dt = new Date(`${value}T12:00:00`)
        const mm = String(dt.getMonth() + 1).padStart(2, '0')
        const dd = String(dt.getDate()).padStart(2, '0')
        return { value, label: `${dayNames[dt.getDay()]}, ${mm}-${dd}-${dt.getFullYear()}` }
      })
  }, [expirationsQ.data])

  // Fall back to the earliest listed expiration whenever the override isn't
  // (or is no longer, e.g. after a ticker change) one of this ticker's real
  // listings — no effect needed to keep this in sync, it just recomputes.
  const selectedExpiration =
    expOverride && expirations.some((e) => e.value === expOverride) ? expOverride : (expirations[0]?.value ?? null)

  const chainUrl = selectedExpiration
    ? `/api/chains?ticker=${encodeURIComponent(symbol)}&expiration=${encodeURIComponent(selectedExpiration)}`
    : null
  const chainQ = useQuery<ChainsResponse>(chainUrl, { staleMs: 15_000, pollMs: 60_000 })

  const spot = Number(chainQ.data?.data?.underlyingPrice ?? 0) || 0
  const allRows = useMemo(() => parseChainItems(chainQ.data?.data?.items ?? []), [chainQ.data])
  const strikes = useMemo(() => allRows.map((r) => r.strike), [allRows])
  const atmStrike = useMemo(() => nearestStrikeTo(spot, strikes), [spot, strikes])
  const rows = useMemo(() => visibleRows(allRows, spot, rangePct), [allRows, spot, rangePct])

  const levels = levelsQ.data
  const cwStrike = useMemo(
    () => (levels?.callWall != null ? nearestStrikeTo(levels.callWall, strikes) : null),
    [levels?.callWall, strikes],
  )
  const pwStrike = useMemo(
    () => (levels?.putWall != null ? nearestStrikeTo(levels.putWall, strikes) : null),
    [levels?.putWall, strikes],
  )
  const cbStrike = useMemo(
    () => (levels?.cb != null ? nearestStrikeTo(levels.cb, strikes) : null),
    [levels?.cb, strikes],
  )

  const anyLoading = expirationsQ.loading || chainQ.loading
  const chainStale = !chainQ.data && !!chainQ.error
  const chainEmpty = !chainQ.loading && rows.length === 0

  const columns: Column<StrikeRow>[] = [
    { key: 'callVol', header: 'Vol', numeric: true, width: '15%', cell: (r) => fmtCount(r.callVol) },
    { key: 'callOI', header: 'OI', numeric: true, width: '15%', cell: (r) => fmtCount(r.callOI) },
    { key: 'callPrem', header: 'Net Prem', numeric: true, width: '18%', cell: (r) => fmtPrem(r.callPrem) },
    {
      key: 'strike',
      header: 'Strike',
      align: 'center',
      width: '18%',
      cell: (r) => <StrikeCell row={r} atm={atmStrike} cw={cwStrike} pw={pwStrike} cb={cbStrike} spot={spot} />,
    },
    { key: 'putPrem', header: 'Net Prem', numeric: true, width: '18%', cell: (r) => fmtPrem(r.putPrem) },
    { key: 'putOI', header: 'OI', numeric: true, width: '15%', cell: (r) => fmtCount(r.putOI) },
    { key: 'putVol', header: 'Vol', numeric: true, width: '15%', cell: (r) => fmtCount(r.putVol) },
  ]

  return (
    <Page title="Options Chain">
      <Card
        title={
          <span>
            Options Chain <span className="tabular text-faint">{symbol}</span>
          </span>
        }
        stale={chainStale}
        flush
        fill
      >
        <CardToolbar>
          <ExpirationPicker all={expirations} selected={selectedExpiration} onSelect={setExpOverride} />
          <StrikeRangeControl value={rangePct} onChange={setRangePct} />
          <Chip label="↻" on={false} onClick={() => chainQ.refetch()} title="Refresh the chain" />
        </CardToolbar>

        {/* Stat strip: spot and the weekly expected-move band, both straight
            off /api/levels — the one piece of that endpoint v2 actually used
            on this page (close ± em = the 1× band). */}
        <div className="flex shrink-0 flex-wrap items-center gap-4 border-b border-line px-3 py-2">
          <Stat label="Spot" value={spot ? fmtPrice(spot) : '—'} size="sm" />
          <Stat
            label="Weekly EM (1×)"
            value={
              levels?.close && levels?.em
                ? `${fmtPrice(levels.close - levels.em)} – ${fmtPrice(levels.close + levels.em)}`
                : '—'
            }
            size="sm"
          />
          <div className="flex items-center gap-3 text-[10px] font-semibold tracking-wide">
            <LevelLegend swatchClass="bg-level-cb" textClass="text-level-cb" label="CB" title="Core Bullseye — highest |net GEX| strike" />
            <LevelLegend swatchClass="bg-level-cw" textClass="text-level-cw" label="CW" title="Call wall" />
            <LevelLegend swatchClass="bg-level-pw" textClass="text-level-pw" label="PW" title="Put wall" />
          </div>
        </div>

        {/* Side headers — the Table primitive has no notion of grouped
            column headers, so the CALLS / PUTS banner is drawn once here
            rather than repeated per column. */}
        <div className="flex shrink-0 items-center border-b border-line px-2 py-1 text-[10px] font-bold tracking-[0.1em]">
          <span className="flex-1 text-level-cw">CALLS</span>
          <span className="flex-1 text-center text-faint">STRIKE</span>
          <span className="flex-1 text-right text-level-pw">PUTS</span>
        </div>

        {chainQ.error && !chainQ.data && (
          <div className="shrink-0 border-b border-line/50 px-3 py-1 text-xs text-down">
            Chain fetch failed for {symbol} {selectedExpiration ?? ''} — showing the last good ladder if there is one.
          </div>
        )}

        {chainEmpty ? (
          <div className="p-6 text-center text-sm text-faint">
            {anyLoading ? '—' : `No chain data for ${symbol}${selectedExpiration ? ` (${selectedExpiration})` : ''}.`}
          </div>
        ) : (
          <Table
            columns={columns}
            rows={rows}
            rowKey={(r) => r.strike}
            stale={anyLoading && rows.length > 0}
            rowClassName={(r) => {
              const classes: string[] = []
              if (r.strike === atmStrike) classes.push('bg-raised font-semibold')
              if (r.strike === cbStrike) classes.push('border-l-4 border-l-level-cb')
              else if (r.strike === cwStrike) classes.push('border-l-4 border-l-level-cw')
              else if (r.strike === pwStrike) classes.push('border-l-4 border-l-level-pw')
              return classes.length ? classes.join(' ') : undefined
            }}
          />
        )}
      </Card>

      {/* What v2's Options Chain actually was beyond this ladder — the
          multi-expiration heat matrix, replay, DoD movers and the per-strike
          flow-GEX popup — is machinery this port does not carry. Naming it
          here rather than silently dropping it. */}
      <Card title="Matrix, Replay & Flow" className="shrink-0">
        <p className="text-xs text-faint">
          v2's seven-column GEX matrix (heat skins, DEX/CHEX/VEX tabs, the replay transport that rewinds the whole
          grid to a recorded snapshot, day-over-day OI movers, and the per-strike flow-GEX sparkline popup) is not
          ported — it depends on lib/calculations/optionChain.ts, heatLevels.ts and heatSkins.ts, none of which this
          port has access to.
          {/* TODO(v3): port ChainMatrix, HEAT_SKINS/skinMetricBg, GREEK_MODES
              (dex/chex/vex), the ReplayFrame transport and StrikeHoverCard's
              DoD panel from components/pages/OptionsChain.tsx once the
              lib/calculations modules it depends on exist in v3. */}
        </p>
      </Card>
    </Page>
  )
}

function LevelLegend({
  swatchClass,
  textClass,
  label,
  title,
}: {
  swatchClass: string
  textClass: string
  label: string
  title: string
}) {
  return (
    <span className="flex items-center gap-1" title={title}>
      <span className={`h-2 w-2 rounded-sm ${swatchClass}`} />
      <span className={textClass}>{label}</span>
    </span>
  )
}

function StrikeCell({
  row,
  atm,
  cw,
  pw,
  cb,
  spot,
}: {
  row: StrikeRow
  atm: number | null
  cw: number | null
  pw: number | null
  cb: number | null
  spot: number
}) {
  const isAtm = row.strike === atm
  const tags: Array<{ label: string; cls: string; title: string }> = []
  if (row.strike === cb) tags.push({ label: 'CB', cls: 'text-level-cb', title: 'Core Bullseye — highest |net GEX|' })
  if (row.strike === cw) tags.push({ label: 'CW', cls: 'text-level-cw', title: 'Call wall' })
  if (row.strike === pw) tags.push({ label: 'PW', cls: 'text-level-pw', title: 'Put wall' })

  return (
    <span className="tabular inline-flex items-center gap-1.5" title={isAtm ? `At-the-money — nearest to spot ${fmtPrice(spot)}` : undefined}>
      <span className={isAtm ? 'font-bold text-accent' : ''}>{fmtStrike(row.strike)}</span>
      {isAtm && <span className="rounded-sm bg-raised px-1 text-[8px] font-black text-accent">ATM</span>}
      {tags.map((t) => (
        <span key={t.label} className={`text-[8px] font-black ${t.cls}`} title={t.title}>
          {t.label}
        </span>
      ))}
    </span>
  )
}
