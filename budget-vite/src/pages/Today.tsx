import { useState, type FormEvent } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../auth'
import { useToday, useCreateTask } from '../hooks'
import { ApiError, type Task, type TodayPayload } from '../api'
import TaskRow from '../components/TaskRow'
import CalendarCard from '../components/CalendarCard'
import { T, sectionTitle, label, body, hero, display, section, row, input, button, textAction, MONO } from '../theme'

/**
 * Today — "The Briefing".
 *
 * One request paints all of it. The order matches how you actually use it:
 * capture first (the add box is under your thumb), then what matters now, then
 * everything else, then the nudges.
 */
export default function Today() {
  const { user } = useAuth()
  const { data, isLoading, error, refetch } = useToday()

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

  const { today, top3, open, slipping, counts, people } = data
  const me = user.id
  // Top 3 already appears above; repeating it in the full list is just noise.
  const topIds = new Set(top3.map((t) => t.id))
  const rest = open.filter((t) => !topIds.has(t.id))
  const rows = (list: Task[]) =>
    list.map((t) => <TaskRow key={t.id} task={t} today={today} me={me} people={people} />)

  // The reference opens with one plain-English sentence, not a stat grid.
  const brief = [
    `${counts.open} open`,
    counts.overdue > 0 ? `${counts.overdue} overdue` : null,
    counts.due_today > 0 ? `${counts.due_today} due today` : null,
    counts.done_today > 0 ? `${counts.done_today} done` : null,
  ].filter(Boolean)

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 26 }}>
      <div>
        <div style={sectionTitle()}>In brief</div>
        <p style={{ ...body(15), color: T.inkSoft, marginTop: 8 }}>
          {brief.map((b, i) => (
            <span key={i} style={{ color: b!.includes('overdue') ? T.warn : T.inkSoft }}>
              {i > 0 && <span style={{ color: T.faint }}> · </span>}{b}
            </span>
          ))}
          {counts.open === 0 && counts.done_today === 0 && 'Nothing on the list.'}
        </p>
      </div>

      <QuickAdd />

      <div style={section()}>
        <Head left="Top 3" right={top3.length ? `${top3.length} of 3` : undefined} />
        {top3.length ? <div>{rows(top3)}</div>
          : <Muted>Tap ☆ on any task to pin it here.</Muted>}
      </div>

      <CalendarCard status={data.calendar} date={today} />

      {/* Habits and Resurfacing used to sit here. Both are still live screens —
          Habits at /routines (reached from More), notes in More > Saved notes —
          they are just off the home page. Today is what you have to DO now; a
          habit ring and a rotating quote are things you look at, and they were
          pushing the open list below the fold. */}

      <div style={section()}>
        <Head left="Open tasks" right={rest.length ? String(rest.length) : undefined} />
        {rest.length ? <div>{rows(rest)}</div>
          : <Muted>{open.length ? 'Everything else is up top.' : 'Nothing open. Enjoy it.'}</Muted>}
      </div>

      {slipping.length > 0 && (
        <div style={section()}>
          <Head left="Slipping" right={`${data.slippingDays}d+`} accent />
          <div style={label({ marginTop: 6, letterSpacing: '0.06em' })}>
            Untouched a while. Tap one and hit "Still on it" to reset the clock.
          </div>
          <div>{rows(slipping)}</div>
        </div>
      )}

      <MoneyStrip money={data.money} />
    </div>
  )
}

// ── Money ────────────────────────────────────────────────────────────────────

/**
 * Balances plus what's about to hit. Read-only by design: Today is for
 * noticing, the Money tab is for doing.
 */
function MoneyStrip({ money }: { money: TodayPayload['money'] }) {
  if (!money) {
    return (
      <div style={section()}>
        <Head left="Money" />
        <Muted>Balances and the next bills due land here.</Muted>
      </div>
    )
  }
  const fmt = (n: number) => new Intl.NumberFormat('en-US', {
    style: 'currency', currency: money.currency || 'USD', maximumFractionDigits: 0,
  }).format(n || 0)
  const shortDate = (iso: string) => { const [, m, d] = iso.split('-'); return `${Number(m)}/${Number(d)}` }
  const bills = [...money.overdueBills, ...money.nextBills].slice(0, 3)

  return (
    <Link to="/budget" style={{ ...section(), textDecoration: 'none', color: 'inherit', display: 'block' }}>
      <Head left="Money" right="Open ›" />

      <div style={label({ marginTop: 10, letterSpacing: '0.1em' })}>Bank balance</div>
      <div style={{ ...hero(34), marginTop: 4, color: money.total < 0 ? T.bad : T.ink }}>
        {fmt(money.total)}
      </div>
      {money.overdue > 0 && (
        <div style={label({ marginTop: 6, letterSpacing: '0.08em', color: T.warn })}>
          {money.overdue} past due
        </div>
      )}

      {/* Last seven days, both directions. Two figures beat one net number —
          a quiet week and a big-in-big-out week net out the same. */}
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

      {bills.length > 0 && (
        <div style={{ marginTop: 12 }}>
          {bills.map((b) => (
            <div key={b.tag} style={row({ padding: '9px 0' })}>
              <span style={{ ...label({ width: 36, flexShrink: 0, color: b.overdue ? T.warn : T.muted }) }}>
                {shortDate(b.date)}
              </span>
              <span style={{ ...body(14), flex: 1, minWidth: 0, wordBreak: 'break-word' }}>{b.label}</span>
              <span style={{ ...body(14), color: T.inkSoft }}>{fmt(b.amount)}</span>
            </div>
          ))}
        </div>
      )}
    </Link>
  )
}

/** The urgent toggle. Red when armed — the one place red is used for a control
 *  rather than an error, because urgent IS the alarm. */
function urgentChip(on: boolean): React.CSSProperties {
  return {
    appearance: 'none', fontFamily: MONO, fontSize: 9, fontWeight: 700, letterSpacing: '0.1em',
    textTransform: 'uppercase', padding: '0 10px', minHeight: 44, borderRadius: 3, cursor: 'pointer',
    background: on ? 'rgba(239,68,68,0.16)' : 'transparent',
    color: on ? T.bad : T.ink,
    border: `1px solid ${on ? 'rgba(239,68,68,0.55)' : T.ruleStrong}`,
  }
}

// ── Quick add ────────────────────────────────────────────────────────────────

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
 * A section heading. The TITLE is sans 17px semibold — big enough to find while
 * scrolling one-handed. The count on the right stays 10px mono, because it is
 * metadata and promoting it too would flatten the hierarchy the size creates.
 *
 * Exported: Routines, Projects and Lists all render their sections through this,
 * so changing the size here changes every page at once.
 */
export function Head({ left, right, accent }: { left: string; right?: string; accent?: boolean }) {
  return (
    <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 12 }}>
      <span style={sectionTitle(accent ? { color: T.warn } : {})}>{left}</span>
      {right && <span style={label()}>{right}</span>}
    </div>
  )
}

export function Muted({ children }: { children: React.ReactNode }) {
  return <div style={{ ...body(14), color: T.muted, marginTop: 10 }}>{children}</div>
}

export { display, textAction }
