"use client";

/**
 * GexHeatBar — the gross-gamma-churn bar.
 *
 * ONE bar carries two facts, because churn alone cannot tell a giant roll apart
 * from a giant build:
 *
 *   FILL  = how much of this ticker's gamma book rewrote itself today.
 *   COLOR = whether that gamma was ADDED, ROTATED in place, or PULLED OFF.
 *
 * Both come straight from /api/gex-gross-feed (server-v2/_lib-gex-gross.cjs).
 * Every quantity behind them takes its absolute value at the LEG before summing
 * — |call_gex| + |put_gex| — so a put build can never cancel a call build and
 * report a busy session as a quiet one.
 *
 * ── THE FILL SCALE IS NOT 0–100% ────────────────────────────────────────────
 * Measured across the roster, the median ticker churns 16–19% of its book on an
 * ordinary session and p90 sits near 40% — but on 2026-08-27 NVDA printed 312%
 * and CRM 261%, and five of the top thirty cleared 100%. A bar that filled at
 * 100% would peg on every interesting day and sit half-full on every dull one.
 *
 * So the fill is HEAT: churn ÷ that ticker's own trailing clean average, where
 * 1.0 is a normal day FOR IT. SPY carries a $92B gross book and WEN $3.7M; any
 * roster-wide percentage ranks by ticker size, not by what happened. Same
 * reasoning as ×normal in the watch engine.
 *
 * Until a ticker has enough clean sessions behind it the feed sends `heat:
 * null`, and the bar falls back to a fixed provisional churn scale and SAYS so
 * (hatched track). It never silently shows a ratio against an average of three
 * days.
 *
 * ── COLOR IS build_share, WHICH IS BOUNDED ──────────────────────────────────
 * build_share = build / churn, and |build| ≤ churn always (triangle
 * inequality), so it lives in [−1, +1]:
 *
 *   +1  pure addition — gamma arrived, nothing left      (LIGHT_BLUE, bright)
 *    0  pure rotation — as much came off as went on      (purple, dim)
 *   −1  pure unwind   — gamma left, nothing replaced it  (SOFT_RED)
 *
 * The brightness gradient does real work here: a dim bar is a book that churned
 * without growing. On 2026-08-27 NVDA read 0.90 (almost pure addition) while
 * MSTR read 0.29 (mostly rotation) at a similar churn.
 *
 * ── OPEX AND EARNINGS ARE SHOWN, NOT HIDDEN ─────────────────────────────────
 * They are excluded from the BASELINE (see the _lib header — opex drops the
 * median book 31% and earnings days rank the reporters on IV crush alone) but
 * they are still real sessions and still worth seeing. They render with a badge
 * saying which, so a maxed-out bar is never mistaken for repositioning.
 *
 * Colors and surfaces come from homeTheme. Never hardcode hex here.
 */

import { useEffect, useState } from "react";
import type { CSSProperties } from "react";
import { HOME_THEME, LIGHT_BLUE, SOFT_RED, statTileStyle } from "./homeTheme";

/** One row of /api/gex-gross-feed. */
export type GexGrossRow = {
  symbol: string;
  date?: string;
  grossM?: number | null;
  churnPct: number;
  buildPct?: number | null;
  buildShare: number;
  callShare?: number | null;
  /** churn ÷ this ticker's trailing clean average. null = no baseline yet. */
  heat?: number | null;
  baselineSessions?: number | null;
  provisional?: boolean;
  isOpex?: boolean;
  isEarnings?: boolean;
  what?: string;
};

/**
 * Fill anchors. `EXTREME` is where the bar reads full — 4× a normal day. Set
 * from the observed roster: on a busy session the top of the board runs 8–15×
 * its own normal, so a lower ceiling would peg the whole leaderboard and a
 * higher one would leave ordinary hot days looking empty.
 */
const HEAT_NORMAL = 1;
const HEAT_HOT = 2;
const HEAT_EXTREME = 4;
/** Provisional scale, in raw churn %, used only before a baseline exists. */
const PROVISIONAL_MAX_PCT = 100;

const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);

function hexToRgb(hex: string): [number, number, number] {
  const h = hex.replace("#", "");
  return [
    parseInt(h.slice(0, 2), 16),
    parseInt(h.slice(2, 4), 16),
    parseInt(h.slice(4, 6), 16),
  ];
}

/** Diverging ramp across three THEME anchors — no literals. */
function buildShareColor(share: number, alpha = 1): string {
  const s = Number.isFinite(share) ? Math.max(-1, Math.min(1, share)) : 0;
  const from = s < 0 ? hexToRgb(SOFT_RED) : hexToRgb(HOME_THEME.purple);
  const to = s < 0 ? hexToRgb(HOME_THEME.purple) : hexToRgb(LIGHT_BLUE);
  const t = s < 0 ? s + 1 : s;
  const mix = from.map((c, i) => Math.round(c + (to[i] - c) * t));
  return `rgba(${mix[0]},${mix[1]},${mix[2]},${alpha})`;
}

function themeRgba(hex: string, a: number): string {
  const [r, g, b] = hexToRgb(hex);
  return `rgba(${r},${g},${b},${a})`;
}

/** Fill fraction plus whether it came from a real baseline or the fallback. */
export function heatFill(row: { churnPct: number; heat?: number | null }): { frac: number; provisional: boolean } {
  const heat = row.heat;
  if (heat == null || !Number.isFinite(heat)) {
    return { frac: clamp01(row.churnPct / PROVISIONAL_MAX_PCT), provisional: true };
  }
  return { frac: clamp01(heat / HEAT_EXTREME), provisional: false };
}

export type GexHeatBarProps = {
  row: GexGrossRow;
  /** Show the symbol and the readout above the bar. Off for dense tables. */
  showLabel?: boolean;
  height?: number;
  style?: CSSProperties;
};

export function GexHeatBar({ row, showLabel = true, height = 10, style }: GexHeatBarProps) {
  const { frac, provisional } = heatFill(row);
  const fillColor = buildShareColor(row.buildShare);
  const flag = row.isOpex ? "OPEX" : row.isEarnings ? "EARNINGS" : null;

  // Tick positions for "a normal day" and "hot". Meaningless on the provisional
  // scale — that bar has no per-ticker normal yet — so they are not drawn.
  const ticks = provisional
    ? []
    : [HEAT_NORMAL, HEAT_HOT].map((h) => ({ h, left: `${clamp01(h / HEAT_EXTREME) * 100}%` }));

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 4, ...style }}>
      {showLabel && (
        <div style={{ display: "flex", alignItems: "baseline", gap: 8, fontSize: 12 }}>
          <span style={{ fontWeight: 600, color: HOME_THEME.text }}>{row.symbol}</span>
          <span style={{ color: themeRgba(HOME_THEME.muted, 0.55) }}>
            {Math.round(row.churnPct)}% of book changed
          </span>
          <span style={{ marginLeft: "auto", color: fillColor, fontWeight: 600 }}>
            {provisional
              ? `${Math.round(row.churnPct)}%`
              : `${(row.heat as number).toFixed(1)}× normal`}
          </span>
          {flag && (
            <span
              style={{
                fontSize: 9,
                letterSpacing: 0.6,
                padding: "1px 5px",
                borderRadius: 4,
                color: themeRgba(HOME_THEME.muted, 0.7),
                border: `1px solid ${HOME_THEME.border}`,
              }}
            >
              {flag}
            </span>
          )}
        </div>
      )}

      <div
        title={
          `${row.symbol} — ${Math.round(row.churnPct)}% of its gross gamma book changed` +
          (provisional
            ? ` (no baseline yet${row.baselineSessions != null ? `, ${row.baselineSessions} clean sessions on file` : ""})`
            : `, ${(row.heat as number).toFixed(1)}× a normal day for it`) +
          ` · ${row.what || "build share " + row.buildShare.toFixed(2)}` +
          (flag ? ` · ${flag}` : "")
        }
        style={{
          position: "relative",
          height,
          borderRadius: height,
          overflow: "hidden",
          background: themeRgba(HOME_THEME.muted, 0.06),
          // A hatched track is the honest signal that this bar is on the
          // fallback scale — the reader can see it is not a ×normal reading.
          backgroundImage: provisional
            ? `repeating-linear-gradient(135deg, ${themeRgba(HOME_THEME.muted, 0.05)} 0 4px, transparent 4px 8px)`
            : undefined,
          border: `1px solid ${HOME_THEME.border}`,
        }}
      >
        <div
          style={{
            width: `${frac * 100}%`,
            height: "100%",
            background: `linear-gradient(90deg, ${buildShareColor(row.buildShare, 0.55)}, ${fillColor})`,
            transition: "width 240ms ease",
          }}
        />
        {ticks.map((t) => (
          <div
            key={t.h}
            style={{
              position: "absolute",
              top: 0,
              bottom: 0,
              left: t.left,
              width: 1,
              background: themeRgba(HOME_THEME.muted, t.h === HEAT_NORMAL ? 0.35 : 0.18),
            }}
          />
        ))}
      </div>
    </div>
  );
}

export type GexHeatBoardProps = {
  rows: GexGrossRow[];
  asOf?: string | null;
  note?: string | null;
  title?: string;
  style?: CSSProperties;
};

/**
 * The board. Presentational only — the page owns the fetch, so this component
 * never decides how often /api/gex-gross-feed is called.
 */
export function GexHeatBoard({ rows, asOf, note, title = "Gamma book churn", style }: GexHeatBoardProps) {
  return (
    <div style={{ ...statTileStyle, padding: 16, display: "flex", flexDirection: "column", gap: 12, ...style }}>
      <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
        <span style={{ fontSize: 13, fontWeight: 600, letterSpacing: 0.3, color: HOME_THEME.text }}>
          {title}
        </span>
        {asOf && (
          <span style={{ fontSize: 11, color: themeRgba(HOME_THEME.muted, 0.5) }}>at the {asOf} close</span>
        )}
      </div>

      {!rows.length ? (
        <div style={{ fontSize: 12, color: themeRgba(HOME_THEME.muted, 0.55) }}>
          {note || "Nothing on file for the last session."}
        </div>
      ) : (
        <>
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {rows.map((r) => (
              <GexHeatBar key={r.symbol} row={r} />
            ))}
          </div>

          {/* The legend is not decoration: a diverging color scale that nobody
              can read is just a colorful bar. */}
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 10,
              fontSize: 10,
              color: themeRgba(HOME_THEME.muted, 0.5),
              borderTop: `1px solid ${HOME_THEME.border}`,
              paddingTop: 8,
            }}
          >
            <span>pulled off</span>
            <div
              style={{
                flex: 1,
                height: 4,
                borderRadius: 4,
                background: `linear-gradient(90deg, ${buildShareColor(-1)}, ${buildShareColor(0)}, ${buildShareColor(1)})`,
              }}
            />
            <span>added</span>
            <span style={{ marginLeft: 8 }}>fill = × a normal day for that ticker</span>
          </div>

          {note && (
            <div style={{ fontSize: 10, lineHeight: 1.5, color: themeRgba(HOME_THEME.muted, 0.4) }}>{note}</div>
          )}
        </>
      )}
    </div>
  );
}

/* ────────────────────────────────────────────────────────────────────────────
 * PER-TICKER HISTORY — the same encoding, one row per session.
 *
 * The board answers "who moved today". This answers "what does this ticker's
 * book normally do", which is the question a log page is already asking. Same
 * fill, same color ramp, same provisional rule — imported, not re-derived, so
 * the two surfaces cannot drift on what a bar means.
 * ──────────────────────────────────────────────────────────────────────────── */

/** One row of /api/gex-gross-feed?symbol=X — no `symbol`, it is on the envelope. */
export type GexChurnHistoryRow = {
  date: string;
  grossM?: number | null;
  churnPct: number;
  buildPct?: number | null;
  buildShare: number;
  callShare?: number | null;
  heat?: number | null;
  isOpex?: boolean;
  isEarnings?: boolean;
  clean?: boolean;
};

/**
 * Fetches one ticker's churn series. A hook rather than a fetch inside the
 * component, so the PAGE owns the request policy — how often, on what
 * dependency, and whether to fire at all. A component that fetches on mount is
 * a component that fires on every re-render someone later introduces.
 */
export function useGexChurnHistory(symbol: string | null, days = 45) {
  const [rows, setRows] = useState<GexChurnHistoryRow[]>([]);
  const [note, setNote] = useState("");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!symbol) { setRows([]); setNote(""); return; }
    let alive = true;
    setLoading(true);
    (async () => {
      try {
        const r = await fetch(
          `/api/gex-gross-feed?symbol=${encodeURIComponent(symbol)}&days=${days}`,
          { cache: "no-store" },
        );
        const j = await r.json();
        if (!alive) return;
        setRows(Array.isArray(j.rows) ? j.rows : []);
        setNote(typeof j.note === "string" ? j.note : "");
      } catch {
        if (alive) { setRows([]); setNote("Churn history unavailable right now."); }
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => { alive = false; };
  }, [symbol, days]);

  return { rows, note, loading };
}

export type GexChurnHistoryProps = {
  symbol: string | null;
  rows: GexChurnHistoryRow[];
  note?: string;
  loading?: boolean;
  /** Cap the rows drawn. The series only goes back to 2026-08-18 for now. */
  limit?: number;
  style?: CSSProperties;
};

export function GexChurnHistory({ symbol, rows, note, loading, limit = 12, style }: GexChurnHistoryProps) {
  // Newest first: on a log page the reader is looking at a selected session and
  // works backwards from it, not forwards from three weeks ago.
  const shown = [...rows].reverse().slice(0, limit);

  return (
    <div
      style={{
        padding: "12px 18px",
        borderTop: `1px solid ${HOME_THEME.border}`,
        display: "flex",
        flexDirection: "column",
        gap: 8,
        ...style,
      }}
    >
      <div style={{ display: "flex", alignItems: "baseline", gap: 10, flexWrap: "wrap" }}>
        <span style={{ fontSize: 13, fontWeight: 800, letterSpacing: "0.14em", textTransform: "uppercase", color: HOME_THEME.text }}>
          Gamma book churn
        </span>
        <span style={{ fontSize: 11, color: HOME_THEME.text }}>
          {symbol ? `how much of ${symbol}'s book rewrote itself, session by session` : "pick a ticker"}
        </span>
      </div>

      {loading ? (
        <div style={{ fontSize: 12, color: HOME_THEME.text }}>Loading…</div>
      ) : !symbol ? null : !shown.length ? (
        <div style={{ fontSize: 12, lineHeight: 1.6, color: HOME_THEME.text }}>
          {note || `Nothing on file for ${symbol}.`}
        </div>
      ) : (
        <>
          <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
            {shown.map((r) => {
              const { frac, provisional } = heatFill(r);
              const color = buildShareColor(r.buildShare);
              const flag = r.isOpex ? "OPEX" : r.isEarnings ? "ERN" : null;
              return (
                <div key={r.date} style={{ display: "flex", alignItems: "center", gap: 9 }}>
                  <span
                    style={{
                      fontSize: 11,
                      fontFamily: "var(--font-mono)",
                      color: HOME_THEME.text,
                      width: 46,
                      flex: "0 0 auto",
                    }}
                  >
                    {r.date.slice(5)}
                  </span>

                  <div
                    title={
                      `${r.date} — ${Math.round(r.churnPct)}% of the book changed` +
                      (r.heat != null ? `, ${r.heat.toFixed(1)}× a normal day` : " (no baseline yet)") +
                      ` · build share ${r.buildShare.toFixed(2)}` +
                      (flag ? ` · ${flag}` : "")
                    }
                    style={{
                      position: "relative",
                      flex: 1,
                      height: 8,
                      borderRadius: 8,
                      overflow: "hidden",
                      background: themeRgba(HOME_THEME.muted, 0.06),
                      backgroundImage: provisional
                        ? `repeating-linear-gradient(135deg, ${themeRgba(HOME_THEME.muted, 0.05)} 0 4px, transparent 4px 8px)`
                        : undefined,
                      // A dirty session is dimmed rather than dropped: it still
                      // happened, it just never sets the scale.
                      opacity: r.clean === false ? 0.45 : 1,
                    }}
                  >
                    <div
                      style={{
                        width: `${frac * 100}%`,
                        height: "100%",
                        background: `linear-gradient(90deg, ${buildShareColor(r.buildShare, 0.55)}, ${color})`,
                      }}
                    />
                  </div>

                  <span
                    style={{
                      fontSize: 11,
                      fontFamily: "var(--font-mono)",
                      fontWeight: 700,
                      color,
                      width: 54,
                      textAlign: "right",
                      flex: "0 0 auto",
                    }}
                  >
                    {r.heat != null ? `${r.heat.toFixed(1)}×` : `${Math.round(r.churnPct)}%`}
                  </span>

                  <span
                    style={{
                      fontSize: 9,
                      letterSpacing: 0.5,
                      width: 34,
                      flex: "0 0 auto",
                      color: HOME_THEME.text,
                    }}
                  >
                    {flag || ""}
                  </span>
                </div>
              );
            })}
          </div>

          {note && (
            <div style={{ fontSize: 10, lineHeight: 1.5, color: HOME_THEME.text }}>{note}</div>
          )}
        </>
      )}
    </div>
  );
}

export default GexHeatBar;
