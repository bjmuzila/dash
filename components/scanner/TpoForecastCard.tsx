"use client";
import { useEffect, useState } from "react";
import { HOME_THEME, LIGHT_BLUE } from "@/components/shared/homeTheme";
import { Card } from "@/components/shared/PageCard";

// Compact TPO forecast — one-line base-rate stat, no chart.
// The k-NN over tpo_profiles finds the K past sessions whose Initial Balance most
// resembles today's and reports where those analog days settled value. It's a
// soft base rate, not a level to trade — so it earns one line, not a panel.

type Forecast = {
  ok: true; symbol: string; k: number; confidence: number; spot: number | null;
  predicted_poc: number; realized_poc: number;
  predicted_va: [number, number]; realized_va: [number, number];
} | {
  ok: false; status: "accumulating" | "pre_ib"; nHistory: number; need?: number; note: string;
};

const title = <span style={{ fontSize: 15, color: HOME_THEME.orange }}>Forecast</span>;

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

  const line = (node: React.ReactNode, sub?: string) => (
    <Card variant="budget" title={title} subtitle={sub}>
      <div style={{ fontSize: 14, color: HOME_THEME.text, lineHeight: 1.5 }}>{node}</div>
    </Card>
  );

  if (err) return line(<span style={{ color: HOME_THEME.text }}>Couldn&apos;t load: {err}</span>);
  if (!fc) return line("Loading…");
  if (!fc.ok) {
    return line(
      fc.status === "accumulating"
        ? `Accumulating history — ${fc.nHistory}/${fc.need ?? 40} sessions.`
        : "Waiting on the Initial Balance (first hour) to complete.",
      fc.status === "accumulating" ? "IB → day base rate" : "lights up at 10:30 ET",
    );
  }

  return line(
    <span>
      Similar opens (n={fc.k}) settled value{" "}
      <b style={{ fontVariantNumeric: "tabular-nums" }}>{fc.predicted_va[0].toFixed(0)}–{fc.predicted_va[1].toFixed(0)}</b>
      {" · "}POC <b style={{ color: LIGHT_BLUE, fontVariantNumeric: "tabular-nums" }}>{fc.predicted_poc.toFixed(2)}</b>
      {fc.spot != null && <> {" · "}spot <b style={{ fontVariantNumeric: "tabular-nums" }}>{fc.spot.toFixed(2)}</b></>}
    </span>,
    `${fc.symbol} · IB → day · conf ${fc.confidence}`,
  );
}
