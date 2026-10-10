'use strict';
/**
 * server-v2/atm-prem-intraday-recorder.js
 *
 * The intraday half of the Prem Diff panel: near-the-money premium TRADED,
 * calls vs puts, front and back monthly, in ONE-MINUTE buckets through RTH —
 * for SPY and QQQ.
 *
 * ── HOW IT GETS PER-MINUTE PREMIUM OUT OF A CUMULATIVE FEED ─────────────────
 *
 * The chain reports `volume` as the contract's CUMULATIVE day volume. Reading
 * it once a minute and multiplying by the mark would therefore re-count the
 * whole day, every minute. What this recorder stores instead is the DIFFERENCE
 * between consecutive snapshots, priced at the mark prevailing in that minute:
 *
 *   premium(minute, side) = Σ over band strikes of
 *                             (volume_now − volume_prev) × mark_now × 100
 *
 * The delta is taken PER STRIKE and only then summed. Aggregating volume to the
 * band first and differencing that would price every contract at one blended
 * number, which on a chain where a 2-delta wing and the ATM straddle differ by
 * two orders of magnitude is not an approximation, it is a different quantity.
 *
 * A pleasant side effect: summing these minute buckets gives a BETTER day total
 * than the EOD recorder's single snapshot, which necessarily prices the whole
 * session's volume at the 16:05 mark. The two will not agree exactly and the
 * EOD number is the cruder one. They are stored separately and neither
 * overwrites the other.
 *
 * ── WHAT A RESTART COSTS ────────────────────────────────────────────────────
 *
 * The per-strike previous-volume map lives in memory. After a restart the first
 * tick has nothing to difference against, so it is recorded as a BASELINE row
 * (`is_baseline = true`, zero interval premium) and normal buckets resume on the
 * next tick. The volume traded during the gap is NOT attributed to any minute —
 * it would otherwise land as one enormous fake bar at the moment the process
 * came back. `cum_call_prem` / `cum_put_prem` are the recorder's own running
 * totals and are likewise reset, so a restarted session's cumulative line starts
 * from the restart, not from the open. The panel labels that.
 *
 * ── BAND MEMBERSHIP MOVES ───────────────────────────────────────────────────
 *
 * Spot drifts during the session, so a strike can be inside ±1% at 10:00 and
 * outside it at 15:00. Deltas are computed per strike regardless of band, then
 * assigned to bands by the strike's distance from spot AT THAT MINUTE. That is
 * the honest reading of "premium traded near the money right now" — a fixed
 * strike list chosen at the open would be measuring a different thing by lunch.
 *
 * WRITES: atm_prem_intraday(minute, date, symbol, slot, band_pct, expiry, spot,
 *   call_prem, put_prem, call_vol, put_vol, cum_call_prem, cum_put_prem,
 *   strikes, is_baseline, ts). PK (date, symbol, slot, band_pct, minute).
 *
 * SOURCE: fetchChainFull from proxy-tastytrade, same as the daily recorder. No
 * proxy file is modified and no new upstream dependency is added.
 *
 * Wiring: started by startAtmPremRecorder() in atm-prem-recorder.js, so this
 * needs no second hook in server-with-proxy.js.
 * Disable with ATM_PREM_INTRADAY=0.
 */

const { fetchChainFull } = require('./proxy-tastytrade');
const {
  getPool, resolveMonthlies, BANDS, CONTRACT_MULTIPLIER,
} = require('./atm-prem-recorder');

// ── Tunables ─────────────────────────────────────────────────────────────────

// SPX dropped for the same reason as the daily recorder — its monthly is a
// rounding error next to SPXW. Also halves this recorder's chain-fetch load.
const SYMBOLS = String(process.env.ATM_PREM_INTRADAY_SYMBOLS || 'SPY,QQQ')
  .split(',').map((s) => s.trim().toUpperCase()).filter(Boolean);

const INTERVAL_MS = Number(process.env.ATM_PREM_INTRADAY_INTERVAL_MS || 60_000);
/** Pacing between chain fetches inside one tick, so 6 requests trickle. */
const FETCH_DELAY_MS = Number(process.env.ATM_PREM_INTRADAY_FETCH_DELAY_MS || 900);
const RETAIN_DAYS = Number(process.env.ATM_PREM_INTRADAY_RETAIN_DAYS || 45);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ── Time ─────────────────────────────────────────────────────────────────────

function todayYmdET() {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(new Date());
}

function nowET() {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York', hourCycle: 'h23',
    hour: '2-digit', minute: '2-digit', weekday: 'short',
  }).formatToParts(new Date());
  const get = (t) => parts.find((x) => x.type === t)?.value ?? '';
  return { weekday: get('weekday'), minutes: Number(get('hour')) * 60 + Number(get('minute')) };
}

/**
 * RTH, with a one-minute head start.
 *
 * 569 (09:29) rather than 570 is deliberate: the tick that runs just before the
 * bell establishes the day's BASELINE off the overnight/pre-open volume, so the
 * 09:30 bucket is the opening minute's flow rather than the opening minute plus
 * whatever printed pre-market.
 */
function isRthNowET() {
  const { weekday, minutes } = nowET();
  if (weekday === 'Sat' || weekday === 'Sun') return false;
  return minutes >= 569 && minutes < 961;
}

/** Current wall clock floored to the minute — the bucket key. */
function minuteBucket() {
  const d = new Date();
  d.setSeconds(0, 0);
  return d;
}

// ── Schema ───────────────────────────────────────────────────────────────────

let _schemaReady = false;

async function ensureIntradaySchema() {
  if (_schemaReady) return true;
  const p = getPool();
  if (!p) return false;
  await p.query(`
    CREATE TABLE IF NOT EXISTS atm_prem_intraday (
      date          DATE             NOT NULL,
      symbol        TEXT             NOT NULL,
      slot          TEXT             NOT NULL,
      band_pct      REAL             NOT NULL,
      minute        TIMESTAMPTZ      NOT NULL,
      expiry        TEXT             NOT NULL,
      spot          DOUBLE PRECISION,
      call_prem     DOUBLE PRECISION NOT NULL DEFAULT 0,
      put_prem      DOUBLE PRECISION NOT NULL DEFAULT 0,
      call_vol      BIGINT           NOT NULL DEFAULT 0,
      put_vol       BIGINT           NOT NULL DEFAULT 0,
      cum_call_prem DOUBLE PRECISION NOT NULL DEFAULT 0,
      cum_put_prem  DOUBLE PRECISION NOT NULL DEFAULT 0,
      strikes       INTEGER          NOT NULL DEFAULT 0,
      is_baseline   BOOLEAN          NOT NULL DEFAULT FALSE,
      src           TEXT             NOT NULL DEFAULT 'live',
      ts            TIMESTAMPTZ      NOT NULL DEFAULT now(),
      PRIMARY KEY (date, symbol, slot, band_pct, minute)
    );
  `);
  // The only read is "one symbol, one band, one session, both slots, in time
  // order" — which this index serves as a single ordered scan.
  await p.query(`CREATE INDEX IF NOT EXISTS idx_atm_prem_intraday_lookup
                 ON atm_prem_intraday (symbol, band_pct, date, minute);`);
  // Added after the table shipped — a deployment that created it without `src`
  // must not need a hand-run migration to accept backfilled rows.
  await p.query(`ALTER TABLE atm_prem_intraday
                 ADD COLUMN IF NOT EXISTS src TEXT NOT NULL DEFAULT 'live';`);
  _schemaReady = true;
  return true;
}

// ── Chain → per-strike snapshot ──────────────────────────────────────────────

const num = (o, ...keys) => {
  if (!o) return 0;
  for (const k of keys) {
    const v = parseFloat(o[k]);
    if (Number.isFinite(v)) return v;
  }
  return 0;
};

const int = (o, ...keys) => {
  if (!o) return 0;
  for (const k of keys) {
    const v = parseInt(o[k] ?? 0, 10);
    if (Number.isFinite(v) && v) return v;
  }
  return 0;
};

function contractPrice(leg) {
  const mark = num(leg, 'mark');
  if (mark > 0) return mark;
  const bid = num(leg, 'bid');
  const ask = num(leg, 'ask');
  if (bid > 0 && ask > 0) return (bid + ask) / 2;
  if (ask > 0) return ask / 2;
  const last = num(leg, 'last', 'close-price');
  return last > 0 ? last : 0;
}

/** { spot, strikes: Map(strike → { cVol, pVol, cPx, pPx }) } */
function snapshotChain(items, underlyingPrice, expiry) {
  const spot = Number(underlyingPrice) || 0;
  const strikes = new Map();
  if (!(spot > 0) || !Array.isArray(items)) return { spot, strikes };
  for (const group of items) {
    const groupExp = String(group['expiration-date'] || '').slice(0, 10);
    if (groupExp && expiry && groupExp !== expiry) continue;
    for (const it of group.strikes || []) {
      const k = parseFloat(it['strike-price'] || 0);
      if (!(k > 0)) continue;
      strikes.set(k, {
        cVol: int(it.call, 'volume', 'day-volume'),
        pVol: int(it.put, 'volume', 'day-volume'),
        cPx: contractPrice(it.call),
        pPx: contractPrice(it.put),
      });
    }
  }
  return { spot, strikes };
}

// ── State ────────────────────────────────────────────────────────────────────

/**
 * key `${date}|${symbol}|${slot}` → { strikes: Map(strike → {cVol,pVol}),
 * cum: { [band]: { call, put } } }
 *
 * Keyed by DATE so yesterday's cumulative volumes can never be differenced
 * against today's reset counters — that would emit one bar holding the entire
 * previous session as a negative.
 */
const _state = new Map();

function blankCum() {
  const o = {};
  for (const b of BANDS) o[b] = { call: 0, put: 0 };
  return o;
}

// ── Tick ─────────────────────────────────────────────────────────────────────

let _running = false;
/** date → { front, back } so expiries are resolved once per session, not per minute. */
const _expiryCache = new Map();

async function expiriesFor(symbol, day) {
  const key = `${day}|${symbol}`;
  if (_expiryCache.has(key)) return _expiryCache.get(key);
  const res = await resolveMonthlies(symbol, day);
  _expiryCache.set(key, res);
  return res;
}

async function tick() {
  if (_running) return;
  if (!isRthNowET()) return;
  _running = true;
  const day = todayYmdET();
  const minute = minuteBucket();
  const rows = [];

  try {
    if (!(await ensureIntradaySchema())) return;

    for (const symbol of SYMBOLS) {
      let expiries;
      try {
        // eslint-disable-next-line no-await-in-loop
        expiries = await expiriesFor(symbol, day);
      } catch (e) {
        console.warn(`[atm-prem-intraday] ${symbol}: expiry resolve failed — ${e.message}`);
        continue;
      }

      for (const [slot, expiry] of [['front', expiries.front], ['back', expiries.back]]) {
        if (!expiry) continue;
        // eslint-disable-next-line no-await-in-loop
        await sleep(FETCH_DELAY_MS);
        // eslint-disable-next-line no-await-in-loop
        const chain = await fetchChainFull(symbol, expiry).catch(() => null);
        if (!chain) continue;
        const { spot, strikes } = snapshotChain(chain.items, chain.underlyingPrice, expiry);
        if (!(spot > 0) || !strikes.size) continue;

        const key = `${day}|${symbol}|${slot}`;
        const prev = _state.get(key);
        const isBaseline = !prev;

        const acc = {};
        for (const b of BANDS) acc[b] = { callPrem: 0, putPrem: 0, callVol: 0, putVol: 0, strikes: 0 };

        if (!isBaseline) {
          const widest = Math.max(...BANDS);
          for (const [k, cur] of strikes) {
            const distPct = Math.abs(k - spot) / spot * 100;
            if (distPct > widest) continue;
            const was = prev.strikes.get(k);
            // A strike we have not seen before contributes nothing this minute.
            // Its whole cumulative volume is history, not this minute's flow —
            // counting it would put a spike on the bar where a new strike got
            // listed or first came within the widest band.
            if (!was) continue;
            // Clamp: exchange volume should never fall, but a late correction or
            // a bad print can walk it back, and a negative bar here would read
            // as premium being un-traded.
            const dc = Math.max(0, cur.cVol - was.cVol);
            const dp = Math.max(0, cur.pVol - was.pVol);
            if (!dc && !dp) continue;
            const cN = dc * cur.cPx * CONTRACT_MULTIPLIER;
            const pN = dp * cur.pPx * CONTRACT_MULTIPLIER;
            for (const b of BANDS) {
              if (distPct > b) continue;
              acc[b].callPrem += cN;
              acc[b].putPrem += pN;
              acc[b].callVol += dc;
              acc[b].putVol += dp;
              acc[b].strikes += 1;
            }
          }
        }

        const cum = prev?.cum ?? blankCum();
        for (const b of BANDS) {
          cum[b].call += acc[b].callPrem;
          cum[b].put += acc[b].putPrem;
          rows.push({
            date: day, symbol, slot, bandPct: b, minute, expiry, spot,
            callPrem: acc[b].callPrem, putPrem: acc[b].putPrem,
            callVol: acc[b].callVol, putVol: acc[b].putVol,
            cumCallPrem: cum[b].call, cumPutPrem: cum[b].put,
            strikes: acc[b].strikes, isBaseline,
          });
        }

        // Store only what the next delta needs — the price legs are re-read.
        const nextStrikes = new Map();
        for (const [k, v] of strikes) nextStrikes.set(k, { cVol: v.cVol, pVol: v.pVol });
        _state.set(key, { strikes: nextStrikes, cum });
      }
    }

    if (rows.length) await upsertIntraday(rows);
  } catch (e) {
    console.warn('[atm-prem-intraday] tick error:', e.message);
  } finally {
    _running = false;
  }
}

async function upsertIntraday(rows) {
  const p = getPool();
  if (!p || !rows.length) return 0;
  const client = await p.connect();
  try {
    await client.query('BEGIN');
    for (const r of rows) {
      // eslint-disable-next-line no-await-in-loop
      await client.query(
        `INSERT INTO atm_prem_intraday
           (date, symbol, slot, band_pct, minute, expiry, spot,
            call_prem, put_prem, call_vol, put_vol,
            cum_call_prem, cum_put_prem, strikes, is_baseline, src, ts)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16, now())
         ON CONFLICT (date, symbol, slot, band_pct, minute) DO UPDATE SET
           expiry = EXCLUDED.expiry, spot = EXCLUDED.spot,
           call_prem = EXCLUDED.call_prem, put_prem = EXCLUDED.put_prem,
           call_vol = EXCLUDED.call_vol, put_vol = EXCLUDED.put_vol,
           cum_call_prem = EXCLUDED.cum_call_prem, cum_put_prem = EXCLUDED.cum_put_prem,
           strikes = EXCLUDED.strikes, is_baseline = EXCLUDED.is_baseline,
           src = EXCLUDED.src, ts = now()`,
        [r.date, r.symbol, r.slot, r.bandPct, r.minute, r.expiry, r.spot,
         r.callPrem, r.putPrem, r.callVol, r.putVol,
         r.cumCallPrem, r.cumPutPrem, r.strikes, r.isBaseline, r.src || 'live'],
      );
    }
    await client.query('COMMIT');
    return rows.length;
  } catch (e) {
    try { await client.query('ROLLBACK'); } catch {}
    throw e;
  } finally {
    client.release();
  }
}

// ── Read ─────────────────────────────────────────────────────────────────────

/**
 * One session's minute buckets for the panel.
 * @param {object} opts
 * @param {string} opts.symbol
 * @param {number} [opts.bandPct]
 * @param {string} [opts.date] 'YYYY-MM-DD' or 'latest'
 */
async function getIntraday({ symbol, bandPct = 5, date = 'latest' } = {}) {
  const p = getPool();
  if (!p) return { rows: [], symbol, bandPct, error: 'no database' };
  await ensureIntradaySchema();
  const sym = String(symbol || 'SPY').trim().toUpperCase();
  const band = BANDS.includes(Number(bandPct)) ? Number(bandPct) : 5;

  let day = date;
  if (!day || day === 'latest') {
    const { rows } = await p.query(
      'SELECT MAX(date) AS d FROM atm_prem_intraday WHERE symbol = $1 AND band_pct = $2',
      [sym, band],
    );
    day = rows[0]?.d
      ? new Intl.DateTimeFormat('en-CA', { timeZone: 'UTC' }).format(rows[0].d)
      : todayYmdET();
  }

  const { rows } = await p.query(
    `SELECT minute, slot, expiry, spot, call_prem, put_prem, call_vol, put_vol,
            cum_call_prem, cum_put_prem, strikes, is_baseline, src
       FROM atm_prem_intraday
      WHERE symbol = $1 AND band_pct = $2 AND date = $3
      ORDER BY minute ASC, slot ASC`,
    [sym, band, day],
  );

  const byMinute = new Map();
  for (const r of rows) {
    const key = new Date(r.minute).toISOString();
    if (!byMinute.has(key)) {
      byMinute.set(key, { minute: key, spot: Number(r.spot) || 0, baseline: false, src: r.src || 'live', front: null, back: null });
    }
    const bucket = byMinute.get(key);
    if (r.is_baseline) bucket.baseline = true;
    const leg = {
      expiry: r.expiry,
      callPrem: Number(r.call_prem) || 0,
      putPrem: Number(r.put_prem) || 0,
      callVol: Number(r.call_vol) || 0,
      putVol: Number(r.put_vol) || 0,
      strikes: Number(r.strikes) || 0,
      // Same convention as the daily panel: POSITIVE = puts dominated.
      diff: (Number(r.put_prem) || 0) - (Number(r.call_prem) || 0),
      cumDiff: (Number(r.cum_put_prem) || 0) - (Number(r.cum_call_prem) || 0),
      cumCallPrem: Number(r.cum_call_prem) || 0,
      cumPutPrem: Number(r.cum_put_prem) || 0,
    };
    if (r.slot === 'front') bucket.front = leg; else bucket.back = leg;
  }

  return { symbol: sym, bandPct: band, bands: BANDS, date: day, rows: [...byMinute.values()] };
}

// ── Retention ────────────────────────────────────────────────────────────────

async function prune() {
  const p = getPool();
  if (!p) return;
  try {
    await p.query(
      `DELETE FROM atm_prem_intraday WHERE date < (CURRENT_DATE - ($1::int))`,
      [Math.max(5, RETAIN_DAYS)],
    );
  } catch (e) {
    console.warn('[atm-prem-intraday] prune failed:', e.message);
  }
}

// ── Scheduler ────────────────────────────────────────────────────────────────

let _timer = null;
let _pruneTimer = null;

function startAtmPremIntradayRecorder() {
  if (_timer) return;
  if (process.env.ATM_PREM_INTRADAY === '0') {
    console.log('[atm-prem-intraday] recorder disabled (ATM_PREM_INTRADAY=0)');
    return;
  }
  if (!SYMBOLS.length) return;

  _timer = setInterval(() => {
    tick().catch((e) => console.warn('[atm-prem-intraday] tick error:', e.message));
  }, INTERVAL_MS);
  if (_timer.unref) _timer.unref();
  // Behind the daily recorder's own boot stagger so a restart does not fire
  // every chain fetch in the process at the same instant.
  setTimeout(() => { tick().catch(() => {}); }, 55_000);

  _pruneTimer = setInterval(() => { prune().catch(() => {}); }, 6 * 3600_000);
  if (_pruneTimer.unref) _pruneTimer.unref();
  setTimeout(() => { prune().catch(() => {}); }, 120_000);

  console.log(
    `[atm-prem-intraday] recorder started — ${SYMBOLS.join('/')}, front+back monthly, ` +
    `bands ±${BANDS.join('/')}%, every ${INTERVAL_MS / 1000}s during RTH, ${RETAIN_DAYS}d retention`,
  );
}

module.exports = {
  startAtmPremIntradayRecorder,
  getIntraday,
  ensureIntradaySchema,
  upsertIntraday,
  isRthNowET,
  tick,
  snapshotChain,
  prune,
};
