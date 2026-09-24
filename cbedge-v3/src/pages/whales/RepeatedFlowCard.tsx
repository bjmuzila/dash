import { useEffect, useMemo, useState } from 'react'
import { SegGroup, SegMenu } from '@/design/primitives/Controls'
import { readableError, useQuery } from '@/data/api'
import { fmtPremium, fmtStrike, fmtTime } from '@/data/flowMath'

// ─────────────────────────────────────────────────────────────────────────────
// REPEATED FLOW (2026-09-24) — the same contract hit over and over.
//
// The archive above is "who swung $1M+". This is the other signal: a contract
// that keeps getting hit with $50K+ orders. Backed by /api/lse/repeated-flow,
// which groups every print at or above the floor by contract and keeps the
// ones hit at least MIN ORDERS times (5 is the floor; 10+ and 25+ are the
// stronger filters).
//
// Its own FLOOR, ORDERS and WINDOW controls — the page's ≥$1M floor is exactly
// what this section exists to look under. It does follow the page's ticker,
// C/P, side, DTE, strike and unreadable filters, so "SPY, 0DTE, OTM" narrows
// both at once.
//
// Only the last seven days exist below the whale floor (the retention sweep),
// so the window is TODAY or 5D, never the archive's 3M/ALL.
//
// An "order" is a stored print — the capture has no sweep/block flag. The
// DIR column counts how one-sided the repetition was: 25 hits split 13/12 is
// churn, 25/0 is someone building.
// ─────────────────────────────────────────────────────────────────────────────

interface RepeatContract {
  osi: string
  ticker: string
  strike: string
  type: string
  expiry: string
  n: number
  bullN: number
  bearN: number
  total: number
  bull: number
  bear: number
  bought: number
  sold: number
  size: number
  avgPrice: number | null
  firstTs: number
  lastTs: number
  sessions: number
}
interface RepeatResponse {
  range: { from: string; to: string }
  clamped: boolean
  retainDays: number
  minPremium: number
  minOrders: number
  summary: { contracts: number; orders: number; premium: number }
  contracts: RepeatContract[]
  error?: string | null
}

const FLOORS = [
  { label: '≥$50K', value: 50_000 },
  { label: '≥$100K', value: 100_000 },
  { label: '≥$250K', value: 250_000 },
  { label: '≥$500K', value: 500_000 },
]
const ORDER_STOPS = [
  { label: '5+', value: 5, title: 'Hit at least 5 times' },
  { label: '10+', value: 10, title: 'Hit at least 10 times — stronger' },
  { label: '25+', value: 25, title: 'Hit at least 25 times — strongest' },
]
type WindowKey = '1d' | '5d'
const WINDOWS: Array<{ key: WindowKey; label: string; days: number }> = [
  { key: '1d', label: 'TODAY', days: 0 },
  { key: '5d', label: '5D', days: 4 },
]

const SETTINGS_KEY = 'cb-v3-whales:repeated'
interface Saved { floor: number; minOrders: number; win: WindowKey }
const DEFAULTS: Saved = { floor: 50_000, minOrders: 5, win: '1d' }

function loadSaved(): Saved {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY)
    if (!raw) return DEFAULTS
    const j = JSON.parse(raw) as Partial<Saved>
    return {
      floor: FLOORS.some((f) => f.value === j.floor) ? (j.floor as number) : DEFAULTS.floor,
      minOrders: ORDER_STOPS.some((o) => o.value === j.minOrders) ? (j.minOrders as number) : DEFAULTS.minOrders,
      win: j.win === '5d' ? '5d' : DEFAULTS.win,
    }
  } catch {
    return DEFAULTS
  }
}

const etYmd = (d: Date) =>
  new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(d)
const money = (v: number | null | undefined) => fmtPremium(Number(v ?? 0))
const num = (n: number | null | undefined) => (n == null ? '—' : Number(n).toLocaleString())
const fmtExpiry = (iso: string) => {
  if (!iso) return '—'
  const d = new Date(`${iso}T00:00:00Z`)
  if (Number.isNaN(d.getTime())) return iso
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' })
}
const fmtWhen = (ts: number, multiDay: boolean) => {
  if (!ts) return '—'
  if (!multiDay) return fmtTime(ts)
  const md = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', month: '2-digit', day: '2-digit' }).format(new Date(ts))
  return `${md} ${fmtTime(ts)}`
}

export interface RepeatedFlowFilters {
  ticker: string
  type: '' | 'C' | 'P'
  action: '' | 'BUY' | 'SELL'
  moneyness: 'all' | 'otm'
  maxDte: number | null
  maxPrice: number | null
  showUnreadable: boolean
}

export function RepeatedFlowCard({ filters, onOpen, phone = false }: {
  filters: RepeatedFlowFilters
  /** Load the contract into the page's lookup panel. */
  onOpen: (ticker: string, strike: number, expiry: string, type: string) => void
  phone?: boolean
}) {
  const [saved] = useState<Saved>(loadSaved)
  const [floor, setFloor] = useState(saved.floor)
  const [minOrders, setMinOrders] = useState(saved.minOrders)
  const [win, setWin] = useState<WindowKey>(saved.win)

  useEffect(() => {
    try { localStorage.setItem(SETTINGS_KEY, JSON.stringify({ floor, minOrders, win })) } catch { /* best-effort */ }
  }, [floor, minOrders, win])

  const span = WINDOWS.find((w) => w.key === win) ?? WINDOWS[0]!
  const to = etYmd(new Date())
  const from = etYmd(new Date(Date.now() - span.days * 86_400_000))

  const url = useMemo(() => {
    const sp = new URLSearchParams({ from, to, min_premium: String(floor), min_orders: String(minOrders) })
    const t = filters.ticker.trim().toUpperCase()
    if (t) sp.set('ticker', t)
    if (filters.type) sp.set('type', filters.type)
    if (filters.action) sp.set('action', filters.action)
    if (filters.moneyness === 'otm') sp.set('moneyness', 'otm')
    if (filters.maxDte !== null) sp.set('max_dte', String(filters.maxDte))
    if (filters.maxPrice !== null) sp.set('max_price', String(filters.maxPrice))
    if (filters.showUnreadable) sp.set('sides', 'all')
    return `/api/lse/repeated-flow?${sp.toString()}`
  }, [from, to, floor, minOrders, filters])

  const q = useQuery<RepeatResponse>(url, { staleMs: 30_000, pollMs: 60_000 })
  const d = q.data
  const list = d?.contracts ?? []
  const multiDay = win !== '1d'
  const err = d?.error ? readableError(d.error) : q.error ? `Could not load repeated flow — ${readableError(q.error)}.` : null

  const size = phone ? 'touch' : 'sm'
  const controls = (
    <div className="flex flex-wrap items-center gap-2 border-b border-line px-3 py-2">
      <SegGroup<WindowKey>
        size={size}
        title="Only the last seven days are kept below the whale floor"
        options={WINDOWS.map((w) => ({ label: w.label, value: w.key }))}
        value={win}
        onChange={setWin}
      />
      <SegGroup<string>
        size={size}
        title="Minimum times the same contract was hit"
        options={ORDER_STOPS.map((o) => ({ label: o.label, value: String(o.value), title: o.title }))}
        value={String(minOrders)}
        onChange={(v) => setMinOrders(Number(v))}
      />
      <SegMenu<string>
        size={size}
        label="PER ORDER"
        title="Each print on the contract must be at least this much premium"
        options={FLOORS.map((f) => ({ label: f.label, value: String(f.value) }))}
        value={String(floor)}
        defaultValue={String(DEFAULTS.floor)}
        onChange={(v) => setFloor(Number(v))}
      />
      <span className="ml-auto text-2xs text-faint">
        {q.loading && !d
          ? 'loading…'
          : d
            ? `${num(d.summary.contracts)} contracts · ${num(d.summary.orders)} orders · ${money(d.summary.premium)}`
            : ''}
      </span>
    </div>
  )

  const dirOf = (r: RepeatContract) => {
    const dir = r.bullN + r.bearN
    if (dir === 0) return { label: '—', pct: null as number | null, ink: 'text-faint' }
    const bull = r.bullN >= r.bearN
    const pct = Math.round(((bull ? r.bullN : r.bearN) / dir) * 100)
    return { label: bull ? 'BULL' : 'BEAR', pct, ink: bull ? 'text-up' : 'text-down' }
  }

  const emptyNote = (
    <div className="px-3 py-3 text-sm text-faint">
      No contract was hit {minOrders}+ times at {FLOORS.find((f) => f.value === floor)?.label ?? money(floor)} per order
      {multiDay ? ' in the last five sessions' : ' today'}.
    </div>
  )

  return (
    <div className="flex min-h-0 flex-col rounded-md border border-line bg-surface">
      <div className="flex items-center gap-2 border-b border-line px-3 py-2">
        <h2 className="text-2xs font-bold uppercase tracking-[0.11em] text-faint">Repeated flow</h2>
        <span className="ml-auto text-2xs text-faint">same contract, {minOrders}+ orders</span>
      </div>
      {controls}
      {err && <div className="border-b border-line bg-warn/5 px-3 py-2 text-xs text-warn">{err}</div>}

      {phone ? (
        <div className="py-1">
          {list.map((r) => {
            const dir = dirOf(r)
            return (
              <button
                key={r.osi}
                type="button"
                onClick={() => onOpen(r.ticker, Number(r.strike), r.expiry, r.type)}
                className="block w-full border-b border-line px-3 py-2 text-left last:border-b-0 active:bg-raised"
              >
                <span className="flex items-baseline justify-between gap-2">
                  <span className="truncate text-sm font-semibold text-fg">
                    {r.ticker} {fmtStrike(Number(r.strike))}{r.type}{' '}
                    <span className="text-xs font-normal text-faint">{fmtExpiry(r.expiry)}</span>
                  </span>
                  <span className={['tabular shrink-0 text-sm font-semibold', dir.ink].join(' ')}>{money(r.total)}</span>
                </span>
                <span className="mt-0.5 flex items-baseline justify-between gap-2 text-2xs text-faint">
                  <span className="tabular">
                    <span className="font-bold text-fg">×{r.n}</span>
                    {' · '}
                    <span className={dir.ink}>{dir.label}{dir.pct != null ? ` ${dir.pct}%` : ''}</span>
                    {r.avgPrice != null ? ` · avg ${r.avgPrice.toFixed(2)}` : ''}
                  </span>
                  <span className="tabular">{fmtWhen(r.firstTs, multiDay)} → {fmtWhen(r.lastTs, multiDay)}</span>
                </span>
              </button>
            )
          })}
          {!list.length && !q.loading && emptyNote}
        </div>
      ) : (
        <div className="max-h-[420px] min-h-0 overflow-auto">
          <table className="w-full border-collapse text-xs">
            <thead className="sticky top-0 z-[1] bg-surface">
              <tr className="text-2xs uppercase tracking-[0.09em] text-faint">
                <th className="px-2 py-2 text-left font-bold">Ticker</th>
                <th className="px-2 py-2 text-left font-bold">Contract</th>
                <th className="px-2 py-2 text-left font-bold">Exp</th>
                <th className="px-2 py-2 text-right font-bold" title="Times this contract was hit at or above the per-order floor">Orders</th>
                <th
                  className="px-2 py-2 text-left font-bold"
                  title="Which way the orders lean, by COUNT of readable orders. Buying calls or selling puts is bullish"
                >Dir</th>
                <th className="px-2 py-2 text-right font-bold" title="Orders bullish / bearish">Bull / Bear</th>
                <th className="px-2 py-2 text-right font-bold">Contracts</th>
                <th className="px-2 py-2 text-right font-bold" title="Average per-contract fill across the orders">Avg px</th>
                <th className="px-2 py-2 text-right font-bold">First</th>
                <th className="px-2 py-2 text-right font-bold">Last</th>
                <th className="px-2 py-2 text-right font-bold">Premium</th>
              </tr>
            </thead>
            <tbody>
              {list.map((r) => {
                const dir = dirOf(r)
                return (
                  <tr
                    key={r.osi}
                    onClick={() => onOpen(r.ticker, Number(r.strike), r.expiry, r.type)}
                    title="Open this contract in the lookup"
                    className="cursor-pointer border-t border-line hover:bg-raised"
                  >
                    <td className="px-2 py-1.5 font-semibold text-fg">{r.ticker}</td>
                    <td className="tabular px-2 py-1.5 text-fg">{fmtStrike(Number(r.strike))}{r.type}</td>
                    <td className="px-2 py-1.5 text-muted">{fmtExpiry(r.expiry)}</td>
                    <td className="tabular px-2 py-1.5 text-right font-bold text-fg">×{r.n}</td>
                    <td className={['px-2 py-1.5 font-semibold', dir.ink].join(' ')}>
                      {dir.label}{dir.pct != null ? <span className="ml-1 text-2xs opacity-80">{dir.pct}%</span> : null}
                    </td>
                    <td className="tabular px-2 py-1.5 text-right">
                      <span className="text-up">{r.bullN}</span>
                      <span className="text-faint"> / </span>
                      <span className="text-down">{r.bearN}</span>
                    </td>
                    <td className="tabular px-2 py-1.5 text-right text-muted">{num(Math.round(r.size))}</td>
                    <td className="tabular px-2 py-1.5 text-right text-muted">{r.avgPrice != null ? r.avgPrice.toFixed(2) : '—'}</td>
                    <td className="tabular whitespace-nowrap px-2 py-1.5 text-right text-muted">{fmtWhen(r.firstTs, multiDay)}</td>
                    <td className="tabular whitespace-nowrap px-2 py-1.5 text-right text-muted">{fmtWhen(r.lastTs, multiDay)}</td>
                    <td
                      className={['tabular px-2 py-1.5 text-right font-semibold', dir.ink].join(' ')}
                      title={`${money(r.bull)} bullish vs ${money(r.bear)} bearish`}
                    >{money(r.total)}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
          {!list.length && !q.loading && emptyNote}
        </div>
      )}
    </div>
  )
}
