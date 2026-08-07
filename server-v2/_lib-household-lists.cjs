'use strict';
/**
 * server-v2/_lib-household-lists.cjs — meals by day, and the grocery list.
 *
 * Three views over TWO tables, deliberately:
 *
 *   Week  — meals per day, with each meal's items nested underneath.
 *   Shop  — every unchecked grocery item in the week, grouped by aisle.
 *   Lists — the plain grocery list, plus anything not tied to a meal.
 *
 * They are views, not copies. Ticking "tortillas" in the shop marks the SAME
 * row that sits under Tuesday on the week board. Any design where the shopping
 * list is generated as separate rows ends with the two disagreeing about what
 * you actually bought.
 *
 * Lists default to `shared`. A private grocery list in a two-person house is
 * the wrong default — you are both shopping from it. (Tasks default the other
 * way, because a task is usually yours.)
 */

let libDb = null;
try { libDb = require('./_lib-db.cjs'); }
catch (e) { console.warn('[hh-lists] _lib-db.cjs not loaded:', e.message); }

const available = () => !!libDb;

const VISIBLE = `(owner_id = $1 OR visibility = 'shared')`;

// Everything in this app is shared — see the migration in _lib-household.cjs.
// The incoming `visibility` argument is accepted and ignored rather than
// removed from the signatures, so reverting the policy is one constant.
const SHARED = 'shared';

/**
 * Aisle order is store order, not alphabetical — the whole point is walking the
 * shop once. 'other' is last because unknowns belong at the end, not the middle.
 */
const AISLES = ['produce', 'meat', 'dairy', 'bakery', 'frozen', 'pantry', 'household', 'other'];
const normAisle = (v) => (AISLES.includes(String(v || '').toLowerCase()) ? String(v).toLowerCase() : 'other');

/**
 * A small keyword guess so adding "chicken thighs" lands in Meat without the
 * user picking an aisle. Deliberately conservative: a wrong guess is worse than
 * 'other', because a misfiled item is one you walk past.
 */
const AISLE_HINTS = [
  ['produce', /\b(apple|banana|lettuce|romaine|spinach|onion|potato|tomato|carrot|celery|pepper|garlic|lemon|lime|avocado|broccoli|cucumber|berr|grape|salad|herb|cilantro|kale)\w*/i],
  ['meat', /\b(chicken|beef|pork|steak|bacon|sausage|turkey|ham|mince|ground|fish|salmon|shrimp|tilapia)\w*/i],
  ['dairy', /\b(milk|cheese|yogurt|butter|cream|egg|sour cream|half and half)\w*/i],
  ['bakery', /\b(bread|bagel|bun|roll|tortilla|muffin|croissant|pita)\w*/i],
  ['frozen', /\b(frozen|ice cream|pizza|waffle)\w*/i],
  ['household', /\b(paper towel|toilet|detergent|soap|trash bag|foil|wrap|napkin|sponge|shampoo|batter(y|ies))\w*/i],
  ['pantry', /\b(rice|pasta|bean|sauce|oil|vinegar|flour|sugar|cereal|coffee|tea|spice|salt|pepper|can|soup|stock|broth|chip|cracker|peanut butter|jelly)\w*/i],
];
function guessAisle(text) {
  for (const [aisle, re] of AISLE_HINTS) if (re.test(text)) return aisle;
  return 'other';
}

const str = (v, max) => String(v ?? '').trim().slice(0, max);
const isDate = (v) => /^\d{4}-\d{2}-\d{2}$/.test(String(v || ''));

const pad = (n) => String(n).padStart(2, '0');
const isoOf = (dt) => `${dt.getFullYear()}-${pad(dt.getMonth() + 1)}-${pad(dt.getDate())}`;

function addDays(iso, days) {
  const [y, m, d] = iso.split('-').map(Number);
  return isoOf(new Date(y, m - 1, d + days));
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
 * The Monday on or before `iso`.
 *
 * Monday, not Sunday: a meal plan is a working week, and starting on Sunday
 * puts tonight's dinner at the far right of the board every Sunday evening.
 */
function weekStart(iso) {
  const [y, m, d] = iso.split('-').map(Number);
  const dt = new Date(y, m - 1, d);
  const back = (dt.getDay() + 6) % 7; // Sun=0 -> 6, Mon=1 -> 0
  return addDays(iso, -back);
}

// ---------------------------------------------------------------------------
// Read
// ---------------------------------------------------------------------------

// created_at is sent so the list can show WHEN something was added. On a shared
// list that is the difference between "we still need milk" and "someone put
// milk on here three weeks ago and we've bought it twice since".
const ITEM_COLS = `id, owner_id, visibility, list, text, qty, aisle, meal_id,
  checked_at, checked_by, sort_order, created_at`;

/**
 * Everything the Lists screen needs, in one round trip: the week's meals, every
 * item, and the aisle-grouped shopping view derived from the same rows.
 */
async function getWeek(userId, tz = 'America/New_York', dateStr) {
  const pool = libDb.getPool();
  const today = todayIn(tz);
  const anchor = isDate(dateStr) ? dateStr : today;
  const start = weekStart(anchor);
  const end = addDays(start, 6);

  const [{ rows: meals }, { rows: items }] = await Promise.all([
    pool.query(
      `SELECT id, owner_id, visibility, to_char(day,'YYYY-MM-DD') AS day, title, notes, sort_order
         FROM hh_meals WHERE ${VISIBLE} AND day BETWEEN $2::date AND $3::date
        ORDER BY day, sort_order, id`, [userId, start, end]),
    pool.query(
      `SELECT ${ITEM_COLS} FROM hh_list_items WHERE ${VISIBLE}
        ORDER BY sort_order, id`, [userId]),
  ]);

  const byMeal = new Map();
  for (const it of items) {
    if (!it.meal_id) continue;
    if (!byMeal.has(it.meal_id)) byMeal.set(it.meal_id, []);
    byMeal.get(it.meal_id).push(it);
  }

  const days = [];
  for (let i = 0; i < 7; i++) {
    const day = addDays(start, i);
    const dayMeals = meals.filter((m) => m.day === day)
      .map((m) => ({ ...m, items: byMeal.get(m.id) || [] }));
    days.push({
      day,
      isToday: day === today,
      meals: dayMeals,
      // Per-day counts so the board can show "2 items" without the client
      // re-deriving it from nested arrays.
      itemCount: dayMeals.reduce((n, m) => n + m.items.length, 0),
      openCount: dayMeals.reduce((n, m) => n + m.items.filter((x) => !x.checked_at).length, 0),
    });
  }

  const grocery = items.filter((i) => i.list === 'grocery');
  const open = grocery.filter((i) => !i.checked_at);
  const checked = grocery.filter((i) => i.checked_at);

  // Aisle order is store order (see AISLES), and empty aisles are dropped so the
  // shop view is exactly as long as the walk.
  const aisles = AISLES
    .map((aisle) => ({ aisle, items: open.filter((i) => i.aisle === aisle) }))
    .filter((g) => g.items.length > 0);

  const other = items.filter((i) => i.list !== 'grocery');

  return {
    weekStart: start,
    weekEnd: end,
    today,
    days,
    aisles,
    checked,
    other,
    counts: {
      open: open.length,
      checked: checked.length,
      total: grocery.length,
      meals: meals.length,
    },
    aisleOptions: AISLES,
  };
}

// ---------------------------------------------------------------------------
// Write — items
// ---------------------------------------------------------------------------

async function addItem(userId, { text, qty, aisle, list, mealId, visibility }) {
  const pool = libDb.getPool();
  const t = str(text, 200);
  if (!t) throw new Error('What are we adding?');

  // A meal's item inherits nothing from the caller's aisle guess if the meal
  // isn't actually visible to them — checked here, not trusted.
  let meal = null;
  if (mealId) {
    const { rows } = await pool.query(
      `SELECT id FROM hh_meals WHERE id=$2 AND ${VISIBLE}`, [userId, Number(mealId)]);
    if (!rows[0]) throw new Error('Not found.');
    meal = rows[0].id;
  }

  const { rows: [max] } = await pool.query(
    `SELECT COALESCE(MAX(sort_order),0) AS m FROM hh_list_items WHERE list=$1`, [str(list, 30) || 'grocery']);

  const { rows } = await pool.query(
    `INSERT INTO hh_list_items (owner_id, visibility, list, text, qty, aisle, meal_id, sort_order)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING ${ITEM_COLS}`,
    [userId, SHARED, str(list, 30) || 'grocery',
     t, str(qty, 40) || null, aisle ? normAisle(aisle) : guessAisle(t), meal, Number(max.m) + 10]);
  return rows[0];
}

/**
 * Tick / untick. Idempotent in the sense that it always ends in a known state,
 * and it records WHO — in a shop, "did you already get milk?" is the question
 * this answers.
 */
async function toggleItem(userId, id) {
  const { rows } = await libDb.getPool().query(
    `UPDATE hh_list_items
        SET checked_at = CASE WHEN checked_at IS NULL THEN now() ELSE NULL END,
            checked_by = CASE WHEN checked_at IS NULL THEN $1::int ELSE NULL END
      WHERE id=$2 AND ${VISIBLE} RETURNING ${ITEM_COLS}`, [userId, id]);
  if (!rows[0]) throw new Error('Not found.');
  return rows[0];
}

async function updateItem(userId, id, patch) {
  const sets = [];
  const vals = [userId, id];
  const put = (col, v) => { vals.push(v); sets.push(`${col}=$${vals.length}`); };
  if (patch.text !== undefined) {
    const t = str(patch.text, 200);
    if (!t) throw new Error('Give it a name.');
    put('text', t);
  }
  if (patch.qty !== undefined) put('qty', str(patch.qty, 40) || null);
  if (patch.aisle !== undefined) put('aisle', normAisle(patch.aisle));
  if (patch.visibility !== undefined) put('visibility', SHARED);
  if (!sets.length) throw new Error('Nothing to update.');
  const { rows } = await libDb.getPool().query(
    `UPDATE hh_list_items SET ${sets.join(', ')} WHERE id=$2 AND ${VISIBLE} RETURNING ${ITEM_COLS}`, vals);
  if (!rows[0]) throw new Error('Not found.');
  return rows[0];
}

async function deleteItem(userId, id) {
  const { rowCount } = await libDb.getPool().query(
    `DELETE FROM hh_list_items WHERE id=$2 AND ${VISIBLE}`, [userId, id]);
  if (!rowCount) throw new Error('Not found.');
  return true;
}

/**
 * Clear what's in the cart — the end of a shop.
 *
 * DELETES the checked rows rather than un-ticking them: an item you bought is
 * done, and leaving it around means next week's list starts with last week's
 * shopping already crossed off. Items still attached to a meal are kept, so the
 * week board doesn't lose Tuesday's ingredient list.
 */
async function clearChecked(userId) {
  const { rowCount } = await libDb.getPool().query(
    `DELETE FROM hh_list_items
      WHERE checked_at IS NOT NULL AND meal_id IS NULL AND ${VISIBLE}`, [userId]);
  return rowCount;
}

// ---------------------------------------------------------------------------
// Write — meals
// ---------------------------------------------------------------------------

async function addMeal(userId, { day, title, notes, visibility }) {
  const pool = libDb.getPool();
  if (!isDate(day)) throw new Error('Pick a day.');
  const t = str(title, 200);
  if (!t) throw new Error("What's for dinner?");
  const { rows: [max] } = await pool.query(
    `SELECT COALESCE(MAX(sort_order),0) AS m FROM hh_meals WHERE day=$1::date`, [day]);
  const { rows } = await pool.query(
    `INSERT INTO hh_meals (owner_id, visibility, day, title, notes, sort_order)
     VALUES ($1,$2,$3::date,$4,$5,$6)
     RETURNING id, owner_id, visibility, to_char(day,'YYYY-MM-DD') AS day, title, notes, sort_order`,
    [userId, SHARED, day, t,
     str(notes, 2000) || null, Number(max.m) + 10]);
  return { ...rows[0], items: [] };
}

async function updateMeal(userId, id, patch) {
  const sets = [];
  const vals = [userId, id];
  const put = (col, v) => { vals.push(v); sets.push(`${col}=$${vals.length}`); };
  if (patch.title !== undefined) {
    const t = str(patch.title, 200);
    if (!t) throw new Error('Give it a name.');
    put('title', t);
  }
  if (patch.notes !== undefined) put('notes', str(patch.notes, 2000) || null);
  if (patch.day !== undefined) {
    if (!isDate(patch.day)) throw new Error('Pick a day.');
    put('day', patch.day);
  }
  if (!sets.length) throw new Error('Nothing to update.');
  const { rows } = await libDb.getPool().query(
    `UPDATE hh_meals SET ${sets.join(', ')} WHERE id=$2 AND ${VISIBLE}
     RETURNING id, owner_id, visibility, to_char(day,'YYYY-MM-DD') AS day, title, notes, sort_order`, vals);
  if (!rows[0]) throw new Error('Not found.');
  return rows[0];
}

/** Deleting a meal keeps its items — see the ON DELETE SET NULL in the schema. */
async function deleteMeal(userId, id) {
  const { rowCount } = await libDb.getPool().query(
    `DELETE FROM hh_meals WHERE id=$2 AND ${VISIBLE}`, [userId, id]);
  if (!rowCount) throw new Error('Not found.');
  return true;
}

/** The one-line summary for Today. */
async function summary(userId, tz = 'America/New_York') {
  const pool = libDb.getPool();
  const today = todayIn(tz);
  const [{ rows: open }, { rows: meal }] = await Promise.all([
    pool.query(`SELECT COUNT(*)::int AS n FROM hh_list_items
                 WHERE list='grocery' AND checked_at IS NULL AND ${VISIBLE}`, [userId]),
    pool.query(`SELECT title FROM hh_meals WHERE day=$2::date AND ${VISIBLE}
                 ORDER BY sort_order, id LIMIT 1`, [userId, today]),
  ]);
  return { groceryOpen: open[0]?.n ?? 0, tonight: meal[0]?.title ?? null };
}

module.exports = {
  available, AISLES, guessAisle, weekStart, addDays, todayIn,
  getWeek, summary,
  addItem, toggleItem, updateItem, deleteItem, clearChecked,
  addMeal, updateMeal, deleteMeal,
};
