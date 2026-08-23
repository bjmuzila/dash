import { useState } from 'react'
import type { Task, Person } from '../api'
import { useToggleDone, useToggleStar, useUpdateTask, useDeleteTask, useTouchTask } from '../hooks'
import { T, label, body, row, checkbox, doneText, segment, input } from '../theme'

/**
 * One task row. Tap the square to complete, tap the row to expand actions.
 *
 * Dates are compared as 'YYYY-MM-DD' STRINGS throughout — never parsed into a
 * Date. Lexicographic comparison on that format is chronological, and it can't
 * drift by a timezone the way `new Date('2026-08-10') < new Date()` does.
 */

export function dueLabel(due: string | null, today: string): { text: string; overdue: boolean } | null {
  if (!due) return null
  if (due < today) {
    // Day difference computed at UTC noon on both ends, so a DST boundary
    // between the two dates can't round the result to the wrong day.
    const days = Math.round(
      (Date.parse(`${today}T12:00:00Z`) - Date.parse(`${due}T12:00:00Z`)) / 86_400_000)
    return { text: days === 1 ? 'Overdue 1d' : `Overdue ${days}d`, overdue: true }
  }
  if (due === today) return { text: 'Due today', overdue: false }
  const days = Math.round(
    (Date.parse(`${due}T12:00:00Z`) - Date.parse(`${today}T12:00:00Z`)) / 86_400_000)
  if (days === 1) return { text: 'Due tomorrow', overdue: false }
  if (days <= 7) return { text: `Due in ${days}d`, overdue: false }
  const [, m, d] = due.split('-')
  return { text: `Due ${Number(m)}/${Number(d)}`, overdue: false }
}

export default function TaskRow({
  task, today, me, people,
}: { task: Task; today: string; me: number; people: Person[] }) {
  const [open, setOpen] = useState(false)
  const toggleDone = useToggleDone()
  const toggleStar = useToggleStar()
  const update = useUpdateTask()
  const remove = useDeleteTask()
  const touch = useTouchTask()

  const due = dueLabel(task.due_date, today)
  // `created_by`, not an owner: on daily.cbedge.net a row belongs to the
  // HOUSEHOLD, and who typed it is display only. It never gates an action — both
  // people can edit and complete anything, which is the point of a shared list.
  const mine = task.created_by === me
  const authorName = people.find((p) => p.id === task.created_by)?.displayName
  const done = !!task.done_at

  // The meta line is one mono string of · separated facts, like the reference.
  const meta: { text: string; accent?: boolean; urgent?: boolean }[] = []
  // Urgent leads the meta line and is RED. An overdue date next to it stays
  // orange — two different facts, two different colours, never merged.
  if (task.urgent && !done) meta.push({ text: 'Urgent', urgent: true })
  if (due) meta.push({ text: due.text, accent: due.overdue })
  // No "Shared" chip: everything is shared, so the word carries no information
  // and printed on every row it is pure noise. WHO added it still does — but
  // only when it wasn't you.
  if (!mine && authorName) meta.push({ text: authorName })
  // The old app carried a free-text `project` string alongside the real
  // project_id foreign key, and the two drifted constantly. Only the id
  // survived; the Projects screen owns the name.

  return (
    <div>
      <div style={row({ alignItems: 'flex-start' })}>
        {/* Complete. Its own 44px hit area so it never steals a tap meant for
            the row, and never gets stolen by one. */}
        <button
          aria-label={done ? 'Mark not done' : 'Mark done'}
          onClick={(e) => { e.stopPropagation(); toggleDone.mutate(task.id) }}
          style={{ ...checkbox(done), marginTop: 1 }}
        >
          {done ? '✓' : ''}
        </button>

        <div onClick={() => setOpen((v) => !v)} style={{ flex: 1, minWidth: 0, cursor: 'pointer' }}>
          <div style={{ ...body(15), ...doneText(done), wordBreak: 'break-word' }}>{task.title}</div>
          {meta.length > 0 && (
            <div style={{ ...label({ marginTop: 5, letterSpacing: '0.1em' }) }}>
              {meta.map((m, i) => (
                <span key={i} style={{ color: m.urgent ? T.bad : m.accent ? T.warn : T.muted,
                                       fontWeight: m.urgent ? 700 : undefined }}>
                  {i > 0 && <span style={{ color: T.faint }}> · </span>}
                  {m.text}
                </span>
              ))}
            </div>
          )}
        </div>

        <button
          aria-label={task.starred ? 'Unstar' : 'Star'}
          onClick={(e) => { e.stopPropagation(); toggleStar.mutate(task.id) }}
          style={{
            flexShrink: 0, width: 32, minHeight: 32, padding: 0, border: 'none',
            background: 'transparent', cursor: 'pointer', fontSize: 15, lineHeight: 1,
            color: task.starred ? T.accent : T.faint,
          }}
        >
          {task.starred ? '★' : '☆'}
        </button>
      </div>

      {open && (
        <div style={{ padding: '0 0 14px 32px', display: 'flex', flexDirection: 'column', gap: 10 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
            <span style={label()}>Due</span>
            <input
              type="date" value={task.due_date ?? ''}
              onChange={(e) => update.mutate({ id: task.id, patch: { dueDate: e.target.value || null } })}
              style={{ ...input(), width: 'auto', flex: 'none', minHeight: 34, padding: '6px 9px', fontSize: 14 }}
            />
            {task.due_date && (
              <button onClick={() => update.mutate({ id: task.id, patch: { dueDate: null } })}
                      style={segment(false)}>Clear</button>
            )}
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            {/* The Shared/Private switch lived here. There is no such switch any
                more: a row belongs to the household, full stop. */}
            <button onClick={() => touch.mutate(task.id)} style={segment(false)}>Still on it</button>
            {/* Delete is NOT gated on who added it. The private app restricted it
                to the row's owner because it had per-row owners; here the
                household is the unit, and a shared list only one of you may tidy
                up is the failure mode this product exists to prevent. The server
                agrees — see the delete branch in daily-routes.cjs. */}
            <button onClick={() => remove.mutate(task.id)}
                    style={{ ...segment(false), color: T.bad, borderColor: 'rgba(239,68,68,0.35)' }}>
              Delete
            </button>
          </div>

          {!mine && authorName && (
            <div style={label({ letterSpacing: '0.06em' })}>Added by {authorName}</div>
          )}
        </div>
      )}
    </div>
  )
}
