import { useState, type FormEvent } from 'react'
import { useAuth } from '../auth'
import { useTasks, useCreateTask, useToday } from '../hooks'
import { ApiError, type Task } from '../api'
import TaskRow from '../components/TaskRow'
import { T, label, body, section, input, button, segment } from '../theme'

/**
 * Todo — the full list, with urgent as a toggle on the input.
 *
 * Urgent is decided at capture: one tap before you hit Add. That costs a tap,
 * but it is visible and it works the same for both of you — unlike a typed
 * marker, which is faster but is a rule somebody has to be told about.
 *
 * `urgent` is a separate field from `starred`. Starred means "one of my Top 3
 * on Today"; urgent means "this can't wait". One flag for both would make
 * pinning something to Today silently mark it as an emergency.
 */
export default function Todo() {
  const { user } = useAuth()
  const { data: today } = useToday()
  const [scope, setScope] = useState<'open' | 'done'>('open')
  const { data, isLoading, error, refetch } = useTasks(scope)

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
  const todayIso = today?.today ?? new Date().toISOString().slice(0, 10)
  const people = today?.people ?? []
  const urgent = tasks.filter((t) => t.urgent && !t.done_at)
  const rest = tasks.filter((t) => !(t.urgent && !t.done_at))

  const rows = (list: Task[]) =>
    list.map((t) => (
      <div key={t.id} style={t.urgent && !t.done_at
        // A left rule rather than a badge: it marks the whole row without
        // adding another thing to read.
        ? { borderLeft: `2px solid ${T.warn}`, paddingLeft: 11, marginLeft: -13 }
        : undefined}>
        <TaskRow task={t} today={todayIso} me={user.id} people={people} />
      </div>
    ))

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 22 }}>
      <QuickAdd />

      <div style={{ display: 'flex', gap: 6 }}>
        <button onClick={() => setScope('open')} style={segment(scope === 'open')}>Open</button>
        <button onClick={() => setScope('done')} style={segment(scope === 'done')}>Done</button>
      </div>

      {scope === 'open' && urgent.length > 0 && (
        <div style={{ ...section(), borderColor: T.warn }}>
          <Head left="Urgent" right={String(urgent.length)} warn />
          <div>{rows(urgent)}</div>
        </div>
      )}

      <div style={section()}>
        <Head left={scope === 'done' ? 'Done' : urgent.length ? 'Everything else' : 'Open'}
              right={String(rest.length)} />
        {rest.length ? <div>{rows(rest)}</div> : (
          <div style={{ ...body(14), color: T.muted, marginTop: 10 }}>
            {scope === 'done' ? 'Nothing completed yet.' : 'Nothing on the list.'}
          </div>
        )}
      </div>
    </div>
  )
}

function QuickAdd() {
  const create = useCreateTask()
  const [title, setTitle] = useState('')
  const [urgent, setUrgent] = useState(false)
  const [due, setDue] = useState('')
  const [shared, setShared] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    const t = title.trim()
    if (!t || create.isPending) return
    // Cleared before the request resolves: the keyboard is still up and you're
    // already typing the next one.
    setTitle(''); setError(null)
    try {
      await create.mutateAsync({
        title: t, urgent, dueDate: due || null, visibility: shared ? 'shared' : 'private',
      })
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
        <input style={{ ...input(), flex: 1, borderColor: urgent ? T.warn : undefined }}
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
                  ? { ...segment(true), background: T.warn, borderColor: T.warn, color: '#1a1000' }
                  : { ...segment(false), borderColor: T.warn, color: T.warn }}>
          ! Urgent
        </button>
        <input type="date" value={due} onChange={(e) => setDue(e.target.value)}
               style={{ ...input(), width: 'auto', flex: 'none', minHeight: 34, padding: '6px 9px', fontSize: 14 }} />
        <button type="button" onClick={() => setShared((v) => !v)} style={segment(shared)}>
          {shared ? 'Shared' : 'Private'}
        </button>
      </div>
      {error && <div style={label({ color: T.bad, marginTop: 9, letterSpacing: '0.06em' })}>{error}</div>}
    </form>
  )
}

function Head({ left, right, warn }: { left: string; right?: string; warn?: boolean }) {
  return (
    <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 12 }}>
      <span style={label(warn ? { color: T.warn } : {})}>{left}</span>
      {right && <span style={label(warn ? { color: T.warn } : {})}>{right}</span>}
    </div>
  )
}
