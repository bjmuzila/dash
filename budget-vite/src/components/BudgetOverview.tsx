import { useState } from 'react'
import type {
  BudgetOverview as Overview, BudgetBriefing, BudgetCategory, FlowBucket,
  BudgetRent, RentFlow,
} from '../api'
import { T, label, body, card, tile, MONO } from '../theme'
import Collapsible from './Collapsible'

/**
 * The Money page — every card and graph from /owner/budget, re-laid-out for a
 * 390px phone, on the dashboard's card surface.
 *
 * Order is deliberate and matches how the page gets used: the BRIEFING answers
 * "can I spend anything today" before you scroll at all; the six tiles are the
 * month in one glance; everything below is why.
 *
 * Three rules this file follows, all learned the hard way on the desktop:
 *
 *   1. NOTHING is computed here. Every figure arrives from `overview` /
 *      `briefing`, which the server builds by porting the desktop's memos. A
 *      chart that does its own arithmetic is a second source of truth, and the
 *      two drift.
 *   2. Charts are hand-rolled SVG, not a library. Each is 20-40 lines, and a
 *      charting dependency costs more bundle than the whole app.
 *   3. Dates are STRINGS. `'2026-08-14'.split('-')` — never `new Date(iso)`,
 *      which parses as UTC midnight and renders as the 13th east of Greenwich.
 *      That bug has been fixed three times in this codebase already.
 */

const fmt = (n: number, currency = 'USD') =>
  new Intl.NumberFormat('en-US', { style: 'currency', currency, maximumFractionDigits: 2 }).format(n || 0)

/** Whole dollars, thousands-separated: $1,860. What the tiles and briefing use. */
const fmt0 = (n: number, currency = 'USD') =>
  new Intl.NumberFormat('en-US', { style: 'currency', currency, maximumFractionDigits: 0 }).format(n || 0)

/** Compact, for axis ends and cramped rows: $1.2k, $840. */
const fmtK = (n: number, currency = 'USD') => {
  const a = Math.abs(n)
  if (a >= 1000) return `${n < 0 ? '−' : ''}$${(a / 1000).toFixed(a >= 10000 ? 0 : 1)}k`
  return fmt0(n, currency)
}

const shortDate = (iso: string) => { const [, m, d] = iso.split('-'); return `${Number(m)}/${Number(d)}` }
/** 'MM-DD' — how the briefing email writes a date. */
const mmdd = (iso: string) => iso.slice(5)

/**
 * The three verdict tones, on THIS app's palette rather than the email's.
 *
 * The email is standalone HTML in an inbox and invents its own green/amber/red.
 * Here the same three states have to live next to the rest of the dashboard, so
 * they reuse the tokens that already mean those things everywhere else: cyan =
 * fine, orange = act, red = failed. Each is a wash of its own colour over the
 * panel, which is how a card gets a state on cbedge.net — not a flat block of
 * a colour that appears nowhere else on the screen.
 */
const TONE: Record<BudgetBriefing['tone'], { fg: string; bg: string; bd: string }> = {
  good: { fg: T.accent, bg: 'rgba(142,202,230,0.09)', bd: 'rgba(142,202,230,0.30)' },
  warn: { fg: T.warn,   bg: 'rgba(251,133,1,0.10)',   bd: 'rgba(251,133,1,0.32)' },
  bad:  { fg: T.bad,    bg: 'rgba(239,68,68,0.10)',   bd: 'rgba(239,68,68,0.32)' },
}
/** Money going out. The dashboard's red, not the email's washed-out pink. */
const SOFT_RED = T.bad
/** Money coming in / on track. The dashboard's light cyan. */
const GOOD = T.accent

// ── Shared bits ──────────────────────────────────────────────────────────────

/**
 * A card heading. `small` is for the half-width cards, where the full-size
 * letterspaced title wraps to two lines and eats the chart underneath it —
 * so it drops a point and stops wrapping entirely.
 */
function Head({ title, right, rightNode, small }: {
  title: string; right?: string; rightNode?: React.ReactNode; small?: boolean
}) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                  gap: 6, marginBottom: 10 }}>
      <span style={{ fontFamily: 'inherit', fontSize: small ? 10.5 : 12, fontWeight: 800,
                     letterSpacing: small ? '0.1em' : '0.14em', textTransform: 'uppercase',
                     color: T.ink, whiteSpace: 'nowrap' }}>{title}</span>
      {rightNode ?? (right && (
        <span style={label({ letterSpacing: '0.06em', whiteSpace: 'nowrap' })}>{right}</span>
      ))}
    </div>
  )
}

/** One of the six top tiles. */
function Tile({ k, v, sub, tone }: { k: string; v: string; sub?: string; tone?: string }) {
  return (
    <div style={tile()}>
      <div style={{ fontFamily: MONO, fontSize: 9, fontWeight: 700, letterSpacing: '0.12em',
                    textTransform: 'uppercase', color: T.ink }}>{k}</div>
      <div style={{ fontSize: 18, fontWeight: 800, lineHeight: 1.15, marginTop: 6,
                    fontVariantNumeric: 'tabular-nums', letterSpacing: '-0.02em',
                    color: tone || T.ink, whiteSpace: 'nowrap', overflow: 'hidden',
                    textOverflow: 'ellipsis' }}>{v}</div>
      {sub && <div style={{ fontSize: 9, lineHeight: 1.3, marginTop: 4, color: T.ink }}>{sub}</div>}
    </div>
  )
}

/** A label/value line inside a card. */
function KV({ k, v, tone }: { k: string; v: string; tone?: string }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, marginTop: 6,
                  fontSize: 12, fontVariantNumeric: 'tabular-nums' }}>
      <span style={{ color: T.ink }}>{k}</span>
      <b style={{ color: tone || T.ink, fontWeight: 700 }}>{v}</b>
    </div>
  )
}

// ── The page ─────────────────────────────────────────────────────────────────

export default function BudgetOverview({ o, briefing, rent, categories, unsortedSpend, currency, month, onSettleFlow }: {
  o: Overview
  briefing: BudgetBriefing
  /** Optional: an older server predates the rent card. */
  rent?: BudgetRent
  categories: BudgetCategory[]
  unsortedSpend: number
  currency: string
  month: string
  /** Tap a scheduled line off (or back on). Omitted = read-only card. */
  onSettleFlow?: (f: RentFlow) => void | Promise<void>
}) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      {/* Rent sits ABOVE the briefing. The briefing answers "can I spend
          anything today"; rent answers "does the biggest bill of the month
          clear", and on the 2nd of the month that is the more urgent of the
          two. */}
      {rent && rent.rentAmount > 0 && <Rent r={rent} currency={currency} onToggle={onSettleFlow} />}
      <Briefing b={briefing} />
      <Tiles o={o} currency={currency} />

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 9 }}>
        <SafeToSpend o={o} currency={currency} />
        <SpendPace o={o} currency={currency} />
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 9 }}>
        <CategoryDonut o={o} currency={currency} />
        <BalanceCheck o={o} currency={currency} />
      </div>

      <CashFlow o={o} currency={currency} month={month} />
      <UpcomingPay o={o} currency={currency} />
      <CategoryBudgets categories={categories} unsortedSpend={unsortedSpend} currency={currency} />
    </div>
  )
}

// ── Rent ─────────────────────────────────────────────────────────────────────

/**
 * The rent countdown, same arithmetic as the desktop card.
 *
 * `projected` is the bank balance plus what is still scheduled to land before
 * the 5th. Anything already in the account must NOT be added again, which is
 * what tapping a line does — it stays listed, struck through, and leaves the
 * totals. Nothing is computed here; the server sends both the flows and the
 * totals already net of the settled ones.
 */
function Rent({ r, currency, onToggle }: {
  r: BudgetRent; currency: string; onToggle?: (f: RentFlow) => void | Promise<void>
}) {
  const covered = r.shortfall <= 0
  const tone = r.paid || covered ? TONE.good : TONE.bad
  const pct = r.rentAmount > 0 ? Math.min(100, Math.max(0, (r.projected / r.rentAmount) * 100)) : 0

  const line = (f: RentFlow, positive: boolean) => (
    <button
      key={f.key}
      onClick={() => void onToggle?.(f)}
      disabled={!onToggle}
      title={f.settled ? 'Counting it again' : 'Already cleared? Tap to take it out of the maths'}
      style={{
        display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8,
        width: '100%', marginTop: 3, padding: '4px 5px', borderRadius: 7,
        background: f.settled ? 'rgba(255,255,255,0.05)' : 'transparent',
        border: 'none', font: 'inherit', textAlign: 'left',
        color: T.ink, cursor: onToggle ? 'pointer' : 'default',
        opacity: f.settled ? 0.55 : 1,
      }}
    >
      <span style={{ fontSize: 12, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                     textDecoration: f.settled ? 'line-through' : undefined }}>
        {f.settled ? '✓ ' : ''}{f.label} <span style={{ opacity: 0.55 }}>· {shortDate(f.date)}</span>
      </span>
      <b style={{ fontSize: 12, fontVariantNumeric: 'tabular-nums', flexShrink: 0, fontWeight: 700,
                  color: f.settled ? T.ink : positive ? GOOD : SOFT_RED,
                  textDecoration: f.settled ? 'line-through' : undefined }}>
        {positive ? '+' : ''}{fmt(f.amount, currency)}
      </b>
    </button>
  )

  return (
    <div style={card({ padding: 14 })}>
      <Head title="Rent" right={`Due ${shortDate(r.dueIso)} · the 5th`} />

      <div style={{ display: 'flex', alignItems: 'baseline', gap: 9 }}>
        <span style={{ fontSize: 40, fontWeight: 800, lineHeight: 1, letterSpacing: '-0.02em',
                       color: tone.fg }}>
          {r.paid ? 'Paid' : r.daysUntil === 0 ? 'Today' : r.daysUntil}
        </span>
        {!r.paid && r.daysUntil > 0 && (
          <span style={{ ...body(12.5), fontWeight: 700 }}>day{r.daysUntil === 1 ? '' : 's'} to rent</span>
        )}
        {r.paid && <span style={{ ...body(12.5), fontWeight: 700, color: tone.fg }}>✓ this month</span>}
      </div>

      <div style={{ marginTop: 10 }}>
        <Line k="Rent" v={fmt(r.rentAmount, currency)} hi />
        <Line k="On hand now" v={fmt(r.available, currency)}
              tone={r.available < 0 ? SOFT_RED : undefined} />
      </div>

      {!r.paid && (
        <div style={{ marginTop: 11, paddingTop: 11, borderTop: `1px solid ${T.rule}` }}>
          {onToggle && (
            <div style={{ ...body(11), opacity: 0.62, marginBottom: 6, lineHeight: 1.4 }}>
              Tap a line that already cleared — it is in the balance above, so counting it here would add it twice.
            </div>
          )}

          <div style={{ display: 'flex', justifyContent: 'space-between', fontFamily: MONO, fontSize: 10,
                        fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase' }}>
            <span style={{ color: T.ink, opacity: 0.7 }}>Coming in by the 5th</span>
            <span style={{ color: r.incomingTotal > 0 ? GOOD : T.ink }}>+{fmt(r.incomingTotal, currency)}</span>
          </div>
          {r.incoming.length
            ? r.incoming.map((f) => line(f, true))
            : <div style={{ ...body(11), opacity: 0.5, marginTop: 3 }}>Nothing scheduled</div>}

          <div style={{ display: 'flex', justifyContent: 'space-between', fontFamily: MONO, fontSize: 10,
                        fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase', marginTop: 10 }}>
            <span style={{ color: T.ink, opacity: 0.7 }}>Going out by the 5th</span>
            <span style={{ color: r.outgoingTotal > 0 ? SOFT_RED : T.ink }}>
              {r.outgoingTotal > 0 ? '−' : ''}{fmt(r.outgoingTotal, currency)}
            </span>
          </div>
          {r.outgoing.length
            ? r.outgoing.map((f) => line(f, false))
            : <div style={{ ...body(11), opacity: 0.5, marginTop: 3 }}>Nothing scheduled</div>}

          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginTop: 11 }}>
            <span style={{ display: 'flex', flexDirection: 'column' }}>
              <span style={{ ...body(12), fontWeight: 700 }}>Projected on the 5th, for rent</span>
              <span style={{ ...body(10.5), opacity: 0.65 }}>before rent is paid</span>
            </span>
            <b style={{ fontSize: 17, fontWeight: 800, color: tone.fg, fontVariantNumeric: 'tabular-nums' }}>
              {fmt(r.projected, currency)}
            </b>
          </div>
          {r.settledCount > 0 && (
            <div style={{ ...body(10.5), opacity: 0.65, marginTop: 4 }}>
              {r.settledCount} line{r.settledCount === 1 ? '' : 's'} left out — already cleared or not coming.
              {onToggle ? ' Tap to put them back.' : ''}
            </div>
          )}
        </div>
      )}

      <div style={{ height: 7, borderRadius: 99, background: 'rgba(255,255,255,0.07)',
                    margin: '11px 0 6px', overflow: 'hidden' }}>
        <div style={{ height: 7, borderRadius: 99, background: tone.fg, width: `${pct}%` }} />
      </div>

      {r.paid ? (
        <div style={{ ...body(12.5), fontWeight: 700, color: tone.fg }}>Rent is paid for this month.</div>
      ) : (
        <div style={{ background: tone.bg, border: `1px solid ${tone.bd}`, borderLeft: `3px solid ${tone.fg}`,
                      borderRadius: 10, padding: '10px 12px', marginTop: 2 }}>
          {covered ? (
            <>
              <div style={{ ...body(13), fontWeight: 700, color: tone.fg }}>Enough coming in — rent's covered.</div>
              <div style={{ ...body(11.5), opacity: 0.8, marginTop: 2 }}>
                {fmt(r.projected - r.rentAmount, currency)} to spare after rent
                {r.daysUntil > 0 ? ' on the 5th' : ''}.
              </div>
            </>
          ) : (
            <>
              <div style={{ ...body(12) }}>
                Still short by <b style={{ color: tone.fg }}>{fmt(r.shortfall, currency)}</b> after what's due
                {r.daysUntil > 0 ? ` in ${r.daysUntil} day${r.daysUntil === 1 ? '' : 's'}` : ' today'}
              </div>
              <div style={{ ...body(15), fontWeight: 800, color: tone.fg, marginTop: 4 }}>
                {fmt(r.perDay, currency)} <span style={{ ...body(12), fontWeight: 700 }}>/day extra</span>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  )
}

// ── Briefing ─────────────────────────────────────────────────────────────────

/**
 * The 8am email, on the page. Same computation, same wording — the point is
 * that the phone and the inbox never say different things about the same day.
 *
 * The rule worth knowing: "available" counts pay STILL COMING, not just what's
 * in the bank. Without that, every month reads as a catastrophe on the 1st and
 * recovers on payday, which is noise rather than information.
 */
function Briefing({ b }: { b: BudgetBriefing }) {
  const t = TONE[b.tone] || TONE.good
  return (
    <div style={card({ padding: 14 })}>
      <Head title="Budget briefing" right="as of now" />

      {/* The verdict. A wash of its own tone with a matching hairline and a
          left rule — the same way a card carries state everywhere else in the
          dashboard. */}
      <div style={{ background: t.bg, border: `1px solid ${t.bd}`, borderLeft: `3px solid ${t.fg}`,
                    borderRadius: 10, padding: '12px 14px' }}>
        <div style={{ ...body(19), fontWeight: 700, lineHeight: 1.2, letterSpacing: '-0.01em',
                      color: t.fg }}>{b.verdict}</div>
        <div style={{ ...body(12.5), marginTop: 5 }}>{b.sub}</div>
        {b.pastDueCount > 0 && (
          <div style={{ fontFamily: MONO, fontSize: 10, fontWeight: 700, letterSpacing: '0.1em',
                        textTransform: 'uppercase', marginTop: 8, color: T.bad }}>
            {b.pastDueCount} past due · {fmt0(b.pastDueTotal)}
          </div>
        )}
      </div>

      {/* The five figures. Hairline-separated rows on the card itself — the
          email's boxed table is an email constraint, not a design decision. */}
      <div style={{ marginTop: 12 }}>
        {/* Cash on hand, and WHEN it was last confirmed. Every figure under it
            is derived from this one, so a three-week-old balance quietly makes
            the whole card wrong — and `bankAsOf: null` means no balance has
            ever been logged and this is the month's opening number. */}
        <Line k="In the bank" v={fmt0(b.inBank)}
              sub={b.bankAsOf ? `as of ${shortDay(b.bankAsOf)}` : 'not logged — month opening'}
              subTone={b.bankAsOf ? undefined : T.warn} />
        <Line k="Pay coming" v={`+${fmt0(b.coming)}`} tone={GOOD} />
        <Line k="Income" v={fmt0(b.available)} hi />
        <Line k="Still due" v={fmt0(b.owed)} tone={SOFT_RED} />
        <Line k="Left after bills" v={fmt0(b.after)} tone={t.fg} hi />
      </div>

      {b.payComing.length > 0 && (
        <MiniTable title="Pay coming in" rows={b.payComing.map((p) => ({
          date: mmdd(p.date), note: p.late ? 'not in yet' : null, noteTone: T.warn,
          label: p.label, amount: `+${fmt0(p.amount)}`, tone: GOOD,
        }))} />
      )}
      {b.stillDue.length > 0 && (
        <MiniTable title="Still due" rows={b.stillDue.map((p) => ({
          date: mmdd(p.date), note: p.pastDue ? 'past due' : null, noteTone: T.bad,
          label: p.label, amount: fmt0(p.amount), tone: SOFT_RED,
        }))} />
      )}
    </div>
  )
}

/**
 * One figure in the briefing. `hi` is the running total (Income, Left after
 * bills) — it gets the weight, not a background fill, because a striped table
 * is an email pattern and this is a card.
 */
function Line({ k, v, tone, hi, sub, subTone }: {
  k: string; v: string; tone?: string; hi?: boolean; sub?: string; subTone?: string
}) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline',
                  padding: '9px 0', borderTop: `1px solid ${T.rule}` }}>
      <span style={{ fontFamily: MONO, fontSize: 10, fontWeight: hi ? 700 : 500,
                     letterSpacing: '0.12em', textTransform: 'uppercase', color: T.ink }}>
        {k}
        {/* A qualifier on the KEY, not the value — "as of the 5th" is a fact
            about what the label means, and putting it next to the figure would
            make it read as part of the number. */}
        {sub && (
          <span style={{ display: 'block', fontSize: 9, fontWeight: 500, letterSpacing: '0.08em',
                         textTransform: 'none', marginTop: 3, color: subTone || T.faint }}>
            {sub}
          </span>
        )}
      </span>
      <span style={{ ...body(hi ? 17 : 15), fontWeight: hi ? 800 : 600,
                     fontVariantNumeric: 'tabular-nums', letterSpacing: '-0.01em',
                     color: tone || T.ink }}>{v}</span>
    </div>
  )
}

/** "5 Aug" from "2026-08-05". Split, never `new Date(iso)` — a bare date string
 *  parses as UTC midnight and reads a day early west of Greenwich. */
function shortDay(iso: string): string {
  const [y, m, d] = iso.split('-').map(Number)
  return new Date(y, m - 1, d).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

function MiniTable({ title, rows }: {
  title: string
  rows: { date: string; note: string | null; noteTone: string;
          label: string; amount: string; tone: string }[]
}) {
  return (
    <>
      <div style={{ ...label({ letterSpacing: '0.14em' }), margin: '16px 0 2px' }}>{title}</div>
      {rows.map((r, i) => (
        <div key={`${r.label}-${i}`}
             style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '9px 0',
                      borderTop: `1px solid ${T.rule}` }}>
          <span style={{ fontFamily: MONO, fontSize: 11, fontWeight: 600, width: 38,
                         flexShrink: 0, color: T.ink }}>{r.date}</span>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ ...body(14), overflow: 'hidden', textOverflow: 'ellipsis',
                          whiteSpace: 'nowrap' }}>{r.label}</div>
            {/* The status sits UNDER the name rather than inline with the date,
                so a long label can't push it off the row. */}
            {r.note && (
              <div style={{ fontFamily: MONO, fontSize: 9, fontWeight: 700, letterSpacing: '0.1em',
                            textTransform: 'uppercase', marginTop: 2, color: r.noteTone }}>
                {r.note}
              </div>
            )}
          </div>
          <span style={{ ...body(14), fontWeight: 700, fontVariantNumeric: 'tabular-nums',
                         color: r.tone }}>{r.amount}</span>
        </div>
      ))}
    </>
  )
}

// ── Six tiles ────────────────────────────────────────────────────────────────

/** The desktop's top stat row, 3 across × 2 down. Amazon is folded into Income
 *  and Net Profit here exactly as it is there — that is the whole reason these
 *  two surfaces now agree on the month. */
function Tiles({ o, currency }: { o: Overview; currency: string }) {
  const t = o.tiles
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 9 }}>
      {/* Cash on hand — the same figure /owner/budget shows, from the last
          logged daily balance. Not the month's projected ending balance. */}
      <Tile k="All banks" v={fmt0(t.allBanks, currency)} sub="Coastal · Truist · SECU"
            tone={t.allBanks < 0 ? SOFT_RED : T.ink} />
      <Tile k="Income" v={fmtK(t.income, currency)} sub="incl. Amazon" tone={GOOD} />
      <Tile k="Expenses" v={fmtK(t.expenses, currency)} sub="Month outflows" tone={SOFT_RED} />
      <Tile k="Net profit" v={fmtK(t.netProfit, currency)} sub="Income − expenses"
            tone={t.netProfit < 0 ? SOFT_RED : '#5ECB92'} />
      <Tile k="Amazon" v={fmt0(t.amazon, currency)}
            sub={`${t.amazonDays} day${t.amazonDays === 1 ? '' : 's'} · net of gas`}
            tone={t.amazon < 0 ? SOFT_RED : T.ink} />
      <Tile k="Bzila" v={fmtK(t.bzila, currency)}
            sub={`${fmtK(t.bzilaIn, currency)} in · ${fmtK(t.bzilaOut, currency)} out`}
            tone={t.bzila < 0 ? SOFT_RED : '#5ECB92'} />
    </div>
  )
}

// ── Safe to spend ────────────────────────────────────────────────────────────

function SafeToSpend({ o, currency }: { o: Overview; currency: string }) {
  const neg = o.safePerDay < 0
  const pct = Math.min(100, Math.max(0, (o.todayDay / o.daysInMonth) * 100))
  return (
    <div style={card({ padding: 12, display: 'flex', flexDirection: 'column' })}>
      <Head small title="Safe to spend" />
      <div style={{ fontSize: 27, fontWeight: 800, lineHeight: 1, letterSpacing: '-0.02em',
                    fontVariantNumeric: 'tabular-nums', color: neg ? SOFT_RED : GOOD,
                    textShadow: `0 0 26px ${neg ? 'rgba(244,148,142,.45)' : 'rgba(142,202,230,.45)'}` }}>
        {fmt0(o.safePerDay, currency)}
        <span style={{ fontSize: 12, fontWeight: 800 }}>/day</span>
      </div>
      <KV k="Free" v={fmt0(o.safe, currency)} tone={o.safe < 0 ? SOFT_RED : T.ink} />
      <KV k="Bills due" v={fmt0(o.billsLeft, currency)} tone={SOFT_RED} />
      <KV k="Days left" v={String(o.daysLeft)} />
      <div style={{ marginTop: 'auto', paddingTop: 11 }}>
        <div style={{ height: 6, borderRadius: 999, background: 'rgba(255,255,255,0.09)', overflow: 'hidden' }}>
          <div style={{ width: `${pct}%`, height: '100%', borderRadius: 999,
                        background: 'linear-gradient(90deg, #219EBC, #8ECAE6)',
                        boxShadow: '0 0 12px rgba(142,202,230,.55)' }} />
        </div>
        <div style={{ fontSize: 10, marginTop: 5, color: T.ink }}>
          Day {Math.max(o.todayDay, 0)} of {o.daysInMonth}
        </div>
      </div>
    </div>
  )
}

// ── Spend pace ───────────────────────────────────────────────────────────────

function SpendPace({ o, currency }: { o: Overview; currency: string }) {
  const W = 150, H = 76
  const n = o.cum.length
  const over = o.spentMtd > o.paceNow
  const delta = Math.abs(o.spentMtd - o.paceNow)
  const stroke = over ? SOFT_RED : GOOD

  // Only draw up to today. A flat forward projection reads as "spending
  // stopped", which is the opposite of true.
  const upto = Math.max(1, Math.min(o.todayDay, n))
  const peak = Math.max(o.budgetTotal, ...o.cum, 1)
  const x = (i: number) => (n > 1 ? (i / (n - 1)) * W : 0)
  const y = (v: number) => H - (v / peak) * (H - 6)
  const path = o.cum.slice(0, upto)
    .map((v, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(' ')

  return (
    <div style={card({ padding: 12, display: 'flex', flexDirection: 'column' })}>
      <Head small title="Spend pace" rightNode={
        <span style={{ fontFamily: MONO, fontSize: 9, fontWeight: 800, letterSpacing: '0.08em',
                       padding: '4px 7px', borderRadius: 999, color: stroke, whiteSpace: 'nowrap',
                       background: over ? 'rgba(244,148,142,.13)' : 'rgba(142,202,230,.13)',
                       border: `1px solid ${over ? 'rgba(244,148,142,.4)' : 'rgba(142,202,230,.4)'}` }}>
          {over ? 'OVER' : 'UNDER'} {fmt0(delta, currency)}
        </span>} />
      {n > 1 && (
        <svg viewBox={`0 0 ${W} ${H}`} width="100%" height={H} preserveAspectRatio="none"
             style={{ display: 'block' }} aria-hidden>
          <defs>
            <linearGradient id="paceFill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={stroke} stopOpacity="0.28" />
              <stop offset="100%" stopColor={stroke} stopOpacity="0" />
            </linearGradient>
          </defs>
          {/* Straight-line budget: where you'd be spending evenly. */}
          <line x1="0" y1={y(0)} x2={W} y2={y(o.budgetTotal)}
                stroke="rgba(255,255,255,0.28)" strokeWidth="1" strokeDasharray="3 4" />
          <path d={`${path} L${x(upto - 1).toFixed(1)},${H} L0,${H} Z`} fill="url(#paceFill)" />
          <path d={path} fill="none" stroke={stroke} strokeWidth="2"
                strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
          {o.todayDay > 0 && <circle cx={x(upto - 1)} cy={y(o.cum[upto - 1])} r="3" fill={stroke} />}
        </svg>
      )}
      <KV k="Spent MTD" v={fmt0(o.spentMtd, currency)} />
      <KV k="Budget" v={fmt0(o.budgetTotal, currency)} />
    </div>
  )
}

// ── Where it went ────────────────────────────────────────────────────────────

/**
 * Interactive donut. Tapping a slice selects it and the centre swaps to that
 * category's share; tapping it again clears. Drawn as a stroked circle with dash
 * offsets rather than arc paths — same picture, no trigonometry, no seams.
 */
function CategoryDonut({ o, currency }: { o: Overview; currency: string }) {
  const [sel, setSel] = useState<string | null>(null)
  const total = o.slices.reduce((n, s) => n + s.value, 0)

  if (!o.slices.length || total <= 0) {
    return (
      <div style={card({ padding: 12 })}>
        <Head small title="Where it went" />
        <div style={{ ...body(13), marginTop: 6 }}>Nothing spent yet this month.</div>
      </div>
    )
  }

  const R = 44, C = 2 * Math.PI * R
  let acc = 0
  const active = o.slices.find((s) => s.label === sel) || o.slices[0]

  return (
    <div style={card({ padding: 12 })}>
      <Head small title="Where it went" right={fmtK(total, currency)} />
      <div style={{ display: 'flex', justifyContent: 'center' }}>
        <svg width="120" height="120" viewBox="0 0 112 112">
          <g transform="rotate(-90 56 56)">
            <circle cx="56" cy="56" r={R} fill="none" stroke="rgba(255,255,255,0.08)" strokeWidth="15" />
            {o.slices.map((s) => {
              const len = (s.value / total) * C
              const dim = sel !== null && s.label !== sel
              const el = (
                <circle key={s.label} cx="56" cy="56" r={R} fill="none" stroke={s.colour}
                        strokeWidth={s.label === sel ? 18 : 15}
                        strokeOpacity={dim ? 0.3 : 1}
                        strokeDasharray={`${Math.max(0, len - 1.5)} ${C}`}
                        strokeDashoffset={-acc}
                        onClick={() => setSel(sel === s.label ? null : s.label)}
                        style={{ cursor: 'pointer' }} />
              )
              acc += len
              return el
            })}
          </g>
          <text x="56" y="52" textAnchor="middle" fill={T.ink} fontSize="9"
                fontFamily={MONO} style={{ letterSpacing: '0.08em' }}>
            {active.label.toUpperCase().slice(0, 10)}
          </text>
          <text x="56" y="68" textAnchor="middle" fill={T.ink} fontSize="15" fontWeight="800">
            {Math.round((active.value / total) * 100)}%
          </text>
        </svg>
      </div>
      <div style={{ marginTop: 8 }}>
        {o.slices.slice(0, 4).map((s) => (
          <button key={s.label} onClick={() => setSel(sel === s.label ? null : s.label)}
                  style={{ display: 'flex', alignItems: 'center', gap: 7, padding: '4px 0',
                           background: 'none', border: 'none', width: '100%', cursor: 'pointer',
                           opacity: sel !== null && s.label !== sel ? 0.45 : 1 }}>
            <span style={{ width: 8, height: 8, borderRadius: 2, background: s.colour, flexShrink: 0 }} />
            <span style={{ flex: 1, minWidth: 0, fontSize: 12, color: T.ink, textAlign: 'left',
                           overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {s.label}
            </span>
            <span style={{ fontSize: 12, fontWeight: 700, color: T.ink }}>{fmtK(s.value, currency)}</span>
          </button>
        ))}
      </div>
    </div>
  )
}

// ── Balance check ────────────────────────────────────────────────────────────

/**
 * Does the bank agree with the register? Only CLEARED money is compared — a
 * scheduled bill hasn't left the account, so counting it would show a permanent
 * phantom shortfall. Drift below zero means money left that nobody wrote down.
 */
function BalanceCheck({ o, currency }: { o: Overview; currency: string }) {
  const r = o.reconcile
  if (!r) {
    return (
      <div style={card({ padding: 12 })}>
        <Head small title="Balance check" />
        <div style={{ ...body(13), marginTop: 6 }}>
          Log bank balances twice to compare them against the register.
        </div>
      </div>
    )
  }
  const off = Math.abs(r.drift) >= 1
  return (
    <div style={card({ padding: 12 })}>
      <Head small title="Balance check" right={shortDate(r.to)} />
      <div style={{ fontSize: 27, fontWeight: 800, lineHeight: 1, letterSpacing: '-0.02em',
                    fontVariantNumeric: 'tabular-nums', color: off ? T.warn : GOOD }}>
        {r.drift > 0 ? '+' : ''}{fmt(r.drift, currency)}
      </div>
      <div style={{ fontSize: 11, lineHeight: 1.4, marginTop: 6, color: T.ink }}>
        {off
          ? r.drift < 0 ? 'Bank is lower than the register.' : 'Bank is higher than the register.'
          : 'Bank and register agree.'}
      </div>
      <KV k="Started" v={fmtK(r.prevBalance, currency)} />
      <KV k="In / out" v={`+${fmtK(r.moneyIn, currency)} / −${fmtK(r.moneyOut, currency)}`} />
      <KV k="Expected" v={fmtK(r.expected, currency)} />
      <KV k="Actual" v={fmtK(r.actual, currency)} tone={off ? T.warn : T.ink} />
      {r.uncleared > 0 && (
        <div style={{ fontSize: 10, marginTop: 9, color: T.ink }}>
          {fmt0(r.uncleared, currency)} scheduled, not cleared — excluded on purpose
        </div>
      )}
    </div>
  )
}

// ── Cash flow ────────────────────────────────────────────────────────────────

/** In and out, at the resolution you pick. Monthly is the year's real rows —
 *  daily and weekly are this month, projections included. */
function CashFlow({ o, currency, month }: { o: Overview; currency: string; month: string }) {
  const [mode, setMode] = useState<'daily' | 'weekly' | 'monthly'>('weekly')
  const buckets: FlowBucket[] = o.flow?.[mode] ?? o.cashflow ?? []
  const peak = Math.max(1, ...buckets.map((b) => Math.max(b.inflow, b.outflow)))
  // 31 daily bars on a 358px card are 6px wide — thin, but the shape is the
  // point, and the labels thin out rather than the bars.
  const showEvery = mode === 'daily' ? Math.ceil(buckets.length / 8) : 1

  return (
    <div style={card()}>
      <Head title="Cash flow" rightNode={
        <div style={{ display: 'flex', gap: 4 }}>
          {(['daily', 'weekly', 'monthly'] as const).map((k) => (
            <button key={k} onClick={() => setMode(k)}
                    style={{ appearance: 'none', fontFamily: MONO, fontSize: 10, fontWeight: 700,
                             letterSpacing: '0.1em', padding: '5px 9px', borderRadius: 8,
                             cursor: 'pointer',
                             background: mode === k ? T.ink : 'transparent',
                             color: mode === k ? T.paper : T.ink,
                             border: `1px solid ${mode === k ? T.ink : T.ruleStrong}` }}>
              {k[0].toUpperCase()}
            </button>
          ))}
        </div>} />

      {!buckets.length ? (
        <div style={{ ...body(13) }}>Nothing recorded for {mode === 'monthly' ? month.slice(0, 4) : 'this month'}.</div>
      ) : (
        <>
          <div style={{ display: 'flex', alignItems: 'flex-end', gap: mode === 'daily' ? 3 : 10, height: 96 }}>
            {buckets.map((b) => (
              <div key={b.label} style={{ flex: 1, minWidth: 0, height: '100%', display: 'flex',
                                          gap: 2, alignItems: 'flex-end' }}>
                <div title={`in ${fmt(b.inflow, currency)}`}
                     style={{ flex: 1, borderRadius: 3, height: `${Math.max(2, (b.inflow / peak) * 100)}%`,
                              background: b.inflow > 0 ? GOOD : 'rgba(255,255,255,0.07)' }} />
                <div title={`out ${fmt(b.outflow, currency)}`}
                     style={{ flex: 1, borderRadius: 3, height: `${Math.max(2, (b.outflow / peak) * 100)}%`,
                              background: b.outflow > 0 ? SOFT_RED : 'rgba(255,255,255,0.07)' }} />
              </div>
            ))}
          </div>
          <div style={{ display: 'flex', gap: mode === 'daily' ? 3 : 10, marginTop: 7 }}>
            {buckets.map((b, i) => (
              <span key={b.label} style={{ flex: 1, minWidth: 0, textAlign: 'center', fontSize: 9,
                                           color: T.ink, overflow: 'hidden', whiteSpace: 'nowrap' }}>
                {i % showEvery === 0 ? b.label : ''}
              </span>
            ))}
          </div>
          <div style={{ display: 'flex', gap: 14, marginTop: 10, fontFamily: MONO, fontSize: 10,
                        letterSpacing: '0.06em', color: T.ink }}>
            <span><i style={{ display: 'inline-block', width: 8, height: 8, borderRadius: 2,
                              background: GOOD, marginRight: 5 }} />IN</span>
            <span><i style={{ display: 'inline-block', width: 8, height: 8, borderRadius: 2,
                              background: SOFT_RED, marginRight: 5 }} />OUT</span>
          </div>
        </>
      )}
    </div>
  )
}

// ── Due soon ─────────────────────────────────────────────────────────────────

function UpcomingPay({ o, currency }: { o: Overview; currency: string }) {
  if (!o.upcomingPay.length) return null
  const total = o.upcomingPay.reduce((n, b) => n + Math.abs(b.amount), 0)
  const overdue = o.upcomingPay.filter((b) => b.overdue).length
  return (
    // Closed by default. The header keeps the count and the total, which is the
    // part you scroll to this card FOR — and the past-due count in red, because
    // that is the one thing here you might need to act on today.
    <Collapsible
      title="Due within 10 days"
      right={`${o.upcomingPay.length} · ${fmt0(total, currency)}${overdue ? ` · ${overdue} late` : ''}`}
      accent={overdue ? SOFT_RED : undefined}
    >
      {o.upcomingPay.map((b) => (
        <div key={b.tag} style={{ display: 'flex', alignItems: 'center', gap: 11, padding: '10px 0',
                                  borderTop: `1px solid ${T.rule}` }}>
          <span style={{ fontFamily: MONO, fontSize: 11, fontWeight: 700, width: 34, flexShrink: 0,
                         color: b.overdue ? SOFT_RED : T.ink }}>{shortDate(b.date)}</span>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ ...body(14), wordBreak: 'break-word' }}>{b.label}</div>
            <div style={{ fontFamily: MONO, fontSize: 10, letterSpacing: '0.08em', marginTop: 2,
                          color: b.overdue ? SOFT_RED : T.ink }}>
              {b.overdue ? 'PAST DUE' : b.days === 0 ? 'TODAY' : `IN ${b.days}D`}
            </div>
          </div>
          <span style={{ ...body(14), fontWeight: 700, color: b.overdue ? SOFT_RED : T.ink }}>
            {fmt(b.amount, currency)}
          </span>
        </div>
      ))}
    </Collapsible>
  )
}

// ── Category budgets ─────────────────────────────────────────────────────────

function CategoryBudgets({ categories, unsortedSpend, currency }: {
  categories: BudgetCategory[]; unsortedSpend: number; currency: string
}) {
  if (!categories.length) return null
  const budgeted = categories.reduce((n, c) => n + (c.amount || 0), 0)
  const spent = categories.reduce((n, c) => n + (c.spent || 0), 0) + unsortedSpend
  // Named overCount, not over — there is a per-category `over` inside the map
  // below and shadowing it here would be a genuinely nasty read.
  const overCount = categories.filter((c) => c.amount > 0 && c.spent > c.amount).length
  return (
    // Closed by default, with spend-against-budget on the header — the summary
    // figure is the reason you'd open it, so it belongs outside.
    <Collapsible
      title="Categories"
      right={`${fmt0(spent, currency)} of ${fmt0(budgeted, currency)}${overCount ? ` · ${overCount} over` : ''}`}
      accent={overCount ? SOFT_RED : undefined}
    >
      {categories.map((c) => {
        const pct = c.amount > 0 ? Math.min(100, (c.spent / c.amount) * 100) : 0
        const over = c.amount > 0 && c.spent > c.amount
        return (
          <div key={c.id} style={{ padding: '10px 0', borderTop: `1px solid ${T.rule}` }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, ...body(14) }}>
              <span>{c.name}</span>
              <span style={{ color: over ? T.warn : T.ink }}>
                {fmt(c.spent, currency)}
                {c.amount > 0 && <span style={{ color: T.faint }}> / {fmt(c.amount, currency)}</span>}
              </span>
            </div>
            {c.amount > 0 && (
              <div style={{ height: 3, borderRadius: 2, background: T.paperSunk, marginTop: 7 }}>
                <div style={{ width: `${pct}%`, height: '100%', borderRadius: 2,
                              background: over ? T.warn : GOOD }} />
              </div>
            )}
          </div>
        )
      })}
      {unsortedSpend > 0 && (
        // A plain ruled footer, NOT section(). section() is a card now, and this
        // line already sits inside the Collapsible's card — nesting them gives
        // it a second border and a second wash.
        <div style={{ borderTop: `1px solid ${T.rule}`, paddingTop: 10, marginTop: 2,
                      fontFamily: MONO, fontSize: 10, letterSpacing: '0.08em',
                      textTransform: 'uppercase', color: T.ink }}>
          Uncategorised {fmt(unsortedSpend, currency)}
        </div>
      )}
    </Collapsible>
  )
}
