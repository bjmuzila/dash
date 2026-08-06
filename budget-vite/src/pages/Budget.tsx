import { useState, type FormEvent } from 'react'
import { useBudget, useAddBudgetRow, useMarkBillPaid, useDeleteBudgetRow } from '../hooks'
import { ApiError, type Bank, type BudgetBill, type BudgetRow } from '../api'
import { T, card, labelCap, input, button } from '../theme'

/**
 * Budget, phone-first.
 *
 * Reads the SAME tables as /owner/budget — one register, two views. A payment
 * entered here shows on the desktop page immediately, and vice versa.
 *
 * Recurring bills are projections, not rows: they exist as rules until someone
 * marks one paid, which materialises it. That's why a bill has "Paid" instead
 * of a delete, and why projected rows can't be edited here.
 */

const BANKS: Bank[] = ['coastal', 'truist', 'secu']
const BANK_LABEL: Record<Bank, string> = { coastal: 'COASTAL', truist: 'TRUIST', secu: 'SECU' }

const fmt = (n: number, currency = 'USD') =>
  new Intl.NumberFormat('en-US', { style: 'currency', currency, maximumFractionDigits: 2 }).format(n || 0)

/** "8/14" from "2026-08-14" — sliced, never parsed, so no timezone can shift it. */
const shortDate = (iso: string) => {
  const [, m, d] = iso.split('-')
  return `${Number(m)}/${Number(d)}`
}

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
  const { data, isLoading, error, refetch } = useBudget(month)

  if (isLoading) {
    return <div style={{ color: T.muted, fontSize: 14, padding: '30px 0', textAlign: 'center' }}>Loading…</div>
  }
  if (error) {
    return (
      <section style={card()}>
        <div style={{ color: T.red, fontWeight: 700, fontSize: 15 }}>
          {error instanceof ApiError ? error.message : 'Something went wrong.'}
        </div>
        <button onClick={() => void refetch()} style={{ ...button('ghost'), marginTop: 12 }}>Try again</button>
      </section>
    )
  }
  if (!data) return null

  const cur = data.currency
  const total = BANKS.reduce((s, b) => s + (data.balances[b] || 0), 0)
  const overdue = data.bills.filter((b) => b.overdue)
  const upcoming = data.bills.filter((b) => !b.overdue)

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      {/* Month switcher */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <button onClick={() => setMonth(shiftMonth(data.month, -1))} style={navBtn} aria-label="Previous month">‹</button>
        <div style={{ flex: 1, textAlign: 'center', fontSize: 15, fontWeight: 800 }}>
          {monthLabel(data.month)}
        </div>
        <button onClick={() => setMonth(shiftMonth(data.month, 1))} style={navBtn} aria-label="Next month">›</button>
      </div>

      {/* Balances */}
      <section style={card()}>
        <div style={labelCap()}>Balance</div>
        <div style={{ fontSize: 32, fontWeight: 900, marginTop: 6, color: total < 0 ? T.red : T.text }}>
          {fmt(total, cur)}
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8, marginTop: 14 }}>
          {BANKS.map((b) => {
            const v = data.balances[b] || 0
            return (
              <div key={b} style={{ textAlign: 'center' }}>
                <div style={labelCap({ fontSize: 9 })}>{BANK_LABEL[b]}</div>
                <div style={{ fontSize: 15, fontWeight: 800, marginTop: 3, color: v < 0 ? T.red : T.text }}>
                  {fmt(v, cur)}
                </div>
              </div>
            )
          })}
        </div>
      </section>

      {/* Month totals */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 10 }}>
        <Stat label="In" value={fmt(data.totals.income, cur)} color={T.green} />
        <Stat label="Out" value={fmt(data.totals.expenses, cur)} color={T.red} />
        <Stat label="Net" value={fmt(data.totals.net, cur)} color={data.totals.net < 0 ? T.red : T.green} />
      </div>

      {overdue.length > 0 && (
        <BillList title="Past due" bills={overdue} currency={cur} accent={T.red} />
      )}
      {upcoming.length > 0 && (
        <BillList title="Coming up" bills={upcoming} currency={cur} accent={T.orange} />
      )}

      <AddRow today={data.today} />

      <Register rows={data.rows} currency={cur} />

      {data.categories.length > 0 && (
        <section style={card()}>
          <div style={labelCap()}>Categories</div>
          <div style={{ marginTop: 8 }}>
            {data.categories.map((c) => {
              const pct = c.amount > 0 ? Math.min(100, (c.spent / c.amount) * 100) : 0
              const over = c.amount > 0 && c.spent > c.amount
              return (
                <div key={c.id} style={{ padding: '10px 0', borderTop: `1px solid ${T.border}` }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, fontSize: 14 }}>
                    <span style={{ fontWeight: 600 }}>{c.name}</span>
                    <span style={{ fontWeight: 800, color: over ? T.red : T.text }}>
                      {fmt(c.spent, cur)}{c.amount > 0 && <span style={{ color: T.muted, fontWeight: 400 }}> / {fmt(c.amount, cur)}</span>}
                    </span>
                  </div>
                  {c.amount > 0 && (
                    <div style={{ height: 5, borderRadius: 3, background: 'rgba(255,255,255,0.08)', marginTop: 7, overflow: 'hidden' }}>
                      <div style={{ width: `${pct}%`, height: '100%', background: over ? T.red : (c.color || T.cyan) }} />
                    </div>
                  )}
                </div>
              )
            })}
            {data.unsortedSpend > 0 && (
              <div style={{ paddingTop: 10, borderTop: `1px solid ${T.border}`, fontSize: 13, color: T.muted }}>
                Uncategorised: {fmt(data.unsortedSpend, cur)}
              </div>
            )}
          </div>
        </section>
      )}
    </div>
  )
}

// ── Bills ────────────────────────────────────────────────────────────────────

function BillList({ title, bills, currency, accent }: {
  title: string; bills: BudgetBill[]; currency: string; accent: string
}) {
  const mark = useMarkBillPaid()
  const [busy, setBusy] = useState<string | null>(null)

  return (
    <section style={{ ...card(), borderColor: `${accent}55` }}>
      <div style={labelCap({ color: accent })}>{title}</div>
      <div style={{ marginTop: 6 }}>
        {bills.map((b) => (
          <div key={b.tag} style={{
            display: 'flex', alignItems: 'center', gap: 10,
            padding: '11px 0', borderTop: `1px solid ${T.border}`,
          }}>
            <div style={{ width: 42, flexShrink: 0, fontSize: 12, fontWeight: 800, color: accent }}>
              {shortDate(b.date)}
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 14, fontWeight: 600, wordBreak: 'break-word' }}>{b.label}</div>
              <div style={{ fontSize: 11, color: T.muted, marginTop: 1 }}>{BANK_LABEL[b.bank]}</div>
            </div>
            <div style={{ fontSize: 14, fontWeight: 800, color: b.amount < 0 ? T.text : T.green }}>
              {fmt(b.amount, currency)}
            </div>
            <button
              onClick={() => { setBusy(b.tag); mark.mutate(b, { onSettled: () => setBusy(null) }) }}
              disabled={busy === b.tag}
              style={{
                flexShrink: 0, appearance: 'none', minHeight: 38, padding: '8px 12px', borderRadius: 9,
                border: `1px solid ${T.hairline}`, background: 'transparent', color: T.text,
                fontSize: 13, fontWeight: 700, cursor: 'pointer', opacity: busy === b.tag ? 0.5 : 1,
              }}
            >
              {busy === b.tag ? '…' : 'Paid'}
            </button>
          </div>
        ))}
      </div>
    </section>
  )
}

// ── Add a row ────────────────────────────────────────────────────────────────

function AddRow({ today }: { today: string }) {
  const addRow = useAddBudgetRow()
  const [open, setOpen] = useState(false)
  const [date, setDate] = useState(today)
  const [label, setLabel] = useState('')
  const [amount, setAmount] = useState('')
  const [bank, setBank] = useState<Bank>('secu')
  const [kind, setKind] = useState<'pay' | 'income'>('pay')
  const [error, setError] = useState<string | null>(null)

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    if (addRow.isPending) return
    setError(null)
    try {
      // The amount is always sent positive; `kind` decides the sign server-side,
      // so a stray minus can't turn a payment into a deposit.
      await addRow.mutateAsync({ date, label, bank, amount: Math.abs(Number(amount)), kind })
      setLabel(''); setAmount(''); setOpen(false)
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not add that.')
    }
  }

  if (!open) {
    return (
      <button onClick={() => setOpen(true)} style={{ ...button('primary'), width: '100%' }}>
        + Add entry
      </button>
    )
  }

  return (
    <form onSubmit={submit} style={card({ padding: 14 })}>
      <div style={labelCap({ marginBottom: 10 })}>New entry</div>

      <input style={{ ...input(), marginBottom: 10 }} placeholder="What was it?"
             value={label} onChange={(e) => setLabel(e.target.value)} autoFocus />

      <div style={{ display: 'flex', gap: 8, marginBottom: 10 }}>
        <input style={{ ...input(), flex: 1 }} type="number" step="0.01" inputMode="decimal"
               placeholder="0.00" value={amount} onChange={(e) => setAmount(e.target.value)} />
        <input style={{ ...input(), flex: 1 }} type="date"
               value={date} onChange={(e) => setDate(e.target.value)} />
      </div>

      <div style={{ display: 'flex', gap: 6, marginBottom: 10 }}>
        {(['pay', 'income'] as const).map((k) => (
          <button key={k} type="button" onClick={() => setKind(k)} style={seg(kind === k)}>
            {k === 'pay' ? '− Pay' : '+ Income'}
          </button>
        ))}
      </div>

      <div style={{ display: 'flex', gap: 6, marginBottom: 12 }}>
        {BANKS.map((b) => (
          <button key={b} type="button" onClick={() => setBank(b)} style={seg(bank === b)}>
            {BANK_LABEL[b]}
          </button>
        ))}
      </div>

      {error && <div style={{ color: T.red, fontSize: 13, fontWeight: 600, marginBottom: 10 }}>{error}</div>}

      <div style={{ display: 'flex', gap: 8 }}>
        <button type="button" onClick={() => { setOpen(false); setError(null) }}
                style={{ ...button('ghost'), flex: 1 }}>Cancel</button>
        <button type="submit" disabled={addRow.isPending}
                style={{ ...button('primary'), flex: 1, opacity: addRow.isPending ? 0.6 : 1 }}>
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

  if (!list.length) {
    return (
      <section style={card()}>
        <div style={labelCap()}>Register</div>
        <div style={{ fontSize: 14, color: T.muted, marginTop: 10 }}>Nothing this month yet.</div>
      </section>
    )
  }

  return (
    <section style={card()}>
      <div style={labelCap()}>Register</div>
      <div style={{ marginTop: 6 }}>
        {list.map((r) => (
          <div key={r.id} style={{ borderTop: `1px solid ${T.border}` }}>
            <div
              onClick={() => setOpenId(openId === r.id ? null : r.id)}
              style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '11px 0', cursor: 'pointer' }}
            >
              <div style={{ width: 42, flexShrink: 0, fontSize: 12, fontWeight: 800, color: T.muted }}>
                {shortDate(r.entry_date)}
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 14, fontWeight: 600, wordBreak: 'break-word', opacity: r.recurring ? 0.65 : 1 }}>
                  {r.label}
                  {r.recurring && (
                    <span style={{ fontSize: 9, fontWeight: 800, letterSpacing: '0.1em', color: T.orange, marginLeft: 7 }}>
                      DUE
                    </span>
                  )}
                </div>
                <div style={{ fontSize: 11, color: T.muted, marginTop: 1 }}>{BANK_LABEL[r.bank]}</div>
              </div>
              <div style={{ textAlign: 'right', flexShrink: 0 }}>
                <div style={{ fontSize: 14, fontWeight: 800, color: r.amount < 0 ? T.text : T.green }}>
                  {r.amount > 0 ? '+' : ''}{fmt(r.amount, currency)}
                </div>
                <div style={{ fontSize: 11, color: r.balance < 0 ? T.red : T.muted, marginTop: 1 }}>
                  {fmt(r.balance, currency)}
                </div>
              </div>
            </div>

            {openId === r.id && (
              <div style={{ padding: '0 0 12px 52px' }}>
                {r.recurring ? (
                  // A projection has no database row to edit or delete. Saying
                  // so beats a Delete button that would 400.
                  <div style={{ fontSize: 12, color: T.muted, lineHeight: 1.45 }}>
                    Scheduled bill — not entered yet. Mark it paid above to record it.
                  </div>
                ) : (
                  <button
                    onClick={() => { del.mutate(r.id); setOpenId(null) }}
                    style={{
                      appearance: 'none', minHeight: 38, padding: '8px 13px', borderRadius: 9,
                      border: '1px solid rgba(239,68,68,0.35)', background: 'transparent',
                      color: T.red, fontSize: 13, fontWeight: 700, cursor: 'pointer',
                    }}
                  >
                    Delete
                  </button>
                )}
              </div>
            )}
          </div>
        ))}
      </div>
    </section>
  )
}

// ── Bits ─────────────────────────────────────────────────────────────────────

function Stat({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <div style={card({ padding: '12px 8px', textAlign: 'center' })}>
      <div style={{ fontSize: 15, fontWeight: 900, color: color ?? T.text, lineHeight: 1.15 }}>{value}</div>
      <div style={labelCap({ marginTop: 4, fontSize: 9 })}>{label}</div>
    </div>
  )
}

const seg = (active: boolean): React.CSSProperties => ({
  flex: 1, appearance: 'none', minHeight: 42, borderRadius: 10,
  border: `1px solid ${active ? 'rgba(33,158,188,0.5)' : T.hairline}`,
  background: active ? 'rgba(33,158,188,0.18)' : 'transparent',
  color: active ? T.text : T.muted, fontSize: 13, fontWeight: 800, cursor: 'pointer',
})

const navBtn: React.CSSProperties = {
  appearance: 'none', width: 44, height: 44, borderRadius: 12,
  border: `1px solid ${T.hairline}`, background: 'transparent',
  color: T.text, fontSize: 20, fontWeight: 800, cursor: 'pointer', lineHeight: 1,
}
