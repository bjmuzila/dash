"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { CSSProperties } from "react";
import { HOME_THEME, homeButtonStyle, homeInputStyle } from "@/components/shared/homeTheme";
import { Card } from "@/components/shared/PageCard";

// ─────────────────────────────────────────────────────────────────────────────
// DoD Movers — biggest day-over-day change in OI+Vol net GEX per ticker, at the
// strike that moved most (kept at its intraday peak). Reads server-v2
// /proxy/strike-dod (strike_dod_max, written by strike-growth-recorder's
// rollupDayOverDay). All columns click-to-sort.
// ─────────────────────────────────────────────────────────────────────────────
type DodRow = {
  date: string; symbol: string; strike: number; expiry: string | null; spot: number;
  net_today: number; net_yest: number; vol_today: number; delta: number; peak_abs: number; t: number;
  net_now: number | null; now_delta: number | null;
  chg_30m: number | null; chg_60m: number | null; chg_4h: number | null;
};
type DodKey =
  | "rank" | "symbol" | "expiry" | "strike" | "spot"
  | "net_yest" | "net_today" | "vol_today" | "delta" | "peak_abs"
  | "net_now" | "now_delta" | "chg_30m" | "chg_60m" | "chg_4h" | "t";

const dodGex = (v: number): string => {
  const a = Math.abs(v), s = v < 0 ? "-" : "";
  if (a >= 1e9) return `${s}$${(a / 1e9).toFixed(2)}B`;
  if (a >= 1e6) return `${s}$${(a / 1e6).toFixed(0)}M`;
  return `${s}$${Math.round(a).toLocaleString("en-US")}`;
};
const dodSigned = (v: number): string => (v >= 0 ? "+" : "") + dodGex(v);
const dodChg = (v: number | null): string =>
  v == null || !Number.isFinite(v) ? "—" : dodSigned(v);
const dodNum = (v: number): string =>
  (Number(v) || 0).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const dodExp = (e: string | null): string => (e && e.length >= 10 ? `${e.slice(5, 7)}/${e.slice(8, 10)}` : (e || "—"));
const dodTime = (t: number): string => {
  if (!t) return "—";
  const d = new Date(t);
  if (isNaN(d.getTime())) return "—";
  return new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", hour: "2-digit", minute: "2-digit", hour12: false }).format(d);
};

type DodHistRow = {
  date: string; strike: number; expiry: string | null; spot: number;
  net_today: number; net_yest: number; vol_today: number; delta: number; peak_abs: number;
};

// Per-ticker drill-down: each day's frozen peak mover for one symbol, newest
// first, with a Peak-Δ-over-time sparkline. Reads /proxy/strike-dod-history.
function DodHistoryPanel({ symbol, onClose }: { symbol: string; onClose: () => void }) {
  const [rows, setRows] = useState<DodHistRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    setLoading(true); setErr(null);
    fetch(`/proxy/strike-dod-history?symbol=${encodeURIComponent(symbol)}&limit=120`, { cache: "no-store" })
      .then((r) => r.json())
      .then((j) => { if (!alive) return; if (!j.ok) throw new Error(j.error || "load failed"); setRows(Array.isArray(j.rows) ? j.rows : []); })
      .catch((e) => { if (alive) setErr(String((e as Error)?.message || e)); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [symbol]);

  const th: CSSProperties = { position: "sticky", top: 0, background: HOME_THEME.panel, textAlign: "right", padding: "9px 12px", fontSize: 11, fontWeight: 800, color: HOME_THEME.green, letterSpacing: "0.05em", textTransform: "uppercase", borderBottom: `1px solid ${HOME_THEME.border}`, whiteSpace: "nowrap" };
  const td: CSSProperties = { padding: "7px 12px", textAlign: "right", borderBottom: "1px solid rgba(255,255,255,0.05)", whiteSpace: "nowrap", fontVariantNumeric: "tabular-nums" };
  const posNeg = (v: number): CSSProperties => ({ color: v >= 0 ? HOME_THEME.green : HOME_THEME.red });

  const chrono = [...rows].reverse(); // oldest → newest for the sparkline
  const spark = (() => {
    if (chrono.length < 2) return null;
    const vals = chrono.map((d) => d.delta);
    const max = Math.max(...vals.map((v) => Math.abs(v)), 1);
    const W = 260, H = 46, n = vals.length;
    const px = (i: number) => (i / (n - 1)) * W;
    const py = (v: number) => H / 2 - (v / max) * (H / 2 - 4);
    const pts = vals.map((v, i) => `${px(i).toFixed(1)},${py(v).toFixed(1)}`).join(" ");
    return (
      <svg width={W} height={H} style={{ display: "block" }}>
        <line x1={0} y1={H / 2} x2={W} y2={H / 2} stroke="rgba(255,255,255,0.12)" strokeWidth={1} />
        <polyline points={pts} fill="none" stroke={HOME_THEME.cyan} strokeWidth={1.6} />
        {vals.map((v, i) => <circle key={i} cx={px(i)} cy={py(v)} r={1.7} fill={v >= 0 ? HOME_THEME.green : HOME_THEME.red} />)}
      </svg>
    );
  })();

  return (
    <Card variant="budget" accent={HOME_THEME.orange} title={`${symbol} · day-by-day peak movers`}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 12, marginBottom: 8 }}>
        <div style={{ fontSize: 12.5, color: HOME_THEME.text, opacity: 0.7 }}>
          {loading ? "Loading history…" : `${rows.length} session${rows.length === 1 ? "" : "s"} · newest first`}
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
          {spark && <div title="Peak Δ over time (oldest → newest)">{spark}</div>}
          <button onClick={onClose} style={homeButtonStyle}>Close ✕</button>
        </div>
      </div>
      {err && <div style={{ fontSize: 13, color: HOME_THEME.red }}>Error: {err}</div>}
      <div style={{ maxHeight: 320, overflow: "auto", borderRadius: 10, border: `1px solid ${HOME_THEME.border}` }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
          <thead><tr>
            <th style={{ ...th, textAlign: "left" }}>Date</th>
            <th style={{ ...th, textAlign: "left" }}>Exp</th>
            <th style={th}>Strike</th>
            <th style={th}>Spot</th>
            <th style={th}>Peak Net</th>
            <th style={th}>Yest Net</th>
            <th style={th}>Peak Δ</th>
            <th style={th}>|Peak Δ|</th>
            <th style={th}>Vol only</th>
          </tr></thead>
          <tbody>
            {rows.map((d) => (
              <tr key={d.date}>
                <td style={{ ...td, textAlign: "left", fontWeight: 700 }}>{d.date}</td>
                <td style={{ ...td, textAlign: "left", opacity: 0.7 }}>{dodExp(d.expiry)}</td>
                <td style={{ ...td, color: HOME_THEME.cyan, fontWeight: 700 }}>{dodNum(d.strike)}</td>
                <td style={{ ...td, opacity: 0.7 }}>{dodNum(d.spot)}</td>
                <td style={{ ...td, ...posNeg(d.net_today) }}>{dodSigned(d.net_today)}</td>
                <td style={{ ...td, ...posNeg(d.net_yest) }}>{dodSigned(d.net_yest)}</td>
                <td style={{ ...td, ...posNeg(d.delta), fontWeight: 700 }}>{dodSigned(d.delta)}</td>
                <td style={{ ...td, fontWeight: 700 }}>{dodGex(d.peak_abs)}</td>
                <td style={{ ...td, ...posNeg(d.vol_today) }}>{dodSigned(d.vol_today)}</td>
              </tr>
            ))}
            {!loading && !rows.length && (
              <tr><td colSpan={9} style={{ ...td, textAlign: "center", opacity: 0.6, padding: 20 }}>No history yet for {symbol}.</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </Card>
  );
}

export default function DodMoversTab() {
  const [rows, setRows] = useState<DodRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [q, setQ] = useState("");
  const [sortKey, setSortKey] = useState<DodKey>("peak_abs");
  const [sortDir, setSortDir] = useState<1 | -1>(-1);
  const [sel, setSel] = useState<string | null>(null);
  const [dates, setDates] = useState<{ date: string; n: number }[]>([]);
  const [pickDate, setPickDate] = useState<string>(""); // "" = latest (live)

  // Available sessions for the picker (newest first).
  useEffect(() => {
    let alive = true;
    fetch("/proxy/strike-dod-dates", { cache: "no-store" })
      .then((r) => r.json())
      .then((j) => { if (alive && j.ok) setDates(Array.isArray(j.dates) ? j.dates : []); })
      .catch(() => {});
    return () => { alive = false; };
  }, []);

  // Historical = a specific past session picked (not the latest). Live columns
  // (Now/30m/60m/4h) only apply to the latest session; past dates show "—".
  const latestDate = dates[0]?.date || "";
  const historical = !!pickDate && !!latestDate && pickDate !== latestDate;

  const load = useCallback(async () => {
    setLoading(true); setErr(null);
    try {
      const isHist = !!pickDate && pickDate !== (dates[0]?.date || "");
      const qs = isHist ? `&date=${encodeURIComponent(pickDate)}` : "";
      const r = await fetch(`/proxy/strike-dod?limit=2000${qs}`, { cache: "no-store" });
      const j = await r.json();
      if (!j.ok) throw new Error(j.error || "load failed");
      const raw: DodRow[] = Array.isArray(j.rows) ? j.rows : [];
      // Live current-vs-yesterday Δ, so a strike that peaked and faded is visible.
      setRows(raw.map((d) => ({
        ...d,
        now_delta: d.net_now == null ? null : d.net_now - d.net_yest,
      })));
    } catch (e) { setErr(String((e as Error)?.message || e)); }
    finally { setLoading(false); }
  }, [pickDate, dates]);
  useEffect(() => { void load(); }, [load]);

  const asOf = rows[0]?.date || "";
  const maxAbs = useMemo(() => Math.max(1, ...rows.map((d) => d.peak_abs || 0)), [rows]);

  const view = useMemo(() => {
    const needle = q.trim().toUpperCase();
    const filtered = needle ? rows.filter((d) => d.symbol.includes(needle)) : rows;
    if (sortKey === "rank") return filtered;
    return [...filtered].sort((a, b) => {
      const x = (a as unknown as Record<string, unknown>)[sortKey];
      const y = (b as unknown as Record<string, unknown>)[sortKey];
      if (typeof x === "string" || typeof y === "string")
        return (String(x ?? "") < String(y ?? "") ? -1 : String(x ?? "") > String(y ?? "") ? 1 : 0) * sortDir;
      return ((Number(x) || 0) - (Number(y) || 0)) * sortDir;
    });
  }, [rows, q, sortKey, sortDir]);

  const onSort = (k: DodKey) => {
    if (k === sortKey) setSortDir((d) => (d === 1 ? -1 : 1));
    else { setSortKey(k); setSortDir(k === "symbol" || k === "expiry" ? 1 : -1); }
  };

  const cols: { k: DodKey; label: string; l?: boolean }[] = [
    { k: "rank", label: "#", l: true },
    { k: "symbol", label: "Ticker", l: true },
    { k: "expiry", label: "Exp", l: true },
    { k: "strike", label: "Top Strike" },
    { k: "spot", label: "Spot" },
    { k: "net_yest", label: "Yest Net GEX" },
    { k: "net_today", label: "Peak Net GEX" },
    { k: "net_now", label: "Now Net GEX" },
    { k: "vol_today", label: "Today (vol only)" },
    { k: "delta", label: "Peak Δ" },
    { k: "peak_abs", label: "|Peak Δ|" },
    { k: "now_delta", label: "Now Δ" },
    { k: "chg_30m", label: "30m Δ" },
    { k: "chg_60m", label: "60m Δ" },
    { k: "chg_4h", label: "4h Δ" },
    { k: "t", label: "Updated" },
  ];

  const th: CSSProperties = {
    position: "sticky", top: 0, background: HOME_THEME.panel, zIndex: 2, textAlign: "right",
    padding: "10px 12px", fontSize: 11, fontWeight: 800, color: HOME_THEME.green,
    letterSpacing: "0.05em", textTransform: "uppercase", borderBottom: `1px solid ${HOME_THEME.border}`,
    cursor: "pointer", userSelect: "none", whiteSpace: "nowrap",
  };
  const td: CSSProperties = {
    padding: "8px 12px", textAlign: "right", borderBottom: "1px solid rgba(255,255,255,0.05)",
    whiteSpace: "nowrap", fontVariantNumeric: "tabular-nums",
  };
  const posNeg = (v: number): CSSProperties => ({ color: v >= 0 ? HOME_THEME.green : HOME_THEME.red });

  return (
    <>
      <div style={{ display: "flex", alignItems: "center", gap: 14, flexWrap: "wrap", marginBottom: 4 }}>
        <div style={{ fontSize: 14, color: HOME_THEME.text, opacity: 0.7 }}>
          {loading ? "Loading day-over-day movers…"
            : asOf ? `Biggest OI+Vol net-GEX change vs prior session · ${asOf} · ${rows.length} tickers${historical ? " · historical (live cols N/A)" : ""}`
            : "No day-over-day rows yet (needs 2 sessions of history)"}
        </div>
        <select
          value={pickDate}
          onChange={(e) => setPickDate(e.target.value)}
          title="View a past session"
          style={{ ...homeInputStyle, minWidth: 150, cursor: "pointer" }}
        >
          <option value="">Latest (live)</option>
          {dates.map((d) => <option key={d.date} value={d.date}>{d.date} ({d.n})</option>)}
        </select>
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Filter ticker…"
          style={{ ...homeInputStyle, minWidth: 170 }}
        />
        <button onClick={() => void load()} style={homeButtonStyle}>Refresh</button>
      </div>
      {err && <div style={{ fontSize: 14, color: HOME_THEME.red }}>Error: {err}</div>}
      {sel && <DodHistoryPanel symbol={sel} onClose={() => setSel(null)} />}
      <Card variant="budget" accent={HOME_THEME.cyan} title="Day-over-Day GEX Movers">
        <div style={{ maxHeight: "72vh", overflow: "auto", borderRadius: 10, border: `1px solid ${HOME_THEME.border}` }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
            <thead>
              <tr>
                {cols.map((c) => (
                  <th
                    key={c.k}
                    onClick={() => onSort(c.k)}
                    style={{ ...th, textAlign: c.l ? "left" : "right" }}
                  >
                    {c.label}{sortKey === c.k ? (sortDir < 0 ? " ▼" : " ▲") : ""}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {view.map((d, i) => {
                const w = ((d.peak_abs || 0) / maxAbs) * 100;
                return (
                  <tr key={d.symbol}>
                    <td style={{ ...td, textAlign: "left", color: HOME_THEME.green, opacity: 0.7 }}>{i + 1}</td>
                    <td
                      onClick={() => setSel(d.symbol)}
                      title="View day-by-day history"
                      style={{ ...td, textAlign: "left", fontWeight: 800, letterSpacing: "0.03em", cursor: "pointer", color: HOME_THEME.cyan, textDecoration: "underline", textDecorationColor: "rgba(255,255,255,0.25)" }}
                    >{d.symbol}</td>
                    <td style={{ ...td, textAlign: "left", color: HOME_THEME.text, opacity: 0.7 }}>{dodExp(d.expiry)}</td>
                    <td style={{ ...td, color: HOME_THEME.cyan, fontWeight: 700 }}>{dodNum(d.strike)}</td>
                    <td style={{ ...td, opacity: 0.7 }}>{dodNum(d.spot)}</td>
                    <td style={{ ...td, ...posNeg(d.net_yest) }}>{dodSigned(d.net_yest)}</td>
                    <td style={{ ...td, ...posNeg(d.net_today) }}>{dodSigned(d.net_today)}</td>
                    <td style={{ ...td, ...(d.net_now == null ? { opacity: 0.4 } : posNeg(d.net_now)), fontWeight: 700 }}>{d.net_now == null ? "—" : dodSigned(d.net_now)}</td>
                    <td style={{ ...td, ...posNeg(d.vol_today) }}>{dodSigned(d.vol_today)}</td>
                    <td style={{ ...td, ...posNeg(d.delta), fontWeight: 700 }}>{dodSigned(d.delta)}</td>
                    <td style={{ ...td, position: "relative", fontWeight: 800 }}>
                      <div style={{
                        position: "absolute", left: 0, top: "50%", transform: "translateY(-50%)",
                        height: "58%", width: `${w}%`, borderRadius: 3,
                        background: `linear-gradient(90deg, ${HOME_THEME.cyan}44, ${HOME_THEME.cyan}0D)`, zIndex: 0,
                      }} />
                      <span style={{ position: "relative", zIndex: 1 }}>{dodGex(d.peak_abs)}</span>
                    </td>
                    <td style={{ ...td, ...(d.now_delta == null ? { opacity: 0.4 } : posNeg(d.now_delta)), fontWeight: 700 }}>{dodChg(d.now_delta)}</td>
                    <td style={{ ...td, ...(d.chg_30m == null ? { opacity: 0.4 } : posNeg(d.chg_30m)) }}>{dodChg(d.chg_30m)}</td>
                    <td style={{ ...td, ...(d.chg_60m == null ? { opacity: 0.4 } : posNeg(d.chg_60m)) }}>{dodChg(d.chg_60m)}</td>
                    <td style={{ ...td, ...(d.chg_4h == null ? { opacity: 0.4 } : posNeg(d.chg_4h)) }}>{dodChg(d.chg_4h)}</td>
                    <td style={{ ...td, opacity: 0.6 }}>{dodTime(d.t)}</td>
                  </tr>
                );
              })}
              {!loading && !view.length && (
                <tr><td colSpan={cols.length} style={{ ...td, textAlign: "center", opacity: 0.6, padding: 22 }}>
                  No movers to show.
                </td></tr>
              )}
            </tbody>
          </table>
        </div>
        <div style={{ fontSize: 12, color: HOME_THEME.text, opacity: 0.55, marginTop: 8, lineHeight: 1.6 }}>
          Δ = vs yesterday on the OI+Vol basis (gex_now + gex_open). <b>Peak Net / Peak Δ</b> are frozen at the session&rsquo;s max; <b>Now Net / Now Δ</b> are live —
          a strike that hit max and then faded shows |Now Δ| well below |Peak Δ|. &ldquo;Today (vol only)&rdquo; is today&rsquo;s traded-volume GEX at that strike.
          Click any ticker for its day-by-day peak-mover history.
        </div>
      </Card>
    </>
  );
}
