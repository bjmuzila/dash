import type { BudgetOverview as Overview, BudgetCategory, Bank } from '../api'
import { T, label, body, hero, section, SERIF, MONO } from '../theme'

/**
 * The read-only half of the money page — every card and graph from
 * /owner/budget, re-laid-out for a 390px phone.
 *
 * Three rules this file follows, all of them learned the hard way on the
 * desktop version:
 *
 *   1. NOTHING is computed here. Every figure arrives from `overview`, which
 *      the server builds by porting the desktop's memos. A chart that does its
 *      own arithmetic is a second source of truth, and the two drift.
 *   2. Charts are hand-rolled SVG, not a library. Each one is 20-40 lines, and
 *      a charting dependency costs more bundle than the whole page.
 *   3. Dates are STRINGS. `'2026-08-14'.split('-')` — never `new Date(iso)`,
 *      which parses as UTC midnight and renders as the 13th east of Greenwich.
 *      That bug has already been fixed three times in this codebase.
 */

const BANK_LABEL: Record<Bank, string> = { coastal: 'Coastal', truist: 'Truist', secu: 'SECU' }

const fmt = (n: number, currency = 'USD') =>
  new Intl.NumberFormat('en-US', { style: 'currency', currency, maximumFractionDigits: 2 }).format(n || 0)

/** Compact money for axis ends and chips: $1.2k, $840. */
const fmtShort = (n: number, currency = 'USD') => {
  const a = Math.abs(n)
  if (a >= 1000) return `${n < 0 ? '-' : ''}$${(a / 1000).toFixed(a >= 10000 ? 0 : 1)}k`
  return new Intl.NumberFormat('en-US', { style: 'currency', currency, maximumFractionDigits: 0 }).format(n || 0)
}

const shortDate = (iso: string) => { const [, m, d] = iso.split('-'); return `${Number(m)}/${Number(d)}` }
const dayOf = (iso: string) => Number(iso.split('-')[2])

/** Day-of-week for a 'YYYY-MM-DD', computed without letting a Date parse it. */
const dow = (iso: string) => {
  const [y, m, d] = iso.split('-').map(Number)
  return new Date(y, m - 1, d).getDay()
}

// ── Small shared pieces ──────────────────────────────────────────────────────

/** A section heading with an optional right-hand figure. */
function Head({ title, right, tone }: { title: string; right?: string; tone?: string }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 10 }}>
      <span style={label(tone ? { color: tone } : {})}>{title}</span>
      {right && <span style={label({ letterSpacing: '0.06em' })}>{right}</span>}
    </div>
  )
}

/** A label/value pair in the stat strip. */
function Stat({ k, v, tone, sub }: { k: string; v: string; tone?: string; sub?: string }) {
  return (
    <div style={{ minWidth: 0 }}>
      <div style={label({ letterSpacing: '0.1em' })}>{k}</div>
      <div style={{ fontFamily: SERIF, fontSize: 20, lineHeight: 1.15, marginTop: 4,
                    color: tone || T.ink, whiteSpace: 'nowrap' }}>{v}</div>
      {sub && <div style={label({ marginTop: 3, letterSpacing: '0.06em', fontSize: 9 })}>{sub}</div>}
    </div>
  )
}

// ── The page ─────────────────────────────────────────────────────────────────

export default function BudgetOverview({ o, categories, unsortedSpend, balances, currency, month }: {
  o: Overview
  categories: BudgetCategory[]
  unsortedSpend: number
  balances: Record<Bank, number>
  currency: string
  month: string
}) {
  const banks: Bank[] = ['coastal', 'truist', 'secu']

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 26 }}>
      {/* Hero — cash on hand, split by bank. */}
      <div>
        <div style={{ ...hero(46), color: o.allBanks < 0 ? T.bad : T.ink }}>{fmt(o.allBanks, currency)}</div>
        <div style={{ display: 'flex', gap: 18, marginTop: 12, flexWrap: 'wrap' }}>
          {banks.map((b) => (
            <div key={b}>
              <div style={label({ letterSpacing: '0.1em' })}>{BANK_LABEL[b]}</div>
              <div style={{ ...body(14), marginTop: 3, color: (balances[b] || 0) < 0 ? T.bad : T.inkSoft }}>
                {fmt(balances[b] || 0, currency)}
              </div>
            </div>
          ))}
        </div>
      </div>

      <SafeToSpend o={o} currency={currency} />
      <StatStrip o={o} currency={currency} />
      <SpendPace o={o} currency={currency} />
      <WeekPulse o={o} currency={currency} />
      <CategoryDonut o={o} currency={currency} />
      <BalanceCheck o={o} currency={currency} />
      <CashFlow o={o} currency={currency} />
      <MonthGrid o={o} currency={currency} month={month} />
      <Projection o={o} currency={currency} />
      <UpcomingPay o={o} currency={currency} />
      <CategoryBudgets categories={categories} unsortedSpend={unsortedSpend} currency={currency} />
    </div>
  )
}

// ── Safe to spend ────────────────────────────────────────────────────────────

/**
 * The one number worth opening the app for: what's left after every bill still
 * scheduled this month is taken out. Not the bank balance — that lies right up
 * until rent clears.
 */
function SafeToSpend({ o, currency }: { o: Overview; currency: string }) {
  const tight = o.safe < 0
  return (
    <div style={section()}>
      <Head title="Safe to spend" right={`${o.daysLeft} ${o.daysLeft === 1 ? 'day' : 'days'} left`} />
      <div style={{ ...hero(38), marginTop: 10, color: tight ? T.bad : T.ink }}>{fmt(o.safe, currency)}</div>
      <div style={{ ...body(13), color: T.muted, marginTop: 8 }}>
        {tight
          ? `Short by ${fmt(Math.abs(o.safe), currency)} against the bills still to come.`
          : <>About <span style={{ color: T.ink }}>{fmt(o.safePerDay, currency)}</span> a day until month end.</>}
      </div>
      <div style={{ display: 'flex', gap: 16, marginTop: 12, flexWrap: 'wrap' }}>
        <Stat k="Cash" v={fmt(o.allBanks, currency)} />
        <Stat k="Bills left" v={fmt(o.billsLeft, currency)} tone={o.billsLeft > 0 ? T.warn : T.ink} />
      </div>
    </div>
  )
}

// ── Stat strip ───────────────────────────────────────────────────────────────

function StatStrip({ o, currency }: { o: Overview; currency: string }) {
  const wkDelta = o.wkOut - o.prevWkOut
  const paceDelta = o.spentMtd - o.paceNow
  const inflow = o.cashflow.reduce((n, b) => n + b.inflow, 0)
  const outflow = o.cashflow.reduce((n, b) => n + b.outflow, 0)

  return (
    <div style={{ ...section(), display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '16px 10px', paddingTop: 16 }}>
      <Stat k="In" v={fmtShort(inflow, currency)} tone={T.good} />
      <Stat k="Out" v={fmtShort(outflow, currency)} />
      <Stat k="Net" v={fmtShort(inflow - outflow, currency)} tone={inflow - outflow < 0 ? T.warn : T.ink} />
      <Stat k="Spent MTD" v={fmtShort(o.spentMtd, currency)}
            sub={`of ${fmtShort(o.budgetTotal, currency)} budget`} />
      <Stat k="Vs pace" v={`${paceDelta > 0 ? '+' : ''}${fmtShort(paceDelta, currency)}`}
            tone={paceDelta > 0 ? T.warn : T.good} sub={paceDelta > 0 ? 'ahead of budget' : 'under budget'} />
      <Stat k="7-day" v={fmtShort(o.wkOut, currency)}
            tone={wkDelta > 0 ? T.warn : T.good}
            sub={o.prevWkOut > 0 ? `${wkDelta > 0 ? '+' : ''}${fmtShort(wkDelta, currency)} vs prior` : 'no prior week'} />
    </div>
  )
}

// ── Spend pace ───────────────────────────────────────────────────────────────

/**
 * Cumulative spend against a straight-line budget. The shape is the point: if
 * the solid line sits above the dashed one you are ahead of pace, and the gap
 * is how much.
 */
function SpendPace({ o, currency }: { o: Overview; currency: string }) {
  const W = 320, H = 92
  const n = o.cum.length
  if (n < 2) return null
  const peak = Math.max(o.budgetTotal, ...o.cum, 1)
  const x = (i: number) => (i / (n - 1)) * W
  const y = (v: number) => H - (v / peak) * H

  // Only draw the line up to today — a forward-projected flat line reads as
  // "spending stopped", which is the opposite of true.
  const upto = Math.max(1, Math.min(o.todayDay, n))
  const path = o.cum.slice(0, upto).map((v, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(' ')
  const area = `${path} L${x(upto - 1).toFixed(1)},${H} L0,${H} Z`
  const over = o.spentMtd > o.paceNow
  const stroke = over ? T.warn : T.accent

  return (
    <div style={section()}>
      <Head title="Spend pace" right={`${fmt(o.spentMtd, currency)} of ${fmt(o.budgetTotal, currency)}`} />
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" height={H} preserveAspectRatio="none"
           style={{ marginTop: 12, display: 'block', overflow: 'visible' }} aria-hidden>
        <defs>
          <linearGradient id="paceFill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={stroke} stopOpacity="0.22" />
            <stop offset="100%" stopColor={stroke} stopOpacity="0" />
          </linearGradient>
        </defs>
        {/* Straight-line budget: where you'd be if you spent evenly. */}
        <line x1="0" y1={y(0)} x2={W} y2={y(o.budgetTotal)}
              stroke={T.ruleStrong} strokeWidth="1" strokeDasharray="3 4" />
        <path d={area} fill="url(#paceFill)" />
        <path d={path} fill="none" stroke={stroke} strokeWidth="1.75"
              strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
        {o.todayDay > 0 && (
          <circle cx={x(upto - 1)} cy={y(o.cum[upto - 1])} r="3" fill={stroke} />
        )}
      </svg>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 6 }}>
        <span style={label({ letterSpacing: '0.06em' })}>Day 1</span>
        <span style={label({ letterSpacing: '0.06em', color: over ? T.warn : T.good })}>
          {over ? 'ahead of pace' : 'on pace'}
        </span>
        <span style={label({ letterSpacing: '0.06em' })}>Day {o.daysInMonth}</span>
      </div>
    </div>
  )
}

// ── Week pulse ───────────────────────────────────────────────────────────────

function WeekPulse({ o, currency }: { o: Overview; currency: string }) {
  const peak = Math.max(...o.week.map((d) => d.out), 1)
  const delta = o.wkOut - o.prevWkOut
  return (
    <div style={section()}>
      <Head title="Last 7 days" right={fmt(o.wkOut, currency)} />
      <div style={{ display: 'flex', alignItems: 'flex-end', gap: 6, height: 62, marginTop: 12 }}>
        {o.week.map((d) => {
          const h = d.out > 0 ? Math.max(3, (d.out / peak) * 62) : 2
          return (
            <div key={d.date} style={{ flex: 1, display: 'flex', flexDirection: 'column',
                                       alignItems: 'center', justifyContent: 'flex-end', height: '100%' }}>
              <div title={`${shortDate(d.date)} · ${fmt(d.out, currency)}`}
                   style={{ width: '100%', height: h, borderRadius: 2,
                            background: d.out > 0 ? T.accent : T.paperSunk }} />
            </div>
          )
        })}
      </div>
      <div style={{ display: 'flex', gap: 6, marginTop: 6 }}>
        {o.week.map((d) => (
          <span key={d.date} style={{ ...label({ letterSpacing: 0, fontSize: 9 }), flex: 1, textAlign: 'center' }}>
            {'SMTWTFS'[dow(d.date)]}
          </span>
        ))}
      </div>
      {o.prevWkOut > 0 && (
        <div style={{ ...body(13), color: T.muted, marginTop: 10 }}>
          {delta === 0 ? 'Level with the week before.' : (
            <>
              <span style={{ color: delta > 0 ? T.warn : T.good }}>
                {fmt(Math.abs(delta), currency)} {delta > 0 ? 'more' : 'less'}
              </span> than the week before.
            </>
          )}
        </div>
      )}
    </div>
  )
}

// ── Category donut ───────────────────────────────────────────────────────────

/**
 * Where the money went. Drawn as a stroked circle with dash offsets rather than
 * arc paths — same picture, no trigonometry, and no seams at the joins.
 */
function CategoryDonut({ o, currency }: { o: Overview; currency: string }) {
  if (!o.slices.length) return null
  const total = o.slices.reduce((n, s) => n + s.value, 0)
  if (total <= 0) return null

  const R = 46, C = 2 * Math.PI * R
  let acc = 0

  return (
    <div style={section()}>
      <Head title="Where it went" right={fmt(total, currency)} />
      <div style={{ display: 'flex', alignItems: 'center', gap: 18, marginTop: 12 }}>
        <svg width="112" height="112" viewBox="0 0 112 112" style={{ flexShrink: 0 }} aria-hidden>
          <g transform="rotate(-90 56 56)">
            <circle cx="56" cy="56" r={R} fill="none" stroke={T.paperSunk} strokeWidth="14" />
            {o.slices.map((s) => {
              const len = (s.value / total) * C
              const el = (
                <circle key={s.label} cx="56" cy="56" r={R} fill="none" stroke={s.colour} strokeWidth="14"
                        strokeDasharray={`${Math.max(0, len - 1.5)} ${C}`}
                        strokeDashoffset={-acc} />
              )
              acc += len
              return el
            })}
          </g>
        </svg>
        <div style={{ flex: 1, minWidth: 0 }}>
          {o.slices.slice(0, 5).map((s) => (
            <div key={s.label} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '4px 0' }}>
              <span style={{ width: 8, height: 8, borderRadius: 2, background: s.colour, flexShrink: 0 }} />
              <span style={{ ...body(13), flex: 1, minWidth: 0, overflow: 'hidden',
                             textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{s.label}</span>
              <span style={{ ...body(13), color: T.inkSoft }}>{Math.round((s.value / total) * 100)}%</span>
            </div>
          ))}
          {o.slices.length > 5 && (
            <div style={label({ marginTop: 4, letterSpacing: '0.06em' })}>+{o.slices.length - 5} more</div>
          )}
        </div>
      </div>
    </div>
  )
}

// ── Balance check ────────────────────────────────────────────────────────────

/**
 * Does the bank agree with the register? Only CLEARED money is compared — a
 * scheduled bill hasn't left the account, so counting it would show a
 * permanent phantom shortfall. Drift below zero means money left that nobody
 * wrote down.
 */
function BalanceCheck({ o, currency }: { o: Overview; currency: string }) {
  const r = o.reconcile
  if (!r) return null
  const off = Math.abs(r.drift) >= 1
  return (
    <div style={section()}>
      <Head title="Balance check" right={`${shortDate(r.from)} → ${shortDate(r.to)}`} />
      <div style={{ ...hero(30), marginTop: 10, color: off ? T.warn : T.good }}>
        {r.drift > 0 ? '+' : ''}{fmt(r.drift, currency)}
      </div>
      <div style={{ ...body(13), color: T.muted, marginTop: 6 }}>
        {off
          ? r.drift < 0
            ? 'The bank is lower than the register — something spent is not written down.'
            : 'The bank is higher than the register — money came in that is not logged.'
          : 'The bank and the register agree.'}
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '14px 10px', marginTop: 14 }}>
        <Stat k="Started at" v={fmt(r.prevBalance, currency)} />
        <Stat k={`Over ${r.days} ${r.days === 1 ? 'day' : 'days'}`} v={`+${fmtShort(r.moneyIn, currency)} / −${fmtShort(r.moneyOut, currency)}`} />
        <Stat k="Expected" v={fmt(r.expected, currency)} />
        <Stat k="Actual" v={fmt(r.actual, currency)} tone={off ? T.warn : T.ink} />
      </div>
      {r.uncleared > 0 && (
        <div style={label({ marginTop: 12, letterSpacing: '0.06em' })}>
          {fmt(r.uncleared, currency)} scheduled but not cleared — excluded on purpose
        </div>
      )}
    </div>
  )
}

// ── Cash flow ────────────────────────────────────────────────────────────────

function CashFlow({ o, currency }: { o: Overview; currency: string }) {
  if (!o.cashflow.length) return null
  const peak = Math.max(1, ...o.cashflow.map((b) => Math.max(b.inflow, b.outflow)))
  return (
    <div style={section()}>
      <Head title="Cash flow by week" />
      <div style={{ display: 'flex', gap: 12, marginTop: 12, alignItems: 'flex-end', height: 76 }}>
        {o.cashflow.map((b) => (
          <div key={b.label} style={{ flex: 1, height: '100%', display: 'flex', flexDirection: 'column',
                                      justifyContent: 'flex-end' }}>
            <div style={{ display: 'flex', gap: 3, alignItems: 'flex-end', height: 62 }}>
              {/* A zero week keeps its 2px stub so the bars stay paired, but in
                  the empty-track grey — coloured, it reads as a small amount. */}
              <div title={`in ${fmt(b.inflow, currency)}`}
                   style={{ flex: 1, height: Math.max(2, (b.inflow / peak) * 62),
                            background: b.inflow > 0 ? T.good : T.paperSunk, borderRadius: 2 }} />
              <div title={`out ${fmt(b.outflow, currency)}`}
                   style={{ flex: 1, height: Math.max(2, (b.outflow / peak) * 62),
                            background: b.outflow > 0 ? T.warn : T.paperSunk, borderRadius: 2 }} />
            </div>
            <span style={{ ...label({ letterSpacing: 0, fontSize: 9 }), textAlign: 'center', marginTop: 6 }}>
              {b.label}
            </span>
          </div>
        ))}
      </div>
      <div style={{ display: 'flex', gap: 14, marginTop: 10 }}>
        <span style={label({ letterSpacing: '0.06em' })}>
          <span style={{ color: T.good }}>■</span> in
        </span>
        <span style={label({ letterSpacing: '0.06em' })}>
          <span style={{ color: T.warn }}>■</span> out
        </span>
      </div>
    </div>
  )
}

// ── Month grid ───────────────────────────────────────────────────────────────

/**
 * A calendar of the month where each day is shaded by how much left the
 * account. Answers "which days do we bleed?" faster than any list.
 */
function MonthGrid({ o, currency, month }: { o: Overview; currency: string; month: string }) {
  const byDay = new Map(o.days.map((d) => [dayOf(d.date), d]))
  const peak = Math.max(1, ...o.days.map((d) => d.out))
  const [y, m] = month.split('-').map(Number)
  const lead = new Date(y, m - 1, 1).getDay() // blanks before the 1st

  const cells: (number | null)[] = [
    ...Array.from({ length: lead }, () => null),
    ...Array.from({ length: o.daysInMonth }, (_, i) => i + 1),
  ]

  return (
    <div style={section()}>
      <Head title="Month at a glance" />
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 4, marginTop: 12 }}>
        {['S', 'M', 'T', 'W', 'T', 'F', 'S'].map((d, i) => (
          <span key={i} style={{ ...label({ letterSpacing: 0, fontSize: 9 }), textAlign: 'center' }}>{d}</span>
        ))}
        {cells.map((day, i) => {
          if (day === null) return <span key={`b${i}`} />
          const g = byDay.get(day)
          const heat = g && g.out > 0 ? 0.12 + (g.out / peak) * 0.55 : 0
          const isToday = day === o.todayDay
          return (
            <div key={day}
                 title={g ? `${day}: ${fmt(g.net, currency)}` : String(day)}
                 style={{
                   aspectRatio: '1', borderRadius: 3, display: 'grid', placeItems: 'center',
                   background: heat ? `rgba(251,133,1,${heat.toFixed(2)})` : T.paperSunk,
                   border: isToday ? `1px solid ${T.ink}` : '1px solid transparent',
                   fontFamily: MONO, fontSize: 10,
                   color: heat > 0.4 ? T.ink : T.muted,
                 }}>
              {day}
            </div>
          )
        })}
      </div>
    </div>
  )
}

// ── Projection ───────────────────────────────────────────────────────────────

/** The running balance through the month, bills included. The zero line is
 *  drawn only when the balance actually crosses it — a permanent axis at the
 *  bottom of every healthy month is just noise. */
function Projection({ o, currency }: { o: Overview; currency: string }) {
  const pts = o.series
  if (pts.length < 2) return null
  const W = 320, H = 96
  const vals = pts.map((p) => p.balance)
  const lo = Math.min(0, ...vals), hi = Math.max(...vals, 1)
  const span = hi - lo || 1
  const x = (i: number) => (i / (pts.length - 1)) * W
  const y = (v: number) => H - ((v - lo) / span) * H
  const path = pts.map((p, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(p.balance).toFixed(1)}`).join(' ')
  const dips = lo < 0
  const end = vals[vals.length - 1]

  return (
    <div style={section()}>
      <Head title="Projected balance" right={fmt(end, currency)} />
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" height={H} preserveAspectRatio="none"
           style={{ marginTop: 12, display: 'block', overflow: 'visible' }} aria-hidden>
        {dips && <line x1="0" y1={y(0)} x2={W} y2={y(0)} stroke={T.bad} strokeWidth="1" strokeDasharray="3 4" />}
        <path d={`${path} L${W},${H} L0,${H} Z`} fill={T.accent} fillOpacity="0.08" />
        <path d={path} fill="none" stroke={end < 0 ? T.bad : T.accent} strokeWidth="1.75"
              strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
      </svg>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 6 }}>
        <span style={label({ letterSpacing: '0.06em' })}>{shortDate(pts[0].date)}</span>
        {dips && <span style={label({ letterSpacing: '0.06em', color: T.bad })}>dips below zero</span>}
        <span style={label({ letterSpacing: '0.06em' })}>{shortDate(pts[pts.length - 1].date)}</span>
      </div>
    </div>
  )
}

// ── Upcoming pay ─────────────────────────────────────────────────────────────

function UpcomingPay({ o, currency }: { o: Overview; currency: string }) {
  if (!o.upcomingPay.length) return null
  return (
    <div style={section()}>
      <Head title="Due within 10 days" right={fmt(o.upcomingPay.reduce((n, b) => n + Math.abs(b.amount), 0), currency)} />
      <div>
        {o.upcomingPay.map((b) => (
          <div key={b.tag} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '11px 0',
                                    borderTop: `1px solid ${T.rule}` }}>
            <span style={label({ width: 34, flexShrink: 0, color: b.overdue ? T.warn : T.muted })}>
              {shortDate(b.date)}
            </span>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ ...body(14), wordBreak: 'break-word' }}>{b.label}</div>
              <div style={label({ marginTop: 2, letterSpacing: '0.1em' })}>
                {BANK_LABEL[b.bank]} · {b.overdue ? 'past due' : b.days === 0 ? 'today' : `in ${b.days}d`}
              </div>
            </div>
            <span style={{ ...body(14), color: b.overdue ? T.warn : T.inkSoft }}>{fmt(b.amount, currency)}</span>
          </div>
        ))}
      </div>
    </div>
  )
}

// ── Category budgets ─────────────────────────────────────────────────────────

function CategoryBudgets({ categories, unsortedSpend, currency }: {
  categories: BudgetCategory[]; unsortedSpend: number; currency: string
}) {
  if (!categories.length) return null
  return (
    <div style={section()}>
      <Head title="Categories" />
      <div style={{ marginTop: 4 }}>
        {categories.map((c) => {
          const pct = c.amount > 0 ? Math.min(100, (c.spent / c.amount) * 100) : 0
          const over = c.amount > 0 && c.spent > c.amount
          return (
            <div key={c.id} style={{ padding: '11px 0', borderTop: `1px solid ${T.rule}` }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, ...body(14) }}>
                <span>{c.name}</span>
                <span style={{ color: over ? T.warn : T.inkSoft }}>
                  {fmt(c.spent, currency)}
                  {c.amount > 0 && <span style={{ color: T.faint }}> / {fmt(c.amount, currency)}</span>}
                </span>
              </div>
              {c.amount > 0 && (
                <div style={{ height: 2, background: T.paperSunk, marginTop: 7 }}>
                  <div style={{ width: `${pct}%`, height: '100%', background: over ? T.warn : T.ink }} />
                </div>
              )}
            </div>
          )
        })}
        {unsortedSpend > 0 && (
          <div style={label({ marginTop: 11, letterSpacing: '0.08em' })}>
            Uncategorised {fmt(unsortedSpend, currency)}
          </div>
        )}
      </div>
    </div>
  )
}
