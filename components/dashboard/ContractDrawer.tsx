"use client";

// ─────────────────────────────────────────────────────────────────────────────
// ContractDrawer — the /flow tape's in-place whale expansion (variant D).
//
// Clicking a whale row (premium ≥ WHALE_FLOOR) expands this drawer directly
// underneath it, rather than opening a modal: the tape stays on screen, so you
// can compare the print you're inspecting against the ones around it.
//
// Contents:
//   • contract price line (/proxy/option-history), fill / peak / trough guides,
//     traded volume in its own pane at the bottom
//   • since-fill tracking — the print's price vs current / peak / trough
//   • Vol/OI and IV·%OTM tiles, fed live from useContractStats
//
// Both timeframes are anchored to the alert — Today (its session) and All (its
// session → now) — and both are intraday. There is deliberately no 30D/90D:
// history from before the order printed says nothing about how the order did,
// and it drags the price axis until the interesting part is a flat line.
//
// Theme: HOME_THEME only — no color literals beyond the true-green buy accent
// (HOME_THEME.green is a light blue).
// ─────────────────────────────────────────────────────────────────────────────

import { useEffect, useMemo, useRef, useState } from "react";
import { HOME_THEME, DOCK_THEME } from "@/components/shared/homeTheme";
import type { FlowOrder } from "@/hooks/useSpxFlow";
import type { ContractStat } from "@/hooks/useContractStats";

const C = HOME_THEME;
const BULL = "#22c55e";
const BEAR = C.red;

export interface Bar {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume?: number;
}

// Only two timeframes, both anchored to the print:
//   today = the alert's own session
//   all   = the alert's session → now
// There is deliberately no 30D/90D: history from before the order printed can't
// say anything about how the order did, and it drags the price axis to a scale
// that flattens the part you're actually looking at.
type TF = "today" | "all";
const TFS: { id: TF; label: string }[] = [
  { id: "today", label: "Today" },
  { id: "all", label: "All" },
];

function fmtUsd(v: number): string {
  const a = Math.abs(v);
  if (a >= 1_000_000) return `$${(v / 1_000_000).toFixed(2)}M`;
  if (a >= 1_000) return `$${(v / 1_000).toFixed(1)}K`;
  return `$${v.toFixed(2)}`;
}
function fmtPct(v: number): string {
  return `${v >= 0 ? "+" : ""}${v.toFixed(1)}%`;
}
function fmtNum(v: number | null | undefined): string {
  return v == null || !Number.isFinite(v) ? "—" : v.toLocaleString();
}

export interface ContractDrawerProps {
  order: FlowOrder;
  /** Normalized underlying root (SPXW → SPX) — the API's chainTicker key. */
  ticker: string;
  stat: ContractStat | null;
  /** Live underlying spot, for the % OTM readout. 0 = not loaded yet. */
  liveSpot: number;
  onClose: () => void;
}

const etDate = (ms: number) => new Date(ms).toLocaleDateString("en-CA", { timeZone: "America/New_York" });

export default function ContractDrawer({ order, ticker, stat, liveSpot, onClose }: ContractDrawerProps) {
  const [tf, setTf] = useState<TF>("today");
  const [bars, setBars] = useState<Bar[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  // The fill we're tracking: this print's own option price.
  const fillPrice = Number(order.price) || 0;

  // The alert's session — the anchor for BOTH timeframes. Note this is the
  // print's own date, not literally today: a tape loaded for a past date must
  // chart that date's session.
  const fillDate = etDate(order.ts);
  const todayEt = etDate(Date.now());
  // With a same-day print the two timeframes are identical, so don't offer All.
  const sameDay = fillDate === todayEt;

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setErr(null);
    const params = new URLSearchParams({
      ticker,
      expiry: order.expiration ?? "",
      strike: String(order.strike),
      type: order.type,
      start: fillDate,
      end: tf === "today" ? fillDate : todayEt,
    });
    fetch(`/proxy/option-history?${params}`)
      // The route puts the upstream Theta message in `error` on a 502 — surface
      // it instead of a bare "HTTP 502", which says nothing about what broke.
      .then(async (r) => {
        const j = await r.json().catch(() => null);
        if (!r.ok) throw new Error(j?.error ? String(j.error).slice(0, 160) : `HTTP ${r.status}`);
        return j;
      })
      .then((j) => {
        if (cancelled) return;
        setBars(Array.isArray(j?.bars) ? j.bars : []);
        setLoading(false);
      })
      .catch((e) => {
        if (cancelled) return;
        setErr(String(e?.message || e));
        setBars([]);
        setLoading(false);
      });
    return () => { cancelled = true; };
  }, [ticker, order.expiration, order.strike, order.type, fillDate, todayEt, tf]);

  // ── Since-fill: current / peak / trough over bars AT OR AFTER the print.
  //
  // Both timeframes start AT the alert, so the series can't contain pre-order
  // history — but it can still contain the part of the session before the print
  // landed, so the >= fill-time filter stays. If nothing is at/after the fill
  // (an alert in the last bar of the day), fall back to the latest close and
  // flag it rather than reporting a peak that predates the order.
  const track = useMemo(() => {
    if (!bars.length || !(fillPrice > 0)) return null;
    const after = bars.filter((b) => b.time >= order.ts - 60_000);
    const noPostFill = !after.length;
    const scope = noPostFill ? bars.slice(-1) : after;
    let peak = -Infinity, trough = Infinity;
    for (const b of scope) {
      peak = Math.max(peak, b.high ?? b.close);
      trough = Math.min(trough, b.low ?? b.close);
    }
    const current = scope[scope.length - 1]?.close ?? 0;
    const pct = (p: number) => ((p - fillPrice) / fillPrice) * 100;
    return {
      current, peak, trough,
      currentPct: pct(current),
      peakPct: pct(peak),
      troughPct: pct(trough),
      noPostFill,
    };
  }, [bars, fillPrice, order.ts]);

  const dte = useMemo(() => {
    if (!order.expiration) return null;
    const exp = new Date(`${order.expiration}T00:00:00`);
    if (Number.isNaN(exp.getTime())) return null;
    return Math.round((exp.getTime() - new Date(new Date().toDateString()).getTime()) / 86_400_000);
  }, [order.expiration]);

  const otmPct = liveSpot > 0 && order.strike
    ? ((order.type === "C" ? order.strike - liveSpot : liveSpot - order.strike) / liveSpot) * 100
    : null;

  const bull = (order.side === "buy") === (order.type === "C");

  const kpi: React.CSSProperties = {
    border: `1px solid ${C.border}`, borderRadius: 8, background: "rgba(0,0,0,0.35)", padding: "10px 12px",
  };
  const kl: React.CSSProperties = {
    fontSize: 11, textTransform: "uppercase", letterSpacing: "0.08em", color: C.muted, opacity: 0.6,
  };
  const kv: React.CSSProperties = { fontSize: 18, fontWeight: 800, fontFamily: "var(--font-mono)", marginTop: 4 };
  const note: React.CSSProperties = { fontSize: 11, color: C.muted, opacity: 0.5, fontFamily: "var(--font-mono)", marginTop: 2 };

  return (
    <div style={{
      borderBottom: `1px solid ${C.border}`,
      background: "rgba(33,158,188,0.05)",
      padding: "12px 20px",
    }}>
      {/* ── Drawer header ── */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, marginBottom: 10, flexWrap: "wrap" }}>
        <span style={{ fontSize: 13, fontWeight: 800, letterSpacing: "0.1em", textTransform: "uppercase", color: C.text }}>
          ↳ {ticker} {order.strike.toLocaleString()}{order.type} · {order.expiration ?? "—"}
          {dte != null && <span style={{ color: C.muted, opacity: 0.6 }}> · {dte} DTE</span>}
          <span style={{ color: bull ? BULL : BEAR, marginLeft: 8 }}>{bull ? "▲ BULL" : "▼ BEAR"}</span>
        </span>
        <div style={{ display: "flex", gap: 5, alignItems: "center" }}>
          {TFS.map((t) => {
            // A same-day print has nothing beyond its own session, so All would
            // be a no-op button that redraws the identical chart.
            if (t.id === "all" && sameDay) return null;
            return (
              <button
                key={t.id}
                onClick={() => setTf(t.id)}
                title={t.id === "today" ? "The session this alert printed in" : `Since the alert (${fillDate}) → now`}
                style={{
                  fontSize: 11, fontWeight: 700, padding: "4px 9px", borderRadius: 5, cursor: "pointer",
                  letterSpacing: "0.04em", textTransform: "uppercase",
                  border: `1px solid ${tf === t.id ? C.cyan : C.border}`,
                  background: tf === t.id ? DOCK_THEME.activeTile : "rgba(0,0,0,0.4)",
                  color: tf === t.id ? C.cyan : C.text,
                }}
              >
                {t.label}
              </button>
            );
          })}
          <button
            onClick={onClose}
            title="Collapse"
            style={{
              fontSize: 11, fontWeight: 700, padding: "4px 9px", borderRadius: 5, cursor: "pointer",
              border: `1px solid ${C.border}`, background: "rgba(0,0,0,0.4)", color: C.muted,
            }}
          >
            ▲ Collapse
          </button>
        </div>
      </div>

      {/* ── Chart + KPI rail ── */}
      <div className="contract-drawer-grid" style={{ display: "grid", gridTemplateColumns: "1fr 230px", gap: 12 }}>
        <div style={{ border: `1px solid ${C.border}`, borderRadius: 8, background: "rgba(0,0,0,0.35)", padding: 8, minHeight: 276 }}>
          {loading ? (
            <p style={{ fontSize: 12, color: C.muted, opacity: 0.6, padding: 20 }}>Loading contract history…</p>
          ) : err ? (
            <p style={{ fontSize: 12, color: C.red, padding: 20 }}>Contract history unavailable ({err}).</p>
          ) : !bars.length ? (
            <p style={{ fontSize: 12, color: C.muted, opacity: 0.6, padding: 20 }}>
              No traded bars for this contract {tf === "today" ? "this session" : "since the alert"}.
            </p>
          ) : (
            <ContractChart bars={bars} fillPrice={fillPrice} fillTs={order.ts} track={track} />
          )}
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          <div style={{ ...kpi, borderColor: track && track.currentPct >= 0 ? "rgba(34,197,94,0.4)" : C.border }}>
            <div style={kl}>Since Fill</div>
            <div style={{ ...kv, color: !track ? C.muted : track.currentPct >= 0 ? BULL : BEAR }}>
              {track ? fmtPct(track.currentPct) : "—"}
            </div>
            <div style={note}>
              {fmtUsd(fillPrice)}{track ? ` → ${fmtUsd(track.current)}` : ""}
              {track?.noPostFill ? " · latest close" : ""}
            </div>
          </div>

          <div style={kpi}>
            <div style={kl}>Peak / Trough</div>
            <div style={{ ...kv, fontSize: 15 }}>
              <span style={{ color: BULL }}>{track ? fmtPct(track.peakPct) : "—"}</span>
              <span style={{ color: C.muted, opacity: 0.3 }}> / </span>
              <span style={{ color: BEAR }}>{track ? fmtPct(track.troughPct) : "—"}</span>
            </div>
            <div style={note}>
              {track
                ? track.noPostFill
                  ? "no bars after the alert yet"
                  : `${fmtUsd(track.peak)} / ${fmtUsd(track.trough)}`
                : "no bars since fill"}
            </div>
          </div>

          <div style={{ ...kpi, borderColor: "rgba(251,133,1,0.4)" }}>
            <div style={kl}>Vol / OI</div>
            <div style={{ ...kv, color: C.orange, fontSize: 15 }}>
              {stat?.vol != null && stat?.oi ? (stat.vol / stat.oi).toFixed(2) : "—"}
            </div>
            <div style={note}>{fmtNum(stat?.vol)} vol · {fmtNum(stat?.oi)} oi</div>
          </div>

          <div style={kpi}>
            <div style={kl}>IV · % OTM</div>
            <div style={{ ...kv, fontSize: 15 }}>
              {stat?.iv != null ? `${(stat.iv * 100).toFixed(1)}%` : "—"}
              <span style={{ color: C.muted, opacity: 0.3 }}> · </span>
              <span style={{ color: otmPct == null ? C.muted : otmPct >= 0 ? C.cyan : BEAR }}>
                {otmPct == null ? "—" : `${otmPct.toFixed(1)}%`}
              </span>
            </div>
            <div style={note}>
              {order.size.toLocaleString()} ct · {fmtUsd(order.premium)}
              {otmPct != null && otmPct < 0 ? " · now ITM" : ""}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Inline SVG chart: contract close line + fill/peak/trough guides, over a
// volume pane pinned to the bottom. ──
// Deliberately hand-rolled rather than lightweight-charts: the drawer mounts and
// unmounts on every row click, and a full chart instance per expand is heavy.
// Note the guides come from bar HIGHS/LOWS while the line is CLOSES, so the peak
// guide sitting above the line is correct, not a bug — it's the intraday extreme.
function ContractChart({
  bars, fillPrice, fillTs, track,
}: {
  bars: Bar[];
  fillPrice: number;
  fillTs: number;
  track: { peak: number; trough: number } | null;
}) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const [w, setW] = useState(640);
  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setW(el.clientWidth || 640));
    ro.observe(el);
    setW(el.clientWidth || 640);
    return () => ro.disconnect();
  }, []);

  // Volume lives in its OWN pane pinned to the bottom, not overlaid on price:
  // overlaid, it fought the price line for the same pixels and its height meant
  // nothing against a dollar axis.
  const H = 260, PADL = 6, PADR = 62, PADT = 10, PADB = 24;
  const VOL_H = 46;   // volume pane, pinned to the bottom of the card
  const GAP = 10;     // separation between panes
  const iw = Math.max(80, w - PADL - PADR);
  const ih = H - PADT - PADB - VOL_H - GAP; // price pane
  const volTop = PADT + ih + GAP;

  const closes = bars.map((b) => b.close);
  // Domain spans only what's drawn — the close line and the three guide levels.
  // Using bar high/low here would reserve headroom for wicks that aren't
  // rendered, which is part of why the line sat squashed in the middle.
  const rawMax = Math.max(...closes, fillPrice, ...(track && Number.isFinite(track.peak) ? [track.peak] : []));
  const rawMin = Math.min(...closes, fillPrice, ...(track && Number.isFinite(track.trough) ? [track.trough] : []));
  // Small breathing room only — and NOT clamped to 0. Clamping to zero on a
  // contract trading at $30 handed ~90% of the box to empty space below the
  // line; the axis starts near the data instead.
  const span = rawMax - rawMin;
  const pad = span > 0 ? span * 0.06 : Math.max(rawMax * 0.05, 0.05);
  const max = rawMax + pad;
  const min = rawMin - pad;

  const X = (i: number) => PADL + (bars.length === 1 ? iw / 2 : (i / (bars.length - 1)) * iw);
  const Y = (p: number) => PADT + ih - ((p - min) / (max - min || 1)) * ih;

  const path = closes.map((c, i) => `${i ? "L" : "M"}${X(i).toFixed(1)} ${Y(c).toFixed(1)}`).join("");
  const fillIdx = bars.findIndex((b) => b.time >= fillTs - 60_000);

  // Volume scale: the 95th percentile, NOT the max. A whale print is by
  // definition a volume outlier, so scaling to the max makes that one bar full
  // height and squashes every other bar to ~1px — which reads as "no volume on
  // the chart". Bars above p95 simply clip to full height; they're already
  // obviously the biggest, and the fill bar is colour-coded anyway.
  const vols = bars.map((b) => b.volume ?? 0);
  const nonZero = vols.filter((v) => v > 0).sort((a, b) => a - b);
  const p95 = nonZero.length ? nonZero[Math.min(nonZero.length - 1, Math.floor(nonZero.length * 0.95))] : 0;
  const vmax = Math.max(1, p95);
  const barW = Math.max(1.5, (iw / Math.max(1, bars.length)) * 0.6);
  // Any real trade gets at least 1.5px so it's visible at all.
  const volH = (v: number) => (v > 0 ? Math.max(1.5, Math.min(1, v / vmax) * VOL_H) : 0);

  // Bars are always intraday now, but "All" can span several sessions — a bare
  // clock time would then repeat 09:30 once per day and read as nonsense.
  const multiDay = bars.length > 1 && bars[bars.length - 1].time - bars[0].time > 86_400_000;
  const tickFmt = (t: number) =>
    new Date(t).toLocaleString("en-US", {
      timeZone: "America/New_York",
      ...(multiDay
        ? { month: "short", day: "numeric", hour: "numeric" }
        : { hour: "numeric", minute: "2-digit" }),
    });

  return (
    <div ref={wrapRef} style={{ width: "100%" }}>
      <svg width={w} height={H} style={{ display: "block" }}>
        {/* ── volume pane, pinned to the bottom of the card ── */}
        <line x1={PADL} x2={PADL + iw} y1={volTop + VOL_H} y2={volTop + VOL_H} stroke={C.border} strokeWidth={1} />
        {bars.map((b, i) => {
          const v = b.volume ?? 0;
          const bh = volH(v);
          if (!bh) return null;
          return (
            <rect
              key={i}
              x={X(i) - barW / 2}
              y={volTop + VOL_H - bh}
              width={barW}
              height={bh}
              rx={1}
              fill={i === fillIdx ? C.orange : "rgba(142,202,230,0.45)"}
            >
              <title>{`${tickFmt(b.time)} — ${v.toLocaleString()} contracts`}</title>
            </rect>
          );
        })}
        <text x={PADL + iw + 8} y={volTop + 9} fill="rgba(255,255,255,0.4)" fontSize={9} fontFamily="var(--font-mono)">
          {vmax >= 1000 ? `${(vmax / 1000).toFixed(1)}K` : vmax.toFixed(0)}
        </text>
        <text x={PADL + iw + 8} y={volTop + VOL_H} fill="rgba(255,255,255,0.3)" fontSize={9} fontFamily="var(--font-mono)">
          vol
        </text>
        {/* peak / trough guides */}
        {track && Number.isFinite(track.peak) && (
          <line x1={PADL} x2={PADL + iw} y1={Y(track.peak)} y2={Y(track.peak)} stroke={BULL} strokeWidth={1} strokeDasharray="5 4" opacity={0.5} />
        )}
        {track && Number.isFinite(track.trough) && (
          <line x1={PADL} x2={PADL + iw} y1={Y(track.trough)} y2={Y(track.trough)} stroke={BEAR} strokeWidth={1} strokeDasharray="5 4" opacity={0.5} />
        )}
        {/* fill level + fill moment */}
        {fillPrice > 0 && (
          <line x1={PADL} x2={PADL + iw} y1={Y(fillPrice)} y2={Y(fillPrice)} stroke={C.orange} strokeWidth={1} strokeDasharray="5 4" opacity={0.7} />
        )}
        {/* The alert's moment — spans both panes so the print's volume bar lines
            up with the price it printed at. */}
        {fillIdx >= 0 && (
          <line x1={X(fillIdx)} x2={X(fillIdx)} y1={PADT} y2={volTop + VOL_H} stroke={C.orange} strokeWidth={1.4} strokeDasharray="4 3" opacity={0.85} />
        )}
        {/* price */}
        <path d={path} fill="none" stroke={C.green} strokeWidth={2} strokeLinejoin="round" />
        {/* right price axis */}
        {[0, 0.25, 0.5, 0.75, 1].map((f) => {
          const v = min + (max - min) * f;
          return (
            <text key={f} x={PADL + iw + 8} y={Y(v) + 3.5} fill={C.green} fontSize={10} fontFamily="var(--font-mono)">
              ${v.toFixed(2)}
            </text>
          );
        })}
        {/* time axis */}
        {bars.length > 1 && [0, 0.33, 0.66, 1].map((f) => {
          const i = Math.round(f * (bars.length - 1));
          return (
            <text key={f} x={X(i)} y={volTop + VOL_H + 15} fill="rgba(255,255,255,0.35)" fontSize={9.5} textAnchor="middle" fontFamily="var(--font-mono)">
              {tickFmt(bars[i].time)}
            </text>
          );
        })}
      </svg>
    </div>
  );
}
