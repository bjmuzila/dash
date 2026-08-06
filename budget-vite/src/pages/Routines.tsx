import { useState, type FormEvent } from 'react'
import { useAuth } from '../auth'
import { useRoutines, useToggleRoutine, useCreateRoutine, useArchiveRoutine, useUpdateRoutine } from '../hooks'
import { ApiError, type Routine, type RoutineBlock } from '../api'
import { T, label, body, hero, section, row, input, button, segment, checkbox, doneText } from '../theme'

/**
 * Habits.
 *
 * Separate from tasks: a routine never completes, it comes back tomorrow.
 * The streak is the reason anyone opens this screen, so it sits on the row —
 * not behind a tap — and updates the instant you tick.
 *
 * History renders as a run of small squares, one per day, the way the reference
 * does. Binary per day, so bars would be a lie.
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
  if (!data || !user) return null

  const pct = data.total ? Math.round((data.doneToday / data.total) * 100) : 0
  const bestStreak = Math.max(0, ...data.blocks.flatMap((b) => b.items.map((i) => i.streak)))

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 26 }}>
      {/* The hero: one oversized serif number, a 30-day trace, a streak. */}
      <div>
        <div style={{ display: 'flex', alignItems: 'flex-end', gap: 16 }}>
          <div style={hero(46)}>
            {pct}<span style={{ fontSize: 17, color: T.muted }}>%</span>
          </div>
          <div style={{ flex: 1, paddingBottom: 8 }}>
            <DayTrace history={data.history} />
          </div>
          {bestStreak > 0 && (
            <div style={{ paddingBottom: 6, textAlign: 'right' }}>
              <div style={{ ...hero(20), color: T.accent }}>{bestStreak}</div>
              <div style={label({ letterSpacing: '0.1em' })}>days</div>
            </div>
          )}
        </div>
        <div style={label({ marginTop: 10, letterSpacing: '0.1em' })}>
          {data.doneToday} of {data.total} today · last 30 days
        </div>
      </div>

      {BLOCKS.map((b) => {
        const block = data.blocks.find((x) => x.block === b)
        const items = block?.items ?? []
        return (
          <div key={b} style={section()}>
            <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between' }}>
              <span style={label()}>{BLOCK_LABEL[b]}</span>
              {items.length > 0 && (
                <span style={label(block!.done === items.length ? { color: T.good } : {})}>
                  {block!.done}/{items.length}
                </span>
              )}
            </div>

            {items.length === 0 && (
              <div style={{ ...body(14), color: T.muted, marginTop: 10 }}>Nothing here yet.</div>
            )}

            <div>
              {items.map((r) => (
                <RoutineRow key={r.id} routine={r} me={user.id} onToggle={() => toggle.mutate(r.id)} />
              ))}
            </div>

            {adding === b ? (
              <AddRoutine block={b} onDone={() => setAdding(null)} />
            ) : (
              <button onClick={() => setAdding(b)}
                      style={{ ...label({ color: T.accent }), background: 'none', border: 'none',
                               padding: '12px 0', cursor: 'pointer', minHeight: 42 }}>
                + Add routine
              </button>
            )}
          </div>
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
    <div>
      <div style={row()}>
        <button aria-label={routine.done ? 'Mark not done' : 'Mark done'} onClick={onToggle}
                style={checkbox(routine.done)}>
          {routine.done ? '✓' : ''}
        </button>

        <div onClick={() => setOpen((v) => !v)} style={{ flex: 1, minWidth: 0, cursor: 'pointer' }}>
          <div style={{ ...body(15), ...doneText(routine.done), wordBreak: 'break-word' }}>
            {routine.title}
            {routine.visibility === 'shared' && (
              <span style={{ ...label({ marginLeft: 8, letterSpacing: '0.1em' }) }}>shared</span>
            )}
          </div>
        </div>

        {/* Last 14 days inline, then the streak. Compact enough for a phone row. */}
        <Squares history={routine.history.slice(-14)} />
        {routine.streak > 0 && (
          <span style={{ ...label({ color: T.accent, letterSpacing: '0.06em', minWidth: 22, textAlign: 'right' }) }}>
            {routine.streak}
          </span>
        )}
      </div>

      {open && (
        <div style={{ padding: '0 0 14px 32px' }}>
          <Squares history={routine.history} wide />
          <div style={label({ marginTop: 9, letterSpacing: '0.08em' })}>
            {routine.last30} of last 30
            {routine.best > 0 && ` · best ${routine.best} day${routine.best === 1 ? '' : 's'}`}
          </div>
          <div style={{ display: 'flex', gap: 8, marginTop: 12, flexWrap: 'wrap' }}>
            <button
              onClick={() => update.mutate({ id: routine.id, patch: {
                visibility: routine.visibility === 'shared' ? 'private' : 'shared' } })}
              style={segment(routine.visibility === 'shared')}
            >
              {routine.visibility === 'shared' ? 'Shared' : 'Private'}
            </button>
            {BLOCKS.filter((b) => b !== routine.block).map((b) => (
              <button key={b} onClick={() => update.mutate({ id: routine.id, patch: { block: b } })}
                      style={segment(false)}>→ {BLOCK_LABEL[b]}</button>
            ))}
            {mine && (
              <button onClick={() => archive.mutate(routine.id)}
                      style={{ ...segment(false), color: T.bad, borderColor: 'rgba(239,68,68,0.35)' }}>
                Remove
              </button>
            )}
          </div>
          {mine && (
            <div style={label({ marginTop: 9, letterSpacing: '0.06em' })}>
              Removing hides it and keeps the history — your streak isn't lost
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

  return (
    <form
      onSubmit={async (e: FormEvent) => {
        e.preventDefault()
        const t = title.trim()
        if (!t || create.isPending) return
        setError(null)
        try {
          await create.mutateAsync({ title: t, block, visibility: shared ? 'shared' : 'private' })
          setTitle(''); onDone()
        } catch (err) {
          setError(err instanceof ApiError ? err.message : 'Could not add that.')
        }
      }}
      style={{ marginTop: 12 }}
    >
      <input style={input()} placeholder={`New ${BLOCK_LABEL[block].toLowerCase()} habit…`}
             value={title} onChange={(e) => setTitle(e.target.value)} autoFocus enterKeyHint="done" />
      <div style={{ display: 'flex', gap: 8, marginTop: 9, alignItems: 'center' }}>
        <button type="button" onClick={() => setShared((v) => !v)} style={segment(shared)}>
          {shared ? 'Shared' : 'Private'}
        </button>
        <button type="button" onClick={onDone} style={{ ...segment(false), marginLeft: 'auto' }}>Cancel</button>
        <button type="submit" disabled={!title.trim() || create.isPending}
                style={{ ...button(title.trim() ? 'primary' : 'ghost'), minHeight: 34,
                         padding: '7px 14px' }}>Add</button>
      </div>
      {error && <div style={label({ color: T.bad, marginTop: 9, letterSpacing: '0.06em' })}>{error}</div>}
    </form>
  )
}

// ── Charts ───────────────────────────────────────────────────────────────────

/** A run of small squares, one per day. Filled = done. */
function Squares({ history, wide }: { history: { day: string; done: boolean }[]; wide?: boolean }) {
  const s = wide ? 9 : 5
  return (
    <div style={{ display: 'flex', gap: 2, flexShrink: 0, flexWrap: wide ? 'wrap' : 'nowrap' }}>
      {history.map((d) => (
        <div key={d.day} title={d.day} style={{
          width: s, height: s, borderRadius: 1,
          // An empty square, not an absent one: a gap would read as missing
          // data rather than as a day you didn't do it.
          background: d.done ? T.ink : T.paperSunk,
        }} />
      ))}
    </div>
  )
}

/**
 * 30 days of household completion, as a thin trace.
 *
 * A line, not bars. The reference draws this as a barely-there rule that dips
 * on the days you missed — bars at full height turn a quiet background stat
 * into the loudest thing on the screen, which is backwards: the number beside
 * it is the point.
 */
function DayTrace({ history }: { history: { day: string; done: number; total: number }[] }) {
  if (history.length < 2) return null
  const W = 100, H = 22
  const pts = history.map((d, i) => {
    const pct = d.total ? d.done / d.total : 0
    return [(i / (history.length - 1)) * W, H - 2 - pct * (H - 4)] as const
  })
  const path = pts.map(([x, y], i) => `${i ? 'L' : 'M'}${x.toFixed(2)} ${y.toFixed(2)}`).join(' ')
  return (
    <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none"
         style={{ width: '100%', height: H, display: 'block', overflow: 'visible' }}>
      {/* The 100% line, so a dip reads as a dip from somewhere. */}
      <line x1={0} y1={2} x2={W} y2={2} stroke={T.paperSunk} strokeWidth={1}
            vectorEffect="non-scaling-stroke" />
      <path d={path} fill="none" stroke={T.accent} strokeWidth={1.25}
            strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
    </svg>
  )
}
