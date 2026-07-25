import { useCallback, useEffect, useMemo, useState } from "react";
import {
  HOME_THEME,
  homePanelStyle,
  homeButtonStyle,
  homeSecondaryButtonStyle,
  homeInputStyle,
} from "../lib/theme";

// ─── Types ──────────────────────────────────────────────────────────────────

interface CondorRow {
  id: number;
  ticker: string;
  week_label: string;
  week_start: string;
  ref_price: number | null;
  em: number | null;
  put_long: number | null;
  put_short: number | null;
  call_short: number | null;
  call_long: number | null;
  put_credit: number | null;
  call_credit: number | null;
  net_credit: number | null;
  contracts: number | null;
  multiplier: number | null;
  settle_price: number | null;
  intrinsic: number | null;
  pnl: number | null;
  result: "win" | "loss" | null;
  outcome: "max_win" | "partial_win" | "partial_loss" | "max_loss" | null;
  breached_side: "put" | "call" | null;
  touched_side: "put" | "call" | "both" | null;
  result_source: string | null;
  note: string | null;
  // joined from em_tracker
  wk_high: number | null;
  wk_low: number | null;
  wk_close: number | null;
  em_result: "hit" | "miss" | null;
}

interface CondorSummary {
  ticker: string;
  wins: number;
  losses: number;
  settled: number;
  total: number;
  win_rate: number | null;
  pnl: number;
  avg_pnl: number | null;
  max_wins: number;
  max_losses: number;
}

type NumField =
  | "put_long" | "put_short" | "call_short" | "call_long"
  | "put_credit" | "call_credit" | "contracts";

const NUM_FIELDS: NumField[] = [
  "put_long", "put_short", "call_short", "call_long",
  "put_credit", "call_credit", "contracts",
];

// ─── Week helpers (mirror the server's mondayOf / weekLabel) ────────────────

function mondayOf(iso: string): string {
  const ymd = String(iso || "").slice(0, 10);
  const d = new Date(ymd + "T00:00:00");
  if (Number.isNaN(d.getTime())) return ymd;
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

function weekLabel(iso: string): string {
  const mon = mondayOf(iso);
  const d = new Date(mon + "T00:00:00");
  if (Number.isNaN(d.getTime())) return String(iso || "").slice(0, 10);
  d.setDate(d.getDate() + 4);
  return `${d.getMonth() + 1}/${d.getDate()}`;
}

function thisMonday(): string {
  return mondayOf(new Date().toISOString().slice(0, 10));
}

// ─── Formatting ─────────────────────────────────────────────────────────────

function fmt(n: number | null | undefined, d = 2): string {
  if (n == null || !Number.isFinite(Number(n))) return "—";
  return Number(n).toLocaleString(undefined, { maximumFractionDigits: d });
}

function money(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(Number(n))) return "—";
  const v = Number(n);
  return (v < 0 ? "−$" : "$") + Math.abs(v).toLocaleString(undefined, { maximumFractionDigits: 0 });
}

function pctColor(p: number | null): string {
  if (p == null) return HOME_THEME.muted;
  if (p >= 75) return HOME_THEME.green;
  if (p >= 60) return HOME_THEME.cyan;
  if (p >= 50) return HOME_THEME.orange;
  return HOME_THEME.red;
}

function pnlColor(v: number | null | undefined): string {
  if (v == null || !Number.isFinite(Number(v))) return HOME_THEME.muted;
  return Number(v) >= 0 ? HOME_THEME.green : HOME_THEME.red;
}

const OUTCOME_LABEL: Record<string, string> = {
  max_win: "FULL",
  partial_win: "PART +",
  partial_loss: "PART −",
  max_loss: "MAX −",
};

// ─── Condor math (client mirror of lib/em-condor/compute.ts) ────────────────

interface Legs { put_long: number; put_short: number; call_short: number; call_long: number }

function legsOf(r: Partial<CondorRow>): Legs | null {
  const v = [r.put_long, r.put_short, r.call_short, r.call_long].map(Number);
  if (v.some((x) => !Number.isFinite(x) || x <= 0)) return null;
  const [put_long, put_short, call_short, call_long] = v;
  if (!(put_long < put_short && put_short < call_short && call_short < call_long)) return null;
  return { put_long, put_short, call_short, call_long };
}

function legProblems(r: Partial<CondorRow>): string[] {
  const out: string[] = [];
  const v = { pl: Number(r.put_long), ps: Number(r.put_short), cs: Number(r.call_short), cl: Number(r.call_long) };
  const some = Object.values(v).some((x) => Number.isFinite(x) && x > 0);
  const all = Object.values(v).every((x) => Number.isFinite(x) && x > 0);
  if (!some) return [];
  if (!all) return ["incomplete — all four strikes required"];
  if (v.pl >= v.ps) out.push("long put must be BELOW short put");
  if (v.cl <= v.cs) out.push("long call must be ABOVE short call");
  if (v.ps >= v.cs) out.push("short put must be BELOW short call");
  return out;
}

function netCreditOf(r: Partial<CondorRow>): number {
  const n = Number(r.net_credit);
  if (Number.isFinite(n) && n !== 0) return n;
  const p = Number(r.put_credit), c = Number(r.call_credit);
  return (Number.isFinite(p) ? p : 0) + (Number.isFinite(c) ? c : 0);
}

interface Econ {
  putWidth: number; callWidth: number; credit: number;
  maxProfit: number; maxLoss: number; roc: number | null;
  beLow: number; beHigh: number;
}

function econOf(r: Partial<CondorRow>): Econ | null {
  const l = legsOf(r);
  if (!l) return null;
  const mult = Number(r.multiplier) > 0 ? Number(r.multiplier) : 100;
  const qty = Number(r.contracts) > 0 ? Number(r.contracts) : 1;
  const putWidth = l.put_short - l.put_long;
  const callWidth = l.call_long - l.call_short;
  const credit = netCreditOf(r);
  const widest = Math.max(putWidth, callWidth);
  return {
    putWidth, callWidth, credit,
    maxProfit: credit * mult * qty,
    maxLoss: (widest - credit) * mult * qty,
    roc: widest - credit > 0 ? credit / (widest - credit) : null,
    beLow: l.put_short - credit,
    beHigh: l.call_short + credit,
  };
}

// ─── Component ──────────────────────────────────────────────────────────────

export default function CondorTrackerAdmin() {
  const [rows, setRows] = useState<CondorRow[]>([]);
  const [summary, setSummary] = useState<CondorSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);

  // week editor
  const [week, setWeek] = useState(thisMonday());
  const [wing, setWing] = useState("");
  const [qty, setQty] = useState("1");
  // raw string drafts keyed `${ticker}-${field}` so "188." survives typing
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [dirty, setDirty] = useState<Set<string>>(new Set());

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const d = await fetch("/api/em-condors").then((r) => r.json());
      setRows(d.rows || []);
      setSummary(d.summary || []);
    } catch (e) {
      setMsg("Load failed: " + String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  // ── derived ───────────────────────────────────────────────────────────────

  const weekRows = useMemo(
    () => rows.filter((r) => mondayOf(r.week_start) === week).sort((a, b) => a.ticker.localeCompare(b.ticker)),
    [rows, week]
  );

  const totals = useMemo(() => {
    const settled = rows.filter((r) => r.result);
    const wins = settled.filter((r) => r.result === "win").length;
    const pnl = settled.reduce((s, r) => s + (Number(r.pnl) || 0), 0);
    const open = rows.length - settled.length;
    return {
      wins,
      losses: settled.length - wins,
      settled: settled.length,
      open,
      pct: settled.length ? (wins / settled.length) * 100 : null,
      pnl,
    };
  }, [rows]);

  // per-week rollup, newest first
  const weekly = useMemo(() => {
    const by = new Map<string, { key: string; label: string; wins: number; losses: number; open: number; pnl: number }>();
    for (const r of rows) {
      const key = mondayOf(r.week_start);
      let w = by.get(key);
      if (!w) { w = { key, label: weekLabel(key), wins: 0, losses: 0, open: 0, pnl: 0 }; by.set(key, w); }
      if (r.result === "win") w.wins++;
      else if (r.result === "loss") w.losses++;
      else w.open++;
      w.pnl += Number(r.pnl) || 0;
    }
    return Array.from(by.values())
      .map((w) => ({ ...w, settled: w.wins + w.losses, pct: w.wins + w.losses ? (w.wins / (w.wins + w.losses)) * 100 : null }))
      .sort((a, b) => (a.key < b.key ? 1 : -1));
  }, [rows]);

  const rowsByTicker = useMemo(() => {
    const m = new Map<string, CondorRow[]>();
    rows.forEach((r) => { const a = m.get(r.ticker) ?? []; a.push(r); m.set(r.ticker, a); });
    return m;
  }, [rows]);

  // A row merged with any un-saved drafts, so the live economics readout tracks
  // what you're typing rather than what's in the DB.
  const withDraft = useCallback((r: CondorRow): CondorRow => {
    const out = { ...r };
    for (const f of NUM_FIELDS) {
      const k = `${r.ticker}-${f}`;
      if (k in draft) {
        const raw = draft[k].trim();
        (out as unknown as Record<string, number | null>)[f] = raw === "" ? null : Number(raw);
      }
    }
    const nk = `${r.ticker}-note`;
    if (nk in draft) out.note = draft[nk];
    // net credit always follows the two legs while editing
    if (out.put_credit != null || out.call_credit != null) {
      out.net_credit = (Number(out.put_credit) || 0) + (Number(out.call_credit) || 0);
    }
    return out;
  }, [draft]);

  // ── actions ───────────────────────────────────────────────────────────────

  function setCell(ticker: string, field: string, value: string) {
    setDraft((d) => ({ ...d, [`${ticker}-${field}`]: value }));
    setDirty((s) => new Set(s).add(ticker));
  }

  function clearDrafts(tickers: string[]) {
    setDraft((d) => {
      const n = { ...d };
      for (const t of tickers) for (const f of [...NUM_FIELDS, "note"]) delete n[`${t}-${f}`];
      return n;
    });
    setDirty((s) => { const n = new Set(s); tickers.forEach((t) => n.delete(t)); return n; });
  }

  async function seedWeek(overwrite: boolean) {
    if (overwrite && !window.confirm(
      `Re-derive ALL four strikes for week ${weekLabel(week)} from the current EM bands?\n\n` +
      `Any strikes you hand-edited for that week are overwritten. Credits, contracts and notes are kept.`
    )) return;
    setBusy(true); setMsg(null);
    try {
      const body: Record<string, unknown> = { week_start: week, overwrite, contracts: Number(qty) || 1 };
      if (Number(wing) > 0) body.wing = Number(wing);
      const r = await fetch("/api/em-condors/seed", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      }).then((r) => r.json());
      if (r.ok) {
        setMsg(r.seeded
          ? `Seeded ${r.seeded} condor(s) for ${r.week_label}${r.skipped ? `, ${r.skipped} already existed (untouched)` : ""}.`
          : (r.note || `Nothing seeded — ${r.skipped} ticker(s) already have a condor this week.`));
        await load();
      } else setMsg("Seed failed: " + (r.error || "unknown"));
    } catch (e) { setMsg("Seed failed: " + String(e)); }
    finally { setBusy(false); }
  }

  async function saveRows(targets: CondorRow[]) {
    const payload = targets.map(withDraft);
    const bad = payload
      .map((p) => ({ t: p.ticker, probs: legProblems(p) }))
      .filter((x) => x.probs.length);
    if (bad.length) {
      setMsg(`Fix before saving — ${bad.map((b) => `${b.t}: ${b.probs.join(", ")}`).join(" · ")}`);
      return;
    }
    setBusy(true); setMsg(null);
    try {
      const r = await fetch("/api/em-condors", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({
          rows: payload.map((p) => ({
            ticker: p.ticker,
            week_start: p.week_start,
            week_label: p.week_label,
            put_long: p.put_long, put_short: p.put_short,
            call_short: p.call_short, call_long: p.call_long,
            put_credit: p.put_credit, call_credit: p.call_credit,
            net_credit: p.net_credit,
            contracts: p.contracts, multiplier: p.multiplier ?? 100,
            ref_price: p.ref_price, em: p.em,
            note: p.note,
            result_source: "manual",
          })),
        }),
      }).then((r) => r.json());
      if (r.ok) {
        setMsg(`Saved ${r.saved} condor(s)${r.rejected?.length ? ` · ${r.rejected.length} rejected` : ""}.`);
        clearDrafts(payload.map((p) => p.ticker));
        await load();
      } else setMsg("Save failed: " + (r.error || "unknown"));
    } catch (e) { setMsg("Save failed: " + String(e)); }
    finally { setBusy(false); }
  }

  async function settleWeek(all: boolean) {
    setBusy(true); setMsg(null);
    try {
      const r = await fetch("/api/em-condors/evaluate", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify(all ? {} : { week_start: week }),
      }).then((r) => r.json());
      if (r.ok) {
        setMsg(r.settled
          ? `Settled ${r.settled} — ${r.wins} win / ${r.losses} loss · ${money(r.pnl)}` +
            (r.max_losses ? ` · ${r.max_losses} max loss` : "") +
            (r.missing_credit?.length ? ` · ${r.missing_credit.length} with no credit entered` : "")
          : "Nothing to settle — condors need a weekly close (run the EM Tracker evaluator first).");
        await load();
      } else setMsg("Settle failed: " + (r.error || "unknown"));
    } catch (e) { setMsg("Settle failed: " + String(e)); }
    finally { setBusy(false); }
  }

  async function override(id: number, result: "win" | "loss") {
    setBusy(true);
    try {
      await fetch("/api/em-condors", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ id, result }),
      });
      await load();
    } finally { setBusy(false); }
  }

  async function reopen(id: number) {
    setBusy(true);
    try {
      await fetch("/api/em-condors", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ id, reopen: true }),
      });
      await load();
    } finally { setBusy(false); }
  }

  async function removeRow(id: number, ticker: string) {
    if (!window.confirm(`Delete the ${ticker} condor for week ${weekLabel(week)}?`)) return;
    setBusy(true);
    try {
      await fetch(`/api/em-condors?id=${id}`, { method: "DELETE" });
      await load();
    } finally { setBusy(false); }
  }

  const lbl = { fontSize: 9, fontWeight: 800 as const, color: HOME_THEME.muted, textTransform: "uppercase" as const, letterSpacing: "0.12em" };
  const cell = { ...homeInputStyle, padding: "5px 7px", fontSize: 13, width: 78 };

  // ── render ────────────────────────────────────────────────────────────────

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      <style>{`@keyframes icfade{from{opacity:0}to{opacity:1}}`}</style>

      {/* header + actions */}
      <div style={{ ...homePanelStyle, padding: "14px 18px", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
          <span style={{ fontSize: 12, fontWeight: 800, letterSpacing: "0.14em", textTransform: "uppercase", color: HOME_THEME.orange }}>
            EM Iron Condors
          </span>
          <span style={{ fontSize: 10, color: HOME_THEME.muted }}>
            Bull put spread + bear call spread written on the weekly EM band
          </span>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
          {totals.pct != null && (
            <span style={{ fontSize: 11, color: HOME_THEME.muted }}>
              Overall&nbsp;<b style={{ color: pctColor(totals.pct) }}>{totals.pct.toFixed(1)}%</b>
              &nbsp;({totals.wins}/{totals.settled})&nbsp;·&nbsp;
              <b style={{ color: pnlColor(totals.pnl) }}>{money(totals.pnl)}</b>
              {totals.open > 0 && <>&nbsp;·&nbsp;<span style={{ color: HOME_THEME.orange }}>{totals.open} open</span></>}
            </span>
          )}
          <button onClick={() => settleWeek(false)} disabled={busy} style={{ ...homeButtonStyle, opacity: busy ? 0.5 : 1 }} title="Settle this week's condors against the realized weekly close (run the EM Tracker evaluator first)">
            {busy ? "…" : "Settle Week"}
          </button>
          <button onClick={() => settleWeek(true)} disabled={busy} style={{ ...homeSecondaryButtonStyle, opacity: busy ? 0.5 : 1 }} title="Settle every unsettled condor that has a weekly close on record">
            Settle All
          </button>
          <button onClick={load} disabled={loading} style={homeSecondaryButtonStyle}>Refresh</button>
        </div>
      </div>

      {msg && (
        <div style={{ ...homePanelStyle, padding: "8px 14px", fontSize: 11, color: HOME_THEME.cyan, animation: "icfade .3s" }}>{msg}</div>
      )}

      {/* Monday builder */}
      <div style={{ ...homePanelStyle, padding: "14px 18px", display: "flex", flexDirection: "column", gap: 12 }}>
        <div style={{ display: "flex", alignItems: "flex-end", gap: 10, flexWrap: "wrap" }}>
          <Field label="Week (Mon)">
            <input type="date" value={week} onChange={(e) => setWeek(mondayOf(e.target.value))} style={{ ...homeInputStyle, width: 150 }} />
          </Field>
          <Field label="Wing (pts)">
            <input value={wing} onChange={(e) => setWing(e.target.value)} placeholder="auto" style={{ ...homeInputStyle, width: 90 }} />
          </Field>
          <Field label="Contracts">
            <input value={qty} onChange={(e) => setQty(e.target.value)} style={{ ...homeInputStyle, width: 80 }} />
          </Field>
          <button onClick={() => seedWeek(false)} disabled={busy} style={{ ...homeButtonStyle, padding: "8px 16px", opacity: busy ? 0.5 : 1 }} title="Build condors from this week's EM bands. Tickers that already have a condor are left alone.">
            Seed From EM Band
          </button>
          <button onClick={() => seedWeek(true)} disabled={busy} style={{ ...homeSecondaryButtonStyle, padding: "8px 14px", opacity: busy ? 0.5 : 1 }} title="Re-derive every strike for this week from the current EM bands (credits and notes kept)">
            Re-derive Strikes
          </button>
          {dirty.size > 0 && (
            <button onClick={() => saveRows(weekRows.filter((r) => dirty.has(r.ticker)))} disabled={busy}
              style={{ ...homeButtonStyle, padding: "8px 16px", borderColor: `${HOME_THEME.orange}88`, color: HOME_THEME.orange, opacity: busy ? 0.5 : 1 }}>
              Save {dirty.size} Edited
            </button>
          )}
          <span style={{ fontSize: 10, color: HOME_THEME.muted, marginLeft: "auto" }}>
            Week {weekLabel(week)} · {weekRows.length} condor(s)
          </span>
        </div>

        {weekRows.length === 0 && !loading && (
          <div style={{ fontSize: 11, color: HOME_THEME.muted, lineHeight: 1.6 }}>
            No condors for {weekLabel(week)} yet. The EM bands for that Monday must exist first (EM Tracker →
            Review Discord Import → Commit Week), then hit <b>Seed From EM Band</b>: short put = band low and
            short call = band high, each snapped to the ticker&apos;s strike increment, with the longs one wing beyond.
            Every strike stays editable afterwards.
          </div>
        )}

        {weekRows.length > 0 && (
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            <div style={{ display: "grid", gridTemplateColumns: "68px 172px 172px 150px 60px 1fr 150px", gap: 8, padding: "4px 2px", ...lbl }}>
              <span>Ticker</span>
              <span>Bull Put — long / short</span>
              <span>Bear Call — short / long</span>
              <span>Credit put / call</span>
              <span style={{ textAlign: "right" }}>Qty</span>
              <span>Risk &amp; breakevens</span>
              <span style={{ textAlign: "right" }}>Result</span>
            </div>

            {weekRows.map((raw) => {
              const r = withDraft(raw);
              const probs = legProblems(r);
              const e = econOf(r);
              const isDirty = dirty.has(r.ticker);
              const settled = !!r.result;
              const bad = probs.length > 0;
              const tone = bad ? HOME_THEME.red : isDirty ? HOME_THEME.orange : null;
              const num = (v: number | null | undefined) => (v == null || !Number.isFinite(Number(v)) ? "" : String(v));
              const val = (f: NumField) => draft[`${r.ticker}-${f}`] ?? num(raw[f] as number | null);

              return (
                <div key={r.id}
                  style={{
                    display: "grid", gridTemplateColumns: "68px 172px 172px 150px 60px 1fr 150px", gap: 8,
                    alignItems: "center", padding: "6px 2px", borderTop: `1px solid rgba(255,255,255,0.05)`,
                    background: bad ? `${HOME_THEME.red}10` : isDirty ? `${HOME_THEME.orange}0d` : "transparent",
                    borderRadius: 6,
                  }}
                  title={bad ? probs.join("; ") : undefined}
                >
                  <span style={{ fontSize: 13, fontWeight: 800, color: bad ? HOME_THEME.red : "#fff" }}>
                    {r.ticker}
                    {r.em != null && (
                      <span style={{ display: "block", fontSize: 9, fontWeight: 600, color: HOME_THEME.muted }}>
                        EM {fmt(r.em, 1)}
                      </span>
                    )}
                  </span>

                  {/* bull put spread: buy lower / sell higher */}
                  <span style={{ display: "flex", alignItems: "center", gap: 5 }}>
                    <input value={val("put_long")} onChange={(ev) => setCell(r.ticker, "put_long", ev.target.value)}
                      placeholder="buy" disabled={settled}
                      style={{ ...cell, borderColor: tone ?? undefined, color: HOME_THEME.red }} title="Long put (lower wing) — bought" />
                    <span style={{ color: "#5a657a", fontSize: 12 }}>/</span>
                    <input value={val("put_short")} onChange={(ev) => setCell(r.ticker, "put_short", ev.target.value)}
                      placeholder="sell" disabled={settled}
                      style={{ ...cell, borderColor: tone ?? undefined, color: HOME_THEME.green }} title="Short put — sold (this is the level the EM band low sits at)" />
                  </span>

                  {/* bear call spread: sell lower / buy higher */}
                  <span style={{ display: "flex", alignItems: "center", gap: 5 }}>
                    <input value={val("call_short")} onChange={(ev) => setCell(r.ticker, "call_short", ev.target.value)}
                      placeholder="sell" disabled={settled}
                      style={{ ...cell, borderColor: tone ?? undefined, color: HOME_THEME.green }} title="Short call — sold (EM band high)" />
                    <span style={{ color: "#5a657a", fontSize: 12 }}>/</span>
                    <input value={val("call_long")} onChange={(ev) => setCell(r.ticker, "call_long", ev.target.value)}
                      placeholder="buy" disabled={settled}
                      style={{ ...cell, borderColor: tone ?? undefined, color: HOME_THEME.red }} title="Long call (upper wing) — bought" />
                  </span>

                  {/* credits */}
                  <span style={{ display: "flex", alignItems: "center", gap: 5 }}>
                    <input value={val("put_credit")} onChange={(ev) => setCell(r.ticker, "put_credit", ev.target.value)}
                      placeholder="put cr" disabled={settled} style={{ ...cell, width: 68 }} title="Credit taken on the bull put spread (points)" />
                    <input value={val("call_credit")} onChange={(ev) => setCell(r.ticker, "call_credit", ev.target.value)}
                      placeholder="call cr" disabled={settled} style={{ ...cell, width: 68 }} title="Credit taken on the bear call spread (points)" />
                  </span>

                  <input value={val("contracts")} onChange={(ev) => setCell(r.ticker, "contracts", ev.target.value)}
                    disabled={settled} style={{ ...cell, width: 52, textAlign: "right" }} title="Number of condors" />

                  {/* live economics */}
                  <span style={{ fontSize: 10, color: HOME_THEME.muted, lineHeight: 1.45 }}>
                    {bad ? (
                      <span style={{ color: HOME_THEME.red, fontWeight: 700 }}>{probs.join(" · ")}</span>
                    ) : e ? (
                      <>
                        width {fmt(e.putWidth, 2)}/{fmt(e.callWidth, 2)} · credit {fmt(e.credit, 2)} ·{" "}
                        <span style={{ color: HOME_THEME.green }}>max +{money(e.maxProfit)}</span> /{" "}
                        <span style={{ color: HOME_THEME.red }}>−{money(e.maxLoss)}</span>
                        {e.roc != null && <> · ROC {(e.roc * 100).toFixed(1)}%</>}
                        <br />
                        BE {fmt(e.beLow)} → {fmt(e.beHigh)}
                        {r.wk_close != null && <> · close <b style={{ color: "#fff" }}>{fmt(r.wk_close)}</b></>}
                        {r.touched_side && <> · <span style={{ color: HOME_THEME.orange }}>tagged {r.touched_side}</span></>}
                      </>
                    ) : "enter all four strikes"}
                  </span>

                  {/* result */}
                  <span style={{ display: "flex", alignItems: "center", justifyContent: "flex-end", gap: 5 }}>
                    {settled ? (
                      <>
                        <span style={{ fontSize: 11, fontWeight: 800, fontFamily: "var(--font-mono)", color: pnlColor(r.pnl) }}>{money(r.pnl)}</span>
                        <span title={`${r.outcome ?? ""}${r.breached_side ? ` · ${r.breached_side} side breached` : ""}`}
                          style={{
                            fontSize: 9, fontWeight: 800, padding: "2px 7px", borderRadius: 10,
                            color: r.result === "win" ? HOME_THEME.green : HOME_THEME.red,
                            border: `1px solid ${(r.result === "win" ? HOME_THEME.green : HOME_THEME.red)}44`,
                            background: `${r.result === "win" ? HOME_THEME.green : HOME_THEME.red}14`,
                          }}>
                          {OUTCOME_LABEL[r.outcome ?? ""] ?? (r.result === "win" ? "WIN" : "LOSS")}
                        </span>
                        <button onClick={() => reopen(r.id)} disabled={busy} title="Re-open (clears the settlement so it can be scored again)"
                          style={{ ...homeSecondaryButtonStyle, padding: "1px 6px", fontSize: 9 }}>↺</button>
                      </>
                    ) : (
                      <>
                        {isDirty && (
                          <button onClick={() => saveRows([raw])} disabled={busy}
                            style={{ ...homeButtonStyle, padding: "2px 9px", fontSize: 10 }}>Save</button>
                        )}
                        <button onClick={() => override(r.id, "win")} disabled={busy} title="Force win"
                          style={{ ...homeSecondaryButtonStyle, padding: "1px 6px", fontSize: 9 }}>W</button>
                        <button onClick={() => override(r.id, "loss")} disabled={busy} title="Force loss"
                          style={{ ...homeSecondaryButtonStyle, padding: "1px 6px", fontSize: 9 }}>L</button>
                        <button onClick={() => removeRow(r.id, r.ticker)} disabled={busy} title="Delete this condor"
                          style={{ background: "none", border: "none", color: HOME_THEME.muted, fontSize: 15, cursor: "pointer", lineHeight: 1 }}>×</button>
                      </>
                    )}
                  </span>
                </div>
              );
            })}

            <div style={{ fontSize: 9, color: HOME_THEME.muted, marginTop: 6, lineHeight: 1.6 }}>
              Credits are in points per one condor (multiplier 100). Max loss = widest wing − credit, ×
              contracts. A settled row is locked — hit ↺ to re-open it before editing. Settlement uses the
              weekly close stored on the matching EM Tracker row, so run <b>Evaluate Now</b> there first.
            </div>
          </div>
        )}
      </div>

      {/* weekly rollup */}
      {weekly.length > 0 && (
        <div style={{ ...homePanelStyle, padding: "14px 18px", display: "flex", flexDirection: "column", gap: 10 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <span style={lbl}>Weekly Condor Record</span>
            <span style={{ fontSize: 10, color: HOME_THEME.muted }}>Win / loss and realized P&amp;L by week</span>
          </div>
          <div style={{ display: "flex", flexDirection: "column", maxHeight: 260, overflowY: "auto" }}>
            <div style={{ display: "grid", gridTemplateColumns: "90px 1fr 56px 56px 60px 110px", gap: 8, padding: "6px 4px", ...lbl }}>
              <span>Week</span><span>Win Rate</span>
              <span style={{ textAlign: "right" }}>Win</span>
              <span style={{ textAlign: "right" }}>Loss</span>
              <span style={{ textAlign: "right" }}>Open</span>
              <span style={{ textAlign: "right" }}>P&amp;L</span>
            </div>
            {weekly.map((w) => (
              <div key={w.key}
                onClick={() => setWeek(w.key)}
                title="Load this week into the builder above"
                style={{ display: "grid", gridTemplateColumns: "90px 1fr 56px 56px 60px 110px", gap: 8, padding: "7px 4px", borderTop: `1px solid rgba(255,255,255,0.04)`, alignItems: "center", fontSize: 12, cursor: "pointer", background: w.key === week ? "rgba(251,133,1,0.06)" : "transparent" }}>
                <span style={{ fontWeight: 700, color: "#fff" }}>{w.label}</span>
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <div style={{ flex: 1, maxWidth: 200, height: 6, borderRadius: 3, background: "rgba(255,255,255,0.08)", overflow: "hidden" }}>
                    <div style={{ height: "100%", width: `${w.pct ?? 0}%`, background: pctColor(w.pct), borderRadius: 3 }} />
                  </div>
                  <span style={{ fontSize: 11, fontWeight: 800, color: pctColor(w.pct), minWidth: 44 }}>{w.pct != null ? w.pct.toFixed(1) + "%" : "—"}</span>
                </div>
                <span style={{ textAlign: "right", fontFamily: "var(--font-mono)", color: HOME_THEME.green }}>{w.wins}</span>
                <span style={{ textAlign: "right", fontFamily: "var(--font-mono)", color: HOME_THEME.red }}>{w.losses}</span>
                <span style={{ textAlign: "right", fontFamily: "var(--font-mono)", color: w.open ? HOME_THEME.orange : HOME_THEME.muted }}>{w.open}</span>
                <span style={{ textAlign: "right", fontFamily: "var(--font-mono)", fontWeight: 700, color: pnlColor(w.pnl) }}>{money(w.pnl)}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* per-ticker record */}
      <div style={{ ...homePanelStyle, padding: 0, overflow: "hidden" }}>
        <div style={{ display: "grid", gridTemplateColumns: "90px 1fr 100px 90px 110px 110px", gap: 8, padding: "9px 16px", borderBottom: `1px solid ${HOME_THEME.border}`, ...lbl }}>
          <span>Ticker</span><span>Win Rate</span>
          <span style={{ textAlign: "right" }}>Win/Settled</span>
          <span style={{ textAlign: "right" }}>Max Loss</span>
          <span style={{ textAlign: "right" }}>Avg P&amp;L</span>
          <span style={{ textAlign: "right" }}>Total P&amp;L</span>
        </div>
        {loading && <div style={{ padding: 16, fontSize: 12, color: HOME_THEME.muted }}>Loading…</div>}
        {!loading && summary.length === 0 && (
          <div style={{ padding: 16, fontSize: 12, color: HOME_THEME.muted }}>
            No condors recorded yet — seed a Monday above to start the record.
          </div>
        )}
        {!loading && summary.map((s) => {
          const open = expanded === s.ticker;
          const pct = s.win_rate != null ? s.win_rate * 100 : null;
          const trows = (rowsByTicker.get(s.ticker) ?? []).slice().sort((a, b) => (a.week_start < b.week_start ? 1 : -1));
          return (
            <div key={s.ticker}>
              <div onClick={() => setExpanded(open ? null : s.ticker)}
                style={{ display: "grid", gridTemplateColumns: "90px 1fr 100px 90px 110px 110px", gap: 8, padding: "9px 16px", borderBottom: `1px solid rgba(255,255,255,0.04)`, alignItems: "center", cursor: "pointer", fontSize: 12, background: open ? "rgba(251,133,1,0.05)" : "transparent" }}>
                <span style={{ fontWeight: 800, color: "#fff" }}>{s.ticker}</span>
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <div style={{ flex: 1, maxWidth: 160, height: 6, borderRadius: 3, background: "rgba(255,255,255,0.08)", overflow: "hidden" }}>
                    <div style={{ height: "100%", width: `${pct ?? 0}%`, background: pctColor(pct), borderRadius: 3 }} />
                  </div>
                  <span style={{ fontSize: 11, fontWeight: 800, color: pctColor(pct), minWidth: 44 }}>{pct != null ? pct.toFixed(1) + "%" : "—"}</span>
                </div>
                <span style={{ textAlign: "right", fontFamily: "var(--font-mono)", color: "#fff" }}>{s.wins}/{s.settled}</span>
                <span style={{ textAlign: "right", fontFamily: "var(--font-mono)", color: s.max_losses ? HOME_THEME.red : HOME_THEME.muted }}>{s.max_losses}</span>
                <span style={{ textAlign: "right", fontFamily: "var(--font-mono)", color: pnlColor(s.avg_pnl) }}>{money(s.avg_pnl)}</span>
                <span style={{ textAlign: "right", fontFamily: "var(--font-mono)", fontWeight: 700, color: pnlColor(s.pnl) }}>{money(s.pnl)}</span>
              </div>

              {open && (
                <div style={{ padding: "12px 16px 16px", background: "rgba(0,0,0,0.2)", borderBottom: `1px solid rgba(255,255,255,0.04)` }}>
                  <div style={{ display: "grid", gridTemplateColumns: "64px 190px 80px 80px 90px 90px 80px", gap: 6, fontSize: 11, alignItems: "center" }}>
                    {["Week", "Condor (PL/PS — CS/CL)", "Credit", "Close", "Cushion", "P&L", "Outcome"].map((h, i) => (
                      <span key={h} style={{ ...lbl, textAlign: i >= 2 && i <= 5 ? "right" : i === 6 ? "center" : "left" }}>{h}</span>
                    ))}
                    {trows.map((r) => {
                      const l = legsOf(r);
                      const cushion = l && r.wk_close != null
                        ? Math.min(l.call_short - Number(r.wk_close), Number(r.wk_close) - l.put_short)
                        : null;
                      const c = r.result === "win" ? HOME_THEME.green : r.result === "loss" ? HOME_THEME.red : HOME_THEME.muted;
                      return (
                        <div key={r.id} style={{ display: "contents" }}>
                          <span style={{ color: "#fff", fontWeight: 700 }}>{r.week_label}</span>
                          <span style={{ fontFamily: "var(--font-mono)", color: HOME_THEME.muted }}>
                            {l ? <>{fmt(l.put_long, 0)}/{fmt(l.put_short, 0)} <span style={{ color: "#5a657a" }}>—</span> {fmt(l.call_short, 0)}/{fmt(l.call_long, 0)}</> : "—"}
                          </span>
                          <span style={{ textAlign: "right", fontFamily: "var(--font-mono)", color: HOME_THEME.cyan }}>{fmt(r.net_credit)}</span>
                          <span style={{ textAlign: "right", fontFamily: "var(--font-mono)", color: "#fff" }}>{fmt(r.wk_close)}</span>
                          <span style={{ textAlign: "right", fontFamily: "var(--font-mono)", color: cushion == null ? HOME_THEME.muted : cushion >= 0 ? HOME_THEME.green : HOME_THEME.red }}>
                            {cushion == null ? "—" : (cushion >= 0 ? "+" : "") + fmt(cushion)}
                          </span>
                          <span style={{ textAlign: "right", fontFamily: "var(--font-mono)", fontWeight: 700, color: pnlColor(r.pnl) }}>{money(r.pnl)}</span>
                          <span style={{ textAlign: "center" }}>
                            {r.result ? (
                              <span title={r.breached_side ? `${r.breached_side} side finished ITM` : "expired worthless"}
                                style={{ fontSize: 9, fontWeight: 800, color: c, padding: "2px 7px", borderRadius: 10, border: `1px solid ${c}44`, background: `${c}14` }}>
                                {OUTCOME_LABEL[r.outcome ?? ""] ?? (r.result === "win" ? "WIN" : "LOSS")}
                              </span>
                            ) : (
                              <span style={{ fontSize: 9, fontWeight: 800, color: HOME_THEME.orange }}>OPEN</span>
                            )}
                          </span>
                        </div>
                      );
                    })}
                  </div>
                  <div style={{ fontSize: 9, color: HOME_THEME.muted, marginTop: 10 }}>
                    Cushion = distance from the weekly close to the nearer SHORT strike (green = finished inside
                    both shorts for full credit, red = how far past). FULL = both spreads expired worthless.
                    MAX − = price blew all the way through a wing.
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
      <span style={{ fontSize: 9, fontWeight: 800, color: HOME_THEME.muted, textTransform: "uppercase", letterSpacing: "0.1em" }}>{label}</span>
      {children}
    </div>
  );
}
