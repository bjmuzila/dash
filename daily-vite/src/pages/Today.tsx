import { useState, useEffect, type FormEvent, type CSSProperties } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../auth'
import {
  useToday, useCreateTask, useRoutines, useCreateNote, useSettings, useWeather,
} from '../hooks'
import { ApiError, type Task, type TodayPayload, type Routine } from '../api'
import TaskRow from '../components/TaskRow'
import CalendarCard from '../components/CalendarCard'
import {
  T, sectionTitle, label, body, hero, display, section, tile, row, input, button, MONO,
} from '../theme'

/**
 * Today — "The Briefing", as a dashboard.
 *
 * Reading order, and it is deliberate:
 *
 *   strip     what time is it, what's it like out
 *   markets   what is going to move today
 *   calendar  the day, full width — the part you cannot change
 *   todo      | habits    what you have to do  | what you keep doing
 *   journal   | lists     what you're thinking | what the house needs
 *   money     | bills     what you have        | what's leaving
 *
 * Each pair is one question answered from two sides, which is why they sit
 * together rather than in one long column of unrelated cards.
 *
 * The markets line sits high, immediately under the clock, because it is the
 * only thing on this screen with a deadline attached to it — an 8:30 print has
 * already happened by the time you scroll past the grocery list.
 *
 * On a phone it is one column in that same order. The pairing is a width
 * affordance, not a different information architecture.
 */
export default function Today() {
  const { user } = useAuth()
  const { data, isLoading, error, refetch } = useToday()
  const wide = useWide()

  if (isLoading) return <Muted>Loading…</Muted>
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
  if (!data || !user) return null

  const { today, open, people } = data
  const me = user.id
  const rows = (list: Task[]) =>
    list.map((t) => <TaskRow key={t.id} task={t} today={today} me={me} people={people} />)

  const stack: CSSProperties = { display: 'flex', flexDirection: 'column', gap: 14, minWidth: 0 }
  // One pair of cards, side by side above 860px and stacked below.
  const pair: CSSProperties = {
    display: 'grid',
    gridTemplateColumns: wide ? '1fr 1fr' : '1fr',
    gap: 14,
    alignItems: 'start',
  }

  return (
    <div style={stack}>

      <StatStrip tz={data.tz} compact={!wide} />

      <MarketsTeaser markets={data.markets} />

      {/* Full width. The calendar is the frame the rest of the page is read
          against, and halving it to sit beside something else made the
          seven-day strip the narrowest thing on the screen. */}
      <CalendarCard status={data.calendar} date={today} />

      <div style={pair}>
        <div style={section()}>
          <Head left="Todo" right={open.length ? String(open.length) : undefined} />
          {open.length ? <div>{rows(open)}</div> : <Muted>Nothing open. Enjoy it.</Muted>}
          {/* The add box sits at the BOTTOM of the list it adds to. You read the
              list, find the thing isn't on it, and the box is already at the end
              of it under your thumb. */}
          <div style={{ marginTop: 14, paddingTop: 14, borderTop: `1px solid ${T.rule}` }}>
            <QuickAdd />
          </div>
        </div>
        <Habits compact={!wide} />
      </div>

      <div style={pair}>
        <Journal />
        <ListsCard lists={data.lists} />
      </div>

      <div style={pair}>
        <MoneyCard money={data.money} />
        <BillsCard money={data.money} />
      </div>
    </div>
  )
}

// ── Layout ───────────────────────────────────────────────────────────────────

/**
 * True once there is room for two readable columns.
 *
 * matchMedia rather than a CSS breakpoint because this app is inline-styled
 * from theme.ts — there is no stylesheet to hang a media query on, and adding
 * one for a single layout switch would put half the layout in index.css where
 * nobody would look for it.
 */
function useWide(query = '(min-width: 860px)') {
  const [wide, setWide] = useState(() => window.matchMedia(query).matches)
  useEffect(() => {
    const mq = window.matchMedia(query)
    const on = () => setWide(mq.matches)
    mq.addEventListener('change', on)
    // Re-read on mount: between the initial useState and this effect the window
    // may already have changed (rotation during load).
    on()
    return () => mq.removeEventListener('change', on)
  }, [query])
  return wide
}

// ── Markets ──────────────────────────────────────────────────────────────────

/**
 * One line: what is on the economic calendar today, and who reports.
 *
 * Deliberately a teaser and not a table. The Markets tab is one tap away and
 * holds the whole week; this exists so that on the screen you open first thing,
 * "FOMC at 2pm" is not something you have to go and look for. Two facts and a
 * chevron — anything more and it stops being glanceable, which is the only
 * reason it is allowed above the calendar.
 *
 * Silent when the payload is missing entirely: a markets line that says nothing
 * every morning trains you to stop reading it, and the Markets tab still says
 * what happened.
 */
function MarketsTeaser({ markets }: { markets: TodayPayload['markets'] }) {
  if (!markets) return null

  const { highImpactToday, earningsToday, earningsCount } = markets
  const names = earningsToday.slice(0, 3).join(', ')
  const more = Math.max(0, (earningsCount || earningsToday.length) - 3)

  const bits: string[] = []
  if (highImpactToday > 0) {
    bits.push(`${highImpactToday} high-impact event${highImpactToday === 1 ? '' : 's'}`)
  }
  if (names) bits.push(more > 0 ? `${names} +${more} more` : names)

  // A stale or unreachable feed is stated, never hidden. A quiet-looking day
  // that is actually a broken feed is the exact failure this line exists to
  // prevent — it went unnoticed for six weeks on the trading dashboard.
  const warning = markets.warning || markets.note || null

  return (
    <Link to="/markets" style={{
      ...tile({ display: 'flex', alignItems: 'center', gap: 10 }),
      textDecoration: 'none', color: 'inherit',
    }}>
      <span style={label({ color: T.accent, flexShrink: 0 })}>Markets</span>
      <span style={{
        ...body(13), flex: 1, minWidth: 0,
        color: warning ? T.warn : T.ink,
        // One line, ellipsed. This tile is a headline; the full list is what
        // the tab it links to is for.
        whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
      }}>
        {warning ?? (bits.length ? bits.join(' · ') : 'Quiet on both calendars today')}
      </span>
      <span style={label({ flexShrink: 0 })}>›</span>
    </Link>
  )
}

// ── Status strip ─────────────────────────────────────────────────────────────

/**
 * Time and weather, side by side at every width.
 *
 * Two tiles, not three. "Month elapsed" was a progress bar for the passage of
 * time — a fact the date already states — and on a phone it pushed the calendar
 * a third of a screen down.
 *
 * Side by side on a 390px phone too: stacked, these two were 200px of chrome
 * above the first thing you actually came to read.
 */
function StatStrip({ tz, compact }: { tz: string; compact: boolean }) {
  const { data: settings } = useSettings()
  const zip = settings?.settings.weatherZip || ''

  return (
    <div style={{
      display: 'grid',
      // One column when there is no weather to put beside the clock — a half
      // width tile with dead space next to it looks like something failed.
      gridTemplateColumns: zip ? '1fr 1fr' : '1fr',
      gap: compact ? 10 : 14,
    }}>
      <ClockTile tz={tz} compact={compact} />
      {zip && <WeatherTile zip={zip} compact={compact} />}
    </div>
  )
}

function ClockTile({ tz, compact }: { tz: string; compact: boolean }) {
  const [now, setNow] = useState(() => new Date())
  useEffect(() => {
    // Aligned to the top of the minute, not a blind 60s interval — otherwise a
    // clock mounted at :59 shows the wrong minute for 59 seconds.
    let timer: number
    const tick = () => {
      setNow(new Date())
      timer = window.setTimeout(tick, 60_000 - (Date.now() % 60_000))
    }
    timer = window.setTimeout(tick, 60_000 - (Date.now() % 60_000))
    return () => window.clearTimeout(timer)
  }, [])

  const [clock, meridiem] = now.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }).split(' ')

  return (
    <div style={tile({ padding: compact ? '13px 13px' : '15px 16px', minWidth: 0 })}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 6 }}>
        {/* 30px, not 38, once these are half a phone wide: "10:30" plus the
            meridiem overruns a 160px tile at the larger size and wraps. */}
        <span style={hero(compact ? 30 : 38)}>{clock}</span>
        {meridiem && <span style={label()}>{meridiem}</span>}
      </div>
      <div style={label({ marginTop: 8, letterSpacing: compact ? '0.06em' : '0.14em' })}>
        {now.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })}
        {/* The city is the first thing to go when the tile is half width — the
            time is the point, and the timezone is implied by the phone. */}
        {!compact && tz ? ` · ${tz.split('/').pop()!.replace('_', ' ')}` : ''}
      </div>
    </div>
  )
}

/**
 * Current conditions for the ZIP saved in Settings.
 *
 * Only mounted when a ZIP exists — StatStrip decides that, so an unset ZIP
 * collapses the whole strip to one column rather than leaving a hole. An empty
 * weather tile is worse than no tile: a permanent gap on the home screen
 * advertising a setting you chose not to fill in.
 */
function WeatherTile({ zip, compact }: { zip: string; compact: boolean }) {
  const { data, error, isLoading } = useWeather(zip)

  return (
    <div style={tile({ padding: compact ? '13px 13px' : '15px 16px', minWidth: 0 })}>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
        <span style={label()}>Weather</span>
        {/* "Wendell, NC" does not fit beside the word Weather at half a phone
            width, and it is the same place every day — it moves under the
            temperature there. */}
        {data && !compact && <span style={label()}>{data.place}</span>}
      </div>
      {isLoading && <div style={{ ...body(13), color: T.faint, marginTop: 9 }}>Loading…</div>}
      {/* Named, not swallowed. A tile that silently shows nothing is
          indistinguishable from a mild day. */}
      {error && (
        <div style={{ ...body(13), color: T.warn, marginTop: 9 }}>
          {error instanceof ApiError && error.message ? error.message : 'Weather unavailable.'}
        </div>
      )}
      {data && (
        <>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 6, marginTop: 7 }}>
            <span style={hero(compact ? 30 : 34)}>{data.tempF}°</span>
            <span style={label()}>F</span>
          </div>
          <div style={{ ...body(compact ? 12 : 13), marginTop: 6, wordBreak: 'break-word' }}>
            {compact ? `${data.condition} · ${data.place}` : data.condition}
          </div>
        </>
      )}
    </div>
  )
}

// ── Habits ───────────────────────────────────────────────────────────────────

const DOW = ['M', 'T', 'W', 'T', 'F', 'S', 'S']

/**
 * This week as a grid, one row per routine.
 *
 * Built by LOOKING UP each day in `routine.history` rather than slicing the
 * last seven entries: the array's length and direction are the server's
 * business, and a slice silently shifts the whole grid by a day if either
 * changes.
 */
function Habits({ compact }: { compact: boolean }) {
  const { data, isLoading } = useRoutines()
  // 390px, minus the shell's padding and the card's, leaves ~334px. Seven day
  // columns at the desktop size plus a habit name do not fit in that, and the
  // table — auto-layout — refused to shrink and pushed itself out of the card
  // instead of wrapping. The grid gets narrower on a phone, not the card wider.
  const cell = compact ? 26 : 30
  const mark = compact ? 18 : 21
  const items: Routine[] = (data?.blocks ?? []).flatMap((b) => b.items)

  // Monday-first, matching the calendar strip. Sunday walks back six days.
  const now = new Date()
  const monday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - ((now.getDay() + 6) % 7))
  const week = Array.from({ length: 7 }, (_, i) => {
    const d = new Date(monday.getFullYear(), monday.getMonth(), monday.getDate() + i)
    return {
      key: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`,
      future: d.getDate() !== now.getDate() && d.getTime() > now.getTime(),
    }
  })
  const best = items.reduce((n, r) => Math.max(n, r.streak), 0)

  return (
    <Link to="/routines" style={{ ...section(), textDecoration: 'none', color: 'inherit', display: 'block' }}>
      <Head left="Habits" right="Open ›" />
      {isLoading && <Muted>Loading…</Muted>}
      {!isLoading && items.length === 0 && <Muted>No habits yet. Add some under More.</Muted>}

      {items.length > 0 && (
        <table style={{
          width: '100%', borderCollapse: 'collapse', marginTop: 10,
          // FIXED, not auto. Auto layout sizes columns to their content, so one
          // long habit title widened the whole table past the card. Fixed gives
          // the day columns exactly what they asked for and hands the rest to
          // the name, which then wraps instead of overflowing.
          tableLayout: 'fixed',
        }}>
          <thead>
            <tr>
              <th style={{ ...label(), textAlign: 'left', padding: '0 0 8px', fontWeight: 500 }}>Habit</th>
              {week.map((d, i) => (
                <th key={d.key} style={{ ...label(), padding: '0 0 8px', width: cell, fontWeight: 500 }}>
                  {DOW[i]}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {items.map((r) => {
              const byDay = new Map(r.history.map((h) => [h.day, h.done]))
              return (
                <tr key={r.id}>
                  <td style={{
                    ...body(compact ? 13 : 14), padding: '7px 8px 7px 0',
                    borderTop: `1px solid ${T.rule}`,
                    // A habit called "Stretch + mobility" has to wrap somewhere;
                    // without this it wraps nowhere and takes the table with it.
                    overflowWrap: 'anywhere',
                  }}>
                    {r.title}
                  </td>
                  {week.map((d) => (
                    <td key={d.key} style={{ padding: '7px 0', borderTop: `1px solid ${T.rule}`, textAlign: 'center' }}>
                      <Mark size={mark}
                            state={d.future ? 'future' : byDay.get(d.key) ? 'done' : 'missed'} />
                    </td>
                  ))}
                </tr>
              )
            })}
          </tbody>
        </table>
      )}

      {best > 0 && (
        <div style={label({
          display: 'inline-block', marginTop: 12, padding: '5px 10px', borderRadius: 999,
          background: 'rgba(142,202,230,0.14)', border: `1px solid ${T.accentSoft}`, color: T.accent,
        })}>
          {best} day streak
        </div>
      )}
    </Link>
  )
}

/**
 * A day in the grid. Three states, and the third one matters: a day that hasn't
 * happened yet is NOT a missed day, and drawing it as one turns every Monday
 * into a wall of failure.
 */
function Mark({ state, size }: { state: 'done' | 'missed' | 'future'; size: number }) {
  const base: CSSProperties = {
    display: 'inline-grid', placeItems: 'center', width: size, height: size,
    borderRadius: size > 19 ? 6 : 5, fontSize: Math.round(size * 0.52), lineHeight: 1,
  }
  if (state === 'done') return <span style={{ ...base, background: T.ink, color: T.paper }}>✓</span>
  if (state === 'future') return <span style={{ ...base, border: `1px dashed ${T.rule}` }} />
  return <span style={{ ...base, border: `1px solid ${T.rule}`, color: T.faint }}>✕</span>
}

// ── Journal ──────────────────────────────────────────────────────────────────

/**
 * Quick capture only. The archive is the Journal screen — this card exists so a
 * thought at 7am costs one tap from the home screen, not a navigation.
 */
function Journal() {
  const create = useCreateNote()
  const [text, setText] = useState('')
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    const t = text.trim()
    if (!t || create.isPending) return
    setError(null)
    try {
      await create.mutateAsync({ body: t, kind: 'journal' })
      setText('')
      setSaved(true)
      window.setTimeout(() => setSaved(false), 2400)
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not save that.')
    }
  }

  return (
    <form onSubmit={submit} style={section()}>
      <Head left="Journal" right={saved ? 'Saved ✓' : undefined} />
      <div style={label({ marginTop: 6, letterSpacing: '0.06em' })}>Quick capture</div>
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder="What's on your mind today?"
        rows={3}
        style={{ ...input(), marginTop: 10, minHeight: 96, resize: 'vertical', lineHeight: 1.5 }}
      />
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, marginTop: 10 }}>
        <Link to="/journal" style={{ ...label({ color: T.accent }), textDecoration: 'none' }}>
          All entries ›
        </Link>
        <button type="submit" disabled={!text.trim() || create.isPending}
                style={button(text.trim() ? 'primary' : 'ghost')}>
          {create.isPending ? 'Saving…' : 'Save'}
        </button>
      </div>
      {error && <div style={label({ color: T.bad, marginTop: 9, letterSpacing: '0.06em' })}>{error}</div>}
    </form>
  )
}

// ── Money, bills, lists ──────────────────────────────────────────────────────

const fmtMoney = (n: number, currency = 'USD') => new Intl.NumberFormat('en-US', {
  style: 'currency', currency: currency || 'USD', maximumFractionDigits: 0,
}).format(n || 0)

const shortDate = (iso: string) => { const [, m, d] = iso.split('-'); return `${Number(m)}/${Number(d)}` }

/**
 * Cash on hand and what is still owed this month. Read-only by design: Today is
 * for noticing, the Money tab is for doing.
 */
function MoneyCard({ money }: { money: TodayPayload['money'] }) {
  if (!money) {
    return (
      <div style={section()}>
        <Head left="Money" />
        <Muted>Balances land here once one is logged.</Muted>
      </div>
    )
  }

  // A brand new household has no accounts, so every figure below would be a
  // confident zero — and a row of zeroes reads as "you are broke", not as "you
  // haven't set this up". This is the first paying customer's first morning, so
  // it gets an invitation instead of a balance sheet.
  if (money.needsAccount) {
    return (
      <Link to="/money" style={{ ...section(), textDecoration: 'none', color: 'inherit', display: 'block' }}>
        <Head left="Money" right="Set up ›" />
        <Muted>
          Add an account and this becomes your balance, what's still due, and what's left after it.
        </Muted>
      </Link>
    )
  }

  const fmt = (n: number) => fmtMoney(n, money.currency)

  return (
    <Link to="/money" style={{ ...section(), textDecoration: 'none', color: 'inherit', display: 'block' }}>
      <Head left="Money" right="Open ›" />
      <div style={label({ marginTop: 11, letterSpacing: '0.1em' })}>In bank</div>
      <div style={{ ...hero(32), marginTop: 5, color: money.inBank < 0 ? T.bad : T.ink }}>
        {fmt(money.inBank)}
      </div>
      {/* WHEN, always. This is a hand-logged figure, so a stale one is
          indistinguishable from a current one without saying so — and `asOf:
          null` means nobody has logged one at all and this is the month's
          opening balance, a different number entirely. */}
      <div style={label({ marginTop: 5, letterSpacing: '0.08em', color: money.asOf ? T.muted : T.warn })}>
        {money.asOf ? `as of ${shortDate(money.asOf)}` : 'no balance logged — showing month opening'}
      </div>

      {/* Two figures, not one. "Remaining" alone hides how much of the balance
          is already spoken for, and "bills left" alone hides whether it is
          covered. Together they are the only two numbers this card owes you. */}
      <div style={{ display: 'flex', gap: 26, marginTop: 14 }}>
        <div>
          <div style={label({ letterSpacing: '0.1em' })}>Bills left</div>
          <div style={{ ...body(18), fontWeight: 700, marginTop: 3, color: T.warn }}>
            {fmt(money.billsLeft)}
          </div>
        </div>
        <div>
          <div style={label({ letterSpacing: '0.1em' })}>Remaining</div>
          <div style={{ ...body(18), fontWeight: 700, marginTop: 3,
                        color: money.remaining < 0 ? T.bad : T.good }}>
            {fmt(money.remaining)}
          </div>
        </div>
      </div>
    </Link>
  )
}

/** What is about to leave the account. Overdue first, and coloured. */
function BillsCard({ money }: { money: TodayPayload['money'] }) {
  if (!money || money.needsAccount) return null
  const bills = [...money.overdueBills, ...money.nextBills].slice(0, 5)

  return (
    <Link to="/money" style={{ ...section(), textDecoration: 'none', color: 'inherit', display: 'block' }}>
      <Head left="Bills" right={money.overdueCount > 0 ? `${money.overdueCount} past due` : undefined}
            accent={money.overdueCount > 0} />
      {/* nextBills can be empty while nextBill is set — the summary always
          names the very next one, and "nothing scheduled" next to a bill due
          Friday is the kind of small lie that costs a late fee. */}
      {bills.length === 0 && money.nextBill && (
        <div style={row({ padding: '9px 0' })}>
          <span style={label({ width: 36, flexShrink: 0 })}>{shortDate(money.nextBill.date)}</span>
          <span style={{ ...body(14), flex: 1, minWidth: 0, wordBreak: 'break-word' }}>
            {money.nextBill.label}
          </span>
          <span style={{ ...body(14), color: T.inkSoft }}>
            {fmtMoney(money.nextBill.amount, money.currency)}
          </span>
        </div>
      )}
      {bills.length === 0 && !money.nextBill && <Muted>Nothing scheduled.</Muted>}
      {bills.map((b) => (
        <div key={b.tag} style={row({ padding: '9px 0' })}>
          <span style={label({ width: 36, flexShrink: 0, color: b.overdue ? T.warn : T.muted })}>
            {shortDate(b.date)}
          </span>
          <span style={{ ...body(14), flex: 1, minWidth: 0, wordBreak: 'break-word' }}>{b.label}</span>
          <span style={{ ...body(14), color: T.inkSoft }}>{fmtMoney(b.amount, money.currency)}</span>
        </div>
      ))}
    </Link>
  )
}

/** Groceries outstanding and what is planned for tonight. */
function ListsCard({ lists }: { lists: TodayPayload['lists'] }) {
  if (!lists) return null

  return (
    <Link to="/lists" style={{ ...section(), textDecoration: 'none', color: 'inherit', display: 'block' }}>
      <Head left="Lists" right="Open ›" />
      <div style={label({ marginTop: 11, letterSpacing: '0.1em' })}>To get</div>
      <div style={{ ...hero(32), marginTop: 5 }}>{lists.groceryOpen}</div>
      <div style={label({ marginTop: 12, letterSpacing: '0.1em' })}>Tonight</div>
      <div style={{ ...body(14), marginTop: 4, color: lists.tonight ? T.ink : T.faint, wordBreak: 'break-word' }}>
        {lists.tonight ?? 'Nothing planned'}
      </div>
    </Link>
  )
}

// ── Quick add ────────────────────────────────────────────────────────────────

/** The urgent toggle. Red when armed — the one place red is used for a control
 *  rather than an error, because urgent IS the alarm. */
function urgentChip(on: boolean): CSSProperties {
  return {
    appearance: 'none', fontFamily: MONO, fontSize: 9, fontWeight: 700, letterSpacing: '0.1em',
    textTransform: 'uppercase', padding: '0 10px', minHeight: 44, borderRadius: 3, cursor: 'pointer',
    background: on ? 'rgba(239,68,68,0.16)' : 'transparent',
    color: on ? T.bad : T.ink,
    border: `1px solid ${on ? 'rgba(239,68,68,0.55)' : T.ruleStrong}`,
  }
}

function QuickAdd() {
  const create = useCreateTask()
  const [title, setTitle] = useState('')
  const [due, setDue] = useState('')
  const [urgent, setUrgent] = useState(false)
  const [expanded, setExpanded] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    const t = title.trim()
    if (!t || create.isPending) return
    // Cleared before the request resolves: on a phone the keyboard is still up
    // and you're already typing the next one.
    setTitle(''); setError(null)
    try {
      // Nothing to decide about who can see it. Every row belongs to the
      // household, which the server settles before it ever gets here.
      await create.mutateAsync({ title: t, dueDate: due || null, urgent })
      setDue(''); setUrgent(false)
    } catch (err) {
      setTitle(t) // put it back rather than losing what they typed
      setError(err instanceof ApiError ? err.message : 'Could not add that.')
    }
  }

  return (
    <form onSubmit={submit}>
      <div style={{ display: 'flex', gap: 8 }}>
        <input style={{ ...input(), flex: 1 }} placeholder="Add a todo…" value={title}
               onChange={(e) => setTitle(e.target.value)} onFocus={() => setExpanded(true)}
               enterKeyHint="done" />
        {/* Same urgent chip as the Todo page: tag it as you type, not in a
            second step after the thing is already saved. */}
        <button type="button" onClick={() => setUrgent((v) => !v)} aria-pressed={urgent}
                style={urgentChip(urgent)}>Urgent</button>
        <button type="submit" disabled={!title.trim() || create.isPending}
                style={{ ...button(title.trim() ? 'primary' : 'ghost'), padding: '12px 15px' }}>
          Add
        </button>
      </div>
      {expanded && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 9, flexWrap: 'wrap' }}>
          <input type="date" value={due} onChange={(e) => setDue(e.target.value)}
                 style={{ ...input(), width: 'auto', flex: 'none', minHeight: 34, padding: '6px 9px', fontSize: 14 }} />
        </div>
      )}
      {error && <div style={label({ color: T.bad, marginTop: 9, letterSpacing: '0.06em' })}>{error}</div>}
    </form>
  )
}

// ── Bits ─────────────────────────────────────────────────────────────────────

/**
 * A card heading. The TITLE is sans 17px semibold — big enough to find while
 * scrolling one-handed. The count or link on the right stays 10px mono, because
 * it is metadata and promoting it too would flatten the hierarchy the size
 * creates.
 */
export function Head({ left, right, accent }: { left: string; right?: string; accent?: boolean }) {
  return (
    <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 12 }}>
      <span style={sectionTitle(accent ? { color: T.warn } : {})}>{left}</span>
      {right && <span style={label(accent ? { color: T.warn } : {})}>{right}</span>}
    </div>
  )
}

export function Muted({ children }: { children: React.ReactNode }) {
  return <div style={{ ...body(14), color: T.muted, marginTop: 10 }}>{children}</div>
}

export { display }
