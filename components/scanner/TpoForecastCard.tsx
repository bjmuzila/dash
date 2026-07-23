"use client";
import { useEffect, useMemo, useState } from "react";
import { HOME_THEME, LIGHT_BLUE } from "@/components/shared/homeTheme";
import { Card } from "@/components/shared/PageCard";

// Live predicted-vs-realized TPO profile. Predicted comes from /api/tpo-forecast
// (k-NN over the recorder's tpo_profiles history); realized is today's session so
// far. Both are densities on a shared price axis. Prediction is fixed at the IB
// close — the realized profile fills in toward it through the day.

type Forecast = {
  ok: true; symbol: string; date: string; nHistory: number; k: number; confidence: number;
  ibMid: number; ibHigh: number; ibLow: number; spot: number | null;
  prices: number[]; predicted: number[]; realized: number[];
  predicted_poc: number; realized_poc: number;
  predicted_va: [number, number]; realized_va: [number, number];
} | {
  ok: false; status: "accumulating" | "pre_ib"; nHistory: number; need?: number; note: string;
};

const title = (
  <span style={{ fontSize: 17, color: HOME_THEME.orange }}>TPO forecast — predicted vs realized</span>
);

export default function TpoForecastCard({ instr }: { instr: "ESU" | "NQU" }) {
  const [fc, setFc] = useState<Forecast | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    const load = async () => {
      try {
        const r = await fetch(`/api/tpo-forecast?symbol=${instr === "NQU" ? "NQ" : "ES"}`, { cache: "no-store" });
        const j = await r.json();
        if (!alive) return;
        if (j?.error) { setErr(String(j.error)); return; }
        setErr(null); setFc(j as Forecast);
      } catch (e) {
        if (alive) setErr(String((e as Error)?.message || e));
      }
    };
    load();
    const t = setInterval(load, 60_000);
    return () => { alive = false; clearInterval(t); };
  }, [instr]);

  const chart = useMemo(() => {
    if (!fc || !fc.ok) return null;
    const { prices, predicted, realized } = fc;
    // focus on the price window that carries mass
    let lo = 0, hi = prices.length - 1;
    while (lo < hi && Math.max(predicted[lo], realized[lo]) < 0.03) lo++;
    while (hi > lo && Math.max(predicted[hi], realized[hi]) < 0.03) hi--;
    lo = Math.max(0, lo - 4); hi = Math.min(prices.length - 1, hi + 4);
    const pMax = prices[hi], pMin = prices[lo];
    const H = 260, W = 62, X0 = 3;
    const y = (px: number) => ((pMax - px) / Math.max(1e-9, pMax - pMin)) * H;
    const xFor = (v: number) => X0 + v * W;
    const areaPath = (arr: number[]) => {
      let d = `M ${X0} ${y(prices[lo])}`;
      for (let i = lo; i <= hi; i++) d += ` L ${xFor(arr[i]).toFixed(2)} ${y(prices[i]).toFixed(2)}`;
      d += ` L ${X0} ${y(prices[hi])} Z`;
      return d;
    };
    const linePath = (arr: number[]) =>
      arr.slice(lo, hi + 1).map((v, k) => `${k ? "L" : "M"} ${xFor(v).toFixed(2)} ${y(prices[lo + k]).toFixed(2)}`).join(" ");
    return { H, W, X0, y, pMin, pMax,
      realizedArea: areaPath(realized), predictedLine: linePath(predicted) };
  }, [fc]);

  if (err) {
    return <Card variant="budget" title={title}>
      <div style={{ padding: 16, color: HOME_THEME.text, fontSize: 14 }}>Couldn&apos;t load the forecast: {err}</div>
    </Card>;
  }
  if (!fc) {
    return <Card variant="budget" title={title}>
      <div style={{ padding: 16, color: HOME_THEME.text, fontSize: 14 }}>Loading…</div>
    </Card>;
  }
  if (!fc.ok) {
    const pct = fc.status === "accumulating" && fc.need ? Math.round((fc.nHistory / fc.need) * 100) : 0;
    return <Card variant="budget" title={title}
      subtitle={fc.status === "accumulating" ? `accumulating history — ${fc.nHistory}/${fc.need} sessions` : "waiting on the Initial Balance"}>
      <div style={{ padding: "18px 16px", display: "flex", flexDirection: "column", gap: 12 }}>
        <div style={{ fontSize: 14, color: HOME_THEME.text, lineHeight: 1.5 }}>{fc.note}</div>
        {fc.status === "accumulating" && (
          <div style={{ height: 10, borderRadius: 6, background: "rgba(255,255,255,0.06)", overflow: "hidden" }}>
            <div style={{ width: `${pct}%`, height: "100%", background: HOME_THEME.orange, transition: "width .4s" }} />
          </div>
        )}
      </div>
    </Card>;
  }

  const c = chart!;
  const topPct = (px: number) => `${Math.max(1, Math.min(99, (c.y(px) / c.H) * 100))}%`;
  const markers = [
    { px: fc.predicted_poc, color: LIGHT_BLUE, label: "pred POC", dash: "3 2", side: "R" as const },
    { px: fc.realized_poc, color: HOME_THEME.text, label: "real POC", dash: "0", side: "R" as const },
    ...(fc.spot != null ? [{ px: fc.spot, color: HOME_THEME.green, label: "spot", dash: "4 2", side: "L" as const }] : []),
  ];

  return (
    <Card variant="budget" title={title}
      subtitle={`${fc.symbol} · IB→day · ${fc.nHistory} sessions · k=${fc.k}${fc.spot != null ? ` · spot ${fc.spot.toFixed(2)}` : ""}`}>

      <div style={{ display: "flex", gap: 16, alignItems: "center", marginBottom: 10, flexWrap: "wrap", fontSize: 13, color: HOME_THEME.text }}>
        <span style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <span style={{ width: 18, height: 3, background: LIGHT_BLUE, display: "inline-block", borderRadius: 2 }} /> predicted
        </span>
        <span style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <span style={{ width: 12, height: 12, background: `${HOME_THEME.text}30`, border: `1px solid ${HOME_THEME.text}`, display: "inline-block", borderRadius: 2 }} /> realized so far
        </span>
        <span style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 8 }}>
          confidence
          <span style={{
            fontWeight: 800, padding: "2px 8px", borderRadius: 999, fontSize: 12,
            color: fc.confidence >= 55 ? HOME_THEME.green : fc.confidence >= 35 ? HOME_THEME.orange : HOME_THEME.red,
            border: `1px solid ${(fc.confidence >= 55 ? HOME_THEME.green : fc.confidence >= 35 ? HOME_THEME.orange : HOME_THEME.red)}66`,
            background: `${(fc.confidence >= 55 ? HOME_THEME.green : fc.confidence >= 35 ? HOME_THEME.orange : HOME_THEME.red)}1A`,
          }}>{fc.confidence}</span>
        </span>
      </div>

      <div style={{ position: "relative", width: "100%", maxWidth: 460, height: 360, margin: "0 auto" }}>
        <svg viewBox={`0 0 100 ${c.H}`} preserveAspectRatio="none"
          style={{ position: "absolute", inset: 0, width: "100%", height: "100%", display: "block" }}>
          {/* IB band */}
          <rect x={0} y={c.y(fc.ibHigh)} width={100} height={Math.max(0, c.y(fc.ibLow) - c.y(fc.ibHigh))}
            fill={HOME_THEME.cyan} opacity={0.06} />
          {/* realized-so-far (filled) */}
          <path d={c.realizedArea} fill={`${HOME_THEME.text}22`} stroke={HOME_THEME.text} strokeWidth={0.4} />
          {/* predicted (line) */}
          <path d={c.predictedLine} fill="none" stroke={LIGHT_BLUE} strokeWidth={0.9} />
          {/* marker lines — labels live in the HTML overlay below (SVG text stretches) */}
          {markers.map((m, i) => (
            <line key={i} x1={0} y1={c.y(m.px)} x2={100} y2={c.y(m.px)} stroke={m.color}
              strokeWidth={0.5} strokeDasharray={m.dash} opacity={0.85} />
          ))}
        </svg>
        {markers.map((m, i) => (
          <div key={i} style={{
            position: "absolute", top: topPct(m.px), transform: "translateY(-50%)",
            left: m.side === "L" ? 6 : undefined, right: m.side === "R" ? 6 : undefined,
            fontSize: 11, fontWeight: 700, fontVariantNumeric: "tabular-nums", color: m.color,
            background: HOME_THEME.panel, border: `1px solid ${m.color}66`, borderRadius: 5,
            padding: "1px 6px", whiteSpace: "nowrap", pointerEvents: "none",
          }}>{m.label} {m.px.toFixed(2)}</div>
        ))}
      </div>

      <div style={{ marginTop: 10, fontSize: 13, color: HOME_THEME.text, lineHeight: 1.5 }}>
        Prediction is the average of the {fc.k} past sessions whose Initial Balance most resembles today&apos;s, re-centered on today&apos;s IB midpoint. It&apos;s a base-rate shape, not a promise — read it against where the day is actually building. Predicted value area {fc.predicted_va[0].toFixed(0)}–{fc.predicted_va[1].toFixed(0)}.
      </div>
    </Card>
  );
}
