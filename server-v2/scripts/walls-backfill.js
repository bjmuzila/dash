'use strict';
/**
 * server-v2/scripts/walls-backfill.js
 *
 * Rebuilds walls_log for sessions the live recorder missed, by replaying the
 * scanner sweeps that were recorded at the time.
 *
 * WHY THIS EXISTS. startWallsRecorder() was commented out of
 * server-with-proxy.js on 2026-09-10 (the owner Results -> Walls tab had been
 * removed) and re-enabled on 2026-09-11, when /v3/level-log turned out to be
 * the real consumer. Between those two dates nothing wrote walls_log, so the
 * Level Log's rail read "no session recorded" for every ticker. The SOURCE data
 * was never lost: scanner-recorder kept writing scanner_snapshots (and
 * scanner_variants) the whole time, which is the only thing walls-recorder
 * reads. This script turns those sweeps back into the change-only level log.
 *
 * WHY /proxy/walls-run CANNOT DO IT. walls-recorder's sampleUniverse() selects
 * `ts >= NOW() - interval` and takes DISTINCT ON (symbol) ... ORDER BY ts DESC —
 * the newest sweep as of RIGHT NOW. Firing `POST /proxy/walls-run {slot: 3}` at
 * midday therefore stamps midday levels onto the 10:15 row. Correct for a live
 * slot, useless for a past one. This script picks each slot's sample by that
 * slot's own ET clock instead, and writes the sample's real `ts`.
 *
 * WHAT IT REPRODUCES, exactly as a live pass would:
 *   · slot grid          slot 0 = 09:29 open, slots 1..26 = 09:45 .. 16:00 / 15m
 *   · sampling rule      newest sweep at or before the slot clock (+SLOT_GRACE),
 *                        no older than the variant's freshness window
 *   · change-only        a row per level SET or CHANGE; slot 0, and the first
 *                        sighting of a symbol that came online late, land as
 *                        reason='open' with a null prev_strike/delta
 *   · all four variants  0dte|agg x oivol|vol — default off scanner_snapshots,
 *                        the other three off scanner_variants, same as live
 *   · idempotent         ON CONFLICT (date,symbol,level_type,slot,expiry_scope,
 *                        basis) DO NOTHING, so re-running is free and a slot the
 *                        live recorder already wrote is never overwritten
 *
 * WHAT IT DOES NOT DO — on purpose:
 *   · wall_events. Touch/approach classification is a forward-looking read
 *     (classify() needs the RESOLVE_SLOTS window after the tag, and the live
 *     pass resolves events on a delay), so replaying it from history would
 *     invent reactions rather than recover them. walls-recorder exports
 *     reclassifyDay() for that job; run it separately if you want the events.
 *     /v3/level-log's rail and migration chart read `log`, not `events`.
 *   · wall_reach / wall_alerts. Reach Rank and the proximity watcher are
 *     deliberately still disabled in server-with-proxy.js.
 *
 * THE STRAY-OPEN REPAIR. If the recorder came back mid-session, its first write
 * of the day landed as reason='open' at, say, slot 12 (the `!prev` branch), with
 * a null prev_strike. Once slots 0..11 are filled in behind it that row is a
 * mid-day 'open' sitting on top of an earlier baseline, which draws as a broken
 * first step. After the insert pass this script demotes any reason='open' row
 * that now has an earlier row for the same (date, symbol, level_type, variant)
 * to reason='change' and fills its prev_strike/delta from that earlier row.
 *
 * USAGE (inside the dashboard container, or from the repo root with
 * DATABASE_URL / .env.local present):
 *   node server-v2/scripts/walls-backfill.js --date=2026-09-10
 *   node server-v2/scripts/walls-backfill.js --date=2026-09-10 --commit
 *   node server-v2/scripts/walls-backfill.js --from=2026-09-10 --to=2026-09-11 --commit
 *   node server-v2/scripts/walls-backfill.js --date=2026-09-11 --default-only --commit
 *   node server-v2/scripts/walls-backfill.js --date=2026-09-11 --symbol=SPX
 *
 * DRY RUN BY DEFAULT. Without --commit it prints the per-slot sample it would
 * use and the row counts per variant, and writes nothing.
 */

const path = require('node:path');
const { Pool } = require('pg');
const { etEpochMs } = require('../computation/utils');
const V = require('../scanner-variants');

// Same loader shape as scripts/backfill-eod-gex-0dte.js: DATABASE_URL lives in
// .env.local, the only env_file the dashboard container mounts, so a bare host
// run works the same way as a container one.
if (!process.env.DATABASE_URL) {
  const ROOT = path.join(__dirname, '..', '..');
  for (const f of ['.env.local', '.env']) {
    try {
      require('dotenv').config({ path: path.join(ROOT, f), override: false });
    } catch { /* dotenv absent — the explicit error below covers it */ }
    if (process.env.DATABASE_URL) { console.log(`[walls-backfill] loaded DATABASE_URL from ${f}`); break; }
  }
}

// ── The slot grid and the sampling window ────────────────────────────────────
// Mirrored from walls-recorder.js by intent. If you change them there, change
// them here, or a backfilled slot stops matching a live one.
const OPEN_SLOT_MINS = 9 * 60 + 29;
const GRID_START_MINS = 9 * 60 + 45;
const GRID_END_MINS = 16 * 60;
const SLOT_STEP = 15;
const SLOT_COUNT = 1 + (GRID_END_MINS - GRID_START_MINS) / SLOT_STEP + 1; // 27
/** How late after a slot's clock the live pass still accepts a sweep. */
const SLOT_GRACE_MINS = 5;
/** A sweep older than this is not a valid sample for the slot (0DTE legs). */
const MAX_SAMPLE_AGE_MINS = 12;
/** The aggregate legs ride a slower sub-cadence and get a wider window. */
const AGG_SAMPLE_AGE_MINS = Number(process.env.WALLS_AGG_SAMPLE_AGE_MINS || 40);
const sampleAgeMins = (variant) => (variant.scope === 'agg' ? AGG_SAMPLE_AGE_MINS : MAX_SAMPLE_AGE_MINS);

const LEVEL_TYPES = ['call_wall', 'put_wall', 'cb'];

const MARKET_HOLIDAYS = new Set([
  '2026-01-01', '2026-01-19', '2026-02-16', '2026-04-03', '2026-05-25',
  '2026-06-19', '2026-07-03', '2026-09-07', '2026-11-26', '2026-12-25',
  '2027-01-01', '2027-01-18', '2027-02-15', '2027-03-26', '2027-05-31',
  '2027-06-18', '2027-07-05', '2027-09-06', '2027-11-25', '2027-12-24',
]);

/** ET minutes-since-midnight for a slot index. slot 0 = 09:29. */
const slotMins = (slot) => (slot === 0 ? OPEN_SLOT_MINS : GRID_START_MINS + (slot - 1) * SLOT_STEP);

/** "09:29" / "14:45" — for logs, and the same label /proxy/walls serves. */
function slotLabel(slot) {
  const m = slotMins(slot);
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
}

const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : null);

const YMD_RE = /^\d{4}-\d{2}-\d{2}$/;

/** Weekday-and-not-a-holiday, on the calendar date itself (noon UTC parse). */
function isTradingDay(ymd) {
  const t = Date.parse(`${ymd}T12:00:00Z`);
  if (!Number.isFinite(t)) return false;
  const dow = new Date(t).getUTCDay();
  if (dow === 0 || dow === 6) return false;
  return !MARKET_HOLIDAYS.has(ymd);
}

/** Inclusive date span, trading days only, oldest first. */
function spanDates(from, to) {
  const out = [];
  const a = Date.parse(`${from}T12:00:00Z`);
  const b = Date.parse(`${to}T12:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b) || b < a) return out;
  for (let t = a; t <= b; t += 86_400_000) {
    const ymd = new Date(t).toISOString().slice(0, 10);
    if (isTradingDay(ymd)) out.push(ymd);
  }
  return out;
}

function parseArgs(argv) {
  const out = {
    dates: [], from: null, to: null, commit: false,
    defaultOnly: false, symbol: null, noRepair: false, verbose: false,
  };
  for (const a of argv.slice(2)) {
    if (a === '--commit') out.commit = true;
    else if (a === '--default-only') out.defaultOnly = true;
    else if (a === '--no-repair') out.noRepair = true;
    else if (a === '--verbose' || a === '-v') out.verbose = true;
    else if (a.startsWith('--date=')) out.dates.push(a.slice(7));
    else if (a.startsWith('--from=')) out.from = a.slice(7);
    else if (a.startsWith('--to=')) out.to = a.slice(5);
    else if (a.startsWith('--symbol=')) out.symbol = a.slice(9).trim().toUpperCase();
    else if (a.startsWith('dotenv_config_')) continue;
    else {
      console.error(`unknown arg: ${a}`);
      process.exit(2);
    }
  }
  if (out.from && !out.to) out.to = out.from;
  if (out.from && out.to) out.dates.push(...spanDates(out.from, out.to));
  out.dates = [...new Set(out.dates)].sort();
  return out;
}

// ── The sweeps, as they were recorded ────────────────────────────────────────

/**
 * Every sweep for `date`, per symbol, oldest first. The DEFAULT variant reads
 * scanner_snapshots — the table that predates the variant split and is written
 * on every sweep regardless of whether variants are enabled — and the other
 * three read scanner_variants, which is the only place they exist. Same split
 * as walls-recorder.sampleUniverse().
 *
 * `date` is TEXT in both scanner tables (walls_log.date is a DATE column), so
 * it is compared as text here and cast on the way into walls_log below.
 */
async function loadSweeps(pool, date, variant, symbol) {
  const cols = `symbol, ts, spot, call_wall, put_wall, cb, total_net_gex,
                call_wall_gex, put_wall_gex, cb_gex`;
  const symFilter = symbol ? ' AND symbol = $2' : '';
  const { rows } = V.isDefault(variant)
    ? await pool.query(
      `SELECT ${cols} FROM scanner_snapshots
        WHERE date = $1${symFilter} AND spot > 0
        ORDER BY symbol ASC, ts ASC`,
      symbol ? [date, symbol] : [date],
    )
    : await pool.query(
      `SELECT ${cols} FROM scanner_variants
        WHERE date = $1${symFilter} AND spot > 0
          AND expiry_scope = ${symbol ? '$3' : '$2'} AND basis = ${symbol ? '$4' : '$3'}
        ORDER BY symbol ASC, ts ASC`,
      symbol
        ? [date, symbol, variant.scope, variant.basis]
        : [date, variant.scope, variant.basis],
    );

  const bySymbol = new Map();
  for (const r of rows) {
    const ms = new Date(r.ts).getTime();
    if (!Number.isFinite(ms)) continue;
    if (!bySymbol.has(r.symbol)) bySymbol.set(r.symbol, []);
    bySymbol.get(r.symbol).push({ ...r, ms });
  }
  return bySymbol;
}

/**
 * THE SLOT'S SAMPLE. The live pass fires at (or just after) the slot clock and
 * takes the newest sweep no older than the freshness window, so the honest
 * historical equivalent is: the LAST sweep at or before the slot clock plus the
 * same grace the live pass had, and no earlier than the window.
 *
 * `rows` is ascending by ts, so this walks forward and keeps the last in range.
 * A slot with no sweep in its window gets nothing at all — exactly as a live
 * pass would have skipped it — rather than the nearest sweep from some other
 * part of the session.
 */
function sampleForSlot(rows, slotMs, ageMins) {
  const hi = slotMs + SLOT_GRACE_MINS * 60_000;
  const lo = slotMs - ageMins * 60_000;
  let best = null;
  for (const r of rows) {
    if (r.ms > hi) break;
    if (r.ms >= lo) best = r;
  }
  return best;
}

// ── One variant's replay of one date ────────────────────────────────────────

/**
 * Walks the 27 slots in order, carrying the last strike per (symbol, level) so
 * the change-only rule is applied exactly as the live pass applies it — the
 * carry is what makes prev_strike and delta right, and it is why this cannot be
 * done slot-by-slot from the outside.
 *
 * Pre-seeded from whatever walls_log already holds for the date, so a day the
 * recorder half-wrote (it came back mid-session) is completed rather than
 * contradicted: a slot already present keeps its row, and the slots around it
 * are compared against the right neighbour.
 */
async function backfillVariant(pool, date, variant, opts) {
  const bySymbol = await loadSweeps(pool, date, variant, opts.symbol);
  if (!bySymbol.size) {
    return { variant: variant.key, sweeps: 0, symbols: 0, planned: 0, written: 0, skipped: 'no sweeps' };
  }

  // What is already there, per (symbol, level_type, slot) — both the dedupe and
  // the seed for the carry.
  const existing = new Map(); // `${symbol}|${lt}` -> Map(slot -> strike)
  {
    const { rows } = await pool.query(
      `SELECT symbol, level_type, slot, strike FROM walls_log
        WHERE date = $1::date AND expiry_scope = $2 AND basis = $3
          ${opts.symbol ? 'AND symbol = $4' : ''}`,
      opts.symbol
        ? [date, variant.scope, variant.basis, opts.symbol]
        : [date, variant.scope, variant.basis],
    );
    for (const r of rows) {
      const k = `${r.symbol}|${r.level_type}`;
      if (!existing.has(k)) existing.set(k, new Map());
      existing.get(k).set(Number(r.slot), Number(r.strike));
    }
  }

  const slotMsCache = [];
  for (let s = 0; s < SLOT_COUNT; s++) {
    const m = slotMins(s);
    slotMsCache[s] = etEpochMs(date, Math.floor(m / 60), m % 60);
  }
  const ageMins = sampleAgeMins(variant);

  /** `${symbol}|${lt}` -> { strike, slot } carried forward across slots. */
  const carry = new Map();
  const inserts = [];
  let sampled = 0;

  for (let s = 0; s < SLOT_COUNT; s++) {
    for (const [symbol, rows] of bySymbol) {
      const row = sampleForSlot(rows, slotMsCache[s], ageMins);
      if (!row) continue;
      const spot = num(row.spot);
      if (!(spot > 0)) continue;
      sampled++;

      const levels = {
        call_wall: num(row.call_wall),
        put_wall: num(row.put_wall),
        cb: num(row.cb),
      };
      const levelGex = {
        call_wall: num(row.call_wall_gex),
        put_wall: num(row.put_wall_gex),
        cb: num(row.cb_gex),
      };

      for (const lt of LEVEL_TYPES) {
        const strike = levels[lt];
        if (strike == null || !(strike > 0)) continue;
        const k = `${symbol}|${lt}`;

        // A row the live recorder (or an earlier run of this script) already
        // wrote for this exact slot wins. Adopt it as the carry so the NEXT
        // slot's prev_strike/delta are measured against what is really stored.
        const already = existing.get(k)?.get(s);
        if (already != null) {
          carry.set(k, { strike: already, slot: s });
          continue;
        }

        const prev = carry.get(k);
        const isOpen = s === 0 || !prev;
        const changed = prev ? prev.strike !== strike : true;
        if (!isOpen && !changed) continue;

        inserts.push({
          date, ts: new Date(row.ms), slot: s, symbol, level_type: lt, strike,
          prev_strike: isOpen ? null : prev.strike,
          delta: isOpen ? null : strike - prev.strike,
          spot, gex_value: num(row.total_net_gex),
          reason: isOpen ? 'open' : 'change',
          level_gex: levelGex[lt],
        });
        carry.set(k, { strike, slot: s });
      }
    }
    if (opts.verbose) {
      const n = inserts.filter((i) => i.slot === s).length;
      if (n) console.log(`  ${date} ${variant.key} slot ${String(s).padStart(2)} ${slotLabel(s)} — ${n} row(s)`);
    }
  }

  let written = 0;
  if (opts.commit && inserts.length) {
    for (const i of inserts) {
      try {
        const r = await pool.query( // eslint-disable-line no-await-in-loop
          `INSERT INTO walls_log
             (date, ts, slot, symbol, level_type, strike, prev_strike, delta, spot,
              gex_value, reason, level_gex, expiry_scope, basis)
           VALUES ($1::date,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
           ON CONFLICT (date, symbol, level_type, slot, expiry_scope, basis) DO NOTHING`,
          [i.date, i.ts, i.slot, i.symbol, i.level_type, i.strike, i.prev_strike,
            i.delta, i.spot, i.gex_value, i.reason, i.level_gex,
            variant.scope, variant.basis],
        );
        written += r.rowCount || 0;
      } catch (e) {
        console.warn(`[walls-backfill] ${date} ${variant.key} ${i.symbol}/${i.level_type}@${i.slot}: ${e.message}`);
      }
    }
  }

  return {
    variant: variant.key,
    sweeps: [...bySymbol.values()].reduce((n, r) => n + r.length, 0),
    symbols: bySymbol.size,
    sampled,
    planned: inserts.length,
    written,
  };
}

// ── Stray-open repair ────────────────────────────────────────────────────────

/**
 * A reason='open' row that now has an earlier row for the same (date, symbol,
 * level_type, variant) is the recorder's mid-session restart, not a baseline.
 * Demote it and give it the prev_strike/delta it should have had. See the header
 * note. Idempotent: the WHERE clause stops matching once a row is fixed.
 *
 * ON A DRY RUN this counts the strays that exist RIGHT NOW, before the insert
 * pass has put anything in front of them — so the real number after a --commit
 * run is usually higher. Re-run the dry run afterwards to see it settle at 0.
 */
async function repairStrayOpens(pool, date, variant, opts) {
  const sql = `
    WITH ranked AS (
      SELECT id, symbol, level_type, slot, strike, reason,
             LAG(strike) OVER w AS prev_strike,
             LAG(slot)   OVER w AS prev_slot
        FROM walls_log
       WHERE date = $1::date AND expiry_scope = $2 AND basis = $3
         ${opts.symbol ? 'AND symbol = $4' : ''}
      WINDOW w AS (PARTITION BY symbol, level_type ORDER BY slot ASC)
    ), stray AS (
      SELECT * FROM ranked
       WHERE reason = 'open' AND slot > 0 AND prev_slot IS NOT NULL
    )`;
  const params = opts.symbol
    ? [date, variant.scope, variant.basis, opts.symbol]
    : [date, variant.scope, variant.basis];

  if (!opts.commit) {
    const { rows } = await pool.query(`${sql} SELECT COUNT(*)::int AS n FROM stray`, params);
    return rows[0]?.n || 0;
  }
  const { rowCount } = await pool.query(
    `${sql}
     UPDATE walls_log w
        SET reason = 'change',
            prev_strike = s.prev_strike,
            delta = w.strike - s.prev_strike
       FROM stray s
      WHERE w.id = s.id`,
    params,
  );
  return rowCount || 0;
}

// ── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  const opts = parseArgs(process.argv);

  if (!process.env.DATABASE_URL) {
    console.error('DATABASE_URL is not set (expected in env, .env.local or .env).');
    process.exit(1);
  }
  if (!opts.dates.length) {
    console.error('Nothing to do — pass --date=YYYY-MM-DD (repeatable) or --from= / --to=.');
    process.exit(2);
  }
  for (const d of opts.dates) {
    if (!YMD_RE.test(d)) {
      console.error(`bad date: ${d} (expected YYYY-MM-DD)`);
      process.exit(2);
    }
  }

  const variants = opts.defaultOnly
    ? V.VARIANTS.filter((v) => V.isDefault(v))
    : V.VARIANTS;

  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.DATABASE_URL.includes('localhost') || process.env.DATABASE_URL.includes('127.0.0.1')
      ? undefined
      : { rejectUnauthorized: false },
    max: 2,
  });

  console.log(`[walls-backfill] ${opts.commit ? 'COMMIT' : 'DRY RUN'} — ${opts.dates.length} date(s), ${variants.length} variant(s)${opts.symbol ? `, symbol=${opts.symbol}` : ''}`);
  if (!opts.commit) console.log('[walls-backfill] nothing will be written; re-run with --commit');

  let totalPlanned = 0;
  let totalWritten = 0;
  let totalRepaired = 0;

  try {
    for (const date of opts.dates) {
      if (!isTradingDay(date)) {
        console.log(`${date}  skipped — weekend or market holiday`);
        continue;
      }
      console.log(`\n${date}`);
      for (const variant of variants) {
        const r = await backfillVariant(pool, date, variant, opts); // eslint-disable-line no-await-in-loop
        if (r.skipped) {
          console.log(`  ${r.variant.padEnd(11)} ${r.skipped}`);
          continue;
        }
        totalPlanned += r.planned;
        totalWritten += r.written;
        console.log(
          `  ${r.variant.padEnd(11)} ${String(r.symbols).padStart(4)} symbols  ` +
          `${String(r.sweeps).padStart(6)} sweeps  ` +
          `${String(r.planned).padStart(5)} rows ${opts.commit ? `written ${r.written}` : 'planned'}`,
        );
        if (!opts.noRepair) {
          const fixed = await repairStrayOpens(pool, date, variant, opts); // eslint-disable-line no-await-in-loop
          totalRepaired += fixed;
          if (fixed) {
            console.log(`  ${''.padEnd(11)} ${opts.commit ? 'repaired' : 'would repair'} ${fixed} stray reason='open' row(s)`);
          }
        }
      }
    }
  } finally {
    await pool.end().catch(() => {});
  }

  console.log(
    `\n[walls-backfill] ${opts.commit ? 'wrote' : 'would write'} ${opts.commit ? totalWritten : totalPlanned} row(s)` +
    `${totalRepaired ? `, ${opts.commit ? 'repaired' : 'would repair'} ${totalRepaired} stray open(s)` : ''}.`,
  );
  if (!opts.commit) console.log('[walls-backfill] dry run — re-run with --commit to apply.');
  else console.log('[walls-backfill] wall_events were NOT written — see the header note (reclassifyDay).');
}

main().catch((e) => {
  console.error('[walls-backfill] failed:', e?.stack || e);
  process.exit(1);
});
