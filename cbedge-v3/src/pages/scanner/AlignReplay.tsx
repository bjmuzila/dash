// ─────────────────────────────────────────────────────────────────────────────
// ALIGN REPLAY — the drill-in behind a ticker click on /scanner?tab=align.
//
// URL: /scanner?tab=align&sym=AMZN&d=2026-10-07. Draws each expiry's wall,
// minute by minute, for the session — the lines converging on one strike IS the
// setup — with spot, the state shading (PENDING / LOCKED) and an "aligned count"
// strip underneath. Beside it: the order the expiries joined the wall, the
// walls right now, and this ticker's events.
//
// THREE THINGS THAT ARE NOT OBVIOUS
//
//   1. THE CHART READS THE CHAIN REPLAY, not the board's segments. The board's
//      payload is run-length strikes only; the replay needs spot per minute,
//      which /proxy/strike-growth/frames-by-expiry already serves (it is what
//      the Options Chain's replay mode draws from). The wall per frame is
//      recomputed here by the same rule the server applies.
//   2. BOTH REQUESTS FIRE AT ENTRY. The board response (for current walls,
//      dominance and events) is the same URL the board polls, so it is usually
//      a cache hit; the frames URL carries the session date from the click, so
//      it never waits on the board (AGENTS.md rule 3).
//   3. ONE CANVAS, through ChartFrame + useCanvasRenderer, so it inherits the
//      visibility gate and the data-cb-layer tag (non-negotiables 5 and 6).
//      Colours are read with tokenHex at paint time.
// ─────────────────────────────────────────────────────────────────────────────

import { useEffect, useMemo, type ReactNode } from 'react'
import { Card } from '@/design/primitives/Card'
import { ChartFrame } from '@/design/primitives/ChartFrame'
import { T, V2, V2W, tokenHex, tokenHexAlpha } from '@/design/theme'
import { readableError, useQuery } from '@/data/api'
import { sizeCanvas, useCanvasRenderer } from '@/board/chart-render'
import { EM_DASH, fmtB } from '@/pages/scanner/format'
import {
  ALIGN_POLL_MS,
  STATE_LABEL,
  alignUrl,
  pastDate,
  buildRow,
  evaluate,
  fmtEt,
  fmtExpiry,
  fmtHeld,
  fmtStrike,
  framesUrl,
  joinOrder,
  parseReplay,
  steadySeries,
  type AlignResponse,
  type AlignSettings,
  type ReplayResponse,
  type ReplaySeries,
  type Verdict,
} from '@/pages/scanner/align'
import {
  DIM,
  EVENT_COLOR,
  LABEL,
  STATE_COLOR,
  STATE_TOKEN,
  expColor,
  expToken,
  pillStyle,
} from '@/pages/scanner/alignStyle'

const CHART_H = 440
/** On the type scale (text-2xs). Canvas cannot take a class. */
const AXIS_PX = 10

function fontMono(): string {
  try {
    const v = getComputedStyle(document.documentElement).getPropertyValue('--font-mono').trim()
    return v || 'monospace'
  } catch {
    return 'monospace'
  }
}

export default function AlignReplay({
  symbol,
  date,
  settings,
  onBack,
}: {
  symbol: string
  date: string | null
  settings: AlignSettings
  onBack: () => void
}) {
  // Both at entry — see note 2. Same URL as the board that opened this, so it is a cache hit.
  // A past date reads the saved board for that day; today polls the live one.
  const day = pastDate(date)
  const board = useQuery<AlignResponse>(alignUrl(settings.mode, day), {
    pollMs: day ? undefined : ALIGN_POLL_MS,
    staleMs: 30_000,
  })
  const live = !day
  const frames = useQuery<ReplayResponse>(framesUrl(symbol, date), {
    pollMs: live ? ALIGN_POLL_MS : undefined,
    staleMs: 30_000,
  })

  const symRaw = board.data?.symbols?.find((s) => s.symbol === symbol)
  const sessionDate = date ?? board.data?.date
  const now = live ? Date.now() : (symRaw?.t ?? Date.now())
  const row = useMemo(
    () => (symRaw ? buildRow(symRaw, settings, sessionDate ?? undefined, now) : null),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [symRaw, settings, sessionDate, Math.floor(now / 60_000)],
  )

  const series = useMemo(
    () => parseReplay(frames.data, settings.mode, symRaw?.expiries),
    [frames.data, settings.mode, symRaw?.expiries],
  )
  const step = symRaw?.step ?? inferStep(series)
  // The same Hold rule the board applies: a wall move counts once it has held
  // `holdMin` minutes. The raw per-minute walls are still drawn, faintly.
  const holdMs = Math.max(0, settings.holdMin) * 60_000
  const steady = useMemo<ReplaySeries>(
    () => ({ ...series, walls: series.walls.map((w) => steadySeries(series.t, w, holdMs)) }),
    [series, holdMs],
  )
  const verdicts = useMemo(
    () =>
      steady.t.map((_, fi) =>
        evaluate(
          steady.walls.map((w) => w[fi] ?? null),
          step,
          settings,
        ),
      ),
    [steady, step, settings],
  )

  const lastV = verdicts[verdicts.length - 1]
  const verdict: Verdict | undefined = row?.verdict ?? lastV
  const k = verdict?.k ?? null
  const joins = useMemo(() => joinOrder(steady, k, step, settings.tol), [steady, k, step, settings.tol])
  const frontIsZeroDte = !!sessionDate && series.expiries[0] === sessionDate

  const replayError =
    frames.error != null
      ? readableError(frames.error, 'Could not load the session replay.')
      : frames.data && frames.data.ok === false
        ? String(frames.data.error ?? 'No recorded frames.')
        : frames.data && series.t.length === 0
          ? `No recorded frames for ${symbol}${sessionDate ? ` on ${sessionDate}` : ''}.`
          : ''

  const title = `${symbol} · Wall convergence`

  return (
    <Card title={title}>
      <div className="mb-3 flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={onBack}
          className="rounded-sm border border-line px-3 py-1 text-xs text-muted transition-colors hover:bg-raised hover:text-fg"
        >
          ← Board
        </button>
        <span className="text-lg font-bold text-fg">{symbol}</span>
        {verdict && (
          <span
            className="rounded-full px-2 py-0.5 text-2xs font-bold tracking-wide"
            style={pillStyle(STATE_COLOR[verdict.state])}
          >
            {STATE_LABEL[verdict.state]}
            {k != null ? ` ${fmtStrike(k)}` : ''}
          </span>
        )}
        {row && row.verdict.state !== 'SCATTERED' && (
          <span className="text-xs" style={{ color: DIM }}>
            held {fmtHeld(now - row.since)}
          </span>
        )}
        {row && (
          <span className="tabular text-xs" style={{ color: DIM }}>
            spot {row.spot > 0 ? row.spot.toFixed(2) : EM_DASH}
            {row.distStrikes != null ? ` · wall ${row.distStrikes > 0 ? '+' : ''}${row.distStrikes} strikes` : ''}
            {row.distPct != null ? ` (${row.distPct >= 0 ? '+' : ''}${(row.distPct * 100).toFixed(1)}%)` : ''}
          </span>
        )}
        <span className="ml-auto tabular text-xs" style={{ color: DIM }}>
          {sessionDate ? `session ${sessionDate}` : ''}
          {frames.loading ? ' · loading…' : ''}
        </span>
      </div>

      <div className="flex flex-wrap items-start gap-3">
        <div className="min-w-0 rounded-md border border-line p-3" style={{ flex: '999 1 640px' }}>
          {/* Wall Migration's legend (2026-10-08): a square swatch, the name,
              and the value it holds RIGHT NOW in mono — so the chart reads
              without hunting for where each line ends. */}
          <div className="mb-2 flex flex-wrap items-center gap-x-4 gap-y-1 font-mono text-xs tabular">
            <span className="mr-1 font-bold uppercase tracking-wide text-fg">
              {MODE_TITLE[settings.mode]}
            </span>
            {series.expiries.map((e, i) => (
              <span key={e} className="flex items-center gap-1.5 text-fg">
                <span className="inline-block rounded-sm" style={{ width: 11, height: 11, background: expColor(i) }} />
                {i === 0 ? (frontIsZeroDte ? '0DTE ' : 'Front ') : ''}
                {fmtExpiry(e)}
                <span className="font-bold" style={{ color: expColor(i) }}>
                  {lastOf(steady.walls[i]) != null ? fmtStrike(lastOf(steady.walls[i]) as number) : EM_DASH}
                </span>
              </span>
            ))}
            {symRaw?.all?.state === 'ok' && symRaw.all.strike != null && (
              <span className="flex items-center gap-1.5 text-fg">
                <span className="inline-block w-4 border-t-2 border-dashed" style={{ borderColor: V2.accent }} />
                ALL ex-0D
                <span className="font-bold" style={{ color: V2.accent }}>{fmtStrike(symRaw.all.strike)}</span>
              </span>
            )}
            <span className="flex items-center gap-1.5 text-fg">
              <span className="inline-block rounded-sm" style={{ width: 11, height: 11, background: T.text }} />
              spot
              <span className="font-bold">{lastOf(series.spot)?.toFixed(2) ?? EM_DASH}</span>
            </span>
          </div>
          {replayError ? (
            <div className="flex items-center justify-center text-xs" style={{ height: CHART_H, color: DIM }}>
              {replayError}
            </div>
          ) : (
            <div className="flex" style={{ height: CHART_H }}>
              <ConvergenceChart
                raw={series}
                series={steady}
                verdicts={verdicts}
                k={k}
                step={step}
                allSegs={symRaw?.all?.state === 'ok' ? (symRaw.all.segs ?? null) : null}
              />
            </div>
          )}
        </div>

        <div className="flex min-w-0 flex-col gap-3" style={{ flex: '1 1 300px' }}>
          <Panel title="Join order">
            {k == null && <div className="text-xs" style={{ color: DIM }}>No shared wall right now.</div>}
            {k != null &&
              joins.map((j, i) => (
                <div
                  key={j.expiry}
                  className="grid items-center gap-2 border-t border-line/50 py-1.5 text-xs tabular"
                  style={{ gridTemplateColumns: '12px 92px minmax(0, 1fr) auto' }}
                >
                  <span className="inline-block h-3 w-3 rounded-sm" style={{ background: expColor(i) }} />
                  <span className="text-fg">
                    {i === 0 ? (frontIsZeroDte ? '0DTE ' : 'Front ') : ''}
                    {fmtExpiry(j.expiry)}
                  </span>
                  <span style={{ color: DIM }}>
                    {j.t == null
                      ? `at ${j.now != null ? fmtStrike(j.now) : EM_DASH}`
                      : j.from != null
                        ? `${fmtStrike(j.from)} → ${fmtStrike(k)}`
                        : `on ${fmtStrike(k)} from the open`}
                  </span>
                  <span style={{ color: j.t == null ? DIM : i === 0 ? STATE_COLOR.LOCKED : T.text, fontWeight: 700 }}>
                    {j.t == null ? 'not yet' : fmtEt(j.t)}
                  </span>
                </div>
              ))}
          </Panel>

          <Panel title="Walls now">
            {!symRaw && <div className="text-xs" style={{ color: DIM }}>{board.loading || board.data?.warming ? 'loading…' : 'Not on the scanner roster.'}</div>}
            {symRaw && (
              <div className="grid gap-x-3 gap-y-1 text-xs tabular" style={{ gridTemplateColumns: 'minmax(0, 1fr) auto auto auto' }}>
                <span style={{ color: DIM }}>EXPIRY</span>
                <span className="text-right" style={{ color: DIM }}>WALL</span>
                <span className="text-right" style={{ color: DIM }}>$GEX</span>
                <span className="text-right" style={{ color: DIM }}>DOM</span>
                {(row?.sym ?? symRaw).walls.map((w, i) => {
                  const on = verdict?.on[i] ?? false
                  return [
                    <span key={`e${i}`} style={{ color: i === 0 ? STATE_COLOR.PENDING : T.text }}>
                      {i === 0 ? (frontIsZeroDte ? '0DTE ' : 'Front ') : ''}
                      {fmtExpiry(w.expiry)}
                    </span>,
                    <span
                      key={`w${i}`}
                      className="text-right font-bold"
                      style={{ color: on ? T.text : DIM }}
                      title={
                        row && row.walls[i] !== w.strike && w.strike != null
                          ? `Latest sweep has ${fmtStrike(w.strike)}; not held ${settings.holdMin}m yet`
                          : undefined
                      }
                    >
                      {row?.walls[i] != null ? fmtStrike(row.walls[i] as number) : w.strike != null ? fmtStrike(w.strike) : EM_DASH}
                    </span>,
                    <span key={`g${i}`} className="text-right" style={{ color: w.net >= 0 ? V2.up : V2.red }}>
                      {w.net !== 0 ? fmtB(w.net) : EM_DASH}
                    </span>,
                    <span key={`d${i}`} className="text-right">
                      {w.next > 0 ? `${(Math.abs(w.net) / w.next).toFixed(1)}×` : EM_DASH}
                    </span>,
                  ]
                })}
                {symRaw.all?.state === 'ok' && (
                  <>
                    <span style={{ color: LABEL }} title={`${symRaw.all.n ?? '?'} expirations, 0DTE excluded`}>
                      ALL ex-0DTE
                    </span>
                    <span className="text-right font-bold" style={{ color: row?.allOn ? T.text : DIM }}>
                      {symRaw.all.strike != null ? fmtStrike(symRaw.all.strike) : EM_DASH}
                      {row?.allOn ? ' ✓' : ''}
                    </span>
                    <span className="text-right" style={{ color: (symRaw.all.net ?? 0) >= 0 ? V2.up : V2.red }}>
                      {fmtB(symRaw.all.net ?? 0)}
                    </span>
                    <span className="text-right">
                      {symRaw.all.next && symRaw.all.net != null
                        ? `${(Math.abs(symRaw.all.net) / symRaw.all.next).toFixed(1)}×`
                        : EM_DASH}
                    </span>
                  </>
                )}
              </div>
            )}
            {symRaw && symRaw.all?.state !== 'ok' && (
              <div className="mt-1 text-xs" style={{ color: DIM }}>
                ALL ex-0DTE:{' '}
                {!symRaw.all
                  ? 'swept only when 2+ walls agree'
                  : symRaw.all.state === 'queued'
                    ? 'queued for a full-chain sweep'
                    : `sweep failed${symRaw.all.err ? ` (${symRaw.all.err})` : ''}`}
              </div>
            )}
            {symRaw?.all?.state === 'ok' && symRaw.all.at != null && (
              <div className="mt-1 text-xs" style={{ color: DIM }}>
                ALL ex-0DTE swept {fmtEt(symRaw.all.at)}
              </div>
            )}
          </Panel>

          <Panel title="Today's events">
            {(!row || row.events.length === 0) && (
              <div className="text-xs" style={{ color: DIM }}>
                No alignment changes yet.
              </div>
            )}
            {row?.events
              .slice()
              .reverse()
              .map((e, i) => (
                <div
                  key={`${e.t}-${i}`}
                  className="grid items-center gap-2 border-t border-line/50 py-1.5 text-xs"
                  style={{ gridTemplateColumns: '44px 72px minmax(0, 1fr)' }}
                >
                  <span className="tabular" style={{ color: DIM }}>
                    {fmtEt(e.t)}
                  </span>
                  <span
                    className="justify-self-start rounded-full px-2 py-0.5 text-2xs font-bold tracking-wide"
                    style={pillStyle(EVENT_COLOR[e.kind])}
                  >
                    {e.kind}
                  </span>
                  <span className="text-fg">{e.text}</span>
                </div>
              ))}
          </Panel>
        </div>
      </div>

      {board.error && (
        <div className="mt-2 text-xs" style={{ color: V2.red }}>
          {readableError(board.error, 'Could not load the board.')}
        </div>
      )}
    </Card>
  )
}

function Panel({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="rounded-md border border-line p-3" style={{ background: V2W.wash03 }}>
      <div className="mb-1 text-xs font-bold uppercase tracking-wide" style={{ color: LABEL }}>
        {title}
      </div>
      {children}
    </div>
  )
}

const MODE_TITLE: Record<AlignSettings['mode'], string> = {
  abs: 'Core',
  pos: 'Call wall',
  neg: 'Put wall',
}

/** Last non-null, non-zero value of a column. */
function lastOf(col: ReadonlyArray<number | null> | undefined): number | null {
  if (!col) return null
  for (let i = col.length - 1; i >= 0; i--) {
    const v = col[i]
    if (v != null && Number.isFinite(v) && v > 0) return v
  }
  return null
}

function inferStep(s: ReplaySeries): number {
  const set = new Set<number>()
  for (const w of s.walls) for (const v of w) if (v != null) set.add(v)
  const v = [...set].sort((a, b) => a - b)
  let step = Infinity
  for (let i = 1; i < v.length; i++) {
    const d = (v[i] ?? 0) - (v[i - 1] ?? 0)
    if (d > 1e-9 && d < step) step = d
  }
  return Number.isFinite(step) ? step : 0
}

// ── The chart ────────────────────────────────────────────────────────────────

function ConvergenceChart({
  raw,
  series,
  verdicts,
  k,
  step,
  allSegs,
}: {
  raw: ReplaySeries
  series: ReplaySeries
  verdicts: Verdict[]
  k: number | null
  step: number
  allSegs: ReadonlyArray<[number, number]> | null
}) {
  const { onMount, onResize, onVisibility, setDraw } = useCanvasRenderer()
  useEffect(() => {
    setDraw((canvas, w, h) => drawConvergence(canvas, w, h, series, verdicts, k, step, allSegs, raw))
  }, [setDraw, raw, series, verdicts, k, step, allSegs])
  return <ChartFrame className="select-none" onMount={onMount} onResize={onResize} onVisibility={onVisibility} />
}

// ── Wall Migration look (2026-10-08) ─────────────────────────────────────────
// Plain background, crisp step lines, a solid white price line drawn LAST so it
// is never under a wall, and each line's current strike tagged at the right
// edge in its own colour. State lives in the strip underneath only — full-height
// tinting turned the whole plot yellow/green and buried the lines. The raw
// per-minute walls (what Hold smoothed out) are no longer drawn: they doubled
// every line.
const PAD = { l: 52, r: 58, t: 12, b: 50 }
const STRIP_H = 18
const STRIP_GAP = 22

function drawConvergence(
  canvas: HTMLCanvasElement,
  w: number,
  h: number,
  s: ReplaySeries,
  verdicts: Verdict[],
  k: number | null,
  step: number,
  allSegs: ReadonlyArray<[number, number]> | null = null,
  _raw: ReplaySeries | null = null,
): void {
  const ctx = sizeCanvas(canvas, w, h)
  if (!ctx) return
  ctx.clearRect(0, 0, w, h)
  const n = s.t.length
  if (n === 0 || w < 160 || h < 120) return

  const mono = fontMono()
  const ink = tokenHex('--color-fg')
  const dim = tokenHexAlpha('--color-fg', 0.45)
  const grid = tokenHexAlpha('--color-fg', 0.06)

  const x0 = PAD.l
  const x1 = w - PAD.r
  const y0 = PAD.t
  const sy1 = h - 4
  const sy0 = sy1 - STRIP_H
  const y1 = sy0 - STRIP_GAP
  const t0 = s.t[0] ?? 0
  const tN = s.t[n - 1] ?? t0
  const span = Math.max(60_000, tN - t0)
  const X = (t: number) => x0 + ((t - t0) / span) * (x1 - x0)
  const xEnd = (i: number) => (i + 1 < n ? X(s.t[i + 1] ?? tN) : X(tN))

  // y range: every steadied wall, spot, k and the ALL line — half a strike of air.
  let lo = Infinity
  let hi = -Infinity
  const see = (v: number | null | undefined) => {
    if (v == null || !Number.isFinite(v) || v <= 0) return
    if (v < lo) lo = v
    if (v > hi) hi = v
  }
  for (const col of s.walls) for (const v of col) see(v)
  for (const v of s.spot) see(v)
  see(k)
  for (const sg of allSegs ?? []) if (sg[0] <= tN) see(sg[1])
  if (!Number.isFinite(lo) || !Number.isFinite(hi)) return
  const padY = step > 0 ? step * 0.6 : Math.max(0.5, (hi - lo) * 0.05)
  lo -= padY
  hi += padY
  const Y = (v: number) => y1 - ((v - lo) / (hi - lo)) * (y1 - y0)

  // Price grid: a round step, ≤ ~10 labels, faint — Wall Migration's axis.
  ctx.font = `${AXIS_PX}px ${mono}`
  ctx.textAlign = 'right'
  ctx.textBaseline = 'middle'
  const base = step > 0 ? step : 1
  const mult = [1, 2, 4, 5, 10, 20, 25, 50, 100].find((m) => (hi - lo) / (base * m) <= 10) ?? 100
  const gStep = base * mult
  for (let v = Math.ceil(lo / gStep) * gStep; v <= hi + 1e-9; v += gStep) {
    const y = Y(v)
    ctx.strokeStyle = grid
    ctx.lineWidth = 1
    ctx.beginPath()
    ctx.moveTo(x0, y)
    ctx.lineTo(x1, y)
    ctx.stroke()
    ctx.fillStyle = dim
    ctx.fillText(fmtStrike(v), x0 - 6, y)
  }

  // The shared wall, when there is one: a quiet dashed guide with its strike.
  if (k != null) {
    const y = Y(k)
    ctx.strokeStyle = tokenHexAlpha('--color-fg', 0.22)
    ctx.setLineDash([3, 5])
    ctx.beginPath()
    ctx.moveTo(x0, y)
    ctx.lineTo(x1, y)
    ctx.stroke()
    ctx.setLineDash([])
    ctx.fillStyle = ink
    ctx.font = `700 ${AXIS_PX}px ${mono}`
    ctx.fillText(fmtStrike(k), x0 - 6, y)
    ctx.font = `${AXIS_PX}px ${mono}`
  }

  // Hour rules + half-hour labels, faint.
  ctx.textAlign = 'center'
  ctx.textBaseline = 'top'
  const half = 30 * 60_000
  for (let t = Math.ceil(t0 / half) * half; t <= tN; t += half) {
    const x = X(t)
    const hour = Math.round(t / half) % 2 === 0
    ctx.strokeStyle = hour ? tokenHexAlpha('--color-fg', 0.1) : grid
    ctx.beginPath()
    ctx.moveTo(x, y0)
    ctx.lineTo(x, y1)
    ctx.stroke()
    ctx.fillStyle = dim
    ctx.fillText(fmtEt(t), x, y1 + 5)
  }

  // ALL ex-0DTE — dashed, under the expiries.
  if (allSegs && allSegs.length) {
    ctx.strokeStyle = tokenHexAlpha('--color-v2-accent', 0.8)
    ctx.lineWidth = 1.5
    ctx.setLineDash([6, 5])
    ctx.beginPath()
    let prevY: number | null = null
    for (let i = 0; i < allSegs.length; i++) {
      const sg = allSegs[i]
      if (!sg) continue
      const ta = Math.max(t0, sg[0])
      const tb = Math.min(tN, allSegs[i + 1]?.[0] ?? tN)
      if (tb < t0 || ta > tN) continue
      const y = Y(sg[1])
      if (prevY == null) ctx.moveTo(X(ta), y)
      else ctx.lineTo(X(ta), y)
      ctx.lineTo(X(tb), y)
      prevY = y
    }
    ctx.stroke()
    ctx.setLineDash([])
  }

  // Expiry walls: crisp steps, back to front so the front draws on top. Lines
  // sharing a strike are nudged 2px apart so each stays visible.
  const m = s.walls.length
  ctx.lineJoin = 'miter'
  for (let j = m - 1; j >= 0; j--) {
    const col = s.walls[j] ?? []
    const off = (j - (m - 1) / 2) * 2
    ctx.strokeStyle = tokenHex(expToken(j))
    ctx.lineWidth = j === 0 ? 2.2 : 1.8
    ctx.beginPath()
    let prevY: number | null = null
    for (let i = 0; i < n; i++) {
      const v = col[i]
      if (v == null) {
        prevY = null
        continue
      }
      const xa = X(s.t[i] ?? t0)
      const xb = xEnd(i)
      const y = Math.round(Y(v) + off) + 0.5
      if (prevY == null) ctx.moveTo(xa, y)
      else if (prevY !== y) ctx.lineTo(xa, y)
      ctx.lineTo(xb, y)
      prevY = y
    }
    ctx.stroke()
  }

  // Spot: solid white, on top of everything — the line the walls are read against.
  ctx.strokeStyle = ink
  ctx.lineWidth = 1.4
  ctx.lineJoin = 'round'
  ctx.beginPath()
  let started = false
  for (let i = 0; i < n; i++) {
    const v = s.spot[i]
    if (!v) continue
    const x = X(s.t[i] ?? t0)
    const y = Y(v)
    if (!started) {
      ctx.moveTo(x, y)
      started = true
    } else ctx.lineTo(x, y)
  }
  ctx.stroke()

  // Lock markers: a small dot where the state turned LOCKED.
  ctx.font = `700 ${AXIS_PX}px ${mono}`
  for (let i = 0; i < n; i++) {
    const v = verdicts[i]
    const p = verdicts[i - 1]
    if (!v || v.state !== 'LOCKED' || v.k == null) continue
    if (p && p.state === 'LOCKED' && p.k === v.k) continue
    const x = X(s.t[i] ?? t0)
    const y = Y(v.k)
    ctx.fillStyle = tokenHex(STATE_TOKEN.LOCKED)
    ctx.strokeStyle = tokenHex('--color-surface')
    ctx.lineWidth = 2
    ctx.beginPath()
    ctx.arc(x, y, 4.5, 0, Math.PI * 2)
    ctx.stroke()
    ctx.fill()
    ctx.textAlign = 'left'
    ctx.textBaseline = 'bottom'
    ctx.fillText(`LOCK ${fmtEt(s.t[i] ?? t0)}`, Math.min(x + 7, x1 - 70), y - 6)
  }

  // Right-edge tags: each line's current strike in its own colour, nudged apart
  // so two lines on the same strike never print on top of each other.
  type Tag = { y: number; text: string; color: string }
  const tags: Tag[] = []
  for (let j = 0; j < m; j++) {
    const v = lastOf(s.walls[j])
    if (v != null) tags.push({ y: Y(v), text: fmtStrike(v), color: tokenHex(expToken(j)) })
  }
  const allLast = allSegs?.[allSegs.length - 1]?.[1] ?? null
  if (allLast != null) tags.push({ y: Y(allLast), text: `${fmtStrike(allLast)} all`, color: tokenHex('--color-v2-accent') })
  const spotLast = lastOf(s.spot)
  if (spotLast != null) tags.push({ y: Y(spotLast), text: spotLast.toFixed(2), color: ink })
  tags.sort((a, b) => a.y - b.y)
  const GAP = AXIS_PX + 3
  for (let i = 1; i < tags.length; i++) {
    const a = tags[i - 1] as Tag
    const b = tags[i] as Tag
    if (b.y - a.y < GAP) b.y = a.y + GAP
  }
  const over = (tags[tags.length - 1]?.y ?? 0) - y1
  if (over > 0) for (const t of tags) t.y -= over
  ctx.textAlign = 'left'
  ctx.textBaseline = 'middle'
  for (const t of tags) {
    ctx.fillStyle = t.color
    ctx.fillText(t.text, x1 + 6, t.y)
  }

  // Aligned-count strip: how many expiries sit on that minute's shared wall,
  // coloured by state. This is the only place state is painted.
  ctx.strokeStyle = grid
  ctx.lineWidth = 1
  ctx.beginPath()
  ctx.moveTo(x0, sy1)
  ctx.lineTo(x1, sy1)
  ctx.stroke()
  for (let i = 0; i < n; i++) {
    const v = verdicts[i]
    if (!v || v.total === 0 || m === 0) continue
    const bh = (v.total / m) * STRIP_H
    ctx.fillStyle = tokenHexAlpha(STATE_TOKEN[v.state], 0.85)
    const xa = X(s.t[i] ?? t0)
    ctx.fillRect(xa, sy1 - bh, Math.max(1, xEnd(i) - xa), bh)
  }
  ctx.font = `${AXIS_PX}px ${mono}`
  ctx.fillStyle = dim
  ctx.textAlign = 'right'
  ctx.textBaseline = 'middle'
  ctx.fillText(`0–${m}`, x0 - 6, (sy0 + sy1) / 2)
  ctx.textAlign = 'left'
  ctx.fillText('aligned', x1 + 6, (sy0 + sy1) / 2)
}
