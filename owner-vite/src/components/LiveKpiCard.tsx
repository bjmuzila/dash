import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties, ReactNode } from "react";
import { OWNER_THEME as T, homePanelStyle, ownerRgba } from "../lib/theme";

/**
 * ─────────────────────────────────────────────────────────────────────────────
 * LIVE KPI CARD — the owner dashboard's stat tile.
 *
 * Replaces the old 72×26 sparkline with a real chart: monotone-cubic curve,
 * gradient fill, animated y-domain, a pulsing live dot + value badge at the
 * tip, and a crosshair tooltip on hover. Same visual language as the Bklit
 * `LiveLineChart` docs, but written against zero dependencies — owner-vite has
 * no @visx/motion, and this needs to stay in the initial bundle.
 *
 * Layout is the Plausible-style tile: uppercase label + delta pill on the top
 * row, big value, sub-line, chart flush along the bottom of the card.
 *
 * SVG draws only stroke/fill geometry (with preserveAspectRatio="none" so the
 * curve stretches to any card width); every glyph — dot, badge, axis labels,
 * tooltip — is HTML positioned in percent, so nothing gets distorted by the
 * non-uniform scale. Same trick the existing ControlPanel sparkline uses.
 * ─────────────────────────────────────────────────────────────────────────────
 */

export type LivePoint = { label?: string; value: number };

// ─── Curve ─────────────────────────────────────────────────────────────────────

/** Monotone cubic interpolation (d3's curveMonotoneX) — smooth without the
 *  overshoot that a plain Catmull-Rom gives you on spiky revenue data. */
function monotonePath(pts: { x: number; y: number }[]): string {
  const n = pts.length;
  if (n === 0) return "";
  if (n === 1) return `M${pts[0].x},${pts[0].y}`;
  if (n === 2) return `M${pts[0].x},${pts[0].y}L${pts[1].x},${pts[1].y}`;

  const dx: number[] = [], dy: number[] = [], m: number[] = [];
  for (let i = 0; i < n - 1; i++) {
    dx[i] = pts[i + 1].x - pts[i].x;
    dy[i] = pts[i + 1].y - pts[i].y;
    m[i] = dy[i] / (dx[i] || 1);
  }
  const t: number[] = [m[0]];
  for (let i = 1; i < n - 1; i++) {
    if (m[i - 1] * m[i] <= 0) {
      t[i] = 0; // local extremum — flatten so the curve can't overshoot
    } else {
      const w1 = 2 * dx[i] + dx[i - 1];
      const w2 = dx[i] + 2 * dx[i - 1];
      t[i] = (w1 + w2) / (w1 / m[i - 1] + w2 / m[i]);
    }
  }
  t[n - 1] = m[n - 2];

  let d = `M${pts[0].x},${pts[0].y}`;
  for (let i = 0; i < n - 1; i++) {
    const x1 = pts[i].x + dx[i] / 3;
    const y1 = pts[i].y + (t[i] * dx[i]) / 3;
    const x2 = pts[i + 1].x - dx[i] / 3;
    const y2 = pts[i + 1].y - (t[i + 1] * dx[i]) / 3;
    d += `C${x1.toFixed(2)},${y1.toFixed(2)} ${x2.toFixed(2)},${y2.toFixed(2)} ${pts[i + 1].x.toFixed(2)},${pts[i + 1].y.toFixed(2)}`;
  }
  return d;
}

// ─── Animation ─────────────────────────────────────────────────────────────────

/** Eases the whole series toward its next shape instead of snapping on each
 *  poll — the `lerpSpeed` behaviour from the live-chart spec. Series that grow
 *  or shrink are padded from the nearest existing sample so new points slide in
 *  from the edge rather than popping. */
function useLerpedSeries(target: number[], speed = 0.18): number[] {
  const [shown, setShown] = useState<number[]>(target);
  const shownRef = useRef<number[]>(target);
  const raf = useRef<number | null>(null);

  useEffect(() => {
    if (target.length === 0) {
      shownRef.current = [];
      setShown([]);
      return;
    }
    // Resize the in-flight series to match the target before interpolating.
    let from = shownRef.current;
    if (from.length !== target.length) {
      if (from.length === 0) from = target.slice();
      else if (from.length < target.length) {
        const pad = Array.from({ length: target.length - from.length }, () => from[0]);
        from = [...pad, ...from];
      } else {
        from = from.slice(from.length - target.length);
      }
      shownRef.current = from;
    }

    const step = () => {
      const cur = shownRef.current;
      let moved = false;
      const next = cur.map((v, i) => {
        const goal = target[i];
        const d = goal - v;
        if (Math.abs(d) < Math.max(1e-4, Math.abs(goal) * 1e-4)) return goal;
        moved = true;
        return v + d * speed;
      });
      shownRef.current = next;
      setShown(next);
      raf.current = moved ? requestAnimationFrame(step) : null;
    };

    if (raf.current == null) raf.current = requestAnimationFrame(step);
    return () => {
      if (raf.current != null) cancelAnimationFrame(raf.current);
      raf.current = null;
    };
    // Stringified so an identical poll result doesn't restart the loop.
  }, [JSON.stringify(target), speed]);

  return shown.length === target.length ? shown : target;
}

/** Rolling in-memory history for a metric that only ever reports "right now".
 *  Infra tiles (WS clients, contracts sub'd, spot) poll a scalar; this turns
 *  that poll into a real streaming series so the tile can draw a live line. */
export function useLiveSeries(value: number | null | undefined, cap = 40): LivePoint[] {
  const [series, setSeries] = useState<LivePoint[]>([]);
  useEffect(() => {
    if (value == null || !Number.isFinite(value)) return;
    setSeries((prev) => {
      const label = new Date().toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", second: "2-digit", hour12: false });
      const next = [...prev, { label, value }];
      return next.length > cap ? next.slice(next.length - cap) : next;
    });
  }, [value, cap]);
  return series;
}

// ─── Pulse keyframes (injected once) ───────────────────────────────────────────

const PULSE_CSS = `
@keyframes lkc-pulse {
  0%   { transform: translate(-50%,-50%) scale(1);   opacity: 0.55; }
  70%  { transform: translate(-50%,-50%) scale(3.4); opacity: 0; }
  100% { transform: translate(-50%,-50%) scale(3.4); opacity: 0; }
}
@keyframes lkc-in { from { opacity: 0; transform: translateY(4px); } to { opacity: 1; transform: none; } }
`;

function usePulseStyles() {
  useLayoutEffect(() => {
    const ID = "live-kpi-card-styles";
    if (document.getElementById(ID)) return;
    const el = document.createElement("style");
    el.id = ID;
    el.textContent = PULSE_CSS;
    document.head.appendChild(el);
  }, []);
}

// ─── Chart ─────────────────────────────────────────────────────────────────────

export function LiveLineChart({
  points,
  color = T.cyan,
  height = 78,
  formatValue = (v: number) => String(Math.round(v)),
  showYAxis = true,
  showXAxis = true,
  showGrid = true,
  showBadge = true,
  pulse = true,
  live = true,
  emptyHint = "no data yet",
}: {
  points: LivePoint[];
  color?: string;
  height?: number;
  formatValue?: (v: number) => string;
  showYAxis?: boolean;
  showXAxis?: boolean;
  showGrid?: boolean;
  showBadge?: boolean;
  /** Pulsing halo on the live dot. */
  pulse?: boolean;
  /** Draw the tip dot/badge at all — off for finished, non-streaming series. */
  live?: boolean;
  emptyHint?: string;
}) {
  usePulseStyles();
  const [hoverI, setHoverI] = useState<number | null>(null);
  const svgRef = useRef<SVGSVGElement | null>(null);

  const raw = points.length === 1 ? [points[0], points[0]] : points;
  const targets = useMemo(() => raw.map((p) => p.value), [raw]);
  const vals = useLerpedSeries(targets);

  // Y domain with 12% headroom so the curve never kisses the frame. A flat
  // series gets an artificial band so it renders mid-card instead of on an edge.
  const { min, max } = useMemo(() => {
    if (vals.length === 0) return { min: 0, max: 1 };
    let lo = Math.min(...vals), hi = Math.max(...vals);
    if (hi === lo) { const p = Math.abs(hi) * 0.1 || 1; lo -= p; hi += p; }
    const pad = (hi - lo) * 0.12;
    return { min: lo - pad, max: hi + pad };
  }, [vals]);

  const VB_W = 100;                       // viewBox units; stretched to card width
  const VB_H = 100;
  const range = max - min || 1;
  const stepX = vals.length > 1 ? VB_W / (vals.length - 1) : 0;
  const coords = vals.map((v, i) => ({
    x: i * stepX,
    y: VB_H - ((v - min) / range) * VB_H,
  }));

  const line = monotonePath(coords);
  const area = coords.length ? `${line} L${VB_W},${VB_H} L0,${VB_H} Z` : "";
  const uid = useMemo(() => `lkc-${Math.random().toString(36).slice(2, 9)}`, []);

  const last = coords[coords.length - 1];
  const lastVal = vals[vals.length - 1];

  const onMove: React.MouseEventHandler<SVGSVGElement> = (e) => {
    if (!svgRef.current || vals.length < 2) return;
    const r = svgRef.current.getBoundingClientRect();
    const frac = Math.min(1, Math.max(0, (e.clientX - r.left) / r.width));
    setHoverI(Math.round(frac * (vals.length - 1)));
  };

  if (points.length === 0) {
    return (
      <div style={{
        height, display: "flex", alignItems: "center", justifyContent: "center",
        fontSize: 10, color: T.muted, opacity: 1, letterSpacing: "0.04em",
        border: `1px dashed ${ownerRgba("#FFFFFF", 0.08)}`, borderRadius: 8,
      }}>
        {emptyHint}
      </div>
    );
  }

  const hovered = hoverI != null ? coords[hoverI] : null;
  const yLabels = showYAxis ? [max, (max + min) / 2, min] : [];
  const firstLabel = raw[0]?.label ?? "";
  const lastLabel = raw[raw.length - 1]?.label ?? "";

  // The tip badge and the y-axis both live in the right gutter, so only one of
  // them can be on — the badge wins, since the card already prints the headline
  // number and a repeated axis scale is the less useful of the two.
  const badgeText = formatValue(lastVal ?? 0);
  const wantBadge = showBadge && live && !showYAxis;
  const rightGutter = showYAxis
    ? 44
    : wantBadge
      ? Math.min(76, Math.max(30, badgeText.length * 6.4 + 16))
      : 6;

  return (
    <div style={{
      // border-box matters: the gutter is carved OUT of the card width, not
      // added to it. Without it the wrapper overflows by `rightGutter` and every
      // percentage-positioned overlay (dot, badge, crosshair) lands too far
      // right and gets clipped by the card.
      position: "relative", width: "100%", boxSizing: "border-box",
      paddingRight: rightGutter,
      animation: "lkc-in 420ms ease-out both",
    }}>
      <svg
        ref={svgRef}
        viewBox={`0 0 ${VB_W} ${VB_H}`}
        preserveAspectRatio="none"
        style={{ width: "100%", height, display: "block", overflow: "visible", cursor: vals.length > 1 ? "crosshair" : "default" }}
        onMouseMove={onMove}
        onMouseLeave={() => setHoverI(null)}
      >
        <defs>
          <linearGradient id={`${uid}-fill`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={color} stopOpacity="0.34" />
            <stop offset="55%" stopColor={color} stopOpacity="0.10" />
            <stop offset="100%" stopColor={color} stopOpacity="0" />
          </linearGradient>
        </defs>

        {showGrid && [0, 0.5, 1].map((f) => (
          <line
            key={f}
            x1={0} x2={VB_W} y1={f * VB_H} y2={f * VB_H}
            stroke="#FFFFFF" strokeOpacity={0.06} strokeWidth={1}
            strokeDasharray="3 4" vectorEffect="non-scaling-stroke"
          />
        ))}

        <path d={area} fill={`url(#${uid}-fill)`} />
        <path
          d={line}
          fill="none"
          stroke={color}
          strokeWidth={2}
          strokeLinecap="round"
          strokeLinejoin="round"
          vectorEffect="non-scaling-stroke"
        />

        {hovered && (
          <line
            x1={hovered.x} x2={hovered.x} y1={0} y2={VB_H}
            stroke={color} strokeOpacity={0.55} strokeWidth={1}
            strokeDasharray="2 3" vectorEffect="non-scaling-stroke"
          />
        )}
      </svg>

      {/* ── HTML overlay: circles/text stay round and legible under the stretch ── */}

      {live && last && (
        <>
          {pulse && (
            <span style={{
              position: "absolute", left: `calc((100% - ${rightGutter}px) * ${last.x / VB_W})`,
              top: (last.y / VB_H) * height, width: 7, height: 7, borderRadius: "50%",
              background: color, pointerEvents: "none",
              transform: "translate(-50%,-50%)",
              animation: "lkc-pulse 1900ms ease-out infinite",
            }} />
          )}
          <span style={{
            position: "absolute", left: `calc((100% - ${rightGutter}px) * ${last.x / VB_W})`,
            top: (last.y / VB_H) * height, width: 7, height: 7, borderRadius: "50%",
            background: color, boxShadow: `0 0 0 2px ${T.panel}, 0 0 10px ${color}`,
            transform: "translate(-50%,-50%)", pointerEvents: "none",
          }} />
          {wantBadge && (
            <span style={{
              position: "absolute", left: `calc(100% - ${rightGutter}px + 7px)`,
              top: (last.y / VB_H) * height, transform: "translateY(-50%)",
              fontSize: 10, fontFamily: "var(--font-mono), monospace", fontWeight: 700,
              color, background: ownerRgba("#05060A", 0.85), border: `1px solid ${color}55`,
              borderRadius: 4, padding: "1px 4px", lineHeight: 1.3, whiteSpace: "nowrap",
              pointerEvents: "none",
            }}>
              {badgeText}
            </span>
          )}
        </>
      )}

      {/* Y axis — animated because the labels read off the lerped domain. */}
      {showYAxis && (
        <div style={{
          position: "absolute", right: 0, top: 0, height, width: rightGutter - 4,
          display: "flex", flexDirection: "column", justifyContent: "space-between",
          fontSize: 10, fontFamily: "var(--font-mono), monospace", color: T.muted,
          opacity: 1, textAlign: "right", pointerEvents: "none", lineHeight: 1,
        }}>
          {yLabels.map((v, i) => <span key={i}>{formatValue(v)}</span>)}
        </div>
      )}

      {hovered && hoverI != null && (
        <>
          <span style={{
            position: "absolute", left: `calc((100% - ${rightGutter}px) * ${hovered.x / VB_W})`,
            top: (hovered.y / VB_H) * height, width: 8, height: 8, borderRadius: "50%",
            background: color, border: `2px solid ${T.panel}`,
            transform: "translate(-50%,-50%)", pointerEvents: "none",
          }} />
          <div style={{
            position: "absolute", bottom: `calc(100% + 6px)`,
            left: `calc((100% - ${rightGutter}px) * ${hovered.x / VB_W})`,
            transform: `translateX(${hoverI === 0 ? "0%" : hoverI === vals.length - 1 ? "-100%" : "-50%"})`,
            background: T.panelBgStrong, border: `1px solid ${color}66`, borderRadius: 6,
            padding: "5px 8px", fontSize: 12, fontFamily: "var(--font-mono), monospace",
            color: T.text, whiteSpace: "nowrap", pointerEvents: "none", zIndex: 20,
            boxShadow: "0 6px 18px rgba(0,0,0,0.6)",
          }}>
            <div style={{ fontWeight: 700, color }}>{formatValue(targets[hoverI] ?? vals[hoverI])}</div>
            {raw[hoverI]?.label && <div style={{ opacity: 1, marginTop: 2, fontSize: 10 }}>{raw[hoverI].label}</div>}
          </div>
        </>
      )}

      {showXAxis && (firstLabel || lastLabel) && (
        <div style={{
          display: "flex", justifyContent: "space-between", marginTop: 4,
          fontSize: 10, fontFamily: "var(--font-mono), monospace",
          color: T.muted, opacity: 1, lineHeight: 1, pointerEvents: "none",
        }}>
          <span>{firstLabel}</span>
          <span>{lastLabel}</span>
        </div>
      )}
    </div>
  );
}

// ─── Delta pill ────────────────────────────────────────────────────────────────

/** Period-over-period change, Plausible-style. `invert` flips the colour for
 *  metrics where down is good (expenses, bounce rate, error count). */
export function DeltaPill({ delta, invert = false }: { delta: number | null | undefined; invert?: boolean }) {
  if (delta == null || !Number.isFinite(delta)) return null;
  const flat = Math.abs(delta) < 0.05;
  const good = invert ? delta < 0 : delta > 0;
  const color = flat ? T.muted : good ? T.green : T.red;
  const arrow = flat ? "→" : delta > 0 ? "↑" : "↓";
  const mag = Math.abs(delta);
  const text = mag >= 1000 ? `${(mag / 1000).toFixed(1)}K%` : `${mag.toFixed(1)}%`;
  return (
    <span style={{
      display: "inline-flex", alignItems: "center", gap: 3, flexShrink: 0,
      fontSize: 10, fontWeight: 700, fontFamily: "var(--font-mono), monospace",
      color, background: `${color}18`, border: `1px solid ${color}3a`,
      borderRadius: 999, padding: "1px 6px", lineHeight: 1.5, whiteSpace: "nowrap",
    }}>
      <span style={{ fontSize: 10 }}>{arrow}</span>{text}
    </span>
  );
}

/** % change of the last sample vs. the first — what the pill shows when the
 *  caller hands over a series instead of a precomputed delta. */
export function seriesDelta(points: LivePoint[]): number | null {
  if (points.length < 2) return null;
  const first = points[0].value;
  const last = points[points.length - 1].value;
  if (first === 0) return last === 0 ? 0 : null;
  return ((last - first) / Math.abs(first)) * 100;
}

// ─── Card ──────────────────────────────────────────────────────────────────────

export function LiveKpiCard({
  label,
  value,
  sub,
  tooltip,
  accent = T.cyan,
  points,
  formatValue,
  delta,
  invertDelta = false,
  height = 78,
  mono = true,
  live = true,
  showAxes = true,
  showYAxis = false,
  footer,
  style,
}: {
  label: string;
  value: ReactNode;
  sub?: ReactNode;
  tooltip?: string;
  accent?: string;
  points?: LivePoint[];
  formatValue?: (v: number) => string;
  /** Explicit delta %, or `undefined` to derive it from `points`. `null` hides it. */
  delta?: number | null;
  invertDelta?: boolean;
  height?: number;
  mono?: boolean;
  live?: boolean;
  /** Date labels under the curve. */
  showAxes?: boolean;
  /** Off by default inside a card — the headline number above already gives the
   *  scale, and the axis gutter would push out the live value badge. */
  showYAxis?: boolean;
  footer?: ReactNode;
  style?: CSSProperties;
}) {
  const pts = points ?? [];
  const shownDelta = delta === undefined ? seriesDelta(pts) : delta;

  return (
    <div
      title={tooltip}
      style={{
        ...homePanelStyle,
        minHeight: 0,
        padding: "14px 16px 12px",
        borderRadius: 12,
        display: "flex",
        flexDirection: "column",
        gap: 4,
        overflow: "hidden",
        ...style,
      }}
    >
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
        <span style={{
          fontSize: 12, fontWeight: 700, color: T.gold, letterSpacing: "0.07em",
          textTransform: "uppercase", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis",
        }}>
          {label}
        </span>
        <DeltaPill delta={shownDelta} invert={invertDelta} />
      </div>

      <div style={{
        fontSize: 30, fontWeight: 700, color: T.text, lineHeight: 1.1,
        fontFamily: mono ? "var(--font-mono), monospace" : "inherit",
        letterSpacing: "-0.01em", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis",
      }}>
        {value}
      </div>

      {sub != null && sub !== "" && (
        <div style={{ fontSize: 12, color: T.textSecondary, opacity: 1, lineHeight: 1.3 }}>{sub}</div>
      )}

      {pts.length > 0 && (
        <div style={{ marginTop: "auto", paddingTop: 10 }}>
          <LiveLineChart
            points={pts}
            color={accent}
            height={height}
            formatValue={formatValue}
            showYAxis={showYAxis}
            showXAxis={showAxes}
            live={live}
          />
        </div>
      )}

      {footer != null && <div style={{ marginTop: pts.length ? 8 : "auto", paddingTop: pts.length ? 0 : 10 }}>{footer}</div>}
    </div>
  );
}

export default LiveKpiCard;
