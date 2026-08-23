import { useState, type FormEvent } from 'react'
import { useAuth } from '../auth'
import { useTasks, useCreateTask, useToday } from '../hooks'
import { ApiError, type Task } from '../api'
import TaskRow from '../components/TaskRow'
import { T, sectionTitle, label, body, section, input, button, segment } from '../theme'

/**
 * Todo — the full list, with urgent as a toggle on the input.
 *
 * Urgent is decided at capture: one tap before you hit Add. That costs a tap,
 * but it is visible and it works the same for everyone in the household —
 * unlike a typed marker, which is faster but is a rule somebody has to be told
 * about.
 *
 * `urgent` is a separate field from `starred`. Starred means "one of my Top 3
 * on Today"; urgent means "this can't wait". One flag for both would make
 * pinning something to Today silently mark it as an emergency.
 *
 * Urgent is RED — the only place red means "act", not "error". Orange was
 * already spoken for by overdue dates, and two shades of warning next to each
 * other read as one.
 *
 * Ticking something off drops it into Completed, which the server trims to the
 * last five days. Nothing is deleted; it just stops taking up room.
 */
export default function Todo() {
  const { user } = useAuth()
  const { data: today } = useToday()
  // Two queries, not a scope toggle. Completed work belongs on the same screen
  // as the work — a tab you have to remember to check is a tab nobody checks.
  const { data, isLoading, error, refetch } = useTasks('open')
  const { data: doneData } = useTasks('done')

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
  if (!user) return null

  const tasks = data?.tasks ?? []
  const done = doneData?.tasks ?? []
  const todayIso = today?.today ?? new Date().toISOString().slice(0, 10)
  const people = today?.people ?? []
  const urgent = tasks.filter((t) => t.urgent)
  const rest = tasks.filter((t) => !t.urgent)

  const rows = (list: Task[]) =>
    list.map((t) => (
      <div key={t.id} style={t.urgent && !t.done_at
        // A left rule rather than a badge: it marks the whole row without
        // adding another thing to read.
        ? { borderLeft: `2px solid ${T.bad}`, paddingLeft: 11, marginLeft: -13 }
        : undefined}>
        <TaskRow task={t} today={todayIso} me={user.id} people={people} />
      </div>
    ))

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <QuickAdd />

      {urgent.length > 0 && (
        // Plain section rule, NOT a red one. Urgent already reads as urgent
        // from the red left bar on each row and the red heading; a red bar
        // spanning the whole width on top of that was a third alarm for the
        // same fact, and it made the divider look like an error state.
        <div style={section()}>
          <Head left="Urgent" right={String(urgent.length)} urgent />
          <div>{rows(urgent)}</div>
        </div>
      )}

      <div style={section()}>
        <Head left={urgent.length ? 'Everything else' : 'Open'} right={String(rest.length)} />
        {rest.length ? <div>{rows(rest)}</div> : (
          <div style={{ ...body(14), color: T.muted, marginTop: 10 }}>Nothing on the list.</div>
        )}
      </div>

      {done.length > 0 && (
        <div style={section()}>
          {/* The server only returns the last 5 days here. Nothing is deleted —
              older completions stay in the database, they just stop taking up
              space on a phone screen. */}
          <Head left="Completed" right={`${done.length} · clears after 5 days`} />
          <div>{rows(done)}</div>
        </div>
      )}
    </div>
  )
}

function QuickAdd() {
  const create = useCreateTask()
  const [title, setTitle] = useState('')
  const [urgent, setUrgent] = useState(false)
  const [due, setDue] = useState('')
  const [error, setError] = useState<string | null>(null)

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    const t = title.trim()
    if (!t || create.isPending) return
    // Cleared before the request resolves: the keyboard is still up and you're
    // already typing the next one.
    setTitle(''); setError(null)
    try {
      // Nothing to decide about who can see it — the row belongs to the
      // household the moment the server writes it.
      await create.mutateAsync({ title: t, urgent, dueDate: due || null })
      // Urgent resets, the date doesn't: adding three things due Friday is
      // common, adding three emergencies in a row is not.
      setUrgent(false)
    } catch (err) {
      setTitle(t)
      setError(err instanceof ApiError ? err.message : 'Could not add that.')
    }
  }

  return (
    <form onSubmit={submit}>
      <div style={{ display: 'flex', gap: 8 }}>
        <input style={{ ...input(), flex: 1, borderColor: urgent ? T.bad : undefined }}
               placeholder="Add a todo…" value={title}
               onChange={(e) => setTitle(e.target.value)} enterKeyHint="done" />
        <button type="submit" disabled={!title.trim() || create.isPending}
                style={{ ...button(title.trim() ? 'primary' : 'ghost'), padding: '12px 15px' }}>
          Add
        </button>
      </div>
      <div style={{ display: 'flex', gap: 6, marginTop: 9, alignItems: 'center', flexWrap: 'wrap' }}>
        <button type="button" onClick={() => setUrgent((v) => !v)}
                style={urgent
                  // Filled red when armed. The text goes to T.ink rather than a
                  // literal white so the one place this app paints on top of a
                  // solid alarm colour still comes out of the palette.
                  ? { ...segment(true), background: T.bad, borderColor: T.bad, color: T.ink }
                  : { ...segment(false), borderColor: 'rgba(239,68,68,0.55)', color: T.bad }}>
          ! Urgent
        </button>
        <input type="date" value={due} onChange={(e) => setDue(e.target.value)}
               style={{ ...input(), width: 'auto', flex: 'none', minHeight: 34, padding: '6px 9px', fontSize: 14 }} />
      </div>
      {error && <div style={label({ color: T.bad, marginTop: 9, letterSpacing: '0.06em' })}>{error}</div>}
    </form>
  )
}

function Head({ left, right, urgent }: { left: string; right?: string; urgent?: boolean }) {
  return (
    <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 12 }}>
      <span style={sectionTitle(urgent ? { color: T.bad } : {})}>{left}</span>
      {right && <span style={label(urgent ? { color: T.bad } : {})}>{right}</span>}
    </div>
  )
}
