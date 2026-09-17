import { useState } from 'react'
import type { Dispatch, SetStateAction } from 'react'
// Type-only, so it is erased at build and does NOT pull the entry chunk back in
// through the lazy() boundary.
import type { BzilaAlert, Reaction } from '@/shell/BzilaAlerts'

// ─────────────────────────────────────────────────────────────────────────────
// THE BZILA DROPDOWN — everything behind the CB Edge logo.
//
// Split out of BzilaAlerts.tsx so it lands in its own chunk: the trigger is in
// the entry bundle (it is the logo), this is not. See the note there.
//
// Three audiences, one panel:
//   · a subscriber reads the alerts and taps 👍 / 👎;
//   · the OWNER additionally gets the compose box at the top — the send-an-alert
//     control lives here and nowhere else in the customer app — plus Edit and
//     Delete on every alert, and the link to the lifetime scoreboard;
//   · nobody else ever gets here (BzilaLogo does not render a button for them).
//
// The owner controls are CHROME. /api/bzila-alerts rejects POST/PATCH/DELETE
// from anyone but the owner id server-side; hiding them is convenience.
// ─────────────────────────────────────────────────────────────────────────────

const OWNER_REPORT = 'https://owner.cbedge.net/owner/dev/bzila-alerts'
const MAX_TITLE = 120
const MAX_BODY = 2000

function ago(iso: string): string {
  const t = new Date(iso).getTime()
  if (!t) return ''
  const s = Math.max(0, Math.floor((Date.now() - t) / 1000))
  if (s < 60) return 'just now'
  const m = Math.floor(s / 60)
  if (m < 60) return `${m}m ago`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h ago`
  const d = Math.floor(h / 24)
  if (d < 7) return `${d}d ago`
  return new Date(t).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

const FIELD =
  'w-full rounded-sm border border-line bg-bg px-2 py-1.5 text-sm text-fg outline-none placeholder:text-faint placeholder:opacity-40 focus:border-accent'

const PILL =
  'rounded-sm border px-2.5 py-1 text-2xs font-bold uppercase tracking-wide transition-colors disabled:cursor-not-allowed disabled:opacity-40'

/** One 👍 / 👎 with a live count. Filled when it is this account's pick. */
function Thumb({
  dir,
  active,
  count,
  onClick,
}: {
  dir: 'up' | 'down'
  active: boolean
  count: number
  onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      title={dir === 'up' ? 'Helpful' : 'Not helpful'}
      className={[
        'inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-xs font-bold leading-none transition-colors',
        active
          ? dir === 'up'
            ? 'border-up bg-raised text-up'
            : 'border-down bg-raised text-down'
          : 'border-line text-faint opacity-60 hover:opacity-100',
      ].join(' ')}
    >
      <span aria-hidden className="text-sm">
        {dir === 'up' ? '👍' : '👎'}
      </span>
      {count > 0 && <span className="tabular">{count}</span>}
    </button>
  )
}

export function BzilaPanel({
  alerts,
  setAlerts,
  isOwner,
  reload,
  close,
}: {
  alerts: BzilaAlert[]
  setAlerts: Dispatch<SetStateAction<BzilaAlert[]>>
  isOwner: boolean
  reload: () => Promise<void>
  close: () => void
}) {
  const [draftTitle, setDraftTitle] = useState('')
  const [draftBody, setDraftBody] = useState('')
  const [busy, setBusy] = useState(false)
  const [editingId, setEditingId] = useState<number | null>(null)
  const [editTitle, setEditTitle] = useState('')
  const [editBody, setEditBody] = useState('')

  const send = async () => {
    const body = draftBody.trim()
    if (!body || busy) return
    setBusy(true)
    try {
      await fetch('/api/bzila-alerts', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({ title: draftTitle.trim(), body }),
      })
      setDraftTitle('')
      setDraftBody('')
      await reload()
    } finally {
      setBusy(false)
    }
  }

  const saveEdit = async () => {
    const body = editBody.trim()
    if (!editingId || !body || busy) return
    setBusy(true)
    try {
      await fetch('/api/bzila-alerts', {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({ id: editingId, title: editTitle.trim(), body }),
      })
      setEditingId(null)
      await reload()
    } finally {
      setBusy(false)
    }
  }

  const del = async (id: number) => {
    if (busy) return
    setBusy(true)
    try {
      await fetch(`/api/bzila-alerts?id=${id}`, { method: 'DELETE', credentials: 'same-origin' })
      if (editingId === id) setEditingId(null)
      await reload()
    } finally {
      setBusy(false)
    }
  }

  // Optimistic, then reconciled against the server's authoritative counts.
  // Pressing the same thumb again clears it — the endpoint toggles — but the tap
  // is still appended to the permanent log either way.
  const react = async (alertId: number, reaction: 'up' | 'down') => {
    setAlerts((prev) =>
      prev.map((a) => {
        if (a.id !== alertId) return a
        const was = a.mine ?? ''
        const now: Reaction = was === reaction ? '' : reaction
        let up = a.up ?? 0
        let down = a.down ?? 0
        if (was === 'up') up--
        else if (was === 'down') down--
        if (now === 'up') up++
        else if (now === 'down') down++
        return { ...a, mine: now, up: Math.max(0, up), down: Math.max(0, down) }
      }),
    )
    try {
      const r = await fetch('/api/bzila-alerts/react', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({ alertId, reaction }),
      })
      const d = (await r.json()) as { ok?: boolean; mine?: Reaction; up?: number; down?: number }
      if (d?.ok) {
        setAlerts((prev) =>
          prev.map((a) => (a.id === alertId ? { ...a, mine: d.mine ?? '', up: d.up ?? 0, down: d.down ?? 0 } : a)),
        )
      }
    } catch {
      /* keep the optimistic state — the next poll reconciles */
    }
  }

  return (
    <div
      role="menu"
      className="absolute left-0 top-full z-50 mt-2 flex max-h-[70vh] w-88 max-w-[92vw] flex-col gap-2 overflow-y-auto rounded-md border border-line bg-surface p-3 shadow-lg"
    >
      <div className="flex items-center gap-2">
        <span className="text-sm font-bold text-fg">Bzila Alerts</span>
        <span className="flex-1" />
        <button
          type="button"
          onClick={close}
          aria-label="Close"
          className="text-sm text-faint opacity-50 hover:opacity-100"
        >
          ✕
        </button>
      </div>

      {/* ── OWNER: the send box ──────────────────────────────────────────────
          The only place in the customer app an alert is written. Gated on
          isOwner for drawing; the route is what actually refuses everyone
          else. */}
      {isOwner && (
        <div className="flex flex-col gap-2 rounded-sm border border-accent bg-raised p-2">
          <div className="text-2xs font-bold uppercase tracking-wide text-accent">Send an alert</div>
          <input
            value={draftTitle}
            onChange={(e) => setDraftTitle(e.target.value)}
            placeholder="Title (optional)"
            maxLength={MAX_TITLE}
            className={FIELD}
          />
          <textarea
            value={draftBody}
            onChange={(e) => setDraftBody(e.target.value)}
            placeholder="Type an alert…"
            maxLength={MAX_BODY}
            rows={3}
            className={[FIELD, 'resize-y font-sans'].join(' ')}
          />
          <div className="flex items-center gap-2">
            <span className="tabular text-2xs text-faint opacity-50">
              {draftBody.length}/{MAX_BODY}
            </span>
            <span className="flex-1" />
            <button
              type="button"
              onClick={() => void send()}
              disabled={busy || !draftBody.trim()}
              className={[PILL, 'border-accent text-accent hover:bg-surface2'].join(' ')}
            >
              {busy ? 'Sending…' : 'Send'}
            </button>
          </div>
        </div>
      )}

      {alerts.length === 0 ? (
        <div className="px-0.5 py-2 text-sm text-faint opacity-60">No alerts yet.</div>
      ) : (
        <div className="flex flex-col gap-2">
          {alerts.map((a) => {
            const editing = editingId === a.id
            return (
              <div key={a.id} className="rounded-sm border border-line bg-raised p-2">
                {editing ? (
                  <div className="flex flex-col gap-2">
                    <input
                      value={editTitle}
                      onChange={(e) => setEditTitle(e.target.value)}
                      placeholder="Title (optional)"
                      maxLength={MAX_TITLE}
                      className={FIELD}
                    />
                    <textarea
                      value={editBody}
                      onChange={(e) => setEditBody(e.target.value)}
                      maxLength={MAX_BODY}
                      rows={3}
                      className={[FIELD, 'resize-y font-sans'].join(' ')}
                    />
                    <div className="flex justify-end gap-2">
                      <button
                        type="button"
                        onClick={() => setEditingId(null)}
                        className={[PILL, 'border-line text-faint hover:text-fg'].join(' ')}
                      >
                        Cancel
                      </button>
                      <button
                        type="button"
                        onClick={() => void saveEdit()}
                        disabled={busy || !editBody.trim()}
                        className={[PILL, 'border-accent text-accent hover:bg-surface2'].join(' ')}
                      >
                        Save
                      </button>
                    </div>
                  </div>
                ) : (
                  <>
                    {a.title && <div className="mb-0.5 text-sm font-bold text-fg">{a.title}</div>}
                    <div className="whitespace-pre-wrap break-words text-sm text-muted opacity-90">{a.body}</div>
                    <div className="mt-2 flex items-center gap-2">
                      <Thumb dir="up" active={a.mine === 'up'} count={a.up ?? 0} onClick={() => void react(a.id, 'up')} />
                      <Thumb
                        dir="down"
                        active={a.mine === 'down'}
                        count={a.down ?? 0}
                        onClick={() => void react(a.id, 'down')}
                      />
                      <span className="flex-1" />
                      <span className="text-2xs font-semibold text-faint opacity-50">{ago(a.created_at)}</span>
                      {isOwner && (
                        <span className="flex gap-2">
                          <button
                            type="button"
                            onClick={() => {
                              setEditingId(a.id)
                              setEditTitle(a.title)
                              setEditBody(a.body)
                            }}
                            className="text-2xs font-bold uppercase tracking-wide text-accent"
                          >
                            Edit
                          </button>
                          <button
                            type="button"
                            onClick={() => void del(a.id)}
                            className="text-2xs font-bold uppercase tracking-wide text-down"
                          >
                            Delete
                          </button>
                        </span>
                      )}
                    </div>
                  </>
                )}
              </div>
            )
          })}
        </div>
      )}

      {/* The logo used to be a plain link to /feedback. It is this panel's
          trigger now, so the entry point moves in here rather than being lost.
          A native <a>: v3's router runs with basename="/v3" and /feedback is a
          top-level Next route outside the SPA. */}
      <a
        href="/feedback"
        className="rounded-sm border border-line py-1.5 text-center text-2xs font-bold uppercase tracking-wide text-faint no-underline opacity-70 hover:opacity-100"
      >
        Send feedback →
      </a>

      {/* The lifetime scoreboard. Every 👍/👎 above is appended to
          bzila_alert_reaction_log, which survives the alert being edited or
          deleted — this is where that log is read. */}
      {isOwner && (
        <a
          href={OWNER_REPORT}
          target="_blank"
          rel="noopener noreferrer"
          className="rounded-sm border border-accent py-1.5 text-center text-2xs font-bold uppercase tracking-wide text-accent no-underline"
        >
          View reactions ↗
        </a>
      )}
    </div>
  )
}

export default BzilaPanel
