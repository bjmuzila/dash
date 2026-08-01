"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties } from "react";
import { HOME_THEME, LIGHT_BLUE, REFRESH_GREEN, SOFT_RED, statTileStyle, homeButtonStyle } from "@/components/shared/homeTheme";
import { Card } from "@/components/shared/PageCard";
import { ThemedSelect } from "@/components/shared/ThemedSelect";

// ─────────────────────────────────────────────────────────────────────────────
// Test Lab → GEX Map tab.
//
// Four ways of fusing the same five layers — net GEX profile, strike×time
// heatmap, the strike rail, GEX bubbles, and DEX — into ONE readout, all fed by
// a single GET /api/gex-map payload (0DTE only; the route pins expiry = date).
//
//   A · Tape Field      time-forward radar. Heat is the field, profile is the
//                       left wall, rail is the right edge, DEX is the keel.
//   B · Polar Reticle   spot at the centre; strikes fan out by distance.
//   C · Spine           vertical ladder, gamma on the left wing, delta on the
//                       right, heat living inside the spine.
//   D · Gamma Terrain   gamma as elevation, iso-GEX contours, flip as coastline.
//
// Three things this file is deliberately careful about:
//
//   1. NOTHING IS INVENTED. Every layer draws only what the payload contains.
//      When DEX is missing for a session the DEX layers render an explicit
//      "no data" state — they do not fall back to zero, because a flat DEX ring
//      and an absent DEX ring mean opposite things on a positioning map.
//   2. Bubbles ride SPOT, not fixed strikes. One bubble per sampled slot,
//      anchored at that slot's traded price, sized by |GEX| at the strike price
//      was actually sitting on. That is the whole point of the layer: how much
//      gamma the tape is standing in, over time.
//   3. Scales are computed ONCE, from the full session, and shared by all four
//      maps. Per-map normalization would make the same book look calm in one
//      concept and violent in the next.
// ─────────────────────────────────────────────────────────────────────────────

// ── payload ──────────────────────────────────────────────────────────────────
type MapColumn = { t: number; spot: number; flip: number | null; v: number[] };
type MapSession = { date: string; expiry: string; snaps: number };
type MapPayload = {
  symbol: string;
  date: string;
  expiry: string;
  slotMin: number;
  strikes: number[];
  columns: MapColumn[];
  /** Volume-only GEX summed across strikes, per slot — the home page's series. */
  volSeries?: { t: number; vol: number }[];
  dexByStrike: { strike: number; dex: number }[];
  dexSeries: { t: number; dex: number }[];
  /** Slot-aligned DEX ladder — present only when recorded alongside gamma. */
  dexColumns?: { t: number; d: number[] }[];
  dexSource?: "option_strike_gex_history" | "greek_snapshots" | "none";
  levels: {
    spot: number; flip: number | null;
    callWall: number | null; putWall: number | null; magnet: number | null;
    netGex: number; netDex: number; asOf: number | null;
  };
  sessions: MapSession[];
  expiries?: { expiry: string; snaps: number; dte: number }[];
  notes: { gex?: string; dex?: string; expiry?: string };
  error?: string;
};

type Concept = "tape" | "reticle" | "spine" | "terrain";

const CONCEPTS: { key: Concept; label: string; blurb: string }[] = [
  { key: "tape", label: "Tape Field", blurb: "Time-forward radar — DEX profile left, GEX profile right, Vol GEX keel." },
  { key: "reticle", label: "Polar Reticle", blurb: "Spot-centred dial — strikes fan out, session clock on the rim." },
  { key: "spine", label: "Spine", blurb: "Vertical ladder — delta left wing, gamma right wing, heat inside." },
  { key: "terrain", label: "Gamma Terrain", blurb: "Gamma as elevation — iso-GEX contours, flip as coastline." },
];

// ── formatting ───────────────────────────────────────────────────────────────
function fmtBn(v: number | null | undefined): string {
  if (!Number.isFinite(v as number)) return "—";
  const n = v as number;
  const a = Math.abs(n);
  const s = n < 0 ? "-" : "+";
  if (a >= 1e8) return `${s}$${(a / 1e9).toFixed(2)}bn`;
  if (a >= 1e5) return `${s}$${(a / 1e6).toFixed(1)}M`;
  if (a >= 1e3) return `${s}$${(a / 1e3).toFixed(0)}K`;
  return `${s}$${a.toFixed(0)}`;
}
const fmtStrike = (v: number | null | undefined) =>
  Number.isFinite(v as number) ? String(Math.round(v as number)) : "—";
const fmtSpot = (v: number | null | undefined) =>
  Number.isFinite(v as number) && (v as number) > 0 ? (v as number).toFixed(2) : "—";
function etTime(ms: number | null | undefined): string {
  if (!Number.isFinite(ms as number)) return "—";
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York", hour12: false, hour: "2-digit", minute: "2-digit",
  }).format(new Date(ms as number));
}

// ── color ────────────────────────────────────────────────────────────────────
// ── palette ──────────────────────────────────────────────────────────────────
// NOT re-picked here. Every value below is lifted from a GEX surface this app
// already ships, so the maps read as the same instrument as the panels beside
// them:
//
//   GEX sign      GexHeatmap.cellBg() → rgba(41,182,246) positive,
//                 rgba(255,71,87) negative. The options chain uses the same two
//                 (#29b6f6 / #ff4757), so this is the house convention for
//                 "gamma, signed" and the one thing that must not drift.
//   magnitude     GexChart lightens a bar toward white in proportion to |GEX|
//                 (`lift = 0.28 * t`). Same curve here, so a big node looks big
//                 on the map for the same reason it does on the chart.
//   peak / magnet GexHeatmap boxes the highest |NET GEX| strike in #ffd700.
//   flip / accent LIGHT_BLUE + HOME_THEME.cyan out of homeTheme.
//
// DEX is the one place this deliberately does NOT copy the heatmap. There, DEX
// is a separate COLUMN, so reusing the blue/red ramp is unambiguous. Here GEX
// and DEX are layers of one picture, and painting both blue/red would make the
// DEX ring unreadable against the gamma under it — so DEX keeps homeTheme's
// up/down role colors (REFRESH_GREEN / SOFT_RED), which is the same pairing the
// options chain uses for directional values.
type RGB = [number, number, number];
const GEX_POS: RGB = [41, 182, 246];   // #29b6f6
const GEX_NEG: RGB = [255, 71, 87];    // #ff4757
const WHITE: RGB = [255, 255, 255];
const DEX_POS: RGB = [31, 217, 138];   // REFRESH_GREEN
const DEX_NEG: RGB = [244, 148, 142];  // SOFT_RED

const GEX_POS_HEX = "#29b6f6";
const GEX_NEG_HEX = "#ff4757";
/** GexHeatmap's peak box. Reused for the magnet (highest |GEX| node). */
const GOLD = "#ffd700";

const mix = (a: number[], b: number[], t: number): [number, number, number] => [
  Math.round(a[0] + (b[0] - a[0]) * t),
  Math.round(a[1] + (b[1] - a[1]) * t),
  Math.round(a[2] + (b[2] - a[2]) * t),
];
const rgba = (c: number[], a: number) => `rgba(${c[0]},${c[1]},${c[2]},${a})`;
/**
 * Signed gamma → color. v is already normalized to [-1, 1]. Hue is fixed by
 * sign (never interpolated between the two — a mid-magnitude cell must not read
 * as a different quantity), magnitude rides the alpha plus GexChart's 28% lift
 * toward white.
 */
function gamColor(v: number, alpha?: number): string {
  const m = Math.min(1, Math.abs(v));
  const c = mix(v >= 0 ? GEX_POS : GEX_NEG, WHITE, m * 0.28);
  return rgba(c, alpha === undefined ? heatAlpha(m, 0.08, 0.86) : alpha);
}
/**
 * Alpha for a heat cell. GexHeatmap eases its ramp `ratio ** 1.4` before mapping
 * to alpha; the same curve is used here so a mid-strength strike reads mid on
 * both surfaces. It also matters more on a full-bleed field than in a table:
 * linear alpha turns the whole below-flip half into a solid block of #ff4757,
 * where the eased curve keeps only the real nodes hot.
 */
const heatAlpha = (h: number, lo: number, hi: number) => lo + hi * Math.pow(Math.min(1, Math.max(0, h)), 1.4);

function dexColor(v: number, a?: number): string {
  const m = Math.min(1, Math.abs(v));
  return rgba(v >= 0 ? DEX_POS : DEX_NEG, a === undefined ? 0.2 + 0.75 * m : a);
}

// ── model ────────────────────────────────────────────────────────────────────
type Bubble = { ci: number; price: number; strike: number; g: number; n: number; sign: 1 | -1 };

type MapModel = {
  ok: boolean;
  strikes: number[];
  lo: number;
  hi: number;
  cols: MapColumn[];
  /** last column, normalized to ±1 */
  profile: number[];
  /** raw last column, for tooltips/labels */
  profileRaw: number[];
  gMax: number;
  /** heat[colIdx][strikeIdx] in 0..1, normalized on the session max */
  heat: number[][];
  /** signed, normalized per cell — heat magnitude carrying the gamma sign */
  signed: number[][];
  path: number[];
  bubbles: Bubble[];
  dex: number[];
  dexRaw: number[];
  dMax: number;
  hasDex: boolean;
  /** True only when DEX was recorded slot-for-slot with gamma. */
  dexSurface: boolean;
  dexSource: string;
  dexSeries: { t: number; dex: number }[];
  dtMax: number;
  /** Net Vol GEX per slot + its scale. */
  volSeries: { t: number; vol: number }[];
  vtMax: number;
  /** Per-strike Δ net GEX vs ~15 min ago, normalized, + the lag actually used. */
  chg15: number[];
  chg15Min: number;
  hasChg15: boolean;
  spot: number;
  flip: number | null;
  callWall: number | null;
  putWall: number | null;
  magnet: number | null;
  netGex: number;
  netDex: number;
};

function buildModel(p: MapPayload | null): MapModel | null {
  if (!p || !Array.isArray(p.strikes) || !p.strikes.length || !p.columns?.length) return null;
  const strikes = p.strikes;
  const cols = p.columns;
  const n = strikes.length;

  // Session-wide gamma scale. One number for every map and every column, so the
  // heat, the profile bars and the rail all mean the same thing.
  let gMax = 0;
  for (const c of cols) for (const v of c.v) { const a = Math.abs(v); if (a > gMax) gMax = a; }
  if (!(gMax > 0)) gMax = 1;

  const heat: number[][] = [];
  const signed: number[][] = [];
  for (const c of cols) {
    const h = new Array(n);
    const s = new Array(n);
    for (let i = 0; i < n; i++) {
      const v = c.v[i] ?? 0;
      const m = Math.min(1, Math.abs(v) / gMax);
      h[i] = m;
      s[i] = v >= 0 ? m : -m;
    }
    heat.push(h);
    signed.push(s);
  }

  const lastRaw = cols[cols.length - 1].v;
  const profile = lastRaw.map((v) => Math.max(-1, Math.min(1, v / gMax)));

  // Spot path. A slot with no spot (legacy rows) inherits the previous one
  // rather than dropping to zero and drawing a spike through the floor.
  const path: number[] = [];
  let lastSpot = 0;
  for (const c of cols) {
    if (c.spot > 0) lastSpot = c.spot;
    path.push(lastSpot);
  }
  for (let i = 0; i < path.length && path[i] <= 0; i++) {
    const firstGood = path.find((v) => v > 0) ?? 0;
    path[i] = firstGood;
  }

  const nearestIdx = (price: number) => {
    let best = 0, bd = Infinity;
    for (let i = 0; i < n; i++) { const d = Math.abs(strikes[i] - price); if (d < bd) { bd = d; best = i; } }
    return best;
  };

  // Bubbles ride spot: one per sampled slot, at that slot's price, sized by the
  // gamma at the strike price was sitting on.
  const step = Math.max(1, Math.round(cols.length / 16));
  const bubbles: Bubble[] = [];
  for (let ci = 0; ci < cols.length; ci += step) {
    const price = path[ci];
    if (!(price > 0)) continue;
    const si = nearestIdx(price);
    const g = signed[ci][si];
    bubbles.push({
      ci, price, strike: strikes[si], g,
      n: Math.min(1, 0.1 + 1.5 * Math.abs(g) + 0.3 * heat[ci][si]),
      sign: g >= 0 ? 1 : -1,
    });
  }
  if (bubbles.length && bubbles[bubbles.length - 1].ci !== cols.length - 1) {
    const ci = cols.length - 1, price = path[ci];
    if (price > 0) {
      const si = nearestIdx(price);
      const g = signed[ci][si];
      bubbles.push({ ci, price, strike: strikes[si], g, n: Math.min(1, 0.1 + 1.5 * Math.abs(g) + 0.3 * heat[ci][si]), sign: g >= 0 ? 1 : -1 });
    }
  }

  // DEX aligned to the same ladder. Absent → hasDex false, and every DEX layer
  // renders its own empty state instead of a flat ring.
  //
  // When dexColumns is present the DEX ladder was written in the SAME row as
  // gamma, so it is already index-aligned to `strikes` and scaled on the whole
  // session — the same treatment gamma gets. dexByStrike is the fallback shape
  // from greek_snapshots: a last-snapshot ladder keyed by strike.
  const dexCols = p.dexColumns ?? [];
  const dexSurface = dexCols.length === cols.length && dexCols.length > 0;
  const dexRaw = new Array(n).fill(0);
  let dMax = 0, dexCount = 0;
  if (dexSurface) {
    // Scale on the session, not the last column, so the ring does not rescale
    // itself every refresh as the book fills in.
    for (const c of dexCols) for (const v of c.d) { const a = Math.abs(v); if (a > dMax) dMax = a; }
    const lastD = dexCols[dexCols.length - 1].d;
    for (let i = 0; i < n; i++) { dexRaw[i] = lastD[i] ?? 0; if (dexRaw[i] !== 0) dexCount++; }
  } else {
    const byStrike = new Map((p.dexByStrike ?? []).map((r) => [r.strike, r.dex]));
    for (let i = 0; i < n; i++) {
      const v = byStrike.get(strikes[i]);
      if (v == null) continue;
      dexRaw[i] = v;
      dexCount++;
      if (Math.abs(v) > dMax) dMax = Math.abs(v);
    }
  }
  if (!(dMax > 0)) dMax = 1;
  const dex = dexRaw.map((v) => Math.max(-1, Math.min(1, v / dMax)));

  const dexSeries = p.dexSeries ?? [];
  let dtMax = 0;
  for (const d of dexSeries) if (Math.abs(d.dex) > dtMax) dtMax = Math.abs(d.dex);
  if (!(dtMax > 0)) dtMax = 1;

  const volSeries = p.volSeries ?? [];
  let vtMax = 0;
  for (const v of volSeries) if (Math.abs(v.vol) > vtMax) vtMax = Math.abs(v.vol);
  if (!(vtMax > 0)) vtMax = 1;

  // Δ net GEX over ~15 minutes, per strike. The comparison column is chosen by
  // TIMESTAMP, not by counting slots back — recording gaps are routine, and
  // "15 slots ago" silently becomes 40 minutes ago the moment the feed stalls.
  // If nothing sits far enough back, this reports no change rather than
  // comparing against the open and calling it 15 minutes.
  const lastT = cols[cols.length - 1].t;
  const wantT = lastT - 15 * 60_000;
  let baseIdx = -1, bestDt = Infinity;
  for (let i = 0; i < cols.length - 1; i++) {
    const dt = Math.abs(cols[i].t - wantT);
    if (dt < bestDt) { bestDt = dt; baseIdx = i; }
  }
  const lagMin = baseIdx >= 0 ? (lastT - cols[baseIdx].t) / 60_000 : 0;
  const hasChg15 = baseIdx >= 0 && lagMin >= 5;
  const chg15 = new Array(n).fill(0);
  if (hasChg15) {
    const a = cols[baseIdx].v, b = cols[cols.length - 1].v;
    let cMax = 0;
    for (let i = 0; i < n; i++) { const d = (b[i] ?? 0) - (a[i] ?? 0); chg15[i] = d; if (Math.abs(d) > cMax) cMax = Math.abs(d); }
    if (cMax > 0) for (let i = 0; i < n; i++) chg15[i] = Math.max(-1, Math.min(1, chg15[i] / cMax));
  }

  return {
    ok: true,
    strikes, lo: strikes[0], hi: strikes[n - 1], cols,
    profile, profileRaw: lastRaw, gMax, heat, signed, path, bubbles,
    dex, dexRaw, dMax, hasDex: dexCount > 0 || dexSeries.length > 0, dexSeries, dtMax,
    volSeries, vtMax, chg15, chg15Min: Math.round(lagMin), hasChg15,
    dexSurface, dexSource: p.dexSource ?? (dexCount > 0 ? "greek_snapshots" : "none"),
    spot: p.levels.spot, flip: p.levels.flip,
    callWall: p.levels.callWall, putWall: p.levels.putWall, magnet: p.levels.magnet,
    netGex: p.levels.netGex, netDex: p.levels.netDex,
  };
}

// ── shared chrome ────────────────────────────────────────────────────────────
const AXIS = "rgba(255,255,255,0.34)";
const GRID = "rgba(255,255,255,0.05)";
/** Gamma flip. LIGHT_BLUE out of homeTheme — not a literal, per the theme rule. */
const FLIP_C = LIGHT_BLUE;

// Every map is drawn in a fixed 1240-wide viewBox. In the 2×2 grid each one
// renders at roughly half that, which would put 8px labels at ~4px — present but
// unreadable, which is worse than absent. So type is scaled UP in compact mode
// and the densest secondary layers are dropped entirely; expanding a card to
// full width restores both. One context rather than threading a prop through
// every <text> in four components.
const FzCtx = createContext(1);
const useFz = () => useContext(FzCtx);

function Lab({ x, y, children, size = 8, fill = "rgba(255,255,255,0.34)", anchor }: {
  x: number; y: number; children: string; size?: number; fill?: string; anchor?: "start" | "middle" | "end";
}) {
  const fz = useFz();
  return (
    <text x={x} y={y} fill={fill} fontSize={size * fz} fontWeight={700} letterSpacing="0.14em" textAnchor={anchor}>
      {children}
    </text>
  );
}

function RegimeStrip({ m, symbol, date, expiryLabel, asOf }: {
  m: MapModel; symbol: string; date: string; expiryLabel: string; asOf: number | null;
}) {
  const cells: { label: string; value: string; tone: string; sub: string }[] = [
    {
      label: "Net gamma", value: fmtBn(m.netGex),
      tone: m.netGex >= 0 ? GEX_POS_HEX : GEX_NEG_HEX,
      sub: m.netGex >= 0 ? "long gamma · dealers dampen" : "short gamma · dealers amplify",
    },
    {
      label: "Gamma flip", value: fmtStrike(m.flip), tone: FLIP_C,
      sub: m.flip == null ? "no sign change on the ladder"
        : m.spot > m.flip ? "spot above · vol suppressed" : "spot below · vol amplified",
    },
    {
      label: "Net DEX", value: m.hasDex ? fmtBn(m.netDex) : "no data",
      tone: !m.hasDex ? HOME_THEME.muted : m.netDex >= 0 ? REFRESH_GREEN : SOFT_RED,
      sub: !m.hasDex ? "greek_snapshots empty for this session"
        : m.netDex >= 0 ? "dealers short delta · buy dips" : "dealers long delta · sell rips",
    },
    { label: "Call wall", value: fmtStrike(m.callWall), tone: GEX_POS_HEX, sub: "largest +γ above spot" },
    { label: "Put wall", value: fmtStrike(m.putWall), tone: GEX_NEG_HEX, sub: "largest −γ below spot" },
    { label: "Magnet", value: fmtStrike(m.magnet), tone: GOLD, sub: "highest |GEX| node" },
  ];
  return (
    <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "stretch" }}>
      <div style={{ ...statTileStyle, padding: "12px 16px", minWidth: 168, flex: "0 0 auto" }}>
        <div style={{ fontSize: 11, fontWeight: 800, letterSpacing: "0.14em", textTransform: "uppercase", color: HOME_THEME.muted, opacity: 0.5 }}>
          {symbol.replace(/^\$/, "")} · {expiryLabel}
        </div>
        <div style={{ fontSize: 26, fontWeight: 800, marginTop: 2, color: HOME_THEME.text, fontVariantNumeric: "tabular-nums" }}>{fmtSpot(m.spot)}</div>
        <div style={{ fontSize: 11, color: HOME_THEME.text, opacity: 0.5, marginTop: 2 }}>
          {date} · {asOf ? `${etTime(asOf)} ET` : "—"}
        </div>
      </div>
      {cells.map((c) => (
        <div key={c.label} style={{ ...statTileStyle, padding: "12px 16px", minWidth: 150, flex: 1 }}>
          <div style={{ fontSize: 11, fontWeight: 800, letterSpacing: "0.14em", textTransform: "uppercase", color: HOME_THEME.muted, opacity: 0.5 }}>
            {c.label}
          </div>
          <div style={{ fontSize: 22, fontWeight: 800, marginTop: 2, color: c.tone, fontVariantNumeric: "tabular-nums" }}>{c.value}</div>
          <div style={{ fontSize: 10.5, color: HOME_THEME.text, opacity: 0.4, marginTop: 2 }}>{c.sub}</div>
        </div>
      ))}
    </div>
  );
}

function NoDex({ x, y, w, h }: { x: number; y: number; w: number; h: number }) {
  const fz = useFz();
  return (
    <g>
      <rect x={x} y={y} width={w} height={h} rx={8} fill="rgba(255,255,255,0.012)" stroke={HOME_THEME.border} strokeDasharray="4 4" />
      <text x={x + w / 2} y={y + h / 2 + 3} fill={HOME_THEME.muted} opacity={0.45} fontSize={10 * fz} fontWeight={700}
        letterSpacing="0.14em" textAnchor="middle">NO DEX FOR THIS SESSION</text>
    </g>
  );
}

// ═════════════════════════ A · TAPE FIELD ════════════════════════════════════
function TapeField({ m, compact }: { m: MapModel; compact?: boolean }) {
  const fz = useFz();
  const W = 1240, H = 470;
  const PX = 24, PW = 118;
  const FX = PX + PW + 46, FW = 742;
  const RX = FX + FW + 14, RW = 138;
  const FY = 20, FH = 320;
  const KY = FY + FH + 40, KH = 66;

  const yOf = (k: number) => FY + FH - ((k - m.lo) / Math.max(1, m.hi - m.lo)) * FH;
  const xOf = (i: number) => FX + (i / Math.max(1, m.cols.length - 1)) * FW;
  const cw = FW / Math.max(1, m.cols.length);
  const ch = FH / Math.max(1, m.strikes.length - 1);

  const ticks = strikeTicks(m.lo, m.hi, compact);
  const timeTicks = pickTimeTicks(m.cols, compact ? 4 : 6);

  return (
    <svg viewBox={`0 0 ${W} ${H}`} style={{ width: "100%", display: "block" }} preserveAspectRatio="xMidYMid meet">
      {/* heat field */}
      <rect x={FX - 4} y={FY - 4} width={FW + 8} height={FH + 8} rx={10} fill="rgba(0,0,0,0.30)" />
      {m.cols.map((c, ci) =>
        m.strikes.map((k, si) => {
          const h = m.heat[ci][si];
          if (h < 0.045) return null;
          return <rect key={`${ci}-${si}`} x={xOf(ci) - cw / 2} y={yOf(k) - ch / 2} width={cw + 0.6} height={ch + 0.6}
            fill={gamColor(m.signed[ci][si], heatAlpha(h, 0.04, 0.80))} />;
        })
      )}
      {ticks.map((k) => <line key={`g${k}`} x1={FX} y1={yOf(k)} x2={FX + FW} y2={yOf(k)} stroke={GRID} />)}

      {/* walls + flip */}
      {([[m.callWall, GEX_POS_HEX, "CALL WALL"], [m.magnet, GOLD, "MAGNET"], [m.putWall, GEX_NEG_HEX, "PUT WALL"]] as [number | null, string, string][])
        .filter(([k]) => k != null).map(([k, col, label]) => (
          <g key={label}>
            <rect x={FX} y={yOf(k as number) - 4} width={FW} height={8} fill={col} opacity={0.11} />
            <line x1={FX} y1={yOf(k as number)} x2={FX + FW} y2={yOf(k as number)} stroke={col} strokeWidth={0.9} opacity={0.5} />
          </g>
        ))}
      {m.flip != null && (
        <g>
          <line x1={FX} y1={yOf(m.flip)} x2={FX + FW} y2={yOf(m.flip)} stroke={FLIP_C} strokeWidth={1.2} strokeDasharray="5 4" opacity={0.75} />
          <rect x={FX + 4} y={yOf(m.flip) - 6 - 12 * fz} width={106 * fz} height={13 * fz} rx={3} fill="rgba(5,6,10,0.86)" />
          <text x={FX + 9} y={yOf(m.flip) - 8 - 2 * fz} fill={FLIP_C} fontSize={8 * fz} fontWeight={700} letterSpacing="0.1em">
            {`GAMMA FLIP ${fmtStrike(m.flip)}`}
          </text>
        </g>
      )}

      {/* bubbles ride spot, drawn UNDER the path */}
      {m.bubbles.map((b, i) => {
        const r = 3.5 + b.n * 15;
        const c = b.sign > 0 ? GEX_POS : GEX_NEG;
        const last = i === m.bubbles.length - 1;
        return (
          <g key={`b${b.ci}`}>
            <circle cx={xOf(b.ci)} cy={yOf(b.price)} r={r} fill={rgba(c, last ? 0.24 : 0.13)}
              stroke={rgba(c, last ? 0.95 : 0.66)} strokeWidth={last ? 1.6 : 1} />
            <circle cx={xOf(b.ci)} cy={yOf(b.price)} r={1.5} fill={rgba(c, 0.92)} />
          </g>
        );
      })}

      {/* spot path */}
      <path d={pathD(m.path.map((p, i) => [xOf(i), yOf(p)]))} fill="none" stroke="rgba(255,255,255,0.30)" strokeWidth={4.5} strokeLinejoin="round" />
      <path d={pathD(m.path.map((p, i) => [xOf(i), yOf(p)]))} fill="none" stroke="#fff" strokeWidth={1.6} strokeLinejoin="round" />
      <circle cx={xOf(m.cols.length - 1)} cy={yOf(m.path[m.path.length - 1])} r={9} fill="rgba(255,255,255,0.14)" />
      <circle cx={xOf(m.cols.length - 1)} cy={yOf(m.path[m.path.length - 1])} r={3.4} fill="#fff" />
      {timeTicks.map(({ i, label }) => (
        <text key={`t${i}`} x={xOf(i)} y={FY + FH + 14} fill={AXIS} fontSize={8 * fz} textAnchor="middle" opacity={0.75}>{label}</text>
      ))}

      {/* left gutter — DEX profile */}
      <Lab x={PX} y={FY - 8}>NET DEX PROFILE</Lab>
      {m.hasDex ? (
        <g>
          <line x1={PX + PW} y1={FY} x2={PX + PW} y2={FY + FH} stroke="rgba(255,255,255,0.22)" />
          {m.strikes.map((k, i) => {
            const v = m.dex[i];
            const w = Math.abs(v) * (PW - 4);
            if (w < 0.4) return null;
            return <rect key={`p${k}`} x={PX + PW - w} y={yOf(k) - ch * 0.42} width={w} height={Math.max(1.4, ch * 0.84)} rx={1}
              fill={dexColor(v, 0.26 + 0.52 * Math.abs(v))} />;
          })}
        </g>
      ) : <NoDex x={PX} y={FY} w={PW} h={FH} />}

      {/* right rail — GEX profile + the strike ladder */}
      <Lab x={RX} y={FY - 8}>NET GEX PROFILE</Lab>
      <rect x={RX} y={FY} width={RW} height={FH} rx={8} fill="rgba(255,255,255,0.02)" stroke="rgba(255,255,255,0.07)" />
      {m.strikes.map((k, i) => {
        const v = m.profile[i];
        return <rect key={`r${k}`} x={RX + 6} y={yOf(k) - ch * 0.42} width={Math.abs(v) * 26 + 1.5} height={Math.max(1.4, ch * 0.84)} rx={1}
          fill={gamColor(v, 0.3 + 0.55 * Math.abs(v))} />;
      })}
      {/* Tick numbers are dropped in the grid: at 1.7× type the wall badges grow
          into the same column, and the badges already carry those strikes. */}
      {ticks.map((k) => (
        <g key={`rt${k}`}>
          <line x1={RX + 34} y1={yOf(k)} x2={RX + 40} y2={yOf(k)} stroke="rgba(255,255,255,0.18)" />
          {!compact && <text x={RX + 96} y={yOf(k) + 3} fill={AXIS} fontSize={8}>{k}</text>}
        </g>
      ))}
      {([[m.callWall, GEX_POS_HEX, "CW"], [m.magnet, GOLD, "MG"], [m.flip, FLIP_C, "FL"], [m.putWall, GEX_NEG_HEX, "PW"]] as [number | null, string, string][])
        .filter(([k]) => k != null).map(([k, col, tag]) => (
          <g key={tag}>
            <rect x={RX + 42} y={yOf(k as number) - 7 * fz} width={50 * fz} height={14 * fz} rx={3} fill={`${col}26`} stroke={`${col}80`} />
            <text x={RX + 46} y={yOf(k as number) + 3.5 * fz} fill={col} fontSize={7.4 * fz} fontWeight={700}>{`${tag} ${fmtStrike(k)}`}</text>
          </g>
        ))}
      {m.spot > 0 && (
        <g>
          <polygon points={`${RX - 2},${yOf(m.spot)} ${RX - 11},${yOf(m.spot) - 5} ${RX - 11},${yOf(m.spot) + 5}`} fill="#fff" />
          <line x1={RX} y1={yOf(m.spot)} x2={RX + RW} y2={yOf(m.spot)} stroke="#fff" opacity={0.5} />
        </g>
      )}

      {/* Net Vol GEX keel — the same series the home page's Vol GEX Flow draws,
          read straight off net_vol_gex rather than re-derived from the OI+Vol
          composite, so the two panels can never disagree. */}
      <Lab x={FX} y={KY - 8}>NET VOL GEX · SESSION</Lab>
      {m.volSeries.length > 1 ? (
        <g>
          <rect x={FX - 4} y={KY} width={FW + 8} height={KH} rx={10} fill="rgba(255,255,255,0.018)" stroke="rgba(255,255,255,0.07)" />
          <line x1={FX} y1={KY + KH / 2} x2={FX + FW} y2={KY + KH / 2} stroke="rgba(255,255,255,0.16)" />
          {m.volSeries.map((d, i) => {
            const x = FX + (i / Math.max(1, m.volSeries.length - 1)) * FW;
            const r = d.vol / m.vtMax;
            const y = KY + KH / 2 - r * (KH / 2 - 7);
            const bw = Math.max(1.2, FW / m.volSeries.length - 0.6);
            return <rect key={`k${i}`} x={x - bw / 2} y={Math.min(KY + KH / 2, y)} width={bw}
              height={Math.abs(KY + KH / 2 - y)} fill={gamColor(r, 0.3 + 0.5 * Math.min(1, Math.abs(r)))} />;
          })}
        </g>
      ) : <NoDex x={FX - 4} y={KY} w={FW + 8} h={KH} />}

      {/* Δ net GEX over the last ~15 minutes, by strike — where the book moved,
          not where it stands. Diverging off a centre line so a build and a drain
          at the same strike are distinguishable at a glance. */}
      <Lab x={RX} y={KY - 8}>{m.hasChg15 ? `NET GEX Δ · ${m.chg15Min}m` : "NET GEX Δ · 15m"}</Lab>
      {m.hasChg15 ? (
        <g>
          <rect x={RX} y={KY} width={RW} height={KH} rx={8} fill="rgba(255,255,255,0.018)" stroke="rgba(255,255,255,0.07)" />
          <line x1={RX + RW / 2} y1={KY + 5} x2={RX + RW / 2} y2={KY + KH - 5} stroke="rgba(255,255,255,0.14)" />
          {m.strikes.map((k, i) => {
            const v = m.chg15[i];
            if (Math.abs(v) < 0.02) return null;
            const dh = (KH - 12) / m.strikes.length;
            const half = RW / 2 - 8;
            return <rect key={`ck${k}`} x={v >= 0 ? RX + RW / 2 : RX + RW / 2 + v * half} y={KY + 6 + i * dh}
              width={Math.abs(v) * half} height={Math.max(0.8, dh - 0.4)} fill={gamColor(v, 0.35 + 0.5 * Math.abs(v))} />;
          })}
        </g>
      ) : (
        <g>
          <rect x={RX} y={KY} width={RW} height={KH} rx={8} fill="rgba(255,255,255,0.012)" stroke={HOME_THEME.border} strokeDasharray="4 4" />
          <text x={RX + RW / 2} y={KY + KH / 2 + 3} fill={HOME_THEME.muted} opacity={0.45} fontSize={10 * fz}
            fontWeight={700} letterSpacing="0.14em" textAnchor="middle">NOT ENOUGH HISTORY</text>
        </g>
      )}
    </svg>
  );
}

// ═════════════════════════ B · POLAR RETICLE ═════════════════════════════════
function PolarReticle({ m, compact }: { m: MapModel; compact?: boolean }) {
  const fz = useFz();
  const W = 1240, H = 660;
  const CX = compact ? 600 : 380, CY = 336;
  const R0 = 58, R1 = 98, R2 = 176, R3 = 196;
  const RAIL = R3 + 34, TRACK = RAIL + 40, BAND = 13;
  const span = Math.max(1, m.hi - m.lo);

  // bearing = strike, spot at the top, 300° of sweep
  const ang = (k: number) => ((-90 + ((k - m.spot) / span) * 300) * Math.PI) / 180;
  const P = (r: number, a: number): [number, number] => [CX + Math.cos(a) * r, CY + Math.sin(a) * r];
  const arcPath = (r: number, a0: number, a1: number) => {
    const [x0, y0] = P(r, a0), [x1, y1] = P(r, a1);
    return `M${x0} ${y0}A${r} ${r} 0 0 1 ${x1} ${y1}`;
  };

  const step = m.strikes.length > 1 ? m.strikes[1] - m.strikes[0] : 5;
  const ringCount = Math.min(10, m.cols.length);
  const rw = (R2 - R1) / Math.max(1, ringCount);
  const ticks = strikeTicks(m.lo, m.hi, compact);

  // bearing = TIME on the outer band
  const aT = (ci: number) => ((-90 + (ci / Math.max(1, m.cols.length - 1)) * 330) * Math.PI) / 180;
  const rT = (ci: number) => {
    if (m.flip == null || !(m.path[ci] > 0)) return TRACK;
    return TRACK + Math.max(-BAND, Math.min(BAND, ((m.path[ci] - m.flip) / 34) * BAND));
  };
  const clockTicks = pickTimeTicks(m.cols, compact ? 4 : 6);

  return (
    <svg viewBox={`0 0 ${W} ${H}`} style={{ width: "100%", display: "block" }} preserveAspectRatio="xMidYMid meet">
      {/* heat rings — inner = open, outer = now */}
      {Array.from({ length: ringCount }, (_, r) => {
        const ci = Math.round((r / Math.max(1, ringCount - 1)) * (m.cols.length - 1));
        const ri = R1 + r * rw;
        return m.strikes.map((k, si) => {
          const h = m.heat[ci][si];
          if (h < 0.06) return null;
          const a0 = ang(k - step / 2), a1 = ang(k + step / 2);
          const [x0, y0] = P(ri, a0), [x1, y1] = P(ri + rw - 0.7, a0);
          const [x2, y2] = P(ri + rw - 0.7, a1), [x3, y3] = P(ri, a1);
          return <path key={`h${r}-${si}`}
            d={`M${x0} ${y0}L${x1} ${y1}A${ri + rw} ${ri + rw} 0 0 1 ${x2} ${y2}L${x3} ${y3}A${ri} ${ri} 0 0 0 ${x0} ${y0}Z`}
            fill={gamColor(m.signed[ci][si], heatAlpha(h, 0.04, 0.72))} />;
        });
      })}

      {/* spokes = net GEX */}
      {m.strikes.map((k, i) => {
        const v = m.profile[i];
        if (Math.abs(v) < 0.02) return null;
        const a = ang(k);
        const [x0, y0] = P(R2 + 3, a), [x1, y1] = P(R2 + 3 + Math.abs(v) * 30, a);
        return <line key={`s${k}`} x1={x0} y1={y0} x2={x1} y2={y1}
          stroke={rgba(mix(v >= 0 ? GEX_POS : GEX_NEG, WHITE, Math.abs(v) * 0.28), 0.32 + 0.55 * Math.abs(v))} strokeWidth={3.2} strokeLinecap="round" />;
      })}

      {/* rail ring */}
      <circle cx={CX} cy={CY} r={RAIL} fill="none" stroke="rgba(255,255,255,0.09)" />
      {ticks.map((k) => {
        const a = ang(k);
        const [x0, y0] = P(RAIL, a), [x1, y1] = P(RAIL + 7, a), [tx, ty] = P(RAIL + 18, a);
        return (
          <g key={`rt${k}`}>
            <line x1={x0} y1={y0} x2={x1} y2={y1} stroke="rgba(255,255,255,0.24)" />
            <text x={tx} y={ty + 3} fill={AXIS} fontSize={8 * fz} textAnchor="middle">{k}</text>
          </g>
        );
      })}
      {([[m.callWall, GEX_POS_HEX, "CALL WALL"], [m.magnet, GOLD, "MAGNET"], [m.putWall, GEX_NEG_HEX, "PUT WALL"]] as [number | null, string, string][])
        .filter(([k]) => k != null).map(([k, col, label]) => {
          const w = span * 0.04;
          const [lx, ly] = P(RAIL + 92, ang(k as number));
          return (
            <g key={label}>
              <path d={arcPath(RAIL, ang((k as number) - w), ang((k as number) + w))} fill="none" stroke={col} strokeWidth={5} opacity={0.75} strokeLinecap="round" />
              <text x={lx} y={ly + 3} fill={col} fontSize={7.6 * fz} fontWeight={700} letterSpacing="0.1em" textAnchor="middle">{label}</text>
            </g>
          );
        })}
      {m.flip != null && (() => {
        const a = ang(m.flip);
        const [x0, y0] = P(R1 - 8, a), [x1, y1] = P(RAIL + 12, a), [tx, ty] = P(RAIL + 84, a);
        return (
          <g>
            <line x1={x0} y1={y0} x2={x1} y2={y1} stroke={FLIP_C} strokeWidth={1.3} strokeDasharray="5 4" opacity={0.85} />
            <text x={tx} y={ty} fill={FLIP_C} fontSize={8 * fz} fontWeight={700} textAnchor="middle">{`FLIP ${fmtStrike(m.flip)}`}</text>
          </g>
        );
      })()}

      {/* session clock — bearing is TIME here, not strike */}
      <circle cx={CX} cy={CY} r={TRACK} fill="none" stroke="rgba(125,211,252,0.30)" strokeDasharray="4 5" />
      {clockTicks.map(({ i, label }) => {
        const a = aT(i);
        const [x0, y0] = P(TRACK - BAND - 6, a), [x1, y1] = P(TRACK + BAND + 6, a), [tx, ty] = P(TRACK + BAND + 22, a);
        return (
          <g key={`ct${i}`}>
            <line x1={x0} y1={y0} x2={x1} y2={y1} stroke="rgba(255,255,255,0.10)" />
            <text x={tx} y={ty + 3} fill={AXIS} fontSize={7.2 * fz} fontWeight={600} textAnchor="middle" opacity={0.85}>{label}</text>
          </g>
        );
      })}
      <path d={pathD(m.cols.map((_, ci) => P(rT(ci), aT(ci))))} fill="none" stroke="rgba(255,255,255,0.30)" strokeWidth={1.2} />
      {m.bubbles.map((b, i) => {
        const [x, y] = P(rT(b.ci), aT(b.ci));
        const c = b.sign > 0 ? GEX_POS : GEX_NEG;
        const last = i === m.bubbles.length - 1;
        const r = 3 + b.n * 11;
        return (
          <g key={`cb${b.ci}`}>
            <circle cx={x} cy={y} r={r} fill={rgba(c, last ? 0.28 : 0.15)} stroke={rgba(c, last ? 0.95 : 0.66)} strokeWidth={last ? 1.6 : 1} />
            <circle cx={x} cy={y} r={1.4} fill={rgba(c, 0.92)} />
            {last && <>
              <circle cx={x} cy={y} r={r + 7} fill="none" stroke={rgba(c, 0.4)} strokeDasharray="2 3" />
              <text x={x} y={y + r + 18} fill={rgba(c, 0.92)} fontSize={7.4 * fz} fontWeight={700} letterSpacing="0.1em" textAnchor="middle">SPOT NOW</text>
            </>}
          </g>
        );
      })}

      {/* inner DEX ring */}
      {m.hasDex ? (
        <g>
          <circle cx={CX} cy={CY} r={(R0 + R1) / 2} fill="none" stroke="rgba(255,255,255,0.06)" strokeWidth={R1 - R0 - 14} />
          {m.strikes.map((k, i) => {
            const v = m.dex[i];
            if (Math.abs(v) < 0.03) return null;
            const dr = (R0 + R1) / 2, dw = R1 - R0 - 14;
            return <path key={`dx${k}`} d={arcPath(dr, ang(k - step / 2), ang(k + step / 2))} fill="none"
              stroke={dexColor(v, 0.22 + 0.62 * Math.abs(v))} strokeWidth={dw * Math.min(1, 0.35 + 0.65 * Math.abs(v))} />;
          })}
        </g>
      ) : (
        <circle cx={CX} cy={CY} r={(R0 + R1) / 2} fill="none" stroke="rgba(255,255,255,0.07)"
          strokeWidth={R1 - R0 - 14} strokeDasharray="3 5" />
      )}

      {/* core */}
      <circle cx={CX} cy={CY} r={R0 - 14} fill="rgba(5,6,10,0.94)" stroke="rgba(255,255,255,0.10)" />
      <text x={CX} y={CY - 12} fill={HOME_THEME.muted} opacity={0.4} fontSize={7.6 * fz} fontWeight={700} letterSpacing="0.16em" textAnchor="middle">SPOT</text>
      <text x={CX} y={CY + 9} fill="#fff" fontSize={20 * fz} fontWeight={800} textAnchor="middle">{fmtSpot(m.spot)}</text>

      {/* ring map — dropped in the grid, where it would render at ~5px */}
      {!compact && <Lab x={780} y={38}>RING MAP</Lab>}
      {!compact && [
        ["INNER RING", m.hasDex ? "DEX by strike — green = dealers short delta" : "DEX unavailable for this session"],
        ["BAND RINGS", `heatmap — ${ringCount} time slices, oldest inside`],
        ["SPOKES", "net GEX magnitude by strike"],
        ["RAIL", "strike ticks, wall arcs, flip gate"],
        ["OUTER BAND", "SESSION CLOCK — bearing is TIME, not strike"],
        ["· dashed ring", "the gamma flip. outside it = spot above flip"],
        ["· bubbles", "GEX at spot — size = |GEX| the tape is standing in"],
      ].map(([a, b], i) => (
        <text key={a} x={780} y={60 + i * 17} fill="rgba(255,255,255,0.4)" fontSize={9.5}>
          {`· ${a}  —  ${b}`}
        </text>
      ))}
    </svg>
  );
}

// ═════════════════════════════ C · SPINE ═════════════════════════════════════
function Spine({ m, compact }: { m: MapModel; compact?: boolean }) {
  const fz = useFz();
  const W = 1240, H = 560;
  // The spine is 2/3 of the card width; the two wings split what's left, minus a
  // 44px gutter each side for the strike labels.
  const SPW = Math.round((W * 2) / 3);      // 827
  const SPX = Math.round((W - SPW) / 2);    // 206
  const GUT = 44;
  const TY = 26, TH = 470;
  const yOf = (k: number) => TY + TH - ((k - m.lo) / Math.max(1, m.hi - m.lo)) * TH;
  const rowH = TH / Math.max(1, m.strikes.length - 1);
  const nb = Math.min(m.cols.length, 24);
  const c0 = m.cols.length - nb;
  const cw = SPW / nb;
  const LW = SPX - GUT, LWW = LW - 12;              // left wing: DEX, grows leftward
  const RW = SPX + SPW + GUT, RWW = W - RW - 12;   // right wing: GEX, grows rightward
  const ticks = strikeTicks(m.lo, m.hi, compact);

  return (
    <svg viewBox={`0 0 ${W} ${H}`} style={{ width: "100%", display: "block" }} preserveAspectRatio="xMidYMid meet">
      {/* spine heat */}
      <Lab x={SPX} y={TY - 8}>{compact ? `HEAT · LAST ${nb}` : `SPINE · STRIKE × TIME HEAT (LAST ${nb} SLOTS)`}</Lab>
      <rect x={SPX} y={TY} width={SPW} height={TH} rx={10} fill="rgba(0,0,0,0.30)" stroke="rgba(255,255,255,0.07)" />
      {Array.from({ length: nb }, (_, t) => {
        const ci = c0 + t;
        return m.strikes.map((k, si) => {
          const h = m.heat[ci][si];
          if (h < 0.05) return null;
          return <rect key={`sh${t}-${si}`} x={SPX + t * cw} y={yOf(k) - rowH / 2} width={cw + 0.5} height={rowH + 0.5}
            fill={gamColor(m.signed[ci][si], heatAlpha(h, 0.03, 0.78))} />;
        });
      })}
      <path d={pathD(Array.from({ length: nb }, (_, t) => [SPX + t * cw + cw / 2, yOf(m.path[c0 + t])]))}
        fill="none" stroke="rgba(255,255,255,0.28)" strokeWidth={4} />
      <path d={pathD(Array.from({ length: nb }, (_, t) => [SPX + t * cw + cw / 2, yOf(m.path[c0 + t])]))}
        fill="none" stroke="#fff" strokeWidth={1.4} />

      {/* walls + flip across the spine */}
      {([[m.callWall, GEX_POS_HEX, "CALL WALL"], [m.magnet, GOLD, "MAGNET"], [m.putWall, GEX_NEG_HEX, "PUT WALL"]] as [number | null, string, string][])
        .filter(([k]) => k != null).map(([k, col, label]) => (
          <g key={label}>
            <rect x={SPX} y={yOf(k as number) - 5} width={SPW} height={10} fill={col} opacity={0.13} />
            <line x1={SPX} y1={yOf(k as number)} x2={SPX + SPW} y2={yOf(k as number)} stroke={col} opacity={0.55} />
            {/* Dark pill behind the label: the wall colors ARE the heat colors,
                so a bare put-wall label is red text on a red field. */}
            <rect x={SPX + 5} y={yOf(k as number) - 8 - 11 * fz} width={(label.length * 5.6 + 34) * fz}
              height={13 * fz} rx={3} fill="rgba(5,6,10,0.72)" />
            <text x={SPX + 9} y={yOf(k as number) - 8 - 2 * fz} fill={col} fontSize={7.6 * fz} fontWeight={700} letterSpacing="0.12em">
              {`${label} · ${fmtStrike(k)}`}
            </text>
          </g>
        ))}
      {m.flip != null && (
        <g>
          <line x1={SPX} y1={yOf(m.flip)} x2={SPX + SPW} y2={yOf(m.flip)} stroke={FLIP_C} strokeDasharray="5 4" strokeWidth={1.2} />
          <text x={SPX + SPW - 8} y={yOf(m.flip) + 13} fill={FLIP_C} fontSize={7.8 * fz} fontWeight={700} letterSpacing="0.12em" textAnchor="end">
            {`FLIP ${fmtStrike(m.flip)}`}
          </text>
        </g>
      )}

      {/* bubbles pinned to the path inside the spine */}
      {m.bubbles.filter((b) => b.ci >= c0).map((b, i, arr) => {
        const bx = SPX + (b.ci - c0 + 0.5) * cw;
        const c = b.sign > 0 ? GEX_POS : GEX_NEG;
        const last = i === arr.length - 1;
        const r = 3 + b.n * 13;
        return (
          <g key={`sb${b.ci}`}>
            <circle cx={bx} cy={yOf(b.price)} r={r} fill={rgba(c, last ? 0.26 : 0.13)} stroke={rgba(c, last ? 0.95 : 0.66)} strokeWidth={last ? 1.5 : 1} />
            <circle cx={bx} cy={yOf(b.price)} r={1.5} fill={rgba(c, 0.9)} />
          </g>
        );
      })}

      {/* spot cursor */}
      {m.spot > 0 && (
        <g>
          <line x1={LW - LWW} y1={yOf(m.spot)} x2={RW + RWW} y2={yOf(m.spot)} stroke="#fff" opacity={0.3} strokeDasharray="2 3" />
          <rect x={SPX + SPW / 2 - 42 * fz} y={yOf(m.spot) - 11 * fz} width={84 * fz} height={22 * fz} rx={5} fill="rgba(5,6,10,0.9)" stroke="rgba(255,255,255,0.45)" />
          <text x={SPX + SPW / 2} y={yOf(m.spot) + 4.5 * fz} fill="#fff" fontSize={11 * fz} fontWeight={700} textAnchor="middle">{fmtSpot(m.spot)}</text>
        </g>
      )}

      {/* left wing — DEX */}
      <Lab x={LW - LWW} y={TY - 8}>◄ NET DEX</Lab>
      {m.hasDex ? (
        <g>
          <line x1={LW} y1={TY} x2={LW} y2={TY + TH} stroke="rgba(255,255,255,0.14)" />
          {m.strikes.map((k, i) => {
            const v = m.dex[i];
            const w = Math.abs(v) * LWW;
            if (w < 0.4) return null;
            return <rect key={`lw${k}`} x={LW - w} y={yOf(k) - rowH * 0.4} width={w} height={Math.max(1.4, rowH * 0.8)} rx={1.5}
              fill={dexColor(v, 0.24 + 0.55 * Math.abs(v))} />;
          })}
          {!compact && (
            <text x={LW - LWW} y={TY + TH + 20} fill="rgba(255,255,255,0.34)" fontSize={9}>
              bar length = |DEX| · green = dealers short delta · rose = dealers long delta
            </text>
          )}
        </g>
      ) : <NoDex x={LW - LWW} y={TY} w={LWW} h={TH} />}
      {ticks.map((k) => <text key={`lt${k}`} x={SPX - 8} y={yOf(k) + 3} fill={AXIS} fontSize={8.4 * fz} textAnchor="end">{k}</text>)}

      {/* right wing — GEX */}
      <Lab x={RW} y={TY - 8}>NET GEX ►</Lab>
      <line x1={RW} y1={TY} x2={RW} y2={TY + TH} stroke="rgba(255,255,255,0.14)" />
      {m.strikes.map((k, i) => {
        const v = m.profile[i];
        const w = Math.abs(v) * RWW;
        if (w < 0.4) return null;
        return <rect key={`rw${k}`} x={RW} y={yOf(k) - rowH * 0.4} width={w} height={Math.max(1.4, rowH * 0.8)} rx={1.5}
          fill={rgba(mix(v >= 0 ? GEX_POS : GEX_NEG, WHITE, Math.abs(v) * 0.28), 0.26 + 0.55 * Math.abs(v))} />;
      })}
      {ticks.map((k) => <text key={`rt${k}`} x={SPX + SPW + 8} y={yOf(k) + 3} fill={AXIS} fontSize={8.4 * fz}>{k}</text>)}
      {!compact && (
        <text x={RW} y={TY + TH + 20} fill="rgba(255,255,255,0.34)" fontSize={9}>
          bar length = |GEX| · blue = long gamma (dealers dampen) · red = short gamma (dealers amplify)
        </text>
      )}
    </svg>
  );
}

// ═════════════════════════ D · GAMMA TERRAIN ═════════════════════════════════
function GammaTerrain({ m, compact }: { m: MapModel; compact?: boolean }) {
  const fz = useFz();
  const W = 1240, H = 520;
  const L = 34, R = W - 210, TP = 26, BT = H - 52;
  const FWD = R - L, FHT = BT - TP;
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  const yOf = (k: number) => TP + FHT - ((k - m.lo) / Math.max(1, m.hi - m.lo)) * FHT;
  const xOf = (i: number) => L + (i / Math.max(1, m.cols.length - 1)) * FWD;
  const ticks = strikeTicks(m.lo, m.hi, compact);
  const timeTicks = pickTimeTicks(m.cols, compact ? 4 : 6);
  const rowH = FHT / Math.max(1, m.strikes.length - 1);

  // Terrain fill + iso-GEX contours. Canvas rather than SVG: this is a per-pixel
  // field, and 200×140 <rect>s per frame is not a chart, it is a memory leak.
  useEffect(() => {
    const cv = canvasRef.current;
    if (!cv) return;
    const DPR = 2;
    cv.width = Math.round(FWD * DPR);
    cv.height = Math.round(FHT * DPR);
    const ctx = cv.getContext("2d");
    if (!ctx) return;
    const NX = Math.min(220, Math.max(40, m.cols.length * 4));
    const NY = Math.min(180, Math.max(40, m.strikes.length * 2));

    // Resample the (slot × strike) grid onto a smooth field. Bilinear in time,
    // gaussian in strike — the strike axis is the coarse one (5-point ladder),
    // and nearest-neighbour there produces stair-stepped contours.
    const F: number[][] = [];
    const sig = Math.max(1.2, (m.hi - m.lo) / Math.max(1, m.strikes.length) * 1.4);
    for (let j = 0; j < NY; j++) {
      const k = m.hi - ((m.hi - m.lo) * j) / (NY - 1);
      const row: number[] = [];
      for (let i = 0; i < NX; i++) {
        const ct = (i / (NX - 1)) * (m.cols.length - 1);
        const c0 = Math.floor(ct), c1 = Math.min(m.cols.length - 1, c0 + 1), fr = ct - c0;
        let acc = 0, wsum = 0;
        for (let s = 0; s < m.strikes.length; s++) {
          const d = m.strikes[s] - k;
          const w = Math.exp(-(d * d) / (2 * sig * sig));
          if (w < 0.02) continue;
          acc += (m.signed[c0][s] * (1 - fr) + m.signed[c1][s] * fr) * w;
          wsum += w;
        }
        row.push(wsum > 0 ? acc / wsum : 0);
      }
      F.push(row);
    }
    let fmax = 0;
    for (const r of F) for (const v of r) fmax = Math.max(fmax, Math.abs(v));
    if (fmax > 0) for (const r of F) for (let i = 0; i < r.length; i++) r[i] /= fmax;

    const img = ctx.createImageData(cv.width, cv.height);
    for (let y = 0; y < cv.height; y++) {
      for (let x = 0; x < cv.width; x++) {
        const fx = (x / (cv.width - 1)) * (NX - 1), fy = (y / (cv.height - 1)) * (NY - 1);
        const x0 = Math.floor(fx), y0 = Math.floor(fy);
        const x1 = Math.min(NX - 1, x0 + 1), y1 = Math.min(NY - 1, y0 + 1);
        const ax = fx - x0, ay = fy - y0;
        const v = F[y0][x0] * (1 - ax) * (1 - ay) + F[y0][x1] * ax * (1 - ay) + F[y1][x0] * (1 - ax) * ay + F[y1][x1] * ax * ay;
        // Hypsometric banding: quantized elevation reads as a contour map,
        // a continuous ramp reads as a blurry heatmap.
        const mag = Math.min(1, Math.floor(Math.min(1, Math.abs(v)) * 9) / 9 + 0.055);
        const t2 = Math.pow(mag, 1.15);
        const c = v >= 0
          ? mix([5, 12, 20], mix(GEX_POS, WHITE, mag * 0.28), t2)
          : mix([22, 8, 11], mix(GEX_NEG, WHITE, mag * 0.28), t2);
        const o = (y * cv.width + x) * 4;
        img.data[o] = c[0]; img.data[o + 1] = c[1]; img.data[o + 2] = c[2]; img.data[o + 3] = 255;
      }
    }
    ctx.putImageData(img, 0, 0);

    // Marching squares for the iso-GEX lines, including the zero contour, which
    // IS the gamma flip drawn as a coastline rather than a straight line.
    const sx = (i: number) => (i / (NX - 1)) * cv.width;
    const sy = (j: number) => (j / (NY - 1)) * cv.height;
    const contour = (level: number, stroke: string, wid: number, dash: number[]) => {
      ctx.beginPath();
      for (let j = 0; j < NY - 1; j++) {
        for (let i = 0; i < NX - 1; i++) {
          const a = F[j][i], b = F[j][i + 1], c = F[j + 1][i + 1], d = F[j + 1][i];
          const idx = (a > level ? 8 : 0) | (b > level ? 4 : 0) | (c > level ? 2 : 0) | (d > level ? 1 : 0);
          if (idx === 0 || idx === 15) continue;
          const ip = (v1: number, v2: number, X1: number, Y1: number, X2: number, Y2: number): [number, number] => {
            const t = (level - v1) / ((v2 - v1) || 1e-6);
            return [X1 + (X2 - X1) * t, Y1 + (Y2 - Y1) * t];
          };
          const T = ip(a, b, sx(i), sy(j), sx(i + 1), sy(j));
          const Rr = ip(b, c, sx(i + 1), sy(j), sx(i + 1), sy(j + 1));
          const B = ip(d, c, sx(i), sy(j + 1), sx(i + 1), sy(j + 1));
          const Lf = ip(a, d, sx(i), sy(j), sx(i), sy(j + 1));
          const seg: Record<number, [[number, number], [number, number]]> = {
            1: [Lf, B], 2: [B, Rr], 3: [Lf, Rr], 4: [T, Rr], 5: [T, Lf], 6: [T, B], 7: [T, Lf],
            8: [T, Lf], 9: [T, B], 10: [T, Rr], 11: [T, Rr], 12: [Lf, Rr], 13: [B, Rr], 14: [Lf, B],
          };
          const s = seg[idx];
          if (!s) continue;
          ctx.moveTo(s[0][0], s[0][1]); ctx.lineTo(s[1][0], s[1][1]);
        }
      }
      ctx.strokeStyle = stroke; ctx.lineWidth = wid; ctx.setLineDash(dash); ctx.stroke(); ctx.setLineDash([]);
    };
    for (const lv of [-0.75, -0.55, -0.38, -0.24, -0.13, -0.06, 0.06, 0.13, 0.24, 0.38, 0.55, 0.75, 0.9]) {
      contour(lv, lv > 0
        ? `rgba(190,232,255,${0.10 + 0.24 * Math.abs(lv)})`
        : `rgba(255,183,190,${0.10 + 0.24 * Math.abs(lv)})`, 1.6, []);
    }
    contour(0, "rgba(125,211,252,0.95)", 3.2, [12, 8]);
  }, [m, FWD, FHT]);

  return (
    <div style={{ position: "relative", width: "100%" }}>
      <svg viewBox={`0 0 ${W} ${H}`} style={{ width: "100%", display: "block" }} preserveAspectRatio="xMidYMid meet">
        <foreignObject x={L} y={TP} width={FWD} height={FHT}>
          <canvas ref={canvasRef} style={{ width: "100%", height: "100%", display: "block", borderRadius: 6 }} />
        </foreignObject>
        <rect x={L} y={TP} width={FWD} height={FHT} fill="none" stroke="rgba(255,255,255,0.10)" />

        {/* DEX current — direction and force of dealer hedging, by strike band */}
        {m.hasDex && Array.from({ length: 9 }, (_, j) => {
          const k = m.lo + ((m.hi - m.lo) * (j + 0.5)) / 9;
          let bi = 0, bd = Infinity;
          m.strikes.forEach((s, i) => { const d = Math.abs(s - k); if (d < bd) { bd = d; bi = i; } });
          const v = m.dex[bi];
          if (Math.abs(v) < 0.03) return null;
          return Array.from({ length: 7 }, (_, i) => {
            const x = L + 40 + ((FWD - 80) * i) / 6, y = yOf(k);
            const len = 14 + Math.abs(v) * 32, dir = v >= 0 ? 1 : -1;
            const col = dexColor(v, 0.2 + 0.42 * Math.abs(v));
            const tip = dir > 0 ? x + len / 2 : x - len / 2;
            return (
              <g key={`fa${j}-${i}`}>
                <line x1={x - len / 2} y1={y} x2={x + len / 2} y2={y} stroke={col} strokeWidth={1.5} strokeLinecap="round" />
                <polygon points={`${tip},${y} ${tip - dir * 5.5},${y - 3.2} ${tip - dir * 5.5},${y + 3.2}`} fill={col} />
              </g>
            );
          });
        })}
        <Lab x={L + 4} y={TP - 8}>
          {m.hasDex ? "DEALER DELTA CURRENT · arrow = direction of hedging flow" : "DEALER DELTA CURRENT · no DEX for this session"}
        </Lab>

        {/* spot path */}
        <path d={pathD(m.path.map((p, i) => [xOf(i), yOf(p)]))} fill="none" stroke="rgba(0,0,0,0.45)" strokeWidth={5.5} />
        <path d={pathD(m.path.map((p, i) => [xOf(i), yOf(p)]))} fill="none" stroke="rgba(255,255,255,0.35)" strokeWidth={3.4} />
        <path d={pathD(m.path.map((p, i) => [xOf(i), yOf(p)]))} fill="none" stroke="#fff" strokeWidth={1.5} />
        {m.bubbles.map((b, i) => {
          const c = b.sign > 0 ? GEX_POS : GEX_NEG;
          const last = i === m.bubbles.length - 1;
          const r = 3.5 + b.n * 14;
          return (
            <g key={`tb${b.ci}`}>
              <circle cx={xOf(b.ci)} cy={yOf(b.price)} r={r} fill={rgba(c, last ? 0.22 : 0.1)} stroke={rgba(c, last ? 0.95 : 0.72)} strokeWidth={last ? 1.6 : 1.1} />
              <circle cx={xOf(b.ci)} cy={yOf(b.price)} r={1.6} fill={rgba(c, 0.95)} />
            </g>
          );
        })}
        {m.flip != null && (
          <g>
            <rect x={L + 6} y={yOf(m.flip) + 5} width={(compact ? 118 : 186) * fz} height={14 * fz} rx={3} fill="rgba(5,6,10,0.84)" />
            <text x={L + 11} y={yOf(m.flip) + 5 + 10 * fz} fill={FLIP_C} fontSize={8 * fz} fontWeight={700} letterSpacing="0.1em">
              {compact ? `FLIP ${fmtStrike(m.flip)}` : `GAMMA FLIP  ${fmtStrike(m.flip)}  ·  COASTLINE`}
            </text>
          </g>
        )}
        {timeTicks.map(({ i, label }) => (
          <text key={`tt${i}`} x={xOf(i)} y={BT + 16} fill={AXIS} fontSize={8 * fz} textAnchor="middle" opacity={0.75}>{label}</text>
        ))}

        {/* ridge rail */}
        <Lab x={R + 16} y={TP - 8}>RIDGE RAIL</Lab>
        <rect x={R + 16} y={TP} width={150} height={FHT} rx={8} fill="rgba(255,255,255,0.02)" stroke="rgba(255,255,255,0.07)" />
        {m.strikes.map((k, i) => {
          const v = m.profile[i];
          return <rect key={`rr${k}`} x={R + 22} y={yOf(k) - rowH * 0.42} width={Math.abs(v) * 34 + 1.5} height={Math.max(1.2, rowH * 0.84)} rx={1}
            fill={gamColor(v, 0.3 + 0.55 * Math.abs(v))} />;
        })}
        {ticks.map((k) => <text key={`rrt${k}`} x={R + 74} y={yOf(k) + 3} fill={AXIS} fontSize={8 * fz}>{k}</text>)}
        {([[m.callWall, GEX_POS_HEX, "RIDGE"], [m.magnet, GOLD, "PEAK"], [m.flip, FLIP_C, "COAST"], [m.putWall, GEX_NEG_HEX, "TRENCH"]] as [number | null, string, string][])
          .filter(([k]) => k != null).map(([k, col, tag]) => (
            <g key={tag}>
              <rect x={R + 106} y={yOf(k as number) - 7 * fz} width={54 * fz} height={14 * fz} rx={3} fill={`${col}26`} stroke={`${col}80`} />
              <text x={R + 111} y={yOf(k as number) + 3.5 * fz} fill={col} fontSize={7.4 * fz} fontWeight={700} letterSpacing="0.08em">{tag}</text>
            </g>
          ))}
        {m.spot > 0 && (
          <polygon points={`${R + 14},${yOf(m.spot)} ${R + 5},${yOf(m.spot) - 5} ${R + 5},${yOf(m.spot) + 5}`} fill="#fff" />
        )}
        {!compact && (
          <text x={L} y={H - 12} fill="rgba(255,255,255,0.3)" fontSize={8} fontWeight={600} letterSpacing="0.14em">
            ELEVATION = NET GAMMA · CONTOURS = ISO-GEX · DASHED COASTLINE = ZERO GAMMA
          </text>
        )}
      </svg>
    </div>
  );
}

// ── geometry helpers ─────────────────────────────────────────────────────────
function pathD(pts: [number, number][]): string {
  return pts.map(([x, y], i) => `${i ? "L" : "M"}${x.toFixed(1)} ${y.toFixed(1)}`).join("");
}

/**
 * Round strike labels — every 20 points if the range is wide, else every 10/5.
 * `sparse` halves the density for the 2×2 grid, where the full set collides.
 */
function strikeTicks(lo: number, hi: number, sparse = false): number[] {
  const span = hi - lo;
  const base = span > 400 ? 50 : span > 200 ? 20 : span > 90 ? 10 : 5;
  const step = sparse ? base * 2 : base;
  const out: number[] = [];
  for (let k = Math.ceil(lo / step) * step; k <= hi; k += step) out.push(k);
  return out;
}

function pickTimeTicks(cols: MapColumn[], count = 6): { i: number; label: string }[] {
  if (!cols.length) return [];
  const out: { i: number; label: string }[] = [];
  for (let n = 0; n < count; n++) {
    const i = Math.round((n / (count - 1)) * (cols.length - 1));
    out.push({ i, label: etTime(cols[i].t) });
  }
  return out;
}

// ── tab ──────────────────────────────────────────────────────────────────────
/**
 * One map in the 2×2 grid. Clicking the header spans it across both columns and
 * turns compact mode off — the grid is for comparing the four at a glance, the
 * expanded card is for reading one of them.
 */
function MapCard({ def, m, expanded, onToggle }: {
  def: (typeof CONCEPTS)[number];
  m: MapModel;
  expanded: boolean;
  onToggle: () => void;
}) {
  const Body = def.key === "tape" ? TapeField
    : def.key === "reticle" ? PolarReticle
    : def.key === "spine" ? Spine
    : GammaTerrain;
  return (
    <Card variant="budget" padding={16} style={expanded ? { gridColumn: "1 / -1" } : undefined}>
      <button
        type="button"
        onClick={onToggle}
        title={expanded ? "Collapse back into the grid" : "Expand to full width"}
        style={{
          display: "flex", alignItems: "baseline", gap: 10, width: "100%",
          background: "none", border: "none", padding: 0, marginBottom: 10,
          cursor: "pointer", textAlign: "left", color: HOME_THEME.text,
        }}
      >
        <span style={{ fontSize: 13, fontWeight: 800, letterSpacing: "0.12em", textTransform: "uppercase" }}>
          {def.label}
        </span>
        <span style={{ fontSize: 11, color: HOME_THEME.text, opacity: 0.45, flex: 1, minWidth: 0 }}>
          {def.blurb}
        </span>
        <span style={{ fontSize: 10, fontWeight: 800, letterSpacing: "0.1em", color: HOME_THEME.cyan, flexShrink: 0 }}>
          {expanded ? "COLLAPSE" : "EXPAND"}
        </span>
      </button>
      <FzCtx.Provider value={expanded ? 1 : 1.7}>
        <Body m={m} compact={!expanded} />
      </FzCtx.Provider>
    </Card>
  );
}

export default function GexMapTab() {
  const [expanded, setExpanded] = useState<Concept | null>(null);
  const [date, setDate] = useState<string>("latest");
  // "front" = let the route pick (0DTE if it exists). Reset whenever the session
  // changes, because an expiry that had rows on Thursday is meaningless on
  // Friday and pinning it would silently blank the map.
  const [expiry, setExpiry] = useState<string>("front");
  const [data, setData] = useState<MapPayload | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async (d: string, x: string) => {
    setLoading(true);
    try {
      const r = await fetch(
        `/api/gex-map?symbol=$SPX&date=${encodeURIComponent(d)}&expiry=${encodeURIComponent(x)}`,
        { cache: "no-store" }
      );
      if (!r.ok) throw new Error(`gex-map ${r.status}`);
      const j = (await r.json()) as MapPayload;
      if (j.error) throw new Error(j.error);
      setData(j);
      setErr(null);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(date, expiry); }, [date, expiry, load]);

  const model = useMemo(() => buildModel(data), [data]);

  const sessionOptions = useMemo(() => {
    // sessions is one row per (date, expiry) now, so collapse to distinct dates
    // and sum the snapshots across that session's expiries.
    const byDate = new Map<string, number>();
    for (const s of data?.sessions ?? []) byDate.set(s.date, (byDate.get(s.date) ?? 0) + s.snaps);
    const opts = [...byDate.entries()]
      .sort((a, b) => (a[0] < b[0] ? 1 : -1))
      .map(([d, snaps]) => ({ value: d, label: `${d} · ${snaps} snaps` }));
    return [{ value: "latest", label: "Latest session" }, ...opts];
  }, [data]);

  const expiryOptions = useMemo(() => {
    const opts = (data?.expiries ?? []).map((e) => ({
      value: e.expiry,
      label: `${e.expiry}  ·  ${e.dte === 0 ? "0DTE" : `${e.dte > 0 ? "+" : ""}${e.dte}DTE`}  ·  ${e.snaps} snaps`,
    }));
    return [{ value: "front", label: "0DTE / front expiry" }, ...opts];
  }, [data]);

  return (
    <>
      <style>{`
        .gexmap-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 20px; align-items: start; }
        @media (max-width: 1180px) { .gexmap-grid { grid-template-columns: minmax(0, 1fr); } }
      `}</style>
      <Card variant="budget" padding={18}>
        <div style={{ display: "flex", gap: 14, flexWrap: "wrap", alignItems: "center" }}>
          <div style={{ minWidth: 200 }}>
            <ThemedSelect
              value={date}
              ariaLabel="Session"
              onChange={(v: string) => { setDate(v); setExpiry("front"); }}
              options={sessionOptions}
            />
          </div>
          <div style={{ minWidth: 240 }}>
            <ThemedSelect
              value={expiry}
              ariaLabel="Expiration"
              onChange={(v: string) => setExpiry(v)}
              options={expiryOptions}
            />
          </div>
          <button type="button" onClick={() => void load(date, expiry)} style={homeButtonStyle}>Refresh</button>
          {expanded && (
            <button type="button" onClick={() => setExpanded(null)} style={homeButtonStyle}>Back to 2×2</button>
          )}
          <div style={{ fontSize: 12, color: HOME_THEME.text, opacity: 0.6, flex: 1, minWidth: 220 }}>
            All four readouts, same session, same scales — click any card header to expand it.
          </div>
        </div>
        <div style={{ fontSize: 11.5, color: HOME_THEME.text, opacity: 0.45, marginTop: 10, lineHeight: 1.6 }}>
          One expiry at a time — never a blend. Defaults to 0DTE. GEX ladder from{" "}
          <code style={{ color: LIGHT_BLUE }}>option_strike_gex_history</code> (retention ~2 sessions), DEX from{" "}
          <code style={{ color: LIGHT_BLUE }}>net_dex</code> in the same row (added{" "}
          {new Date(2026, 7, 1).toLocaleDateString("en-US", { month: "short", day: "numeric" })}; sessions before that
          fall back to <code style={{ color: LIGHT_BLUE }}>greek_snapshots</code>, last-snapshot ladder only). Bubbles
          ride spot: one per slot, sized by |GEX| at the strike price was trading on.
        </div>
      </Card>

      {err && (
        <Card variant="budget" padding={16}>
          <div style={{ fontSize: 14, color: HOME_THEME.red }}>GEX map error: {err}</div>
        </Card>
      )}

      {(data?.notes?.gex || data?.notes?.dex || data?.notes?.expiry) && (
        <Card variant="budget" padding={14}>
          {data?.notes?.expiry && <div style={{ fontSize: 12.5, color: HOME_THEME.orange }}>Expiry: {data.notes.expiry}</div>}
          {data?.notes?.gex && <div style={{ fontSize: 12.5, color: HOME_THEME.orange, marginTop: 4 }}>GEX: {data.notes.gex}</div>}
          {data?.notes?.dex && <div style={{ fontSize: 12.5, color: HOME_THEME.orange, marginTop: 4 }}>DEX: {data.notes.dex}</div>}
        </Card>
      )}

      {model && data && (
        <RegimeStrip
          m={model}
          symbol={data.symbol}
          date={data.date}
          expiryLabel={data.expiry === data.date ? "0DTE" : `exp ${data.expiry}`}
          asOf={data.levels.asOf}
        />
      )}

      {loading && !model ? (
        <Card variant="budget" padding={20}>
          <div style={{ fontSize: 14, color: HOME_THEME.text, opacity: 0.6, padding: 40, textAlign: "center" }}>
            Loading 0DTE map…
          </div>
        </Card>
      ) : !model ? (
        <Card variant="budget" padding={20}>
          <div style={{ fontSize: 14, color: HOME_THEME.text, opacity: 0.6, padding: 40, textAlign: "center" }}>
            No strike ladder for this session — nothing to draw.
          </div>
        </Card>
      ) : (
        // Hard 2×2. `auto-fit` was wrong here — on a wide monitor it fits three
        // across and the layout stops being the 2×2 it is supposed to be. The
        // only responsive behaviour wanted is a single column once two side by
        // side are unreadable at any type scale, which needs a media query, so
        // this carries its own <style> rather than faking it with auto-fit.
        <div className="gexmap-grid">
          {CONCEPTS.map((def) => (
            <MapCard
              key={def.key}
              def={def}
              m={model}
              expanded={expanded === def.key}
              onToggle={() => setExpanded((e) => (e === def.key ? null : def.key))}
            />
          ))}
        </div>
      )}

      {model && data && (
        <div style={{ fontSize: 11.5, color: HOME_THEME.text, opacity: 0.4, lineHeight: 1.7 }}>
          {data.symbol} · {data.date} exp {data.expiry} · {data.columns.length} slots @ {data.slotMin}m ·{" "}
          {data.strikes.length} strikes ({fmtStrike(model.lo)}–{fmtStrike(model.hi)}) ·{" "}
          {model.hasDex
            ? `${data.dexSeries.length} DEX snapshots (${model.dexSurface ? "strike×time, recorded with gamma" : "last-snapshot ladder"})`
            : "no DEX"} · gamma scale {fmtBn(model.gMax)} per strike
        </div>
      )}
    </>
  );
}
