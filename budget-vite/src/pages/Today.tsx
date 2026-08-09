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
 *   strip     what time is it, what's it like out, how far into the month
 *   calendar  the day, full width — the part you cannot change
 *   todo      | habits    what you have to do  | what you keep doing
 *   journal   | lists     what you're thinking | what the house needs
 *   money     | bills     what you have        | what's leaving
 *
 * Each pair is one question answered from two sides, which is why they sit
 * together rather than in one long column of unrelated cards.
 *
 * Everything reads an endpoint that already existed. Only the weather is new,
 * and only because /api/weather is gated on a trading-app subscription that an
 * hh_session cannot satisfy — see the note on /api/hh/weather in
 * server-v2/household-routes.cjs.
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

      <StatStrip data={data} wide={wide} />

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

// ── Status strip ─────────────────────────────────────────────────────────────

/** Clock, weather, month pace. The glance you take before reading anything. */
function StatStrip({ data, wide }: { data: TodayPayload; wide: boolean }) {
  return (
    <div style={{
      display: 'grid',
      gridTemplateColumns: wide ? 'repeat(3, 1fr)' : '1fr',
      gap: 14,
    }}>
      <ClockTile tz={data.tz} />
      <WeatherTile />
      <PaceTile money={data.money} today={data.today} />
    </div>
  )
}

function ClockTile({ tz }: { tz: string }) {
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
    <div style={tile({ padding: '15px 16px' })}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
        <span style={hero(38)}>{clock}</span>
        {meridiem && <span style={label()}>{meridiem}</span>}
      </div>
      <div style={label({ marginTop: 9 })}>
        {now.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })}
        {tz ? ` · ${tz.split('/').pop()!.replace('_', ' ')}` : ''}
      </div>
    </div>
  )
}

/**
 * Current conditions for the ZIP saved in Settings.
 *
 * Renders NOTHING when no ZIP is set. An empty weather tile is worse than no
 * tile — it is a permanent hole on the home screen advertising a setting you
 * chose not to fill in. Settings is where you turn it on, and that is the only
 * place that should mention it.
 */
function WeatherTile() {
  const { data: settings } = useSettings()
  const zip = settings?.settings.weatherZip || ''
  const { data, error, isLoading } = useWeather(zip)

  if (!zip) return null

  return (
    <div style={tile({ padding: '15px 16px' })}>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10 }}>
        <span style={label()}>Weather</span>
        {data && <span style={label()}>{data.place}</span>}
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
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginTop: 7 }}>
            <span style={hero(34)}>{data.tempF}°</span>
            <span style={label()}>F</span>
          </div>
          <div style={{ ...body(13), marginTop: 6 }}>{data.condition}</div>
        </>
      )}
    </div>
  )
}

/**
 * How far into the month you are, against where the money lands.
 *
 * The bar is the CALENDAR month, not spend — it is the denominator you compare
 * the projection against, and a spend bar next to a projection figure invites
 * reading one as the other.
 */
function PaceTile({ money, today }: { money: TodayPayload['money']; today: string }) {
  const [y, m, d] = today.split('-').map(Number)
  const days = new Date(y, m, 0).getDate()
  const pct = Math.round((d / days) * 100)
  const fmt = (n: number) => fmtMoney(n, money?.currency)

  return (
    <div style={tile({ padding: '15px 16px' })}>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10 }}>
        <span style={label()}>Month elapsed</span>
        <span style={label()}>{new Date(y, m - 1, 1).toLocaleDateString('en-US', { month: 'short' })}</span>
      </div>
      <div style={{ height: 5, background: T.paperSunk, borderRadius: 3, overflow: 'hidden', marginTop: 10 }}>
        <div style={{ width: `${pct}%`, height: '100%', background: T.accent }} />
      </div>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, marginTop: 8 }}>
        <span style={label()}>{pct}%</span>
        {money && (
          <span style={label({ color: money.projectedEom < 0 ? T.warn : T.muted })}>
            {fmt(money.projectedEom)} projected
          </span>
        )}
      </div>
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
 * Quick capture only. The archive is the Journal tab — this card exists so a
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
 * Balances and the week's two directions. Read-only by design: Today is for
 * noticing, the Money tab is for doing.
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
  const fmt = (n: number) => fmtMoney(n, money.currency)

  return (
    <Link to="/budget" style={{ ...section(), textDecoration: 'none', color: 'inherit', display: 'block' }}>
      <Head left="Money" right="Open ›" />
      <div style={label({ marginTop: 11, letterSpacing: '0.1em' })}>Bank balance</div>
      <div style={{ ...hero(32), marginTop: 5, color: money.total < 0 ? T.bad : T.ink }}>
        {fmt(money.total)}
      </div>
      {/* WHEN, always. This is a hand-logged figure, so a stale one is
          indistinguishable from a current one without saying so — and `asOf:
          null` means nobody has logged one at all and this is the month's
          opening balance, a different number entirely. */}
      <div style={label({ marginTop: 5, letterSpacing: '0.08em', color: money.asOf ? T.muted : T.warn })}>
        {money.asOf ? `as of ${shortDate(money.asOf)}` : 'no balance logged — showing month opening'}
      </div>

      {/* Two figures, not one net number — a quiet week and a big-in-big-out
          week net out the same. */}
      <div style={{ display: 'flex', gap: 26, marginTop: 14 }}>
        <div>
          <div style={label({ letterSpacing: '0.1em' })}>Weekly in</div>
          <div style={{ ...body(18), fontWeight: 700, marginTop: 3, color: T.good }}>
            +{fmt(money.weekIn ?? 0)}
          </div>
        </div>
        <div>
          <div style={label({ letterSpacing: '0.1em' })}>Weekly out</div>
          <div style={{ ...body(18), fontWeight: 700, marginTop: 3, color: T.warn }}>
            −{fmt(money.weekOut ?? 0)}
          </div>
        </div>
      </div>
    </Link>
  )
}

/** What is about to leave the account. Overdue first, and coloured. */
function BillsCard({ money }: { money: TodayPayload['money'] }) {
  if (!money) return null
  const bills = [...money.overdueBills, ...money.nextBills].slice(0, 5)

  return (
    <Link to="/budget" style={{ ...section(), textDecoration: 'none', color: 'inherit', display: 'block' }}>
      <Head left="Bills" right={money.overdue > 0 ? `${money.overdue} past due` : undefined}
            accent={money.overdue > 0} />
      {bills.length === 0 && <Muted>Nothing scheduled.</Muted>}
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
      // No visibility choice: everything in this app is shared. See the note
      // in server-v2/household-routes.cjs.
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
