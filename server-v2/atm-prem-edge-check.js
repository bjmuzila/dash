'use strict';
/**
 * server-v2/atm-prem-edge-check.js
 *
 * Answers the only question that matters about the Prem Diff panel: does a
 * premium spike tell you anything about what price does NEXT, or is it just
 * describing what price already did?
 *
 * READ-ONLY. Touches nothing but SELECTs on atm_prem_diff.
 *
 * ── WHAT IT MEASURES ────────────────────────────────────────────────────────
 *
 * For each session it computes the front-month premium tilt two ways:
 *
 *   dollars  = put_prem − call_prem            (what the panel plots)
 *   ratio    = (put_prem − call_prem) / (put_prem + call_prem)   ∈ [−1, +1]
 *
 * The RATIO is the one to trust for conditioning. Dollar magnitude scales with
 * the volatility regime and with the underlying's price level, so a $200M tilt
 * in a quiet month and in a panic month are not the same event; the share is.
 *
 * Both are then turned into a TRAILING z-score over `--lookback` sessions —
 * trailing, not full-sample. A full-sample mean and sd use the whole year to
 * score a bar from month two, which is look-ahead: the number could not have
 * been computed on the day it is being used to trade. That single detail is the
 * difference between a backtest and a story.
 *
 * Sessions are bucketed by z, and each bucket's FORWARD close-to-close returns
 * (1, 3, 5, 10 sessions) are reported against the all-sessions baseline.
 *
 * ── THE CONTROL THAT USUALLY KILLS IT ───────────────────────────────────────
 *
 * It also reports the SAME-DAY correlation between tilt and return. Premium
 * follows price mechanically: a hard down day prints put volume because people
 * are trading puts on a down day. If same-day correlation is strong and forward
 * correlation is ~0, the panel is a rear-view mirror — an accurate one, but not
 * a signal. Read that line before any of the bucket tables.
 *
 * ── HOW TO READ THE OUTPUT HONESTLY ─────────────────────────────────────────
 *
 *   · n is small. A year is ~250 sessions and a |z|>2 bucket holds maybe 5-12
 *     of them. Ten observations cannot separate a real 40bp edge from noise.
 *   · Forward windows OVERLAP, so the rows are not independent draws and any
 *     t-stat computed from them is inflated. The t column is printed as a rough
 *     ordering device, not a p-value.
 *   · Running this across 4 symbols × 3 bands × 4 horizons is 48 tests. At the
 *     usual thresholds two or three "hits" are what pure noise looks like.
 *     Something is interesting when it holds across ADJACENT bands and ADJACENT
 *     horizons and both symbols — not when one cell lights up.
 *
 * ── USAGE ───────────────────────────────────────────────────────────────────
 *
 *   node server-v2/atm-prem-edge-check.js --symbols=SPY,QQQ,SPX,NVDA --band=5
 *   node server-v2/atm-prem-edge-check.js --symbols=SPY --band=2 --lookback=60
 *
 * Flags: --symbols=A,B · --band=1|2|5 (default 5) · --lookback=N trailing
 *   sessions for the z-score (default 60) · --top=N spike days to list
 *   (default 10) · --slot=front|back (default front)
 */

const { getPool, ensureSchema } = require('./atm-prem-recorder');

function parseArgs(argv) {
  const out = { symbols: ['SPY'], band: 5, lookback: 60, top: 10, slot: 'front' };
  for (const a of argv.slice(2)) {
    if (a.startsWith('--symbols=')) out.symbols = a.slice(10).split(',').map((s) => s.trim().toUpperCase()).filter(Boolean);
    else if (a.startsWith('--band=')) out.band = Number(a.slice(7)) || 5;
    else if (a.startsWith('--lookback=')) out.lookback = Math.max(20, Number(a.slice(11)) || 60);
    else if (a.startsWith('--top=')) out.top = Math.max(0, Number(a.slice(6)) || 10);
    else if (a.startsWith('--slot=')) out.slot = a.slice(7) === 'back' ? 'back' : 'front';
  }
  return out;
}

const HORIZONS = [1, 3, 5, 10];

// ── Small stats ──────────────────────────────────────────────────────────────

const mean = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0);

function sd(a) {
  if (a.length < 2) return 0;
  const m = mean(a);
  return Math.sqrt(a.reduce((s, v) => s + (v - m) ** 2, 0) / (a.length - 1));
}

function median(a) {
  if (!a.length) return 0;
  const s = [...a].sort((x, y) => x - y);
  const i = Math.floor(s.length / 2);
  return s.length % 2 ? s[i] : (s[i - 1] + s[i]) / 2;
}

function corr(a, b) {
  const n = Math.min(a.length, b.length);
  if (n < 3) return 0;
  const ma = mean(a.slice(0, n));
  const mb = mean(b.slice(0, n));
  let num = 0; let da = 0; let db = 0;
  for (let i = 0; i < n; i++) {
    const x = a[i] - ma; const y = b[i] - mb;
    num += x * y; da += x * x; db += y * y;
  }
  return da > 0 && db > 0 ? num / Math.sqrt(da * db) : 0;
}

const pct = (x) => `${(x * 100).toFixed(2)}%`;
const pad = (s, n) => String(s).padEnd(n);
const padL = (s, n) => String(s).padStart(n);

// ── Load ─────────────────────────────────────────────────────────────────────

async function loadSeries(symbol, band, slot) {
  const p = getPool();
  if (!p) throw new Error('no DATABASE_URL');
  const { rows } = await p.query(
    `SELECT date, expiry, call_prem, put_prem, u_close, spot, strikes, src
       FROM atm_prem_diff
      WHERE symbol = $1 AND band_pct = $2 AND slot = $3
      ORDER BY date ASC`,
    [symbol, band, slot],
  );
  return rows.map((r) => {
    const call = Number(r.call_prem) || 0;
    const put = Number(r.put_prem) || 0;
    const total = call + put;
    return {
      date: r.date instanceof Date ? r.date.toISOString().slice(0, 10) : String(r.date).slice(0, 10),
      close: Number(r.u_close ?? r.spot) || 0,
      call,
      put,
      dollars: put - call,
      // Guard the zero-volume session rather than emitting NaN and poisoning
      // every downstream mean.
      ratio: total > 0 ? (put - call) / total : 0,
      strikes: Number(r.strikes) || 0,
    };
  }).filter((r) => r.close > 0);
}

// ── Analysis ─────────────────────────────────────────────────────────────────

/** Trailing z-score of `key` over the previous `lookback` sessions (exclusive). */
function trailingZ(series, key, lookback) {
  return series.map((_, i) => {
    if (i < lookback) return null;
    const win = series.slice(i - lookback, i).map((r) => r[key]);
    const s = sd(win);
    if (!(s > 0)) return null;
    return (series[i][key] - mean(win)) / s;
  });
}

/** Forward close-to-close return over `h` sessions, null past the end. */
function forwardReturns(series, h) {
  return series.map((r, i) => {
    const fut = series[i + h];
    return fut ? fut.close / r.close - 1 : null;
  });
}

const BUCKETS = [
  { key: 'z < -2',      test: (z) => z < -2 },
  { key: '-2 ≤ z < -1', test: (z) => z >= -2 && z < -1 },
  { key: '-1 ≤ z ≤ 1',  test: (z) => z >= -1 && z <= 1 },
  { key: '1 < z ≤ 2',   test: (z) => z > 1 && z <= 2 },
  { key: 'z > 2',       test: (z) => z > 2 },
];

function analyse(symbol, series, opts) {
  const { lookback, top } = opts;
  console.log(`\n${'='.repeat(78)}`);
  console.log(`${symbol}  ·  ${series.length} sessions  ${series[0]?.date} → ${series[series.length - 1]?.date}  ·  ±${opts.band}% ${opts.slot} month`);
  console.log('='.repeat(78));

  if (series.length < lookback + 30) {
    console.log(`Not enough history: ${series.length} sessions against a ${lookback}-session lookback. Skipping.`);
    return;
  }

  const zRatio = trailingZ(series, 'ratio', lookback);
  const zDollars = trailingZ(series, 'dollars', lookback);

  // ── The control: is this just describing today? ────────────────────────────
  const sameDay = series.map((r, i) => (i > 0 ? r.close / series[i - 1].close - 1 : null));
  const pairsIdx = series.map((_, i) => i).filter((i) => zRatio[i] != null && sameDay[i] != null);
  const cSame = corr(pairsIdx.map((i) => zRatio[i]), pairsIdx.map((i) => sameDay[i]));

  console.log('\nCONTROL — same-day correlation (tilt vs THAT day\'s return)');
  console.log(`  corr(z-ratio, same-day return) = ${cSame.toFixed(3)}`);
  console.log('  Strongly negative is expected and is NOT a signal: down days print put');
  console.log('  premium because people trade puts on down days. Compare against the');
  console.log('  forward correlations below — if those are ~0, the panel is a mirror.');

  console.log('\nFORWARD correlation (tilt vs return over the NEXT h sessions)');
  for (const h of HORIZONS) {
    const fwd = forwardReturns(series, h);
    const idx = series.map((_, i) => i).filter((i) => zRatio[i] != null && fwd[i] != null);
    const c = corr(idx.map((i) => zRatio[i]), idx.map((i) => fwd[i]));
    console.log(`  h=${padL(h, 2)}  corr = ${c >= 0 ? ' ' : ''}${c.toFixed(3)}   (n=${idx.length})`);
  }

  // ── Buckets ────────────────────────────────────────────────────────────────
  for (const h of HORIZONS) {
    const fwd = forwardReturns(series, h);
    const all = series.map((_, i) => i).filter((i) => fwd[i] != null).map((i) => fwd[i]);
    const baseMean = mean(all);

    console.log(`\nFORWARD ${h}-SESSION RETURN BY TILT BUCKET (trailing ${lookback}d z of the put/call SHARE)`);
    console.log(`  ${pad('bucket', 13)} ${padL('n', 4)} ${padL('mean', 9)} ${padL('median', 9)} ${padL('win%', 7)} ${padL('vs base', 9)} ${padL('t', 6)}`);
    console.log(`  ${'-'.repeat(62)}`);
    console.log(`  ${pad('ALL', 13)} ${padL(all.length, 4)} ${padL(pct(baseMean), 9)} ${padL(pct(median(all)), 9)} ${padL(`${(all.filter((v) => v > 0).length / all.length * 100).toFixed(0)}%`, 7)} ${padL('—', 9)} ${padL('—', 6)}`);

    for (const b of BUCKETS) {
      const vals = series.map((_, i) => i)
        .filter((i) => zRatio[i] != null && fwd[i] != null && b.test(zRatio[i]))
        .map((i) => fwd[i]);
      if (!vals.length) {
        console.log(`  ${pad(b.key, 13)} ${padL(0, 4)} ${padL('—', 9)} ${padL('—', 9)} ${padL('—', 7)} ${padL('—', 9)} ${padL('—', 6)}`);
        continue;
      }
      const m = mean(vals);
      const s = sd(vals);
      // Rough t against the baseline mean. Overlapping windows make the rows
      // dependent, so this OVERSTATES significance — it is an ordering device.
      const t = s > 0 && vals.length > 1 ? (m - baseMean) / (s / Math.sqrt(vals.length)) : 0;
      console.log(`  ${pad(b.key, 13)} ${padL(vals.length, 4)} ${padL(pct(m), 9)} ${padL(pct(median(vals)), 9)} ${padL(`${(vals.filter((v) => v > 0).length / vals.length * 100).toFixed(0)}%`, 7)} ${padL(pct(m - baseMean), 9)} ${padL(t.toFixed(2), 6)}`);
    }
  }

  // ── The actual spike days ──────────────────────────────────────────────────
  if (top > 0) {
    const ranked = series.map((r, i) => ({ r, i, z: zRatio[i], zd: zDollars[i] }))
      .filter((x) => x.z != null)
      .sort((a, b) => Math.abs(b.z) - Math.abs(a.z))
      .slice(0, top);
    const f1 = forwardReturns(series, 1);
    const f5 = forwardReturns(series, 5);
    console.log(`\nTOP ${ranked.length} TILT EXTREMES (by |z| of the share) — eyeball these before believing any table above`);
    console.log(`  ${pad('date', 12)} ${padL('z-share', 8)} ${padL('z-$', 7)} ${padL('calls', 9)} ${padL('puts', 9)} ${padL('fwd 1d', 9)} ${padL('fwd 5d', 9)}`);
    console.log(`  ${'-'.repeat(70)}`);
    for (const x of ranked.sort((a, b) => (a.r.date < b.r.date ? -1 : 1))) {
      const usd = (v) => `$${(v / 1e6).toFixed(0)}M`;
      console.log(`  ${pad(x.r.date, 12)} ${padL(x.z.toFixed(2), 8)} ${padL(x.zd != null ? x.zd.toFixed(2) : '—', 7)} ${padL(usd(x.r.call), 9)} ${padL(usd(x.r.put), 9)} ${padL(f1[x.i] != null ? pct(f1[x.i]) : '—', 9)} ${padL(f5[x.i] != null ? pct(f5[x.i]) : '—', 9)}`);
    }
  }
}

// ── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  const opts = parseArgs(process.argv);
  await ensureSchema();

  for (const symbol of opts.symbols) {
    try {
      // eslint-disable-next-line no-await-in-loop
      const series = await loadSeries(symbol, opts.band, opts.slot);
      if (!series.length) {
        console.log(`\n${symbol}: no rows at ±${opts.band}% ${opts.slot} — run the backfill first.`);
        continue;
      }
      analyse(symbol, series, opts);
    } catch (e) {
      console.error(`${symbol}: ${e.message}`);
    }
  }

  console.log(`\n${'─'.repeat(78)}`);
  console.log('Reminder before acting on any of the above:');
  console.log('  · A |z|>2 bucket in one year holds ~5-12 sessions. That cannot distinguish');
  console.log('    a real 40bp edge from noise, whatever the t column says.');
  console.log('  · Forward windows overlap, so the observations are not independent and');
  console.log('    every t is inflated.');
  console.log('  · 4 symbols x 3 bands x 4 horizons = 48 tests. Two or three "significant"');
  console.log('    cells is what pure noise produces. Believe a result only when it holds');
  console.log('    across ADJACENT bands, ADJACENT horizons and MORE THAN ONE symbol.');
  console.log('  · If the same-day correlation is strong and the forward ones are ~0, the');
  console.log('    panel is describing the past accurately and predicting nothing.');
  process.exit(0);
}

if (require.main === module) {
  main().catch((e) => { console.error('fatal:', e); process.exit(1); });
}

module.exports = { loadSeries, trailingZ, forwardReturns, analyse };
