'use strict';
/**
 * server-v2/daily-em.js — the DAILY expected-move band, computed once per ET
 * session and then FROZEN.
 *
 * ── Why this exists ──────────────────────────────────────────────────────────
 * The only expected move the product had was the WEEKLY one: `em_tracker` /
 * `/api/levels`, a row published once a week and evaluated against that week's
 * high and low. Every surface that says "±1σ (EM)" — the /em page, the Key
 * Levels axis, the GEX Chart's two EM tiles — is reading that weekly band.
 *
 * A day trader watching a 0DTE gamma ladder wants the band for TODAY, and it
 * has to behave like every other level on that chart: it is decided once and
 * then it does not move. A band recomputed on every poll would drift across the
 * session as the straddle decays, and a level that slides is not a level — you
 * cannot say "price rejected the EM high" about a line that was somewhere else
 * an hour ago.
 *
 * So: computed once, on the first read of the ET session date, written to
 * `daily_em`, and served from that row for the rest of the day. Every later
 * request — every client, every reload, every tab — gets the identical three
 * numbers. Only an explicit owner POST ?force=1 recomputes.
 *
 * ── What the band IS ─────────────────────────────────────────────────────────
 *   magnitude  the FRONT expiry's ATM straddle, read off the live TastyTrade
 *              chain. Same arithmetic /api/social-media/daily-input already
 *              uses for its `expectedMove`, transcribed rather than re-derived:
 *
 *                dte > 0   0.84 × avgIV × spot × √(dte / 365)
 *                dte = 0   (callMid + putMid) × 0.85
 *
 *              The 0DTE branch is the one that matters here — on an SPX session
 *              the front expiry IS today, there is no √t left to price, and the
 *              straddle's own premium is the market's number for the day.
 *
 *   anchor     the PREVIOUS SESSION'S CLOSE, not spot. That is the definition
 *              Brandon asked for and it is also the only one that can be frozen
 *              honestly: an anchor of "spot at the moment somebody first opened
 *              the board" would make the band depend on who loaded the page
 *              first and when.
 *
 *              up = refClose + em,  down = refClose − em.
 *
 * ── The one caveat, stated out loud ──────────────────────────────────────────
 * The row is written on the FIRST read of the session, whenever that happens.
 * Read at 07:30 ET it is priced off the premarket book; read for the first time
 * at 14:00 it is priced off a straddle that has already burned half its value,
 * and the band will be too tight. In practice the board is open long before the
 * bell and the 07:00-09:30 read is the one that lands. When it is not, POST
 * ?force=1 rewrites the row — which is also what makes a bad read fixable
 * instead of permanent.
 *
 * ── Ownership ────────────────────────────────────────────────────────────────
 * This module owns its table and creates it on first use through libDb.pgQuery,
 * NOT through _lib-db.cjs's ensureAllTables — that file is an esbuild bundle of
 * lib/db.ts and hand-editing a build artifact is how the bundle and its source
 * drift apart. Same pattern cb-contract-track.js uses for its own tables.
 *
 * Loaded defensively by api-router.js: no DB bundle, no route, and nothing else
 * in the file changes behaviour.
 */

let libDb = null;
try { libDb = require('./_lib-db.cjs'); }
catch (e) { console.warn('[daily-em] _lib-db.cjs not loaded — daily EM disabled:', e.message); }

/** Sanity gate on a computed band, as a fraction of the anchor. */
const MIN_EM_PCT = 0.0015;
const MAX_EM_PCT = 0.25;
/** How many strikes either side of the money to try before giving up. */
const ATM_TRIES = 8;

const num = (v) => { const x = Number(v); return Number.isFinite(x) ? x : null; };
const pos = (v) => { const x = num(v); return x != null && x > 0 ? x : null; };

/** ET calendar date, YYYY-MM-DD. The session key the band is filed under. */
function etDate(d = new Date()) {
  const p = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(d).filter((x) => x.type !== 'literal')
    .reduce((a, x) => ({ ...a, [x.type]: x.value }), {});
  return `${p.year}-${p.month}-${p.day}`;
}

let ensured = null;
/** CREATE TABLE IF NOT EXISTS, once per process. */
async function ensureTable() {
  if (!libDb) throw new Error('no db');
  if (!ensured) {
    ensured = libDb.pgQuery(`
      CREATE TABLE IF NOT EXISTS daily_em (
        ticker       TEXT NOT NULL,
        session_date TEXT NOT NULL,
        ref_close    REAL NOT NULL,
        em           REAL NOT NULL,
        up           REAL NOT NULL,
        down         REAL NOT NULL,
        expiry       TEXT,
        method       TEXT,
        recorded_at  BIGINT NOT NULL,
        PRIMARY KEY (ticker, session_date)
      );
    `).catch((err) => { ensured = null; throw err; });
  }
  return ensured;
}

/**
 * The TastyTrade chain, flattened to legs. A local copy of api-router's
 * smFlattenChain rather than an import: that function is a module-level const
 * inside an 800KB file with no exports, and this module is required defensively
 * — reaching back into it would couple the two in the one direction the
 * defensive require exists to avoid.
 */
function flattenChain(json) {
  const root = json ?? {};
  const data = root.data ?? root;
  const items = Array.isArray(data.items) ? data.items : [];
  const legs = [];
  for (const grp of items) {
    const expiration = String(grp['expiration-date'] ?? grp.expirationDate ?? grp.expiration ?? '');
    const strikes = Array.isArray(grp.strikes) ? grp.strikes : [];
    for (const row of strikes) {
      const strike = Number(row['strike-price'] ?? row.strikePrice ?? row.strike ?? 0);
      if (!(strike > 0)) continue;
      for (const side of ['call', 'put']) {
        const leg = row[side];
        if (!leg) continue;
        legs.push({
          strike,
          type: side.toUpperCase(),
          bid: Number(leg.bid ?? leg['bid-price'] ?? 0),
          ask: Number(leg.ask ?? leg['ask-price'] ?? 0),
          mark: Number(leg.mark ?? leg['mark-price'] ?? leg['mid-price'] ?? 0),
          last: Number(leg.last ?? leg['last-price'] ?? 0),
          iv: Number(leg.iv ?? leg['implied-volatility'] ?? leg.volatility ?? 0),
          dte: Number(leg.dte ?? leg.daysToExpiration ?? 0),
          expiration,
        });
      }
    }
  }
  const underlying = Number(data.underlyingPrice ?? data.underlying_price ?? root.underlyingPrice ?? 0);
  return { legs, underlying };
}

/** Mid, falling back the way the rest of the codebase falls back. */
function legMid(o) {
  if (o.bid > 0 && o.ask > 0) return (o.bid + o.ask) / 2;
  if (o.mark > 0) return o.mark;
  if (o.last > 0) return o.last;
  return 0;
}

/** Previous session close for a symbol, from whichever source carries one. */
async function fetchRefClose(ctx, ticker) {
  // SPX first through the live in-memory GEX feed — it carries `prevClose`
  // directly and it is the number every other SPX surface calls the prior
  // close, so the band cannot be anchored one tick away from Key Levels.
  if (ticker === 'SPX') {
    try {
      const r = await ctx.internalFetch('/proxy/gex', { cache: 'no-store' });
      if (r.ok) {
        const p = await r.json();
        const pc = pos(p.prevClose);
        if (pc) return { refClose: pc, refSource: 'gex-feed' };
      }
    } catch { /* fall through to the quote */ }
  }
  try {
    const r = await ctx.internalFetch(`/api/tt-quotes?symbols=${encodeURIComponent(ticker)}`, { cache: 'no-store' });
    if (r.ok) {
      const j = await r.json();
      const items = j?.data?.items ?? j?.items ?? j?.data ?? [];
      const list = Array.isArray(items) ? items : [];
      const it = list.find((x) => String(x?.symbol ?? '').toUpperCase() === ticker) ?? list[0] ?? null;
      if (it) {
        const pc = pos(it.prevClose) ?? pos(it['prev-close']) ?? pos(it.previousClose)
          ?? pos(it['previous-close']) ?? pos(it['close-price']) ?? pos(it.close);
        if (pc) return { refClose: pc, refSource: 'quote' };
      }
    }
  } catch { /* fall through to the published weekly row */ }
  // Last resort: the published weekly levels row carries the close it was
  // built from. Stale by up to a week, so it is the rung of last resort and it
  // says so in `refSource` rather than pretending to be today's.
  try {
    const r = await ctx.internalFetch(`/api/levels?ticker=${encodeURIComponent(ticker)}`, { cache: 'no-store' });
    if (r.ok) {
      const j = await r.json();
      const pc = pos(typeof j?.close === 'string' ? j.close.replace(/,/g, '') : j?.close);
      if (pc) return { refClose: pc, refSource: 'levels-row' };
    }
  } catch { /* nothing left */ }
  return { refClose: null, refSource: null };
}

/**
 * The FRONT expiry's ATM straddle, as a ±1σ magnitude.
 *
 * The nearest expiration only — that is what makes this the DAILY move and not
 * the weekly one. `/api/social-media/daily-input`'s computeExpectedMove walks
 * every DTE until one answers; this deliberately does not, because an SPX
 * session whose 0DTE book is momentarily unquotable should report "no band
 * yet" rather than silently hand back next Friday's.
 */
async function fetchEmMagnitude(ctx, ticker, center) {
  const r = await ctx.internalFetch(`/proxy/api/tt/chains/${encodeURIComponent(ticker)}`, { cache: 'no-store' });
  if (!r.ok) return { em: null, expiry: null, method: null, spot: 0 };
  const { legs, underlying } = flattenChain(await r.json());
  if (!legs.length) return { em: null, expiry: null, method: null, spot: underlying };
  // Price the straddle at the LIVE underlying when there is one — an ATM
  // strike picked around a stale anchor is not the at-the-money strike.
  const mid = underlying > 0 ? underlying : center;
  if (!(mid > 0)) return { em: null, expiry: null, method: null, spot: underlying };

  const byExp = new Map();
  for (const l of legs) {
    if (!l.expiration) continue;
    if (!byExp.has(l.expiration)) byExp.set(l.expiration, []);
    byExp.get(l.expiration).push(l);
  }
  const front = [...byExp.keys()].sort()[0];
  const pool = front ? byExp.get(front) : null;
  if (!pool || !pool.length) return { em: null, expiry: null, method: null, spot: underlying };

  const strikes = [...new Set(pool.map((l) => l.strike))]
    .sort((a, b) => Math.abs(a - mid) - Math.abs(b - mid))
    .slice(0, ATM_TRIES);
  for (const k of strikes) {
    const c = pool.find((l) => l.strike === k && l.type === 'CALL');
    const p = pool.find((l) => l.strike === k && l.type === 'PUT');
    if (!c || !p) continue;
    const avgIV = (Number(c.iv || 0) + Number(p.iv || 0)) / 2;
    const dte = Number(c.dte || p.dte || 0);
    let em = 0;
    let method = null;
    if (avgIV > 0 && dte > 0) {
      em = 0.84 * avgIV * mid * Math.sqrt(dte / 365);
      method = 'iv';
    } else {
      const cMid = legMid(c);
      const pMid = legMid(p);
      if (cMid > 0 && pMid > 0) { em = (cMid + pMid) * 0.85; method = 'straddle'; }
    }
    if (!Number.isFinite(em) || !(em > 0)) continue;
    const pct = em / mid;
    if (pct < MIN_EM_PCT || pct > MAX_EM_PCT) continue;
    return { em, expiry: front, method, spot: underlying };
  }
  return { em: null, expiry: front ?? null, method: null, spot: underlying };
}

/** Compute today's band without touching the table. Null when it cannot. */
async function computeDailyEm(ctx, ticker) {
  const [{ refClose, refSource }, mag] = await Promise.all([
    fetchRefClose(ctx, ticker),
    // Centre the ATM search on the live underlying; 0 lets fetchEmMagnitude
    // fall back to the chain's own underlyingPrice, which is the same number.
    fetchEmMagnitude(ctx, ticker, 0),
  ]);
  if (!refClose || !mag.em) return null;
  return {
    ticker,
    refClose,
    refSource,
    em: mag.em,
    up: refClose + mag.em,
    down: refClose - mag.em,
    expiry: mag.expiry,
    method: mag.method,
  };
}

const shape = (row) => ({
  ticker: row.ticker,
  date: row.session_date,
  refClose: num(row.ref_close),
  em: num(row.em),
  up: num(row.up),
  down: num(row.down),
  expiry: row.expiry ?? null,
  method: row.method ?? null,
  recordedAt: num(row.recorded_at),
});

/** The recorded row for one ticker and session date, or null. */
async function readDailyEm(ticker, date) {
  await ensureTable();
  const row = await libDb.queryOne(
    'SELECT * FROM daily_em WHERE ticker = ? AND session_date = ? LIMIT 1',
    [ticker, date],
  );
  return row ? shape(row) : null;
}

/**
 * Write the band for a session date.
 *
 * `force` is what makes it an UPSERT instead of an insert-if-absent. Without
 * it a second caller racing the first simply loses and reads the winner's row,
 * which is the whole point: whichever request got there first defines the day.
 */
async function writeDailyEm(band, date, force) {
  await ensureTable();
  const args = [
    band.ticker, date, band.refClose, band.em, band.up, band.down,
    band.expiry ?? null, band.method ?? null, Date.now(),
  ];
  const conflict = force
    ? `DO UPDATE SET ref_close = EXCLUDED.ref_close, em = EXCLUDED.em, up = EXCLUDED.up,
         down = EXCLUDED.down, expiry = EXCLUDED.expiry, method = EXCLUDED.method,
         recorded_at = EXCLUDED.recorded_at`
    : 'DO NOTHING';
  await libDb.pgQuery(
    `INSERT INTO daily_em
       (ticker, session_date, ref_close, em, up, down, expiry, method, recorded_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
     ON CONFLICT (ticker, session_date) ${conflict}`,
    args,
  );
  return readDailyEm(band.ticker, date);
}

/**
 * The route's whole job: serve the frozen row, and be the one that freezes it
 * if nobody has yet.
 *
 * A failed compute NEVER clears an existing row — a chain that goes unquotable
 * at lunchtime must not take the morning's band off the chart with it.
 */
async function getOrRecord(ctx, ticker, opts = {}) {
  const date = opts.date || etDate();
  const force = opts.force === true;
  if (!force) {
    const existing = await readDailyEm(ticker, date);
    if (existing) return { band: existing, fresh: false };
  }
  // A past session that was never recorded cannot be reconstructed from a live
  // chain, so do not try — say so instead of writing today's straddle under
  // yesterday's date.
  if (date !== etDate()) return { band: await readDailyEm(ticker, date), fresh: false };

  const computed = await computeDailyEm(ctx, ticker);
  if (!computed) return { band: force ? await readDailyEm(ticker, date) : null, fresh: false };
  return { band: await writeDailyEm(computed, date, force), fresh: true };
}

module.exports = {
  etDate,
  ensureTable,
  computeDailyEm,
  readDailyEm,
  getOrRecord,
  /** Exported for the selftest — not used by the route. */
  _internals: { flattenChain, legMid, MIN_EM_PCT, MAX_EM_PCT },
};
