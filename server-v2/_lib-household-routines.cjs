'use strict';
/**
 * server-v2/_lib-household-routines.cjs — routines, habits and streaks.
 *
 * A routine is not a task. A task is done once and gone; a routine is a
 * recurring intention that never completes, it just gets done again tomorrow.
 * That is why they live in their own tables and never appear in the task lists:
 * mixing them means either your to-do list is permanently full of things you do
 * every single day, or your habits vanish the moment you tick them.
 *
 * Two tables: one row per routine, one row per (routine, day) tick.
 *
 * ── THE STREAK RULE ────────────────────────────────────────────────────────
 * A streak counts consecutive days completed, walking backwards from today —
 * but TODAY IS NOT COUNTED AGAINST YOU UNTIL IT'S OVER. If you haven't done
 * your morning routine yet at 7am, the walk starts from yesterday instead. A
 * streak that resets to zero every midnight and only recovers once you've done
 * the thing is punishing and, worse, wrong: you haven't broken anything at 7am.
 *
 * Every date here is a calendar day in the USER'S timezone, resolved before it
 * reaches SQL. Never `now()::date` — that rolls over at 8pm Eastern and would
 * tick the wrong day for the whole evening block.
 */

let libDb = null;
try { libDb = require('./_lib-db.cjs'); }
catch (e) { console.warn('[hh-routines] _lib-db.cjs not loaded:', e.message); }

const available = () => !!libDb;

const BLOCKS = ['morning', 'afternoon', 'evening'];
const normBlock = (v) => (BLOCKS.includes(v) ? v : 'morning');

// Same predicate as everywhere else in this app: yours, or shared with you.
const VISIBLE = `(owner_id = $1 OR visibility = 'shared')`;

const HISTORY_DAYS = 30;   // the bar chart
const STREAK_LOOKBACK = 400; // enough for a year-long streak plus slack

const pad = (n) => String(n).padStart(2, '0');

function isoDate(dt) {
  return `${dt.getFullYear()}-${pad(dt.getMonth() + 1)}-${pad(dt.getDate())}`;
}

/** Shift a 'YYYY-MM-DD' by whole days without ever touching a timezone. */
function addDays(iso, days) {
  const [y, m, d] = iso.split('-').map(Number);
  return isoDate(new Date(y, m - 1, d + days));
}

function todayIn(tz = 'America/New_York') {
  const p = new Intl.DateTimeFormat('en-US', {
    timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(new Date());
  const m = {};
  p.forEach((x) => { m[x.type] = x.value; });
  return `${m.year}-${m.month}-${m.day}`;
}

/**
 * Consecutive days completed, ending today or yesterday.
 *
 * `days` is a Set of 'YYYY-MM-DD'. See THE STREAK RULE above for why an
 * unfinished today doesn't break it.
 */
function currentStreak(days, today) {
  let cursor = days.has(today) ? today : addDays(today, -1);
  // If yesterday is also missing, the streak really is over.
  if (!days.has(cursor)) return 0;
  let n = 0;
  while (days.has(cursor) && n < STREAK_LOOKBACK) {
    n++;
    cursor = addDays(cursor, -1);
  }
  return n;
}

/** Longest run anywhere in the window — the number worth beating. */
function bestStreak(days) {
  const sorted = [...days].sort();
  let best = 0, run = 0, prev = null;
  for (const d of sorted) {
    run = (prev && addDays(prev, 1) === d) ? run + 1 : 1;
    if (run > best) best = run;
    prev = d;
  }
  return best;
}

// ---------------------------------------------------------------------------
// Read
// ---------------------------------------------------------------------------

/**
 * Every routine visible to this user, grouped by block, with today's tick state,
 * streaks, and a 30-day completion history.
 *
 * One query for the routines and one for the log — not one per routine. With
 * twenty habits that would be twenty-one round trips on a phone.
 */
async function getRoutines(userId, tz = 'America/New_York', dateStr) {
  const pool = libDb.getPool();
  const today = todayIn(tz);
  const day = /^\d{4}-\d{2}-\d{2}$/.test(String(dateStr || '')) ? dateStr : today;
  const since = addDays(day, -STREAK_LOOKBACK);

  const [{ rows: routines }, { rows: log }] = await Promise.all([
    pool.query(
      `SELECT id, owner_id, visibility, title, block, sort_order, active, created_at
         FROM hh_routines WHERE ${VISIBLE} AND active = TRUE
        ORDER BY CASE block WHEN 'morning' THEN 0 WHEN 'afternoon' THEN 1 ELSE 2 END,
                 sort_order, id`, [userId]),
    pool.query(
      `SELECT l.routine_id, to_char(l.day,'YYYY-MM-DD') AS day, l.done_by
         FROM hh_routine_log l JOIN hh_routines r ON r.id = l.routine_id
        WHERE ${VISIBLE.replace(/owner_id/g, 'r.owner_id').replace(/visibility/g, 'r.visibility')}
          AND l.day >= $2::date`, [userId, since]),
  ]);

  const byRoutine = new Map();
  for (const r of log) {
    if (!byRoutine.has(r.routine_id)) byRoutine.set(r.routine_id, new Set());
    byRoutine.get(r.routine_id).add(r.day);
  }

  // The 30-day window, oldest first, so the chart reads left-to-right.
  const window = [];
  for (let i = HISTORY_DAYS - 1; i >= 0; i--) window.push(addDays(day, -i));

  const items = routines.map((r) => {
    const days = byRoutine.get(r.id) || new Set();
    const recent = window.filter((d) => days.has(d)).length;
    return {
      id: r.id,
      ownerId: r.owner_id,
      visibility: r.visibility,
      title: r.title,
      block: r.block,
      sortOrder: r.sort_order,
      done: days.has(day),
      streak: currentStreak(days, today),
      best: bestStreak(days),
      last30: recent,
      // Only count days since it existed, or a habit added yesterday reads as
      // 3% consistent instead of 100%.
      history: window.map((d) => ({ day: d, done: days.has(d) })),
    };
  });

  const blocks = BLOCKS.map((b) => {
    const list = items.filter((i) => i.block === b);
    return {
      block: b,
      items: list,
      done: list.filter((i) => i.done).length,
      total: list.length,
    };
  });

  // Household-wide completion per day, for the summary chart.
  const dayTotals = window.map((d) => {
    const done = items.filter((i) => (byRoutine.get(i.id) || new Set()).has(d)).length;
    return { day: d, done, total: items.length };
  });

  return {
    date: day,
    today,
    blocks,
    total: items.length,
    doneToday: items.filter((i) => i.done).length,
    history: dayTotals,
  };
}

/** The one-line version for the Today screen. */
async function summary(userId, tz = 'America/New_York') {
  const r = await getRoutines(userId, tz);
  return { done: r.doneToday, total: r.total, date: r.date };
}

// ---------------------------------------------------------------------------
// Write
// ---------------------------------------------------------------------------

async function create(userId, { title, block, visibility }) {
  const pool = libDb.getPool();
  const text = String(title || '').trim().slice(0, 200);
  if (!text) throw new Error('Give it a name.');
  const b = normBlock(block);
  // New items land at the bottom of their block rather than the top — a routine
  // list is a sequence you work through, not a feed.
  const { rows: [max] } = await pool.query(
    `SELECT COALESCE(MAX(sort_order), 0) AS m FROM hh_routines WHERE owner_id=$1 AND block=$2`,
    [userId, b]);
  const { rows } = await pool.query(
    `INSERT INTO hh_routines (owner_id, visibility, title, block, sort_order)
     VALUES ($1,$2,$3,$4,$5)
     RETURNING id, owner_id, visibility, title, block, sort_order, active`,
    [userId, visibility === 'shared' ? 'shared' : 'private', text, b, Number(max.m) + 10]);
  return rows[0];
}

async function update(userId, id, patch) {
  const pool = libDb.getPool();
  const sets = [];
  const vals = [userId, id];
  const put = (col, v) => { vals.push(v); sets.push(`${col}=$${vals.length}`); };
  if (patch.title !== undefined) {
    const t = String(patch.title).trim().slice(0, 200);
    if (!t) throw new Error('Give it a name.');
    put('title', t);
  }
  if (patch.block !== undefined) put('block', normBlock(patch.block));
  if (patch.visibility !== undefined) put('visibility', patch.visibility === 'shared' ? 'shared' : 'private');
  if (patch.sortOrder !== undefined) put('sort_order', Number(patch.sortOrder) || 0);
  if (!sets.length) throw new Error('Nothing to update.');
  const { rows } = await pool.query(
    `UPDATE hh_routines SET ${sets.join(', ')} WHERE id=$2 AND ${VISIBLE}
     RETURNING id, owner_id, visibility, title, block, sort_order, active`, vals);
  if (!rows[0]) throw new Error('Not found.');
  return rows[0];
}

/**
 * Archive rather than delete. The log rows would cascade away with the routine,
 * and losing a 90-day streak because you tidied your list is the kind of thing
 * that makes people stop using an app. `active = FALSE` hides it and keeps the
 * history — a real delete stays available for a routine you never wanted.
 */
async function archive(userId, id) {
  const { rowCount } = await libDb.getPool().query(
    `UPDATE hh_routines SET active = FALSE WHERE id=$2 AND owner_id=$1`, [userId, id]);
  if (!rowCount) throw new Error('Only the person who added it can remove it.');
  return true;
}

async function remove(userId, id) {
  const { rowCount } = await libDb.getPool().query(
    `DELETE FROM hh_routines WHERE id=$2 AND owner_id=$1`, [userId, id]);
  if (!rowCount) throw new Error('Only the person who added it can delete it.');
  return true;
}

/**
 * Tick or un-tick one day. Idempotent by (routine_id, day) — a double tap can't
 * double-log, and a shared routine ticked by either person is done for both.
 */
async function toggle(userId, id, tz = 'America/New_York', dateStr) {
  const pool = libDb.getPool();
  const day = /^\d{4}-\d{2}-\d{2}$/.test(String(dateStr || '')) ? dateStr : todayIn(tz);

  // Permission is checked here rather than trusted from the client: without it,
  // anyone could tick the other person's private routine by guessing an id.
  const { rows: [routine] } = await pool.query(
    `SELECT id FROM hh_routines WHERE id=$2 AND ${VISIBLE}`, [userId, id]);
  if (!routine) throw new Error('Not found.');

  const { rowCount } = await pool.query(
    `DELETE FROM hh_routine_log WHERE routine_id=$1 AND day=$2::date`, [id, day]);
  if (rowCount) return { done: false, day };

  await pool.query(
    `INSERT INTO hh_routine_log (routine_id, day, done_by) VALUES ($1,$2::date,$3)
     ON CONFLICT (routine_id, day) DO NOTHING`, [id, day, userId]);
  return { done: true, day };
}

module.exports = {
  available, BLOCKS,
  getRoutines, summary, create, update, archive, remove, toggle,
  // exported for tests
  currentStreak, bestStreak, addDays, todayIn,
};
