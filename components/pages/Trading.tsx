"use client";

/**
 * Trading — Journaling Dashboard.
 *
 * Entries live in Postgres (table: trading_journals) behind /api/journal, scoped
 * to the signed-in user. This replaces the old localStorage key
 * "trading_journals", which was per-browser and didn't survive a device change.
 * A one-time migration lifts any surviving localStorage entries into the DB on
 * first load, then clears the key (see migrateLocal()).
 *
 * Chrome is 100% shared-theme: PageShell + Card + HOME_THEME tokens. The only
 * color literals left are the win/loss + chart series encodings (T.green /
 * T.red), which are data encodings, not chrome — and they're sourced from the
 * theme too.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { HOME_THEME as HT, homeInputStyle, homeButtonStyle, homeSecondaryButtonStyle, LIGHT_BLUE, REFRESH_GREEN, DOCK_THEME } from "@/components/shared/homeTheme";
import { PageShell, Card as ThemeCard } from "@/components/shared/PageCard";
import type { ComponentProps } from "react";

/** Wire shape from /api/journal (snake_case, straight off the row). */
interface JournalRow {
  id: number;
  date: string;        // YYYY-MM-DD
  net_pnl: number;
  trades: number;
  win_rate: number;    // 0-100
  avg_win: number;
  avg_loss: number;
  profit_factor: number;
  commissions: number;
  notes: string | null;
  kind: "manual" | "verified";
}

/** Wire shape from /api/journal/trades — one closed round-trip, derived live
 *  from the persisted fills (symbol, time in/out, price in/out, account). */
interface JournalTrade {
  symbol: string;
  underlying: string;
  asset_type: string;
  direction: "long" | "short";
  open_ts: number;
  close_ts: number;
  date: string;
  qty: number;
  entry: number;
  exit: number;
  fees: number;
  pnl: number;
  account: string;
  open_ext_id: string;
  close_ext_id: string;
}

interface AccountStat {
  account: string;
  sessions: number;
  first_date: string;
  last_date: string;
  trades: number;
  net_pnl: number;
  win_rate: number;
  avg_tit_ms: number;
}

const LS_KEY = "trading_journals";          // legacy localStorage key (migrated once)
const LS_MIGRATED = "trading_journals_migrated";
/** Privacy toggle: when on, real account names are never painted to the screen
 *  (screen-shares / streams). Persisted per-browser — it's a display setting,
 *  not data, so it deliberately does NOT round-trip to the DB. */
const LS_HIDE_ACCT = "trading_hide_accounts";

/** ms → "H:MM:SS" for avg time-in-trade. */
const fmtDur = (ms: number) => {
  if (!ms || ms < 0) return "—";
  const s = Math.round(ms / 1000);
  const hh = Math.floor(s / 3600), mm = Math.floor((s % 3600) / 60), ss = s % 60;
  return `${String(hh).padStart(2, "0")}:${String(mm).padStart(2, "0")}:${String(ss).padStart(2, "0")}`;
};

/** epoch ms → local "YYYY-MM-DDTHH:MM:SS" for a datetime-local input value. */
const toLocalInput = (ts: number) => {
  const d = new Date(ts);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
};
/** datetime-local input value → epoch ms (local time, same as the input picker). */
const fromLocalInput = (v: string) => { const t = new Date(v).getTime(); return Number.isFinite(t) ? t : Date.now(); };

// Data-viz encodings (win/loss cells + chart series). BOTH come from the
// theme — no page-local hex.
//
//   gain → REFRESH_GREEN (#1FD98A), homeTheme's exported "up / success" role
//          color, already the green of every success state in the app.
//   loss → HOME_THEME.red (#EF4444), the theme's red.
//
// Deliberately NOT HOME_THEME.green — that token is a pale BLUE (#8ECAE6,
// shared chrome for other pages) and would read as "gain = blue" here. If the
// dashboard's success green ever changes, this page follows automatically.
const T = { green: REFRESH_GREEN, red: HT.red };

/**
 * hex → rgba. The session heat map and its legend need the SAME two colors at
 * partial alpha; deriving them here means the palette lives in T only, instead
 * of being re-typed as `rgba(31,217,138,…)` literals that drift.
 */
const rgba = (hex: string, a: number) => {
  const h = hex.replace("#", "");
  return `rgba(${parseInt(h.slice(0, 2), 16)},${parseInt(h.slice(2, 4), 16)},${parseInt(h.slice(4, 6), 16)},${a})`;
};

// Secondary text. Full white — hierarchy on this page is carried by SIZE and
// WEIGHT (11px/800 caps labels vs 29px/700 values), not by dimming, so a
// half-opacity gray just made captions hard to read on a dark panel.
const SOFT = HT.text;

/**
 * Card header label — the ONE label style every band on this page uses, for
 * findings, charts, tables and the calendar alike. Full white: hierarchy is
 * carried by size and weight (11px/800 caps label vs 29px/700 value), not by
 * dimming, and the band's own border already separates it from the body.
 */
const cardLabelStyle: React.CSSProperties = {
  fontSize: 11, fontWeight: 800, letterSpacing: ".12em", textTransform: "uppercase", color: SOFT,
};

/**
 * The BANDS. Every card on this page opens with a header strip, holds its
 * content in a body strip, and (for findings) closes with a verdict strip.
 * That shared skeleton is what lets a dozen cards coexist without turning into
 * wallpaper — and it's built from HOME_THEME.border / panelBgStrong only.
 */
const bandHeadStyle: React.CSSProperties = {
  display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10,
  padding: "14px 18px", borderBottom: `1px solid ${HT.border}`, flexShrink: 0,
};
const bandBodyStyle: React.CSSProperties = { padding: "17px 18px" };

/**
 * FOCUS PANES. The page used to stack Leaks, the Clock, eight charts, four
 * tables and a calendar into one scroll — about four screens of simultaneous
 * findings, which is what made it a wall. One pane on screen at a time cuts
 * that to a quarter without hiding anything: every section is one click away
 * and the header totals stay pinned above the nav.
 */
const PANES = [
  { key: "leaks", label: "Leaks" },
  { key: "clock", label: "The clock" },
  { key: "charts", label: "Charts" },
  { key: "journal", label: "Journal" },
] as const;
type PaneKey = (typeof PANES)[number]["key"];

/**
 * Page-local card — the raised surface.
 *
 * Twelve of the shared cards in a 12px grid read as one striped sheet, not as
 * twelve findings. Every card on this page routes through here and keeps the
 * theme's `classic` surface — HOME_THEME.panelBg, HOME_THEME.border, radius 18
 * — with a deeper drop shadow and (via .journal-focus) the hover lift the page
 * otherwise opts out of, so a card reads as an object you can pick out. Band
 * structure — header / body / verdict — comes from bandHeadStyle / insightCard
 * below; this is only the surface.
 *
 * `.journal-focus` is also the hook globals.css uses to re-enable the lift
 * inside .no-card-lift. Modals pass their own "no-card-lift" and are excluded
 * there, so they stay still.
 */
function Card(props: ComponentProps<typeof ThemeCard>) {
  return (
    <ThemeCard
      variant="classic"
      {...props}
      className={`journal-focus${props.className ? ` ${props.className}` : ""}`}
      style={{
        // Fill, radius and edge all come from the theme's `classic` card —
        // this page does NOT invent a surface. The only override is a deeper
        // drop shadow; separation here is the shadow plus 22px gutters, not a
        // different colour.
        boxShadow: "0 24px 48px -20px rgba(0,0,0,0.55)",
        ...props.style,
      }}
    />
  );
}

const btnStyle = (active = false): React.CSSProperties => ({
  ...(active ? homeButtonStyle : homeSecondaryButtonStyle),
  ...(active ? {} : { color: HT.muted }),
});
const inputStyle: React.CSSProperties = {
  ...homeInputStyle,
  width: "100%",
  colorScheme: "dark",
  accentColor: HT.cyan,
};
const labelStyle: React.CSSProperties = {
  fontSize: 12, fontWeight: 700, color: HT.muted, textTransform: "uppercase",
  letterSpacing: ".08em", display: "block", marginBottom: 4,
};
const cellStyle: React.CSSProperties = { padding: "6px 6px", borderBottom: `1px solid ${HT.border}`, fontSize: 14 };

/** Card/section titles: 16px, accent-colored (cyan) so panels read as titled. */
const titleStyle: React.CSSProperties = {
  fontSize: 17, fontWeight: 700, color: HT.cyan, marginBottom: 10,
};
/**
 * Collapsible section headers. The same BAND as every finding card, pulled out
 * to the card edges with a negative margin so it reads as a header strip
 * rather than a line of text floating in the padding. Deliberately NOT the
 * 17px accent title — the three table cards used to be cyan, orange and purple
 * headers sitting side by side, which is three unrelated-looking widgets.
 * They're the same kind of thing, so they get the same neutral band.
 */
const collapseTitleStyle: React.CSSProperties = {
  ...cardLabelStyle,
  display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10,
  margin: "-16px -16px 16px", padding: "14px 16px",
  borderBottom: `1px solid ${HT.border}`, cursor: "pointer",
};
const tableStyle: React.CSSProperties = { width: "100%", fontSize: 14, borderCollapse: "collapse" };

const fmt$ = (v: number) => (v < 0 ? "-" : "") + "$" + Math.abs(v).toFixed(2);
const num = (s: string) => (s.trim() === "" ? 0 : Number(s));

// Day-level only. MAE/MFE are deliberately gone — they're per-trade excursion
// stats and this journal is a day-level record.
const EMPTY_FORM = {
  date: "", netPnl: "", trades: "", winRate: "", avgWin: "", avgLoss: "",
  profitFactor: "", commissions: "", notes: "",
};

/** Preview payload from POST /api/journal/import (commit:false). */
interface ImportPreview {
  broker: string;
  counts: { fills: number; trades: number; days: number };
  days: JournalRow[];
  warnings: string[];
  skipped: number;
}

const BROKER_LABEL: Record<string, string> = {
  tastytrade: "tastytrade", tos: "Thinkorswim / Schwab", ibkr: "Interactive Brokers",
  rithmic: "Rithmic", motivewave: "MotiveWave", tradovate: "Tradovate",
  generic: "Unrecognized format",
};

/** One plotted day. `sub` is the extra context line shown in the tooltip. */
interface Pt { label: string; value: number; sub?: string }

const CH_W = 320, CH_H = 120, CH_PAD = 8;

const emptyChart = (
  <div style={{ height: CH_H, display: "grid", placeItems: "center", color: HT.muted, fontSize: 14 }}>No data yet</div>
);

/**
 * Shared hover tooltip. The SVG scales to the card width, so pointer math is
 * done in PERCENT of the container (not SVG user units) — otherwise the hit
 * index drifts as the card resizes.
 */
function ChartTip({ pt, xPct, fmt }: { pt: Pt; xPct: number; fmt: (v: number) => string }) {
  // Flip the tooltip to the left of the cursor near the right edge so it never
  // clips out of the card.
  const flip = xPct > 62;
  return (
    <div
      style={{
        position: "absolute", top: 4, left: `${xPct}%`,
        transform: flip ? "translateX(-100%) translateX(-10px)" : "translateX(10px)",
        pointerEvents: "none", zIndex: 5,
        background: HT.panelBgStrong ?? "rgba(10,15,20,.95)",
        border: `1px solid ${HT.border}`, borderRadius: 4,
        padding: "6px 9px", whiteSpace: "nowrap",
        boxShadow: "0 4px 14px rgba(0,0,0,.45)",
      }}
    >
      <div style={{ fontSize: 12, color: HT.muted }}>{pt.label}</div>
      <div style={{ fontSize: 14, fontWeight: 700, color: pt.value >= 0 ? T.green : T.red }}>
        {fmt(pt.value)}
      </div>
      {pt.sub && <div style={{ fontSize: 12, color: HT.muted, marginTop: 1 }}>{pt.sub}</div>}
    </div>
  );
}

/** Track the hovered index from a pointer move over the chart box. */
function useHoverIndex(count: number) {
  const [i, setI] = useState<number | null>(null);
  const onMove = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!count) return;
    const r = e.currentTarget.getBoundingClientRect();
    const p = (e.clientX - r.left) / r.width;              // 0..1 across the box
    const idx = Math.round(p * (count - 1));
    setI(Math.min(count - 1, Math.max(0, idx)));
  };
  return { i, onMove, onLeave: () => setI(null) };
}

// ─────────────────────────────────────────────────────────────────────────────
// AXES
//
// These used to be sparklines: a bare series over a zero rule, with the only
// numbers coming from the hover tooltip. That's fine at 320px in a strip of
// eight, and useless once a chart is half a card wide and you want to read a
// level straight off it. Every chart now carries a real Y axis (rounded ticks
// + gridlines) and a real X axis (category labels under the plot).
//
// The plot keeps preserveAspectRatio="none", so anything with TEXT has to be
// HTML rather than <text> — an SVG label would stretch horizontally with the
// box. That constraint buys an exact trick: the viewBox height equals the
// rendered CSS height, so the vertical scale is 1:1 and a tick's y in DATA
// space is literally its `top` in PIXELS. Gridlines are therefore plain divs,
// and they line up with the series to the pixel because both go through the
// same y() the chart already used to place its marks.
// ─────────────────────────────────────────────────────────────────────────────

/** Left gutter reserved for Y labels; strip under the plot for X labels. */
const AXIS_W = 50, AXIS_H = 18;

/**
 * Rounded tick values covering [min,max] on 1 / 2 / 5 × 10ⁿ steps, so an axis
 * reads "$0 · $2.5k · $5k" instead of "$0 · $1,833.27 · $3,666.54".
 */
function niceTicks(min: number, max: number, target = 5): number[] {
  if (!Number.isFinite(min) || !Number.isFinite(max) || max <= min) return [min];
  const raw = (max - min) / Math.max(1, target);
  const mag = Math.pow(10, Math.floor(Math.log10(raw)));
  const n = raw / mag;
  // 2.5 is in the ladder on purpose: without it a 0–14k range snaps straight
  // from a 2k step to a 5k step and the axis collapses to "$0 · $5k · $10k".
  const step = (n <= 1 ? 1 : n <= 2 ? 2 : n <= 2.5 ? 2.5 : n <= 5 ? 5 : 10) * mag;
  const out: number[] = [];
  for (let v = Math.ceil(min / step) * step; v <= max + step * 1e-9; v += step) {
    out.push(Math.abs(v) < step * 1e-9 ? 0 : +v.toPrecision(12));
  }
  return out.length ? out : [min];
}

/** Compact money for an axis — 12500 → "$12.5k". A tick can't be 9 chars wide. */
const fmtAxis$ = (v: number) => {
  const a = Math.abs(v), sign = v < 0 ? "-" : "";
  if (a >= 1000) return `${sign}$${(a / 1000).toFixed(a >= 10000 ? 0 : 1)}k`;
  return `${sign}$${a.toFixed(0)}`;
};

/**
 * Up to `max` evenly spaced X labels, ALWAYS including the last one — the end
 * of the range is the tick you actually want. Sampling on a fixed stride
 * usually stops short of the final point, so the last label is appended; if
 * that lands within 9% of the previous tick the previous one is dropped rather
 * than letting the two overprint each other ("Jul 11Jul 14").
 */
function axisX(labels: string[], w: number, at: (n: number) => number, max = 6) {
  const n = labels.length;
  if (!n) return [];
  const step = Math.max(1, Math.ceil(n / max));
  const out: { pct: number; label: string }[] = [];
  for (let k = 0; k < n; k += step) out.push({ pct: (at(k) / w) * 100, label: labels[k] });
  const lastPct = (at(n - 1) / w) * 100;
  if (out.length && Math.abs(out[out.length - 1].pct - lastPct) < 9) out.pop();
  if (!out.length || out[out.length - 1].label !== labels[n - 1]) {
    out.push({ pct: lastPct, label: labels[n - 1] });
  }
  return out;
}

/**
 * The axis furniture every chart sits in: Y labels in a fixed left gutter,
 * horizontal gridlines behind the plot, X labels in a strip underneath.
 * `children` is the plot itself — the <svg> plus any HTML overlays — and the
 * hover handlers land on the plot column only, so the pointer maths stays
 * measured against the plotting area and not the gutter.
 */
function ChartFrame({
  h, ticks, y, axisFmt, xTicks, onMove, onLeave, children,
}: {
  h: number;
  ticks: number[];
  y: (v: number) => number;
  axisFmt: (v: number) => string;
  xTicks: { pct: number; label: string }[];
  onMove?: (e: React.MouseEvent<HTMLDivElement>) => void;
  onLeave?: () => void;
  children: React.ReactNode;
}) {
  const tickStyle: React.CSSProperties = {
    position: "absolute", fontSize: 9.5, color: HT.muted, whiteSpace: "nowrap",
    fontVariantNumeric: "tabular-nums", pointerEvents: "none", opacity: 0.75,
  };
  return (
    <div style={{ display: "flex", alignItems: "flex-start" }}>
      {/* Y AXIS — its own gutter, so a label never sits on top of the series. */}
      <div style={{ width: AXIS_W, flexShrink: 0, position: "relative", height: h }}>
        {ticks.map((t, n) => (
          <div key={n} style={{ ...tickStyle, top: y(t), right: 7, transform: "translateY(-50%)" }}>
            {axisFmt(t)}
          </div>
        ))}
      </div>

      <div style={{ flex: 1, minWidth: 0 }}>
        {/* PLOT — gridlines are rendered FIRST so the series paints over them. */}
        <div style={{ position: "relative" }} onMouseMove={onMove} onMouseLeave={onLeave}>
          {ticks.map((t, n) => (
            <div key={n} style={{
              position: "absolute", left: 0, right: 0, top: y(t), height: 1,
              background: HT.border, opacity: t === 0 ? 1 : 0.4, pointerEvents: "none",
            }} />
          ))}
          {children}
        </div>
        {/* X AXIS — first label left-aligned and last right-aligned, so neither
            hangs off the edge of the card. */}
        <div style={{ position: "relative", height: AXIS_H, borderTop: `1px solid ${HT.border}` }}>
          {xTicks.map((t, n) => (
            <div key={n} style={{
              ...tickStyle, left: `${t.pct}%`, top: 4,
              transform: n === 0 ? "none"
                : n === xTicks.length - 1 ? "translateX(-100%)" : "translateX(-50%)",
            }}>{t.label}</div>
          ))}
        </div>
      </div>
    </div>
  );
}

function MiniLine({ points, color, fmt = fmt$, axisFmt = fmtAxis$, w = CH_W, h = CH_H }: { points: Pt[]; color: string; fmt?: (v: number) => string; axisFmt?: (v: number) => string; w?: number; h?: number }) {
  const { i, onMove, onLeave } = useHoverIndex(points.length);
  if (points.length < 2) return emptyChart;

  const vals = points.map((p) => p.value);
  const min = Math.min(...vals, 0), max = Math.max(...vals, 0);
  const range = max - min || 1;
  const x = (n: number) => CH_PAD + ((w - 2 * CH_PAD) * n) / (points.length - 1);
  const y = (v: number) => CH_PAD + (h - 2 * CH_PAD) * (1 - (v - min) / range);
  const d = vals.map((v, n) => `${n === 0 ? "M" : "L"}${x(n)},${y(v)}`).join(" ");
  const hoverX = i != null ? (x(i) / w) * 100 : 0;

  return (
    <ChartFrame
      h={h}
      ticks={niceTicks(min, max)}
      y={y}
      axisFmt={axisFmt}
      xTicks={axisX(points.map((pt) => pt.label), w, x)}
      onMove={onMove}
      onLeave={onLeave}
    >
      <svg viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" style={{ width: "100%", height: h, display: "block", cursor: "crosshair" }}>
        {/* The zero rule is now a frame gridline (ticks always include 0). */}
        <path d={d} fill="none" stroke={color} strokeWidth={2} vectorEffect="non-scaling-stroke" />
        {i != null && (
          <>
            <line x1={x(i)} y1={CH_PAD} x2={x(i)} y2={h - CH_PAD} stroke={HT.border} strokeDasharray="3 3" vectorEffect="non-scaling-stroke" />
            <circle cx={x(i)} cy={y(vals[i])} r={3.5} fill={color} stroke={HT.bg} strokeWidth={1.5} vectorEffect="non-scaling-stroke" />
          </>
        )}
      </svg>
      {i != null && <ChartTip pt={points[i]} xPct={hoverX} fmt={fmt} />}
    </ChartFrame>
  );
}

function MiniBars({ points, fmt = fmt$, axisFmt = fmtAxis$, w = CH_W, h = CH_H }: { points: Pt[]; fmt?: (v: number) => string; axisFmt?: (v: number) => string; w?: number; h?: number }) {
  const { i, onMove, onLeave } = useHoverIndex(points.length);
  if (!points.length) return emptyChart;

  const vals = points.map((p) => p.value);
  const maxAbs = Math.max(...vals.map(Math.abs), 1);
  const slot = (w - 2 * CH_PAD) / points.length;
  const bw = Math.max(2, slot - 2);
  const zero = h / 2;
  /** data → px. The SAME mapping the bars use, so ticks line up with them. */
  const y = (v: number) => zero - (v / maxAbs) * (h / 2 - CH_PAD);
  const barX = (n: number) => CH_PAD + n * slot + bw / 2;
  const hoverX = i != null ? (barX(i) / w) * 100 : 0;

  return (
    <ChartFrame
      h={h}
      ticks={niceTicks(-maxAbs, maxAbs)}
      y={y}
      axisFmt={axisFmt}
      xTicks={axisX(points.map((pt) => pt.label), w, barX)}
      onMove={onMove}
      onLeave={onLeave}
    >
      <svg viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" style={{ width: "100%", height: h, display: "block", cursor: "crosshair" }}>
        {vals.map((v, n) => {
          const bh = (Math.abs(v) / maxAbs) * (h / 2 - CH_PAD);
          return (
            <rect key={n}
              x={CH_PAD + n * slot} y={v >= 0 ? zero - bh : zero}
              width={bw} height={bh}
              fill={v >= 0 ? T.green : T.red}
              opacity={i == null || i === n ? 0.9 : 0.4} />
          );
        })}
      </svg>
      {/* Value labels above each bar. Rendered as HTML (not SVG <text>) because
          the chart uses preserveAspectRatio="none", which would stretch text.
          Dropped past ~24 bars: at a 60-day range they overprint each other
          into an unreadable smear, and the Y axis + hover tooltip now cover
          the same job. */}
      {vals.length <= 24 && vals.map((v, n) => {
        const bh = (Math.abs(v) / maxAbs) * (h / 2 - CH_PAD);
        const xPct = ((CH_PAD + n * slot + bw / 2) / w) * 100;
        const tipPct = ((v >= 0 ? zero - bh : zero + bh) / h) * 100;
        return (
          <div key={n}
            style={{
              position: "absolute", left: `${xPct}%`, top: `${tipPct}%`,
              transform: v >= 0 ? "translate(-50%,-115%)" : "translate(-50%,15%)",
              fontSize: 9, fontWeight: 700, whiteSpace: "nowrap", pointerEvents: "none",
              color: v >= 0 ? T.green : T.red, opacity: i == null || i === n ? 1 : 0.4,
            }}>
            {(v < 0 ? "-" : "") + "$" + Math.abs(Math.round(v))}
          </div>
        );
      })}
      {i != null && <ChartTip pt={points[i]} xPct={hoverX} fmt={fmt} />}
    </ChartFrame>
  );
}

/** Bar chart with an always-visible category label under each bar (day-of-week,
 * $ bucket, …) instead of hover-only tooltips — matches how these read best.
 * The label row IS the X axis now, so it lives in ChartFrame rather than being
 * absolutely positioned inside the plot and stealing 14px off the bar height. */
function MiniLabeledBars({ data, w = CH_W, h = CH_H, barColor, axisFmt = fmtAxis$ }: {
  data: { label: string; value: number }[]; fmt?: (v: number) => string; w?: number; h?: number;
  barColor?: (v: number, i: number) => string; axisFmt?: (v: number) => string;
}) {
  if (!data.length) return emptyChart;
  const vals = data.map((d) => d.value);
  const min = Math.min(...vals, 0), max = Math.max(...vals, 0);
  const range = max - min || 1;
  const slot = (w - 2 * CH_PAD) / data.length;
  const bw = Math.max(3, slot - Math.max(4, slot * 0.25));
  // Bars are drawn from y(0) to y(v) rather than from a hardcoded baseline, so
  // an all-negative series (e.g. a losing weekday set) still sits under the
  // zero line instead of being flipped above it.
  const y = (v: number) => CH_PAD + (h - 2 * CH_PAD) * (1 - (v - min) / range);
  const zero = y(0);
  const cx = (n: number) => CH_PAD + n * slot + slot / 2;
  const color = barColor ?? ((v: number) => (v >= 0 ? T.green : T.red));

  return (
    <ChartFrame
      h={h}
      ticks={niceTicks(min, max)}
      y={y}
      axisFmt={axisFmt}
      xTicks={data.map((d, n) => ({ pct: (cx(n) / w) * 100, label: d.label }))}
    >
      <svg viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" style={{ width: "100%", height: h, display: "block" }}>
        {vals.map((v, n) => {
          const top = Math.min(y(v), zero), bot = Math.max(y(v), zero);
          return (
            <rect key={n}
              x={cx(n) - bw / 2} y={top}
              width={bw} height={Math.max(bot - top, 1)}
              fill={color(v, n)} opacity={0.9} rx={1.5} />
          );
        })}
      </svg>
    </ChartFrame>
  );
}

export default function TradingPage() {
  const [journals, setJournals] = useState<JournalRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState("");
  const [showModal, setShowModal] = useState(false);
  const [editId, setEditId] = useState<number | null>(null);
  const [modalErr, setModalErr] = useState("");
  const [calMonth, setCalMonth] = useState(() => { const d = new Date(); return { y: d.getFullYear(), m: d.getMonth() }; });
  const [selectedDay, setSelectedDay] = useState<string | null>(null);
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  /** Which focus pane is on screen. See PANES. */
  const [pane, setPane] = useState<PaneKey>("leaks");

  // CSV import
  const fileRef = useRef<HTMLInputElement>(null);
  const [csvText, setCsvText] = useState("");
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [importErr, setImportErr] = useState("");
  const [importing, setImporting] = useState(false);

  // Modal fields (strings — coerced on save).
  const [f, setF] = useState(EMPTY_FORM);

  // Trade-level detail (symbol, time in/out, price in/out, account) — derived
  // live from the fills a CSV import already persisted. Day-level KPIs above
  // still come from `journals`; this powers the by-account panel and the
  // long/short + time-in-trade stats that only exist at the trade level.
  const [trades, setTrades] = useState<JournalTrade[]>([]);
  const [accounts, setAccounts] = useState<AccountStat[]>([]);
  const [selectedAccount, setSelectedAccount] = useState<string | null>(null);
  // Privacy: mask every account name on screen. State stays keyed on the REAL
  // account string everywhere (filters, edits, API) — only the rendered label
  // is swapped, so toggling it can never change what's selected or saved.
  const [hideAccounts, setHideAccounts] = useState(false);
  // Which chart card is popped out into the bigger modal view, if any.
  const [expandedChart, setExpandedChart] = useState<string | null>(null);

  // Trade edit modal — editing a trade writes an override row (see
  // /api/journal/trades), never the underlying fills, so it can't bleed into
  // a sibling trade that happens to share one of those two fills.
  const [editingTrade, setEditingTrade] = useState<JournalTrade | null>(null);
  const [tradeForm, setTradeForm] = useState({
    symbol: "", account: "", direction: "long" as "long" | "short",
    openLocal: "", closeLocal: "", qty: "", entry: "", exit: "", fees: "",
  });
  const [tradeSaving, setTradeSaving] = useState(false);
  const [tradeModalErr, setTradeModalErr] = useState("");

  // ── Load from the API ────────────────────────────────────────────────────────
  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/journal", { cache: "no-store" });
      if (res.status === 401) { setErr("Sign in to use the journal."); setJournals([]); return; }
      const j = await res.json();
      setJournals(Array.isArray(j.rows) ? j.rows : []);
      setErr("");
    } catch (e) {
      setErr(String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  const loadTrades = useCallback(async () => {
    try {
      const res = await fetch("/api/journal/trades", { cache: "no-store" });
      if (res.status === 401) return;
      const j = await res.json();
      setTrades(Array.isArray(j.trades) ? j.trades : []);
      setAccounts(Array.isArray(j.accounts) ? j.accounts : []);
    } catch { /* trade-level detail is supplementary; day KPIs still work without it */ }
  }, []);

  // ── Trade edit / delete ──────────────────────────────────────────────────────
  const openEditTrade = (t: JournalTrade) => {
    setTradeForm({
      symbol: t.symbol, account: t.account, direction: t.direction,
      openLocal: toLocalInput(t.open_ts), closeLocal: toLocalInput(t.close_ts),
      qty: String(t.qty), entry: String(t.entry), exit: String(t.exit), fees: String(t.fees),
    });
    setTradeModalErr("");
    setEditingTrade(t);
  };

  const saveTrade = async () => {
    if (!editingTrade) return;
    if (!tradeForm.symbol.trim()) { setTradeModalErr("Symbol is required."); return; }
    if (tradeForm.entry.trim() === "" || !Number.isFinite(num(tradeForm.entry))) { setTradeModalErr("Price In must be a number."); return; }
    if (tradeForm.exit.trim() === "" || !Number.isFinite(num(tradeForm.exit))) { setTradeModalErr("Price Out must be a number."); return; }
    setTradeSaving(true);
    try {
      const res = await fetch("/api/journal/trades", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          openExtId: editingTrade.open_ext_id, closeExtId: editingTrade.close_ext_id,
          symbol: tradeForm.symbol, account: tradeForm.account, direction: tradeForm.direction,
          openTs: fromLocalInput(tradeForm.openLocal), closeTs: fromLocalInput(tradeForm.closeLocal),
          qty: num(tradeForm.qty), entry: num(tradeForm.entry), exit: num(tradeForm.exit), fees: num(tradeForm.fees),
        }),
      });
      const j = await res.json();
      if (!res.ok) { setTradeModalErr(j.error || "Save failed."); return; }
      setEditingTrade(null);
      await loadTrades();
    } catch (e) {
      setTradeModalErr(String(e));
    } finally {
      setTradeSaving(false);
    }
  };

  const deleteTrade = async (t: JournalTrade) => {
    const prev = trades;
    setTrades((all) => all.filter((x) => !(x.open_ext_id === t.open_ext_id && x.close_ext_id === t.close_ext_id))); // optimistic
    const res = await fetch(`/api/journal/trades?openExtId=${encodeURIComponent(t.open_ext_id)}&closeExtId=${encodeURIComponent(t.close_ext_id)}`, { method: "DELETE" });
    if (!res.ok) { setTrades(prev); setErr("Delete trade failed."); return; }
    await loadTrades();
  };

  /**
   * One-time lift of legacy localStorage entries into Postgres. Runs before the
   * first load; the key is cleared afterward so it can't double-import. Any
   * entry that fails to POST is left behind by design (we only clear on a clean
   * run) — better a retry next visit than a silent loss.
   */
  const migrateLocal = useCallback(async () => {
    try {
      if (localStorage.getItem(LS_MIGRATED)) return;
      const raw = localStorage.getItem(LS_KEY);
      if (!raw) { localStorage.setItem(LS_MIGRATED, "1"); return; }
      const old = JSON.parse(raw);
      if (!Array.isArray(old) || !old.length) { localStorage.setItem(LS_MIGRATED, "1"); return; }
      let ok = 0;
      for (const o of old) {
        const res = await fetch("/api/journal", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ...o, kind: o.kind === "verified" ? "verified" : "manual" }),
        });
        if (res.ok) ok++;
      }
      if (ok === old.length) {
        localStorage.removeItem(LS_KEY);
        localStorage.setItem(LS_MIGRATED, "1");
      }
    } catch { /* migration is best-effort; never block the page */ }
  }, []);

  useEffect(() => {
    (async () => { await migrateLocal(); await load(); await loadTrades(); })();
  }, [migrateLocal, load, loadTrades]);

  // Restore the account-masking preference after mount (not in useState's
  // initializer — that would read localStorage during SSR/hydration).
  useEffect(() => {
    try { setHideAccounts(localStorage.getItem(LS_HIDE_ACCT) === "1"); } catch { /* private mode */ }
  }, []);

  const toggleHideAccounts = useCallback(() => {
    setHideAccounts((v) => {
      const next = !v;
      try { localStorage.setItem(LS_HIDE_ACCT, next ? "1" : "0"); } catch { /* private mode */ }
      return next;
    });
  }, []);

  // Every entry counts — there's no manual/verified split any more (imported and
  // hand-typed days are the same thing to the stats). The only filter left is a
  // click on a calendar day.
  const visible = useMemo(() => {
    const v = selectedDay ? journals.filter((j) => j.date === selectedDay) : journals;
    return [...v].sort((a, b) => a.date.localeCompare(b.date) || a.id - b.id);
  }, [journals, selectedDay]);

  // ── KPIs ─────────────────────────────────────────────────────────────────────
  const k = useMemo(() => {
    const wins = visible.filter((j) => j.net_pnl > 0);
    const losses = visible.filter((j) => j.net_pnl < 0);
    const totalPnl = visible.reduce((s, j) => s + j.net_pnl, 0);
    const totalTrades = visible.reduce((s, j) => s + j.trades, 0);
    // Trade-level win/loss stats, aggregated from each day's stored per-trade
    // averages (weighted by that day's win/loss counts). Day-level net_pnl can't
    // surface avg loss or profit factor when every journal DAY is green while
    // individual trades still lost — exactly the single-import all-win-day case.
    // Trade-level streaks are reconstructed from each day's win/loss COUNTS in
    // date order (wins-first within a day — the journal stores day aggregates,
    // not per-fill order, so intra-day sequence is assumed).
    let grossWin = 0, grossLoss = 0, winCt = 0, lossCt = 0;
    let bestTW = 0, bestTL = 0, curTW = 0, curTL = 0;
    for (const j of visible) {
      const lc = Math.round(j.trades * (1 - j.win_rate / 100));
      const wc = j.trades - lc;
      winCt += wc; lossCt += lc;
      grossWin += (j.avg_win || 0) * wc;
      grossLoss += Math.abs(j.avg_loss || 0) * lc;
      for (let n = 0; n < wc; n++) { curTW++; curTL = 0; bestTW = Math.max(bestTW, curTW); }
      for (let n = 0; n < lc; n++) { curTL++; curTW = 0; bestTL = Math.max(bestTL, curTL); }
    }
    const avgWin = winCt ? grossWin / winCt : 0;
    const avgLoss = lossCt ? -grossLoss / lossCt : 0;
    const tradeWinPct = winCt + lossCt > 0 ? (winCt / (winCt + lossCt)) * 100 : null;
    // Day streaks
    let bestW = 0, bestL = 0, curW = 0, curL = 0;
    for (const j of visible) {
      if (j.net_pnl > 0) { curW++; curL = 0; } else if (j.net_pnl < 0) { curL++; curW = 0; } else { curW = 0; curL = 0; }
      bestW = Math.max(bestW, curW); bestL = Math.max(bestL, curL);
    }
    // Cumulative + drawdown
    const cum: number[] = [];
    let run = 0;
    for (const j of visible) { run += j.net_pnl; cum.push(run); }
    let peak = -Infinity, maxDD = 0;
    const dd: number[] = cum.map((v) => {
      peak = Math.max(peak, v);
      const d = v - peak;
      maxDD = Math.min(maxDD, d);
      return d;
    });
    const winPct = wins.length + losses.length > 0 ? (wins.length / (wins.length + losses.length)) * 100 : null;

    // Best/worst single day — surfaced separately from the avg win/loss tiles
    // (avg is per-trade, this is per-session).
    const maxGainDay = visible.reduce<JournalRow | null>((best, j) => (!best || j.net_pnl > best.net_pnl ? j : best), null);
    const maxLossDay = visible.reduce<JournalRow | null>((worst, j) => (!worst || j.net_pnl < worst.net_pnl ? j : worst), null);
    const sessions = visible.length;
    const avgTradesPerSession = sessions ? totalTrades / sessions : 0;
    // Per-trade expectancy: $ per trade if the historical win rate/avg win/avg
    // loss holds. Running cumulative version below is what the "Expectancy"
    // chart plots — it should settle toward this number as sessions accumulate.
    const expectancy = winCt + lossCt > 0
      ? (winCt / (winCt + lossCt)) * avgWin + (lossCt / (winCt + lossCt)) * avgLoss
      : null;

    // Cumulative win-rate trend, day by day (what "Win/Loss" plots).
    let rWin = 0, rLoss = 0;
    const winRateSeries = visible.map((j) => {
      if (j.net_pnl > 0) rWin++; else if (j.net_pnl < 0) rLoss++;
      const decided = rWin + rLoss;
      return { label: j.date, value: decided ? (rWin / decided) * 100 : 0, sub: `${rWin}W - ${rLoss}L so far` };
    });

    // Running (cumulative) expectancy per trade, day by day.
    let cGrossWin = 0, cGrossLoss = 0, cWinCt = 0, cLossCt = 0;
    const expectancySeries = visible.map((j) => {
      const lc = Math.round(j.trades * (1 - j.win_rate / 100));
      const wc = j.trades - lc;
      cWinCt += wc; cLossCt += lc;
      cGrossWin += (j.avg_win || 0) * wc;
      cGrossLoss += Math.abs(j.avg_loss || 0) * lc;
      const n = cWinCt + cLossCt;
      const value = n ? (cGrossWin - cGrossLoss) / n : 0;
      return { label: j.date, value, sub: `running avg over ${n} trades` };
    });

    // P&L distribution — day net_pnl bucketed into fixed-width $ ranges.
    const pnls = visible.map((j) => j.net_pnl);
    const distBuckets: { label: string; value: number; positive: boolean }[] = [];
    if (pnls.length) {
      const maxAbs = Math.max(...pnls.map(Math.abs), 1);
      const bucketW = Math.max(25, Math.ceil(maxAbs / 4 / 25) * 25);
      const counts = new Map<number, number>();
      for (const v of pnls) {
        const idx = Math.trunc(v / bucketW) + (v < 0 && v % bucketW !== 0 ? -1 : 0);
        counts.set(idx, (counts.get(idx) ?? 0) + 1);
      }
      const idxs = [...counts.keys()].sort((a, b) => a - b);
      for (const idx of idxs) {
        const lo = idx * bucketW;
        distBuckets.push({ label: `$${lo}`, value: counts.get(idx)!, positive: lo >= 0 });
      }
    }

    // Median P&L by day of week (Sun..Sat), matching the calendar's own week.
    const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
    const byWeekday: number[][] = Array.from({ length: 7 }, () => []);
    for (const j of visible) byWeekday[new Date(`${j.date}T00:00:00`).getDay()].push(j.net_pnl);
    const median = (arr: number[]) => {
      if (!arr.length) return 0;
      const s = [...arr].sort((a, b) => a - b);
      const mid = Math.floor(s.length / 2);
      return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
    };
    const weekdaySeries = WEEKDAYS.map((label, i) => ({ label, value: median(byWeekday[i]) }));

    return {
      wins: wins.length, losses: losses.length, winPct, totalPnl, totalTrades,
      avgWin, avgLoss, bestW, bestL, bestTW, bestTL, winCt, lossCt, tradeWinPct, cum, dd, maxDD,
      pnlPerTrade: totalTrades > 0 ? totalPnl / totalTrades : null,
      maxGainDay, maxLossDay, sessions, avgTradesPerSession, expectancy, distBuckets, weekdaySeries,
      // Profit factor across the whole filtered set: gross wins / gross losses.
      // This replaced the old "capture efficiency" score, which was defined
      // against avg MFE — a per-trade excursion stat the journal no longer keeps.
      profitFactor: grossLoss > 0 ? grossWin / grossLoss : null,
      // Hoverable series — each point carries its date + a context line so the
      // tooltip can say WHY the number is what it is, not just what it is.
      pfSeries: visible.map((j) => ({
        label: j.date,
        value: j.profit_factor,
        sub: `${j.trades} trades · ${j.win_rate.toFixed(0)}% win`,
      })),
      cumSeries: visible.map((j, i) => ({
        label: j.date,
        value: cum[i],
        sub: `day ${j.net_pnl >= 0 ? "+" : ""}${fmt$(j.net_pnl)}`,
      })),
      ddSeries: visible.map((j, i) => ({
        label: j.date,
        value: dd[i],
        sub: dd[i] < 0 ? `below peak of ${fmt$(cum[i] - dd[i])}` : "at equity high",
      })),
      pnlSeries: visible.map((j) => ({
        label: j.date,
        value: j.net_pnl,
        sub: `${j.trades} trades · ${j.win_rate.toFixed(0)}% win · fees ${fmt$(j.commissions)}`,
      })),
      winRateSeries,
      expectancySeries,
    };
  }, [visible]);

  // ── Trade-level: long/short + time-in-trade + by-account ────────────────────
  // Filtered by the same day-click as the day KPIs, plus an optional account
  // filter from the By Account panel.
  const visibleTrades = useMemo(() => {
    let v = trades;
    if (selectedDay) v = v.filter((t) => t.date === selectedDay);
    if (selectedAccount) v = v.filter((t) => (t.account || "Unlabeled") === selectedAccount);
    return v;
  }, [trades, selectedDay, selectedAccount]);

  // ── Account masking ────────────────────────────────────────────────────────
  // Build ONE stable real-name → alias map ("Account 1", "Account 2", …) keyed
  // on the by-account summary order, with any account that only shows up on a
  // trade row appended after it. Stable aliases (rather than a flat "••••")
  // keep the panel readable while masked: you can still tell two accounts
  // apart, sort by them, and click one to filter — you just can't read the
  // broker name off a shared screen.
  const acctAlias = useMemo(() => {
    const m = new Map<string, string>();
    const add = (raw: string) => {
      const label = raw || "Unlabeled";
      if (!m.has(label)) m.set(label, `Account ${m.size + 1}`);
    };
    accounts.forEach((a) => add(a.account));
    trades.forEach((t) => add(t.account));
    return m;
  }, [accounts, trades]);

  /** Render-time only. Never feed the result back into state or the API. */
  const maskAcct = useCallback((raw: string | null | undefined) => {
    const label = raw || "Unlabeled";
    if (!hideAccounts) return label;
    return acctAlias.get(label) ?? "Account •";
  }, [hideAccounts, acctAlias]);

  // ── LEAK FINDERS ───────────────────────────────────────────────────────────
  // Every figure here is derived from the per-trade fills already persisted by
  // a CSV import — no new API, no new columns. The point of this block is that
  // each card compares TWO SLICES OF YOUR OWN TRADES and reports the gap, so
  // the card can end in a sentence instead of a bare number.
  //
  // Scratch trades (pnl === 0) are excluded from every win/loss split: they're
  // neither, and bucketing them either way skews small samples.
  const leaks = useMemo(() => {
    const ts = visibleTrades;
    const wins = ts.filter((t) => t.pnl > 0);
    const losses = ts.filter((t) => t.pnl < 0);
    const sum = (a: JournalTrade[]) => a.reduce((s, t) => s + t.pnl, 0);
    const avg = (a: number[]) => (a.length ? a.reduce((s, v) => s + v, 0) / a.length : 0);
    const dur = (t: JournalTrade) => Math.max(0, t.close_ts - t.open_ts);
    const baseWin = ts.length ? (wins.length / ts.length) * 100 : 0;

    // 1 ── Hold-time asymmetry. The classic leak: winners cut short, losers
    // nursed. Threshold for "held too long" is 2× the average WINNER hold —
    // self-scaling, so it works for a scalper and a swing trader alike.
    const avgWinDur = avg(wins.map(dur));
    const avgLossDur = avg(losses.map(dur));
    const holdRatio = avgWinDur > 0 ? avgLossDur / avgWinDur : 0;
    const longHoldThr = avgWinDur * 2;
    const nursed = longHoldThr > 0 ? losses.filter((t) => dur(t) > longHoldThr) : [];
    // Counterfactual: what the nursed losers cost beyond an average loser.
    const avgLoss = avg(losses.map((t) => t.pnl));
    const nursedExcess = nursed.reduce((s, t) => s + (avgLoss - t.pnl), 0);

    // 2 ── Overtrading curve. Number each trade within its own session by open
    // time, then bucket. This is the card that tells you when to stop.
    const bySession = new Map<string, JournalTrade[]>();
    ts.forEach((t) => {
      const arr = bySession.get(t.date) ?? [];
      arr.push(t); bySession.set(t.date, arr);
    });
    const seqOf = new Map<JournalTrade, number>();
    bySession.forEach((arr) => {
      [...arr].sort((a, b) => a.open_ts - b.open_ts).forEach((t, i) => seqOf.set(t, i + 1));
    });
    const SEQ_BUCKETS: { label: string; lo: number; hi: number }[] = [
      { label: "Trade 1–3", lo: 1, hi: 3 },
      { label: "Trade 4–5", lo: 4, hi: 5 },
      { label: "Trade 6–8", lo: 6, hi: 8 },
      { label: "Trade 9+",  lo: 9, hi: Infinity },
    ];
    const seqRows = SEQ_BUCKETS.map((b) => {
      const g = ts.filter((t) => { const n = seqOf.get(t) ?? 1; return n >= b.lo && n <= b.hi; });
      const w = g.filter((t) => t.pnl > 0).length, l = g.filter((t) => t.pnl < 0).length;
      return { label: b.label, lo: b.lo, ct: g.length, pnl: sum(g), win: w + l ? (w / (w + l)) * 100 : null };
    }).filter((r) => r.ct > 0);
    // First bucket that turns negative = where the edge dies.
    const deadFrom = seqRows.find((r) => r.pnl < 0);
    const pastCut = deadFrom ? ts.filter((t) => (seqOf.get(t) ?? 1) >= deadFrom.lo) : [];

    // 3 ── Revenge trades: opened within 5 minutes of CLOSING a losing trade in
    // the same session. Compared against the baseline win rate, not an absolute.
    const REVENGE_MS = 5 * 60_000;
    const revenge: JournalTrade[] = [];
    bySession.forEach((arr) => {
      const byOpen = [...arr].sort((a, b) => a.open_ts - b.open_ts);
      byOpen.forEach((t) => {
        const priorLoss = arr.some((p) => p !== t && p.pnl < 0 && p.close_ts <= t.open_ts && t.open_ts - p.close_ts <= REVENGE_MS);
        if (priorLoss) revenge.push(t);
      });
    });
    const revWins = revenge.filter((t) => t.pnl > 0).length;
    const revLosses = revenge.filter((t) => t.pnl < 0).length;
    const revWinPct = revWins + revLosses ? (revWins / (revWins + revLosses)) * 100 : null;

    // 4 ── Fee drag. `pnl` is net of fees, so gross adds them back.
    const fees = ts.reduce((s, t) => s + Math.abs(t.fees || 0), 0);
    const net = sum(ts);
    const gross = net + fees;
    const feePct = gross > 0 ? (fees / gross) * 100 : null;

    // 5 ── Loss-cap discipline. The worst five losers vs a typical one, plus the
    // counterfactual net if each had been cut at the average loss instead.
    const worst = [...losses].sort((a, b) => a.pnl - b.pnl).slice(0, 5);
    const worstSum = sum(worst);
    const grossLoss = sum(losses);
    const cappedNet = net + worst.reduce((s, t) => s + (avgLoss - t.pnl), 0);

    // 6 ── Size discipline. Win rate by position size — if it falls as size
    // rises, you're upsizing into your worst reads.
    const SIZE_BUCKETS: { label: string; lo: number; hi: number }[] = [
      { label: "1–2 lots", lo: 1, hi: 2 },
      { label: "3–5 lots", lo: 3, hi: 5 },
      { label: "6+ lots",  lo: 6, hi: Infinity },
    ];
    const sizeRows = SIZE_BUCKETS.map((b) => {
      const g = ts.filter((t) => { const q = Math.abs(t.qty) || 1; return q >= b.lo && q <= b.hi; });
      const w = g.filter((t) => t.pnl > 0).length, l = g.filter((t) => t.pnl < 0).length;
      return { label: b.label, ct: g.length, pnl: sum(g), win: w + l ? (w / (w + l)) * 100 : null };
    }).filter((r) => r.ct > 0);
    const sizeInverted = sizeRows.length > 1
      && sizeRows[0].win != null && sizeRows[sizeRows.length - 1].win != null
      && (sizeRows[sizeRows.length - 1].win as number) < (sizeRows[0].win as number) - 5;

    return {
      n: ts.length, baseWin, avgLoss,
      avgWinDur, avgLossDur, holdRatio, longHoldThr,
      nursedCt: nursed.length, nursedPnl: sum(nursed), nursedExcess,
      seqRows, deadFrom, pastCtLoss: sum(pastCut), pastCt: pastCut.length,
      revCt: revenge.length, revWinPct, revPnl: sum(revenge),
      revShare: ts.length ? (revenge.length / ts.length) * 100 : 0,
      fees, gross, net, feePct, feePerTrade: ts.length ? fees / ts.length : 0,
      worstCt: worst.length, worstSum, grossLoss,
      worstShare: grossLoss < 0 ? (worstSum / grossLoss) * 100 : null,
      cappedNet, sizeRows, sizeInverted,
    };
  }, [visibleTrades]);

  // ── TIME OF DAY ────────────────────────────────────────────────────────────
  // Entry timestamps sliced into 30-minute buckets, plus a weekday × hour grid.
  // Bucketing is on OPEN time in the browser's local zone — the same clock the
  // trader was sitting at, which is the only one that matters for a schedule.
  const tod = useMemo(() => {
    const ts = visibleTrades;
    const slotOf = (t: JournalTrade) => {
      const d = new Date(t.open_ts);
      return d.getHours() * 2 + (d.getMinutes() >= 30 ? 1 : 0);   // 0..47
    };
    const slotLabel = (s: number) =>
      `${String(Math.floor(s / 2)).padStart(2, "0")}:${s % 2 ? "30" : "00"}`;

    const agg = new Map<number, { pnl: number; ct: number; w: number; l: number }>();
    ts.forEach((t) => {
      const s = slotOf(t);
      const a = agg.get(s) ?? { pnl: 0, ct: 0, w: 0, l: 0 };
      a.pnl += t.pnl; a.ct++;
      if (t.pnl > 0) a.w++; else if (t.pnl < 0) a.l++;
      agg.set(s, a);
    });
    // Only render the span that actually has trades, so a futures session and a
    // 9:30–16:00 equity session both come out tight instead of padded with 48
    // empty columns.
    const used = [...agg.keys()].sort((a, b) => a - b);
    const slots = used.length
      ? Array.from({ length: used[used.length - 1] - used[0] + 1 }, (_, i) => used[0] + i)
      : [];
    const buckets = slots.map((s) => {
      const a = agg.get(s) ?? { pnl: 0, ct: 0, w: 0, l: 0 };
      return { slot: s, label: slotLabel(s), pnl: a.pnl, ct: a.ct,
        win: a.w + a.l ? (a.w / (a.w + a.l)) * 100 : null };
    });
    const maxAbs = Math.max(1, ...buckets.map((b) => Math.abs(b.pnl)));
    const net = ts.reduce((s, t) => s + t.pnl, 0);

    // Best single 30-min slot.
    const best = buckets.reduce<typeof buckets[0] | null>((m, b) =>
      b.ct && (!m || b.pnl > m.pnl) ? b : m, null);

    // Worst CONTIGUOUS run (min-subarray sum) — "11:00–13:00" reads better than
    // a single scattered slot, and a two-hour hole is what you actually block.
    let dead: { from: string; to: string; pnl: number; ct: number; w: number; l: number } | null = null;
    if (buckets.length) {
      let bestSum = 0, bestI = -1, bestJ = -1, cur = 0, start = 0;
      buckets.forEach((b, i) => {
        if (cur > 0) { cur = 0; start = i; }
        cur += b.pnl;
        if (cur < bestSum) { bestSum = cur; bestI = start; bestJ = i; }
      });
      if (bestI >= 0) {
        const run = buckets.slice(bestI, bestJ + 1);
        const rt = ts.filter((t) => { const s = slotOf(t); return s >= run[0].slot && s <= run[run.length - 1].slot; });
        dead = {
          from: run[0].label,
          to: slotLabel(run[run.length - 1].slot + 1),
          pnl: bestSum,
          ct: rt.length,
          w: rt.filter((t) => t.pnl > 0).length,
          l: rt.filter((t) => t.pnl < 0).length,
        };
      }
    }

    // Weekday × hour grid. Weekdays only — a Saturday column on an equities
    // journal is dead space, and futures weekend trades are vanishingly rare.
    const hoursUsed = [...new Set(ts.map((t) => new Date(t.open_ts).getHours()))].sort((a, b) => a - b);
    const grid = [1, 2, 3, 4, 5].map((dow) => ({
      dow,
      label: ["", "Mon", "Tue", "Wed", "Thu", "Fri"][dow],
      cells: hoursUsed.map((h) => {
        const g = ts.filter((t) => { const d = new Date(t.open_ts); return d.getDay() === dow && d.getHours() === h; });
        return { hour: h, pnl: g.reduce((s, t) => s + t.pnl, 0), ct: g.length };
      }),
    }));
    const gridMax = Math.max(1, ...grid.flatMap((r) => r.cells.map((c) => Math.abs(c.pnl))));

    // Coarse session blocks — the "you could trade two hours a day" card.
    const blockOf = (t: JournalTrade) => {
      const d = new Date(t.open_ts), m = d.getHours() * 60 + d.getMinutes();
      if (m < 9 * 60 + 30) return "Pre / ETH";
      if (m < 10 * 60 + 30) return "Open hour";
      if (m < 15 * 60) return "Midday";
      if (m < 16 * 60) return "Power hour";
      return "Post / ETH";
    };
    const BLOCK_ORDER = ["Pre / ETH", "Open hour", "Midday", "Power hour", "Post / ETH"];
    const blocks = BLOCK_ORDER.map((label) => {
      const g = ts.filter((t) => blockOf(t) === label);
      return { label, ct: g.length, pnl: g.reduce((s, t) => s + t.pnl, 0) };
    }).filter((b) => b.ct > 0);
    const topTwo = [...blocks].sort((a, b) => b.pnl - a.pnl).slice(0, 2);
    const topTwoPnl = topTwo.reduce((s, b) => s + b.pnl, 0);
    const topTwoShare = net > 0 ? (topTwoPnl / net) * 100 : null;

    return { buckets, maxAbs, net, best, dead, grid, gridMax, hoursUsed, blocks, topTwo, topTwoShare };
  }, [visibleTrades]);

  // ── Calendar ─────────────────────────────────────────────────────────────────
  const calCells = useMemo(() => {
    const first = new Date(calMonth.y, calMonth.m, 1);
    const days = new Date(calMonth.y, calMonth.m + 1, 0).getDate();
    const lead = first.getDay();
    const cells: ({ day: number; date: string; pnl: number | null } | null)[] = Array(lead).fill(null);
    for (let d = 1; d <= days; d++) {
      const date = `${calMonth.y}-${String(calMonth.m + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
      const dayJ = journals.filter((j) => j.date === date);
      cells.push({ day: d, date, pnl: dayJ.length ? dayJ.reduce((s, j) => s + j.net_pnl, 0) : null });
    }
    while (cells.length % 7) cells.push(null);
    return cells;
  }, [calMonth, journals]);

  const monthLabel = new Date(calMonth.y, calMonth.m, 1).toLocaleDateString("en-US", { month: "long", year: "numeric" });

  // ── Actions ──────────────────────────────────────────────────────────────────
  const openNew = () => { setEditId(null); setF(EMPTY_FORM); setModalErr(""); setShowModal(true); };

  const openEdit = (j: JournalRow) => {
    setEditId(j.id);
    setF({
      date: j.date,
      netPnl: String(j.net_pnl), trades: String(j.trades), winRate: String(j.win_rate),
      avgWin: String(j.avg_win), avgLoss: String(j.avg_loss), profitFactor: String(j.profit_factor),
      commissions: String(j.commissions),
      notes: j.notes ?? "",
    });
    setModalErr("");
    setShowModal(true);
  };

  /** Create (POST) or edit (PATCH) — the DB row is the source of truth after. */
  const saveJournal = async () => {
    if (!f.date) { setModalErr("Trading date is required."); return; }
    if (f.netPnl.trim() === "" || !Number.isFinite(num(f.netPnl))) {
      setModalErr("Net P&L is required and must be a number."); return;
    }
    setSaving(true);
    try {
      const payload = {
        ...(editId != null ? { id: editId } : {}),
        date: f.date, netPnl: num(f.netPnl), trades: num(f.trades), winRate: num(f.winRate),
        avgWin: num(f.avgWin), avgLoss: num(f.avgLoss), profitFactor: num(f.profitFactor),
        commissions: num(f.commissions),
        notes: f.notes, kind: "manual",
      };
      const res = await fetch("/api/journal", {
        method: editId != null ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const j = await res.json();
      if (!res.ok) { setModalErr(j.error || "Save failed."); return; }
      const row: JournalRow = j.row;
      setJournals((all) => (editId != null ? all.map((x) => (x.id === row.id ? row : x)) : [...all, row]));
      setF(EMPTY_FORM);
      setEditId(null);
      setModalErr("");
      setShowModal(false);
    } catch (e) {
      setModalErr(String(e));
    } finally {
      setSaving(false);
    }
  };

  const removeJournal = async (id: number) => {
    const prev = journals;
    setJournals((all) => all.filter((x) => x.id !== id));   // optimistic
    const res = await fetch(`/api/journal?id=${id}`, { method: "DELETE" });
    if (!res.ok) { setJournals(prev); setErr("Delete failed."); }
  };

  // ── CSV import ───────────────────────────────────────────────────────────────
  // Two-step by design: the file is parsed server-side and shown back as day
  // rows BEFORE anything is written. Nothing lands in the DB until "Import".

  const onFile = async (file: File | undefined) => {
    if (!file) return;
    setImportErr("");
    setPreview(null);
    const text = await file.text();
    setCsvText(text);
    setImporting(true);
    try {
      const res = await fetch("/api/journal/import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ csv: text, commit: false }),
      });
      const j = await res.json();
      if (!res.ok) { setImportErr(j.error || "Could not read that file."); return; }
      setPreview(j as ImportPreview);
    } catch (e) {
      setImportErr(String(e));
    } finally {
      setImporting(false);
      if (fileRef.current) fileRef.current.value = "";   // allow re-picking the same file
    }
  };

  const commitImport = async () => {
    if (!csvText) return;
    setImporting(true);
    try {
      const res = await fetch("/api/journal/import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ csv: csvText, commit: true }),
      });
      const j = await res.json();
      if (!res.ok) { setImportErr(j.error || "Import failed."); return; }
      setPreview(null);
      setCsvText("");
      await load();                                       // pull the upserted day rows
      await loadTrades();                                 // refresh per-trade + by-account detail
    } catch (e) {
      setImportErr(String(e));
    } finally {
      setImporting(false);
    }
  };

  const exportCSV = () => {
    const header = "date,netPnl,trades,winRate,avgWin,avgLoss,profitFactor,commissions,notes,kind";
    const rows = journals.map((j) =>
      [j.date, j.net_pnl, j.trades, j.win_rate, j.avg_win, j.avg_loss, j.profit_factor,
       j.commissions, JSON.stringify(j.notes ?? ""), j.kind].join(","));
    const blob = new Blob([[header, ...rows].join("\n")], { type: "text/csv" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `trading-journals-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  // ── Chart cards — each one can "pop out" into a bigger modal view ──────────
  // One definition per chart, reused for both the inline mini card and the
  // expanded modal (same series, just a bigger w/h passed to the renderer).
  const chartDefs: Record<string, { title: string; accent: string; value: React.ReactNode; render: (w: number, h: number) => React.ReactNode }> = {
    pf: {
      title: "Profit Factor", accent: HT.cyan,
      value: <span style={{ color: HT.text }}>{k.profitFactor != null ? k.profitFactor.toFixed(2) : "—"}</span>,
      render: (w, h) => <MiniLine points={k.pfSeries} color={HT.cyan} fmt={(v) => (v ? v.toFixed(2) : "—")} axisFmt={(v) => v.toFixed(1)} w={w} h={h} />,
    },
    cum: {
      title: "Cumulative PnL", accent: T.green,
      value: <span style={{ color: k.totalPnl >= 0 ? T.green : T.red }}>{visible.length ? fmt$(k.totalPnl) : "—"}</span>,
      render: (w, h) => <MiniLine points={k.cumSeries} color={T.green} w={w} h={h} />,
    },
    dd: {
      title: "Drawdown (Max)", accent: T.red,
      value: <span style={{ color: T.red }}>{visible.length ? fmt$(k.maxDD) : "—"}</span>,
      render: (w, h) => <MiniLine points={k.ddSeries} color={T.red} w={w} h={h} />,
    },
    pnl: {
      title: "PnL Per Day", accent: HT.orange, value: null,
      render: (w, h) => <MiniBars points={k.pnlSeries} w={w} h={h} />,
    },
    winloss: {
      title: "Win/Loss", accent: T.green,
      value: <span style={{ color: HT.text }}>{k.winPct != null ? `${k.winPct.toFixed(0)}%` : "—"}</span>,
      render: (w, h) => <MiniLine points={k.winRateSeries} color={T.green} fmt={(v) => `${v.toFixed(0)}%`} axisFmt={(v) => `${v.toFixed(0)}%`} w={w} h={h} />,
    },
    expectancy: {
      title: "Expectancy", accent: HT.purple,
      value: <span style={{ color: k.expectancy != null ? (k.expectancy >= 0 ? T.green : T.red) : HT.text }}>{k.expectancy != null ? fmt$(k.expectancy) : "—"}</span>,
      render: (w, h) => <MiniLine points={k.expectancySeries} color={HT.purple} w={w} h={h} />,
    },
    dist: {
      title: "P&L Distribution", accent: HT.cyan, value: null,
      render: (w, h) => (
        <MiniLabeledBars
          w={w} h={h}
          data={k.distBuckets.map((b) => ({ label: b.label, value: b.value }))}
          barColor={(_v, i) => (k.distBuckets[i]?.positive ? T.green : T.red)}
        />
      ),
    },
    weekday: {
      title: "Median PnL vs Day of Week", accent: T.green, value: null,
      render: (w, h) => <MiniLabeledBars w={w} h={h} data={k.weekdaySeries} />,
    },
  };
  const chartOrder = ["pf", "cum", "dd", "pnl", "winloss", "expectancy", "dist", "weekday"];

  const chartCard = (key: string, big = false) => {
    const def = chartDefs[key];
    // The strip used to be 4-across at CH_H (120px); at 2-across the card is
    // roughly twice as wide, and a 120px plot under a real axis reads flat.
    const w = big ? 720 : CH_W, h = big ? 340 : 170;
    return (
      <Card key={key} padding={0} style={big ? { width: "100%" } : undefined}>
        <div style={bandHeadStyle}>
          <div style={{ display: "flex", alignItems: "baseline", gap: 10, minWidth: 0 }}>
            {/* One neutral header, not eight per-chart accent colors. The
                series inside is already colored; coloring the title too made
                the strip look like eight unrelated widgets. */}
            <span style={insightLabelStyle}>{def.title}</span>
            <span style={{ fontSize: 16, fontWeight: 700, letterSpacing: "-.02em" }}>{def.value}</span>
          </div>
          {!big && (
            <button
              onClick={() => setExpandedChart(key)}
              title="Expand"
              style={{ background: "none", border: "none", color: HT.muted, cursor: "pointer", fontSize: 15, padding: "2px 4px", lineHeight: 1 }}
            >⤢</button>
          )}
        </div>
        <div style={bandBodyStyle}>{def.render(w, h)}</div>
      </Card>
    );
  };

  // ── Insight-card primitives ────────────────────────────────────────────────
  // Deliberately UNTINTED: no accent background, no colored rail, no gradient.
  // The card surface is the same flat frosted panel as every other card on the
  // page; the only color in here is data encoding (green = made money, red =
  // lost money) and the verdict line. Color used as decoration makes eight
  // cards look like eight unrelated widgets.
  // Tone is carried by TEXT COLOUR alone — no ⚠ / ✓ glyph. An icon on every
  // card turns the strip into a row of alarms and stops meaning anything.
  // Straight off the theme: red = HOME_THEME.red, warn = HOME_THEME.orange,
  // good = the same success green the gain bars use. No page-local pastels.
  const VERDICT_TONE: Record<string, string> = {
    bad: HT.red, warn: HT.orange, good: T.green, info: SOFT,
  };

  /** Alias — the shared band label, so every card header is literally one style. */
  const insightLabelStyle = cardLabelStyle;

  /**
   * A finding, in three BANDS: header (label + qualifier), body (the numbers),
   * footer (the VERDICT — a sentence saying what the numbers mean). A card
   * without a verdict is the thing we were trying to get away from.
   *
   * The bands are the point. The old card ran label → body → hairline-verdict
   * as one continuous block of padding, so the verdict blended into the body
   * and the card had no visible skeleton. Splitting them with real dividers
   * and giving the verdict its own darker band means every card has the same
   * readable shape, which is what lets twelve of them coexist without turning
   * into wallpaper. Tone is carried by the verdict's TEXT COLOUR alone — no
   * ⚠ / ✓ glyph, since an icon on every card is a row of alarms.
   */
  const insightCard = (
    label: string, right: React.ReactNode, body: React.ReactNode,
    verdict: React.ReactNode, tone: keyof typeof VERDICT_TONE = "info",
    span?: React.CSSProperties,
  ) => {
    const color = VERDICT_TONE[tone] ?? SOFT;
    return (
      <Card padding={0} style={{ display: "flex", flexDirection: "column", minHeight: 200, ...span }}>
        <div style={bandHeadStyle}>
          <span style={cardLabelStyle}>{label}</span>
          {right != null && <span style={{ ...cardLabelStyle, color, letterSpacing: ".1em", whiteSpace: "nowrap" }}>{right}</span>}
        </div>
        <div style={{ ...bandBodyStyle, flex: 1, display: "flex", flexDirection: "column", minHeight: 0 }}>{body}</div>
        <div style={{
          padding: "12px 18px", borderTop: `1px solid ${HT.border}`,
          background: HT.panelBgStrong, borderRadius: "0 0 17px 17px",
          fontSize: 12.5, lineHeight: 1.55, color, flexShrink: 0,
        }}>{verdict}</div>
      </Card>
    );
  };

  /** Label · proportional track · value. The comparison IS the card. */
  const barRow = (label: string, pct: number, value: React.ReactNode, color: string, key?: string) => (
    <div key={key ?? label} style={{ display: "grid", gridTemplateColumns: "78px 1fr auto", alignItems: "center", gap: 9, fontSize: 12 }}>
      <span style={{ color: SOFT, letterSpacing: ".02em" }}>{label}</span>
      <span style={{ height: 9, borderRadius: 5, background: "rgba(255,255,255,0.06)", overflow: "hidden" }}>
        <span style={{ display: "block", height: "100%", width: `${Math.max(0, Math.min(100, pct))}%`, background: color, borderRadius: 5 }} />
      </span>
      <span style={{ textAlign: "right", fontWeight: 700, color, whiteSpace: "nowrap", fontVariantNumeric: "tabular-nums" }}>{value}</span>
    </div>
  );

  const bigVal = (node: React.ReactNode, color?: string) => (
    <div style={{ fontSize: 29, fontWeight: 700, lineHeight: 1.04, letterSpacing: "-.025em", color: color ?? HT.text, fontVariantNumeric: "tabular-nums" }}>{node}</div>
  );
  const subLine = (node: React.ReactNode) => (
    <div style={{ fontSize: 11.5, color: SOFT, lineHeight: 1.5, marginTop: 5 }}>{node}</div>
  );
  const pillRow = (items: React.ReactNode[]) => (
    <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 10 }}>
      {items.map((n, i) => (
        <span key={i} style={{
          fontSize: 10.5, fontWeight: 700, padding: "3px 8px", borderRadius: 999,
          background: "rgba(255,255,255,0.05)", border: `1px solid ${HT.border}`, color: SOFT,
        }}>{n}</span>
      ))}
    </div>
  );
  const strong = (node: React.ReactNode, color: string = HT.text) => (
    <span style={{ color, fontWeight: 700 }}>{node}</span>
  );
  const pctOf = (v: number, max: number) => (max > 0 ? (Math.abs(v) / max) * 100 : 0);
  const winTxt = (w: number | null) => (w == null ? "—" : `${w.toFixed(0)}%`);

  return (
    <PageShell className="journal-root no-card-lift">
      {/* Header */}
      <Card padding="14px 20px" style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <div style={{ fontSize: 17, fontWeight: 700, color: HT.cyan }}>Journaling Dashboard</div>
        {/* Core totals live INLINE in the header, not as cards. They're
            reference figures, not findings — spending four KPI cards on
            "Net PnL / Sessions / Trades / Win %" is what made the strip
            feel like a receipt. The cards below are the findings. */}
        <div style={{ display: "flex", alignItems: "center", gap: 18, flexWrap: "wrap" }}>
          {([
            ["Net P&L", visible.length ? fmt$(k.totalPnl) : "—", k.totalPnl >= 0 ? T.green : T.red],
            ["Sessions", String(k.sessions || 0), HT.text],
            ["Trades", String(k.totalTrades || 0), HT.text],
            ["Day win", k.winPct != null ? `${k.winPct.toFixed(0)}%` : "—", HT.text],
            ["Per trade", k.pnlPerTrade != null ? fmt$(k.pnlPerTrade) : "—", k.pnlPerTrade != null && k.pnlPerTrade >= 0 ? T.green : T.red],
          ] as [string, string, string][]).map(([lab, val, col]) => (
            <div key={lab} style={{ display: "flex", flexDirection: "column", lineHeight: 1.2 }}>
              <span style={{ fontSize: 9.5, fontWeight: 800, letterSpacing: ".1em", textTransform: "uppercase", color: SOFT }}>{lab}</span>
              <span style={{ fontSize: 15, fontWeight: 700, color: col, fontVariantNumeric: "tabular-nums" }}>{val}</span>
            </div>
          ))}
          {err && <span style={{ fontSize: 14, color: T.red }}>{err}</span>}
          <span style={{ fontSize: 12, color: SOFT }}>
            {loading ? "Loading…" : `${journals.length} saved`}
          </span>
        </div>
      </Card>

      <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
        {/* Toolbar */}
        <div className="journal-toolbar" style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            {selectedDay && (
              <button style={btnStyle()} onClick={() => setSelectedDay(null)}>Day: {selectedDay} ✕</button>
            )}
            {selectedAccount && (
              <button style={btnStyle()} onClick={() => setSelectedAccount(null)}>Account: {maskAcct(selectedAccount)} ✕</button>
            )}
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <input
              ref={fileRef} type="file" accept=".csv,text/csv" style={{ display: "none" }}
              onChange={(e) => onFile(e.target.files?.[0])}
            />
            <button style={btnStyle()} onClick={() => fileRef.current?.click()} disabled={importing}>
              {importing ? "Reading…" : "Import Broker CSV"}
            </button>
            <button style={btnStyle()} onClick={exportCSV}>Export CSV</button>
            {/* Privacy toggle — masks every account name on the page. Display
                only; filters and saved data keep the real names. */}
            <button
              style={btnStyle(hideAccounts)}
              onClick={toggleHideAccounts}
              title={hideAccounts ? "Account names are hidden — click to show" : "Hide account names (for screen shares)"}
              aria-pressed={hideAccounts}
            >
              {hideAccounts ? "🙈 Accounts Hidden" : "👁 Hide Accounts"}
            </button>
            <button style={btnStyle(true)} onClick={openNew}>+ New Journal</button>
          </div>
        </div>

        {importErr && (
          <Card padding={12} style={{ fontSize: 14, color: T.red }}>{importErr}</Card>
        )}

        {/* ── FOCUS NAV ────────────────────────────────────────────────
            One section on screen at a time. Nothing is hidden — every pane
            is one click away and the header totals stay pinned above, so
            you never lose the figure you were comparing against. */}
        {/* Chrome is DOCK_THEME — the same frosted-tile language as the
            toolbar menus and NavMenu, so the pane switcher looks like part of
            the app rather than a control invented for this page. */}
        <div className="journal-nav" style={{
          display: "flex", gap: 4, padding: 5, borderRadius: 12,
          border: `1px solid ${HT.border}`, background: HT.panelBgStrong,
          width: "fit-content",
        }}>
          {PANES.map((p) => {
            const on = pane === p.key;
            return (
              <button
                key={p.key}
                onClick={() => setPane(p.key)}
                aria-pressed={on}
                style={{
                  padding: "8px 17px", borderRadius: 8, cursor: "pointer",
                  fontSize: 12.5, fontWeight: 700, transition: "all .15s", whiteSpace: "nowrap",
                  border: `1px solid ${on ? DOCK_THEME.activeBorder : "transparent"}`,
                  background: on ? DOCK_THEME.activeTile : "transparent",
                  boxShadow: on ? DOCK_THEME.activeGlow : "none",
                  color: on ? HT.cyan : HT.muted,
                }}
              >{p.label}</button>
            );
          })}
        </div>

        {/* ── FINDINGS, not figures ──────────────────────────────────
            Replaces the old nine-bare-number KPI strip. Every card below
            compares two slices of the same trades and closes with a verdict
            sentence. Card surfaces are intentionally untinted — see
            insightCard(). Sourced from per-trade fills, so it only appears
            once a broker CSV has been imported. */}
        {leaks.n === 0 && (pane === "leaks" || pane === "clock") ? (
          <Card padding={16}>
            <div style={insightLabelStyle}><span>Findings</span></div>
            <div style={{ fontSize: 13, color: SOFT, marginTop: 10, lineHeight: 1.6, maxWidth: 640 }}>
              No per-trade detail yet. Import a broker CSV and this fills with hold-time asymmetry,
              your overtrading curve, revenge-trade cost, fee drag, and a session heat map — all
              derived from the fills, no extra setup.
            </div>
          </Card>
        ) : null}

        {/* ── PANE · LEAKS ─────────────────────────────────────────────
            Gutters are 22px, not 12. At 12 the cards touched and the grid
            read as one striped sheet; the gap is what makes each card an
            object rather than a cell. */}
        {leaks.n > 0 && pane === "leaks" && (
          <div className="journal-kpis" style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(330px, 1fr))", gap: 22 }}>

              {/* Hold-time asymmetry */}
              {insightCard("Hold-time asymmetry",
                leaks.holdRatio ? `${leaks.holdRatio.toFixed(1)}×` : null,
                <>
                  {bigVal(<>{fmtDur(leaks.avgLossDur)} <span style={{ fontSize: ".45em", color: SOFT, fontWeight: 600 }}>avg loser</span></>)}
                  <div style={{ display: "flex", flexDirection: "column", gap: 7, marginTop: 12 }}>
                    {barRow("Winners", pctOf(leaks.avgWinDur, Math.max(leaks.avgWinDur, leaks.avgLossDur)), fmtDur(leaks.avgWinDur), T.green)}
                    {barRow("Losers", pctOf(leaks.avgLossDur, Math.max(leaks.avgWinDur, leaks.avgLossDur)), fmtDur(leaks.avgLossDur), T.red)}
                  </div>
                  {pillRow([<>&gt;{fmtDur(leaks.longHoldThr)} {strong(fmt$(leaks.nursedPnl), T.red)}</>, <>{leaks.nursedCt} trades</>])}
                </>,
                leaks.holdRatio > 1.4
                  ? <>Cutting the {leaks.nursedCt} long-held losers: {strong(fmt$(leaks.nursedExcess), T.green)}</>
                  : <>Hold times are symmetric.</>,
                leaks.holdRatio > 1.4 ? "bad" : "good")}

              {/* Overtrading curve */}
              {insightCard("Overtrading curve",
                leaks.deadFrom ? `edge dies at #${leaks.deadFrom.lo}` : "holds up",
                <>
                  <div style={{ display: "flex", flexDirection: "column", gap: 7 }}>
                    {leaks.seqRows.map((r) => barRow(
                      r.label,
                      pctOf(r.pnl, Math.max(...leaks.seqRows.map((x) => Math.abs(x.pnl)), 1)),
                      <>{winTxt(r.win)} · {fmt$(r.pnl)}</>,
                      r.pnl >= 0 ? T.green : T.red, r.label))}
                  </div>
                  {pillRow([<>{leaks.pastCt} past the cut</>])}
                </>,
                leaks.deadFrom && leaks.pastCtLoss < 0
                  ? <>Hard stop at {leaks.deadFrom.lo - 1} trades: {strong(fmt$(-leaks.pastCtLoss), T.green)}</>
                  : leaks.deadFrom
                    ? <>First red bucket at #{leaks.deadFrom.lo}, but the tail recovers.</>
                    : <>Every bucket profitable.</>,
                leaks.deadFrom && leaks.pastCtLoss < 0 ? "bad" : leaks.deadFrom ? "warn" : "good")}

              {/* Revenge trades */}
              {insightCard("Revenge trades", "<5 min after a loss",
                <>
                  {bigVal(winTxt(leaks.revWinPct), leaks.revWinPct != null && leaks.revWinPct < leaks.baseWin ? T.red : T.green)}
                  {subLine(<>{leaks.revCt} trades re-entered within 5 min of a loss</>)}
                  <div style={{ display: "flex", flexDirection: "column", gap: 7, marginTop: 12 }}>
                    {barRow("Baseline", leaks.baseWin, `${leaks.baseWin.toFixed(0)}%`, T.green)}
                    {barRow("Revenge", leaks.revWinPct ?? 0, winTxt(leaks.revWinPct), (leaks.revWinPct ?? 0) < leaks.baseWin ? T.red : T.green)}
                  </div>
                  {pillRow([<>Net {strong(fmt$(leaks.revPnl), leaks.revPnl >= 0 ? T.green : T.red)}</>, <>{leaks.revShare.toFixed(0)}% of trades</>])}
                </>,
                leaks.revCt === 0
                  ? <>No quick re-entries. Discipline already there.</>
                  : leaks.revPnl < 0
                    ? <>A 5-minute cooldown after a loss: {strong(fmt$(-leaks.revPnl), T.green)}</>
                    : <>Quick re-entries aren&apos;t costing you.</>,
                leaks.revCt === 0 ? "good" : leaks.revPnl < 0 ? "bad" : "info")}

              {/* Fee drag */}
              {insightCard("Fee drag",
                leaks.feePct != null ? `${leaks.feePct.toFixed(1)}% of gross` : null,
                <>
                  <div style={{ display: "flex", flexDirection: "column", gap: 7 }}>
                    {barRow("Gross", 100, fmt$(leaks.gross), LIGHT_BLUE)}
                    {barRow("Fees", pctOf(leaks.fees, Math.max(leaks.gross, 1)), fmt$(-leaks.fees), HT.orange)}
                    {barRow("Net", pctOf(leaks.net, Math.max(leaks.gross, 1)), fmt$(leaks.net), leaks.net >= 0 ? T.green : T.red)}
                  </div>
                  {pillRow([<>{fmt$(leaks.feePerTrade)} / trade</>, <>{leaks.n} trades</>])}
                </>,
                leaks.feePct == null
                  ? <>No commission data on the fills.</>
                  : leaks.feePct > 10
                    ? <>One dollar in {Math.round(100 / leaks.feePct)} goes to fees.</>
                    : <>Fees aren&apos;t the leak.</>,
                leaks.feePct != null && leaks.feePct > 10 ? "warn" : "info")}

              {/* Loss-cap discipline */}
              {insightCard("Loss-cap discipline", `${leaks.worstCt} outliers`,
                <>
                  {bigVal(fmt$(leaks.worstSum), T.red)}
                  {subLine(<>worst {leaks.worstCt} · {strong(leaks.avgLoss ? `${(leaks.worstCt ? (leaks.worstSum / leaks.worstCt) / leaks.avgLoss : 0).toFixed(1)}×` : "—")} the {fmt$(leaks.avgLoss)} average</>)}
                  <div style={{ display: "flex", flexDirection: "column", gap: 7, marginTop: 12 }}>
                    {barRow("Avg loss", pctOf(leaks.avgLoss, Math.abs(leaks.worstCt ? leaks.worstSum / leaks.worstCt : 1)), fmt$(leaks.avgLoss), LIGHT_BLUE)}
                    {barRow("Worst avg", 100, fmt$(leaks.worstCt ? leaks.worstSum / leaks.worstCt : 0), T.red)}
                  </div>
                  {pillRow([
                    <>{leaks.n ? ((leaks.worstCt / leaks.n) * 100).toFixed(1) : "0"}% of trades</>,
                    <>{leaks.worstShare != null ? `${leaks.worstShare.toFixed(0)}% of gross losses` : "—"}</>,
                  ])}
                </>,
                leaks.worstShare != null && leaks.worstShare > 25
                  ? <>Cap those {leaks.worstCt} and net goes {strong(fmt$(leaks.cappedNet), T.green)}</>
                  : <>No outlier losses. Stops are working.</>,
                leaks.worstShare != null && leaks.worstShare > 25 ? "bad" : "good")}

              {/* Size discipline */}
              {insightCard("Size discipline", leaks.sizeInverted ? "inverted" : "aligned",
                <>
                  <div style={{ display: "flex", flexDirection: "column", gap: 7 }}>
                    {leaks.sizeRows.map((r) => barRow(
                      r.label,
                      r.win ?? 0,
                      <>{winTxt(r.win)} · {fmt$(r.pnl)}</>,
                      r.pnl >= 0 ? T.green : T.red, r.label))}
                  </div>
                  {subLine(leaks.sizeInverted ? "Win rate falls as size rises." : "Win rate holds as size rises.")}
                </>,
                leaks.sizeRows.length < 2
                  ? <>One size only — nothing to compare.</>
                  : leaks.sizeInverted
                    ? <>Biggest size, worst win rate.</>
                    : <>Size and conviction aligned.</>,
                leaks.sizeRows.length < 2 ? "info" : leaks.sizeInverted ? "bad" : "good")}
          </div>
        )}

        {/* ── PANE · THE CLOCK ─────────────────────────────────────── */}
        {leaks.n > 0 && pane === "clock" && (
          <div className="journal-tod" style={{ display: "grid", gridTemplateColumns: "2fr 1fr", gap: 22 }}>

              {/* Session P&L by 30 min */}
              {insightCard("Session P&L by 30 min", `${tod.buckets.length ? tod.buckets[0].label : ""}–${tod.buckets.length ? tod.buckets[tod.buckets.length - 1].label : ""}`,
                // Columns stretch to whatever height the card ends up at (the
                // right-hand stack usually sets it), so the strip fills the
                // card instead of floating in dead space. Bar heights are % of
                // the flex-sized region, not fixed px, for the same reason.
                <div style={{ flex: 1, display: "flex", gap: 3, alignItems: "stretch", minHeight: 230 }}>
                  {tod.buckets.map((b) => {
                    const pos = b.pnl >= 0;
                    const h = `${Math.max(b.ct ? 2 : 0, pctOf(b.pnl, tod.maxAbs))}%`;
                    return (
                      <div key={b.slot} title={`${b.label} · ${b.ct} trades · ${fmt$(b.pnl)}`}
                        style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", alignItems: "center", gap: 4 }}>
                        <div style={{ flex: "1 1 0", minHeight: 40, display: "flex", alignItems: "flex-end", width: "100%" }}>
                          {pos && <div style={{ width: "100%", height: h, borderRadius: "3px 3px 0 0", background: T.green }} />}
                        </div>
                        <div style={{ height: 1, width: "100%", background: HT.border }} />
                        <div style={{ flex: "0 0 auto", height: 58, display: "flex", alignItems: "flex-start", width: "100%" }}>
                          {!pos && <div style={{ width: "100%", height: h, borderRadius: "0 0 3px 3px", background: T.red }} />}
                        </div>
                        <div style={{ fontSize: 9, color: SOFT, whiteSpace: "nowrap", opacity: .8 }}>{b.label}</div>
                        <div style={{ fontSize: 10, fontWeight: 700, whiteSpace: "nowrap", color: pos ? T.green : T.red, fontVariantNumeric: "tabular-nums" }}>
                          {b.ct ? `${b.pnl >= 0 ? "+" : "-"}${Math.abs(b.pnl) >= 1000 ? `${(Math.abs(b.pnl) / 1000).toFixed(1)}k` : Math.abs(b.pnl).toFixed(0)}` : "·"}
                        </div>
                        {/* Volume + hit rate per slot: a fat green bar built on
                            three trades is not the same finding as one built
                            on forty, and the strip should say which it is. */}
                        <div style={{ fontSize: 9, color: SOFT, whiteSpace: "nowrap", opacity: .7, fontVariantNumeric: "tabular-nums" }}>
                          {b.ct ? `${b.ct}t` : ""}
                        </div>
                        <div style={{ fontSize: 9, fontWeight: 700, whiteSpace: "nowrap", opacity: .85, fontVariantNumeric: "tabular-nums",
                          color: b.win == null ? SOFT : b.win >= 50 ? T.green : T.red }}>
                          {b.win != null ? `${b.win.toFixed(0)}%` : ""}
                        </div>
                      </div>
                    );
                  })}
                </div>,
                tod.best && tod.dead
                  ? <>Best half hour {strong(tod.best.label)} at {strong(fmt$(tod.best.pnl), T.green)} · worst run {strong(`${tod.dead.from}–${tod.dead.to}`)} at {strong(fmt$(tod.dead.pnl), T.red)}</>
                  : <>Not enough spread to call a pattern yet.</>,
                "info")}

              <div style={{ display: "grid", gap: 22 }}>
                {/* Best window */}
                {insightCard("Best window", tod.best ? tod.best.label : null,
                  <>
                    {bigVal(tod.best ? fmt$(tod.best.pnl) : "—", tod.best && tod.best.pnl >= 0 ? T.green : T.red)}
                    {subLine(tod.best
                      ? <>{tod.net > 0 ? `${((tod.best.pnl / tod.net) * 100).toFixed(0)}% of net P&L in 30 minutes · ` : ""}{tod.best.ct} trades · {winTxt(tod.best.win)} win</>
                      : "No trades yet")}
                  </>,
                  tod.best && tod.best.ct
                    ? <>Per-trade in this window is {strong(fmt$(tod.best.pnl / tod.best.ct), T.green)} vs {strong(fmt$(leaks.n ? leaks.net / leaks.n : 0))} all-day.</>
                    : <>—</>,
                  "good")}

                {/* Dead zone */}
                {insightCard("Dead zone", tod.dead ? `${tod.dead.from}–${tod.dead.to}` : null,
                  <>
                    {bigVal(tod.dead ? fmt$(tod.dead.pnl) : "—", T.red)}
                    {subLine(tod.dead
                      ? <>{tod.dead.ct} trades · {tod.dead.w + tod.dead.l ? `${((tod.dead.w / (tod.dead.w + tod.dead.l)) * 100).toFixed(0)}%` : "—"} win · {leaks.n ? ((tod.dead.ct / leaks.n) * 100).toFixed(0) : 0}% of all trades taken, for negative P&L</>
                      : "No losing window")}
                  </>,
                  tod.dead
                    ? <>{leaks.n && tod.dead.ct / leaks.n > 0.15
                        ? <>{((tod.dead.ct / leaks.n) * 100).toFixed(0)}% of your trades happen in the only window that loses money. Blocking it is free money.</>
                        : <>A small, contained hole — worth avoiding but it isn&apos;t the main leak.</>}</>
                    : <>No contiguous losing window — your P&L is spread evenly across the session.</>,
                  tod.dead ? "bad" : "good")}
              </div>

              {/* Weekday x hour */}
              {insightCard("Weekday × hour", "net $ per cell",
                <>
                  <table style={{ borderCollapse: "separate", borderSpacing: 3, width: "100%" }}>
                    <thead>
                      <tr>
                        <th />
                        {tod.hoursUsed.map((h) => (
                          <th key={h} style={{ fontSize: 10, color: SOFT, fontWeight: 700, letterSpacing: ".06em", paddingBottom: 3 }}>
                            {h}:00
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {tod.grid.map((r) => (
                        <tr key={r.dow}>
                          <td style={{ fontSize: 10, color: SOFT, fontWeight: 700, textAlign: "right", paddingRight: 6, width: 34 }}>{r.label}</td>
                          {r.cells.map((c) => {
                            const a = Math.min(Math.abs(c.pnl) / tod.gridMax, 1);
                            const bg = !c.ct ? "rgba(255,255,255,0.03)"
                              : c.pnl >= 0 ? rgba(T.green, +(0.12 + a * 0.6).toFixed(2))
                              : rgba(T.red, +(0.12 + a * 0.6).toFixed(2));
                            return (
                              <td key={c.hour} title={`${r.label} ${c.hour}:00 · ${c.ct} trades · ${fmt$(c.pnl)}`}
                                style={{ height: 24, borderRadius: 4, background: bg, textAlign: "center", fontSize: 10, fontWeight: 700, color: c.ct ? "rgba(255,255,255,0.85)" : SOFT, fontVariantNumeric: "tabular-nums" }}>
                                {c.ct ? Math.round(c.pnl) : ""}
                              </td>
                            );
                          })}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  <div style={{ display: "flex", alignItems: "center", gap: 7, fontSize: 10, color: SOFT, marginTop: 9 }}>
                    <span style={{ width: 15, height: 9, borderRadius: 2, background: rgba(T.red, 0.7) }} />loss
                    <span style={{ width: 15, height: 9, borderRadius: 2, background: "rgba(255,255,255,.1)" }} />flat
                    <span style={{ width: 15, height: 9, borderRadius: 2, background: rgba(T.green, 0.7) }} />gain
                  </div>
                </>,
                <>Read down a column, not across a row — a hole that repeats every weekday is structural; one red cell is a single bad session.</>,
                "info")}

              {/* Session blocks */}
              {insightCard("Where the day pays",
                tod.topTwoShare != null ? `top 2 = ${tod.topTwoShare.toFixed(0)}%` : null,
                <>
                  <div style={{ display: "flex", flexDirection: "column", gap: 7 }}>
                    {tod.blocks.map((b) => barRow(
                      b.label,
                      pctOf(b.pnl, Math.max(...tod.blocks.map((x) => Math.abs(x.pnl)), 1)),
                      fmt$(b.pnl), b.pnl >= 0 ? T.green : T.red, b.label))}
                  </div>
                  {pillRow(tod.blocks.map((b) => <>{b.label} {strong(String(b.ct))} trades</>))}
                </>,
                tod.topTwoShare != null && tod.topTwo.length === 2
                  ? <>{tod.topTwoShare.toFixed(0)}% of your net lands in {strong(tod.topTwo[0].label)} and {strong(tod.topTwo[1].label)}. You could trade those two blocks and keep most of the money.</>
                  : <>Not enough session spread to call it yet.</>,
                "good")}
          </div>
        )}

        {/* ── PANE · CHARTS ────────────────────────────────────────────
            2-across, not 4. Four minis per row meant eight charts on screen
            at 320px each — none of them readable. Two per row at ~2× the
            width is the same eight charts, one scroll, actually legible.
            Still a FIXED column count (not auto-fit) so the last, partial
            row keeps the same card width as every other row. ⤢ pops any of
            them out bigger. */}
        {pane === "charts" && (
          <div className="journal-charts" style={{ display: "grid", gridTemplateColumns: "repeat(2, 1fr)", gap: 22 }}>
            {chartOrder.map((key) => chartCard(key))}
          </div>
        )}

        {/* ── PANE · JOURNAL — the tables + the calendar ─────────────── */}
        {pane === "journal" && (
          <>
            <div className="journal-tables" style={{ display: "grid", gridTemplateColumns: "1fr 1fr 2fr", gap: 22 }}>
              <Card padding={16}>
                <div
                  onClick={() => setCollapsed((c) => ({ ...c, accounts: !c.accounts }))}
                  style={collapseTitleStyle}
                >
                  <span>By Account{selectedAccount ? ` — ${maskAcct(selectedAccount)} ✕` : ""}</span><span>{collapsed.accounts ? "▶" : "▼"}</span>
                </div>
                {!collapsed.accounts && (
                  accounts.length ? (
                    <table style={tableStyle}>
                      <thead>
                        <tr>
                          {["Account", "Sessions", "Trades", "Net P&L", "Win %"].map((h) => (
                            <th key={h} style={{ textAlign: h === "Account" ? "left" : "right", fontSize: 12, color: HT.muted, textTransform: "uppercase", padding: "4px 6px", borderBottom: `1px solid ${HT.border}` }}>{h}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {accounts.map((a) => {
                          const label = a.account || "Unlabeled";
                          const active = selectedAccount === label;
                          return (
                            <tr
                              key={label}
                              onClick={() => setSelectedAccount(active ? null : label)}
                              style={{ cursor: "pointer", background: active ? `${HT.cyan}14` : "transparent" }}
                            >
                              <td style={{ ...cellStyle, color: active ? HT.cyan : HT.text, fontWeight: active ? 700 : 400 }}>{maskAcct(label)}</td>
                              <td style={{ ...cellStyle, color: HT.text, textAlign: "right" }}>{a.sessions}</td>
                              <td style={{ ...cellStyle, color: HT.text, textAlign: "right" }}>{a.trades}</td>
                              <td style={{ ...cellStyle, color: a.net_pnl >= 0 ? T.green : T.red, textAlign: "right", fontWeight: 700 }}>{fmt$(a.net_pnl)}</td>
                              <td style={{ ...cellStyle, color: HT.text, textAlign: "right" }}>{a.win_rate.toFixed(0)}%</td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  ) : (
                    <div style={{ padding: 12, color: HT.muted, fontSize: 13 }}>
                      No account column found on the imported CSV yet — every trade is grouped as one account.
                    </div>
                  )
                )}
              </Card>

              <Card padding={16}>
                <div
                  onClick={() => setCollapsed((c) => ({ ...c, targets: !c.targets }))}
                  style={collapseTitleStyle}
                >
                  <span>Session vs Targets</span><span>{collapsed.targets ? "▶" : "▼"}</span>
                </div>
                {!collapsed.targets && (
                  <table style={tableStyle}>
                    <tbody>
                      {[
                        ["Avg Win", k.avgWin ? fmt$(k.avgWin) : "—"],
                        ["Avg Loss", k.avgLoss ? fmt$(k.avgLoss) : "—"],
                        ["Profit Factor", k.profitFactor != null ? k.profitFactor.toFixed(2) : "—"],
                        ["Commissions", visible.length ? fmt$(visible.reduce((s, j) => s + j.commissions, 0)) : "—"],
                        ["Win Ratio", k.winPct != null ? `${k.winPct.toFixed(1)}%` : "—"],
                      ].map(([l, v], i, arr) => (
                        <tr key={l as string}>
                          <td style={{ color: HT.muted, padding: "7px 0", borderBottom: i < arr.length - 1 ? `1px solid ${HT.border}` : "none" }}>{l}</td>
                          <td style={{ textAlign: "right", color: HT.text, borderBottom: i < arr.length - 1 ? `1px solid ${HT.border}` : "none" }}>{v}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </Card>

              <Card padding={16}>
                <div
                  onClick={() => setCollapsed((c) => ({ ...c, log: !c.log }))}
                  style={collapseTitleStyle}
                >
                  <span>Journal Log ({visible.length} entries)</span><span>{collapsed.log ? "▶" : "▼"}</span>
                </div>
                {!collapsed.log && (
                  <div style={{ maxHeight: 280, overflowY: "auto" }}>
                    <table style={tableStyle}>
                      <thead>
                        <tr>
                          {["Date", "Net P&L", "Cum P&L", "Trades", "Win %", "Result", ""].map((h) => (
                            <th key={h} style={{ textAlign: "left", fontSize: 12, color: HT.muted, textTransform: "uppercase", padding: "4px 6px", borderBottom: `1px solid ${HT.border}` }}>{h}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {visible.map((j, i) => (
                          <tr key={j.id}>
                            <td style={{ ...cellStyle, color: HT.text }}>{j.date}</td>
                            <td style={{ ...cellStyle, color: j.net_pnl >= 0 ? T.green : T.red }}>{fmt$(j.net_pnl)}</td>
                            <td style={{ ...cellStyle, color: k.cum[i] >= 0 ? T.green : T.red }}>{fmt$(k.cum[i])}</td>
                            <td style={{ ...cellStyle, color: HT.text }}>{j.trades}</td>
                            <td style={{ ...cellStyle, color: HT.text }}>{j.win_rate ? `${j.win_rate}%` : "—"}</td>
                            <td style={{ ...cellStyle, color: j.net_pnl >= 0 ? T.green : T.red, fontWeight: 700 }}>
                              {j.net_pnl >= 0 ? "WIN" : "LOSS"}
                            </td>
                            <td style={{ ...cellStyle, textAlign: "right", whiteSpace: "nowrap" }}>
                              <button style={{ ...btnStyle(), padding: "3px 9px", fontSize: 12, marginRight: 4 }}
                                onClick={() => openEdit(j)}>Edit</button>
                              <button style={{ ...btnStyle(), padding: "3px 9px", fontSize: 12 }}
                                onClick={() => removeJournal(j.id)}>✕</button>
                            </td>
                          </tr>
                        ))}
                        {!visible.length && (
                          <tr><td colSpan={7} style={{ padding: 16, color: HT.muted, textAlign: "center", fontSize: 14 }}>
                            {loading ? "Loading…" : "No journal entries yet — click + New Journal."}
                          </td></tr>
                        )}
                      </tbody>
                    </table>
                  </div>
                )}
              </Card>
            </div>

            {/* Trade-level detail — symbol, time in/out, price in/out, direction,
                account. Populated from the fills a CSV import already saved. */}
            <Card padding={16}>
              <div
                onClick={() => setCollapsed((c) => ({ ...c, trades: !c.trades }))}
                style={collapseTitleStyle}
              >
                <span>Trades ({visibleTrades.length})</span><span>{collapsed.trades ? "▶" : "▼"}</span>
              </div>
              {!collapsed.trades && (
                visibleTrades.length ? (
                  <div style={{ maxHeight: 320, overflowY: "auto" }}>
                    <table style={tableStyle}>
                      <thead>
                        <tr>
                          {["Date", "Symbol", "Side", "Account", "Time In", "Time Out", "Price In", "Price Out", "Qty", "P&L", ""].map((h) => (
                            <th key={h} style={{ textAlign: "left", fontSize: 12, color: HT.muted, textTransform: "uppercase", padding: "4px 6px", borderBottom: `1px solid ${HT.border}` }}>{h}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {[...visibleTrades].sort((a, b) => b.close_ts - a.close_ts).slice(0, 300).map((t, i) => (
                          <tr key={`${t.open_ext_id}-${t.close_ext_id}-${i}`}>
                            <td style={{ ...cellStyle, color: HT.text }}>{t.date}</td>
                            <td style={{ ...cellStyle, color: HT.text }}>{t.symbol}</td>
                            <td style={{ ...cellStyle, color: t.direction === "long" ? T.green : T.red }}>{t.direction === "long" ? "Long" : "Short"}</td>
                            <td style={{ ...cellStyle, color: HT.muted }}>{t.account ? maskAcct(t.account) : "—"}</td>
                            <td style={{ ...cellStyle, color: HT.muted, whiteSpace: "nowrap" }}>{new Date(t.open_ts).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</td>
                            <td style={{ ...cellStyle, color: HT.muted, whiteSpace: "nowrap" }}>{new Date(t.close_ts).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</td>
                            <td style={{ ...cellStyle, color: HT.text }}>{t.entry.toFixed(2)}</td>
                            <td style={{ ...cellStyle, color: HT.text }}>{t.exit.toFixed(2)}</td>
                            <td style={{ ...cellStyle, color: HT.text }}>{t.qty}</td>
                            <td style={{ ...cellStyle, color: t.pnl >= 0 ? T.green : T.red, fontWeight: 700 }}>{fmt$(t.pnl)}</td>
                            <td style={{ ...cellStyle, textAlign: "right", whiteSpace: "nowrap" }}>
                              <button style={{ ...btnStyle(), padding: "3px 9px", fontSize: 12, marginRight: 4 }}
                                onClick={() => openEditTrade(t)}>Edit</button>
                              <button style={{ ...btnStyle(), padding: "3px 9px", fontSize: 12 }}
                                onClick={() => deleteTrade(t)}>✕</button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                    {visibleTrades.length > 300 && (
                      <div style={{ fontSize: 12, color: HT.muted, padding: "8px 4px" }}>Showing the most recent 300 of {visibleTrades.length} trades.</div>
                    )}
                  </div>
                ) : (
                  <div style={{ padding: 12, color: HT.muted, fontSize: 13 }}>
                    No per-trade detail yet — import a broker CSV to populate symbol / time in-out / price in-out per trade.
                  </div>
                )
              )}
            </Card>

            {/* Calendar */}
            <Card padding={16}>
              <div style={{ ...collapseTitleStyle, cursor: "default" }}>
                <span>Session Calendar</span>
                <div style={{ display: "flex", alignItems: "center", gap: 16, color: SOFT, fontSize: 14 }}>
                  <span style={{ cursor: "pointer" }} onClick={() => setCalMonth((c) => ({ y: c.m === 0 ? c.y - 1 : c.y, m: c.m === 0 ? 11 : c.m - 1 }))}>&lt;</span>
                  <strong style={{ color: HT.text }}>{monthLabel}</strong>
                  <span style={{ cursor: "pointer" }} onClick={() => setCalMonth((c) => ({ y: c.m === 11 ? c.y + 1 : c.y, m: c.m === 11 ? 0 : c.m + 1 }))}>&gt;</span>
                </div>
              </div>
              <div className="journal-cal" style={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)", gap: 4 }}>
                {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((d) => (
                  <div key={d} style={{ fontSize: 12, color: HT.muted, textAlign: "center", padding: 4, textTransform: "uppercase" }}>{d}</div>
                ))}
                {calCells.map((c, i) => c ? (
                  <div key={i}
                    onClick={() => setSelectedDay(selectedDay === c.date ? null : c.date)}
                    style={{
                      minHeight: 52, border: `1px solid ${selectedDay === c.date ? HT.cyan : HT.border}`,
                      borderRadius: 4, padding: 6, cursor: "pointer",
                      background: c.pnl != null ? (c.pnl >= 0 ? `${T.green}14` : `${T.red}14`) : "transparent",
                    }}>
                    <div style={{ fontSize: 14, color: HT.muted }}>{c.day}</div>
                    {c.pnl != null && (
                      <div style={{ fontSize: 12, fontWeight: 700, color: c.pnl >= 0 ? T.green : T.red }}>{fmt$(c.pnl)}</div>
                    )}
                  </div>
                ) : <div key={i} style={{ minHeight: 52 }} />)}
              </div>
            </Card>
          </>
        )}
      </div>

      {/* CSV IMPORT PREVIEW — nothing is written until "Import" is clicked */}
      {preview && (
        <div
          style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,.7)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1000, backdropFilter: "blur(4px)" }}
          onClick={() => setPreview(null)}
        >
          <Card className="no-card-lift" padding={20} style={{ maxWidth: 760, width: "95vw" }}>
            <div onClick={(e) => e.stopPropagation()}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14, paddingBottom: 10, borderBottom: `1px solid ${HT.border}` }}>
                <div style={{ ...titleStyle, marginBottom: 0 }}>
                  Import Preview — {BROKER_LABEL[preview.broker] ?? preview.broker}
                </div>
                <button onClick={() => setPreview(null)} style={{ background: "none", border: "none", fontSize: 20, color: HT.muted, cursor: "pointer" }}>×</button>
              </div>

              <div style={{ fontSize: 14, color: HT.muted, marginBottom: 12 }}>
                {preview.counts.fills} fills → {preview.counts.trades} closed trades →{" "}
                <span style={{ color: HT.text }}>{preview.counts.days} journal days</span>.
                Stats are recomputed from the executions, not read from the broker&apos;s summary.
              </div>

              {preview.warnings.map((w, i) => (
                <div key={i} style={{ fontSize: 14, color: HT.orange, marginBottom: 8 }}>⚠ {w}</div>
              ))}

              <div style={{ maxHeight: 300, overflowY: "auto", marginTop: 8 }}>
                <table style={tableStyle}>
                  <thead>
                    <tr>
                      {["Date", "Net P&L", "Trades", "Win %", "Avg Win", "Avg Loss", "PF", "Fees"].map((h) => (
                        <th key={h} style={{ textAlign: "left", fontSize: 12, color: HT.muted, textTransform: "uppercase", padding: "4px 6px", borderBottom: `1px solid ${HT.border}` }}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {preview.days.map((d) => (
                      <tr key={d.date}>
                        <td style={{ ...cellStyle, color: HT.text }}>{d.date}</td>
                        <td style={{ ...cellStyle, color: d.net_pnl >= 0 ? T.green : T.red, fontWeight: 700 }}>{fmt$(d.net_pnl)}</td>
                        <td style={{ ...cellStyle, color: HT.text }}>{d.trades}</td>
                        <td style={{ ...cellStyle, color: HT.text }}>{d.win_rate.toFixed(0)}%</td>
                        <td style={{ ...cellStyle, color: T.green }}>{d.avg_win ? fmt$(d.avg_win) : "—"}</td>
                        <td style={{ ...cellStyle, color: T.red }}>{d.avg_loss ? fmt$(d.avg_loss) : "—"}</td>
                        <td style={{ ...cellStyle, color: HT.text }}>{d.profit_factor ? d.profit_factor.toFixed(2) : "—"}</td>
                        <td style={{ ...cellStyle, color: HT.muted }}>{fmt$(d.commissions)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <div style={{ fontSize: 12, color: HT.muted, marginTop: 10 }}>
                Existing days with the same date are overwritten (your notes are kept).
                Re-importing the same statement is safe — duplicate fills are ignored.
              </div>

              <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 16, paddingTop: 12, borderTop: `1px solid ${HT.border}` }}>
                <button style={btnStyle()} onClick={() => setPreview(null)} disabled={importing}>Cancel</button>
                <button style={btnStyle(true)} onClick={commitImport} disabled={importing}>
                  {importing ? "Importing…" : `Import ${preview.counts.days} Days`}
                </button>
              </div>
            </div>
          </Card>
        </div>
      )}

      {/* EXPANDED CHART — pop-out view of whichever card's ⤢ was clicked */}
      {expandedChart && chartDefs[expandedChart] && (
        <div
          style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,.7)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1000, backdropFilter: "blur(4px)" }}
          onClick={() => setExpandedChart(null)}
        >
          <Card className="no-card-lift" padding={20} style={{ maxWidth: 800, width: "95vw" }}>
            <div onClick={(e) => e.stopPropagation()}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14, paddingBottom: 10, borderBottom: `1px solid ${HT.border}` }}>
                <div style={{ ...titleStyle, marginBottom: 0, color: chartDefs[expandedChart].accent }}>
                  {chartDefs[expandedChart].title} {chartDefs[expandedChart].value}
                </div>
                <button onClick={() => setExpandedChart(null)} style={{ background: "none", border: "none", fontSize: 20, color: HT.muted, cursor: "pointer" }}>×</button>
              </div>
              {chartDefs[expandedChart].render(720, 340)}
            </div>
          </Card>
        </div>
      )}

      {/* EDIT TRADE MODAL — writes an override, never the underlying fills */}
      {editingTrade && (
        <div
          style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,.7)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1000, backdropFilter: "blur(4px)" }}
          onClick={() => setEditingTrade(null)}
        >
          <Card className="no-card-lift" padding={20} style={{ maxWidth: 520, width: "95vw" }}>
            <div onClick={(e) => e.stopPropagation()}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16, paddingBottom: 10, borderBottom: `1px solid ${HT.border}` }}>
                <div style={{ ...titleStyle, marginBottom: 0 }}>Edit Trade</div>
                <button onClick={() => setEditingTrade(null)} style={{ background: "none", border: "none", fontSize: 20, color: HT.muted, cursor: "pointer" }}>×</button>
              </div>

              <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                <div className="journal-form-3" style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8 }}>
                  <div><label style={labelStyle}>Symbol</label><input style={inputStyle} value={tradeForm.symbol} onChange={(e) => setTradeForm({ ...tradeForm, symbol: e.target.value })} /></div>
                  <div>
                    <label style={labelStyle}>Side</label>
                    <select style={inputStyle} value={tradeForm.direction} onChange={(e) => setTradeForm({ ...tradeForm, direction: e.target.value === "short" ? "short" : "long" })}>
                      <option value="long">Long</option>
                      <option value="short">Short</option>
                    </select>
                  </div>
                  {/* While masked, show the alias read-only rather than the real
                      name — editing the account is the one thing you can't do
                      with accounts hidden, by design. tradeForm.account still
                      holds the real value, so saving is unaffected. */}
                  <div><label style={labelStyle}>Account</label><input
                    style={{ ...inputStyle, ...(hideAccounts ? { opacity: .6, cursor: "not-allowed" } : null) }}
                    readOnly={hideAccounts}
                    title={hideAccounts ? "Unhide accounts to edit this field" : undefined}
                    value={hideAccounts ? maskAcct(tradeForm.account) : tradeForm.account}
                    onChange={(e) => { if (!hideAccounts) setTradeForm({ ...tradeForm, account: e.target.value }); }} /></div>
                </div>
                <div className="journal-form-3" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
                  <div><label style={labelStyle}>Time In</label><input type="datetime-local" step="1" style={inputStyle} value={tradeForm.openLocal} onChange={(e) => setTradeForm({ ...tradeForm, openLocal: e.target.value })} /></div>
                  <div><label style={labelStyle}>Time Out</label><input type="datetime-local" step="1" style={inputStyle} value={tradeForm.closeLocal} onChange={(e) => setTradeForm({ ...tradeForm, closeLocal: e.target.value })} /></div>
                </div>
                <div className="journal-form-3" style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr 1fr", gap: 8 }}>
                  <div><label style={labelStyle}>Price In</label><input type="number" step="0.01" style={inputStyle} value={tradeForm.entry} onChange={(e) => setTradeForm({ ...tradeForm, entry: e.target.value })} /></div>
                  <div><label style={labelStyle}>Price Out</label><input type="number" step="0.01" style={inputStyle} value={tradeForm.exit} onChange={(e) => setTradeForm({ ...tradeForm, exit: e.target.value })} /></div>
                  <div><label style={labelStyle}>Qty</label><input type="number" step="1" min="1" style={inputStyle} value={tradeForm.qty} onChange={(e) => setTradeForm({ ...tradeForm, qty: e.target.value })} /></div>
                  <div><label style={labelStyle}>Fees ($)</label><input type="number" step="0.01" style={inputStyle} value={tradeForm.fees} onChange={(e) => setTradeForm({ ...tradeForm, fees: e.target.value })} /></div>
                </div>
                <div style={{ fontSize: 12, color: HT.muted }}>
                  P&L recalculates from Price In/Out × Qty × the contract's point value, minus Fees.
                </div>
              </div>

              {tradeModalErr && <div style={{ fontSize: 14, color: T.red, marginTop: 8 }}>{tradeModalErr}</div>}

              <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 16, paddingTop: 12, borderTop: `1px solid ${HT.border}` }}>
                <button style={btnStyle()} onClick={() => setEditingTrade(null)} disabled={tradeSaving}>Cancel</button>
                <button style={btnStyle(true)} onClick={saveTrade} disabled={tradeSaving}>
                  {tradeSaving ? "Saving…" : "Save Changes"}
                </button>
              </div>
            </div>
          </Card>
        </div>
      )}

      {/* NEW / EDIT JOURNAL MODAL */}
      {showModal && (
        <div
          style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,.7)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1000, backdropFilter: "blur(4px)" }}
          onClick={() => setShowModal(false)}
        >
          <Card
            className="no-card-lift journal-modal"
            padding={20}
            style={{ maxWidth: 520, width: "95vw" }}
          >
            <div onClick={(e) => e.stopPropagation()}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16, paddingBottom: 10, borderBottom: `1px solid ${HT.border}` }}>
                <div style={{ ...titleStyle, marginBottom: 0 }}>
                  {editId != null ? "Edit Journal Entry" : "New Journal Entry"}
                </div>
                <button onClick={() => setShowModal(false)} style={{ background: "none", border: "none", fontSize: 20, color: HT.muted, cursor: "pointer" }}>×</button>
              </div>

              <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                <div>
                  <label style={labelStyle}>Trading Date</label>
                  <input type="date" style={inputStyle} value={f.date} onChange={(e) => setF({ ...f, date: e.target.value })} />
                </div>
                <div className="journal-form-3" style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8 }}>
                  <div><label style={labelStyle}>Net P&L ($)</label><input type="number" step="0.01" placeholder="e.g. 312.50" style={inputStyle} value={f.netPnl} onChange={(e) => setF({ ...f, netPnl: e.target.value })} /></div>
                  <div><label style={labelStyle}>Total Trades</label><input type="number" step="1" min="0" placeholder="e.g. 8" style={inputStyle} value={f.trades} onChange={(e) => setF({ ...f, trades: e.target.value })} /></div>
                  <div><label style={labelStyle}>Win Rate (%)</label><input type="number" step="0.1" min="0" max="100" placeholder="e.g. 62.5" style={inputStyle} value={f.winRate} onChange={(e) => setF({ ...f, winRate: e.target.value })} /></div>
                </div>
                <div className="journal-form-3" style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8 }}>
                  <div><label style={labelStyle}>Avg Win ($)</label><input type="number" step="0.01" placeholder="e.g. 187.00" style={inputStyle} value={f.avgWin} onChange={(e) => setF({ ...f, avgWin: e.target.value })} /></div>
                  <div><label style={labelStyle}>Avg Loss ($)</label><input type="number" step="0.01" placeholder="e.g. -95.00" style={inputStyle} value={f.avgLoss} onChange={(e) => setF({ ...f, avgLoss: e.target.value })} /></div>
                  <div><label style={labelStyle}>Profit Factor</label><input type="number" step="0.01" min="0" placeholder="e.g. 1.87" style={inputStyle} value={f.profitFactor} onChange={(e) => setF({ ...f, profitFactor: e.target.value })} /></div>
                </div>
                <div style={{ display: "grid", gridTemplateColumns: "1fr", gap: 8 }}>
                  <div><label style={labelStyle}>Commissions ($)</label><input type="number" step="0.01" placeholder="e.g. -24.00" style={inputStyle} value={f.commissions} onChange={(e) => setF({ ...f, commissions: e.target.value })} /></div>
                </div>
                <div>
                  <label style={labelStyle}>Notes</label>
                  <textarea rows={2} placeholder="Market conditions, key trades, observations…" style={{ ...inputStyle, resize: "vertical", minHeight: 48 }} value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} />
                </div>
              </div>

              {modalErr && <div style={{ fontSize: 14, color: T.red, marginTop: 8 }}>{modalErr}</div>}

              <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 16, paddingTop: 12, borderTop: `1px solid ${HT.border}` }}>
                <button style={btnStyle()} onClick={() => setShowModal(false)} disabled={saving}>Cancel</button>
                <button style={btnStyle(true)} onClick={saveJournal} disabled={saving}>
                  {saving ? "Saving…" : editId != null ? "Save Changes" : "Save Entry"}
                </button>
              </div>
            </div>
          </Card>
        </div>
      )}
    </PageShell>
  );
}
