// ─────────────────────────────────────────────────────────────────────────────
// ESTIMATED MOVES — /v3/em
//
// A port of v2's /app/em (components/dashboard/EmCustomer.tsx). The SPEC is
// docs/parity/em.md: one row per rendered value, and this page is finished when
// every row is ticked. The maths, the thresholds, the label wording and the
// row ordering are transcribed from v2; only the palette and the render layer
// are new.
//
// PALETTE: re-keyed onto v3's tokens (Brandon, 2026-08-31 — "re-key onto v3
// tokens"). v2 hardcoded five colours that are in no token file — #cbd5e1,
// #e8c060, #00e676, #ff5a6a, #ffc107 — and used two different reds and two
// different greens for the same semantic. The mapping, once, so it is legible:
//
//   Close                        → CAL.previous   (was #cbd5e1)
//   EM                           → T.orange       (was #e8c060)
//   Up · Buy Zone · HIT · ≥65%   → MOVE_UP        (was #00e676)
//   Down · Sell Zone · MISS      → MOVE_DOWN      (was #ff5a6a AND #EF4444)
//   50–64% hit rate              → CAL.medium     (was #ffc107)
//
// The two-reds and two-greens inconsistency collapses by construction: the Sell
// Zone's border and its text are now one colour, and the sub-50% threshold is
// the same colour in the hit-rate meter as it is in the track record.
//
// SNAPSHOT — v2 put a 📸 inside the result header (BoxSnapBtn, html2canvas).
// v3 HAS the capture now (shell/snapshot.ts — no dependency; the browser does
// the rendering) but not the button: there is one camera in this app and it
// lives in the toolbar. This page publishes its RESULT BLOCK to that camera's
// menu the moment a ticker has actually been looked up, which is the only
// moment there is anything worth photographing, and it publishes the ticker and
// the week as the caption's tail so the PNG names them under the picture.
//
// parity-check-em.mjs still carries `D/snapshot` as a KNOWN DEPARTURE (`soft`):
// the capability came across, the chrome moved. See docs/parity/em.md Part D.
//
// This page opens no socket and mounts no canvas: it is REST-only, so
// non-negotiables 4, 5 and 6 have nothing to bite on here.
// ─────────────────────────────────────────────────────────────────────────────

import type { CSSProperties, ReactNode } from 'react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { Card } from '@/design/primitives/Card'
import { Page } from '@/design/primitives/Page'
import { CAL, MOVE_DOWN, MOVE_UP, T, alpha } from '@/design/theme'
import type { EmSnapshot } from '@/pages/em/emData'
import { POPULAR, emNumber, fmtUpdated, loadEm, val } from '@/pages/em/emData'
import { NO_TARGETS, type CopyShotTarget, useCopyShotTargets } from '@/shell/CopyShot'

// ── Threshold tables ─────────────────────────────────────────────────────────
// Both are v2's, to the number. They were two DIFFERENT colour sets in v2 for
// the same two cut points; here they are one function used twice.
const hitRateColor = (pct: number): string =>
  pct >= 65 ? MOVE_UP : pct >= 50 ? CAL.medium : MOVE_DOWN

export default function Em() {
  const [params, setParams] = useSearchParams()
  const urlTicker = (params.get('ticker') || '').trim().toUpperCase()

  const [input, setInput] = useState(urlTicker)
  const [ticker, setTicker] = useState('')
  const [snap, setSnap] = useState<EmSnapshot | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  // Guards against an out-of-order response overwriting a newer lookup — a
  // fast chip-click after a slow one would otherwise repaint the old ticker.
  const seq = useRef(0)
  const lastRun = useRef('')

  const run = useCallback(async (sym: string) => {
    if (!sym) return
    const mine = ++seq.current
    lastRun.current = sym
    setTicker(sym)
    setInput(sym)
    setLoading(true)
    setError('')
    setSnap(null)
    try {
      const result = await loadEm(sym)
      if (seq.current !== mine) return
      setSnap(result)
    } catch (e) {
      if (seq.current !== mine) return
      setError(e instanceof Error ? e.message : 'Lookup failed')
    } finally {
      if (seq.current === mine) setLoading(false)
    }
  }, [])

  // THE URL IS THE SOURCE OF TRUTH (Brandon, 2026-08-31). v2 read `?ticker=` on
  // mount and never wrote it back, so a looked-up page could not be shared by
  // copying the address bar. Here every lookup goes through the query string,
  // which also makes back/forward work for free.
  useEffect(() => {
    if (urlTicker && urlTicker !== lastRun.current) void run(urlTicker)
  }, [urlTicker, run])

  const submit = (raw: string) => {
    const sym = raw.trim().toUpperCase()
    if (!sym) return
    // A re-submit of the SAME ticker leaves the query string untouched, so the
    // effect above will not fire — re-run it directly, the way v2's button did.
    if (sym === lastRun.current) void run(sym)
    setParams({ ticker: sym })
  }

  const data = snap?.data
  const busy = loading || !input.trim()

  // ── 📸 The result block, offered to the toolbar's camera ───────────────────
  //
  // v2 captured "from the result header down" — ticker, week, stamp, then every
  // card. Same span here, and the same rule about WHEN: nothing is published
  // until a lookup has landed, so the menu never offers a shot of the empty
  // state.
  const shotRef = useRef<HTMLDivElement | null>(null)
  const sym = data?.ticker || ticker
  const shotTargets = useMemo<CopyShotTarget[]>(
    () =>
      snap && data && !loading
        ? [
            {
              id: 'em:result',
              icon: '↔️',
              label: 'Estimated Move',
              group: 'This page',
              // Same caption shape every card uses: name · time · ticker · week.
              meta: `${data.label || sym}${data.exp_label ? ` · Week of ${data.exp_label}` : ''}`,
              file: `em-${sym}`,
              resolve: () => shotRef.current,
            },
          ]
        : NO_TARGETS,
    [snap, data, loading, sym],
  )
  useCopyShotTargets(shotTargets)

  return (
    <Page>
      <div className="mx-auto flex w-full max-w-[720px] flex-col gap-4 pb-12">
        {/* ── Header ───────────────────────────────────────────────────── */}
        <header className="text-center">
          {/* Served from the v2 public/ root, which is the same origin. */}
          <img
            src="/cb-edge-logo.png"
            alt="CB Edge"
            className="mx-auto -mb-4 block h-36 w-auto"
          />
          <h1 className="m-0 text-xl font-extrabold text-fg">Weekly Estimated Move &amp; Zones</h1>
          <p className="mt-2 text-sm text-muted opacity-75">
            Enter a ticker to see this week&apos;s estimated move and the buy / sell zones.
          </p>
        </header>

        {/* ── Search ───────────────────────────────────────────────────── */}
        <Card>
          <form
            className="mb-3 flex flex-wrap gap-2"
            onSubmit={(e) => {
              e.preventDefault()
              submit(input)
            }}
          >
            <input
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="Enter ticker  (e.g. SPX, NDX, AAPL)"
              spellCheck={false}
              autoCapitalize="characters"
              aria-label="Ticker"
              className="min-w-[200px] flex-1 rounded-md border border-line bg-bg px-3 py-3 text-base uppercase tracking-wide text-fg outline-none"
            />
            <button
              type="submit"
              disabled={busy}
              className="rounded-md border border-accent px-5 py-3 text-xs font-bold uppercase tracking-widest text-accent transition-opacity disabled:cursor-not-allowed disabled:opacity-45"
              style={{ background: alpha(T.cyan, 0.1) }}
            >
              {loading ? 'Loading…' : 'Get Levels'}
            </button>
          </form>

          <div className="flex flex-wrap justify-center gap-1.5">
            {POPULAR.map((s) => {
              const on = ticker === s
              return (
                <button
                  key={s}
                  type="button"
                  onClick={() => submit(s)}
                  className={[
                    'rounded-full border px-3 py-1 text-xs font-extrabold tracking-wide text-accent',
                    on ? 'border-accent' : 'border-line',
                  ].join(' ')}
                  style={{ background: alpha(T.cyan, on ? 0.16 : 0.07) }}
                >
                  {s}
                </button>
              )
            })}
          </div>
        </Card>

        {/* ── Error ────────────────────────────────────────────────────── */}
        {error && (
          <div
            className="rounded-md border px-4 py-3.5 text-center text-sm"
            style={{ borderColor: alpha(MOVE_DOWN, 0.25), background: alpha(MOVE_DOWN, 0.08), color: MOVE_DOWN }}
          >
            {error}
          </div>
        )}

        {/* ── Empty ────────────────────────────────────────────────────── */}
        {!snap && !error && !loading && (
          <div className="py-10 text-center text-sm text-muted opacity-70">
            Enter a ticker above to view its weekly levels.
          </div>
        )}

        {/* ── Result ───────────────────────────────────────────────────── */}
        {snap && data && !loading && (
          <div ref={shotRef} className="flex flex-col gap-4">
            <div className="flex flex-wrap items-baseline gap-3">
              <span className="text-2xl font-extrabold tracking-tight text-fg">
                {data.label || data.ticker || ticker}
              </span>
              {data.exp_label && (
                <span className="text-xs font-bold uppercase tracking-widest text-muted opacity-70">
                  Week of {data.exp_label}
                </span>
              )}
              {data.updated_at && (
                <span className="ml-auto text-xs text-muted opacity-70">
                  Updated {fmtUpdated(data.updated_at)}
                </span>
              )}
            </div>

            <EstimatedMove snap={snap} />
            <Zones data={data} />
            <HistoricalAverages snap={snap} />
            <TrackRecord snap={snap} />

            <p className="text-center text-xs leading-relaxed text-muted opacity-70">
              Levels are published weekly and are informational only — not financial advice.
            </p>
          </div>
        )}
      </div>
    </Page>
  )
}

// ── Part E — Estimated Move ──────────────────────────────────────────────────

function EstimatedMove({ snap }: { snap: EmSnapshot }) {
  const { data, winRate } = snap
  return (
    <Card title="Estimated Move">
      {/* v2 was a fixed repeat(4,1fr) at every width, rescued on narrow screens
          only by globals.css's GLOBAL GRID COLLAPSE — which v3 does not have.
          Two columns below 640px is the explicit replacement. */}
      <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-4">
        <Tile label="Close" value={val(data.close)} color={CAL.previous} />
        <Tile label="EM" value={val(data.em)} color={T.orange} />
        <Tile label="Up" value={val(data.up)} color={MOVE_UP} />
        <Tile label="Down" value={val(data.down)} color={MOVE_DOWN} />
      </div>

      {winRate != null && <HitRate winRate={winRate} />}
    </Card>
  )
}

function HitRate({ winRate }: { winRate: NonNullable<EmSnapshot['winRate']> }) {
  const winPct = Math.round(winRate.hit_rate * 100)
  const losses = winRate.evaluated - winRate.hits
  return (
    <div className="mt-2.5 rounded-md border border-line px-3 pb-2.5 pt-3 text-center" style={PLATE}>
      <div className={LABEL}>EM Hit Rate</div>
      <div className="mb-2 text-xl font-bold" style={{ color: hitRateColor(winPct) }}>
        {winPct}% Hit
      </div>
      <div className="mb-1 flex justify-between text-2xs text-muted opacity-80">
        <span>Miss ({losses})</span>
        <span>{winPct}%</span>
        <span>Hit ({winRate.hits})</span>
      </div>
      {/* Three stops, two of them the same colour, so the bar stays "miss" for
          its first half and only then ramps. v2's shape, v3's colours. */}
      <div className="h-1 overflow-hidden rounded-full" style={{ background: alpha(T.text, 0.1) }}>
        <div
          className="h-full transition-[width] duration-500"
          style={{
            width: `${winPct}%`,
            background: `linear-gradient(90deg, ${MOVE_DOWN}, ${MOVE_DOWN}, ${MOVE_UP})`,
          }}
        />
      </div>
    </div>
  )
}

// ── Part F — Buy / Sell zones, and the pivot ─────────────────────────────────

function Zones({ data }: { data: EmSnapshot['data'] }) {
  return (
    <>
      <div className="grid grid-cols-1 gap-3.5 sm:grid-cols-2">
        <ZoneCard
          title="Buy Zone"
          hint="Support area — bias long while price holds above."
          color={MOVE_UP}
          near={val(data.buy_near)}
          far={val(data.buy_far)}
        />
        <ZoneCard
          title="Sell Zone"
          hint="Resistance area — bias short while price stays below."
          color={MOVE_DOWN}
          near={val(data.sell_near)}
          far={val(data.sell_far)}
        />
      </div>

      {/* PIVOT. v2 fetches it, merges it, tests it in the zones fallback — and
          renders it nowhere; the styles for it are still in the file, wired to
          nothing. Brandon, 2026-08-31: keep it. The data was always on the
          wire; now it is on the screen. */}
      <div className="text-center text-xs font-bold uppercase tracking-widest text-muted opacity-70">
        Pivot
        <span className="ml-2 font-mono text-lg font-bold normal-case tracking-normal text-fg opacity-100">
          {val(data.pivot)}
        </span>
      </div>
    </>
  )
}

function ZoneCard({
  title,
  hint,
  color,
  near,
  far,
}: {
  title: string
  hint: string
  color: string
  near: string
  far: string
}) {
  return (
    <Card title={<span style={{ color }}>{title}</span>} style={{ borderColor: alpha(color, 0.25) }}>
      <p className="m-0 mb-3.5 text-xs leading-relaxed text-muted opacity-75">{hint}</p>
      <ZoneLine label="Near" value={near} color={color} />
      <ZoneLine label="Far" value={far} color={color} dim />
    </Card>
  )
}

function ZoneLine({
  label,
  value,
  color,
  dim = false,
}: {
  label: string
  value: string
  color: string
  dim?: boolean
}) {
  return (
    <div className="flex items-baseline justify-between border-t border-line py-2.5">
      <span className="text-xs font-bold uppercase tracking-widest text-muted opacity-70">{label}</span>
      <span
        className={['font-mono text-xl font-bold', dim ? 'opacity-70' : ''].join(' ')}
        style={{ color }}
      >
        {value}
      </span>
    </div>
  )
}

// ── Part G — vs Historical EM Average ────────────────────────────────────────

function HistoricalAverages({ snap }: { snap: EmSnapshot }) {
  const { data, emStats } = snap
  if (!emStats || (emStats.recentAvg == null && emStats.midAvg == null)) return null
  const emVal = emNumber(data.em)

  const avgTile = (avg: number | null, label: string) => {
    if (!avg || !emVal || !Number.isFinite(avg) || !Number.isFinite(emVal)) {
      return (
        <div className="rounded-md border border-line px-2 py-3 text-center" style={PLATE}>
          <div className={LABEL}>{label}</div>
          <div className="text-base text-muted opacity-70">--</div>
        </div>
      )
    }
    const diff = emVal - avg
    const pct = (diff / avg) * 100
    const isHigher = diff > 0
    return (
      <div className="rounded-md border border-line px-2 py-3 text-center" style={PLATE}>
        <div className={LABEL}>
          {label} ({avg.toLocaleString('en-US', { maximumFractionDigits: 2 })})
        </div>
        {/* The arrow means "this week's EM is WIDER than its average", not
            "good". Green on a bigger expected move is v2's choice; kept so the
            two pages cannot disagree while both are up. */}
        <div className="font-mono text-lg font-bold" style={{ color: isHigher ? MOVE_UP : MOVE_DOWN }}>
          {isHigher ? '▲' : '▼'} {Math.abs(pct).toFixed(1)}%
        </div>
      </div>
    )
  }

  return (
    <Card title="vs Historical EM Average">
      <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
        {avgTile(emStats.recentAvg, 'vs 4-Wk Avg')}
        {avgTile(emStats.midAvg, 'vs 12-Wk Avg')}
      </div>
      {emStats.sampleSize > 0 && (
        <div className="mt-2.5 text-2xs uppercase tracking-widest text-muted opacity-70">
          Based on {emStats.sampleSize} week{emStats.sampleSize !== 1 ? 's' : ''} of recorded data
        </div>
      )}
    </Card>
  )
}

// ── Part H — Recent Track Record ─────────────────────────────────────────────

function TrackRecord({ snap }: { snap: EmSnapshot }) {
  const rec = snap.recentRec
  if (!rec) return null
  const isHit = rec.lastResult === 'hit'
  const pct = rec.last5Total > 0 ? Math.round((rec.last5Hits / rec.last5Total) * 100) : 0
  const pctCol = hitRateColor(pct)
  const resultCol = isHit ? MOVE_UP : MOVE_DOWN

  return (
    <Card title="Recent Track Record">
      <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
        <div
          className="rounded-md border px-2 py-3 text-center"
          style={{ ...PLATE, borderColor: alpha(resultCol, 0.3) }}
        >
          <div className={LABEL}>Last Week{rec.lastLabel ? ` (${rec.lastLabel})` : ''}</div>
          {/* A null result renders MISS — the test is `=== "hit"`. v2's. */}
          <div className="font-mono text-xl font-bold" style={{ color: resultCol }}>
            {isHit ? 'HIT' : 'MISS'}
          </div>
        </div>
        <div
          className="rounded-md border px-2 py-3 text-center"
          style={{ ...PLATE, borderColor: alpha(pctCol, 0.3) }}
        >
          <div className={LABEL}>
            Last {rec.last5Total} Wk{rec.last5Total !== 1 ? 's' : ''} Hit %
          </div>
          <div className="font-mono text-xl font-bold" style={{ color: pctCol }}>
            {pct}%
          </div>
          <div className="mt-1 text-2xs tracking-wide text-muted opacity-70">
            {rec.last5Hits} / {rec.last5Total} hit
          </div>
        </div>
      </div>
    </Card>
  )
}

// ── Shared bits ──────────────────────────────────────────────────────────────

/** v2's stat plate: a sunken well inside a card. */
const PLATE: CSSProperties = { background: alpha(T.bg, 0.6) }

const LABEL = 'mb-1.5 text-2xs font-bold uppercase tracking-widest text-muted opacity-70'

function Tile({ label, value, color }: { label: ReactNode; value: string; color: string }) {
  return (
    <div className="rounded-md border border-line px-2 py-3 text-center" style={PLATE}>
      <div className={LABEL}>{label}</div>
      <div className="font-mono text-xl font-bold" style={{ color }}>
        {value}
      </div>
    </div>
  )
}
