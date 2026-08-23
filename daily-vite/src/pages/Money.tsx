import { useState, type CSSProperties, type FormEvent, type ReactNode } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  ApiError, money,
  type AccountKind, type BudgetBill, type BudgetCategory, type BudgetMonth,
  type BudgetRow, type MonthAccount, type RecurringRule,
} from '../api'
import { T, label, body, section, tile, row, input, button, segment, hero } from '../theme'
import Collapsible from '../components/Collapsible'

/**
 * Money — one register, one month at a time, on a phone.
 *
 * The private version of this app was wired to three named banks because it had
 * exactly one household in it. This one has customers, so an account is whatever
 * the person says it is: they name it, they pick what kind it is, and every
 * figure on this page is keyed off those. The consequence is that the FIRST
 * screen most people ever see here has no numbers on it at all — see
 * <FirstAccount>. That screen matters more than the rest of the page: a register
 * of zeroes with no accounts behind it looks broken, and someone who thinks the
 * money page is broken never comes back to it.
 *
 * Every number above the register — opening, cash on hand, projected ending, the
 * totals — is computed SERVER-SIDE and rendered as given. Nothing here adds two
 * server numbers together to make a third. That rule is why the phone and the
 * web app can never quietly disagree about what is left this month.
 *
 * Recurring bills are projections, not rows. They exist as rules until someone
 * marks one paid, which materialises a real row. That is why a projected line
 * offers "Paid" and nothing else, and why the UI says so out loud rather than
 * offering an Edit button that would 400.
 */

// ── Formatting ───────────────────────────────────────────────────────────────

/** The ONLY money formatter on this page. Currency comes from the payload, not
 *  from a constant, because the server decides what this household counts in. */
const fmt = (n: number, currency: string) =>
  new Intl.NumberFormat('en-US', { style: 'currency', currency, maximumFractionDigits: 2 }).format(n || 0)

/** "8/14" from "2026-08-14" — sliced, never parsed, so no timezone can shift it. */
const shortDate = (iso: string) => { const [, m, d] = iso.split('-'); return `${Number(m)}/${Number(d)}` }

/** "12th". Teens are the exception every naive version of this gets wrong. */
const ordinal = (n: number) => {
  const v = n % 100
  if (v >= 11 && v <= 13) return `${n}th`
  if (n % 10 === 1) return `${n}st`
  if (n % 10 === 2) return `${n}nd`
  if (n % 10 === 3) return `${n}rd`
  return `${n}th`
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

const KINDS: AccountKind[] = ['checking', 'savings', 'credit', 'cash']
const KIND_LABEL: Record<AccountKind, string> = {
  checking: 'Checking', savings: 'Savings', credit: 'Credit', cash: 'Cash',
}

/**
 * A signed amount.
 *
 * Colour AND a sign, always both. On a 390px screen at arm's length a leading
 * minus is one pixel column wide and disappears entirely against a serif digit,
 * so an expense that reads as income is a genuinely easy mistake to make — which
 * is the one mistake a money screen must never invite.
 */
function Amount({ n, currency, size = 14 }: { n: number; currency: string; size?: number }) {
  const negative = n < 0
  return (
    <span style={{ ...body(size), color: negative ? T.bad : T.good, whiteSpace: 'nowrap' }}>
      {negative ? '−' : '+'}{fmt(Math.abs(n), currency)}
    </span>
  )
}

/** A balance is not an amount: it isn't income or spending, it's a position.
 *  Only going below zero is worth colouring. */
function Balance({ n, currency, size = 14 }: { n: number; currency: string; size?: number }) {
  return (
    <span style={{ ...body(size), color: n < 0 ? T.bad : T.ink, whiteSpace: 'nowrap' }}>
      {fmt(n, currency)}
    </span>
  )
}

// ── Queries ──────────────────────────────────────────────────────────────────

/**
 * Every money query lives under the 'budget' prefix so ONE invalidation covers
 * the month, the rules, the accounts and the categories. They are not
 * independent: renaming an account changes what the month view prints, and
 * adding a rule changes which projections appear in the register. Keying them
 * apart would mean remembering, at each of a dozen call sites, which other lists
 * this particular write also invalidated — and the one that got forgotten would
 * show a stale name until someone reloaded the page.
 */
const MONTH_KEY = (m?: string) => ['budget', m ?? 'current'] as const
const RULES_KEY = ['budget', 'rules'] as const
const ACCOUNTS_KEY = ['budget', 'accounts'] as const

/**
 * A mutation that always leaves the screen truthful.
 *
 * Marking an August bill paid changes September's opening balance and the money
 * tile on Today, so this deliberately invalidates the whole prefix and Today
 * rather than the one month in view. It is a handful of cheap refetches against
 * a page that is nothing but server-computed figures.
 */
function useMoneyAction<TArgs>(fn: (a: TArgs) => Promise<unknown>) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: fn,
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['budget'] })
      void qc.invalidateQueries({ queryKey: ['today'] })
    },
  })
}

const errText = (e: unknown, fallback: string) => (e instanceof ApiError ? e.message : fallback)

// ── Page ─────────────────────────────────────────────────────────────────────

export default function Money() {
  // undefined = "whatever month the server thinks it is in the account's
  // timezone". Never seeded from the browser clock: a phone in another zone
  // would open the wrong month on the 1st and the 31st.
  const [month, setMonth] = useState<string | undefined>(undefined)
  const { data, isLoading, error, refetch } = useQuery({
    queryKey: MONTH_KEY(month),
    queryFn: () => money.month(month),
  })

  if (isLoading) return <div style={{ ...body(14), color: T.muted }}>Loading…</div>
  if (error) {
    return (
      <div>
        <div style={{ ...body(15), color: T.bad }}>{errText(error, 'Something went wrong.')}</div>
        <button onClick={() => void refetch()} style={{ ...button('ghost'), marginTop: 14 }}>Try again</button>
      </div>
    )
  }
  if (!data) return null

  // The whole page, replaced. Not a banner above an empty register — there is
  // genuinely nothing else to show yet, and one instruction with one field is
  // the fastest possible route out of this state.
  if (data.needsAccount) return <FirstAccount />

  return <MonthView data={data} onMonth={setMonth} />
}

// ── The empty state ──────────────────────────────────────────────────────────

function FirstAccount() {
  const create = useMoneyAction((a: { name: string; kind: AccountKind }) => money.createAccount(a))
  const [name, setName] = useState('')
  const [kind, setKind] = useState<AccountKind>('checking')
  const [err, setErr] = useState<string | null>(null)

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    const n = name.trim()
    if (!n || create.isPending) return
    setErr(null)
    try { await create.mutateAsync({ name: n, kind }) }
    catch (e2) { setErr(errText(e2, 'Could not create that account.')) }
  }

  // The page title comes from the shell, so this screen is nothing but the one
  // thing there is to do here.
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <form onSubmit={submit} style={section()}>
        <div style={label()}>Start here</div>
        <div style={{ ...body(15), marginTop: 10, lineHeight: 1.5 }}>
          Name the account you actually spend out of — whatever you call it in your head.
          Everything else on this page hangs off it: balances, bills, the month's register.
        </div>

        <input
          style={{ ...input(), marginTop: 14 }}
          placeholder="Everyday checking"
          value={name}
          onChange={(e) => setName(e.target.value)}
          autoFocus
        />

        <div style={label({ marginTop: 14 })}>What kind</div>
        <div style={{ display: 'flex', gap: 6, marginTop: 8, flexWrap: 'wrap' }}>
          {KINDS.map((k) => (
            <button key={k} type="button" onClick={() => setKind(k)} style={segment(kind === k)}>
              {KIND_LABEL[k]}
            </button>
          ))}
        </div>

        {err && <div style={label({ color: T.bad, marginTop: 12, letterSpacing: '0.06em' })}>{err}</div>}

        <button
          type="submit"
          disabled={!name.trim() || create.isPending}
          style={{ ...button('primary'), width: '100%', marginTop: 16, opacity: name.trim() ? 1 : 0.4 }}
        >
          {create.isPending ? 'Creating…' : 'Create account'}
        </button>

        <div style={{ ...body(13), color: T.muted, marginTop: 12, lineHeight: 1.5 }}>
          You can add more later, and rename this one whenever you like.
        </div>
      </form>
    </div>
  )
}

// ── The month ────────────────────────────────────────────────────────────────

function MonthView({ data, onMonth }: { data: BudgetMonth; onMonth: (m: string) => void }) {
  const cur = data.currency
  const overdue = data.bills.filter((b) => b.overdue)
  const upcoming = data.bills.filter((b) => !b.overdue)
  const open = data.accounts.filter((a) => !a.archived)

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
        <button onClick={() => onMonth(shiftMonth(data.month, -1))} style={nav} aria-label="Previous month">‹</button>
        <span style={label()}>{monthLabel(data.month)}</span>
        <button onClick={() => onMonth(shiftMonth(data.month, 1))} style={nav} aria-label="Next month">›</button>
      </div>

      <InBank data={data} />
      <AccountStrip accounts={open} currency={cur} />
      <Totals data={data} />

      {overdue.length > 0 && (
        <Bills title="Past due" bills={overdue} currency={cur} accent defaultOpen />
      )}
      <Bills title="Coming up" bills={upcoming} currency={cur} />

      <AddRow today={data.today} accounts={open} categories={data.categories} />
      <Register data={data} />

      <LogBalances accounts={open} today={data.today} currency={cur} />
      <Rules accounts={open} currency={cur} today={data.today} />
      <Categories categories={data.categories} unsorted={data.unsortedSpend} currency={cur} />
      <Accounts />
    </div>
  )
}

/**
 * Cash on hand, and the date it was last true.
 *
 * `bankAsOf` is not garnish. Every projection below this card is built on the
 * last balance somebody typed in, so "as of the 3rd" on the 27th is the single
 * most important caveat on the page — and a household that has never logged one
 * needs telling that outright, not left to infer it from a confident-looking
 * number that is really just the sum of what they happened to enter.
 */
function InBank({ data }: { data: BudgetMonth }) {
  const cur = data.currency
  const day = data.bankAsOf ? Number(data.bankAsOf.split('-')[2]) : null

  return (
    <div style={section()}>
      <div style={label()}>In the bank</div>
      <div style={{ ...hero(44), marginTop: 8, color: data.inBank < 0 ? T.bad : T.ink }}>
        {fmt(data.inBank, cur)}
      </div>
      {day !== null ? (
        <div style={{ ...body(13), color: T.muted, marginTop: 8, lineHeight: 1.45 }}>
          As of the {ordinal(day)}. Anything you've spent since then isn't in that figure yet.
        </div>
      ) : (
        <div style={{ ...body(13), color: T.warn, marginTop: 8, lineHeight: 1.45 }}>
          No balance logged yet — this is only the entries below added up, not what your
          bank actually says. Log today's balance further down and every projection on this
          page starts from something real.
        </div>
      )}
    </div>
  )
}

/**
 * One tile per account: what's there now, where the month lands.
 *
 * Scrolls sideways INSIDE the strip rather than wrapping. Someone with five
 * accounts would otherwise get a grid three rows deep between them and the
 * register, and the register is what they came for.
 */
function AccountStrip({ accounts, currency }: { accounts: MonthAccount[]; currency: string }) {
  if (!accounts.length) return null
  return (
    <div style={{ display: 'flex', gap: 8, overflowX: 'auto', paddingBottom: 4, WebkitOverflowScrolling: 'touch' }}>
      {accounts.map((a) => (
        <div key={a.id} style={tile({ minWidth: 138, flexShrink: 0 })}>
          <div style={{ ...body(14), whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
            {a.name}
          </div>
          <div style={label({ marginTop: 2, letterSpacing: '0.1em', color: T.faint })}>{KIND_LABEL[a.kind]}</div>
          <div style={{ marginTop: 10 }}>
            <div style={label({ letterSpacing: '0.08em', color: T.faint })}>Now</div>
            <Balance n={a.bankNow} currency={currency} size={17} />
          </div>
          <div style={{ marginTop: 8 }}>
            <div style={label({ letterSpacing: '0.08em', color: T.faint })}>Month end</div>
            <Balance n={a.ending} currency={currency} size={14} />
          </div>
        </div>
      ))}
    </div>
  )
}

function Totals({ data }: { data: BudgetMonth }) {
  const cur = data.currency
  const t = data.totals
  return (
    <div style={section()}>
      <div style={label()}>{monthLabel(data.month)} so far</div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8, marginTop: 12 }}>
        <Stat name="In">
          <Amount n={t.income} currency={cur} size={16} />
        </Stat>
        <Stat name="Out">
          {/* `expenses` arrives positive; showing it as a negative amount keeps
              the colour rule intact — out is red whichever way the sign came. */}
          <Amount n={-Math.abs(t.expenses)} currency={cur} size={16} />
        </Stat>
        <Stat name="Net">
          <Amount n={t.net} currency={cur} size={16} />
        </Stat>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8, marginTop: 8 }}>
        <Stat name="Bills left">
          <Balance n={t.billsLeft} currency={cur} size={15} />
        </Stat>
        <Stat name="Pay coming">
          <Balance n={t.payComing} currency={cur} size={15} />
        </Stat>
        <Stat name="Month end">
          <Balance n={t.endingBalance} currency={cur} size={15} />
        </Stat>
      </div>
      <div style={{ ...body(13), color: T.muted, marginTop: 10, lineHeight: 1.45 }}>
        Month end is what's left once every bill still due has gone out and every payment
        still coming has landed.
      </div>
    </div>
  )
}

function Stat({ name, children }: { name: string; children: ReactNode }) {
  return (
    <div style={tile()}>
      <div style={label({ letterSpacing: '0.08em', color: T.faint })}>{name}</div>
      <div style={{ marginTop: 5 }}>{children}</div>
    </div>
  )
}

// ── Bills ────────────────────────────────────────────────────────────────────

function Bills({ title, bills, currency, accent, defaultOpen }: {
  title: string; bills: BudgetBill[]; currency: string; accent?: boolean; defaultOpen?: boolean
}) {
  const mark = useMoneyAction((b: BudgetBill) => money.markPaid(b))
  const [busy, setBusy] = useState<string | null>(null)
  const total = bills.reduce((n, b) => n + Math.abs(b.amount), 0)

  return (
    // Past due opens itself. A collapsed header carries the count and the total,
    // which is enough for "coming up" — but a late bill is a thing you have to
    // act on, and one extra tap between someone and the Paid button is one extra
    // chance to close the app having done nothing.
    <Collapsible
      variant="section"
      title={title}
      right={`${bills.length} · ${fmt(total, currency)}`}
      accent={accent ? T.warn : undefined}
      defaultOpen={defaultOpen}
    >
      {!bills.length && (
        <div style={{ ...body(14), color: T.muted, marginTop: 10 }}>Nothing else due this month.</div>
      )}
      <div>
        {bills.map((b) => (
          <div key={b.tag} style={row()}>
            <span style={label({ width: 34, flexShrink: 0, color: accent ? T.warn : T.muted })}>
              {shortDate(b.date)}
            </span>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ ...body(14), wordBreak: 'break-word' }}>{b.label}</div>
              <div style={label({ marginTop: 2, letterSpacing: '0.1em', color: T.faint })}>
                {b.accountName ?? 'Unassigned'}
                {b.overdue ? ' · late' : ''}
              </div>
            </div>
            <Amount n={b.kind === 'income' ? Math.abs(b.amount) : -Math.abs(b.amount)} currency={currency} />
            <button
              onClick={() => { setBusy(b.tag); mark.mutate(b, { onSettled: () => setBusy(null) }) }}
              disabled={busy === b.tag}
              style={{ ...segment(false), flexShrink: 0, minHeight: 44, opacity: busy === b.tag ? 0.5 : 1 }}
            >
              {busy === b.tag ? '…' : 'Paid'}
            </button>
          </div>
        ))}
      </div>
    </Collapsible>
  )
}

// ── Add ──────────────────────────────────────────────────────────────────────

function AddRow({ today, accounts, categories }: {
  today: string; accounts: MonthAccount[]; categories: BudgetCategory[]
}) {
  const add = useMoneyAction((r: Parameters<typeof money.addRow>[0]) => money.addRow(r))
  const [open, setOpen] = useState(false)
  const [date, setDate] = useState(today)
  const [text, setText] = useState('')
  const [amount, setAmount] = useState('')
  const [accountId, setAccountId] = useState<number>(accounts[0]?.id ?? 0)
  const [kind, setKind] = useState<'income' | 'expense'>('expense')
  const [categoryId, setCategoryId] = useState<number | null>(null)
  const [err, setErr] = useState<string | null>(null)

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        style={{ ...label({ color: T.accent }), background: 'none', border: 'none',
                 padding: '12px 0', cursor: 'pointer', minHeight: 44, textAlign: 'left' }}
      >
        + Add entry
      </button>
    )
  }

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    if (add.isPending) return
    setErr(null)
    try {
      // Always sent positive; `kind` decides the sign server-side, so a stray
      // minus typed into the amount can't turn a payment into a deposit.
      await add.mutateAsync({
        accountId, date, label: text.trim(), amount: Math.abs(Number(amount)), kind, categoryId,
      })
      setText(''); setAmount(''); setOpen(false)
    } catch (e2) {
      setErr(errText(e2, 'Could not add that.'))
    }
  }

  return (
    <form onSubmit={submit} style={section()}>
      <div style={label()}>New entry</div>
      <input style={{ ...input(), marginTop: 10 }} placeholder="What was it?"
             value={text} onChange={(e) => setText(e.target.value)} autoFocus />
      <div style={{ display: 'flex', gap: 8, marginTop: 9 }}>
        <input style={{ ...input(), flex: 1, minWidth: 0 }} type="number" step="0.01" inputMode="decimal"
               placeholder="0.00" value={amount} onChange={(e) => setAmount(e.target.value)} />
        <input style={{ ...input(), flex: 1, minWidth: 0 }} type="date" value={date}
               onChange={(e) => setDate(e.target.value)} />
      </div>

      <div style={{ display: 'flex', gap: 6, marginTop: 9, flexWrap: 'wrap' }}>
        <button type="button" onClick={() => setKind('expense')} style={segment(kind === 'expense')}>− Out</button>
        <button type="button" onClick={() => setKind('income')} style={segment(kind === 'income')}>+ In</button>
      </div>

      <div style={label({ marginTop: 12 })}>Account</div>
      <select
        value={accountId}
        onChange={(e) => setAccountId(Number(e.target.value))}
        style={{ ...input(), marginTop: 6 }}
      >
        {accounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
      </select>

      {categories.length > 0 && (
        <>
          <div style={label({ marginTop: 12 })}>Category (optional)</div>
          <select
            value={categoryId ?? ''}
            onChange={(e) => setCategoryId(e.target.value === '' ? null : Number(e.target.value))}
            style={{ ...input(), marginTop: 6 }}
          >
            <option value="">No category</option>
            {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </>
      )}

      {err && <div style={label({ color: T.bad, marginTop: 9, letterSpacing: '0.06em' })}>{err}</div>}

      <div style={{ display: 'flex', gap: 8, marginTop: 14 }}>
        <button type="button" onClick={() => { setOpen(false); setErr(null) }}
                style={{ ...button('ghost'), flex: 1 }}>Cancel</button>
        <button type="submit" disabled={add.isPending || !text.trim() || !accountId}
                style={{ ...button('primary'), flex: 1, opacity: add.isPending ? 0.5 : 1 }}>
          {add.isPending ? 'Saving…' : 'Add'}
        </button>
      </div>
    </form>
  )
}

// ── Register ─────────────────────────────────────────────────────────────────

function Register({ data }: { data: BudgetMonth }) {
  const cur = data.currency
  // Newest first — on a phone you are checking what just happened, not reading
  // the month from the top.
  const list = data.rows.slice().reverse()
  const [openId, setOpenId] = useState<number | null>(null)
  const inAmt = data.rows.reduce((n, r) => n + (r.amount > 0 ? r.amount : 0), 0)
  const outAmt = data.rows.reduce((n, r) => n + (r.amount < 0 ? -r.amount : 0), 0)

  return (
    <Collapsible
      variant="section"
      title="Register"
      right={`${list.length} · +${fmt(inAmt, cur)} / −${fmt(outAmt, cur)}`}
    >
      {!list.length && (
        <div style={{ ...body(14), color: T.muted, marginTop: 10 }}>
          Nothing this month yet. Add an entry above, or set up a recurring bill and it
          will appear here as a projection.
        </div>
      )}
      <div>
        {list.map((r) => (
          <RegisterRow
            key={r.id}
            r={r}
            currency={cur}
            accounts={data.accounts}
            categories={data.categories}
            open={openId === r.id}
            onToggle={() => setOpenId(openId === r.id ? null : r.id)}
          />
        ))}
      </div>
    </Collapsible>
  )
}

function RegisterRow({ r, currency, accounts, categories, open, onToggle }: {
  r: BudgetRow
  currency: string
  accounts: MonthAccount[]
  categories: BudgetCategory[]
  open: boolean
  onToggle: () => void
}) {
  const del = useMoneyAction((id: number) => money.deleteRow(id))
  const setCat = useMoneyAction((a: { id: number; categoryId: number | null }) =>
    money.setRowCategory(a.id, a.categoryId))
  const [editing, setEditing] = useState(false)

  // A negative id and `recurring` both mean the same thing: this line is a
  // projection off a rule, with no database row behind it. Either alone would be
  // enough; checking both means a server that changes one convention can't
  // silently start offering Delete on something that cannot be deleted.
  const projected = r.recurring && r.id < 0

  return (
    <div>
      <div
        onClick={onToggle}
        style={row({
          cursor: 'pointer',
          // Projections are drawn back, not greyed into illegibility: they are
          // real money that is really going to leave, just not yet.
          opacity: projected ? 0.72 : 1,
        })}
      >
        <span style={label({ width: 34, flexShrink: 0 })}>{shortDate(r.date)}</span>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ ...body(14), wordBreak: 'break-word' }}>
            {r.label}
            {projected && (
              <span style={label({ marginLeft: 7, color: T.warn, letterSpacing: '0.1em' })}>scheduled</span>
            )}
          </div>
          <div style={label({ marginTop: 2, letterSpacing: '0.1em', color: T.faint })}>
            {r.accountName ?? 'Unassigned'}
          </div>
        </div>
        <div style={{ textAlign: 'right', flexShrink: 0 }}>
          <Amount n={r.amount} currency={currency} />
          <div style={{ marginTop: 2 }}>
            <span style={label({ color: r.balance < 0 ? T.bad : T.faint, letterSpacing: '0.06em' })}>
              {fmt(r.balance, currency)}
            </span>
          </div>
        </div>
      </div>

      {open && (
        <div style={{ padding: '0 0 14px 42px' }}>
          {projected ? (
            // Say it in the UI, not in a comment: someone tapping a scheduled
            // line is looking for Edit or Delete, and an explanation costs less
            // confusion than two buttons that would fail.
            <div style={{ ...body(13), color: T.muted, lineHeight: 1.5 }}>
              This one hasn't happened yet — it's projected from a recurring rule, so there is
              no entry here to edit or delete. Tick it off with Paid under "Coming up" above and
              it becomes a real entry; to change the amount or the date for good, edit the rule
              under Recurring below.
            </div>
          ) : editing ? (
            <EditRow r={r} accounts={accounts} onDone={() => setEditing(false)} />
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {categories.length > 0 && (
                <div>
                  <div style={label({ letterSpacing: '0.08em', color: T.faint })}>Category</div>
                  <select
                    value={r.categoryId ?? ''}
                    onChange={(e) => setCat.mutate({
                      id: r.id,
                      categoryId: e.target.value === '' ? null : Number(e.target.value),
                    })}
                    disabled={setCat.isPending}
                    style={{ ...input(), marginTop: 6 }}
                  >
                    <option value="">No category</option>
                    {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                  </select>
                </div>
              )}
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                <button onClick={() => setEditing(true)} style={{ ...segment(false), minHeight: 44 }}>Edit</button>
                <button
                  onClick={() => del.mutate(r.id)}
                  disabled={del.isPending}
                  style={{ ...segment(false), minHeight: 44, color: T.bad, borderColor: 'rgba(239,68,68,0.35)' }}
                >
                  {del.isPending ? 'Deleting…' : 'Delete'}
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

function EditRow({ r, accounts, onDone }: { r: BudgetRow; accounts: MonthAccount[]; onDone: () => void }) {
  const update = useMoneyAction((a: { id: number; patch: Parameters<typeof money.updateRow>[1] }) =>
    money.updateRow(a.id, a.patch))
  const [date, setDate] = useState(r.date)
  const [text, setText] = useState(r.label)
  const [amount, setAmount] = useState(String(Math.abs(r.amount)))
  const [accountId, setAccountId] = useState(r.accountId)
  const [err, setErr] = useState<string | null>(null)

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    if (update.isPending) return
    setErr(null)
    try {
      // The row already knows whether it is income or expense; re-applying the
      // stored sign to a positive input keeps an edit from flipping a payment
      // into a deposit by accident.
      const signed = (r.amount < 0 ? -1 : 1) * Math.abs(Number(amount))
      await update.mutateAsync({ id: r.id, patch: { date, label: text.trim(), accountId, amount: signed } })
      onDone()
    } catch (e2) {
      setErr(errText(e2, 'Could not save that.'))
    }
  }

  return (
    <form onSubmit={submit}>
      <input style={input()} value={text} onChange={(e) => setText(e.target.value)} placeholder="What was it?" />
      <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
        <input style={{ ...input(), flex: 1, minWidth: 0 }} type="number" step="0.01" inputMode="decimal"
               value={amount} onChange={(e) => setAmount(e.target.value)} />
        <input style={{ ...input(), flex: 1, minWidth: 0 }} type="date" value={date}
               onChange={(e) => setDate(e.target.value)} />
      </div>
      <select value={accountId} onChange={(e) => setAccountId(Number(e.target.value))}
              style={{ ...input(), marginTop: 8 }}>
        {accounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
      </select>
      {err && <div style={label({ color: T.bad, marginTop: 8, letterSpacing: '0.06em' })}>{err}</div>}
      <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
        <button type="button" onClick={onDone} style={{ ...button('ghost'), flex: 1 }}>Cancel</button>
        <button type="submit" disabled={update.isPending} style={{ ...button('primary'), flex: 1 }}>
          {update.isPending ? 'Saving…' : 'Save'}
        </button>
      </div>
    </form>
  )
}

// ── Balances ─────────────────────────────────────────────────────────────────

/**
 * Type in what the bank app says, per account.
 *
 * This is the only place a real-world number enters the system. Everything above
 * is arithmetic on top of it, which is why the date is editable: entering
 * Friday's balance on Sunday and stamping it Sunday would quietly overstate the
 * weekend.
 */
function LogBalances({ accounts, today, currency }: {
  accounts: MonthAccount[]; today: string; currency: string
}) {
  return (
    <Collapsible variant="section" title="Log a balance" right={`${accounts.length} accounts`}>
      <div style={{ ...body(13), color: T.muted, marginTop: 8, lineHeight: 1.5 }}>
        Open your banking app and copy the number across. Everything on this page is only as
        current as the last balance you logged.
      </div>
      {accounts.map((a) => (
        <BalanceRow key={a.id} account={a} today={today} currency={currency} />
      ))}
    </Collapsible>
  )
}

function BalanceRow({ account, today, currency }: {
  account: MonthAccount; today: string; currency: string
}) {
  const save = useMoneyAction((b: Parameters<typeof money.setBalance>[0]) => money.setBalance(b))
  const [value, setValue] = useState('')
  const [day, setDay] = useState(today)

  const submit = (e: FormEvent) => {
    e.preventDefault()
    if (value === '' || save.isPending) return
    save.mutate({ accountId: account.id, day, balance: Number(value) }, {
      onSuccess: () => setValue(''),
    })
  }

  return (
    <form onSubmit={submit} style={row({ flexWrap: 'wrap' })}>
      <div style={{ flex: 1, minWidth: 120 }}>
        <div style={{ ...body(14) }}>{account.name}</div>
        <div style={label({ marginTop: 2, letterSpacing: '0.08em', color: T.faint })}>
          now {fmt(account.bankNow, currency)}
        </div>
      </div>
      <input style={{ ...input(), width: 110, flex: 'none' }} type="number" step="0.01" inputMode="decimal"
             placeholder="0.00" value={value} onChange={(e) => setValue(e.target.value)} />
      <input style={{ ...input(), width: 148, flex: 'none' }} type="date" value={day}
             onChange={(e) => setDay(e.target.value)} />
      <button type="submit" disabled={value === '' || save.isPending}
              style={{ ...segment(false), minHeight: 44, opacity: value === '' ? 0.4 : 1 }}>
        {save.isPending ? '…' : 'Log'}
      </button>
    </form>
  )
}

// ── Recurring rules ──────────────────────────────────────────────────────────

const FREQS: RecurringRule['frequency'][] = ['weekly', 'biweekly', 'monthly']
const FREQ_LABEL: Record<RecurringRule['frequency'], string> = {
  weekly: 'Weekly', biweekly: 'Every 2 weeks', monthly: 'Monthly',
}

/**
 * The rules behind the projections.
 *
 * A rule is not a row and never becomes one on its own — it draws a scheduled
 * line into every month it touches until somebody marks an occurrence paid.
 * Editing a rule therefore rewrites the future and leaves the past alone, which
 * is exactly what you want when the rent goes up.
 */
function Rules({ accounts, currency, today }: {
  accounts: MonthAccount[]; currency: string; today: string
}) {
  const { data } = useQuery({ queryKey: RULES_KEY, queryFn: money.rules })
  const create = useMoneyAction((r: Parameters<typeof money.createRule>[0]) => money.createRule(r))
  const del = useMoneyAction((id: number) => money.deleteRule(id))
  const [adding, setAdding] = useState(false)

  const rules = data?.rules ?? []

  return (
    <Collapsible variant="section" title="Recurring" right={`${rules.length}`}>
      <div style={{ ...body(13), color: T.muted, marginTop: 8, lineHeight: 1.5 }}>
        Rent, salary, the phone bill. Each one draws a scheduled line into the register every
        time it comes round; nothing is actually recorded until you mark it paid.
      </div>

      {rules.map((r) => (
        <RuleRow key={r.id} rule={r} accounts={accounts} currency={currency}
                 onDelete={() => del.mutate(r.id)} deleting={del.isPending} />
      ))}

      {adding ? (
        <RuleForm
          accounts={accounts}
          today={today}
          busy={create.isPending}
          onCancel={() => setAdding(false)}
          onSave={async (v) => {
            await create.mutateAsync({
              accountId: v.accountId, label: v.label, amount: v.amount, kind: v.kind,
              frequency: v.frequency, anchorDate: v.anchorDate, categoryId: null,
            })
            setAdding(false)
          }}
        />
      ) : (
        <button
          onClick={() => setAdding(true)}
          style={{ ...label({ color: T.accent }), background: 'none', border: 'none',
                   padding: '12px 0', cursor: 'pointer', minHeight: 44, textAlign: 'left' }}
        >
          + New rule
        </button>
      )}
    </Collapsible>
  )
}

function RuleRow({ rule, accounts, currency, onDelete, deleting }: {
  rule: RecurringRule
  accounts: MonthAccount[]
  currency: string
  onDelete: () => void
  deleting: boolean
}) {
  const update = useMoneyAction((a: { id: number; patch: Partial<RecurringRule> }) =>
    money.updateRule(a.id, a.patch))
  const [editing, setEditing] = useState(false)
  const account = accounts.find((a) => a.id === rule.accountId)

  if (editing) {
    return (
      <div style={{ paddingTop: 12, borderTop: `1px solid ${T.rule}` }}>
        <RuleForm
          accounts={accounts}
          today={rule.anchorDate}
          initial={rule}
          busy={update.isPending}
          onCancel={() => setEditing(false)}
          onSave={async (v) => {
            await update.mutateAsync({ id: rule.id, patch: v })
            setEditing(false)
          }}
        />
      </div>
    )
  }

  return (
    <div style={row()}>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ ...body(14), wordBreak: 'break-word' }}>{rule.label}</div>
        <div style={label({ marginTop: 2, letterSpacing: '0.08em', color: T.faint })}>
          {FREQ_LABEL[rule.frequency]} · from {shortDate(rule.anchorDate)} · {account?.name ?? 'Unassigned'}
        </div>
      </div>
      <Amount n={rule.kind === 'income' ? Math.abs(rule.amount) : -Math.abs(rule.amount)} currency={currency} />
      <button onClick={() => setEditing(true)} style={{ ...segment(false), flexShrink: 0, minHeight: 44 }}>
        Edit
      </button>
      <button onClick={onDelete} disabled={deleting} aria-label={`Delete ${rule.label}`}
              style={{ ...segment(false), flexShrink: 0, minHeight: 44, color: T.bad,
                       borderColor: 'rgba(239,68,68,0.35)' }}>
        ×
      </button>
    </div>
  )
}

type RuleDraft = {
  label: string
  amount: number
  accountId: number
  kind: 'income' | 'expense'
  frequency: RecurringRule['frequency']
  anchorDate: string
}

function RuleForm({ accounts, today, initial, busy, onSave, onCancel }: {
  accounts: MonthAccount[]
  today: string
  initial?: RecurringRule
  busy: boolean
  onSave: (v: RuleDraft) => Promise<void>
  onCancel: () => void
}) {
  const [text, setText] = useState(initial?.label ?? '')
  const [amount, setAmount] = useState(initial ? String(Math.abs(initial.amount)) : '')
  const [accountId, setAccountId] = useState(initial?.accountId ?? accounts[0]?.id ?? 0)
  const [kind, setKind] = useState<'income' | 'expense'>(initial?.kind ?? 'expense')
  const [frequency, setFrequency] = useState<RecurringRule['frequency']>(initial?.frequency ?? 'monthly')
  const [anchorDate, setAnchorDate] = useState(initial?.anchorDate ?? today)
  const [err, setErr] = useState<string | null>(null)

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    if (busy || !text.trim()) return
    setErr(null)
    try {
      await onSave({
        label: text.trim(),
        // Positive on the wire; `kind` carries the direction, the same as a
        // one-off entry does.
        amount: Math.abs(Number(amount)),
        accountId, kind, frequency, anchorDate,
      })
    } catch (e2) {
      setErr(errText(e2, 'Could not save that rule.'))
    }
  }

  return (
    <form onSubmit={submit} style={{ paddingBottom: 12 }}>
      <input style={input()} placeholder="Rent" value={text} onChange={(e) => setText(e.target.value)} />
      <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
        <input style={{ ...input(), flex: 1, minWidth: 0 }} type="number" step="0.01" inputMode="decimal"
               placeholder="0.00" value={amount} onChange={(e) => setAmount(e.target.value)} />
        <input style={{ ...input(), flex: 1, minWidth: 0 }} type="date" value={anchorDate}
               onChange={(e) => setAnchorDate(e.target.value)} />
      </div>
      {/* The anchor is the date it lands, not the date you set it up. A monthly
          rule anchored to the 3rd falls on the 3rd forever. */}
      <div style={label({ marginTop: 6, letterSpacing: '0.06em', color: T.faint })}>
        The date it next lands — the schedule counts from there
      </div>

      <div style={{ display: 'flex', gap: 6, marginTop: 10, flexWrap: 'wrap' }}>
        <button type="button" onClick={() => setKind('expense')} style={segment(kind === 'expense')}>− Out</button>
        <button type="button" onClick={() => setKind('income')} style={segment(kind === 'income')}>+ In</button>
      </div>
      <div style={{ display: 'flex', gap: 6, marginTop: 8, flexWrap: 'wrap' }}>
        {FREQS.map((f) => (
          <button key={f} type="button" onClick={() => setFrequency(f)} style={segment(frequency === f)}>
            {FREQ_LABEL[f]}
          </button>
        ))}
      </div>

      <select value={accountId} onChange={(e) => setAccountId(Number(e.target.value))}
              style={{ ...input(), marginTop: 10 }}>
        {accounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
      </select>

      {err && <div style={label({ color: T.bad, marginTop: 8, letterSpacing: '0.06em' })}>{err}</div>}

      <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
        <button type="button" onClick={onCancel} style={{ ...button('ghost'), flex: 1 }}>Cancel</button>
        <button type="submit" disabled={busy || !text.trim() || !accountId}
                style={{ ...button('primary'), flex: 1 }}>
          {busy ? 'Saving…' : 'Save'}
        </button>
      </div>
    </form>
  )
}

// ── Categories ───────────────────────────────────────────────────────────────

function Categories({ categories, unsorted, currency }: {
  categories: BudgetCategory[]; unsorted: number; currency: string
}) {
  const create = useMoneyAction((c: { name: string; kind: 'income' | 'expense' }) => money.createCategory(c))
  const del = useMoneyAction((id: number) => money.deleteCategory(id))
  const [name, setName] = useState('')
  const spent = categories.reduce((n, c) => n + Math.abs(c.spent), 0)

  const submit = (e: FormEvent) => {
    e.preventDefault()
    const n = name.trim()
    if (!n || create.isPending) return
    create.mutate({ name: n, kind: 'expense' }, { onSuccess: () => setName('') })
  }

  return (
    <Collapsible
      variant="section"
      title="Categories"
      right={`${categories.length} · ${fmt(spent, currency)}`}
    >
      {!categories.length && (
        <div style={{ ...body(14), color: T.muted, marginTop: 10, lineHeight: 1.5 }}>
          None yet. Categories are optional — they only exist to answer "where did it go",
          and the register works perfectly well without them.
        </div>
      )}

      {categories.map((c) => (
        <div key={c.id} style={row()}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ ...body(14), wordBreak: 'break-word' }}>{c.name}</div>
            <div style={label({ marginTop: 2, letterSpacing: '0.08em', color: T.faint })}>
              {c.kind === 'income' ? 'Income' : 'Spending'} this month
            </div>
          </div>
          <Balance n={Math.abs(c.spent)} currency={currency} />
          {/* Deleting a category is safe in a way deleting an account is not:
              the rows survive, they just stop being counted anywhere. */}
          <button onClick={() => del.mutate(c.id)} disabled={del.isPending} aria-label={`Delete ${c.name}`}
                  style={{ ...segment(false), flexShrink: 0, minHeight: 44, color: T.bad,
                           borderColor: 'rgba(239,68,68,0.35)' }}>
            ×
          </button>
        </div>
      ))}

      {unsorted !== 0 && (
        <div style={{ ...body(13), color: T.muted, marginTop: 12, lineHeight: 1.45 }}>
          {fmt(Math.abs(unsorted), currency)} of this month's spending isn't in any category yet.
        </div>
      )}

      <form onSubmit={submit} style={{ display: 'flex', gap: 8, marginTop: 14 }}>
        <input style={{ ...input(), flex: 1, minWidth: 0 }} placeholder="Groceries"
               value={name} onChange={(e) => setName(e.target.value)} />
        <button type="submit" disabled={!name.trim() || create.isPending}
                style={{ ...button('ghost'), flexShrink: 0 }}>
          {create.isPending ? 'Adding…' : 'Add'}
        </button>
      </form>
    </Collapsible>
  )
}

// ── Accounts ─────────────────────────────────────────────────────────────────

/**
 * Rename, re-kind, archive.
 *
 * Reads its own list rather than the month's, because the month only carries
 * accounts that are still open — and the one thing you cannot do from a screen
 * that hides archived accounts is un-archive one.
 */
function Accounts() {
  const { data } = useQuery({ queryKey: ACCOUNTS_KEY, queryFn: () => money.accounts(false) })
  const create = useMoneyAction((a: { name: string; kind: AccountKind }) => money.createAccount(a))
  const [name, setName] = useState('')
  const [kind, setKind] = useState<AccountKind>('checking')

  const accounts = data?.accounts ?? []
  const open = accounts.filter((a) => !a.archived)

  const submit = (e: FormEvent) => {
    e.preventDefault()
    const n = name.trim()
    if (!n || create.isPending) return
    create.mutate({ name: n, kind }, { onSuccess: () => setName('') })
  }

  return (
    <Collapsible variant="section" title="Accounts" right={`${open.length} open`}>
      {accounts.map((a) => <AccountRow key={a.id} account={a} />)}

      <div style={{ ...body(13), color: T.muted, marginTop: 14, lineHeight: 1.5 }}>
        There is no delete, on purpose: ledger rows point at the account, and closing one
        does not un-happen last year's rent. Archiving takes it out of the pickers and the
        month view while every entry that ever touched it stays exactly where it is.
      </div>

      <form onSubmit={submit} style={{ marginTop: 16 }}>
        <div style={label()}>New account</div>
        <input style={{ ...input(), marginTop: 8 }} placeholder="Savings"
               value={name} onChange={(e) => setName(e.target.value)} />
        <div style={{ display: 'flex', gap: 6, marginTop: 8, flexWrap: 'wrap' }}>
          {KINDS.map((k) => (
            <button key={k} type="button" onClick={() => setKind(k)} style={segment(kind === k)}>
              {KIND_LABEL[k]}
            </button>
          ))}
        </div>
        <button type="submit" disabled={!name.trim() || create.isPending}
                style={{ ...button('primary'), width: '100%', marginTop: 12, opacity: name.trim() ? 1 : 0.4 }}>
          {create.isPending ? 'Adding…' : 'Add account'}
        </button>
      </form>
    </Collapsible>
  )
}

function AccountRow({ account }: { account: { id: number; name: string; kind: AccountKind; archived: boolean } }) {
  const update = useMoneyAction((a: { id: number; patch: { name?: string; kind?: AccountKind; archived?: boolean } }) =>
    money.updateAccount(a.id, a.patch))
  const archive = useMoneyAction((id: number) => money.archiveAccount(id))
  const [editing, setEditing] = useState(false)
  const [name, setName] = useState(account.name)
  const [kind, setKind] = useState<AccountKind>(account.kind)

  if (editing) {
    return (
      <div style={{ paddingTop: 12, borderTop: `1px solid ${T.rule}` }}>
        <input style={input()} value={name} onChange={(e) => setName(e.target.value)} />
        <div style={{ display: 'flex', gap: 6, marginTop: 8, flexWrap: 'wrap' }}>
          {KINDS.map((k) => (
            <button key={k} type="button" onClick={() => setKind(k)} style={segment(kind === k)}>
              {KIND_LABEL[k]}
            </button>
          ))}
        </div>
        <div style={{ display: 'flex', gap: 8, marginTop: 12, paddingBottom: 12 }}>
          <button type="button" onClick={() => { setName(account.name); setKind(account.kind); setEditing(false) }}
                  style={{ ...button('ghost'), flex: 1 }}>Cancel</button>
          <button
            type="button"
            disabled={!name.trim() || update.isPending}
            onClick={() => update.mutate(
              { id: account.id, patch: { name: name.trim(), kind } },
              { onSuccess: () => setEditing(false) },
            )}
            style={{ ...button('primary'), flex: 1 }}
          >
            {update.isPending ? 'Saving…' : 'Save'}
          </button>
        </div>
      </div>
    )
  }

  return (
    <div style={row()}>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ ...body(14), wordBreak: 'break-word', color: account.archived ? T.faint : T.ink }}>
          {account.name}
          {account.archived && (
            <span style={label({ marginLeft: 8, letterSpacing: '0.1em', color: T.faint })}>archived</span>
          )}
        </div>
        <div style={label({ marginTop: 2, letterSpacing: '0.1em', color: T.faint })}>
          {KIND_LABEL[account.kind]}
        </div>
      </div>
      <button onClick={() => setEditing(true)} style={{ ...segment(false), flexShrink: 0, minHeight: 44 }}>
        Edit
      </button>
      {account.archived ? (
        <button
          onClick={() => update.mutate({ id: account.id, patch: { archived: false } })}
          disabled={update.isPending}
          style={{ ...segment(false), flexShrink: 0, minHeight: 44 }}
        >
          Reopen
        </button>
      ) : (
        <button
          onClick={() => archive.mutate(account.id)}
          disabled={archive.isPending}
          style={{ ...segment(false), flexShrink: 0, minHeight: 44 }}
        >
          Archive
        </button>
      )}
    </div>
  )
}

const nav: CSSProperties = {
  appearance: 'none', width: 44, height: 44, borderRadius: 3,
  border: `1px solid ${T.ruleStrong}`, background: 'transparent',
  color: T.ink, fontSize: 17, cursor: 'pointer', lineHeight: 1,
}
