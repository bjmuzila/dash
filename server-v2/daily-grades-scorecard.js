'use strict';
/**
 * server-v2/daily-grades-scorecard.js
 *
 * The Daily Grades rubric, as a structured scorecard. Pure math — no I/O, no
 * clock, no database. daily-grades-recorder.js feeds it numbers at 09:26 and
 * again after the close, and stores what comes back.
 *
 * WHY THIS FILE EXISTS
 * --------------------
 * The old rubric asked one question of every level — "did price close back on
 * the side the seal left it on?" — and asked it the same way every day. That is
 * wrong in a specific, knowable way: GEX is a map of modeled dealer HEDGING
 * PRESSURE, and the direction of that pressure flips with the gamma regime. A
 * call wall in positive gamma is a place dealers sell into strength, so it
 * absorbs and a hold is the model working. The SAME wall in negative gamma is a
 * place hedging turns pro-cyclical, so a break with follow-through is the model
 * working and a hold is the model being wrong about the mechanism. Scoring both
 * out of the same table rewards and punishes the map for the wrong things.
 *
 * So the scorecard is ordered the way a premarket read is ordered:
 *
 *   1. REGIME FIRST.   Net GEX sign and where spot sits against the flip decide
 *                      how every level below is expected to behave. Tight or
 *                      oscillating around the flip is its own answer — chop,
 *                      low conviction — not a coin flip between the other two.
 *   2. WALL QUALITY.   Size of the bar, whether the peak is isolated or smeared
 *                      across neighbours, distance from spot, alignment with the
 *                      expected-move band, and round-number confluence.
 *   3. OVERNIGHT STABILITY. A wall that held its strike overnight is a stronger
 *                      lean. A wall that CHASED price overnight is a weaker fade
 *                      and a more credible breakout level — that flips the call.
 *   4. EXPECTED REACTION. The three together produce ONE call per ticker:
 *                      fade the first test, expect the break, or stand down.
 *   5. GRADE THE CALL. After the close, each level is scored against the table
 *                      its OWN regime implies, and the call itself is scored on
 *                      whether the reaction it named actually happened.
 *
 * QUALITY IS A WEIGHT, NOT A BONUS. Every component's points-available are
 * scaled by that component's seal-time quality. A wall 3% away, smeared over
 * four strikes and outside the expected move, contributes almost nothing to the
 * score in EITHER direction. This is the fix for the number that makes published
 * wall-hold rates look better than they are: distant walls hold ~always, and
 * counting those holds at full weight inflates the record. Here they barely
 * count, because barely anything was claimed.
 *
 * WHAT IS NOT CLAIMED. The expected move here is a REALIZED-range read (see
 * `emFromSessions` in the recorder), not an ATM-straddle implied move. It is
 * used only as a scale for "is this level a plausible destination today". If an
 * implied EM ever lands in the database, feed it in as `emPct` and nothing else
 * changes — that is the one seam.
 *
 * VERSIONING. Every scorecard carries `v`. A graded row with no scorecard (any
 * session sealed before this file existed) grades on the v1 path: positive-gamma
 * wall table, unit weights, no regime or reaction component. Old sessions
 * regrade to exactly the numbers they had.
 */

// ── knobs ────────────────────────────────────────────────────────────────────

/** Rubric version stamped into every scorecard. Bump when the tables move. */
const SCORECARD_VERSION = 2;

/** Inside this much of the flip, in percent, the regime is "transition" — the
 *  oscillation case, where no single level carries conviction. */
const FLIP_CHOP_PCT = Number(process.env.DG_FLIP_CHOP_PCT || 0.25);

/** The distance band a level is most useful at: relevant, but not already there. */
const DIST_SWEET_LO = Number(process.env.DG_DIST_SWEET_LO || 0.30);
const DIST_SWEET_HI = Number(process.env.DG_DIST_SWEET_HI || 1.00);
/** Beyond this, a level is scenery — quality decays to zero. */
const DIST_FAR_PCT = Number(process.env.DG_DIST_FAR_PCT || 3.00);

/** Expected move used when none is on file. Keeps the math defined; the
 *  component that used it is down-weighted so a guess never drives a grade. */
const EM_FALLBACK_PCT = Number(process.env.DG_EM_FALLBACK_PCT || 1.00);

/** A break "followed through" once price extended this much of the expected
 *  move BEYOND the wall. Below it, the break reverted and the acceleration the
 *  negative-gamma read promised did not arrive. */
const BREAK_FOLLOW_EM = Number(process.env.DG_BREAK_FOLLOW_EM || 0.25);

/** Overnight drift thresholds, percent of the level. */
const STAB_HOLD_PCT = Number(process.env.DG_STAB_HOLD_PCT || 0.15);
const STAB_CHASE_PCT = Number(process.env.DG_STAB_CHASE_PCT || 0.50);

/** No component's weight falls below this — a level that exists made SOME claim. */
const MIN_WEIGHT = 0.25;

/** Each component is worth this before its weight is applied. */
const COMPONENT_PTS = 25;

/** House bands, shared with _lib-pick-grade.cjs so a B means the same thing on
 *  both boards. Used for the setup grade and the outcome grade alike. */
const GRADE_BANDS = (pts) =>
  pts >= 85 ? 'A+' : pts >= 72 ? 'A' : pts >= 58 ? 'B' : pts >= 44 ? 'C' : pts >= 28 ? 'D' : 'F';

// ── tiny helpers ─────────────────────────────────────────────────────────────

const isNum = (v) => typeof v === 'number' && Number.isFinite(v);
const num = (v) => (isNum(Number(v)) && v !== null && v !== '' ? Number(v) : null);
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const r3 = (v) => (isNum(v) ? Number(v.toFixed(3)) : null);
const r4 = (v) => (isNum(v) ? Number(v.toFixed(4)) : null);

/** Linear ramp from (x0,y0) to (x1,y1), clamped outside. */
function ramp(x, x0, y0, x1, y1) {
  if (!isNum(x)) return null;
  if (x1 === x0) return y1;
  const t = clamp((x - x0) / (x1 - x0), 0, 1);
  return y0 + t * (y1 - y0);
}

/** Percent distance from `spot` to `level`, signed (positive = level above). */
function pctTo(spot, level) {
  if (!isNum(spot) || !isNum(level) || spot === 0) return null;
  return ((level - spot) / spot) * 100;
}

// ── 1. regime ────────────────────────────────────────────────────────────────

/**
 * Which regime the board is in, and how cleanly.
 *
 * Two independent readings have to agree for a confident call: the SIGN of net
 * GEX, and which side of the gamma flip spot is on. When they disagree the
 * honest answer is "transition", not a coin flip — and when spot is sitting on
 * the flip, nothing else on the board carries conviction no matter what the sign
 * says.
 *
 * @returns {{ regime: 'positive'|'negative'|'transition'|'unknown',
 *             conf: number, flipDistPct: number|null, netGex: number|null,
 *             side: 'above'|'below'|null, agree: boolean|null }}
 */
function readRegime({ spot, flip, netGex } = {}) {
  const s = num(spot);
  const f = num(flip);
  const g = num(netGex);
  const flipDistPct = pctTo(s, f);
  const side = flipDistPct == null ? null : (flipDistPct < 0 ? 'above' : 'below');
  //         flipDistPct < 0  ⇒  flip sits BELOW spot  ⇒  spot is ABOVE the flip.

  if (f == null && g == null) {
    return { regime: 'unknown', conf: 0, flipDistPct: null, netGex: null, side: null, agree: null };
  }

  // Sitting on the flip. This is the oscillation case and it outranks the sign:
  // chop, false starts, no single level worth much.
  if (flipDistPct != null && Math.abs(flipDistPct) < FLIP_CHOP_PCT) {
    return {
      regime: 'transition',
      conf: r3(clamp(0.20 + 0.25 * (Math.abs(flipDistPct) / FLIP_CHOP_PCT), 0, 1)),
      flipDistPct: r4(flipDistPct), netGex: g, side, agree: null,
    };
  }

  // Only one of the two readings is available.
  if (f == null || side == null) {
    const regime = g > 0 ? 'positive' : g < 0 ? 'negative' : 'transition';
    return { regime, conf: 0.45, flipDistPct: null, netGex: g, side: null, agree: null };
  }
  if (g == null) {
    const regime = side === 'above' ? 'positive' : 'negative';
    // Distance from the flip is all the confidence there is.
    return {
      regime, conf: r3(clamp(ramp(Math.abs(flipDistPct), FLIP_CHOP_PCT, 0.35, 1.5, 0.7), 0, 1)),
      flipDistPct: r4(flipDistPct), netGex: null, side, agree: null,
    };
  }

  const bySign = g > 0 ? 'positive' : 'negative';
  const bySide = side === 'above' ? 'positive' : 'negative';
  const agree = bySign === bySide;

  if (!agree) {
    // Net GEX says one thing, the flip says the other. That IS the finding.
    return {
      regime: 'transition', conf: 0.35, flipDistPct: r4(flipDistPct), netGex: g, side, agree: false,
    };
  }

  const conf = clamp(ramp(Math.abs(flipDistPct), FLIP_CHOP_PCT, 0.55, 1.5, 1.0), 0, 1);
  return { regime: bySign, conf: r3(conf), flipDistPct: r4(flipDistPct), netGex: g, side, agree: true };
}

// ── 2. wall quality ──────────────────────────────────────────────────────────

/**
 * How standout the bar is against the ladder it sits in.
 * Compares the peak to the MEDIAN live strike on that side, not to the total:
 * "a standout bar among neighbouring ones" is a ratio question, and a ratio is
 * the only form of it that survives comparing SPX to a $30 name.
 */
function sizeScore(peak, sideValues) {
  const p = num(peak);
  if (!isNum(p) || p <= 0) return null;
  const live = (sideValues || []).map(Number).filter((v) => isNum(v) && v > 0).sort((a, b) => a - b);
  if (live.length < 3) return null;
  const med = live[Math.floor(live.length / 2)];
  if (!(med > 0)) return null;
  // 20× the typical strike is a genuinely dominant wall; 1× is no wall at all.
  return clamp(Math.log10(p / med) / Math.log10(20), 0, 1);
}

/**
 * Isolated peak or smeared across neighbours. 1.0 = all the local mass is on one
 * strike; 0 = it is spread evenly over the strike and its two neighbours, which
 * is the "clustered / smeared" case the read treats as weak.
 */
function concScore(idx, sideValues) {
  const v = sideValues || [];
  const peak = num(v[idx]);
  if (!isNum(peak) || peak <= 0) return null;
  const left = Math.abs(num(v[idx - 1]) || 0);
  const right = Math.abs(num(v[idx + 1]) || 0);
  const local = peak + left + right;
  if (!(local > 0)) return null;
  const share = peak / local;            // 1/3 … 1
  return clamp((share - 1 / 3) / (2 / 3), 0, 1);
}

/**
 * Distance quality. Relevant but not already there: full marks across the sweet
 * band, ramping down to a floor as the level sits on top of price (it has
 * effectively already been reached) and decaying to zero as it becomes scenery.
 */
function distScore(distPct) {
  const d = Math.abs(num(distPct) ?? NaN);
  if (!isNum(d)) return null;
  if (d < DIST_SWEET_LO) return r3(ramp(d, 0, 0.30, DIST_SWEET_LO, 1.0));
  if (d <= DIST_SWEET_HI) return 1;
  return r3(ramp(d, DIST_SWEET_HI, 1.0, DIST_FAR_PCT, 0));
}

/**
 * Expected-move alignment. A wall the day can plausibly REACH is a different
 * proposition from one that needs a catalyst to matter. Null EM returns a
 * deliberately neutral 0.6 rather than a guess in either direction.
 */
function emScore(distPct, emPct) {
  const d = Math.abs(num(distPct) ?? NaN);
  const em = num(emPct);
  if (!isNum(d)) return null;
  if (!isNum(em) || em <= 0) return 0.6;
  const ratio = d / em;
  if (ratio <= 0.8) return 1;
  if (ratio <= 1.2) return 0.8;
  return r3(ramp(ratio, 1.2, 0.8, 2.5, 0.1));
}

/**
 * Round-number confluence. The increment that counts scales with the price, so
 * 6000 on SPX and 50 on a $47 name are both "the round number".
 */
function confluenceScore(level) {
  const v = num(level);
  if (!isNum(v) || v <= 0) return null;
  const [major, minor] =
    v >= 1000 ? [100, 50]
      : v >= 200 ? [50, 25]
        : v >= 50 ? [10, 5]
          : v >= 10 ? [5, 1]
            : [1, 0.5];
  const tol = Math.max(v * 0.0004, minor * 0.06);
  const near = (step) => Math.abs(v - Math.round(v / step) * step) <= tol;
  if (near(major)) return 1;
  if (near(minor)) return 0.7;
  return 0.35;
}

/**
 * Overnight stability. The premarket value of a level is in the CHANGE, not the
 * print.
 *
 *   held     the strike did not move — the strongest lean available
 *   firming  it moved TOWARD price / against the overnight drift — structure
 *            building where price is going
 *   chasing  it migrated WITH price — a weaker fade and a more credible break,
 *            which is exactly the case that should flip the call
 *   drift    moved, but not decisively either way
 *
 * `shift` is the plain direction, kept separate from the judgement: a call wall
 * moving higher overnight is a bullish structural signal whatever it does to the
 * fade quality, and the board should be able to say so.
 */
function stabilityFor(level, prevLevel, spot, prevSpot) {
  const l = num(level);
  const pl = num(prevLevel);
  if (!isNum(l) || !isNum(pl) || pl === 0) {
    return { stability: null, score: 0.6, driftPct: null, shift: null };
  }
  const driftPct = ((l - pl) / pl) * 100;
  const shift = Math.abs(driftPct) <= STAB_HOLD_PCT ? 'flat' : driftPct > 0 ? 'up' : 'down';

  if (Math.abs(driftPct) <= STAB_HOLD_PCT) {
    return { stability: 'held', score: 1, driftPct: r4(driftPct), shift };
  }

  const movePct = pctTo(prevSpot, spot);           // overnight move in price
  if (isNum(movePct) && Math.abs(movePct) > 0.05) {
    const sameWay = (movePct > 0) === (driftPct > 0);
    if (sameWay && Math.abs(driftPct) >= STAB_CHASE_PCT) {
      return { stability: 'chasing', score: 0.35, driftPct: r4(driftPct), shift };
    }
    if (!sameWay) {
      return { stability: 'firming', score: 0.85, driftPct: r4(driftPct), shift };
    }
  }
  return { stability: 'drift', score: 0.6, driftPct: r4(driftPct), shift };
}

/** How the six sub-scores roll into one number. Distance dominates on purpose:
 *  a level price will not visit is not a level, whatever its bar looks like. */
const QUALITY_WEIGHTS = { dist: 0.30, size: 0.22, conc: 0.16, em: 0.14, stab: 0.12, conf: 0.06 };

/** Weighted mean over whichever sub-scores are present. Null sub-scores drop out
 *  of both numerator and denominator rather than scoring zero. */
function blend(parts) {
  let n = 0;
  let d = 0;
  for (const [k, w] of Object.entries(QUALITY_WEIGHTS)) {
    const v = parts[k];
    if (!isNum(v)) continue;
    n += v * w;
    d += w;
  }
  return d > 0 ? clamp(n / d, 0, 1) : null;
}

/**
 * Score one wall.
 *
 * @param {object} a
 * @param {number|null} a.level      the wall strike
 * @param {number|null} a.spot       sealed spot
 * @param {number[]} a.strikes       ascending ladder strikes
 * @param {number[]} a.sideValues    that side's gamma per strike, aligned to `strikes`
 * @param {number|null} a.emPct      expected move, percent of spot
 * @param {number|null} a.prevLevel  the same wall on the previous seal
 * @param {number|null} a.prevSpot   the previous seal's spot
 */
function wallQuality({ level, spot, strikes, sideValues, emPct, prevLevel, prevSpot } = {}) {
  const l = num(level);
  if (!isNum(l)) return null;

  const distPct = pctTo(num(spot), l);

  // Nearest ladder index to the wall — the wall strike and the ladder are two
  // different reads of the same chain and need not be exactly aligned.
  let idx = -1;
  if (Array.isArray(strikes) && strikes.length) {
    let best = Infinity;
    for (let i = 0; i < strikes.length; i++) {
      const d = Math.abs(Number(strikes[i]) - l);
      if (d < best) { best = d; idx = i; }
    }
    // More than a strike-spacing away and it is not the same level.
    const spacing = strikes.length > 1
      ? Math.abs(Number(strikes[1]) - Number(strikes[0])) || Math.abs(l) * 0.01
      : Math.abs(l) * 0.01;
    if (best > spacing * 1.5) idx = -1;
  }

  const peak = idx >= 0 ? Math.abs(Number(sideValues?.[idx]) || 0) : null;
  const stab = stabilityFor(l, prevLevel, spot, prevSpot);

  const parts = {
    dist: distScore(distPct),
    size: idx >= 0 ? sizeScore(peak, sideValues) : null,
    conc: idx >= 0 ? concScore(idx, sideValues) : null,
    em: emScore(distPct, emPct),
    stab: stab.score,
    conf: confluenceScore(l),
  };

  return {
    level: l,
    gex: isNum(peak) ? peak : null,
    dist_pct: r4(distPct),
    size: r3(parts.size),
    conc: r3(parts.conc),
    dist: r3(parts.dist),
    em: r3(parts.em),
    conf: r3(parts.conf),
    stab: r3(parts.stab),
    stability: stab.stability,
    drift_pct: stab.driftPct,
    shift: stab.shift,
    quality: r3(blend(parts)),
  };
}

// ── 3. the call ──────────────────────────────────────────────────────────────

/**
 * One sentence, one call. The regime decides the SHAPE of the expectation; wall
 * quality decides whether there is enough there to make a call at all; and a
 * wall that chased price overnight overrides a fade into a break, because a
 * level migrating with the move is not a level being defended.
 */
function reactionCall({ regime, conf, cap, floor, spot }) {
  const capQ = cap?.quality ?? null;
  const floorQ = floor?.quality ?? null;

  // The side the call is about: the wall price would meet first.
  const dCap = isNum(cap?.dist_pct) ? Math.abs(cap.dist_pct) : Infinity;
  const dFloor = isNum(floor?.dist_pct) ? Math.abs(floor.dist_pct) : Infinity;
  const side = dCap === Infinity && dFloor === Infinity ? null : (dCap <= dFloor ? 'cap' : 'floor');
  const near = side === 'cap' ? cap : side === 'floor' ? floor : null;
  const nearQ = side === 'cap' ? capQ : floorQ;

  if (!side || !isNum(nearQ)) {
    return { call: 'none', side: null, conf: 0, note: 'No usable wall on either side — nothing to call.' };
  }

  const chasing = near?.stability === 'chasing';

  let call;
  if (regime === 'unknown') call = 'none';
  else if (regime === 'transition') call = 'low_conviction';
  else if (regime === 'negative') call = 'expect_break';
  else if (chasing) call = 'expect_break';                 // +GEX, but the wall is moving with price
  else if (nearQ >= 0.55) call = 'fade_first_test';
  else call = 'low_conviction';

  // Confidence in the CALL, not in the regime: a clean regime read behind a
  // mediocre wall is still a mediocre call.
  const callConf = call === 'none' ? 0
    : clamp(0.55 * (conf ?? 0) + 0.45 * nearQ, 0, 1);

  return { call, side, conf: r3(callConf), note: callNote({ regime, call, side, near, spot, chasing }) };
}

/** The sentence the premarket routine ends on. */
function callNote({ regime, call, side, near, spot, chasing }) {
  const label = side === 'cap' ? 'call wall' : 'put wall';
  const dist = isNum(near?.dist_pct) ? `${Math.abs(near.dist_pct).toFixed(2)}%` : 'unknown distance';
  const dir = isNum(near?.dist_pct) ? (near.dist_pct >= 0 ? 'up' : 'down') : '';
  const regimeWord =
    regime === 'positive' ? 'Positive GEX'
      : regime === 'negative' ? 'Negative GEX'
        : regime === 'transition' ? 'Sitting on the flip'
          : 'Regime unknown';
  const stab =
    near?.stability === 'held' ? 'and stable'
      : near?.stability === 'chasing' ? 'and chasing price'
        : near?.stability === 'firming' ? 'and firming into price'
          : near?.stability === 'drift' ? 'and drifting'
            : '';
  const em = isNum(near?.em) ? (near.em >= 0.8 ? 'inside EM' : near.em >= 0.5 ? 'at the EM edge' : 'outside EM') : '';
  const tail =
    call === 'fade_first_test' ? 'fade the first test unless flow overwhelms it'
      : call === 'expect_break'
        ? (chasing ? 'treat it as a breakout level, not a fade' : 'respect the break and the extension past it')
        : call === 'low_conviction' ? 'no single level carries conviction — trade the tape, not the map'
          : 'nothing to call';
  return [regimeWord, `${label} ${dist} ${dir} ${stab}`.replace(/\s+/g, ' ').trim(), em]
    .filter(Boolean).join(', ') + ` — ${tail}.`;
}

// ── the seal-time scorecard ──────────────────────────────────────────────────

/**
 * Everything the 09:26 seal knows, scored.
 *
 * @param {object} i
 * @param {number|null} i.spot
 * @param {number|null} i.flip
 * @param {number|null} i.netGex        chain total, signed
 * @param {number|null} i.capLevel      the level graded as "cap"
 * @param {number|null} i.floorLevel
 * @param {number|null} i.apexLevel     CB
 * @param {number[]}    i.strikes       ascending
 * @param {number[]}    i.callGex       per strike, call side (sign ignored)
 * @param {number[]}    i.putGex        per strike, put side (sign ignored)
 * @param {number|null} i.emPct         expected move, percent of spot
 * @param {object|null} i.prev          previous seal's board for this symbol
 */
function buildScorecard(i = {}) {
  const {
    spot = null, flip = null, netGex = null,
    capLevel = null, floorLevel = null, apexLevel = null,
    strikes = [], callGex = [], putGex = [], emPct = null, prev = null,
  } = i;

  const regime = readRegime({ spot, flip, netGex });
  const prevSpot = num(prev?.spot);

  const cap = wallQuality({
    level: capLevel, spot, strikes, sideValues: callGex, emPct,
    prevLevel: num(prev?.cap), prevSpot,
  });
  const floor = wallQuality({
    level: floorLevel, spot, strikes, sideValues: putGex, emPct,
    prevLevel: num(prev?.floor), prevSpot,
  });

  // CB is unsided — the single largest |net GEX| strike — so its bar is scored
  // against the COMBINED ladder rather than one side of it.
  const both = strikes.map((_, k) => Math.abs(Number(callGex?.[k]) || 0) + Math.abs(Number(putGex?.[k]) || 0));
  const apex = wallQuality({
    level: apexLevel, spot, strikes, sideValues: both, emPct,
    prevLevel: num(prev?.apex), prevSpot,
  });

  // The flip's own quality is the regime read plus how far price has to go to
  // reach it — a flip 4% away is not a level this session will argue with.
  const flipDist = distScore(regime.flipDistPct);
  const flipQuality = flip == null ? null
    : r3(clamp(0.6 * (regime.conf ?? 0) + 0.4 * (isNum(flipDist) ? flipDist : 0.5), 0, 1));

  const call = reactionCall({ regime: regime.regime, conf: regime.conf, cap, floor, spot });

  // The premarket structure score — what the MAP was worth before the session
  // touched it. Deliberately separate from the grade: a good map can have a bad
  // day, and the record should be able to tell those two apart.
  const setupParts = [
    [regime.conf, 0.30],
    [cap?.quality, 0.25],
    [floor?.quality, 0.25],
    [apex?.quality, 0.10],
    [flipQuality, 0.10],
  ];
  let sn = 0;
  let sd = 0;
  for (const [v, w] of setupParts) { if (isNum(v)) { sn += v * w; sd += w; } }
  const setup = sd > 0 ? Number(((sn / sd) * 100).toFixed(2)) : null;

  return {
    v: SCORECARD_VERSION,
    regime: regime.regime,
    regime_conf: regime.conf,
    regime_agree: regime.agree,
    net_gex: regime.netGex,
    flip_dist_pct: regime.flipDistPct,
    em_pct: r4(num(emPct)),
    walls: { cap, floor },
    apex,
    flip: flip == null ? null : { level: num(flip), quality: flipQuality },
    call: call.call,
    call_side: call.side,
    call_conf: call.conf,
    note: call.note,
    setup,
    setup_grade: setup == null ? null : GRADE_BANDS(setup),
  };
}

// ── after the close: regime-conditioned outcomes ─────────────────────────────

/**
 * One wall, scored against the table its regime implies.
 *
 * POSITIVE — dealers hedge against the move, so the wall is expected to absorb.
 *   tagged_held 25 · untested_held 15 · tagged_broke 5 · gapped_through 0
 *
 * NEGATIVE — hedging is pro-cyclical, so the model's claim is "if it goes, it
 * goes". A break WITH follow-through is the map being right; a hold is a real
 * level found for the wrong reason; a wall never even reached is the weakest
 * result, because the regime promised movement and none arrived.
 *   broke_accelerated 25 · gapped_ran 22 · absorbed 16 · broke_reverted 10 · untested_quiet 8
 *
 * TRANSITION — the call was "chop", so containment is the hit and a decisive
 * close through is the miss, in both directions.
 *   chop_held 22 · chop_broke 8 · chop_gapped 4
 *
 * @param {number|null} level
 * @param {'above'|'below'} side  which side of the level the seal left price on
 * @param {'positive'|'negative'|'transition'|'unknown'} regime
 * @param {number} emAbs          expected move in POINTS, for the follow-through test
 */
function gradeWall(level, side, regime, { o, h, l, c }, emAbs) {
  if (!isNum(level)) return null;
  const inside = side === 'below' ? (v) => v <= level : (v) => v >= level;
  const reached = side === 'below' ? h >= level : l <= level;
  const openedThrough = !inside(o);
  const closedInside = inside(c);
  // How far past the wall the close finished, in points. Zero when it closed back.
  const beyond = closedInside ? 0 : Math.abs(c - level);
  const followed = isNum(emAbs) && emAbs > 0 ? beyond >= BREAK_FOLLOW_EM * emAbs : beyond > 0;

  if (regime === 'negative') {
    if (openedThrough && !closedInside) {
      return { outcome: 'gapped_ran', pts: 22, reached };
    }
    if (!closedInside) {
      return followed
        ? { outcome: 'broke_accelerated', pts: 25, reached }
        : { outcome: 'broke_reverted', pts: 10, reached };
    }
    if (reached) return { outcome: 'absorbed', pts: 16, reached };
    return { outcome: 'untested_quiet', pts: 8, reached };
  }

  if (regime === 'transition') {
    if (openedThrough && !closedInside) return { outcome: 'chop_gapped', pts: 4, reached };
    if (!closedInside) return { outcome: 'chop_broke', pts: 8, reached };
    return { outcome: 'chop_held', pts: 22, reached };
  }

  // positive, and the v1 fallback for a session with no scorecard.
  if (openedThrough && !closedInside) return { outcome: 'gapped_through', pts: 0, reached };
  if (reached && closedInside) return { outcome: 'tagged_held', pts: 25, reached };
  if (!reached && closedInside) return { outcome: 'untested_held', pts: 15, reached };
  return { outcome: 'tagged_broke', pts: 5, reached };
}

/**
 * Did the session behave the way the regime said it would? This is the component
 * the old rubric had no place for, and it is the one that says whether the MAP
 * was being followed at all that morning.
 *
 * Positive gamma should look contained and two-sided; negative gamma should look
 * extended and one-sided; transition should look like chop. `dirRatio` — body
 * over range — is what separates "moved a lot" from "went somewhere".
 */
function gradeRegime(regime, { o, h, l, c }, emPct) {
  if (regime !== 'positive' && regime !== 'negative' && regime !== 'transition') return null;
  if (!isNum(o) || o === 0 || !isNum(h) || !isNum(l) || !isNum(c)) return null;
  const range = h - l;
  const rangePct = (range / o) * 100;
  const dirRatio = range > 0 ? Math.abs(c - o) / range : 0;
  const em = isNum(emPct) && emPct > 0 ? emPct : EM_FALLBACK_PCT;

  let quiet;
  let directional;
  if (regime === 'positive') {
    quiet = rangePct <= 1.15 * em;
    directional = dirRatio <= 0.60;
  } else if (regime === 'negative') {
    quiet = rangePct >= 0.95 * em;
    directional = dirRatio >= 0.50;
  } else {
    quiet = rangePct <= em;
    directional = dirRatio <= 0.45;
  }
  const hits = (quiet ? 1 : 0) + (directional ? 1 : 0);
  const outcome = hits === 2 ? 'regime_held' : hits === 1 ? 'regime_partial' : 'regime_failed';
  const pts = hits === 2 ? 25 : hits === 1 ? 14 : 4;
  return { outcome, pts, range_pct: r4(rangePct), dir_ratio: r3(dirRatio) };
}

/**
 * Did the CALL happen? Scored against the one wall the call was about, so the
 * board is answerable for the sentence it published rather than only for the
 * levels underneath it.
 */
function gradeReaction(sc, ohlc, emAbs, emPct) {
  const call = sc?.call;
  if (!call || call === 'none') return null;
  const { o, h, l, c } = ohlc;
  if (!isNum(o) || !isNum(h) || !isNum(l) || !isNum(c)) return null;

  if (call === 'low_conviction') {
    const cap = num(sc?.walls?.cap?.level);
    const floor = num(sc?.walls?.floor?.level);
    const contained = (cap == null || h <= cap) && (floor == null || l >= floor);
    const em = isNum(emPct) && emPct > 0 ? emPct : EM_FALLBACK_PCT;
    const quiet = o !== 0 ? ((h - l) / o) * 100 <= em : false;
    const hits = (contained ? 1 : 0) + (quiet ? 1 : 0);
    return hits === 2 ? { outcome: 'call_hit', pts: 25 }
      : hits === 1 ? { outcome: 'call_partial', pts: 13 }
        : { outcome: 'call_missed', pts: 5 };
  }

  const side = sc?.call_side;
  const wall = side === 'cap' ? sc?.walls?.cap : side === 'floor' ? sc?.walls?.floor : null;
  const level = num(wall?.level);
  if (!isNum(level)) return null;

  const above = side === 'cap';                 // cap sits above spot, floor below
  const reached = above ? h >= level : l <= level;
  const closedThrough = above ? c > level : c < level;
  const beyond = closedThrough ? Math.abs(c - level) : 0;
  const followed = isNum(emAbs) && emAbs > 0 ? beyond >= BREAK_FOLLOW_EM * emAbs : beyond > 0;

  if (call === 'fade_first_test') {
    if (!reached) return { outcome: 'call_untested', pts: 12 };
    return closedThrough ? { outcome: 'call_missed', pts: 4 } : { outcome: 'call_hit', pts: 25 };
  }
  // expect_break
  if (!reached) return { outcome: 'call_untested', pts: 9 };
  if (!closedThrough) return { outcome: 'call_missed', pts: 6 };
  return followed ? { outcome: 'call_hit', pts: 25 } : { outcome: 'call_partial', pts: 13 };
}

/** Quality → the weight its component carries. Never zero: a level that exists
 *  made some claim, and a claim nobody scores is a claim nobody can be wrong about. */
const weightOf = (q, fallback = 1) =>
  clamp(isNum(q) ? q : fallback, MIN_WEIGHT, 1);

module.exports = {
  SCORECARD_VERSION,
  COMPONENT_PTS,
  MIN_WEIGHT,
  EM_FALLBACK_PCT,
  BREAK_FOLLOW_EM,
  FLIP_CHOP_PCT,
  GRADE_BANDS,
  // seal
  readRegime,
  wallQuality,
  reactionCall,
  buildScorecard,
  // grade
  gradeWall,
  gradeRegime,
  gradeReaction,
  weightOf,
  // exposed for the selftest
  sizeScore,
  concScore,
  distScore,
  emScore,
  confluenceScore,
  stabilityFor,
};
