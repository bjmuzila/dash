import {
  memo,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type MouseEvent as ReactMouseEvent,
  type RefObject,
} from 'react'
import { createPortal } from 'react-dom'
import { Card } from '@/design/primitives/Card'
import { SegGroup } from '@/design/primitives/Controls'
import { T, alpha } from '@/design/theme'
import {
  AMP,
  CAPS,
  R,
  R0,
  R_CALL,
  RING_ALL,
  RING_FOCUS,
  VB,
  arcPath,
  buildCallouts,
  buildHierarchy,
  fmtWheelPct,
  nameForms,
  px,
  py,
  sectorRank as buildSectorRank,
  shortestForm,
  textW,
  wheelPalette,
  type Callout,
  type WheelLeaf,
  type WheelNode,
  type WheelPalette,
  type WheelPayload,
  type WheelRow,
} from './wheelMath'

// ─────────────────────────────────────────────────────────────────────────────
// S&P SECTOR WHEEL — sector → industry → ticker.
//
// The port of v2's components/dashboard/SectorSunburst.tsx, rendered with the
// defaults the Traders Dashboard used (inline wheel, movers shown, no width
// cap). All of the maths lives in ./wheelMath.ts; this file is the render
// layer and the interaction state, rewritten on v3 primitives — no v2 JSX, no
// @/app alias, no colour literal.
//
// Three things worth knowing before editing:
//
//  1. THE SVG IS MEMOISED AND THE TOOLTIP IS NOT. v2 kept hover position in the
//     same component as the wheel, so every mousemove over any of ~200 arcs
//     re-rendered all of them. Here <WheelSvg> is memo()'d on props that do not
//     include the hover, so a mousemove repaints one absolutely-positioned div.
//     Keep the props it receives referentially stable or that goes away
//     silently.
//
//  2. IT DOES NOT PAINT WHEN IT CANNOT BE SEEN (AGENTS.md non-negotiable 5).
//     This is a declarative SVG, not an imperative canvas, so it cannot mount
//     through ChartFrame — that primitive hands you a bare element to build
//     into. It carries the same contract by hand instead: an
//     IntersectionObserver with the same generous 200px rootMargin, publishing
//     `data-visible` on the wrapper exactly as ChartFrame does, and the arcs
//     are not rendered at all while it reads "0". The wrapper keeps its height
//     so nothing jumps.
//
//  3. THERE IS NO SNAPSHOT BUTTON. v2's ⤢/Snap cluster carried a
//     CopySnapButton; that needs a DOM-to-canvas renderer v3 does not ship and
//     will not add for one button. Expand and Full screen did come across.
// ─────────────────────────────────────────────────────────────────────────────

/** How far outside the viewport still counts as visible. ChartFrame's value. */
const ROOT_MARGIN = '200px'

function useInView<E extends Element>(ref: RefObject<E | null>): boolean {
  // Start optimistic, for ChartFrame's reason: the observer's first callback is
  // asynchronous, and one thrown-away paint costs less than a card that renders
  // blank for a frame on every mount.
  const [inView, setInView] = useState(true)
  useEffect(() => {
    const el = ref.current
    if (!el || typeof IntersectionObserver !== 'function') return
    let onScreen = true
    let tabAwake = !document.hidden
    const publish = () => setInView(onScreen && tabAwake)
    const io = new IntersectionObserver(
      (entries) => {
        const entry = entries[entries.length - 1]
        if (!entry) return
        onScreen = entry.isIntersecting
        publish()
      },
      { rootMargin: ROOT_MARGIN },
    )
    io.observe(el)
    const onTab = () => {
      tabAwake = !document.hidden
      publish()
    }
    document.addEventListener('visibilitychange', onTab)
    return () => {
      io.disconnect()
      document.removeEventListener('visibilitychange', onTab)
    }
  }, [ref])
  return inView
}

interface Tip {
  x: number
  y: number
  bw: number
  title: string
  sub: string
  val: number
}

type TipFn = (e: ReactMouseEvent, title: string, sub: string, val: number) => void

// ── The SVG ──────────────────────────────────────────────────────────────────

interface WheelSvgProps {
  sectors: WheelNode[]
  industries: WheelNode[]
  leaves: WheelLeaf[]
  callouts: Callout[]
  palette: WheelPalette
  focus: string | null
  expanded: boolean
  net: number
  up: number
  down: number
  hubLabel: string
  onSector: (name: string) => void
  onClearFocus: () => void
  onTip: TipFn
  onLeave: () => void
}

const WheelSvg = memo(function WheelSvg({
  sectors,
  industries,
  leaves,
  callouts,
  palette,
  focus,
  expanded,
  net,
  up,
  down,
  hubLabel,
  onSector,
  onClearFocus,
  onTip,
  onLeave,
}: WheelSvgProps) {
  const RING = focus ? RING_FOCUS : RING_ALL
  const { fillFor, ringFill, barLen, inkOn, dir } = palette
  /** Bars that already have a callout skip the ticker printed inside them. */
  const calledOut = useMemo(() => new Set(callouts.map((c) => c.k)), [callouts])

  return (
    <svg
      viewBox={`${-VB / 2} ${-VB / 2} ${VB} ${VB}`}
      // Tagged for the same reason a canvas is (non-negotiable 6): so the perf
      // tooling and a human in devtools can both tell a layer v3 drew from one
      // a library made for itself. perf-check.mjs counts canvas repaints and
      // will not see this one — the visibility gate above is what stands in.
      data-cb-layer="sector-wheel"
      style={{ display: 'block', width: '100%', height: 'auto' }}
    >
      {/* scale rings */}
      {[0.5, 1].map((f) => (
        <circle key={f} r={R0 + f * AMP} fill="none" stroke={T.border} strokeWidth={1} />
      ))}

      {/* sector ring */}
      {sectors.map((s) => (
        <path
          key={`s-${s.name}`}
          d={arcPath(s.a0, s.a1, R * RING.holeOut, R * RING.secOut - 1.5)}
          fill={ringFill(s.chg, 0.62)}
          stroke={T.bg}
          strokeWidth={1}
          fillRule="evenodd"
          style={{ cursor: focus ? 'default' : 'pointer' }}
          onClick={() => {
            if (!focus) onSector(s.name)
          }}
          onMouseMove={(e) => onTip(e, s.name, `${s.rows.length} names · cap-weighted`, s.chg)}
          onMouseLeave={onLeave}
        />
      ))}

      {/* industry ring */}
      {industries.map((n, k) => (
        <path
          key={`i-${n.name}-${k}`}
          d={arcPath(n.a0, n.a1, R * RING.secOut, R * RING.indOut - 1.5)}
          fill={ringFill(n.chg, 0.9)}
          stroke={T.bg}
          strokeWidth={0.8}
          fillRule="evenodd"
          onMouseMove={(e) => onTip(e, n.name, `${n.rows.length} names · cap-weighted`, n.chg)}
          onMouseLeave={onLeave}
        />
      ))}

      {/* bars — all outward from the zero ring */}
      {leaves.map((l, k) => (
        <path
          key={`l-${l.name}-${k}`}
          d={arcPath(l.a0, l.a1, R0, R0 + barLen(l.chg))}
          fill={fillFor(l.chg)}
          stroke={T.bg}
          strokeWidth={0.6}
          onMouseMove={(e) => onTip(e, l.name, `${l.row.s} › ${l.row.i}`, l.chg)}
          onMouseLeave={onLeave}
        />
      ))}

      {/* zero ring, above the feet of the bars */}
      <circle r={R0} fill="none" stroke={alpha(T.text, 0.28)} strokeWidth={1.4} />

      {/* hub */}
      <circle r={R * RING.holeOut - 3} fill={T.panel} />

      {/* sector labels — tangential, only where the arc genuinely fits one */}
      {sectors.map((s) => {
        // Type is sized in viewBox units, so the fit test is the same at any
        // render size — popped out we can afford smaller units (they land
        // bigger on screen), which is what lets more names show.
        const fs = expanded ? 7 : 9
        const ri = R * RING.holeOut
        const ro = R * RING.secOut - 1.5
        const rr = (ri + ro) / 2
        if (ro - ri < fs + 3) return null // thin accent band — no room
        const arcLen = (s.a1 - s.a0) * rr - 8
        let text: string | null = null
        for (const cand of nameForms(s.name)) {
          const w = textW(cand, fs)
          // must fit the arc, and the straight chord it sits on must not bulge
          // past the ring's outer edge
          if (w <= arcLen && Math.hypot(rr, w / 2) + fs * 0.45 <= ro) {
            text = cand
            break
          }
        }
        if (!text) return null
        const mid = (s.a0 + s.a1) / 2
        const deg = (mid * 180) / Math.PI
        const flip = Math.cos(mid) < 0 ? ' rotate(180)' : ''
        return (
          <text
            key={`sl-${s.name}`}
            transform={`rotate(${deg}) translate(0,${-rr})${flip}`}
            textAnchor="middle"
            dy="0.34em"
            fontSize={fs}
            fontWeight={700}
            fill={inkOn(ringFill(s.chg, 0.62))}
            style={{ pointerEvents: 'none' }}
          >
            {text}
          </text>
        )
      })}

      {/* industry labels — only ever fit in the zoomed layout, and the fit test
          is what decides that, so there is no special case here */}
      {industries.map((n, k) => {
        const fs = expanded ? 6.5 : 8
        const ri = R * RING.secOut
        const ro = R * RING.indOut - 1.5
        const rr = (ri + ro) / 2
        if (ro - ri < fs + 3) return null
        const arcLen = (n.a1 - n.a0) * rr - 8
        const w = textW(n.name, fs)
        if (w > arcLen || Math.hypot(rr, w / 2) + fs * 0.45 > ro) return null
        const mid = (n.a0 + n.a1) / 2
        const flip = Math.cos(mid) < 0 ? ' rotate(180)' : ''
        return (
          <text
            key={`il-${n.name}-${k}`}
            transform={`rotate(${(mid * 180) / Math.PI}) translate(0,${-rr})${flip}`}
            textAnchor="middle"
            dy="0.34em"
            fontSize={fs}
            fontWeight={600}
            fill={inkOn(ringFill(n.chg, 0.9))}
            style={{ pointerEvents: 'none' }}
          >
            {n.name}
          </text>
        )
      })}

      {/* callouts — the biggest movers, named on the rim with a tick back to
          the bar they belong to */}
      {callouts.map((c) => {
        const col = dir(c.chg)
        const rIn = c.tip + 2.5
        const rOut = R_CALL - c.fs * 0.9
        const flip = Math.cos(c.mid) < 0 ? ' rotate(180)' : ''
        return (
          <g key={`co-${c.k}`} style={{ pointerEvents: 'none' }}>
            {rOut > rIn && (
              <line
                x1={px(rIn, c.mid)}
                y1={py(rIn, c.mid)}
                x2={px(rOut, c.mid)}
                y2={py(rOut, c.mid)}
                stroke={alpha(col, 0.5)}
                strokeWidth={0.9}
              />
            )}
            <text
              transform={`rotate(${(c.mid * 180) / Math.PI}) translate(0,${-R_CALL})${flip}`}
              textAnchor="middle"
              dy="0.34em"
              fontSize={c.fs}
              fontWeight={800}
              fill={col}
            >
              {c.text}
            </text>
          </g>
        )
      })}

      {/* tickers, printed inside a bar that is both wide and long enough */}
      {leaves.map((l, k) => {
        if (calledOut.has(k)) return null // already named on the rim
        const fs = expanded ? 5.6 : 7.5
        const len = barLen(l.chg)
        const w = textW(l.name, fs)
        if (w > len - 7) return null
        if (fs * 1.35 > (l.a1 - l.a0) * R0) return null
        const mid = (l.a0 + l.a1) / 2
        const rr = R0 + len / 2
        const rot = (mid * 180) / Math.PI - 90
        const flip = rot > 90 || rot < -90 ? ' rotate(180)' : ''
        return (
          <text
            key={`tl-${l.name}-${k}`}
            transform={`rotate(${rot}) translate(${rr},0)${flip}`}
            textAnchor="middle"
            dy="0.34em"
            fontSize={fs}
            fontWeight={700}
            fill={inkOn(fillFor(l.chg))}
            style={{ pointerEvents: 'none' }}
          >
            {l.name}
          </text>
        )
      })}

      {/* hero + back-out target — the hub names what the number covers, so the
          reading is unambiguous both zoomed out and zoomed in */}
      <text
        textAnchor="middle"
        y={-26}
        fontSize={10.5}
        fontWeight={800}
        letterSpacing="0.1em"
        fill={T.muted}
        opacity={0.55}
        style={{ pointerEvents: 'none' }}
      >
        {hubLabel}
      </text>
      <text
        textAnchor="middle"
        y={-3}
        fontSize={22}
        fontWeight={800}
        fill={dir(net)}
        style={{ pointerEvents: 'none' }}
      >
        {fmtWheelPct(net)}
      </text>
      <text
        textAnchor="middle"
        y={12}
        fontSize={9.5}
        fill={T.muted}
        opacity={0.7}
        style={{ pointerEvents: 'none' }}
      >
        {up} up · {down} down
      </text>
      {focus && (
        <>
          <text
            textAnchor="middle"
            y={30}
            fontSize={9}
            fontWeight={700}
            fill={T.cyan}
            style={{ pointerEvents: 'none' }}
          >
            ← all sectors
          </text>
          <circle
            r={R * RING.holeOut - 3}
            fill="transparent"
            style={{ cursor: 'pointer' }}
            onClick={onClearFocus}
          />
        </>
      )}
    </svg>
  )
})

// ── Movers / leaderboard / footer ────────────────────────────────────────────

function MoverList({ head, rows, dir }: { head: string; rows: WheelRow[]; dir: (v: number) => string }) {
  return (
    <div>
      <div className="mb-1.5 text-2xs font-bold uppercase tracking-[0.08em] text-muted opacity-55">
        {head}
      </div>
      <div className="flex flex-col gap-[3px]">
        {rows.map((m) => (
          <div key={m.t} className="flex justify-between text-xs">
            <span className="font-bold text-fg">{m.t}</span>
            <span className="tabular font-bold" style={{ color: dir(m.c) }}>
              {fmtWheelPct(m.c)}
            </span>
          </div>
        ))}
      </div>
    </div>
  )
}

// ── The card ─────────────────────────────────────────────────────────────────

export interface SectorWheelProps {
  payload: WheelPayload | undefined
  /** The feed errored and there is nothing cached to fall back on. */
  failed: boolean
}

export default function SectorWheel({ payload, failed }: SectorWheelProps) {
  const [cap, setCap] = useState(3)
  const [focus, setFocus] = useState<string | null>(null)
  const [tip, setTip] = useState<Tip | null>(null)
  // `expanded` lifts the whole card into a fixed overlay (portalled to <body>
  // so the page's overflow cannot clip it); `isFs` is the real browser
  // Fullscreen API on top of that. Both live here, so zoom level, cap and the
  // loaded payload all survive the move in either direction.
  const [expanded, setExpanded] = useState(false)
  const [isFs, setIsFs] = useState(false)

  // One element, two jobs: the tooltip measures against it, and it is the
  // visibility gate. It renders unconditionally — an earlier cut hung the
  // observer off a node inside `{data && …}`, which meant the ref was null on
  // the only pass the effect ever ran and the gate silently never engaged.
  const boxRef = useRef<HTMLDivElement>(null)
  const overlayRef = useRef<HTMLDivElement>(null)
  const inView = useInView(boxRef)
  // The pop-out is a fixed overlay over the viewport — it is on screen by
  // definition, whatever the card behind it is doing.
  const paint = inView || expanded

  // A payload is only trusted when it actually has rows, matching v2: a 502 or
  // an empty body leaves whatever is already on screen alone.
  const data = payload && Array.isArray(payload.rows) && payload.rows.length ? payload : undefined
  const rows = useMemo(() => data?.rows ?? [], [data])

  const { sectors, industries, leaves, net, up, down } = useMemo(
    () => buildHierarchy(rows, focus),
    [rows, focus],
  )
  const palette = useMemo(() => wheelPalette(cap), [cap])
  const callouts = useMemo(
    () => buildCallouts(leaves, expanded ? 5 : 3, expanded ? 7.5 : 9.5, palette.barLen),
    [leaves, expanded, palette],
  )

  // Three names each fits under the card; the pop-out has room for a real list.
  const moverCount = expanded ? 8 : 3
  const movers = useMemo(() => {
    const rs = [...rows].sort((a, b) => b.c - a.c)
    return { top: rs.slice(0, moverCount), bottom: rs.slice(-moverCount).reverse() }
  }, [rows, moverCount])
  const ranks = useMemo(() => buildSectorRank(rows), [rows])

  // What the hub number covers. Zoomed in that is the sector — and it has to be
  // the shortest form we have, because the hub is only ~100 units across.
  const hubLabel = focus ? shortestForm(focus).toUpperCase() : 'S&P 500'

  const asOf = data?.updatedAt
    ? new Date(data.updatedAt).toLocaleTimeString('en-US', {
        timeZone: 'America/New_York',
        hour: '2-digit',
        minute: '2-digit',
      })
    : null

  const onTip = useCallback<TipFn>((e, title, sub, val) => {
    const b = boxRef.current?.getBoundingClientRect()
    if (!b) return
    setTip({ x: e.clientX - b.left, y: e.clientY - b.top, bw: b.width, title, sub, val })
  }, [])
  const onLeave = useCallback(() => setTip(null), [])
  const onSector = useCallback((name: string) => setFocus(name), [])
  const onClearFocus = useCallback(() => setFocus(null), [])

  const toggleFullscreen = useCallback(() => {
    const el = overlayRef.current
    if (!el) return
    if (document.fullscreenElement) void document.exitFullscreen().catch(() => {})
    else void el.requestFullscreen().catch(() => {})
  }, [])

  const close = useCallback(() => {
    if (document.fullscreenElement) void document.exitFullscreen().catch(() => {})
    setExpanded(false)
    setTip(null)
  }, [])

  // Esc closes the pop-out. The browser eats the first Esc when we are in real
  // fullscreen, which just drops back to the windowed overlay — that is fine.
  useEffect(() => {
    if (!expanded) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !document.fullscreenElement) close()
    }
    const onFs = () => setIsFs(!!document.fullscreenElement)
    window.addEventListener('keydown', onKey)
    document.addEventListener('fullscreenchange', onFs)
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      window.removeEventListener('keydown', onKey)
      document.removeEventListener('fullscreenchange', onFs)
      document.body.style.overflow = prev
    }
  }, [expanded, close])

  const capOptions = useMemo(
    () =>
      CAPS.map((c) => ({
        label: `${c}%`,
        value: String(c),
        title: `Full-scale move: a name at ±${c}% paints a full-length bar`,
      })),
    [],
  )

  const controls = (
    <>
      <SegGroup
        options={capOptions}
        value={String(cap)}
        onChange={(v) => setCap(Number(v))}
        title="Scale — what counts as a full-length bar"
      />
      {expanded ? (
        <>
          <button
            type="button"
            onClick={toggleFullscreen}
            title={isFs ? 'Exit full screen' : 'Full screen'}
            className="rounded-sm border border-line px-2 py-0.5 text-2xs font-semibold text-muted opacity-75 hover:opacity-100"
          >
            {isFs ? '⤡ Exit full screen' : '⛶ Full screen'}
          </button>
          <button
            type="button"
            onClick={close}
            title="Close (Esc)"
            className="rounded-sm border border-line px-2 py-0.5 text-2xs font-semibold text-muted opacity-75 hover:opacity-100"
          >
            ✕ Close
          </button>
        </>
      ) : (
        <button
          type="button"
          onClick={() => setExpanded(true)}
          title="Pop out to a larger window"
          className="rounded-sm border border-line px-2 py-0.5 text-2xs font-semibold text-muted opacity-75 hover:opacity-100"
        >
          ⤢ Expand
        </button>
      )}
    </>
  )

  const body = (
    <>
      {/* How to read it. The zoomed-in variant is a way back OUT, not a
          caption — there is no other affordance for it. */}
      <div className="mb-2.5 text-xs text-muted opacity-65">
        {focus ? (
          <>
            Showing <strong className="text-fg">{focus}</strong> — click the middle to go back.
          </>
        ) : (
          <>Bar length = size of move, color = direction. Click a sector to zoom.</>
        )}
      </div>

      <div
        className={
          expanded
            ? 'flex flex-row flex-wrap items-start gap-7'
            : 'flex flex-col flex-nowrap items-stretch gap-0'
        }
      >
        <div
          className="flex min-w-0 justify-center"
          style={expanded ? { flex: '1 1 460px' } : undefined}
        >
          <div
            ref={boxRef}
            data-visible={paint ? '1' : '0'}
            className="relative w-full"
            style={expanded ? { maxWidth: 'min(100%, calc(100vh - 200px))' } : undefined}
          >
            {!data && !failed && (
              <div className="px-3 py-12 text-center text-xs text-muted opacity-60">
                Loading sector data…
              </div>
            )}
            {failed && !data && (
              <div className="rounded-md border border-dashed border-line px-3 py-9 text-center text-xs text-muted opacity-70">
                Sector feed unavailable. Retrying every 5 minutes.
              </div>
            )}

            {data && (
              // Square box whether or not the wheel is painting, so scrolling
              // past a gated card does not make the page jump.
              <div style={{ aspectRatio: '1 / 1' }}>
                {paint && (
                  <WheelSvg
                    sectors={sectors}
                    industries={industries}
                    leaves={leaves}
                    callouts={callouts}
                    palette={palette}
                    focus={focus}
                    expanded={expanded}
                    net={net}
                    up={up}
                    down={down}
                    hubLabel={hubLabel}
                    onSector={onSector}
                    onClearFocus={onClearFocus}
                    onTip={onTip}
                    onLeave={onLeave}
                  />
                )}
              </div>
            )}

            {tip && (
              <div
                className="pointer-events-none absolute z-[5] min-w-[120px] rounded-md border border-line bg-raised px-2.5 py-2"
                style={{ left: Math.max(0, Math.min(tip.x + 12, tip.bw - 150)), top: tip.y + 12 }}
              >
                <div className="text-xs font-bold text-fg">{tip.title}</div>
                <div className="mt-px text-2xs text-muted opacity-60">{tip.sub}</div>
                <div className="mt-1 text-base font-bold" style={{ color: palette.dir(tip.val) }}>
                  {fmtWheelPct(tip.val)}
                </div>
              </div>
            )}
          </div>
        </div>

        {/* side rail when popped out, footer stack when in the card */}
        <div
          className={expanded ? 'min-w-[220px]' : 'w-full shrink-0'}
          style={expanded ? { flex: '0 1 280px' } : undefined}
        >
          {/* biggest movers — the wheel is too small for callouts to name them
              all, so name them here. Always the full universe. */}
          {data && (
            <div className="mt-3 grid grid-cols-2 gap-2.5">
              <MoverList head="Top" rows={movers.top} dir={palette.dir} />
              <MoverList head="Bottom" rows={movers.bottom} dir={palette.dir} />
            </div>
          )}

          {/* sector leaderboard — only the pop-out has the room for it */}
          {data && expanded && (
            <div className="mt-[18px]">
              <div className="mb-1.5 text-2xs font-bold uppercase tracking-[0.08em] text-muted opacity-55">
                Sectors
              </div>
              <div className="flex flex-col gap-1">
                {ranks.map((s) => (
                  <button
                    key={s.name}
                    type="button"
                    onClick={() => setFocus(focus === s.name ? null : s.name)}
                    title={`${s.n} names · click to zoom the wheel`}
                    className={[
                      'grid grid-cols-[1fr_56px] items-center gap-2 rounded-sm border px-1.5 py-[3px] text-left text-xs font-semibold text-fg',
                      focus === s.name ? 'border-accent bg-raised' : 'border-transparent',
                    ].join(' ')}
                  >
                    <span className="truncate">{s.name}</span>
                    <span className="tabular text-right font-bold" style={{ color: palette.dir(s.chg) }}>
                      {fmtWheelPct(s.chg)}
                    </span>
                  </button>
                ))}
              </div>
            </div>
          )}

          {data && (
            <div className="mt-2.5 flex justify-between text-2xs text-muted opacity-50">
              <span>
                {data.covered}/{data.universe} names{data.stale ? ' · cached' : ''}
              </span>
              {asOf && <span>as of {asOf} ET</span>}
            </div>
          )}
        </div>
      </div>
    </>
  )

  if (expanded && typeof document !== 'undefined') {
    return createPortal(
      <div
        ref={overlayRef}
        onMouseDown={(e) => {
          if (e.target === e.currentTarget) close()
        }}
        className="fixed inset-0 z-[4000] flex items-center justify-center backdrop-blur-md"
        style={{
          padding: isFs ? 0 : 'clamp(10px, 2.5vw, 32px)',
          background: isFs ? T.bg : alpha(T.bg, 0.82),
        }}
      >
        <div
          className={[
            'max-h-full w-full overflow-auto',
            isFs ? '' : 'rounded-lg border border-line bg-surface shadow-2xl',
          ].join(' ')}
          style={{ maxWidth: isFs ? 'none' : 1320, padding: 'clamp(16px, 2vw, 28px)' }}
        >
          <div className="mb-1.5 flex flex-wrap items-center justify-between gap-2">
            <div className="text-lg font-medium text-fg">S&amp;P Sector Wheel</div>
            <div className="flex shrink-0 items-center gap-1.5">{controls}</div>
          </div>
          {body}
        </div>
      </div>,
      document.body,
    )
  }

  return (
    <Card title="S&P Sector Wheel" actions={controls}>
      {body}
    </Card>
  )
}
