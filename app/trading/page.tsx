"use client";

/**
 * Trading — Journaling Dashboard.
 *
 * Entries live in Postgres (table: trading_journals) behind /api/journal, scoped
 * to the signed-in user. This replaces the old localStorage key
 * "trading_journals", which was per-browser and didn't survive a device change.
 * A one-time migration lifts any surviving localStorage entries into the DB on
 * first load, then clears the key (see migrateLocal()).
 *
 * Chrome is 100% shared-theme: PageShell + Card + HOME_THEME tokens. The only
 * color literals left are the win/loss + chart series encodings (T.green /
 * T.red), which are data encodings, not chrome — and they're sourced from the
 * theme too.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { HOME_THEME as HT, homeInputStyle, homeButtonStyle, homeSecondaryButtonStyle, LIGHT_BLUE } from "@/components/shared/homeTheme";
import { PageShell, Card as ThemeCard } from "@/components/shared/PageCard";
import type { ComponentProps } from "react";

/** Wire shape from /api/journal (snake_case, straight off the row). */
interface JournalRow {
  id: number;
  date: string;        // YYYY-MM-DD
  net_pnl: number;
  trades: number;
  win_rate: number;    // 0-100
  avg_win: number;
  avg_loss: number;
  profit_factor: number;
  commissions: number;
  notes: string | null;
  kind: "manual" | "verified";
}

/** Wire shape from /api/journal/trades — one closed round-trip, derived live
 *  from the persisted fills (symbol, time in/out, price in/out, account). */
interface JournalTrade {
  symbol: string;
  underlying: string;
  asset_type: string;
  direction: "long" | "short";
  open_ts: number;
  close_ts: number;
  date: string;
  qty: number;
  entry: number;
  exit: number;
  fees: number;
  pnl: number;
  account: string;
}

interface AccountStat {
  account: string;
  sessions: number;
  first_date: string;
  last_date: string;
  trades: number;
  net_pnl: number;
  win_rate: number;
  avg_tit_ms: number;
}

const LS_KEY = "trading_journals";          // legacy localStorage key (migrated once)
const LS_MIGRATED = "trading_journals_migrated";

/** ms → "H:MM:SS" for avg time-in-trade. */
const fmtDur = (ms: number) => {
  if (!ms || ms < 0) return "—";
  const s = Math.round(ms / 1000);
  const hh = Math.floor(s / 3600), mm = Math.floor((s % 3600) / 60), ss = s % 60;
  return `${String(hh).padStart(2, "0")}:${String(mm).padStart(2, "0")}:${String(ss).padStart(2, "0")}`;
};

// Data-viz encodings (win/loss cells + chart series). Gain/loss is a strict
// green-or-red convention on this page — NOT sourced from HOME_THEME.green,
// which is actually a pale BLUE (#8ECAE6, shared chrome for other pages) and
// would read as "gain = blue" here. red still comes from the theme since
// HOME_THEME.red is a real red.
const T = { green: "#22C55E", red: HT.red };

// Softer secondary text — a real muted gray, not the theme's flat white, so
// labels/captions read one step back from primary values.
const SOFT = "rgba(255,255,255,0.55)";

/**
 * Page-local flat card. The shared Card carries a faint radial highlight + drop
 * shadow (the "glow"); on this dense dashboard we want a flat frosted surface,
 * so route every card through here: classic variant (no radial) + shadow off.
 */
function Card(props: ComponentProps<typeof ThemeCard>) {
  return <ThemeCard variant="classic" {...props} style={{ boxShadow: "none", ...props.style }} />;
}

const btnStyle = (active = false): React.CSSProperties => ({
  ...(active ? homeButtonStyle : homeSecondaryButtonStyle),
  ...(active ? {} : { color: HT.muted }),
});
const inputStyle: React.CSSProperties = {
  ...homeInputStyle,
  width: "100%",
  colorScheme: "dark",
  accentColor: HT.cyan,
};
const labelStyle: React.CSSProperties = {
  fontSize: 12, fontWeight: 700, color: HT.muted, textTransform: "uppercase",
  letterSpacing: ".08em", display: "block", marginBottom: 4,
};
const cellStyle: React.CSSProperties = { padding: "6px 6px", borderBottom: `1px solid ${HT.border}`, fontSize: 14 };

/** Card/section titles: 16px, accent-colored (cyan) so panels read as titled. */
const titleStyle: React.CSSProperties = {
  fontSize: 17, fontWeight: 700, color: HT.cyan, marginBottom: 10,
};
/** Collapsible section titles — same look, plus the ▶/▼ affordance row. */
const collapseTitleStyle: React.CSSProperties = {
  ...titleStyle, display: "flex", justifyContent: "space-between",
  alignItems: "center", cursor: "pointer",
};
const tableStyle: React.CSSProperties = { width: "100%", fontSize: 14, borderCollapse: "collapse" };

const fmt$ = (v: number) => (v < 0 ? "-" : "") + "$" + Math.abs(v).toFixed(2);
const num = (s: string) => (s.trim() === "" ? 0 : Number(s));

// Day-level only. MAE/MFE are deliberately gone — they're per-trade excursion
// stats and this journal is a day-level record.
const EMPTY_FORM = {
  date: "", netPnl: "", trades: "", winRate: "", avgWin: "", avgLoss: "",
  profitFactor: "", commissions: "", notes: "",
};

/** Preview payload from POST /api/journal/import (commit:false). */
interface ImportPreview {
  broker: string;
  counts: { fills: number; trades: number; days: number };
  days: JournalRow[];
  warnings: string[];
  skipped: number;
}

const BROKER_LABEL: Record<string, string> = {
  tastytrade: "tastytrade", tos: "Thinkorswim / Schwab", ibkr: "Interactive Brokers",
  rithmic: "Rithmic", motivewave: "MotiveWave", tradovate: "Tradovate",
  generic: "Unrecognized format",
};

/** One plotted day. `sub` is the extra context line shown in the tooltip. */
interface Pt { label: string; value: number; sub?: string }

const CH_W = 320, CH_H = 120, CH_PAD = 8;

const emptyChart = (
  <div style={{ height: CH_H, display: "grid", placeItems: "center", color: HT.muted, fontSize: 14 }}>No data yet</div>
);

/**
 * Shared hover tooltip. The SVG scales to the card width, so pointer math is
 * done in PERCENT of the container (not SVG user units) — otherwise the hit
 * index drifts as the card resizes.
 */
function ChartTip({ pt, xPct, fmt }: { pt: Pt; xPct: number; fmt: (v: number) => string }) {
  // Flip the tooltip to the left of the cursor near the right edge so it never
  // clips out of the card.
  const flip = xPct > 62;
  return (
    <div
      style={{
        position: "absolute", top: 4, left: `${xPct}%`,
        transform: flip ? "translateX(-100%) translateX(-10px)" : "translateX(10px)",
        pointerEvents: "none", zIndex: 5,
        background: HT.panelBgStrong ?? "rgba(10,15,20,.95)",
        border: `1px solid ${HT.border}`, borderRadius: 4,
        padding: "6px 9px", whiteSpace: "nowrap",
        boxShadow: "0 4px 14px rgba(0,0,0,.45)",
      }}
    >
      <div style={{ fontSize: 12, color: HT.muted }}>{pt.label}</div>
      <div style={{ fontSize: 14, fontWeight: 700, color: pt.value >= 0 ? T.green : T.red }}>
        {fmt(pt.value)}
      </div>
      {pt.sub && <div style={{ fontSize: 12, color: HT.muted, marginTop: 1 }}>{pt.sub}</div>}
    </div>
  );
}

/** Track the hovered index from a pointer move over the chart box. */
function useHoverIndex(count: number) {
  const [i, setI] = useState<number | null>(null);
  const onMove = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!count) return;
    const r = e.currentTarget.getBoundingClientRect();
    const p = (e.clientX - r.left) / r.width;              // 0..1 across the box
    const idx = Math.round(p * (count - 1));
    setI(Math.min(count - 1, Math.max(0, idx)));
  };
  return { i, onMove, onLeave: () => setI(null) };
}

function MiniLine({ points, color, fmt = fmt$, w = CH_W, h = CH_H }: { points: Pt[]; color: string; fmt?: (v: number) => string; w?: number; h?: number }) {
  const { i, onMove, onLeave } = useHoverIndex(points.length);
  if (points.length < 2) return emptyChart;

  const vals = points.map((p) => p.value);
  const min = Math.min(...vals, 0), max = Math.max(...vals, 0);
  const range = max - min || 1;
  const x = (n: number) => CH_PAD + ((w - 2 * CH_PAD) * n) / (points.length - 1);
  const y = (v: number) => CH_PAD + (h - 2 * CH_PAD) * (1 - (v - min) / range);
  const d = vals.map((v, n) => `${n === 0 ? "M" : "L"}${x(n)},${y(v)}`).join(" ");
  const hoverX = i != null ? (x(i) / w) * 100 : 0;

  return (
    <div style={{ position: "relative" }} onMouseMove={onMove} onMouseLeave={onLeave}>
      <svg viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" style={{ width: "100%", height: h, display: "block", cursor: "crosshair" }}>
        <line x1={CH_PAD} y1={y(0)} x2={w - CH_PAD} y2={y(0)} stroke={HT.border} />
        <path d={d} fill="none" stroke={color} strokeWidth={2} vectorEffect="non-scaling-stroke" />
        {i != null && (
          <>
            <line x1={x(i)} y1={CH_PAD} x2={x(i)} y2={h - CH_PAD} stroke={HT.border} strokeDasharray="3 3" vectorEffect="non-scaling-stroke" />
            <circle cx={x(i)} cy={y(vals[i])} r={3.5} fill={color} stroke={HT.bg} strokeWidth={1.5} vectorEffect="non-scaling-stroke" />
          </>
        )}
      </svg>
      {i != null && <ChartTip pt={points[i]} xPct={hoverX} fmt={fmt} />}
    </div>
  );
}

function MiniBars({ points, fmt = fmt$, w = CH_W, h = CH_H }: { points: Pt[]; fmt?: (v: number) => string; w?: number; h?: number }) {
  const { i, onMove, onLeave } = useHoverIndex(points.length);
  if (!points.length) return emptyChart;

  const vals = points.map((p) => p.value);
  const maxAbs = Math.max(...vals.map(Math.abs), 1);
  const slot = (w - 2 * CH_PAD) / points.length;
  const bw = Math.max(2, slot - 2);
  const zero = h / 2;
  const hoverX = i != null ? ((CH_PAD + i * slot + bw / 2) / w) * 100 : 0;

  return (
    <div style={{ position: "relative" }} onMouseMove={onMove} onMouseLeave={onLeave}>
      <svg viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" style={{ width: "100%", height: h, display: "block", cursor: "crosshair" }}>
        <line x1={CH_PAD} y1={zero} x2={w - CH_PAD} y2={zero} stroke={HT.border} />
        {vals.map((v, n) => {
          const bh = (Math.abs(v) / maxAbs) * (h / 2 - CH_PAD);
          return (
            <rect key={n}
              x={CH_PAD + n * slot} y={v >= 0 ? zero - bh : zero}
              width={bw} height={bh}
              fill={v >= 0 ? T.green : T.red}
              opacity={i == null || i === n ? 0.9 : 0.4} />
          );
        })}
      </svg>
      {/* Value labels above each bar. Rendered as HTML (not SVG <text>) because
          the chart uses preserveAspectRatio="none", which would stretch text. */}
      {vals.map((v, n) => {
        const bh = (Math.abs(v) / maxAbs) * (h / 2 - CH_PAD);
        const xPct = ((CH_PAD + n * slot + bw / 2) / w) * 100;
        const tipPct = ((v >= 0 ? zero - bh : zero + bh) / h) * 100;
        return (
          <div key={n}
            style={{
              position: "absolute", left: `${xPct}%`, top: `${tipPct}%`,
              transform: v >= 0 ? "translate(-50%,-115%)" : "translate(-50%,15%)",
              fontSize: 9, fontWeight: 700, whiteSpace: "nowrap", pointerEvents: "none",
              color: v >= 0 ? T.green : T.red, opacity: i == null || i === n ? 1 : 0.4,
            }}>
            {(v < 0 ? "-" : "") + "$" + Math.abs(Math.round(v))}
          </div>
        );
      })}
      {i != null && <ChartTip pt={points[i]} xPct={hoverX} fmt={fmt} />}
    </div>
  );
}

/** Bar chart with an always-visible category label under each bar (day-of-week,
 * $ bucket, …) instead of hover-only tooltips — matches how these read best. */
function MiniLabeledBars({ data, w = CH_W, h = CH_H, barColor }: {
  data: { label: string; value: number }[]; fmt?: (v: number) => string; w?: number; h?: number;
  barColor?: (v: number, i: number) => string;
}) {
  if (!data.length) return emptyChart;
  const vals = data.map((d) => d.value);
  const maxAbs = Math.max(...vals.map(Math.abs), 1);
  const slot = (w - 2 * CH_PAD) / data.length;
  const bw = Math.max(3, slot - Math.max(4, slot * 0.25));
  const zero = h - CH_PAD - 14; // leave room for the label row
  const color = barColor ?? ((v: number) => (v >= 0 ? T.green : T.red));

  return (
    <div style={{ position: "relative" }}>
      <svg viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" style={{ width: "100%", height: h, display: "block" }}>
        <line x1={CH_PAD} y1={zero} x2={w - CH_PAD} y2={zero} stroke={HT.border} />
        {vals.map((v, n) => {
          const bh = (Math.abs(v) / maxAbs) * (zero - CH_PAD);
          const cx = CH_PAD + n * slot + slot / 2;
          return (
            <rect key={n}
              x={cx - bw / 2} y={v >= 0 ? zero - bh : zero}
              width={bw} height={Math.max(bh, 1)}
              fill={color(v, n)} opacity={0.9} rx={1.5} />
          );
        })}
      </svg>
      {data.map((d, n) => {
        const xPct = ((CH_PAD + n * slot + slot / 2) / w) * 100;
        return (
          <div key={n} style={{
            position: "absolute", left: `${xPct}%`, bottom: 0,
            transform: "translateX(-50%)", fontSize: 10, color: HT.muted, whiteSpace: "nowrap",
          }}>
            {d.label}
          </div>
        );
      })}
    </div>
  );
}

export default function TradingPage() {
  const [journals, setJournals] = useState<JournalRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState("");
  const [showModal, setShowModal] = useState(false);
  const [editId, setEditId] = useState<number | null>(null);
  const [modalErr, setModalErr] = useState("");
  const [calMonth, setCalMonth] = useState(() => { const d = new Date(); return { y: d.getFullYear(), m: d.getMonth() }; });
  const [selectedDay, setSelectedDay] = useState<string | null>(null);
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});

  // CSV import
  const fileRef = useRef<HTMLInputElement>(null);
  const [csvText, setCsvText] = useState("");
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [importErr, setImportErr] = useState("");
  const [importing, setImporting] = useState(false);

  // Modal fields (strings — coerced on save).
  const [f, setF] = useState(EMPTY_FORM);

  // Trade-level detail (symbol, time in/out, price in/out, account) — derived
  // live from the fills a CSV import already persisted. Day-level KPIs above
  // still come from `journals`; this powers the by-account panel and the
  // long/short + time-in-trade stats that only exist at the trade level.
  const [trades, setTrades] = useState<JournalTrade[]>([]);
  const [accounts, setAccounts] = useState<AccountStat[]>([]);
  const [selectedAccount, setSelectedAccount] = useState<string | null>(null);
  // Which chart card is popped out into the bigger modal view, if any.
  const [expandedChart, setExpandedChart] = useState<string | null>(null);

  // ── Load from the API ────────────────────────────────────────────────────────
  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/journal", { cache: "no-store" });
      if (res.status === 401) { setErr("Sign in to use the journal."); setJournals([]); return; }
      const j = await res.json();
      setJournals(Array.isArray(j.rows) ? j.rows : []);
      setErr("");
    } catch (e) {
      setErr(String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  const loadTrades = useCallback(async () => {
    try {
      const res = await fetch("/api/journal/trades", { cache: "no-store" });
      if (res.status === 401) return;
      const j = await res.json();
      setTrades(Array.isArray(j.trades) ? j.trades : []);
      setAccounts(Array.isArray(j.accounts) ? j.accounts : []);
    } catch { /* trade-level detail is supplementary; day KPIs still work without it */ }
  }, []);

  /**
   * One-time lift of legacy localStorage entries into Postgres. Runs before the
   * first load; the key is cleared afterward so it can't double-import. Any
   * entry that fails to POST is left behind by design (we only clear on a clean
   * run) — better a retry next visit than a silent loss.
   */
  const migrateLocal = useCallback(async () => {
    try {
      if (localStorage.getItem(LS_MIGRATED)) return;
      const raw = localStorage.getItem(LS_KEY);
      if (!raw) { localStorage.setItem(LS_MIGRATED, "1"); return; }
      const old = JSON.parse(raw);
      if (!Array.isArray(old) || !old.length) { localStorage.setItem(LS_MIGRATED, "1"); return; }
      let ok = 0;
      for (const o of old) {
        const res = await fetch("/api/journal", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ...o, kind: o.kind === "verified" ? "verified" : "manual" }),
        });
        if (res.ok) ok++;
      }
      if (ok === old.length) {
        localStorage.removeItem(LS_KEY);
        localStorage.setItem(LS_MIGRATED, "1");
      }
    } catch { /* migration is best-effort; never block the page */ }
  }, []);

  useEffect(() => {
    (async () => { await migrateLocal(); await load(); await loadTrades(); })();
  }, [migrateLocal, load, loadTrades]);

  // Every entry counts — there's no manual/verified split any more (imported and
  // hand-typed days are the same thing to the stats). The only filter left is a
  // click on a calendar day.
  const visible = useMemo(() => {
    const v = selectedDay ? journals.filter((j) => j.date === selectedDay) : journals;
    return [...v].sort((a, b) => a.date.localeCompare(b.date) || a.id - b.id);
  }, [journals, selectedDay]);

  // ── KPIs ─────────────────────────────────────────────────────────────────────
  const k = useMemo(() => {
    const wins = visible.filter((j) => j.net_pnl > 0);
    const losses = visible.filter((j) => j.net_pnl < 0);
    const totalPnl = visible.reduce((s, j) => s + j.net_pnl, 0);
    const totalTrades = visible.reduce((s, j) => s + j.trades, 0);
    // Trade-level win/loss stats, aggregated from each day's stored per-trade
    // averages (weighted by that day's win/loss counts). Day-level net_pnl can't
    // surface avg loss or profit factor when every journal DAY is green while
    // individual trades still lost — exactly the single-import all-win-day case.
    // Trade-level streaks are reconstructed from each day's win/loss COUNTS in
    // date order (wins-first within a day — the journal stores day aggregates,
    // not per-fill order, so intra-day sequence is assumed).
    let grossWin = 0, grossLoss = 0, winCt = 0, lossCt = 0;
    let bestTW = 0, bestTL = 0, curTW = 0, curTL = 0;
    for (const j of visible) {
      const lc = Math.round(j.trades * (1 - j.win_rate / 100));
      const wc = j.trades - lc;
      winCt += wc; lossCt += lc;
      grossWin += (j.avg_win || 0) * wc;
      grossLoss += Math.abs(j.avg_loss || 0) * lc;
      for (let n = 0; n < wc; n++) { curTW++; curTL = 0; bestTW = Math.max(bestTW, curTW); }
      for (let n = 0; n < lc; n++) { curTL++; curTW = 0; bestTL = Math.max(bestTL, curTL); }
    }
    const avgWin = winCt ? grossWin / winCt : 0;
    const avgLoss = lossCt ? -grossLoss / lossCt : 0;
    const tradeWinPct = winCt + lossCt > 0 ? (winCt / (winCt + lossCt)) * 100 : null;
    // Day streaks
    let bestW = 0, bestL = 0, curW = 0, curL = 0;
    for (const j of visible) {
      if (j.net_pnl > 0) { curW++; curL = 0; } else if (j.net_pnl < 0) { curL++; curW = 0; } else { curW = 0; curL = 0; }
      bestW = Math.max(bestW, curW); bestL = Math.max(bestL, curL);
    }
    // Cumulative + drawdown
    const cum: number[] = [];
    let run = 0;
    for (const j of visible) { run += j.net_pnl; cum.push(run); }
    let peak = -Infinity, maxDD = 0;
    const dd: number[] = cum.map((v) => {
      peak = Math.max(peak, v);
      const d = v - peak;
      maxDD = Math.min(maxDD, d);
      return d;
    });
    const winPct = wins.length + losses.length > 0 ? (wins.length / (wins.length + losses.length)) * 100 : null;

    // Best/worst single day — surfaced separately from the avg win/loss tiles
    // (avg is per-trade, this is per-session).
    const maxGainDay = visible.reduce<JournalRow | null>((best, j) => (!best || j.net_pnl > best.net_pnl ? j : best), null);
    const maxLossDay = visible.reduce<JournalRow | null>((worst, j) => (!worst || j.net_pnl < worst.net_pnl ? j : worst), null);
    const sessions = visible.length;
    const avgTradesPerSession = sessions ? totalTrades / sessions : 0;
    // Per-trade expectancy: $ per trade if the historical win rate/avg win/avg
    // loss holds. Running cumulative version below is what the "Expectancy"
    // chart plots — it should settle toward this number as sessions accumulate.
    const expectancy = winCt + lossCt > 0
      ? (winCt / (winCt + lossCt)) * avgWin + (lossCt / (winCt + lossCt)) * avgLoss
      : null;

    // Cumulative win-rate trend, day by day (what "Win/Loss" plots).
    let rWin = 0, rLoss = 0;
    const winRateSeries = visible.map((j) => {
      if (j.net_pnl > 0) rWin++; else if (j.net_pnl < 0) rLoss++;
      const decided = rWin + rLoss;
      return { label: j.date, value: decided ? (rWin / decided) * 100 : 0, sub: `${rWin}W - ${rLoss}L so far` };
    });

    // Running (cumulative) expectancy per trade, day by day.
    let cGrossWin = 0, cGrossLoss = 0, cWinCt = 0, cLossCt = 0;
    const expectancySeries = visible.map((j) => {
      const lc = Math.round(j.trades * (1 - j.win_rate / 100));
      const wc = j.trades - lc;
      cWinCt += wc; cLossCt += lc;
      cGrossWin += (j.avg_win || 0) * wc;
      cGrossLoss += Math.abs(j.avg_loss || 0) * lc;
      const n = cWinCt + cLossCt;
      const value = n ? (cGrossWin - cGrossLoss) / n : 0;
      return { label: j.date, value, sub: `running avg over ${n} trades` };
    });

    // P&L distribution — day net_pnl bucketed into fixed-width $ ranges.
    const pnls = visible.map((j) => j.net_pnl);
    const distBuckets: { label: string; value: number; positive: boolean }[] = [];
    if (pnls.length) {
      const maxAbs = Math.max(...pnls.map(Math.abs), 1);
      const bucketW = Math.max(25, Math.ceil(maxAbs / 4 / 25) * 25);
      const counts = new Map<number, number>();
      for (const v of pnls) {
        const idx = Math.trunc(v / bucketW) + (v < 0 && v % bucketW !== 0 ? -1 : 0);
        counts.set(idx, (counts.get(idx) ?? 0) + 1);
      }
      const idxs = [...counts.keys()].sort((a, b) => a - b);
      for (const idx of idxs) {
        const lo = idx * bucketW;
        distBuckets.push({ label: `$${lo}`, value: counts.get(idx)!, positive: lo >= 0 });
      }
    }

    // Median P&L by day of week (Sun..Sat), matching the calendar's own week.
    const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
    const byWeekday: number[][] = Array.from({ length: 7 }, () => []);
    for (const j of visible) byWeekday[new Date(`${j.date}T00:00:00`).getDay()].push(j.net_pnl);
    const median = (arr: number[]) => {
      if (!arr.length) return 0;
      const s = [...arr].sort((a, b) => a - b);
      const mid = Math.floor(s.length / 2);
      return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
    };
    const weekdaySeries = WEEKDAYS.map((label, i) => ({ label, value: median(byWeekday[i]) }));

    return {
      wins: wins.length, losses: losses.length, winPct, totalPnl, totalTrades,
      avgWin, avgLoss, bestW, bestL, bestTW, bestTL, winCt, lossCt, tradeWinPct, cum, dd, maxDD,
      pnlPerTrade: totalTrades > 0 ? totalPnl / totalTrades : null,
      maxGainDay, maxLossDay, sessions, avgTradesPerSession, expectancy, distBuckets, weekdaySeries,
      // Profit factor across the whole filtered set: gross wins / gross losses.
      // This replaced the old "capture efficiency" score, which was defined
      // against avg MFE — a per-trade excursion stat the journal no longer keeps.
      profitFactor: grossLoss > 0 ? grossWin / grossLoss : null,
      // Hoverable series — each point carries its date + a context line so the
      // tooltip can say WHY the number is what it is, not just what it is.
      pfSeries: visible.map((j) => ({
        label: j.date,
        value: j.profit_factor,
        sub: `${j.trades} trades · ${j.win_rate.toFixed(0)}% win`,
      })),
      cumSeries: visible.map((j, i) => ({
        label: j.date,
        value: cum[i],
        sub: `day ${j.net_pnl >= 0 ? "+" : ""}${fmt$(j.net_pnl)}`,
      })),
      ddSeries: visible.map((j, i) => ({
        label: j.date,
        value: dd[i],
        sub: dd[i] < 0 ? `below peak of ${fmt$(cum[i] - dd[i])}` : "at equity high",
      })),
      pnlSeries: visible.map((j) => ({
        label: j.date,
        value: j.net_pnl,
        sub: `${j.trades} trades · ${j.win_rate.toFixed(0)}% win · fees ${fmt$(j.commissions)}`,
      })),
      winRateSeries,
      expectancySeries,
    };
  }, [visible]);

  // ── Trade-level: long/short + time-in-trade + by-account ────────────────────
  // Filtered by the same day-click as the day KPIs, plus an optional account
  // filter from the By Account panel.
  const visibleTrades = useMemo(() => {
    let v = trades;
    if (selectedDay) v = v.filter((t) => t.date === selectedDay);
    if (selectedAccount) v = v.filter((t) => (t.account || "Unlabeled") === selectedAccount);
    return v;
  }, [trades, selectedDay, selectedAccount]);

  const tradeStats = useMemo(() => {
    const long = visibleTrades.filter((t) => t.direction === "long");
    const short = visibleTrades.filter((t) => t.direction === "short");
    const sum = (arr: JournalTrade[]) => arr.reduce((s, t) => s + t.pnl, 0);
    const avgTiT = (arr: JournalTrade[]) => arr.length
      ? arr.reduce((s, t) => s + (t.close_ts - t.open_ts), 0) / arr.length : 0;
    return {
      longCt: long.length, shortCt: short.length,
      longPnl: sum(long), shortPnl: sum(short),
      avgLongTiT: avgTiT(long), avgShortTiT: avgTiT(short),
    };
  }, [visibleTrades]);

  // ── Calendar ─────────────────────────────────────────────────────────────────
  const calCells = useMemo(() => {
    const first = new Date(calMonth.y, calMonth.m, 1);
    const days = new Date(calMonth.y, calMonth.m + 1, 0).getDate();
    const lead = first.getDay();
    const cells: ({ day: number; date: string; pnl: number | null } | null)[] = Array(lead).fill(null);
    for (let d = 1; d <= days; d++) {
      const date = `${calMonth.y}-${String(calMonth.m + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
      const dayJ = journals.filter((j) => j.date === date);
      cells.push({ day: d, date, pnl: dayJ.length ? dayJ.reduce((s, j) => s + j.net_pnl, 0) : null });
    }
    while (cells.length % 7) cells.push(null);
    return cells;
  }, [calMonth, journals]);

  const monthLabel = new Date(calMonth.y, calMonth.m, 1).toLocaleDateString("en-US", { month: "long", year: "numeric" });

  // ── Actions ──────────────────────────────────────────────────────────────────
  const openNew = () => { setEditId(null); setF(EMPTY_FORM); setModalErr(""); setShowModal(true); };

  const openEdit = (j: JournalRow) => {
    setEditId(j.id);
    setF({
      date: j.date,
      netPnl: String(j.net_pnl), trades: String(j.trades), winRate: String(j.win_rate),
      avgWin: String(j.avg_win), avgLoss: String(j.avg_loss), profitFactor: String(j.profit_factor),
      commissions: String(j.commissions),
      notes: j.notes ?? "",
    });
    setModalErr("");
    setShowModal(true);
  };

  /** Create (POST) or edit (PATCH) — the DB row is the source of truth after. */
  const saveJournal = async () => {
    if (!f.date) { setModalErr("Trading date is required."); return; }
    if (f.netPnl.trim() === "" || !Number.isFinite(num(f.netPnl))) {
      setModalErr("Net P&L is required and must be a number."); return;
    }
    setSaving(true);
    try {
      const payload = {
        ...(editId != null ? { id: editId } : {}),
        date: f.date, netPnl: num(f.netPnl), trades: num(f.trades), winRate: num(f.winRate),
        avgWin: num(f.avgWin), avgLoss: num(f.avgLoss), profitFactor: num(f.profitFactor),
        commissions: num(f.commissions),
        notes: f.notes, kind: "manual",
      };
      const res = await fetch("/api/journal", {
        method: editId != null ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const j = await res.json();
      if (!res.ok) { setModalErr(j.error || "Save failed."); return; }
      const row: JournalRow = j.row;
      setJournals((all) => (editId != null ? all.map((x) => (x.id === row.id ? row : x)) : [...all, row]));
      setF(EMPTY_FORM);
      setEditId(null);
      setModalErr("");
      setShowModal(false);
    } catch (e) {
      setModalErr(String(e));
    } finally {
      setSaving(false);
    }
  };

  const removeJournal = async (id: number) => {
    const prev = journals;
    setJournals((all) => all.filter((x) => x.id !== id));   // optimistic
    const res = await fetch(`/api/journal?id=${id}`, { method: "DELETE" });
    if (!res.ok) { setJournals(prev); setErr("Delete failed."); }
  };

  // ── CSV import ───────────────────────────────────────────────────────────────
  // Two-step by design: the file is parsed server-side and shown back as day
  // rows BEFORE anything is written. Nothing lands in the DB until "Import".

  const onFile = async (file: File | undefined) => {
    if (!file) return;
    setImportErr("");
    setPreview(null);
    const text = await file.text();
    setCsvText(text);
    setImporting(true);
    try {
      const res = await fetch("/api/journal/import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ csv: text, commit: false }),
      });
      const j = await res.json();
      if (!res.ok) { setImportErr(j.error || "Could not read that file."); return; }
      setPreview(j as ImportPreview);
    } catch (e) {
      setImportErr(String(e));
    } finally {
      setImporting(false);
      if (fileRef.current) fileRef.current.value = "";   // allow re-picking the same file
    }
  };

  const commitImport = async () => {
    if (!csvText) return;
    setImporting(true);
    try {
      const res = await fetch("/api/journal/import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ csv: csvText, commit: true }),
      });
      const j = await res.json();
      if (!res.ok) { setImportErr(j.error || "Import failed."); return; }
      setPreview(null);
      setCsvText("");
      await load();                                       // pull the upserted day rows
      await loadTrades();                                 // refresh per-trade + by-account detail
    } catch (e) {
      setImportErr(String(e));
    } finally {
      setImporting(false);
    }
  };

  const exportCSV = () => {
    const header = "date,netPnl,trades,winRate,avgWin,avgLoss,profitFactor,commissions,notes,kind";
    const rows = journals.map((j) =>
      [j.date, j.net_pnl, j.trades, j.win_rate, j.avg_win, j.avg_loss, j.profit_factor,
       j.commissions, JSON.stringify(j.notes ?? ""), j.kind].join(","));
    const blob = new Blob([[header, ...rows].join("\n")], { type: "text/csv" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `trading-journals-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  // ── Chart cards — each one can "pop out" into a bigger modal view ──────────
  // One definition per chart, reused for both the inline mini card and the
  // expanded modal (same series, just a bigger w/h passed to the renderer).
  const chartDefs: Record<string, { title: string; accent: string; value: React.ReactNode; render: (w: number, h: number) => React.ReactNode }> = {
    pf: {
      title: "Profit Factor", accent: HT.cyan,
      value: <span style={{ color: HT.text }}>{k.profitFactor != null ? k.profitFactor.toFixed(2) : "—"}</span>,
      render: (w, h) => <MiniLine points={k.pfSeries} color={HT.cyan} fmt={(v) => (v ? v.toFixed(2) : "—")} w={w} h={h} />,
    },
    cum: {
      title: "Cumulative PnL", accent: T.green,
      value: <span style={{ color: k.totalPnl >= 0 ? T.green : T.red }}>{visible.length ? fmt$(k.totalPnl) : "—"}</span>,
      render: (w, h) => <MiniLine points={k.cumSeries} color={T.green} w={w} h={h} />,
    },
    dd: {
      title: "Drawdown (Max)", accent: T.red,
      value: <span style={{ color: T.red }}>{visible.length ? fmt$(k.maxDD) : "—"}</span>,
      render: (w, h) => <MiniLine points={k.ddSeries} color={T.red} w={w} h={h} />,
    },
    pnl: {
      title: "PnL Per Day", accent: HT.orange, value: null,
      render: (w, h) => <MiniBars points={k.pnlSeries} w={w} h={h} />,
    },
    winloss: {
      title: "Win/Loss", accent: T.green,
      value: <span style={{ color: HT.text }}>{k.winPct != null ? `${k.winPct.toFixed(0)}%` : "—"}</span>,
      render: (w, h) => <MiniLine points={k.winRateSeries} color={T.green} fmt={(v) => `${v.toFixed(0)}%`} w={w} h={h} />,
    },
    expectancy: {
      title: "Expectancy", accent: HT.purple,
      value: <span style={{ color: k.expectancy != null ? (k.expectancy >= 0 ? T.green : T.red) : HT.text }}>{k.expectancy != null ? fmt$(k.expectancy) : "—"}</span>,
      render: (w, h) => <MiniLine points={k.expectancySeries} color={HT.purple} w={w} h={h} />,
    },
    dist: {
      title: "P&L Distribution", accent: HT.cyan, value: null,
      render: (w, h) => (
        <MiniLabeledBars
          w={w} h={h}
          data={k.distBuckets.map((b) => ({ label: b.label, value: b.value }))}
          barColor={(_v, i) => (k.distBuckets[i]?.positive ? T.green : T.red)}
        />
      ),
    },
    weekday: {
      title: "Median PnL vs Day of Week", accent: T.green, value: null,
      render: (w, h) => <MiniLabeledBars w={w} h={h} data={k.weekdaySeries} />,
    },
  };
  const chartOrder = ["pf", "cum", "dd", "pnl", "winloss", "expectancy", "dist", "weekday"];

  const chartCard = (key: string, big = false) => {
    const def = chartDefs[key];
    const w = big ? 720 : CH_W, h = big ? 340 : CH_H;
    return (
      <Card key={key} padding={16} style={big ? { width: "100%" } : undefined}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <div style={{ ...titleStyle, color: def.accent, marginBottom: 0 }}>
            {def.title} {def.value}
          </div>
          {!big && (
            <button
              onClick={() => setExpandedChart(key)}
              title="Expand"
              style={{ background: "none", border: "none", color: HT.muted, cursor: "pointer", fontSize: 15, padding: "2px 4px", lineHeight: 1 }}
            >⤢</button>
          )}
        </div>
        <div style={{ marginTop: 10 }}>{def.render(w, h)}</div>
      </Card>
    );
  };

  const kpiCard = (title: string, val: React.ReactNode, sub: React.ReactNode, extra?: React.ReactNode, accent: string = HT.cyan) => (
    <Card padding={16} style={{ display: "flex", flexDirection: "column", minHeight: 140 }}>
      <div style={{ fontSize: 13, fontWeight: 700, color: accent, marginBottom: 6, letterSpacing: ".04em", textTransform: "uppercase" }}>{title}</div>
      <div style={{ fontSize: 24, fontWeight: 700, color: HT.text }}>{val}</div>
      <div style={{ fontSize: 12, color: SOFT, marginTop: 2 }}>{sub}</div>
      {extra && <div style={{ marginTop: "auto", paddingTop: 8 }}>{extra}</div>}
    </Card>
  );

  return (
    <PageShell className="journal-root no-card-lift">
      {/* Header */}
      <Card padding="14px 20px" style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <div style={{ fontSize: 17, fontWeight: 700, color: HT.cyan }}>Journaling Dashboard</div>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          {err && <span style={{ fontSize: 14, color: T.red }}>{err}</span>}
          <span style={{ fontSize: 14, color: HT.muted }}>
            {loading ? "Loading…" : `${journals.length} saved`}
          </span>
        </div>
      </Card>

      <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
        {/* Toolbar */}
        <div className="journal-toolbar" style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            {selectedDay && (
              <button style={btnStyle()} onClick={() => setSelectedDay(null)}>Day: {selectedDay} ✕</button>
            )}
            {selectedAccount && (
              <button style={btnStyle()} onClick={() => setSelectedAccount(null)}>Account: {selectedAccount} ✕</button>
            )}
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <input
              ref={fileRef} type="file" accept=".csv,text/csv" style={{ display: "none" }}
              onChange={(e) => onFile(e.target.files?.[0])}
            />
            <button style={btnStyle()} onClick={() => fileRef.current?.click()} disabled={importing}>
              {importing ? "Reading…" : "Import Broker CSV"}
            </button>
            <button style={btnStyle()} onClick={exportCSV}>Export CSV</button>
            <button style={btnStyle(true)} onClick={openNew}>+ New Journal</button>
          </div>
        </div>

        {importErr && (
          <Card padding={12} style={{ fontSize: 14, color: T.red }}>{importErr}</Card>
        )}

        {/* KPI strip */}
            <div className="journal-kpis" style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(170px, 1fr))", gap: 12 }}>
              {kpiCard("Day Win %",
                k.winPct != null ? `${k.winPct.toFixed(0)}%` : "—",
                <>
                  {`${k.wins}W - ${k.losses}L`}
                  <div style={{ marginTop: 2 }}>
                    Trade win <span style={{ color: HT.cyan, fontWeight: 700 }}>{k.tradeWinPct != null ? `${k.tradeWinPct.toFixed(0)}%` : "—"}</span>
                    {" "}<span style={{ color: SOFT }}>({k.winCt}/{k.winCt + k.lossCt})</span>
                  </div>
                </>,
                <div style={{ height: 6, background: HT.border, borderRadius: 3, overflow: "hidden", display: "flex" }}>
                  <div style={{ width: `${k.winPct ?? 0}%`, background: T.green }} />
                  <div style={{ width: `${k.winPct != null ? 100 - k.winPct : 0}%`, background: T.red }} />
                </div>, HT.green)}
              {kpiCard("Avg Win / Loss",
                k.avgLoss !== 0 ? Math.abs(k.avgWin / k.avgLoss).toFixed(2) : "—",
                "Avg Absolute Trade",
                <div style={{ fontSize: 14 }}>
                  <div style={{ color: T.green }}>W {k.avgWin ? fmt$(k.avgWin) : "—"}</div>
                  <div style={{ color: T.red }}>L {k.avgLoss ? fmt$(k.avgLoss) : "—"}</div>
                </div>, HT.orange)}
              {kpiCard("Net PnL",
                <span style={{ color: k.totalPnl >= 0 ? T.green : T.red }}>{visible.length ? fmt$(k.totalPnl) : "—"}</span>,
                "Total Net PnL", undefined, LIGHT_BLUE)}
              {kpiCard("Max Streaks", k.bestW || "—", "Best win streak (days)",
                <div style={{ fontSize: 13, color: SOFT, lineHeight: 1.5 }}>
                  <div>Days <span style={{ color: T.green }}>{k.bestW}W</span> · <span style={{ color: T.red }}>{k.bestL}L</span></div>
                  <div>Trades <span style={{ color: T.green }}>{k.bestTW}W</span> · <span style={{ color: T.red }}>{k.bestTL}L</span></div>
                </div>, HT.purple)}
              {kpiCard("Per Trade",
                k.pnlPerTrade != null ? fmt$(k.pnlPerTrade) : "—",
                "Net PnL / trade",
                <div style={{ fontSize: 14, color: SOFT }}>Total Trades <span style={{ color: HT.text }}>{k.totalTrades}</span></div>, HT.cyan)}
              {kpiCard("Sessions",
                k.sessions || "—",
                `Avg ${k.avgTradesPerSession ? k.avgTradesPerSession.toFixed(1) : "0"} trades/session`,
                <div style={{ fontSize: 13, color: SOFT }}>
                  Expectancy{" "}
                  <span style={{ color: k.expectancy != null ? (k.expectancy >= 0 ? T.green : T.red) : HT.text, fontWeight: 700 }}>
                    {k.expectancy != null ? fmt$(k.expectancy) : "—"}
                  </span>
                </div>, HT.cyan)}
              {kpiCard("Max Gain / Loss",
                <span>
                  <span style={{ color: T.green }}>{k.maxGainDay ? fmt$(k.maxGainDay.net_pnl) : "—"}</span>
                  {" / "}
                  <span style={{ color: T.red }}>{k.maxLossDay ? fmt$(k.maxLossDay.net_pnl) : "—"}</span>
                </span>,
                "Best / worst single session",
                <div style={{ fontSize: 12, color: SOFT }}>
                  {k.maxGainDay ? k.maxGainDay.date : "—"} · {k.maxLossDay ? k.maxLossDay.date : "—"}
                </div>, HT.orange)}
              {kpiCard("Long / Short",
                <span>
                  <span style={{ color: HT.text }}>{tradeStats.longCt}</span>
                  {" / "}
                  <span style={{ color: HT.text }}>{tradeStats.shortCt}</span>
                </span>,
                "Trades by direction",
                <div style={{ fontSize: 13, lineHeight: 1.5 }}>
                  <div>Long PnL <span style={{ color: tradeStats.longPnl >= 0 ? T.green : T.red }}>{tradeStats.longCt ? fmt$(tradeStats.longPnl) : "—"}</span></div>
                  <div>Short PnL <span style={{ color: tradeStats.shortPnl >= 0 ? T.green : T.red }}>{tradeStats.shortCt ? fmt$(tradeStats.shortPnl) : "—"}</span></div>
                </div>, HT.purple)}
              {kpiCard("Avg Time in Trade",
                tradeStats.longCt || tradeStats.shortCt
                  ? fmtDur((tradeStats.avgLongTiT * tradeStats.longCt + tradeStats.avgShortTiT * tradeStats.shortCt) / (tradeStats.longCt + tradeStats.shortCt))
                  : "—",
                "Entry → exit, HH:MM:SS",
                <div style={{ fontSize: 13, color: SOFT }}>
                  Long <span style={{ color: HT.text }}>{tradeStats.longCt ? fmtDur(tradeStats.avgLongTiT) : "—"}</span>
                  {" · "}Short <span style={{ color: HT.text }}>{tradeStats.shortCt ? fmtDur(tradeStats.avgShortTiT) : "—"}</span>
                </div>, HT.green)}
            </div>

            {/* Charts strip — click ⤢ on any card to pop it out bigger */}
            <div className="journal-charts" style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))", gap: 12 }}>
              {chartOrder.map((key) => chartCard(key))}
            </div>

            {/* Tables */}
            <div className="journal-tables" style={{ display: "grid", gridTemplateColumns: "1fr 1fr 2fr", gap: 12 }}>
              <Card padding={16}>
                <div
                  onClick={() => setCollapsed((c) => ({ ...c, accounts: !c.accounts }))}
                  style={{ ...collapseTitleStyle, color: HT.cyan }}
                >
                  <span>By Account{selectedAccount ? ` — ${selectedAccount} ✕` : ""}</span><span>{collapsed.accounts ? "▶" : "▼"}</span>
                </div>
                {!collapsed.accounts && (
                  accounts.length ? (
                    <table style={tableStyle}>
                      <thead>
                        <tr>
                          {["Account", "Sessions", "Trades", "Net P&L", "Win %"].map((h) => (
                            <th key={h} style={{ textAlign: h === "Account" ? "left" : "right", fontSize: 12, color: HT.muted, textTransform: "uppercase", padding: "4px 6px", borderBottom: `1px solid ${HT.border}` }}>{h}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {accounts.map((a) => {
                          const label = a.account || "Unlabeled";
                          const active = selectedAccount === label;
                          return (
                            <tr
                              key={label}
                              onClick={() => setSelectedAccount(active ? null : label)}
                              style={{ cursor: "pointer", background: active ? `${HT.cyan}14` : "transparent" }}
                            >
                              <td style={{ ...cellStyle, color: active ? HT.cyan : HT.text, fontWeight: active ? 700 : 400 }}>{label}</td>
                              <td style={{ ...cellStyle, color: HT.text, textAlign: "right" }}>{a.sessions}</td>
                              <td style={{ ...cellStyle, color: HT.text, textAlign: "right" }}>{a.trades}</td>
                              <td style={{ ...cellStyle, color: a.net_pnl >= 0 ? T.green : T.red, textAlign: "right", fontWeight: 700 }}>{fmt$(a.net_pnl)}</td>
                              <td style={{ ...cellStyle, color: HT.text, textAlign: "right" }}>{a.win_rate.toFixed(0)}%</td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  ) : (
                    <div style={{ padding: 12, color: HT.muted, fontSize: 13 }}>
                      No account column found on the imported CSV yet — every trade is grouped as one account.
                    </div>
                  )
                )}
              </Card>

              <Card padding={16}>
                <div
                  onClick={() => setCollapsed((c) => ({ ...c, targets: !c.targets }))}
                  style={{ ...collapseTitleStyle, color: HT.orange }}
                >
                  <span>Session vs Targets</span><span>{collapsed.targets ? "▶" : "▼"}</span>
                </div>
                {!collapsed.targets && (
                  <table style={tableStyle}>
                    <tbody>
                      {[
                        ["Avg Win", k.avgWin ? fmt$(k.avgWin) : "—"],
                        ["Avg Loss", k.avgLoss ? fmt$(k.avgLoss) : "—"],
                        ["Profit Factor", k.profitFactor != null ? k.profitFactor.toFixed(2) : "—"],
                        ["Commissions", visible.length ? fmt$(visible.reduce((s, j) => s + j.commissions, 0)) : "—"],
                        ["Win Ratio", k.winPct != null ? `${k.winPct.toFixed(1)}%` : "—"],
                      ].map(([l, v], i, arr) => (
                        <tr key={l as string}>
                          <td style={{ color: HT.muted, padding: "7px 0", borderBottom: i < arr.length - 1 ? `1px solid ${HT.border}` : "none" }}>{l}</td>
                          <td style={{ textAlign: "right", color: HT.text, borderBottom: i < arr.length - 1 ? `1px solid ${HT.border}` : "none" }}>{v}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </Card>

              <Card padding={16}>
                <div
                  onClick={() => setCollapsed((c) => ({ ...c, log: !c.log }))}
                  style={{ ...collapseTitleStyle, color: HT.purple }}
                >
                  <span>Journal Log ({visible.length} entries)</span><span>{collapsed.log ? "▶" : "▼"}</span>
                </div>
                {!collapsed.log && (
                  <div style={{ maxHeight: 280, overflowY: "auto" }}>
                    <table style={tableStyle}>
                      <thead>
                        <tr>
                          {["Date", "Net P&L", "Cum P&L", "Trades", "Win %", "Result", ""].map((h) => (
                            <th key={h} style={{ textAlign: "left", fontSize: 12, color: HT.muted, textTransform: "uppercase", padding: "4px 6px", borderBottom: `1px solid ${HT.border}` }}>{h}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {visible.map((j, i) => (
                          <tr key={j.id}>
                            <td style={{ ...cellStyle, color: HT.text }}>{j.date}</td>
                            <td style={{ ...cellStyle, color: j.net_pnl >= 0 ? T.green : T.red }}>{fmt$(j.net_pnl)}</td>
                            <td style={{ ...cellStyle, color: k.cum[i] >= 0 ? T.green : T.red }}>{fmt$(k.cum[i])}</td>
                            <td style={{ ...cellStyle, color: HT.text }}>{j.trades}</td>
                            <td style={{ ...cellStyle, color: HT.text }}>{j.win_rate ? `${j.win_rate}%` : "—"}</td>
                            <td style={{ ...cellStyle, color: j.net_pnl >= 0 ? T.green : T.red, fontWeight: 700 }}>
                              {j.net_pnl >= 0 ? "WIN" : "LOSS"}
                            </td>
                            <td style={{ ...cellStyle, textAlign: "right", whiteSpace: "nowrap" }}>
                              <button style={{ ...btnStyle(), padding: "3px 9px", fontSize: 12, marginRight: 4 }}
                                onClick={() => openEdit(j)}>Edit</button>
                              <button style={{ ...btnStyle(), padding: "3px 9px", fontSize: 12 }}
                                onClick={() => removeJournal(j.id)}>✕</button>
                            </td>
                          </tr>
                        ))}
                        {!visible.length && (
                          <tr><td colSpan={7} style={{ padding: 16, color: HT.muted, textAlign: "center", fontSize: 14 }}>
                            {loading ? "Loading…" : "No journal entries yet — click + New Journal."}
                          </td></tr>
                        )}
                      </tbody>
                    </table>
                  </div>
                )}
              </Card>
            </div>

            {/* Trade-level detail — symbol, time in/out, price in/out, direction,
                account. Populated from the fills a CSV import already saved. */}
            <Card padding={16}>
              <div
                onClick={() => setCollapsed((c) => ({ ...c, trades: !c.trades }))}
                style={{ ...collapseTitleStyle, color: HT.cyan }}
              >
                <span>Trades ({visibleTrades.length})</span><span>{collapsed.trades ? "▶" : "▼"}</span>
              </div>
              {!collapsed.trades && (
                visibleTrades.length ? (
                  <div style={{ maxHeight: 320, overflowY: "auto" }}>
                    <table style={tableStyle}>
                      <thead>
                        <tr>
                          {["Date", "Symbol", "Side", "Account", "Time In", "Time Out", "Price In", "Price Out", "Qty", "P&L"].map((h) => (
                            <th key={h} style={{ textAlign: "left", fontSize: 12, color: HT.muted, textTransform: "uppercase", padding: "4px 6px", borderBottom: `1px solid ${HT.border}` }}>{h}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {[...visibleTrades].sort((a, b) => b.close_ts - a.close_ts).slice(0, 300).map((t, i) => (
                          <tr key={`${t.symbol}-${t.close_ts}-${i}`}>
                            <td style={{ ...cellStyle, color: HT.text }}>{t.date}</td>
                            <td style={{ ...cellStyle, color: HT.text }}>{t.symbol}</td>
                            <td style={{ ...cellStyle, color: t.direction === "long" ? T.green : T.red }}>{t.direction === "long" ? "Long" : "Short"}</td>
                            <td style={{ ...cellStyle, color: HT.muted }}>{t.account || "—"}</td>
                            <td style={{ ...cellStyle, color: HT.muted, whiteSpace: "nowrap" }}>{new Date(t.open_ts).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</td>
                            <td style={{ ...cellStyle, color: HT.muted, whiteSpace: "nowrap" }}>{new Date(t.close_ts).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</td>
                            <td style={{ ...cellStyle, color: HT.text }}>{t.entry.toFixed(2)}</td>
                            <td style={{ ...cellStyle, color: HT.text }}>{t.exit.toFixed(2)}</td>
                            <td style={{ ...cellStyle, color: HT.text }}>{t.qty}</td>
                            <td style={{ ...cellStyle, color: t.pnl >= 0 ? T.green : T.red, fontWeight: 700 }}>{fmt$(t.pnl)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                    {visibleTrades.length > 300 && (
                      <div style={{ fontSize: 12, color: HT.muted, padding: "8px 4px" }}>Showing the most recent 300 of {visibleTrades.length} trades.</div>
                    )}
                  </div>
                ) : (
                  <div style={{ padding: 12, color: HT.muted, fontSize: 13 }}>
                    No per-trade detail yet — import a broker CSV to populate symbol / time in-out / price in-out per trade.
                  </div>
                )
              )}
            </Card>

            {/* Calendar */}
            <Card padding={16}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
                <div style={{ ...titleStyle, marginBottom: 0, color: T.green }}>Session Calendar</div>
                <div style={{ display: "flex", alignItems: "center", gap: 16, color: HT.muted, fontSize: 14 }}>
                  <span style={{ cursor: "pointer" }} onClick={() => setCalMonth((c) => ({ y: c.m === 0 ? c.y - 1 : c.y, m: c.m === 0 ? 11 : c.m - 1 }))}>&lt;</span>
                  <strong style={{ color: HT.text }}>{monthLabel}</strong>
                  <span style={{ cursor: "pointer" }} onClick={() => setCalMonth((c) => ({ y: c.m === 11 ? c.y + 1 : c.y, m: c.m === 11 ? 0 : c.m + 1 }))}>&gt;</span>
                </div>
              </div>
              <div className="journal-cal" style={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)", gap: 4 }}>
                {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((d) => (
                  <div key={d} style={{ fontSize: 12, color: HT.muted, textAlign: "center", padding: 4, textTransform: "uppercase" }}>{d}</div>
                ))}
                {calCells.map((c, i) => c ? (
                  <div key={i}
                    onClick={() => setSelectedDay(selectedDay === c.date ? null : c.date)}
                    style={{
                      minHeight: 52, border: `1px solid ${selectedDay === c.date ? HT.cyan : HT.border}`,
                      borderRadius: 4, padding: 6, cursor: "pointer",
                      background: c.pnl != null ? (c.pnl >= 0 ? `${T.green}14` : `${T.red}14`) : "transparent",
                    }}>
                    <div style={{ fontSize: 14, color: HT.muted }}>{c.day}</div>
                    {c.pnl != null && (
                      <div style={{ fontSize: 12, fontWeight: 700, color: c.pnl >= 0 ? T.green : T.red }}>{fmt$(c.pnl)}</div>
                    )}
                  </div>
                ) : <div key={i} style={{ minHeight: 52 }} />)}
              </div>
        </Card>
      </div>

      {/* CSV IMPORT PREVIEW — nothing is written until "Import" is clicked */}
      {preview && (
        <div
          style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,.7)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1000, backdropFilter: "blur(4px)" }}
          onClick={() => setPreview(null)}
        >
          <Card className="no-card-lift" padding={20} style={{ maxWidth: 760, width: "95vw" }}>
            <div onClick={(e) => e.stopPropagation()}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14, paddingBottom: 10, borderBottom: `1px solid ${HT.border}` }}>
                <div style={{ ...titleStyle, marginBottom: 0 }}>
                  Import Preview — {BROKER_LABEL[preview.broker] ?? preview.broker}
                </div>
                <button onClick={() => setPreview(null)} style={{ background: "none", border: "none", fontSize: 20, color: HT.muted, cursor: "pointer" }}>×</button>
              </div>

              <div style={{ fontSize: 14, color: HT.muted, marginBottom: 12 }}>
                {preview.counts.fills} fills → {preview.counts.trades} closed trades →{" "}
                <span style={{ color: HT.text }}>{preview.counts.days} journal days</span>.
                Stats are recomputed from the executions, not read from the broker&apos;s summary.
              </div>

              {preview.warnings.map((w, i) => (
                <div key={i} style={{ fontSize: 14, color: HT.orange, marginBottom: 8 }}>⚠ {w}</div>
              ))}

              <div style={{ maxHeight: 300, overflowY: "auto", marginTop: 8 }}>
                <table style={tableStyle}>
                  <thead>
                    <tr>
                      {["Date", "Net P&L", "Trades", "Win %", "Avg Win", "Avg Loss", "PF", "Fees"].map((h) => (
                        <th key={h} style={{ textAlign: "left", fontSize: 12, color: HT.muted, textTransform: "uppercase", padding: "4px 6px", borderBottom: `1px solid ${HT.border}` }}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {preview.days.map((d) => (
                      <tr key={d.date}>
                        <td style={{ ...cellStyle, color: HT.text }}>{d.date}</td>
                        <td style={{ ...cellStyle, color: d.net_pnl >= 0 ? T.green : T.red, fontWeight: 700 }}>{fmt$(d.net_pnl)}</td>
                        <td style={{ ...cellStyle, color: HT.text }}>{d.trades}</td>
                        <td style={{ ...cellStyle, color: HT.text }}>{d.win_rate.toFixed(0)}%</td>
                        <td style={{ ...cellStyle, color: T.green }}>{d.avg_win ? fmt$(d.avg_win) : "—"}</td>
                        <td style={{ ...cellStyle, color: T.red }}>{d.avg_loss ? fmt$(d.avg_loss) : "—"}</td>
                        <td style={{ ...cellStyle, color: HT.text }}>{d.profit_factor ? d.profit_factor.toFixed(2) : "—"}</td>
                        <td style={{ ...cellStyle, color: HT.muted }}>{fmt$(d.commissions)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <div style={{ fontSize: 12, color: HT.muted, marginTop: 10 }}>
                Existing days with the same date are overwritten (your notes are kept).
                Re-importing the same statement is safe — duplicate fills are ignored.
              </div>

              <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 16, paddingTop: 12, borderTop: `1px solid ${HT.border}` }}>
                <button style={btnStyle()} onClick={() => setPreview(null)} disabled={importing}>Cancel</button>
                <button style={btnStyle(true)} onClick={commitImport} disabled={importing}>
                  {importing ? "Importing…" : `Import ${preview.counts.days} Days`}
                </button>
              </div>
            </div>
          </Card>
        </div>
      )}

      {/* EXPANDED CHART — pop-out view of whichever card's ⤢ was clicked */}
      {expandedChart && chartDefs[expandedChart] && (
        <div
          style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,.7)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1000, backdropFilter: "blur(4px)" }}
          onClick={() => setExpandedChart(null)}
        >
          <Card className="no-card-lift" padding={20} style={{ maxWidth: 800, width: "95vw" }}>
            <div onClick={(e) => e.stopPropagation()}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14, paddingBottom: 10, borderBottom: `1px solid ${HT.border}` }}>
                <div style={{ ...titleStyle, marginBottom: 0, color: chartDefs[expandedChart].accent }}>
                  {chartDefs[expandedChart].title} {chartDefs[expandedChart].value}
                </div>
                <button onClick={() => setExpandedChart(null)} style={{ background: "none", border: "none", fontSize: 20, color: HT.muted, cursor: "pointer" }}>×</button>
              </div>
              {chartDefs[expandedChart].render(720, 340)}
            </div>
          </Card>
        </div>
      )}

      {/* NEW / EDIT JOURNAL MODAL */}
      {showModal && (
        <div
          style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,.7)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1000, backdropFilter: "blur(4px)" }}
          onClick={() => setShowModal(false)}
        >
          <Card
            className="no-card-lift journal-modal"
            padding={20}
            style={{ maxWidth: 520, width: "95vw" }}
          >
            <div onClick={(e) => e.stopPropagation()}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16, paddingBottom: 10, borderBottom: `1px solid ${HT.border}` }}>
                <div style={{ ...titleStyle, marginBottom: 0 }}>
                  {editId != null ? "Edit Journal Entry" : "New Journal Entry"}
                </div>
                <button onClick={() => setShowModal(false)} style={{ background: "none", border: "none", fontSize: 20, color: HT.muted, cursor: "pointer" }}>×</button>
              </div>

              <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                <div>
                  <label style={labelStyle}>Trading Date</label>
                  <input type="date" style={inputStyle} value={f.date} onChange={(e) => setF({ ...f, date: e.target.value })} />
                </div>
                <div className="journal-form-3" style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8 }}>
                  <div><label style={labelStyle}>Net P&L ($)</label><input type="number" step="0.01" placeholder="e.g. 312.50" style={inputStyle} value={f.netPnl} onChange={(e) => setF({ ...f, netPnl: e.target.value })} /></div>
                  <div><label style={labelStyle}>Total Trades</label><input type="number" step="1" min="0" placeholder="e.g. 8" style={inputStyle} value={f.trades} onChange={(e) => setF({ ...f, trades: e.target.value })} /></div>
                  <div><label style={labelStyle}>Win Rate (%)</label><input type="number" step="0.1" min="0" max="100" placeholder="e.g. 62.5" style={inputStyle} value={f.winRate} onChange={(e) => setF({ ...f, winRate: e.target.value })} /></div>
                </div>
                <div className="journal-form-3" style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8 }}>
                  <div><label style={labelStyle}>Avg Win ($)</label><input type="number" step="0.01" placeholder="e.g. 187.00" style={inputStyle} value={f.avgWin} onChange={(e) => setF({ ...f, avgWin: e.target.value })} /></div>
                  <div><label style={labelStyle}>Avg Loss ($)</label><input type="number" step="0.01" placeholder="e.g. -95.00" style={inputStyle} value={f.avgLoss} onChange={(e) => setF({ ...f, avgLoss: e.target.value })} /></div>
                  <div><label style={labelStyle}>Profit Factor</label><input type="number" step="0.01" min="0" placeholder="e.g. 1.87" style={inputStyle} value={f.profitFactor} onChange={(e) => setF({ ...f, profitFactor: e.target.value })} /></div>
                </div>
                <div style={{ display: "grid", gridTemplateColumns: "1fr", gap: 8 }}>
                  <div><label style={labelStyle}>Commissions ($)</label><input type="number" step="0.01" placeholder="e.g. -24.00" style={inputStyle} value={f.commissions} onChange={(e) => setF({ ...f, commissions: e.target.value })} /></div>
                </div>
                <div>
                  <label style={labelStyle}>Notes</label>
                  <textarea rows={2} placeholder="Market conditions, key trades, observations…" style={{ ...inputStyle, resize: "vertical", minHeight: 48 }} value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} />
                </div>
              </div>

              {modalErr && <div style={{ fontSize: 14, color: T.red, marginTop: 8 }}>{modalErr}</div>}

              <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 16, paddingTop: 12, borderTop: `1px solid ${HT.border}` }}>
                <button style={btnStyle()} onClick={() => setShowModal(false)} disabled={saving}>Cancel</button>
                <button style={btnStyle(true)} onClick={saveJournal} disabled={saving}>
                  {saving ? "Saving…" : editId != null ? "Save Changes" : "Save Entry"}
                </button>
              </div>
            </div>
          </Card>
        </div>
      )}
    </PageShell>
  );
}
