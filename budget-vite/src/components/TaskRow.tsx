import { useState } from 'react'
import type { Task, Person } from '../api'
import { useToggleDone, useToggleStar, useUpdateTask, useDeleteTask, useTouchTask } from '../hooks'
import { T, labelCap } from '../theme'

/**
 * One task row. Tap the circle to complete, tap the row to expand actions.
 *
 * Dates are compared as 'YYYY-MM-DD' STRINGS throughout — never parsed into a
 * Date. Lexicographic comparison on that format is chronological, and it can't
 * drift by a timezone the way `new Date('2026-08-10') < new Date()` does.
 */

export function dueLabel(due: string | null, today: string): { text: string; color: string } | null {
  if (!due) return null
  if (due < today) {
    // Day difference computed at UTC noon on both ends, so a DST boundary
    // between the two dates can't round the result to the wrong day.
    const days = Math.round(
      (Date.parse(`${today}T12:00:00Z`) - Date.parse(`${due}T12:00:00Z`)) / 86_400_000)
    return { text: days === 1 ? 'Yesterday' : `${days}d overdue`, color: T.red }
  }
  if (due === today) return { text: 'Today', color: T.orange }
  const days = Math.round(
    (Date.parse(`${due}T12:00:00Z`) - Date.parse(`${today}T12:00:00Z`)) / 86_400_000)
  if (days === 1) return { text: 'Tomorrow', color: T.accent }
  if (days <= 7) return { text: `${days}d`, color: T.muted }
  const [, m, d] = due.split('-')
  return { text: `${Number(m)}/${Number(d)}`, color: T.muted }
}

export default function TaskRow({
  task, today, me, people, showOwner = true,
}: {
  task: Task
  today: string
  me: number
  people: Person[]
  showOwner?: boolean
}) {
  const [open, setOpen] = useState(false)
  const toggleDone = useToggleDone()
  const toggleStar = useToggleStar()
  const update = useUpdateTask()
  const remove = useDeleteTask()
  const touch = useTouchTask()

  const due = dueLabel(task.due_date, today)
  const mine = task.owner_id === me
  const ownerName = people.find((p) => p.id === task.owner_id)?.displayName
  const done = !!task.done_at

  return (
    <div style={{ borderBottom: `1px solid ${T.border}` }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12, padding: '12px 2px' }}>
        {/* Complete. Its own 44px hit area so it never steals a tap meant for
            the row, and never gets stolen by one. */}
        <button
          aria-label={done ? 'Mark not done' : 'Mark done'}
          onClick={(e) => { e.stopPropagation(); toggleDone.mutate(task.id) }}
          style={{
            flexShrink: 0, width: 24, height: 24, marginTop: 1, padding: 0,
            borderRadius: '50%', cursor: 'pointer', background: done ? T.green : 'transparent',
            border: `2px solid ${done ? T.green : 'rgba(255,255,255,0.35)'}`,
            display: 'grid', placeItems: 'center', color: T.ink, fontSize: 13, fontWeight: 900,
          }}
        >
          {done ? '✓' : ''}
        </button>

        <div onClick={() => setOpen((v) => !v)} style={{ flex: 1, minWidth: 0, cursor: 'pointer' }}>
          <div style={{
            fontSize: 15, fontWeight: 600, lineHeight: 1.35,
            color: done ? T.muted : T.text, textDecoration: done ? 'line-through' : 'none',
            wordBreak: 'break-word',
          }}>
            {task.title}
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginTop: 4 }}>
            {due && <span style={{ fontSize: 12, fontWeight: 800, color: due.color }}>{due.text}</span>}
            {task.visibility === 'shared' && (
              <span style={{
                fontSize: 10, fontWeight: 800, letterSpacing: '0.1em', textTransform: 'uppercase',
                color: T.cyan, border: `1px solid rgba(33,158,188,0.4)`, borderRadius: 6, padding: '1px 5px',
              }}>
                {/* Whose it is only matters once it's shared. */}
                {showOwner && ownerName && !mine ? ownerName : 'Shared'}
              </span>
            )}
            {task.project && <span style={{ fontSize: 12, color: T.muted }}>{task.project}</span>}
          </div>
        </div>

        <button
          aria-label={task.starred ? 'Unstar' : 'Star'}
          onClick={(e) => { e.stopPropagation(); toggleStar.mutate(task.id) }}
          style={{
            flexShrink: 0, width: 32, height: 32, padding: 0, border: 'none', background: 'transparent',
            cursor: 'pointer', fontSize: 17, lineHeight: 1,
            color: task.starred ? T.orange : 'rgba(255,255,255,0.22)',
          }}
        >
          ★
        </button>
      </div>

      {open && (
        <div style={{ padding: '0 2px 14px 36px', display: 'flex', flexDirection: 'column', gap: 10 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
            <span style={labelCap()}>Due</span>
            <input
              type="date"
              value={task.due_date ?? ''}
              onChange={(e) => update.mutate({ id: task.id, patch: { dueDate: e.target.value || null } })}
              style={{
                background: 'rgba(255,255,255,0.05)', border: `1px solid ${T.hairline}`,
                borderRadius: 8, color: T.text, padding: '7px 10px', fontSize: 15, minHeight: 38,
              }}
            />
            {task.due_date && (
              <button onClick={() => update.mutate({ id: task.id, patch: { dueDate: null } })}
                      style={miniBtn()}>Clear</button>
            )}
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
            <button
              onClick={() => update.mutate({
                id: task.id,
                patch: { visibility: task.visibility === 'shared' ? 'private' : 'shared' },
              })}
              style={miniBtn(task.visibility === 'shared')}
            >
              {task.visibility === 'shared' ? '✓ Shared' : 'Share'}
            </button>
            <button onClick={() => touch.mutate(task.id)} style={miniBtn()}>Still on it</button>
            {mine && (
              <button
                onClick={() => remove.mutate(task.id)}
                style={{ ...miniBtn(), color: T.red, borderColor: 'rgba(239,68,68,0.35)' }}
              >
                Delete
              </button>
            )}
          </div>

          {!mine && (
            <div style={{ fontSize: 12, color: T.muted, opacity: 0.7 }}>
              Added by {ownerName ?? 'someone else'} — only they can delete it.
            </div>
          )}
        </div>
      )}
    </div>
  )
}

function miniBtn(active = false): React.CSSProperties {
  return {
    appearance: 'none',
    background: active ? 'rgba(33,158,188,0.18)' : 'transparent',
    border: `1px solid ${active ? 'rgba(33,158,188,0.5)' : T.hairline}`,
    color: T.text, borderRadius: 9, minHeight: 38, padding: '8px 13px',
    fontSize: 13, fontWeight: 700, cursor: 'pointer',
  }
}
