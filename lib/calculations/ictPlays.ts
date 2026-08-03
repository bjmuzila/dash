/**
 * ictPlays — turn the raw ICT detector output into TRADEABLE PLAYS.
 *
 * `ictConcepts.ts` answers "what is on the chart" (gaps, blocks, pools, breaks).
 * This module answers "is there a trade, and where are entry / stop / targets" —
 * the numbers a long/short position tool needs to be drawn on the chart.
 *
 * A play has three states:
 *   live   — the trigger bar has printed and the trade is working.
 *   won    — 3R tagged, or the stop was hit after ≥1R of run.
 *   lost   — the stop was hit having never reached 1R.
 *
 * There is deliberately NO "armed / possible" state. It was tried and cut: the
 * pierce test ("pool taken, waiting for the close back inside") was true for any
 * pool price had simply left behind, so a swept-EQL long stayed marked while
 * price ran away downward — a setup pointing the wrong way. A play appears when
 * its detector actually fires, and not before.
 *
 * RISK MATH MIRRORS THE RECORDER
 * (`app/api/ict-setups/route.ts` → `extractSetups`): entry = trigger-bar close,
 * stop = nearest swing pivot on the wrong side of entry (gated on `confirmTs`,
 * never on formation — that was the lookahead bug), buffered by 0.15 × ATR(14),
 * with a ≥1-buffer floor so a degenerate stop can't produce infinite R. If the
 * two ever drift, the boxes on the chart stop matching the win rates on
 * /dev/results, so change them together.
 *
 * ONE EXCEPTION: **Turtle Soup** is built here from the full ICT model (raid on a
 * short-term swing high/low, inside a Turtle Soup raid window, entry on the first
 * filled reversal FVG, stop beyond the raid wick) rather than from
 * `analysis.turtleSoup`. Its entry and stop therefore do NOT match the recorder,
 * whose `turtleSoup` rows are still the raid-close + structural-stop version — so
 * the leaderboard's Turtle Soup win rate describes a different trade than the box
 * on the chart until the same rules are ported into the route and rescanned.
 *
 * Targets are the 1R / 2R / 3R ladder off that risk — the same R the grader
 * measures in, so a box tagging "2R" on the chart is the same 2R the leaderboard
 * counts.
 */

import { etMinutes, type Dir, type IctAnalysis, type IctCandle } from "./ictConcepts";

/**
 * Turtle Soup raid windows (ET), from theinnercircletraders.com's Turtle Soup
 * write-up. These are NARROWER than `ICT_WINDOWS` in ictConcepts — that list is
 * the general killzone/Silver-Bullet/macro set used by the chart's KZ overlay,
 * while these are the specific windows the Turtle Soup model says a stop raid
 * has to land in to count. Kept local to the play layer on purpose: widening
 * ICT_WINDOWS would repaint the killzone bands and the live badges on every
 * other concept card.
 */
export const TURTLE_RAID_WINDOWS: Array<{ id: string; label: string; startMin: number; endMin: number }> = [
  { id: "londonOpen", label: "London open",        startMin: 2 * 60,        endMin: 2 * 60 + 30 },
  { id: "londonInj",  label: "London injection",   startMin: 3 * 60 + 45,   endMin: 4 * 60 + 8 },
  { id: "nyam1",      label: "NY AM manipulation", startMin: 8 * 60 + 14,   endMin: 8 * 60 + 38 },
  { id: "nyam2",      label: "NY AM manipulation", startMin: 9 * 60 + 23,   endMin: 9 * 60 + 45 },
  { id: "lunch",      label: "Lunch liquidity raid", startMin: 12 * 60 + 45, endMin: 13 * 60 + 8 },
  { id: "nypm",       label: "NY PM raid",         startMin: 14 * 60 + 15,  endMin: 14 * 60 + 38 },
];

/** Label of the raid window a timestamp falls in, or null if it's outside them all. */
export function turtleRaidWindow(ts: number): string | null {
  const m = etMinutes(ts);
  const w = TURTLE_RAID_WINDOWS.find((x) => m >= x.startMin && m < x.endMin);
  return w ? w.label : null;
}

export type PlayState = "live" | "won" | "lost";

/** Only the ICT *models* get a position box — the discretionary plays a trader
 *  actually takes. Structure breaks, displacement legs and every raw FVG fire far
 *  too often to draw a box for each without burying the chart. */
export type PlayKind =
  | "turtleSoup" | "judas" | "cisd" | "model2022" | "breaker" | "inducement"
  | "ob" | "ote";

export interface IctPlay {
  id: string;               // stable across re-renders: kind:dir:triggerTs:entry
  kind: PlayKind;
  label: string;            // "Turtle Soup"
  conceptId: string;        // glossary id, so the box hover reuses the concept card
  dir: Dir;
  state: PlayState;
  triggerTs: number;        // the bar the setup fired on
  entry: number;
  stop: number;
  risk: number;             // |entry − stop| in points; the R unit
  targets: number[];        // [1R, 2R, 3R] prices
  hitR: number;             // highest whole-R target actually tagged (0–3)
  mfeR: number;             // max favourable excursion, in R
  resolvedTs: number | null;// bar the play finished on (stop hit / 3R tagged)
  note: string;
  zone: { top: number; bottom: number } | null; // the zone being traded, if any
}

export const PLAY_TARGET_RS = [1, 2, 3];

const PLAY_META: Record<PlayKind, { label: string; conceptId: string }> = {
  turtleSoup: { label: "Turtle Soup", conceptId: "turtle" },
  judas:      { label: "Judas Swing", conceptId: "judas" },
  cisd:       { label: "CISD",        conceptId: "cisd" },
  model2022:  { label: "2022 Model",  conceptId: "model2022" },
  breaker:    { label: "Breaker",     conceptId: "breaker" },
  inducement: { label: "Inducement",  conceptId: "idm" },
  ob:         { label: "Order Block", conceptId: "ob" },
  ote:        { label: "OTE Entry",   conceptId: "ote" },
};

export const playLabel = (k: PlayKind): string => PLAY_META[k]?.label ?? k;

const round2 = (n: number) => Math.round(n * 100) / 100;

export interface BuildPlaysOptions {
  /** Wall clock (injectable for tests / replay). */
  now?: number;
  /** Bar size of the candle array, minutes. Ages scale with the timeframe. */
  tfMin?: number;
  /** Drop live plays that have gone this many bars without resolving. */
  maxOpenBars?: number;
  /** Keep a resolved play on the chart for this many bars after it finished. */
  keepResolvedBars?: number;
  /** Hard cap on plays returned (newest first). */
  limit?: number;
}

/**
 * Build every armed / live / just-resolved play from an existing IctAnalysis.
 * Pass the SAME candle array `analyzeICT` was run on — entries are looked up by
 * bar timestamp.
 */
export function buildIctPlays(
  candles: IctCandle[],
  a: IctAnalysis,
  opts: BuildPlaysOptions = {},
): IctPlay[] {
  if (candles.length < 3) return [];

  const tfMin = opts.tfMin ?? 5;
  const barMs = tfMin * 60_000;
  const maxOpenBars = opts.maxOpenBars ?? 24;      // ~2h on 5m
  const keepResolvedBars = opts.keepResolvedBars ?? 6;
  const limit = opts.limit ?? 4;

  const last = candles[candles.length - 1];
  const now = opts.now ?? Math.max(Date.now(), last.timestamp);

  const byTs = new Map<number, IctCandle>(candles.map((c) => [c.timestamp, c]));
  const idxOf = new Map<number, number>(candles.map((c, i) => [c.timestamp, i]));

  // ATR(14) on the active timeframe → stop buffer. Mirrors the recorder.
  const atr = (() => {
    const n = Math.min(14, candles.length - 1);
    if (n <= 0) return 2;
    let sum = 0;
    for (let i = candles.length - n; i < candles.length; i++) {
      const c = candles[i], p = candles[i - 1];
      sum += Math.max(c.high - c.low, Math.abs(c.high - p.close), Math.abs(c.low - p.close));
    }
    return Math.max(1, sum / n);
  })();
  const buf = Math.max(1, atr * 0.15);

  /**
   * Structure-based stop: nearest confirmed swing pivot on the wrong side of
   * entry, buffered beyond by ATR. Gate on `confirmTs` — a fractal pivot needs k
   * bars to its right to exist, so gating on `ts` puts future data in the risk
   * denominator and inflates every R downstream.
   */
  const structuralStop = (dir: Dir, entry: number, ts: number): number => {
    if (dir === "bull") {
      const lows = a.pivots.filter((p) => p.type === "low" && p.confirmTs <= ts && p.price < entry).map((p) => p.price);
      const lvl = lows.length ? Math.max(...lows) : entry - atr;
      return Math.min(lvl - buf, entry - buf);
    }
    const highs = a.pivots.filter((p) => p.type === "high" && p.confirmTs <= ts && p.price > entry).map((p) => p.price);
    const lvl = highs.length ? Math.min(...highs) : entry + atr;
    return Math.max(lvl + buf, entry + buf);
  };

  /**
   * Walk the bars after the trigger to grade the play: peak MFE in R, which
   * whole-R targets got tagged, and whether the stop was hit. Stop-before-target
   * within the same bar resolves as the stop (conservative — we can't see the
   * intrabar path).
   */
  const grade = (dir: Dir, entry: number, stop: number, risk: number, triggerTs: number) => {
    const start = (idxOf.get(triggerTs) ?? -1) + 1;
    let mfe = 0, hitR = 0, resolvedTs: number | null = null, stopped = false;
    if (start > 0) {
      for (let i = start; i < candles.length; i++) {
        const c = candles[i];
        const fav = dir === "bull" ? c.high - entry : entry - c.low;
        if (fav > mfe) mfe = fav;
        const hitStop = dir === "bull" ? c.low <= stop : c.high >= stop;
        const r = risk > 0 ? fav / risk : 0;
        // Stop and target on the SAME bar is unresolvable without intrabar data →
        // resolve as the stop and bank no new R rung (the MFE still counts it, the
        // same way the recorder grades it).
        if (hitStop) { stopped = true; resolvedTs = c.timestamp; break; }
        if (r >= 1) hitR = Math.min(3, Math.max(hitR, Math.floor(r)));
        if (r >= 3) { resolvedTs = c.timestamp; break; }
      }
    }
    const mfeR = risk > 0 ? mfe / risk : 0;
    const state: PlayState = stopped
      ? (mfeR >= 1 ? "won" : "lost")
      : resolvedTs != null ? "won" : "live";
    return { mfeR, hitR, resolvedTs, state };
  };

  const out: IctPlay[] = [];

  /**
   * A play that has already triggered.
   * `level` is the concept's price; entry defaults to the trigger bar's close.
   * `opts.entryPrice` overrides that (Turtle Soup enters at the reversal FVG, not
   * at the raid candle) and `opts.stopPrice` overrides the structural stop.
   */
  const pushLive = (
    kind: PlayKind, dir: Dir, triggerTs: number, level: number, note: string,
    zone: { top: number; bottom: number } | null = null,
    opts2: { entryPrice?: number; stopPrice?: number } = {},
  ) => {
    const bar = byTs.get(triggerTs);
    const entry = round2(opts2.entryPrice ?? (bar ? bar.close : level));
    const rawStop = opts2.stopPrice ?? structuralStop(dir, entry, triggerTs);
    // Whatever the source, the stop must sit on the losing side of entry with at
    // least one buffer of room, or R is meaningless.
    const stop = round2(dir === "bull"
      ? Math.min(rawStop, entry - buf)
      : Math.max(rawStop, entry + buf));
    const risk = Math.abs(entry - stop);
    if (!(risk > 0) || !Number.isFinite(entry)) return;
    const targets = PLAY_TARGET_RS.map((r) => round2(dir === "bull" ? entry + r * risk : entry - r * risk));
    const g = grade(dir, entry, stop, risk, triggerTs);
    out.push({
      id: `${kind}:${dir}:${triggerTs}:${entry}`,
      kind, label: PLAY_META[kind].label, conceptId: PLAY_META[kind].conceptId,
      dir, state: g.state, triggerTs,
      entry, stop, risk: round2(risk), targets,
      hitR: g.hitR, mfeR: g.mfeR, resolvedTs: g.resolvedTs, note, zone,
    });
  };

  // ── LIVE: Turtle Soup, per the ICT model ──────────────────────────────────
  // Built here rather than taken from `a.turtleSoup` (which only fires on EQH/EQL
  // clusters and enters at the raid candle). The model is:
  //   1. a raid on a SHORT-TERM SWING HIGH/LOW — any confirmed fractal pivot, not
  //      just relative-equal levels;
  //   2. inside one of the Turtle Soup raid windows (TURTLE_RAID_WINDOWS);
  //   3. the raid candle closes back INSIDE the level — the breakout failed;
  //   4. entry on the FIRST FVG created on the reversal (consequent encroachment
  //      = the gap's midpoint), falling back to the raid close if no gap prints
  //      within FVG_WAIT bars, so a clean raid is never left unmarked;
  //   5. stop beyond the raid wick — the high/low the stop hunt actually printed.
  //
  // NOTE: steps 4–5 make Turtle Soup the ONE kind whose entry/stop differ from
  // `app/api/ict-setups/route.ts`, so its leaderboard row is still graded from the
  // raid-close + structural-stop version. Port the same rules there (and rescan)
  // if the two need to agree again.
  {
    const tol = Math.max(0.25, atr * 0.05);
    const RAID_WAIT = 24;   // bars a pivot stays raidable after it confirms
    const FVG_WAIT = 6;     // bars to wait for the reversal gap
    const seenRaid = new Set<string>();

    for (const p of a.pivots) {
      const startIdx = p.confirmIdx + 1;
      for (let i = startIdx; i < Math.min(candles.length, startIdx + RAID_WAIT); i++) {
        const c = candles[i];
        const took = p.type === "high" ? c.high > p.price + tol : c.low < p.price - tol;
        if (!took) continue;
        // Closed back inside → failed breakout. Closed beyond → real break, and
        // this pivot is spent either way.
        const failed = p.type === "high" ? c.close < p.price : c.close > p.price;
        if (!failed) break;
        const win = turtleRaidWindow(c.timestamp);
        if (!win) break;                       // right shape, wrong time
        const dir: Dir = p.type === "high" ? "bear" : "bull";
        const key = `${dir}:${c.timestamp}`;
        if (seenRaid.has(key)) break;
        seenRaid.add(key);

        // Reversal FVGs created within FVG_WAIT bars of the raid, oldest first.
        const gaps = a.fvgs
          .map((f) => ({ f, activeTs: f.inverted && f.invertedTs != null ? f.invertedTs : f.ts }))
          .filter(({ f, activeTs }) => f.activeDir === dir && activeTs > c.timestamp &&
            activeTs - c.timestamp <= FVG_WAIT * barMs)
          .sort((x, y) => x.activeTs - y.activeTs);

        const raidStop = dir === "bull" ? c.low - buf : c.high + buf;
        const lvl = round2(p.price);
        const sideTxt = dir === "bull" ? "SSL" : "BSL";

        // An FVG entry is a RESTING order: the gap forms away from price, and the
        // trade only exists once price trades back into it. Stamping the trigger
        // at gap creation would start grading from a price that never traded and
        // hand every setup free MFE — so the play waits for the fill bar, and
        // until then the raid close stands as the fallback entry.
        // Take the EARLIEST gap that price actually came back to — if the first
        // one never gets filled it was never a trade, and the next gap in the
        // reversal is the one the entry happened at.
        let filled: { ts: number; entry: number; zone: { top: number; bottom: number } } | null = null;
        for (const gap of gaps) {
          const mid = (gap.f.top + gap.f.bottom) / 2;   // consequent encroachment
          const fillBar = candles.find((b) => b.timestamp > gap.activeTs && b.low <= mid && b.high >= mid);
          if (fillBar) { filled = { ts: fillBar.timestamp, entry: mid, zone: { top: gap.f.top, bottom: gap.f.bottom } }; break; }
        }

        if (filled) {
          pushLive("turtleSoup", dir, filled.ts, filled.entry,
            `${sideTxt} raid ${lvl} · ${win} → FVG entry ${round2(filled.zone.bottom)}–${round2(filled.zone.top)}`,
            filled.zone, { entryPrice: filled.entry, stopPrice: raidStop });
        } else {
          pushLive("turtleSoup", dir, c.timestamp, p.price,
            `${sideTxt} raid ${lvl} · ${win} · ${gaps.length ? "reversal FVG unfilled — raid close" : "no reversal FVG — raid close"}`,
            null, { stopPrice: raidStop });
        }
        break;                                  // one raid per pivot
      }
    }
  }

  // ── LIVE: the remaining model detectors are already point-in-time triggers ──
  const signalGroups: Array<[PlayKind, typeof a.judas]> = [
    ["judas",      a.judas],
    ["cisd",       a.cisd],
    ["model2022",  a.model2022],
    ["breaker",    a.breakers],
    ["inducement", a.inducement],
  ];
  for (const [kind, sigs] of signalGroups) {
    for (const s of sigs) pushLive(kind, s.dir, s.ts, s.price, s.note ?? `${PLAY_META[kind].label} ${s.dir}`);
  }

  // ── LIVE: valid order block, traded back into after confirmation ───────────
  // The trade is the RETEST, never the OB candle itself — entering at `o.ts`
  // books the pre-impulse price with hindsight.
  for (const o of a.orderBlocks) {
    if (!o.valid || o.violated) continue;
    const retest = candles.find((c) => c.timestamp > o.confirmTs && c.low <= o.top && c.high >= o.bottom);
    if (retest) {
      pushLive("ob", o.dir, retest.timestamp, o.dir === "bull" ? o.bottom : o.top,
        `OB ${round2(o.bottom)}–${round2(o.top)} retest`, { top: o.top, bottom: o.bottom });
    }
  }

  // ── LIVE: first bar to trade into the OTE band ─────────────────────────────
  if (a.range) {
    const lo = Math.min(a.range.ote.from, a.range.ote.to);
    const hi = Math.max(a.range.ote.from, a.range.ote.to);
    const entryBar = candles.find((c) => c.low <= hi && c.high >= lo);
    if (entryBar) {
      pushLive("ote", a.range.dir, entryBar.timestamp, (lo + hi) / 2,
        `OTE ${round2(lo)}–${round2(hi)} (${a.range.dir})`, { top: hi, bottom: lo });
    }
  }

  // ── Prune ─────────────────────────────────────────────────────────────────
  const maxOpenMs = maxOpenBars * barMs;
  const keepResolvedMs = keepResolvedBars * barMs;
  const fresh = out.filter((p) => (p.resolvedTs != null
    ? now - p.resolvedTs <= keepResolvedMs
    : now - p.triggerTs <= maxOpenMs));

  // Same entry from two detectors → keep the most recent trigger.
  const seen = new Map<string, IctPlay>();
  for (const p of fresh) {
    const key = `${p.kind}:${p.dir}:${Math.round(p.entry)}`;
    const prev = seen.get(key);
    if (!prev || p.triggerTs > prev.triggerTs) seen.set(key, p);
  }

  // Fill the budget by usefulness, not just recency: a working trade outranks one
  // that already finished. Resolved plays keep at most 1 slot so a busy detector
  // (inducement fires often) can't crowd out the live markup.
  const newest = (x: IctPlay, y: IctPlay) => y.triggerTs - x.triggerTs;
  const all = [...seen.values()];
  const live = all.filter((p) => p.state === "live").sort(newest);
  const resolved = all.filter((p) => p.state !== "live").sort(newest).slice(0, 1);
  return [...live, ...resolved].slice(0, limit);
}

/** "LONG" / "SHORT" — the position-tool wording, not the detector wording. */
export const playSide = (dir: Dir): "LONG" | "SHORT" => (dir === "bull" ? "LONG" : "SHORT");

/** Reward:risk of the full box (always 3 with the 1R/2R/3R ladder, but derived
 *  so a future custom ladder still prints the right number). */
export const playRR = (p: IctPlay): number =>
  p.risk > 0 ? Math.abs(p.targets[p.targets.length - 1] - p.entry) / p.risk : 0;
