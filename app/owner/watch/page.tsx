"use client";

/**
 * Owner · Watch — options tracker. Add a contract (ticker, strike, side,
 * expiry) and the table tracks its live greeks, option price, OI/volume and a
 * net-premium flow proxy. Data comes from /api/watch, which pulls each
 * contract from /proxy/probe-rest (Theta greeks + TT quote) and records a
 * snapshot every refresh. Auto-polls while the tab is open; a server-side
 * recorder keeps the history filling during RTH even when the page is closed.
 */

import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  OWNER_THEME as HOME_THEME,
  homeButtonStyle,
  homeContentStyle,
  homeHeaderStyle,
  homeInputStyle,
  homePanelStyle,
  homeSecondaryButtonStyle,
  homeShellStyle,
} from "@/components/shared/ownerTheme";
import { ThemedSelect } from "@/components/shared/ThemedSelect";
import { ThemedDatePicker } from "@/components/shared/ThemedDatePicker";

// ── Types ───────────────────────────────────────────────────────────────────
interface Snapshot {
  ts: number;
  spot: number | null; bid: number | null; ask: number | null;
  mark: number | null; last: number | null;
  iv: number | null; delta: number | null; gamma: number | null;
  theta: number | null; vega: number | null;
  open_interest: number | null; volume: number | null; net_prem: number | null;
  prev_close: number | null;
}
interface Row {
  id: number; ticker: string; expiration: string; strike: number;
  side: string; note: string | null; snapshot: Snapshot | null;
}

// ── Helpers ─────────────────────────────────────────────────────────────────
function rgba(hex: string, a: number) {
  const h = hex.replace("#", "");
  const n = parseInt(h.length === 3 ? h.split("").map((c) => c + c).join("") : h, 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
}
const fmt = (v: number | null | undefined, d = 2) =>
  v == null || !Number.isFinite(v) ? "—" : Number(v).toFixed(d);
const fmtInt = (v: number | null | undefined) =>
  v == null || !Number.isFinite(v) ? "—" : Math.round(v).toLocaleString();
const fmtMoney = (v: number | null | undefined) => {
  if (v == null || !Number.isFinite(v)) return "—";
  const a = Math.abs(v);
  if (a >= 1e6) return `$${(v / 1e6).toFixed(2)}M`;
  if (a >= 1e3) return `$${(v / 1e3).toFixed(1)}K`;
  return `$${v.toFixed(0)}`;
};
// Real, unsoftened up/down colors — deliberately not OWNER_THEME's desaturated
// red/green, so positive/negative pops against the frosted cards.
const REAL_BLUE = "#3B82F6";
const REAL_RED = "#EF4444";
const signColor = (v: number | null | undefined) =>
  v == null || !Number.isFinite(v) || v === 0 ? HOME_THEME.text : v > 0 ? REAL_BLUE : REAL_RED;
/** Option-price day-change %, from the latest mark vs. the prior session's close. */
const dayChgPct = (mark: number | null | undefined, prevClose: number | null | undefined) => {
  if (mark == null || prevClose == null || !Number.isFinite(mark) || !Number.isFinite(prevClose) || prevClose === 0) return null;
  return ((mark - prevClose) / prevClose) * 100;
};
const timeAgo = (ts: number | null | undefined) => {
  if (!ts) return "—";
  const s = Math.round((Date.now() - ts) / 1000);
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.round(s / 60)}m ago`;
  return `${Math.round(s / 3600)}h ago`;
};

// ── Price-over-time chart ────────────────────────────────────────────────────
const METRICS = [
  { key: "mark", label: "Price (mark)", d: 2 },
  { key: "delta", label: "Δ Delta", d: 3 },
  { key: "gamma", label: "Γ Gamma", d: 4 },
  { key: "theta", label: "Θ Theta", d: 3 },
  { key: "vega", label: "V Vega", d: 3 },
  { key: "iv", label: "IV", d: 4 },
] as const;
type MetricKey = (typeof METRICS)[number]["key"];

const RANGES = [
  { key: "1d", label: "1D" },
  { key: "3d", label: "3D" },
  { key: "1w", label: "1W" },
  { key: "1m", label: "1M" },
] as const;
type RangeKey = (typeof RANGES)[number]["key"];

function HistoryChart({ history, metric }: { history: Snapshot[]; metric: MetricKey }) {
  const W = 960, H = 360, PADL = 56, PADR = 16, PADT = 16, PADB = 28;
  const pts = history
    .map((s) => ({ ts: s.ts, v: s[metric] as number | null }))
    .filter((p) => p.v != null && Number.isFinite(p.v as number)) as { ts: number; v: number }[];
  if (pts.length < 2) {
    return <div style={{ padding: 24, textAlign: "center", color: HOME_THEME.muted, fontSize: 15 }}>
      Not enough history yet — snapshots accrue every refresh.
    </div>;
  }
  const xs = pts.map((p) => p.ts), ys = pts.map((p) => p.v);
  const minX = Math.min(...xs), maxX = Math.max(...xs);
  let minY = Math.min(...ys), maxY = Math.max(...ys);
  if (minY === maxY) { minY -= 1; maxY += 1; }
  const pad = (maxY - minY) * 0.08; minY -= pad; maxY += pad;
  const sx = (t: number) => PADL + ((t - minX) / (maxX - minX || 1)) * (W - PADL - PADR);
  const sy = (v: number) => H - PADB - ((v - minY) / (maxY - minY || 1)) * (H - PADT - PADB);
  const path = pts.map((p, i) => `${i ? "L" : "M"}${sx(p.ts).toFixed(1)},${sy(p.v).toFixed(1)}`).join(" ");
  const area = `${path} L${sx(pts[pts.length - 1].ts).toFixed(1)},${H - PADB} L${sx(pts[0].ts).toFixed(1)},${H - PADB} Z`;
  const dec = METRICS.find((m) => m.key === metric)!.d;
  const yTicks = [0, 0.25, 0.5, 0.75, 1].map((f) => minY + f * (maxY - minY));
  // Spans over ~a day: show the date alongside the time so multi-day ranges are legible.
  const multiDay = maxX - minX > 20 * 3600_000;
  const fmtT = (ts: number) =>
    multiDay
      ? new Date(ts).toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })
      : new Date(ts).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  return (
    <svg viewBox={`0 0 ${W} ${H}`} style={{ width: "100%", height: "auto" }}>
      <defs>
        <linearGradient id="wg" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={rgba(HOME_THEME.cyan, 0.28)} />
          <stop offset="100%" stopColor={rgba(HOME_THEME.cyan, 0)} />
        </linearGradient>
      </defs>
      {yTicks.map((v, i) => (
        <g key={i}>
          <line x1={PADL} y1={sy(v)} x2={W - PADR} y2={sy(v)} stroke={rgba(HOME_THEME.border, 0.6)} strokeWidth={1} />
          <text x={PADL - 6} y={sy(v) + 3} textAnchor="end" fontSize={9} fill={HOME_THEME.muted} fontFamily="var(--font-mono)">{v.toFixed(dec)}</text>
        </g>
      ))}
      <text x={PADL} y={H - 6} textAnchor="start" fontSize={9} fill={HOME_THEME.muted} fontFamily="var(--font-mono)">{fmtT(minX)}</text>
      <text x={W - PADR} y={H - 6} textAnchor="end" fontSize={9} fill={HOME_THEME.muted} fontFamily="var(--font-mono)">{fmtT(maxX)}</text>
      <path d={area} fill="url(#wg)" />
      <path d={path} fill="none" stroke={HOME_THEME.cyan} strokeWidth={1.75} strokeLinejoin="round" strokeLinecap="round" />
      <circle cx={sx(pts[pts.length - 1].ts)} cy={sy(pts[pts.length - 1].v)} r={3} fill={HOME_THEME.cyan} />
    </svg>
  );
}

// ── Page ────────────────────────────────────────────────────────────────────
const REFRESH_MS = 15_000;

export default function WatchPage() {
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  // Add form
  const [ticker, setTicker] = useState("");
  const [expiry, setExpiry] = useState("");
  const [strike, setStrike] = useState("");
  const [side, setSide] = useState("C");
  const [note, setNote] = useState("");
  const [adding, setAdding] = useState(false);

  // Row expansion → price/greeks history
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const [historyById, setHistoryById] = useState<Record<number, Snapshot[]>>({});
  const [historyLoading, setHistoryLoading] = useState(false);
  const [metric, setMetric] = useState<MetricKey>("mark");
  const [range, setRange] = useState<RangeKey>("1d");

  const timer = useRef<ReturnType<typeof setInterval> | null>(null);

  const loadHistory = useCallback(async (id: number, r: RangeKey = range) => {
    setHistoryLoading(true);
    try {
      const res = await fetch(`/api/watch?history=${id}&range=${r}`, { cache: "no-store" });
      const j = await res.json();
      setHistoryById((m) => ({ ...m, [id]: j.history || [] }));
    } catch { /* keep prior */ } finally {
      setHistoryLoading(false);
    }
  }, [range]);

  const toggleRow = useCallback((id: number) => {
    setExpandedId((cur) => {
      const next = cur === id ? null : id;
      if (next != null) loadHistory(next);
      return next;
    });
  }, [loadHistory]);

  const changeRange = useCallback((r: RangeKey) => {
    setRange(r);
    if (expandedId != null) loadHistory(expandedId, r);
  }, [expandedId, loadHistory]);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/watch", { cache: "no-store" });
      const j = await res.json();
      if (j.error) throw new Error(j.error);
      setRows(j.rows || []);
      setErr(null);
    } catch (e) {
      setErr(String((e as Error).message || e));
    } finally {
      setLoading(false);
    }
  }, []);

  const refresh = useCallback(async () => {
    setRefreshing(true);
    try {
      const res = await fetch("/api/watch", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "refresh" }),
      });
      const j = await res.json();
      if (j.error) throw new Error(j.error);
      if (j.rows) setRows(j.rows);
      setErr(null);
      if (expandedId != null) loadHistory(expandedId);
    } catch (e) {
      setErr(String((e as Error).message || e));
    } finally {
      setRefreshing(false);
    }
  }, [expandedId, loadHistory]);

  useEffect(() => {
    load().then(refresh);
    timer.current = setInterval(refresh, REFRESH_MS);
    return () => { if (timer.current) clearInterval(timer.current); };
  }, [load, refresh]);

  const add = useCallback(async (e: React.FormEvent) => {
    e.preventDefault();
    if (!ticker.trim() || !expiry || !strike) return;
    setAdding(true);
    try {
      const res = await fetch("/api/watch", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "add", ticker, expiry, strike: Number(strike), side, note,
        }),
      });
      const j = await res.json();
      if (j.error) throw new Error(j.error);
      setTicker(""); setStrike(""); setNote("");
      await load();
    } catch (e2) {
      setErr(String((e2 as Error).message || e2));
    } finally {
      setAdding(false);
    }
  }, [ticker, expiry, strike, side, note, load]);

  const remove = useCallback(async (id: number) => {
    setRows((r) => r.filter((x) => x.id !== id));
    await fetch("/api/watch", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "remove", id }),
    });
  }, []);

  // ── Styles ────────────────────────────────────────────────────────────────
  const label: React.CSSProperties = {
    fontSize: 15, fontWeight: 700, color: HOME_THEME.muted,
    textTransform: "uppercase", letterSpacing: ".1em",
  };
  const input: React.CSSProperties = { ...homeInputStyle, width: "100%", fontSize: 15, colorScheme: "dark" };
  // OWNER_THEME.muted is white (same as .text), so titles and numbers were
  // indistinguishable — dim the label explicitly instead.
  const statLabel: React.CSSProperties = {
    fontSize: 15, fontWeight: 700, letterSpacing: ".1em", textTransform: "uppercase", color: "rgba(255,255,255,0.45)",
  };
  const statValue: React.CSSProperties = {
    fontSize: 15, fontWeight: 700, color: HOME_THEME.text, fontFamily: "var(--font-mono)",
  };

  return (
    <div style={homeShellStyle}>
      <style>{`
        .wcard{transition:transform .15s ease, box-shadow .15s ease, border-color .15s ease; cursor:pointer;}
        .wcard:hover{transform:translateY(-2px); box-shadow:0 6px 18px rgba(0,0,0,.35); border-color:rgba(0,240,255,.35);}
      `}</style>

      {/* Header */}
      <div style={homeHeaderStyle}>
        <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
          <span style={{ fontSize: 16, fontWeight: 800, textTransform: "uppercase", letterSpacing: ".12em", color: HOME_THEME.cyan }}>
            Owner · Watch
          </span>
          <span style={{ fontSize: 15, color: HOME_THEME.text, opacity: 0.8, fontFamily: "var(--font-mono)" }}>
            {rows.length} contract{rows.length === 1 ? "" : "s"} · greeks · price · flow
          </span>
        </div>
        <button style={{ ...homeSecondaryButtonStyle, opacity: refreshing ? 0.6 : 1 }} onClick={refresh} disabled={refreshing}>
          {refreshing ? "Refreshing…" : "↻ Refresh"}
        </button>
      </div>

      <div style={{ ...homeContentStyle, overflow: "auto" }}>
        {/* Add form */}
        <form onSubmit={add} style={{
          ...homePanelStyle, padding: 16, display: "grid",
          gridTemplateColumns: "1.2fr 1.4fr 1fr 1fr 1.6fr auto",
          gap: 12, alignItems: "end",
        }}>
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            <label style={label}>Ticker</label>
            <input style={input} value={ticker} onChange={(e) => setTicker(e.target.value.toUpperCase())} placeholder="SPX" required />
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            <label style={label}>Expiry</label>
            <ThemedDatePicker value={expiry} onChange={setExpiry} width="100%" />
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            <label style={label}>Strike</label>
            <input style={input} type="number" step="any" value={strike} onChange={(e) => setStrike(e.target.value)} placeholder="6000" required />
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            <label style={label}>Side</label>
            <ThemedSelect value={side} onChange={setSide} options={[{ value: "C", label: "Call" }, { value: "P", label: "Put" }]} />
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            <label style={label}>Note (optional)</label>
            <input style={input} value={note} onChange={(e) => setNote(e.target.value)} placeholder="thesis / tag" />
          </div>
          <button type="submit" style={{ ...homeButtonStyle, opacity: adding ? 0.6 : 1 }} disabled={adding}>
            {adding ? "Adding…" : "+ Add"}
          </button>
        </form>

        {err && (
          <div style={{ ...homePanelStyle, padding: "10px 14px", color: HOME_THEME.red, fontSize: 15, borderLeft: `2px solid ${HOME_THEME.red}` }}>
            {err}
          </div>
        )}

        {/* Cards */}
        {loading ? (
          <div style={{ ...homePanelStyle, padding: 28, textAlign: "center", color: HOME_THEME.muted }}>Loading…</div>
        ) : rows.length === 0 ? (
          <div style={{ ...homePanelStyle, padding: 28, textAlign: "center", color: HOME_THEME.muted }}>No contracts yet — add one above.</div>
        ) : (
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))", gap: 14 }}>
            {rows.map((r) => {
              const s = r.snapshot;
              const sideCol = r.side === "C" ? HOME_THEME.green : HOME_THEME.orange;
              const npCol = s?.net_prem == null ? HOME_THEME.text : s.net_prem >= 0 ? REAL_BLUE : REAL_RED;
              const isOpen = expandedId === r.id;
              const hist = historyById[r.id] || [];
              const chg = dayChgPct(s?.mark, s?.prev_close);
              const chgCol = chg == null ? HOME_THEME.muted : chg >= 0 ? REAL_BLUE : REAL_RED;
              return (
                <div
                  key={r.id}
                  className="wcard"
                  onClick={() => toggleRow(r.id)}
                  style={{ ...homePanelStyle, padding: 16, borderColor: isOpen ? rgba(HOME_THEME.cyan, 0.35) : undefined, gridColumn: isOpen ? "1 / -1" : undefined }}
                >
                  {/* Front */}
                  <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 8 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                      <span style={{ fontSize: 16, fontWeight: 800, color: HOME_THEME.text }}>{r.ticker}</span>
                      <span style={{ fontSize: 15, fontWeight: 700, padding: "2px 7px", borderRadius: 4, color: sideCol, background: rgba(sideCol, 0.12), border: `1px solid ${rgba(sideCol, 0.3)}` }}>
                        {fmt(r.strike, r.strike % 1 ? 1 : 0)}{r.side}
                      </span>
                    </div>
                    <button onClick={(e) => { e.stopPropagation(); remove(r.id); }} title="Remove" style={{
                      background: "none", border: "none", color: HOME_THEME.muted,
                      cursor: "pointer", fontSize: 16, lineHeight: 1, padding: "0 2px",
                    }}>×</button>
                  </div>
                  <div style={{ fontSize: 15, color: HOME_THEME.muted, marginTop: 4 }}>
                    {r.expiration}{r.note && <span style={{ fontStyle: "italic" }}> · {r.note}</span>}
                  </div>
                  <div style={{ display: "flex", alignItems: "baseline", gap: 10, marginTop: 14 }}>
                    <span style={{ fontSize: 26, fontWeight: 800, color: HOME_THEME.cyan, fontFamily: "var(--font-mono)" }}>
                      {fmt(s?.mark)}
                    </span>
                    <span style={{ fontSize: 15, fontWeight: 700, color: chgCol, fontFamily: "var(--font-mono)" }}>
                      {chg == null ? "—" : `${chg >= 0 ? "▲" : "▼"} ${Math.abs(chg).toFixed(2)}%`}
                    </span>
                  </div>
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginTop: 6 }}>
                    <span style={{ fontSize: 15, color: HOME_THEME.muted }}>Updated {timeAgo(s?.ts)}</span>
                    <span style={{ color: HOME_THEME.muted, fontSize: 15, transition: "transform .15s", transform: isOpen ? "rotate(90deg)" : "none", display: "inline-block" }}>▶</span>
                  </div>

                  {/* Expanded */}
                  {isOpen && (
                    <div onClick={(e) => e.stopPropagation()} style={{ marginTop: 14, paddingTop: 14, borderTop: `1px solid ${HOME_THEME.border}`, cursor: "default" }}>
                      <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 12, marginBottom: 14 }}>
                        <div><div style={statLabel}>Spot</div><div style={statValue}>{fmt(s?.spot, 2)}</div></div>
                        <div><div style={statLabel}>Bid</div><div style={statValue}>{fmt(s?.bid)}</div></div>
                        <div><div style={statLabel}>Ask</div><div style={statValue}>{fmt(s?.ask)}</div></div>
                        <div><div style={statLabel}>Δ Delta</div><div style={{ ...statValue, color: signColor(s?.delta) }}>{fmt(s?.delta, 3)}</div></div>
                        <div><div style={statLabel}>Γ Gamma</div><div style={{ ...statValue, color: signColor(s?.gamma) }}>{fmt(s?.gamma, 4)}</div></div>
                        <div><div style={statLabel}>Θ Theta</div><div style={{ ...statValue, color: signColor(s?.theta) }}>{fmt(s?.theta, 3)}</div></div>
                        <div><div style={statLabel}>V Vega</div><div style={{ ...statValue, color: signColor(s?.vega) }}>{fmt(s?.vega, 3)}</div></div>
                        <div><div style={statLabel}>IV</div><div style={statValue}>{s?.iv == null ? "—" : `${(s.iv * 100).toFixed(1)}%`}</div></div>
                        <div><div style={statLabel}>OI</div><div style={statValue}>{fmtInt(s?.open_interest)}</div></div>
                        <div><div style={statLabel}>Volume</div><div style={statValue}>{fmtInt(s?.volume)}</div></div>
                        <div><div style={statLabel}>Net Prem</div><div style={{ ...statValue, color: npCol }}>{fmtMoney(s?.net_prem)}</div></div>
                        <div><div style={statLabel}>Prev Close</div><div style={statValue}>{fmt(s?.prev_close)}</div></div>
                      </div>

                      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 10, marginBottom: 10 }}>
                        <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                          {RANGES.map((r) => {
                            const on = range === r.key;
                            return (
                              <button key={r.key} onClick={() => changeRange(r.key)} style={{
                                fontSize: 15, fontWeight: 700, padding: "4px 10px", borderRadius: 6, cursor: "pointer",
                                color: on ? HOME_THEME.text : "rgba(255,255,255,0.45)",
                                background: on ? "rgba(255,255,255,0.10)" : "transparent",
                                border: `1px solid ${on ? HOME_THEME.borderStrong : HOME_THEME.border}`,
                              }}>{r.label}</button>
                            );
                          })}
                        </div>
                      </div>

                      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 10, marginBottom: 10 }}>
                        <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                          {METRICS.map((m) => {
                            const on = metric === m.key;
                            return (
                              <button key={m.key} onClick={() => setMetric(m.key)} style={{
                                fontSize: 15, fontWeight: 700, padding: "4px 10px", borderRadius: 6, cursor: "pointer",
                                color: on ? HOME_THEME.cyan : HOME_THEME.muted,
                                background: on ? rgba(HOME_THEME.cyan, 0.12) : "transparent",
                                border: `1px solid ${on ? rgba(HOME_THEME.cyan, 0.4) : HOME_THEME.border}`,
                              }}>{m.label}</button>
                            );
                          })}
                        </div>
                        <span style={{ fontSize: 15, color: HOME_THEME.muted, fontFamily: "var(--font-mono)" }}>
                          {hist.length} snapshot{hist.length === 1 ? "" : "s"} · since {hist.length ? new Date(hist[0].ts).toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }) : "—"}
                        </span>
                      </div>
                      {historyLoading && !hist.length
                        ? <div style={{ padding: 24, textAlign: "center", color: HOME_THEME.muted, fontSize: 15 }}>Loading history…</div>
                        : <HistoryChart history={hist} metric={metric} />}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}

        <div style={{ fontSize: 15, color: HOME_THEME.muted, padding: "0 2px" }}>
          Day-chg % = mark vs. prior session close. Net Prem = mark × volume × 100 (a directional flow proxy from today&apos;s traded volume). Greeks/OI from Theta, quote from Tastytrade. Auto-refreshes every {REFRESH_MS / 1000}s.
        </div>
      </div>
    </div>
  );
}
