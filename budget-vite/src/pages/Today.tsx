import { useState, type FormEvent } from 'react'
import { useAuth } from '../auth'
import { useToday, useCreateTask } from '../hooks'
import { ApiError, type Task } from '../api'
import TaskRow from '../components/TaskRow'
import { T, card, labelCap, input, button } from '../theme'

/**
 * Today — the default screen. One request (/api/hh/today) paints all of it.
 *
 * Order is deliberate and matches how you actually use it: capture first (the
 * add box is the first thing under your thumb), then what matters now, then
 * everything else, then the nudges.
 */
export default function Today() {
  const { user } = useAuth()
  const { data, isLoading, error, refetch, isFetching } = useToday()

  if (isLoading) {
    return <div style={{ color: T.muted, fontSize: 14, padding: '30px 0', textAlign: 'center' }}>Loading…</div>
  }

  if (error) {
    const msg = error instanceof ApiError ? error.message : 'Something went wrong.'
    return (
      <section style={card()}>
        <div style={{ color: T.red, fontWeight: 700, fontSize: 15 }}>{msg}</div>
        <button onClick={() => void refetch()} style={{ ...button('ghost'), marginTop: 12 }}>Try again</button>
      </section>
    )
  }
  if (!data || !user) return null

  const { today, top3, open, slipping, counts, resurfacing, people } = data
  const me = user.id
  // Top 3 already appears above; repeating it in the full list is just noise.
  const topIds = new Set(top3.map((t) => t.id))
  const rest = open.filter((t) => !topIds.has(t.id))

  const rows = (list: Task[]) =>
    list.map((t) => <TaskRow key={t.id} task={t} today={today} me={me} people={people} />)

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <QuickAdd />

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 10 }}>
        <Stat label="Open" value={counts.open} />
        <Stat label="Overdue" value={counts.overdue} color={counts.overdue > 0 ? T.red : undefined} />
        <Stat label="Done" value={counts.done_today} color={counts.done_today > 0 ? T.green : undefined} />
      </div>

      <section style={card()}>
        <div style={labelCap()}>Top 3</div>
        {top3.length ? (
          <div style={{ marginTop: 4 }}>{rows(top3)}</div>
        ) : (
          <Empty>Star up to three tasks and they'll sit here.</Empty>
        )}
      </section>

      <section style={card()}>
        <div style={labelCap()}>Calendar</div>
        <Empty>Connect Google Calendar in Settings to see today's events.</Empty>
      </section>

      <section style={card()}>
        <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between' }}>
          <div style={labelCap()}>Open tasks</div>
          {isFetching && <span style={{ fontSize: 11, color: T.muted, opacity: 0.6 }}>syncing…</span>}
        </div>
        {rest.length ? (
          <div style={{ marginTop: 4 }}>{rows(rest)}</div>
        ) : (
          <Empty>{open.length ? 'Everything else is up top.' : 'Nothing open. Enjoy it.'}</Empty>
        )}
      </section>

      {slipping.length > 0 && (
        <section style={{ ...card(), borderColor: 'rgba(251,133,1,0.3)' }}>
          <div style={labelCap({ color: T.orange })}>Slipping</div>
          <div style={{ fontSize: 12, color: T.muted, marginTop: 6, lineHeight: 1.4 }}>
            Untouched for {data.slippingDays}+ days. Tap one and hit "Still on it" to reset its clock.
          </div>
          <div style={{ marginTop: 6 }}>{rows(slipping)}</div>
        </section>
      )}

      {resurfacing && (
        <section style={card()}>
          <div style={labelCap()}>Resurfacing</div>
          <div style={{ fontSize: 15, lineHeight: 1.55, marginTop: 10, color: T.text }}>
            {resurfacing.body}
          </div>
          <div style={{ fontSize: 11, color: T.muted, opacity: 0.6, marginTop: 8 }}>
            Saved {new Date(resurfacing.created_at).toLocaleDateString()}
            {resurfacing.owner_id !== me && ` · ${people.find((p) => p.id === resurfacing.owner_id)?.displayName ?? ''}`}
          </div>
        </section>
      )}

      <section style={card()}>
        <div style={labelCap()}>Money</div>
        <Empty>Balances and the next bills due land here.</Empty>
      </section>
    </div>
  )
}

// ── Quick add ────────────────────────────────────────────────────────────────

function QuickAdd() {
  const create = useCreateTask()
  const [title, setTitle] = useState('')
  const [due, setDue] = useState('')
  const [shared, setShared] = useState(false)
  const [expanded, setExpanded] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    const t = title.trim()
    if (!t || create.isPending) return
    // Cleared before the request resolves: on a phone the keyboard is still up
    // and you're already typing the next one.
    setTitle('')
    setError(null)
    try {
      await create.mutateAsync({
        title: t,
        dueDate: due || null,
        visibility: shared ? 'shared' : 'private',
      })
      setDue('')
    } catch (err) {
      setTitle(t) // put it back rather than losing what they typed
      setError(err instanceof ApiError ? err.message : 'Could not add that.')
    }
  }

  return (
    <form onSubmit={submit} style={card({ padding: 14 })}>
      <div style={{ display: 'flex', gap: 8 }}>
        <input
          style={{ ...input(), flex: 1 }}
          placeholder="Add a task…"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          onFocus={() => setExpanded(true)}
          enterKeyHint="done"
        />
        <button type="submit" disabled={!title.trim() || create.isPending}
                style={{ ...button('primary'), padding: '12px 16px', opacity: title.trim() ? 1 : 0.4 }}>
          Add
        </button>
      </div>

      {expanded && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 10, flexWrap: 'wrap' }}>
          <input
            type="date" value={due} onChange={(e) => setDue(e.target.value)}
            style={{
              background: 'rgba(255,255,255,0.05)', border: `1px solid ${T.hairline}`,
              borderRadius: 8, color: T.text, padding: '7px 10px', fontSize: 15, minHeight: 38,
            }}
          />
          <button
            type="button" onClick={() => setShared((v) => !v)}
            style={{
              appearance: 'none', minHeight: 38, padding: '8px 13px', borderRadius: 9,
              fontSize: 13, fontWeight: 700, cursor: 'pointer', color: T.text,
              background: shared ? 'rgba(33,158,188,0.18)' : 'transparent',
              border: `1px solid ${shared ? 'rgba(33,158,188,0.5)' : T.hairline}`,
            }}
          >
            {shared ? '✓ Shared' : 'Private'}
          </button>
        </div>
      )}

      {error && <div style={{ color: T.red, fontSize: 13, fontWeight: 600, marginTop: 10 }}>{error}</div>}
    </form>
  )
}

// ── Small pieces ─────────────────────────────────────────────────────────────

function Stat({ label, value, color }: { label: string; value: number; color?: string }) {
  return (
    <div style={card({ padding: '12px 10px', textAlign: 'center' })}>
      <div style={{ fontSize: 24, fontWeight: 900, color: color ?? T.text, lineHeight: 1.1 }}>{value}</div>
      <div style={labelCap({ marginTop: 4, fontSize: 10 })}>{label}</div>
    </div>
  )
}

function Empty({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ fontSize: 14, color: T.muted, marginTop: 10, lineHeight: 1.45 }}>{children}</div>
  )
}
