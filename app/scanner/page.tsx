"use client";

/**
 * /scanner — three-tab scanner:
 *   GEX Change Scanner  — cross-ticker GEX anomaly leaderboard (stocks)
 *   Greeks Sensitivity  — per-strike Charm / Vanna / Gamma / TG-Imbalance for SPX
 *   Vol Pin             — IV-RV spread contraction + price range tightening → pin candidates
 */

import { useCallback, useEffect, useState } from "react";
import { HOME_THEME } from "@/components/shared/homeTheme";
import { PageShell, Card } from "@/components/shared/PageCard";

// ── shared types / helpers ────────────────────────────────────────────────────

const NEUTRAL = "#6B7280";

const fmtB = (n: number) => {
  const a = Math.abs(n), s = n < 0 ? "-" : "+";
  if (a >= 1e9) return `${s}${(a / 1e9).toFixed(2)}B`;
  if (a >= 1e6) return `${s}${(a / 1e6).toFixed(1)}M`;
  if (a >= 1e3) return `${s}${(a / 1e3).toFixed(1)}K`;
  return `${s}${a.toFixed(0)}`;
};

// ── style helpers ─────────────────────────────────────────────────────────────

const th: React.CSSProperties = { padding: "6px 10px", textAlign: "right", fontWeight: 700, letterSpacing: "0.05em" };
const td: React.CSSProperties = { padding: "6px 10px", textAlign: "right", color: HOME_THEME.text };

const seg = (active: boolean): React.CSSProperties => ({
  padding: "6px 14px", borderRadius: 8, fontSize: 12, cursor: "pointer", fontWeight: 700,
  border: `1px solid ${active ? HOME_THEME.cyan : "rgba(255,255,255,0.15)"}`,
  background: active ? "rgba(33,158,188,0.15)" : "transparent",
  color: active ? HOME_THEME.text : "rgba(255,255,255,0.7)",
});

const zColor = (z: number | null) =>
  z == null ? "rgba(255,255,255,0.4)"
  : Math.abs(z) >= 3 ? HOME_THEME.red
  : Math.abs(z) >= 2 ? HOME_THEME.orange
  : HOME_THEME.text;

// ── top-level tab ─────────────────────────────────────────────────────────────

type MainTab = "gex" | "greeks" | "volpin";

// ══════════════════════════════════════════════════════════════════════════════
//  GEX CHANGE SCANNER (original tab)
// ══════════════════════════════════════════════════════════════════════════════

type GexRow = {
  symbol: string;
  expiry: string;
  strike: number;
  latest_chg: number;
  mean_chg: number;
  sd_chg: number;
  n: number;
  z: number | null;
};
type Win = 15 | 30 | 60;
type GexSort = "z" | "abs";

function GexScanner() {
  const [rows, setRows] = useState<GexRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [win, setWin] = useState<Win>(15);
  const [sort, setSort] = useState<GexSort>("z");
  const [minZ, setMinZ] = useState(0);

  const load = useCallback(async () => {
    setLoading(true); setErr(null);
    try {
      const u = new URL("/proxy/strike-growth/scanner", window.location.origin);
      u.searchParams.set("window", String(win));
      u.searchParams.set("sort", sort);
      u.searchParams.set("minZ", String(minZ));
      u.searchParams.set("limit", "25");
      const res = await fetch(u.toString(), { cache: "no-store" });
      const text = await res.text();
      let j: any;
      try { j = JSON.parse(text); } catch { throw new Error(`Server returned ${res.status} (non-JSON). Recorder may not have run yet.`); }
      if (!j.ok) throw new Error(j.error || "load failed");
      setRows(j.rows || []);
    } catch (e: any) { setErr(String(e?.message || e)); }
    finally { setLoading(false); }
  }, [win, sort, minZ]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => { const t = setInterval(() => load(), 60_000); return () => clearInterval(t); }, [load]);

  return (
    <Card accent={NEUTRAL} title="GEX Change Scanner"
      subtitle={`Stocks only · biggest ${win}m moves${sort === "z" ? " ranked by anomaly" : " by size"}${loading ? " · refreshing…" : ""}`}>

      <div style={{ display: "flex", flexWrap: "wrap", gap: 12, alignItems: "center", marginBottom: 16 }}>
        <div style={{ display: "flex", gap: 6 }}>
          {([15, 30, 60] as Win[]).map((w) => (
            <button key={w} onClick={() => setWin(w)} style={seg(win === w)}>{w}m</button>
          ))}
        </div>
        <span style={{ color: HOME_THEME.border }}>|</span>
        <div style={{ display: "flex", gap: 6 }}>
          <button onClick={() => setSort("z")} style={seg(sort === "z")}>Most unusual (z)</button>
          <button onClick={() => setSort("abs")} style={seg(sort === "abs")}>Biggest (size)</button>
        </div>
        <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, color: HOME_THEME.green }}>
          min z
          <select value={minZ} onChange={(e) => setMinZ(Number(e.target.value))}
            style={{ fontSize: 12, padding: "6px 10px", borderRadius: 6, background: "rgba(0,0,0,0.4)", color: HOME_THEME.text, border: "1px solid rgba(255,255,255,0.15)" }}>
            <option value={0}>any</option>
            <option value={1.5}>1.5+</option>
            <option value={2}>2.0+</option>
            <option value={3}>3.0+</option>
          </select>
        </label>
        <button onClick={() => load()} style={seg(false)}>↻ Refresh</button>
      </div>

      {err && <div style={{ color: HOME_THEME.red, marginBottom: 12 }}>{err}</div>}

      <div style={{ overflowX: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
          <thead>
            <tr style={{ color: HOME_THEME.green, textAlign: "right", fontSize: 11, textTransform: "uppercase" }}>
              <th style={{ ...th, textAlign: "left" }}>#</th>
              <th style={{ ...th, textAlign: "left" }}>Symbol</th>
              <th style={th}>Strike</th>
              <th style={{ ...th, textAlign: "left" }}>Expiry</th>
              <th style={th}>{win}m Δ</th>
              <th style={th}>Avg Δ</th>
              <th style={th}>z-score</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => {
              const up = r.latest_chg >= 0;
              const col = up ? HOME_THEME.green : HOME_THEME.red;
              return (
                <tr key={`${r.symbol}-${r.expiry}-${r.strike}`}
                  style={{ borderTop: "1px solid rgba(255,255,255,0.06)", background: i % 2 ? "rgba(255,255,255,0.02)" : "transparent" }}>
                  <td style={{ ...td, textAlign: "left", color: HOME_THEME.text, fontWeight: 700 }}>{i + 1}</td>
                  <td style={{ ...td, textAlign: "left", fontWeight: 700 }}>{r.symbol}</td>
                  <td style={td}>{r.strike}</td>
                  <td style={{ ...td, textAlign: "left", color: "rgba(255,255,255,0.7)", fontSize: 12 }}>{r.expiry}</td>
                  <td style={{ ...td, color: col, fontWeight: 800 }}>{fmtB(r.latest_chg)}</td>
                  <td style={td}>{fmtB(r.mean_chg)}</td>
                  <td style={{ ...td, color: zColor(r.z), fontWeight: 800 }}>
                    {r.z == null ? "—" : `${r.z >= 0 ? "+" : ""}${r.z.toFixed(1)}σ`}
                  </td>
                </tr>
              );
            })}
            {!rows.length && !loading && (
              <tr><td colSpan={7} style={{ padding: 24, textAlign: "center", color: "rgba(255,255,255,0.4)" }}>
                No qualifying moves yet. Needs ≥3 snapshots spanning the window — give the recorder ~{win + 10} min of history.
              </td></tr>
            )}
          </tbody>
        </table>
      </div>
    </Card>
  );
}

// ══════════════════════════════════════════════════════════════════════════════
//  GREEKS SENSITIVITY SCANNER (new tab)
// ══════════════════════════════════════════════════════════════════════════════

type GreekMode = "charm" | "vanna" | "gamma" | "tg";

type GreekRow = {
  symbol: string;
  expiry: string;
  strike: number;
  latest_chg: number;
  mean_chg: number;
  sd_chg: number;
  n: number;
  z_score: number | null;
  charm_now: number;
  vanna_now: number;
  gamma_now: number;
  delta_now: number;
  spot_now: number;
  tg_score: number;
};

const MODE_META: Record<GreekMode, { label: string; accent: string; colLabel: string; subtitle: string }> = {
  charm: {
    label: "Charm (CHEX)",
    accent: HOME_THEME.cyan,
    colLabel: "Charm Δ",
    subtitle: "Delta decay momentum — strikes bleeding delta the fastest. High near 0DTE.",
  },
  vanna: {
    label: "Vanna (VEX)",
    accent: HOME_THEME.purple,
    colLabel: "Vanna Δ",
    subtitle: "Delta sensitivity to IV — ranks strikes most exposed to vol-driven delta shifts.",
  },
  gamma: {
    label: "Gamma Accel",
    accent: HOME_THEME.orange,
    colLabel: "GEX Δ",
    subtitle: "Gamma momentum — strikes with accelerating gamma build near key walls / flip zones.",
  },
  tg: {
    label: "TG Imbalance",
    accent: HOME_THEME.green,
    colLabel: "TG Score",
    subtitle: "Theta-Gamma imbalance — high |charm| × |GEX| composite: potential pin risk or explosive move zones.",
  },
};

function GreeksScanner() {
  const [rows, setRows]     = useState<GreekRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr]       = useState<string | null>(null);
  const [win, setWin]       = useState<Win>(15);
  const [mode, setMode]     = useState<GreekMode>("charm");

  const load = useCallback(async () => {
    setLoading(true); setErr(null);
    try {
      const u = new URL("/proxy/greek-scanner", window.location.origin);
      u.searchParams.set("window", String(win));
      u.searchParams.set("mode", mode);
      u.searchParams.set("limit", "25");
      const res = await fetch(u.toString(), { cache: "no-store" });
      const text = await res.text();
      let j: any;
      try { j = JSON.parse(text); } catch { throw new Error(`Server returned ${res.status} (non-JSON).`); }
      if (!j.ok) throw new Error(j.error || "load failed");
      setRows(j.rows || []);
    } catch (e: any) { setErr(String(e?.message || e)); }
    finally { setLoading(false); }
  }, [win, mode]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => { const t = setInterval(() => load(), 60_000); return () => clearInterval(t); }, [load]);

  const meta = MODE_META[mode];

  // For TG mode, show tg_score; otherwise show the metric change + z-score.
  const isTg = mode === "tg";

  return (
    <Card accent={meta.accent} title="Greeks Sensitivity Scanner"
      subtitle={`SPX · ${meta.label} · ${win}m window${loading ? " · refreshing…" : ""}`}>

      {/* Mode selector */}
      <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 8 }}>
        {(Object.keys(MODE_META) as GreekMode[]).map((m) => (
          <button key={m} onClick={() => setMode(m)} style={{
            ...seg(mode === m),
            border: `1px solid ${mode === m ? MODE_META[m].accent : "rgba(255,255,255,0.15)"}`,
            background: mode === m ? `${MODE_META[m].accent}22` : "transparent",
            color: mode === m ? HOME_THEME.text : "rgba(255,255,255,0.7)",
          }}>{MODE_META[m].label}</button>
        ))}
      </div>

      {/* Window + refresh */}
      <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 16 }}>
        {([15, 30, 60] as Win[]).map((w) => (
          <button key={w} onClick={() => setWin(w)} style={seg(win === w)}>{w}m</button>
        ))}
        <button onClick={() => load()} style={{ ...seg(false), marginLeft: 4 }}>↻</button>
        <span style={{ fontSize: 12, color: "rgba(255,255,255,0.5)", marginLeft: 8 }}>{meta.subtitle}</span>
      </div>

      {err && (
        <div style={{ color: HOME_THEME.orange, marginBottom: 12, fontSize: 13 }}>
          {err.includes('no DB') || err.includes('503')
            ? "Recorder hasn't started yet — data appears after the first 5-min RTH snapshot."
            : err}
        </div>
      )}

      <div style={{ overflowX: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
          <thead>
            <tr style={{ color: HOME_THEME.green, textAlign: "right", fontSize: 11, textTransform: "uppercase" }}>
              <th style={{ ...th, textAlign: "left" }}>#</th>
              <th style={th}>Strike</th>
              <th style={{ ...th, textAlign: "left" }}>Expiry</th>
              <th style={th}>{meta.colLabel}</th>
              {!isTg && <th style={th}>Avg Δ</th>}
              {!isTg && <th style={th}>z-score</th>}
              {isTg  && <th style={th}>|Charm|</th>}
              {isTg  && <th style={th}>|GEX|</th>}
              <th style={th}>Delta</th>
              <th style={th}>GEX now</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => {
              const chg    = isTg ? r.tg_score : r.latest_chg;
              const up     = chg >= 0;
              const chgCol = up ? HOME_THEME.green : HOME_THEME.red;
              const key    = `${r.symbol}-${r.expiry}-${r.strike}`;

              // Highlight strikes near spot (within 2%)
              const nearSpot = r.spot_now > 0 && Math.abs(r.strike - r.spot_now) / r.spot_now < 0.02;

              return (
                <tr key={key} style={{
                  borderTop: "1px solid rgba(255,255,255,0.06)",
                  background: nearSpot
                    ? `${meta.accent}18`
                    : i % 2 ? "rgba(255,255,255,0.02)" : "transparent",
                }}>
                  <td style={{ ...td, textAlign: "left", color: HOME_THEME.text, fontWeight: 700 }}>
                    {i + 1}{nearSpot ? " ◆" : ""}
                  </td>
                  <td style={{ ...td, fontWeight: 700 }}>{r.strike}</td>
                  <td style={{ ...td, textAlign: "left", color: "rgba(255,255,255,0.6)", fontSize: 12 }}>{r.expiry}</td>
                  <td style={{ ...td, color: chgCol, fontWeight: 800 }}>{fmtB(chg)}</td>
                  {!isTg && <td style={td}>{fmtB(r.mean_chg)}</td>}
                  {!isTg && (
                    <td style={{ ...td, color: zColor(r.z_score), fontWeight: 800 }}>
                      {r.z_score == null ? "—" : `${r.z_score >= 0 ? "+" : ""}${r.z_score.toFixed(1)}σ`}
                    </td>
                  )}
                  {isTg && <td style={{ ...td, color: HOME_THEME.cyan }}>{fmtB(Math.abs(r.charm_now))}</td>}
                  {isTg && <td style={{ ...td, color: HOME_THEME.orange }}>{fmtB(Math.abs(r.gamma_now))}</td>}
                  <td style={{ ...td, color: Math.abs(r.delta_now) < 1e6 ? HOME_THEME.green : "rgba(255,255,255,0.5)" }}>
                    {fmtB(r.delta_now)}
                  </td>
                  <td style={td}>{fmtB(r.gamma_now)}</td>
                </tr>
              );
            })}
            {!rows.length && !loading && !err && (
              <tr><td colSpan={8} style={{ padding: 24, textAlign: "center", color: "rgba(255,255,255,0.4)" }}>
                No data yet. The recorder runs every 5 min during RTH — needs ≥2 snapshots spanning {win}m.
              </td></tr>
            )}
          </tbody>
        </table>
      </div>

      {/* Legend */}
      <div style={{ marginTop: 14, display: "flex", gap: 20, flexWrap: "wrap", fontSize: 11, color: "rgba(255,255,255,0.4)" }}>
        <span>◆ near spot (&lt;2%)</span>
        {!isTg && <span>z ≥ 2σ = <span style={{ color: HOME_THEME.orange }}>unusual</span></span>}
        {!isTg && <span>z ≥ 3σ = <span style={{ color: HOME_THEME.red }}>extreme</span></span>}
        {isTg  && <span>TG Score = |charm| × |GEX| / max(|delta|, 1M)</span>}
        <span>OI+Vol basis (canonical)</span>
      </div>
    </Card>
  );
}

// ══════════════════════════════════════════════════════════════════════════════
//  VOL PIN SCANNER (new tab)
// ══════════════════════════════════════════════════════════════════════════════

type PinRow = {
  symbol: string;
  expiry: string;
  spot: number;
  atm_strike: number;
  atm_iv: number;
  atm_call_iv: number;
  atm_put_iv: number;
  pin_strike: number | null;
  pin_strike_oi: number | null;
  day_hi: number;
  day_lo: number;
  range_pct: number;
  rv_ann: number | null;
  iv_rv_spread: number | null;
  n_snaps: number;
  spread_delta: number | null;  // negative = contracting (IV-RV closing)
  range_delta: number | null;   // negative = contracting (price range tightening)
  pin_dist_pct: number | null;
  pin_score: number;
};

function fmtPct(v: number | null, decimals = 1) {
  if (v == null || isNaN(v)) return "—";
  return `${(v * 100).toFixed(decimals)}%`;
}

function PinStatus({ r }: { r: PinRow }) {
  const spreadContracting = (r.spread_delta ?? 0) < -0.005;
  const rangeContracting  = (r.range_delta ?? 0) < -0.001;
  const nearPin = r.pin_dist_pct != null && r.pin_dist_pct < 0.005;

  if (spreadContracting && rangeContracting && nearPin) {
    return <span style={{ color: HOME_THEME.red, fontWeight: 800, fontSize: 11 }}>PINNING</span>;
  }
  if (spreadContracting && rangeContracting) {
    return <span style={{ color: HOME_THEME.orange, fontWeight: 700, fontSize: 11 }}>SQUEEZING</span>;
  }
  if (spreadContracting || rangeContracting) {
    return <span style={{ color: HOME_THEME.cyan, fontWeight: 600, fontSize: 11 }}>WATCHING</span>;
  }
  return <span style={{ color: "rgba(255,255,255,0.3)", fontSize: 11 }}>—</span>;
}

function VolPinScanner() {
  const [rows, setRows]       = useState<PinRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr]         = useState<string | null>(null);
  const [minSnaps, setMinSnaps] = useState(3);

  const load = useCallback(async () => {
    setLoading(true); setErr(null);
    try {
      const u = new URL("/proxy/vol-pin-scanner", window.location.origin);
      u.searchParams.set("limit", "30");
      u.searchParams.set("minSnapshots", String(minSnaps));
      const res  = await fetch(u.toString(), { cache: "no-store" });
      const text = await res.text();
      let j: any;
      try { j = JSON.parse(text); } catch { throw new Error(`Server returned ${res.status} (non-JSON).`); }
      if (!j.ok) throw new Error(j.error || "load failed");
      setRows(j.rows || []);
    } catch (e: any) { setErr(String(e?.message || e)); }
    finally { setLoading(false); }
  }, [minSnaps]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => { const t = setInterval(() => load(), 90_000); return () => clearInterval(t); }, [load]);

  return (
    <Card accent={HOME_THEME.purple} title="Volatility Pin Scanner"
      subtitle={`Stocks · IV-RV spread + range contraction → pin candidates${loading ? " · refreshing…" : ""}`}>

      <div style={{ display: "flex", gap: 10, alignItems: "center", marginBottom: 16, flexWrap: "wrap" }}>
        <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, color: HOME_THEME.green }}>
          min snapshots
          <select value={minSnaps} onChange={(e) => setMinSnaps(Number(e.target.value))}
            style={{ fontSize: 12, padding: "6px 10px", borderRadius: 6, background: "rgba(0,0,0,0.4)", color: HOME_THEME.text, border: "1px solid rgba(255,255,255,0.15)" }}>
            <option value={2}>2 (early)</option>
            <option value={3}>3 (15 min)</option>
            <option value={6}>6 (30 min)</option>
            <option value={12}>12 (60 min)</option>
          </select>
        </label>
        <button onClick={() => load()} style={seg(false)}>↻ Refresh</button>
        <span style={{ fontSize: 11, color: "rgba(255,255,255,0.35)", marginLeft: 4 }}>
          Refreshes every 90s · recorder runs every 5m during RTH
        </span>
      </div>

      {err && (
        <div style={{ color: HOME_THEME.orange, marginBottom: 12, fontSize: 13 }}>
          {err.includes('503') || err.includes('no DB')
            ? "Recorder not yet active — data appears after first RTH sweep."
            : err}
        </div>
      )}

      <div style={{ overflowX: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
          <thead>
            <tr style={{ color: HOME_THEME.green, textAlign: "right", fontSize: 11, textTransform: "uppercase" }}>
              <th style={{ ...th, textAlign: "left" }}>#</th>
              <th style={{ ...th, textAlign: "left" }}>Symbol</th>
              <th style={th}>Spot</th>
              <th style={th}>Pin Strike</th>
              <th style={th}>Dist</th>
              <th style={th}>Pin OI</th>
              <th style={th}>ATM IV</th>
              <th style={th}>RV</th>
              <th style={th}>IV−RV%</th>
              <th style={th}>Spread Trend</th>
              <th style={th}>Range</th>
              <th style={th}>Range Trend</th>
              <th style={{ ...th, textAlign: "center" }}>Status</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => {
              const spreadContracting = (r.spread_delta ?? 0) < 0;
              const rangeContracting  = (r.range_delta ?? 0) < 0;
              const isPin = spreadContracting && rangeContracting && r.pin_dist_pct != null && r.pin_dist_pct < 0.005;
              const rowBg = isPin
                ? `${HOME_THEME.red}12`
                : i % 2 ? "rgba(255,255,255,0.02)" : "transparent";

              return (
                <tr key={r.symbol} style={{ borderTop: "1px solid rgba(255,255,255,0.06)", background: rowBg }}>
                  <td style={{ ...td, textAlign: "left", fontWeight: 700, color: HOME_THEME.text }}>{i + 1}</td>
                  <td style={{ ...td, textAlign: "left", fontWeight: 800 }}>{r.symbol}</td>
                  <td style={td}>{r.spot.toFixed(2)}</td>
                  <td style={{ ...td, color: HOME_THEME.cyan, fontWeight: 700 }}>
                    {r.pin_strike != null ? r.pin_strike : "—"}
                  </td>
                  <td style={{ ...td, color: r.pin_dist_pct != null && r.pin_dist_pct < 0.005 ? HOME_THEME.red : HOME_THEME.text }}>
                    {r.pin_dist_pct != null ? fmtPct(r.pin_dist_pct, 2) : "—"}
                  </td>
                  <td style={{ ...td, color: "rgba(255,255,255,0.6)" }}>
                    {r.pin_strike_oi != null ? (r.pin_strike_oi / 1000).toFixed(0) + "K" : "—"}
                  </td>
                  <td style={{ ...td, color: HOME_THEME.orange }}>{fmtPct(r.atm_iv)}</td>
                  <td style={td}>{r.rv_ann != null ? fmtPct(r.rv_ann) : "—"}</td>
                  <td style={{ ...td, color: r.iv_rv_spread != null && r.iv_rv_spread > 0.3 ? HOME_THEME.green : HOME_THEME.text }}>
                    {fmtPct(r.iv_rv_spread)}
                  </td>
                  {/* Spread trend: negative = contracting = good for pin */}
                  <td style={{ ...td, color: spreadContracting ? HOME_THEME.green : HOME_THEME.red }}>
                    {r.spread_delta != null
                      ? `${spreadContracting ? "↓" : "↑"} ${fmtPct(Math.abs(r.spread_delta), 2)}`
                      : "—"}
                  </td>
                  <td style={td}>{fmtPct(r.range_pct, 2)}</td>
                  {/* Range trend: negative = tightening = good for pin */}
                  <td style={{ ...td, color: rangeContracting ? HOME_THEME.green : HOME_THEME.red }}>
                    {r.range_delta != null
                      ? `${rangeContracting ? "↓" : "↑"} ${fmtPct(Math.abs(r.range_delta), 2)}`
                      : "—"}
                  </td>
                  <td style={{ ...td, textAlign: "center" }}><PinStatus r={r} /></td>
                </tr>
              );
            })}
            {!rows.length && !loading && !err && (
              <tr><td colSpan={13} style={{ padding: 24, textAlign: "center", color: "rgba(255,255,255,0.4)" }}>
                No data yet. Needs {minSnaps} snapshots per ticker (each 5 min apart during RTH).
                Give the recorder ~{minSnaps * 5} min after market open.
              </td></tr>
            )}
          </tbody>
        </table>
      </div>

      {/* Legend */}
      <div style={{ marginTop: 14, display: "flex", gap: 20, flexWrap: "wrap", fontSize: 11, color: "rgba(255,255,255,0.4)" }}>
        <span><span style={{ color: HOME_THEME.red }}>PINNING</span> = spread ↓ + range ↓ + within 0.5% of pin strike</span>
        <span><span style={{ color: HOME_THEME.orange }}>SQUEEZING</span> = spread ↓ + range ↓</span>
        <span>Pin strike = highest OI within ±10% of spot (front expiry)</span>
        <span>RV = annualized from 5-min spot log-returns</span>
        <span>Spread Trend = IV-RV% change since session start (↓ = compressing)</span>
      </div>
    </Card>
  );
}

// ══════════════════════════════════════════════════════════════════════════════
//  PAGE SHELL — tab switcher
// ══════════════════════════════════════════════════════════════════════════════

export default function ScannerPage() {
  const [tab, setTab] = useState<MainTab>("gex");

  const tabStyle = (active: boolean): React.CSSProperties => ({
    padding: "8px 20px", borderRadius: 8, fontSize: 13, cursor: "pointer", fontWeight: 700,
    border: `1px solid ${active ? HOME_THEME.cyan : "rgba(255,255,255,0.1)"}`,
    background: active ? "rgba(33,158,188,0.15)" : "transparent",
    color: active ? HOME_THEME.text : "rgba(255,255,255,0.55)",
    transition: "all 0.15s",
  });

  return (
    <PageShell>
      {/* Top-level tabs */}
      <div style={{ display: "flex", gap: 10, marginBottom: 4 }}>
        <button onClick={() => setTab("gex")}    style={tabStyle(tab === "gex")}>GEX Scanner</button>
        <button onClick={() => setTab("greeks")} style={tabStyle(tab === "greeks")}>Greeks Sensitivity</button>
        <button onClick={() => setTab("volpin")} style={{
          ...tabStyle(tab === "volpin"),
          border: `1px solid ${tab === "volpin" ? HOME_THEME.purple : "rgba(255,255,255,0.1)"}`,
          background: tab === "volpin" ? `${HOME_THEME.purple}22` : "transparent",
        }}>Vol Pin</button>
      </div>

      {tab === "gex"    && <GexScanner />}
      {tab === "greeks" && <GreeksScanner />}
      {tab === "volpin" && <VolPinScanner />}
    </PageShell>
  );
}
