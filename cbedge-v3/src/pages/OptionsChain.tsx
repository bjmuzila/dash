// ─────────────────────────────────────────────────────────────────────────────
// OPTIONS CHAIN — v2's /app/options-chain, ported to /v3/options-chain.
//
// This page is not a calls-and-puts ladder. It is a GEX MATRIX: one column per
// expiration across a shared strike axis, every cell painted by a heat skin,
// with six greek lenses, two contract bases, a ⅀ Total column that excludes
// 0DTE, focus selection on rows and columns, and a replay transport that rewinds
// the whole grid to a recorded snapshot.
//
// Everything above the render layer lives elsewhere:
//   optionsChain/chainMath.ts     the greek formulas, the walls, the window
//   optionsChain/heatSkins.ts     the ramps, the rank floors, the level fill
//   optionsChain/useChainData.ts  every fetch, every derivation
//   optionsChain/format.ts        every number's exact wording
//
// The parity spec is docs/parity/options-chain.md, and scripts/parity-check-
// chain.mjs drives this page against v2's and fails on anything v2 renders and
// this does not.
//
// ── Four departures from v2, all deliberate ──────────────────────────────────
//  1. The TICKER is not a control on this page at all. The app toolbar owns the
//     board symbol (data/symbol.tsx) and this page follows it, so v2's ticker
//     dropdown, its GO button and its Recent list are all gone — the picker,
//     with its favourites, moved to design/primitives/TickerPicker.tsx where the
//     whole board reads it. v2 had those controls because v2 had no board symbol.
//  2. ContractFlowPopup is NOT ported. In v2 it is unreachable — ChainMatrix
//     destructures `onCellClick` and never calls it, so `contractPopup` can
//     never become non-null. Porting dead UI (and a chart library with it) would
//     be inventing a feature, not preserving one. Recorded in Part N of the spec.
//
// Two v2 controls were dropped at Brandon's call on 2026-08-30 rather than lost
// in the port, and they are gone end to end — control, state, fetch and column —
// rather than left as plumbing nothing can reach:
//  3. The Δ CHANGE columns (Live / 15m / 30m / 60m off /proxy/strike-growth).
//  4. The Δ15m STAMPS (front-expiry 15-minute net-GEX chips off
//     /api/mult-greek-gex-grid).
// Both are recorded as declared departures in the spec and reported as such by
// scripts/parity-check-chain.mjs, so the checker says they went rather than
// quietly scoring them as a pass.
// ─────────────────────────────────────────────────────────────────────────────

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { alpha, CHAIN, T } from '@/design/theme'
import { usePageSymbol } from '@/data/symbol'
import { Popover, PanelSection, SegGroup } from '@/design/primitives/Controls'
import { ChainMatrix } from './optionsChain/ChainMatrix'
import { LadderModal } from './optionsChain/LadderModal'
import { ChainDropdown } from './optionsChain/pickers'
import { ReplayBar } from './optionsChain/ReplayBar'
import { StrikeHoverCard } from './optionsChain/StrikeHoverCard'
import { HEAT_SKINS, type HeatSkin } from './optionsChain/heatSkins'
import { INTENSITY_MIN } from './optionsChain/chainMath'
import { DATA_MODE_LABEL, DISPLAY_PERCENTS, GREEK_MODES, useChainData, type GreekMode } from './optionsChain/useChainData'
import type { DataMode } from './optionsChain/chainMath'

/** The ↻ button's four states and its 1800ms revert, transcribed from v2's
 *  useRefreshButton — the labels are what tells you a refresh actually ran. */
function useRefreshButton(fn: () => Promise<void>) {
  const [state, setState] = useState<'idle' | 'refreshing' | 'success' | 'error'>('idle')
  const lockedRef = useRef(false)
  const trigger = useCallback(async () => {
    if (lockedRef.current) return
    lockedRef.current = true
    setState('refreshing')
    try {
      await fn()
      setState('success')
    } catch {
      setState('error')
    } finally {
      setTimeout(() => {
        setState('idle')
        lockedRef.current = false
      }, 1800)
    }
  }, [fn])
  const label =
    state === 'refreshing' ? '↻ Refreshing…' : state === 'success' ? '✓ Refreshed' : state === 'error' ? '✗ Failed' : '↻ Now'
  return { trigger, label, state }
}

export default function OptionsChain() {
  const { symbol } = usePageSymbol()
  const c = useChainData({ symbol })

  const [cogOpen, setCogOpen] = useState(false)
  const [ladderOpen, setLadderOpen] = useState(false)
  const [hoverCell, setHoverCell] = useState<{ strike: number; colIdx: number; x: number; y: number } | null>(null)
  const onCellClick = useCallback(
    (v: { strike: number; colIdx: number; x: number; y: number }) => setHoverCell(v),
    [],
  )

  const chainScrollRef = useRef<HTMLDivElement>(null)
  const atmRowRef = useRef<HTMLDivElement>(null)
  const centeredForRef = useRef<string>('')

  const { trigger: refresh, label: refreshLabel, state: refreshState } = useRefreshButton(c.doRefresh)

  // ── Centre the ATM row on load / whenever the window changes ───────────────
  // visibleStrikes always puts the centre at the exact middle index, but the
  // scroll container itself defaults to scrolled-to-top.
  useEffect(() => {
    if (!c.visibleStrikes.length) return
    const key = `${c.activeTicker}|${c.selectedExpiry}|${c.visibleStrikes.length}`
    if (centeredForRef.current === key) return
    const id = requestAnimationFrame(() => {
      const el = atmRowRef.current
      const container = chainScrollRef.current
      if (!el || !container) return
      container.scrollTop = Math.max(0, el.offsetTop - container.clientHeight / 2 + el.clientHeight / 2)
      centeredForRef.current = key
    })
    return () => cancelAnimationFrame(id)
  }, [c.visibleStrikes, c.activeTicker, c.selectedExpiry])

  // ── Keep the ATM row in view while REPLAY IS PLAYING ───────────────────────
  // The session axis is fixed, which is what makes the grid hold still — but it
  // also means the ATM row walks down a stationary ladder as the session runs,
  // and over a full day it can walk clean off screen.
  //
  // Two rules keep this from becoming the jitter it just replaced. It SCROLLS,
  // it never reflows. And it fires only when the ATM row has actually left the
  // middle 60% of the viewport, so it is a rescue every few minutes of playback,
  // not a nudge every frame. Gated on `playing` because while paused or
  // scrubbing the user is driving.
  useEffect(() => {
    if (!c.replay.frame || !c.replay.playing) return
    const el = atmRowRef.current
    const container = chainScrollRef.current
    if (!el || !container) return
    const viewH = container.clientHeight
    if (!viewH) return
    const rowTop = el.offsetTop - container.scrollTop
    const band = viewH * 0.2 // dead zone: the middle 60%
    if (rowTop >= band && rowTop <= viewH - band) return
    container.scrollTop = Math.max(0, el.offsetTop - viewH / 2 + el.clientHeight / 2)
  }, [c.replay.frame, c.replay.playing])

  // ── Shared button styling ──────────────────────────────────────────────────
  const segStyle = useCallback(
    (on: boolean): React.CSSProperties => ({
      height: 34,
      padding: '0 14px',
      fontSize: 12,
      fontWeight: 700,
      border: `1px solid ${on ? alpha(T.cyan, 0.35) : alpha(T.text, 0.06)}`,
      borderRadius: 8,
      background: on ? `linear-gradient(180deg,${alpha(T.cyan, 0.18)},${alpha(T.cyan, 0.05)})` : alpha(T.text, 0.04),
      color: on ? T.cyan : T.text,
      cursor: 'pointer',
      outline: 'none',
      whiteSpace: 'nowrap',
      textTransform: 'uppercase',
      letterSpacing: '0.04em',
      boxSizing: 'border-box',
    }),
    [],
  )

  const hoverPayload = useMemo(() => {
    if (!hoverCell) return null
    const col = c.columns[hoverCell.colIdx]
    const cell = col?.cells.get(hoverCell.strike)
    if (!col || !cell) return null
    const match = c.dodRows.find(
      (d) => d.strike === hoverCell.strike && (!d.expiry || d.expiry === col.expiration),
    )
    return {
      col,
      cell,
      dod: match ? { netYest: match.net_yest, netNow: match.net_now, delta: match.now_delta ?? match.delta } : null,
    }
  }, [hoverCell, c.columns, c.dodRows])

  const replayPinned = c.replay.on

  return (
    <main className="flex min-h-0 flex-1 flex-col overflow-hidden">
      {/* Load progress. 8 at fetch start, 100 on success, 0 after 800ms. */}
      {c.loadProgress > 0 && (
        <div style={{ position: 'relative', height: 3, background: T.bg, flexShrink: 0 }}>
          <div
            style={{ height: '100%', width: `${c.loadProgress}%`, background: T.cyan, transition: 'width 0.3s ease' }}
          />
        </div>
      )}

      {/* ── Toolbar. Pinned; the grid scrolls below it in its own container so
             the expiry header row stays stuck to the top of that scroll area. ── */}
      <div
        className="shrink-0 border-b border-line bg-bg"
        style={{ display: 'flex', flexDirection: 'column', gap: 3, padding: '3px 10px 4px', minWidth: 0 }}
      >
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            flexWrap: 'nowrap',
            overflowX: 'auto',
            scrollbarWidth: 'none',
            minWidth: 0,
          }}
        >
          {/* Identity on the left, actions on the right, one cog holding every
              setting. */}
          <div style={{ flex: 1, minWidth: 0, display: 'flex', alignItems: 'center', gap: 8, overflow: 'hidden' }}>
            <span
              style={{
                fontSize: 12,
                fontWeight: 800,
                color: T.cyan,
                letterSpacing: '0.14em',
                textTransform: 'uppercase',
                whiteSpace: 'nowrap',
              }}
            >
              Options Chain
            </span>
            <span
              style={{
                fontSize: 13,
                fontWeight: 800,
                color: T.cyan,
                letterSpacing: '0.06em',
                fontFamily: 'var(--font-mono)',
                whiteSpace: 'nowrap',
              }}
            >
              {c.activeTicker}
            </span>
            {/* The three facts the folded-away controls used to spell out. */}
            <span
              style={{
                fontSize: 10,
                fontWeight: 800,
                color: T.text,
                letterSpacing: '0.08em',
                whiteSpace: 'nowrap',
              }}
            >
              {c.greekMode.toUpperCase()} · {DATA_MODE_LABEL[c.dataMode]} · {c.displayPercent}%
            </span>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <div
                style={{
                  width: 7,
                  height: 7,
                  borderRadius: '50%',
                  background: c.replay.frame ? T.orange : T.green,
                }}
              />
              <span
                style={{
                  fontSize: 10,
                  color: c.replay.frame ? T.orange : T.green,
                  fontWeight: 800,
                  letterSpacing: '0.08em',
                }}
              >
                {c.replay.frame ? 'REPLAY' : 'LIVE'}
              </span>
            </div>

            {/* Focus readout — and the only way OUT of a selection, so it only
                renders while something is actually selected. */}
            {c.hasSel && (
              <button
                onClick={c.clearSel}
                title="Clear the focus selection"
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 6,
                  height: 20,
                  padding: '0 8px',
                  borderRadius: 999,
                  cursor: 'pointer',
                  flexShrink: 0,
                  border: `1px solid ${alpha(T.cyan, 0.5)}`,
                  background: alpha(T.cyan, 0.14),
                  color: T.cyan,
                  fontSize: 9.5,
                  fontWeight: 800,
                  letterSpacing: '0.06em',
                  whiteSpace: 'nowrap',
                }}
              >
                FOCUS:{' '}
                {[
                  c.selExps.size ? `${c.selExps.size} exp` : null,
                  c.selStrikes.size ? `${c.selStrikes.size} strike${c.selStrikes.size > 1 ? 's' : ''}` : null,
                ]
                  .filter(Boolean)
                  .join(' + ')}{' '}
                ✕
              </button>
            )}

            {/* OI provenance: the Δ column only means anything once TWO daily
                snapshots exist, so say which two days are being compared — and
                say so just as plainly when there is no baseline yet, rather than
                letting a column of "—" look like a bug. */}
            {c.greekMode === 'oi' && (
              <span
                style={{
                  fontSize: 9.5,
                  fontWeight: 700,
                  whiteSpace: 'nowrap',
                  color: c.oiSnapshot.prevDate ? T.cyan : T.muted,
                  opacity: 0.9,
                }}
              >
                {c.oiSnapshot.prevDate
                  ? `ΔOI ${c.oiSnapshot.date} vs ${c.oiSnapshot.prevDate}`
                  : c.oiSnapshot.date
                    ? `OI ${c.oiSnapshot.date} · no prior snapshot yet`
                    : 'OI snapshot not recorded'}
              </span>
            )}
          </div>

          {/* Refresh is an ACTION, not a setting — it stands on its own rather
              than hiding a click deep in the cog. */}
          <button
            onClick={() => void refresh()}
            disabled={refreshState === 'refreshing'}
            style={{
              ...segStyle(false),
              height: 26,
              padding: '0 10px',
              fontSize: 10,
              color: refreshState === 'success' ? T.green : refreshState === 'error' ? T.red : T.cyan,
              borderColor:
                refreshState === 'success' ? T.green : refreshState === 'error' ? T.red : alpha(T.cyan, 0.4),
              opacity: refreshState === 'refreshing' ? 0.6 : 1,
              cursor: refreshState === 'refreshing' ? 'not-allowed' : 'pointer',
            }}
          >
            {refreshLabel}
          </button>

          {/* ── Settings ──────────────────────────────────────────────────────
              One floating layer for the page: everything the grid is set to is
              on the bar above or one click into here. */}
          <div style={{ position: 'relative', flexShrink: 0 }}>
            <button
              onClick={() => setCogOpen((o) => !o)}
              title="Options chain settings"
              // Same aria-label v2's DockCogMenu gives its cog. It is what
              // scripts/parity-check-chain.mjs opens on BOTH pages to compare
              // what is behind the settings menu, so the two must match.
              aria-label="Options chain settings"
              style={{ ...segStyle(cogOpen), height: 26, padding: '0 10px', fontSize: 10 }}
            >
              ⚙ {c.displayPercent}% · {c.greekMode.toUpperCase()} ·{' '}
              {HEAT_SKINS[c.heatSkin].label.toLowerCase()} ·{' '}
              {c.intensity <= INTENSITY_MIN.chain ? 'levels' : `${c.intensity.toFixed(2)}x`}
            </button>
            <Popover open={cogOpen} onClose={() => setCogOpen(false)} align="right">
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10, width: 316 }}>
                <PanelSection title="Grid">
                  <Field label="Strikes">
                    <ChainDropdown
                      value={c.displayPercent}
                      options={DISPLAY_PERCENTS}
                      onChange={(v) => c.setDisplayPercent(Number(v))}
                      formatLabel={(v) => `${v}% strikes`}
                    />
                  </Field>
                  {/* Pinned to GEX while replaying. Rendered INERT rather than
                      hidden so the tabs do not vanish and reappear. */}
                  <Field label="Greek">
                    <div
                      style={{ opacity: replayPinned ? 0.4 : 1, pointerEvents: replayPinned ? 'none' : undefined, width: '100%' }}
                      title={
                        replayPinned
                          ? 'GEX only in replay — DEX/CHEX/VEX/OI/VOL are not recorded'
                          : undefined
                      }
                    >
                      <SegGroup
                        options={GREEK_MODES.map((m) => ({ label: m.toUpperCase(), value: m }))}
                        value={c.greekMode}
                        onChange={(v) => c.setGreekMode(v as GreekMode)}
                      />
                    </div>
                  </Field>
                  {/* OI+Vol / Vol Only stays live in replay — strike_growth
                      records BOTH bases, so the toggle means the same thing
                      rewound as it does live.
                      "flow" is deliberately absent: v2 filters it out of this
                      control too. parseExpiration still implements it. */}
                  <Field label="Basis">
                    <SegGroup
                      options={[
                        { label: DATA_MODE_LABEL['oi-vol'], value: 'oi-vol' },
                        { label: DATA_MODE_LABEL['vol-only'], value: 'vol-only' },
                      ]}
                      value={c.dataMode as 'oi-vol' | 'vol-only'}
                      onChange={(v) => c.setDataMode(v as DataMode)}
                    />
                  </Field>
                </PanelSection>

                <PanelSection title="Heat">
                  <Field
                    label="Intensity"
                    hint="Heat intensity. At the minimum stop the gamma wash switches off and only CB / CW / PW stay marked."
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      <input
                        type="range"
                        min={INTENSITY_MIN.chain}
                        max={c.intensityMax}
                        step={0.01}
                        value={c.intensity}
                        onChange={(e) => c.setIntensity(Number(e.target.value))}
                        style={{ width: 110, height: 3, accentColor: T.cyan }}
                      />
                      <span
                        style={{
                          fontSize: 10,
                          color: T.cyan,
                          fontWeight: 700,
                          minWidth: 44,
                          fontFamily: 'var(--font-mono)',
                        }}
                      >
                        {c.intensity <= INTENSITY_MIN.chain ? 'LEVELS' : `${c.intensity.toFixed(2)}x`}
                      </span>
                    </div>
                  </Field>
                  {/* Skin — how the cell is PAINTED, not what it says. Same
                      values, same ranks, same walls either way. */}
                  <Field label="Skin">
                    <SegGroup
                      options={[
                        { label: 'CLASSIC', value: 'classic' },
                        { label: 'VIVID', value: 'vivid' },
                      ]}
                      value={c.heatSkin}
                      onChange={(v) => c.changeHeatSkin(v as HeatSkin)}
                    />
                  </Field>
                </PanelSection>

                <PanelSection title="Replay">
                  <button
                    onClick={() => c.replay.setOn((v) => !v)}
                    style={{ ...segStyle(c.replay.on), height: 26, fontSize: 10 }}
                    title="Rewind the grid itself through the session's recorded net-GEX snapshots"
                  >
                    {c.replay.on ? '■ Exit Replay' : '▶ Replay'}
                  </button>
                </PanelSection>
              </div>
            </Popover>
          </div>
        </div>

        {c.replay.on && (
          <ReplayBar
            dates={c.replay.dates}
            date={c.replay.date}
            setDate={c.replay.setDate}
            frames={c.replay.frames}
            frame={c.replay.frame}
            idx={c.replay.idx}
            setIdx={c.replay.setIdx}
            playing={c.replay.playing}
            setPlaying={c.replay.setPlaying}
            speed={c.replay.speed}
            setSpeed={c.replay.setSpeed}
            loading={c.replay.loading}
            err={c.replay.err}
            scope={c.replay.scope}
            setScope={c.replay.setScope}
            allExpiries={c.replay.allExpiries}
            axis={c.replay.axis}
            zeroDteExp={c.replay.zeroDteExp}
            zeroDteIsExact={c.replay.zeroDteIsExact}
            onOpenLadder={() => setLadderOpen(true)}
            segStyle={segStyle}
          />
        )}
      </div>

      {/* ── Body ── */}
      {c.replay.on && !c.replay.frame ? (
        <EmptyState
          heading={c.replay.loading ? 'Loading recorded session…' : `Nothing recorded to replay for ${c.activeTicker}`}
          headingColor={T.orange}
          body={
            c.replay.loading
              ? `${c.activeTicker} · ${c.replay.date}`
              : `${c.replay.err || 'No snapshots for this ticker yet.'} The recorder keeps roughly five trading days and only covers tickers on the scanner watchlist.`
          }
        />
      ) : !c.visibleStrikes.length ? (
        <EmptyState
          heading={c.chainError ? 'No Live Chain Data' : 'Select ticker, expiry & % strikes'}
          body={c.chainError ?? 'Then click ↻ Now to load the chain'}
        />
      ) : (
        <div
          ref={chainScrollRef}
          style={{
            flex: 1,
            overflow: 'auto',
            minHeight: 0,
            // NO top padding. A sticky top:0 header inside a padded scroll
            // container sticks to the CONTENT edge, leaving a band where rows
            // scroll through ABOVE the header and show behind it. The breathing
            // room is marginTop on the grid, which correctly scrolls away.
            padding: '0 10px 10px',
          }}
        >
          <ChainMatrix
            columns={c.columns}
            gridCols={c.gridCols}
            visibleStrikes={c.visibleStrikes}
            nearestStrike={c.nearestStrike}
            spot={c.spot}
            greekMode={c.greekMode}
            dataMode={c.dataMode}
            intensity={c.deferredIntensity}
            heatSkin={c.heatSkin}
            levelsOnly={c.levelsOnly}
            colScales={c.colScales}
            volMvcByCol={c.volMvcByCol}
            mvcByCol={c.mvcByCol}
            valueAt={c.valueAt}
            sessionDate={c.sessionDate}
            showTotalCol={c.showTotalCol}
            layoutExpCols={c.layoutExpCols}
            emStrikes={c.emStrikes}
            anyCurrentWeek={c.anyCurrentWeek}
            emLevels={c.emLevels}
            atmRowRef={atmRowRef}
            oiChangeMap={c.oiSnapshot.map}
            selExps={c.selExps}
            selStrikes={c.selStrikes}
            onToggleExp={c.toggleExpSel}
            onToggleStrike={c.toggleStrikeSel}
            onCellClick={onCellClick}
          />
        </div>
      )}

      {hoverCell && hoverPayload && (
        <StrikeHoverCard
          ticker={c.activeTicker}
          strike={hoverCell.strike}
          expiration={hoverPayload.col.expiration}
          cell={hoverPayload.cell}
          dod={hoverPayload.dod}
          x={hoverCell.x}
          y={hoverCell.y}
          onClose={() => setHoverCell(null)}
        />
      )}

      {ladderOpen && (
        <LadderModal symbol={c.activeTicker} onClose={() => setLadderOpen(false)} />
      )}
    </main>
  )
}

// ── Small local pieces ───────────────────────────────────────────────────────

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 5, minWidth: 0 }}>
      <span
        title={hint}
        style={{
          fontSize: 10,
          fontWeight: 800,
          letterSpacing: '0.1em',
          textTransform: 'uppercase',
          color: alpha(T.text, 0.62),
          whiteSpace: 'nowrap',
          cursor: hint ? 'help' : undefined,
        }}
      >
        {label}
      </span>
      <div style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 6, minWidth: 0 }}>{children}</div>
    </div>
  )
}

function EmptyState({
  heading,
  body,
  headingColor,
}: {
  heading: string
  body: string
  headingColor?: string
}) {
  return (
    <div
      style={{
        flex: 1,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        fontSize: 12,
        color: CHAIN.empty,
      }}
    >
      <div style={{ textAlign: 'center', maxWidth: 460 }}>
        <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 8, color: headingColor }}>{heading}</div>
        <div style={{ fontSize: 12, lineHeight: 1.5 }}>{body}</div>
      </div>
    </div>
  )
}
