"use client";

/**
 * Owner · Watch — options tracker. Add a contract (ticker, strike, side,
 * expiry) and the table tracks its live greeks, option price, OI/volume and a
 * net-premium flow proxy. Data comes from /api/watch, which pulls each
 * contract from /proxy/probe-rest (Theta greeks + TT quote) and records a
 * snapshot every refresh. Auto-polls while the tab is open; a server-side
 * recorder keeps the history filling during RTH even when the page is closed.
 */

import { useCallback, useEffect, useRef, useState } from "react";
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

// ── Types ───────────────────────────────────────────────────────────────────
interface Snapshot {
  ts: number;
  spot: number | null; bid: number | null; ask: number | null;
  mark: number | null; last: number | null;
  iv: number | null; delta: number | null; gamma: number | null;
  theta: number | null; vega: number | null;
  open_interest: number | null; volume: number | null; net_prem: number | null;
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
const timeAgo = (ts: number | null | undefined) => {
  if (!ts) return "—";
  const s = Math.round((Date.now() - ts) / 1000);
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.round(s / 60)}m ago`;
  return `${Math.round(s / 3600)}h ago`;
};

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

  const timer = useRef<ReturnType<typeof setInterval> | null>(null);

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
    } catch (e) {
      setErr(String((e as Error).message || e));
    } finally {
      setRefreshing(false);
    }
  }, []);

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
    fontSize: 10, fontWeight: 700, color: HOME_THEME.muted,
    textTransform: "uppercase", letterSpacing: ".1em",
  };
  const input: React.CSSProperties = { ...homeInputStyle, width: "100%", fontSize: 13, colorScheme: "dark" };
  const th: React.CSSProperties = {
    padding: "8px 10px", textAlign: "right", fontSize: 10, fontWeight: 700,
    letterSpacing: ".1em", textTransform: "uppercase", color: HOME_THEME.muted, whiteSpace: "nowrap",
  };
  const td: React.CSSProperties = {
    padding: "9px 10px", textAlign: "right", fontSize: 12.5,
    color: HOME_THEME.text, whiteSpace: "nowrap", fontFamily: "var(--font-mono)",
  };

  const HEADERS = ["Spot", "Bid", "Ask", "Mark", "Δ", "Γ", "Θ", "V", "IV", "OI", "Vol", "Net Prem", "Updated"];

  return (
    <div style={homeShellStyle}>
      <style>{`
        .wrow{transition:background .15s ease;}
        .wrow:hover{background:${rgba(HOME_THEME.cyan, 0.05)};}
      `}</style>

      {/* Header */}
      <div style={homeHeaderStyle}>
        <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
          <span style={{ fontSize: 12, fontWeight: 800, textTransform: "uppercase", letterSpacing: ".12em", color: HOME_THEME.cyan }}>
            Owner · Watch
          </span>
          <span style={{ fontSize: 11, color: HOME_THEME.text, opacity: 0.8, fontFamily: "var(--font-mono)" }}>
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
            <input style={input} type="date" value={expiry} onChange={(e) => setExpiry(e.target.value)} required />
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
          <div style={{ ...homePanelStyle, padding: "10px 14px", color: HOME_THEME.red, fontSize: 12, borderLeft: `2px solid ${HOME_THEME.red}` }}>
            {err}
          </div>
        )}

        {/* Table */}
        <div style={{ ...homePanelStyle, padding: 0, overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr style={{ borderBottom: `2px solid ${HOME_THEME.border}` }}>
                <th style={{ ...th, textAlign: "left" }}>Contract</th>
                {HEADERS.map((h) => <th key={h} style={th}>{h}</th>)}
                <th style={{ ...th, textAlign: "center" }} />
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={HEADERS.length + 2} style={{ ...td, textAlign: "center", color: HOME_THEME.muted, padding: 28 }}>Loading…</td></tr>
              ) : rows.length === 0 ? (
                <tr><td colSpan={HEADERS.length + 2} style={{ ...td, textAlign: "center", color: HOME_THEME.muted, padding: 28 }}>No contracts yet — add one above.</td></tr>
              ) : rows.map((r) => {
                const s = r.snapshot;
                const sideCol = r.side === "C" ? HOME_THEME.green : HOME_THEME.orange;
                const npCol = s?.net_prem == null ? HOME_THEME.text : s.net_prem >= 0 ? HOME_THEME.green : HOME_THEME.red;
                return (
                  <tr key={r.id} className="wrow" style={{ borderBottom: `1px solid ${HOME_THEME.border}` }}>
                    <td style={{ ...td, textAlign: "left" }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                        <span style={{ fontWeight: 800, color: HOME_THEME.text, fontFamily: "inherit" }}>{r.ticker}</span>
                        <span style={{ fontSize: 11, fontWeight: 700, padding: "1px 6px", borderRadius: 4, color: sideCol, background: rgba(sideCol, 0.12), border: `1px solid ${rgba(sideCol, 0.3)}` }}>
                          {fmt(r.strike, r.strike % 1 ? 1 : 0)}{r.side}
                        </span>
                        <span style={{ fontSize: 11, color: HOME_THEME.muted }}>{r.expiration}</span>
                        {r.note && <span style={{ fontSize: 10, color: HOME_THEME.muted, fontStyle: "italic" }}>· {r.note}</span>}
                      </div>
                    </td>
                    <td style={td}>{fmt(s?.spot, 2)}</td>
                    <td style={td}>{fmt(s?.bid)}</td>
                    <td style={td}>{fmt(s?.ask)}</td>
                    <td style={{ ...td, color: HOME_THEME.cyan, fontWeight: 700 }}>{fmt(s?.mark)}</td>
                    <td style={td}>{fmt(s?.delta, 3)}</td>
                    <td style={td}>{fmt(s?.gamma, 4)}</td>
                    <td style={td}>{fmt(s?.theta, 3)}</td>
                    <td style={td}>{fmt(s?.vega, 3)}</td>
                    <td style={td}>{s?.iv == null ? "—" : `${(s.iv * 100).toFixed(1)}%`}</td>
                    <td style={td}>{fmtInt(s?.open_interest)}</td>
                    <td style={td}>{fmtInt(s?.volume)}</td>
                    <td style={{ ...td, color: npCol, fontWeight: 700 }}>{fmtMoney(s?.net_prem)}</td>
                    <td style={{ ...td, color: HOME_THEME.muted, fontSize: 11 }}>{timeAgo(s?.ts)}</td>
                    <td style={{ ...td, textAlign: "center" }}>
                      <button onClick={() => remove(r.id)} title="Remove" style={{
                        background: "none", border: "none", color: HOME_THEME.muted,
                        cursor: "pointer", fontSize: 16, lineHeight: 1, padding: "0 4px",
                      }}>×</button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        <div style={{ fontSize: 11, color: HOME_THEME.muted, padding: "0 2px" }}>
          Net Prem = mark × volume × 100 (a directional flow proxy from today&apos;s traded volume). Greeks/OI from Theta, quote from Tastytrade. Auto-refreshes every {REFRESH_MS / 1000}s.
        </div>
      </div>
    </div>
  );
}
