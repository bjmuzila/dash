"use client";

/**
 * GEX Strike Ladder — SPX / SPY / QQQ + selectable 4th ticker, 4 columns.
 * React port of pages/old/gex.html. Chain data via /api/chains,
 * spot prices via /api/quotes-batch, expirations via /api/expirations.
 */

import { useCallback, useEffect, useState } from "react";

const FOURTH_TICKERS = ["AAPL", "AMD", "AMZN", "GOOGL", "META", "MSFT", "NVDA", "TSLA"];
const REFRESH_MS = 30000;

interface LadderRow {
  strike: number;
  callGEX: number;
  putGEX: number;
  netGEX: number;
}

interface LadderData {
  spot: number;
  expiration: string;
  rows: LadderRow[];
  flip: number | null;
  maxStrike: number | null;
}

function fmtB(v: number): string {
  const a = Math.abs(v);
  if (a >= 1e9) return (v / 1e9).toFixed(2) + "B";
  if (a >= 1e6) return (v / 1e6).toFixed(1) + "M";
  if (a >= 1e3) return (v / 1e3).toFixed(1) + "K";
  return v.toFixed(0);
}

function computeLadder(data: { spot?: number; expiration?: string; rows?: unknown[] }): LadderData {
  const spot = Number(data?.spot ?? 0);
  const raw = Array.isArray(data?.rows) ? data.rows : [];
  const rows: LadderRow[] = raw
    .map((r0) => {
      const r = r0 as Record<string, unknown>;
      const strike = Number(r.strike);
      const callGEX = Number(r.callGEX ?? 0) ||
        Number(r.callGamma ?? 0) * Number(r.callOI ?? 0) * 100 * spot * spot * 0.01;
      const putGEX = Number(r.putGEX ?? 0) ||
        -Number(r.putGamma ?? 0) * Number(r.putOI ?? 0) * 100 * spot * spot * 0.01;
      const netGEX = Number(r.netGEX ?? 0) || callGEX + putGEX;
      return { strike, callGEX, putGEX, netGEX };
    })
    .filter((r) => Number.isFinite(r.strike))
    .sort((a, b) => b.strike - a.strike);

  // Gamma flip: where cumulative net GEX (ascending strikes) crosses zero
  let flip: number | null = null;
  const asc = [...rows].sort((a, b) => a.strike - b.strike);
  let cum = 0;
  let prevCum = 0;
  let prevStrike: number | null = null;
  for (const r of asc) {
    prevCum = cum;
    cum += r.netGEX;
    if (prevStrike != null && prevCum < 0 && cum >= 0) { flip = r.strike; break; }
    prevStrike = r.strike;
  }
  if (flip == null && asc.length) {
    // Fallback: strike with min |cumulative|
    let best = asc[0].strike, bestAbs = Infinity;
    cum = 0;
    for (const r of asc) {
      cum += r.netGEX;
      if (Math.abs(cum) < bestAbs) { bestAbs = Math.abs(cum); best = r.strike; }
    }
    flip = best;
  }

  // Max strike: largest |net GEX|
  let maxStrike: number | null = null, maxAbs = 0;
  for (const r of rows) {
    if (Math.abs(r.netGEX) > maxAbs) { maxAbs = Math.abs(r.netGEX); maxStrike = r.strike; }
  }

  return { spot, expiration: String(data?.expiration ?? ""), rows, flip, maxStrike };
}

function LadderColumn({
  label, ticker, expiration, last, dteControls,
}: {
  label: string;
  ticker: string | null;
  expiration?: string;
  last?: boolean;
  dteControls?: React.ReactNode;
}) {
  const [data, setData] = useState<LadderData | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!ticker) return;
    try {
      const qs = new URLSearchParams({ ticker, range: "near", pageId: "gex-ladder" });
      if (expiration) qs.set("expiration", expiration);
      const res = await fetch(`/api/chains?${qs}`, { cache: "no-store" });
      if (!res.ok) throw new Error(`chains ${res.status}`);
      const json = await res.json();
      setData(computeLadder(json));
      setErr(null);
    } catch (e) {
      setErr(String(e));
    }
  }, [ticker, expiration]);

  useEffect(() => {
    setData(null);
    if (!ticker) return;
    load();
    const id = setInterval(load, REFRESH_MS);
    return () => clearInterval(id);
  }, [ticker, load]);

  const spot = data?.spot ?? 0;
  const rows = data?.rows ?? [];
  const maxAbs = Math.max(...rows.map((r) => Math.abs(r.netGEX)), 1);
  const pin = data
    ? (spot && data.flip != null ? (spot >= data.flip ? "LONG γ" : "SHORT γ") : "—")
    : "—";
  const pinColor = pin === "SHORT γ" ? "#ff4757" : "#00e676";

  return (
    <div style={{
      background: "#0d1520", borderRight: last ? "none" : "1px solid #1a2a3a",
      display: "flex", flexDirection: "column", minHeight: 0, overflow: "hidden",
    }}>
      <div style={{ padding: "12px 16px", borderBottom: "1px solid #1a2a3a", flexShrink: 0 }}>
        <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", marginBottom: 4 }}>
          <span style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
            <span style={{ fontWeight: 700, fontSize: 18, color: "#fff" }}>{label}</span>
            <span style={{ fontSize: 12, fontWeight: 600, color: "#6a8aaa" }}>
              {spot ? spot.toFixed(2) : "—"}
            </span>
          </span>
          <span style={{
            fontSize: 9, padding: "3px 10px", border: `1px solid ${pinColor}`,
            borderRadius: 20, color: pinColor, textTransform: "uppercase",
            fontWeight: 700, display: "flex", alignItems: "center", gap: 4,
          }}>
            <span style={{ width: 6, height: 6, borderRadius: "50%", background: pinColor, display: "inline-block" }} />
            {pin}
          </span>
        </div>
        <div style={{ fontSize: 11, color: "#4a6a84", fontWeight: 600, marginBottom: 12, marginTop: 3 }}>
          {data?.expiration || "—"}
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 5 }}>
          <div style={{ background: "#0a1018", borderRadius: 3, padding: "6px 8px" }}>
            <div style={{ color: "#4a6a84", fontSize: 7, textTransform: "uppercase", letterSpacing: ".06em", fontWeight: 700, marginBottom: 3 }}>Gamma Flip</div>
            <div style={{ fontWeight: 700, color: "#fff", fontSize: 12 }}>{data?.flip != null ? data.flip.toLocaleString() : "—"}</div>
          </div>
          <div style={{ background: "#0a1018", borderRadius: 3, padding: "6px 8px" }}>
            <div style={{ color: "#4a6a84", fontSize: 7, textTransform: "uppercase", letterSpacing: ".06em", fontWeight: 700, marginBottom: 3 }}>Max Strike</div>
            <div style={{ fontWeight: 700, color: "#ffd700", fontSize: 12 }}>{data?.maxStrike != null ? data.maxStrike.toLocaleString() : "—"}</div>
          </div>
        </div>
        {dteControls}
      </div>

      <div style={{ flex: 1, minHeight: 0, overflowY: "auto" }}>
        {!ticker ? (
          <div style={{ padding: 20, color: "#3a5570", textAlign: "center", fontSize: 10 }}>Select a ticker above</div>
        ) : err ? (
          <div style={{ padding: 20, color: "#ff4757", textAlign: "center", fontSize: 10 }}>{err}</div>
        ) : !rows.length ? (
          <div style={{ padding: 20, color: "#3a5570", textAlign: "center", fontSize: 10 }}>Loading…</div>
        ) : (
          rows.map((r) => {
            const pos = r.netGEX >= 0;
            const w = Math.min(100, (Math.abs(r.netGEX) / maxAbs) * 100);
            const nearSpot = spot && Math.abs(r.strike - spot) <= (spot * 0.001);
            return (
              <div key={r.strike} style={{
                display: "grid", gridTemplateColumns: "64px 1fr 70px",
                gap: 8, alignItems: "center", padding: "3px 12px",
                background: nearSpot ? "rgba(0,229,255,.08)" : "transparent",
                borderBottom: "1px solid #10192466",
              }}>
                <div style={{
                  fontSize: 11, fontWeight: 700, fontFamily: "monospace",
                  color: nearSpot ? "#00e5ff" : "#94a3b8",
                }}>
                  {r.strike.toLocaleString()}
                </div>
                <div style={{ height: 10, display: "flex", justifyContent: pos ? "flex-start" : "flex-end", background: "#0a1018", borderRadius: 2, overflow: "hidden" }}>
                  <div style={{ width: `${w}%`, background: pos ? "#00e676aa" : "#ff4757aa", borderRadius: 2 }} />
                </div>
                <div style={{ fontSize: 10, fontFamily: "monospace", textAlign: "right", color: pos ? "#00e676" : "#ff4757" }}>
                  {fmtB(r.netGEX)}
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}

export default function GexLadderPage() {
  const [ticker4, setTicker4] = useState<string | null>(null);
  const [exp4, setExp4] = useState<string>("");
  const [exp4List, setExp4List] = useState<string[]>([]);

  // Populate 4th-ticker expirations
  useEffect(() => {
    setExp4("");
    setExp4List([]);
    if (!ticker4) return;
    (async () => {
      try {
        const res = await fetch(`/api/expirations?ticker=${encodeURIComponent(ticker4)}`, { cache: "no-store" });
        if (!res.ok) return;
        const json = await res.json();
        const list: string[] = Array.isArray(json) ? json
          : Array.isArray(json?.expirations) ? json.expirations
          : Array.isArray(json?.dates) ? json.dates : [];
        setExp4List(list.map(String).slice(0, 10));
      } catch { /* proxy offline */ }
    })();
  }, [ticker4]);

  const selStyle: React.CSSProperties = {
    fontSize: 10, padding: "3px 6px", background: "#111822",
    border: "1px solid #2a4060", color: "#5a7a99", borderRadius: 2,
    fontFamily: "Arial", fontWeight: 600, textTransform: "uppercase",
  };

  return (
    <div style={{ display: "flex", flex: 1, flexDirection: "column", minHeight: 0, overflow: "hidden", background: "#070b11" }}>
      {/* Header */}
      <div style={{
        padding: "8px 16px", background: "#0a0f16", borderBottom: "1px solid #1e3050",
        display: "flex", alignItems: "center", justifyContent: "space-between", flexShrink: 0,
      }}>
        <span style={{ fontSize: 11, fontWeight: 700, color: "#3a5570", textTransform: "uppercase", letterSpacing: ".08em" }}>
          GEX Strike Ladder <span style={{ color: "#3a5570", fontWeight: 400, fontSize: 9 }}>· nearest expiration</span>
        </span>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <label style={{ fontSize: 9, color: "#3a5570", fontWeight: 700, textTransform: "uppercase" }}>4th Ticker:</label>
          <select
            value={ticker4 ?? ""}
            onChange={(e) => setTicker4(e.target.value || null)}
            style={{ ...selStyle, width: 100 }}
          >
            <option value="">— Select —</option>
            {FOURTH_TICKERS.map((t) => <option key={t} value={t}>{t}</option>)}
          </select>
          <label style={{ fontSize: 9, color: "#3a5570", fontWeight: 700, textTransform: "uppercase" }}>4th Exp:</label>
          <select
            value={exp4}
            onChange={(e) => setExp4(e.target.value)}
            disabled={!ticker4}
            style={{ ...selStyle, cursor: ticker4 ? "pointer" : "not-allowed" }}
          >
            <option value="">{ticker4 ? "Nearest" : "Select ticker first"}</option>
            {exp4List.map((x) => <option key={x} value={x}>{x}</option>)}
          </select>
        </div>
      </div>

      {/* 4 columns */}
      <div style={{ flex: 1, minHeight: 0, display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 0, overflow: "hidden" }}>
        <LadderColumn label="SPX" ticker="SPX" />
        <LadderColumn label="SPY" ticker="SPY" />
        <LadderColumn label="QQQ" ticker="QQQ" />
        <LadderColumn label={ticker4 ?? "— Select —"} ticker={ticker4} expiration={exp4 || undefined} last />
      </div>
    </div>
  );
}
