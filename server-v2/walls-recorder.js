'use strict';
/**
 * server-v2/walls-recorder.js
 *
 * WALLS — call wall / put wall / CB (Core Bullseye) tracking across the whole
 * scanner universe, recorded on a fixed clock and stored change-only.
 *
 * Cadence (ET, trading days only):
 *   slot 0      09:29   open baseline — always writes all three levels
 *   slot 1..26  09:45, 10:00, 10:15 … 16:00 — writes ONLY what changed
 *
 * 168 tickers × 3 levels × 27 slots = 4,536 rows/day if we wrote everything.
 * Change-only keeps a normal session near ~250 rows, and the read side can
 * still reconstruct the full state at any slot by carrying the last value
 * forward, because slot 0 pins the baseline.
 *
 * SOURCE — scanner_snapshots, written every 5m by scanner-recorder.js for the
 * same universe (call_wall / put_wall / cb / spot). This recorder never touches
 * Theta or the stream: it samples the most recent scanner row per symbol at
 * each slot. That means a slot is only as fresh as the last scanner sweep
 * (≤5m), which is well inside a 15m grid.
 *
 * TWO TABLES, on purpose:
 *   walls_log    one row per level SET or CHANGE. Immutable once written.
 *   wall_events  one row per level TOUCH. Written open at the touch, then
 *                resolved with a reaction 4 slots later — a hit is not
 *                classifiable at the moment it happens.
 *
 * Reactions: reject | break_lt5 | break_5 | consolidated | new_wall | pin.
 *
 * Wiring:      startWallsRecorder() in server-with-proxy.js
 * Read API:    GET  /proxy/walls[?date=&symbol=]
 * Manual fire: POST /proxy/walls-run   { slot?: number, force?: true }
 */

// ── Tunables ─────────────────────────────────────────────────────────────────

/** Slot 0 fires at 09:29 ET; the 15m grid starts at 09:45 and ends at 16:00. */
const OPEN_SLOT_MINS = 9 * 60 + 29;
const GRID_START_MINS = 9 * 60 + 45;
const GRID_END_MINS = 16 * 60;
const SLOT_STEP = 15;
// slot 0 = the open capture, then one slot per point on the inclusive
// 09:45…16:00 grid → 1 + 26 = 27 captures a session.
const SLOT_COUNT = 1 + (GRID_END_MINS - GRID_START_MINS) / SLOT_STEP + 1; // 27

/** How long after a slot's clock time we still accept the write (restarts). */
const SLOT_GRACE_MINS = 5;
/** Scheduler heartbeat — cheap, the slot key dedupes actual work. */
const CHECK_MS = 30_000;
/** A scanner row older than this is not a valid sample for the slot. */
const MAX_SAMPLE_AGE_MINS = 12;

/** Touch band: spot within this fraction of the level counts as a tag. */
const TOUCH_PCT = 0.0005; // 0.05%
/**
 * Approach band — six times the touch band. Price inside this but never inside
 * TOUCH_PCT is "got close and didn't tag", which is the coil-and-roll-over case
 * that produced no record at all before. Wide enough to catch a real approach,
 * tight enough that it is not just "somewhere in the day's range".
 */
const APPROACH_PCT = 0.003; // 0.30%
/**
 * "Broke by 5 points" generalised. Index-scale names (strike ≥ 1000) use the
 * literal 5pt floor Brandon asked for; single names scale by price so a $40
 * stock isn't required to move 5 points to count as a real break.
 */
function breakThreshold(strike) {
  const k = Math.abs(Number(strike) || 0);
  return k >= 1000 ? Math.max(5, k * 0.0008) : k * 0.0015;
}
/** A fade of this much (fraction of strike) back inside makes it a reject. */
const REJECT_REVERSE_PCT = 0.0015; // 0.15%
/** Tail range this tight (fraction of strike) while outside = consolidation. */
const CONSOLIDATION_RANGE_PCT = 0.001; // 0.10%
/** Consecutive samples required for pin / consolidation calls. */
const HOLD_SAMPLES = 3;
/** Slots to wait before an open event must be classified. */
const RESOLVE_SLOTS = 4;

const LEVEL_TYPES = ['call_wall', 'put_wall', 'cb'];

// Keep in sync with scanner-recorder.js / gex-levels-history-recorder.js
const MARKET_HOLIDAYS = new Set([
  '2026-01-01', '2026-01-19', '2026-02-16', '2026-04-03', '2026-05-25',
  '2026-06-19', '2026-07-03', '2026-09-07', '2026-11-26', '2026-12-25',
  '2027-01-01', '2027-01-18', '2027-02-15', '2027-03-26', '2027-05-31',
  '2027-06-18', '2027-07-05', '2027-09-06', '2027-11-25', '2027-12-24',
]);

// ── PG pool (same lazy, no-DB-safe pattern as scanner-recorder.js) ───────────

let pool = null;
let pgUnavailable = false;
let _schemaReady = false;

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
      console.warn('[walls] pool error (will reconnect):', e.message);
      try { pool?.end().catch(() => {}); } catch {}
      pool = null; _schemaReady = false;
    });
    return pool;
  } catch (e) {
    console.error('[walls] pg unavailable:', e.message);
    pgUnavailable = true; return null;
  }
}

async function ensureSchema() {
  const p = getPool();
  if (!p) return false;
  if (_schemaReady) return true;
  try {
    await p.query(`
      CREATE TABLE IF NOT EXISTS walls_log (
        id          BIGSERIAL PRIMARY KEY,
        date        DATE        NOT NULL,
        ts          TIMESTAMPTZ NOT NULL,
        slot        SMALLINT    NOT NULL,
        symbol      TEXT        NOT NULL,
        level_type  TEXT        NOT NULL,
        strike      DOUBLE PRECISION NOT NULL,
        prev_strike DOUBLE PRECISION,
        delta       DOUBLE PRECISION,
        spot        DOUBLE PRECISION NOT NULL,
        gex_value   DOUBLE PRECISION,
        reason      TEXT NOT NULL DEFAULT 'change',
        UNIQUE (date, symbol, level_type, slot)
      );
      CREATE INDEX IF NOT EXISTS walls_log_day ON walls_log (date, symbol);

      CREATE TABLE IF NOT EXISTS wall_events (
        id            BIGSERIAL PRIMARY KEY,
        date          DATE        NOT NULL,
        hit_ts        TIMESTAMPTZ NOT NULL,
        hit_slot      SMALLINT    NOT NULL,
        symbol        TEXT        NOT NULL,
        level_type    TEXT        NOT NULL,
        strike        DOUBLE PRECISION NOT NULL,
        spot_at_hit   DOUBLE PRECISION NOT NULL,
        reaction      TEXT,
        excursion_pts DOUBLE PRECISION,
        reclaim_min   INTEGER,
        resolved_ts   TIMESTAMPTZ,
        note          TEXT,
        UNIQUE (date, symbol, level_type, strike, hit_slot)
      );
      CREATE INDEX IF NOT EXISTS wall_events_day ON wall_events (date, symbol);
      CREATE INDEX IF NOT EXISTS wall_events_open ON wall_events (date) WHERE reaction IS NULL;

      -- 'touch'    — spot came inside TOUCH_PCT. The original event.
      -- 'approach' — spot came inside APPROACH_PCT but never tagged. A level
      --              price coiled under and rolled away from produced NO row at
      --              all before this, so the most common non-event was invisible.
      -- Everything that counts "hits" must filter kind = 'touch'.
      ALTER TABLE wall_events ADD COLUMN IF NOT EXISTS kind TEXT NOT NULL DEFAULT 'touch';
      -- Was this strike ALSO the CORE at the moment of the hit, and was it still
      -- CORE once the window resolved? A wall that is the CORE is a different
      -- animal from one that merely sits near it.
      ALTER TABLE wall_events ADD COLUMN IF NOT EXISTS was_core BOOLEAN;
      ALTER TABLE wall_events ADD COLUMN IF NOT EXISTS core_held BOOLEAN;
      -- Net GEX at the level's own strike when it was tagged, and at resolve.
      -- Their ratio is "how much did GEX build as price got here".
      ALTER TABLE wall_events ADD COLUMN IF NOT EXISTS gex_at_hit DOUBLE PRECISION;
      ALTER TABLE wall_events ADD COLUMN IF NOT EXISTS gex_at_resolve DOUBLE PRECISION;
      CREATE INDEX IF NOT EXISTS wall_events_kind ON wall_events (date, kind);

      -- Net GEX at THIS level's strike, per slot. walls_log.gex_value is the
      -- whole-symbol total and cannot answer "did this wall thicken".
      ALTER TABLE walls_log ADD COLUMN IF NOT EXISTS level_gex DOUBLE PRECISION;
    `);
    _schemaReady = true;
    return true;
  } catch (e) {
    console.error('[walls] ensureSchema error:', e.message);
    return false;
  }
}

// ── Time / slot helpers ──────────────────────────────────────────────────────

function etDateStr(d = new Date()) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(d);
}

function etParts(d = new Date()) {
  const p = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York', hour: '2-digit', minute: '2-digit', weekday: 'short', hour12: false,
  }).formatToParts(d);
  const get = (t) => p.find((x) => x.type === t)?.value;
  return { hour: Number(get('hour')), minute: Number(get('minute')), weekday: get('weekday') };
}

function isTradingDay(d = new Date()) {
  const { weekday } = etParts(d);
  if (weekday === 'Sat' || weekday === 'Sun') return false;
  return !MARKET_HOLIDAYS.has(etDateStr(d));
}

/** ET minutes-since-midnight for a slot index. slot 0 = 09:29. */
function slotMins(slot) {
  return slot === 0 ? OPEN_SLOT_MINS : GRID_START_MINS + (slot - 1) * SLOT_STEP;
}

/** "09:29" / "14:45" for display + logs. */
function slotLabel(slot) {
  const m = slotMins(slot);
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
}

/**
 * The slot that is currently due, or null. A slot is due from its clock time
 * until SLOT_GRACE_MINS after it — so a restart at 10:02 still fills 10:00.
 */
function dueSlot(d = new Date()) {
  if (!isTradingDay(d)) return null;
  const { hour, minute } = etParts(d);
  const mins = hour * 60 + minute;
  for (let s = SLOT_COUNT - 1; s >= 0; s--) {
    const t = slotMins(s);
    if (mins >= t && mins <= t + SLOT_GRACE_MINS) return s;
  }
  return null;
}

// ── Sampling ─────────────────────────────────────────────────────────────────

/**
 * Latest scanner row per symbol for `date`, no older than MAX_SAMPLE_AGE_MINS.
 * scanner-recorder writes every 5m, so at a 15m slot this is a fresh read.
 */
async function sampleUniverse(p, date) {
  const { rows } = await p.query(
    `SELECT DISTINCT ON (symbol)
            symbol, ts, spot, call_wall, put_wall, cb, total_net_gex,
            call_wall_gex, put_wall_gex, cb_gex
       FROM scanner_snapshots
      WHERE date = $1
        AND ts >= NOW() - make_interval(mins => $2::int)
      ORDER BY symbol, ts DESC`,
    [date, MAX_SAMPLE_AGE_MINS],
  );
  return rows;
}

/** Last recorded strike per (symbol, level_type) for the day. */
async function lastLevels(p, date) {
  const { rows } = await p.query(
    `SELECT DISTINCT ON (symbol, level_type) symbol, level_type, strike, slot
       FROM walls_log
      WHERE date = $1
      ORDER BY symbol, level_type, slot DESC`,
    [date],
  );
  const m = new Map();
  for (const r of rows) m.set(`${r.symbol}|${r.level_type}`, r);
  return m;
}

const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : null);

// ── Tick: write level changes, open hit events ───────────────────────────────

async function runSlot({ slot = null, force = false } = {}) {
  const p = getPool();
  if (!p || !(await ensureSchema())) return { skipped: 'no DB' };

  const now = new Date();
  const s = slot != null ? Number(slot) : dueSlot(now);
  if (s == null) return { skipped: 'no slot due' };
  if (!force && !isTradingDay(now)) return { skipped: 'not a trading day' };

  const date = etDateStr(now);
  const [samples, last] = await Promise.all([sampleUniverse(p, date), lastLevels(p, date)]);
  if (!samples.length) return { skipped: 'no scanner samples', slot: s, date };

  let written = 0;
  let hits = 0;
  let approaches = 0;

  for (const row of samples) {
    const spot = num(row.spot);
    if (!(spot > 0)) continue;
    const levels = { call_wall: num(row.call_wall), put_wall: num(row.put_wall), cb: num(row.cb) };

    // GEX at each level's OWN strike, captured by the scanner sweep.
    const levelGex = {
      call_wall: num(row.call_wall_gex),
      put_wall: num(row.put_wall_gex),
      cb: num(row.cb_gex),
    };
    // Is this strike also carrying the largest |net GEX| on the chain? A wall
    // that IS the CORE behaves differently from one that merely sits near it.
    const coreStrike = levels.cb;

    for (const lt of LEVEL_TYPES) {
      const strike = levels[lt];
      if (strike == null || !(strike > 0)) continue;
      const isCore = coreStrike != null && Number(coreStrike) === Number(strike);

      const prev = last.get(`${row.symbol}|${lt}`);
      const isOpen = s === 0 || !prev;
      const changed = prev ? Number(prev.strike) !== strike : true;

      // Change-only write. Slot 0 (or the first sighting of a symbol that came
      // online late) always lands as the baseline.
      if (isOpen || changed) {
        try {
          await p.query( // eslint-disable-line no-await-in-loop
            `INSERT INTO walls_log
               (date, ts, slot, symbol, level_type, strike, prev_strike, delta, spot, gex_value, reason, level_gex)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
             ON CONFLICT (date, symbol, level_type, slot) DO NOTHING`,
            [date, now, s, row.symbol, lt, strike,
              isOpen ? null : Number(prev.strike),
              isOpen ? null : strike - Number(prev.strike),
              spot, num(row.total_net_gex), isOpen ? 'open' : 'change',
              levelGex[lt]],
          );
          written++;
          last.set(`${row.symbol}|${lt}`, { symbol: row.symbol, level_type: lt, strike, slot: s });
        } catch (e) {
          console.warn(`[walls] write ${row.symbol}/${lt}:`, e.message);
        }
      }

      // Touch, or merely an approach. Same de-dupe either way: one open event
      // per (symbol, level, strike) at a time, plus a RESOLVE_SLOTS cooldown
      // after one closes — otherwise a level price is sitting on would log a
      // fresh event every 15 minutes. The cooldown is why the attempt count
      // means "distinct approaches an hour apart", not "every bar that grazed".
      const kind = isTouched(lt, spot, strike) ? 'touch'
        : isApproaching(lt, spot, strike) ? 'approach'
        : null;
      if (kind) {
        try {
          // A touch supersedes an open approach on the same strike: price got
          // there after all, so the approach is no longer the story. Without
          // this the cooldown would suppress the touch entirely.
          if (kind === 'touch') {
            await p.query( // eslint-disable-line no-await-in-loop
              `DELETE FROM wall_events
                WHERE date = $1 AND symbol = $2 AND level_type = $3
                  AND strike = $4 AND kind = 'approach' AND reaction IS NULL`,
              [date, row.symbol, lt, strike],
            );
          }
          const r = await p.query( // eslint-disable-line no-await-in-loop
            `INSERT INTO wall_events
               (date, hit_ts, hit_slot, symbol, level_type, strike, spot_at_hit,
                kind, was_core, gex_at_hit)
             SELECT $1::date, $2::timestamptz, $3::smallint, $4::text, $5::text,
                    $6::double precision, $7::double precision,
                    $9::text, $10::boolean, $11::double precision
              WHERE NOT EXISTS (
                    SELECT 1 FROM wall_events
                     WHERE date = $1::date AND symbol = $4::text
                       AND level_type = $5::text AND strike = $6::double precision
                       AND (reaction IS NULL OR hit_slot > $3::int - $8::int))
             ON CONFLICT DO NOTHING
             RETURNING id`,
            [date, now, s, row.symbol, lt, strike, spot, RESOLVE_SLOTS,
              kind, isCore, levelGex[lt]],
          );
          if (r.rowCount && kind === 'touch') hits++;
          if (r.rowCount && kind === 'approach') approaches++;
        } catch (e) {
          console.warn(`[walls] ${kind} ${row.symbol}/${lt}:`, e.message);
        }
      }
    }
  }

  const resolved = await resolveOpenEvents(p, date, s).catch((e) => {
    console.warn('[walls] resolve error:', e.message); return 0;
  });

  console.log(`[walls] slot ${s} (${slotLabel(s)}) — ${samples.length} tickers · ${written} level rows · ${hits} new hits · ${approaches} approaches · ${resolved} resolved`);
  return { ok: true, date, slot: s, at: slotLabel(s), tickers: samples.length, written, hits, approaches, resolved };
}

/**
 * Is spot trading into / through the level?
 * Walls are directional — a call wall is only "tested" from below, a put wall
 * from above. CB is a magnet and counts from either side.
 */
function isWithin(levelType, spot, strike, pct) {
  const band = strike * pct;
  if (levelType === 'call_wall') return spot >= strike - band;
  if (levelType === 'put_wall') return spot <= strike + band;
  return Math.abs(spot - strike) <= band;
}
function isTouched(levelType, spot, strike) {
  return isWithin(levelType, spot, strike, TOUCH_PCT);
}
/** Inside the approach band but NOT yet a tag — "got close, didn't touch". */
function isApproaching(levelType, spot, strike) {
  return isWithin(levelType, spot, strike, APPROACH_PCT)
    && !isWithin(levelType, spot, strike, TOUCH_PCT);
}

// ── Classification ───────────────────────────────────────────────────────────

/**
 * Signed distance past the level, in the direction a break would go.
 * call_wall breaks up (+), put_wall breaks down (+ = below the strike),
 * cb uses whichever side it left on.
 */
function pastBy(levelType, spot, strike, cbDir) {
  if (levelType === 'call_wall') return spot - strike;
  if (levelType === 'put_wall') return strike - spot;
  return cbDir >= 0 ? spot - strike : strike - spot;
}

/**
 * Which side price was on when it came to the level. +1 = approached from
 * BELOW (a break goes up), -1 = approached from ABOVE (a break goes down).
 *
 * This is the fix for the "7775 was never broken" case: CORE has no natural
 * side, and the old code took the direction of the LARGEST excursion anywhere
 * in the watch window. Price that tagged 7775 from underneath at 7772.97 and
 * then fell 18.77 got scored as "broke by 18.77" — but falling away from a
 * level you approached from below is a retreat, not a break. Direction has to
 * come from where price CAME FROM, never from where it ended up.
 *
 * `prior` is the last spot strictly before the hit (best signal — the touch
 * band is only 0.05% wide, so spot AT the hit is nearly on the level).
 * `atHit` is the fallback.
 */
function approachDir(strike, prior, atHit) {
  const k = Number(strike);
  for (const s of [prior, atHit]) {
    const v = Number(s);
    if (Number.isFinite(v) && v !== k) return v < k ? 1 : -1;
  }
  return 0; // unknown — caller falls back to the excursion heuristic
}

/** Word for the direction a break through this level would travel. */
function breakWord(levelType, cbDir) {
  if (levelType === 'call_wall') return 'above';
  if (levelType === 'put_wall') return 'below';
  return cbDir >= 0 ? 'above' : 'below';
}
/** Word for the side price approached the level from. */
function sideWord(levelType, cbDir) {
  return breakWord(levelType, cbDir) === 'above' ? 'below' : 'above';
}

/**
 * Classify one open event from the spot path recorded after the hit.
 * `path` = ascending-by-ts [{ts, spot}] from scanner_snapshots.
 * `rolled` = did walls_log show this level_type move in the break direction?
 * `dirHint` = +1 price approached from below / -1 from above / 0 unknown.
 *             Only CB uses it; the walls have a fixed side.
 */
function classify(levelType, strike, path, rolled, dirHint = 0) {
  if (!path.length) return null;
  const thresh = breakThreshold(strike);
  const band = strike * TOUCH_PCT;

  // CB has no natural side. Take it from the side price APPROACHED on — a
  // break is price continuing THROUGH the level, so it must be measured away
  // from where price came from. Only when the approach side is unknown do we
  // fall back to the old "largest excursion wins" guess.
  let cbDir = 1;
  if (levelType === 'cb') {
    if (dirHint === 1 || dirHint === -1) {
      cbDir = dirHint;
    } else {
      let up = 0, dn = 0;
      for (const s of path) { up = Math.max(up, s.spot - strike); dn = Math.max(dn, strike - s.spot); }
      cbDir = up >= dn ? 1 : -1;
    }
  }

  const past = path.map((s) => pastBy(levelType, s.spot, strike, cbDir));
  const maxPast = Math.max(...past);
  const lastPast = past[past.length - 1];

  // How far it retreated back inside after the furthest push.
  const peakIdx = past.indexOf(maxPast);
  const minAfterPeak = Math.min(...past.slice(peakIdx));
  const reversal = maxPast - minAfterPeak;

  // Consolidation is a statement about how the window ENDED, not about the
  // longest stretch somewhere in the middle: the last HOLD_SAMPLES samples all
  // sit outside the level and stopped making new ground. A break that is still
  // extending on the final sample has a wide tail range and stays a break.
  const tail = past.slice(-HOLD_SAMPLES);
  const tailOutside = tail.length >= HOLD_SAMPLES && tail.every((d) => d > band);
  const tailRange = tail.length ? Math.max(...tail) - Math.min(...tail) : Infinity;

  // Samples that never left the band at all.
  let inBand = 0, bestInBand = 0;
  for (const d of past) { if (Math.abs(d) <= band) { inBand++; bestInBand = Math.max(bestInBand, inBand); } else inBand = 0; }

  const excursion = Number(maxPast.toFixed(4));
  const mkReclaim = () => {
    const i = past.findIndex((d, idx) => idx > peakIdx && d <= 0);
    if (i < 0) return null;
    return Math.round((path[i].ts - path[peakIdx].ts) / 60000);
  };

  // Precedence, strongest structural read first. Note the size labels
  // (break_5 / break_lt5) key off HOW FAR it went, not whether it was later
  // reclaimed — a reclaim shows up in reclaim_min and the note instead, so
  // "broke by 8 then failed" doesn't get filed as a clean reject.
  const reclaim = mkReclaim();
  const back = reclaim != null ? `, reclaimed after ${reclaim}m` : ', never reclaimed';
  // Every note says which way price was travelling — a bare "broke by 18.77"
  // reads the same whether it went through the level or fell away from it.
  const thru = breakWord(levelType, cbDir);   // where a break goes
  const from = sideWord(levelType, cbDir);    // where price came from

  if (maxPast >= thresh && rolled) {
    return { reaction: 'new_wall', excursion, reclaim_min: reclaim,
      note: `broke ${thru} by ${excursion.toFixed(2)} and the ${levelType.replace('_', ' ')} rolled with it` };
  }
  if (maxPast >= thresh && tailOutside && tailRange <= strike * CONSOLIDATION_RANGE_PCT) {
    return { reaction: 'consolidated', excursion, reclaim_min: reclaim,
      note: `broke ${thru} by ${excursion.toFixed(2)}, then held a ${tailRange.toFixed(2)} range outside for ${tail.length} samples` };
  }
  if (maxPast >= thresh) {
    return { reaction: 'break_5', excursion, reclaim_min: reclaim,
      note: `pushed ${excursion.toFixed(2)} ${thru} the level${back}` };
  }
  if (maxPast > band) {
    return { reaction: 'break_lt5', excursion, reclaim_min: reclaim,
      note: `pierced ${excursion.toFixed(2)} ${thru} the level${back}` };
  }
  if (reversal >= strike * REJECT_REVERSE_PCT && lastPast <= 0) {
    return { reaction: 'reject', excursion, reclaim_min: reclaim,
      note: `tagged from ${from} and faded ${reversal.toFixed(2)} back` };
  }
  if (bestInBand >= HOLD_SAMPLES) {
    return { reaction: 'pin', excursion, reclaim_min: null,
      note: `sat inside the band for ${bestInBand} samples` };
  }
  // Touched, went nowhere either way — call it a reject rather than leaving it open.
  return { reaction: 'reject', excursion, reclaim_min: reclaim,
    note: `tagged from ${from}, never got ${thru} it` };
}

/**
 * Classify an APPROACH — price came inside the approach band but never tagged.
 *
 * Three outcomes worth telling apart, and none of them are the touch reactions:
 *   reached     — it did get there eventually, just outside the watch window
 *   rolled_over — coiled near the level, then reversed away by a real margin.
 *                 The one Brandon was after: a level that repelled price
 *                 WITHOUT ever being tagged leaves no touch event at all.
 *   stalled     — drifted near and neither tagged nor left. No information.
 */
function classifyApproach(levelType, strike, path, dirHint = 0) {
  if (!path.length) return null;
  const band = strike * TOUCH_PCT;
  const closest = Math.min(...path.map((s) => Math.abs(s.spot - strike)));
  const closestPct = closest / strike;
  // Which side price was working the level from. Walls are fixed; CB takes the
  // approach side, falling back to where the path actually sits.
  const cbDir = (dirHint === 1 || dirHint === -1)
    ? dirHint
    : (path[0].spot < strike ? 1 : -1);
  const from = sideWord(levelType, cbDir);

  // Distance from the level at the end vs. at the closest point. Reversing a
  // full approach band's width away is a roll-over, not drift.
  const closestIdx = path.findIndex((s) => Math.abs(s.spot - strike) === closest);
  const endDist = Math.abs(path[path.length - 1].spot - strike);
  const backedOff = endDist - closest;

  if (closest <= band) {
    return { reaction: 'reached', excursion: Number(closestPct.toFixed(6)), reclaim_min: null,
      note: `approached from ${from} and eventually tagged ${strike}` };
  }
  if (backedOff >= strike * APPROACH_PCT * 0.6) {
    return { reaction: 'rolled_over', excursion: Number((closest).toFixed(4)), reclaim_min: null,
      note: `came within ${closest.toFixed(2)} from ${from} without tagging, then rolled ${backedOff.toFixed(2)} away` };
  }
  return { reaction: 'stalled', excursion: Number((closest).toFixed(4)), reclaim_min: null,
    note: `hovered ${from} ${strike}, closest ${closest.toFixed(2)}, no resolution` };
}

/**
 * Resolve every open event whose watch window has elapsed. At the closing slot
 * everything still open is forced to a verdict — nothing carries overnight.
 */
async function resolveOpenEvents(p, date, currentSlot) {
  const cutoff = currentSlot >= SLOT_COUNT - 1 ? SLOT_COUNT : currentSlot - RESOLVE_SLOTS;
  const { rows: open } = await p.query(
    `SELECT id, symbol, level_type, strike, hit_ts, hit_slot, kind, gex_at_hit, spot_at_hit
       FROM wall_events
      WHERE date = $1 AND reaction IS NULL AND hit_slot <= $2`,
    [date, cutoff],
  );
  if (!open.length) return 0;

  let n = 0;
  for (const ev of open) {
    try {
      const { rows: path } = await p.query( // eslint-disable-line no-await-in-loop
        `SELECT ts, spot FROM scanner_snapshots
          WHERE date = $1 AND symbol = $2 AND ts >= $3
          ORDER BY ts ASC`,
        [date, ev.symbol, ev.hit_ts],
      );
      // Did the level itself roll in the break direction after the hit?
      const { rows: moved } = await p.query( // eslint-disable-line no-await-in-loop
        `SELECT strike FROM walls_log
          WHERE date = $1 AND symbol = $2 AND level_type = $3 AND slot > $4
          ORDER BY slot ASC LIMIT 1`,
        [date, ev.symbol, ev.level_type, ev.hit_slot],
      );
      const strike = Number(ev.strike);
      const rolled = moved.length
        ? (ev.level_type === 'put_wall' ? Number(moved[0].strike) < strike : Number(moved[0].strike) > strike)
        : false;

      // Where price came FROM. The last sample strictly before the hit is the
      // honest read; spot_at_hit is only the fallback because the touch band is
      // 0.05% wide, so at the tag price is basically sitting on the level.
      const { rows: before } = await p.query( // eslint-disable-line no-await-in-loop
        `SELECT spot FROM scanner_snapshots
          WHERE date = $1 AND symbol = $2 AND ts < $3 AND spot > 0
          ORDER BY ts DESC LIMIT 1`,
        [date, ev.symbol, ev.hit_ts],
      );
      const dirHint = approachDir(strike, before[0]?.spot, ev.spot_at_hit);

      const pts = path.map((r) => ({ ts: new Date(r.ts).getTime(), spot: Number(r.spot) }));
      const verdict = ev.kind === 'approach'
        ? classifyApproach(ev.level_type, strike, pts, dirHint)
        : classify(ev.level_type, strike, pts, rolled, dirHint);
      if (!verdict) continue;

      // Was this strike still the CORE when the window closed, and what is the
      // level's GEX now? gex_at_hit -> gex_at_resolve is the build/bleed.
      const { rows: after } = await p.query( // eslint-disable-line no-await-in-loop
        `SELECT cb, call_wall_gex, put_wall_gex, cb_gex FROM scanner_snapshots
          WHERE date = $1 AND symbol = $2 AND spot > 0
          ORDER BY ts DESC LIMIT 1`,
        [date, ev.symbol],
      );
      const last = after[0] || {};
      const coreHeld = last.cb == null ? null : Number(last.cb) === strike;
      const gexNow = num(ev.level_type === 'call_wall' ? last.call_wall_gex
        : ev.level_type === 'put_wall' ? last.put_wall_gex : last.cb_gex);

      await p.query( // eslint-disable-line no-await-in-loop
        `UPDATE wall_events
            SET reaction = $2, excursion_pts = $3, reclaim_min = $4, note = $5,
                core_held = $6, gex_at_resolve = $7, resolved_ts = NOW()
          WHERE id = $1`,
        [ev.id, verdict.reaction, verdict.excursion, verdict.reclaim_min, verdict.note,
          coreHeld, gexNow],
      );
      n++;
    } catch (e) {
      console.warn(`[walls] resolve ${ev.symbol}/${ev.level_type}:`, e.message);
    }
  }
  return n;
}

/**
 * Re-score a day that was already classified. Only needed after a change to
 * classify() — days recorded before the approach-direction fix carry verdicts
 * built from "largest excursion wins", which mislabelled a fall AWAY from a
 * level as a break THROUGH it.
 *
 * Clears the verdict columns for the date and lets the normal resolver run
 * again over the same stored spot path, so nothing is invented — the events,
 * hit times and GEX snapshots are untouched.
 */
async function reclassifyDay(date, symbol = null) {
  const p = await getPool();
  const args = symbol ? [date, symbol] : [date];
  const { rowCount } = await p.query(
    `UPDATE wall_events
        SET reaction = NULL, excursion_pts = NULL, reclaim_min = NULL,
            note = NULL, resolved_ts = NULL
      WHERE date = $1 ${symbol ? 'AND symbol = $2' : ''}`,
    args,
  );
  const n = await resolveOpenEvents(p, date, SLOT_COUNT - 1);
  console.log(`[walls] reclassify ${date}${symbol ? `/${symbol}` : ''} — ${rowCount} cleared, ${n} re-scored`);
  return { ok: true, date, symbol, cleared: rowCount, resolved: n };
}

// ── Read API ─────────────────────────────────────────────────────────────────

/**
 * Day view. Without `symbol`: one summary row per ticker (current levels,
 * change count, last event, latest reaction) + session totals. With `symbol`:
 * that ticker's full ordered level log and every hit event.
 */
async function getWalls({ date, symbol } = {}) {
  const p = getPool();
  if (!p || !(await ensureSchema())) return { ok: false, error: 'no DB' };
  const day = date || etDateStr();

  if (symbol) {
    const sym = String(symbol).toUpperCase();
    const [log, events] = await Promise.all([
      p.query(
        `SELECT slot, ts, level_type, strike, prev_strike, delta, spot, reason, level_gex
           FROM walls_log WHERE date = $1 AND symbol = $2
          ORDER BY slot ASC, level_type ASC`, [day, sym]),
      p.query(
        `SELECT hit_slot, hit_ts, level_type, strike, spot_at_hit, reaction,
                excursion_pts, reclaim_min, note, resolved_ts,
                kind, was_core, core_held, gex_at_hit, gex_at_resolve,
                -- How many times this exact level has been come at today.
                -- Touches only: an approach is not an attempt to break.
                COUNT(*) FILTER (WHERE kind = 'touch')
                  OVER (PARTITION BY level_type, strike) AS attempts
           FROM wall_events WHERE date = $1 AND symbol = $2
          ORDER BY hit_slot ASC`, [day, sym]),
    ]);
    return {
      ok: true, date: day, symbol: sym,
      log: log.rows.map((r) => ({ ...r, at: slotLabel(r.slot) })),
      events: events.rows.map((r) => ({ ...r, at: slotLabel(r.hit_slot) })),
    };
  }

  // Per-symbol current state = the newest walls_log row per level type.
  const cur = await p.query(
    `SELECT DISTINCT ON (symbol, level_type)
            symbol, level_type, strike, slot, spot
       FROM walls_log WHERE date = $1
      ORDER BY symbol, level_type, slot DESC`, [day]);
  const open = await p.query(
    `SELECT DISTINCT ON (symbol, level_type)
            symbol, level_type, strike
       FROM walls_log WHERE date = $1 AND reason = 'open'
      ORDER BY symbol, level_type, slot ASC`, [day]);
  const chg = await p.query(
    `SELECT symbol, COUNT(*)::int AS n FROM walls_log
      WHERE date = $1 AND reason = 'change' GROUP BY symbol`, [day]);
  const evs = await p.query(
    `SELECT symbol, level_type, strike, hit_slot, reaction, reclaim_min, kind, was_core
       FROM wall_events WHERE date = $1 AND kind = 'touch' ORDER BY hit_slot ASC`, [day]);
  // Approaches are a separate story from hits — a level price respected without
  // ever tagging is not a "hit" and must not inflate the hit column.
  const apps = await p.query(
    `SELECT symbol, COUNT(*)::int AS n,
            COUNT(*) FILTER (WHERE reaction = 'rolled_over')::int AS rolled
       FROM wall_events WHERE date = $1 AND kind = 'approach'
      GROUP BY symbol`, [day]);
  const tot = await p.query(
    'SELECT COUNT(*)::int AS n FROM walls_log WHERE date = $1', [day]);

  const bySym = new Map();
  const get = (s) => {
    if (!bySym.has(s)) bySym.set(s, { symbol: s, spot: null, call_wall: null, put_wall: null, cb: null,
      open: {}, changes: 0, hits: 0, approaches: 0, rolled_over: 0, attempts: {},
      by_level: {}, last_event: null, reaction: null, reclaim_min: null, _spotSlot: -1 });
    return bySym.get(s);
  };
  for (const r of cur.rows) {
    const e = get(r.symbol);
    e[r.level_type] = Number(r.strike);
    // Level types can last have changed at different slots — take spot from
    // whichever row is newest so the table shows one coherent price.
    if (r.slot > e._spotSlot) { e.spot = Number(r.spot); e._spotSlot = r.slot; }
  }
  for (const r of open.rows) get(r.symbol).open[r.level_type] = Number(r.strike);
  for (const r of chg.rows) get(r.symbol).changes = r.n;
  for (const r of apps.rows) { const e = get(r.symbol); e.approaches = r.n; e.rolled_over = r.rolled; }
  for (const r of evs.rows) {
    const e = get(r.symbol);
    e.hits++;
    // Attempts per level type — "this put wall has been come at 3 times today".
    e.attempts[r.level_type] = (e.attempts[r.level_type] || 0) + 1;
    e.last_event = `${slotLabel(r.hit_slot)} ${r.level_type} ${r.strike}`;
    e.reaction = r.reaction; // ordered by slot, so the last write wins
    // Carried so the table badge can tell a break that came back from one that
    // held, the same way the level log does.
    e.reclaim_min = r.reclaim_min;
    // Per level type, because e.reaction above is the last event of ANY level —
    // a ticker can show "consolidated" off its call wall while its put wall
    // rejected cleanly, which is exactly the wrong read for a bounce.
    e.by_level[r.level_type] = { reaction: r.reaction, reclaim_min: r.reclaim_min, strike: Number(r.strike) };
  }

  const tickers = [...bySym.values()]
    .map(({ _spotSlot, ...t }) => t) // eslint-disable-line no-unused-vars
    .sort((a, b) => a.symbol.localeCompare(b.symbol));
  const counts = (rx) => evs.rows.filter((r) => r.reaction === rx).length;
  return {
    ok: true, date: day, slots: SLOT_COUNT,
    totals: {
      tickers: tickers.length,
      changes: chg.rows.reduce((n, r) => n + r.n, 0),
      hits: evs.rowCount,
      approaches: apps.rows.reduce((n, r) => n + r.n, 0),
      rolled_over: apps.rows.reduce((n, r) => n + r.rolled, 0),
      rejects: counts('reject'),
      breaks: counts('break_5') + counts('break_lt5') + counts('consolidated') + counts('new_wall'),
      consolidated: counts('consolidated'),
      pins: counts('pin'),
      rows: tot.rows[0]?.n ?? 0, // every walls_log row written today
    },
    tickers,
  };
}

// ── Scheduler ────────────────────────────────────────────────────────────────

let _timer = null;
let _lastKey = null;
let _inFlight = false;

function startWallsRecorder() {
  const tick = async () => {
    // runSlot walks the whole universe and can outlast CHECK_MS. _lastKey used
    // to double as the reentrancy guard; now that it is only set on success,
    // overlap needs its own flag.
    if (_inFlight) return;
    try {
      const now = new Date();
      const s = dueSlot(now);
      if (s == null) return;
      const key = `${etDateStr(now)}:${s}`;
      if (_lastKey === key) return; // this slot is already done
      _inFlight = true;
      const res = await runSlot({ slot: s });
      // Burn the slot ONLY on a real capture. A skip — no scanner samples yet,
      // DB down — has to stay retryable for the rest of SLOT_GRACE_MINS, which
      // is the entire reason that grace window exists. Marking the key up front
      // meant one early failure (guaranteed at 09:29, when scanner_snapshots is
      // still empty for the day) permanently lost the slot.
      if (res && res.ok) _lastKey = key;
      else console.warn(`[walls] slot ${s} (${slotLabel(s)}) not captured: ${res?.skipped || 'unknown'} — will retry within grace`);
    } catch (e) {
      console.warn('[walls] tick error:', e.message);
    } finally {
      _inFlight = false;
    }
  };
  _timer = setInterval(() => { void tick(); }, CHECK_MS);
  if (_timer.unref) _timer.unref();
  // Mid-session restart: fill the slot we are standing in, if any.
  setTimeout(() => { void tick(); }, 20_000).unref?.();
  console.log(`[walls] recorder started — ${SLOT_COUNT} slots (${slotLabel(0)} open + ${slotLabel(1)}–${slotLabel(SLOT_COUNT - 1)} every ${SLOT_STEP}m)`);
}

module.exports = {
  startWallsRecorder, runSlot, getWalls, ensureSchema, getPool, reclassifyDay,
  // exported for tests / manual poking
  classify, classifyApproach, approachDir, isTouched, isApproaching, dueSlot, slotLabel,
  breakThreshold, SLOT_COUNT, LEVEL_TYPES, TOUCH_PCT, APPROACH_PCT,
};
