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
export function heatFill(row: GexGrossRow): { frac: number; provisional: boolean } {
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

export default GexHeatBar;
