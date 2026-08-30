// ─────────────────────────────────────────────────────────────────────────────
// THE LADDER — the single-column replay the "⛶ Ladder" button opens.
//
// A DIFFERENT data path from the in-grid replay, and that is not an accident:
// /proxy/strike-growth/frames returns ONE net per strike for the front active
// expiry, where /frames-by-expiry returns the whole matrix. The ladder is the
// front contract's profile moving through the day; the grid is every expiry at
// one instant. Both read the same recorder.
//
// Two pieces of behaviour are transcribed rather than simplified, because both
// were bugs that took a while to see:
//
//   • The spot line's vertical position is DERIVED DURING RENDER, not held in
//     state. Measured in a layout effect it sat one commit behind the `spot` the
//     label printed in the same paint — invisible at rest, and tens of strikes
//     out during playback.
//   • The spot TWEEN lands exactly on the frame's spot in its cleanup. An
//     interrupted tween otherwise leaves the displayed spot SHORT of the frame
//     it was heading for, the next tween starts from that shortfall, and the
//     error compounds — one dropped frame is invisible, a few hundred is how the
//     dashed line ends up dozens of strikes from the price.
//
// Spec: docs/parity/options-chain.md — Part O.
// ─────────────────────────────────────────────────────────────────────────────

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { alpha, LIGHT_BLUE, MOVE_UP, SHADOW, T } from '@/design/theme'
import { query } from '@/data/api'
import { fmtClockHm, fmtExpiryShort, fmtGex, fmtReplayClock, fmtStampDate } from './format'
import { TickerPicker } from '@/design/primitives/TickerPicker'

interface Strike {
  strike: number
  net: number
}
interface Frame {
  ts: string
  spot: number
  strikes: Strike[]
  /** Front active expiry covered by this snapshot; can roll intraday. */
  expiry?: string | null
  /** How many distinct expiries were summed into this frame's net. */
  expiryCount?: number
}

const SPEEDS = [0.5, 1, 2, 4, 8]
const BASE_MS = 700
/** Positive net GEX. v2 used HOME_THEME.green here, which is a light blue. */
const POS = MOVE_UP
const NEG = T.red
const SUB = alpha(T.text, 0.55)

async function get<TResult>(url: string): Promise<TResult | null> {
  try {
    return await query<TResult>(url, { staleMs: 0 })
  } catch {
    return null
  }
}

const inputStyle: React.CSSProperties = {
  fontSize: 14,
  padding: '8px 12px',
  border: `1px solid ${T.border}`,
  borderRadius: 6,
  background: T.panelBg,
  color: T.text,
  outline: 'none',
}

export function LadderModal({
  symbol: initialSymbol,
  onClose,
}: {
  symbol: string
  onClose: () => void
}) {
  const [symbols, setSymbols] = useState<string[]>([])
  const [symbol, setSymbol] = useState<string>((initialSymbol || '').toUpperCase())
  const [dates, setDates] = useState<string[]>([])
  const [date, setDate] = useState<string>('')
  const [frames, setFrames] = useState<Frame[]>([])
  /** Distinct expiries recorded for symbol+date — the fallback label when a
   *  frame carries no `expiry` (an older server build). */
  const [expiries, setExpiries] = useState<string[]>([])
  const [idx, setIdx] = useState(0)
  const [playing, setPlaying] = useState(false)
  const [speed, setSpeed] = useState(1)
  const [scaleMode, setScaleMode] = useState<'frame' | 'day'>('frame')
  const [loading, setLoading] = useState(false)
  const [err, setErr] = useState('')

  useEffect(() => {
    void (async () => {
      const j = await get<{ ok?: boolean; symbols?: string[] }>('/proxy/strike-growth/replay-meta')
      if (!j?.ok) {
        setErr('Could not load recorded symbols.')
        return
      }
      const syms = j.symbols ?? []
      setSymbols(syms)
      setSymbol((cur) => cur || (syms.includes('MSFT') ? 'MSFT' : (syms[0] ?? '')))
    })()
  }, [])

  useEffect(() => {
    if (!symbol) return
    void (async () => {
      const j = await get<{ ok?: boolean; dates?: string[] }>(
        `/proxy/strike-growth/replay-meta?symbol=${encodeURIComponent(symbol)}`,
      )
      if (!j?.ok) {
        setErr('Could not load recorded dates.')
        return
      }
      const ds = j.dates ?? []
      setDates(ds)
      setDate(ds[0] ?? '')
    })()
  }, [symbol])

  useEffect(() => {
    if (!symbol || !date) return
    setLoading(true)
    setErr('')
    setPlaying(false)
    void (async () => {
      const j = await get<{ ok?: boolean; error?: string; frames?: Frame[]; expiries?: string[] }>(
        `/proxy/strike-growth/frames?symbol=${encodeURIComponent(symbol)}&date=${encodeURIComponent(date)}`,
      )
      if (!j) {
        setErr('Could not load frames.')
        setFrames([])
        setExpiries([])
      } else if (!j.ok) {
        setErr(j.error || 'No data.')
        setFrames([])
        setExpiries([])
      } else {
        setFrames(j.frames ?? [])
        setExpiries(j.expiries ?? [])
        setIdx(0)
      }
      setLoading(false)
    })()
  }, [symbol, date])

  useEffect(() => {
    if (!playing || frames.length === 0) return
    const id = setInterval(() => setIdx((i) => (i >= frames.length - 1 ? i : i + 1)), BASE_MS / speed)
    return () => clearInterval(id)
  }, [playing, speed, frames.length])

  // Stop at the last frame. Deliberately NOT inside the setIdx updater above:
  // updaters must be pure (StrictMode invokes them twice), and setting state
  // from inside one double-fires the pause.
  useEffect(() => {
    if (playing && frames.length > 0 && idx >= frames.length - 1) setPlaying(false)
  }, [playing, idx, frames.length])

  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', h)
    return () => document.removeEventListener('keydown', h)
  }, [onClose])

  const frame = frames[idx]

  // ── The spot tween ─────────────────────────────────────────────────────────
  const animSpot = useRef(0)
  const animSpotInit = useRef(false)
  const [, forceTick] = useState(0)
  useEffect(() => {
    const target = frame?.spot || 0
    if (!animSpotInit.current) {
      animSpot.current = target
      animSpotInit.current = true
      forceTick((x) => x + 1)
      return
    }
    const start = animSpot.current
    if (start === target) {
      forceTick((x) => x + 1)
      return
    }
    // Scrubbing snaps instantly — animating here would restart a fresh tween on
    // every intermediate frame while dragging, stacking overlapping tweens that
    // overshoot and make the value bounce around instead of tracking the handle.
    if (!playing) {
      animSpot.current = target
      forceTick((x) => x + 1)
      return
    }
    const duration = Math.min(BASE_MS / speed, 450)
    const t0 = performance.now()
    let raf = 0
    const step = (now: number) => {
      const t = Math.min(1, (now - t0) / duration)
      const ease = 1 - Math.pow(1 - t, 2)
      animSpot.current = start + (target - start) * ease
      forceTick((x) => x + 1)
      if (t < 1) raf = requestAnimationFrame(step)
    }
    raf = requestAnimationFrame(step)
    return () => {
      cancelAnimationFrame(raf)
      // Land exactly on this frame's spot before the next tween reads
      // animSpot.current as its `start` — see the header note on compounding.
      animSpot.current = target
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [frame?.ts, frame?.spot, playing])

  const maxAbs = useMemo(() => {
    let m = 0
    for (const f of frames) for (const s of f.strikes) m = Math.max(m, Math.abs(s.net))
    return m || 1
  }, [frames])

  const allStrikes = useMemo(() => {
    const set = new Set<number>()
    for (const f of frames) for (const s of f.strikes) set.add(s.strike)
    return Array.from(set).sort((a, b) => b - a)
  }, [frames])

  const netByStrike = useMemo(() => {
    const m = new Map<number, number>()
    if (frame) for (const s of frame.strikes) m.set(s.strike, s.net)
    return m
  }, [frame])

  /** Largest |net| in the CURRENT frame — so the biggest bar of every snapshot
   *  fills the row even early in the day, when the session peak (usually EOD)
   *  would squash it to a sliver. */
  const frameMax = useMemo(() => {
    let m = 0
    if (frame) for (const s of frame.strikes) m = Math.max(m, Math.abs(s.net))
    return m
  }, [frame])

  const denom = (scaleMode === 'day' ? maxAbs : frameMax) || 1
  const spot = animSpot.current

  const frameExpiry = frame?.expiry || expiries[0] || ''
  const extraExpiries = Math.max(0, (frame?.expiryCount ?? expiries.length) - 1)
  const isZeroDte = !!frameExpiry && frameExpiry === date

  // ── Row geometry, measured once per ladder size ────────────────────────────
  const rowsContainerRef = useRef<HTMLDivElement | null>(null)
  const rowsColRef = useRef<HTMLDivElement | null>(null)
  const [rowGeom, setRowGeom] = useState<{ top0: number; pitch: number } | null>(null)

  useLayoutEffect(() => {
    const container = rowsContainerRef.current
    const col = rowsColRef.current
    const n = allStrikes.length
    if (!container || !col || n === 0) {
      setRowGeom(null)
      return
    }
    const measure = () => {
      const first = col.firstElementChild as HTMLElement | null
      const last = col.lastElementChild as HTMLElement | null
      if (!first || !last) return
      const cTop = container.getBoundingClientRect().top
      const fr = first.getBoundingClientRect()
      const lr = last.getBoundingClientRect()
      const top0 = fr.top - cTop + fr.height / 2
      const lastMid = lr.top - cTop + lr.height / 2
      // first→last / (n−1), never a guessed px-per-row constant, so there is no
      // compounding rounding error.
      const pitch = n > 1 ? (lastMid - top0) / (n - 1) : fr.height
      setRowGeom((prev) =>
        prev && Math.abs(prev.top0 - top0) < 0.5 && Math.abs(prev.pitch - pitch) < 0.01
          ? prev
          : { top0, pitch },
      )
    }
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(col)
    return () => ro.disconnect()
  }, [allStrikes])

  /** Continuous row index of `spot`, interpolated between the two bracketing
   *  strikes so uneven spacing still lands correctly. Off either end it parks one
   *  row past the edge rather than clamping onto the edge strike. */
  const spotTop = useMemo(() => {
    const n = allStrikes.length
    if (!rowGeom || n === 0 || !(spot > 0)) return null
    let i = 0
    while (i < n && (allStrikes[i] as number) > spot) i++
    let pos: number
    if (i === 0) pos = -1
    else if (i >= n) pos = n
    else {
      const hi = allStrikes[i - 1] as number
      const lo = allStrikes[i] as number
      pos = i - 1 + (hi === lo ? 0 : (hi - spot) / (hi - lo))
    }
    return rowGeom.top0 + pos * rowGeom.pitch
  }, [rowGeom, allStrikes, spot])

  // Memoised so a tween tick (which re-renders ~60×/s purely to move the spot
  // line) does not reconcile several hundred bar rows.
  const ladder = useMemo(
    () =>
      allStrikes.map((k) => {
        const net = netByStrike.get(k) ?? 0
        const pct = Math.min(100, (Math.abs(net) / denom) * 100)
        const positive = net >= 0
        return (
          <div key={k} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <div
              style={{ width: 56, textAlign: 'right', fontSize: 12, color: T.text, fontVariantNumeric: 'tabular-nums' }}
            >
              {k}
            </div>
            <div style={{ flex: 1, display: 'flex', alignItems: 'center', height: 16 }}>
              <div style={{ flex: 1, display: 'flex', justifyContent: 'flex-end' }}>
                {!positive && (
                  <div style={{ width: `${pct}%`, height: 12, background: NEG, borderRadius: '3px 0 0 3px', opacity: 0.9 }} />
                )}
              </div>
              <div style={{ width: 1, height: 16, background: T.border }} />
              <div style={{ flex: 1, display: 'flex', justifyContent: 'flex-start' }}>
                {positive && (
                  <div style={{ width: `${pct}%`, height: 12, background: POS, borderRadius: '0 3px 3px 0', opacity: 0.9 }} />
                )}
              </div>
            </div>
            <div
              style={{
                width: 68,
                textAlign: 'left',
                fontSize: 11,
                color: positive ? POS : NEG,
                fontVariantNumeric: 'tabular-nums',
              }}
            >
              {fmtGex(net)}
            </div>
          </div>
        )
      }),
    [allStrikes, netByStrike, denom],
  )

  if (typeof document === 'undefined') return null

  return createPortal(
    <div
      onClick={onClose}
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 9999,
        background: alpha(SHADOW, 0.72),
        display: 'flex',
        alignItems: 'flex-start',
        justifyContent: 'center',
        padding: '40px 16px',
        overflowY: 'auto',
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: 'min(760px, 100%)',
          background: T.panel,
          border: `1px solid ${T.border}`,
          borderRadius: 14,
          padding: '18px 20px 20px',
          boxShadow: `0 24px 60px ${alpha(SHADOW, 0.55)}`,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
          <div>
            <div style={{ fontSize: 16, fontWeight: 800, color: T.text, letterSpacing: '0.02em' }}>
              Option Chain Replay
            </div>
            <div style={{ fontSize: 12, color: SUB }}>
              Play back the recorded per-strike net-GEX profile through the session.
            </div>
          </div>
          <button
            onClick={onClose}
            aria-label="Close"
            style={{
              ...inputStyle,
              width: 34,
              height: 34,
              padding: 0,
              cursor: 'pointer',
              fontSize: 18,
              lineHeight: 1,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            ✕
          </button>
        </div>

        {/* Controls */}
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, alignItems: 'center', marginBottom: 14 }}>
          <span
            style={{
              fontSize: 13,
              fontWeight: 800,
              color: T.cyan,
              letterSpacing: '0.06em',
              fontFamily: 'var(--font-mono)',
              minWidth: 46,
            }}
          >
            {symbol || '—'}
          </span>
          {/* The RECORDER's symbol list, not the board's — a session can only
              be replayed for a root the recorder actually swept. */}
          <TickerPicker
            activeTicker={symbol}
            universe={symbols.length ? symbols : undefined}
            onSelect={setSymbol}
            triggerLabel="Tickers"
          />
          <select value={date} style={{ ...inputStyle, padding: '6px 10px', cursor: 'pointer' }} onChange={(e) => setDate(e.target.value)}>
            {dates.map((d) => (
              <option key={d} value={d}>
                {d}
              </option>
            ))}
          </select>
          <button
            style={{
              ...inputStyle,
              padding: '6px 16px',
              cursor: 'pointer',
              minWidth: 74,
              background: playing ? alpha(NEG, 0.15) : alpha(LIGHT_BLUE, 0.15),
              borderColor: playing ? NEG : LIGHT_BLUE,
              color: T.text,
              fontWeight: 600,
            }}
            disabled={!frames.length}
            onClick={() => {
              if (idx >= frames.length - 1) setIdx(0)
              setPlaying((p) => !p)
            }}
          >
            {playing ? '❚❚ Pause' : '▶ Play'}
          </button>
          <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
            <span style={{ fontSize: 12, color: SUB }}>Speed</span>
            {SPEEDS.map((sp) => (
              <button
                key={sp}
                onClick={() => setSpeed(sp)}
                style={{
                  ...inputStyle,
                  padding: '4px 8px',
                  cursor: 'pointer',
                  fontSize: 12,
                  borderColor: speed === sp ? LIGHT_BLUE : T.border,
                  color: speed === sp ? LIGHT_BLUE : SUB,
                }}
              >
                {sp}×
              </button>
            ))}
          </div>
          <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
            <span style={{ fontSize: 12, color: SUB }}>Scale</span>
            {(['frame', 'day'] as const).map((m) => (
              <button
                key={m}
                onClick={() => setScaleMode(m)}
                title={
                  m === 'frame'
                    ? 'Rescale each snapshot to its own peak — bars always readable'
                    : 'Fixed session-wide scale — magnitudes comparable across time'
                }
                style={{
                  ...inputStyle,
                  padding: '4px 8px',
                  cursor: 'pointer',
                  fontSize: 12,
                  textTransform: 'capitalize',
                  borderColor: scaleMode === m ? LIGHT_BLUE : T.border,
                  color: scaleMode === m ? LIGHT_BLUE : SUB,
                }}
              >
                {m}
              </button>
            ))}
          </div>
        </div>

        {/* Scrubber */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 6 }}>
          <input
            type="range"
            min={0}
            max={Math.max(0, frames.length - 1)}
            value={idx}
            disabled={!frames.length}
            onChange={(e) => {
              setPlaying(false)
              setIdx(Number(e.target.value))
            }}
            style={{ flex: 1, accentColor: LIGHT_BLUE }}
          />
          <div
            style={{
              fontVariantNumeric: 'tabular-nums',
              minWidth: 150,
              textAlign: 'right',
              fontSize: 14,
              color: T.text,
            }}
          >
            {frame ? (
              <>
                <strong>{fmtClockHm(frame.ts)}</strong> ET<span style={{ color: SUB }}> · spot {spot.toFixed(2)}</span>
              </>
            ) : (
              '—'
            )}
          </div>
        </div>
        <div style={{ fontSize: 12, color: SUB, marginBottom: 14 }}>
          {frames.length ? `Frame ${idx + 1} / ${frames.length}` : ''}
        </div>

        {loading && <div style={{ padding: 40, textAlign: 'center', color: SUB }}>Loading…</div>}
        {!loading && err && <div style={{ padding: 24, textAlign: 'center', color: NEG }}>{err}</div>}
        {!loading && !err && !frames.length && (
          <div style={{ padding: 40, textAlign: 'center', color: SUB }}>
            No recorded frames for {symbol} on {date || 'this date'}.
          </div>
        )}

        {!loading && !err && frame && (
          <div ref={rowsContainerRef} style={{ position: 'relative' }}>
            {/* Provenance stamp — ticker, expiry and the frame's own wall clock,
                burned into the ladder itself so a screen-grab carries what it is
                and when, with no surrounding chrome needed. */}
            <div
              style={{
                position: 'absolute',
                left: 64,
                top: 0,
                zIndex: 3,
                pointerEvents: 'none',
                display: 'flex',
                flexDirection: 'column',
                gap: 3,
                padding: '6px 10px',
                borderRadius: 8,
                background: alpha(T.bg, 0.62),
                border: `1px solid ${T.border}`,
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <span
                  style={{
                    fontSize: 15,
                    fontWeight: 800,
                    letterSpacing: '0.08em',
                    color: T.cyan,
                    fontFamily: 'var(--font-mono)',
                    lineHeight: 1,
                  }}
                >
                  {symbol || '—'}
                </span>
                {frameExpiry && (
                  <span
                    style={{
                      fontSize: 10,
                      fontWeight: 700,
                      letterSpacing: '0.06em',
                      lineHeight: 1,
                      padding: '3px 6px',
                      borderRadius: 4,
                      color: isZeroDte ? T.orange : LIGHT_BLUE,
                      border: `1px solid ${alpha(isZeroDte ? T.orange : LIGHT_BLUE, 0.45)}`,
                      background: alpha(isZeroDte ? T.orange : LIGHT_BLUE, 0.1),
                    }}
                  >
                    {isZeroDte ? '0DTE' : `EXP ${fmtExpiryShort(frameExpiry)}`}
                  </span>
                )}
                {extraExpiries > 0 && (
                  <span
                    title={`Net summed across ${extraExpiries + 1} expiries`}
                    style={{ fontSize: 10, fontWeight: 700, color: SUB, lineHeight: 1 }}
                  >
                    +{extraExpiries}
                  </span>
                )}
              </div>
              <div style={{ fontSize: 11, color: SUB, fontVariantNumeric: 'tabular-nums', lineHeight: 1.2 }}>
                {date ? fmtStampDate(date) : ''}
                {frame ? `${date ? ' · ' : ''}${fmtReplayClock(frame.ts)} ET` : ''}
              </div>
            </div>

            {spotTop !== null && (
              <div
                style={{
                  position: 'absolute',
                  left: 64,
                  right: 0,
                  top: spotTop,
                  height: 0,
                  borderTop: `1px dashed ${T.text}`,
                  pointerEvents: 'none',
                  zIndex: 1,
                  // No CSS transition here. The JS tween above already eases
                  // `spot`; a transition on top of it re-starts every animation
                  // frame, so the line permanently trails its own label.
                }}
              >
                <span
                  style={{
                    position: 'absolute',
                    right: 0,
                    top: -8,
                    fontSize: 10,
                    color: T.text,
                    background: T.panel,
                    padding: '0 4px',
                  }}
                >
                  spot {spot.toFixed(2)}
                </span>
              </div>
            )}
            <div ref={rowsColRef} style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
              {ladder}
            </div>
          </div>
        )}
      </div>
    </div>,
    document.body,
  )
}
