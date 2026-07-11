'use strict';
/**
 * server-v2/pairs-regime-trainer.js
 *
 * Pairs Regime Engine — Phase 1 (Data + Trainer) of the "Co-Equal HMM
 * Addition" in REGIME_LEARNING_DESIGN.md. A second, independent HMM that
 * learns regimes from SPREAD behavior instead of market macro:
 *   MeanRevert — spread oscillating around its mean (reversion trades win)
 *   Drift      — spread trending away from mean (reversion fades)
 *   Stuck      — flat/low-vol spread (no edge)
 *
 * PAIR: ESU-NQU (per Brandon — no SPX/NDX legs wanted). Legs come from the
 * same es_candles/nq_candles tables the market-regime trainer reads.
 *
 * Flow (daily 04:30-04:40 ET, before the 05:00 market-regime trainer):
 *   1. Fetch 30D 5m candles for both legs, align on shared bar timestamps.
 *   2. β = cov(P1,P2)/var(P2) over the aligned window (stored in
 *      observable_config; a >20% swing vs the previous fit logs a
 *      correlation-decay warning per the doc's β stability tracker).
 *   3. spread_t = P1_t − β·P2_t; zscore_t = (spread − MA20)/σ20.
 *   4. Fit the shared 3-state Gaussian HMM on Δzscore, then RE-LABEL the
 *      three states by their spread behavior (not Trend/Chop/Panic):
 *        Stuck      = lowest Δz volatility state
 *        MeanRevert = of the rest, the state where Δz is more strongly
 *                     ANTI-correlated with the prior bar's zscore (pulls
 *                     back toward the mean)
 *        Drift      = the other one (pushes away / uncorrelated)
 *   5. Validate 5 bars forward, per the doc:
 *        MeanRevert hit  = |z(t+5)| <= 0.5·|z(t)| or sign flip
 *        Drift hit       = |z(t+5)| >  |z(t)|
 *        Stuck "neutral" = |z(t+5) − z(t)| < 0.5
 *      Rolled up over every decoded bar → accuracy_metrics; one
 *      pairs_validation_log row per ET day (last bar of day) keeps the log
 *      readable instead of ~5k rows per refit.
 *   6. Store fit in pairs_regime_fits; warn if hit-rate < 60%; fire onRefit
 *      (server wires it to the /ws/gex "pairs-regime-updated" broadcast).
 *
 * Read API:  GET  /proxy/pairs-regime-fit?pair=ESU-NQU
 * Manual:    POST /proxy/pairs-regime-retrain
 */

const { fitGaussianHmm } = require('./regimeHmm');

const PAIR_LABELS = ['MeanRevert', 'Drift', 'Stuck'];

// Config-driven pair list. leg symbols follow /api/snapshots/candles:
// undefined = es_candles, '/NQ' = nq_candles.
const PAIRS = [
  { id: 'ESU-NQU', leg1: { name: 'ESU', symbol: undefined }, leg2: { name: 'NQU', symbol: '/NQ' } },
];

const DAYS_BACK = 30;
const MA_WINDOW = 20;          // zscore MA/σ window (doc: MA20/σ20)
const VALIDATE_BARS_AHEAD = 5; // doc: "did spread revert 5 bars later?"
const STUCK_NEUTRAL_BAND = 0.5;
const MIN_OBS = 120;
const ACCURACY_ALERT_THRESHOLD = 0.60; // doc: pairs threshold is 60%
const BETA_SWING_WARN = 0.20;          // doc: β stability tracker, 20%

// Daily trigger window (ET minutes-since-midnight): 04:30-04:40 — 30 min
// before the market-regime trainer, per the doc.
const WINDOW_OPEN_MINS = 4 * 60 + 30;
const WINDOW_CLOSE_MINS = 4 * 60 + 40;

// Keep in sync with regime-trainer.js / eod-gex-recorder.js.
const MARKET_HOLIDAYS = new Set([
  '2026-01-01', '2026-01-19', '2026-02-16', '2026-04-03', '2026-05-25',
  '2026-06-19', '2026-07-03', '2026-09-07', '2026-11-26', '2026-12-25',
  '2027-01-01', '2027-01-18', '2027-02-15', '2027-03-26', '2027-05-31',
  '2027-06-18', '2027-07-05', '2027-09-06', '2027-11-25', '2027-12-24',
]);

let onRefit = null;
function setOnRefit(fn) { onRefit = typeof fn === 'function' ? fn : null; }

// ── PG pool (same lazy no-DB-safe pattern as regime-trainer.js) ─────────────
let pool = null;
let pgUnavailable = false;
let ensured = false;

function getPool() {
  if (pgUnavailable) return null;
  if (pool) return pool;
  if (!process.env.DATABASE_URL) { pgUnavailable = true; return null; }
  try {
    const { Pool } = require('pg');
    pool = new Pool({
      connectionString: process.env.DATABASE_URL,
      ssl: process.env.DATABASE_URL.includes('localhost') || process.env.DATABASE_URL.includes('127.0.0.1')
        ? undefined : { rejectUnauthorized: false },
      max: 2, keepAlive: true,
    });
    pool.on('error', (e) => {
      console.warn('[pairs-regime] pool error:', e.message);
      try { pool?.end().catch(() => {}); } catch {}
      pool = null; ensured = false;
    });
    return pool;
  } catch (e) {
    console.error('[pairs-regime] pg unavailable:', e.message);
    pgUnavailable = true; return null;
  }
}

async function ensureSchema() {
  const p = getPool();
  if (!p) return false;
  if (ensured) return true;
  try {
    await p.query(`
      CREATE TABLE IF NOT EXISTS pairs_regime_fits (
        id                BIGSERIAL   PRIMARY KEY,
        pair_id           TEXT        NOT NULL,
        fit_timestamp     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        lookback_bars     INTEGER     NOT NULL,
        hmm_params        JSONB       NOT NULL,
        decoded_path      JSONB       NOT NULL,
        stationary_dist   JSONB       NOT NULL,
        accuracy_metrics  JSONB       NOT NULL,
        observable_config JSONB       NOT NULL,
        version           INTEGER     NOT NULL DEFAULT 1,
        notes             TEXT,
        created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS idx_pairs_regime_fits_pair_ts ON pairs_regime_fits(pair_id, fit_timestamp DESC);

      CREATE TABLE IF NOT EXISTS pairs_validation_log (
        id                    BIGSERIAL   PRIMARY KEY,
        pair_id               TEXT        NOT NULL,
        refit_date            DATE        NOT NULL,
        bar_timestamp         TIMESTAMPTZ NOT NULL,
        regime_label          TEXT        NOT NULL,
        spread_zscore         REAL,
        mean_revert_happened  BOOLEAN,
        drift_continued       BOOLEAN,
        confidence_percentile INTEGER,
        notes                 TEXT,
        created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        UNIQUE(pair_id, refit_date)
      );
      CREATE INDEX IF NOT EXISTS idx_pairs_validation_pair_date ON pairs_validation_log(pair_id, refit_date DESC);
    `);
    ensured = true;
    return true;
  } catch (e) {
    console.error('[pairs-regime] ensureSchema error:', e.message);
    return false;
  }
}

// ── Time helpers (same as regime-trainer.js) ────────────────────────────────
function etParts(d = new Date()) {
  const p = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York', hour: '2-digit', minute: '2-digit', weekday: 'short', hour12: false,
  }).formatToParts(d);
  const get = (t) => p.find((x) => x.type === t)?.value;
  return { hour: Number(get('hour')), minute: Number(get('minute')), weekday: get('weekday') };
}
function etDateStr(d = new Date()) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(d).filter((p) => p.type !== 'literal')
    .reduce((a, p) => ({ ...a, [p.type]: p.value }), {});
  return `${parts.year}-${parts.month}-${parts.day}`;
}
function etDateOfMs(ms) { return etDateStr(new Date(ms)); }
function isTradingDay(dateStr, weekday) {
  if (weekday === 'Sat' || weekday === 'Sun') return false;
  return !MARKET_HOLIDAYS.has(dateStr);
}
function isTrainerWindow() {
  const { hour, minute, weekday } = etParts();
  const today = etDateStr();
  if (!isTradingDay(today, weekday)) return false;
  const mins = hour * 60 + minute;
  return mins >= WINDOW_OPEN_MINS && mins <= WINDOW_CLOSE_MINS;
}

function internalHeaders(extra = {}) {
  return Object.assign({}, extra,
    process.env.INTERNAL_API_TOKEN ? { 'x-internal-token': process.env.INTERNAL_API_TOKEN } : {});
}

async function fetchCloses(base, symbol, daysBack) {
  const qs = symbol
    ? `symbol=${encodeURIComponent(symbol)}&daysBack=${daysBack}&limit=20000`
    : `daysBack=${daysBack}&limit=20000`;
  try {
    const res = await fetch(`${base}/api/snapshots/candles?${qs}`, { cache: 'no-store', headers: internalHeaders() });
    if (!res.ok) return [];
    const j = await res.json().catch(() => ({}));
    const rows = Array.isArray(j.rows) ? j.rows : [];
    return rows
      .filter((c) => Number.isFinite(Number(c.close)) && Number(c.close) > 0 && Number.isFinite(Number(c.timestamp)))
      .map((c) => ({ ts: Number(c.timestamp), close: Number(c.close) }))
      .sort((a, b) => a.ts - b.ts);
  } catch {
    return [];
  }
}

/** Inner-join both legs on bar timestamp → [{ts, p1, p2}] ascending. */
function alignLegs(bars1, bars2) {
  const m2 = new Map(bars2.map((b) => [b.ts, b.close]));
  const out = [];
  for (const b of bars1) {
    const p2 = m2.get(b.ts);
    if (p2 != null) out.push({ ts: b.ts, p1: b.close, p2 });
  }
  return out;
}

/**
 * Build spread + zscore series. β is computed over the FULL aligned window
 * (cov/var — deterministic, no rolling-β noise; the doc allows either).
 * Returns { beta, rows: [{ts, spread, zscore|null}] } — zscore is null for
 * the first MA_WINDOW-1 bars.
 */
function buildSpreadSeries(aligned) {
  const n = aligned.length;
  const mean1 = aligned.reduce((a, r) => a + r.p1, 0) / n;
  const mean2 = aligned.reduce((a, r) => a + r.p2, 0) / n;
  let cov = 0, var2 = 0;
  for (const r of aligned) {
    cov += (r.p1 - mean1) * (r.p2 - mean2);
    var2 += (r.p2 - mean2) ** 2;
  }
  const beta = var2 > 0 ? cov / var2 : 0;

  const rows = aligned.map((r) => ({ ts: r.ts, spread: r.p1 - beta * r.p2, zscore: null }));
  for (let i = MA_WINDOW - 1; i < n; i++) {
    let s = 0;
    for (let j = i - MA_WINDOW + 1; j <= i; j++) s += rows[j].spread;
    const ma = s / MA_WINDOW;
    let v = 0;
    for (let j = i - MA_WINDOW + 1; j <= i; j++) v += (rows[j].spread - ma) ** 2;
    const sd = Math.sqrt(v / MA_WINDOW);
    rows[i].zscore = sd > 1e-9 ? (rows[i].spread - ma) / sd : 0;
  }
  return { beta, rows };
}

/**
 * Map the generic HMM's Trend/Chop/Panic state labels onto pairs labels by
 * each state's SPREAD behavior:
 *   Stuck      = lowest Δz std
 *   MeanRevert = of the rest, more negative corr(z_{t-1}, Δz_t)
 *   Drift      = the other
 * Returns { toPair: {Trend|Chop|Panic → pair label} }.
 */
function relabelStates(hmm, obs, zPrev) {
  const stats = {};
  for (const L of ['Trend', 'Chop', 'Panic']) stats[L] = { xs: [], zs: [] };
  for (let k = 0; k < hmm.decodedPath.length; k++) {
    const L = hmm.decodedPath[k];
    if (!stats[L]) continue;
    stats[L].xs.push(obs[k]);
    stats[L].zs.push(zPrev[k]);
  }
  const stdOf = (xs) => {
    if (xs.length < 3) return Infinity;
    const m = xs.reduce((a, b) => a + b, 0) / xs.length;
    return Math.sqrt(xs.reduce((a, b) => a + (b - m) ** 2, 0) / xs.length);
  };
  const corrOf = (zs, xs) => {
    if (xs.length < 3) return 0;
    const mz = zs.reduce((a, b) => a + b, 0) / zs.length;
    const mx = xs.reduce((a, b) => a + b, 0) / xs.length;
    let num = 0, dz = 0, dx = 0;
    for (let i = 0; i < xs.length; i++) {
      num += (zs[i] - mz) * (xs[i] - mx);
      dz += (zs[i] - mz) ** 2;
      dx += (xs[i] - mx) ** 2;
    }
    const den = Math.sqrt(dz * dx);
    return den > 0 ? num / den : 0;
  };

  const labels = ['Trend', 'Chop', 'Panic'];
  const stds = labels.map((L) => stdOf(stats[L].xs));
  const stuckIdx = stds.indexOf(Math.min(...stds));
  const rest = labels.filter((_, i) => i !== stuckIdx);
  const corrs = rest.map((L) => corrOf(stats[L].zs, stats[L].xs));
  // More negative corr(z_prev, Δz) = state pulls the spread BACK toward mean.
  const revertLabel = corrs[0] <= corrs[1] ? rest[0] : rest[1];
  const driftLabel = rest.find((L) => L !== revertLabel);

  const toPair = {};
  toPair[labels[stuckIdx]] = 'Stuck';
  toPair[revertLabel] = 'MeanRevert';
  toPair[driftLabel] = 'Drift';
  return { toPair };
}

/** Score one decoded bar 5 bars forward, per the doc's validation rules. */
function scoreBar(pairLabel, zNow, zFut) {
  if (zNow == null || zFut == null) return null;
  const reverted = Math.abs(zFut) <= 0.5 * Math.abs(zNow) || Math.sign(zFut) !== Math.sign(zNow);
  const drifted = Math.abs(zFut) > Math.abs(zNow);
  if (pairLabel === 'MeanRevert') return { hit: reverted, meanRevertHappened: reverted, driftContinued: drifted };
  if (pairLabel === 'Drift') return { hit: drifted, meanRevertHappened: reverted, driftContinued: drifted };
  return { hit: Math.abs(zFut - zNow) < STUCK_NEUTRAL_BAND, meanRevertHappened: reverted, driftContinued: drifted };
}

/**
 * @param {object} [opts]
 * @param {number}  [opts.daysBack] window override (Phase 2 backtest uses 60)
 * @param {boolean} [opts.dryRun]   fit + validate + return metrics, but write
 *                                  NOTHING to Postgres and skip onRefit
 */
async function runTrainerForPair(base, pair, opts = {}) {
  const daysBack = Number(opts.daysBack) > 0 ? Number(opts.daysBack) : DAYS_BACK;
  const dryRun = !!opts.dryRun;
  const p = getPool();
  if (!dryRun && (!p || !(await ensureSchema()))) return { skipped: 'no-db' };

  const [bars1, bars2] = await Promise.all([
    fetchCloses(base, pair.leg1.symbol, daysBack),
    fetchCloses(base, pair.leg2.symbol, daysBack),
  ]);
  const aligned = alignLegs(bars1, bars2);
  if (aligned.length < MIN_OBS + MA_WINDOW) return { skipped: 'not-enough-aligned-bars', aligned: aligned.length };

  const { beta, rows } = buildSpreadSeries(aligned);

  // Observable = Δzscore. obs[k] = z[i] - z[i-1] where barIdx[k] = i, so
  // decodedPath[k] labels the regime AT rows[barIdx[k]].
  const obs = [];
  const zPrev = [];
  const barIdx = [];
  for (let i = 1; i < rows.length; i++) {
    if (rows[i].zscore == null || rows[i - 1].zscore == null) continue;
    obs.push(rows[i].zscore - rows[i - 1].zscore);
    zPrev.push(rows[i - 1].zscore);
    barIdx.push(i);
  }
  if (obs.length < MIN_OBS) return { skipped: 'not-enough-observations', obs: obs.length };

  const hmm = fitGaussianHmm(obs, { states: 3, iters: 25 });
  if (!hmm) return { skipped: 'fit-failed' };

  const { toPair } = relabelStates(hmm, obs, zPrev);
  const pairPath = hmm.decodedPath.map((L) => toPair[L]);
  const idxOfMarket = hmm.stateIndexByLabel; // market-label → raw state idx

  // Stationary dist + transition re-expressed in PAIR_LABELS order.
  const marketOf = {};
  for (const [mkt, pr] of Object.entries(toPair)) marketOf[pr] = mkt;
  const marketOrder = ['Trend', 'Chop', 'Panic'];
  const stationaryDist = {};
  for (const pl of PAIR_LABELS) {
    stationaryDist[pl] = hmm.stationary[marketOrder.indexOf(marketOf[pl])];
  }
  const transition = PAIR_LABELS.map((li) =>
    PAIR_LABELS.map((lj) => hmm.transition[marketOrder.indexOf(marketOf[li])][marketOrder.indexOf(marketOf[lj])]));
  const means = PAIR_LABELS.map((pl) => hmm.means[idxOfMarket[marketOf[pl]]]);
  const stds = PAIR_LABELS.map((pl) => hmm.stds[idxOfMarket[marketOf[pl]]]);

  // ── Validation: every decoded bar with a bar 5 ahead ──────────────────────
  const byLabel = { MeanRevert: [], Drift: [], Stuck: [] };
  let hits = 0, scored = 0;
  const dayRows = new Map(); // ET date → last scored bar of that day (for the log)
  for (let k = 0; k < pairPath.length; k++) {
    const i = barIdx[k];
    const iFut = barIdx[k + VALIDATE_BARS_AHEAD];
    if (iFut == null) break;
    const s = scoreBar(pairPath[k], rows[i].zscore, rows[iFut].zscore);
    if (!s) continue;
    byLabel[pairPath[k]].push(s.hit);
    if (pairPath[k] !== 'Stuck') { hits += s.hit ? 1 : 0; scored++; }
    const conf = hmm.gammaByLabel[k]?.[marketOf[pairPath[k]]] ?? null;
    dayRows.set(etDateOfMs(rows[i].ts), {
      refitDate: etDateOfMs(rows[i].ts),
      barTs: rows[i].ts,
      label: pairPath[k],
      zscore: rows[i].zscore,
      meanRevertHappened: s.meanRevertHappened,
      driftContinued: s.driftContinued,
      confidencePercentile: conf != null ? Math.round(conf * 100) : null,
    });
  }
  const rate = (arr) => (arr.length ? arr.filter(Boolean).length / arr.length : null);
  const accuracy = {
    hit_rate: scored ? hits / scored : null, // MeanRevert+Drift calls only
    revert_hit: rate(byLabel.MeanRevert),
    drift_hit: rate(byLabel.Drift),
    stuck_neutral: rate(byLabel.Stuck),
    n: scored,
  };
  if (accuracy.hit_rate != null && accuracy.hit_rate < ACCURACY_ALERT_THRESHOLD) {
    console.warn(`[pairs-regime] ${pair.id}: hit-rate ${(accuracy.hit_rate * 100).toFixed(1)}% below ${ACCURACY_ALERT_THRESHOLD * 100}% — pair may be decorrelating`);
  }

  // Dry-run (Phase 2 backtest): stop here — return everything the caller
  // needs to judge the regime quality, persist nothing, broadcast nothing.
  if (dryRun) {
    const labelCounts = { MeanRevert: 0, Drift: 0, Stuck: 0 };
    for (const l of pairPath) labelCounts[l]++;
    return {
      ok: true, dryRun: true, daysBack, obs: obs.length, beta,
      accuracy, stationaryDist, labelCounts,
      hmmParams: { means, stds, transition, labels: [...PAIR_LABELS] },
    };
  }

  // ── β stability vs previous fit (doc: warn on >20% swing) ─────────────────
  let notes = `${pair.leg1.name} β=${beta.toFixed(4)} vs ${pair.leg2.name} at 5m`;
  try {
    const { rows: prevRows } = await p.query(
      `SELECT observable_config FROM pairs_regime_fits WHERE pair_id=$1 ORDER BY fit_timestamp DESC LIMIT 1`, [pair.id]
    );
    const prevBeta = Number(prevRows[0]?.observable_config?.beta);
    if (Number.isFinite(prevBeta) && prevBeta !== 0) {
      const swing = Math.abs(beta - prevBeta) / Math.abs(prevBeta);
      if (swing > BETA_SWING_WARN) {
        notes += ` — WARNING: β swung ${(swing * 100).toFixed(1)}% vs previous fit (${prevBeta.toFixed(4)}); correlation may be decaying`;
        console.warn(`[pairs-regime] ${pair.id}: ${notes}`);
      }
    }
  } catch { /* best-effort */ }

  // ── Persist ────────────────────────────────────────────────────────────────
  for (const r of dayRows.values()) {
    try {
      await p.query(
        `INSERT INTO pairs_validation_log (pair_id, refit_date, bar_timestamp, regime_label, spread_zscore, mean_revert_happened, drift_continued, confidence_percentile)
         VALUES ($1,$2,to_timestamp($3/1000.0),$4,$5,$6,$7,$8)
         ON CONFLICT (pair_id, refit_date) DO UPDATE SET
           bar_timestamp=to_timestamp($3/1000.0), regime_label=$4, spread_zscore=$5,
           mean_revert_happened=$6, drift_continued=$7, confidence_percentile=$8`,
        [pair.id, r.refitDate, r.barTs, r.label, r.zscore, r.meanRevertHappened, r.driftContinued, r.confidencePercentile]
      );
    } catch (e) {
      console.warn(`[pairs-regime] ${pair.id} validation upsert failed for ${r.refitDate}:`, e.message);
    }
  }

  const hmmParams = { means, stds, transition, labels: [...PAIR_LABELS], logLik: hmm.logLik, iterations: hmm.iterations, K: 3 };
  const observableConfig = { type: 'zscore_delta', ma_window: MA_WINDOW, beta, beta_source: 'full-window cov/var', validate_bars_ahead: VALIDATE_BARS_AHEAD };

  try {
    const { rows: verRows } = await p.query(
      `SELECT COALESCE(MAX(version),0)+1 AS v FROM pairs_regime_fits WHERE pair_id=$1`, [pair.id]
    );
    const version = verRows[0]?.v ?? 1;
    await p.query(
      `INSERT INTO pairs_regime_fits (pair_id, fit_timestamp, lookback_bars, hmm_params, decoded_path, stationary_dist, accuracy_metrics, observable_config, version, notes)
       VALUES ($1, NOW(), $2, $3, $4, $5, $6, $7, $8, $9)`,
      [pair.id, obs.length, JSON.stringify(hmmParams), JSON.stringify(pairPath), JSON.stringify(stationaryDist),
       JSON.stringify(accuracy), JSON.stringify(observableConfig), version, notes]
    );
    console.log(`[pairs-regime] ${pair.id}: daily refit stored (v${version}), ${obs.length} obs, β=${beta.toFixed(4)}, hit-rate ${accuracy.hit_rate != null ? (accuracy.hit_rate * 100).toFixed(1) + '%' : 'n/a'} over ${accuracy.n} scored bars`);
    try { onRefit?.(pair.id, { version, accuracy, stationaryDist, beta }); } catch (e) {
      console.warn('[pairs-regime] onRefit hook failed:', e.message);
    }
  } catch (e) {
    console.warn(`[pairs-regime] ${pair.id}: store failed:`, e.message);
    return { error: e.message };
  }

  return { ok: true, obs: obs.length, beta, accuracy };
}

async function runTrainerOnce(base) {
  const out = {};
  for (const pair of PAIRS) {
    try { out[pair.id] = await runTrainerForPair(base, pair); }
    catch (e) { out[pair.id] = { error: String(e?.message || e) }; }
  }
  return out;
}

/** Latest stored fit + recent validation rows, for /proxy/pairs-regime-fit. */
async function getLatestStoredFit(pairId) {
  const p = getPool();
  if (!p || !(await ensureSchema())) return null;
  try {
    const { rows } = await p.query(
      `SELECT pair_id, fit_timestamp, lookback_bars, hmm_params, decoded_path, stationary_dist,
              accuracy_metrics, observable_config, version, notes, created_at
       FROM pairs_regime_fits WHERE pair_id=$1 ORDER BY fit_timestamp DESC LIMIT 1`,
      [pairId]
    );
    const fit = rows[0] ?? null;
    const { rows: valRows } = await p.query(
      `SELECT refit_date, bar_timestamp, regime_label, spread_zscore, mean_revert_happened, drift_continued, confidence_percentile
       FROM pairs_validation_log WHERE pair_id=$1 ORDER BY refit_date DESC LIMIT 20`,
      [pairId]
    );
    return { fit, validation: valRows };
  } catch (e) {
    console.warn('[pairs-regime] read failed:', e.message);
    return null;
  }
}

const lastRunDate = {};

let timer = null;
function startPairsRegimeTrainer(port) {
  const base = `http://localhost:${port}`;
  if (process.env.PAIRS_REGIME_TRAINER_DISABLED === '1') {
    console.log('[pairs-regime] disabled via PAIRS_REGIME_TRAINER_DISABLED=1');
    return () => {};
  }
  console.log(`[pairs-regime] enabled — daily 30D spread-HMM refit + validation, 04:30-04:40 ET window (${PAIRS.map((p) => p.id).join(', ')})`);
  (async () => {
    if (!(await ensureSchema().catch(() => false))) return;
    for (const pair of PAIRS) {
      const latest = await getLatestStoredFit(pair.id).catch(() => null);
      if (latest?.fit?.fit_timestamp) {
        lastRunDate[pair.id] = etDateOfMs(new Date(latest.fit.fit_timestamp).getTime());
      }
    }
  })();
  timer = setInterval(async () => {
    if (!isTrainerWindow()) return;
    const today = etDateStr();
    for (const pair of PAIRS) {
      if (lastRunDate[pair.id] === today) continue;
      lastRunDate[pair.id] = today; // set before awaiting so a slow run can't double-fire
      try {
        const r = await runTrainerForPair(base, pair);
        console.log(`[pairs-regime] ${pair.id} daily run:`, r);
      } catch (e) {
        console.warn(`[pairs-regime] ${pair.id} daily run failed:`, e.message);
      }
    }
  }, 60_000);
  return () => { if (timer) clearInterval(timer); timer = null; };
}

/** Manual force-run for POST /proxy/pairs-regime-retrain. */
async function forceRetrainAll(base) {
  const today = etDateStr();
  const out = await runTrainerOnce(base);
  for (const pair of PAIRS) lastRunDate[pair.id] = today;
  return out;
}

module.exports = {
  startPairsRegimeTrainer,
  ensureSchema,
  runTrainerOnce,
  runTrainerForPair,
  forceRetrainAll,
  getLatestStoredFit,
  setOnRefit,
  PAIR_LABELS,
  PAIRS,
};
