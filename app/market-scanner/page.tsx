import { notFound } from "next/navigation";
export default function MarketScannerPage() { notFound(); }
/*

import { useState, useEffect, useCallback } from "react";
import { HOME_THEME, homeButtonStyle, homeRefreshButtonStyle } from "@/components/shared/homeTheme";
import { PageShell } from "@/components/shared/PageCard";
import type { TickerAnalytics } from "@/app/api/market-scanner/route";

// ── Constants ─────────────────────────────────────────────────────────────────

const FILTERS = ["All", "Top Opportunities", "Directional", "Mean Reversion", "Vol Premium", "Elevated Vol", "Fragile"] as const;
type Filter = (typeof FILTERS)[number];

const ACCENT_COLORS: Record<string, string> = {
  cyan: HOME_THEME.cyan,
  green: HOME_THEME.green,
  orange: HOME_THEME.orange,
  red: HOME_THEME.red,
  purple: HOME_THEME.purple,
};

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmt(n: number | null, decimals = 2, prefix = ""): string {
  if (n == null) return "–";
  return `${prefix}${n.toFixed(decimals)}`;
}

function fmtPrice(n: number | null): string {
  if (n == null) return "–";
  return n >= 1000
    ? `$${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
    : `$${n.toFixed(2)}`;
}

function fmtPct(n: number | null, showSign = false): string {
  if (n == null) return "–";
  const s = showSign && n > 0 ? "+" : "";
  return `${s}${n.toFixed(1)}%`;
}

function fmtSI(n: number | null): string {
  if (n == null) return "–";
  const abs = Math.abs(n);
  const sign = n < 0 ? "-" : "+";
  if (abs >= 1e9) return `${sign}${(abs / 1e9).toFixed(1)}B`;
  if (abs >= 1e6) return `${sign}${(abs / 1e6).toFixed(0)}M`;
  if (abs >= 1e3) return `${sign}${(abs / 1e3).toFixed(0)}K`;
  return `${sign}${abs.toFixed(2)}`;
}

function filterTicker(t: TickerAnalytics, f: Filter): boolean {
  if (f === "All") return true;
  if (f === "Top Opportunities") return t.score >= 7;
  if (f === "Directional") return t.direction !== "NEUTRAL";
  if (f === "Mean Reversion") return t.strategy === "MEAN REVERSION";
  if (f === "Vol Premium") return t.strategy === "VOL PREMIUM";
  if (f === "Elevated Vol") return (t.ivRank ?? 0) > 50;
  if (f === "Fragile") return t.extension === "extended" && t.momentum === "weakening";
  return true;
}

// ── Mini arc gauge (SVG) ──────────────────────────────────────────────────────

function ArcGauge({ pct, label }: { pct: number | null; label: string }) {
  const v = Math.max(0, Math.min(100, pct ?? 0));
  const r = 22, cx = 30, cy = 30;
  const startAngle = -210; // degrees
  const sweep = 240; // total arc
  const ang = startAngle + (sweep * v) / 100;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const trackStart = { x: cx + r * Math.cos(toRad(startAngle)), y: cy + r * Math.sin(toRad(startAngle)) };
  const trackEnd   = { x: cx + r * Math.cos(toRad(startAngle + sweep)), y: cy + r * Math.sin(toRad(startAngle + sweep)) };
  const needleEnd  = { x: cx + r * Math.cos(toRad(ang)), y: cy + r * Math.sin(toRad(ang)) };
  const largeArc = sweep > 180 ? 1 : 0;
  const filledLarge = (sweep * v) / 100 > 180 ? 1 : 0;

  const trackD = `M ${trackStart.x} ${trackStart.y} A ${r} ${r} 0 ${largeArc} 1 ${trackEnd.x} ${trackEnd.y}`;
  const fillD  = pct != null && v > 0
    ? `M ${trackStart.x} ${trackStart.y} A ${r} ${r} 0 ${filledLarge} 1 ${needleEnd.x} ${needleEnd.y}`
    : "";

  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 0 }}>
      <div style={{ fontSize: 9, color: `rgba(255,255,255,0.45)`, letterSpacing: "0.06em", textTransform: "uppercase", marginBottom: 2 }}>
        {label}
      </div>
      <svg width={60} height={40} viewBox="0 0 60 45">
        <path d={trackD} fill="none" stroke="rgba(255,255,255,0.1)" strokeWidth={4} strokeLinecap="round" />
        {fillD && <path d={fillD} fill="none" stroke={HOME_THEME.cyan} strokeWidth={4} strokeLinecap="round" />}
        <text x={cx} y={38} textAnchor="middle" fontSize={10} fontWeight={700} fill={HOME_THEME.text}>
          {pct != null ? `${Math.round(v)}%` : "–"}
        </text>
      </svg>
    </div>
  );
}

// ── Mini bar (0-1 fill) ───────────────────────────────────────────────────────

function MiniBar({ value, color, flip = false }: { value: number; color: string; flip?: boolean }) {
  const w = Math.max(0, Math.min(1, value)) * 100;
  return (
    <div style={{ flex: 1, height: 4, background: "rgba(255,255,255,0.08)", borderRadius: 2, overflow: "hidden" }}>
      <div style={{
        width: `${w}%`, height: "100%", borderRadius: 2,
        background: color,
        marginLeft: flip ? `${100 - w}%` : 0,
      }} />
    </div>
  );
}

// ── Badge ─────────────────────────────────────────────────────────────────────

function Badge({ label, color, bg }: { label: string; color: string; bg: string }) {
  return (
    <span style={{
      fontSize: 9, fontWeight: 800, letterSpacing: "0.1em",
      textTransform: "uppercase", padding: "2px 6px",
      borderRadius: 3, color, background: bg, whiteSpace: "nowrap",
    }}>
      {label}
    </span>
  );
}

function ScoreBadge({ score, rating }: { score: number; rating: string }) {
  const color = rating === "HIGH" ? HOME_THEME.orange : rating === "LOW" ? HOME_THEME.cyan : "rgba(255,255,255,0.5)";
  return (
    <div style={{ display: "flex", gap: 4, alignItems: "center" }}>
      <span style={{ fontSize: 10, color: "rgba(255,255,255,0.4)", fontWeight: 700 }}>SCORE:</span>
      <span style={{ fontSize: 10, fontWeight: 900, color }}>{score.toFixed(2)}</span>
      <Badge label={rating} color={color} bg={`${color}22`} />
    </div>
  );
}

function DirectionBadge({ dir }: { dir: string }) {
  const color = dir === "LONG" ? HOME_THEME.green : dir === "SHORT" ? HOME_THEME.red : "rgba(255,255,255,0.5)";
  return (
    <div style={{ display: "flex", gap: 4, alignItems: "center" }}>
      <span style={{ fontSize: 10, color: "rgba(255,255,255,0.4)", fontWeight: 700 }}>DIRECTION:</span>
      <Badge label={dir} color={color} bg={`${color}22`} />
    </div>
  );
}

function StrategyBadge({ strat }: { strat: string }) {
  const color = HOME_THEME.cyan;
  return (
    <div style={{ display: "flex", gap: 4, alignItems: "center" }}>
      <span style={{ fontSize: 10, color: "rgba(255,255,255,0.4)", fontWeight: 700 }}>STRATEGY:</span>
      <Badge label={strat} color={color} bg={`${color}22`} />
    </div>
  );
}

// ── Section label ─────────────────────────────────────────────────────────────

function SectionLabel({ label }: { label: string }) {
  return (
    <div style={{
      fontSize: 9, fontWeight: 800, letterSpacing: "0.14em", color: "rgba(255,255,255,0.35)",
      textTransform: "uppercase", marginBottom: 8,
    }}>
      {label}
    </div>
  );
}

// ── Market state row ──────────────────────────────────────────────────────────

function StateRow({ label, value, barValue, barColor }: { label: string; value: string; barValue: number; barColor: string }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 5 }}>
      <span style={{ fontSize: 11, color: "rgba(255,255,255,0.7)", minWidth: 140 }}>{label}: {value}</span>
      <MiniBar value={barValue} color={barColor} />
    </div>
  );
}

// State bar values
function stateBar(val: string, type: "trend" | "mom" | "ext" | "rv" | "align"): { v: number; color: string } {
  if (type === "trend") {
    if (val === "up") return { v: 0.85, color: HOME_THEME.green };
    if (val === "down") return { v: 0.15, color: HOME_THEME.red };
    return { v: 0.5, color: HOME_THEME.cyan };
  }
  if (type === "mom") {
    if (val === "strong") return { v: 0.9, color: HOME_THEME.green };
    if (val === "weakening") return { v: 0.35, color: HOME_THEME.orange };
    return { v: 0.5, color: HOME_THEME.cyan };
  }
  if (type === "ext") {
    if (val === "extended") return { v: 0.9, color: HOME_THEME.orange };
    if (val === "contracted") return { v: 0.15, color: HOME_THEME.cyan };
    return { v: 0.5, color: HOME_THEME.cyan };
  }
  if (type === "rv") return { v: 0.5, color: `rgba(255,100,100,0.7)` };
  if (type === "align") {
    if (val === "aligned") return { v: 0.8, color: HOME_THEME.green };
    if (val === "conflicting") return { v: 0.2, color: HOME_THEME.red };
    return { v: 0.5, color: HOME_THEME.cyan };
  }
  return { v: 0.5, color: HOME_THEME.cyan };
}

// ── OI split bar ──────────────────────────────────────────────────────────────

function OiSplitBar({ callsOI, putsOI }: { callsOI: number | null; putsOI: number | null }) {
  const c = callsOI ?? 0, p = putsOI ?? 0;
  const total = c + p;
  const callPct = total > 0 ? (c / total) * 100 : 50;
  const putPct = 100 - callPct;

  const fmtOI = (n: number) => n >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : n >= 1e3 ? `${(n / 1e3).toFixed(0)}K` : n ? String(n) : "–";

  return (
    <div style={{ margin: "8px 0" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 4 }}>
        <span style={{ fontSize: 10, color: HOME_THEME.green }}>▲ {fmtOI(c)} calls</span>
        <span style={{ fontSize: 9, color: "rgba(255,255,255,0.4)" }}>OI split</span>
        <span style={{ fontSize: 10, color: HOME_THEME.red }}>puts {fmtOI(p)} ▼</span>
      </div>
      <div style={{ height: 4, background: HOME_THEME.red, borderRadius: 2, overflow: "hidden" }}>
        <div style={{ width: `${callPct}%`, height: "100%", background: HOME_THEME.green }} />
      </div>
    </div>
  );
}

// ── Gamma row ─────────────────────────────────────────────────────────────────

function GammaRow({ label, value, bar }: { label: string; value: string; bar?: { v: number; c: string } }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 5 }}>
      <span style={{ fontSize: 11, color: "rgba(255,255,255,0.55)", flex: 1 }}>{label}</span>
      {bar && <MiniBar value={bar.v} color={bar.c} />}
      <span style={{ fontSize: 11, fontWeight: 700, color: HOME_THEME.text, minWidth: 70, textAlign: "right" }}>{value}</span>
    </div>
  );
}

// ── Ticker Card ───────────────────────────────────────────────────────────────

function TickerCard({ t }: { t: TickerAnalytics }) {
  const pctPos = t.pct1d != null && t.pct1d > 0;
  const pctColor = pctPos ? HOME_THEME.green : t.pct1d != null && t.pct1d < 0 ? HOME_THEME.red : "rgba(255,255,255,0.5)";

  const regimeColor = t.regime.includes("HIGH VOL") || t.regime.includes("EXPANSION")
    ? HOME_THEME.orange
    : t.regime.includes("RANGE") ? HOME_THEME.purple : HOME_THEME.cyan;

  const msColor = t.marketStructure.includes("REVERSION") ? HOME_THEME.orange
    : t.marketStructure.includes("EXPANSION") ? HOME_THEME.red
    : t.marketStructure.includes("CONTINUATION") ? HOME_THEME.green
    : "rgba(255,255,255,0.4)";

  const trendBar = stateBar(t.trend, "trend");
  const momBar = stateBar(t.momentum, "mom");
  const extBar = stateBar(t.extension, "ext");
  const alignBar = stateBar(t.alignment, "align");
  const rvFraction = t.realizedVol20d != null ? Math.min(1, t.realizedVol20d / 50) : 0.4;

  const em1dPct = t.spot && t.em1d ? fmtPct(t.em1d / t.spot * 100, true) : "–";
  const em1wPct = t.spot && t.em1w ? fmtPct(t.em1w / t.spot * 100, true) : "–";
  const em30dPct = t.spot && t.em30d ? fmtPct(t.em30d / t.spot * 100, true) : "–";

  const borderColor = t.rating === "HIGH" ? `${HOME_THEME.orange}60` : t.rating === "LOW" ? `${HOME_THEME.cyan}40` : "rgba(255,255,255,0.08)";
  const topAccent = t.rating === "HIGH" ? HOME_THEME.orange : t.rating === "LOW" ? HOME_THEME.cyan : HOME_THEME.purple;

  return (
    <div style={{
      background: `radial-gradient(circle at 50% 0%, ${topAccent}12 0%, transparent 55%), rgba(13,17,25,0.55)`,
      backdropFilter: "blur(16px)",
      borderRadius: 16,
      border: `1px solid ${borderColor}`,
      borderTop: `2px solid ${topAccent}80`,
      padding: 16,
      display: "flex",
      flexDirection: "column",
      gap: 0,
      minWidth: 0,
    }}>
      {/* Header */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 10 }}>
        <div>
          <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
            <span style={{ fontSize: 20, fontWeight: 900, color: HOME_THEME.text }}>{t.symbol}</span>
            <span style={{ fontSize: 14, color: "rgba(255,255,255,0.7)" }}>{fmtPrice(t.spot)}</span>
          </div>
          <span style={{ fontSize: 11, color: pctColor }}>
            {t.change1d != null ? (t.change1d > 0 ? "+" : "") + t.change1d.toFixed(2) : ""}
            {t.pct1d != null ? ` (${fmtPct(t.pct1d, true)})` : ""}
          </span>
        </div>
        <ArcGauge pct={t.callSpec} label="Call Speculation" />
      </div>

      {/* Score / Direction / Strategy */}
      <div style={{ display: "flex", flexDirection: "column", gap: 4, marginBottom: 10 }}>
        <ScoreBadge score={t.score} rating={t.rating} />
        <DirectionBadge dir={t.direction} />
        <StrategyBadge strat={t.strategy} />
      </div>

      {/* Thesis */}
      <div style={{
        fontSize: 11, color: HOME_THEME.text, lineHeight: 1.5,
        fontFamily: "monospace", marginBottom: 10,
        padding: "6px 8px", background: "rgba(0,0,0,0.25)", borderRadius: 6,
        borderLeft: `3px solid ${topAccent}60`,
      }}>
        {t.thesis}
      </div>

      {/* Regime tags */}
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 12 }}>
        <Badge label={`REGIME: ${t.regime}`} color={regimeColor} bg={`${regimeColor}18`} />
        <Badge label={`MARKET STRUCTURE: ${t.marketStructure}`} color={msColor} bg={`${msColor}14`} />
      </div>

      {/* IV Context */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 6, marginBottom: 10 }}>
        {[
          { label: "IV Context", val: t.ivRank != null ? `${t.ivRank}% IVR` : "–", sub: String(t.ivRank ?? "–") },
          { label: "IV 1D Change", val: t.iv1dChange != null ? `${t.iv1dChange > 0 ? "+" : ""}${t.iv1dChange.toFixed(1)}%` : "–", sub: "" },
          { label: "Call Speculation", val: t.callSpec != null ? `${t.callSpec}%` : "–", sub: "" },
        ].map(({ label, val }) => (
          <div key={label} style={{ background: "rgba(0,0,0,0.2)", borderRadius: 6, padding: "6px 8px" }}>
            <div style={{ fontSize: 9, color: "rgba(255,255,255,0.35)", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 2 }}>{label}</div>
            <div style={{ fontSize: 12, fontWeight: 700, color: HOME_THEME.cyan }}>{val}</div>
          </div>
        ))}
      </div>

      {/* Expected moves */}
      <div style={{ display: "flex", gap: 6, marginBottom: 12 }}>
        {[["1d", em1dPct], ["1w", em1wPct], ["30d", em30dPct]].map(([lbl, val]) => (
          <div key={lbl} style={{
            flex: 1, textAlign: "center", padding: "4px 0",
            background: "rgba(33,158,188,0.06)", borderRadius: 4,
            border: `1px solid ${HOME_THEME.cyan}22`,
          }}>
            <div style={{ fontSize: 9, color: "rgba(255,255,255,0.35)", marginBottom: 1 }}>{lbl}</div>
            <div style={{ fontSize: 11, fontWeight: 700, color: HOME_THEME.green }}>{val}</div>
          </div>
        ))}
      </div>

      {/* Divider */}
      <div style={{ height: 1, background: "rgba(255,255,255,0.07)", marginBottom: 10 }} />

      {/* Market State */}
      <SectionLabel label="Market State" />
      <StateRow label="Trend" value={t.trend} barValue={trendBar.v} barColor={trendBar.color} />
      <StateRow label="Momentum" value={t.momentum} barValue={momBar.v} barColor={momBar.color} />
      <StateRow label="Extension" value={t.extension} barValue={extBar.v} barColor={extBar.color} />
      <StateRow label="Realized Vol" value={t.realizedVol20d != null ? "subdued" : "–"} barValue={rvFraction} barColor={`rgba(255,100,100,0.6)`} />
      <StateRow label="Alignment" value={t.alignment} barValue={alignBar.v} barColor={alignBar.color} />
      <div style={{ fontSize: 11, color: "rgba(255,255,255,0.5)", marginBottom: 10, marginTop: 2 }}>
        20d Realized Vol <span style={{ color: HOME_THEME.text, fontWeight: 700 }}>{t.realizedVol20d != null ? `${t.realizedVol20d}%` : "–"}</span>
      </div>

      {/* Gamma */}
      <div style={{ height: 1, background: "rgba(255,255,255,0.07)", marginBottom: 10 }} />
      <SectionLabel label="Gamma" />
      <GammaRow label="GEX Flip Price" value={t.gexFlip != null ? fmtPrice(t.gexFlip) : "–"} />
      <GammaRow label="GEX/1% Move" value={t.gexPer1pct != null ? fmtSI(t.gexPer1pct * 1e9) : "–"}
        bar={t.gexPer1pct != null ? { v: Math.min(1, Math.abs(t.gexPer1pct) / 100), c: t.gexPer1pct > 0 ? HOME_THEME.green : HOME_THEME.red } : undefined} />
      <GammaRow label="Max GEX Strike" value={t.maxGexStrike != null ? `$${t.maxGexStrike.toLocaleString()}` : "–"} />
      <GammaRow label="GEX Expiring" value={t.gexExpiringDate ?? "–"} />

      {/* Skew */}
      <div style={{ height: 1, background: "rgba(255,255,255,0.07)", marginBottom: 10, marginTop: 4 }} />
      <SectionLabel label={`Skew (30d)`} />
      <GammaRow label="P/C IV Ratio"
        value={fmt(t.pcIvRatio, 2)}
        bar={t.pcIvRatio != null ? { v: Math.min(1, t.pcIvRatio / 2), c: t.pcIvRatio > 1.2 ? HOME_THEME.red : HOME_THEME.green } : undefined} />
      <GammaRow label="P-C IV Spread"
        value={fmt(t.pcIvSpread, 3, t.pcIvSpread != null && t.pcIvSpread > 0 ? "+" : "")}
        bar={t.pcIvSpread != null ? { v: Math.min(1, Math.abs(t.pcIvSpread) * 10), c: t.pcIvSpread > 0 ? HOME_THEME.red : HOME_THEME.green } : undefined} />

      {/* Positioning */}
      <div style={{ height: 1, background: "rgba(255,255,255,0.07)", marginBottom: 10, marginTop: 4 }} />
      <SectionLabel label="Positioning" />
      <OiSplitBar callsOI={t.callsOI} putsOI={t.putsOI} />
      <GammaRow label="PCR (OI)" value={fmt(t.pcrOI, 2)} />
      <GammaRow label="PCR (Vol)" value={fmt(t.pcrVol, 2)} />
      <GammaRow label="PCR Δ 30d" value={fmt(t.pcrDelta30d, 2, t.pcrDelta30d != null && t.pcrDelta30d > 0 ? "+" : "")} />
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────

export default function MarketScannerPage() {
  const [data, setData] = useState<TickerAnalytics[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<Filter>("All");
  const [refreshState, setRefreshState] = useState<"idle" | "refreshing" | "success" | "error">("idle");
  const [lastUpdated, setLastUpdated] = useState<string | null>(null);

  const load = useCallback(async (isRefresh = false) => {
    if (isRefresh) setRefreshState("refreshing");
    else setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/market-scanner", { cache: "no-store" });
      if (!res.ok) throw new Error(`API error ${res.status}`);
      const json = await res.json();
      setData(json.tickers ?? []);
      setLastUpdated(new Date().toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" }));
      if (isRefresh) setRefreshState("success");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load");
      if (isRefresh) setRefreshState("error");
    } finally {
      setLoading(false);
      if (isRefresh) setTimeout(() => setRefreshState("idle"), 2000);
    }
  }, []);

  useEffect(() => { load(false); }, [load]);

  const visible = data?.filter(t => filterTicker(t, filter)) ?? [];

  return (
    <PageShell>
      {/* Header */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
        <div>
          <div style={{ fontSize: 18, fontWeight: 900, color: HOME_THEME.text, letterSpacing: "-0.01em" }}>
            Market Scanner
          </div>
          <div style={{ fontSize: 11, color: "rgba(255,255,255,0.35)" }}>
            SPX · SPY · QQQ · VIX — regime, gamma &amp; positioning
            {lastUpdated && <span style={{ marginLeft: 8 }}>Updated {lastUpdated}</span>}
          </div>
        </div>
        <button
          style={{ ...homeRefreshButtonStyle(refreshState), fontSize: 10, padding: "6px 14px" }}
          onClick={() => load(true)}
          disabled={refreshState === "refreshing"}
        >
          {refreshState === "refreshing" ? "REFRESHING…" : refreshState === "success" ? "UPDATED" : refreshState === "error" ? "ERROR" : "REFRESH"}
        </button>
      </div>

      {/* Filter bar */}
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
        {FILTERS.map(f => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            style={{
              padding: "5px 12px",
              borderRadius: 20,
              border: filter === f ? `1px solid ${HOME_THEME.cyan}` : `1px solid rgba(255,255,255,0.1)`,
              background: filter === f ? `${HOME_THEME.cyan}18` : "rgba(255,255,255,0.04)",
              color: filter === f ? HOME_THEME.cyan : HOME_THEME.text,
              fontSize: 11, fontWeight: 700, letterSpacing: "0.04em",
              cursor: "pointer", transition: "all 0.15s",
            }}
          >
            {f}
          </button>
        ))}
      </div>

      {/* Content */}
      {loading && (
        <div style={{ textAlign: "center", padding: 60, color: "rgba(255,255,255,0.35)", fontSize: 13 }}>
          Loading market data…
        </div>
      )}
      {error && (
        <div style={{
          padding: 16, borderRadius: 10, background: `${HOME_THEME.red}14`,
          border: `1px solid ${HOME_THEME.red}40`, color: HOME_THEME.red, fontSize: 12,
        }}>
          {error}
        </div>
      )}
      {!loading && !error && visible.length === 0 && (
        <div style={{ textAlign: "center", padding: 40, color: "rgba(255,255,255,0.35)", fontSize: 13 }}>
          No tickers match "{filter}"
        </div>
      )}
      {!loading && visible.length > 0 && (
        <div style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))",
          gap: 16,
          alignItems: "start",
        }}>
          {visible.map(t => <TickerCard key={t.symbol} t={t} />)}
        </div>
      )}
    </PageShell>
  );
}
*/
