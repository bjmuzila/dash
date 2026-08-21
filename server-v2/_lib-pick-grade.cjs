'use strict';
/**
 * server-v2/_lib-pick-grade.cjs
 *
 * The CANONICAL grade + feature vocabulary for GEX Change Top picks.
 *
 * Four things live here, deliberately together:
 *
 *   1. gradeFor()     — the outcome label. What a pick actually DID after it was
 *                       flagged, as a letter. Shipped on every scorecard row so
 *                       the client never has to agree with the server by
 *                       coincidence (components/scanner/GexChangeTop.tsx keeps a
 *                       local copy only as a fallback for rows served before
 *                       this module existed).
 *   2. pickFeatures() — what a pick looked like AT CAPTURE, as a flat object,
 *                       plus the bucket each feature falls in. This is the
 *                       feature vector the study joins against the label.
 *   3. projectPick()  — the forward-looking projected grade. Rule-driven, and
 *                       inert until a rule EARNS its way in (see PROJ_RULE).
 *   4. fitRule()      — the auto-fit. Turns the study's own bucket tables into a
 *                       rule using exactly the two filters the study tells you
 *                       to read by eye: not thin, and holds in both halves. This
 *                       is what makes arming the projection a button instead of
 *                       a hand-edited config file.
 *
 * WHY ONE FILE: the whole loop is "features at capture -> label at EOD -> rule
 * -> projection -> calibration". Split the vocabulary across three files and the
 * bucket edges drift apart, at which point the calibration is measuring the
 * drift instead of the rule.
 */

const fs = require('fs');
const path = require('path');

// ── 1. THE LABEL ──────────────────────────────────────────────────────────────
// 100 points: peak 0-55 (best gain offered, MFE), pain 0-25 (worst drawdown,
// MAE), close 0-20 (where it finished).
//
// HARD RULE: max_pct <= 0 is an F whatever the points say. A pick that never
// traded above its flag mark offered no exit at all, and pain/close credit must
// not launder it up into a D. This is the case the whole grade exists to name.

const GRADE_ORDER = ['A+', 'A', 'B', 'C', 'D', 'F'];

/** Number() coerces null/'' to 0, which would silently grade an unsnapshotted
 *  pick as a never-green F instead of leaving it ungraded. Be explicit. */
const num = (v) => (v == null || v === '' ? NaN : Number(v));

function gradePoints(maxPct, minPct, closePct) {
  const mx = num(maxPct);
  if (!Number.isFinite(mx)) return null;
  const peak =
    mx >= 150 ? 55 : mx >= 100 ? 50 : mx >= 50 ? 42 :
    mx >= 30 ? 33 : mx >= 20 ? 26 : mx >= 10 ? 18 :
    mx > 0 ? 8 : 0;
  // No low on file -> assume it was not free. Half credit, so a pick with no MAE
  // recorded can never outrank one that PROVED it stayed shallow.
  const mn = Number.isFinite(num(minPct)) ? num(minPct) : -25;
  const pain = mn >= -10 ? 25 : mn >= -20 ? 20 : mn >= -30 ? 15 : mn >= -45 ? 9 : mn >= -60 ? 4 : 0;
  const cl = Number.isFinite(num(closePct)) ? num(closePct) : null;
  const close = cl == null ? 8 : cl >= 50 ? 20 : cl >= 20 ? 16 : cl >= 0 ? 11 : cl >= -20 ? 6 : cl >= -50 ? 2 : 0;
  return peak + pain + close;
}

/** → { grade, pts, neverGreen } | null when the pick was never snapshotted. */
function gradeFor(r) {
  if (!r) return null;
  const pts = gradePoints(r.max_pct, r.min_pct, r.close_pct);
  if (pts == null) return null;
  const neverGreen = !(num(r.max_pct) > 0);
  const grade = neverGreen
    ? 'F'
    : pts >= 85 ? 'A+' : pts >= 72 ? 'A' : pts >= 58 ? 'B' : pts >= 44 ? 'C' : pts >= 28 ? 'D' : 'F';
  return { grade, pts, neverGreen };
}

/** Did this pick clear the bar? The study's primary hit test. */
const isGood = (g) => g === 'A+' || g === 'A' || g === 'B';

// ── 2. THE FEATURES ───────────────────────────────────────────────────────────
// Everything below is computable from a gex_change_top row at its FIRST slot
// plus the results row's entry — i.e. known at capture, never after. Adding a
// feature that peeks at the outcome is the one mistake that silently makes a
// study look brilliant, so each one carries a note on why it is honest.

/** "YYYY-MM-DD" pair → whole calendar days between. */
function daysBetween(fromYmd, toYmd) {
  const a = Date.parse(`${fromYmd}T00:00:00Z`);
  const b = Date.parse(`${toYmd}T00:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return Math.round((b - a) / 86_400_000);
}

/** "HH:MM" → minutes past midnight ET. */
function slotMinutes(slot) {
  const m = /^(\d{1,2}):(\d{2})$/.exec(String(slot || ''));
  if (!m) return null;
  return Number(m[1]) * 60 + Number(m[2]);
}

/**
 * @param row  gex_change_top row at the pick's first slot (symbol, expiry,
 *             strike, spot, latest_chg, pct_open, z_score, score, rank, slot)
 * @param res  the matching gex_change_top_results row (entry, slots) — entry is
 *             the probe mark AT the first flag, so it is a capture-time fact,
 *             not an outcome. `slots` is NOT used as a feature: it counts
 *             appearances across the whole day, which is knowledge from the
 *             future at the moment of the first flag.
 */
function pickFeatures(row, res) {
  const spot = Number(row.spot);
  const strike = Number(row.strike);
  const dte = row.expiry && row.date ? daysBetween(row.date, row.expiry) : null;
  const otmPct = spot > 0 && Number.isFinite(strike) ? (Math.abs(strike - spot) / spot) * 100 : null;
  const side = spot > 0 && strike < spot ? 'P' : 'C';
  const entry = res && Number.isFinite(Number(res.entry)) ? Number(res.entry) : null;
  return {
    symbol: row.symbol,
    dte,
    otmPct,
    side,
    slot: row.slot,
    slotMin: slotMinutes(row.slot),
    entry,
    rank: row.rank == null ? null : Number(row.rank),
    score: row.score == null ? null : Number(row.score),
    pctOpenAbs: row.pct_open == null ? null : Math.abs(Number(row.pct_open)),
    zAbs: row.z_score == null ? null : Math.abs(Number(row.z_score)),
    chgAbs: row.latest_chg == null ? null : Math.abs(Number(row.latest_chg)),
  };
}

/**
 * The bucket vocabulary. `by` keys are what /proxy/gex-change-top-study accepts
 * and what the Pick Study tab lists. Each returns a bucket LABEL, and `order`
 * fixes the display sequence so a table never sorts "10-20" before "5-10".
 */
const BUCKETS = {
  score: {
    label: 'Score (the current 0.6/0.4 blend)',
    note: 'The first cut worth running. If the top bucket does not beat the bottom, the existing ranking is sorting on noise and everything downstream needs rethinking.',
    order: ['0-20', '20-40', '40-60', '60-80', '80-100'],
    of: (f) => (f.score == null ? null
      : f.score < 20 ? '0-20' : f.score < 40 ? '20-40' : f.score < 60 ? '40-60' : f.score < 80 ? '60-80' : '80-100'),
  },
  dte: {
    label: 'DTE at capture',
    note: 'A 0DTE flag and a 5DTE flag are not the same instrument. Expected to be the single biggest split.',
    order: ['0', '1', '2-4', '5-9', '10+'],
    of: (f) => (f.dte == null ? null
      : f.dte <= 0 ? '0' : f.dte === 1 ? '1' : f.dte <= 4 ? '2-4' : f.dte <= 9 ? '5-9' : '10+'),
  },
  slot: {
    label: 'Time of day flagged',
    note: 'Interacts hard with DTE — a late-day 0DTE flag has no session left to work in.',
    order: ['pre-10:00', '10:00-11:30', '11:30-13:30', '13:30-15:00', '15:00+'],
    of: (f) => (f.slotMin == null ? null
      : f.slotMin < 600 ? 'pre-10:00' : f.slotMin < 690 ? '10:00-11:30'
      : f.slotMin < 810 ? '11:30-13:30' : f.slotMin < 900 ? '13:30-15:00' : '15:00+'),
  },
  entry: {
    label: 'Option entry price',
    note: 'The $0.50 floor already drops tick-size artifacts. The tier just above it may be nearly as bad.',
    order: ['0.50-1.00', '1.00-2.00', '2.00-5.00', '5.00+'],
    of: (f) => (f.entry == null ? null
      : f.entry < 1 ? '0.50-1.00' : f.entry < 2 ? '1.00-2.00' : f.entry < 5 ? '2.00-5.00' : '5.00+'),
  },
  otm: {
    label: 'OTM distance',
    note: 'MIN_OTM floors this at 5%, but 5% and 15% out behave nothing alike.',
    order: ['<7%', '7-10%', '10-15%', '15%+'],
    of: (f) => (f.otmPct == null ? null
      : f.otmPct < 7 ? '<7%' : f.otmPct < 10 ? '7-10%' : f.otmPct < 15 ? '10-15%' : '15%+'),
  },
  side: {
    label: 'Side (call wall vs put wall)',
    note: 'DIR=build means calls build above spot and puts build below. Whether the two behave alike is an open question.',
    order: ['C', 'P'],
    of: (f) => f.side || null,
  },
  rank: {
    label: 'Rank within the slot',
    note: 'Does being rank 1 actually beat being rank 5? Cheap sanity check on the ordering.',
    order: ['1', '2', '3', '4', '5', '6+'],
    of: (f) => (f.rank == null ? null : f.rank >= 6 ? '6+' : String(f.rank)),
  },
  pctopen: {
    label: '|% vs open| at capture',
    note: 'One half of the score blend, isolated.',
    order: ['30-50', '50-100', '100-200', '200+'],
    of: (f) => (f.pctOpenAbs == null ? null
      : f.pctOpenAbs < 50 ? '30-50' : f.pctOpenAbs < 100 ? '50-100' : f.pctOpenAbs < 200 ? '100-200' : '200+'),
  },
  chg: {
    label: '|Δ GEX $| at capture',
    note: 'The other half of the score blend, isolated.',
    order: ['200-500k', '500k-1M', '1-3M', '3M+'],
    of: (f) => (f.chgAbs == null ? null
      : f.chgAbs < 500e3 ? '200-500k' : f.chgAbs < 1e6 ? '500k-1M' : f.chgAbs < 3e6 ? '1-3M' : '3M+'),
  },
  z: {
    label: '|z-score| at capture',
    note: 'How unusual the move was against the strike’s own recent history.',
    order: ['<1', '1-2', '2-3', '3+'],
    of: (f) => (f.zAbs == null ? null : f.zAbs < 1 ? '<1' : f.zAbs < 2 ? '1-2' : f.zAbs < 3 ? '2-3' : '3+'),
  },
  symbol: {
    label: 'Ticker',
    note: 'Least stable feature there is — a ticker that worked in one regime is the first thing to stop working. Read it for outliers, never fit a rule on it.',
    order: null, // alphabetical, filled at runtime
    of: (f) => f.symbol || null,
  },
};

const BUCKET_KEYS = Object.keys(BUCKETS);

// ── 3. THE PROJECTION ─────────────────────────────────────────────────────────
// A projected grade, stamped on each pick AT CAPTURE so it can be scored later
// against what actually happened (that is what /proxy/gex-change-top-calibration
// reads). Rule-driven, additive, and completely transparent — no fitted model,
// because there is nothing honest to fit until the study has a few hundred
// labelled picks AND a rule has survived a train/test split.
//
// SHIPS INERT, AND ARMS ITSELF. With no rule in force, projectPick() returns
// null, no proj_grade is written, and the UI shows no Proj pill. What changed:
// that state is no longer a permanent wait for someone to hand-write a config
// file. fitRule() below derives a rule from the study's own bucket tables the
// moment the evidence clears the bar, and the recorder re-runs it after every
// EOD freeze. The original principle is intact — nothing is projected until
// there is evidence — but "there is evidence now" is something the server can
// notice on its own.
//
// THREE TIERS, highest wins:
//   1. env GEX_CHANGE_TOP_PROJ_RULE — the emergency override.
//   2. server-v2/config/pick-proj-rule.json — a hand-pinned rule. Its presence
//      also PINS the rule: the auto-fit will not overwrite a file you wrote.
//   3. the stored rule — what the auto-fit last wrote (kept in Postgres, so it
//      survives a container rebuild). Set through applyStoredRule().
//
// All three take the same JSON:
//
//   {
//     "enabled": true,
//     "base": 50,
//     "note": "fitted 2026-09-30 on 612 picks, held out Oct",
//     "terms": [
//       { "by": "dte",   "bucket": "0",         "pts": -12 },
//       { "by": "slot",  "bucket": "pre-10:00", "pts":  +9 },
//       { "by": "entry", "bucket": "0.50-1.00", "pts":  -7 }
//     ]
//   }
//
// `by` + `bucket` must name a real bucket from BUCKETS above — the study tab
// prints each bucket's lift in exactly this shape, so a rule is copy-paste from
// what you measured. Unknown keys are ignored with a warning rather than
// throwing: a typo must not take the recorder down mid-session.

const PROJ_RULE_PATH = path.join(__dirname, 'config', 'pick-proj-rule.json');
const INERT_RULE = Object.freeze({
  enabled: false, base: 50, terms: [], note: 'no rule configured', source: 'none',
});

/**
 * Parse + validate any of the three tiers into the one rule shape.
 * Unknown/malformed terms are dropped with a warning rather than thrown: a typo
 * must never take the recorder down mid-session.
 * → rule | null when the input is not usable JSON at all.
 */
function normalizeRule(input, source) {
  if (input == null) return null;
  let j = input;
  if (typeof input === 'string') {
    try { j = JSON.parse(input); } catch (e) {
      console.warn(`[pick-grade] ${source} rule unreadable, ignoring:`, e.message);
      return null;
    }
  }
  if (!j || typeof j !== 'object') return null;
  const terms = Array.isArray(j.terms) ? j.terms.filter((t) => {
    const ok = t && BUCKETS[t.by] && typeof t.bucket === 'string' && Number.isFinite(Number(t.pts));
    if (!ok) console.warn('[pick-grade] ignoring malformed projection term:', JSON.stringify(t));
    return ok;
  }).map((t) => ({ by: t.by, bucket: t.bucket, pts: Number(t.pts) })) : [];
  return {
    enabled: !!j.enabled && terms.length > 0,
    base: Number.isFinite(Number(j.base)) ? Number(j.base) : 50,
    note: String(j.note || ''),
    fittedAt: j.fittedAt ? String(j.fittedAt) : null,
    terms,
    source,
  };
}

/** Tier 3 — whatever the auto-fit last stored. Held in memory; the recorder
 *  reloads it from Postgres at boot and re-applies it on every save. */
let _stored = null;
let _cached = null;

/**
 * Install (or clear) the stored rule. Called by the recorder after reading the
 * pick_proj_rule row at boot and after every auto-fit that lands.
 * → the rule now in force.
 */
function applyStoredRule(input) {
  _stored = input == null ? null : normalizeRule(input, 'stored');
  _cached = null;
  const r = projRule({ reload: true });
  if (r.enabled) {
    console.log(`[pick-grade] projection rule armed from ${r.source}: ${r.terms.length} term(s)${r.note ? ` — ${r.note}` : ''}`);
  } else {
    console.log('[pick-grade] projection rule inert (no rule in force)');
  }
  return r;
}

/** Is a hand-written config file pinning the rule? Then the auto-fit stands down. */
function rulePinned() {
  if (process.env.GEX_CHANGE_TOP_PROJ_RULE) return 'env';
  try { fs.accessSync(PROJ_RULE_PATH); return 'file'; } catch { return null; }
}

function projRule({ reload = false } = {}) {
  if (_cached && !reload) return _cached;
  let r = null;
  if (process.env.GEX_CHANGE_TOP_PROJ_RULE) {
    r = normalizeRule(process.env.GEX_CHANGE_TOP_PROJ_RULE, 'env');
  }
  if (!r) {
    let raw = null;
    try { raw = fs.readFileSync(PROJ_RULE_PATH, 'utf8'); } catch { raw = null; }
    if (raw) r = normalizeRule(raw, 'file');
  }
  if (!r) r = _stored;
  _cached = r || INERT_RULE;
  return _cached;
}

/**
 * → { grade, pts, terms:[…] } | null when no rule is armed.
 * Same letter bands as the real grade, so "projected B" and "actual B" are
 * directly comparable — which is the entire point of stamping it.
 */
function projectPick(features, { rule } = {}) {
  const R = rule || projRule();
  if (!R.enabled) return null;
  let pts = R.base;
  const hit = [];
  for (const t of R.terms) {
    const spec = BUCKETS[t.by];
    if (!spec) continue;
    const b = spec.of(features);
    if (b != null && b === t.bucket) { pts += Number(t.pts); hit.push(`${t.by}=${b} ${Number(t.pts) >= 0 ? '+' : ''}${t.pts}`); }
  }
  pts = Math.max(0, Math.min(100, pts));
  const grade = pts >= 85 ? 'A+' : pts >= 72 ? 'A' : pts >= 58 ? 'B' : pts >= 44 ? 'C' : pts >= 28 ? 'D' : 'F';
  return { grade, pts: Math.round(pts), terms: hit };
}

// ── 4. THE AUTO-FIT ───────────────────────────────────────────────────────────
// The rule the study already implies, read off the same table a human would.
//
// This exists because the alternative was worse. "Read the bucket table, copy
// the qualifying rows, hand-write a JSON file, redeploy" is a procedure nobody
// runs on a schedule, so in practice the projection stayed inert forever and
// the calibration table stayed empty — which is not the honest-by-default state
// it was designed to be, it is just an unfinished loop.
//
// So the filters that were prose in the UI ("not thin, holds in both halves")
// become code, and the server applies them after every EOD freeze.
//
// WHAT IT WILL NOT DO, because these are the ways this goes wrong:
//
//   • It will not arm on a small sample. Under MIN_PICKS graded picks the fit
//     returns armed:false with a reason, however good the splits look.
//   • It will not use a bucket that failed the half-split (`holds !== true`) or
//     one that is thin. Those are the two filters that kill most findings, and
//     automating past them would be automating the mistake.
//   • It will not fit on `symbol`. A ticker that worked in one regime is the
//     first thing to stop working; BUCKETS.symbol says so in its own note.
//   • It will not triple-count the score blend. `score` is 0.6·|Δ| + 0.4·|%|,
//     so if score contributes a term, `chg` and `pctopen` are dropped — they are
//     the same evidence wearing two more hats, and stacking all three turns a
//     6pt edge into an 18pt one that was never there.
//   • It will not invent a magnitude. A term's points ARE its measured lift,
//     clamped, so the rule can only ever claim what the table showed.
//
// Everything it did and did not use comes back in `rejected`, so the UI can say
// why a bucket was passed over instead of leaving it a black box.

const FIT = {
  MIN_PICKS: Number(process.env.GEX_CHANGE_TOP_FIT_MIN_PICKS || 150), // graded picks before anything arms
  MIN_LIFT:  Number(process.env.GEX_CHANGE_TOP_FIT_MIN_LIFT  || 6),   // pts of lift worth encoding
  MAX_TERMS: Number(process.env.GEX_CHANGE_TOP_FIT_MAX_TERMS || 8),
  MAX_PTS:   Number(process.env.GEX_CHANGE_TOP_FIT_MAX_PTS   || 20),  // per-term clamp
  BASE: 50,
};
/** Never fit on these. See the note on BUCKETS.symbol. */
const FIT_EXCLUDE = new Set(['symbol']);
/** Dropped when `score` contributes — they are the two halves of that blend. */
const FIT_REDUNDANT_WITH_SCORE = ['chg', 'pctopen'];

/**
 * @param features [{ by, buckets:[…] }] — one entry per bucket key, each holding
 *                 the study's own bucket rows (n, pctGood, lift, thin, holds).
 * @param overall  the window summary the lifts were measured against.
 * @returns { armed, reason, rule, terms, rejected, sample }
 *          `rule` is always present and always valid; armed:false means it is
 *          the inert one and nothing should be stored.
 */
function fitRule({ features = [], overall = null, days = null, cohort = 'selected', today = null, opts = {} } = {}) {
  const minPicks = Number(opts.minPicks ?? FIT.MIN_PICKS);
  const minLift  = Number(opts.minLift  ?? FIT.MIN_LIFT);
  const maxTerms = Number(opts.maxTerms ?? FIT.MAX_TERMS);
  const n = Number(overall?.n || 0);
  const rejected = [];
  const inert = { ...INERT_RULE, terms: [] };

  if (n < minPicks) {
    return {
      armed: false,
      reason: `${n} graded pick(s) in the window — the fit needs ${minPicks} before it will claim anything.`,
      need: minPicks, have: n, rule: inert, terms: [], rejected, sample: overall,
    };
  }

  const candidates = [];
  for (const f of features) {
    if (!f || !BUCKETS[f.by] || FIT_EXCLUDE.has(f.by)) continue;
    for (const b of f.buckets || []) {
      const lift = b.lift == null ? null : Number(b.lift);
      if (b.thin) { rejected.push({ by: f.by, bucket: b.bucket, n: b.n, lift, why: 'thin' }); continue; }
      if (b.holds !== true) { rejected.push({ by: f.by, bucket: b.bucket, n: b.n, lift, why: 'did not hold in both halves' }); continue; }
      if (lift == null || !Number.isFinite(lift) || Math.abs(lift) < minLift) {
        rejected.push({ by: f.by, bucket: b.bucket, n: b.n, lift, why: `lift under ${minLift}pt` });
        continue;
      }
      candidates.push({ by: f.by, bucket: b.bucket, n: b.n, lift, holds: true });
    }
  }

  // De-duplicate the score blend against its own two halves.
  const scoreWins = candidates.some((c) => c.by === 'score');
  const kept = candidates.filter((c) => {
    if (scoreWins && FIT_REDUNDANT_WITH_SCORE.includes(c.by)) {
      rejected.push({ by: c.by, bucket: c.bucket, n: c.n, lift: c.lift, why: 'same evidence as the score term already in the rule' });
      return false;
    }
    return true;
  });

  // Strongest first, then cut. A rule with 20 terms is a fitted model wearing a
  // lookup table's clothes.
  kept.sort((a, b) => Math.abs(b.lift) - Math.abs(a.lift));
  const chosen = kept.slice(0, maxTerms);
  for (const c of kept.slice(maxTerms)) {
    rejected.push({ by: c.by, bucket: c.bucket, n: c.n, lift: c.lift, why: `beyond the ${maxTerms}-term cap` });
  }

  if (!chosen.length) {
    return {
      armed: false,
      reason: `${n} graded picks, but no bucket cleared all three filters (not thin, holds in both halves, ${minLift}pt+ lift). Nothing to arm — that is a real answer about the data, not a failure.`,
      need: minPicks, have: n, rule: inert, terms: [], rejected, sample: overall,
    };
  }

  const clamp = (v) => Math.max(-FIT.MAX_PTS, Math.min(FIT.MAX_PTS, Math.round(v)));
  const terms = chosen.map((c) => ({ by: c.by, bucket: c.bucket, pts: clamp(c.lift) }));
  const stamp = today || new Date().toISOString().slice(0, 10);
  const rule = {
    enabled: true,
    base: FIT.BASE,
    note: `auto-fit ${stamp} · ${days ?? '?'}d · ${n} picks · ${cohort}`,
    fittedAt: stamp,
    terms,
    source: 'stored',
  };
  return {
    armed: true,
    reason: `${terms.length} bucket(s) cleared every filter on ${n} graded picks.`,
    need: minPicks, have: n, rule, terms, rejected, sample: overall,
    evidence: chosen,
  };
}

/** Do two rules say the same thing? Used to avoid rewriting an identical rule
 *  (and re-logging it) after every nightly fit. */
function sameRule(a, b) {
  if (!a || !b) return false;
  if (!!a.enabled !== !!b.enabled) return false;
  if (Number(a.base) !== Number(b.base)) return false;
  const key = (r) => (r.terms || []).map((t) => `${t.by}|${t.bucket}|${t.pts}`).sort().join(',');
  return key(a) === key(b);
}

module.exports = {
  GRADE_ORDER, gradePoints, gradeFor, isGood,
  pickFeatures, slotMinutes, daysBetween,
  BUCKETS, BUCKET_KEYS,
  projRule, projectPick, PROJ_RULE_PATH,
  normalizeRule, applyStoredRule, rulePinned,
  fitRule, sameRule, FIT, FIT_EXCLUDE,
};
