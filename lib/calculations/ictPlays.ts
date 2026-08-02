/**
 * ictPlays — turn the raw ICT detector output into TRADEABLE PLAYS.
 *
 * `ictConcepts.ts` answers "what is on the chart" (gaps, blocks, pools, breaks).
 * This module answers "is there a trade, and where are entry / stop / targets" —
 * the numbers a long/short position tool needs to be drawn on the chart.
 *
 * A play has four states:
 *   armed  — the setup is POSSIBLE but has not triggered (pool pierced but the
 *            candle hasn't closed back inside; price approaching an unmitigated
 *            OB / OTE band). Drawn dashed + faded.
 *   live   — the trigger bar has printed and the trade is working. Drawn solid.
 *   won    — 3R tagged, or the stop was hit after ≥1R of run.
 *   lost   — the stop was hit having never reached 1R.
 *
 * RISK MATH IS DELIBERATELY IDENTICAL TO THE RECORDER
 * (`app/api/ict-setups/route.ts` → `extractSetups`): entry = trigger-bar close,
 * stop = nearest swing pivot on the wrong side of entry (gated on `confirmTs`,
 * never on formation — that was the lookahead bug), buffered by 0.15 × ATR(14),
 * with a ≥1-buffer floor so a degenerate stop can't produce infinite R. If the
 * two ever drift, the boxes on the chart stop matching the win rates on
 * /dev/results, so change them together.
 *
 * Targets are the 1R / 2R / 3R ladder off that risk — the same R the grader
 * measures in, so a box tagging "2R" on the chart is the same 2R the leaderboard
 * counts.
 */

import type {
  Dir, IctAnalysis, IctCandle, LiquidityPool, OrderBlock,
} from "./ictConcepts";

export type PlayState = "armed" | "live" | "won" | "lost";

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
  armedTs: number;          // when the setup became POSSIBLE
  triggerTs: number | null; // when it went LIVE (null while still armed)
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
  const px = last.close;

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
  /** "price is at the level" tolerance for the ARMED checks. */
  const near = Math.max(1, atr * 0.6);

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

  /** A play that has already triggered — entry is the trigger bar's close. */
  const pushLive = (
    kind: PlayKind, dir: Dir, triggerTs: number, level: number, note: string,
    zone: { top: number; bottom: number } | null = null,
  ) => {
    const bar = byTs.get(triggerTs);
    const entry = round2(bar ? bar.close : level);
    const stop = round2(structuralStop(dir, entry, triggerTs));
    const risk = Math.abs(entry - stop);
    if (!(risk > 0) || !Number.isFinite(entry)) return;
    const targets = PLAY_TARGET_RS.map((r) => round2(dir === "bull" ? entry + r * risk : entry - r * risk));
    const g = grade(dir, entry, stop, risk, triggerTs);
    out.push({
      id: `${kind}:${dir}:${triggerTs}:${entry}`,
      kind, label: PLAY_META[kind].label, conceptId: PLAY_META[kind].conceptId,
      dir, state: g.state, armedTs: triggerTs, triggerTs,
      entry, stop, risk: round2(risk), targets,
      hitR: g.hitR, mfeR: g.mfeR, resolvedTs: g.resolvedTs, note, zone,
    });
  };

  /** A play that is only POSSIBLE — entry is the level price would trade at. */
  const pushArmed = (
    kind: PlayKind, dir: Dir, armedTs: number, entryLevel: number, note: string,
    zone: { top: number; bottom: number } | null = null,
  ) => {
    const entry = round2(entryLevel);
    const stop = round2(structuralStop(dir, entry, last.timestamp));
    const risk = Math.abs(entry - stop);
    if (!(risk > 0) || !Number.isFinite(entry)) return;
    const targets = PLAY_TARGET_RS.map((r) => round2(dir === "bull" ? entry + r * risk : entry - r * risk));
    out.push({
      id: `armed:${kind}:${dir}:${entry}`,
      kind, label: PLAY_META[kind].label, conceptId: PLAY_META[kind].conceptId,
      dir, state: "armed", armedTs, triggerTs: null,
      entry, stop, risk: round2(risk), targets,
      hitR: 0, mfeR: 0, resolvedTs: null, note, zone,
    });
  };

  // ── LIVE: the model detectors are already point-in-time triggers ───────────
  const signalGroups: Array<[PlayKind, typeof a.turtleSoup]> = [
    ["turtleSoup", a.turtleSoup],
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
  const obRetest = new Map<OrderBlock, IctCandle | undefined>();
  for (const o of a.orderBlocks) {
    if (!o.valid || o.violated) continue;
    const retest = candles.find((c) => c.timestamp > o.confirmTs && c.low <= o.top && c.high >= o.bottom);
    obRetest.set(o, retest);
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
    } else if (px >= lo - near && px <= hi + near) {
      // ARMED: price is walking into the discount/premium band but hasn't tagged it.
      pushArmed("ote", a.range.dir, last.timestamp, (lo + hi) / 2,
        `price ${round2(Math.min(Math.abs(px - lo), Math.abs(px - hi)))} pts from OTE`, { top: hi, bottom: lo });
    }
  }

  // ── ARMED: valid OB never retested, price approaching the zone ─────────────
  for (const o of a.orderBlocks) {
    if (!o.valid || o.violated) continue;
    if (obRetest.get(o)) continue;                  // already live above
    const edge = o.dir === "bull" ? o.top : o.bottom;
    if (Math.abs(px - edge) > near * 3) continue;   // still miles away
    pushArmed("ob", o.dir, o.confirmTs, o.dir === "bull" ? o.bottom : o.top,
      `OB ${round2(o.bottom)}–${round2(o.top)} awaiting retest`, { top: o.top, bottom: o.bottom });
  }

  // ── ARMED: EQ pool pierced on the live bar, no close back inside yet ───────
  // This is the bar BEFORE a Turtle Soup confirms — the moment the trade becomes
  // possible. If the bar closes back inside, `detectTurtleSoup` promotes it to a
  // live play on the next analysis pass and the armed copy is dropped below.
  const pierced = (p: LiquidityPool): boolean =>
    p.side === "BSL" ? last.high > p.price && last.close >= p.price
                     : last.low < p.price && last.close <= p.price;
  for (const p of a.liquidity) {
    if (p.count < 2) continue;                      // Turtle Soup needs equal H/L
    if (last.timestamp <= p.confirmTs) continue;
    if (!pierced(p)) continue;
    pushArmed("turtleSoup", p.side === "BSL" ? "bear" : "bull", last.timestamp, p.price,
      `EQ${p.side === "BSL" ? "H" : "L"} ${round2(p.price)} pierced — needs close back inside`);
  }

  // ── ARMED: breaker zone identified, price approaching, no retest yet ───────
  for (const s of a.structure.slice(-8)) {
    const ob = a.orderBlocks.filter((o) => o.ts < s.ts && o.dir !== s.dir).sort((x, y) => y.ts - x.ts)[0];
    if (!ob) continue;
    const retested = candles.some((c) => c.timestamp > s.ts && c.low <= ob.top && c.high >= ob.bottom);
    if (retested) continue;                         // detectBreakers already has it
    const edge = s.dir === "bull" ? ob.top : ob.bottom;
    if (Math.abs(px - edge) > near * 3) continue;
    pushArmed("breaker", s.dir, s.ts, edge,
      `${s.kind} through OB ${round2(ob.bottom)}–${round2(ob.top)} — awaiting retest`,
      { top: ob.top, bottom: ob.bottom });
  }

  // ── Prune ─────────────────────────────────────────────────────────────────
  const maxOpenMs = maxOpenBars * barMs;
  const keepResolvedMs = keepResolvedBars * barMs;
  const fresh = out.filter((p) => {
    if (p.state === "armed") return true;
    if (p.resolvedTs != null) return now - p.resolvedTs <= keepResolvedMs;
    return p.triggerTs != null && now - p.triggerTs <= maxOpenMs;
  });

  // An armed play is superseded once the same concept fires in the same
  // direction after it armed — otherwise the ghost box sits on top of the real one.
  const superseded = (p: IctPlay) =>
    p.state === "armed" &&
    fresh.some((q) => q.state !== "armed" && q.kind === p.kind && q.dir === p.dir &&
      (q.triggerTs ?? 0) >= p.armedTs - barMs);

  // Same entry from two detectors → keep the one with the better R already banked.
  const seen = new Map<string, IctPlay>();
  for (const p of fresh) {
    if (superseded(p)) continue;
    const key = `${p.kind}:${p.dir}:${Math.round(p.entry)}`;
    const prev = seen.get(key);
    if (!prev || (p.triggerTs ?? 0) > (prev.triggerTs ?? 0)) seen.set(key, p);
  }

  // Fill the box budget by usefulness, not just recency: a working trade outranks
  // a maybe, and both outrank a play that already finished. Resolved plays keep at
  // most 2 slots so a busy detector (inducement fires often) can't crowd out the
  // live markup.
  const newest = (x: IctPlay, y: IctPlay) => (y.triggerTs ?? y.armedTs) - (x.triggerTs ?? x.armedTs);
  const all = [...seen.values()];
  const live = all.filter((p) => p.state === "live").sort(newest);
  const armedPlays = all.filter((p) => p.state === "armed").sort(newest);
  const resolved = all.filter((p) => p.state === "won" || p.state === "lost").sort(newest).slice(0, 1);
  return [...live, ...armedPlays, ...resolved].slice(0, limit);
}

/** "LONG" / "SHORT" — the position-tool wording, not the detector wording. */
export const playSide = (dir: Dir): "LONG" | "SHORT" => (dir === "bull" ? "LONG" : "SHORT");

/** Reward:risk of the full box (always 3 with the 1R/2R/3R ladder, but derived
 *  so a future custom ladder still prints the right number). */
export const playRR = (p: IctPlay): number =>
  p.risk > 0 ? Math.abs(p.targets[p.targets.length - 1] - p.entry) / p.risk : 0;
