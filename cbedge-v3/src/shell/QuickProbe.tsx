import { useCallback, useEffect, useRef, useState } from 'react'
import { useIsOwner } from '@/data/auth'
import { Select } from '@/design/primitives/Controls'
import { DatePicker } from '@/design/primitives/DatePicker'

// ─────────────────────────────────────────────────────────────────────────────
// QUICK PROBE — owner-only "add a contract to the probe list", docked in Notes.
//
// A 1:1 port of v2's components/shared/QuickProbe.tsx onto v3 tokens. Same
// fields, same endpoints, same gate; nothing below names a colour.
//
// Fill in ticker / expiration / strike / call-or-put, hit Probe, and the
// contract is written straight onto the owner probe list — the same list
// /owner/probe renders. No navigation, no new tab: the row is there the next
// time that page is opened, and the server-side recorder starts filling its
// price history during RTH exactly as if it had been typed there.
//
// It posts the identical payload the probe page's own Add button posts:
//
//   POST /api/watch { action: "add", ticker, expiry, strike, side }
//
// No `addedPrice` is sent, so the route captures the live mark as the entry
// basis (server-v2's api-router → /proxy/probe-rest). That route is registered
// `auth: 'owner'` server-side, so this is genuinely gated, not just hidden.
//
// The one other request it makes is /api/expirations, to fill the expiration
// dropdown for whatever symbol is typed — the same route the chain surfaces
// already call. No new endpoint, no proxy change.
//
// `useIsOwner` decides whether the card is DRAWN; /api/watch decides whether
// the write is allowed. (See the CHROME-not-a-gate note in data/auth.tsx.)
// ─────────────────────────────────────────────────────────────────────────────

type Side = 'C' | 'P'

/** One manual probe row, as GET /api/watch lists it (auto-probed rows are hidden server-side). */
type ProbeRow = {
  id: number
  ticker: string
  expiration: string
  strike: number
  side: Side
  added_price: number | null
  snapshot: { mark: number | null; ts: number | string | null } | null
}

const n = (v: unknown): number | null => {
  const x = Number(v)
  return v == null || v === '' || !Number.isFinite(x) ? null : x
}
const px = (v: number | null) => (v == null ? '—' : v.toFixed(2))
const todayEt = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(new Date())

const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

function expiryLabel(ymd: string): string {
  const dt = new Date(`${ymd}T12:00:00`)
  if (Number.isNaN(dt.getTime())) return ymd
  return `${DAY_NAMES[dt.getDay()]} ${String(dt.getMonth() + 1).padStart(2, '0')}/${String(dt.getDate()).padStart(2, '0')}`
}

const LABEL = 'mb-1 block text-3xs font-bold uppercase tracking-[0.08em] text-faint opacity-60'
const FIELD =
  'w-full rounded-sm border border-line bg-surface2 px-2 py-1.5 text-sm text-fg outline-none placeholder:text-faint placeholder:opacity-50'

export default function QuickProbe() {
  const { isOwner } = useIsOwner()

  // Open by default — this is owner chrome in the owner's own drawer, so the
  // fields are there the moment Notes opens. Collapsible for when the note list
  // needs the room.
  const [open, setOpen] = useState(true)
  const [ticker, setTicker] = useState('SPX')
  const [expiries, setExpiries] = useState<string[]>([])
  const [expiration, setExpiration] = useState('')
  const [strike, setStrike] = useState('')
  const [side, setSide] = useState<Side>('C')

  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  /** Last contract successfully added, for the confirmation line. */
  const [added, setAdded] = useState<string | null>(null)

  // ── the probe list itself, so a probe SHOWS here instead of only on /owner/probe
  const [rows, setRows] = useState<ProbeRow[]>([])
  const [listErr, setListErr] = useState<string | null>(null)
  const loadRows = useCallback(async () => {
    try {
      const r = await fetch('/api/watch', { cache: 'no-store', credentials: 'same-origin' })
      const j = await r.json().catch(() => null)
      if (!r.ok || j?.error) {
        setListErr(String(j?.error || `Probe list failed (${r.status}).`))
        return
      }
      setRows(Array.isArray(j?.rows) ? (j.rows as ProbeRow[]) : [])
      setListErr(null)
    } catch {
      setListErr("Couldn't load the probe list.")
    }
  }, [])
  const removeRow = useCallback(async (id: number) => {
    setRows((rs) => rs.filter((r) => r.id !== id))
    try {
      await fetch('/api/watch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({ action: 'remove', id }),
      })
    } catch {
      /* optimistic — the next load corrects it */
    }
  }, [])

  // Guards a stale expiry response from overwriting a newer symbol's list.
  const expiryReqRef = useRef(0)

  // ── expirations for the typed symbol ───────────────────────────────────────
  const loadExpiries = useCallback(async (sym: string) => {
    const clean = sym.trim().toUpperCase()
    if (!clean) return
    const req = ++expiryReqRef.current
    try {
      const json = await fetch(`/api/expirations?ticker=${encodeURIComponent(clean)}`, {
        cache: 'no-store',
        credentials: 'same-origin',
      })
        .then((r) => (r.ok ? r.json() : null))
        .catch(() => null)
      if (req !== expiryReqRef.current) return
      const items: Array<Record<string, unknown>> = json?.data?.items ?? []
      const seen = new Set<string>()
      const list = items
        .map((it) => String(it['expiration-date'] ?? '').slice(0, 10))
        .filter((d) => d && !seen.has(d) && (seen.add(d), true))
        .sort()
      setExpiries(list)
      setExpiration((cur) => (cur && list.includes(cur) ? cur : (list[0] ?? '')))
    } catch {
      if (req === expiryReqRef.current) setExpiries([])
    }
  }, [])

  useEffect(() => {
    if (!open || !isOwner) return
    void loadExpiries(ticker)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, isOwner])

  // The server recorder snapshots every row each minute during RTH; re-read the
  // list on the same cadence while the card is open.
  useEffect(() => {
    if (!open || !isOwner) return
    void loadRows()
    const t = setInterval(() => void loadRows(), 60_000)
    return () => clearInterval(t)
  }, [open, isOwner, loadRows])

  // ── add the contract to the probe list ─────────────────────────────────────
  const probe = useCallback(async () => {
    const sym = ticker.trim().toUpperCase()
    const exp = expiration.trim().slice(0, 10)
    const k = parseFloat(strike)
    if (!sym) {
      setError('Enter a ticker.')
      return
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(exp)) {
      setError('Pick an expiration.')
      return
    }
    if (!Number.isFinite(k) || k <= 0) {
      setError('Enter a strike.')
      return
    }

    setBusy(true)
    setError(null)
    setAdded(null)
    try {
      const res = await fetch('/api/watch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({ action: 'add', ticker: sym, expiry: exp, strike: k, side }),
      })
      const j = await res.json().catch(() => null)
      if (!res.ok || j?.error) {
        setError(String(j?.error || `Probe failed (${res.status}).`))
        return
      }
      setAdded(`${sym} ${k}${side} · ${expiryLabel(exp)}`)
      void loadRows()
      // Strike is the one field that changes contract to contract; clear it so
      // the next probe on the same symbol/expiry is one number and Enter.
      setStrike('')
    } catch {
      setError("Probe failed — couldn't reach the watch service.")
    } finally {
      setBusy(false)
    }
  }, [ticker, expiration, strike, side, loadRows])

  // Owner chrome only — renders nothing (and fetches nothing) for anyone else.
  if (!isOwner) return null

  const sideBtn = (s: Side) => {
    const on = side === s
    return (
      <button
        key={s}
        type="button"
        onClick={() => {
          setSide(s)
          setAdded(null)
        }}
        className={[
          'flex-1 rounded-sm border py-1.5 text-2xs font-bold uppercase tracking-[0.1em] transition-colors',
          on
            ? s === 'C'
              ? 'border-accent bg-raised text-accent'
              : 'border-down bg-raised text-down'
            : 'border-line text-muted opacity-55 hover:opacity-100',
        ].join(' ')}
      >
        {s === 'C' ? 'Call' : 'Put'}
      </button>
    )
  }

  return (
    <div
      className={[
        'mb-3 shrink-0 overflow-hidden rounded-md border transition-colors',
        open ? 'border-accent bg-surface2' : 'border-line bg-surface',
      ].join(' ')}
    >
      {/* header / toggle */}
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="flex w-full items-center gap-2 px-3 py-2 text-left text-fg"
      >
        <span aria-hidden className="text-sm leading-none">
          🔎
        </span>
        <span className="flex-1 text-2xs font-bold uppercase tracking-[0.12em]">Quick Probe</span>
        <span className="text-3xs font-bold uppercase tracking-[0.1em] text-accent opacity-75">Owner</span>
        <svg
          width="12"
          height="12"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.5"
          strokeLinecap="round"
          strokeLinejoin="round"
          className={['text-faint opacity-60 transition-transform', open ? 'rotate-180' : ''].join(' ')}
        >
          <polyline points="6 9 12 15 18 9" />
        </svg>
      </button>

      {open && (
        <div className="flex flex-col gap-2 px-3 pb-3">
          {/* ticker */}
          <div>
            <label className={LABEL} htmlFor="qp-ticker">
              Ticker
            </label>
            <input
              id="qp-ticker"
              value={ticker}
              onChange={(e) => {
                setTicker(e.target.value.toUpperCase())
                setAdded(null)
              }}
              onBlur={() => void loadExpiries(ticker)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault()
                  void loadExpiries(ticker)
                }
              }}
              placeholder="SPX"
              autoComplete="off"
              spellCheck={false}
              className={`${FIELD} font-bold tracking-[0.06em]`}
            />
          </div>

          {/* expiration
              Both arms used to be native — a <select> whose menu the OS drew,
              and an <input type="date"> whose calendar the OS drew. This card
              is docked inside the Notes drawer, a scrolling panel, which is
              exactly where a platform popup looks most out of place. Same two
              arms, same handlers, ours to paint. */}
          <div>
            <span className={LABEL}>Expiration</span>
            {expiries.length > 0 ? (
              <Select
                value={expiration}
                onChange={(v) => {
                  setExpiration(v)
                  setAdded(null)
                }}
                ariaLabel="Expiration"
                className="w-full"
                menuWidth="w-48"
                triggerClassName={`${FIELD} flex cursor-pointer items-center justify-between gap-1 text-left`}
                options={expiries.map((d) => ({ value: d, label: `${expiryLabel(d)} · ${d}` }))}
              />
            ) : (
              <DatePicker
                value={expiration}
                onChange={(v) => {
                  setExpiration(v)
                  setAdded(null)
                }}
                title="Expiration"
                label={(v) => `${expiryLabel(v)} · ${v}`}
                placeholder="Expiration"
              />
            )}
          </div>

          {/* strike + side */}
          <div className="flex gap-2">
            <div className="min-w-0 flex-1">
              <label className={LABEL} htmlFor="qp-strike">
                Strike
              </label>
              <input
                id="qp-strike"
                value={strike}
                onChange={(e) => {
                  setStrike(e.target.value.replace(/[^0-9.]/g, ''))
                  setAdded(null)
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault()
                    void probe()
                  }
                }}
                inputMode="decimal"
                placeholder="6400"
                autoComplete="off"
                className={`${FIELD} tabular`}
              />
            </div>
            <div className="min-w-0 flex-1">
              <span className={LABEL}>Side</span>
              <div className="flex gap-1.5">
                {sideBtn('C')}
                {sideBtn('P')}
              </div>
            </div>
          </div>

          <button
            type="button"
            onClick={() => void probe()}
            disabled={busy}
            className={[
              'mt-0.5 rounded-sm border border-accent bg-raised py-2 text-2xs font-bold uppercase tracking-[0.12em] text-accent',
              busy ? 'cursor-default opacity-55' : 'cursor-pointer',
            ].join(' ')}
          >
            {busy ? 'Adding…' : 'Probe'}
          </button>

          {error && <div className="text-xs leading-snug text-down">{error}</div>}

          {added && !error && (
            <div className="text-xs leading-snug text-accent">
              Added <strong className="font-bold">{added}</strong> to the probe list.
            </div>
          )}

          {!added && !error && (
            <div className="text-center text-3xs tracking-[0.04em] text-faint opacity-45">
              Adds the contract to the owner probe list
            </div>
          )}

          {/* probe list — same rows /owner/probe shows, live-expiry first */}
          <div className="mt-1 border-t border-line pt-2">
            <div className="mb-1 flex items-center">
              <span className={`${LABEL} mb-0 flex-1`}>Probing · {rows.length}</span>
              <button
                type="button"
                onClick={() => void loadRows()}
                className="cursor-pointer text-3xs font-bold uppercase tracking-[0.1em] text-accent opacity-75 hover:opacity-100"
              >
                Refresh
              </button>
            </div>
            {listErr && <div className="text-xs leading-snug text-down">{listErr}</div>}
            {!listErr && rows.length === 0 && (
              <div className="text-3xs text-faint opacity-50">Nothing on the probe list yet.</div>
            )}
            <div className="flex flex-col gap-1">
              {[...rows]
                .sort((a, b) => {
                  const t = todayEt()
                  const ae = a.expiration < t ? 1 : 0
                  const be = b.expiration < t ? 1 : 0
                  return ae - be || a.expiration.localeCompare(b.expiration) || a.ticker.localeCompare(b.ticker)
                })
                .map((r) => {
                  const mark = n(r.snapshot?.mark)
                  const entry = n(r.added_price)
                  const pnl = mark != null && entry != null ? mark - entry : null
                  const pct = pnl != null && entry ? (pnl / entry) * 100 : null
                  const expired = r.expiration < todayEt()
                  return (
                    <div
                      key={r.id}
                      className={[
                        'flex items-center gap-2 rounded-sm border border-line bg-surface px-2 py-1 text-xs',
                        expired ? 'opacity-45' : '',
                      ].join(' ')}
                    >
                      <div className="min-w-0 flex-1">
                        <div className="truncate font-bold text-fg">
                          {r.ticker} {n(r.strike)}
                          <span className={r.side === 'C' ? 'text-accent' : 'text-down'}>{r.side}</span>
                          <span className="ml-1 text-3xs font-normal text-faint">{expiryLabel(r.expiration)}</span>
                        </div>
                        <div className="tabular text-3xs text-muted">
                          {px(entry)} → {px(mark)}
                          {pct != null && (
                            <span className={['ml-1 font-bold', pnl! >= 0 ? 'text-up' : 'text-down'].join(' ')}>
                              {pct >= 0 ? '+' : ''}
                              {pct.toFixed(1)}%
                            </span>
                          )}
                        </div>
                      </div>
                      <button
                        type="button"
                        onClick={() => void removeRow(r.id)}
                        aria-label={`Stop probing ${r.ticker} ${r.strike}${r.side}`}
                        className="cursor-pointer px-1 text-sm leading-none text-faint opacity-50 hover:opacity-100"
                      >
                        ×
                      </button>
                    </div>
                  )
                })}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
