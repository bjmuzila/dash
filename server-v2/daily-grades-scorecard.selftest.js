'use strict';
/**
 * server-v2/daily-grades-scorecard.selftest.js
 *
 * No DB, no network. Drives the v2 Daily Grades rubric against synthetic boards
 * and sessions where the right answer is known by construction.
 *
 * The tests that matter most are the ones that would have passed under v1 and
 * must now fail, or vice versa: the SAME wall break has to score high in
 * negative gamma and low in positive gamma, and a far, smeared wall has to stop
 * being able to move a grade in either direction.
 *
 *   node server-v2/daily-grades-scorecard.selftest.js
 */

const assert = require('assert');
const SC = require('./daily-grades-scorecard');
const { gradeTicker } = require('./daily-grades-recorder');

let pass = 0;
const t = (name, fn) => {
  try { fn(); pass++; console.log(`  ok  ${name}`); }
  catch (e) { console.error(`  FAIL ${name}\n       ${e.message}`); process.exitCode = 1; }
};

/**
 * A ladder with a clean isolated call peak at `callPeak` and put peak at
 * `putPeak`. Distances are deliberately REALISTIC — spot 100 with the walls
 * 0.8% away — because distance is a first-class input to quality and a fixture
 * with the cap 5% out would score every wall as scenery and prove nothing.
 */
function ladder({ lo = 97, hi = 103, step = 0.2, callPeak = 100.8, putPeak = 99.2, spike = 40 } = {}) {
  const strikes = [];
  const call = [];
  const put = [];
  for (let k = lo; k <= hi + 1e-9; k += step) {
    const strike = Number(k.toFixed(4));
    strikes.push(strike);
    call.push(Math.abs(strike - callPeak) < step / 2 ? spike : 1);
    put.push(Math.abs(strike - putPeak) < step / 2 ? spike : 1);
  }
  return { strikes, call, put };
}

const CAP = 100.8;
const FLOOR = 99.2;

const board = (over = {}) => {
  const lad = ladder();
  return SC.buildScorecard({
    spot: 100, flip: 99, netGex: 5e9,
    capLevel: CAP, floorLevel: FLOOR, apexLevel: 100,
    strikes: lad.strikes, callGex: lad.call, putGex: lad.put,
    emPct: 1.0, prev: null,
    ...over,
  });
};

// ── 1. regime comes first ────────────────────────────────────────────────────

console.log('\nregime');
t('positive net GEX above the flip reads positive', () => {
  const r = SC.readRegime({ spot: 100, flip: 96, netGex: 4e9 });
  assert.strictEqual(r.regime, 'positive');
  assert.ok(r.agree === true);
  assert.ok(r.conf > 0.5, `conf ${r.conf}`);
});
t('negative net GEX below the flip reads negative', () => {
  const r = SC.readRegime({ spot: 100, flip: 104, netGex: -4e9 });
  assert.strictEqual(r.regime, 'negative');
  assert.ok(r.agree === true);
});
t('sitting ON the flip is transition, whatever the sign says', () => {
  const r = SC.readRegime({ spot: 100, flip: 99.9, netGex: 9e9 });
  assert.strictEqual(r.regime, 'transition');
  assert.ok(r.conf < 0.5, 'a flip-straddling board must not read as confident');
});
t('sign and side disagreeing is transition, not a coin flip', () => {
  const r = SC.readRegime({ spot: 100, flip: 96, netGex: -4e9 });
  assert.strictEqual(r.regime, 'transition');
  assert.strictEqual(r.agree, false);
});
t('no flip and no net GEX is unknown, not a guess', () => {
  assert.strictEqual(SC.readRegime({ spot: 100 }).regime, 'unknown');
});
t('confidence grows with distance from the flip', () => {
  const near = SC.readRegime({ spot: 100, flip: 99.5, netGex: 1e9 }).conf;
  const far = SC.readRegime({ spot: 100, flip: 94, netGex: 1e9 }).conf;
  assert.ok(far > near, `${far} should exceed ${near}`);
});

// ── 2. wall quality ──────────────────────────────────────────────────────────

console.log('\nwall quality');
t('the sweet band scores full distance marks, far scores none', () => {
  assert.strictEqual(SC.distScore(0.5), 1);
  assert.strictEqual(SC.distScore(0.9), 1);
  assert.ok(SC.distScore(0.05) < 0.5, 'a level already on price is not a level');
  assert.ok(SC.distScore(2.5) < 0.3);
  assert.strictEqual(SC.distScore(3.5), 0);
});
t('an isolated peak beats a smeared one', () => {
  const iso = SC.concScore(2, [1, 1, 40, 1, 1]);
  const smear = SC.concScore(2, [1, 12, 14, 13, 1]);
  assert.ok(iso > 0.9, `isolated ${iso}`);
  assert.ok(smear < 0.3, `smeared ${smear}`);
});
t('a standout bar beats a bar among equals', () => {
  const big = SC.sizeScore(40, [1, 1, 1, 2, 40]);
  const flat = SC.sizeScore(2, [1, 1, 1, 2, 2]);
  assert.ok(big > flat, `${big} should exceed ${flat}`);
});
t('a level inside the expected move beats one well outside it', () => {
  assert.strictEqual(SC.emScore(0.6, 1.0), 1);
  assert.ok(SC.emScore(2.6, 1.0) < 0.3);
});
t('a null expected move is neutral, never a guess in either direction', () => {
  const v = SC.emScore(0.6, null);
  assert.ok(v > 0.4 && v < 0.8, `neutral, got ${v}`);
});
t('round numbers carry confluence', () => {
  assert.strictEqual(SC.confluenceScore(6000), 1);
  assert.strictEqual(SC.confluenceScore(5950), 0.7);
  assert.strictEqual(SC.confluenceScore(5937), 0.35);
});

console.log('\novernight stability');
t('a wall that did not move is held', () => {
  assert.strictEqual(SC.stabilityFor(105, 105.05, 100, 99.9).stability, 'held');
});
t('a wall migrating WITH the overnight move is chasing', () => {
  const s = SC.stabilityFor(106, 105, 101, 100);   // price up, wall up
  assert.strictEqual(s.stability, 'chasing');
  assert.ok(s.score < 0.5, 'chasing must weaken the fade');
  assert.strictEqual(s.shift, 'up');
});
t('a wall moving AGAINST the overnight move is firming', () => {
  const s = SC.stabilityFor(104, 105, 101, 100);   // price up, wall down
  assert.strictEqual(s.stability, 'firming');
  assert.ok(s.score > 0.7);
});
t('no prior seal is neutral, not a penalty', () => {
  const s = SC.stabilityFor(105, null, 100, null);
  assert.strictEqual(s.stability, null);
  assert.ok(s.score > 0.4 && s.score < 0.8);
});

// ── 3. the call ──────────────────────────────────────────────────────────────

console.log('\nthe call');
t('positive gamma with a good near wall calls the fade', () => {
  const sc = board();
  assert.strictEqual(sc.regime, 'positive');
  assert.strictEqual(sc.call, 'fade_first_test');
  assert.ok(/fade the first test/.test(sc.note), sc.note);
});
t('negative gamma calls the break instead', () => {
  const sc = board({ spot: 100, flip: 104, netGex: -5e9 });
  assert.strictEqual(sc.regime, 'negative');
  assert.strictEqual(sc.call, 'expect_break');
});
t('a chasing wall flips a positive-gamma fade into a break', () => {
  const sc = board({ prev: { cap: 100.2, floor: 98.6, apex: 99.4, spot: 99.2 } });
  assert.strictEqual(sc.regime, 'positive');
  assert.strictEqual(sc.walls.cap.stability, 'chasing');
  assert.strictEqual(sc.call, 'expect_break');
});
t('sitting on the flip stands down', () => {
  const sc = board({ flip: 100.05 });
  assert.strictEqual(sc.call, 'low_conviction');
});
t('the scorecard is stamped with its rubric version', () => {
  assert.strictEqual(board().v, SC.SCORECARD_VERSION);
});
t('a setup score and letter come out of the seal, before any session', () => {
  const sc = board();
  assert.ok(sc.setup > 0 && sc.setup <= 100, `setup ${sc.setup}`);
  assert.ok(/^(A\+|A|B|C|D|F)$/.test(sc.setup_grade));
});

// ── 4. the same break, scored in two regimes ─────────────────────────────────

console.log('\nregime-conditioned outcomes');
// Through the 100.8 cap and closed well past it — 0.6pt of extension on a 1.0pt
// expected move, which clears the follow-through bar.
const brokeHard = { o: 100, h: 101.6, l: 99.7, c: 101.4 };
// Tagged the cap and got rejected back inside.
const heldAt = { o: 100, h: 100.9, l: 99.5, c: 100.2 };
// Never went near either wall.
const untested = { o: 100, h: 100.5, l: 99.6, c: 100.1 };

t('positive gamma: a cap break is a miss', () => {
  const w = SC.gradeWall(CAP, 'below', 'positive', brokeHard, 1.0);
  assert.strictEqual(w.outcome, 'tagged_broke');
  assert.strictEqual(w.pts, 5);
});
t('negative gamma: the SAME cap break with follow-through is the model working', () => {
  const w = SC.gradeWall(CAP, 'below', 'negative', brokeHard, 1.0);
  assert.strictEqual(w.outcome, 'broke_accelerated');
  assert.strictEqual(w.pts, 25);
});
t('negative gamma: a break that reverts is not acceleration', () => {
  const w = SC.gradeWall(CAP, 'below', 'negative', { o: 100, h: 101.2, l: 99.5, c: 100.85 }, 1.0);
  assert.strictEqual(w.outcome, 'broke_reverted');
});
t('positive gamma: a tagged hold is full marks', () => {
  assert.strictEqual(SC.gradeWall(CAP, 'below', 'positive', heldAt, 1.0).pts, 25);
});
t('negative gamma: the same hold is a real level found for the wrong reason', () => {
  const w = SC.gradeWall(CAP, 'below', 'negative', heldAt, 1.0);
  assert.strictEqual(w.outcome, 'absorbed');
  assert.ok(w.pts < 25 && w.pts > 5, `absorbed should sit between, got ${w.pts}`);
});
t('negative gamma: a wall never reached is the weakest result, not the safest', () => {
  const neg = SC.gradeWall(CAP, 'below', 'negative', untested, 1.0);
  const pos = SC.gradeWall(CAP, 'below', 'positive', untested, 1.0);
  assert.strictEqual(neg.outcome, 'untested_quiet');
  assert.ok(neg.pts < pos.pts, 'a quiet day should not pay the same in −GEX as in +GEX');
});
t('transition: containment is the hit and a close through is the miss', () => {
  assert.strictEqual(SC.gradeWall(CAP, 'below', 'transition', heldAt, 1.0).outcome, 'chop_held');
  assert.strictEqual(SC.gradeWall(CAP, 'below', 'transition', brokeHard, 1.0).outcome, 'chop_broke');
});
t('an unknown regime falls back to the v1 table exactly', () => {
  const a = SC.gradeWall(CAP, 'below', 'unknown', brokeHard, null);
  const b = SC.gradeWall(CAP, 'below', 'positive', brokeHard, null);
  assert.deepStrictEqual(a, b);
});

console.log('\nregime component');
t('a quiet two-sided day confirms positive gamma', () => {
  const r = SC.gradeRegime('positive', { o: 100, h: 100.5, l: 99.6, c: 100.05 }, 1.0);
  assert.strictEqual(r.outcome, 'regime_held');
});
t('a big one-way day fails positive gamma', () => {
  const r = SC.gradeRegime('positive', { o: 100, h: 103, l: 99.9, c: 102.9 }, 1.0);
  assert.strictEqual(r.outcome, 'regime_failed');
});
t('the same big one-way day confirms negative gamma', () => {
  const r = SC.gradeRegime('negative', { o: 100, h: 103, l: 99.9, c: 102.9 }, 1.0);
  assert.strictEqual(r.outcome, 'regime_held');
});
t('chop confirms a transition call', () => {
  const r = SC.gradeRegime('transition', { o: 100, h: 100.4, l: 99.7, c: 100.05 }, 1.0);
  assert.strictEqual(r.outcome, 'regime_held');
});

console.log('\nthe call, graded');
t('a fade call that gets tagged and rejected is a hit', () => {
  const sc = board();
  const r = SC.gradeReaction(sc, heldAt, 1.0, 1.0);
  assert.strictEqual(r.outcome, 'call_hit');
});
t('a fade call the market runs straight through is a miss', () => {
  const sc = board();
  const r = SC.gradeReaction(sc, brokeHard, 1.0, 1.0);
  assert.strictEqual(r.outcome, 'call_missed');
});
t('a fade call that was never tested is neither', () => {
  const sc = board();
  const r = SC.gradeReaction(sc, untested, 1.0, 1.0);
  assert.strictEqual(r.outcome, 'call_untested');
});
t('a break call needs the follow-through, not just the close through', () => {
  const sc = board({ spot: 100, flip: 101, netGex: -5e9 });
  assert.strictEqual(sc.call, 'expect_break');
  // call_side is the nearer wall; grade the session on that side.
  const through = sc.call_side === 'cap'
    ? { o: 100, h: 101.6, l: 99.7, c: 101.4 }
    : { o: 100, h: 100.3, l: 98.4, c: 98.6 };
  const shallow = sc.call_side === 'cap'
    ? { o: 100, h: 101.0, l: 99.7, c: 100.85 }
    : { o: 100, h: 100.3, l: 99.0, c: 99.15 };
  assert.strictEqual(SC.gradeReaction(sc, through, 1.0, 1.0).outcome, 'call_hit');
  assert.strictEqual(SC.gradeReaction(sc, shallow, 1.0, 1.0).outcome, 'call_partial');
});

// ── 5. quality as a weight ───────────────────────────────────────────────────

console.log('\nquality is a weight');
const sealedV2 = () => ({
  spot: 100, cap: CAP, floor: FLOOR, apex: 100, flip: 99, scorecard: board(),
});

t('a far, smeared wall barely moves the grade either way', () => {
  const lad = ladder({ lo: 60, hi: 140, step: 1, callPeak: 130, putPeak: 70, spike: 1.2 });
  const sealed = {
    spot: 100, cap: 130, floor: 70, apex: null, flip: 96,
    scorecard: SC.buildScorecard({
      spot: 100, flip: 96, netGex: 3e9,
      capLevel: 130, floorLevel: 70, apexLevel: null,
      strikes: lad.strikes, callGex: lad.call, putGex: lad.put,
      emPct: 1.0, prev: null,
    }),
  };
  const q = sealed.scorecard.walls.cap.quality;
  assert.ok(q < 0.45, `a 30%-away smeared wall should score poorly, got ${q}`);
  const held = gradeTicker(sealed, { o: 100, h: 100.8, l: 99.3, c: 100.2 });
  assert.ok(held.parts.cap.weight <= 0.45, `weight ${held.parts.cap.weight}`);
});
t('a clean near wall carries near-full weight', () => {
  const g = gradeTicker(sealedV2(), heldAt);
  assert.ok(g.parts.cap.weight > 0.7, `weight ${g.parts.cap.weight}`);
});
t('every weight stays inside [MIN_WEIGHT, 1]', () => {
  const g = gradeTicker(sealedV2(), heldAt);
  for (const [k, w] of Object.entries(g.weights)) {
    assert.ok(w >= SC.MIN_WEIGHT && w <= 1, `${k} weight ${w} out of range`);
  }
});

// ── 6. the whole ticker ──────────────────────────────────────────────────────

console.log('\ngradeTicker');
t('a board with no levels grades to no_levels, never an F', () => {
  const g = gradeTicker({ spot: 100 }, { o: 1, h: 2, l: 0.5, c: 1.5 });
  assert.strictEqual(g.status, 'no_levels');
  assert.strictEqual(g.grade, null);
});
t('a board with no candles grades to no_candles, never an F', () => {
  const g = gradeTicker({ spot: 100, cap: 105, floor: 95 }, null);
  assert.strictEqual(g.status, 'no_candles');
  assert.strictEqual(g.grade, null);
});
t('a v1 seal (no scorecard) still grades on the v1 path', () => {
  const g = gradeTicker({ spot: 100, cap: CAP, floor: FLOOR, apex: 100, flip: 99 }, heldAt);
  assert.strictEqual(g.regime, null);
  assert.ok(!g.parts.regime, 'no regime component without a scorecard');
  assert.ok(!g.parts.reaction, 'no reaction component without a scorecard');
  // Unit weights: max_pts must land on a whole multiple of 25.
  assert.strictEqual(g.maxPts % 25, 0, `maxPts ${g.maxPts}`);
});
t('a v2 seal adds the regime and reaction components', () => {
  const g = gradeTicker(sealedV2(), heldAt);
  assert.ok(g.parts.regime, 'expected a regime component');
  assert.ok(g.parts.reaction, 'expected a reaction component');
  assert.strictEqual(g.regime, 'positive');
});
t('the model being RIGHT in negative gamma outscores it being wrong', () => {
  const lad = ladder();
  const sc = SC.buildScorecard({
    spot: 100, flip: 101, netGex: -5e9,
    capLevel: CAP, floorLevel: FLOOR, apexLevel: 100,
    strikes: lad.strikes, callGex: lad.call, putGex: lad.put,
    emPct: 1.0, prev: null,
  });
  const sealed = { spot: 100, cap: CAP, floor: FLOOR, apex: 100, flip: 101, scorecard: sc };
  // Broke the put wall and ran — exactly what negative gamma implies.
  const ran = gradeTicker(sealed, { o: 100, h: 100.3, l: 98.2, c: 98.4 });
  // Dead quiet, nothing tested — the regime promised movement and none came.
  const quiet = gradeTicker(sealed, { o: 100, h: 100.15, l: 99.85, c: 100.0 });
  assert.ok(ran.score > quiet.score, `${ran.score} should beat ${quiet.score}`);
});
t('score is weighted points over weighted points-available', () => {
  const g = gradeTicker(sealedV2(), heldAt);
  let pts = 0;
  let max = 0;
  for (const [k, v] of Object.entries(g.parts)) {
    if (!v) continue;
    pts += v.pts * g.weights[k];
    max += SC.COMPONENT_PTS * g.weights[k];
  }
  assert.ok(Math.abs(g.score - (pts / max) * 100) < 0.02, `${g.score} vs ${(pts / max) * 100}`);
});

console.log(`\n${pass} passed${process.exitCode ? ' — with failures above' : ''}\n`);
