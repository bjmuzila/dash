"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { CSSProperties } from "react";
import { HOME_THEME, LIGHT_BLUE, statTileStyle, homeButtonStyle } from "@/components/shared/homeTheme";
import { Card } from "@/components/shared/PageCard";
import { ThemedSelect } from "@/components/shared/ThemedSelect";

// ─────────────────────────────────────────────────────────────────────────────
// Test Lab → Dealer Gamma tab.
//
// Renders the EOD dealer-gamma-by-DTE snapshot written by
// server-v2/eod-dte-gamma-recorder.js at the 15:55 ET window, read through
// /api/eod-dealer-gamma.
//
// Two things this UI is deliberately careful about:
//
//   1. Rollups are not buckets. Ex-0DTE and All-expirations are SUMS of the
//      five disjoint buckets, so they render below a divider with a "rollup"
//      chip and dimmed bars. Stacked identically they would read as seven
//      independent quantities summing to 200%.
//   2. Basis is always visible. Gamma is measured for every bucket, but the
//      POSITION SIGN is only measured inside ~7 DTE — beyond that it is the
//      ordinary call+/put− convention. Every row carries a chip saying which,
//      because presenting an assumed number as a measured dealer book is the
//      single most misleading thing this page could do.
// ─────────────────────────────────────────────────────────────────────────────

const SYMBOLS = ["$SPX", "SPY", "QQQ"];

// The Next app's HOME_THEME has no `gold` or `borderStrong` (owner-vite's
// OWNER_THEME does, but this page imports the shared one). Declared locally
// rather than widening the shared theme, so this tab can't perturb any other
// page's colors.
const GOLD = "#FFB703";
const BORDER_STRONG = "rgba(255,255,255,0.18)";

type Entry = {
  bucket: string;
  label: string;
  dteLabel: string;
  expirations: number;
  strikes: number;
  callOi: number;
  putOi: number;
  netGamma: number;
  basis: string;
  measuredCoverage: number;
  shareOfGross?: number;
};

type Session = {
  date: string;
  spot: number;
  buckets: Entry[];
  rollups: Entry[];
  totals: { net: number; gross: number; zeroDte: number; ex0dte: number };
};

// ── formatting ───────────────────────────────────────────────────────────────
/**
 * Dollar gamma. The billions threshold is deliberately 0.1B rather than 1B:
 * index gamma columns are almost entirely billions, and letting a single row
 * drop to "M" makes the column impossible to scan (-$790.00M next to +$2.87B
 * reads as the larger number at a glance). Sub-0.1B values still fall back so
 * a quiet symbol doesn't render as a column of +$0.00B.
 */
function fmtGamma(v: number): string {
  const a = Math.abs(v);
  const sign = v < 0 ? "-" : "+";
  if (a >= 1e8) return `${sign}$${(a / 1e9).toFixed(2)}B`;
  if (a >= 1e5) return `${sign}$${(a / 1e6).toFixed(1)}M`;
  if (a >= 1e3) return `${sign}$${(a / 1e3).toFixed(0)}K`;
  return `${sign}$${a.toFixed(0)}`;
}
const fmtInt = (v: number) => Math.round(v).toLocaleString("en-US");
const fmtPct = (v: number) => `${(v * 100).toFixed(1)}%`;
const toneOf = (v: number) => (v < 0 ? HOME_THEME.red : LIGHT_BLUE);

// ── styles ───────────────────────────────────────────────────────────────────
const th: CSSProperties = {
  textAlign: "left", padding: "7px 10px", fontSize: 14, fontWeight: 800,
  letterSpacing: "0.14em", textTransform: "uppercase", color: HOME_THEME.muted,
  opacity: 0.55, borderBottom: `1px solid ${HOME_THEME.border}`, whiteSpace: "nowrap",
};
const thNum: CSSProperties = { ...th, textAlign: "right" };
const td: CSSProperties = {
  padding: "8px 10px", fontSize: 14, color: HOME_THEME.text,
  borderBottom: `1px solid ${HOME_THEME.border}`, whiteSpace: "nowrap",
  fontVariantNumeric: "tabular-nums",
};
const tdNum: CSSProperties = { ...td, textAlign: "right" };

function Chip({ kind }: { kind: string }) {
  const map: Record<string, { bg: string; fg: string; bd: string; text: string }> = {
    measured: { bg: "rgba(125,211,252,0.14)", fg: LIGHT_BLUE, bd: "rgba(125,211,252,0.30)", text: "measured" },
    partial: { bg: "rgba(255,183,3,0.12)", fg: GOLD, bd: "rgba(255,183,3,0.30)", text: "partial" },
    convention: { bg: "rgba(255,255,255,0.06)", fg: HOME_THEME.text, bd: HOME_THEME.border, text: "convention" },
    rollup: { bg: "rgba(255,183,3,0.12)", fg: GOLD, bd: "rgba(255,183,3,0.30)", text: "rollup" },
    mixed: { bg: "rgba(255,255,255,0.06)", fg: HOME_THEME.text, bd: HOME_THEME.border, text: "mixed" },
  };
  const s = map[kind] ?? map.convention;
  return (
    <span style={{
      display: "inline-block", padding: "2px 8px", borderRadius: 999, fontSize: 11,
      fontWeight: 800, letterSpacing: "0.08em", textTransform: "uppercase",
      background: s.bg, color: s.fg, border: `1px solid ${s.bd}`,
      opacity: kind === "convention" ? 0.75 : 1,
    }}>{s.text}</span>
  );
}

function Tile({ label, value, sub, tone }: { label: string; value: string; sub: string; tone?: string }) {
  return (
    <div style={{ ...statTileStyle, padding: "14px 18px", minWidth: 172, flex: 1 }}>
      <div style={{ fontSize: 12, fontWeight: 800, letterSpacing: "0.14em", textTransform: "uppercase", color: HOME_THEME.muted, opacity: 0.5 }}>
        {label}
      </div>
      <div style={{ fontSize: 30, fontWeight: 800, marginTop: 4, color: tone ?? HOME_THEME.text, fontVariantNumeric: "tabular-nums" }}>
        {value}
      </div>
      <div style={{ fontSize: 12, color: HOME_THEME.muted, opacity: 0.55, marginTop: 2 }}>{sub}</div>
    </div>
  );
}

/** Diverging bar: negative left of a neutral zero line, positive right. */
function DivergingBars({ buckets, rollups }: { buckets: Entry[]; rollups: Entry[] }) {
  const all = [...buckets, ...rollups];
  const max = Math.max(1, ...all.map((b) => Math.abs(b.netGamma)));

  const row = (b: Entry, isRollup: boolean) => {
    const half = (Math.abs(b.netGamma) / max) * 50;
    const neg = b.netGamma < 0;
    return (
      <div key={b.bucket} style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 7 }}>
        <span style={{ fontSize: 13, color: HOME_THEME.muted, opacity: isRollup ? 0.9 : 0.65, width: 132, textAlign: "right", flex: "none", fontWeight: isRollup ? 700 : 400 }}>
          {b.label} <span style={{ opacity: 0.5 }}>{b.dteLabel}</span>
        </span>
        <span style={{ flex: 1, height: 20, position: "relative", display: "block" }}>
          <span style={{ position: "absolute", left: "50%", top: -2, bottom: -2, width: 1, background: "rgba(255,255,255,0.22)" }} />
          <span
            title={`${b.label} (${b.dteLabel} DTE) · ${fmtGamma(b.netGamma)} per 1%${isRollup ? " · rollup" : ""}`}
            style={{
              position: "absolute", top: 0, height: 20, display: "block",
              background: neg ? HOME_THEME.red : LIGHT_BLUE,
              opacity: isRollup ? 0.55 : 1,
              borderRadius: neg ? "4px 0 0 4px" : "0 4px 4px 0",
              ...(neg ? { right: "50%", width: `${half}%` } : { left: "50%", width: `${half}%` }),
            }}
          />
        </span>
        <span style={{ fontSize: 13, width: 92, flex: "none", color: toneOf(b.netGamma), fontVariantNumeric: "tabular-nums" }}>
          {fmtGamma(b.netGamma)}
        </span>
      </div>
    );
  };

  return (
    <div style={{ marginTop: 10 }}>
      {buckets.map((b) => row(b, false))}
      <div style={{ height: 1, background: BORDER_STRONG, margin: "10px 0 10px 142px", opacity: 0.7 }} />
      {rollups.map((r) => row(r, true))}
      <div style={{ display: "flex", gap: 10, marginTop: 4, fontSize: 11, color: HOME_THEME.muted, opacity: 0.4 }}>
        <span style={{ width: 132, flex: "none" }} />
        <span style={{ flex: 1, display: "flex", justifyContent: "space-between" }}>
          <span>{fmtGamma(-max)}</span><span>0</span><span>{fmtGamma(max)}</span>
        </span>
        <span style={{ width: 92, flex: "none" }} />
      </div>
    </div>
  );
}

function BucketTable({ session }: { session: Session }) {
  return (
    <div style={{ overflowX: "auto", marginTop: 10 }}>
      <table style={{ borderCollapse: "collapse", width: "100%" }}>
        <thead>
          <tr>
            <th style={th}>bucket</th>
            <th style={th}>dte</th>
            <th style={thNum}>exps</th>
            <th style={thNum}>call oi</th>
            <th style={thNum}>put oi</th>
            <th style={thNum}>net gamma / 1%</th>
            <th style={thNum}>share of gross</th>
            <th style={th}>basis</th>
          </tr>
        </thead>
        <tbody>
          {session.buckets.map((b) => (
            <tr key={b.bucket}>
              <td style={td}>{b.label}</td>
              <td style={{ ...td, opacity: 0.55 }}>{b.dteLabel}</td>
              <td style={{ ...tdNum, opacity: 0.55 }}>{fmtInt(b.expirations)}</td>
              <td style={tdNum}>{fmtInt(b.callOi)}</td>
              <td style={tdNum}>{fmtInt(b.putOi)}</td>
              <td style={{ ...tdNum, color: toneOf(b.netGamma) }}>{fmtGamma(b.netGamma)}</td>
              <td style={{ ...tdNum, opacity: 0.55 }}>{fmtPct(b.shareOfGross ?? 0)}</td>
              <td style={td}><Chip kind={b.basis} /></td>
            </tr>
          ))}
          {session.rollups.map((r, i) => (
            <tr key={r.bucket}>
              <td style={{ ...td, fontWeight: 800, borderTop: i === 0 ? `1px solid ${BORDER_STRONG}` : undefined }}>
                {r.label} <Chip kind="rollup" />
              </td>
              <td style={{ ...td, opacity: 0.55, borderTop: i === 0 ? `1px solid ${BORDER_STRONG}` : undefined }}>{r.dteLabel}</td>
              <td style={{ ...tdNum, opacity: 0.55, borderTop: i === 0 ? `1px solid ${BORDER_STRONG}` : undefined }}>{fmtInt(r.expirations)}</td>
              <td style={{ ...tdNum, fontWeight: 800, borderTop: i === 0 ? `1px solid ${BORDER_STRONG}` : undefined }}>{fmtInt(r.callOi)}</td>
              <td style={{ ...tdNum, fontWeight: 800, borderTop: i === 0 ? `1px solid ${BORDER_STRONG}` : undefined }}>{fmtInt(r.putOi)}</td>
              <td style={{ ...tdNum, fontWeight: 800, color: toneOf(r.netGamma), borderTop: i === 0 ? `1px solid ${BORDER_STRONG}` : undefined }}>{fmtGamma(r.netGamma)}</td>
              <td style={{ ...tdNum, opacity: 0.55, borderTop: i === 0 ? `1px solid ${BORDER_STRONG}` : undefined }}>
                {session.totals.gross > 0 ? fmtPct(Math.abs(r.netGamma) / session.totals.gross) : "—"}
              </td>
              <td style={{ ...td, borderTop: i === 0 ? `1px solid ${BORDER_STRONG}` : undefined }}><Chip kind="mixed" /></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ── data hook ────────────────────────────────────────────────────────────────
function useDealerGamma(symbol: string, limit: number) {
  const [sessions, setSessions] = useState<Session[]>([]);
  const [pending, setPending] = useState(false);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setErr(null);
    try {
      const res = await fetch(
        `/api/eod-dealer-gamma?symbol=${encodeURIComponent(symbol)}&limit=${limit}`,
        { cache: "no-store" }
      );
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || `HTTP ${res.status}`);
      setSessions(Array.isArray(json.sessions) ? json.sessions : []);
      setPending(Boolean(json.pending));
    } catch (e) {
      setErr((e as Error).message);
      setSessions([]);
    } finally {
      setLoading(false);
    }
  }, [symbol, limit]);

  useEffect(() => { void load(); }, [load]);
  return { sessions, pending, loading, err, reload: load };
}

// ── tab ──────────────────────────────────────────────────────────────────────
export default function DealerGammaTab() {
  const [symbol, setSymbol] = useState("$SPX");
  const { sessions, pending, loading, err, reload } = useDealerGamma(symbol, 30);

  // Newest session drives the tiles/table; the array arrives ascending.
  const latest = useMemo(() => sessions[sessions.length - 1] ?? null, [sessions]);

  const conventionShare = useMemo(() => {
    if (!latest || !(latest.totals.gross > 0)) return 0;
    const conv = latest.buckets
      .filter((b) => b.basis === "convention")
      .reduce((a, b) => a + Math.abs(b.netGamma), 0);
    return conv / latest.totals.gross;
  }, [latest]);

  return (
    <>
      <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
        <ThemedSelect
          width={120}
          ariaLabel="Symbol"
          value={symbol}
          options={SYMBOLS.map((s) => ({ value: s, label: s }))}
          onChange={setSymbol}
        />
        <button onClick={reload} style={homeButtonStyle}>Refresh</button>
        <div style={{ fontSize: 14, color: HOME_THEME.text, opacity: 0.7 }}>
          {loading ? "Loading EOD snapshots…" : latest ? `Latest close: ${latest.date}` : "No snapshots yet"}
        </div>
      </div>

      {err && (
        <Card variant="budget" accent={HOME_THEME.red} title="Dealer gamma">
          <div style={{ fontSize: 14, color: HOME_THEME.red }}>Error: {err}</div>
        </Card>
      )}

      {!err && pending && (
        <Card variant="budget" accent={HOME_THEME.orange} title="Waiting on the first snapshot">
          <div style={{ fontSize: 14, color: HOME_THEME.text, opacity: 0.8, lineHeight: 1.6 }}>
            The <code>eod_dte_gamma</code> table has not been written yet. It is populated by
            <code> server-v2/eod-dte-gamma-recorder.js</code> during the 15:55 ET window, so the
            first row appears after the next close.
          </div>
        </Card>
      )}

      {!err && !pending && latest && (
        <Card
          variant="budget"
          accent={LIGHT_BLUE}
          title={<span style={{ fontSize: 17 }}>{symbol} · Dealer gamma by DTE</span>}
          subtitle={`Close of ${latest.date} · spot ${latest.spot ? latest.spot.toFixed(2) : "—"} · snapshot taken at 15:55 ET, before 0DTE settles`}
        >
          <div style={{ display: "flex", flexWrap: "wrap", gap: 12, marginBottom: 20 }}>
            <Tile
              label="net dealer gamma / 1%"
              value={fmtGamma(latest.totals.net)}
              sub="all expirations"
              tone={toneOf(latest.totals.net)}
            />
            <Tile
              label="0DTE"
              value={fmtGamma(latest.totals.zeroDte)}
              sub={`${fmtPct(latest.totals.gross > 0 ? Math.abs(latest.totals.zeroDte) / latest.totals.gross : 0)} of gross · expires tonight`}
              tone={toneOf(latest.totals.zeroDte)}
            />
            <Tile
              label="ex-0DTE"
              value={fmtGamma(latest.totals.ex0dte)}
              sub="carried into tomorrow"
              tone={toneOf(latest.totals.ex0dte)}
            />
            <Tile
              label="convention-based"
              value={fmtPct(conventionShare)}
              sub="share of gross that is assumed, not measured"
              tone={conventionShare > 0.5 ? GOLD : HOME_THEME.text}
            />
          </div>

          <div style={{ fontSize: 17, fontWeight: 800, letterSpacing: "0.14em", textTransform: "uppercase", color: LIGHT_BLUE }}>
            by bucket
          </div>
          <BucketTable session={latest} />

          <div style={{ fontSize: 17, fontWeight: 800, letterSpacing: "0.14em", textTransform: "uppercase", color: LIGHT_BLUE, marginTop: 18 }}>
            gamma distribution
          </div>
          <DivergingBars buckets={latest.buckets} rollups={latest.rollups} />

          <div style={{ marginTop: 16, paddingTop: 14, borderTop: `1px solid ${HOME_THEME.border}`, fontSize: 13.5, color: HOME_THEME.muted, lineHeight: 1.65, opacity: 0.88 }}>
            <b style={{ color: GOLD }}>What is measured vs. assumed.</b>{" "}
            Gamma is real for every bucket — the EOD sweep pulls per-strike vendor gamma, OI and
            volume for every listed expiration, so there is no implied-vol assumption anywhere.
            What differs by bucket is the <b style={{ color: GOLD }}>sign of the position</b>:
            measured from classified tape inside 7 DTE, assumed by the ordinary call+/put− convention
            beyond it, because the live feed only subscribes one expiry at a time and the OI baseline
            only reaches about a week out.
            <br /><br />
            <b style={{ color: GOLD }}>Rollups are not buckets.</b>{" "}
            Ex-0DTE and All expirations are sums of the five rows above them, which is why they sit
            below a divider. Shares are of <i>gross</i> gamma so the five disjoint buckets total 100%
            even when the book straddles zero.
            <br /><br />
            <b style={{ color: GOLD }}>Scaling.</b>{" "}
            Γ × Position × 100 × S² × 0.01 — dollar gamma per 1% move, the same multiplier
            <code> gex-calculator.js</code> already uses.
          </div>
        </Card>
      )}

      {!err && !pending && !loading && !latest && (
        <Card variant="budget" accent={HOME_THEME.orange} title="No snapshots for this symbol">
          <div style={{ fontSize: 14, color: HOME_THEME.text, opacity: 0.8 }}>
            Nothing recorded for {symbol} yet. The recorder writes $SPX by default.
          </div>
        </Card>
      )}
    </>
  );
}
