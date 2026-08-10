'use strict';
/**
 * server-v2/roster-store.js
 *
 * ONE runtime-editable layer over the three CB Edge ticker rosters.
 *
 * WHY THIS EXISTS
 *   scanner-tickers.js / em-tickers.js / far-cb-tickers.js are hardcoded arrays
 *   evaluated once at require time. Changing the scanner universe meant editing
 *   a file, committing, and waiting for a Docker rebuild — and every consumer
 *   bound its copy at module load, so even an env override only moved SOME of
 *   them (the /proxy/scanner-tickers endpoint re-read process.env per request
 *   while the recorders did not, which silently split the UI from the sweeps).
 *
 * WHAT THIS DOES
 *   The files above stay the BASELINE — the thing you get with an empty DB, and
 *   still the right place for a permanent, reviewed change. On top of them this
 *   module keeps a small table of per-symbol OVERRIDES:
 *
 *     roster_overrides(list, symbol, action, bucket, created_at)
 *       action='add'    -> symbol belongs in `bucket` (also acts as a MOVE when
 *                          the symbol already exists in a different baseline
 *                          bucket: the resolver drops it from the old one)
 *       action='remove' -> symbol is stripped from every bucket of that list
 *
 *   One row per (list, symbol): adding clears a prior remove and vice versa, so
 *   the table never holds a contradiction.
 *
 * LIVE, NOT ON RESTART
 *   Resolution is cached in-process for CACHE_TTL_MS and the cache is version-
 *   bumped on every write, so a change made from the owner Watchlists page is
 *   picked up by the next sweep of each recorder rather than the next deploy.
 *   Consumers should call getSymbols()/getRoster() per sweep, NOT destructure a
 *   const at module load. `change` is emitted after every successful write for
 *   consumers that want to react immediately (strike-growth reconciles on it).
 *
 * FAIL-SOFT
 *   No DATABASE_URL, dead pool, bad query — every path falls back to the static
 *   baseline. A roster is never empty because Postgres hiccuped, and `live:false`
 *   on the payload tells the owner page it is looking at the file, not the DB.
 *
 * Owner surface: GET /proxy/rosters, POST /proxy/roster, POST /proxy/roster-reset
 *                (see server-with-proxy.js — writes are owner-only via proxy-auth)
 */

const { EventEmitter } = require('events');

const scannerBase = require('./scanner-tickers');
const emBase = require('./em-tickers');
const farCbBase = require('./far-cb-tickers');

const CACHE_TTL_MS = Number(process.env.ROSTER_CACHE_TTL_MS || 15_000);

const events = new EventEmitter();
events.setMaxListeners(50);

// ── Baseline registry ────────────────────────────────────────────────────────
//
// `buckets` is ordered — the order here is the order the owner page renders and
// the order strike-growth writes sort_idx in. `hot` marks the bucket that gets
// the fast-lane sweep (scanner MAIN only).

const up = (s) => String(s || '').trim().toUpperCase();
const uniq = (a) => [...new Set(a)];

const LISTS = {
  scanner: {
    id: 'scanner',
    label: 'Scanner Universe',
    source: 'server-v2/scanner-tickers.js',
    blurb:
      'Drives the /scanner tabs (GEX Scanner, Strike Query, GEX%), the oi-daily recorder, ' +
      'the strike-growth sweep and FLOW_TICKERS=SCANNER. MAIN is the 2-minute hot lane; ' +
      'everything else sweeps every 5 minutes.',
    buckets: [
      { id: 'MAIN', label: 'MAIN', note: 'Hot lane — 2-minute sweeps', hot: true, base: () => scannerBase.MAIN },
      { id: 'SHARES', label: 'SHARES', note: 'Single-name shares bucket', base: () => scannerBase.SHARES },
      { id: 'SPREADS', label: 'SPREADS', note: 'Spread candidates', base: () => scannerBase.SPREADS },
      { id: 'OPTVOL', label: 'OPTVOL', note: 'Option-volume leaders not already covered above', base: () => scannerBase.OPTVOL },
    ],
  },
  em: {
    id: 'em',
    label: 'EM Roster',
    source: 'server-v2/em-tickers.js',
    blurb:
      'Estimated-Moves roster behind the customer-facing /em levels page, and the flow tape ' +
      'while FLOW_TICKERS=EM. A name without a weekly expiration cannot produce a one-week EM ' +
      'and will sit in failedEm forever — check the chain before adding.',
    buckets: [
      { id: 'SPECIAL', label: 'SPECIAL', note: 'Futures + cash indices (aliased in levels-engine)', base: () => emBase.SPECIAL_TICKERS },
      { id: 'EQUITY', label: 'EQUITY', note: 'Optionable equities and ETFs', base: () => emBase.EQUITY_TICKERS },
      { id: 'ZONE', label: 'ZONE', note: 'Buy/Sell zones pre-published weekly', base: () => emBase.ZONE_SYMBOLS, overlay: true },
    ],
  },
  farcb: {
    id: 'farcb',
    label: 'Far-CB Core',
    source: 'server-v2/far-cb-tickers.js',
    blurb:
      'CORE_TICKERS for the Far CB Watch scanner — flags names whose highest OI+Vol GEX strike ' +
      'within 30 days sits further than OTM_THRESHOLD_PCT from spot. Customer-added tickers ' +
      '(far_cb_custom_tickers) stack on top of this and are not editable here.',
    buckets: [
      { id: 'CORE', label: 'CORE', note: 'Far-CB core roster', base: () => farCbBase.CORE_TICKERS },
    ],
  },
};

/** Bucket ids that are OVERLAYS — a symbol may sit here AND in another bucket
 * of the same list (EM ZONE re-lists index/ETF names that are already SPECIAL
 * or EQUITY). Overlay buckets are excluded from the "already in bucket X"
 * duplicate check and from move semantics. */
function isOverlay(list, bucketId) {
  return !!(LISTS[list]?.buckets || []).find((b) => b.id === bucketId)?.overlay;
}

const LIST_IDS = Object.keys(LISTS);
const isKnownList = (l) => Object.prototype.hasOwnProperty.call(LISTS, l);
const bucketIds = (list) => (LISTS[list]?.buckets || []).map((b) => b.id);

// ── PG pool (same defensive shape as the recorders) ──────────────────────────

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
      console.warn('[roster] pool error (will reconnect):', e.message);
      try { pool?.end().catch(() => {}); } catch {}
      pool = null; ensured = false;
    });
    return pool;
  } catch (e) {
    console.error('[roster] pg unavailable:', e.message);
    pgUnavailable = true; return null;
  }
}

async function ensureSchema() {
  const p = getPool();
  if (!p) return false;
  if (ensured) return true;
  try {
    await p.query(`
      CREATE TABLE IF NOT EXISTS roster_overrides (
        list       TEXT        NOT NULL,
        symbol     TEXT        NOT NULL,
        action     TEXT        NOT NULL,
        bucket     TEXT        NOT NULL DEFAULT '',
        note       TEXT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        PRIMARY KEY (list, symbol)
      );
      CREATE INDEX IF NOT EXISTS idx_roster_overrides_list ON roster_overrides(list);
    `);
    ensured = true;
    return true;
  } catch (e) {
    console.error('[roster] ensureSchema error:', e.message);
    return false;
  }
}

// ── Resolution ───────────────────────────────────────────────────────────────

/** list -> { at, payload } */
const cache = new Map();
let version = 0;

function baselineBuckets(list) {
  return (LISTS[list].buckets).map((b) => ({
    id: b.id,
    label: b.label,
    note: b.note,
    hot: !!b.hot,
    overlay: !!b.overlay,
    symbols: uniq((b.base() || []).map(up).filter(Boolean)),
  }));
}

/**
 * Apply override rows to the baseline. Pure — no IO — so the same code path
 * serves the DB result, the empty-DB fallback and the unit-testable case.
 */
function resolve(list, rows) {
  const buckets = baselineBuckets(list);
  const removed = new Set();
  const moved = new Map(); // symbol -> target bucket id

  for (const r of rows || []) {
    const sym = up(r.symbol);
    if (!sym) continue;
    if (r.action === 'remove') removed.add(sym);
    else if (r.action === 'add') moved.set(sym, String(r.bucket || '').toUpperCase());
  }

  for (const b of buckets) {
    b.symbols = b.symbols.filter((s) => {
      if (removed.has(s)) return false;
      // An `add` naming a DIFFERENT bucket is a move: drop it from the old one.
      // Overlay buckets (EM ZONE) are exempt in BOTH directions — a symbol
      // legitimately lives in both ZONE and EQUITY, so neither a move between
      // the real buckets nor an add into ZONE may empty the other.
      if (!b.overlay && moved.has(s) && moved.get(s) !== b.id && !isOverlay(list, moved.get(s))) return false;
      return true;
    });
  }

  for (const [sym, target] of moved) {
    if (removed.has(sym)) continue;
    const b = buckets.find((x) => x.id === target);
    if (!b) continue;                       // stale bucket id — ignore, don't throw
    if (!b.symbols.includes(sym)) b.symbols.push(sym);
  }

  const symbols = uniq(buckets.flatMap((b) => b.symbols));
  const hot = uniq(buckets.filter((b) => b.hot).flatMap((b) => b.symbols));
  return { buckets, symbols, hot };
}

async function loadRows(list) {
  if (!(await ensureSchema())) return null;
  const p = getPool();
  if (!p) return null;
  try {
    const { rows } = await p.query(
      `SELECT symbol, action, bucket, note, created_at
         FROM roster_overrides
        WHERE list = $1
        ORDER BY created_at ASC`,
      [list]
    );
    return rows;
  } catch (e) {
    console.warn(`[roster] override fetch failed for ${list}, using baseline:`, e.message);
    return null;
  }
}

function pack(list, rows, live) {
  const meta = LISTS[list];
  const { buckets, symbols, hot } = resolve(list, rows);
  return {
    id: meta.id,
    label: meta.label,
    source: meta.source,
    blurb: meta.blurb,
    editable: true,
    live,
    version,
    buckets,
    symbols,
    hot,
    overrides: (rows || []).map((r) => ({
      symbol: up(r.symbol),
      action: r.action,
      bucket: r.bucket || '',
      note: r.note || '',
      createdAt: r.created_at || null,
    })),
  };
}

/**
 * Resolved roster for one list. Cached CACHE_TTL_MS; a write invalidates
 * immediately. Falls back to the file baseline whenever Postgres can't answer.
 */
async function getRoster(list) {
  if (!isKnownList(list)) throw new Error(`unknown roster: ${list}`);
  const hit = cache.get(list);
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.payload;

  const rows = await loadRows(list);
  const payload = pack(list, rows, rows !== null);
  cache.set(list, { at: Date.now(), payload });
  return payload;
}

/** Every list, resolved. Used by GET /proxy/rosters and by primeRosters(). */
async function getAllRosters() {
  const out = {};
  for (const id of LIST_IDS) {
    out[id] = await getRoster(id); // eslint-disable-line no-await-in-loop
  }
  return out;
}

/** De-duped symbol array for one list. The call every recorder should make. */
async function getSymbols(list) {
  return (await getRoster(list)).symbols;
}

/** Fast-lane subset (scanner MAIN). Empty for lists with no hot bucket. */
async function getHotSymbols(list) {
  return (await getRoster(list)).hot;
}

/**
 * Last resolved value with NO await — for the handful of call sites that are
 * synchronous by contract (module-load defaults, a constructor). Returns the
 * file baseline until the first async resolve lands, so it is always usable and
 * never wrong in a dangerous direction (it under-reports edits, never invents).
 */
function getSymbolsSync(list) {
  if (!isKnownList(list)) return [];
  const hit = cache.get(list);
  if (hit) return hit.payload.symbols;
  return resolve(list, null).symbols;
}

function getHotSymbolsSync(list) {
  if (!isKnownList(list)) return [];
  const hit = cache.get(list);
  if (hit) return hit.payload.hot;
  return resolve(list, null).hot;
}

function invalidate(list) {
  version += 1;
  if (list) cache.delete(list); else cache.clear();
}

// ── Writes ───────────────────────────────────────────────────────────────────

/**
 * @param {object} edit
 * @param {string} edit.list    'scanner' | 'em' | 'farcb'
 * @param {string} edit.action  'add' | 'remove' | 'move'
 * @param {string} edit.symbol
 * @param {string} [edit.bucket] required for add/move
 * @param {string} [edit.note]
 * @returns {Promise<{ok:boolean, error?:string, roster?:object}>}
 */
async function applyEdit({ list, action, symbol, bucket, note } = {}) {
  if (!isKnownList(list)) return { ok: false, error: `unknown list "${list}"` };

  const act = String(action || '').toLowerCase();
  const sym = up(symbol);
  if (!sym) return { ok: false, error: 'symbol required' };
  // Roots only: letters, digits and the handful of separators the feeds use
  // (BRK.B / BRK/B, $-prefixed index feeds on the TT market-indicator lists).
  if (!/^[A-Z0-9$][A-Z0-9./-]{0,11}$/.test(sym)) {
    return { ok: false, error: `"${sym}" does not look like a ticker root` };
  }

  if (!(await ensureSchema())) {
    return { ok: false, error: 'no database — roster edits need DATABASE_URL' };
  }
  const p = getPool();
  if (!p) return { ok: false, error: 'no database' };

  const current = await getRoster(list);

  try {
    if (act === 'remove') {
      // Removing something that only exists as an override = just drop the row
      // and let it fall back to the baseline (which does not contain it).
      const inBaseline = resolve(list, null).symbols.includes(sym);
      if (inBaseline) {
        await p.query(
          `INSERT INTO roster_overrides (list, symbol, action, bucket, note)
           VALUES ($1, $2, 'remove', '', $3)
           ON CONFLICT (list, symbol)
           DO UPDATE SET action = 'remove', bucket = '', note = EXCLUDED.note, created_at = NOW()`,
          [list, sym, note || null]
        );
      } else {
        await p.query(`DELETE FROM roster_overrides WHERE list = $1 AND symbol = $2`, [list, sym]);
      }
    } else if (act === 'add' || act === 'move') {
      const target = String(bucket || '').toUpperCase();
      if (!bucketIds(list).includes(target)) {
        return { ok: false, error: `bucket must be one of ${bucketIds(list).join(', ')}` };
      }
      if (act === 'add') {
        if (isOverlay(list, target)) {
          // Overlay bucket (EM ZONE): only a duplicate WITHIN that bucket is an
          // error — living in EQUITY as well is the normal case.
          const b = current.buckets.find((x) => x.id === target);
          if (b && b.symbols.includes(sym)) return { ok: false, error: `${sym} is already in ${target}` };
        } else {
          const where = current.buckets.find((b) => !b.overlay && b.symbols.includes(sym));
          if (where) {
            return {
              ok: false,
              error: where.id === target
                ? `${sym} is already in ${target}`
                : `${sym} is already in ${where.id} — use move instead`,
            };
          }
        }
      }
      await p.query(
        `INSERT INTO roster_overrides (list, symbol, action, bucket, note)
         VALUES ($1, $2, 'add', $3, $4)
         ON CONFLICT (list, symbol)
         DO UPDATE SET action = 'add', bucket = EXCLUDED.bucket, note = EXCLUDED.note, created_at = NOW()`,
        [list, sym, target, note || null]
      );
    } else {
      return { ok: false, error: `unknown action "${action}"` };
    }
  } catch (e) {
    console.error('[roster] write failed:', e.message);
    return { ok: false, error: String(e.message || e) };
  }

  invalidate(list);
  const roster = await getRoster(list);
  console.log(`[roster] ${list}: ${act} ${sym}${bucket ? ` -> ${String(bucket).toUpperCase()}` : ''} (now ${roster.symbols.length} symbols)`);
  events.emit('change', { list, action: act, symbol: sym, bucket: bucket || '', roster });
  return { ok: true, roster };
}

/** Drop overrides for a list (or one symbol), reverting to the file baseline. */
async function resetOverrides({ list, symbol } = {}) {
  if (!isKnownList(list)) return { ok: false, error: `unknown list "${list}"` };
  if (!(await ensureSchema())) return { ok: false, error: 'no database' };
  const p = getPool();
  if (!p) return { ok: false, error: 'no database' };
  try {
    const sym = symbol ? up(symbol) : null;
    const r = sym
      ? await p.query(`DELETE FROM roster_overrides WHERE list = $1 AND symbol = $2`, [list, sym])
      : await p.query(`DELETE FROM roster_overrides WHERE list = $1`, [list]);
    invalidate(list);
    const roster = await getRoster(list);
    console.log(`[roster] ${list}: reset ${sym || 'ALL'} — ${r.rowCount} override(s) dropped`);
    events.emit('change', { list, action: 'reset', symbol: sym || '', bucket: '', roster });
    return { ok: true, cleared: r.rowCount, roster };
  } catch (e) {
    return { ok: false, error: String(e.message || e) };
  }
}

/**
 * Resolve every list once at boot so the synchronous accessors are warm before
 * the recorders take their first pass. Never throws.
 */
async function primeRosters() {
  try {
    const all = await getAllRosters();
    const parts = LIST_IDS.map((id) => `${id}=${all[id].symbols.length}${all[id].live ? '' : ' (baseline)'}`);
    console.log(`[roster] primed — ${parts.join(', ')}`);
    return all;
  } catch (e) {
    console.warn('[roster] prime failed (baselines still serve):', e.message);
    return null;
  }
}

module.exports = {
  LISTS, LIST_IDS,
  getRoster, getAllRosters, getSymbols, getHotSymbols,
  getSymbolsSync, getHotSymbolsSync,
  applyEdit, resetOverrides, resetRoster: resetOverrides,
  primeRosters, invalidate, ensureSchema, events,
  // exported for tests / the selftest harness
  resolve, bucketIds,
};
