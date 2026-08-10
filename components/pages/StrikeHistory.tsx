"use client";

/**
 * /strike-history — per-strike net GEX and IV skew over time.
 *
 * Pick a date + expiry + strike and get every recorded snapshot for that ONE
 * strike out of `option_strike_gex_history`: net GEX, volume-weighted net GEX,
 * Flow GEX, and IV skew vs the at-the-money strike.
 *
 * Flow GEX is the only DEALER-SIGNED series of the four. net_gex is the OI book
 * and net_vol_gex is the volume book; both assume every contract is dealer-long-
 * call / short-put. Flow GEX instead reads the classified tape — γ × dealer
 * inventory × spot², both legs +gamma because the inventory is already the
 * dealer's own signed position. Rebuilt server-side per snapshot from
 * flow_prints; see /api/strike-gex-series in server-v2/api-router.js.
 *
 * (Spot had its own panel here until Flow GEX took the slot. It was the one
 * panel not about the selected strike, and it still shows in the "Spot range"
 * tile and the hover strip.)
 *
 * Skew is `IV(K) − IV(ATM)`, where IV at a strike is the call/put average and
 * ATM is the strike nearest spot AT THAT SNAPSHOT (recomputed per tick, since
 * spot drifts through the session). The API returns it precomputed.
 *
 * The recorder writes 24/7, so the RTH/ETH switch is a client-side window over
 * already-fetched rows — no refetch, and every derived number (stat tiles, OI
 * step detection, axis ranges) recomputes against the visible window so a
 * "session low" always means the low of the session you're looking at.
 *
 * Data: GET /api/strike-gex-series (server-v2/api-router.js), fetch-on-load +
 * explicit refresh — no polling, so an open tab never hammers the pool.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { HOME_THEME, homeRefreshButtonStyle, homeButtonStyle, homeSecondaryButtonStyle, homeInputStyle, statTileStyle, DOCK_THEME, LIGHT_BLUE, SOFT_RED } from "@/components/shared/homeTheme";
import { PageShell, Card } from "@/components/shared/PageCard";
import { ThemedSelect } from "@/components/shared/ThemedSelect";

type DayMeta = { date: string; expiry: string; snaps: number };
type StrikeMeta = { strike: number; snaps: number; avgNetGex: number };
type SessionWindow = "eth" | "rth";
type Row = {
  t: number;
  spot: number | null;
  netGex: number;
  netVolGex: number | null;
  /**
   * Per-strike Flow GEX: γ × DEALER inventory × spot², reconstructed server-side
   * from flow_prints (see /api/strike-gex-series). Null when the session has no
   * tape at all — which is NOT the same as a flat zero, so it must not render as
   * one. Sign is dealer polarity: + = dealer long gamma here, − = short.
   */
  flowGex: number | null;
  /** Dealer's own signed contract position behind flowGex, for the hover strip. */
  flowCallNet: number | null;
  flowPutNet: number | null;
  callGamma: number | null;
  putGamma: number | null;
  callIv: number | null;
  putIv: number | null;
  ivK: number | null;
  atmStrike: number | null;
  atmIv: number | null;
  skew: number | null;
  skewPct: number | null;
};
/** Row plus its ET minute-of-day, computed once on load rather than per render. */
type VRow = Row & { etMin: number; hhmm: string };

const ET = "America/New_York";
/**
 * ONE formatter, module-level. Building an Intl.DateTimeFormat is expensive and
 * these run per row per render across four panels — instantiating inside the
 * loop is what turns a 550-row series into visible lag on every hover.
 */
const ET_FMT = new Intl.DateTimeFormat("en-US", {
  timeZone: ET, hour12: false, hour: "2-digit", minute: "2-digit",
});
function etParts(ms: number): { hhmm: string; etMin: number } {
  const p = ET_FMT.formatToParts(new Date(ms));
  let h = Number(p.find((x) => x.type === "hour")?.value ?? 0);
  const m = Number(p.find((x) => x.type === "minute")?.value ?? 0);
  // hour12:false yields "24" for midnight in some ICU builds — normalize, or
  // every midnight row sorts past 16:00 and lands inside the RTH window.
  if (h === 24) h = 0;
  return { hhmm: `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`, etMin: h * 60 + m };
}

/**
 * Shared height for every control in the filter row. ThemedSelect's trigger and
 * a padded <input> both compute to 34px, so pinning buttons to the same number
 * is what keeps the row on one baseline.
 */
const CTRL_H = 34;

/** Regular trading hours, ET: 09:30 inclusive → 16:00 exclusive. */
const RTH_OPEN_MIN = 9 * 60 + 30;
const RTH_CLOSE_MIN = 16 * 60;

const fmtM = (v: number | null | undefined, digits = 2) =>
  v == null || !Number.isFinite(v) ? "—" : (v / 1e6).toFixed(digits) + "M";
/** Skew arrives in vol decimals (0.021). Vol points read better on an axis. */
const fmtVp = (v: number | null | undefined, digits = 1) =>
  v == null || !Number.isFinite(v) ? "—" : (v > 0 ? "+" : "") + (v * 100).toFixed(digits);
const fmtIv = (v: number | null | undefined) =>
  v == null || !Number.isFinite(v) ? "—" : (v * 100).toFixed(1) + "%";
/** Signed contract count — the sign IS the reading, so + is always explicit. */
const fmtSigned = (v: number | null | undefined) =>
  v == null || !Number.isFinite(v) ? "—" : (v > 0 ? "+" : "") + Math.round(v).toLocaleString("en-US");

/**
 * Snapshots where net GEX steps hard while per-contract gamma does NOT move are
 * open-interest refreshes, not flow: gamma is the price-sensitivity term, OI is
 * the size term, so a jump with gamma flat can only have come from the OI side.
 * Marking them matters because levels either side of one are not comparable.
 */
function findOiSteps(rows: VRow[]): number[] {
  if (rows.length < 12) return [];
  const deltas: number[] = [];
  for (let i = 1; i < rows.length; i++) deltas.push(Math.abs(rows[i].netGex - rows[i - 1].netGex));
  const sorted = [...deltas].sort((a, b) => a - b);
  const median = sorted[Math.floor(sorted.length / 2)] || 0;
  if (median <= 0) return [];
  const out: number[] = [];
  for (let i = 1; i < rows.length; i++) {
    const jump = Math.abs(rows[i].netGex - rows[i - 1].netGex);
    const g0 = rows[i - 1].callGamma;
    const g1 = rows[i].callGamma;
    const gammaFlat = g0 != null && g1 != null && Math.abs(g1 - g0) < 1e-6;
    if (jump > median * 6 && gammaFlat) out.push(i);
  }
  return out;
}

/* ── chart ────────────────────────────────────────────────────────────────── */

const VB_W = 560;
const VB_H = 210;
const M = { l: 62, r: 52, t: 12, b: 26 };

function niceTicks(lo: number, hi: number, n: number): number[] {
  if (!(hi > lo)) return [lo];
  const raw = (hi - lo) / n;
  const mag = Math.pow(10, Math.floor(Math.log10(raw)));
  const norm = raw / mag;
  const step = (norm <= 1 ? 1 : norm <= 2 ? 2 : norm <= 5 ? 5 : 10) * mag;
  const out: number[] = [];
  for (let v = Math.ceil(lo / step) * step; v <= hi + 1e-9; v += step) out.push(Number(v.toFixed(10)));
  return out;
}

function Panel({
  rows, values, color, fmt, hoverFmt, refLine, refLabel, steps, hover, onHover,
}: {
  rows: VRow[];
  values: (number | null)[];
  color: string;
  fmt: (v: number) => string;
  /** Axis ticks want round numbers; the hover tag wants precision. Defaults to `fmt`. */
  hoverFmt?: (v: number) => string;
  refLine?: number;
  refLabel?: string;
  steps: number[];
  hover: number | null;
  onHover: (i: number | null) => void;
}) {
  const n = rows.length;
  const pts = useMemo(
    () => values.map((v, i) => ({ v, i })).filter((p) => p.v != null && Number.isFinite(p.v as number)) as { v: number; i: number }[],
    [values]
  );

  const { lo, hi } = useMemo(() => {
    if (!pts.length) return { lo: 0, hi: 1 };
    let mn = Math.min(...pts.map((p) => p.v));
    let mx = Math.max(...pts.map((p) => p.v));
    if (refLine != null) { mn = Math.min(mn, refLine); mx = Math.max(mx, refLine); }
    if (mn === mx) { mn -= 1; mx += 1; }
    const pad = (mx - mn) * 0.12;
    return { lo: mn - pad, hi: mx + pad };
  }, [pts, refLine]);

  const xAt = (i: number) => M.l + (n > 1 ? (i / (n - 1)) * (VB_W - M.l - M.r) : 0);
  const yAt = (v: number) => M.t + (1 - (v - lo) / (hi - lo)) * (VB_H - M.t - M.b);

  // Break the path where data is missing instead of bridging the gap — a
  // straight line across an hour of nulls reads as a real flat reading.
  const path = useMemo(() => {
    let d = "";
    let pen = false;
    values.forEach((v, i) => {
      if (v == null || !Number.isFinite(v)) { pen = false; return; }
      d += `${pen ? "L" : "M"}${xAt(i).toFixed(1)},${yAt(v).toFixed(1)}`;
      pen = true;
    });
    return d;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [values, lo, hi, n]);

  const ticks = niceTicks(lo, hi, 4);
  const last = pts.length ? pts[pts.length - 1] : null;

  const hourIdx = useMemo(() => {
    const out: number[] = [];
    for (let i = 1; i < n; i++) {
      if (rows[i].hhmm.slice(0, 2) !== rows[i - 1].hhmm.slice(0, 2)) out.push(i);
    }
    return out;
  }, [rows, n]);

  const svgRef = useRef<SVGSVGElement | null>(null);
  const handleMove = useCallback((e: React.MouseEvent<SVGSVGElement>) => {
    const el = svgRef.current;
    if (!el || n < 2) return;
    const r = el.getBoundingClientRect();
    const px = ((e.clientX - r.left) / r.width) * VB_W;
    const i = Math.round(((px - M.l) / (VB_W - M.l - M.r)) * (n - 1));
    onHover(Math.max(0, Math.min(n - 1, i)));
  }, [n, onHover]);

  return (
    <svg
      ref={svgRef}
      viewBox={`0 0 ${VB_W} ${VB_H}`}
      preserveAspectRatio="xMidYMid meet"
      style={{ display: "block", width: "100%", height: "auto", overflow: "visible" }}
      onMouseMove={handleMove}
      onMouseLeave={() => onHover(null)}
    >
      {ticks.map((tk) => (
        <g key={tk}>
          <line x1={M.l} x2={VB_W - M.r} y1={yAt(tk)} y2={yAt(tk)} stroke={HOME_THEME.border} strokeWidth={1} />
          <text x={M.l - 8} y={yAt(tk) + 3.5} textAnchor="end" fontSize={10} fill={HOME_THEME.text} opacity={0.45}>
            {fmt(tk)}
          </text>
        </g>
      ))}

      {hourIdx.map((i) => (
        <g key={`h${i}`}>
          <line x1={xAt(i)} x2={xAt(i)} y1={M.t} y2={VB_H - M.b} stroke={HOME_THEME.border} strokeWidth={1} />
          <text x={xAt(i)} y={VB_H - M.b + 14} textAnchor="middle" fontSize={10} fill={HOME_THEME.text} opacity={0.45}>
            {rows[i].hhmm}
          </text>
        </g>
      ))}

      {refLine != null && (
        <>
          <line x1={M.l} x2={VB_W - M.r} y1={yAt(refLine)} y2={yAt(refLine)} stroke={HOME_THEME.text} strokeOpacity={0.45} strokeWidth={1.5} strokeDasharray="5 4" />
          {refLabel && (
            <text x={VB_W - M.r + 6} y={yAt(refLine) + 3.5} fontSize={10} fontWeight={700} fill={HOME_THEME.text} opacity={0.55}>{refLabel}</text>
          )}
        </>
      )}

      {steps.map((i) => (
        <line key={`s${i}`} x1={xAt(i)} x2={xAt(i)} y1={M.t} y2={VB_H - M.b} stroke={HOME_THEME.red} strokeWidth={1.5} strokeDasharray="4 3" strokeOpacity={0.8} />
      ))}

      <path d={path} fill="none" stroke={color} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />

      {last && (
        <>
          <circle cx={xAt(last.i)} cy={yAt(last.v)} r={4} fill={color} stroke={HOME_THEME.bg} strokeWidth={2} />
          <text x={xAt(last.i) + 7} y={yAt(last.v) + 3.5} fontSize={10} fontWeight={700} fill={HOME_THEME.text} opacity={0.8}>
            {fmt(last.v)}
          </text>
        </>
      )}

      {hover != null && values[hover] != null && Number.isFinite(values[hover] as number) && (() => {
        const hv = values[hover] as number;
        const hx = xAt(hover);
        const hy = yAt(hv);
        const vTxt = (hoverFmt ?? fmt)(hv);
        // SVG has no text metrics before paint, so size the chips off character
        // count — 5.9px/char at fontSize 10 in a tabular face is close enough
        // that the box never clips.
        const vW = vTxt.length * 5.9 + 10;
        const tTxt = rows[hover].hhmm;
        const tW = tTxt.length * 5.9 + 10;
        // Flip the value chip to the left of the dot near the right edge, or it
        // paints over the last-value label and off the plot.
        const flip = hx + 8 + vW > VB_W - M.r;
        const vX = flip ? hx - 8 - vW : hx + 8;
        // Clamp the time chip so it stays inside the plot at either end.
        const tX = Math.max(M.l, Math.min(VB_W - M.r - tW, hx - tW / 2));
        return (
          <>
            <line x1={hx} x2={hx} y1={M.t} y2={VB_H - M.b} stroke={HOME_THEME.text} strokeOpacity={0.35} strokeWidth={1} strokeDasharray="3 3" />
            <circle cx={hx} cy={hy} r={4.5} fill={color} stroke={HOME_THEME.bg} strokeWidth={2} />

            {/* value at the cursor, pinned to the dot */}
            <rect x={vX} y={hy - 9} width={vW} height={18} rx={4}
              fill={HOME_THEME.bg} fillOpacity={0.92} stroke={color} strokeOpacity={0.55} strokeWidth={1} />
            <text x={vX + vW / 2} y={hy + 3.5} textAnchor="middle" fontSize={10} fontWeight={700}
              fill={color} style={{ fontVariantNumeric: "tabular-nums" }}>
              {vTxt}
            </text>

            {/* timestamp on the x axis, under the crosshair */}
            <rect x={tX} y={VB_H - M.b + 3} width={tW} height={16} rx={4}
              fill={HOME_THEME.bg} fillOpacity={0.92} stroke={HOME_THEME.border} strokeWidth={1} />
            <text x={tX + tW / 2} y={VB_H - M.b + 14.5} textAnchor="middle" fontSize={10} fontWeight={700}
              fill={HOME_THEME.text} opacity={0.85} style={{ fontVariantNumeric: "tabular-nums" }}>
              {tTxt}
            </text>
          </>
        );
      })()}

      <line x1={M.l} x2={VB_W - M.r} y1={VB_H - M.b} y2={VB_H - M.b} stroke={HOME_THEME.border} strokeWidth={1} />
    </svg>
  );
}

/* ── strike input ─────────────────────────────────────────────────────────── */

/**
 * Typeable strike field with an on-theme suggestion list.
 *
 * A plain <select> is unusable once a session records hundreds of strikes, so
 * this takes free text and commits to the NEAREST RECORDED strike rather than
 * whatever was typed — asking for 7423 on a 5-point grid should land you on
 * 7425, not on an empty chart. Exact-vs-snapped is shown under the field so a
 * snap is never silent.
 *
 * The suggestion list is PORTALED to <body> with fixed positioning, exactly like
 * ThemedSelect's menu. Every Card carries backdrop-filter, which makes each card
 * its own stacking context — so an absolutely positioned menu inside the toolbar
 * card, no matter how high its z-index, still paints UNDER the sibling card that
 * follows it in the DOM. A portal is the only fix that survives that.
 */
function StrikeInput({
  strikes, value, onCommit,
}: {
  strikes: StrikeMeta[];
  value: string;
  onCommit: (v: string) => void;
}) {
  const [text, setText] = useState(value);
  const [open, setOpen] = useState(false);
  const [cursor, setCursor] = useState(0);
  const boxRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const [rect, setRect] = useState<{ left: number; top?: number; bottom?: number; width: number; maxH: number } | null>(null);

  // Parent can change the strike on its own (day switch auto-picks the dominant
  // one) — mirror that back into the field instead of leaving stale text.
  useEffect(() => { setText(value); }, [value]);

  // Anchor the portaled list under the input; flip above when it would overflow
  // the viewport bottom. Recomputed on scroll (capture: the page scrolls inside
  // PageShell's <main>, not the window) and on resize.
  useEffect(() => {
    if (!open) return;
    const update = () => {
      const r = inputRef.current?.getBoundingClientRect();
      if (!r) return;
      const GAP = 6, PAD = 8, MAX_H = 260;
      const below = window.innerHeight - r.bottom - GAP - PAD;
      const above = r.top - GAP - PAD;
      const flip = below < Math.min(MAX_H, 160) && above > below;
      setRect({
        left: Math.max(PAD, Math.min(r.left, window.innerWidth - r.width - PAD)),
        ...(flip ? { bottom: window.innerHeight - r.top + GAP } : { top: r.bottom + GAP }),
        width: r.width,
        maxH: Math.max(120, Math.min(MAX_H, flip ? above : below)),
      });
    };
    update();
    window.addEventListener("scroll", update, true);
    window.addEventListener("resize", update);
    return () => {
      window.removeEventListener("scroll", update, true);
      window.removeEventListener("resize", update);
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      const t = e.target as Node;
      // The list lives in a portal, so it is NOT inside boxRef — check both.
      if (boxRef.current?.contains(t) || menuRef.current?.contains(t)) return;
      setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);

  const matches = useMemo(() => {
    const q = text.trim();
    if (!q) return strikes;
    // Prefix first: typing "74" should show the 74xx block, NOT the strikes
    // numerically closest to 74 (which would be the bottom of the chain).
    const pref = strikes.filter((s) => String(s.strike).startsWith(q));
    if (pref.length) return pref;
    const n = Number(q);
    if (Number.isFinite(n)) {
      return [...strikes]
        .sort((a, b) => Math.abs(a.strike - n) - Math.abs(b.strike - n))
        .slice(0, 9)
        .sort((a, b) => a.strike - b.strike);
    }
    return [];
  }, [text, strikes]);

  const exact = useMemo(
    () => strikes.some((s) => String(s.strike) === text.trim()),
    [strikes, text]
  );

  const nearestTo = useCallback((n: number) => {
    if (!strikes.length) return null;
    return strikes.reduce((best, s) =>
      Math.abs(s.strike - n) < Math.abs(best.strike - n) ? s : best, strikes[0]);
  }, [strikes]);

  const commit = useCallback((raw: string) => {
    const n = Number(String(raw).trim());
    if (!Number.isFinite(n)) { setText(value); setOpen(false); return; }
    const hit = strikes.find((s) => s.strike === n) ?? nearestTo(n);
    if (hit) { setText(String(hit.strike)); onCommit(String(hit.strike)); }
    setOpen(false);
  }, [strikes, nearestTo, onCommit, value]);

  const step = useCallback((dir: 1 | -1) => {
    if (!strikes.length) return;
    const sorted = [...strikes].sort((a, b) => a.strike - b.strike);
    const i = sorted.findIndex((s) => String(s.strike) === value);
    const next = sorted[Math.max(0, Math.min(sorted.length - 1, (i < 0 ? 0 : i) + dir))];
    if (next) { setText(String(next.strike)); onCommit(String(next.strike)); }
  }, [strikes, value, onCommit]);

  const onKey = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") { e.preventDefault(); commit(open && matches[cursor] ? String(matches[cursor].strike) : text); return; }
    if (e.key === "Escape") { setOpen(false); setText(value); return; }
    if (e.key === "ArrowDown") {
      e.preventDefault();
      // Closed field: arrows walk the chain. Open list: arrows move the highlight.
      if (!open) { step(1); return; }
      setCursor((c) => Math.min(matches.length - 1, c + 1));
      return;
    }
    if (e.key === "ArrowUp") {
      e.preventDefault();
      if (!open) { step(-1); return; }
      setCursor((c) => Math.max(0, c - 1));
    }
  };

  return (
    <div ref={boxRef} style={{ position: "relative", width: 160 }}>
      <input
        ref={inputRef}
        value={text}
        onChange={(e) => { setText(e.target.value); setOpen(true); setCursor(0); }}
        onFocus={() => setOpen(true)}
        onKeyDown={onKey}
        onBlur={() => { if (!open) commit(text); }}
        placeholder={strikes.length ? "type a strike" : "—"}
        disabled={!strikes.length}
        inputMode="decimal"
        autoComplete="off"
        spellCheck={false}
        style={{
          ...homeInputStyle,
          width: "100%",
          // Box-match ThemedSelect's trigger exactly: same height, radius,
          // weight and family, so the two controls read as one row. <input>
          // does NOT inherit font-family by default — without this it renders
          // in the browser UI font and sits a hair off everything else.
          height: CTRL_H,
          boxSizing: "border-box",
          borderRadius: 8,
          fontFamily: "inherit",
          fontWeight: 700,
          color: HOME_THEME.cyan,
          fontVariantNumeric: "tabular-nums",
        }}
      />

      <div style={{ fontSize: 10, marginTop: 3, color: HOME_THEME.green, opacity: 0.7, height: 12 }}>
        {!strikes.length ? ""
          : text.trim() === "" ? `${strikes.length} recorded`
          : exact ? `exact · ${strikes.length} recorded`
          : `↵ snaps to nearest of ${strikes.length}`}
      </div>

      {open && matches.length > 0 && rect && createPortal(
        <div
          ref={menuRef}
          style={{
            position: "fixed",
            ...(rect.bottom !== undefined ? { bottom: rect.bottom } : { top: rect.top }),
            left: rect.left,
            width: rect.width,
            maxHeight: rect.maxH,
            overflowY: "auto",
            // Same layer as ThemedSelect's menu, so the two dropdowns in this
            // toolbar row can never end up on opposite sides of a card edge.
            zIndex: 9999,
            padding: 4,
            borderRadius: 12,
            border: `1px solid ${HOME_THEME.border}`,
            borderTop: `2px solid ${DOCK_THEME.cyanTop}`,
            background: DOCK_THEME.bg,
            backdropFilter: "blur(18px)",
            WebkitBackdropFilter: "blur(18px)",
            boxShadow: DOCK_THEME.shadow,
          }}
        >
          {matches.map((s, i) => {
            const isCur = String(s.strike) === value;
            const isCursor = i === cursor;
            return (
              <div
                key={s.strike}
                // mousedown, not click: blur fires first on click and would
                // commit the typed text before the row's handler ever ran.
                onMouseDown={(e) => { e.preventDefault(); commit(String(s.strike)); }}
                onMouseEnter={() => setCursor(i)}
                style={{
                  padding: "6px 10px", fontSize: 13, cursor: "pointer",
                  display: "flex", justifyContent: "space-between", gap: 8,
                  fontVariantNumeric: "tabular-nums",
                  color: isCur || isCursor ? HOME_THEME.text : HOME_THEME.green,
                  background: isCur ? DOCK_THEME.activeTile : isCursor ? DOCK_THEME.hoverTile : "transparent",
                  border: `1px solid ${isCur ? DOCK_THEME.activeBorder : "transparent"}`,
                  borderRadius: 6,
                }}
              >
                <span>{s.strike}</span>
                <span style={{ opacity: 0.55, fontSize: 11 }}>{s.snaps}</span>
              </div>
            );
          })}
        </div>,
        document.body
      )}
    </div>
  );
}

/* ── page ─────────────────────────────────────────────────────────────────── */

export default function StrikeHistoryPage() {
  const [days, setDays] = useState<DayMeta[]>([]);
  const [strikes, setStrikes] = useState<StrikeMeta[]>([]);
  const [rows, setRows] = useState<Row[]>([]);

  const [dayKey, setDayKey] = useState("");
  const [strike, setStrike] = useState("");
  const [session, setSession] = useState<SessionWindow>("eth");
  const [hover, setHover] = useState<number | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [refreshState, setRefreshState] = useState<"idle" | "refreshing" | "success" | "error">("idle");

  const [date, expiry] = dayKey ? dayKey.split("|") : ["", ""];

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const r = await fetch("/api/strike-gex-series?mode=meta");
        const j = await r.json();
        if (!alive) return;
        if (j.error) { setErr(String(j.error)); return; }
        const d: DayMeta[] = j.days ?? [];
        setDays(d);
        if (d.length) setDayKey(`${d[0].date}|${d[0].expiry}`);
      } catch (e) { if (alive) setErr(String(e)); }
    })();
    return () => { alive = false; };
  }, []);

  useEffect(() => {
    if (!date || !expiry) return;
    let alive = true;
    (async () => {
      try {
        const r = await fetch(`/api/strike-gex-series?mode=strikes&date=${date}&expiry=${expiry}`);
        const j = await r.json();
        if (!alive) return;
        const s: StrikeMeta[] = j.strikes ?? [];
        setStrikes(s);
        const keep = s.find((x) => String(x.strike) === strike);
        if (!keep) {
          const dominant = [...s].sort((a, b) => Math.abs(b.avgNetGex) - Math.abs(a.avgNetGex))[0];
          setStrike(dominant ? String(dominant.strike) : "");
        }
      } catch (e) { if (alive) setErr(String(e)); }
    })();
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [date, expiry]);

  const loadSeries = useCallback(async () => {
    if (!date || !expiry || !strike) { setRows([]); return; }
    setRefreshState("refreshing");
    try {
      const r = await fetch(`/api/strike-gex-series?mode=series&date=${date}&expiry=${expiry}&strike=${strike}`);
      const j = await r.json();
      if (j.error) { setErr(String(j.error)); setRefreshState("error"); return; }
      setRows(j.rows ?? []);
      setErr(null);
      setRefreshState("success");
      setTimeout(() => setRefreshState("idle"), 1200);
    } catch (e) { setErr(String(e)); setRefreshState("error"); }
  }, [date, expiry, strike]);

  useEffect(() => { void loadSeries(); }, [loadSeries]);

  // ET time is stamped once per fetch; the RTH/ETH switch then costs a filter.
  const stamped = useMemo<VRow[]>(
    () => rows.map((r) => ({ ...r, ...etParts(r.t) })),
    [rows]
  );
  const view = useMemo<VRow[]>(
    () => (session === "rth" ? stamped.filter((r) => r.etMin >= RTH_OPEN_MIN && r.etMin < RTH_CLOSE_MIN) : stamped),
    [stamped, session]
  );

  // Hover is an index into `view`; switching windows changes what that index
  // points at, so drop it rather than leave a crosshair on an unrelated bar.
  useEffect(() => { setHover(null); }, [session, strike, dayKey]);

  const steps = useMemo(() => findOiSteps(view), [view]);
  // (strikeNum is gone with the Spot panel — it existed only to draw the
  // selected strike as that panel's reference line.)
  const skewCount = useMemo(() => view.filter((r) => r.skew != null).length, [view]);
  // Zero is a legitimate Flow GEX reading (a strike nobody traded), so the
  // "is there data" test has to be null-vs-not, never truthiness.
  const flowCount = useMemo(() => view.filter((r) => r.flowGex != null).length, [view]);

  const stats = useMemo(() => {
    if (!view.length) return null;
    const g = view.map((r) => r.netGex);
    const lo = Math.min(...g), hi = Math.max(...g);
    const flips = view.filter((r, i) => i > 0 && Math.sign(r.netGex) !== Math.sign(view[i - 1].netGex)).length;
    const vol = view.map((r) => r.netVolGex).filter((v): v is number => v != null);
    const spots = view.map((r) => r.spot).filter((v): v is number => v != null);
    const sk = view.map((r) => r.skew).filter((v): v is number => v != null);
    const lastRow = view[view.length - 1];
    return {
      current: g[g.length - 1],
      lo, loAt: view[g.indexOf(lo)].hhmm,
      hi, hiAt: view[g.indexOf(hi)].hhmm,
      flips,
      volFirst: vol[0] ?? null, volLast: vol[vol.length - 1] ?? null,
      spotLo: spots.length ? Math.min(...spots) : null,
      spotHi: spots.length ? Math.max(...spots) : null,
      spotNow: spots.length ? spots[spots.length - 1] : null,
      skewNow: sk.length ? sk[sk.length - 1] : null,
      // Latest NON-NULL flow reading, not lastRow's — the newest snapshot can
      // land before its prints are written, and a trailing null would blank the
      // tile on an otherwise complete session.
      flowNow: [...view].reverse().find((r) => r.flowGex != null)?.flowGex ?? null,
      flowCallNet: lastRow.flowCallNet, flowPutNet: lastRow.flowPutNet,
      ivK: lastRow.ivK, atmIv: lastRow.atmIv, atmStrike: lastRow.atmStrike,
      first: view[0].hhmm, last: lastRow.hhmm,
    };
  }, [view]);

  const label: React.CSSProperties = { fontSize: 10, letterSpacing: "0.06em", textTransform: "uppercase", color: HOME_THEME.green, opacity: 0.7 };
  const value: React.CSSProperties = { fontSize: 18, fontWeight: 700, color: HOME_THEME.text, marginTop: 3, fontVariantNumeric: "tabular-nums" };
  const note: React.CSSProperties = { fontSize: 11, color: HOME_THEME.green, opacity: 0.7, marginTop: 2 };
  const panelTitle: React.CSSProperties = { fontSize: 12, fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase", color: HOME_THEME.text, display: "flex", alignItems: "center", gap: 8 };
  /** Pins a short button to the shared control height and centers its label. */
  const centeredCtrl: React.CSSProperties = {
    height: CTRL_H, display: "inline-flex", alignItems: "center", justifyContent: "center", boxSizing: "border-box",
  };
  const panelNote: React.CSSProperties = { fontSize: 11.5, color: HOME_THEME.green, opacity: 0.75, margin: "2px 0 8px" };

  const hoverRow = hover != null ? view[hover] : null;

  /**
   * One control column: fixed-height label, then the control. The row is
   * top-aligned, so a field with extra text underneath (the strike hint) grows
   * downward instead of pushing its own control out of line.
   */
  const Field = ({ text, width, children }: { text?: string; width?: number; children: React.ReactNode }) => (
    <div style={{ width }}>
      <div style={{ ...label, height: 13, lineHeight: "13px", marginBottom: 5 }}>{text ?? "\u00A0"}</div>
      {children}
    </div>
  );

  const PanelCard = ({ title, color, subtitle, children }: { title: string; color: string; subtitle: string; children: React.ReactNode }) => (
    <Card variant="classic" padding={18} style={{ minWidth: 0 }}>
      <div style={panelTitle}>
        <span style={{ width: 9, height: 9, borderRadius: 2, background: color, display: "inline-block" }} />
        {title}
      </div>
      <div style={panelNote}>{subtitle}</div>
      {children}
    </Card>
  );

  return (
    // no-card-lift: the shell-level opt-out from globals.css. These cards hold
    // dense charts you hover CONSTANTLY to read the crosshair — the default
    // rise-on-hover would make the whole panel twitch under the cursor.
    <PageShell className="no-card-lift">
      {/* No tab strip here: the Scanner section's tabs live in the GlobalToolbar
          sub-strip now (ScannerSubStrip), which stays on screen across every
          route in the section — including this one. */}
      <Card
        variant="classic"
        title="Strike GEX + IV skew history"
        subtitle="One strike, every recorded snapshot. Net GEX is read from the stored column — not recomputed."
        padding={20}
      >
        <div style={{ display: "flex", gap: 12, flexWrap: "wrap", alignItems: "flex-start" }}>
          <Field text="Session · expiry" width={230}>
            <ThemedSelect
              value={dayKey}
              onChange={setDayKey}
              options={days.map((d) => ({
                value: `${d.date}|${d.expiry}`,
                label: d.date === d.expiry ? `${d.date} · 0DTE` : `${d.date} · exp ${d.expiry}`,
              }))}
              placeholder="Loading…"
            />
          </Field>

          <Field text="Strike">
            <StrikeInput strikes={strikes} value={strike} onCommit={setStrike} />
          </Field>

          {/* RTH / ETH window. Filters the already-fetched series client-side. */}
          <Field text="Hours">
            <div style={{ display: "inline-flex", gap: 6 }}>
              <button
                onClick={() => setSession("eth")}
                style={{ ...(session === "eth" ? homeButtonStyle : homeSecondaryButtonStyle), ...centeredCtrl }}
                title="Full recorded session, 24h"
              >
                ETH
              </button>
              <button
                onClick={() => setSession("rth")}
                style={{ ...(session === "rth" ? homeButtonStyle : homeSecondaryButtonStyle), ...centeredCtrl }}
                title="Regular trading hours, 09:30–16:00 ET"
              >
                RTH
              </button>
            </div>
          </Field>

          <Field>
            <button
              style={{ ...homeRefreshButtonStyle(refreshState), ...centeredCtrl }}
              onClick={() => void loadSeries()}
              disabled={refreshState === "refreshing"}
            >
              {refreshState === "refreshing" ? "Loading" : "Refresh"}
            </button>
          </Field>

          {stats && (
            <Field>
              <div style={{ height: CTRL_H, display: "flex", alignItems: "center", fontSize: 11.5, color: HOME_THEME.green, opacity: 0.75 }}>
                {view.length} of {stamped.length} snapshots · {stats.first}–{stats.last} ET
                {steps.length > 0 && ` · ${steps.length} OI refresh step${steps.length > 1 ? "s" : ""}`}
                {` · ${skewCount} with IV`}
              </div>
            </Field>
          )}
        </div>

        {err && <div style={{ marginTop: 12, fontSize: 12, color: HOME_THEME.red }}>{err}</div>}

        {stats && (
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 10, marginTop: 16 }}>
            <div style={{ ...statTileStyle, padding: "12px 14px" }}>
              <div style={label}>Current net GEX</div>
              <div style={value}>{fmtM(stats.current)}</div>
              <div style={note}>{stats.last} ET</div>
            </div>
            <div style={{ ...statTileStyle, padding: "12px 14px" }}>
              <div style={label}>Net GEX range</div>
              <div style={value}>{fmtM(stats.lo, 1)} / {fmtM(stats.hi, 1)}</div>
              <div style={note}>low {stats.loAt} · high {stats.hiAt}</div>
            </div>
            <div style={{ ...statTileStyle, padding: "12px 14px" }}>
              <div style={label}>Sign flips</div>
              <div style={value}>{stats.flips}</div>
              <div style={note}>{stats.lo < 0 && stats.hi < 0 ? "short gamma throughout" : stats.lo > 0 && stats.hi > 0 ? "long gamma throughout" : "crosses zero"}</div>
            </div>
            <div style={{ ...statTileStyle, padding: "12px 14px" }}>
              <div style={label}>Vol-weighted build</div>
              <div style={value}>{fmtM(stats.volFirst, 0)} → {fmtM(stats.volLast, 0)}</div>
              <div style={note}>{stats.volFirst && stats.volLast ? `${(stats.volLast / stats.volFirst).toFixed(1)}×` : "—"}</div>
            </div>
            <div style={{ ...statTileStyle, padding: "12px 14px" }}>
              <div style={label}>Skew vs ATM</div>
              <div style={{ ...value, color: stats.skewNow == null ? HOME_THEME.text : stats.skewNow >= 0 ? LIGHT_BLUE : SOFT_RED }}>
                {fmtVp(stats.skewNow)}{stats.skewNow != null && " vp"}
              </div>
              <div style={note}>
                {stats.skewNow == null ? "no IV recorded yet"
                  : `IV ${fmtIv(stats.ivK)} vs ATM ${fmtIv(stats.atmIv)}${stats.atmStrike != null ? ` @ ${stats.atmStrike}` : ""}`}
              </div>
            </div>
            <div style={{ ...statTileStyle, padding: "12px 14px" }}>
              <div style={label}>Spot range</div>
              <div style={value}>{stats.spotLo?.toFixed(2) ?? "—"} – {stats.spotHi?.toFixed(2) ?? "—"}</div>
              <div style={note}>now {stats.spotNow?.toFixed(2) ?? "—"}</div>
            </div>
            {/* Dealer-side summary. Coloured on the SIGN, not the magnitude:
                positive/negative is the whole reading on this series. */}
            <div style={{ ...statTileStyle, padding: "12px 14px" }}>
              <div style={label}>Flow GEX now</div>
              <div style={{ ...value, color: stats.flowNow == null ? HOME_THEME.text : stats.flowNow >= 0 ? LIGHT_BLUE : SOFT_RED }}>
                {fmtM(stats.flowNow, 1)}
              </div>
              <div style={note}>
                {stats.flowNow == null ? "no tape for this session"
                  : `dealer ${fmtSigned(stats.flowCallNet)}c / ${fmtSigned(stats.flowPutNet)}p`}
              </div>
            </div>
          </div>
        )}

        <div style={{ minHeight: 20, marginTop: 14, fontSize: 12, color: HOME_THEME.text, opacity: 0.85, fontVariantNumeric: "tabular-nums" }}>
          {hoverRow ? (
            <>
              <strong>{hoverRow.hhmm} ET</strong>
              {"  ·  spot "}{hoverRow.spot?.toFixed(2) ?? "—"}
              {"  ·  net GEX "}{fmtM(hoverRow.netGex)}
              {"  ·  vol GEX "}{fmtM(hoverRow.netVolGex, 1)}
              {hoverRow.flowGex != null && <>{"  ·  flow GEX "}{fmtM(hoverRow.flowGex, 1)}</>}
              {/* The dealer position itself, in contracts — flow GEX is that
                  number times gamma times spot², so when the line moves this is
                  what moved. Signed dealer-side: + = dealer long. */}
              {hoverRow.flowCallNet != null && hoverRow.flowPutNet != null && (
                <>{"  ·  dealer "}{fmtSigned(hoverRow.flowCallNet)}c / {fmtSigned(hoverRow.flowPutNet)}p</>
              )}
              {"  ·  IV "}{fmtIv(hoverRow.ivK)}
              {"  ·  ATM "}{fmtIv(hoverRow.atmIv)}
              {"  ·  skew "}{fmtVp(hoverRow.skew)}{hoverRow.skew != null && " vp"}
              {hoverRow.skewPct != null && `  (${(hoverRow.skewPct * 100).toFixed(1)}%)`}
            </>
          ) : (
            <span style={{ opacity: 0.55 }}>Hover any chart for a synced reading across all four.</span>
          )}
        </div>
      </Card>

      {!view.length ? (
        <Card variant="classic" padding={24}>
          <div style={{ fontSize: 13, color: HOME_THEME.green, opacity: 0.7, padding: "40px 0", textAlign: "center", lineHeight: 1.7 }}>
            {!strike ? "Pick a session and strike."
              : !stamped.length ? "No snapshots for this strike."
              : <>No RTH snapshots in this session yet — the cash open is 09:30 ET.<br />
                  <span style={{ opacity: 0.75 }}>{stamped.length} overnight snapshots are recorded; switch to ETH to see them.</span></>}
          </div>
        </Card>
      ) : (
        // Locked 2×2 — repeat(2, …) rather than auto-fit, so the grid never
        // reflows to a single column. minmax(0,1fr) (not 1fr) is what stops the
        // SVGs from forcing tracks wider than half the row on narrow viewports.
        <div style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: "clamp(12px, 1.6vw, 28px)" }}>
          <PanelCard
            title={`Net GEX at ${strike}`}
            color={HOME_THEME.cyan}
            subtitle="Stored net_gex. Dashed red = GEX stepped while gamma held flat — an OI refresh, not flow."
          >
            <Panel rows={view} values={view.map((r) => r.netGex)} color={HOME_THEME.cyan}
              fmt={(v) => fmtM(v, 0)} hoverFmt={(v) => fmtM(v, 1)} steps={steps} hover={hover} onHover={setHover} />
          </PanelCard>

          <PanelCard
            title="Net volume-weighted GEX"
            color={HOME_THEME.orange}
            subtitle="net_vol_gex — continuous across OI refreshes, so real intraday accumulation shows here."
          >
            <Panel rows={view} values={view.map((r) => r.netVolGex)} color={HOME_THEME.orange}
              fmt={(v) => fmtM(v, 0)} hoverFmt={(v) => fmtM(v, 1)} steps={[]} hover={hover} onHover={setHover} />
          </PanelCard>

          <PanelCard
            title="IV skew vs ATM"
            color={LIGHT_BLUE}
            subtitle="IV(K) − IV(ATM) in vol points. ATM = strike nearest spot at each snapshot; IV at both is the call/put average."
          >
            {skewCount === 0 ? (
              <div style={{ fontSize: 12.5, color: HOME_THEME.green, opacity: 0.75, padding: "48px 8px", textAlign: "center", lineHeight: 1.7 }}>
                No IV stored for this window.<br />
                <span style={{ opacity: 0.75 }}>
                  call_iv / put_iv began recording when this build deployed — the feed always computed them,
                  the writer just never persisted them. Skew fills in from the next snapshot forward;
                  back-sessions stay blank permanently.
                </span>
              </div>
            ) : (
              <Panel rows={view} values={view.map((r) => r.skew)} color={LIGHT_BLUE}
                fmt={(v) => fmtVp(v, 1)} hoverFmt={(v) => fmtVp(v, 2)} refLine={0} refLabel="flat" steps={[]} hover={hover} onHover={setHover} />
            )}
          </PanelCard>

          {/* Flow GEX replaced the Spot panel here. Spot was the one panel on
              this page that wasn't about the strike you picked — and it's still
              on screen twice (the "Spot range" stat tile and the hover strip),
              so nothing was actually lost. What this shows instead is the only
              dealer-SIGNED series of the four: net GEX is the OI book and
              net_vol_gex is the volume book, but both assume every contract is
              dealer-long-call / short-put. This one asks the tape who actually
              lifted the offer. */}
          <PanelCard
            title="Flow GEX"
            color={HOME_THEME.green}
            subtitle="γ × dealer inventory × spot², from today's classified tape. Above zero = dealers long gamma at this strike; below = short."
          >
            {flowCount === 0 ? (
              <div style={{ fontSize: 12.5, color: HOME_THEME.green, opacity: 0.75, padding: "48px 8px", textAlign: "center", lineHeight: 1.7 }}>
                No tape recorded for this session.<br />
                <span style={{ opacity: 0.75 }}>
                  Flow GEX is rebuilt from flow_prints, which only holds prints from when the tape
                  was running. A blank panel here means the inventory is unknown — not that dealers
                  held nothing, which is why it isn&apos;t drawn as a flat zero.
                </span>
              </div>
            ) : (
              <Panel rows={view} values={view.map((r) => r.flowGex)} color={HOME_THEME.green}
                fmt={(v) => fmtM(v, 0)} hoverFmt={(v) => fmtM(v, 1)} refLine={0} refLabel="flat"
                steps={[]} hover={hover} onHover={setHover} />
            )}
          </PanelCard>
        </div>
      )}
    </PageShell>
  );
}
