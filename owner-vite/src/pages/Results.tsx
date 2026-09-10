/**
 * /dev/results — owner-only results board.
 *
 * Two tabs: Confidence (MVC checkpoint hit rates, /api/confidence/checkpoints)
 * and Contracts (the CB contract trade log, /api/cb-trades). Inherits the owner
 * guard from app/dev/layout.tsx.
 *
 * The ICT Results, Fail Rate and Walls tabs were removed — see CHANGELOG.
 */

import React, { useCallback, useEffect, useMemo, useState } from "react";
import { PageShell } from "../components/PageCard";
import { HOME_THEME, classicCardAccentStyle } from "../lib/theme";

// Theme sourced from the shared dashboard palette (components/shared/homeTheme.ts) —
// single source of truth so this page matches every other page. `label`/`MUTED`
// map to HOME_THEME.text/.muted, which are both pure white in this theme (no gray text).
const C = { cyan: HOME_THEME.cyan, border: HOME_THEME.border, card: HOME_THEME.panelBg, label: HOME_THEME.text, purple: HOME_THEME.purple };
const GREEN = HOME_THEME.green, RED = HOME_THEME.red, AMBER = HOME_THEME.orange, MUTED = HOME_THEME.muted;
// Frosted card surface (matches /confidence-score and the site-wide Budget-card look).
const CARD = classicCardAccentStyle;
function rgba(hex: string, a: number) {
  const h = hex.replace("#", "");
  const n = parseInt(h.length === 3 ? h.split("").map((c) => c + c).join("") : h, 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
}

function wrColor(wr: number | null): string {
  if (wr == null) return MUTED;
  if (wr >= 0.6) return GREEN;
  if (wr >= 0.45) return AMBER;
  return RED;
}

type TabKey = "checkpoints" | "contracts";

export default function Results() {
  const [tab, setTab] = useState<TabKey>("checkpoints");

  const tabBtn = (key: TabKey): React.CSSProperties => ({
    fontSize: 14, fontWeight: 800, padding: "7px 18px", borderRadius: 8, cursor: "pointer",
    border: `1px solid ${tab === key ? C.cyan : C.border}`,
    background: tab === key ? rgba(C.cyan, 0.18) : "transparent",
    color: tab === key ? C.cyan : C.label, letterSpacing: "0.08em", textTransform: "uppercase",
    fontFamily: "inherit",
  });

  // `wall-scroll` themes the page's own scrollbar (see index.css) — PageShell's
  // <main> is the scroll container for both tabs here, and on a short monitor
  // the Contracts table is taller than it, so that bar is now visible chrome
  // rather than an accident.
  //
  // This note used to sit inside the `return (…)` as a {/* JSX comment */}. That
  // is a syntax error, not a style nit: `{…}` only means "expression container"
  // INSIDE JSX, and here it was the first token after `return (`, where esbuild
  // reads it as an object literal and dies with `Expected ")" but found
  // "className"`. It broke the owner-vite Docker build. Comments that precede
  // the root element go above the return, as ordinary // lines.
  return (
    <PageShell className="wall-scroll">
      {/* Tab bar */}
      <div className="tab-strip" style={{ display: "flex", gap: 8, marginBottom: 18, flexShrink: 0 }}>
        <button onClick={() => setTab("checkpoints")} style={tabBtn("checkpoints")}>Confidence</button>
        <button onClick={() => setTab("contracts")} style={tabBtn("contracts")}>Contracts</button>
      </div>

      {tab === "contracts" ? <TradesView /> : <CheckpointsView />}
    </PageShell>
  );
}

// ── Confidence tab: MVC checkpoint tracking (9:45 / 10:30 / 12:00) ──
// For each session, how close SPX got to the MVC strike that was active at each
// checkpoint, and whether it was hit (within HIT_PTS). Data: /api/confidence/checkpoints.
//
// Deliberately hit rates ONLY. The dollar side of the same three checkpoints —
// what the CB-strike 0DTE contract cost, whether the <= $1.00 rule bought it,
// and what the auto-sell did with it — lives on the Contracts tab, because
// bolting three more columns onto a table that already carries a strike, a
// distance and three tier ticks per checkpoint made both halves unreadable.
// This view fetches with ?contracts=0 so the server skips that join entirely.
type CpCell = {
  key: string; label: string;
  strike: number | null; spxAt: number | null; distAt: number | null;
  closest: number | null; hit: boolean; matched: boolean;
  tiers?: Record<number, boolean | null>;
  changed?: boolean;
};
type CpDay = { date: string; checkpoints: CpCell[] };
type CpSummary = {
  key: string; label: string; samples: number; hits: number;
  hitRate: number | null; avgClosest: number | null;
  tiers?: Record<number, { hits: number; rate: number | null }>;
};
const TIERS = [5, 10, 15] as const;

function CheckpointsView() {
  const [days, setDays] = useState<CpDay[]>([]);
  const [summary, setSummary] = useState<CpSummary[]>([]);
  const [hitPts, setHitPts] = useState(8);
  const [range, setRange] = useState<"7d" | "20d" | "all">("20d");
  const [loaded, setLoaded] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const qs = `${range === "all" ? "?all=1" : range === "7d" ? "?since=7" : "?since=20"}&contracts=0`;

  const load = useCallback(async () => {
    setErr(null);
    try {
      const r = await fetch(`/api/confidence/checkpoints${qs}`, { cache: "no-store" });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const j = await r.json();
      setDays(Array.isArray(j.days) ? j.days : []);
      setSummary(Array.isArray(j.summary) ? j.summary : []);
      if (typeof j.hitPts === "number") setHitPts(j.hitPts);
      setLoaded(true);
    } catch (e) { setErr(String(e)); setLoaded(true); }
  }, [qs]);

  useEffect(() => { setLoaded(false); load(); const id = setInterval(load, 60_000); return () => clearInterval(id); }, [load]);

  const rangeBtn = (key: typeof range, _label: string): React.CSSProperties => ({
    fontSize: 14, fontWeight: 800, padding: "6px 14px", borderRadius: 8, cursor: "pointer",
    border: `1px solid ${range === key ? C.cyan : C.border}`,
    background: range === key ? rgba(C.cyan, 0.18) : "transparent",
    color: range === key ? C.cyan : C.label, letterSpacing: "0.06em", textTransform: "uppercase", fontFamily: "inherit",
  });

  const distColor = (d: number | null): string => {
    if (d == null) return MUTED;
    if (d <= hitPts) return GREEN;
    if (d <= hitPts * 2.5) return AMBER;
    return RED;
  };

  const th: React.CSSProperties = { padding: "10px 14px", fontSize: 14, fontWeight: 800, letterSpacing: "0.08em", textTransform: "uppercase", color: C.label, textAlign: "left", whiteSpace: "nowrap" };
  const td: React.CSSProperties = { padding: "10px 14px", fontSize: 14, whiteSpace: "nowrap", fontFamily: "var(--font-mono)" };

  return (
    <>
      <div style={{ display: "flex", alignItems: "baseline", gap: 12, marginBottom: 14, flexWrap: "wrap" }}>
        <span style={{ fontSize: 17, fontWeight: 800, color: C.cyan, textTransform: "uppercase", letterSpacing: "0.1em" }}>Confidence</span>
        <span style={{ fontSize: 14, color: C.label }}>CB - Core Bullseye at 9:45 / 10:30 / 12:00 · how close SPX got · hit = within {hitPts} pts</span>
        <div style={{ marginLeft: "auto", display: "flex", gap: 8 }}>
          <button onClick={() => setRange("7d")} style={rangeBtn("7d", "7d")}>7d</button>
          <button onClick={() => setRange("20d")} style={rangeBtn("20d", "20d")}>20d</button>
          <button onClick={() => setRange("all")} style={rangeBtn("all", "All")}>All</button>
        </div>
      </div>

      {/* Per-checkpoint hit-rate roll-up */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(260px, 1fr))", gap: 14, marginBottom: 22 }}>
        {summary.map((s) => {
          // Bare CARD, no accent strip: the ICT cards use the frosted surface
          // unadorned, and a coloured top border made these read as a different
          // card family on the same page. `accent` still colours the stat text.
          const accent = wrColor(s.hitRate);
          return (
            <div key={s.key} className="card-hover" style={{ ...CARD, padding: "16px 18px", display: "flex", flexDirection: "column", gap: 8 }}>
              <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between" }}>
                <span style={{ fontSize: 17, fontWeight: 800, color: C.label }}>{s.label}</span>
                <span style={{ fontSize: 14, fontWeight: 700, color: C.label, textTransform: "uppercase", letterSpacing: "0.1em" }}>{s.samples} days</span>
              </div>
              <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
                <span style={{ fontSize: 14, fontWeight: 800, color: accent, fontFamily: "var(--font-mono)", lineHeight: 1 }}>
                  {s.hitRate != null ? `${Math.round(s.hitRate * 100)}%` : "—"}
                </span>
                <span style={{ fontSize: 14, color: C.label, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.08em" }}>
                  hit rate{s.samples > 0 ? ` · ${s.hits}/${s.samples}` : ""}
                </span>
              </div>
              <div style={{ fontSize: 14, color: C.label, fontFamily: "var(--font-mono)" }}>
                avg closest: <span style={{ color: distColor(s.avgClosest), fontWeight: 700 }}>{s.avgClosest != null ? `${s.avgClosest.toFixed(1)} pt` : "—"}</span>
              </div>
              <div style={{ display: "flex", gap: 6, marginTop: 4 }}>
                {TIERS.map((t) => {
                  const ts = s.tiers?.[t];
                  const rate = ts?.rate ?? null;
                  const ac = wrColor(rate);
                  return (
                    <div key={t} style={{ flex: 1, textAlign: "center", background: "rgba(255,255,255,0.03)", border: `1px solid ${C.border}`, borderRadius: 8, padding: "6px 4px" }}>
                      <div style={{ fontSize: 14, fontWeight: 700, color: C.label, textTransform: "uppercase", letterSpacing: "0.06em" }}>≤{t}pt</div>
                      <div style={{ fontSize: 14, fontWeight: 800, color: ac, fontFamily: "var(--font-mono)", lineHeight: 1.2 }}>
                        {rate != null ? `${Math.round(rate * 100)}%` : "—"}
                      </div>
                      <div style={{ fontSize: 14, color: C.label, fontFamily: "var(--font-mono)" }}>{ts ? `${ts.hits}/${s.samples}` : ""}</div>
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>

      {err && <div style={{ color: RED, fontSize: 14, marginBottom: 14, fontFamily: "var(--font-mono)" }}>Couldn&apos;t load checkpoints: {err}</div>}

      {!loaded ? (
        <div style={{ color: C.label, fontSize: 14 }}>Loading checkpoints…</div>
      ) : days.length === 0 ? (
        <div style={{ ...CARD, padding: "20px 22px", color: C.label, fontSize: 14 }}>
          No MVC snapshots in this range yet.
        </div>
      ) : (
        <div style={{ ...CARD, padding: 0, overflow: "hidden" }}>
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead>
                <tr style={{ borderBottom: `1px solid ${C.border}` }}>
                  <th style={th}>Date</th>
                  {["9:45", "10:30", "12:00"].map((l) => (
                    <th key={l} style={{ ...th, textAlign: "center", borderLeft: `1px solid ${C.border}` }} colSpan={5}>{l} CB</th>
                  ))}
                </tr>
                <tr style={{ borderBottom: `1px solid ${C.border}` }}>
                  <th style={th}></th>
                  {[0, 1, 2].map((i) => (
                    <React.Fragment key={i}>
                      <th style={{ ...th, textAlign: "right", borderLeft: `1px solid ${C.border}` }}>Strike</th>
                      <th style={{ ...th, textAlign: "right" }}>Closest</th>
                      {TIERS.map((t) => (
                        <th key={t} style={{ ...th, textAlign: "center" }}>≤{t}</th>
                      ))}
                    </React.Fragment>
                  ))}
                </tr>
              </thead>
              <tbody>
                {days.map((d, di) => (
                  <tr key={d.date} style={{ borderTop: di ? `1px solid ${C.border}` : undefined }}>
                    <td style={{ ...td, color: C.label }}>{d.date}</td>
                    {d.checkpoints.map((c) => (
                      <React.Fragment key={c.key}>
                        <td style={{ ...td, textAlign: "right", color: C.label, borderLeft: `1px solid ${C.border}` }}>
                          {c.strike != null ? c.strike.toFixed(0) : "—"}
                          {c.changed && (
                            <span title="CB changed at next checkpoint — window scored only until then" style={{ marginLeft: 5, fontSize: 14, color: AMBER, fontWeight: 700 }}>↻</span>
                          )}
                        </td>
                        <td style={{ ...td, textAlign: "right", color: distColor(c.closest), fontWeight: 700 }}>
                          {c.closest != null ? `${c.closest.toFixed(1)}` : "—"}
                        </td>
                        {TIERS.map((t) => {
                          const v = c.tiers?.[t];
                          return (
                            <td key={t} style={{ ...td, textAlign: "center" }}>
                              {!c.matched || v == null ? <span style={{ color: MUTED }}>·</span>
                                : v ? <span style={{ color: GREEN, fontWeight: 800 }}>✓</span>
                                : <span style={{ color: RED, fontWeight: 800 }}>✗</span>}
                            </td>
                          );
                        })}
                      </React.Fragment>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </>
  );
}

// ── Contracts tab: the CB contract trade log ───────────────────────────────
// One row per checkpoint of one session: the CB-strike 0DTE contract probed on
// TastyTrade (server-v2/cb-contract-track.js, via the same /proxy/probe-rest
// pipeline /owner/probe uses), what the <= $1.00 rule paid for it, what the
// 5-10 pt auto-sell got out at, and the P&L. Data: /api/cb-trades.
//
// Clicking the contract opens the probe chart for that exact trade — the same
// chart /owner/probe draws, but plotted from cb_trade_ticks (the recorder's
// poll-by-poll marks) instead of watch_snapshots, so it covers exactly the span
// the position was live.
//
// SKIPPED ROWS ARE THE POINT. A checkpoint where the contract came back at
// $2.40 is a recorded decision, not a gap — without it the board silently
// rewrites its own history and "no trades this week" becomes indistinguishable
// from "the recorder was down". They stay in the table, greyed, with the price
// and reason that disqualified them.
type CbTrade = {
  id: number; date: string; checkpoint: string; checkpoint_label: string | null;
  ticker: string; expiration: string; side: "C" | "P";
  strike: number;              // the contract actually bought (where the walk landed)
  cb_strike: number | null;    // the CB it targets — what the sell distance measures to
  cb_price: number | null;     // what the CB strike itself cost (why the walk happened)
  walk_steps: number | null;   // strikes stepped from the CB toward the money
  occ_symbol: string | null; streamer_symbol: string | null;
  status: "skipped" | "open" | "closed"; skip_reason: string | null;
  probe_ts: number | string; probe_price: number | null; probe_bid: number | null; probe_ask: number | null;
  probe_spot: number | null; probe_dist: number | null;
  entry_ts: number | string | null; entry_price: number | null; entry_spot: number | null;
  signal_ts: number | string | null; signal_dist: number | null;   // legacy — the auto-sell that no longer exists
  best_ts: number | string | null; worst_ts: number | string | null;
  exit_ts: number | string | null; exit_price: number | null; exit_spot: number | null; exit_reason: string | null;
  last_ts: number | string | null; last_price: number | null; last_spot: number | null; last_dist: number | null;
  best_price: number | null; worst_price: number | null; closest_dist: number | null;
  pnl: number | null; pnl_usd: number | null; polls: number;
  last_error: string | null;   // why the most recent poll did not price
};
type CbSummary = {
  key: string; label: string; probes: number; trades: number; openNow: number;
  peakedUp: number; avgPeakGain: number | null; wins: number; winRate: number | null;
  avgPnl: number | null; totalPnl: number | null; totalPnlUsd: number | null; takeRate: number | null;
};
type CbConfig = {
  BUY_MIN: number; STRIKE_STEP: number; WALK_MAX_STEPS: number;
  PROBE_TICKER: string; MULTIPLIER: number; CHECKPOINT_GRACE_MIN: number;
};
type CbTick = {
  ts: number | string; mark: number | null; bid: number | null; ask: number | null;
  spot: number | null; dist: number | null;
  // Present on stream-sourced bars: the true intra-minute range. A REST-probed
  // row has these equal to `mark`, so the band collapses to the line on its own.
  mark_open: number | null; mark_high: number | null; mark_low: number | null;
  src: string | null;
};

// BIGINT columns come back from node-pg as STRINGS (no type parser is
// registered in lib/db.ts), so every timestamp has to be coerced before it goes
// anywhere near a Date. Doing it here rather than at each call site is what
// keeps "Invalid Date" out of the table.
//
// The null/"" guard is load-bearing, not defensive noise: Number(null) is 0 and
// Number("") is 0, and both pass Number.isFinite. Without it every open and
// every skipped row rendered its P&L as a confident "0.00" instead of "—" — a
// fabricated number indistinguishable from a real flat trade.
const n = (v: unknown): number | null => {
  if (v == null || v === "") return null;
  const x = Number(v);
  return Number.isFinite(x) ? x : null;
};
const contractLabel = (t: CbTrade) =>
  t.strike ? `${Number(t.strike).toFixed(0)}${t.side}` : "—";

function TradesView() {
  const [trades, setTrades] = useState<CbTrade[]>([]);
  const [summary, setSummary] = useState<CbSummary[]>([]);
  const [config, setConfig] = useState<CbConfig | null>(null);
  const [range, setRange] = useState<"7d" | "20d" | "all">("20d");
  const [showSkipped, setShowSkipped] = useState(true);
  const [openTrade, setOpenTrade] = useState<CbTrade | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<{ text: string; bad: boolean } | null>(null);
  const [diag, setDiag] = useState<unknown>(null);

  const qs = range === "all" ? "?all=1" : range === "7d" ? "?since=7" : "?since=20";

  const load = useCallback(async () => {
    setErr(null);
    try {
      const r = await fetch(`/api/cb-trades${qs}`, { cache: "no-store" });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const j = await r.json();
      setTrades(Array.isArray(j.trades) ? j.trades : []);
      setSummary(Array.isArray(j.summary) ? j.summary : []);
      setConfig(j.config ?? null);
      setLoaded(true);
    } catch (e) { setErr(String(e)); setLoaded(true); }
  }, [qs]);

  useEffect(() => { setLoaded(false); load(); const id = setInterval(load, 60_000); return () => clearInterval(id); }, [load]);

  // Force one recorder pass. Same code path the 60s tick uses and idempotent, so
  // pressing it twice costs nothing — it just re-polls whatever is open.
  const runNow = useCallback(async () => {
    setBusy(true); setStatus(null);
    try {
      const r = await fetch("/api/cb-trades", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "tick" }),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j?.error || `HTTP ${r.status}`);
      const opened = (j.opened ?? []).length;
      const polled = j.polled?.polled ?? 0;
      const errors = j.polled?.errors ?? 0;
      setStatus({
        text: `${opened} opened · ${polled} priced · ${errors} probe error${errors === 1 ? "" : "s"}`
          + `${j.note ? ` · ${j.note}` : ""}`,
        bad: errors > 0 || (polled === 0 && (j.polled?.open ?? 0) > 0),
      });
      await load();
    } catch (e) { setStatus({ text: String(e), bad: true }); }
    finally { setBusy(false); }
  }, [load]);

  const runDiagnose = useCallback(async () => {
    setBusy(true); setStatus(null);
    try {
      const r = await fetch("/api/cb-trades?diag=1", { cache: "no-store" });
      const j = await r.json();
      if (!r.ok) throw new Error(j?.error || `HTTP ${r.status}`);
      setDiag(j);
    } catch (e) { setStatus({ text: String(e), bad: true }); }
    finally { setBusy(false); }
  }, []);

  const actionBtn = (disabled: boolean): React.CSSProperties => ({
    fontSize: 14, fontWeight: 800, padding: "6px 14px", borderRadius: 8,
    cursor: disabled ? "default" : "pointer", opacity: disabled ? 0.6 : 1,
    border: `1px solid ${C.border}`, background: "transparent", color: C.label,
    letterSpacing: "0.06em", textTransform: "uppercase", fontFamily: "inherit",
  });

  const buyMin = config?.BUY_MIN ?? 1.0;
  const mult = config?.MULTIPLIER ?? 100;

  const visible = useMemo(
    () => (showSkipped ? trades : trades.filter((t) => t.status !== "skipped")),
    [trades, showSkipped],
  );
  const totals = useMemo(() => {
    // `status === "closed"`, not `pnl != null`. Held positions now carry a
    // mark-to-market pnl all day, so the old test folded live marks into the
    // booked win rate and the net dollar figure — numbers that are supposed to
    // mean "this is what the day actually paid".
    const settled = trades.filter((t) => t.status === "closed" && t.pnl != null);
    const wins = settled.filter((t) => (n(t.pnl) ?? 0) > 0).length;
    return {
      probes: trades.length,
      taken: trades.filter((t) => t.status !== "skipped").length,
      open: trades.filter((t) => t.status === "open").length,
      closed: settled.length,
      wins,
      winRate: settled.length ? wins / settled.length : null,
      usd: settled.reduce((a, t) => a + (n(t.pnl_usd) ?? 0), 0),
    };
  }, [trades]);

  const rangeBtn = (key: typeof range): React.CSSProperties => ({
    fontSize: 14, fontWeight: 800, padding: "6px 14px", borderRadius: 8, cursor: "pointer",
    border: `1px solid ${range === key ? C.cyan : C.border}`,
    background: range === key ? rgba(C.cyan, 0.18) : "transparent",
    color: range === key ? C.cyan : C.label, letterSpacing: "0.06em", textTransform: "uppercase", fontFamily: "inherit",
  });

  const th: React.CSSProperties = { padding: "10px 14px", fontSize: 14, fontWeight: 800, letterSpacing: "0.08em", textTransform: "uppercase", color: C.label, textAlign: "left", whiteSpace: "nowrap" };
  const td: React.CSSProperties = { padding: "10px 14px", fontSize: 14, whiteSpace: "nowrap", fontFamily: "var(--font-mono)" };

  return (
    // Every direct child here is a flex item of PageShell's <main> (a column
    // flexbox that scrolls). Flex items default to flex-shrink:1, so on a short
    // monitor the table card was squeezed to fit the viewport instead of
    // overflowing it — and its own overflow:hidden then clipped the rows, with
    // no scrollbar anywhere. flexShrink:0 on each block lets the content run
    // past the bottom so <main> scrolls it.
    <>
      <div style={{ display: "flex", alignItems: "baseline", gap: 12, marginBottom: 14, flexWrap: "wrap", flexShrink: 0 }}>
        <span style={{ fontSize: 17, fontWeight: 800, color: C.purple, textTransform: "uppercase", letterSpacing: "0.1em" }}>Contracts</span>
        <span style={{ fontSize: 14, color: C.label }}>
          0DTE probed on TastyTrade at 9:45 / 10:30 / 12:00 · from the CB, walk toward the money to the first strike over ${buyMin.toFixed(2)} · held and re-priced every minute to the bell · ×{mult}
        </span>
        <div style={{ marginLeft: "auto", display: "flex", gap: 8 }}>
          <button
            onClick={() => setShowSkipped((v) => !v)}
            title="Skipped rows are checkpoints that were probed but never qualified — keeping them visible is what separates 'nothing set up' from 'the recorder was down'."
            style={{
              fontSize: 14, fontWeight: 800, padding: "6px 14px", borderRadius: 8, cursor: "pointer",
              border: `1px solid ${showSkipped ? C.purple : C.border}`,
              background: showSkipped ? rgba(C.purple, 0.18) : "transparent",
              color: showSkipped ? C.purple : C.label, letterSpacing: "0.06em", textTransform: "uppercase", fontFamily: "inherit",
            }}
          >
            Skipped {showSkipped ? "on" : "off"}
          </button>
          <button onClick={() => setRange("7d")} style={rangeBtn("7d")}>7d</button>
          <button onClick={() => setRange("20d")} style={rangeBtn("20d")}>20d</button>
          <button onClick={() => setRange("all")} style={rangeBtn("all")}>All</button>
        </div>
      </div>

      {/* Recorder controls. "Nothing is updating" is the failure this feature is
          most likely to hit — the whole thing hangs off a 60s in-process poll —
          so forcing a tick and reading the diagnosis are one click, not an SSH
          session. */}
      <div style={{ display: "flex", gap: 8, marginBottom: 16, flexWrap: "wrap", alignItems: "center", flexShrink: 0 }}>
        <button onClick={() => void runNow()} disabled={busy} style={actionBtn(busy)}>
          {busy ? "Running…" : "Run now"}
        </button>
        <button onClick={() => void runDiagnose()} disabled={busy} style={actionBtn(busy)}>Diagnose</button>
        {status && <span style={{ fontSize: 14, color: status.bad ? AMBER : GREEN, fontFamily: "var(--font-mono)" }}>{status.text}</span>}
      </div>

      {/* Per-checkpoint roll-up */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(260px, 1fr))", gap: 14, marginBottom: 22, flexShrink: 0 }}>
        {summary.map((s) => {
          // Bare CARD — see the note on the Confidence cards above.
          const accent = wrColor(s.winRate);
          return (
            <div key={s.key} className="card-hover" style={{ ...CARD, padding: "16px 18px", display: "flex", flexDirection: "column", gap: 8 }}>
              {/* Type scale is the dashboard's, not this card's own: 17 for the
                  title, 14 for everything else, C.label for text, mono only on
                  numbers — the same block the ICT and Confidence cards use. A
                  20px headline stat here made this one card shout next to them. */}
              <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 10 }}>
                <span style={{ fontSize: 17, fontWeight: 800, color: C.label, letterSpacing: "0.02em" }}>{s.label}</span>
                <span style={{ fontSize: 14, fontWeight: 700, color: C.label, textTransform: "uppercase", letterSpacing: "0.12em", whiteSpace: "nowrap" }}>
                  {s.trades}/{s.probes} taken
                </span>
              </div>
              <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
                <span style={{ fontSize: 14, fontWeight: 800, color: accent, fontFamily: "var(--font-mono)", lineHeight: 1 }}>
                  {s.winRate != null ? `${Math.round(s.winRate * 100)}%` : "—"}
                </span>
                <span style={{ fontSize: 14, color: C.label, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.1em" }}>
                  win rate{s.trades > 0 ? ` · ${s.wins}/${s.trades - s.openNow}` : ""}
                </span>
              </div>
              <div style={{ display: "flex", justifyContent: "space-between", fontSize: 14 }}>
                <span style={{ color: C.label }} title="How often the contract ever traded above what was paid — the move was there, whether or not anyone took it.">
                  Traded up
                </span>
                <span style={{ color: s.peakedUp > 0 ? GREEN : MUTED, fontWeight: 700, fontFamily: "var(--font-mono)" }}>
                  {s.peakedUp}/{s.trades}
                </span>
              </div>
              <div style={{ display: "flex", justifyContent: "space-between", fontSize: 14 }}>
                <span style={{ color: C.label }} title="Average distance from entry to the day's peak mark.">Avg peak</span>
                <span style={{ color: s.avgPeakGain == null ? MUTED : s.avgPeakGain >= 0 ? GREEN : RED, fontWeight: 700, fontFamily: "var(--font-mono)" }}>
                  {s.avgPeakGain != null ? `${s.avgPeakGain > 0 ? "+" : ""}${s.avgPeakGain.toFixed(2)}` : "—"}
                </span>
              </div>
              <div style={{ display: "flex", justifyContent: "space-between", fontSize: 14 }}>
                <span style={{ color: C.label }}>Avg P&amp;L</span>
                <span style={{ color: s.avgPnl == null ? MUTED : s.avgPnl >= 0 ? GREEN : RED, fontWeight: 700, fontFamily: "var(--font-mono)" }}>
                  {s.avgPnl != null ? `${s.avgPnl > 0 ? "+" : ""}${s.avgPnl.toFixed(2)}` : "—"}
                </span>
              </div>
              <div style={{ display: "flex", justifyContent: "space-between", fontSize: 14 }}>
                <span style={{ color: C.label }}>Total</span>
                <span style={{ color: s.totalPnlUsd == null ? MUTED : s.totalPnlUsd >= 0 ? GREEN : RED, fontWeight: 800, fontFamily: "var(--font-mono)" }}>
                  {s.totalPnlUsd != null ? `${s.totalPnlUsd > 0 ? "+" : "−"}$${Math.abs(s.totalPnlUsd).toFixed(0)}` : "—"}
                </span>
              </div>
              {s.openNow > 0 && (
                <span style={{ fontSize: 14, color: C.cyan, fontWeight: 700 }}>{s.openNow} open right now</span>
              )}
            </div>
          );
        })}
      </div>

      {err && <div style={{ color: RED, fontSize: 14, marginBottom: 14, fontFamily: "var(--font-mono)", flexShrink: 0 }}>Couldn&apos;t load contracts: {err}</div>}

      {!loaded ? (
        <div style={{ color: C.label, fontSize: 14, flexShrink: 0 }}>Loading contracts…</div>
      ) : trades.length === 0 ? (
        <div style={{ ...CARD, padding: "20px 22px", color: C.label, fontSize: 14, lineHeight: 1.6, flexShrink: 0 }}>
          No checkpoints recorded yet. The tracker writes a row per checkpoint as each session runs —
          TastyTrade has no per-contract history, so this table fills forward from the day the recorder
          went live and cannot be backfilled. First rows appear at 9:45 ET on the next trading day.
        </div>
      ) : (
        <div style={{ ...CARD, padding: 0, overflow: "hidden", flexShrink: 0 }}>
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead>
                <tr style={{ borderBottom: `1px solid ${C.border}` }}>
                  <th style={th}>Date</th>
                  <th style={th}>Time</th>
                  <th style={th}>Contract</th>
                  <th style={{ ...th, textAlign: "right" }}>Entry</th>
                  <th style={{ ...th, textAlign: "right" }}>Peak</th>
                  <th style={{ ...th, textAlign: "right" }}>P/L</th>
                </tr>
              </thead>
              <tbody>
                {visible.map((t, i) => {
                  const skipped = t.status === "skipped";
                  // A held position is marked to its last poll. It is shown, but
                  // starred and dimmed — an unrealized number that reads exactly
                  // like a booked one is how a board starts lying to you.
                  //
                  // The flag is `status`, NOT "did the server send a pnl". Once
                  // positions began being held all day the server started writing
                  // pnl on open rows too, and a `pnl ?? live` test silently
                  // stopped starring anything — every live mark read as booked.
                  const unrealized = t.status === "open";
                  const shown = n(t.pnl) ?? (t.entry_price != null && t.last_price != null
                    ? Math.round((n(t.last_price)! - n(t.entry_price)!) * 100) / 100
                    : null);
                  const entryVsPeak = t.best_price != null && t.entry_price != null
                    ? Number(t.best_price) - Number(t.entry_price) : null;
                  return (
                    <tr key={t.id} style={{ borderTop: i ? `1px solid ${C.border}` : undefined, opacity: skipped ? 0.55 : 1 }}>
                      <td style={{ ...td, color: C.label }}>{t.date}</td>
                      <td style={{ ...td, color: C.label, fontWeight: 700 }}>{t.checkpoint_label ?? t.checkpoint}</td>
                      <td style={td}>
                        <button
                          type="button"
                          onClick={() => setOpenTrade(t)}
                          title={skipped
                            ? (t.skip_reason ?? "not taken")
                            : `${t.ticker} ${t.expiration}`
                              + `${t.cb_strike != null ? ` · CB ${Number(t.cb_strike).toFixed(0)}` : ""}`
                              + `${t.cb_price != null ? ` priced $${Number(t.cb_price).toFixed(2)}` : ""}`
                              + `${t.walk_steps ? ` · walk ${t.walk_steps}` : " · walk 0"}`}
                          style={{
                            font: "inherit", fontFamily: "var(--font-mono)", cursor: "pointer",
                            background: "transparent", border: `1px solid ${rgba(skipped ? MUTED : C.cyan, 0.4)}`,
                            color: skipped ? MUTED : C.cyan, fontWeight: 800, borderRadius: 6, padding: "3px 9px",
                          }}
                        >
                          {contractLabel(t)}
                          {/* The CB is the target, the strike is the instrument. Showing
                              only one of them is how you end up reading a 6635C as if the
                              board had said the CB was 6635. */}
                          {t.cb_strike != null && Number(t.cb_strike) !== Number(t.strike) && (
                            <span style={{ marginLeft: 6, fontSize: 14, fontWeight: 700, color: MUTED }}>
                              ←CB {Number(t.cb_strike).toFixed(0)}
                            </span>
                          )}
                        </button>
                      </td>
                      <td style={{ ...td, textAlign: "right", color: C.label }}>
                        {t.entry_price != null ? (
                          <span title={`filled ${etClock(n(t.entry_ts) ?? 0)} · SPX ${n(t.entry_spot)?.toFixed(2) ?? "—"}`
                            + `${t.cb_price != null ? ` · the CB ${Number(t.cb_strike ?? 0).toFixed(0)} was $${Number(t.cb_price).toFixed(2)}` : ""}`}>
                            ${Number(t.entry_price).toFixed(2)}
                          </span>
                        ) : (
                          <span style={{ color: MUTED }} title={t.skip_reason ?? "not taken"}>
                            {t.probe_price != null ? `($${Number(t.probe_price).toFixed(2)})` : "—"}
                          </span>
                        )}
                      </td>
                      <td style={{ ...td, textAlign: "right" }}>
                        {/* The day's high-water mark, not an exit. There is no
                            sell rule any more, so this is what was there to take
                            rather than what a rule took. */}
                        {t.best_price != null ? (
                          <span
                            title={`peak $${Number(t.best_price).toFixed(2)}`
                              + `${t.best_ts ? ` at ${etClock(n(t.best_ts) ?? 0)}` : ""}`
                              + `${t.worst_price != null ? ` · low $${Number(t.worst_price).toFixed(2)}` : ""}`
                              + `${t.closest_dist != null ? ` · SPX came within ${Number(t.closest_dist).toFixed(1)} pt of the CB` : ""}`}
                            style={{ color: entryVsPeak == null ? C.label : entryVsPeak > 0 ? GREEN : MUTED, fontWeight: 700 }}
                          >
                            ${Number(t.best_price).toFixed(2)}
                            {t.best_ts != null && (
                              <span style={{ marginLeft: 5, fontSize: 14, color: MUTED }}>{etClock(n(t.best_ts) ?? 0)}</span>
                            )}
                          </span>
                        ) : <span style={{ color: MUTED }}>—</span>}
                      </td>
                      <td style={{ ...td, textAlign: "right", fontWeight: 800, color: shown == null ? MUTED : shown >= 0 ? GREEN : RED, opacity: unrealized ? 0.75 : 1 }}>
                        {shown != null ? (
                          <>
                            {`${shown > 0 ? "+" : ""}${shown.toFixed(2)}${unrealized ? "*" : ""}`}
                            <span style={{ marginLeft: 7, fontSize: 14, fontWeight: 700, color: MUTED }}>
                              {shown >= 0 ? "+" : "−"}${Math.abs(shown * mult).toFixed(0)}
                            </span>
                          </>
                        ) : "—"}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <div style={{ borderTop: `1px solid ${C.border}`, padding: "10px 14px", display: "flex", gap: 18, flexWrap: "wrap", fontSize: 14, color: MUTED }}>
            <span>{totals.probes} checkpoints probed · {totals.taken} traded · {totals.open} open</span>
            <span>{totals.winRate != null ? `${Math.round(totals.winRate * 100)}% win rate (${totals.wins}/${totals.closed})` : "nothing closed yet"}</span>
            <span style={{ color: totals.usd >= 0 ? GREEN : RED, fontWeight: 800 }}>
              net {totals.usd >= 0 ? "+" : "−"}${Math.abs(totals.usd).toFixed(0)}
            </span>
            <span style={{ marginLeft: "auto" }}>
              ←CB marks a walked strike · held to the bell, no exit rule · <span style={{ fontWeight: 800 }}>*</span> unrealized
            </span>
          </div>
        </div>
      )}

      {openTrade && <CbProbeModal trade={openTrade} mult={mult} onClose={() => setOpenTrade(null)} />}
      {diag != null && <DiagnoseModal data={diag} onClose={() => setDiag(null)} />}
    </>
  );
}

/** Raw diagnosis dump — deliberately unformatted; it is meant to be read and pasted. */
function DiagnoseModal({ data, onClose }: { data: unknown; onClose: () => void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  return (
    <div onClick={onClose} style={{ position: "fixed", inset: 0, zIndex: 1000, background: "rgba(5,6,10,0.72)", display: "flex", alignItems: "center", justifyContent: "center", padding: 24 }}>
      <div onClick={(e) => e.stopPropagation()} style={{ ...CARD, width: "min(900px, 100%)", maxHeight: "88vh", overflow: "auto", padding: "18px 20px" }}>
        <div style={{ display: "flex", alignItems: "baseline", gap: 12, marginBottom: 12 }}>
          <span style={{ fontSize: 17, fontWeight: 800, color: C.purple, textTransform: "uppercase", letterSpacing: "0.08em" }}>Recorder diagnosis</span>
          <span style={{ fontSize: 14, color: MUTED }}>recorder liveness · CB per checkpoint · a live probe · row/tick counts</span>
          <button onClick={onClose} style={{ marginLeft: "auto", font: "inherit", fontSize: 17, fontWeight: 800, cursor: "pointer", background: "transparent", border: `1px solid ${C.border}`, color: C.label, borderRadius: 7, padding: "2px 10px" }}>×</button>
        </div>
        <pre style={{ margin: 0, fontSize: 14, lineHeight: 1.55, color: C.label, fontFamily: "var(--font-mono)", whiteSpace: "pre-wrap", wordBreak: "break-word" }}>
          {JSON.stringify(data, null, 2)}
        </pre>
      </div>
    </div>
  );
}

// ── Probe chart popup ──────────────────────────────────────────────────────
// The /owner/probe chart, pointed at one CB trade. Same shape as ProbeChart
// there — gradient area under a cyan line, five gridlines with value labels,
// first/last timestamps, a dot on the latest point — but plotted from
// cb_trade_ticks, so the x-axis spans exactly the minutes the position was live
// rather than a rolling 1D/1W window.
const CB_METRICS = [
  { key: "mark", label: "Price", dec: 2, prefix: "$" },
  { key: "spot", label: "SPX", dec: 2, prefix: "" },
  { key: "dist", label: "Dist", dec: 1, prefix: "" },
] as const;
type CbMetricKey = typeof CB_METRICS[number]["key"];

function CbProbeChart({
  ticks, metric, entry, peak,
}: {
  ticks: CbTick[]; metric: CbMetricKey;
  entry: number | null;
  peak: { v: number; ts: number } | null;   // the day's high-water mark, not an exit
}) {
  const W = 960, H = 340, PADL = 62, PADR = 16, PADT = 16, PADB = 28;
  const pts = ticks
    .map((t) => ({ ts: n(t.ts), v: n(t[metric]) }))
    .filter((p): p is { ts: number; v: number } => p.ts != null && p.v != null);

  if (pts.length < 2) {
    // Only real positions reach the chart — a never-taken checkpoint is handled
    // upstream with its own explanation. The first cut reported every one of
    // these as "0 polls recorded", which reads as a broken chart even when the
    // honest answer was "this was never a position".
    return (
      <div style={{ padding: "40px 0", textAlign: "center", color: MUTED, fontSize: 14, fontFamily: "var(--font-mono)", lineHeight: 1.7 }}>
        {pts.length === 0
          ? <>No polls recorded yet. The recorder writes one tick a minute while a position is open — if this stays at zero, the poll is failing rather than pending. Press <b>Diagnose</b>.</>
          : <>Only one poll recorded — not enough for a line.</>}
      </div>
    );
  }

  const spec = CB_METRICS.find((m) => m.key === metric)!;
  // On the price view, stream-sourced bars carry the minute's true high and low.
  // Drawing that band is the whole point of streaming: the line alone still only
  // shows one sampled price per minute, and the peak this board leads with can
  // live entirely inside the band.
  const band = metric === "mark"
    ? ticks.map((t) => ({ ts: n(t.ts), hi: n(t.mark_high), lo: n(t.mark_low) }))
      .filter((b): b is { ts: number; hi: number; lo: number } => b.ts != null && b.hi != null && b.lo != null)
    : [];
  const hasRange = band.some((b) => b.hi > b.lo);
  const xs = pts.map((p) => p.ts), ys = pts.map((p) => p.v);
  const minX = Math.min(...xs), maxX = Math.max(...xs);
  // The entry line is part of the picture, not an annotation on top of it — if
  // the domain excludes it, it gets drawn off-canvas.
  const domain = [...ys];
  if (hasRange) domain.push(...band.map((b) => b.hi), ...band.map((b) => b.lo));
  if (metric === "mark" && entry != null) domain.push(entry);
  let minY = Math.min(...domain), maxY = Math.max(...domain);
  if (minY === maxY) { minY -= 1; maxY += 1; }
  const gpad = (maxY - minY) * 0.08; minY -= gpad; maxY += gpad;

  const cnt = pts.length;
  const sx = (i: number) => PADL + (cnt <= 1 ? 0 : i / (cnt - 1)) * (W - PADL - PADR);
  const sy = (v: number) => H - PADB - ((v - minY) / (maxY - minY || 1)) * (H - PADT - PADB);
  const path = pts.map((p, i) => `${i ? "L" : "M"}${sx(i).toFixed(1)},${sy(p.v).toFixed(1)}`).join(" ");
  const area = `${path} L${sx(cnt - 1).toFixed(1)},${H - PADB} L${sx(0).toFixed(1)},${H - PADB} Z`;
  const fmtY = (v: number) => `${spec.prefix}${v.toFixed(spec.dec)}`;
  const yTicks = [0, 0.25, 0.5, 0.75, 1].map((f) => minY + f * (maxY - minY));
  const fmtT = (ts: number) => new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York", hour: "2-digit", minute: "2-digit", hour12: false,
  }).format(new Date(ts));
  // Index of the tick nearest the peak, so the high-water mark is flagged where
  // it printed. Nothing happened there — that is the point of showing it.
  const peakIdx = peak ? pts.reduce((best, p, i) => (Math.abs(p.ts - peak.ts) < Math.abs(pts[best].ts - peak.ts) ? i : best), 0) : -1;

  return (
    <svg viewBox={`0 0 ${W} ${H}`} style={{ width: "100%", height: "auto", display: "block" }}>
      <defs>
        <linearGradient id="cbwg" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={rgba(C.cyan, 0.28)} />
          <stop offset="100%" stopColor={rgba(C.cyan, 0)} />
        </linearGradient>
      </defs>

      {yTicks.map((v, i) => (
        <g key={i}>
          <line x1={PADL} y1={sy(v)} x2={W - PADR} y2={sy(v)} stroke="rgba(255,255,255,0.08)" strokeWidth={1} />
          <text x={PADL - 6} y={sy(v) + 3} textAnchor="end" fontSize={11} fill={C.label} fontFamily="var(--font-mono)">{fmtY(v)}</text>
        </g>
      ))}

      {/* Entry line on the price view. Without it a rising curve reads as a
          winner even when it never got back to what was paid. */}
      {metric === "mark" && entry != null && (
        <>
          <line x1={PADL} y1={sy(entry)} x2={W - PADR} y2={sy(entry)} stroke={rgba(MUTED, 0.6)} strokeWidth={1} strokeDasharray="4 4" />
          <text x={PADL + 4} y={sy(entry) - 5} fontSize={11} fill={MUTED} fontFamily="var(--font-mono)">entry ${entry.toFixed(2)}</text>
        </>
      )}

      <path d={area} fill="url(#cbwg)" />

      {/* High/low envelope from the 1-minute stream bars. */}
      {hasRange && (
        <path
          d={`${band.map((b, i) => `${i ? "L" : "M"}${sx(i).toFixed(1)},${sy(b.hi).toFixed(1)}`).join(" ")} `
            + `${band.slice().reverse().map((b, i) => `L${sx(band.length - 1 - i).toFixed(1)},${sy(b.lo).toFixed(1)}`).join(" ")} Z`}
          fill={rgba(C.cyan, 0.16)}
        />
      )}

      <path d={path} fill="none" stroke={C.cyan} strokeWidth={1.75} strokeLinejoin="round" strokeLinecap="round" />

      {peakIdx >= 0 && (
        <>
          <line x1={sx(peakIdx)} y1={PADT} x2={sx(peakIdx)} y2={H - PADB} stroke={rgba(GREEN, 0.55)} strokeWidth={1} strokeDasharray="3 3" />
          <circle cx={sx(peakIdx)} cy={sy(pts[peakIdx].v)} r={4} fill={GREEN} stroke="#05060a" strokeWidth={1} />
        </>
      )}
      <circle cx={sx(cnt - 1)} cy={sy(pts[cnt - 1].v)} r={3.5} fill={C.cyan} />

      <text x={PADL} y={H - 6} textAnchor="start" fontSize={11} fill={C.label} fontFamily="var(--font-mono)">{fmtT(minX)}</text>
      <text x={W - PADR} y={H - 6} textAnchor="end" fontSize={11} fill={C.label} fontFamily="var(--font-mono)">{fmtT(maxX)}</text>
    </svg>
  );
}

function CbProbeModal({
  trade, mult, onClose,
}: { trade: CbTrade; mult: number; onClose: () => void }) {
  const [ticks, setTicks] = useState<CbTick[] | null>(null);
  const [metric, setMetric] = useState<CbMetricKey>("mark");
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setTicks(null); setErr(null);
    (async () => {
      try {
        const r = await fetch(`/api/cb-trades?ticks=${trade.id}`, { cache: "no-store" });
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        const j = await r.json();
        if (!cancelled) setTicks(Array.isArray(j.ticks) ? j.ticks : []);
      } catch (e) { if (!cancelled) { setErr(String(e)); setTicks([]); } }
    })();
    return () => { cancelled = true; };
  }, [trade.id]);

  // Esc closes, and the body doesn't scroll behind the overlay.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { window.removeEventListener("keydown", onKey); document.body.style.overflow = prev; };
  }, [onClose]);

  const entry = n(trade.entry_price);
  const exitV = n(trade.exit_price);
  const pnl = n(trade.pnl) ?? (entry != null && n(trade.last_price) != null
    ? Math.round((n(trade.last_price)! - entry) * 100) / 100 : null);

  // Headline is the high of day against the entry — what was there to take.
  // The live/exit mark sits under it on the in → now line.
  const effMark = exitV ?? n(trade.last_price);
  const peakV = n(trade.best_price);
  const peakPct = entry != null && peakV != null && entry !== 0 ? ((peakV - entry) / entry) * 100 : null;
  const pct = entry != null && effMark != null && entry !== 0 ? ((effMark - entry) / entry) * 100 : null;
  const dollars = entry != null && effMark != null ? (effMark - entry) * mult : null;
  const px = (v: number | null) => (v == null ? "—" : `$${v.toFixed(2)}`);
  const upDown = (v: number | null) => (v == null ? MUTED : v > 0 ? GREEN : v < 0 ? RED : C.label);

  const stat =(label: string, value: string, color: string = C.label) => (
    <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
      <span style={{ fontSize: 14, fontWeight: 700, color: MUTED, textTransform: "uppercase", letterSpacing: "0.08em" }}>{label}</span>
      <span style={{ fontSize: 14, fontWeight: 800, color, fontFamily: "var(--font-mono)" }}>{value}</span>
    </div>
  );
  const tgl = (on: boolean): React.CSSProperties => ({
    fontSize: 14, fontWeight: 800, padding: "5px 12px", borderRadius: 7, cursor: "pointer",
    border: `1px solid ${on ? C.cyan : C.border}`,
    background: on ? rgba(C.cyan, 0.18) : "transparent",
    color: on ? C.cyan : C.label, letterSpacing: "0.06em", textTransform: "uppercase", fontFamily: "inherit",
  });

  return (
    <div
      onClick={onClose}
      style={{
        position: "fixed", inset: 0, zIndex: 1000, background: "rgba(5,6,10,0.72)",
        backdropFilter: "blur(3px)", display: "flex", alignItems: "center", justifyContent: "center", padding: 24,
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{ ...CARD, width: "min(1040px, 100%)", maxHeight: "90vh", overflowY: "auto", padding: "20px 22px", display: "flex", flexDirection: "column", gap: 16 }}
      >
        <div style={{ display: "flex", alignItems: "baseline", gap: 12, flexWrap: "wrap" }}>
          <span style={{ fontSize: 17, fontWeight: 800, color: C.cyan, fontFamily: "var(--font-mono)" }}>
            {trade.ticker} {contractLabel(trade)}
          </span>
          <span style={{ fontSize: 14, color: MUTED, fontFamily: "var(--font-mono)" }}>
            {trade.expiration} · {trade.checkpoint_label ?? trade.checkpoint}
          </span>
          <button
            onClick={onClose}
            title="Close (Esc)"
            style={{ marginLeft: "auto", font: "inherit", fontSize: 17, fontWeight: 800, lineHeight: 1, cursor: "pointer", background: "transparent", border: `1px solid ${C.border}`, color: C.label, borderRadius: 7, padding: "4px 11px" }}
          >
            ×
          </button>
        </div>

        {/* Headline is entry → high of day. The in → now line under it is the
            current (or exited) mark and its own percent. */}
        <div>
          <div style={{ fontFamily: "var(--font-mono)", fontSize: 24, fontWeight: 800, lineHeight: 1, color: upDown(peakPct) }}>
            {peakPct == null ? "—" : `${peakPct >= 0 ? "▲" : "▼"} ${Math.abs(peakPct).toFixed(1)}%`}
          </div>
          <div style={{ fontFamily: "var(--font-mono)", fontSize: 14, color: C.label, marginTop: 6 }}>
            <span style={{ color: MUTED, fontSize: 10, textTransform: "uppercase", letterSpacing: "0.06em", marginRight: 3 }}>in</span>{px(entry)}
            <span style={{ color: MUTED, margin: "0 6px" }}>→</span>
            <span style={{ color: MUTED, fontSize: 10, textTransform: "uppercase", letterSpacing: "0.06em", marginRight: 3 }}>{exitV != null ? "sold" : "now"}</span>{px(effMark)}
            <span style={{ color: upDown(pct) }}>
              {pct == null ? "" : ` · ${pct >= 0 ? "+" : "−"}${Math.abs(pct).toFixed(1)}%`}
            </span>
            <span style={{ color: upDown(dollars) }}>
              {dollars == null ? "" : ` · ${dollars >= 0 ? "+" : "−"}$${Math.abs(dollars).toFixed(0)}/ct`}
            </span>
          </div>
        </div>

        <div style={{ display: "flex", gap: 26, flexWrap: "wrap", paddingBottom: 14, borderBottom: `1px solid ${C.border}` }}>
          {stat("CB", trade.cb_strike != null
            ? `${Number(trade.cb_strike).toFixed(0)}${trade.cb_price != null ? ` @ $${Number(trade.cb_price).toFixed(2)}` : ""}`
            : "—", C.cyan)}
          {stat("Entry", entry != null ? `$${entry.toFixed(2)} · ${etClock(n(trade.entry_ts) ?? 0)}` : "not taken",
            entry != null ? C.label : MUTED)}
          {stat("Peak", trade.best_price != null
            ? `$${Number(trade.best_price).toFixed(2)}${trade.best_ts ? ` · ${etClock(n(trade.best_ts) ?? 0)}` : ""}`
            : "—", trade.best_price != null ? GREEN : MUTED)}
          {stat("Low", trade.worst_price != null
            ? `$${Number(trade.worst_price).toFixed(2)}${trade.worst_ts ? ` · ${etClock(n(trade.worst_ts) ?? 0)}` : ""}` : "—")}
          {stat("Close", exitV != null ? `$${exitV.toFixed(2)}` : trade.status === "open" ? "open" : "—",
            exitV != null ? AMBER : C.cyan)}
          {stat("P/L", pnl != null ? `${pnl > 0 ? "+" : ""}${pnl.toFixed(2)}` : "—",
            pnl == null ? MUTED : pnl >= 0 ? GREEN : RED)}
        </div>

        {trade.status !== "skipped" && (
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            {CB_METRICS.map((m) => (
              <button key={m.key} onClick={() => setMetric(m.key)} style={tgl(metric === m.key)}>{m.label}</button>
            ))}
          </div>
        )}

        {trade.last_error && (
          <div style={{ color: AMBER, fontSize: 14, fontFamily: "var(--font-mono)", border: `1px solid ${rgba(AMBER, 0.4)}`, background: rgba(AMBER, 0.1), borderRadius: 8, padding: "9px 12px", lineHeight: 1.6 }}>
            Last poll unpriced — <b>{trade.last_error}</b>
          </div>
        )}

        {err ? (
          <div style={{ color: RED, fontSize: 14, fontFamily: "var(--font-mono)", padding: "24px 0", textAlign: "center" }}>
            History failed to load: {err}
          </div>
        ) : trade.status === "skipped" ? (
          // Never a position, so there is no curve and never will be. Say that
          // plainly instead of rendering an empty chart frame.
          <div style={{ padding: "28px 22px", textAlign: "center", border: `1px dashed ${C.border}`, borderRadius: 10, lineHeight: 1.75 }}>
            <div style={{ fontSize: 14, fontWeight: 800, color: AMBER, marginBottom: 6 }}>Not taken</div>
            <div style={{ fontSize: 14, color: C.label, fontFamily: "var(--font-mono)" }}>{trade.skip_reason ?? "—"}</div>
            <div style={{ marginTop: 8, fontSize: 14, color: MUTED, fontFamily: "var(--font-mono)" }}>
              Probed {etClock(n(trade.probe_ts) ?? 0)}
              {trade.cb_price != null
                ? ` · CB ${Number(trade.cb_strike ?? 0).toFixed(0)} @ $${Number(trade.cb_price).toFixed(2)}`
                : ""}
            </div>
          </div>
        ) : ticks == null ? (
          <div style={{ color: C.label, fontSize: 14, padding: "48px 0", textAlign: "center" }}>Loading history…</div>
        ) : (
          <CbProbeChart
            ticks={ticks}
            metric={metric}
            entry={entry}
            peak={trade.best_price != null && trade.best_ts != null
              ? { v: Number(trade.best_price), ts: n(trade.best_ts) as number } : null}
          />
        )}

        {/* One line, same shape as the probe card's chart hint. */}
        <div style={{ fontSize: 12, color: MUTED, fontFamily: "var(--font-mono)", letterSpacing: "0.04em" }}>
          {metric === "mark" ? "Option price (mark)" : metric === "spot" ? "SPX spot" : "SPX distance to CB"}
          {" · RTH only"}
          {entry != null ? ` · entry @ $${entry.toFixed(2)}` : ""}
          {exitV != null ? ` · sold @ $${exitV.toFixed(2)}` : ""}
        </div>
      </div>
    </div>
  );
}

// ── ET formatters (self-contained for this owner page) ──
function etClock(ts: number) {
  const t = Number(ts);
  if (!Number.isFinite(t) || t <= 0) return "—";
  return new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", hour: "2-digit", minute: "2-digit", hour12: true }).format(new Date(t));
}
