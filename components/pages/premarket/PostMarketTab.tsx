"use client";

/**
 * /premarket → POST-MARKET tab. LIVE, and derived from the same feed the
 * Premarket tab uses — no second socket, no duplicated math.
 *
 * The premarket tab answers "what is the map before the open". This one answers
 * the three questions that only exist after the close:
 *
 *   1. Did the morning map hold?      → snapshot + level scorecard
 *   2. What changed inside the day?   → GEX evolution + flow/positioning
 *   3. What does tomorrow look like?  → next-expiry structure, after 0DTE rolls off
 *
 * DATA SOURCES
 *   props                       everything the Premarket tab already computed off
 *                               the live chain — spot, walls, flip, CB, max pain,
 *                               per-strike GEX, totals, the ES session bars.
 *   /api/snapshots/option-strike-gex-history
 *                               the per-minute strike ladder the ES chart's bubble
 *                               trail already backfills from. It is what makes a
 *                               REAL recap possible: an intraday SPX spot path and
 *                               a 09:30 GEX profile, neither of which the live
 *                               socket keeps. Same endpoint, same guards as
 *                               hooks/useGexBubbleHistory (see its header: the
 *                               route answers 200 even when it threw, and "today"
 *                               is the newest NON-WEEKEND day present, not
 *                               etDayKey(now) — the recorder has no market-hours
 *                               gate and rewrites a frozen copy all weekend).
 *   /proxy/walls?date&symbol=SPX
 *                               the SAVED grade. server-v2/walls-recorder.js
 *                               captures SPX's call wall / put wall / CORE at
 *                               09:29 and every 15 min to 16:00, writes only on
 *                               a change, and classifies every touch four slots
 *                               later (reject / break / pin / new wall / …). The
 *                               scorecard reads that verdict instead of inventing
 *                               its own, exactly like /level-log; the derived
 *                               grade stays underneath as the fallback.
 *   /api/expirations + /api/chains
 *                               the ONE thing that needs a second chain: tomorrow's
 *                               structure cannot be derived from today's expiring
 *                               book. Fetched once, only while this tab is open,
 *                               and every panel degrades to "—" if it fails.
 *
 * NOTHING HERE IS SYNTHETIC. A number that cannot be derived renders as "—" or as
 * an explicit "not recorded today" note; it is never filled in with a plausible
 * value. That rule is what makes the scorecard worth reading.
 *
 * Styling: the same `.pmk` scope as the Premarket tab. This file exports its own
 * CSS block, which Premarket.tsx concatenates onto its own — one <style>, one
 * theme, no chance of the two drifting apart.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties } from "react";
import { findGEXFlip, type ChainRow } from "@/lib/calculations/calculations";
import {
  etHm,
  RTH_CLOSE_MIN,
  RTH_OPEN_MIN,
  etMinutes,
  useIntradayLadder,
  useNextExpiryStructure,
  useRecordedWalls,
  LEVEL_LABEL,
  REACTION_LABEL,
  REACTION_TONE,
  type WallLevel,
  type Col,
} from "./postMarketData";

// ─────────────────────────────────────────────────────────────────────────────
//  CSS — appended to the Premarket tab's block, same .pmk scope
// ─────────────────────────────────────────────────────────────────────────────

export const POSTMARKET_CSS = `
.pmk .tabs{display:inline-flex;border:1px solid var(--line2);border-radius:9px;overflow:hidden}
.pmk .tabs button{background:transparent;border:0;border-right:1px solid var(--line2);color:var(--dim);
  font:inherit;font-size:11.5px;letter-spacing:.04em;padding:5px 13px;cursor:pointer}
.pmk .tabs button:last-child{border-right:0}
.pmk .tabs button.on{background:#1e2836;color:var(--txt)}
.pmk .tabs button .tdot{display:inline-block;width:6px;height:6px;border-radius:50%;margin-right:6px;
  vertical-align:middle;background:var(--amber)}

.pmk .prep.is-post{
  background:linear-gradient(180deg,rgba(77,163,255,.06),rgba(77,163,255,0) 190px), var(--panel);
  box-shadow:0 0 0 1px rgba(77,163,255,.09), 0 18px 50px -30px #000;
}
.pmk .sec{padding:14px 18px;border-bottom:1px solid var(--line)}
.pmk .sec:last-child{border-bottom:0}
.pmk .sechead{display:flex;align-items:baseline;justify-content:space-between;gap:12px;margin-bottom:11px;flex-wrap:wrap}
.pmk .sechead h3{font-size:11px;letter-spacing:.09em;text-transform:uppercase;color:var(--dim);margin:0;font-weight:600}
.pmk .secn{width:17px;height:17px;border-radius:5px;background:#1e2836;color:var(--dim);display:inline-grid;
  place-items:center;font-size:9.5px;font-weight:700;margin-right:8px;vertical-align:1px}
.pmk .warnbar{padding:8px 11px;border-radius:8px;border:1px solid rgba(245,185,66,.28);
  background:rgba(245,185,66,.06);font-size:11.5px;color:var(--dim)}

/* 1 — snapshot. Every column carries a min-width: the captions under the range
   bar are absolutely positioned, and without a floor the grid squeezes a column
   until a caption lands on top of the pill in the next one. */
.pmk .snap{display:grid;
  grid-template-columns:minmax(190px,auto) 1px minmax(280px,1.2fr) 1px minmax(230px,1fr) 1px minmax(230px,auto);
  align-items:start;row-gap:14px}
.pmk .snap .vr{align-self:center}
.pmk .rangebar{position:relative;height:42px;margin-top:8px}
.pmk .rangebar .wallband{position:absolute;left:0;right:0;top:16px;height:14px;border-radius:7px;
  background:linear-gradient(90deg,rgba(46,204,143,.22),rgba(255,255,255,.05),rgba(255,92,108,.22));border:1px solid var(--line)}
.pmk .rangebar .act{position:absolute;top:19px;height:8px;border-radius:5px;
  background:linear-gradient(90deg,rgba(77,163,255,.45),rgba(77,163,255,.85))}
.pmk .rangebar .mk3{position:absolute;top:11px;width:2px;height:24px;border-radius:2px;transform:translateX(-50%)}
.pmk .rangebar .cp3{position:absolute;top:0;font-size:9.5px;white-space:nowrap;transform:translateX(-50%)}
.pmk .rangelabs{display:flex;justify-content:space-between;gap:8px;font-size:9.5px;color:var(--dim)}

/* 2 — scorecard */
.pmk .scorecard{display:grid;grid-template-columns:repeat(5,1fr);gap:10px}
.pmk .sc{position:relative;border:1px solid var(--card);border-radius:var(--r);background:var(--panel2);
  padding:10px 11px 11px;overflow:hidden}
/* The accent is an ELEMENT, not a ::before with tone classes. The tone classes
   only ever fired when the grade resolved, so a card whose level had no verdict
   yet drew a grey edge and the row read as unstyled. Every card now carries its
   LEVEL's colour on the edge — call wall red, put wall green, CORE violet — and
   the verdict shows in the pill, which is the thing that actually changes. */
.pmk .sc .accent{position:absolute;left:0;top:0;bottom:0;width:3px;border-radius:0 2px 2px 0}
.pmk .sc .src{font-size:9px;letter-spacing:.06em;text-transform:uppercase;color:var(--dim2);margin-top:6px}
.pmk .sc .nm{font-size:10px;letter-spacing:.07em;text-transform:uppercase;color:var(--dim2);
  display:flex;justify-content:space-between;align-items:center;gap:6px}
.pmk .sc .px{font-size:20px;font-weight:660;letter-spacing:-.03em;margin:3px 0 1px}
.pmk .sc .sub{font-size:10.5px;color:var(--dim)}
.pmk .taps{display:flex;gap:2px;margin-top:8px;height:16px;align-items:flex-end}
.pmk .taps i{flex:1;background:#1a2230;border-radius:2px;height:5px}
.pmk .taps i.t{background:var(--pos);height:13px}
.pmk .taps i.b{background:var(--neg);height:16px}
.pmk .taps i.c{background:var(--amber);height:10px}

/* 3 — evolution. ONE bar (now) + a caret where 09:30 was + a hatch for the
   change between them. Drawing both profiles as filled shapes was unreadable. */
.pmk .evrow{display:grid;grid-template-columns:54px 1fr 92px;align-items:center;height:20px;gap:8px}
.pmk .evrow .k{font-size:10.5px;text-align:right;color:var(--dim)}
.pmk .evrow.key .k{color:var(--txt);font-weight:700}
.pmk .evrow .chg{position:absolute;top:1px;bottom:1px;border-radius:2px;
  background:repeating-linear-gradient(45deg,rgba(255,255,255,.22) 0 3px,rgba(255,255,255,.06) 3px 6px)}
.pmk .evrow .openmk{position:absolute;top:0;bottom:0;width:2px;background:#fff;opacity:.9;border-radius:1px}
.pmk .evrow .tagcol{font-size:9px;letter-spacing:.05em;text-transform:uppercase;white-space:nowrap}
.pmk .evlegend{display:flex;gap:14px;flex-wrap:wrap;font-size:9.5px;letter-spacing:.05em;
  text-transform:uppercase;color:var(--dim2)}
.pmk .evlegend i{display:inline-block;width:9px;height:8px;border-radius:2px;margin-right:5px;vertical-align:middle}
.pmk .heat{display:grid;gap:2px;margin-top:6px}
.pmk .heat i{height:22px;border-radius:3px;background:#1a2230}
.pmk .heatx{display:flex;justify-content:space-between;font-size:9px;color:var(--dim2);margin-top:4px}

/* 4/5/6 */
.pmk .tiles{display:grid;grid-template-columns:repeat(4,1fr);gap:10px}
.pmk .tile{border:1px solid var(--card);border-radius:9px;background:var(--panel2);padding:9px 10px}
.pmk .tile .n2{font-size:9.5px;letter-spacing:.08em;text-transform:uppercase;color:var(--dim2)}
.pmk .tile .v2{font-size:16px;font-weight:640;margin-top:2px;letter-spacing:-.02em}
.pmk .tile .m2{font-size:10px;color:var(--dim)}
.pmk .split{display:flex;height:9px;border-radius:5px;overflow:hidden;margin-top:10px;border:1px solid var(--line)}
.pmk .split i{display:block;height:100%}
.pmk .biasbox{margin-top:10px;padding:10px 12px;border-radius:var(--r);
  background:rgba(77,163,255,.06);border:1px solid rgba(77,163,255,.22);font-size:12.5px}
.pmk .biasbox b{color:var(--blue)}
.pmk .jot{width:100%;min-height:86px;resize:vertical;background:#0d1117;color:var(--txt);
  border:1px solid var(--line2);border-radius:8px;padding:9px 10px;font:inherit;font-size:12px}
.pmk .jot:focus{outline:none;border-color:#4a5b70}
.pmk .acc{display:flex;align-items:flex-end;gap:5px;height:60px;margin-top:6px}
.pmk .acc .c{flex:1;background:#1a2230;border-radius:3px 3px 0 0;position:relative;min-height:4px}
.pmk .acc .c i{position:absolute;left:0;right:0;bottom:0;border-radius:3px 3px 0 0;
  background:linear-gradient(180deg,var(--pos),var(--posDim))}
.pmk .movelog{display:grid;gap:0;margin-top:10px}
.pmk .movelog .mv{display:grid;grid-template-columns:52px 74px 1fr auto;gap:10px;align-items:center;
  padding:5px 0;border-bottom:1px dashed var(--line);font-size:11.5px}
.pmk .movelog .mv:last-child{border-bottom:0}
.pmk .rx{font-size:9.5px;padding:2px 6px;border-radius:5px;white-space:nowrap;border:1px solid var(--line2)}
.pmk .replay{display:grid;grid-template-columns:auto 1fr auto;gap:12px;align-items:center;margin-top:8px}
.pmk .replay input[type=range]{width:100%;accent-color:#4da3ff}
.pmk .readout{display:flex;gap:16px;flex-wrap:wrap;margin-top:8px}
.pmk .readout div{font-size:11px;color:var(--dim)}
.pmk .readout b{color:var(--txt);font-weight:640}

@media (max-width:1180px){
  .pmk .snap{grid-template-columns:1fr}
  .pmk .scorecard{grid-template-columns:repeat(2,1fr)}
  .pmk .tiles{grid-template-columns:repeat(2,1fr)}
}
`;

// ─────────────────────────────────────────────────────────────────────────────
//  types + small helpers
// ─────────────────────────────────────────────────────────────────────────────

/** The subset of hooks/useEsCandles' EsCandle this tab reads. Structural on
 *  purpose — it must not drag the candle module's types into this bundle. */
export type EsBar = {
  slotKey: string; date?: string; timestamp: number;
  open: number; high: number; low: number; close: number;
};

export type PostMarketProps = {
  spot: number;
  esFut: number;
  basis: number | null;
  flip: number | null;
  callWall: number | null;
  putWall: number | null;
  totalNetGex: number | null;
  perStrike: { strike: number; net: number }[];
  coreBullseye: { strike: number; net: number } | null;
  maxPain: number | null;
  em: number | null;
  totals: { dex: number; vanna: number; callGex: number; putGex: number };
  overnight: { hi: number | null; lo: number | null; pdc: number | null; rthHi: number | null; rthLo: number | null; openPx: number | null } | null;
  candles: EsBar[];
  expiry: string;
  etDate: string;
  etMin: number;
  hasData: boolean;
};

const NOTES_KEY = "cb-postmarket-notes-v1";
const LOG_KEY = "cb-postmarket-log-v1";

const nf = (v: number, dp = 0) =>
  v.toLocaleString("en-US", { minimumFractionDigits: dp, maximumFractionDigits: dp });

const fmtPx = (v: number | null | undefined, dp = 0) =>
  v == null || !Number.isFinite(v) || v <= 0 ? "—" : nf(v, dp);

const fmtPts = (v: number | null | undefined) =>
  v == null || !Number.isFinite(v) ? "—" : `${v >= 0 ? "+" : "−"}${nf(Math.abs(v), 0)} pts`;

const fmtPct = (v: number | null | undefined, dp = 2) =>
  v == null || !Number.isFinite(v) ? "—" : `${v >= 0 ? "+" : "−"}${Math.abs(v).toFixed(dp)}%`;

function fmtUsd(v: number | null | undefined, signed = true): string {
  if (v == null || !Number.isFinite(v)) return "—";
  const abs = Math.abs(v);
  const sign = v < 0 ? "−" : signed ? "+" : "";
  if (abs >= 1e9) return `${sign}$${(abs / 1e9).toFixed(2)}B`;
  if (abs >= 1e6) return `${sign}$${(abs / 1e6).toFixed(0)}M`;
  if (abs >= 1e3) return `${sign}$${(abs / 1e3).toFixed(1)}K`;
  return `${sign}$${abs.toFixed(0)}`;
}

// ─────────────────────────────────────────────────────────────────────────────
//  component
// ─────────────────────────────────────────────────────────────────────────────

type LevelKey = "CW" | "PW" | "FLIP" | "CB" | "MP";

type Grade = {
  key: LevelKey;
  name: string;
  hint: string;
  px: number | null;
  color: string;
  tone: "ok" | "bad" | "warn" | "vio" | "";
  status: string;
  detail: string;
  taps: ("" | "t" | "b" | "c")[];
  foot: string;
  /** RECORDED = the walls recorder's own verdict. DERIVED = graded here. */
  src: "recorded" | "derived";
};

export default function PostMarketTab(p: PostMarketProps) {
  const {
    spot, esFut, basis, flip, callWall, putWall, totalNetGex, perStrike,
    coreBullseye, maxPain, em, totals, overnight, candles, expiry, etDate, etMin, hasData,
  } = p;

  const { cols, state: histState } = useIntradayLadder(true, expiry);
  const { next, state: nextState } = useNextExpiryStructure(true, expiry, spot);
  const { log: wallLog, byLevel: recorded, state: wallState } = useRecordedWalls(etDate, "SPX");

  const es = (px: number | null | undefined) => (px == null || basis == null ? null : px + basis);
  const toSpx = useCallback((esPx: number | null | undefined) =>
    esPx == null || basis == null ? null : esPx - basis, [basis]);

  // ── the day's price path, in SPX ───────────────────────────────────────────
  // The recorder's own spot is first choice: it is SPX, per minute, and it is
  // the same series the ladder was captured against. The ES bars are the
  // fallback, converted through the live basis — good enough for high/low, but
  // 5-minute and one basis for the whole day, so it is marked as such.
  const path = useMemo<{ src: "recorder" | "es"; pts: { ts: number; px: number }[] }>(() => {
    if (cols.length && cols.some((c) => c.spot > 0)) {
      return {
        src: "recorder",
        pts: cols.filter((c) => c.spot > 0).map((c) => ({ ts: c.ts, px: c.spot })),
      };
    }
    const pts = candles
      .filter((c) => (c.date ?? c.slotKey.slice(0, 10)) === etDate)
      .map((c) => ({ ts: c.timestamp, px: toSpx(c.close) ?? 0 }))
      .filter((c) => c.px > 0 && etMinutes(c.ts) >= RTH_OPEN_MIN && etMinutes(c.ts) <= RTH_CLOSE_MIN);
    return { src: "es", pts };
  }, [cols, candles, etDate, toSpx]);

  const closePx = spot > 0 ? spot : (path.pts.length ? path.pts[path.pts.length - 1].px : 0);
  const rthHi = useMemo(() => {
    const fromEs = toSpx(overnight?.rthHi);
    const fromPath = path.pts.length ? Math.max(...path.pts.map((q) => q.px)) : null;
    return fromEs != null && fromPath != null ? Math.max(fromEs, fromPath) : (fromEs ?? fromPath);
  }, [overnight, path, toSpx]);
  const rthLo = useMemo(() => {
    const fromEs = toSpx(overnight?.rthLo);
    const fromPath = path.pts.length ? Math.min(...path.pts.map((q) => q.px)) : null;
    return fromEs != null && fromPath != null ? Math.min(fromEs, fromPath) : (fromEs ?? fromPath);
  }, [overnight, path, toSpx]);
  const pdcSpx = toSpx(overnight?.pdc);
  const dayChg = pdcSpx != null && closePx > 0 ? closePx - pdcSpx : null;

  // ── open vs now, off the recorded ladder ───────────────────────────────────
  const openCol = cols.length ? cols[0] : null;
  const sumNet = (c: Col | null) => (c ? c.cells.reduce((s, x) => s + x.net, 0) : null);
  const openNetGex = sumNet(openCol);
  const netGexChg = openNetGex != null && totalNetGex != null ? totalNetGex - openNetGex : null;
  const openFlip = useMemo(() => {
    if (!openCol) return null;
    return findGEXFlip(openCol.cells.map((c) => ({ strike: c.strike, netGEX: c.net } as ChainRow)), openCol.spot || spot);
  }, [openCol, spot]);

  const openByStrikeRaw = useMemo(() => {
    const m = new Map<number, number>();
    if (openCol) for (const c of openCol.cells) m.set(c.strike, c.net);
    return m;
  }, [openCol]);

  /**
   * SCALE GUARD — DIRECTIONAL, because the two directions mean opposite things.
   *
   * ratio = |recorded 09:30| / |live now|, over the strikes the two share.
   *
   * A ratio WELL UNDER 1 is the normal shape of a 0DTE day and must not be
   * blocked. The basis is OI + volume, and at 09:29 today's contracts have
   * essentially no volume yet — the book that decides the session is written
   * after the bell. A 5x–20x build from open to close is routine on SPX 0DTE,
   * and it is exactly the thing this panel exists to show. The first cut of this
   * guard rejected anything past 4x in EITHER direction, so on a live 0DTE it
   * saw 0.1x, called a real ten-fold build a "different book", and hid the
   * overlay, the delta list and the heatmap all at once.
   *
   * A ratio WELL OVER 1 is the suspicious one: the recorded side cannot legally
   * hold more gamma than the live side unless it is a different, larger book —
   * which is precisely what `anyExpiry=1` used to produce (the whole SPX board
   * against today's 0DTE alone: ~100x, a hatch across every row, +$65B deltas).
   *
   * The far floor stays too. 0.01x is not a build, it is the classic per-1%
   * convention error (S^2 * 0.01 against S^2) and would quietly halve every
   * reading; 0.02 sits just above it and well below any real intraday growth.
   */
  const OPEN_RATIO_MAX = 4;      // recorded bigger than live -> wrong book
  const OPEN_RATIO_MIN = 0.02;   // 100x apart -> a unit error, not a session

  const openScale = useMemo(() => {
    if (!openByStrikeRaw.size || !perStrike.length) {
      return { ratio: null as number | null, ok: false, grew: false };
    }
    let a = 0, b = 0, n = 0;
    for (const r of perStrike) {
      const o = openByStrikeRaw.get(r.strike);
      if (o == null) continue;
      a += Math.abs(o); b += Math.abs(r.net); n++;
    }
    if (n < 5 || !(a > 0) || !(b > 0)) return { ratio: null, ok: false, grew: false };
    const ratio = a / b;
    return {
      ratio,
      ok: ratio >= OPEN_RATIO_MIN && ratio <= OPEN_RATIO_MAX,
      // Worth SAYING, not hiding: the day wrote most of its own gamma.
      grew: ratio < 0.6,
    };
  }, [openByStrikeRaw, perStrike]);

  const openByStrike = useMemo(
    () => (openScale.ok ? openByStrikeRaw : new Map<number, number>()),
    [openScale.ok, openByStrikeRaw],
  );

  /**
   * Same two-window rule as the premarket profile: ±12 sets the bar SCALE (so a
   * monster strike far from the money cannot flatten everything near it), ±60
   * renders and the panel scrolls.
   */
  const evWindow = useCallback((half: number) => {
    if (!perStrike.length || !(spot > 0)) return [];
    const idx = perStrike.reduce(
      (b, r, i) => (Math.abs(r.strike - spot) < Math.abs(perStrike[b].strike - spot) ? i : b), 0);
    return perStrike.slice(Math.max(0, idx - half), Math.min(perStrike.length, idx + half + 1)).slice().reverse();
  }, [perStrike, spot]);
  const evNear = useMemo(() => evWindow(12), [evWindow]);
  const evBars = useMemo(() => evWindow(60), [evWindow]);

  const strikeDeltas = useMemo(() => {
    if (!openByStrike.size) return [];
    return perStrike
      .filter((r) => openByStrike.has(r.strike))
      .map((r) => ({ strike: r.strike, delta: r.net - (openByStrike.get(r.strike) ?? 0) }))
      .filter((r) => Number.isFinite(r.delta) && r.delta !== 0)
      .sort((a, z) => Math.abs(z.delta) - Math.abs(a.delta))
      .slice(0, 5);
  }, [perStrike, openByStrike]);

  // ── level scorecard ────────────────────────────────────────────────────────
  const grades = useMemo<Grade[]>(() => {
    const tol = Math.max(3, spot * 0.0005);          // ~4 pts on SPX
    const pts = path.pts;
    const BUCKETS = 12;

    const build = (
      key: LevelKey, name: string, hint: string, px: number | null, color: string,
      mode: "above" | "below" | "cross" | "near",
    ): Grade => {
      const base: Grade = {
        key, name, hint, px, color, tone: "", status: "—", detail: "no level",
        taps: Array(BUCKETS).fill(""), foot: "", src: "derived",
      };
      if (px == null || !(px > 0)) return base;
      if (!pts.length) return { ...base, status: "NO PATH", detail: "no intraday prices recorded", foot: "" };

      const taps: ("" | "t" | "b" | "c")[] = Array(BUCKETS).fill("");
      let touches = 0, beyond = 0, crosses = 0, firstTs = 0, lastTs = 0;
      let prevSide = 0;

      pts.forEach((q, i) => {
        const b = Math.min(BUCKETS - 1, Math.floor((i / pts.length) * BUCKETS));
        const d = q.px - px;
        const side = d >= 0 ? 1 : -1;
        const touched = Math.abs(d) <= tol;
        const isBeyond = mode === "above" ? d > tol : mode === "below" ? d < -tol : false;

        if (touched) {
          touches++;
          if (!firstTs) firstTs = q.ts;
          lastTs = q.ts;
          if (taps[b] !== "b") taps[b] = "t";
        }
        if (isBeyond) { beyond++; taps[b] = "b"; }
        if (mode === "cross" && prevSide !== 0 && side !== prevSide) {
          crosses++;
          taps[b] = taps[b] === "b" ? "b" : "c";
        }
        prevSide = side;
      });

      const perPt = path.src === "recorder" ? 1 : 5;   // minutes represented by one sample
      const mins = (n: number) => `${n * perPt} min`;
      const stamp = (ts: number) => (ts ? etHm(ts) : "—");

      if (mode === "cross") {
        return {
          ...base,
          tone: crosses ? "warn" : "ok",
          status: crosses ? `CROSSED ${crosses}×` : "NEVER CROSSED",
          detail: crosses
            ? `${mins(beyond)} on the far side · first ${stamp(firstTs)}`
            : `held one side of the flip all session`,
          taps,
          foot: crosses ? "regime changed hands intraday" : "one regime, all day",
        };
      }
      if (mode === "near") {
        const dist = closePx > 0 ? closePx - px : null;
        const pinned = dist != null && Math.abs(dist) <= Math.max(5, spot * 0.0008);
        return {
          ...base,
          tone: pinned ? "vio" : "",
          status: pinned ? "PINNED" : dist == null ? "—" : `${Math.abs(dist) < 25 ? "NEAR" : "MISSED"}`,
          detail: `${touches ? `${mins(touches)} within ${nf(tol, 0)} pts` : "never reached"} · close ${fmtPts(dist)}`,
          taps,
          foot: pinned ? "price closed on it" : "gravity did not win",
        };
      }
      const broke = beyond > 0;
      return {
        ...base,
        tone: broke ? "bad" : touches ? "ok" : "",
        status: broke ? "BROKEN" : touches ? "HELD" : "UNTESTED",
        detail: broke
          ? `${mins(beyond)} beyond · first break ${stamp(firstTs)}`
          : touches
            ? `tagged ${touches}× · first ${stamp(firstTs)} · last ${stamp(lastTs)}`
            : `never within ${nf(tol, 0)} pts`,
        taps,
        foot: broke
          ? (mode === "above" ? "resistance failed" : "support failed")
          : touches ? "defended" : (mode === "above" ? "never reached" : "never needed"),
      };
    };

    /**
     * The recorder's verdict WINS for the three levels it tracks. It watched the
     * level all day at 15-minute resolution and classified the touch four slots
     * later; this file only ever sees the last frame plus whatever price path it
     * could reconstruct. Where a recorded grade exists the derived one is kept
     * underneath as the sparkline and the "also" line, so nothing is lost.
     */
    const withRecorded = (g: Grade, lvl: WallLevel): Grade => {
      const rec = recorded.get(lvl);
      if (!rec) return g;
      const last = rec.events.length ? rec.events[rec.events.length - 1] : null;
      const rx = last?.reaction ?? null;
      const moved = rec.open != null && rec.last != null && rec.open !== rec.last;
      const hits = rec.events.filter((e) => e.kind === "touch").length;

      const detail = [
        moved ? `${nf(rec.open as number, 0)} → ${nf(rec.last as number, 0)}` : `held ${fmtPx(rec.last ?? g.px)} all day`,
        rec.moves ? `moved ${rec.moves}×` : "never moved",
        hits ? `${hits} tag${hits > 1 ? "s" : ""}` : "no tags",
      ].join(" · ");

      const foot = last
        ? [
            last.excursion_pts != null ? `${fmtPts(last.excursion_pts)} through` : null,
            last.reclaim_min != null ? `reclaimed in ${last.reclaim_min} min` : null,
            last.attempts > 1 ? `${last.attempts} attempts` : null,
          ].filter(Boolean).join(" · ") || "recorded by the wall log"
        : "watched all day, never traded into";

      return {
        ...g,
        px: rec.last ?? g.px,
        src: "recorded",
        tone: rx ? REACTION_TONE[rx] : (hits ? "warn" : "ok"),
        status: rx ? REACTION_LABEL[rx] : (hits ? "TAGGED" : "UNTESTED"),
        detail,
        foot,
      };
    };

    return [
      withRecorded(build("CW", "Call Wall", "resistance", callWall, "var(--neg)", "above"), "call_wall"),
      withRecorded(build("PW", "Put Wall", "support", putWall, "var(--pos)", "below"), "put_wall"),
      build("FLIP", "Gamma Flip", "regime", flip, "var(--amber)", "cross"),
      withRecorded(build("CB", "CORE", "max γ", coreBullseye?.strike ?? null, "var(--violet)", "near"), "cb"),
      build("MP", "Max Pain", "OI", maxPain, "var(--blue)", "near"),
    ];
  }, [callWall, putWall, flip, coreBullseye, maxPain, path, spot, closePx, recorded]);

  const gradeOf = (k: LevelKey) => grades.find((g) => g.key === k) ?? null;

  // ── verdict ────────────────────────────────────────────────────────────────
  const verdict = useMemo(() => {
    if (!hasData || !(closePx > 0) || rthHi == null || rthLo == null) {
      return { t: "WAITING FOR DATA", d: "no chain or no session bars yet.", neg: false };
    }
    const brokeCall = callWall != null && rthHi > callWall;
    const brokePut = putWall != null && rthLo < putWall;
    const cb = coreBullseye?.strike ?? null;
    const pinned = cb != null && Math.abs(closePx - cb) <= Math.max(5, spot * 0.0008);
    const inside = !brokeCall && !brokePut && callWall != null && putWall != null;

    if (brokeCall && brokePut) {
      return { t: "BOTH WALLS GAVE", d: `Range ${fmtPx(rthLo)}–${fmtPx(rthHi)} ran through both sides. The map was too narrow for the tape.`, neg: true };
    }
    if (brokeCall) {
      return { t: "BROKE THE CALL WALL", d: `High ${fmtPx(rthHi)} cleared ${fmtPx(callWall)}. Fading resistance was the wrong trade.`, neg: true };
    }
    if (brokePut) {
      return { t: "BROKE THE PUT WALL", d: `Low ${fmtPx(rthLo)} lost ${fmtPx(putWall)}. Support was not support.`, neg: true };
    }
    if (pinned) {
      return { t: "PINNED", d: `Closed ${fmtPts(cb != null ? closePx - cb : null)} from the ${fmtPx(cb)} bullseye, inside the wall band all day.`, neg: false };
    }
    if (inside) {
      return { t: "HELD THE RANGE", d: `Whole session between ${fmtPx(putWall)} and ${fmtPx(callWall)}. The morning map was the day.`, neg: false };
    }
    return { t: "NO WALLS TO GRADE", d: "The chain never produced both walls today.", neg: false };
  }, [hasData, closePx, rthHi, rthLo, callWall, putWall, coreBullseye, spot]);

  // ── range bar geometry ─────────────────────────────────────────────────────
  const rangeDomain = useMemo(() => {
    const vals = [callWall, putWall, rthHi, rthLo, closePx].filter((v): v is number => v != null && v > 0);
    if (vals.length < 2) return null;
    const lo = Math.min(...vals), hi = Math.max(...vals);
    const span = hi - lo;
    if (!(span > 0)) return null;
    const pad = span * 0.1;
    return { lo: lo - pad, hi: hi + pad };
  }, [callWall, putWall, rthHi, rthLo, closePx]);
  const rPos = (px: number | null | undefined) =>
    px == null || rangeDomain == null ? null
      : Math.max(0, Math.min(100, ((px - rangeDomain.lo) / (rangeDomain.hi - rangeDomain.lo)) * 100));

  // ── tomorrow's rail ────────────────────────────────────────────────────────
  const railMarks = useMemo(() => {
    if (!next) return null;
    const marks: { code: string; name: string; px: number; color: string }[] = [];
    const add = (code: string, name: string, px: number | null | undefined, color: string) => {
      if (px != null && Number.isFinite(px) && px > 0) marks.push({ code, name, px, color });
    };
    add("PW", "Put Wall", next.putWall, "var(--pos)");
    add("FLIP", "Gamma Flip", next.flip, "var(--amber)");
    add("CB", "Core Bullseye", next.cb, "var(--violet)");
    add("CLOSE", "SPX Close", closePx > 0 ? closePx : null, "#ffffff");
    add("CW", "Call Wall", next.callWall, "var(--neg)");
    if (marks.length < 2) return null;
    const lo = Math.min(...marks.map((m) => m.px)), hi = Math.max(...marks.map((m) => m.px));
    const span = hi - lo;
    if (!(span > 0)) return null;
    const pad = span * 0.14;
    const pos = (px: number) => ((px - (lo - pad)) / ((hi + pad) - (lo - pad))) * 100;
    const placed = marks.slice().sort((a, b) => a.px - b.px).map((m, i) => ({
      ...m, pos: pos(m.px), side: i % 2 === 0 ? "dn" : "up",
      dist: closePx > 0 && m.code !== "CLOSE" ? m.px - closePx : null,
    }));
    const band = next.putWall != null && next.callWall != null
      ? { left: Math.min(pos(next.putWall), pos(next.callWall)), width: Math.abs(pos(next.callWall) - pos(next.putWall)) }
      : null;
    return { placed, band };
  }, [next, closePx]);

  const todayWidth = callWall != null && putWall != null ? Math.abs(callWall - putWall) : null;
  const nextWidth = next?.callWall != null && next?.putWall != null ? Math.abs(next.callWall - next.putWall) : null;

  // ── replay ─────────────────────────────────────────────────────────────────
  const [rIdx, setRIdx] = useState<number | null>(null);
  useEffect(() => { setRIdx(null); }, [cols.length]);
  const replayIdx = rIdx == null ? Math.max(0, cols.length - 1) : Math.min(rIdx, cols.length - 1);
  const replay = useMemo(() => {
    const c = cols[replayIdx];
    if (!c) return null;
    const net = c.cells.reduce((s, x) => s + x.net, 0);
    const cb = c.cells.reduce((b, x) => (Math.abs(x.net) > Math.abs(b.net) ? x : b), c.cells[0]);
    const f = findGEXFlip(c.cells.map((x) => ({ strike: x.strike, netGEX: x.net } as ChainRow)), c.spot || spot);
    return { ts: c.ts, spot: c.spot, net, cb: cb?.strike ?? null, flip: f };
  }, [cols, replayIdx, spot]);

  // ── session journal (per date, local) ──────────────────────────────────────
  const [note, setNote] = useState("");
  const noteLoaded = useRef(false);
  useEffect(() => {
    try {
      const all = JSON.parse(localStorage.getItem(NOTES_KEY) || "{}") as Record<string, string>;
      setNote(all[etDate] ?? "");
    } catch { /* first run */ }
    noteLoaded.current = true;
  }, [etDate]);
  const saveNote = useCallback((v: string) => {
    setNote(v);
    if (!noteLoaded.current) return;
    try {
      const all = JSON.parse(localStorage.getItem(NOTES_KEY) || "{}") as Record<string, string>;
      all[etDate] = v;
      localStorage.setItem(NOTES_KEY, JSON.stringify(all));
    } catch { /* quota — the textarea still holds it for this session */ }
  }, [etDate]);

  // ── rolling accuracy log — written once per session, after the close ───────
  type LogRow = { date: string; cw: boolean; pw: boolean; inside: boolean; pinned: boolean };
  const [log, setLog] = useState<LogRow[]>([]);
  useEffect(() => {
    try { setLog(JSON.parse(localStorage.getItem(LOG_KEY) || "[]") as LogRow[]); } catch { /* none yet */ }
  }, []);
  const wroteLogRef = useRef(false);
  useEffect(() => {
    if (wroteLogRef.current) return;
    if (etMin < RTH_CLOSE_MIN + 5) return;               // only after the settle
    if (!hasData || rthHi == null || rthLo == null || callWall == null || putWall == null) return;
    let rows: LogRow[] = [];
    try { rows = JSON.parse(localStorage.getItem(LOG_KEY) || "[]") as LogRow[]; } catch { /* none */ }
    if (rows.some((r) => r.date === etDate)) { wroteLogRef.current = true; return; }
    const cb = coreBullseye?.strike ?? null;
    const row: LogRow = {
      date: etDate,
      cw: rthHi <= callWall,
      pw: rthLo >= putWall,
      inside: rthHi <= callWall && rthLo >= putWall,
      pinned: cb != null && Math.abs(closePx - cb) <= Math.max(5, spot * 0.0008),
    };
    const nextRows = [...rows, row].slice(-20);
    try { localStorage.setItem(LOG_KEY, JSON.stringify(nextRows)); } catch { /* quota */ }
    setLog(nextRows);
    wroteLogRef.current = true;
  }, [etMin, etDate, hasData, rthHi, rthLo, callWall, putWall, coreBullseye, closePx, spot]);

  const accRows = log.slice(-10);
  const hitRate = (pick: (r: LogRow) => boolean) =>
    accRows.length ? `${accRows.filter(pick).length} / ${accRows.length}` : "—";

  // ── render helpers ─────────────────────────────────────────────────────────
  const maxAbsBar = Math.max(1, ...evNear.map((b) => Math.abs(b.net)));
  const openTag = (strike: number): { text: string; color: string } | null => {
    if (callWall != null && strike === callWall) return { text: "CALL WALL", color: "var(--neg)" };
    if (putWall != null && strike === putWall) return { text: "PUT WALL", color: "var(--pos)" };
    if (coreBullseye && strike === coreBullseye.strike) return { text: "BULLSEYE", color: "var(--violet)" };
    if (maxPain != null && strike === maxPain) return { text: "MAX PAIN", color: "var(--blue)" };
    return null;
  };

  const histNote =
    histState === "ok" && openByStrikeRaw.size && !openScale.ok
      ? (openScale.ratio != null && openScale.ratio > OPEN_RATIO_MAX
          ? `The recorded 09:30 ladder holds ${openScale.ratio.toFixed(1)}× the gamma the live 0DTE chain does — that is a bigger book, not a bigger day. The open overlay is hidden rather than shown wrong.`
          : `The recorded 09:30 ladder is ${openScale.ratio ? `${(1 / openScale.ratio).toFixed(0)}×` : "far"} smaller than the live one — past what a session can build, so it is being read as a unit mismatch and the overlay is hidden.`)
      : histState === "ok" ? null
      : histState === "loading" ? "Loading today's recorded ladder…"
        : histState === "empty" ? "No per-minute ladder recorded for today — the open-vs-close panels need it. Everything else below is live."
          : "The intraday recorder did not answer. Open-vs-close and replay are unavailable; the rest is live.";

  return (
    <section className="prep is-post">

      {/* ── 1. DAY SNAPSHOT ──────────────────────────────────────────────── */}
      <div className="sec">
        <div className="sechead">
          <h3><span className="secn">1</span>Day Snapshot</h3>
          <span className="tiny">
            {path.src === "recorder" ? "per-minute recorder" : "5m ES bars via basis"} · {expiry || "—"}
          </span>
        </div>

        <div className="snap">
          <div className="kpi">
            <div className="k">SPX Close</div>
            <div className="v mono">
              {fmtPx(closePx)}{" "}
              <small className={dayChg == null ? undefined : dayChg >= 0 ? "chg-pos" : "chg-neg"}>
                {dayChg == null ? "vs prior close —" : `${fmtPts(dayChg)} / ${fmtPct(pdcSpx ? (dayChg / pdcSpx) * 100 : null)}`}
              </small>
            </div>
            <div className="tiny" style={{ marginTop: 4 }}>
              H {fmtPx(rthHi)} · L {fmtPx(rthLo)} ·{" "}
              {rthHi != null && rthLo != null ? `${nf(rthHi - rthLo, 0)} pt range` : "—"}
            </div>
          </div>

          <div className="vr" />

          <div>
            <div className="tiny">Day range vs the morning wall band</div>
            <div className="rangebar">
              <div className="wallband" />
              {rPos(rthLo) != null && rPos(rthHi) != null && (
                <div className="act" style={{ left: `${rPos(rthLo)}%`, width: `${(rPos(rthHi) as number) - (rPos(rthLo) as number)}%` }} />
              )}
              {rPos(putWall) != null && <div className="mk3" style={{ left: `${rPos(putWall)}%`, background: "var(--pos)" }} />}
              {rPos(callWall) != null && <div className="mk3" style={{ left: `${rPos(callWall)}%`, background: "var(--neg)" }} />}
              {rPos(closePx) != null && <div className="mk3" style={{ left: `${rPos(closePx)}%`, background: "#fff" }} />}
              {rPos(putWall) != null && (
                <div className="cp3" style={{ left: `${Math.max(9, rPos(putWall) as number)}%`, color: "var(--pos)" }}>PW {fmtPx(putWall)}</div>
              )}
              {rPos(closePx) != null && (
                <div className="cp3" style={{ left: `${Math.min(82, Math.max(28, rPos(closePx) as number))}%` }}>close {fmtPx(closePx)}</div>
              )}
              {rPos(callWall) != null && (
                <div className="cp3" style={{ left: `${Math.min(91, rPos(callWall) as number)}%`, color: "var(--neg)" }}>CW {fmtPx(callWall)}</div>
              )}
            </div>
            <div className="rangelabs">
              <span>L {fmtPx(rthLo)}</span>
              <span>{todayWidth != null ? `${nf(todayWidth, 0)} pt wall band` : ""}</span>
              <span>H {fmtPx(rthHi)}</span>
            </div>
          </div>

          <div className="vr" />

          <div className="kpi">
            <div className="k">Net GEX · open → now</div>
            <div className="v mono">
              {openNetGex == null ? fmtUsd(totalNetGex) : <>{fmtUsd(openNetGex)} <small>→</small> {fmtUsd(totalNetGex)}</>}
            </div>
            <div style={{ marginTop: 6, display: "flex", flexWrap: "wrap", alignItems: "center", gap: 8 }}>
              <span className={`pill ${(totalNetGex ?? 0) >= 0 ? "cool" : "hot"}`}>
                {openNetGex == null
                  ? ((totalNetGex ?? 0) >= 0 ? "positive gamma" : "negative gamma")
                  : (openNetGex >= 0) === ((totalNetGex ?? 0) >= 0)
                    ? `regime held ${(totalNetGex ?? 0) >= 0 ? "positive" : "negative"}`
                    : "REGIME FLIPPED"}
              </span>
              <span className="tiny">
                {netGexChg == null ? "no open snapshot" : `${fmtUsd(netGexChg)} on the day`}
                {openFlip != null && flip != null ? ` · flip ${fmtPx(openFlip)} → ${fmtPx(flip)}` : ""}
              </span>
            </div>
          </div>

          <div className={`bias${verdict.neg ? " neg" : ""}`}>
            <div className="t">{verdict.t}</div>
            <div className="d">{verdict.d}</div>
          </div>
        </div>
      </div>

      {/* ── 2. LEVEL SCORECARD ───────────────────────────────────────────── */}
      <div className="sec">
        <div className="sechead">
          <h3><span className="secn">2</span>Level Performance Scorecard</h3>
          <span className="tiny">
            {wallState === "ok" ? "SPX wall log · 09:29 → 16:00" : wallState === "loading" ? "loading the wall log…" : "wall log unavailable"}
            {path.pts.length ? ` · ${path.pts.length} price samples` : ""}
          </span>
        </div>
        <div className="scorecard">
          {grades.map((g) => (
            <div className="sc" key={g.key}>
              <i className="accent" style={{ background: g.color }} />
              <div className="nm">
                <span style={{ color: g.color }}>{g.name}</span>
                <span className={`pill${g.tone === "ok" ? " cool" : g.tone === "bad" ? " hot" : g.tone === "warn" ? " warn" : ""}`}
                  style={g.tone === "vio" ? { borderColor: "rgba(167,139,250,.45)", color: "var(--violet)", background: "rgba(167,139,250,.09)" } : undefined}>
                  {g.status}
                </span>
              </div>
              <div className="px mono">{fmtPx(g.px)}</div>
              <div className="sub">{g.detail}</div>
              <div className="taps">
                {g.taps.map((t, i) => <i key={i} className={t} />)}
              </div>
              <div className="sub" style={{ marginTop: 5 }}>{g.foot}</div>
              <div className="src">
                {g.src === "recorded" ? "graded by the wall log" : `derived · ${g.hint}`}
              </div>
            </div>
          ))}
        </div>

        {wallState === "ok" && wallLog.some((r) => r.reason === "change") && (
          <div className="movelog">
            <div className="tiny" style={{ marginBottom: 4 }}>Every time a level moved today</div>
            {wallLog
              .filter((r) => r.reason === "change")
              .sort((a, b) => a.slot - b.slot)
              .slice(-8)
              .map((r, i) => (
                <div className="mv" key={`${r.level_type}-${r.slot}-${i}`}>
                  <span className="mono">{String(r.at ?? "").slice(0, 5) || `slot ${r.slot}`}</span>
                  <span style={{ color: r.level_type === "call_wall" ? "var(--neg)" : r.level_type === "put_wall" ? "var(--pos)" : "var(--violet)" }}>
                    {LEVEL_LABEL[r.level_type]}
                  </span>
                  <span className="mono">
                    {r.prev_strike != null ? `${nf(r.prev_strike, 0)} → ` : ""}{nf(r.strike, 0)}
                    {r.delta != null ? <span className={r.delta >= 0 ? "chg-pos" : "chg-neg"}>{"  "}{fmtPts(r.delta)}</span> : null}
                  </span>
                  <span className="tiny">spot {fmtPx(r.spot)}</span>
                </div>
              ))}
          </div>
        )}
        {wallState === "empty" && (
          <div className="warnbar" style={{ marginTop: 10 }}>
            Nothing recorded in the SPX wall log for {etDate} — the three wall cards above are graded
            from the price path instead of the recorder&apos;s own verdict.
          </div>
        )}
      </div>

      {/* ── 3. GEX EVOLUTION ─────────────────────────────────────────────── */}
      <div className="sec">
        <div className="sechead">
          <h3><span className="secn">3</span>GEX Evolution — 09:30 vs now</h3>
          <div className="evlegend">
            {openScale.ok && openScale.ratio != null && (
              <span style={{ color: openScale.grew ? "var(--amber)" : "var(--dim)" }}>
                {openScale.grew
                  ? `book grew ${(1 / openScale.ratio).toFixed(1)}× since 09:30`
                  : `book ${openScale.ratio >= 1 ? "flat" : `−${Math.round((1 - openScale.ratio) * 100)}%`} vs 09:30`}
              </span>
            )}
            <span><i style={{ background: "var(--pos)" }} />now positive</span>
            <span><i style={{ background: "var(--neg)" }} />now negative</span>
            <span><i style={{ background: "#fff", width: 3 }} />09:30 level</span>
            <span><i style={{ background: "repeating-linear-gradient(45deg,rgba(255,255,255,.5) 0 2px,rgba(255,255,255,.12) 2px 4px)" }} />added / lost</span>
          </div>
        </div>

        {histNote && <div className="warnbar" style={{ marginBottom: 11 }}>{histNote}</div>}

        <div className="body" style={{ gridTemplateColumns: "1.35fr 1fr" }}>
          <div className="col">
            <div className="chart">
            {evBars.length === 0 && (
              <div style={{ padding: "30px 0", textAlign: "center", color: "var(--dim)", fontSize: 12 }}>
                Waiting for the chain…
              </div>
            )}
            {evBars.map((b) => {
              const openNet = openByStrike.get(b.strike);
              const pos = b.net >= 0;
              const w = (Math.abs(b.net) / maxAbsBar) * 46;
              // Clamped: a caret can never be drawn outside the track, so a bad
              // scale shows as a pegged marker rather than a row-wide smear.
              const wo = openNet == null ? null : Math.min(46, (Math.abs(openNet) / maxAbsBar) * 46);
              const lo = wo == null ? null : Math.min(w, wo);
              const hi = wo == null ? null : Math.max(w, wo);
              const tag = openTag(b.strike);
              // Anchored from the centre line outwards on the bar's own side —
              // left for positive rows, right for negative — so the caret and the
              // hatch can never cross into the other half of the track.
              const chgStyle: CSSProperties | null = lo == null || hi == null || hi <= lo
                ? null
                : pos
                  ? { left: `${50 + lo}%`, width: `${hi - lo}%` }
                  : { right: `${50 + lo}%`, width: `${hi - lo}%` };
              const openStyle: CSSProperties | null = wo == null
                ? null
                : pos
                  ? { left: `calc(${50 + wo}% - 1px)` }
                  : { right: `calc(${50 + wo}% - 1px)` };
              return (
                <div className={`evrow${tag ? " key" : ""}`} key={b.strike}>
                  <div className="k mono">{nf(b.strike, 0)}</div>
                  <div className="track">
                    <div className={`bar ${pos ? "p" : "n"}`} style={{ width: `${w}%` }} />
                    {chgStyle && <div className="chg" style={chgStyle} />}
                    {openStyle && <div className="openmk" style={openStyle} />}
                  </div>
                  <div className="tagcol" style={{ color: tag ? tag.color : "transparent" }}>{tag ? tag.text : ""}</div>
                </div>
              );
            })}
            </div>
          </div>

          <div className="col">
            <div className="colhead"><h3>Biggest strike changes</h3><span className="tiny">since 09:30</span></div>
            {strikeDeltas.length === 0 && <div className="tiny">No 09:30 ladder — nothing to difference.</div>}
            {strikeDeltas.map((d) => {
              const maxD = Math.max(...strikeDeltas.map((x) => Math.abs(x.delta)));
              const w = (Math.abs(d.delta) / maxD) * 100;
              return (
                <div className="deltas" key={d.strike}>
                  <div className="d">
                    <div className="s mono">{nf(d.strike, 0)}</div>
                    <div className="t">
                      <i style={{
                        left: 0, width: `${w}%`,
                        background: d.delta >= 0
                          ? "linear-gradient(90deg,var(--posDim),var(--pos))"
                          : "linear-gradient(270deg,var(--negDim),var(--neg))",
                      }} />
                    </div>
                    <div className={`v mono ${d.delta >= 0 ? "chg-pos" : "chg-neg"}`}>{fmtUsd(d.delta)}</div>
                  </div>
                </div>
              );
            })}

            <div className="colhead" style={{ marginTop: 14 }}><h3>Δ GEX by strike</h3><span className="tiny">green = gamma added</span></div>
            {evNear.length > 0 && openByStrike.size > 0 ? (
              <>
                <div className="heat" style={{ gridTemplateColumns: `repeat(${evNear.length}, 1fr)` }}>
                  {evNear.slice().reverse().map((b) => {
                    const o = openByStrike.get(b.strike);
                    const d = o == null ? 0 : b.net - o;
                    const maxD = Math.max(1, ...evNear.map((x) => {
                      const ox = openByStrike.get(x.strike);
                      return ox == null ? 0 : Math.abs(x.net - ox);
                    }));
                    const a = Math.max(.1, Math.min(.9, Math.abs(d) / maxD));
                    return <i key={b.strike} style={{ background: d === 0 ? "#1a2230" : d > 0 ? `rgba(46,204,143,${a})` : `rgba(255,92,108,${a})` }} />;
                  })}
                </div>
                <div className="heatx">
                  <span>{fmtPx(evNear[evNear.length - 1]?.strike)}</span>
                  <span>{fmtPx(spot)}</span>
                  <span>{fmtPx(evNear[0]?.strike)}</span>
                </div>
              </>
            ) : (
              <div className="tiny">Needs the 09:30 ladder.</div>
            )}
          </div>
        </div>
      </div>

      {/* ── 4. FLOW & POSITIONING ────────────────────────────────────────── */}
      <div className="sec">
        <div className="sechead">
          <h3><span className="secn">4</span>Positioning at the Close</h3>
          <span className="tiny">same chain, same formulas as the GEX chart</span>
        </div>
        <div className="tiles">
          <div className="tile">
            <div className="n2">Net DEX</div>
            <div className="v2 mono">{fmtUsd(totals.dex)}</div>
            <div className="m2">{totals.dex >= 0 ? "dealers long delta" : "dealers short delta"}</div>
          </div>
          <div className="tile">
            <div className="n2">Net Vanna</div>
            <div className="v2 mono">{fmtUsd(totals.vanna)}</div>
            <div className="m2">{totals.vanna >= 0 ? "vol down helps the tape" : "vol down pressures the tape"}</div>
          </div>
          <div className="tile">
            <div className="n2">Net GEX on the day</div>
            <div className="v2 mono">{netGexChg == null ? "—" : fmtUsd(netGexChg)}</div>
            <div className="m2">{netGexChg == null ? "no 09:30 ladder" : netGexChg >= 0 ? "gamma built through the session" : "gamma bled out of the book"}</div>
          </div>
          <div className="tile">
            <div className="n2">Call vs Put gamma</div>
            <div className="v2 mono">
              {(() => {
                const c = Math.abs(totals.callGex), pu = Math.abs(totals.putGex);
                return c + pu > 0 ? `${Math.round((c / (c + pu)) * 100)}% / ${Math.round((pu / (c + pu)) * 100)}%` : "—";
              })()}
            </div>
            <div className="m2">{fmtUsd(totals.callGex, false)} calls · {fmtUsd(totals.putGex, false)} puts</div>
            <div className="split">
              {(() => {
                const c = Math.abs(totals.callGex), pu = Math.abs(totals.putGex);
                const t = c + pu;
                return t > 0 ? (
                  <>
                    <i style={{ width: `${(c / t) * 100}%`, background: "linear-gradient(90deg,var(--posDim),var(--pos))" }} />
                    <i style={{ width: `${(pu / t) * 100}%`, background: "linear-gradient(90deg,var(--negDim),var(--neg))" }} />
                  </>
                ) : null;
              })()}
            </div>
          </div>
        </div>
      </div>

      {/* ── 5. TOMORROW'S MAP ────────────────────────────────────────────── */}
      <div className="sec">
        <div className="sechead">
          <h3><span className="secn">5</span>Tomorrow&apos;s Map — after 0DTE rolls off</h3>
          <span className="tiny">
            {nextState === "ok" && next ? `${next.expiry} chain` : nextState === "loading" ? "loading the next expiry…" : "next expiry unavailable"}
          </span>
        </div>

        {nextState !== "ok" || !railMarks ? (
          <div className="warnbar">
            {nextState === "loading"
              ? "Pulling the next expiry's chain…"
              : "Could not build tomorrow's structure — the next expiry's chain did not answer. Today's numbers above are unaffected."}
          </div>
        ) : (
          <>
            <div className="rail">
              <div className="track2">
                {railMarks.band && (
                  <div className="band" style={{ left: `${railMarks.band.left}%`, width: `${railMarks.band.width}%` }} />
                )}
              </div>
              {railMarks.placed.map((m) => (
                <div key={m.code}>
                  <div className={`mk2${m.code === "CLOSE" ? " spot" : ""}`} style={{ left: `${m.pos}%`, background: m.color }} />
                  <div className={`cap2 ${m.side}`} style={{ left: `${Math.max(4, Math.min(96, m.pos))}%` }}>
                    <div className="n2" style={{ color: m.color }}>{m.code}<span className="ln"> · {m.name}</span></div>
                    <div className="v2 mono">{fmtPx(m.px)}</div>
                    <div className="d2 mono">
                      {m.code === "CLOSE" ? (es(m.px) != null ? `ES ${fmtPx(es(m.px))}` : "settled") : fmtPts(m.dist)}
                    </div>
                  </div>
                </div>
              ))}
            </div>

            <div className="tiles" style={{ marginTop: 6 }}>
              <div className="tile">
                <div className="n2">Wall band</div>
                <div className="v2 mono">
                  {todayWidth != null && nextWidth != null ? `${nf(todayWidth, 0)} → ${nf(nextWidth, 0)} pts` : nextWidth != null ? `${nf(nextWidth, 0)} pts` : "—"}
                </div>
                <div className="m2">
                  {todayWidth != null && nextWidth != null
                    ? nextWidth > todayWidth ? `${Math.round(((nextWidth - todayWidth) / todayWidth) * 100)}% wider` : `${Math.round(((todayWidth - nextWidth) / todayWidth) * 100)}% tighter`
                    : "structure after the roll"}
                </div>
              </div>
              <div className="tile">
                <div className="n2">Flip moves to</div>
                <div className="v2 mono">{fmtPx(next?.flip)}</div>
                <div className="m2">{next?.flip != null && closePx > 0 ? `${fmtPts(next.flip - closePx)} from the close` : "—"}</div>
              </div>
              <div className="tile">
                <div className="n2">Net GEX rolls to</div>
                <div className="v2 mono">{fmtUsd(next?.netGex ?? null)}</div>
                <div className="m2">
                  {next?.netGex != null && totalNetGex != null && totalNetGex !== 0
                    ? `${Math.round((next.netGex / Math.abs(totalNetGex)) * 100)}% of today's book`
                    : "next expiry only"}
                </div>
              </div>
              <div className="tile">
                <div className="n2">Overnight watch</div>
                <div className="v2 mono">{fmtPx(rthHi)} / {fmtPx(rthLo)}</div>
                <div className="m2">today&apos;s RTH high / low{basis != null ? ` · ES basis ${fmtPts(basis)}` : ""}</div>
              </div>
            </div>

            <div className="biasbox">
              <b>Bias:</b>{" "}
              {(next?.netGex ?? 0) >= 0 ? "Positive gamma into tomorrow" : "Negative gamma into tomorrow"}
              {nextWidth != null && todayWidth != null
                ? nextWidth > todayWidth
                  ? ` — but ${nf(nextWidth, 0)} pts of room versus ${nf(todayWidth, 0)} today, so the fade needs the edges, not the middle.`
                  : ` — and tighter than today (${nf(nextWidth, 0)} vs ${nf(todayWidth, 0)} pts), so the walls should bind sooner.`
                : "."}
              {next?.flip != null && closePx > 0 && (
                <> Watch <b>{fmtPx(next.flip)}</b>: {closePx > next.flip ? "below it the suppression is gone" : "above it the suppression comes back"}
                  {next.putWall != null && closePx > next.flip ? ` and ${fmtPx(next.putWall)} becomes the target.` : "."}
                </>
              )}
            </div>
          </>
        )}
      </div>

      {/* ── 6. JOURNAL · ACCURACY · REPLAY ───────────────────────────────── */}
      <div className="sec">
        <div className="body" style={{ gridTemplateColumns: "1.05fr 1fr 1fr" }}>
          <div className="col">
            <div className="colhead"><h3><span className="secn">6</span>Session journal</h3><span className="tiny">{etDate} · saved on this device</span></div>
            <div className="stat">
              <span className="l">Auto-read</span>
              <span className="r" style={{ fontWeight: 500, fontSize: 11.5, textAlign: "right" }}>
                {gradeOf("CW")?.status ?? "—"} call wall · {gradeOf("PW")?.status ?? "—"} put wall · flip {gradeOf("FLIP")?.status?.toLowerCase() ?? "—"}
              </span>
            </div>
            <textarea
              className="jot"
              style={{ marginTop: 9 }}
              placeholder="What you faded, what you chased, what you'd do differently tomorrow…"
              value={note}
              onChange={(e) => saveNote(e.target.value)}
            />
          </div>

          <div className="col">
            <div className="colhead"><h3>Level accuracy</h3><span className="tiny">last {accRows.length || 0} sessions</span></div>
            {accRows.length === 0 ? (
              <div className="warnbar">
                Nothing logged yet. This tab writes one row per session after 16:05 ET — the streak fills in
                as you use it.
              </div>
            ) : (
              <>
                <div className="acc">
                  {accRows.map((r) => {
                    const score = (r.cw ? 34 : 0) + (r.pw ? 33 : 0) + (r.inside ? 33 : 0);
                    return <div className="c" key={r.date} title={r.date}><i style={{ height: `${Math.max(6, score)}%` }} /></div>;
                  })}
                </div>
                <div className="heatx"><span>{accRows[0]?.date.slice(5)}</span><span>{accRows[accRows.length - 1]?.date.slice(5)}</span></div>
                <div className="greeks" style={{ gridTemplateColumns: "repeat(2,1fr)" }}>
                  <div className="g"><div className="n">Call wall held</div><div className="v mono">{hitRate((r) => r.cw)}</div></div>
                  <div className="g"><div className="n">Put wall held</div><div className="v mono">{hitRate((r) => r.pw)}</div></div>
                  <div className="g"><div className="n">Closed inside</div><div className="v mono">{hitRate((r) => r.inside)}</div></div>
                  <div className="g"><div className="n">Pinned the CB</div><div className="v mono">{hitRate((r) => r.pinned)}</div></div>
                </div>
              </>
            )}
          </div>

          <div className="col">
            <div className="colhead"><h3>Replay the day</h3><span className="tiny">{cols.length ? `${cols.length} minutes recorded` : "no recording"}</span></div>
            {cols.length === 0 ? (
              <div className="warnbar">No per-minute ladder for today, so there is nothing to scrub.</div>
            ) : (
              <>
                <div className="replay">
                  <span className="tiny mono">{etHm(cols[0].ts)}</span>
                  <input
                    type="range"
                    min={0}
                    max={cols.length - 1}
                    value={replayIdx}
                    onChange={(e) => setRIdx(Number(e.target.value))}
                  />
                  <span className="tiny mono">{etHm(cols[cols.length - 1].ts)}</span>
                </div>
                <div className="readout">
                  <div>At <b className="mono">{replay ? etHm(replay.ts) : "—"}</b></div>
                  <div>SPX <b className="mono">{fmtPx(replay?.spot)}</b></div>
                  <div>Net GEX <b className="mono">{fmtUsd(replay?.net ?? null)}</b></div>
                  <div>Flip <b className="mono" style={{ color: "var(--amber)" }}>{fmtPx(replay?.flip)}</b></div>
                  <div>CB <b className="mono" style={{ color: "var(--violet)" }}>{fmtPx(replay?.cb)}</b></div>
                </div>
                <div className="tiny" style={{ marginTop: 8 }}>
                  Same frames the ES chart&apos;s bubble trail rides — scrub to see when the book actually moved.
                </div>
              </>
            )}
          </div>
        </div>
      </div>

      <div className="footbar">
        <span className="l">
          Recap for {etDate} · {expiry || "—"} · ES {fmtPx(esFut, 2)}
          {em != null ? ` · EM ±${nf(em, 0)}` : ""}
        </span>
        <span className="l">
          {histState === "ok" ? "intraday ladder: recorded" : "intraday ladder: unavailable"} ·{" "}
          {nextState === "ok" ? "next expiry: loaded" : "next expiry: unavailable"}
        </span>
      </div>
    </section>
  );
}
