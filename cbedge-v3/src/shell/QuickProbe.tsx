import { useCallback, useEffect, useRef, useState } from 'react'
import { useIsOwner } from '@/data/auth'

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
      // Strike is the one field that changes contract to contract; clear it so
      // the next probe on the same symbol/expiry is one number and Enter.
      setStrike('')
    } catch {
      setError("Probe failed — couldn't reach the watch service.")
    } finally {
      setBusy(false)
    }
  }, [ticker, expiration, strike, side])

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

          {/* expiration */}
          <div>
            <label className={LABEL} htmlFor="qp-exp">
              Expiration
            </label>
            {expiries.length > 0 ? (
              <select
                id="qp-exp"
                value={expiration}
                onChange={(e) => {
                  setExpiration(e.target.value)
                  setAdded(null)
                }}
                className={`${FIELD} cursor-pointer`}
              >
                {expiries.map((d) => (
                  <option key={d} value={d}>{`${expiryLabel(d)} · ${d}`}</option>
                ))}
              </select>
            ) : (
              <input
                id="qp-exp"
                type="date"
                value={expiration}
                onChange={(e) => {
                  setExpiration(e.target.value)
                  setAdded(null)
                }}
                className={FIELD}
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
        </div>
      )}
    </div>
  )
}
