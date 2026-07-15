"use client";

// ─────────────────────────────────────────────────────────────────────────────
// ContractDrawer — the /flow tape's in-place whale expansion (variant D).
//
// Clicking a whale row (premium ≥ WHALE_FLOOR) expands this drawer directly
// underneath it, rather than opening a modal: the tape stays on screen, so you
// can compare the print you're inspecting against the ones around it.
//
// Contents:
//   • contract price line + volume bars (/proxy/option-history)
//   • since-fill tracking — the print's price vs current / peak / trough
//   • aggressor split, when the order carries bid/ask classification
//
// Since-fill only means something at intraday granularity for a same-day print,
// so the 1D timeframe is the default; 30D/90D fall back to daily EOD closes.
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

type TF = "1d" | "30d" | "90d";
const TFS: TF[] = ["1d", "30d", "90d"];

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

export default function ContractDrawer({ order, ticker, stat, liveSpot, onClose }: ContractDrawerProps) {
  const [tf, setTf] = useState<TF>("1d");
  const [bars, setBars] = useState<Bar[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  // The fill we're tracking: this print's own option price.
  const fillPrice = Number(order.price) || 0;

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setErr(null);
    const params = new URLSearchParams({
      ticker,
      expiry: order.expiration ?? "",
      strike: String(order.strike),
      type: order.type,
      tf,
    });
    // Intraday is anchored to the print's own session, not "today" — a tape
    // loaded for a past date must chart that date, not the current one.
    if (tf === "1d") {
      params.set("date", new Date(order.ts).toLocaleDateString("en-CA", { timeZone: "America/New_York" }));
    }
    fetch(`/proxy/option-history?${params}`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
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
  }, [ticker, order.expiration, order.strike, order.type, order.ts, tf]);

  // ── Since-fill: current / peak / trough over bars AT OR AFTER the print.
  //
  // Granularity caveat, deliberately surfaced rather than hidden: daily bars are
  // anchored at midnight ET, so for a print made TODAY the 30D/90D series has no
  // bar strictly after the fill. Rather than silently reporting the whole 90-day
  // range as "since fill" (which would invent a peak from before the order even
  // existed), we fall back to the latest close only and flag it. The 1D view is
  // the one that can actually answer peak/trough for a same-day whale print.
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
          {TFS.map((t) => (
            <button
              key={t}
              onClick={() => setTf(t)}
              style={{
                fontSize: 11, fontWeight: 700, padding: "4px 9px", borderRadius: 5, cursor: "pointer",
                letterSpacing: "0.04em", textTransform: "uppercase",
                border: `1px solid ${tf === t ? C.cyan : C.border}`,
                background: tf === t ? DOCK_THEME.activeTile : "rgba(0,0,0,0.4)",
                color: tf === t ? C.cyan : C.text,
              }}
            >
              {t}
            </button>
          ))}
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
        <div style={{ border: `1px solid ${C.border}`, borderRadius: 8, background: "rgba(0,0,0,0.35)", padding: 8, minHeight: 220 }}>
          {loading ? (
            <p style={{ fontSize: 12, color: C.muted, opacity: 0.6, padding: 20 }}>Loading contract history…</p>
          ) : err ? (
            <p style={{ fontSize: 12, color: C.red, padding: 20 }}>Contract history unavailable ({err}).</p>
          ) : !bars.length ? (
            <p style={{ fontSize: 12, color: C.muted, opacity: 0.6, padding: 20 }}>
              No {tf.toUpperCase()} bars for this contract.
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
              {track?.noPostFill ? " · latest close (try 1D)" : ""}
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
                  ? "no bars after fill on this timeframe"
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

// ── Inline SVG chart: price line + volume bars + fill/peak/trough guides. ──
// Deliberately hand-rolled rather than lightweight-charts: the drawer mounts and
// unmounts on every row click, and a full chart instance per expand is heavy for
// a ~200px sparkline.
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

  const H = 210, PADL = 6, PADR = 62, PADT = 8, PADB = 24;
  const iw = Math.max(80, w - PADL - PADR);
  const ih = H - PADT - PADB;

  const closes = bars.map((b) => b.close);
  const highs = bars.map((b) => b.high ?? b.close);
  const lows = bars.map((b) => b.low ?? b.close);
  // Include the fill line in the domain so it's never clipped off-chart.
  const rawMax = Math.max(...highs, fillPrice, track?.peak ?? 0);
  const rawMin = Math.min(...lows, fillPrice, track?.trough ?? Infinity);
  const pad = (rawMax - rawMin) * 0.08 || rawMax * 0.1 || 1;
  const max = rawMax + pad;
  const min = Math.max(0, rawMin - pad);
  const vmax = Math.max(1, ...bars.map((b) => b.volume ?? 0));

  const X = (i: number) => PADL + (bars.length === 1 ? iw / 2 : (i / (bars.length - 1)) * iw);
  const Y = (p: number) => PADT + ih - ((p - min) / (max - min || 1)) * ih;

  const path = closes.map((c, i) => `${i ? "L" : "M"}${X(i).toFixed(1)} ${Y(c).toFixed(1)}`).join("");
  const fillIdx = bars.findIndex((b) => b.time >= fillTs - 60_000);
  const barW = Math.max(1.5, (iw / Math.max(1, bars.length)) * 0.55);

  const tickFmt = (t: number) =>
    new Date(t).toLocaleString("en-US", {
      timeZone: "America/New_York",
      ...(bars.length && bars[bars.length - 1].time - bars[0].time > 2 * 86_400_000
        ? { month: "short", day: "numeric" }
        : { hour: "numeric", minute: "2-digit" }),
    });

  return (
    <div ref={wrapRef} style={{ width: "100%" }}>
      <svg width={w} height={H} style={{ display: "block" }}>
        {/* volume */}
        {bars.map((b, i) => {
          const bh = ((b.volume ?? 0) / vmax) * ih * 0.85;
          return (
            <rect
              key={i}
              x={X(i) - barW / 2}
              y={PADT + ih - bh}
              width={barW}
              height={bh}
              rx={1}
              fill={i === fillIdx ? "rgba(142,202,230,0.75)" : "rgba(255,255,255,0.14)"}
            />
          );
        })}
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
        {fillIdx >= 0 && (
          <line x1={X(fillIdx)} x2={X(fillIdx)} y1={PADT} y2={PADT + ih} stroke={C.orange} strokeWidth={1.4} strokeDasharray="4 3" opacity={0.85} />
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
            <text key={f} x={X(i)} y={PADT + ih + 15} fill="rgba(255,255,255,0.35)" fontSize={9.5} textAnchor="middle" fontFamily="var(--font-mono)">
              {tickFmt(bars[i].time)}
            </text>
          );
        })}
      </svg>
    </div>
  );
}
