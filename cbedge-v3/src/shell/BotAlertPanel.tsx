import { useEffect, useMemo, useRef, useState } from 'react'

// ─────────────────────────────────────────────────────────────────────────────
// THE BOT DROPDOWN — the full composer, in the toolbar.
//
// Same fields and the same one server call as owner.cbedge.net → BOT, because a
// second, subtly different composer is how two surfaces start posting two
// different-looking alerts. What it does NOT carry is Manage: adding a Discord
// or pasting a webhook URL is setup, done once, and it stays on the owner site
// where there is room to see all four routes at once.
//
// EVERYTHING SERVER-SIDE. This posts FIELDS to /api/bot-alert, which owns the
// webhook URLs, builds the embed and fans it out. No webhook URL ever reaches
// this file, and the route rejects anyone but the owner — so the owner check in
// BotAlert.tsx is convenience, not the gate.
//
// The append is not optimistic and the panel does not close on send: with
// several destinations a partial failure is normal, and closing on the POST
// would hide "2 of 4 landed" at exactly the moment it matters.
// ─────────────────────────────────────────────────────────────────────────────

type AssetClass = 'notes' | 'options' | 'futures' | 'equity'
type TradeAction = 'buy' | 'sell' | 'trim' | 'average-down'
type Target = { id: string; label: string; accepts?: Record<string, boolean> }
type Bar = { id: string; label: string; hex: string }
type SendResult = { id: string; label?: string; ok: boolean; error?: string; warning?: string | null }

const ASSETS: { id: AssetClass; label: string }[] = [
  { id: 'options', label: 'Options' },
  { id: 'futures', label: 'Futures' },
  { id: 'equity', label: 'Equity' },
  { id: 'notes', label: 'Notes' },
]

const ACTIONS: { id: TradeAction; label: string }[] = [
  { id: 'buy', label: 'Buy' },
  { id: 'sell', label: 'Sell' },
  { id: 'trim', label: 'Trim' },
  { id: 'average-down', label: 'Avg Down' },
]

// ── NO COLOUR LITERALS IN THIS FILE, AND NOT BY ACCIDENT ────────────────────
// The embed bar is Discord PAYLOAD, not this app's theme: those hexes are
// picked to read against Discord's surface and would be meaningless as design
// tokens. So the server owns the palette and ships it on /api/bot-alert/targets
// as `bars`; the swatches below are drawn from that response and the composer
// sends a bar by NAME ('auto' | 'green' | ...). check-theme stays happy for the
// right reason — there is genuinely no colour of ours here — and the palette
// has one home instead of three.

/** Which fields each class shows. Notes is a plain broadcast — no trade. */
const SHOWS = {
  notes: { trade: false, opt: false },
  options: { trade: true, opt: true },
  futures: { trade: true, opt: false },
  equity: { trade: true, opt: false },
} as const

const FIELD =
  'w-full rounded-sm border border-line bg-bg px-2 py-1.5 text-sm text-fg outline-none placeholder:text-faint placeholder:opacity-40 focus:border-accent'
const PILL =
  'rounded-sm border px-2 py-1 text-2xs font-bold uppercase tracking-wide transition-colors disabled:cursor-not-allowed disabled:opacity-30'
const ON = 'border-accent bg-raised text-accent'
const OFF = 'border-line text-faint hover:text-fg'
const LABEL = 'text-2xs font-bold uppercase tracking-wide text-faint'

function todayIso(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

export function BotAlertPanel({ close }: { close: () => void }) {
  const [targets, setTargets] = useState<Target[]>([])
  const [picked, setPicked] = useState<string[]>([])
  const [assetClass, setAssetClass] = useState<AssetClass>('options')
  const [action, setAction] = useState<TradeAction>('buy')
  const [ticker, setTicker] = useState('')
  const [strike, setStrike] = useState('')
  const [right, setRight] = useState<'call' | 'put'>('call')
  const [expiry, setExpiry] = useState(todayIso())
  const [price, setPrice] = useState('')
  const [notes, setNotes] = useState('')
  const [image, setImage] = useState<string | null>(null)
  const [bars, setBars] = useState<Bar[]>([])
  const [barChoice, setBarChoice] = useState('auto')
  const [sending, setSending] = useState(false)
  const [msg, setMsg] = useState<{ kind: 'ok' | 'warn' | 'err'; text: string } | null>(null)
  const fileRef = useRef<HTMLInputElement | null>(null)

  const shows = SHOWS[assetClass]

  // Destinations, and whether each can take the class being composed. A Discord
  // with no channel mapped for it is disabled rather than selectable — the
  // alternative is discovering it from a red row after the others posted.
  useEffect(() => {
    let alive = true
    fetch('/api/bot-alert/targets', { cache: 'no-store', credentials: 'same-origin' })
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => {
        if (!alive) return
        if (Array.isArray(j?.targets)) setTargets(j.targets)
        if (Array.isArray(j?.bars)) setBars(j.bars)
      })
      .catch(() => {})
    return () => {
      alive = false
    }
  }, [])

  const accepts = (t: Target) => (t.accepts ? !!t.accepts[assetClass] : true)

  // Switching class can strip a destination of its channel. A selection that
  // silently became unsendable is how an alert goes missing.
  useEffect(() => {
    setPicked((prev) => prev.filter((id) => targets.some((t) => t.id === id && accepts(t))))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [assetClass, targets])

  // Ctrl+V anywhere in the panel attaches the clipboard image — the chart is
  // already on the clipboard from TradingView, and a file-picker round trip is
  // the friction that ends with the chart not being posted. Only claims the
  // event when the clipboard actually carries an image, so pasting TEXT into
  // the thesis box still behaves normally.
  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      const item = Array.from(e.clipboardData?.items ?? []).find((i) => i.type.startsWith('image/'))
      const file = item?.getAsFile()
      if (!file) return
      e.preventDefault()
      readImage(file)
    }
    window.addEventListener('paste', onPaste)
    return () => window.removeEventListener('paste', onPaste)
  }, [])

  function readImage(file: File) {
    if (!file.type.startsWith('image/')) return
    const fr = new FileReader()
    fr.onload = () => setImage(typeof fr.result === 'string' ? fr.result : null)
    fr.readAsDataURL(file)
  }

  const canSend = useMemo(() => {
    if (!picked.length || sending) return false
    return assetClass === 'notes' ? notes.trim().length > 0 || image != null : ticker.trim().length > 0
  }, [picked, sending, assetClass, notes, image, ticker])

  async function send() {
    if (!canSend) return
    setSending(true)
    setMsg(null)
    try {
      const r = await fetch('/api/bot-alert', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({
          targets: picked,
          assetClass,
          action,
          ticker: ticker.trim(),
          expiry,
          strike: strike.trim(),
          right,
          price: price.trim(),
          notes: notes.trim(),
          image,
          bar: barChoice,
        }),
      })
      const j = await r.json().catch(() => null)
      const results: SendResult[] = Array.isArray(j?.results) ? j.results : []

      if (!j?.ok) {
        setMsg({ kind: 'err', text: j?.error || results.find((x) => !x.ok)?.error || `Failed (${r.status})` })
        return
      }

      const failed = results.filter((x) => !x.ok)
      const warned = results.filter((x) => x.ok && x.warning)
      if (failed.length) {
        setMsg({ kind: 'err', text: `Sent to ${j.sent}/${j.of} — failed: ${failed.map((f) => f.label || f.id).join(', ')}` })
      } else if (warned.length) {
        // Posted, tag did not resolve. The difference between "the room was
        // notified" and "you think the room was".
        setMsg({ kind: 'warn', text: warned[0].warning as string })
      } else {
        setMsg({ kind: 'ok', text: `Sent to ${j.sent}/${j.of}` })
      }

      // Clear only what is per-alert. Destinations and asset class survive,
      // because the next alert is usually to the same rooms about the same kind
      // of thing, and re-picking them every time is how one gets forgotten.
      setTicker('')
      setStrike('')
      setPrice('')
      setNotes('')
      setImage(null)
    } catch (e) {
      setMsg({ kind: 'err', text: String((e as Error)?.message || e) })
    } finally {
      setSending(false)
    }
  }

  return (
    <div
      role="menu"
      className="absolute left-0 top-full z-50 mt-2 flex max-h-[78vh] w-[27rem] max-w-[94vw] flex-col gap-2.5 overflow-y-auto rounded-md border border-line bg-surface p-3 shadow-lg"
    >
      {/* ── Destinations ── */}
      <div className="flex flex-col gap-1.5">
        <span className={LABEL}>Broadcast to</span>
        <div className="flex flex-wrap gap-1.5">
          {targets.length === 0 && <span className="text-xs text-faint">No destinations configured.</span>}
          {targets.map((t) => {
            const ok = accepts(t)
            const on = picked.includes(t.id)
            return (
              <button
                key={t.id}
                type="button"
                disabled={!ok}
                title={ok ? undefined : `No ${assetClass} channel mapped for ${t.label}`}
                onClick={() => setPicked((p) => (p.includes(t.id) ? p.filter((x) => x !== t.id) : [...p, t.id]))}
                className={[PILL, on ? ON : OFF].join(' ')}
              >
                {t.label}
                {!ok && ' · none'}
              </button>
            )
          })}
          {targets.length > 1 && (
            <button
              type="button"
              onClick={() => {
                const eligible = targets.filter(accepts).map((t) => t.id)
                setPicked(picked.length === eligible.length ? [] : eligible)
              }}
              className={[PILL, 'border-line text-faint hover:text-fg'].join(' ')}
            >
              All
            </button>
          )}
        </div>
      </div>

      {/* ── Asset class ── */}
      <div className="flex flex-wrap gap-1.5">
        {ASSETS.map((a) => (
          <button
            key={a.id}
            type="button"
            onClick={() => setAssetClass(a.id)}
            className={[PILL, assetClass === a.id ? ON : OFF].join(' ')}
          >
            {a.label}
          </button>
        ))}
      </div>

      {/* ── Action ── */}
      {shows.trade && (
        <div className="flex flex-wrap gap-1.5">
          {ACTIONS.map((a) => (
            <button
              key={a.id}
              type="button"
              onClick={() => setAction(a.id)}
              className={[PILL, action === a.id ? ON : OFF].join(' ')}
            >
              {a.label}
            </button>
          ))}
        </div>
      )}

      {/* ── Trade details ── */}
      {shows.trade && (
        <div className="flex flex-wrap gap-2">
          <input
            value={ticker}
            onChange={(e) => setTicker(e.target.value.toUpperCase())}
            placeholder="TICKER"
            className={[FIELD, 'flex-[1_1_7rem] font-bold tracking-wide'].join(' ')}
          />
          {shows.opt && (
            <>
              <input
                value={strike}
                onChange={(e) => setStrike(e.target.value)}
                inputMode="decimal"
                placeholder="Strike"
                className={[FIELD, 'flex-[1_1_5rem]'].join(' ')}
              />
              <button
                type="button"
                onClick={() => setRight((r) => (r === 'call' ? 'put' : 'call'))}
                title="Call / Put"
                className={[PILL, right === 'call' ? 'border-up text-up' : 'border-down text-down'].join(' ')}
              >
                {right === 'call' ? 'Call' : 'Put'}
              </button>
              <input
                type="date"
                value={expiry}
                onChange={(e) => setExpiry(e.target.value)}
                className={[FIELD, 'flex-[1_1_9rem]'].join(' ')}
              />
            </>
          )}
          <input
            value={price}
            onChange={(e) => setPrice(e.target.value)}
            inputMode="decimal"
            placeholder="Entry / exit price"
            className={[FIELD, 'flex-[2_1_9rem]'].join(' ')}
          />
        </div>
      )}

      {/* ── Thesis ── */}
      <textarea
        value={notes}
        onChange={(e) => setNotes(e.target.value)}
        rows={3}
        placeholder={assetClass === 'notes' ? 'What should the room know?' : "What's the thesis?"}
        className={[FIELD, 'resize-y font-sans'].join(' ')}
      />

      {/* ── Chart ── */}
      {image ? (
        <div className="relative overflow-hidden rounded-sm border border-line">
          <img src={image} alt="" className="block max-h-44 w-full object-contain" />
          <button
            type="button"
            onClick={() => setImage(null)}
            title="Remove chart"
            className="absolute right-1.5 top-1.5 rounded-full border border-down bg-surface px-1.5 text-xs font-bold text-down"
          >
            ✕
          </button>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => fileRef.current?.click()}
          className="rounded-sm border border-dashed border-line py-3 text-xs text-faint transition-colors hover:border-accent hover:text-fg"
        >
          Paste a screenshot (Ctrl+V) · or click to browse
        </button>
      )}
      <input
        ref={fileRef}
        type="file"
        accept="image/*"
        hidden
        onChange={(e) => {
          const f = e.target.files?.[0]
          if (f) readImage(f)
          e.target.value = ''
        }}
      />

      {/* ── Embed bar ── Auto derives it from the action server-side. */}
      {bars.length > 0 && (
        <div className="flex items-center gap-1.5">
          <span className={LABEL}>Bar</span>
          <button
            type="button"
            onClick={() => setBarChoice('auto')}
            className={[PILL, barChoice === 'auto' ? ON : OFF].join(' ')}
          >
            Auto
          </button>
          {bars.map((c) => (
            <button
              key={c.id}
              type="button"
              title={c.label}
              onClick={() => setBarChoice(c.id)}
              className={[
                'h-5 w-5 rounded-sm border transition-transform',
                barChoice === c.id ? 'scale-110 border-fg' : 'border-line',
              ].join(' ')}
              style={{ background: c.hex }}
            />
          ))}
        </div>
      )}

      {msg && (
        <div
          className={[
            'rounded-sm border px-2 py-1.5 text-xs',
            msg.kind === 'ok'
              ? 'border-up text-up'
              : msg.kind === 'warn'
                ? 'border-warn text-warn'
                : 'border-down text-down',
          ].join(' ')}
        >
          {msg.text}
        </div>
      )}

      <div className="flex items-center gap-2">
        <button type="button" onClick={close} className={[PILL, 'border-line text-faint hover:text-fg'].join(' ')}>
          Close
        </button>
        <button
          type="button"
          onClick={send}
          disabled={!canSend}
          className={[PILL, 'ml-auto', canSend ? ON : 'border-line text-faint'].join(' ')}
        >
          {sending ? 'Broadcasting…' : 'Broadcast alert'}
        </button>
      </div>
    </div>
  )
}

export default BotAlertPanel
