// ─── TPO structures: tails / excess / poor highs+lows / holes / naked POC ────
//
// This is the "open business" engine. It takes the same 5m RTH candles the rest
// of the app already has (useEsCandles / useNqCandles), builds a real TPO
// profile per session (one touch per 30-min period per price bin — TIME, not
// volume), then extracts the auction structures that matter and FORWARD-FILLS
// them across every later session so you can ask the only question that pays:
//
//     "which of these levels is still unfinished, how old is it, and how often
//      does this kind of level actually get revisited?"
//
// A tail is nearly worthless intraday. It is very valuable as an untested level
// three weeks later. That asymmetry is why `structures` (a forward-filled list)
// is the product and `sessions` (the drawing) is just the input.
//
// ── The four structures are NOT the same trade ───────────────────────────────
//
//   EXCESS   ≥2 consecutive single prints at an extreme, AND the period that
//            created them CLOSED BACK INSIDE the body. A rejection. The auction
//            ended properly. → The level HOLDS. Fade back toward POC.
//
//   TAIL     Same singles at the extreme, but the period closed away (out at the
//            extreme). That is a TREND leg leaving singles behind — continuation,
//            not rejection. Trading this like excess is how you get run over,
//            which is exactly why we track the period close and split the two.
//
//   POOR     A flat stack (≥2 TPOs) at the extreme with NO tail. The auction ran
//   HIGH/LOW out of time, not out of buyers/sellers. Unfinished. → The level does
//            NOT hold. Expect it to be taken out. Trade TOWARD it.
//
//   HOLE     Single prints in the MIDDLE of the profile. No acceptance — price
//            ripped through. → A thin zone. Price ACCELERATES through it, it does
//            not react to it. Never put a target inside one; targets go on the
//            far side.
//
// Everything below is computed from 5m OHLC bars, which is an approximation of a
// true tick-built profile: a 30-min period's "touched range" is the high-low of
// its 5m bars, so very brief excursions can be over- or under-represented at the
// bin edges. Structures are therefore bin-size sensitive — sweep `binSize` in the
// backtest rather than trusting the default.

import { groupRthByDate } from "@/lib/balanceImbalance";
import type { EsCandle } from "@/hooks/useEsCandles";

export const TPO_PERIOD_MS = 30 * 60_000;

export interface TpoBin { price: number; count: number }

export type StructureKind =
  | "excess_high" | "excess_low"
  | "tail_high"   | "tail_low"
  | "poor_high"   | "poor_low"
  | "hole"
  | "naked_poc";

export interface TpoStructure {
  id: string;
  date: string;            // session that created it
  kind: StructureKind;
  side: "up" | "down";     // which end of the profile it sits at ("up" for a hole above POC)
  priceLo: number;
  priceHi: number;
  createdTs: number;

  // forward-filled by buildTpoStructures() across every LATER session
  testedAt: number | null;    // first later bar whose range intersects the band
  repairedAt: number | null;  // first later bar that traded fully beyond it (business closed)
  touches: number;            // distinct later sessions that intersected the band
  ageSessions: number;        // sessions elapsed since created (as of the last session in the set)
}

export interface TpoSession {
  date: string;
  bins: TpoBin[];            // ascending by price
  maxCount: number;
  poc: number;
  vah: number;
  val: number;
  mid: number;
  high: number;
  low: number;
  ibHigh: number | null;     // first two 30-min periods (09:30–10:30)
  ibLow: number | null;
  ibRange: number | null;
  periods: number;
  singles: number[];                 // bin prices with count === 1
  structures: TpoStructure[];        // this session's structures (not yet forward-filled)
}

export interface KindStat {
  kind: StructureKind;
  n: number;
  tested: number;
  repaired: number;
  testRate: number | null;       // null when n === 0 — never render 0% for "no sample"
  repairRate: number | null;
  medSessionsToTest: number | null;
}

export interface TpoResult {
  sessions: TpoSession[];
  structures: TpoStructure[];   // ALL structures, forward-filled, newest last
  open: TpoStructure[];         // repairedAt === null — the Open Business rail
  stats: KindStat[];
  binSize: number;
}

// ── one session ──────────────────────────────────────────────────────────────

/**
 * Build one session's TPO profile + its structures.
 * `bars` must be ONE session's RTH bars, ascending. Pass RTH only — ETH single
 * prints are a liquidity artifact (thin overnight book), not an auction failure,
 * and folding them in poisons every stat downstream.
 */
export function buildTpoSession(
  bars: EsCandle[],
  date: string,
  binSize = 1,
  vaPct = 0.70,
  periodMs = TPO_PERIOD_MS,
): TpoSession | null {
  if (!bars.length || !(binSize > 0)) return null;
  const floorBin = (p: number) => Math.floor(p / binSize) * binSize;

  // Collapse 5m bars into 30-min TPO periods. We keep each period's CLOSE — the
  // existing es-candles buildTpoProfile only tracks low/high, and without the
  // close you cannot tell excess (rejection, closed back inside) from a trend
  // leg's leftover singles (continuation). Those are opposite trades.
  type Period = { lo: number; hi: number; close: number; ts: number; lastTs: number };
  const byPeriod = new Map<number, Period>();
  for (const c of bars) {
    const k = Math.floor(c.timestamp / periodMs) * periodMs;
    const p = byPeriod.get(k);
    if (!p) byPeriod.set(k, { lo: c.low, hi: c.high, close: c.close, ts: k, lastTs: c.timestamp });
    else {
      if (c.low < p.lo) p.lo = c.low;
      if (c.high > p.hi) p.hi = c.high;
      if (c.timestamp >= p.lastTs) { p.close = c.close; p.lastTs = c.timestamp; }
    }
  }
  const periods = [...byPeriod.values()].sort((a, b) => a.ts - b.ts);
  if (!periods.length) return null;

  // One touch per bin per period — this is TPO (time), not volume.
  const counts = new Map<number, number>();
  for (const p of periods) {
    const b0 = floorBin(p.lo), b1 = floorBin(p.hi);
    for (let b = b0; b <= b1 + 1e-9; b += binSize) counts.set(b, (counts.get(b) ?? 0) + 1);
  }
  const bins: TpoBin[] = [...counts.entries()]
    .map(([price, count]) => ({ price, count }))
    .sort((a, b) => a.price - b.price);
  if (bins.length < 3) return null;

  let pocIdx = 0;
  for (let i = 1; i < bins.length; i++) if (bins[i].count > bins[pocIdx].count) pocIdx = i;
  const total = bins.reduce((s, b) => s + b.count, 0);
  const target = total * vaPct;

  let loI = pocIdx, hiI = pocIdx, acc = bins[pocIdx].count;
  while (acc < target && (loI > 0 || hiI < bins.length - 1)) {
    const below = loI > 0 ? bins[loI - 1].count : -1;
    const above = hiI < bins.length - 1 ? bins[hiI + 1].count : -1;
    if (above >= below) { hiI++; acc += Math.max(0, above); }
    else { loI--; acc += Math.max(0, below); }
  }

  const high = Math.max(...bars.map((b) => b.high));
  const low = Math.min(...bars.map((b) => b.low));
  const poc = bins[pocIdx].price, vah = bins[hiI].price, val = bins[loI].price;

  const ib = periods.slice(0, 2);
  const ibHigh = ib.length ? Math.max(...ib.map((p) => p.hi)) : null;
  const ibLow = ib.length ? Math.min(...ib.map((p) => p.lo)) : null;

  // ── singles → contiguous runs ──────────────────────────────────────────────
  const singleIdx = bins.map((b, i) => (b.count === 1 ? i : -1)).filter((i) => i >= 0);
  const runs: number[][] = [];
  for (const i of singleIdx) {
    const last = runs[runs.length - 1];
    if (last && i === last[last.length - 1] + 1) last.push(i);
    else runs.push([i]);
  }

  const topIdx = bins.length - 1, botIdx = 0;
  const ts = periods[periods.length - 1].lastTs;
  const S: TpoStructure[] = [];
  const mk = (kind: StructureKind, side: "up" | "down", lo: number, hi: number): TpoStructure => ({
    id: `${date}:${kind}:${lo}`, date, kind, side, priceLo: lo, priceHi: hi, createdTs: ts,
    testedAt: null, repairedAt: null, touches: 0, ageSessions: 0,
  });

  const topRun = runs.find((r) => r[r.length - 1] === topIdx && r.length >= 2);
  const botRun = runs.find((r) => r[0] === botIdx && r.length >= 2);

  if (topRun) {
    const lo = bins[topRun[0]].price, hi = bins[topRun[topRun.length - 1]].price;
    // Excess = the period that PRINTED the high closed back inside the body.
    const hiPeriod = periods.reduce((a, b) => (b.hi > a.hi ? b : a));
    const rejected = hiPeriod.close < lo;
    S.push(mk(rejected ? "excess_high" : "tail_high", "up", lo, hi));
  } else if (bins[topIdx].count >= 2) {
    // Flat stack at the extreme, no tail → auction ran out of TIME, not sellers.
    S.push(mk("poor_high", "up", bins[topIdx].price, bins[topIdx].price));
  }

  if (botRun) {
    const lo = bins[botRun[0]].price, hi = bins[botRun[botRun.length - 1]].price;
    const loPeriod = periods.reduce((a, b) => (b.lo < a.lo ? b : a));
    const rejected = loPeriod.close > hi;
    S.push(mk(rejected ? "excess_low" : "tail_low", "down", lo, hi));
  } else if (bins[botIdx].count >= 2) {
    S.push(mk("poor_low", "down", bins[botIdx].price, bins[botIdx].price));
  }

  // Holes = single runs that touch NEITHER extreme. Thin zones inside the body.
  for (const r of runs) {
    if (r[r.length - 1] === topIdx || r[0] === botIdx) continue;
    const lo = bins[r[0]].price, hi = bins[r[r.length - 1]].price;
    S.push(mk("hole", lo >= poc ? "up" : "down", lo, hi));
  }

  S.push(mk("naked_poc", "up", poc, poc));

  return {
    date, bins, maxCount: bins[pocIdx].count, poc, vah, val,
    mid: (high + low) / 2, high, low,
    ibHigh, ibLow, ibRange: ibHigh != null && ibLow != null ? ibHigh - ibLow : null,
    periods: periods.length,
    singles: singleIdx.map((i) => bins[i].price),
    structures: S,
  };
}

// ── forward-fill across sessions ─────────────────────────────────────────────

const TOUCH_PAD = 0.25; // ES tick — a band of zero width (naked POC, poor high) still needs a hit-test

/**
 * Build every session in `candles`, then walk each structure forward through all
 * LATER sessions to mark when it was tested and when it was repaired.
 *
 * tested   = a later bar's [low,high] intersects the band.
 * repaired = a later bar traded fully BEYOND it (business closed):
 *              *_high / naked_poc(up)  → some later bar high  > priceHi
 *              *_low                   → some later bar low   < priceLo
 *              hole                    → a later session traded BOTH above hi and
 *                                        below lo (a full traverse of the thin zone)
 *
 * A naked POC is "repaired" the moment it is touched — that IS the business.
 */
export function buildTpoStructures(candles: EsCandle[], binSize = 1): TpoResult {
  const grouped = groupRthByDate(candles);
  const dates = [...grouped.keys()].sort();

  const sessions: TpoSession[] = [];
  for (const d of dates) {
    const bars = grouped.get(d) ?? [];
    if (bars.length < 6) continue; // need ≥2 periods to say anything
    const s = buildTpoSession(bars, d, binSize);
    if (s) sessions.push(s);
  }

  const all: TpoStructure[] = [];
  for (let i = 0; i < sessions.length; i++) {
    const later = sessions.slice(i + 1);
    for (const st of sessions[i].structures) {
      const lo = st.priceLo - TOUCH_PAD, hi = st.priceHi + TOUCH_PAD;
      let touches = 0;

      for (const s of later) {
        const bars = grouped.get(s.date) ?? [];
        let touchedThisSession = false;
        let above = false, below = false;

        for (const b of bars) {
          if (b.high >= lo && b.low <= hi) {
            touchedThisSession = true;
            if (st.testedAt == null) st.testedAt = b.timestamp;
          }
          if (b.high > st.priceHi) above = true;
          if (b.low < st.priceLo) below = true;

          if (st.repairedAt == null) {
            const done =
              st.kind === "hole" ? above && below
              : st.kind === "naked_poc" ? touchedThisSession
              : st.side === "up" ? b.high > st.priceHi
              : b.low < st.priceLo;
            if (done) st.repairedAt = b.timestamp;
          }
        }
        if (touchedThisSession) touches++;
      }

      st.touches = touches;
      st.ageSessions = sessions.length - 1 - i;
      all.push(st);
    }
  }

  // ── stats rollup, per kind ────────────────────────────────────────────────
  // NOTE: only structures that have had a fair chance to resolve are counted.
  // Grading a tail created 20 minutes ago as "untested" is lookahead bias in
  // reverse — it drags every rate down and makes the sample look worse than it
  // is. Require ≥1 later session before a structure enters the stats.
  const gradable = all.filter((s) => s.ageSessions >= 1);
  const kinds: StructureKind[] = [
    "excess_high", "excess_low", "tail_high", "tail_low",
    "poor_high", "poor_low", "hole", "naked_poc",
  ];
  const stats: KindStat[] = kinds.map((kind) => {
    const g = gradable.filter((s) => s.kind === kind);
    const tested = g.filter((s) => s.testedAt != null);
    const repaired = g.filter((s) => s.repairedAt != null);
    const spans = tested
      .map((s) => sessionsBetween(sessions, s.date, s.testedAt!))
      .filter((n): n is number => n != null)
      .sort((a, b) => a - b);
    return {
      kind,
      n: g.length,
      tested: tested.length,
      repaired: repaired.length,
      testRate: g.length ? tested.length / g.length : null,
      repairRate: g.length ? repaired.length / g.length : null,
      medSessionsToTest: spans.length ? spans[Math.floor(spans.length / 2)] : null,
    };
  });

  return {
    sessions,
    structures: all,
    open: all.filter((s) => s.repairedAt == null).sort((a, b) => b.createdTs - a.createdTs),
    stats,
    binSize,
  };
}

function sessionsBetween(sessions: TpoSession[], fromDate: string, ts: number): number | null {
  const i = sessions.findIndex((s) => s.date === fromDate);
  if (i < 0) return null;
  for (let j = i + 1; j < sessions.length; j++) {
    const s = sessions[j];
    // a session's structures carry its last bar ts; close enough to date-bucket by
    const anyTs = s.structures[0]?.createdTs ?? 0;
    if (anyTs >= ts) return j - i;
  }
  return sessions.length - 1 - i;
}

export const KIND_LABEL: Record<StructureKind, string> = {
  excess_high: "excess hi",
  excess_low: "excess lo",
  tail_high: "tail hi",
  tail_low: "tail lo",
  poor_high: "poor high",
  poor_low: "poor low",
  hole: "hole",
  naked_poc: "naked poc",
};

/** What the structure implies — the if/then, one line, for the rail tooltip. */
export const KIND_MEANING: Record<StructureKind, string> = {
  excess_high: "Rejection — auction ended properly. Level holds; fade back toward POC.",
  tail_high: "Trend leg left singles behind — continuation, NOT rejection. Don't fade it.",
  excess_low: "Rejection — auction ended properly. Level holds; fade back toward POC.",
  tail_low: "Trend leg left singles behind — continuation, NOT rejection. Don't fade it.",
  poor_high: "Unfinished auction — ran out of time, not sellers. Expect it to get taken out.",
  poor_low: "Unfinished auction — ran out of time, not buyers. Expect it to get taken out.",
  hole: "Thin zone — no acceptance. Price accelerates THROUGH. Never target inside it.",
  naked_poc: "Untested fair value from a prior session. Strong magnet.",
};
