import { useState, type FormEvent } from 'react'
import { useBudget, useAddBudgetRow, useMarkBillPaid, useDeleteBudgetRow } from '../hooks'
import { ApiError, type Bank, type BudgetBill, type BudgetRow } from '../api'
import { T, label, body, section, row, input, button, segment } from '../theme'
import BudgetOverview from '../components/BudgetOverview'

/**
 * Money, phone-first.
 *
 * Reads the SAME tables as /owner/budget — one register, two views. A payment
 * entered here shows on the desktop page immediately, and vice versa.
 *
 * TWO TABS, because the two jobs are different:
 *   Overview — every card and graph from the desktop page, READ ONLY. The
 *     numbers are computed server-side (a port of the desktop's memos), never
 *     recomputed here, so the phone can't disagree with the laptop.
 *   Register — the small amount of writing that's actually worth doing on a
 *     phone: log what you just spent, tick a bill paid.
 *
 * Recurring bills are projections, not rows: they exist as rules until someone
 * marks one paid, which materialises it. That's why a bill has "Paid" instead
 * of a delete, and why projected rows can't be edited here.
 */

const BANKS: Bank[] = ['coastal', 'truist', 'secu']
const BANK_LABEL: Record<Bank, string> = { coastal: 'Coastal', truist: 'Truist', secu: 'SECU' }

const fmt = (n: number, currency = 'USD') =>
  new Intl.NumberFormat('en-US', { style: 'currency', currency, maximumFractionDigits: 2 }).format(n || 0)

/** "8/14" from "2026-08-14" — sliced, never parsed, so no timezone can shift it. */
const shortDate = (iso: string) => { const [, m, d] = iso.split('-'); return `${Number(m)}/${Number(d)}` }

const monthLabel = (m: string) => {
  const [y, mo] = m.split('-').map(Number)
  return new Date(y, mo - 1, 1).toLocaleDateString('en-US', { month: 'long', year: 'numeric' })
}
const shiftMonth = (m: string, delta: number) => {
  const [y, mo] = m.split('-').map(Number)
  const d = new Date(y, mo - 1 + delta, 1)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}

export default function Budget() {
  const [month, setMonth] = useState<string | undefined>(undefined)
  const [tab, setTab] = useState<'overview' | 'register'>('overview')
  const { data, isLoading, error, refetch } = useBudget(month)

  if (isLoading) return <div style={{ ...body(14), color: T.muted }}>Loading…</div>
  if (error) {
    return (
      <div>
        <div style={{ ...body(15), color: T.bad }}>
          {error instanceof ApiError ? error.message : 'Something went wrong.'}
        </div>
        <button onClick={() => void refetch()} style={{ ...button('ghost'), marginTop: 14 }}>Try again</button>
      </div>
    )
  }
  if (!data) return null

  const cur = data.currency
  const overdue = data.bills.filter((b) => b.overdue)
  const upcoming = data.bills.filter((b) => !b.overdue)

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 22 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
        <button onClick={() => setMonth(shiftMonth(data.month, -1))} style={nav} aria-label="Previous month">‹</button>
        <span style={label()}>{monthLabel(data.month)}</span>
        <button onClick={() => setMonth(shiftMonth(data.month, 1))} style={nav} aria-label="Next month">›</button>
      </div>

      <div style={{ display: 'flex', gap: 6 }}>
        <button onClick={() => setTab('overview')} style={{ ...segment(tab === 'overview'), flex: 1 }}>Overview</button>
        <button onClick={() => setTab('register')} style={{ ...segment(tab === 'register'), flex: 1 }}>Register</button>
      </div>

      {tab === 'overview' ? (
        <BudgetOverview
          o={data.overview}
          categories={data.categories}
          unsortedSpend={data.unsortedSpend}
          balances={data.balances}
          currency={cur}
          month={data.month}
        />
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 26 }}>
          <div style={label({ letterSpacing: '0.1em' })}>
            <span style={{ color: T.good }}>{fmt(data.totals.income, cur)} in</span>
            <span style={{ color: T.faint }}> · </span>
            <span>{fmt(data.totals.expenses, cur)} out</span>
            <span style={{ color: T.faint }}> · </span>
            <span style={{ color: data.totals.net < 0 ? T.warn : T.ink }}>
              {fmt(data.totals.net, cur)} net
            </span>
          </div>

          {overdue.length > 0 && <Bills title="Past due" bills={overdue} currency={cur} accent />}
          {upcoming.length > 0 && <Bills title="Coming up" bills={upcoming} currency={cur} />}

          <AddRow today={data.today} />
          <Register rows={data.rows} currency={cur} />
        </div>
      )}
    </div>
  )
}

// ── Bills ────────────────────────────────────────────────────────────────────

function Bills({ title, bills, currency, accent }: {
  title: string; bills: BudgetBill[]; currency: string; accent?: boolean
}) {
  const mark = useMarkBillPaid()
  const [busy, setBusy] = useState<string | null>(null)

  return (
    <div style={section()}>
      <div style={{ display: 'flex', justifyContent: 'space-between' }}>
        <span style={label(accent ? { color: T.warn } : {})}>{title}</span>
        <span style={label()}>{bills.length}</span>
      </div>
      <div>
        {bills.map((b) => (
          <div key={b.tag} style={row()}>
            <span style={label({ width: 34, flexShrink: 0, color: accent ? T.warn : T.muted })}>
              {shortDate(b.date)}
            </span>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ ...body(14), wordBreak: 'break-word' }}>{b.label}</div>
              <div style={label({ marginTop: 2, letterSpacing: '0.1em' })}>{BANK_LABEL[b.bank]}</div>
            </div>
            <span style={{ ...body(14), color: T.inkSoft }}>{fmt(b.amount, currency)}</span>
            <button
              onClick={() => { setBusy(b.tag); mark.mutate(b, { onSettled: () => setBusy(null) }) }}
              disabled={busy === b.tag}
              style={{ ...segment(false), flexShrink: 0, opacity: busy === b.tag ? 0.5 : 1 }}
            >
              {busy === b.tag ? '…' : 'Paid'}
            </button>
          </div>
        ))}
      </div>
    </div>
  )
}

// ── Add ──────────────────────────────────────────────────────────────────────

function AddRow({ today }: { today: string }) {
  const addRow = useAddBudgetRow()
  const [open, setOpen] = useState(false)
  const [date, setDate] = useState(today)
  const [labelText, setLabelText] = useState('')
  const [amount, setAmount] = useState('')
  const [bank, setBank] = useState<Bank>('secu')
  const [kind, setKind] = useState<'pay' | 'income'>('pay')
  const [error, setError] = useState<string | null>(null)

  if (!open) {
    return (
      <button onClick={() => setOpen(true)}
              style={{ ...label({ color: T.accent }), background: 'none', border: 'none',
                       padding: '12px 0', cursor: 'pointer', minHeight: 42, textAlign: 'left' }}>
        + Add entry
      </button>
    )
  }

  return (
    <form
      onSubmit={async (e: FormEvent) => {
        e.preventDefault()
        if (addRow.isPending) return
        setError(null)
        try {
          // Always positive; `kind` decides the sign server-side, so a stray
          // minus can't turn a payment into a deposit.
          await addRow.mutateAsync({ date, label: labelText, bank, amount: Math.abs(Number(amount)), kind })
          setLabelText(''); setAmount(''); setOpen(false)
        } catch (err) {
          setError(err instanceof ApiError ? err.message : 'Could not add that.')
        }
      }}
      style={section()}
    >
      <span style={label()}>New entry</span>
      <input style={{ ...input(), marginTop: 10 }} placeholder="What was it?"
             value={labelText} onChange={(e) => setLabelText(e.target.value)} autoFocus />
      <div style={{ display: 'flex', gap: 8, marginTop: 9 }}>
        <input style={{ ...input(), flex: 1 }} type="number" step="0.01" inputMode="decimal"
               placeholder="0.00" value={amount} onChange={(e) => setAmount(e.target.value)} />
        <input style={{ ...input(), flex: 1 }} type="date" value={date}
               onChange={(e) => setDate(e.target.value)} />
      </div>
      <div style={{ display: 'flex', gap: 6, marginTop: 9, flexWrap: 'wrap' }}>
        <button type="button" onClick={() => setKind('pay')} style={segment(kind === 'pay')}>− Pay</button>
        <button type="button" onClick={() => setKind('income')} style={segment(kind === 'income')}>+ Income</button>
        {BANKS.map((b) => (
          <button key={b} type="button" onClick={() => setBank(b)} style={segment(bank === b)}>
            {BANK_LABEL[b]}
          </button>
        ))}
      </div>
      {error && <div style={label({ color: T.bad, marginTop: 9, letterSpacing: '0.06em' })}>{error}</div>}
      <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
        <button type="button" onClick={() => { setOpen(false); setError(null) }}
                style={{ ...button('ghost'), flex: 1 }}>Cancel</button>
        <button type="submit" disabled={addRow.isPending}
                style={{ ...button('primary'), flex: 1, opacity: addRow.isPending ? 0.5 : 1 }}>
          {addRow.isPending ? 'Saving…' : 'Add'}
        </button>
      </div>
    </form>
  )
}

// ── Register ─────────────────────────────────────────────────────────────────

function Register({ rows, currency }: { rows: BudgetRow[]; currency: string }) {
  const del = useDeleteBudgetRow()
  const [openId, setOpenId] = useState<number | null>(null)
  // Newest first — on a phone you're checking what just happened, not reading
  // the month from the top.
  const list = rows.slice().reverse()

  return (
    <div style={section()}>
      <div style={{ display: 'flex', justifyContent: 'space-between' }}>
        <span style={label()}>Register</span>
        <span style={label()}>{list.length}</span>
      </div>
      {!list.length && <div style={{ ...body(14), color: T.muted, marginTop: 10 }}>Nothing this month yet.</div>}
      <div>
        {list.map((r) => (
          <div key={r.id}>
            <div onClick={() => setOpenId(openId === r.id ? null : r.id)} style={row({ cursor: 'pointer' })}>
              <span style={label({ width: 34, flexShrink: 0 })}>{shortDate(r.entry_date)}</span>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ ...body(14), wordBreak: 'break-word', color: r.recurring ? T.muted : T.ink }}>
                  {r.label}
                  {r.recurring && <span style={label({ marginLeft: 7, color: T.warn })}>due</span>}
                </div>
                <div style={label({ marginTop: 2, letterSpacing: '0.1em' })}>{BANK_LABEL[r.bank]}</div>
              </div>
              <div style={{ textAlign: 'right', flexShrink: 0 }}>
                <div style={{ ...body(14), color: r.amount > 0 ? T.good : T.ink }}>
                  {r.amount > 0 ? '+' : ''}{fmt(r.amount, currency)}
                </div>
                <div style={label({ marginTop: 2, color: r.balance < 0 ? T.bad : T.muted, letterSpacing: '0.06em' })}>
                  {fmt(r.balance, currency)}
                </div>
              </div>
            </div>
            {openId === r.id && (
              <div style={{ padding: '0 0 12px 42px' }}>
                {r.recurring ? (
                  // A projection has no database row to edit or delete. Saying
                  // so beats a Delete button that would 400.
                  <div style={label({ letterSpacing: '0.06em' })}>
                    Scheduled bill — not entered yet. Mark it paid above to record it.
                  </div>
                ) : (
                  <button onClick={() => { del.mutate(r.id); setOpenId(null) }}
                          style={{ ...segment(false), color: T.bad, borderColor: 'rgba(239,68,68,0.35)' }}>
                    Delete
                  </button>
                )}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}

const nav: React.CSSProperties = {
  appearance: 'none', width: 40, height: 40, borderRadius: 3,
  border: `1px solid ${T.ruleStrong}`, background: 'transparent',
  color: T.ink, fontSize: 17, cursor: 'pointer', lineHeight: 1,
}
