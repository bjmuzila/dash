import { useState, type FormEvent } from 'react'
import { useAuth } from '../auth'
import { useRoutines, useToggleRoutine, useCreateRoutine, useArchiveRoutine, useUpdateRoutine } from '../hooks'
import { ApiError, type Routine, type RoutineBlock } from '../api'
import { T, card, labelCap, input, button } from '../theme'

/**
 * Routines & habits.
 *
 * Separate from tasks on purpose: a routine never completes, it just comes back
 * tomorrow. Three time blocks, a tick per day, a streak, and 30 days of history.
 *
 * The streak number is the whole reason anyone opens this screen, so it sits
 * next to the item rather than behind a tap, and it updates the instant you tick.
 */

const BLOCK_LABEL: Record<RoutineBlock, string> = {
  morning: 'Morning', afternoon: 'Afternoon', evening: 'Evening',
}
const BLOCKS: RoutineBlock[] = ['morning', 'afternoon', 'evening']

export default function Routines() {
  const { user } = useAuth()
  const { data, isLoading, error, refetch } = useRoutines()
  const toggle = useToggleRoutine()
  const [adding, setAdding] = useState<RoutineBlock | null>(null)

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
  if (!data || !user) return null

  const pct = data.total ? Math.round((data.doneToday / data.total) * 100) : 0

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <section style={card()}>
        <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between' }}>
          <div style={labelCap()}>Today</div>
          <div style={{ fontSize: 13, color: T.muted }}>{data.doneToday} of {data.total}</div>
        </div>
        <div style={{ fontSize: 32, fontWeight: 900, marginTop: 4, color: pct === 100 && data.total > 0 ? T.green : T.text }}>
          {pct}%
        </div>
        <div style={{ height: 6, borderRadius: 3, background: 'rgba(255,255,255,0.08)', marginTop: 10, overflow: 'hidden' }}>
          <div style={{ width: `${pct}%`, height: '100%', background: pct === 100 ? T.green : T.cyan, transition: 'width 160ms' }} />
        </div>
        {data.total > 0 && <History history={data.history} />}
      </section>

      {BLOCKS.map((b) => {
        const block = data.blocks.find((x) => x.block === b)
        const items = block?.items ?? []
        return (
          <section key={b} style={card()}>
            <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between' }}>
              <div style={labelCap()}>{BLOCK_LABEL[b]}</div>
              {items.length > 0 && (
                <div style={{ fontSize: 12, color: block!.done === items.length ? T.green : T.muted, fontWeight: 700 }}>
                  {block!.done}/{items.length}
                </div>
              )}
            </div>

            {items.length === 0 && (
              <div style={{ fontSize: 14, color: T.muted, marginTop: 10 }}>Nothing here yet.</div>
            )}

            <div style={{ marginTop: 6 }}>
              {items.map((r) => (
                <RoutineRow key={r.id} routine={r} me={user.id} onToggle={() => toggle.mutate(r.id)} />
              ))}
            </div>

            {adding === b ? (
              <AddRoutine block={b} onDone={() => setAdding(null)} />
            ) : (
              <button onClick={() => setAdding(b)}
                      style={{ ...button('ghost'), width: '100%', marginTop: 12, color: T.muted }}>
                + Add to {BLOCK_LABEL[b].toLowerCase()}
              </button>
            )}
          </section>
        )
      })}
    </div>
  )
}

// ── One routine ──────────────────────────────────────────────────────────────

function RoutineRow({ routine, me, onToggle }: { routine: Routine; me: number; onToggle: () => void }) {
  const [open, setOpen] = useState(false)
  const archive = useArchiveRoutine()
  const update = useUpdateRoutine()
  const mine = routine.ownerId === me

  return (
    <div style={{ borderTop: `1px solid ${T.border}` }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 2px' }}>
        <button
          aria-label={routine.done ? 'Mark not done' : 'Mark done'}
          onClick={onToggle}
          style={{
            flexShrink: 0, width: 26, height: 26, padding: 0, borderRadius: 8, cursor: 'pointer',
            background: routine.done ? T.green : 'transparent',
            border: `2px solid ${routine.done ? T.green : 'rgba(255,255,255,0.35)'}`,
            display: 'grid', placeItems: 'center', color: T.ink, fontSize: 14, fontWeight: 900,
            transition: 'background 120ms',
          }}
        >
          {routine.done ? '✓' : ''}
        </button>

        <div onClick={() => setOpen((v) => !v)} style={{ flex: 1, minWidth: 0, cursor: 'pointer' }}>
          <div style={{
            fontSize: 15, fontWeight: 600, lineHeight: 1.35, wordBreak: 'break-word',
            color: routine.done ? T.muted : T.text,
          }}>
            {routine.title}
            {routine.visibility === 'shared' && (
              <span style={{ fontSize: 9, fontWeight: 800, letterSpacing: '0.1em', color: T.cyan, marginLeft: 7 }}>
                SHARED
              </span>
            )}
          </div>
        </div>

        {/* The streak is the payoff. It stays visible, not tucked behind a tap. */}
        {routine.streak > 0 && (
          <div style={{ flexShrink: 0, textAlign: 'right' }}>
            <div style={{ fontSize: 15, fontWeight: 900, color: T.orange, lineHeight: 1 }}>
              {routine.streak}
            </div>
            <div style={{ fontSize: 9, fontWeight: 800, letterSpacing: '0.1em', color: T.muted, marginTop: 2 }}>
              DAY{routine.streak === 1 ? '' : 'S'}
            </div>
          </div>
        )}
      </div>

      {open && (
        <div style={{ padding: '0 2px 14px 38px' }}>
          <Sparkline history={routine.history} />
          <div style={{ fontSize: 12, color: T.muted, marginTop: 8 }}>
            {routine.last30} of the last 30 days
            {routine.best > 0 && ` · best run ${routine.best} day${routine.best === 1 ? '' : 's'}`}
          </div>
          <div style={{ display: 'flex', gap: 8, marginTop: 12, flexWrap: 'wrap' }}>
            <button
              onClick={() => update.mutate({ id: routine.id, patch: {
                visibility: routine.visibility === 'shared' ? 'private' : 'shared',
              } })}
              style={mini(routine.visibility === 'shared')}
            >
              {routine.visibility === 'shared' ? '✓ Shared' : 'Share'}
            </button>
            {BLOCKS.filter((b) => b !== routine.block).map((b) => (
              <button key={b} onClick={() => update.mutate({ id: routine.id, patch: { block: b } })} style={mini()}>
                → {BLOCK_LABEL[b]}
              </button>
            ))}
            {mine && (
              <button
                onClick={() => archive.mutate(routine.id)}
                style={{ ...mini(), color: T.red, borderColor: 'rgba(239,68,68,0.35)' }}
              >
                Remove
              </button>
            )}
          </div>
          {mine && (
            <div style={{ fontSize: 11, color: T.muted, opacity: 0.65, marginTop: 8 }}>
              Removing hides it and keeps the history — your streak isn't lost.
            </div>
          )}
        </div>
      )}
    </div>
  )
}

// ── Add ──────────────────────────────────────────────────────────────────────

function AddRoutine({ block, onDone }: { block: RoutineBlock; onDone: () => void }) {
  const create = useCreateRoutine()
  const [title, setTitle] = useState('')
  const [shared, setShared] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    const t = title.trim()
    if (!t || create.isPending) return
    setError(null)
    try {
      await create.mutateAsync({ title: t, block, visibility: shared ? 'shared' : 'private' })
      setTitle('')
      onDone()
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not add that.')
    }
  }

  return (
    <form onSubmit={submit} style={{ marginTop: 12 }}>
      <input style={input()} placeholder={`New ${BLOCK_LABEL[block].toLowerCase()} habit…`}
             value={title} onChange={(e) => setTitle(e.target.value)} autoFocus enterKeyHint="done" />
      <div style={{ display: 'flex', gap: 8, marginTop: 10, alignItems: 'center' }}>
        <button type="button" onClick={() => setShared((v) => !v)} style={mini(shared)}>
          {shared ? '✓ Shared' : 'Private'}
        </button>
        <button type="button" onClick={onDone} style={{ ...button('ghost'), marginLeft: 'auto' }}>Cancel</button>
        <button type="submit" disabled={!title.trim() || create.isPending}
                style={{ ...button('primary'), opacity: title.trim() ? 1 : 0.4 }}>Add</button>
      </div>
      {error && <div style={{ color: T.red, fontSize: 13, fontWeight: 600, marginTop: 8 }}>{error}</div>}
    </form>
  )
}

// ── Charts ───────────────────────────────────────────────────────────────────

/** 30 days of household completion. Bars, because a habit is binary per day. */
function History({ history }: { history: { day: string; done: number; total: number }[] }) {
  return (
    <div style={{ display: 'flex', alignItems: 'flex-end', gap: 2, height: 34, marginTop: 14 }}>
      {history.map((d) => {
        const pct = d.total ? d.done / d.total : 0
        return (
          <div key={d.day} title={d.day} style={{ flex: 1, height: '100%', display: 'flex', alignItems: 'flex-end' }}>
            <div style={{
              width: '100%',
              // A floor of 2px so a zero day reads as "nothing done", not as
              // missing data — an absent bar looks like a gap in the record.
              height: `${Math.max(6, pct * 100)}%`,
              borderRadius: 2,
              background: pct === 0 ? 'rgba(255,255,255,0.07)' : pct === 1 ? T.green : T.cyan,
              opacity: pct === 0 ? 1 : 0.35 + pct * 0.65,
            }} />
          </div>
        )
      })}
    </div>
  )
}

/** Per-routine 30-day dots. */
function Sparkline({ history }: { history: { day: string; done: boolean }[] }) {
  return (
    <div style={{ display: 'flex', gap: 2, flexWrap: 'wrap' }}>
      {history.map((d) => (
        <div key={d.day} title={d.day} style={{
          width: 8, height: 8, borderRadius: 2,
          background: d.done ? T.green : 'rgba(255,255,255,0.09)',
        }} />
      ))}
    </div>
  )
}

const mini = (active = false): React.CSSProperties => ({
  appearance: 'none',
  background: active ? 'rgba(33,158,188,0.18)' : 'transparent',
  border: `1px solid ${active ? 'rgba(33,158,188,0.5)' : T.hairline}`,
  color: T.text, borderRadius: 9, minHeight: 38, padding: '8px 13px',
  fontSize: 13, fontWeight: 700, cursor: 'pointer',
})
