import { useState, type FormEvent } from 'react'
import { useAuth } from '../auth'
import {
  useProjects, useProject, useCreateProject, useUpdateProject, useArchiveProject,
  useAddMilestone, useToggleMilestone, useDeleteMilestone, useLogTime, useDeleteTime,
} from '../hooks'
import { ApiError, type Project, type ProjectStatus } from '../api'
import { T, label, body, display, hero, section, input, button } from '../theme'

/**
 * Projects.
 *
 * The progress bar reads MILESTONES, never tasks — a project with 40 chores and
 * 3 real milestones would otherwise show 80% done the moment you cleared the
 * easy chores. A project with no milestones shows no bar at all rather than a
 * confident 0%.
 *
 * List and detail are one screen with a selected id, not two routes: on a phone
 * you're bouncing in and out of a project constantly, and a full route change
 * loses your scroll position every time.
 */

const fmtHours = (mins: number) => {
  if (!mins) return '0h'
  const h = Math.floor(Math.abs(mins) / 60)
  const m = Math.abs(mins) % 60
  const sign = mins < 0 ? '-' : ''
  return h ? `${sign}${h}h${m ? ` ${m}m` : ''}` : `${sign}${m}m`
}

/** "Oct 1" from "2026-10-01" — sliced, never parsed. */
const shortDate = (iso: string) => {
  const [y, m, d] = iso.split('-').map(Number)
  return new Date(y, m - 1, d).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

export default function Projects() {
  const [openId, setOpenId] = useState<number | null>(null)
  const [showArchived, setShowArchived] = useState(false)
  const [adding, setAdding] = useState(false)
  const { data, isLoading, error, refetch } = useProjects(showArchived)

  if (openId) return <Detail id={openId} onBack={() => setOpenId(null)} />

  if (isLoading) {
    return <div style={{ color: T.muted, fontSize: 14, padding: '30px 0', textAlign: 'center' }}>Loading…</div>
  }
  if (error) {
    return (
      <section style={section()}>
        <div style={{ color: T.bad, fontWeight: 700, fontSize: 15 }}>
          {error instanceof ApiError ? error.message : 'Something went wrong.'}
        </div>
        <button onClick={() => void refetch()} style={{ ...button('ghost'), marginTop: 12 }}>Try again</button>
      </section>
    )
  }

  const list = data?.projects ?? []

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      {adding ? <NewProject onDone={() => setAdding(false)} /> : (
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
          <span style={label()}>{list.length} project{list.length === 1 ? '' : 's'}</span>
          <button onClick={() => setAdding(true)} style={textBtn}>+ New project</button>
        </div>
      )}

      {list.length === 0 && (
        <section style={section()}>
          <div style={{ fontSize: 14, color: T.muted, lineHeight: 1.5 }}>
            Nothing here yet. A project is anything with more than one step —
            add milestones and the bar tracks the ones that actually matter.
          </div>
        </section>
      )}

      {list.map((p) => <Card key={p.id} project={p} onOpen={() => setOpenId(p.id)} />)}

      <button onClick={() => setShowArchived((v) => !v)}
              style={{ ...textBtn, color: T.muted, alignSelf: 'flex-start' }}>
        {showArchived ? 'Hide archived' : 'Show archived'}
      </button>
    </div>
  )
}

function Card({ project, onOpen }: { project: Project; onOpen: () => void }) {
  const p = project
  const meta = [
    // Kept terse: this line is mono uppercase, which is wide, and a phone at
    // 390px wraps it to two ragged lines the moment it gets wordy.
    p.progress !== null ? `${p.milestones.done}/${p.milestones.total} done` : null,
    p.tasks.open > 0 ? `${p.tasks.open} open` : null,
    p.minutes > 0 ? fmtHours(p.minutes) : null,
    p.status !== 'active' ? p.status : null,
  ].filter(Boolean) as string[]

  return (
    <div onClick={onOpen} style={section({ cursor: 'pointer', opacity: p.archived_at ? 0.5 : 1 })}>
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 10 }}>
        <div style={{ ...display(18), wordBreak: 'break-word' }}>
          {p.name}
          {p.visibility === 'shared' && (
            <span style={label({ marginLeft: 9, letterSpacing: '0.1em' })}>shared</span>
          )}
        </div>
        {p.progress !== null && (
          <div style={{ ...hero(20), flexShrink: 0, color: p.progress === 100 ? T.good : T.ink }}>
            {p.progress}<span style={{ fontSize: 11, color: T.muted }}>%</span>
          </div>
        )}
      </div>

      {/* No milestones = no bar. A 0% bar on a project you've barely defined
          reads as failure rather than as "not measured yet". */}
      {p.progress !== null ? (
        <div style={{ height: 2, background: T.paperSunk, marginTop: 10 }}>
          <div style={{ width: `${p.progress}%`, height: '100%',
                        background: p.progress === 100 ? T.good : T.accent }} />
        </div>
      ) : (
        <div style={label({ marginTop: 9, letterSpacing: '0.08em' })}>No milestones yet</div>
      )}

      <div style={label({ marginTop: 10, letterSpacing: '0.1em', lineHeight: 1.7 })}>
        {meta.map((m, i) => (
          <span key={i}>{i > 0 && <span style={{ color: T.faint }}> · </span>}{m}</span>
        ))}
        {p.target_date && (
          <span style={{ color: T.warn }}>
            {meta.length > 0 && <span style={{ color: T.faint }}> · </span>}
            by {shortDate(p.target_date)}
          </span>
        )}
      </div>
    </div>
  )
}

const textBtn: React.CSSProperties = {
  ...label({ color: T.accent }),
  background: 'none', border: 'none', cursor: 'pointer',
  padding: '10px 0', minHeight: 40, textAlign: 'left',
}

// ── Detail ───────────────────────────────────────────────────────────────────

function Detail({ id, onBack }: { id: number; onBack: () => void }) {
  const { user } = useAuth()
  const { data, isLoading } = useProject(id)
  const addMilestone = useAddMilestone()
  const toggleMilestone = useToggleMilestone()
  const delMilestone = useDeleteMilestone()
  const logTime = useLogTime()
  const delTime = useDeleteTime()
  const update = useUpdateProject()
  const archive = useArchiveProject()

  const [msTitle, setMsTitle] = useState('')
  const [mins, setMins] = useState('')
  const [note, setNote] = useState('')

  if (isLoading || !data) {
    return <div style={{ color: T.muted, fontSize: 14, padding: '30px 0', textAlign: 'center' }}>Loading…</div>
  }
  const p = data.project
  const mine = p.owner_id === user?.id

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <button onClick={onBack} style={{ ...textBtn, color: T.muted }}>‹ All projects</button>

      <section style={section()}>
        <div style={{ ...display(24), wordBreak: 'break-word' }}>{p.name}</div>
        {p.description && (
          <div style={{ ...body(14), color: T.inkSoft, marginTop: 8 }}>{p.description}</div>
        )}
        {p.progress !== null && (
          <>
            <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginTop: 14 }}>
              <div style={label()}>Progress</div>
              <div style={{ ...hero(26), color: p.progress === 100 ? T.good : T.ink }}>
                {p.progress}<span style={{ fontSize: 12, color: T.muted }}>%</span>
              </div>
            </div>
            <div style={{ height: 3, background: T.paperSunk, marginTop: 10 }}>
              <div style={{ width: `${p.progress}%`, height: '100%', background: p.progress === 100 ? T.good : T.accent }} />
            </div>
          </>
        )}
        <div style={{ ...label({ marginTop: 12, letterSpacing: '0.1em' }), display: 'flex', gap: 14, flexWrap: 'wrap' }}>
          <span>{fmtHours(p.minutes)} total</span>
          {p.minutesThisWeek > 0 && <span>{fmtHours(p.minutesThisWeek)} this week</span>}
          {p.target_date && <span style={{ color: T.accent }}>target {shortDate(p.target_date)}</span>}
        </div>
      </section>

      <section style={section()}>
        <div style={label()}>Milestones</div>
        <div style={{ fontSize: 12, color: T.muted, marginTop: 6, lineHeight: 1.4 }}>
          The few things that mean real progress — not every small task.
        </div>
        <div style={{ marginTop: 8 }}>
          {p.milestones.map((m) => (
            <div key={m.id} style={{ display: 'flex', alignItems: 'center', gap: 11, padding: '11px 0', borderTop: `1px solid ${T.rule}` }}>
              <button
                onClick={() => toggleMilestone.mutate(m.id)}
                aria-label={m.done_at ? 'Mark not done' : 'Mark done'}
                style={{
                  flexShrink: 0, width: 24, height: 24, padding: 0, borderRadius: 7, cursor: 'pointer',
                  background: m.done_at ? T.good : 'transparent',
                  border: `2px solid ${m.done_at ? T.good : T.ruleStrong}`,
                  display: 'grid', placeItems: 'center', color: T.ink, fontSize: 13, fontWeight: 900,
                }}
              >
                {m.done_at ? '✓' : ''}
              </button>
              <span style={{
                flex: 1, minWidth: 0, fontSize: 14, wordBreak: 'break-word',
                color: m.done_at ? T.muted : T.ink,
                textDecoration: m.done_at ? 'line-through' : 'none',
              }}>
                {m.title}
              </span>
              <button onClick={() => delMilestone.mutate(m.id)} aria-label="Delete milestone"
                      style={{ flexShrink: 0, background: 'transparent', border: 'none', cursor: 'pointer',
                               color: T.muted, fontSize: 18, padding: '0 4px', minHeight: 32 }}>×</button>
            </div>
          ))}
        </div>
        <form onSubmit={(e: FormEvent) => {
          e.preventDefault()
          if (!msTitle.trim()) return
          addMilestone.mutate({ id: p.id, title: msTitle.trim() })
          setMsTitle('')
        }} style={{ display: 'flex', gap: 8, marginTop: 12 }}>
          <input style={{ ...input(), flex: 1 }} placeholder="Add a milestone…"
                 value={msTitle} onChange={(e) => setMsTitle(e.target.value)} />
          <button type="submit" disabled={!msTitle.trim()}
                  style={{ ...button(msTitle.trim() ? 'primary' : 'ghost'), padding: '12px 16px' }}>Add</button>
        </form>
      </section>

      {p.tasks.length > 0 && (
        <section style={section()}>
          <div style={label()}>Tasks</div>
          <div style={{ marginTop: 8 }}>
            {p.tasks.map((t) => (
              <div key={t.id} style={{ display: 'flex', gap: 10, padding: '9px 0', borderTop: `1px solid ${T.rule}`, fontSize: 14 }}>
                <span style={{ color: t.done_at ? T.good : T.muted, flexShrink: 0 }}>{t.done_at ? '✓' : '○'}</span>
                <span style={{
                  flex: 1, minWidth: 0, wordBreak: 'break-word',
                  color: t.done_at ? T.muted : T.ink,
                  textDecoration: t.done_at ? 'line-through' : 'none',
                }}>{t.title}</span>
              </div>
            ))}
          </div>
        </section>
      )}

      <section style={section()}>
        <div style={label()}>Time</div>
        <form onSubmit={(e: FormEvent) => {
          e.preventDefault()
          const n = Number(mins)
          if (!Number.isFinite(n) || n === 0) return
          logTime.mutate({ id: p.id, minutes: n, note: note.trim() || undefined })
          setMins(''); setNote('')
        }} style={{ marginTop: 10 }}>
          <div style={{ display: 'flex', gap: 8 }}>
            <input style={{ ...input(), width: 110, flex: 'none' }} type="number" inputMode="numeric"
                   placeholder="mins" value={mins} onChange={(e) => setMins(e.target.value)} />
            <input style={{ ...input(), flex: 1 }} placeholder="What on? (optional)"
                   value={note} onChange={(e) => setNote(e.target.value)} />
            <button type="submit" disabled={!mins}
                    style={{ ...button(mins ? 'primary' : 'ghost'), padding: '12px 14px' }}>Log</button>
          </div>
          <div style={{ display: 'flex', gap: 6, marginTop: 8 }}>
            {[15, 30, 60, 120].map((q) => (
              <button key={q} type="button" onClick={() => setMins(String(q))}
                      style={{ flex: 1, appearance: 'none', minHeight: 36, borderRadius: 8,
                               border: `1px solid ${T.ruleStrong}`, background: 'transparent',
                               color: T.muted, fontSize: 12, fontWeight: 700, cursor: 'pointer' }}>
                {q < 60 ? `${q}m` : `${q / 60}h`}
              </button>
            ))}
          </div>
        </form>

        {p.timeEntries.length > 0 && (
          <div style={{ marginTop: 14 }}>
            {p.timeEntries.slice(0, 10).map((e) => (
              <div key={e.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 0', borderTop: `1px solid ${T.rule}`, fontSize: 13 }}>
                <span style={{ width: 46, flexShrink: 0, color: T.muted, fontWeight: 700 }}>{shortDate(e.day)}</span>
                <span style={{ flex: 1, minWidth: 0, color: T.muted, wordBreak: 'break-word' }}>{e.note || '—'}</span>
                <span style={{ fontWeight: 800, color: e.minutes < 0 ? T.bad : T.ink }}>{fmtHours(e.minutes)}</span>
                {e.user_id === user?.id && (
                  <button onClick={() => delTime.mutate(e.id)} aria-label="Delete entry"
                          style={{ background: 'transparent', border: 'none', cursor: 'pointer',
                                   color: T.muted, fontSize: 16, padding: '0 2px', minHeight: 30 }}>×</button>
                )}
              </div>
            ))}
          </div>
        )}
      </section>

      <section style={section()}>
        <div style={label()}>Project</div>
        <div style={{ display: 'flex', gap: 8, marginTop: 12, flexWrap: 'wrap' }}>
          {(['active', 'someday', 'done'] as ProjectStatus[]).map((s) => (
            <button key={s} onClick={() => update.mutate({ id: p.id, patch: { status: s } })}
                    style={mini(p.status === s)}>{s}</button>
          ))}
          <button onClick={() => update.mutate({ id: p.id, patch: {
            visibility: p.visibility === 'shared' ? 'private' : 'shared',
          } })} style={mini(p.visibility === 'shared')}>
            {p.visibility === 'shared' ? '✓ Shared' : 'Share'}
          </button>
        </div>
        {mine && (
          <button onClick={() => { archive.mutate({ id: p.id, archived: !p.archived_at }); onBack() }}
                  style={{ ...button('ghost'), width: '100%', marginTop: 12, color: T.muted }}>
            {p.archived_at ? 'Un-archive' : 'Archive'}
          </button>
        )}
      </section>
    </div>
  )
}

// ── New ──────────────────────────────────────────────────────────────────────

function NewProject({ onDone }: { onDone: () => void }) {
  const create = useCreateProject()
  const [name, setName] = useState('')
  const [target, setTarget] = useState('')
  const [shared, setShared] = useState(false)
  const [error, setError] = useState<string | null>(null)

  return (
    <form
      onSubmit={async (e: FormEvent) => {
        e.preventDefault()
        if (!name.trim() || create.isPending) return
        setError(null)
        try {
          await create.mutateAsync({
            name: name.trim(), targetDate: target || null,
            visibility: shared ? 'shared' : 'private',
          })
          onDone()
        } catch (err) {
          setError(err instanceof ApiError ? err.message : 'Could not create that.')
        }
      }}
      style={section({ padding: 14 })}
    >
      <div style={label({ marginBottom: 10 })}>New project</div>
      <input style={{ ...input(), marginBottom: 10 }} placeholder="Project name"
             value={name} onChange={(e) => setName(e.target.value)} autoFocus />
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 12 }}>
        <input style={{ ...input(), flex: 1 }} type="date" value={target}
               onChange={(e) => setTarget(e.target.value)} />
        <button type="button" onClick={() => setShared((v) => !v)} style={mini(shared)}>
          {shared ? '✓ Shared' : 'Private'}
        </button>
      </div>
      {error && <div style={{ color: T.bad, fontSize: 13, fontWeight: 600, marginBottom: 10 }}>{error}</div>}
      <div style={{ display: 'flex', gap: 8 }}>
        <button type="button" onClick={onDone} style={{ ...button('ghost'), flex: 1 }}>Cancel</button>
        <button type="submit" disabled={!name.trim() || create.isPending}
                style={{ ...button(name.trim() ? 'primary' : 'ghost'), flex: 1 }}>Create</button>
      </div>
    </form>
  )
}

const mini = (active = false): React.CSSProperties => ({
  appearance: 'none',
  background: active ? 'transparent' : 'transparent',
  border: `1px solid ${active ? T.ink : T.ruleStrong}`,
  color: T.ink, borderRadius: 9, minHeight: 38, padding: '8px 13px',
  fontSize: 13, fontWeight: 700, cursor: 'pointer', textTransform: 'capitalize',
})
