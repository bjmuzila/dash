'use strict';
/**
 * server-v2/computation/dte-buckets.js
 *
 * Bucket an EOD option chain by time to expiry and roll dealer gamma up per
 * bucket.
 *
 * Context: eod-gex-recorder.js already sweeps EVERY listed expiration through
 * ThetaData at the close (chain + greeks + OI + volume per expiry) — that sweep
 * is what `total_gex_ex0dte` is computed from. So per-strike VENDOR gamma is
 * already available across the whole chain at EOD, with no implied-vol
 * assumption anywhere. This module consumes that same shape and splits it by
 * DTE instead of collapsing it to one number.
 *
 * ── The honest part ───────────────────────────────────────────────────────
 * Gamma is measured for every bucket. The POSITION SIGN is not:
 *
 *   - Inside ~7 DTE we can measure it. The live tape carries classified,
 *     aggressor-signed prints, and oi_daily carries a day-over-day OI baseline
 *     (OI_DAILY_EXPIRY_DEPTH defaults to 6, which for SPX's near-daily
 *     expiries is roughly a week).
 *   - Beyond that we cannot. _activeContracts() filters
 *     `c.expiration !== this.expiry`, so the live feed only ever subscribes the
 *     ONE selected expiry — normally 0DTE. There is no far-dated flow in
 *     flow_prints, and no ΔOI past the recorder's depth.
 *
 * So every bucket carries an explicit `basis` of 'measured' or 'convention',
 * and the UI is expected to show it. A convention bucket is the ordinary
 * calls-positive / puts-negative assumption applied to outstanding open
 * interest — the same basis the existing dashboard uses. It is a real number;
 * it is just not a measured dealer book, and conflating the two is the whole
 * failure mode this module exists to avoid.
 */

const { notionalGammaPer1Pct, signedPosition, reconcilePositionChange } =
  require('./dealer-inventory.js');

/**
 * Bucket definitions, ascending, non-overlapping, exhaustive over dte >= 0.
 * `maxDte` null = open-ended.
 */
const BUCKETS = [
  { key: '0dte',  label: '0DTE',  minDte: 0,  maxDte: 0 },
  { key: 'near',  label: 'Near',  minDte: 1,  maxDte: 7 },
  { key: 'front', label: 'Front', minDte: 8,  maxDte: 30 },
  { key: 'mid',   label: 'Mid',   minDte: 31, maxDte: 90 },
  { key: 'back',  label: 'Back',  minDte: 91, maxDte: null },
];

/** DTE at or below which signed flow + an OI baseline actually exist. */
const MEASURABLE_MAX_DTE = Number(process.env.DEALER_GAMMA_MEASURABLE_DTE || 7);

/** Calendar days between two YYYY-MM-DD dates. Negative if expiry is past. */
function dteBetween(sessionDate, expiration) {
  const a = Date.parse(`${sessionDate}T00:00:00Z`);
  const b = Date.parse(`${expiration}T00:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return Math.round((b - a) / 86400000);
}

/** The bucket a given DTE falls into, or null when dte is negative/invalid. */
function bucketForDte(dte) {
  if (!Number.isFinite(dte) || dte < 0) return null;
  for (const b of BUCKETS) {
    if (dte >= b.minDte && (b.maxDte == null || dte <= b.maxDte)) return b;
  }
  return null;
}

/**
 * Dealer gamma for one strike under the CONVENTION basis: calls positive, puts
 * negative, applied to outstanding open interest. Mirrors gex-calculator.js.
 *
 * @param {{callGamma:number, putGamma:number, callOi:number, putOi:number}} s
 * @param {number} spot
 * @returns {number} dollar gamma per 1% move
 */
function conventionStrikeGamma(s, spot) {
  const cg = Math.abs(Number(s?.callGamma) || 0);
  const pg = Math.abs(Number(s?.putGamma) || 0);
  const co = Number(s?.callOi) || 0;
  const po = Number(s?.putOi) || 0;
  return notionalGammaPer1Pct(cg, co, spot) - notionalGammaPer1Pct(pg, po, spot);
}

/**
 * Dealer gamma for one strike under the MEASURED basis: signed dealer inventory
 * from classified flow, sized against the OI delta.
 *
 * Both legs use +gamma — the long/short information already lives in the signed
 * contract counts, so negating the put leg again (as the convention path
 * legitimately does) would double-flip it.
 *
 * @param {object} s strike row, must carry `inventory` and OI deltas
 * @param {number} spot
 * @param {'flow'|'oi'|'min'} mode
 * @returns {number} dollar gamma per 1% move
 */
function measuredStrikeGamma(s, spot, mode) {
  const pos = reconcilePositionChange(
    signedPosition(s?.inventory),
    { call: s?.callOiDelta, put: s?.putOiDelta },
    mode
  );
  const cg = Math.abs(Number(s?.callGamma) || 0);
  const pg = Math.abs(Number(s?.putGamma) || 0);
  return notionalGammaPer1Pct(cg, pos.callNet, spot)
       + notionalGammaPer1Pct(pg, pos.putNet, spot);
}

/**
 * Roll an EOD chain up into DTE buckets.
 *
 * @param {object} input
 * @param {string} input.sessionDate 'YYYY-MM-DD' — the session being snapshotted
 * @param {number} input.spot underlying price at the snapshot instant
 * @param {Array<{
 *   expiration: string, strike: number,
 *   callGamma: number, putGamma: number,
 *   callOi: number, putOi: number,
 *   inventory?: object,          // present only where flow was captured
 *   callOiDelta?: number, putOiDelta?: number,
 * }>} input.strikes flattened all-expirations chain from the EOD sweep
 * @param {object} [opts]
 * @param {'flow'|'oi'|'min'} [opts.mode='oi'] estimator for measured buckets
 * @param {number} [opts.measurableMaxDte] override the measured/convention line
 * @returns {{
 *   sessionDate: string, spot: number,
 *   buckets: Array<object>, rollups: Array<object>,
 *   totals: {net: number, gross: number, ex0dte: number, zeroDte: number},
 *   expirations: number, strikes: number,
 * }}
 */
function bucketChain(input, opts = {}) {
  const mode = opts.mode || 'oi';
  const measurableMax = Number.isFinite(opts.measurableMaxDte)
    ? opts.measurableMaxDte
    : MEASURABLE_MAX_DTE;

  const sessionDate = String(input?.sessionDate || '');
  const spot = Number(input?.spot) || 0;
  const strikes = Array.isArray(input?.strikes) ? input.strikes : [];

  // Seed every bucket so an empty one still renders as a zero row rather than
  // silently vanishing — a missing row reads as "no data", which is a
  // different claim from "no gamma".
  const acc = new Map();
  for (const b of BUCKETS) {
    acc.set(b.key, {
      key: b.key,
      label: b.label,
      dteLabel: b.maxDte == null ? `${b.minDte}+` : (b.minDte === b.maxDte ? `${b.minDte}` : `${b.minDte} – ${b.maxDte}`),
      minDte: b.minDte,
      maxDte: b.maxDte,
      expirations: new Set(),
      strikes: 0,
      callOi: 0,
      putOi: 0,
      netGamma: 0,
      basis: b.minDte <= measurableMax ? 'measured' : 'convention',
      measuredStrikes: 0,
    });
  }

  let expirations = new Set();
  let counted = 0;

  for (const s of strikes) {
    const expiration = String(s?.expiration || '');
    if (!expiration) continue;
    const dte = dteBetween(sessionDate, expiration);
    const b = bucketForDte(dte);
    if (!b) continue; // already expired, or unparseable — not part of the book

    const row = acc.get(b.key);
    row.expirations.add(expiration);
    row.strikes += 1;
    row.callOi += Number(s.callOi) || 0;
    row.putOi += Number(s.putOi) || 0;

    // A bucket is only allowed to use the measured basis where flow was
    // actually captured for that strike. A strike inside 7 DTE with no
    // inventory falls back to convention rather than contributing zero, which
    // would silently understate the bucket.
    const canMeasure = row.basis === 'measured' && s.inventory != null;
    if (canMeasure) {
      row.netGamma += measuredStrikeGamma(s, spot, mode);
      row.measuredStrikes += 1;
    } else {
      row.netGamma += conventionStrikeGamma(s, spot);
    }

    expirations.add(expiration);
    counted += 1;
  }

  const buckets = BUCKETS.map((b) => {
    const r = acc.get(b.key);
    const coverage = r.strikes ? r.measuredStrikes / r.strikes : 0;
    return {
      key: r.key,
      label: r.label,
      dteLabel: r.dteLabel,
      expirations: r.expirations.size,
      strikes: r.strikes,
      callOi: r.callOi,
      putOi: r.putOi,
      netGamma: r.netGamma,
      // Downgrade the claim when flow only covered part of the bucket, so the
      // UI never shows a bare "measured" chip over mostly-assumed numbers.
      basis: r.basis === 'convention' ? 'convention'
        : coverage >= 0.5 ? 'measured' : 'partial',
      measuredCoverage: coverage,
    };
  });

  const zeroDte = buckets.find((b) => b.key === '0dte')?.netGamma || 0;
  const net = buckets.reduce((a, b) => a + b.netGamma, 0);
  const gross = buckets.reduce((a, b) => a + Math.abs(b.netGamma), 0);
  const ex0dte = net - zeroDte;

  const sumOi = (pred, field) =>
    buckets.filter(pred).reduce((a, b) => a + b[field], 0);
  const notZero = (b) => b.key !== '0dte';
  const all = () => true;

  // Rollups are NOT buckets — they are sums of the rows above. Keeping them in
  // a separate array stops a consumer from iterating one list and
  // double-counting, and lets the UI render them below a divider.
  const rollups = [
    {
      key: 'ex0dte',
      label: 'Ex-0DTE',
      dteLabel: '1+',
      expirations: new Set(
        strikes
          .filter((s) => {
            const d = dteBetween(sessionDate, String(s?.expiration || ''));
            return Number.isFinite(d) && d >= 1;
          })
          .map((s) => s.expiration)
      ).size,
      strikes: buckets.filter(notZero).reduce((a, b) => a + b.strikes, 0),
      callOi: sumOi(notZero, 'callOi'),
      putOi: sumOi(notZero, 'putOi'),
      netGamma: ex0dte,
      basis: 'mixed',
    },
    {
      key: 'all',
      label: 'All expirations',
      dteLabel: '0+',
      expirations: expirations.size,
      strikes: buckets.reduce((a, b) => a + b.strikes, 0),
      callOi: sumOi(all, 'callOi'),
      putOi: sumOi(all, 'putOi'),
      netGamma: net,
      basis: 'mixed',
    },
  ];

  return {
    sessionDate,
    spot,
    mode,
    buckets,
    rollups,
    totals: { net, gross, ex0dte, zeroDte },
    expirations: expirations.size,
    strikes: counted,
  };
}

/**
 * Share of GROSS gamma for a row. Gross (not net) so the five disjoint buckets
 * sum to 100% even when they straddle zero — a share of net would blow up as
 * net approaches zero and can exceed 100%.
 */
function shareOfGross(netGamma, gross) {
  if (!(gross > 0) || !Number.isFinite(netGamma)) return 0;
  return Math.abs(netGamma) / gross;
}

module.exports = {
  BUCKETS,
  MEASURABLE_MAX_DTE,
  dteBetween,
  bucketForDte,
  conventionStrikeGamma,
  measuredStrikeGamma,
  bucketChain,
  shareOfGross,
};
