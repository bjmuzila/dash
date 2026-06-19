"use client";

import { useEffect, useRef, useState, useCallback, type CSSProperties } from "react";

// ── Types (mirror /api/insights/market-quality payload) ────────────────────────

interface Pillars {
  volatility: { score: number; vix: number | null; vixFalling: boolean; realized10d: number | null };
  trend: { score: number; regime: string; bullish: boolean; spx: number | null; sma20: number | null; sma50: number | null };
  breadth: { score: number; above: number; total: number };
  momentum: { score: number; rsi: number | null; ret5: number | null };
  macro: { score: number; bondPct: number | null; dollarPct: number | null; bondLast: number | null };
}

interface MQ {
  asOf: string;
  global: number;
  banner: string;
  sizingLabel: string;
  sizingNote: string;
  weights: { volatility: number; trend: number; breadth: number; momentum: number; macro: number };
  pillars: Pillars;
  sectors: { sym: string; pct: number }[];
  assessment: string;
}

// ── Helpers ────────────────────────────────────────────────────────────────────

function scoreColor(v: number): string {
  if (v >= 70) return "#00e676";
  if (v >= 50) return "#faad14";
  if (v >= 35) return "#f97316";
  return "#ef4444";
}

function fmt(v: number | null | undefined, d = 2, suffix = ""): string {
  if (v == null || !isFinite(v)) return "—";
  return v.toFixed(d) + suffix;
}

// ── Ring gauge ─────────────────────────────────────────────────────────────────

function Ring({ value, label, weight }: { value: number; label: string; weight: number }) {
  const color = scoreColor(value);
  const v = Math.max(0, Math.min(100, value));
  const SZ = 94;          // viewbox size
  const C = SZ / 2;       // center
  const r = 36;
  const circ = 2 * Math.PI * r;
  const off = circ * (1 - v / 100);
  const uid = `ring-${label}`;
  // End-cap dot position (sweeps from top, clockwise).
  const ang = (-90 + (v / 100) * 360) * (Math.PI / 180);
  const dotX = C + r * Math.cos(ang);
  const dotY = C + r * Math.sin(ang);
  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 7 }}>
      <svg width={94} height={94} viewBox={`0 0 ${SZ} ${SZ}`}>
        <defs>
          <linearGradient id={`${uid}-grad`} x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor={color} stopOpacity={0.55} />
            <stop offset="100%" stopColor={color} stopOpacity={1} />
          </linearGradient>
          <filter id={`${uid}-glow`} x="-50%" y="-50%" width="200%" height="200%">
            <feGaussianBlur stdDeviation="2.4" result="b" />
            <feMerge>
              <feMergeNode in="b" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
        </defs>
        {/* track */}
        <circle cx={C} cy={C} r={r} fill="none" stroke="#16202c" strokeWidth={8} />
        <circle cx={C} cy={C} r={r} fill="none" stroke={`${color}22`} strokeWidth={8} strokeDasharray="1 7" />
        {/* progress arc with glow */}
        <circle
          cx={C} cy={C} r={r} fill="none" stroke={`url(#${uid}-grad)`} strokeWidth={8} strokeLinecap="round"
          strokeDasharray={circ} strokeDashoffset={off}
          transform={`rotate(-90 ${C} ${C})`}
          filter={`url(#${uid}-glow)`}
          style={{ transition: "stroke-dashoffset .6s cubic-bezier(.4,0,.2,1)" }}
        />
        {/* sweeping end-cap dot */}
        <circle cx={dotX} cy={dotY} r={3.4} fill="#ffffff" stroke={color} strokeWidth={1.6}
          style={{ transition: "cx .6s cubic-bezier(.4,0,.2,1), cy .6s cubic-bezier(.4,0,.2,1)" }} />
        <text x={C} y={C + 7} textAnchor="middle" fontSize={26} fontWeight={900} fill={color} fontFamily="monospace">{value}</text>
      </svg>
      <div style={{ fontSize: 11, fontWeight: 800, color: "#ffffff", letterSpacing: ".12em", textTransform: "uppercase" }}>{label}</div>
      <div style={{ fontSize: 10, color: color, fontWeight: 800 }}>{Math.round(weight * 100)}%</div>
    </div>
  );
}

// ── Detail panel ───────────────────────────────────────────────────────────────

function Panel({ title, score, rows }: { title: string; score: number; rows: { k: string; v: string; c?: string }[] }) {
  const color = scoreColor(score);
  return (
    <div className="card-hover" style={{ border: `1px solid ${color}33`, background: `linear-gradient(180deg,${color}0d,rgba(5,8,13,.92))`, borderRadius: 8, padding: 12, display: "flex", flexDirection: "column", gap: 8 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <span style={{ fontSize: 13, fontWeight: 800, color: "#eef7ff", letterSpacing: ".08em", textTransform: "uppercase" }}>{title}</span>
        <span style={{ fontSize: 22, fontWeight: 900, color, fontFamily: "monospace" }}>{score}</span>
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
        {rows.map((row) => (
          <div key={row.k} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", fontSize: 13 }}>
            <span style={{ color: "#ffffff", textTransform: "uppercase", letterSpacing: ".04em", fontSize: 11, fontWeight: 700, alignSelf: "center" }}>{row.k}</span>
            <span style={{ color: row.c ?? "#ffffff", fontFamily: "monospace", fontWeight: 700, fontSize: 14 }}>{row.v}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Main ───────────────────────────────────────────────────────────────────────

export default function MarketQualityTerminal() {
  const [data, setData] = useState<MQ | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState(false);
  const mounted = useRef(true);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/insights/market-quality", { cache: "no-store" });
      if (!res.ok) throw new Error("bad");
      const json = (await res.json()) as MQ;
      if (mounted.current) { setData(json); setErr(false); }
    } catch {
      if (mounted.current) setErr(true);
    } finally {
      if (mounted.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    mounted.current = true;
    load();
    const t = setInterval(load, 60_000);
    return () => { mounted.current = false; clearInterval(t); };
  }, [load]);

  const card: CSSProperties = { background: "#070c14", border: "1px solid #1a2a3a", borderRadius: 8 };

  if (loading && !data) {
    return (
      <div style={{ ...card, padding: 24, color: "#ffffff", fontSize: 13 }}>Loading Market Quality Terminal…</div>
    );
  }
  if (err && !data) {
    return (
      <div style={{ ...card, padding: 24, color: "#ef4444", fontSize: 13 }}>
        Market Quality Terminal unavailable — could not reach data source.{" "}
        <button onClick={load} style={{ marginLeft: 8, color: "#00e5ff", background: "transparent", border: "1px solid #1a2a3a", borderRadius: 4, padding: "2px 8px", cursor: "pointer", fontSize: 11 }}>Retry</button>
      </div>
    );
  }
  if (!data) return null;

  const p = data.pillars;
  const gColor = scoreColor(data.global);
  const bannerColor = data.banner === "CLEAR" ? "#00e676" : data.banner === "CAUTION" ? "#faad14" : "#ef4444";
  const asOf = new Date(data.asOf).toLocaleString("en-US", { timeZone: "America/New_York", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false });

  const trendArrow = (n: number | null | undefined) => (n == null ? "" : n >= 0 ? " ↑" : " ↓");

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      {/* ── Header banner ── */}
      <div style={{ ...card, padding: "12px 16px", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 16, flexWrap: "wrap", borderColor: `${bannerColor}55` }}>
        <span style={{ fontSize: 13, fontWeight: 900, color: "#eef7ff", letterSpacing: ".16em", textTransform: "uppercase" }}>Market Quality Terminal</span>
        <span style={{ fontSize: 10, color: "#ffffff", fontFamily: "monospace" }}>{asOf} ET</span>
      </div>

      {/* ── Score + gauges row ── */}
      <div style={{ ...card, padding: 16, display: "grid", gridTemplateColumns: "minmax(170px,200px) 1fr", gap: 16, alignItems: "center" }} className="mqt-top card-hover">
        {/* Global score block */}
        <div style={{ border: `1px solid ${bannerColor}66`, background: `${bannerColor}12`, borderRadius: 8, padding: "16px 12px", textAlign: "center", display: "flex", flexDirection: "column", alignItems: "center", gap: 4 }}>
          <div style={{ fontSize: 16, fontWeight: 900, color: bannerColor, letterSpacing: ".08em", whiteSpace: "nowrap" }}>{data.banner}</div>
          <div style={{ fontSize: 42, fontWeight: 900, color: gColor, fontFamily: "monospace", lineHeight: 1, whiteSpace: "nowrap" }}>{data.global}<span style={{ fontSize: 14, color: "#ffffff" }}> / 100</span></div>
          <div style={{ fontSize: 11, fontWeight: 800, color: gColor, letterSpacing: ".08em", textTransform: "uppercase" }}>{data.sizingLabel}</div>
          <div style={{ fontSize: 9, color: "#ffffff", lineHeight: 1.3 }}>{data.sizingNote}</div>
        </div>

        {/* Pillar rings */}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(5, 1fr)", gap: 8 }} className="mqt-rings">
          <Ring value={p.volatility.score} label="Volatility" weight={data.weights.volatility} />
          <Ring value={p.trend.score} label="Trend" weight={data.weights.trend} />
          <Ring value={p.breadth.score} label="Breadth" weight={data.weights.breadth} />
          <Ring value={p.momentum.score} label="Momentum" weight={data.weights.momentum} />
          <Ring value={p.macro.score} label="Macro" weight={data.weights.macro} />
        </div>
      </div>

      {/* ── Detail panels ── */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(5, minmax(0,1fr))", gap: 10 }} className="mqt-panels">
        <Panel title="Volatility" score={p.volatility.score} rows={[
          { k: "VIX", v: fmt(p.volatility.vix), c: p.volatility.vix != null && p.volatility.vix < 22 ? "#00e676" : "#f97316" },
          { k: "VIX Trend", v: p.volatility.vixFalling ? "Falling ↓" : "Rising ↑", c: p.volatility.vixFalling ? "#00e676" : "#ef4444" },
          { k: "10D RV", v: fmt(p.volatility.realized10d, 1, "%") },
        ]} />
        <Panel title="Trend" score={p.trend.score} rows={[
          { k: "Regime", v: p.trend.regime, c: p.trend.bullish ? "#00e676" : p.trend.regime === "Bearish" ? "#ef4444" : "#faad14" },
          { k: "SPX", v: fmt(p.trend.spx, 0) },
          { k: "vs 20D", v: p.trend.spx != null && p.trend.sma20 != null ? (p.trend.spx > p.trend.sma20 ? "Above ↑" : "Below ↓") : "—", c: p.trend.spx != null && p.trend.sma20 != null ? (p.trend.spx > p.trend.sma20 ? "#00e676" : "#ef4444") : undefined },
          { k: "vs 50D", v: p.trend.spx != null && p.trend.sma50 != null ? (p.trend.spx > p.trend.sma50 ? "Above ↑" : "Below ↓") : "—", c: p.trend.spx != null && p.trend.sma50 != null ? (p.trend.spx > p.trend.sma50 ? "#00e676" : "#ef4444") : undefined },
        ]} />
        <Panel title="Breadth" score={p.breadth.score} rows={[
          { k: "Sectors > 50D", v: `${p.breadth.above}/${p.breadth.total}` },
          { k: "Participation", v: p.breadth.score >= 60 ? "Broad" : p.breadth.score >= 40 ? "Mixed" : "Narrow", c: p.breadth.score >= 60 ? "#00e676" : p.breadth.score >= 40 ? "#faad14" : "#ef4444" },
        ]} />
        <Panel title="Momentum" score={p.momentum.score} rows={[
          { k: "RSI-14", v: fmt(p.momentum.rsi, 0), c: p.momentum.rsi == null ? undefined : p.momentum.rsi >= 70 ? "#f97316" : p.momentum.rsi >= 55 ? "#00e676" : p.momentum.rsi <= 30 ? "#00e5ff" : "#faad14" },
          { k: "5D Return", v: fmt(p.momentum.ret5, 2, "%") + trendArrow(p.momentum.ret5), c: p.momentum.ret5 == null ? undefined : p.momentum.ret5 >= 0 ? "#00e676" : "#ef4444" },
        ]} />
        <Panel title="Macro" score={p.macro.score} rows={[
          { k: "Bonds (TLT)", v: fmt(p.macro.bondLast, 2) },
          { k: "Bonds Δ", v: fmt(p.macro.bondPct, 2, "%") + trendArrow(p.macro.bondPct), c: p.macro.bondPct == null ? undefined : p.macro.bondPct >= 0 ? "#00e676" : "#ef4444" },
          { k: "Dollar Δ", v: fmt(p.macro.dollarPct, 2, "%") + trendArrow(p.macro.dollarPct), c: p.macro.dollarPct == null ? undefined : p.macro.dollarPct >= 0 ? "#f97316" : "#00e676" },
        ]} />
      </div>

      {/* ── Sector perf + weights ── */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }} className="mqt-lower">
        {/* Sector performance bars */}
        <div className="card-hover" style={{ ...card, padding: 14 }}>
          <div style={{ fontSize: 13, fontWeight: 900, color: "#00e5ff", letterSpacing: ".12em", textTransform: "uppercase", marginBottom: 12 }}>★ Sector Performance (5-Day)</div>
          {(() => {
            const maxAbs = Math.max(0.01, ...data.sectors.map((s) => Math.abs(s.pct)));
            return (
              <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                {data.sectors.map((s) => {
                  const pos = s.pct >= 0;
                  const w = (Math.abs(s.pct) / maxAbs) * 50;
                  return (
                    <div key={s.sym} style={{ display: "grid", gridTemplateColumns: "50px 1fr 64px", alignItems: "center", gap: 8, fontSize: 13 }}>
                      <span style={{ color: "#ffffff", fontFamily: "monospace", fontWeight: 700 }}>{s.sym}</span>
                      <div style={{ position: "relative", height: 14, background: "#0d1620", borderRadius: 3 }}>
                        <div style={{ position: "absolute", left: "50%", top: 0, bottom: 0, width: 1, background: "#1a2a3a" }} />
                        <div style={{
                          position: "absolute", top: 1, bottom: 1,
                          left: pos ? "50%" : `${50 - w}%`, width: `${w}%`,
                          background: pos ? "#00e676" : "#ef4444",
                          borderRadius: 2, transition: "width .4s, left .4s",
                        }} />
                      </div>
                      <span style={{ textAlign: "right", color: pos ? "#00e676" : "#ef4444", fontFamily: "monospace", fontWeight: 700 }}>{pos ? "+" : ""}{s.pct.toFixed(2)}%</span>
                    </div>
                  );
                })}
              </div>
            );
          })()}
        </div>

        {/* Scoring weights table */}
        <div className="card-hover" style={{ ...card, padding: 14 }}>
          <div style={{ fontSize: 13, fontWeight: 900, color: "#00e5ff", letterSpacing: ".12em", textTransform: "uppercase", marginBottom: 12 }}>★ Scoring Weights</div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 56px 60px 64px", gap: 5, fontSize: 13 }}>
            <span style={{ color: "#ffffff", fontWeight: 800, textTransform: "uppercase", letterSpacing: ".06em", fontSize: 11 }}>Pillar</span>
            <span style={{ color: "#ffffff", fontWeight: 800, textAlign: "right", fontSize: 11 }}>SCORE</span>
            <span style={{ color: "#ffffff", fontWeight: 800, textAlign: "right", fontSize: 11 }}>WEIGHT</span>
            <span style={{ color: "#ffffff", fontWeight: 800, textAlign: "right", fontSize: 11 }}>WTD</span>
            {([
              ["Volatility", p.volatility.score, data.weights.volatility],
              ["Trend", p.trend.score, data.weights.trend],
              ["Breadth", p.breadth.score, data.weights.breadth],
              ["Momentum", p.momentum.score, data.weights.momentum],
              ["Macro", p.macro.score, data.weights.macro],
            ] as [string, number, number][]).map(([name, score, w]) => (
              <Row key={name} name={name} score={score} weight={w} />
            ))}
            <span style={{ color: "#00e5ff", fontWeight: 900, marginTop: 6, paddingTop: 6, borderTop: "1px solid #1a2a3a" }}>TOTAL</span>
            <span style={{ marginTop: 6, paddingTop: 6, borderTop: "1px solid #1a2a3a" }} />
            <span style={{ textAlign: "right", color: "#00e5ff", fontWeight: 900, marginTop: 6, paddingTop: 6, borderTop: "1px solid #1a2a3a" }}>100%</span>
            <span style={{ textAlign: "right", color: scoreColor(data.global), fontWeight: 900, fontFamily: "monospace", marginTop: 6, paddingTop: 6, borderTop: "1px solid #1a2a3a" }}>{data.global}</span>
          </div>
        </div>
      </div>

      {/* ── AI Assessment ── */}
      <div className="card-hover" style={{ ...card, padding: 18 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12 }}>
          <span style={{ fontSize: 13, fontWeight: 900, color: "#00e5ff", letterSpacing: ".12em", textTransform: "uppercase" }}>⚡ Generated Market Assessment</span>
        </div>
        <div style={{ fontSize: 17, color: "#ffffff", lineHeight: 1.65 }}>{data.assessment}</div>
      </div>

      {/* Responsive collapse */}
      <style>{`
        @media (max-width: 720px) {
          .mqt-top { grid-template-columns: 1fr !important; }
          .mqt-rings { grid-template-columns: repeat(5, 1fr) !important; gap: 4px !important; }
          .mqt-panels { grid-template-columns: repeat(2, 1fr) !important; }
          .mqt-lower { grid-template-columns: 1fr !important; }
        }
      `}</style>
    </div>
  );
}

function Row({ name, score, weight }: { name: string; score: number; weight: number }) {
  const wtd = Math.round(score * weight * 10) / 10;
  return (
    <>
      <span style={{ color: "#ffffff" }}>{name}</span>
      <span style={{ textAlign: "right", color: scoreColor(score), fontFamily: "monospace", fontWeight: 700 }}>{score}</span>
      <span style={{ textAlign: "right", color: "#ffffff", fontFamily: "monospace" }}>{Math.round(weight * 100)}%</span>
      <span style={{ textAlign: "right", color: "#eef7ff", fontFamily: "monospace", fontWeight: 700 }}>{wtd}</span>
    </>
  );
}
