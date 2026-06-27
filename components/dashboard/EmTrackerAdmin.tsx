"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  HOME_THEME,
  homePanelStyle,
  homeButtonStyle,
  homeSecondaryButtonStyle,
  homeInputStyle,
} from "@/components/shared/homeTheme";

// ─── Types ──────────────────────────────────────────────────────────────────

interface TrackerRow {
  id: number;
  ticker: string;
  week_label: string;
  week_start: string | null;
  em: number;
  ref_close: number | null;
  up: number | null;
  down: number | null;
  o: number | null; h: number | null; l: number | null; c: number | null;
  result: "hit" | "miss" | null;
  breach: number | null;
  result_source: string | null;
  note: string | null;
}

interface Summary {
  ticker: string;
  hits: number;
  misses: number;
  evaluated: number;
  total: number;
  hit_rate: number | null;
  latest_em: number | null;
  latest_week: string | null;
}

interface HistTally { hits: number; total: number; pct: number; latest_em: number }
interface History { tallies: Record<string, HistTally>; total_weeks: number }

interface DiscordRow { ticker: string; up: number; down: number; repaired?: boolean }
interface DiscordWeek {
  week_start: string; week_label: string; friday?: string; week_inferred?: boolean;
  source_url?: string; ocr_ticker_count?: number; rows: DiscordRow[]; raw_ocr?: string;
  committed?: boolean; // marked once this week has been saved + scored
}
interface DiscordPreview { weeks: DiscordWeek[]; note?: string }

const TICKERS = [
  "SPX","NDX","ESU","NQU","SPY","QQQ","AAPL","AMD","AMZN",
  "GOOGL","META","MSFT","NVDA","TSLA","COIN","HOOD","IWM","NFLX","SMH","PLTR",
];

// Canonical board roster, in the order the EM boards print them. Every weekly
// board carries this fixed set; the review panel shows one row per roster ticker
// (blank where OCR missed it) so missing data is obvious and fillable. The
// futures line rolls (ESM↔ESU display), so that ticker is editable per week.
const BOARD_ROSTER = [
  "ESM","NQM","SPY","QQQ","SPX","AAPL","AMD","AMZN","GOOGL","META","MSFT","NVDA","TSLA",
  "COIN","HOOD","IWM","NDX","NFLX","SMH","PLTR",
];

/** Merge OCR rows onto the full roster so every expected ticker has a row
 *  (blank up/down where OCR found nothing). Preserves any extra OCR tickers not
 *  in the roster (appended at the end). */
function rosterRows(ocrRows: DiscordRow[]): DiscordRow[] {
  const byTicker = new Map(ocrRows.map((r) => [r.ticker, r]));
  const out: DiscordRow[] = BOARD_ROSTER.map(
    (t) => byTicker.get(t) ?? { ticker: t, up: NaN as unknown as number, down: NaN as unknown as number }
  );
  for (const r of ocrRows) if (!BOARD_ROSTER.includes(r.ticker)) out.push(r);
  return out;
}

// ─── OCR sanity flagging ──────────────────────────────────────────────────────
// Per-cell issues we know OCR produces on these boards. A flagged ticker turns
// red in the review panel with a tooltip naming the problem(s).

interface RowFlag { bad: boolean; blank: boolean; reasons: string[] }

function median(xs: number[]): number | null {
  const v = xs.filter((n) => Number.isFinite(n) && n > 0).sort((a, b) => a - b);
  if (!v.length) return null;
  const m = Math.floor(v.length / 2);
  return v.length % 2 ? v[m] : (v[m - 1] + v[m]) / 2;
}

/** Median up-level per ticker across all preview weeks — baseline for the
 *  magnitude-outlier (dropped-decimal) check. */
function buildTickerMedians(weeks: DiscordWeek[]): Record<string, number> {
  const by: Record<string, number[]> = {};
  for (const w of weeks) for (const r of w.rows) {
    (by[r.ticker] = by[r.ticker] || []).push(Number(r.up));
  }
  const out: Record<string, number> = {};
  for (const [t, xs] of Object.entries(by)) { const m = median(xs); if (m != null) out[t] = m; }
  return out;
}

/** If a value is a clean power-of-10 off the ticker's typical level (the classic
 *  OCR dropped-decimal: 2842865 ↔ 28428.65), snap it back. Returns the repaired
 *  number, or the original if no confident fix. Conservative: only adjusts when
 *  the result lands within 35% of the median. */
function repairValue(v: number, medianRef?: number): number {
  if (!Number.isFinite(v) || v <= 0 || !medianRef || medianRef <= 0) return v;
  let best = v, bestErr = Math.abs(Math.log10(v / medianRef));
  for (const k of [-3, -2, -1, 1, 2, 3]) {
    const cand = v * Math.pow(10, k);
    const err = Math.abs(Math.log10(cand / medianRef));
    if (err < bestErr) { bestErr = err; best = cand; }
  }
  // accept only if the snapped value is within ~35% of the median
  if (best !== v && Math.abs(best / medianRef - 1) <= 0.35) return best;
  return v;
}

/** Build a per-ticker median from only the rows that look sane (so a few garbled
 *  cells don't poison the baseline used for repair/flagging). */
function robustMediansUp(weeks: DiscordWeek[]): Record<string, number> {
  const by: Record<string, number[]> = {};
  for (const w of weeks) for (const r of w.rows) {
    const up = Number(r.up), dn = Number(r.down);
    if (Number.isFinite(up) && Number.isFinite(dn) && up > 0 && dn > 0 && up > dn && up / dn < 1.5) {
      (by[r.ticker] = by[r.ticker] || []).push(up);
    }
  }
  const out: Record<string, number> = {};
  for (const [t, xs] of Object.entries(by)) { const m = median(xs); if (m != null) out[t] = m; }
  return out;
}

function flagRow(r: DiscordRow, tickerMedianUp?: number): RowFlag {
  const reasons: string[] = [];
  const up = Number(r.up), down = Number(r.down);

  // A roster row with no numbers yet = blank (needs manual input), not "wrong".
  const upBlank = !Number.isFinite(up) || up <= 0;
  const downBlank = !Number.isFinite(down) || down <= 0;
  if (upBlank && downBlank) return { bad: false, blank: true, reasons: ["needs input"] };

  if (upBlank) reasons.push("Up missing");
  if (downBlank) reasons.push("Down missing");

  if (Number.isFinite(up) && Number.isFinite(down) && up > 0 && down > 0) {
    if (up <= down) reasons.push("Up ≤ Down (inverted)");
    const ratio = up / down;
    // implied half-band as % of midpoint = the EM%. Normal weeklies ~1–10%.
    const emPct = ((up - down) / 2) / ((up + down) / 2) * 100;
    if (ratio > 1.5 || emPct > 18) reasons.push(`band too wide (${emPct.toFixed(0)}%)`);
    if (Math.abs(up - down) < up * 0.0005) reasons.push("band collapsed (decimal dropped?)");
  }

  // magnitude vs this ticker's own median across weeks — catches 10×/100× shifts
  if (tickerMedianUp && Number.isFinite(up) && up > 0) {
    const f = up / tickerMedianUp;
    if (f > 3 || f < 1 / 3) reasons.push(`Up off ~${f >= 1 ? f.toFixed(0) + "×" : "1/" + (1 / f).toFixed(0)} vs usual`);
  }
  return { bad: reasons.length > 0, blank: false, reasons };
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function pctColor(p: number | null): string {
  if (p == null) return HOME_THEME.muted;
  if (p >= 75) return HOME_THEME.green;
  if (p >= 60) return HOME_THEME.cyan;
  if (p >= 50) return HOME_THEME.orange;
  return HOME_THEME.red;
}

function fmt(n: number | null | undefined, d = 2): string {
  if (n == null || !Number.isFinite(n)) return "—";
  return Number(n).toLocaleString(undefined, { maximumFractionDigits: d });
}

function thisMonday(): string {
  const d = new Date();
  const dow = (d.getDay() + 6) % 7; // Mon=0
  d.setDate(d.getDate() - dow);
  return d.toISOString().slice(0, 10);
}
function weekLabelFromDate(iso: string): string {
  const d = new Date(iso + "T00:00:00");
  return `${d.getMonth() + 1}/${d.getDate()}`;
}

// ─── Component ──────────────────────────────────────────────────────────────

export default function EmTrackerAdmin() {
  const [summary, setSummary] = useState<Summary[]>([]);
  const [rows, setRows] = useState<TrackerRow[]>([]);
  const [history, setHistory] = useState<History>({ tallies: {}, total_weeks: 31 });
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);

  // Discord OCR review
  const [review, setReview] = useState<DiscordPreview | null>(null);
  const [reviewOpen, setReviewOpen] = useState(false);
  // Raw string drafts for numeric cells — prevents "." being eaten on every keystroke
  const [draftCells, setDraftCells] = useState<Record<string, string>>({});

  // add-week form
  const [fTicker, setFTicker] = useState("SPX");
  const [fWeekStart, setFWeekStart] = useState(thisMonday());
  const [fEm, setFEm] = useState("");
  const [fRef, setFRef] = useState("");
  const [fHigh, setFHigh] = useState("");
  const [fLow, setFLow] = useState("");
  const [fClose, setFClose] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [t, h] = await Promise.all([
        fetch("/api/em-tracker").then((r) => r.json()),
        fetch("/api/em-tracker/history").then((r) => r.json()),
      ]);
      setSummary(t.summary || []);
      setRows(t.rows || []);
      setHistory(h || { tallies: {}, total_weeks: 31 });
    } catch (e) {
      setMsg("Load failed: " + String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  // Combined record = verified historical tally (from the original spreadsheet)
  // + going-forward weeks auto-scored from OHLC each Saturday.
  const merged = useMemo(() => {
    const bySym = new Map<string, Summary>();
    summary.forEach((s) => bySym.set(s.ticker, s));
    const keys = new Set<string>([...Object.keys(history.tallies), ...summary.map((s) => s.ticker)]);
    return Array.from(keys).map((ticker) => {
      const live = bySym.get(ticker);
      const hist = history.tallies[ticker];
      const liveHits = live?.hits ?? 0;
      const liveEval = live?.evaluated ?? 0;
      const histHits = hist?.hits ?? 0;
      const histTotal = hist?.total ?? 0;
      const totalHits = histHits + liveHits;
      const totalEval = histTotal + liveEval;
      return {
        ticker,
        histHits, histTotal, histPct: hist?.pct ?? null,
        liveHits, liveMisses: live?.misses ?? 0, liveEval,
        totalHits, totalEval,
        combinedPct: totalEval > 0 ? (totalHits / totalEval) * 100 : null,
        latestEm: live?.latest_em ?? hist?.latest_em ?? null,
      };
    }).sort((a, b) => (b.combinedPct ?? -1) - (a.combinedPct ?? -1));
  }, [summary, history]);

  const totals = useMemo(() => {
    const hits = merged.reduce((s, m) => s + m.totalHits, 0);
    const evald = merged.reduce((s, m) => s + m.totalEval, 0);
    return { hits, evald, pct: evald > 0 ? (hits / evald) * 100 : null };
  }, [merged]);

  async function addWeek() {
    if (!fEm) { setMsg("Enter an EM value"); return; }
    setBusy(true); setMsg(null);
    const body: Record<string, unknown> = {
      ticker: fTicker,
      week_label: weekLabelFromDate(fWeekStart),
      week_start: fWeekStart,
      em: Number(fEm),
      ref_close: fRef ? Number(fRef) : null,
      h: fHigh ? Number(fHigh) : null,
      l: fLow ? Number(fLow) : null,
      c: fClose ? Number(fClose) : null,
      result_source: "manual",
    };
    try {
      const r = await fetch("/api/em-tracker", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      }).then((r) => r.json());
      if (r.ok) { setMsg(`Saved ${fTicker} ${body.week_label}`); setFEm(""); setFRef(""); setFHigh(""); setFLow(""); setFClose(""); await load(); }
      else setMsg("Save failed: " + (r.error || "unknown"));
    } catch (e) { setMsg("Save failed: " + String(e)); }
    finally { setBusy(false); }
  }

  async function resetGoingForward() {
    if (!window.confirm("Clear ALL going-forward EM Tracker rows from the database? Your verified 31-week history stays intact. This fixes stats thrown off by a bad import.")) return;
    setBusy(true); setMsg(null);
    try {
      const r = await fetch("/api/em-tracker?all=1", { method: "DELETE" }).then((r) => r.json());
      if (r.ok) setMsg(`Reset — removed ${r.removed} going-forward row(s). Verified history restored.`);
      else setMsg("Reset failed: " + (r.error || "unknown"));
      await load();
    } catch (e) { setMsg("Reset failed: " + String(e)); }
    finally { setBusy(false); }
  }

  async function loadReview() {
    setBusy(true); setMsg(null);
    try {
      const p: DiscordPreview = await fetch("/api/em-tracker/discord-preview").then((r) => r.json());
      if (p.weeks?.length) {
        // Per-ticker baseline from the sane rows, used to auto-repair dropped
        // decimals (e.g. 2842865 → 28428.65). Repaired cells are marked so they
        // stay flagged for you to confirm against the image.
        const ref = robustMediansUp(p.weeks);
        p.weeks = p.weeks.map((w) => {
          const rows = rosterRows(w.rows || []).map((r) => {
            const m = ref[r.ticker];
            const up2 = repairValue(Number(r.up), m);
            const dn2 = repairValue(Number(r.down), m);
            const repaired = up2 !== Number(r.up) || dn2 !== Number(r.down);
            return repaired ? { ...r, up: up2, down: dn2, repaired: true } : r;
          });
          return { ...w, rows };
        });
      }
      setReview(p);
      setReviewOpen(true);
      if (!p.weeks?.length) setMsg(p.note || "No Discord preview found — run the import script first.");
    } catch (e) { setMsg("Preview load failed: " + String(e)); }
    finally { setBusy(false); }
  }

  function editReviewCell(wi: number, ri: number, field: "up" | "down", value: string) {
    // Store raw string so "188." doesn't get eaten mid-type
    setDraftCells((d) => ({ ...d, [`${wi}-${ri}-${field}`]: value }));
  }

  function flushReviewCell(wi: number, ri: number, field: "up" | "down") {
    const key = `${wi}-${ri}-${field}`;
    setDraftCells((d) => { const n = { ...d }; delete n[key]; return n; });
    const raw = draftCells[key];
    if (raw === undefined) return;
    setReview((prev) => {
      if (!prev) return prev;
      const weeks = prev.weeks.map((w, i) => {
        if (i !== wi) return w;
        const num = raw.trim() === "" ? (NaN as unknown as number) : Number(raw);
        const rows = w.rows.map((r, j) => (j === ri ? { ...r, [field]: num, repaired: false } : r));
        return { ...w, rows };
      });
      return { ...prev, weeks };
    });
  }

  function editReviewTicker(wi: number, ri: number, value: string) {
    setReview((prev) => {
      if (!prev) return prev;
      const weeks = prev.weeks.map((w, i) => {
        if (i !== wi) return w;
        const rows = w.rows.map((r, j) => (j === ri ? { ...r, ticker: value.toUpperCase() } : r));
        return { ...w, rows };
      });
      return { ...prev, weeks };
    });
  }

  function addReviewRow(wi: number) {
    setReview((prev) => {
      if (!prev) return prev;
      const weeks = prev.weeks.map((w, i) =>
        i === wi ? { ...w, rows: [...w.rows, { ticker: "", up: NaN as unknown as number, down: NaN as unknown as number }] } : w
      );
      return { ...prev, weeks };
    });
  }

  function deleteReviewRow(wi: number, ri: number) {
    setReview((prev) => {
      if (!prev) return prev;
      const weeks = prev.weeks.map((w, i) =>
        i === wi ? { ...w, rows: w.rows.filter((_, j) => j !== ri) } : w
      );
      return { ...prev, weeks };
    });
  }

  function editReviewWeekStart(wi: number, iso: string) {
    setReview((prev) => {
      if (!prev) return prev;
      const weeks = prev.weeks.map((w, i) =>
        i === wi ? { ...w, week_start: iso, week_label: weekLabelFromDate(iso), week_inferred: false } : w
      );
      return { ...prev, weeks };
    });
  }

  // Keep only fillable rows (ticker + both numbers) for a single week.
  function cleanWeek(w: DiscordWeek) {
    return { ...w, rows: w.rows.filter((r) => r.ticker && Number.isFinite(Number(r.up)) && Number.isFinite(Number(r.down))) };
  }

  // Commit ONE week. Banks progress immediately so a long review session never
  // loses work. Marks the week committed (stays visible, greyed) without
  // re-doing it on a later bulk commit.
  async function commitOneWeek(wi: number) {
    if (!review) return;
    const w = cleanWeek(review.weeks[wi]);
    if (!w.rows.length) { setMsg("Nothing to commit for this week — fill the blanks first."); return; }
    setBusy(true); setMsg(null);
    try {
      const r = await fetch("/api/em-tracker/commit-history", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ weeks: [w] }),
      }).then((r) => r.json());
      if (r.ok) {
        setMsg(`Week ${w.week_label} committed — ${r.bands} tickers, ${r.hits} win / ${r.misses} loss, ${r.breaches} breaches${r.missingOhlc ? `, ${r.missingOhlc} no OHLC` : ""}.`);
        setReview((prev) => prev ? { ...prev, weeks: prev.weeks.map((x, i) => i === wi ? { ...x, committed: true } : x) } : prev);
        await load();
      } else setMsg(`Week ${w.week_label} failed: ` + (r.error || "unknown"));
    } catch (e) { setMsg("Commit failed: " + String(e)); }
    finally { setBusy(false); }
  }

  async function commitReview() {
    if (!review?.weeks?.length) return;
    // Only weeks not already committed; drop blank rows.
    const weeks = review.weeks
      .map((w, i) => ({ w: cleanWeek(w), i }))
      .filter(({ w, i }) => !review.weeks[i].committed && w.rows.length > 0)
      .map(({ w }) => w);
    const totalRows = weeks.reduce((s, w) => s + w.rows.length, 0);
    if (!totalRows) { setMsg("Nothing left to commit — all weeks committed or blank."); return; }
    if (!window.confirm(`Commit the ${weeks.length} remaining week(s) / ${totalRows} ticker-rows? Already-committed weeks are skipped. Bands are scored against weekly OHLC (win = close inside).`)) return;
    setBusy(true); setMsg(null);
    try {
      const r = await fetch("/api/em-tracker/commit-history", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ weeks }),
      }).then((r) => r.json());
      if (r.ok) {
        setMsg(`Committed ${r.bands} bands across ${r.weeks} weeks — ${r.hits} win / ${r.misses} loss, ${r.breaches} breaches${r.missingOhlc ? `, ${r.missingOhlc} missing OHLC` : ""}.`);
        // Mark all just-committed weeks; keep panel open so you can see results.
        const committedKeys = new Set(weeks.map((w) => w.week_start));
        setReview((prev) => prev ? { ...prev, weeks: prev.weeks.map((x) => committedKeys.has(x.week_start) ? { ...x, committed: true } : x) } : prev);
        await load();
      } else setMsg("Commit failed: " + (r.error || "unknown"));
    } catch (e) { setMsg("Commit failed: " + String(e)); }
    finally { setBusy(false); }
  }

  async function runEvaluate() {
    setBusy(true); setMsg(null);
    try {
      const r = await fetch("/api/em-tracker/evaluate", { method: "POST" }).then((r) => r.json());
      if (r.ok) setMsg(`Evaluated ${r.evaluated} week(s): ${r.hits} hit / ${r.misses} miss`);
      else setMsg("Evaluate failed: " + (r.error || "unknown"));
      await load();
    } catch (e) { setMsg("Evaluate failed: " + String(e)); }
    finally { setBusy(false); }
  }

  async function setResult(id: number, result: "hit" | "miss") {
    await fetch("/api/em-tracker", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ id, result }),
    });
    await load();
  }

  const rowsByTicker = useMemo(() => {
    const m = new Map<string, TrackerRow[]>();
    rows.forEach((r) => { const a = m.get(r.ticker) ?? []; a.push(r); m.set(r.ticker, a); });
    return m;
  }, [rows]);

  // Per-ticker median up-level across the preview, for OCR outlier flagging.
  const reviewMedians = useMemo(
    () => (review ? buildTickerMedians(review.weeks) : {}),
    [review]
  );
  // Total flagged cells across all preview weeks (shown in the panel header).
  const reviewFlagCount = useMemo(() => {
    if (!review) return 0;
    let n = 0;
    for (const w of review.weeks) for (const r of w.rows) if (flagRow(r, reviewMedians[r.ticker]).bad) n++;
    return n;
  }, [review, reviewMedians]);

  const lbl = { fontSize: 9, fontWeight: 800 as const, color: HOME_THEME.muted, textTransform: "uppercase" as const, letterSpacing: "0.12em" };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      <style>{`@keyframes emfade{from{opacity:0}to{opacity:1}}`}</style>

      {/* header / actions */}
      <div style={{ ...homePanelStyle, padding: "14px 18px", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <span style={{ fontSize: 12, fontWeight: 800, letterSpacing: "0.14em", textTransform: "uppercase", color: HOME_THEME.cyan }}>
            EM Tracker
          </span>
          <span style={{ fontSize: 10, color: HOME_THEME.muted }}>
            Closed-inside-EM win/loss · {history.total_weeks} verified wks + going-forward
          </span>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          {totals.pct != null && (
            <span style={{ fontSize: 11, color: HOME_THEME.muted }}>
              Overall&nbsp;
              <b style={{ color: pctColor(totals.pct) }}>{totals.pct.toFixed(1)}%</b>
              &nbsp;({totals.hits}/{totals.evald})
            </span>
          )}
          <button onClick={runEvaluate} disabled={busy} style={{ ...homeButtonStyle, opacity: busy ? 0.5 : 1 }} title="Score last completed week from weekly OHLC (runs automatically Saturday 9am ET)">
            {busy ? "…" : "Evaluate Now"}
          </button>
          <button onClick={loadReview} disabled={busy} style={{ ...homeSecondaryButtonStyle, opacity: busy ? 0.5 : 1 }} title="Review the OCR'd weekly boards pulled from Discord, fix any misreads, then commit + evaluate vs OHLC">
            Review Discord Import
          </button>
          <button onClick={load} disabled={loading} style={homeSecondaryButtonStyle}>Refresh</button>
          <button onClick={resetGoingForward} disabled={busy} style={{ ...homeSecondaryButtonStyle, borderColor: `${HOME_THEME.red}55`, color: HOME_THEME.red, opacity: busy ? 0.5 : 1 }} title="Wipe going-forward DB rows (e.g. after a bad import). Verified 31-week history is kept.">
            Reset Going-Fwd
          </button>
        </div>
      </div>

      {msg && (
        <div style={{ ...homePanelStyle, padding: "8px 14px", fontSize: 11, color: HOME_THEME.cyan, animation: "emfade .3s" }}>{msg}</div>
      )}

      {/* Discord OCR review panel */}
      {reviewOpen && review && (
        <div style={{ ...homePanelStyle, padding: "14px 16px" }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <span style={{ ...lbl }}>Review Discord Import · {review.weeks.length} week(s)</span>
              {reviewFlagCount > 0 && (
                <span style={{ fontSize: 9, fontWeight: 800, color: HOME_THEME.red, padding: "2px 8px", borderRadius: 10, border: `1px solid ${HOME_THEME.red}55`, background: `${HOME_THEME.red}14` }}>
                  ⚠ {reviewFlagCount} cell{reviewFlagCount === 1 ? "" : "s"} flagged
                </span>
              )}
            </div>
            <div style={{ display: "flex", gap: 8 }}>
              <button onClick={commitReview} disabled={busy || !review.weeks.length} style={{ ...homeButtonStyle, opacity: busy ? 0.5 : 1 }} title="Commit every remaining (un-committed) week at once">
                Commit All Remaining
              </button>
              <button onClick={() => setReviewOpen(false)} style={homeSecondaryButtonStyle}>Close</button>
            </div>
          </div>
          <div style={{ fontSize: 11, color: HOME_THEME.muted, marginBottom: 12, lineHeight: 1.5 }}>
            Every board shows the full ticker roster. <b style={{ color: HOME_THEME.red }}>Red</b> = likely OCR error (inverted, dropped decimal, off vs usual) — hover for why.
            <b style={{ color: HOME_THEME.orange }}> Orange</b> = blank (OCR missed it) — type the Up/Down from the image. The ticker name is editable for futures rolls (ESM↔ESU), and “+ Add ticker” handles extras. Blank rows are skipped on commit. Bands are scored against the actual weekly OHLC (win = close inside).
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 14, maxHeight: 560, overflowY: "auto" }}>
            {review.weeks.map((w, wi) => {
              const filled = w.rows.filter((r) => r.ticker && Number.isFinite(Number(r.up)) && Number.isFinite(Number(r.down))).length;
              const lowCount = filled < 18;
              const numStr = (n: number) => (Number.isFinite(Number(n)) ? String(n) : "");
              return (
              <div key={w.week_start + "_" + wi} style={{ border: `1px solid ${w.committed ? HOME_THEME.green + "55" : HOME_THEME.border}`, borderRadius: 10, opacity: w.committed ? 0.6 : 1 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 12px", background: w.committed ? `${HOME_THEME.green}0d` : w.week_inferred ? "rgba(249,115,22,0.08)" : "rgba(33,158,188,0.04)", borderBottom: `1px solid ${HOME_THEME.border}`, borderRadius: "10px 10px 0 0", flexWrap: "wrap" }}>
                  <span style={{ fontSize: 13, fontWeight: 800, color: "#fff" }}>Week of</span>
                  <input type="date" value={w.week_start} onChange={(e) => editReviewWeekStart(wi, e.target.value)} disabled={w.committed} style={{ ...homeInputStyle, padding: "5px 8px", fontSize: 13, width: 150 }} />
                  <span style={{ fontSize: 12, color: lowCount && !w.committed ? HOME_THEME.orange : HOME_THEME.muted }}>
                    board “{w.week_label}” · {filled}/{w.rows.length} filled{lowCount && !w.committed ? " ⚠ low — fill the blanks" : ""}
                  </span>
                  {w.week_inferred && !w.committed && (
                    <span style={{ fontSize: 9, fontWeight: 800, color: HOME_THEME.orange, padding: "2px 7px", borderRadius: 10, border: `1px solid ${HOME_THEME.orange}55`, background: `${HOME_THEME.orange}14` }} title="Title date couldn't be read — week was inferred from the post date. Verify against the image.">
                      ⚠ VERIFY WEEK
                    </span>
                  )}
                  <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 10 }}>
                    {w.source_url && (
                      <a href={w.source_url} target="_blank" rel="noreferrer" style={{ fontSize: 11, color: HOME_THEME.cyan, fontWeight: 700 }}>view image ↗</a>
                    )}
                    {w.committed ? (
                      <span style={{ fontSize: 11, fontWeight: 800, color: HOME_THEME.green }}>✓ Committed</span>
                    ) : (
                      <button onClick={() => commitOneWeek(wi)} disabled={busy || filled === 0} style={{ ...homeButtonStyle, padding: "5px 14px", opacity: busy || filled === 0 ? 0.5 : 1 }} title="Save & score just this week now">
                        Commit Week
                      </button>
                    )}
                  </div>
                </div>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(250px, 1fr))", columnGap: 12, rowGap: 10, padding: 14 }}>
                  {w.rows.map((r, ri) => {
                    const fl = flagRow(r, reviewMedians[r.ticker]);
                    const tone = fl.bad ? HOME_THEME.red : fl.blank ? HOME_THEME.orange : r.repaired ? HOME_THEME.cyan : null;
                    const bd = tone ?? HOME_THEME.border;
                    const tip = fl.bad ? "OCR check: " + fl.reasons.join("; ")
                      : fl.blank ? "Missing from OCR — type it in from the image"
                      : r.repaired ? "Auto-fixed a dropped decimal — confirm against the image" : undefined;
                    const numColor = fl.bad ? HOME_THEME.red : r.repaired ? HOME_THEME.cyan : HOME_THEME.text;
                    return (
                      <div key={ri} title={tip}
                        style={{ display: "flex", alignItems: "center", gap: 7, fontSize: 14, padding: "4px 6px", borderRadius: 6, background: fl.bad ? `${HOME_THEME.red}10` : fl.blank ? `${HOME_THEME.orange}0d` : r.repaired ? `${HOME_THEME.cyan}0d` : "transparent", border: `1px solid ${tone ? tone + "44" : "transparent"}` }}>
                        <span style={{ width: 14, fontSize: 12, color: r.repaired ? HOME_THEME.cyan : "transparent" }} title={r.repaired ? "auto-fixed" : undefined}>{r.repaired ? "↩" : ""}</span>
                        <input value={r.ticker} onChange={(e) => editReviewTicker(wi, ri, e.target.value)} placeholder="—"
                          style={{ ...homeInputStyle, width: 62, padding: "6px 6px", fontSize: 14, fontWeight: 800, textTransform: "uppercase", borderColor: tone ? bd : "transparent", background: "transparent", color: fl.bad ? HOME_THEME.red : "#fff" }} title="Ticker" />
                        <input
                          value={draftCells[`${wi}-${ri}-up`] ?? numStr(r.up)}
                          onChange={(e) => editReviewCell(wi, ri, "up", e.target.value)}
                          onBlur={() => flushReviewCell(wi, ri, "up")}
                          placeholder="up" style={{ ...homeInputStyle, width: 82, padding: "6px 8px", fontSize: 14, borderColor: bd, color: numColor }} title="Up" />
                        <span style={{ color: "#5a657a", fontSize: 14 }}>/</span>
                        <input
                          value={draftCells[`${wi}-${ri}-down`] ?? numStr(r.down)}
                          onChange={(e) => editReviewCell(wi, ri, "down", e.target.value)}
                          onBlur={() => flushReviewCell(wi, ri, "down")}
                          placeholder="down" style={{ ...homeInputStyle, width: 82, padding: "6px 8px", fontSize: 14, borderColor: bd, color: numColor }} title="Down" />
                        <button onClick={() => deleteReviewRow(wi, ri)} title="Remove row" style={{ background: "none", border: "none", color: HOME_THEME.muted, fontSize: 16, cursor: "pointer", lineHeight: 1, padding: "0 2px" }}>×</button>
                      </div>
                    );
                  })}
                </div>
                <div style={{ padding: "0 14px 12px 14px" }}>
                  <button onClick={() => addReviewRow(wi)} style={{ ...homeSecondaryButtonStyle, padding: "5px 12px", fontSize: 11 }}>+ Add ticker</button>
                </div>
              </div>
            ); })}
          </div>
        </div>
      )}

      {/* per-ticker hit-rate table */}
      <div style={{ ...homePanelStyle, padding: 0, overflow: "hidden" }}>
        <div style={{ display: "grid", gridTemplateColumns: "90px 1fr 110px 110px 130px 90px", gap: 8, padding: "9px 16px", borderBottom: `1px solid ${HOME_THEME.border}`, ...lbl }}>
          <span>Ticker</span><span>Hit Rate</span><span style={{ textAlign: "right" }}>Verified</span>
          <span style={{ textAlign: "right" }}>Going-Fwd</span><span style={{ textAlign: "right" }}>Combined</span><span style={{ textAlign: "right" }}>Latest EM</span>
        </div>
        {loading && <div style={{ padding: 16, fontSize: 12, color: HOME_THEME.muted }}>Loading…</div>}
        {!loading && merged.map((m) => {
          const open = expanded === m.ticker;
          const trows = rowsByTicker.get(m.ticker) ?? [];
          return (
            <div key={m.ticker}>
              <div
                onClick={() => setExpanded(open ? null : m.ticker)}
                style={{ display: "grid", gridTemplateColumns: "90px 1fr 110px 110px 130px 90px", gap: 8, padding: "9px 16px", borderBottom: `1px solid rgba(255,255,255,0.04)`, alignItems: "center", cursor: "pointer", fontSize: 12, background: open ? "rgba(33,158,188,0.04)" : "transparent" }}
              >
                <span style={{ fontWeight: 800, color: "#fff" }}>{m.ticker}</span>
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <div style={{ flex: 1, maxWidth: 160, height: 6, borderRadius: 3, background: "rgba(255,255,255,0.08)", overflow: "hidden" }}>
                    <div style={{ height: "100%", width: `${m.combinedPct ?? 0}%`, background: pctColor(m.combinedPct), borderRadius: 3 }} />
                  </div>
                  <span style={{ fontSize: 11, fontWeight: 800, color: pctColor(m.combinedPct), minWidth: 44 }}>
                    {m.combinedPct != null ? m.combinedPct.toFixed(1) + "%" : "—"}
                  </span>
                </div>
                <span style={{ textAlign: "right", color: HOME_THEME.muted, fontFamily: "monospace" }}>{m.histHits}/{m.histTotal}</span>
                <span style={{ textAlign: "right", fontFamily: "monospace", color: m.liveEval ? "#fff" : HOME_THEME.muted }}>
                  {m.liveHits}/{m.liveEval}
                </span>
                <span style={{ textAlign: "right", fontFamily: "monospace", color: "#fff" }}>{m.totalHits}/{m.totalEval}</span>
                <span style={{ textAlign: "right", fontFamily: "monospace", color: HOME_THEME.cyan }}>{fmt(m.latestEm)}</span>
              </div>

              {open && (
                <div style={{ padding: "12px 16px 16px 16px", background: "rgba(0,0,0,0.2)", borderBottom: `1px solid rgba(255,255,255,0.04)` }}>
                  {trows.length === 0 && (
                    <div style={{ fontSize: 11, color: HOME_THEME.muted }}>
                      No going-forward weeks recorded yet. Each Saturday the band is seeded for the coming week, then scored the following Saturday from the weekly close.
                    </div>
                  )}
                  {trows.length > 0 && (
                    <div style={{ display: "grid", gridTemplateColumns: "70px 80px 150px 90px 90px 70px 70px", gap: 6, fontSize: 11, alignItems: "center" }}>
                      {/* header */}
                      {["Week","EM","Band (Down → Up)","Close","Δ Edge","Breach","Result"].map((h, i) => (
                        <span key={h} style={{ ...lbl, textAlign: i >= 1 && i <= 4 ? "right" : (i >= 5 ? "center" : "left") }}>{h}</span>
                      ))}
                      {trows.map((r) => {
                        const c = r.result === "hit" ? HOME_THEME.green : r.result === "miss" ? HOME_THEME.red : HOME_THEME.muted;
                        const up = r.up ?? (r.ref_close != null ? r.ref_close + r.em : null);
                        const down = r.down ?? (r.ref_close != null ? r.ref_close - r.em : null);
                        const close = r.c;
                        // Distance from the nearer band edge. Positive = inside (cushion),
                        // negative = outside (how far it broke).
                        let edge: number | null = null;
                        if (close != null && up != null && down != null) {
                          edge = Math.min(up - close, close - down);
                        }
                        return (
                          <div key={r.id} style={{ display: "contents" }}>
                            <span style={{ color: "#fff", fontWeight: 700 }}>{r.week_label}</span>
                            <span style={{ textAlign: "right", fontFamily: "monospace", color: HOME_THEME.cyan }}>{fmt(r.em)}</span>
                            <span style={{ textAlign: "right", fontFamily: "monospace", color: HOME_THEME.muted }}>
                              {down != null ? fmt(down) : "—"} <span style={{ color: "#5a657a" }}>→</span> {up != null ? fmt(up) : "—"}
                            </span>
                            <span style={{ textAlign: "right", fontFamily: "monospace", color: close != null ? "#fff" : HOME_THEME.muted }}>
                              {close != null ? fmt(close) : "—"}
                            </span>
                            <span style={{ textAlign: "right", fontFamily: "monospace", color: edge == null ? HOME_THEME.muted : edge >= 0 ? HOME_THEME.green : HOME_THEME.red }}>
                              {edge == null ? "—" : (edge >= 0 ? "+" : "") + fmt(edge)}
                            </span>
                            <span style={{ textAlign: "center", fontSize: 10, fontWeight: 700, color: r.breach == null ? HOME_THEME.muted : r.breach ? HOME_THEME.orange : HOME_THEME.green }}>
                              {r.breach == null ? "—" : r.breach ? "YES" : "no"}
                            </span>
                            <span style={{ textAlign: "center" }}>
                              {r.result ? (
                                <span style={{ fontSize: 10, fontWeight: 800, color: c, padding: "2px 8px", borderRadius: 10, border: `1px solid ${c}44`, background: `${c}14` }}>
                                  {r.result === "hit" ? "WIN" : "LOSS"}
                                </span>
                              ) : (
                                <span style={{ display: "inline-flex", gap: 3 }}>
                                  <button onClick={(e) => { e.stopPropagation(); setResult(r.id, "hit"); }} style={{ ...homeSecondaryButtonStyle, padding: "1px 6px", fontSize: 9 }} title="Mark win">W</button>
                                  <button onClick={(e) => { e.stopPropagation(); setResult(r.id, "miss"); }} style={{ ...homeSecondaryButtonStyle, padding: "1px 6px", fontSize: 9 }} title="Mark loss">L</button>
                                </span>
                              )}
                            </span>
                          </div>
                        );
                      })}
                    </div>
                  )}
                  <div style={{ fontSize: 9, color: HOME_THEME.muted, marginTop: 10 }}>
                    Win = weekly close inside the band [down, up]. Δ Edge = distance from the nearer band edge (green = cushion inside, red = how far it broke out).
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* add-week form */}
      <div style={{ ...homePanelStyle, padding: "14px 18px" }}>
        <div style={{ ...lbl, marginBottom: 10 }}>Add / Update Week</div>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 10, alignItems: "flex-end" }}>
          <Field label="Ticker">
            <select value={fTicker} onChange={(e) => setFTicker(e.target.value)} style={{ ...homeInputStyle, minWidth: 90 }}>
              {TICKERS.map((t) => <option key={t} value={t}>{t}</option>)}
            </select>
          </Field>
          <Field label="Week (Mon)">
            <input type="date" value={fWeekStart} onChange={(e) => setFWeekStart(e.target.value)} style={{ ...homeInputStyle, width: 140 }} />
          </Field>
          <Field label="EM"><input value={fEm} onChange={(e) => setFEm(e.target.value)} placeholder="e.g. 111.5" style={{ ...homeInputStyle, width: 90 }} /></Field>
          <Field label="Ref Close"><input value={fRef} onChange={(e) => setFRef(e.target.value)} placeholder="optional" style={{ ...homeInputStyle, width: 100 }} /></Field>
          <Field label="Wk High"><input value={fHigh} onChange={(e) => setFHigh(e.target.value)} placeholder="optional" style={{ ...homeInputStyle, width: 100 }} /></Field>
          <Field label="Wk Low"><input value={fLow} onChange={(e) => setFLow(e.target.value)} placeholder="optional" style={{ ...homeInputStyle, width: 100 }} /></Field>
          <Field label="Wk Close"><input value={fClose} onChange={(e) => setFClose(e.target.value)} placeholder="optional" style={{ ...homeInputStyle, width: 100 }} /></Field>
          <button onClick={addWeek} disabled={busy} style={{ ...homeButtonStyle, padding: "8px 16px", opacity: busy ? 0.5 : 1 }}>Save Week</button>
        </div>
        <div style={{ fontSize: 10, color: HOME_THEME.muted, marginTop: 8 }}>
          If you enter Ref Close + High + Low, hit/miss is computed automatically (hit = high ≤ ref+EM and low ≥ ref−EM). Otherwise leave OHLC blank and run “Run Evaluation” once the weekly candle is in.
        </div>
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
