"use client";

import { useEffect, useMemo, useState } from "react";
import { HOME_THEME, LIGHT_BLUE } from "@/components/shared/homeTheme";
import { PageShell, Card } from "@/components/shared/PageCard";
import { useNqCandles } from "@/hooks/useNqCandles";

// ── Live tuning ──────────────────────────────────────────────────────────────
const GEX_POLL_MS = 60_000;
const DMA_LEN = 10;
// Slope is "flat" when the 10-DMA moved less than this fraction day-over-day.
const FLAT_BAND = 0.0008; // 0.08%

type Tone = "bull" | "transition" | "bear";
const TONE: Record<Tone, string> = {
  bull: HOME_THEME.green,
  transition: HOME_THEME.orange,
  bear: HOME_THEME.red,
};

type Slope = "incline" | "flat" | "decline";
type Regime = "above" | "below";

const COLS: { key: Slope; label: string; arrow: string; tone: Tone }[] = [
  { key: "incline", label: "Inclining", arrow: "↗", tone: "bull" },
  { key: "flat", label: "Flat", arrow: "→", tone: "transition" },
  { key: "decline", label: "Declining", arrow: "↘", tone: "bear" },
];

const ROWS: {
  key: Regime;
  label: string;
  sub: string;
  cells: { title: string; tone: Tone; slope: Slope }[];
}[] = [
  {
    key: "above",
    label: "SPX Above Flip",
    sub: "Positive Gamma",
    cells: [
      { title: "Bull Strong", tone: "bull", slope: "incline" },
      { title: "Potential Transition", tone: "transition", slope: "flat" },
      { title: "Bull Weak", tone: "bull", slope: "decline" },
    ],
  },
  {
    key: "below",
    label: "SPX Below Flip",
    sub: "Negative Gamma",
    cells: [
      { title: "Bear Weak", tone: "bear", slope: "incline" },
      { title: "Potential Transition", tone: "transition", slope: "flat" },
      { title: "Bear Strong", tone: "bear", slope: "decline" },
    ],
  },
];

// ── 10-DMA slope from NQ (NASDAQ futures) daily closes ───────────────────────
function sma(series: number[], len: number): number[] {
  const out: number[] = [];
  for (let i = 0; i < series.length; i++) {
    if (i + 1 < len) { out.push(NaN); continue; }
    let s = 0;
    for (let j = i + 1 - len; j <= i; j++) s += series[j];
    out.push(s / len);
  }
  return out;
}

function useNqDmaSlope(): { slope: Slope | null; ma: number | null; rel: number | null } {
  const { historical } = useNqCandles(true, 30);
  return useMemo(() => {
    // Last bar of each day = that day's close.
    const byDay = new Map<string, { ts: number; close: number }>();
    for (const c of historical) {
      const d = c.date ?? (c.slotKey ?? "").slice(0, 10);
      const close = Number(c.close);
      if (!d || !Number.isFinite(close)) continue;
      const prev = byDay.get(d);
      if (!prev || c.timestamp > prev.ts) byDay.set(d, { ts: c.timestamp, close });
    }
    const closes = [...byDay.entries()].sort((a, b) => a[0].localeCompare(b[0])).map((e) => e[1].close);
    if (closes.length < DMA_LEN + 1) return { slope: null, ma: null, rel: null };
    const line = sma(closes, DMA_LEN);
    const ma = line[line.length - 1];
    const maPrev = line[line.length - 2];
    if (!Number.isFinite(ma) || !Number.isFinite(maPrev) || maPrev === 0)
      return { slope: null, ma: null, rel: null };
    const rel = (ma - maPrev) / maPrev;
    const slope: Slope = rel > FLAT_BAND ? "incline" : rel < -FLAT_BAND ? "decline" : "flat";
    return { slope, ma, rel };
  }, [historical]);
}

// ── Gamma regime from /api/gex (spot vs flip) ────────────────────────────────
function useGammaRegime(): { regime: Regime | null; spot: number | null; flip: number | null } {
  const [s, setS] = useState<{ regime: Regime | null; spot: number | null; flip: number | null }>({
    regime: null, spot: null, flip: null,
  });
  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const r = await fetch("/api/gex", { cache: "no-store" });
        if (!r.ok) return;
        const j = await r.json();
        const spot = Number(j?.spotPrice ?? 0);
        const flip = Number(j?.gexFlip ?? 0);
        if (cancelled) return;
        if (spot > 0 && flip > 0) setS({ regime: spot >= flip ? "above" : "below", spot, flip });
        else setS((p) => ({ ...p, spot: spot > 0 ? spot : p.spot, flip: flip > 0 ? flip : p.flip }));
      } catch { /* leave last-known */ }
    };
    load();
    const id = setInterval(load, GEX_POLL_MS);
    return () => { cancelled = true; clearInterval(id); };
  }, []);
  return s;
}

function Cell({
  title, tone, active, resolved,
}: { title: string; tone: Tone; active: boolean; resolved: boolean }) {
  const c = TONE[tone];
  const dim = resolved && !active;
  return (
    <div
      style={{
        position: "relative",
        borderRadius: 14,
        border: `1px solid ${active ? c : HOME_THEME.border}`,
        borderLeft: `4px solid ${c}`,
        background: active
          ? `radial-gradient(circle at 50% 0%, ${c}22 0%, transparent 70%), ${HOME_THEME.panelBgStrong}`
          : HOME_THEME.panelBg,
        boxShadow: active ? `0 0 24px ${c}44` : "none",
        padding: "34px 20px",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        minHeight: 120,
        textAlign: "center",
        opacity: dim ? 0.32 : 1,
        transition: "opacity .2s, box-shadow .2s, border-color .2s",
      }}
    >
      <span style={{ fontSize: 22, fontWeight: 800, letterSpacing: "0.02em", textTransform: "uppercase", color: c, lineHeight: 1.15 }}>
        {title}
      </span>
    </div>
  );
}

export default function MarketMatrixPage() {
  const { regime, spot, flip } = useGammaRegime();
  const { slope, ma, rel } = useNqDmaSlope();
  const resolved = regime != null && slope != null;
  const grid = "180px repeat(3, 1fr)";

  const activeName = resolved
    ? ROWS.find((r) => r.key === regime)!.cells.find((c) => c.slope === slope)!.title
    : "Awaiting live data";

  const fmt = (n: number | null, d = 2) => (n == null ? "—" : n.toLocaleString(undefined, { maximumFractionDigits: d }));

  return (
    <PageShell>
      <Card variant="budget" accent={LIGHT_BLUE} title="Market Conditions Matrix" subtitle="Gamma Regime × Directional Momentum · Live">
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          {/* Live status strip */}
          <div
            style={{
              display: "flex", flexWrap: "wrap", gap: 20, alignItems: "baseline",
              padding: "10px 14px", borderRadius: 12,
              background: HOME_THEME.panelBg, border: `1px solid ${HOME_THEME.border}`,
            }}
          >
            {[
              { k: "SPX", v: fmt(spot) },
              { k: "Gamma Flip", v: fmt(flip) },
              { k: "Regime", v: regime === "above" ? "Above · +γ" : regime === "below" ? "Below · −γ" : "—" },
              { k: "NQ 10 DMA", v: fmt(ma, 0) },
              { k: "DMA Slope", v: rel == null ? "—" : `${(rel * 100).toFixed(2)}%` },
            ].map((x) => (
              <span key={x.k} style={{ display: "inline-flex", gap: 6, alignItems: "baseline" }}>
                <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: "0.14em", textTransform: "uppercase", color: HOME_THEME.green }}>{x.k}</span>
                <span style={{ fontSize: 14, fontWeight: 800, color: HOME_THEME.text }}>{x.v}</span>
              </span>
            ))}
            <span style={{ marginLeft: "auto", fontSize: 13, fontWeight: 800, letterSpacing: "0.06em", textTransform: "uppercase", color: resolved ? HOME_THEME.text : HOME_THEME.green }}>
              {activeName}
            </span>
          </div>

          {/* Column headers */}
          <div style={{ display: "grid", gridTemplateColumns: grid, gap: 16, alignItems: "end" }}>
            <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: "0.16em", textTransform: "uppercase", color: HOME_THEME.green, textAlign: "center", paddingBottom: 4 }}>
              NASDAQ 10 DMA Slope
            </div>
            {COLS.map((col) => {
              const on = slope === col.key;
              return (
                <div key={col.key} style={{ textAlign: "center", opacity: resolved && !on ? 0.4 : 1 }}>
                  <div style={{ fontSize: 22, color: TONE[col.tone], lineHeight: 1 }}>{col.arrow}</div>
                  <div style={{ marginTop: 6, fontSize: 11, fontWeight: 700, letterSpacing: "0.16em", textTransform: "uppercase", color: HOME_THEME.text }}>{col.label}</div>
                </div>
              );
            })}
          </div>

          {/* Rows */}
          {ROWS.map((row) => {
            const rowOn = regime === row.key;
            return (
              <div key={row.key} style={{ display: "grid", gridTemplateColumns: grid, gap: 16, alignItems: "stretch" }}>
                <div style={{ display: "flex", flexDirection: "column", justifyContent: "center", gap: 4, opacity: resolved && !rowOn ? 0.4 : 1 }}>
                  <div style={{ fontSize: 13, fontWeight: 800, letterSpacing: "0.1em", textTransform: "uppercase", color: HOME_THEME.text }}>{row.label}</div>
                  <div style={{ fontSize: 10, fontWeight: 600, letterSpacing: "0.14em", textTransform: "uppercase", color: HOME_THEME.green }}>{row.sub}</div>
                </div>
                {row.cells.map((cell) => (
                  <Cell key={cell.title + cell.slope} title={cell.title} tone={cell.tone} active={rowOn && slope === cell.slope} resolved={resolved} />
                ))}
              </div>
            );
          })}

          {/* Legend */}
          <div style={{ marginTop: 8, display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 24, borderTop: `1px solid ${HOME_THEME.border}`, paddingTop: 16 }}>
            {[
              { k: "Input 01", t: "Gamma Regime", d: "SPX spot vs the gamma flip line (live from /api/gex)." },
              { k: "Input 02", t: "Trend Momentum", d: "Slope of the NQ 10-day moving average." },
              { k: "Output", t: "Six Regimes", d: "Each regime maps to its own strategy & sizing playbook." },
            ].map((x) => (
              <div key={x.k}>
                <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: "0.16em", textTransform: "uppercase", color: HOME_THEME.green }}>{x.k}</div>
                <div style={{ fontSize: 13, fontWeight: 800, letterSpacing: "0.1em", textTransform: "uppercase", color: HOME_THEME.text, marginTop: 4 }}>{x.t}</div>
                <div style={{ fontSize: 12, color: HOME_THEME.text, opacity: 0.6, marginTop: 4, lineHeight: 1.5 }}>{x.d}</div>
              </div>
            ))}
          </div>
        </div>
      </Card>
    </PageShell>
  );
}
