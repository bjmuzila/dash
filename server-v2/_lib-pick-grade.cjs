'use strict';
/**
 * server-v2/_lib-pick-grade.cjs
 *
 * The CANONICAL grade + feature vocabulary for GEX Change Top picks.
 *
 * Three things live here, deliberately together:
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
 *   3. projectPick()  — the forward-looking projected grade. Rule-driven and
 *                       INERT until a rule is configured (see PROJ_RULE below).
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
// SHIPS INERT. With no rule configured, projectPick() returns null, no proj_grade
// is written, and the UI shows no Proj pill. That is deliberate: a projection
// seeded with plausible-looking guesses is indistinguishable, on screen, from one
// backed by evidence.
//
// To arm it, drop server-v2/config/pick-proj-rule.json (or set the env var
// GEX_CHANGE_TOP_PROJ_RULE to the same JSON):
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
const INERT_RULE = { enabled: false, base: 50, terms: [], note: 'no rule configured' };

let _rule = null;
function projRule({ reload = false } = {}) {
  if (_rule && !reload) return _rule;
  let raw = null;
  if (process.env.GEX_CHANGE_TOP_PROJ_RULE) {
    raw = process.env.GEX_CHANGE_TOP_PROJ_RULE;
  } else {
    try { raw = fs.readFileSync(PROJ_RULE_PATH, 'utf8'); } catch { raw = null; }
  }
  if (!raw) { _rule = INERT_RULE; return _rule; }
  try {
    const j = JSON.parse(raw);
    const terms = Array.isArray(j.terms) ? j.terms.filter((t) => {
      const ok = t && BUCKETS[t.by] && typeof t.bucket === 'string' && Number.isFinite(Number(t.pts));
      if (!ok) console.warn('[pick-grade] ignoring malformed projection term:', JSON.stringify(t));
      return ok;
    }) : [];
    _rule = {
      enabled: !!j.enabled && terms.length > 0,
      base: Number.isFinite(Number(j.base)) ? Number(j.base) : 50,
      note: String(j.note || ''),
      terms,
    };
    if (_rule.enabled) console.log(`[pick-grade] projection rule armed: ${terms.length} term(s)${_rule.note ? ` — ${_rule.note}` : ''}`);
  } catch (e) {
    console.warn('[pick-grade] projection rule unreadable, staying inert:', e.message);
    _rule = INERT_RULE;
  }
  return _rule;
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

module.exports = {
  GRADE_ORDER, gradePoints, gradeFor, isGood,
  pickFeatures, slotMinutes, daysBetween,
  BUCKETS, BUCKET_KEYS,
  projRule, projectPick, PROJ_RULE_PATH,
};
