"use client";

/**
 * Market Quality Terminal — 5-pillar global market score.
 *
 * Lived inline in components/pages/Scanner.tsx until 2026-08-16, when the tab
 * moved from /scanner to the Test Lab page (/test?tab=marketquality). See
 * GexScannerTab.tsx for why these moved into their own modules instead of
 * being imported page-to-page.
 *
 * Body unchanged from the original apart from `React.ReactNode` -> `ReactNode`
 * (this file imports the type directly rather than the React namespace).
 */

import { useCallback, useEffect, useState } from "react";
import type { ReactNode } from "react";
import { HOME_THEME, LIGHT_BLUE } from "@/components/shared/homeTheme";
import { Card } from "@/components/shared/PageCard";
import { seg } from "@/components/scanner/scannerStyles";

// ══════════════════════════════════════════════════════════════════════════════
//  MARKET QUALITY TERMINAL (new tab) — 5-pillar global market score
// ══════════════════════════════════════════════════════════════════════════════

type Pillars = {
  volatility: { score: number; weight: number; weighted: number; vixLevel: number | null; vixLevelLabel: string; vixTrend: string; ivPercentile: number | null; iv1yLabel: string; putCall: number | null; putCallLabel: string };
  trend: { score: number; weight: number; weighted: number; regime: string; spyVs20: boolean | null; spyVs50: boolean | null; spyVs200: boolean | null; qqqVs50: boolean | null; rsi14: number | null };
  breadth: { score: number; weight: number; weighted: number; aboveCount: number; total: number; pct200: number | null; pct20: number | null; participation: string; nyseAd: { display: string; label: string }; sectors: { symbol: string; above: boolean | null }[] };
  momentum: { score: number; weight: number; weighted: number; positiveCount: number; total: number; spread: number | null; leader: { symbol: string; chg5d: number } | null; laggard: { symbol: string; chg5d: number } | null; rotation: string };
  macro: { score: number; weight: number; weighted: number; tltLast: number | null; tltTrend: string; uupTrend: string; uup5d: number | null; tenYield: number | null; tenYieldTrend: string; dxy: number | null; dxyTrend: string };
};

type ExecItem = { label: string; value: string; sub: string; tone: boolean | null };

type MqData = {
  asOf: string;
  globalScore: number;
  decision: "YES" | "CAUTION" | "NO";
  banner: { label: string; tone: "green" | "cyan" | "orange" | "red"; sizing: string; sizeLabel: string; sizeNote: string };
  event: {
    fomc: { isToday: boolean; label: string | null; nextDate: string | null; daysAway: number | null };
    fedStance: { stance: string; range: string };
    geopolitical: { label: string; tone: string } | null;
  };
  pillars: Pillars;
  executionWindow: { score: number; items: ExecItem[] };
  sectorBars: { symbol: string; name: string; chg5d: number | null }[];
  headline: string;
  body: string;
  suggestedAction: string;
  assessment: string;
  source: string;
};

const TONE_COLOR: Record<string, string> = {
  green: HOME_THEME.green, cyan: HOME_THEME.cyan, orange: HOME_THEME.orange, red: HOME_THEME.red,
};

const scoreColor = (score: number) =>
  score >= 75 ? HOME_THEME.green : score >= 60 ? HOME_THEME.cyan : score >= 40 ? HOME_THEME.orange : HOME_THEME.red;

function RingGauge({ score, label, sub }: { score: number; label: string; sub: string }) {
  const size = 108, stroke = 9, r = (size - stroke) / 2, c = 2 * Math.PI * r;
  const pct = clamp01(score / 100);
  const dash = c * pct;
  const color = scoreColor(score);
  // End-cap dot position
  const angle = -90 + pct * 360;
  const rad = (angle * Math.PI) / 180;
  const cx = size / 2 + r * Math.cos(rad);
  const cy = size / 2 + r * Math.sin(rad);
  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 8 }}>
      <svg width={size} height={size} style={{ overflow: "visible" }}>
        <defs>
          <filter id={`glow-${label}`} x="-50%" y="-50%" width="200%" height="200%">
            <feGaussianBlur stdDeviation="4" result="blur" />
            <feMerge>
              <feMergeNode in="blur" /><feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
        </defs>
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="rgba(255,255,255,0.08)" strokeWidth={stroke} strokeDasharray="2 5" />
        <circle
          cx={size / 2} cy={size / 2} r={r} fill="none" stroke={color} strokeWidth={stroke}
          strokeDasharray={`${dash} ${c - dash}`} strokeLinecap="round" transform={`rotate(-90 ${size / 2} ${size / 2})`}
          filter={`url(#glow-${label})`} style={{ transition: "stroke-dasharray 0.6s ease" }}
        />
        {pct > 0.02 && <circle cx={cx} cy={cy} r={4} fill="#fff" />}
        <text x="50%" y="50%" textAnchor="middle" dominantBaseline="central" fontSize={15} fontWeight={800} fill={HOME_THEME.text}>
          {Math.round(score)}
        </text>
      </svg>
      <div style={{ textAlign: "center" }}>
        <div style={{ fontSize: 14, fontWeight: 800, letterSpacing: "0.06em", color: HOME_THEME.text, textTransform: "uppercase" }}>{label}</div>
        <div style={{ fontSize: 14, color: HOME_THEME.text }}>{sub}</div>
      </div>
    </div>
  );
}

function clamp01(v: number) { return Math.max(0, Math.min(1, v)); }

function MqPanel({ title, accent, children }: { title: string; accent: string; score: number; children: ReactNode }) {
  return (
    <div style={{ borderRadius: 12, border: "1px solid rgba(255,255,255,0.08)", padding: "14px 16px", background: `rgba(13,17,25,0.25)` }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
        <span style={{ fontSize: 17, fontWeight: 800, letterSpacing: "0.05em", color: accent, textTransform: "uppercase" }}>{title}</span>
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>{children}</div>
    </div>
  );
}

function MqRow({ label, value, valueColor }: { label: string; value: ReactNode; valueColor?: string }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", fontSize: 14 }}>
      <span style={{ color: HOME_THEME.text }}>{label}</span>
      <span style={{ fontWeight: 700, color: valueColor ?? HOME_THEME.text }}>{value}</span>
    </div>
  );
}

function MarketQualityScanner() {
  const [data, setData] = useState<MqData | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [copyStatus, setCopyStatus] = useState<"idle" | "copied">("idle");

  const load = useCallback(async () => {
    setLoading(true); setErr(null);
    try {
      const res = await fetch("/api/scanner/market-quality", { cache: "no-store" });
      const text = await res.text();
      let j: any;
      try { j = JSON.parse(text); } catch { throw new Error(`Server returned ${res.status} (non-JSON).`); }
      if (j.error) throw new Error(j.error);
      setData(j.data);
    } catch (e: any) { setErr(String(e?.message || e)); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); }, [load]);
  useEffect(() => { const t = setInterval(() => load(), 60_000); return () => clearInterval(t); }, [load]);

  const copyAssessment = () => {
    if (!data) return;
    navigator.clipboard?.writeText(data.assessment).then(() => {
      setCopyStatus("copied");
      setTimeout(() => setCopyStatus("idle"), 1500);
    }).catch(() => {});
  };

  if (err) {
    return (
      <Card variant="budget" title={<span style={{ fontSize: 17 }}>Market Quality Terminal</span>} subtitle="Global market regime score">
        <div style={{ color: HOME_THEME.red, fontSize: 14 }}>{err}</div>
      </Card>
    );
  }
  if (!data) {
    return (
      <Card variant="budget" title={<span style={{ fontSize: 17 }}>Market Quality Terminal</span>} subtitle="Loading…">
        <div style={{ color: HOME_THEME.text, fontSize: 14, padding: 24, textAlign: "center" }}>Fetching live index / sector data…</div>
      </Card>
    );
  }

  const { globalScore, decision, banner, event, pillars, executionWindow, sectorBars, headline, body, suggestedAction } = data;
  const bannerColor = TONE_COLOR[banner.tone];
  const decisionColor = decision === "YES" ? HOME_THEME.green : decision === "CAUTION" ? HOME_THEME.orange : HOME_THEME.red;
  const asOfLocal = new Date(data.asOf).toLocaleString("en-US", { month: "short", day: "numeric", year: "numeric", hour: "2-digit", minute: "2-digit", timeZoneName: "short" });

  const maxAbsBar = Math.max(1, ...sectorBars.map((b) => Math.abs(b.chg5d ?? 0)));

  const execToneColor = (tone: boolean | null) => tone == null ? HOME_THEME.orange : tone ? HOME_THEME.green : HOME_THEME.red;

  return (
    <Card variant="budget" title={<span style={{ fontSize: 17 }}>Market Quality Terminal</span>}
      subtitle={`Global market regime score · ${asOfLocal}${loading ? " · refreshing…" : ""}`}>

      {/* Decision + Banner + global score + 5 rings + Position Size */}
      <div style={{ display: "flex", flexWrap: "wrap", gap: 24, alignItems: "center", marginBottom: 22 }}>
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 6, minWidth: 90 }}>
          <span style={{ fontSize: 14, fontWeight: 800, color: HOME_THEME.text, textTransform: "uppercase", letterSpacing: "0.06em" }}>Decision</span>
          <div style={{
            borderRadius: 8, padding: "8px 18px", fontSize: 14, fontWeight: 800, letterSpacing: "0.04em",
            color: decisionColor, border: `1px solid ${decisionColor}55`, background: `${decisionColor}15`,
          }}>{decision}</div>
          <span style={{ fontSize: 14, color: HOME_THEME.text }}>Swing Trading</span>
        </div>

        <div style={{
          borderRadius: 12, padding: "14px 20px", minWidth: 150,
          border: `1px solid ${bannerColor}55`, background: `${bannerColor}15`,
        }}>
          <div style={{ fontSize: 14, fontWeight: 800, letterSpacing: "0.1em", color: bannerColor }}>{banner.label}</div>
          <div style={{ fontSize: 14, fontWeight: 800, color: HOME_THEME.text, lineHeight: 1.1 }}>{globalScore}<span style={{ fontSize: 17, color: HOME_THEME.text }}>/100</span></div>
          <div style={{ fontSize: 14, color: bannerColor, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.04em" }}>{banner.sizing}</div>
        </div>

        <div style={{ display: "flex", gap: 18, flexWrap: "wrap" }}>
          <RingGauge score={pillars.volatility.score} label="Volatility" sub="25%" />
          <RingGauge score={pillars.trend.score} label="Trend" sub="20%" />
          <RingGauge score={pillars.breadth.score} label="Breadth" sub="20%" />
          <RingGauge score={pillars.momentum.score} label="Momentum" sub="25%" />
          <RingGauge score={pillars.macro.score} label="Macro" sub="10%" />
        </div>

        <div style={{
          borderRadius: 12, padding: "14px 20px", minWidth: 140, marginLeft: "auto",
          border: `1px solid ${HOME_THEME.border}`, background: "rgba(13,17,25,0.35)",
        }}>
          <div style={{ fontSize: 14, fontWeight: 800, color: HOME_THEME.text, textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 4 }}>Position Size</div>
          <div style={{ fontSize: 14, fontWeight: 800, color: bannerColor, letterSpacing: "0.04em" }}>{banner.sizeLabel}</div>
          <div style={{ fontSize: 14, color: HOME_THEME.text }}>{banner.sizeNote}</div>
        </div>
      </div>

      {/* FOMC / event banner */}
      {event.fomc.label && (
        <div style={{
          borderRadius: 8, padding: "10px 16px", marginBottom: 16, fontSize: 14, fontWeight: 600,
          color: HOME_THEME.text, background: `${HOME_THEME.orange}12`, border: `1px solid ${HOME_THEME.orange}45`,
        }}>
          <span style={{ fontWeight: 800, color: HOME_THEME.orange }}>⚠ {event.fomc.label}</span>
          {" — Fed decision at 2:00 PM ET. Fed stance: "}{event.fedStance.stance}{" at "}{event.fedStance.range}{". Press conference at 2:30 PM."}
        </div>
      )}

      {/* 5 detail panels */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 12, marginBottom: 24 }}>
        <MqPanel title="Volatility" accent={HOME_THEME.orange} score={pillars.volatility.score}>
          <MqRow label="VIX Level" value={pillars.volatility.vixLevel ?? "—"} valueColor={HOME_THEME.text} />
          <MqRow label="VIX Trend" value={pillars.volatility.vixTrend} valueColor={pillars.volatility.vixTrend === "Rising" ? HOME_THEME.red : pillars.volatility.vixTrend === "Falling" ? HOME_THEME.green : HOME_THEME.text} />
          <MqRow label="VIX 1Y %ile" value={pillars.volatility.ivPercentile != null ? `${pillars.volatility.ivPercentile}th` : "—"} valueColor={HOME_THEME.text} />
          <MqRow label="Put/Call" value={`${pillars.volatility.putCall ?? "—"} · ${pillars.volatility.putCallLabel}`} valueColor={pillars.volatility.putCallLabel === "Fear elevated" ? HOME_THEME.red : pillars.volatility.putCallLabel === "Complacent" ? HOME_THEME.green : HOME_THEME.text} />
        </MqPanel>

        <MqPanel title="Trend" accent={HOME_THEME.cyan} score={pillars.trend.score}>
          <MqRow label="SPX vs 20D" value={pillars.trend.spyVs20 == null ? "—" : pillars.trend.spyVs20 ? "▲ Intact" : "▼ Weak"} valueColor={pillars.trend.spyVs20 ? HOME_THEME.green : HOME_THEME.red} />
          <MqRow label="SPX vs 50D" value={pillars.trend.spyVs50 == null ? "—" : pillars.trend.spyVs50 ? "▲ Intact" : "▼ Weak"} valueColor={pillars.trend.spyVs50 ? HOME_THEME.green : HOME_THEME.red} />
          <MqRow label="SPX vs 200D" value={pillars.trend.spyVs200 == null ? "—" : pillars.trend.spyVs200 ? "▲ Intact" : "▼ Weak"} valueColor={pillars.trend.spyVs200 ? HOME_THEME.green : HOME_THEME.red} />
          <MqRow label="QQQ vs 50D" value={pillars.trend.qqqVs50 == null ? "—" : pillars.trend.qqqVs50 ? "▲ Intact" : "▼ Correcting"} valueColor={pillars.trend.qqqVs50 ? HOME_THEME.green : HOME_THEME.red} />
          <MqRow label="Regime" value={pillars.trend.regime} valueColor={pillars.trend.regime === "Bullish" ? HOME_THEME.green : pillars.trend.regime === "Bearish" ? HOME_THEME.red : HOME_THEME.orange} />
          <MqRow label="RSI-14" value={pillars.trend.rsi14 ?? "—"} valueColor={HOME_THEME.text} />
        </MqPanel>

        <MqPanel title="Breadth" accent={HOME_THEME.red} score={pillars.breadth.score}>
          <MqRow label="% > 50D MA" value={`${pillars.breadth.total ? Math.round((pillars.breadth.aboveCount / pillars.breadth.total) * 100) : 0}%`} valueColor={HOME_THEME.text} />
          <MqRow label="% > 200D MA" value={pillars.breadth.pct200 != null ? `${pillars.breadth.pct200}%` : "—"} valueColor={HOME_THEME.text} />
          <MqRow label="% > 20D MA" value={pillars.breadth.pct20 != null ? `${pillars.breadth.pct20}%` : "—"} valueColor={HOME_THEME.text} />
          <MqRow label="Sector A/D" value={`${pillars.breadth.nyseAd.display} · ${pillars.breadth.nyseAd.label}`} valueColor={pillars.breadth.nyseAd.label === "Positive" ? HOME_THEME.green : pillars.breadth.nyseAd.label === "Negative" ? HOME_THEME.red : HOME_THEME.orange} />
          <MqRow label="Participation" value={pillars.breadth.participation} valueColor={pillars.breadth.participation === "Broad" ? HOME_THEME.green : pillars.breadth.participation === "Narrow" ? HOME_THEME.red : HOME_THEME.orange} />
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 4 }}>
            {pillars.breadth.sectors.map((s) => (
              <span key={s.symbol} style={{
                fontSize: 14, fontWeight: 700, padding: "2px 6px", borderRadius: 4,
                color: s.above == null ? HOME_THEME.text : s.above ? HOME_THEME.green : HOME_THEME.red,
                background: s.above == null ? "transparent" : s.above ? `${HOME_THEME.green}18` : `${HOME_THEME.red}18`,
              }}>
                {s.symbol} {s.above == null ? "—" : s.above ? "↑" : "↓"}
              </span>
            ))}
          </div>
        </MqPanel>

        <MqPanel title="Momentum" accent={HOME_THEME.green} score={pillars.momentum.score}>
          <MqRow label="Sectors +" value={`${pillars.momentum.positiveCount}/${pillars.momentum.total}`} valueColor={HOME_THEME.text} />
          <MqRow label="Spread" value={pillars.momentum.spread != null ? `${pillars.momentum.spread}%` : "—"} valueColor={HOME_THEME.text} />
          <MqRow label="Leader" value={pillars.momentum.leader ? `${pillars.momentum.leader.symbol} +${pillars.momentum.leader.chg5d}%` : "—"} valueColor={HOME_THEME.green} />
          <MqRow label="Laggard" value={pillars.momentum.laggard ? `${pillars.momentum.laggard.symbol} ${pillars.momentum.laggard.chg5d}%` : "—"} valueColor={HOME_THEME.red} />
          <MqRow label="Rotation" value={pillars.momentum.rotation} valueColor={HOME_THEME.text} />
        </MqPanel>

        <MqPanel title="Macro" accent={LIGHT_BLUE} score={pillars.macro.score}>
          <MqRow label="FOMC" value={event.fomc.isToday ? "TODAY · Event risk!" : event.fomc.nextDate ? `${event.fomc.nextDate} · ${event.fomc.daysAway}d away` : "—"} valueColor={event.fomc.isToday ? HOME_THEME.red : HOME_THEME.text} />
          <MqRow label="10Y Yield" value={pillars.macro.tenYield != null ? `${pillars.macro.tenYield}% ${pillars.macro.tenYieldTrend}` : "—"} valueColor={pillars.macro.tenYieldTrend === "Rising" ? HOME_THEME.red : pillars.macro.tenYieldTrend === "Falling" ? HOME_THEME.green : HOME_THEME.text} />
          <MqRow label="DXY" value={pillars.macro.dxy != null ? `${pillars.macro.dxy} ${pillars.macro.dxyTrend}` : "—"} valueColor={pillars.macro.dxyTrend === "Strengthening" ? HOME_THEME.red : pillars.macro.dxyTrend === "Weakening" ? HOME_THEME.green : HOME_THEME.text} />
          <MqRow label="Fed Stance" value={`${event.fedStance.stance} ${event.fedStance.range}`} valueColor={HOME_THEME.text} />
          <MqRow label="Geopolitical" value={event.geopolitical ? `${event.geopolitical.label} · ${event.geopolitical.tone}` : "None flagged"} valueColor={event.geopolitical ? HOME_THEME.orange : HOME_THEME.text} />
        </MqPanel>
      </div>

      {/* Execution window + sector performance + scoring weights */}
      <div style={{ display: "grid", gridTemplateColumns: "minmax(220px, 1fr) minmax(260px, 1.3fr) minmax(220px, 1fr)", gap: 16 }}>
        <div style={{ borderRadius: 12, border: "1px solid rgba(255,255,255,0.08)", padding: "14px 16px" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
            <span style={{ fontSize: 17, fontWeight: 800, color: HOME_THEME.green, textTransform: "uppercase", letterSpacing: "0.05em" }}>
              Execution Window
            </span>
            <span style={{ fontSize: 14, fontWeight: 800, color: scoreColor(executionWindow.score) }}>{executionWindow.score}</span>
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {executionWindow.items.map((it) => (
              <div key={it.label} style={{ display: "flex", justifyContent: "space-between", fontSize: 14 }}>
                <span style={{ color: HOME_THEME.text }}>{it.label}</span>
                <span style={{ fontWeight: 700, color: execToneColor(it.tone) }}>{it.value} <span style={{ fontSize: 14, fontWeight: 500 }}>{it.sub}</span></span>
              </div>
            ))}
          </div>
        </div>

        <div style={{ borderRadius: 12, border: "1px solid rgba(255,255,255,0.08)", padding: "14px 16px" }}>
          <div style={{ fontSize: 17, fontWeight: 800, color: HOME_THEME.green, textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 10 }}>
            Sector Performance (5-Day)
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            {sectorBars.map((b) => {
              const v = b.chg5d ?? 0;
              const pos = v >= 0;
              const widthPct = (Math.abs(v) / maxAbsBar) * 100;
              return (
                <div key={b.symbol} style={{ display: "grid", gridTemplateColumns: "48px 1fr 60px", alignItems: "center", gap: 8, fontSize: 14 }}>
                  <span style={{ fontWeight: 700, color: HOME_THEME.text }}>{b.symbol}</span>
                  <div style={{ position: "relative", height: 14, background: "rgba(255,255,255,0.05)", borderRadius: 4 }}>
                    <div style={{
                      position: "absolute", top: 0, bottom: 0, left: pos ? "0%" : undefined, right: pos ? undefined : "0%",
                      width: `${widthPct}%`, background: pos ? HOME_THEME.green : HOME_THEME.red, borderRadius: 4, opacity: 0.85,
                    }} />
                  </div>
                  <span style={{ textAlign: "right", fontWeight: 700, color: pos ? HOME_THEME.green : HOME_THEME.red }}>
                    {pos ? "+" : ""}{v.toFixed(2)}%
                  </span>
                </div>
              );
            })}
          </div>
        </div>

        <div style={{ borderRadius: 12, border: "1px solid rgba(255,255,255,0.08)", padding: "14px 16px" }}>
          <div style={{ fontSize: 17, fontWeight: 800, color: HOME_THEME.green, textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 10 }}>
            Scoring Weights
          </div>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 14 }}>
            <thead>
              <tr style={{ color: HOME_THEME.text, fontSize: 14, textTransform: "uppercase" }}>
                <th style={{ textAlign: "left", padding: "4px 0" }}>Pillar</th>
                <th style={{ textAlign: "right", padding: "4px 0" }}>Score</th>
                <th style={{ textAlign: "right", padding: "4px 0" }}>Weight</th>
                <th style={{ textAlign: "right", padding: "4px 0" }}>Wtd</th>
              </tr>
            </thead>
            <tbody>
              {([
                ["Volatility", pillars.volatility.score, pillars.volatility.weight, pillars.volatility.weighted],
                ["Trend", pillars.trend.score, pillars.trend.weight, pillars.trend.weighted],
                ["Breadth", pillars.breadth.score, pillars.breadth.weight, pillars.breadth.weighted],
                ["Momentum", pillars.momentum.score, pillars.momentum.weight, pillars.momentum.weighted],
                ["Macro", pillars.macro.score, pillars.macro.weight, pillars.macro.weighted],
              ] as [string, number, number, number][]).map(([name, score, weight, wtd]) => (
                <tr key={name} style={{ borderTop: "1px solid rgba(255,255,255,0.06)" }}>
                  <td style={{ padding: "5px 0", color: HOME_THEME.text }}>{name}</td>
                  <td style={{ textAlign: "right", color: scoreColor(score), fontWeight: 700 }}>{score}</td>
                  <td style={{ textAlign: "right", color: HOME_THEME.text }}>{Math.round(weight * 100)}%</td>
                  <td style={{ textAlign: "right", color: HOME_THEME.text, fontWeight: 700 }}>{wtd}</td>
                </tr>
              ))}
              <tr style={{ borderTop: `1px solid ${HOME_THEME.cyan}55` }}>
                <td style={{ padding: "6px 0", color: HOME_THEME.cyan, fontWeight: 800 }}>Total</td>
                <td style={{ textAlign: "right", color: HOME_THEME.text }}>—</td>
                <td style={{ textAlign: "right", color: HOME_THEME.text }}>100%</td>
                <td style={{ textAlign: "right", color: HOME_THEME.cyan, fontWeight: 800 }}>{globalScore}</td>
              </tr>
            </tbody>
          </table>
          <div style={{ marginTop: 10, paddingTop: 10, borderTop: "1px solid rgba(255,255,255,0.06)", display: "flex", flexDirection: "column", gap: 3, fontSize: 14 }}>
            <span style={{ color: HOME_THEME.green, fontWeight: 700 }}>60-100: YES (press risk)</span>
            <span style={{ color: HOME_THEME.orange, fontWeight: 700 }}>40-59: CAUTION (selective)</span>
            <span style={{ color: HOME_THEME.red, fontWeight: 700 }}>&lt;40: NO (preserve capital)</span>
          </div>
        </div>
      </div>

      {/* AI-generated assessment */}
      <div style={{ marginTop: 20, borderRadius: 12, border: `1px solid ${HOME_THEME.cyan}30`, padding: "14px 16px", background: `${HOME_THEME.cyan}0A` }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
          <span style={{ fontSize: 17, fontWeight: 800, color: HOME_THEME.cyan, textTransform: "uppercase", letterSpacing: "0.06em" }}>
            ⚡ AI-Generated Market Assessment
          </span>
          <button onClick={copyAssessment} style={{ ...seg(false), fontSize: 14, padding: "4px 10px" }}>
            {copyStatus === "copied" ? "Copied ✓" : "Copy Shot"}
          </button>
        </div>
        <div style={{ fontSize: 14, fontWeight: 800, color: decisionColor, marginBottom: 8 }}>{headline}</div>
        <div style={{ fontSize: 14, color: HOME_THEME.text, lineHeight: 1.6, marginBottom: 10 }}>{body}</div>
        <div style={{ fontSize: 14, color: HOME_THEME.text, lineHeight: 1.6, fontStyle: "italic" }}>{suggestedAction}</div>
      </div>
    </Card>
  );
}

export default MarketQualityScanner;
