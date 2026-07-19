"use client";

/* ────────────────────────────────────────────────────────────────────────────
 * Volatility Skew Calculator + If-This-Then-That matrix
 *
 *   skew = (OTM_Put_IV − OTM_Call_IV) / ATM_IV
 *
 * Positive skew (typically 10–30% for equities) = bearish fear (puts richer).
 * Use 25-delta or a fixed % OTM (±5–10% from spot) for consistency.
 *
 * Pure client component: three IV inputs (OTM put, OTM call, ATM) → live skew %
 * plus a highlighted regime band and an if-this-then-that lookup table.
 * ──────────────────────────────────────────────────────────────────────────── */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { HOME_THEME, LIGHT_BLUE, homeInputStyle } from "@/components/shared/homeTheme";

/* ── Live SPX 0DTE auto-fill ──────────────────────────────────────────────────
 * Pulls the active-expiry (0DTE) chain from /api/gex — the same feed the Greeks
 * page / GEX heatmap use — and derives the three IVs the skew needs:
 *   • OTM put IV  = strike whose |putDelta| is nearest 0.25 (25Δ), below spot
 *   • OTM call IV = strike whose callDelta is nearest 0.25 (25Δ), above spot
 *   • ATM IV      = strike nearest spot (avg of call/put IV)
 * IV fields arrive as decimals (0.15) → shown as percent (15.0).
 * ──────────────────────────────────────────────────────────────────────────── */
export interface ChainRow {
  strike: number;
  callIV?: number;
  putIV?: number;
  callDelta?: number;
  putDelta?: number;
}
export interface SkewPick {
  put: number; call: number; atm: number;        // IVs as percent
  putK: number; callK: number; atmK: number;      // source strikes
  spot: number; expiry: string | null; ts: number;
}
const TARGET_DELTA = 0.25;

export function derivePick(rows: ChainRow[], spot: number, expiry: string | null): SkewPick | null {
  if (!rows.length || !(spot > 0)) return null;
  const valid = rows.filter(r => Number.isFinite(r.strike));
  if (!valid.length) return null;

  // ATM: strike nearest spot; IV = mean of call/put where present.
  const atmRow = valid.reduce((best, r) =>
    Math.abs(r.strike - spot) < Math.abs(best.strike - spot) ? r : best, valid[0]);
  const atmIvs = [atmRow.callIV, atmRow.putIV].filter((v): v is number => Number.isFinite(v) && (v as number) > 0);
  if (!atmIvs.length) return null;
  const atm = (atmIvs.reduce((s, v) => s + v, 0) / atmIvs.length) * 100;

  // OTM call: strike above spot with callDelta nearest 0.25 (fallback ~+5%).
  const calls = valid.filter(r => r.strike > spot && Number.isFinite(r.callIV) && (r.callIV as number) > 0);
  const puts  = valid.filter(r => r.strike < spot && Number.isFinite(r.putIV)  && (r.putIV  as number) > 0);
  if (!calls.length || !puts.length) return null;

  const pickBy = (arr: ChainRow[], delta: (r: ChainRow) => number | undefined, fallbackK: number) => {
    const withD = arr.filter(r => Number.isFinite(delta(r)) && Math.abs(delta(r) as number) > 0);
    if (withD.length) {
      return withD.reduce((best, r) =>
        Math.abs(Math.abs(delta(r) as number) - TARGET_DELTA) < Math.abs(Math.abs(delta(best) as number) - TARGET_DELTA) ? r : best, withD[0]);
    }
    // no deltas → nearest strike to the ±5% fallback level
    return arr.reduce((best, r) => Math.abs(r.strike - fallbackK) < Math.abs(best.strike - fallbackK) ? r : best, arr[0]);
  };
  const callRow = pickBy(calls, r => r.callDelta, spot * 1.05);
  const putRow  = pickBy(puts,  r => r.putDelta,  spot * 0.95);

  return {
    put: (putRow.putIV as number) * 100,
    call: (callRow.callIV as number) * 100,
    atm,
    putK: putRow.strike, callK: callRow.strike, atmK: atmRow.strike,
    spot, expiry, ts: Date.now(),
  };
}

// Skew regime bands (skew expressed as a percentage: 100 * (Pput−Pcall)/ATM).
export interface Band {
  id: string;
  lo: number;              // inclusive lower bound (%)
  hi: number;              // exclusive upper bound (%)
  label: string;
  tone: "bear" | "neutral" | "bull" | "extreme";
  ifThis: string;
  thenThat: string;
}

export const COLORS = {
  bear: "#ff5252",
  neutral: "#9fb3c8",
  bull: "#00e676",
  extreme: "#ff8c1a",
} as const;

// Ordered low→high. Bounds in percent.
export const BANDS: Band[] = [
  {
    id: "inverted", lo: -Infinity, hi: 0, tone: "bull",
    label: "Inverted / Call Skew",
    ifThis: "Skew < 0% — OTM calls richer than OTM puts.",
    thenThat: "Upside/melt-up or squeeze demand (call chasing, commodities-like). Right-tail hedging or bullish speculation dominant. Favor call spreads over naked longs; watch for a fast vol-up move that flips skew back positive.",
  },
  {
    id: "flat", lo: 0, hi: 10, tone: "neutral",
    label: "Flat / Complacent",
    ifThis: "Skew 0–10% — unusually flat for equity index.",
    thenThat: "Low fear premium; puts cheap relative to ATM. Good backdrop to BUY downside protection / put spreads cheaply. Complacency risk — a shock can re-steepen skew violently.",
  },
  {
    id: "normal", lo: 10, hi: 30, tone: "neutral",
    label: "Normal Equity Skew",
    ifThis: "Skew 10–30% — the typical equity-index regime.",
    thenThat: "Balanced fear premium. No skew edge on its own — trade the underlying thesis. Put-selling / put-spread financing works; puts are moderately rich, so prefer spreads to naked long puts.",
  },
  {
    id: "steep", lo: 30, hi: 45, tone: "bear",
    label: "Steep / Elevated Fear",
    ifThis: "Skew 30–45% — puts materially bid.",
    thenThat: "Rising downside hedging demand — defensive positioning building. Favor put SPREADS or ratio structures (long put financed by richer further-OTM puts). Selling puts pays well but carries real tail risk; size down.",
  },
  {
    id: "extreme", lo: 45, hi: Infinity, tone: "extreme",
    label: "Extreme / Panic Skew",
    ifThis: "Skew > 45% — crash-fear pricing.",
    thenThat: "Capitulation-grade put demand; downside convexity very rich. Fade the fear: sell put spreads / put ratios, or harvest skew via risk reversals. Often near local BOTTOMS once spot stabilizes — but never sell naked into a falling tape.",
  },
];

export function bandFor(skewPct: number): Band {
  return BANDS.find(b => skewPct >= b.lo && skewPct < b.hi) ?? BANDS[2];
}

function parseNum(s: string): number | null {
  if (s.trim() === "") return null;
  const v = Number(s);
  return Number.isFinite(v) ? v : null;
}

export default function SkewCalculator() {
  const [putIv, setPutIv] = useState("");   // OTM put IV, %
  const [callIv, setCallIv] = useState(""); // OTM call IV, %
  const [atmIv, setAtmIv] = useState("");   // ATM IV, %

  // ── Live SPX 0DTE auto-fill ──
  const [linked, setLinked] = useState(true);         // true = auto-fill from feed
  const [pick, setPick] = useState<SkewPick | null>(null);
  const [loading, setLoading] = useState(false);
  const [feedErr, setFeedErr] = useState(false);
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);

  const applyPick = useCallback((sp: SkewPick) => {
    setPutIv(sp.put.toFixed(1));
    setCallIv(sp.call.toFixed(1));
    setAtmIv(sp.atm.toFixed(1));
  }, []);

  const fetchLive = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/gex", { cache: "no-store" });
      const j = res.ok ? await res.json() : null;
      const sp = j ? derivePick(
        (Array.isArray(j.chain) ? j.chain : []) as ChainRow[],
        Number(j.spotPrice ?? 0),
        j.expiration ?? null,
      ) : null;
      if (!mounted.current) return;
      if (sp) { setPick(sp); setFeedErr(false); if (linked) applyPick(sp); }
      else setFeedErr(true);
    } catch { if (mounted.current) setFeedErr(true); }
    finally { if (mounted.current) setLoading(false); }
  }, [linked, applyPick]);

  // Poll the 0DTE chain every 60s while linked; one-shot pull when re-linked.
  useEffect(() => {
    if (!linked) return;
    fetchLive();
    const t = setInterval(fetchLive, 60_000);
    return () => clearInterval(t);
  }, [linked, fetchLive]);

  // Editing an input breaks the live link until the user re-links.
  const editPut  = (v: string) => { setLinked(false); setPutIv(v); };
  const editCall = (v: string) => { setLinked(false); setCallIv(v); };
  const editAtm  = (v: string) => { setLinked(false); setAtmIv(v); };
  const relink = () => { setLinked(true); if (pick) applyPick(pick); };

  const p = parseNum(putIv);
  const c = parseNum(callIv);
  const a = parseNum(atmIv);

  const skewPct = useMemo(() => {
    if (p == null || c == null || a == null || a <= 0) return null;
    return ((p - c) / a) * 100;
  }, [p, c, a]);

  const spread = p != null && c != null ? p - c : null; // raw vol points
  const active = skewPct != null ? bandFor(skewPct) : null;

  const inputRow = (
    label: string, hint: string, val: string,
    set: (v: string) => void, accent: string,
  ) => (
    <div style={{ flex: "1 1 150px", minWidth: 140 }}>
      <div style={{ fontSize: 14, color: "#9fb3c8", fontWeight: 700, letterSpacing: ".06em", textTransform: "uppercase", marginBottom: 4 }}>
        {label}
      </div>
      <div style={{ position: "relative" }}>
        <input
          type="number" inputMode="decimal" placeholder={hint} value={val}
          onChange={(e) => set(e.target.value)}
          style={{ ...homeInputStyle, width: "100%", paddingRight: 30, borderColor: `${accent}55`, fontFamily: "var(--font-mono)", fontSize: 17, fontWeight: 700 }}
        />
        <span style={{ position: "absolute", right: 10, top: "50%", transform: "translateY(-50%)", fontSize: 14, color: "#7e8ea0", fontWeight: 700 }}>%</span>
      </div>
    </div>
  );

  return (
    <section className="card-hover" style={{
      marginTop: 14, border: `1px solid ${HOME_THEME.border}`, borderRadius: 16, padding: 16,
      backdropFilter: "blur(16px)",
      background: `radial-gradient(circle at 50% 0%, rgba(126,211,252,0.12) 0%, transparent 60%), ${HOME_THEME.panelBg}`,
    }}>
      {/* Header */}
      <div style={{ display: "flex", alignItems: "center", gap: 9, marginBottom: 12, flexWrap: "wrap" }}>
        <div style={{
          width: 30, height: 30, borderRadius: 8, border: `1px solid ${LIGHT_BLUE}66`,
          display: "flex", alignItems: "center", justifyContent: "center", color: LIGHT_BLUE, fontWeight: 800, fontSize: 14,
        }}>◱</div>
        <div>
          <div style={{ fontSize: 20, fontWeight: 800, color: "#eef7ff", letterSpacing: ".04em" }}>Vol Skew Calculator</div>
          <div style={{ fontSize: 14, color: LIGHT_BLUE, fontWeight: 700, letterSpacing: ".12em", textTransform: "uppercase" }}>
            (OTM Put IV − OTM Call IV) / ATM IV
          </div>
        </div>

        {/* Live-link control */}
        <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 14, fontWeight: 800, letterSpacing: ".06em",
            color: feedErr ? "#ff5252" : linked ? "#00e676" : "#7e8ea0" }}>
            <span style={{ width: 7, height: 7, borderRadius: "50%",
              background: feedErr ? "#ff5252" : linked ? "#00e676" : "#7e8ea0",
              boxShadow: linked && !feedErr ? "0 0 8px #00e676" : "none" }} />
            {feedErr ? "FEED ERR" : linked ? (loading ? "SYNCING…" : "LIVE SPX 0DTE") : "MANUAL"}
          </span>
          {linked ? (
            <button onClick={fetchLive} disabled={loading} title="Refresh 0DTE IVs"
              style={{ ...homeInputStyle, padding: "6px 12px", fontSize: 14, fontWeight: 800, letterSpacing: ".06em",
                textTransform: "uppercase", cursor: loading ? "wait" : "pointer", borderColor: `${LIGHT_BLUE}55`, color: LIGHT_BLUE }}>↻ Sync</button>
          ) : (
            <button onClick={relink} title="Re-link to live SPX 0DTE IVs"
              style={{ ...homeInputStyle, padding: "6px 12px", fontSize: 14, fontWeight: 800, letterSpacing: ".06em",
                textTransform: "uppercase", cursor: "pointer", borderColor: "#00e67655", color: "#00e676" }}>⟲ Link live</button>
          )}
        </div>
      </div>

      {/* Source line — which SPX 0DTE strikes feed the calc */}
      {pick && (
        <div style={{ fontSize: 14, color: "#9fb3c8", fontWeight: 600, marginBottom: 10, fontFamily: "var(--font-mono)" }}>
          SPX 0DTE{pick.expiry ? ` ${pick.expiry}` : ""} · spot {pick.spot.toFixed(0)} · 25Δ put {pick.putK}
          {" "}· 25Δ call {pick.callK} · ATM {pick.atmK}
        </div>
      )}

      {/* Inputs */}
      <div style={{ display: "flex", gap: 12, flexWrap: "wrap", alignItems: "flex-end" }}>
        {inputRow("OTM Put IV", "25Δ / −5-10%", putIv, editPut, COLORS.bear)}
        {inputRow("OTM Call IV", "25Δ / +5-10%", callIv, editCall, COLORS.bull)}
        {inputRow("ATM IV", "spot IV", atmIv, editAtm, LIGHT_BLUE)}

        {/* Result */}
        <div style={{
          flex: "1 1 160px", minWidth: 150, padding: "10px 14px", borderRadius: 12,
          border: `1px solid ${active ? COLORS[active.tone] : HOME_THEME.border}55`,
          background: active ? `${COLORS[active.tone]}12` : "rgba(0,0,0,0.25)",
        }}>
          <div style={{ fontSize: 14, color: "#9fb3c8", fontWeight: 700, letterSpacing: ".06em", textTransform: "uppercase" }}>Skew</div>
          <div style={{ fontSize: 38, fontWeight: 900, fontFamily: "var(--font-mono)", color: active ? COLORS[active.tone] : "#9fb3c8", lineHeight: 1.1 }}>
            {skewPct != null ? `${skewPct >= 0 ? "+" : ""}${skewPct.toFixed(1)}%` : "--"}
          </div>
          <div style={{ fontSize: 14, color: "#c9d7db", fontWeight: 700, marginTop: 2 }}>
            {spread != null ? `${spread >= 0 ? "+" : ""}${spread.toFixed(2)} vol pts` : "enter three IVs"}
          </div>
        </div>
      </div>

      {/* Live interpretation */}
      {active && (
        <div style={{
          marginTop: 12, padding: "10px 14px", borderRadius: 10,
          borderLeft: `3px solid ${COLORS[active.tone]}`, background: `${COLORS[active.tone]}0e`,
        }}>
          <div style={{ fontSize: 17, fontWeight: 800, color: COLORS[active.tone], marginBottom: 3 }}>{active.label}</div>
          <div style={{ fontSize: 14, color: "#d7e6e8", lineHeight: 1.5 }}>{active.thenThat}</div>
        </div>
      )}

      {/* If-this-then-that matrix */}
      <div style={{ marginTop: 14, border: `1px solid ${HOME_THEME.border}`, borderRadius: 10, overflow: "hidden" }}>
        <div style={{ display: "grid", gridTemplateColumns: "minmax(120px,1.1fr) minmax(150px,1.4fr) minmax(200px,2.4fr)", background: "rgba(255,255,255,.04)", borderBottom: `1px solid ${HOME_THEME.border}` }}>
          {["Skew band", "If this", "Then that"].map((h) => (
            <div key={h} style={{ padding: "8px 12px", fontSize: 14, fontWeight: 800, color: "#9fb3c8", letterSpacing: ".08em", textTransform: "uppercase" }}>{h}</div>
          ))}
        </div>
        {BANDS.map((b) => {
          const isActive = active?.id === b.id;
          return (
            <div key={b.id} style={{
              display: "grid", gridTemplateColumns: "minmax(120px,1.1fr) minmax(150px,1.4fr) minmax(200px,2.4fr)",
              borderBottom: `1px solid rgba(255,255,255,.05)`,
              borderLeft: `3px solid ${isActive ? COLORS[b.tone] : "transparent"}`,
              background: isActive ? `${COLORS[b.tone]}12` : "transparent",
            }}>
              <div style={{ padding: "10px 12px" }}>
                <div style={{ fontSize: 14, fontWeight: 800, color: COLORS[b.tone] }}>{b.label}</div>
                <div style={{ fontSize: 14, color: "#7e8ea0", fontFamily: "var(--font-mono)", marginTop: 2 }}>
                  {b.lo === -Infinity ? "< 0%" : b.hi === Infinity ? `> ${b.lo}%` : `${b.lo}–${b.hi}%`}
                </div>
              </div>
              <div style={{ padding: "10px 12px", fontSize: 14, color: "#c9d7db", lineHeight: 1.45 }}>{b.ifThis}</div>
              <div style={{ padding: "10px 12px", fontSize: 14, color: "#d7e6e8", lineHeight: 1.45 }}>{b.thenThat}</div>
            </div>
          );
        })}
      </div>

      <div style={{ marginTop: 10, fontSize: 14, color: "#7e8ea0", lineHeight: 1.5 }}>
        Convention: positive skew = puts richer = downside fear. Keep the put/call legs at a consistent moneyness
        (25-delta, or a fixed ±5-10% from spot) so readings are comparable across sessions.
      </div>
    </section>
  );
}
