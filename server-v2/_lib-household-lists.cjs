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
      // LEFT JOIN the meal list so the week can show a dinner's link, category
      // and "made" count without a second request.
      `SELECT m.id, m.owner_id, m.visibility, to_char(m.day,'YYYY-MM-DD') AS day, m.title, m.notes,
              m.library_id, m.sort_order,
              l.url, l.source, l.category, l.made_count, to_char(l.last_made,'YYYY-MM-DD') AS last_made
         FROM hh_meals m LEFT JOIN hh_meal_library l ON l.id = m.library_id
        WHERE (m.owner_id = $1 OR m.visibility = 'shared') AND m.day BETWEEN $2::date AND $3::date
        ORDER BY m.day, m.sort_order, m.id`, [userId, start, end]),
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

  // An item can belong to a meal in ANY week — the `meals` query above only
  // covers the seven days on screen. So look up every meal actually referenced
  // by a visible item and send a flat index of them. Without this, an
  // ingredient for next Tuesday's dinner shows on the plain list as a bare
  // "from a meal" with no way to find out which one.
  const refIds = [...new Set(items.map((i) => i.meal_id).filter(Boolean))];
  let mealRefs = [];
  if (refIds.length) {
    const { rows } = await pool.query(
      `SELECT id, to_char(day,'YYYY-MM-DD') AS day, title
         FROM hh_meals WHERE id = ANY($2::int[]) AND ${VISIBLE}`, [userId, refIds]);
    mealRefs = rows;
  }

  return {
    weekStart: start,
    weekEnd: end,
    today,
    days,
    aisles,
    checked,
    other,
    /** id → { day, title } for every meal any visible item points at, in or
     *  out of this week. The plain list names the meal from this. */
    mealRefs,
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

// ---------------------------------------------------------------------------
// Meals + the dinner week (Lists → Meals, Lists → Week)
// ---------------------------------------------------------------------------
//
// Meals tab: your own list of dinners (hh_meal_library), grouped by category
// (hh_meal_categories), each with an optional link — usually a TikTok — and a
// "made it" count. Independent of the Cookbook on purpose.
//
// Week tab: ONE dinner per day. "The dinner" for a day is its first hh_meals
// row (sort_order, id), the same row summary() calls "tonight". Days that
// already carry more than one meal keep the extras.

const DEFAULT_CATEGORIES = ['Chicken', 'Beef', 'Pork', 'Pasta', 'Seafood', 'Other'];
const OTHER = 'Other';
const LIB_COLS = `id, title, category, url, source,
  made_count, to_char(last_made,'YYYY-MM-DD') AS last_made`;

async function inTx(fn) {
  const client = await libDb.getPool().connect();
  try {
    await client.query('BEGIN');
    const out = await fn(client);
    await client.query('COMMIT');
    return out;
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {});
    throw e;
  } finally {
    client.release();
  }
}

/** First use seeds a starter set; after that "Other" is guaranteed to exist. */
async function ensureCategories(pool) {
  const { rows } = await pool.query(`SELECT COUNT(*)::int AS n FROM hh_meal_categories`);
  if (rows[0].n === 0) {
    for (let i = 0; i < DEFAULT_CATEGORIES.length; i++) {
      await pool.query(
        `INSERT INTO hh_meal_categories (name, sort_order) VALUES ($1,$2) ON CONFLICT (name) DO NOTHING`,
        [DEFAULT_CATEGORIES[i], (i + 1) * 10]);
    }
  } else {
    await pool.query(
      `INSERT INTO hh_meal_categories (name, sort_order)
       VALUES ($1, (SELECT COALESCE(MAX(sort_order),0)+10 FROM hh_meal_categories))
       ON CONFLICT (name) DO NOTHING`, [OTHER]);
  }
}

/** Everything the Meals tab draws, in one round trip. */
async function getMeals(userId) {
  const pool = libDb.getPool();
  await ensureCategories(pool);
  const [{ rows: categories }, { rows: meals }] = await Promise.all([
    pool.query(`SELECT id, name, sort_order FROM hh_meal_categories ORDER BY sort_order, id`),
    pool.query(`SELECT ${LIB_COLS} FROM hh_meal_library WHERE ${VISIBLE} ORDER BY lower(title)`, [userId]),
  ]);
  // A meal whose category row went missing (renamed elsewhere, hand-edited)
  // still has to show up somewhere.
  const names = new Set(categories.map((c) => c.name));
  for (const m of meals) if (!names.has(m.category)) m.category = OTHER;
  return { categories, meals };
}

// ── Link preview ─────────────────────────────────────────────────────────────

const sourceOf = (url) => {
  const h = (() => { try { return new URL(url).hostname; } catch { return ''; } })();
  if (/tiktok/i.test(h)) return 'TikTok';
  if (/instagram/i.test(h)) return 'Instagram';
  if (/youtu/i.test(h)) return 'YouTube';
  return 'Web';
};

function safeUrl(raw) {
  let u;
  try { u = new URL(String(raw || '').trim()); } catch { throw new Error("That doesn't look like a link."); }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') throw new Error('Only http and https links.');
  // A pasted link must not be able to probe the VPS's own network.
  if (/^(localhost$|127\.|10\.|0\.|192\.168\.|169\.254\.|172\.(1[6-9]|2\d|3[01])\.|\[?::1|\[?f[cd])/i.test(u.hostname)) {
    throw new Error('That address is not reachable from here.');
  }
  return u;
}

async function fetchText(url, accept) {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), 10_000);
  try {
    const res = await fetch(url, {
      signal: ctl.signal, redirect: 'follow',
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122 Safari/537.36',
        Accept: accept, 'Accept-Language': 'en-US,en;q=0.9',
      },
    });
    if (!res.ok) return null;
    const text = await res.text();
    return { text: text.slice(0, 1_500_000), finalUrl: res.url || url };
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

const decode = (s) => String(s || '')
  .replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'")
  .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)));

function meta(html, key) {
  const k = key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const res = [
    new RegExp(`<meta[^>]+(?:property|name)=["']${k}["'][^>]+content=["']([^"']*)["']`, 'i'),
    new RegExp(`<meta[^>]+content=["']([^"']*)["'][^>]+(?:property|name)=["']${k}["']`, 'i'),
  ];
  for (const re of res) { const m = html.match(re); if (m && m[1].trim()) return decode(m[1].trim()); }
  return null;
}

/**
 * A caption is not a title. Keep the first line / sentence, drop hashtags,
 * @mentions and emoji, and cap it — you can edit it before saving anyway.
 */
function tidyTitle(raw) {
  let t = String(raw || '').split(/\n/)[0];
  t = t.replace(/#[\wÀ-￿]+/g, ' ').replace(/@[\w.]+/g, ' ')
       .replace(/[\u{1F000}-\u{1FFFF}\u{2600}-\u{27BF}\u{FE0F}\u{200D}]/gu, ' ')
       .replace(/\s+/g, ' ').trim();
  const sentence = t.match(/^(.{12,}?[.!?])(\s|$)/);
  if (sentence) t = sentence[1].replace(/[.!]+$/, '');
  if (t.length > 80) t = t.slice(0, 80).replace(/\s+\S*$/, '') + '…';
  return t;
}

/** Best category for a title: the first of YOUR categories named in it. */
function guessCategory(text, categories) {
  const hay = ` ${String(text || '').toLowerCase()} `;
  const hit = categories.find((c) => c !== OTHER &&
    new RegExp(`\\b${c.toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}s?\\b`).test(hay));
  return hit || OTHER;
}

/**
 * Title + source for a pasted link. TikTok answers its public oEmbed endpoint
 * with the caption, which is far more reliable than scraping its client-
 * rendered page; everything else falls back to OpenGraph / <title>. Never
 * throws for an unreadable page — you get the link with an empty title and
 * type one yourself.
 */
async function previewLink(userId, rawUrl) {
  const u = safeUrl(rawUrl);
  let url = u.toString();
  let title = '';

  const oembed = async (link) => {
    const o = await fetchText(`https://www.tiktok.com/oembed?url=${encodeURIComponent(link)}`, 'application/json');
    try { return o ? (JSON.parse(o.text).title || '') : ''; } catch { return ''; }
  };
  if (/tiktok/i.test(u.hostname)) {
    title = await oembed(url);
    // Short share links (vm.tiktok.com/…) aren't accepted by oEmbed — follow
    // the redirect to the canonical /@user/video/<id> URL and ask again.
    if (!title) {
      const page = await fetchText(url, 'text/html');
      if (page && page.finalUrl && page.finalUrl !== url) {
        url = page.finalUrl.split('?')[0];
        title = await oembed(url);
      }
    }
  }
  if (!title) {
    const page = await fetchText(url, 'text/html,application/xhtml+xml');
    if (page) {
      url = page.finalUrl || url;
      const h = page.text;
      title = meta(h, 'og:title') || meta(h, 'twitter:title') ||
        decode((h.match(/<title[^>]*>([^<]*)<\/title>/i) || [])[1] || '') || meta(h, 'og:description') || '';
    }
  }
  // A site's own name is not a meal name ("TikTok - Make Your Day").
  if (/^(tiktok|instagram|youtube)\b/i.test(title.trim())) title = '';
  const { categories } = await getMeals(userId);
  const clean = tidyTitle(title);
  return {
    url, source: sourceOf(url), title: clean,
    category: guessCategory(`${clean} ${title}`, categories.map((c) => c.name)),
  };
}

// ── Meals ────────────────────────────────────────────────────────────────────

async function addLibraryMeal(userId, { title, category, url }) {
  const t = str(title, 200);
  if (!t) throw new Error('Name the meal.');
  const link = url ? safeUrl(url).toString() : null;
  const { rows } = await libDb.getPool().query(
    `INSERT INTO hh_meal_library (owner_id, visibility, title, category, url, source)
     VALUES ($1,$2,$3,$4,$5,$6) RETURNING ${LIB_COLS}`,
    [userId, SHARED, t, str(category, 60) || OTHER, link, link ? sourceOf(link) : null]);
  return rows[0];
}

async function updateLibraryMeal(userId, id, patch) {
  const sets = [];
  const vals = [userId, id];
  const put = (col, v) => { vals.push(v); sets.push(`${col}=$${vals.length}`); };
  if (patch.title !== undefined) {
    const t = str(patch.title, 200);
    if (!t) throw new Error('Give it a name.');
    put('title', t);
  }
  if (patch.category !== undefined) put('category', str(patch.category, 60) || OTHER);
  if (patch.url !== undefined) {
    const link = patch.url ? safeUrl(patch.url).toString() : null;
    put('url', link);
    put('source', link ? sourceOf(link) : null);
  }
  if (!sets.length) throw new Error('Nothing to update.');
  const { rows } = await libDb.getPool().query(
    `UPDATE hh_meal_library SET ${sets.join(', ')} WHERE id=$2 AND ${VISIBLE} RETURNING ${LIB_COLS}`, vals);
  if (!rows[0]) throw new Error('Not found.');
  // A planned dinner shows the meal's name — keep them in step on rename.
  if (patch.title !== undefined) {
    await libDb.getPool().query(`UPDATE hh_meals SET title=$2 WHERE library_id=$1`, [id, rows[0].title]);
  }
  return rows[0];
}

/** Removes the meal from the list only — days it was planned on keep it. */
async function deleteLibraryMeal(userId, id) {
  const { rowCount } = await libDb.getPool().query(
    `DELETE FROM hh_meal_library WHERE id=$2 AND ${VISIBLE}`, [userId, id]);
  if (!rowCount) throw new Error('Not found.');
  return true;
}

/** "Made it" +1 (today), or undo the last one. */
async function markMade(userId, id, { undo = false, tz = 'America/New_York' } = {}) {
  const sql = undo
    ? `UPDATE hh_meal_library SET made_count = GREATEST(made_count-1, 0),
         last_made = CASE WHEN made_count <= 1 THEN NULL ELSE last_made END
       WHERE id=$2 AND ${VISIBLE} RETURNING ${LIB_COLS}`
    : `UPDATE hh_meal_library SET made_count = made_count+1, last_made = $3::date
       WHERE id=$2 AND ${VISIBLE} RETURNING ${LIB_COLS}`;
  const { rows } = await libDb.getPool().query(sql, undo ? [userId, id] : [userId, id, todayIn(tz)]);
  if (!rows[0]) throw new Error('Not found.');
  return rows[0];
}

// ── Categories ───────────────────────────────────────────────────────────────

async function addCategory(name) {
  const n = str(name, 60);
  if (!n) throw new Error('Name the category.');
  const pool = libDb.getPool();
  // New categories go just above "Other", which stays last until you move it.
  const { rows: [o] } = await pool.query(`SELECT sort_order FROM hh_meal_categories WHERE name=$1`, [OTHER]);
  const at = o ? o.sort_order : 1000;
  await pool.query(`UPDATE hh_meal_categories SET sort_order = sort_order + 10 WHERE sort_order >= $1`, [at]);
  const { rows } = await pool.query(
    `INSERT INTO hh_meal_categories (name, sort_order) VALUES ($1,$2)
     ON CONFLICT (name) DO NOTHING RETURNING id, name, sort_order`, [n, at]);
  if (!rows[0]) throw new Error('That category already exists.');
  return rows[0];
}

async function renameCategory(id, name) {
  const n = str(name, 60);
  if (!n) throw new Error('Name the category.');
  return inTx(async (c) => {
    const { rows: [cur] } = await c.query(`SELECT name FROM hh_meal_categories WHERE id=$1`, [id]);
    if (!cur) throw new Error('Not found.');
    if (cur.name === OTHER) throw new Error('"Other" keeps its name.');
    const { rows: [dupe] } = await c.query(`SELECT 1 FROM hh_meal_categories WHERE name=$1 AND id<>$2`, [n, id]);
    if (dupe) throw new Error('That category already exists.');
    await c.query(`UPDATE hh_meal_categories SET name=$2 WHERE id=$1`, [id, n]);
    await c.query(`UPDATE hh_meal_library SET category=$2 WHERE category=$1`, [cur.name, n]);
    return true;
  });
}

/** Swap with the neighbour above (dir -1) or below (+1). */
async function moveCategory(id, dir) {
  return inTx(async (c) => {
    const { rows } = await c.query(`SELECT id, sort_order FROM hh_meal_categories ORDER BY sort_order, id`);
    const i = rows.findIndex((r) => r.id === id);
    const j = i + (dir < 0 ? -1 : 1);
    if (i < 0 || j < 0 || j >= rows.length) return true;
    // Renumber the whole list so ties from old data can't make a swap a no-op.
    const order = rows.map((r) => r.id);
    [order[i], order[j]] = [order[j], order[i]];
    for (let k = 0; k < order.length; k++) {
      await c.query(`UPDATE hh_meal_categories SET sort_order=$2 WHERE id=$1`, [order[k], (k + 1) * 10]);
    }
    return true;
  });
}

/** Its meals move to "Other" — nothing is lost. */
async function deleteCategory(id) {
  return inTx(async (c) => {
    const { rows: [cur] } = await c.query(`SELECT name FROM hh_meal_categories WHERE id=$1`, [id]);
    if (!cur) throw new Error('Not found.');
    if (cur.name === OTHER) throw new Error('"Other" catches everything and can\'t be deleted.');
    await c.query(`UPDATE hh_meal_library SET category=$2 WHERE category=$1`, [cur.name, OTHER]);
    await c.query(`DELETE FROM hh_meal_categories WHERE id=$1`, [id]);
    return true;
  });
}

// ── Planning ─────────────────────────────────────────────────────────────────

async function dinnerOn(client, userId, day) {
  const { rows } = await client.query(
    `SELECT id, sort_order FROM hh_meals WHERE day=$2::date AND ${VISIBLE}
      ORDER BY sort_order, id LIMIT 1`, [userId, day]);
  return rows[0] || null;
}

/**
 * Set a day's dinner. REPLACES the existing dinner rather than renaming it:
 * the old dinner's ingredients belong to the old dish, so they drop back onto
 * the grocery list unattached (ON DELETE SET NULL).
 */
async function setDinnerIn(client, userId, { day, title, libraryId }) {
  const old = await dinnerOn(client, userId, day);
  if (old) await client.query(`DELETE FROM hh_meals WHERE id=$1`, [old.id]);
  const { rows } = await client.query(
    `INSERT INTO hh_meals (owner_id, visibility, day, title, library_id, sort_order)
     VALUES ($1,$2,$3::date,$4,$5,$6)
     RETURNING id, owner_id, visibility, to_char(day,'YYYY-MM-DD') AS day, title, notes, library_id, sort_order`,
    [userId, SHARED, day, title, libraryId || null, old ? old.sort_order : 10]);
  return { ...rows[0], items: [] };
}

async function setDinner(userId, { day, title, libraryId }) {
  if (!isDate(day)) throw new Error('Pick a day.');
  let t = str(title, 200);
  const lid = libraryId ? Number(libraryId) : null;
  if (lid) {
    const { rows } = await libDb.getPool().query(
      `SELECT title FROM hh_meal_library WHERE id=$2 AND ${VISIBLE}`, [userId, lid]);
    if (!rows[0]) throw new Error('Meal not found.');
    t = rows[0].title;
  }
  if (!t) throw new Error("What's for dinner?");
  return inTx((c) => setDinnerIn(c, userId, { day, title: t, libraryId: lid }));
}

/**
 * The Meals tab's day picker: put this meal on `day` for the week containing
 * `week`, taking it off any other day of THAT week. `day` null = not planned
 * this week. Other weeks are left alone — Tuesday's tacos last week are
 * history, not a conflict.
 */
async function planLibraryMeal(userId, { libraryId, day, week }) {
  const lid = Number(libraryId);
  if (!lid) throw new Error('Meal not found.');
  if (day && !isDate(day)) throw new Error('Pick a day.');
  const anchor = day || (isDate(week) ? week : todayIn());
  const start = weekStart(anchor);
  const end = addDays(start, 6);
  const { rows } = await libDb.getPool().query(
    `SELECT title FROM hh_meal_library WHERE id=$2 AND ${VISIBLE}`, [userId, lid]);
  if (!rows[0]) throw new Error('Meal not found.');
  return inTx(async (c) => {
    await c.query(
      `DELETE FROM hh_meals WHERE library_id=$1 AND day BETWEEN $2::date AND $3::date
         AND ($4::date IS NULL OR day <> $4::date)`, [lid, start, end, day || null]);
    if (!day) return null;
    const cur = await dinnerOn(c, userId, day);
    if (cur) {
      const { rows: [same] } = await c.query(`SELECT library_id FROM hh_meals WHERE id=$1`, [cur.id]);
      if (same && same.library_id === lid) return true; // already there
    }
    return setDinnerIn(c, userId, { day, title: rows[0].title, libraryId: lid });
  });
}

/** Move a dinner to another day, swapping if that day already has one. */
async function moveDinner(userId, { from, to }) {
  if (!isDate(from) || !isDate(to)) throw new Error('Pick a day.');
  if (from === to) return true;
  return inTx(async (client) => {
    const a = await dinnerOn(client, userId, from);
    const b = await dinnerOn(client, userId, to);
    if (!a) throw new Error('Nothing to move.');
    await client.query(`UPDATE hh_meals SET day=$2::date, sort_order=$3 WHERE id=$1`,
      [a.id, to, b ? b.sort_order : 0]);
    if (b) await client.query(`UPDATE hh_meals SET day=$2::date, sort_order=$3 WHERE id=$1`,
      [b.id, from, a.sort_order]);
    return true;
  });
}

// ── Bulk import (paste box) ──────────────────────────────────────────────────
//
// One request, one INSERT, however many lines were pasted. Duplicates are
// skipped, never errors: re-pasting the same list is a no-op, not a mess.
// "Same" is case- and whitespace-insensitive ("Marry Me  Pasta" = "marry me
// pasta"), checked against what is already there AND within the paste itself.
// Deduped in code rather than by a unique index so existing rows (which may
// already hold near-duplicates) never block a deploy.

const IMPORT_MAX = 2000;
const nameKey = (s) => String(s || '').trim().replace(/\s+/g, ' ').toLowerCase();

/**
 * Grocery items. Only OPEN items count as "already on the list" — milk you
 * bought last week and ticked off is not a reason to refuse milk today.
 */
async function importItems(userId, rawItems) {
  const input = Array.isArray(rawItems) ? rawItems.slice(0, IMPORT_MAX) : [];
  const pool = libDb.getPool();
  const { rows: existing } = await pool.query(
    `SELECT text FROM hh_list_items
      WHERE list='grocery' AND checked_at IS NULL AND ${VISIBLE}`, [userId]);
  const seen = new Set(existing.map((r) => nameKey(r.text)));

  const texts = []; const qtys = []; const aisles = [];
  let skipped = 0;
  for (const it of input) {
    const t = str(it && it.text, 200);
    if (!t) continue;
    const k = nameKey(t);
    if (seen.has(k)) { skipped++; continue; }
    seen.add(k);
    texts.push(t);
    qtys.push(str(it.qty, 40) || null);
    aisles.push(it.aisle ? normAisle(it.aisle) : guessAisle(t));
  }
  if (!texts.length) return { added: 0, skipped };

  const { rows: [max] } = await pool.query(
    `SELECT COALESCE(MAX(sort_order),0) AS m FROM hh_list_items WHERE list='grocery'`);
  const { rowCount } = await pool.query(
    `INSERT INTO hh_list_items (owner_id, visibility, list, text, qty, aisle, sort_order)
     SELECT $1, $2, 'grocery', x.t, x.q, x.a, $6::int + (x.n::int * 10)
       FROM unnest($3::text[], $4::text[], $5::text[]) WITH ORDINALITY AS x(t, q, a, n)`,
    [userId, SHARED, texts, qtys, aisles, Number(max.m)]);
  return { added: rowCount, skipped };
}

/**
 * Meal library. A category that doesn't exist yet is created (just above
 * "Other", like addCategory); one that differs only in case maps onto the
 * existing name. A bad link keeps the meal and drops the link — the name is
 * what was asked for.
 */
async function importLibraryMeals(userId, rawMeals) {
  const input = Array.isArray(rawMeals) ? rawMeals.slice(0, IMPORT_MAX) : [];
  await ensureCategories(libDb.getPool());

  return inTx(async (c) => {
    const { rows: cats } = await c.query(
      `SELECT name, sort_order FROM hh_meal_categories ORDER BY sort_order, id`);
    const { rows: existing } = await c.query(
      `SELECT title FROM hh_meal_library WHERE ${VISIBLE}`, [userId]);
    const catByKey = new Map(cats.map((r) => [nameKey(r.name), r.name]));
    const seen = new Set(existing.map((r) => nameKey(r.title)));

    const titles = []; const categories = []; const urls = []; const sources = [];
    const newCats = [];
    let skipped = 0; let badLinks = 0;
    for (const m of input) {
      const t = str(m && m.title, 200);
      if (!t) continue;
      const k = nameKey(t);
      if (seen.has(k)) { skipped++; continue; }
      seen.add(k);

      let cat = str(m.category, 60) || OTHER;
      const ck = nameKey(cat);
      if (catByKey.has(ck)) cat = catByKey.get(ck);
      else { catByKey.set(ck, cat); newCats.push(cat); }

      let link = null;
      if (m.url) {
        try { link = safeUrl(m.url).toString(); } catch { badLinks++; }
      }
      titles.push(t); categories.push(cat); urls.push(link); sources.push(link ? sourceOf(link) : null);
    }

    if (newCats.length) {
      const o = cats.find((r) => r.name === OTHER);
      const at = o ? o.sort_order : 1000;
      await c.query(
        `UPDATE hh_meal_categories SET sort_order = sort_order + $2 WHERE sort_order >= $1`,
        [at, newCats.length * 10]);
      for (let i = 0; i < newCats.length; i++) {
        await c.query(
          `INSERT INTO hh_meal_categories (name, sort_order) VALUES ($1,$2) ON CONFLICT (name) DO NOTHING`,
          [newCats[i], at + i * 10]);
      }
    }

    let added = 0;
    if (titles.length) {
      const { rowCount } = await c.query(
        `INSERT INTO hh_meal_library (owner_id, visibility, title, category, url, source)
         SELECT $1, $2, x.t, x.c, x.u, x.s
           FROM unnest($3::text[], $4::text[], $5::text[], $6::text[]) AS x(t, c, u, s)`,
        [userId, SHARED, titles, categories, urls, sources]);
      added = rowCount;
    }
    return { added, skipped, badLinks, categoriesAdded: newCats };
  });
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
  getMeals, previewLink, addLibraryMeal, updateLibraryMeal, deleteLibraryMeal, markMade,
  addCategory, renameCategory, moveCategory, deleteCategory,
  setDinner, planLibraryMeal, moveDinner,
  importItems, importLibraryMeals,
};
