import { useCallback, useEffect, useRef, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { Card } from '@/design/primitives/Card'
import { Page } from '@/design/primitives/Page'
import { SegGroup } from '@/design/primitives/Controls'
import {
  CATEGORY_LABEL,
  CATEGORY_OPTIONS,
  FIELD,
  SEND_BTN,
  ShotTray,
  StatusChip,
  Thread,
  UnreadDot,
  fmtWhen,
  num,
  useShotDrop,
} from '@/pages/feedback/Thread'
import type {
  FeedbackCategory,
  FeedbackMessage,
  FeedbackTicket,
} from '@/pages/feedback/Thread'
import type { FeedbackShot, PendingShot } from '@/pages/feedback/shots'

// ─────────────────────────────────────────────────────────────────────────────
// /feedback — SUPPORT TICKETS, the customer side.
//
// Ported from the Next page at /feedback (app/feedback/page.tsx) on 2026-09-09.
// That page still exists and still works — it is what the v2 wing links to —
// but the account menu in v3's toolbar points here now, so a customer who is in
// v3 stays in v3 rather than being dropped onto a page wearing the other app's
// chrome mid-conversation.
//
// Sending feedback is not fire-and-forget. Every submission opens a TICKET the
// customer keeps: it lands Open, both sides trade replies on it, and it closes
// when CB Edge marks it complete. A customer reply on a closed ticket reopens it
// — the SERVER does that, not this page.
//
// Two views, one card: "New" (the form) and "My tickets" (the list, and a thread
// when one is picked). ?tab=mine and ?ticket=<id> are the deep links the account
// menu and the unread badge use, and they live in the query string so a link to
// a ticket is shareable and Back works.
//
// SCOPE=MINE, ALWAYS. This page is "my tickets". Without that parameter the
// OWNER opening their own support page gets the entire customer queue rendered
// as if they had written every word of it; the inbox is a different surface
// (owner.cbedge.net).
//
// REST + a poll, no socket: a support thread moves at human speed.
// ─────────────────────────────────────────────────────────────────────────────

/** An open thread is polled — an owner reply should land without a refresh. */
const THREAD_POLL_MS = 15_000

type Tab = 'new' | 'mine'

interface ThreadPayload {
  ticket: FeedbackTicket
  messages: FeedbackMessage[]
  shots: FeedbackShot[]
  isOwner: boolean
  isAuthor: boolean
}

export default function Feedback() {
  const [params, setParams] = useSearchParams()
  const openId = Number(params.get('ticket') ?? 0) || null
  const tab: Tab = params.get('tab') === 'mine' || openId ? 'mine' : 'new'

  // ── new-ticket form ────────────────────────────────────────────────────────
  const [category, setCategory] = useState<FeedbackCategory>('note')
  const [message, setMessage] = useState('')
  const [shots, setShots] = useState<PendingShot[]>([])
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // ── list + open thread ─────────────────────────────────────────────────────
  const [tickets, setTickets] = useState<FeedbackTicket[]>([])
  const [unread, setUnread] = useState(0)
  const [listLoaded, setListLoaded] = useState(false)
  const [thread, setThread] = useState<ThreadPayload | null>(null)
  const [sending, setSending] = useState(false)

  // Guards a poll response landing after the selection moved on.
  const openIdRef = useRef<number | null>(null)
  openIdRef.current = openId

  // Paste/drag onto the NEW-ticket form. The thread's composer has its own copy
  // inside Thread — different drafts cannot share one queue.
  const { over: dragOver, handlers: dropHandlers } = useShotDrop(shots, setShots, setError)

  const go = useCallback(
    (next: { tab?: Tab; ticket?: number | null }) => {
      const p = new URLSearchParams(params)
      if (next.tab) p.set('tab', next.tab)
      if (next.ticket) p.set('ticket', String(next.ticket))
      else if (next.ticket === null) p.delete('ticket')
      setParams(p, { replace: true })
    },
    [params, setParams],
  )

  const loadList = useCallback(async () => {
    try {
      const res = await fetch('/api/feedback?scope=mine', {
        cache: 'no-store',
        credentials: 'same-origin',
      })
      if (!res.ok) throw new Error(String(res.status))
      const j = (await res.json()) as { items?: FeedbackTicket[]; unreadCount?: number | string }
      setTickets(Array.isArray(j?.items) ? j.items : [])
      setUnread(num(j?.unreadCount))
    } catch {
      /* the list is a convenience — a failure here must not block sending */
    } finally {
      setListLoaded(true)
    }
  }, [])

  const loadThread = useCallback(async (id: number) => {
    try {
      const res = await fetch(`/api/feedback/${id}`, {
        cache: 'no-store',
        credentials: 'same-origin',
      })
      if (!res.ok) throw new Error(String(res.status))
      const j = (await res.json()) as Partial<ThreadPayload>
      if (openIdRef.current !== id || !j.ticket) return // moved on while in flight
      setThread({
        ticket: j.ticket,
        messages: Array.isArray(j.messages) ? j.messages : [],
        shots: Array.isArray(j.shots) ? j.shots : [],
        isOwner: Boolean(j.isOwner),
        isAuthor: Boolean(j.isAuthor),
      })
    } catch {
      /* keep whatever is already on screen */
    }
  }, [])

  useEffect(() => {
    void loadList()
  }, [loadList])

  useEffect(() => {
    if (openId == null) {
      setThread(null)
      return
    }
    void loadThread(openId)
    const t = window.setInterval(() => {
      if (!document.hidden) void loadThread(openId)
    }, THREAD_POLL_MS)
    return () => window.clearInterval(t)
  }, [openId, loadThread])

  async function submit() {
    const msg = message.trim()
    // A screenshot on its own is a perfectly good ticket — the server takes it
    // and titles the row — so words are only required when nothing is attached.
    if (!msg && shots.length === 0) {
      setError('Write a message or attach a screenshot first.')
      return
    }
    setSubmitting(true)
    setError(null)
    try {
      const res = await fetch('/api/feedback', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({
          category,
          message: msg,
          page: '/v3/feedback',
          shots: shots.map((s) => ({ dataUrl: s.dataUrl, name: s.name })),
        }),
      })
      if (!res.ok) {
        const j = (await res.json().catch(() => ({}))) as { error?: string }
        throw new Error(j?.error || `Failed (${res.status})`)
      }
      const j = (await res.json().catch(() => ({}))) as { id?: number; feedback?: { id?: number } }
      setMessage('')
      setShots([])
      await loadList()
      // Drop straight into the ticket that was just opened — that IS the
      // confirmation, and it shows where the reply will arrive.
      const id = Number(j?.id ?? j?.feedback?.id ?? 0)
      go({ tab: 'mine', ticket: id > 0 ? id : null })
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Something went wrong.')
    } finally {
      setSubmitting(false)
    }
  }

  async function reply(text: string, replyShots: PendingShot[]) {
    if (openId == null) return
    setSending(true)
    setError(null)
    try {
      const res = await fetch(`/api/feedback/${openId}/messages`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({
          message: text,
          shots: replyShots.map((s) => ({ dataUrl: s.dataUrl, name: s.name })),
        }),
      })
      if (!res.ok) {
        const j = (await res.json().catch(() => ({}))) as { error?: string }
        throw new Error(j?.error || `Failed (${res.status})`)
      }
      await loadThread(openId)
      await loadList()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Reply failed.')
    } finally {
      setSending(false)
    }
  }

  const tabs: Array<{ value: Tab; label: string }> = [
    { value: 'new', label: '✍ New' },
    { value: 'mine', label: `📬 My tickets${tickets.length ? ` (${tickets.length})` : ''}` },
  ]

  return (
    <Page
      title="Feedback & Support"
      actions={
        <div className="relative flex items-center">
          <SegGroup<Tab>
            options={tabs}
            value={tab}
            onChange={(v) => {
              setError(null)
              go({ tab: v, ticket: null })
            }}
          />
          {unread > 0 && (
            <span className="absolute -right-2 -top-2">
              <UnreadDot count={unread} />
            </span>
          )}
        </div>
      }
    >
      <p className="max-w-3xl text-xs leading-relaxed text-muted">
        Every bug you flag, idea you share or note you leave shapes CB Edge. Send one and it opens a
        ticket you keep — replies land right here, and the badge on your avatar lights up when there
        is one waiting.
      </p>

      {error && <p className="text-xs font-semibold text-down">{error}</p>}

      {/* ── NEW TICKET ─────────────────────────────────────────────────────── */}
      {tab === 'new' && (
        <Card title="Open a ticket" expandable={false}>
          <div className="flex flex-col gap-3" {...dropHandlers}>
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-2xs font-bold uppercase tracking-wide text-faint">Type</span>
              <SegGroup<FeedbackCategory>
                options={CATEGORY_OPTIONS}
                value={category}
                onChange={setCategory}
              />
            </div>

            <textarea
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              placeholder="What's on your mind?"
              rows={7}
              maxLength={5000}
              className={[
                FIELD,
                'resize-y font-sans leading-relaxed',
                // The drop target is the whole block, so say so on the part the
                // cursor is actually over.
                dragOver ? 'border-accent' : '',
              ].join(' ')}
            />
            <span className="text-right text-2xs text-faint">{message.length}/5000</span>

            <ShotTray
              pending={shots}
              setPending={setShots}
              disabled={submitting}
              onError={setError}
            />

            <div className="flex justify-end">
              <button type="button" onClick={submit} disabled={submitting} className={SEND_BTN}>
                {submitting ? 'Sending…' : 'Open a ticket'}
              </button>
            </div>
          </div>
        </Card>
      )}

      {/* ── MY TICKETS ─────────────────────────────────────────────────────── */}
      {tab === 'mine' && openId == null && (
        <Card title="My tickets" expandable={false}>
          <div className="flex flex-col gap-2">
            {!listLoaded && <p className="py-6 text-center text-xs text-faint">Loading…</p>}
            {listLoaded && tickets.length === 0 && (
              <p className="py-6 text-center text-xs leading-relaxed text-faint">
                No tickets yet. Send one from the New tab and it will show up here.
              </p>
            )}
            {tickets.map((t) => (
              <button
                key={t.id}
                type="button"
                onClick={() => go({ tab: 'mine', ticket: t.id })}
                className="flex w-full items-center gap-3 rounded-md border border-line bg-surface2 px-3 py-2 text-left transition-colors hover:bg-raised"
              >
                <span className="shrink-0 text-xs">{CATEGORY_LABEL[t.category] ?? t.category}</span>
                <span className="min-w-0 flex-1 truncate text-sm text-fg">{t.message}</span>
                {num(t.shot_count) > 0 && (
                  <span className="tabular shrink-0 text-2xs text-faint">
                    📎 {num(t.shot_count)}
                  </span>
                )}
                {num(t.reply_count) > 0 && (
                  <span className="tabular shrink-0 text-2xs text-faint">
                    💬 {num(t.reply_count)}
                  </span>
                )}
                <UnreadDot count={num(t.unread_user)} />
                <StatusChip status={t.status} />
                <span className="tabular w-16 shrink-0 text-right text-2xs text-faint">
                  {fmtWhen(t.last_activity_at)}
                </span>
              </button>
            ))}
          </div>
        </Card>
      )}

      {/* ── ONE THREAD ─────────────────────────────────────────────────────── */}
      {tab === 'mine' && openId != null && (
        <Card title={thread ? `Ticket #${thread.ticket.id}` : 'Ticket'} expandable={false}>
          {thread ? (
            <Thread
              ticket={thread.ticket}
              messages={thread.messages}
              shots={thread.shots}
              isOwner={thread.isOwner}
              isAuthor={thread.isAuthor}
              sending={sending}
              onSend={reply}
              header={
                <div className="flex flex-wrap items-center gap-2 border-b border-line pb-2">
                  <button
                    type="button"
                    onClick={() => {
                      go({ tab: 'mine', ticket: null })
                      void loadList()
                    }}
                    className="rounded-sm border border-line px-2 py-1 text-2xs font-bold uppercase tracking-wide text-faint transition-colors hover:text-fg"
                  >
                    ← All tickets
                  </button>
                  <span className="text-sm font-semibold text-fg">
                    {CATEGORY_LABEL[thread.ticket.category] ?? thread.ticket.category}
                  </span>
                  <span className="text-xs text-faint">
                    opened {fmtWhen(thread.ticket.created_at)}
                  </span>
                  <span className="ml-auto">
                    <StatusChip status={thread.ticket.status} />
                  </span>
                </div>
              }
            />
          ) : (
            <p className="py-6 text-center text-xs text-faint">Loading ticket…</p>
          )}
        </Card>
      )}
    </Page>
  )
}
