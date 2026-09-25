import { Fragment, useMemo, useState } from 'react'
import { ContractProbe, type ProbeAlertInfo } from '@/board/topFlow/ContractProbe'
import { fmtPremium, fmtStrike } from '@/data/flowMath'
import { alertToRow, type AlertsStore, type WhaleAlert } from './alertsStore'

// ─────────────────────────────────────────────────────────────────────────────
// TRACKED CONTRACTS — the card at the bottom of /whales.
//
// One row per contract you flagged, your note beside it, and a drawer that
// draws the SAME probe the prints table draws. Nothing here notifies: this is a
// list you come back to, which is why it is a server row and not a filter.
//
// ── GROUPING IS NOT FILTERING ────────────────────────────────────────────────
// The three GROUP BY stops re-bucket the same rows and never hide any. That is
// the difference between this control and every other control on the page, and
// it is why the header counts are per group rather than a single total that
// would not move.
//
//   TRACKED   newest flag first, by the day you flagged it. The default,
//             because the question this card answers most mornings is "what was
//             I looking at yesterday".
//   TICKER    one header per underlying. Answers "how much am I carrying in
//             NVDA" without reading eleven rows.
//   EXPIRY    what dies first. This is the one that reads like a to-do list,
//             and on a page whose rows are deleted AT expiry it is also the
//             running countdown.
//
// ── THE TWO PICTURES ─────────────────────────────────────────────────────────
// LIVE is redrawn from the four saved fields every time the drawer opens, so it
// is never stale and costs nothing to keep. TRACKED is the bars frozen the
// minute you pressed the button — the one thing that genuinely cannot be
// recovered later, and the only way "what has it done since I flagged it" is a
// side-by-side instead of a memory.
// ─────────────────────────────────────────────────────────────────────────────

type GroupBy = 'tracked' | 'ticker' | 'expiry'

const GROUPS: Array<{ key: GroupBy; label: string; title: string }> = [
  { key: 'tracked', label: 'TRACKED', title: 'Group by the day you flagged it, newest first' },
  { key: 'ticker', label: 'TICKER', title: 'Group by underlying' },
  { key: 'expiry', label: 'EXPIRY', title: 'Group by expiry, soonest first — what dies next' },
]

const ET = 'America/New_York'
const etYmd = (ms: number) =>
  new Intl.DateTimeFormat('en-CA', { timeZone: ET, year: 'numeric', month: '2-digit', day: '2-digit' })
    .format(new Date(ms))

const fmtDay = (ymd: string) => {
  const d = new Date(`${ymd}T12:00:00Z`)
  if (Number.isNaN(d.getTime())) return ymd
  const today = etYmd(Date.now())
  const yest = etYmd(Date.now() - 86_400_000)
  const label = d.toLocaleDateString('en-US', { weekday: 'short', month: 'numeric', day: 'numeric', timeZone: 'UTC' })
  return ymd === today ? `Today · ${label}` : ymd === yest ? `Yesterday · ${label}` : label
}

const fmtExpiry = (iso: string) => {
  const d = new Date(`${iso}T00:00:00Z`)
  if (Number.isNaN(d.getTime())) return iso
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: '2-digit', timeZone: 'UTC' })
}

/** Calendar days to expiry, ET. Zero is today — the row still lives today. */
function dte(expiry: string): number | null {
  const exp = Date.parse(`${expiry}T00:00:00Z`)
  if (!Number.isFinite(exp)) return null
  const today = Date.parse(`${etYmd(Date.now())}T00:00:00Z`)
  return Math.round((exp - today) / 86_400_000)
}

/** "Sep 24, 10:42 AM" — the date matters on a row that can be weeks old. */
const fmtWhen = (ms: number) =>
  new Intl.DateTimeFormat('en-US', { timeZone: ET, month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', hour12: true })
    .format(new Date(ms))

const fmtTime = (ms: number) =>
  new Intl.DateTimeFormat('en-US', { timeZone: ET, hour: 'numeric', minute: '2-digit', hour12: true })
    .format(new Date(ms))

export function TrackedAlertsCard({ store }: { store: AlertsStore }) {
  const { alerts, marks, loading, ready, unavailable, error } = store
  const [groupBy, setGroupBy] = useState<GroupBy>('tracked')
  const [openId, setOpenId] = useState<number | null>(null)

  // Bucketed, then ordered. Each bucket carries its own count and premium so a
  // collapsed read of the headers alone is still an answer.
  const groups = useMemo(() => {
    const by = new Map<string, { label: string; sort: string; rows: WhaleAlert[] }>()
    for (const a of alerts) {
      let key: string, label: string, sort: string
      if (groupBy === 'ticker') {
        key = a.underlying; label = a.underlying; sort = a.underlying
      } else if (groupBy === 'expiry') {
        key = a.expiry; label = fmtExpiry(a.expiry); sort = a.expiry
      } else {
        const ymd = etYmd(a.createdAt)
        key = ymd; label = fmtDay(ymd)
        // Descending for dates, so the newest day heads the list; the other two
        // read ascending. Inverted here rather than at the sort so the
        // comparator below stays one line.
        sort = String(9_999_999_999_999 - Date.parse(`${ymd}T00:00:00Z`))
      }
      const g = by.get(key) ?? { label, sort, rows: [] }
      g.rows.push(a)
      by.set(key, g)
    }
    return [...by.values()]
      .sort((x, y) => x.sort.localeCompare(y.sort))
      .map((g) => ({
        ...g,
        rows: g.rows.slice().sort((x, y) => y.createdAt - x.createdAt),
        premium: g.rows.reduce((n, r) => n + (r.printPremium ?? 0), 0),
      }))
  }, [alerts, groupBy])

  if (unavailable) return null

  return (
    <div className="rounded-md border border-line bg-surface">
      <div className="flex flex-wrap items-baseline gap-2 border-b border-line px-3 py-2">
        <span className="text-sm font-bold tracking-[0.02em] text-fg">Tracked contracts</span>
        <span className="text-2xs text-fg">
          saved to your login
          {ready && alerts.length ? ` · ${alerts.length} tracked` : ''}
          {loading && !ready ? ' · loading…' : ''}
        </span>
        <div className="ml-auto flex items-center gap-1.5">
          {GROUPS.map((g) => (
            <button
              key={g.key}
              type="button"
              title={g.title}
              onClick={() => setGroupBy(g.key)}
              className={[
                'tabular rounded-sm border px-2 py-0.5 text-2xs font-bold tracking-[0.08em] transition-colors',
                groupBy === g.key ? 'border-fg/25 bg-raised text-fg' : 'border-line text-fg hover:text-fg',
              ].join(' ')}
            >
              {g.label}
            </button>
          ))}
        </div>
      </div>

      {error && (
        <div className="border-b border-line px-3 py-2 text-2xs text-warn">
          Could not reach your tracked list — {error}
        </div>
      )}

      {ready && !alerts.length ? (
        <div className="px-3 py-4 text-xs leading-relaxed text-fg">
          Nothing tracked yet. Hit <span className="font-bold text-fg">TRACK</span> on a print above, or
          on a contract in the lookup, and it lands here with its chart and a place for your note. Tracked
          contracts follow your login, not this browser — and a contract is removed on the day after it
          expires.
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-xs">
            <thead>
              <tr className="text-2xs uppercase tracking-[0.09em] text-fg">
                <th className="w-6 px-1 py-2" />
                <th className="px-2 py-2 text-left font-bold">Contract</th>
                <th className="px-2 py-2 text-left font-bold">Expiry</th>
                <th className="px-2 py-2 text-right font-bold">Entry</th>
                <th className="px-2 py-2 text-right font-bold">Mark</th>
                <th className="px-2 py-2 text-right font-bold">Move</th>
                <th className="min-w-[180px] px-2 py-2 text-left font-bold">Note</th>
                <th className="px-2 py-2 text-right font-bold">Tracked</th>
                <th className="w-7 px-1 py-2" />
              </tr>
            </thead>
            <tbody>
              {groups.map((g) => (
                <Fragment key={g.label}>
                  <tr>
                    <td colSpan={9} className="border-t border-line bg-surface2 px-2 py-1.5 text-2xs font-bold uppercase tracking-[0.1em] text-fg">
                      {g.label}
                      <span className="tabular font-normal text-fg">
                        {' '}· {g.rows.length}
                        {g.premium > 0 ? ` · ${fmtPremium(g.premium)} behind them` : ''}
                      </span>
                    </td>
                  </tr>
                  {g.rows.map((a) => (
                    <AlertRow
                      key={a.id}
                      a={a}
                      mark={marks.get(a.id)}
                      open={openId === a.id}
                      onToggle={() => setOpenId((id) => (id === a.id ? null : a.id))}
                      store={store}
                    />
                  ))}
                </Fragment>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

function AlertRow({ a, mark, open, onToggle, store }: {
  a: WhaleAlert
  /** undefined = not fetched yet, null = fetched and the contract has no bars. */
  mark: number | null | undefined
  open: boolean
  onToggle: () => void
  store: AlertsStore
}) {
  const [draft, setDraft] = useState<string | null>(null)
  const row = useMemo(() => alertToRow(a), [a])
  const days = dte(a.expiry)

  const entry = a.entryPrice
  const pct = entry != null && entry > 0 && mark != null ? ((mark - entry) / entry) * 100 : null
  const dollars = entry != null && mark != null && a.printSize
    ? (mark - entry) * a.printSize * 100
    : null
  const ink = pct == null ? 'text-fg' : pct > 0 ? 'text-up' : pct < 0 ? 'text-down' : 'text-fg'

  // What the pop-out's trade card says about this row — see ProbeAlertInfo.
  const alertInfo = useMemo<ProbeAlertInfo>(() => {
    const bits: string[] = []
    if (a.source === 'whale') {
      bits.push('Whale print')
      if (a.printPremium) bits.push(fmtPremium(a.printPremium))
      if (a.printSize) bits.push(`${a.printSize.toLocaleString()} ct${entry != null ? ` @ ${entry.toFixed(2)}` : ''}`)
      if (a.printTs) bits.push(fmtWhen(a.printTs))
    } else {
      bits.push('Tracked from lookup')
      if (entry != null) bits.push(`entry ${entry.toFixed(2)}`)
      if (a.printSize) bits.push(`${a.printSize.toLocaleString()} ct`)
    }
    return {
      shotId: `tracked:${a.id}`,
      shotLabel: 'Tracked contract',
      file: `tracked-${a.underlying}-${a.strike}${a.optType}-${a.expiry}`,
      headline: bits.join(' · '),
      dteLabel: days != null ? `${days}d` : null,
      trackedAt: a.createdAt,
      note: a.note || undefined,
      // Layout A's tiles — this row's own numbers, so the PNG says what the
      // table says.
      items: [
        { k: 'Contract', v: `${a.underlying} ${fmtStrike(a.strike)}${a.optType}`, sub: a.source === 'whale' ? 'from print' : 'from lookup' },
        { k: 'Expiry', v: fmtExpiry(a.expiry), sub: days != null ? `${days}d to expiry` : undefined, ink: days != null && days <= 2 ? 'text-warn' : undefined },
        { k: 'Entry', v: entry?.toFixed(2) ?? '—', sub: a.printTs ? `printed ${fmtWhen(a.printTs)}` : undefined },
        { k: 'Mark', v: mark == null ? '—' : mark.toFixed(2) },
        {
          k: 'Move',
          v: pct == null ? '—' : `${pct >= 0 ? '+' : '−'}${Math.abs(pct).toFixed(1)}%`,
          sub: dollars != null ? `${dollars >= 0 ? '+' : '−'}${fmtPremium(Math.abs(dollars))}` : undefined,
          ink,
        },
        { k: 'Size', v: a.printSize ? `${a.printSize.toLocaleString()} ct` : '—' },
        { k: 'Premium', v: a.printPremium ? fmtPremium(a.printPremium) : '—' },
        { k: 'Tracked', v: fmtWhen(a.createdAt) },
      ],
    }
  }, [a, days, entry, mark, pct, dollars, ink])

  const commitNote = () => {
    if (draft == null) return
    const next = draft.trim().slice(0, 500)
    setDraft(null)
    if (next !== a.note) void store.setNote(a.id, next)
  }

  return (
    <>
      <tr className="border-t border-line hover:bg-raised">
        <td className="px-1 py-1.5 align-middle">
          <button
            type="button"
            onClick={onToggle}
            aria-label={open ? 'Close chart' : 'Open chart'}
            title={open ? 'Close the chart' : 'Open the chart'}
            className="h-5 w-5 rounded-sm border border-line text-2xs leading-none text-fg hover:text-fg"
          >
            {open ? '▾' : '▸'}
          </button>
        </td>
        <td className="whitespace-nowrap px-2 py-1.5">
          <span className="font-semibold text-fg">{a.underlying}</span>{' '}
          <span className={[
            'tabular rounded-sm border px-1 py-px text-2xs font-bold',
            a.optType === 'P'
              ? 'border-down/50 bg-down/10 text-down'
              : 'border-warn/50 bg-warn/10 text-warn',
          ].join(' ')}>
            {fmtStrike(a.strike)}{a.optType}
          </span>
          <div className="tabular text-3xs text-fg">
            {a.source === 'whale'
              ? `from print${a.printSize ? ` · ${a.printSize.toLocaleString()} ct` : ''}${a.printPremium ? ` · ${fmtPremium(a.printPremium)}` : ''}`
              : 'from lookup · no print'}
          </div>
        </td>
        <td className="tabular whitespace-nowrap px-2 py-1.5 text-fg">
          {fmtExpiry(a.expiry)}
          {/* A tracked contract is deleted the day after it expires, so this
              number is a countdown to the row leaving — worth colouring. */}
          <span className={days != null && days <= 2 ? ' text-warn' : ' text-fg'}>
            {days != null ? ` ${days}d` : ''}
          </span>
        </td>
        <td className="tabular px-2 py-1.5 text-right text-fg">{entry?.toFixed(2) ?? '—'}</td>
        <td className="tabular px-2 py-1.5 text-right text-fg">
          {mark === undefined ? <span className="text-fg">…</span> : mark?.toFixed(2) ?? '—'}
        </td>
        <td className={['tabular px-2 py-1.5 text-right font-semibold', ink].join(' ')}>
          {pct == null ? '—' : `${pct >= 0 ? '+' : '−'}${Math.abs(pct).toFixed(1)}%`}
          {dollars != null && (
            <div className="text-3xs font-normal">
              {dollars >= 0 ? '+' : '−'}{fmtPremium(Math.abs(dollars))}
            </div>
          )}
        </td>
        <td className="px-2 py-1.5">
          {/* An input that is always an input reads as a form. This is a note
              you write once and glance at for weeks, so it renders as text and
              becomes an input on click. */}
          {draft == null ? (
            <button
              type="button"
              onClick={() => setDraft(a.note)}
              title="Click to edit"
              className={[
                'w-full truncate text-left text-2xs',
                a.note ? 'border-b border-dashed border-line text-fg' : 'text-fg',
              ].join(' ')}
            >
              {a.note || 'add a note…'}
            </button>
          ) : (
            <input
              autoFocus
              value={draft}
              maxLength={500}
              onChange={(e) => setDraft(e.target.value)}
              onBlur={commitNote}
              onKeyDown={(e) => {
                if (e.key === 'Enter') commitNote()
                if (e.key === 'Escape') setDraft(null)
              }}
              className="w-full rounded-sm border border-line bg-bg px-1.5 py-0.5 text-2xs text-fg outline-none focus:border-accent"
            />
          )}
        </td>
        <td className="tabular whitespace-nowrap px-2 py-1.5 text-right text-3xs text-fg">
          {fmtTime(a.createdAt)}
        </td>
        <td className="px-1 py-1.5">
          <button
            type="button"
            onClick={() => store.remove(a.id)}
            aria-label="Stop tracking"
            title="Stop tracking this contract"
            className="h-5 w-5 rounded-sm border border-line text-2xs leading-none text-fg hover:border-down/50 hover:text-down"
          >
            ✕
          </button>
        </td>
      </tr>

      {open && (
        <tr>
          <td colSpan={9} className="border-t border-line bg-surface2 p-0">
            {/* ── ONE PANE, THE LIVE ONE ──────────────────────────────────────
                This was a two-up: live on the left, the bars frozen at the
                minute you tracked it on the right. The frozen pane is gone.
                The live probe already carries the entry rung, the marker at
                the moment of the print and the move against it, so "what has
                it done since" is legible in one picture — and the pair cost
                half the width to say it twice, at half the resolution, with a
                RE-SNAPSHOT button whose job was to keep the weaker half
                current.

                The snapshot itself is still taken and still stored server-side
                (see the SNAPSHOT note in api-router.js) — it is the one thing
                about a tracked contract that cannot be rebuilt later, so it
                keeps being recorded whether or not anything draws it.
            ──────────────────────────────────────────────────────────────── */}
            <div className="p-2">
              <div className="flex min-h-[380px] flex-col rounded-sm border border-line bg-surface">
                <div className="border-b border-line px-3 py-1 text-3xs font-bold uppercase tracking-[0.11em] text-fg">
                  Live — redrawn from the saved contract
                </div>
                <ContractProbe
                  key={`live:${a.id}`}
                  row={row}
                  onClose={onToggle}
                  // A tracked LOOKUP has a cost basis but no moment it was paid
                  // at, so the entry draws as a rung with no marker — same
                  // contract the lookup panel makes.
                  entryAt={a.printTs ?? null}
                  alertInfo={alertInfo}
                />
              </div>
            </div>
          </td>
        </tr>
      )}
    </>
  )
}

/**
 * The button that puts a contract in the card. Lives on the prints table and
 * beside LOOK UP, and says which of the two states it is in rather than firing
 * silently — a save with no acknowledgement is a button people press twice.
 */
export function TrackButton({ tracked, busy, onClick, compact = false }: {
  tracked: boolean
  busy?: boolean
  onClick: () => void
  compact?: boolean
}) {
  return (
    <button
      type="button"
      onClick={(e) => { e.stopPropagation(); onClick() }}
      disabled={busy}
      title={tracked ? 'Already in Tracked contracts — click to stop tracking' : 'Keep this contract in Tracked contracts'}
      className={[
        'rounded-sm border font-bold uppercase tracking-[0.1em] transition-colors',
        compact ? 'px-1.5 py-0.5 text-3xs' : 'px-2 py-1 text-2xs',
        busy
          ? 'cursor-wait border-line text-fg opacity-60'
          : tracked
            ? 'border-up/50 bg-up/10 text-up hover:border-down/50 hover:bg-down/10 hover:text-down'
            : 'border-line text-fg hover:border-accent hover:text-accent',
      ].join(' ')}
    >
      {busy ? '…' : tracked ? 'Tracked' : 'Track'}
    </button>
  )
}
