import { useCallback, useEffect, useRef, useState } from 'react'
import type { ClipboardEvent, DragEvent, ReactNode } from 'react'
import { alpha, T } from '@/design/theme'
import {
  MAX_SHOTS,
  SHOT_ACCEPT,
  imageFilesFrom,
  prepareShots,
  shotKb,
  shotUrl,
} from '@/pages/feedback/shots'
import type { FeedbackShot, PendingShot } from '@/pages/feedback/shots'

// ─────────────────────────────────────────────────────────────────────────────
// ONE TICKET CONVERSATION.
//
// A ticket is read from two sides — the customer here at /v3/feedback and the
// owner at owner.cbedge.net — and the thread itself has to read identically on
// both, so what surrounds it (a tab switch here, an inbox there) is the page's
// job and this is only the conversation plus the box you reply in.
//
// "MINE" IS WHICHEVER SIDE IS LOOKING, and it is decided by `isAuthor` — did the
// VIEWER open this ticket — never by which page is rendering. isOwner and
// isAuthor are different questions and all four combinations happen: the owner
// reading a customer's ticket is not its author, and the owner reading one they
// opened themselves is both. Both flags come from the server, because only it
// knows who the caller is.
//
// SCREENSHOTS hang off a MESSAGE rather than the ticket, so they render inside
// the bubble they were sent with. Paste, drag, or the 📎 button; a screenshot
// with no words is a valid reply, and the composer says so by enabling Send.
//
// MIRROR: components/shared/FeedbackThread.tsx (Next) and the inlined copy in
// owner-vite/src/pages/Feedback.tsx draw the same thing on v2's palette. v3
// shares no code with v2, so this is a rewrite on v3's tokens rather than an
// import. Change the API shapes in one and check the others.
// ─────────────────────────────────────────────────────────────────────────────

export type FeedbackStatus = 'open' | 'resolved'

/**
 * A ticket row as /api/feedback returns it. COUNT comes back from Postgres as a
 * string (bigint, and node-postgres does not narrow it) — hence
 * `number | string` and `num()`. Never do arithmetic on these raw.
 */
export interface FeedbackTicket {
  id: number
  clerk_user_id: string | null
  email: string | null
  category: string
  message: string
  page: string | null
  status: FeedbackStatus
  created_at: string
  updated_at: string
  reply_count: number | string
  last_activity_at: string
  unread_user: number | string
  unread_owner: number | string
  /** Attachments across the whole ticket — the 📎 hint on a list row. */
  shot_count?: number | string
}

export interface FeedbackMessage {
  id: number
  author: 'user' | 'owner'
  body: string
  created_at: string
}

export const CATEGORY_LABEL: Record<string, string> = {
  bug: '🐞 Bug',
  idea: '💡 Idea',
  note: '📝 Note',
  other: '💬 Other',
}

export type FeedbackCategory = 'bug' | 'idea' | 'note' | 'other'

export const CATEGORY_OPTIONS: Array<{ value: FeedbackCategory; label: string }> = [
  { value: 'bug', label: '🐞 Bug' },
  { value: 'idea', label: '💡 Idea' },
  { value: 'note', label: '📝 Note' },
  { value: 'other', label: '💬 Other' },
]

/** COUNT columns arrive as strings. One place that knows it. */
export function num(v: number | string | null | undefined): number {
  const n = Number(v ?? 0)
  return Number.isFinite(n) ? n : 0
}

/** "3m ago" / "yesterday" / "Aug 12" — short enough for a list row. */
export function fmtWhen(iso: string | null | undefined): string {
  if (!iso) return ''
  const t = new Date(iso).getTime()
  if (!Number.isFinite(t)) return ''
  const mins = Math.floor((Date.now() - t) / 60000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m ago`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return `${hrs}h ago`
  const days = Math.floor(hrs / 24)
  if (days === 1) return 'yesterday'
  if (days < 7) return `${days}d ago`
  return new Date(t).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

/** Full stamp for a bubble's footer. */
export function fmtStamp(iso: string | null | undefined): string {
  if (!iso) return ''
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  return d.toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  })
}

/* ------------------------------------------------------------------- chips */

export function StatusChip({ status }: { status: FeedbackStatus }) {
  const open = status !== 'resolved'
  return (
    <span
      className={[
        'shrink-0 whitespace-nowrap rounded-full border px-2 py-0.5 text-3xs font-extrabold uppercase tracking-wide',
        open ? 'border-warn text-warn' : 'border-accent text-accent',
      ].join(' ')}
      style={{ background: alpha(open ? T.orange : T.cyan, 0.12) }}
    >
      {open ? 'Open' : 'Complete'}
    </span>
  )
}

/** Unread count. Renders nothing at zero. */
export function UnreadDot({ count }: { count: number }) {
  if (count <= 0) return null
  return (
    <span className="tabular inline-flex h-4 min-w-4 shrink-0 items-center justify-center rounded-full bg-warn px-1.5 text-2xs font-extrabold text-bg">
      {count > 99 ? '99+' : count}
    </span>
  )
}

/* ------------------------------------------------------------- screenshots */

const THUMB = 'h-20 w-32 rounded-sm border border-line bg-surface2 object-cover'

/**
 * Full-size view of one attachment.
 *
 * A bug-report screenshot is unreadable at thumbnail size — the point is
 * usually the small number in the corner — so a click has to open it big.
 */
function Lightbox({ src, alt, onClose }: { src: string; alt: string; onClose: () => void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <div
      onClick={onClose}
      className="fixed inset-0 z-50 flex cursor-zoom-out items-center justify-center p-6"
      style={{ background: alpha(T.bg, 0.88) }}
    >
      <img
        src={src}
        alt={alt}
        onClick={(e) => e.stopPropagation()}
        className="max-h-full max-w-full cursor-default rounded-sm border border-line object-contain"
      />
      <span className="absolute right-4 top-3 text-xs text-faint">Esc to close</span>
    </div>
  )
}

/** Attachments on one message, as a row of thumbnails. */
export function ShotGallery({ shots, mine }: { shots: FeedbackShot[]; mine: boolean }) {
  const [open, setOpen] = useState<FeedbackShot | null>(null)
  if (!shots.length) return null
  return (
    <div
      className={[
        'flex max-w-[88%] flex-wrap gap-1.5',
        mine ? 'justify-end' : 'justify-start',
      ].join(' ')}
    >
      {shots.map((s) => (
        <button
          key={s.id}
          type="button"
          onClick={() => setOpen(s)}
          title={`${s.name || 'screenshot'} · ${shotKb(s.byte_len)}`}
          className="cursor-zoom-in leading-none"
        >
          <img src={shotUrl(s)} alt={s.name || 'screenshot'} className={THUMB} />
        </button>
      ))}
      {open && (
        <Lightbox
          src={shotUrl(open)}
          alt={open.name || 'screenshot'}
          onClose={() => setOpen(null)}
        />
      )}
    </div>
  )
}

/**
 * The composer's attachment row: a 📎 button and whatever is queued.
 *
 * The queue lives in the PARENT, because whoever owns the Send button is what
 * has to clear it once the message is away — and on this page that is the
 * new-ticket form as often as it is a thread.
 */
export function ShotTray({
  pending,
  setPending,
  disabled,
  onError,
}: {
  pending: PendingShot[]
  setPending: (next: PendingShot[]) => void
  disabled?: boolean
  onError: (msg: string | null) => void
}) {
  const inputRef = useRef<HTMLInputElement | null>(null)
  const [busy, setBusy] = useState(false)

  const add = useCallback(
    async (files: File[]) => {
      if (!files.length || disabled) return
      setBusy(true)
      onError(null)
      try {
        const next = await prepareShots(files, pending.length)
        if (next.length) setPending([...pending, ...next])
        if (files.length > next.length) {
          onError(`Only ${MAX_SHOTS} images per message — the rest were skipped.`)
        }
      } catch (e) {
        onError(e instanceof Error ? e.message : 'Could not attach that image.')
      } finally {
        setBusy(false)
      }
    },
    [disabled, onError, pending, setPending],
  )

  const full = pending.length >= MAX_SHOTS

  return (
    <div className="flex flex-wrap items-center gap-2">
      <input
        ref={inputRef}
        type="file"
        accept={SHOT_ACCEPT}
        multiple
        hidden
        onChange={(e) => {
          const files = Array.from(e.target.files ?? [])
          e.target.value = '' // so the same file can be picked twice
          void add(files)
        }}
      />
      <button
        type="button"
        disabled={disabled || busy || full}
        onClick={() => inputRef.current?.click()}
        title="Attach a screenshot — you can also paste or drag one in"
        className="rounded-sm border border-line px-2 py-1 text-2xs font-bold uppercase tracking-wide text-faint transition-colors hover:border-accent hover:text-fg disabled:cursor-not-allowed disabled:opacity-30"
      >
        {busy ? 'Adding…' : '📎 Screenshot'}
      </button>

      {pending.map((p) => (
        <span key={p.key} className="relative leading-none">
          <img
            src={p.dataUrl}
            alt={p.name}
            title={`${p.name} · ${shotKb(p.bytes)}`}
            className="h-16 w-24 rounded-sm border border-line bg-surface2 object-cover"
          />
          <button
            type="button"
            onClick={() => setPending(pending.filter((x) => x.key !== p.key))}
            title="Remove"
            className="absolute -right-1.5 -top-1.5 rounded-full border border-down bg-surface px-1.5 text-xs font-bold text-down"
          >
            ✕
          </button>
        </span>
      ))}

      {pending.length === 0 && (
        <span className="text-2xs text-faint">or paste / drag an image in</span>
      )}
    </div>
  )
}

/** Paste + drop handlers for whatever container owns a composer. */
export function useShotDrop(
  pending: PendingShot[],
  setPending: (n: PendingShot[]) => void,
  onError: (m: string | null) => void,
) {
  const [over, setOver] = useState(false)

  const take = useCallback(
    async (files: File[]) => {
      if (!files.length) return
      try {
        const next = await prepareShots(files, pending.length)
        if (next.length) setPending([...pending, ...next])
      } catch (e) {
        onError(e instanceof Error ? e.message : 'Could not attach that image.')
      }
    },
    [onError, pending, setPending],
  )

  return {
    over,
    handlers: {
      onPaste: (e: ClipboardEvent) => {
        const files = imageFilesFrom(e.clipboardData)
        if (!files.length) return
        e.preventDefault() // otherwise the filename lands in the textarea
        void take(files)
      },
      onDragOver: (e: DragEvent) => {
        e.preventDefault()
        setOver(true)
      },
      onDragLeave: () => setOver(false),
      onDrop: (e: DragEvent) => {
        const files = imageFilesFrom(e.dataTransfer)
        setOver(false)
        if (!files.length) return
        e.preventDefault()
        void take(files)
      },
    },
  }
}

/* ------------------------------------------------------------------ thread */

function Bubble({
  mine,
  who,
  body,
  when,
  shots,
}: {
  mine: boolean
  who: string
  body: string
  when: string
  shots: FeedbackShot[]
}) {
  return (
    <div className={['flex flex-col gap-1.5', mine ? 'items-end' : 'items-start'].join(' ')}>
      {/* A screenshot-only message gets NO bubble — an empty one reads as a
          bug, and the image is the message. */}
      {body ? (
        <div
          className={[
            'max-w-[88%] whitespace-pre-wrap break-words rounded-md border px-3 py-2 text-sm leading-relaxed text-fg',
            mine ? 'border-accent' : 'border-line bg-surface2',
          ].join(' ')}
          style={mine ? { background: alpha(T.cyan, 0.14) } : undefined}
        >
          {body}
        </div>
      ) : null}
      <ShotGallery shots={shots} mine={mine} />
      <span className="text-2xs text-faint">
        {who} · {when}
      </span>
    </div>
  )
}

export const FIELD =
  'w-full rounded-sm border border-line bg-bg px-2 py-1.5 text-sm text-fg outline-none placeholder:text-faint placeholder:opacity-40 focus:border-accent'

export const SEND_BTN =
  'rounded-sm border border-accent px-4 py-1.5 text-2xs font-bold uppercase tracking-wide text-accent transition-colors hover:bg-raised disabled:cursor-not-allowed disabled:opacity-30'

/**
 * The conversation + composer.
 *
 * `isOwner` only changes the placeholder and the label on staff replies; the
 * server is what enforces who may reply or close a ticket.
 */
export function Thread({
  ticket,
  messages,
  shots,
  isOwner,
  isAuthor,
  sending,
  onSend,
  onSetStatus,
  header,
}: {
  ticket: FeedbackTicket
  messages: FeedbackMessage[]
  /** Every attachment on the ticket; grouped onto its message by message_id. */
  shots: FeedbackShot[]
  isOwner: boolean
  /** Did the VIEWER open this ticket? From the server, never inferred. */
  isAuthor: boolean
  sending: boolean
  /** `shots` is a list of data URLs, already downscaled by ShotTray. */
  onSend: (text: string, shots: PendingShot[]) => void | Promise<void>
  /** Owner-only. Omit to hide the status control entirely. */
  onSetStatus?: (status: FeedbackStatus) => void | Promise<void>
  /** Slot above the conversation (back button, subject line, meta). */
  header?: ReactNode
}) {
  const [draft, setDraft] = useState('')
  const [pending, setPending] = useState<PendingShot[]>([])
  const [shotError, setShotError] = useState<string | null>(null)
  const endRef = useRef<HTMLDivElement | null>(null)
  const { over, handlers } = useShotDrop(pending, setPending, setShotError)

  // Jump to the newest message whenever the thread grows or is swapped out.
  useEffect(() => {
    endRef.current?.scrollIntoView({ block: 'end' })
  }, [ticket.id, messages.length, shots.length])

  // A different ticket is a different draft — never carry an attachment over.
  useEffect(() => {
    setPending([])
    setShotError(null)
    setDraft('')
  }, [ticket.id])

  const canSend = Boolean(draft.trim()) || pending.length > 0

  const send = () => {
    if (!canSend || sending) return
    const text = draft.trim()
    const files = pending
    setDraft('')
    setPending([])
    setShotError(null)
    void onSend(text, files)
  }

  const closed = ticket.status === 'resolved'

  // Authoring the ticket wins over being staff: on your own ticket your
  // customer-side words are "You", even when you are also who answers tickets.
  const isMine = (author: 'user' | 'owner') => (isAuthor ? author === 'user' : author === 'owner')
  const whoSaid = (author: 'user' | 'owner') => {
    if (author === 'user') return isAuthor ? 'You' : ticket.email || 'Customer'
    return isOwner && !isAuthor ? 'You' : 'CB Edge'
  }

  // message_id NULL belongs to the opening message (a ticket row, not a message).
  const shotsFor = (messageId: number | null) =>
    shots.filter((s) => (messageId == null ? s.message_id == null : s.message_id === messageId))

  return (
    <div className="flex min-h-0 flex-col gap-3" {...handlers}>
      {header}

      <div
        className={[
          'flex h-96 flex-col gap-3 overflow-y-auto rounded-md p-1',
          over ? 'ring-1 ring-accent' : '',
        ].join(' ')}
      >
        {/* The opening message is the ticket row itself, not a thread row —
            but it is always a CUSTOMER message, so it takes the same seat. */}
        <Bubble
          mine={isMine('user')}
          who={whoSaid('user')}
          body={ticket.message}
          when={fmtStamp(ticket.created_at)}
          shots={shotsFor(null)}
        />
        {messages.map((m) => (
          <Bubble
            key={m.id}
            mine={isMine(m.author)}
            who={whoSaid(m.author)}
            body={m.body}
            when={fmtStamp(m.created_at)}
            shots={shotsFor(m.id)}
          />
        ))}
        <div ref={endRef} />
      </div>

      {closed && !isOwner && (
        <p className="text-xs text-muted">This ticket is marked complete. Replying reopens it.</p>
      )}

      <div className="flex flex-col gap-2">
        <textarea
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            // Enter sends, Shift+Enter breaks the line.
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault()
              send()
            }
          }}
          placeholder={isOwner ? 'Reply to this customer…' : 'Add to this ticket…'}
          rows={3}
          maxLength={5000}
          className={[FIELD, 'resize-y font-sans leading-relaxed'].join(' ')}
        />

        <ShotTray
          pending={pending}
          setPending={setPending}
          disabled={sending}
          onError={setShotError}
        />
        {shotError && <p className="text-xs font-semibold text-down">{shotError}</p>}

        <div className="flex flex-wrap items-center justify-between gap-2">
          {onSetStatus ? (
            <button
              type="button"
              onClick={() => void onSetStatus(closed ? 'open' : 'resolved')}
              title={closed ? 'Put this ticket back in the open queue' : 'Mark this ticket complete'}
              className={[
                'rounded-sm border px-3 py-1.5 text-2xs font-bold uppercase tracking-wide transition-colors hover:bg-raised',
                closed ? 'border-warn text-warn' : 'border-accent text-accent',
              ].join(' ')}
            >
              {closed ? 'Reopen' : 'Mark complete'}
            </button>
          ) : (
            <span className="text-2xs text-faint">Enter to send · Shift+Enter for a new line</span>
          )}
          <button type="button" onClick={send} disabled={sending || !canSend} className={SEND_BTN}>
            {sending ? 'Sending…' : 'Send'}
          </button>
        </div>
      </div>
    </div>
  )
}
