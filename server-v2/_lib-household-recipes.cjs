'use strict';
/**
 * server-v2/_lib-household-recipes.cjs — the cookbook behind recipe.cbedge.net.
 *
 * Three jobs, in order of how much of this file they take up:
 *
 *   1. IMPORT. Paste a link, get a recipe. Structured data first (schema.org
 *      JSON-LD, which most food blogs already publish because Google demands
 *      it), Claude only when that isn't there. That order matters: JSON-LD is
 *      free, instant and exact, and an LLM asked to re-read a page that already
 *      told us the answer is a way to pay money for a worse result.
 *   2. STORE. One row per recipe. Ingredients and steps live in JSONB on that
 *      row, not in child tables — see the schema note in _lib-household.cjs.
 *   3. HAND OFF. "Add all" writes real hh_list_items rows and "cook Tuesday"
 *      writes a real hh_meals row, so a recipe imported here shows up on
 *      budget.cbedge.net's grocery list and week board with no sync step. The
 *      cookbook is a source of items; the list app stays the one owner of them.
 *
 * The visibility rule is the household one — see household-routes.cjs. Every
 * row is shared: two people, one kitchen.
 */

let libDb = null;
try { libDb = require('./_lib-db.cjs'); }
catch (e) { console.warn('[hh-recipes] _lib-db.cjs not loaded:', e.message); }

// Aisle guessing is the list module's job and it already does it well. Reused
// rather than reimplemented so an ingredient added from a recipe files itself
// into exactly the same aisle it would have if you'd typed it on the list.
let hlists = null;
try { hlists = require('./_lib-household-lists.cjs'); }
catch (e) { console.warn('[hh-recipes] lists lib not loaded:', e.message); }

const available = () => !!libDb;

const VISIBLE = `(owner_id = $1 OR visibility = 'shared')`;
const SHARED = 'shared';

const str = (v, max) => String(v ?? '').trim().slice(0, max);
const isDate = (v) => /^\d{4}-\d{2}-\d{2}$/.test(String(v || ''));

/** Positive integer or null. Used for every minutes/servings/calories field. */
function posInt(v, max = 100000) {
  const n = Math.round(Number(v));
  if (!Number.isFinite(n) || n <= 0 || n > max) return null;
  return n;
}

const SKILLS = ['easy', 'intermediate', 'hard'];
const normSkill = (v) => (SKILLS.includes(String(v || '').toLowerCase()) ? String(v).toLowerCase() : 'easy');

/**
 * The filter chips across the top of the Cookbook. Fixed rather than free-text
 * tags: a tag cloud that grows one entry per import is a filter row you stop
 * being able to use by month three.
 */
const CATEGORIES = ['breakfast', 'lunch', 'dinner', 'dessert', 'bread', 'cocktails', 'sides', 'sauces', 'other'];
const normCategory = (v) => (CATEGORIES.includes(String(v || '').toLowerCase()) ? String(v).toLowerCase() : 'other');

const CATEGORY_HINTS = [
  ['breakfast', /\b(breakfast|pancake|waffle|omelet|granola|oatmeal|brunch|french toast)\w*/i],
  ['dessert', /\b(dessert|cake|cookie|brownie|pie|ice cream|pudding|tart|cheesecake|frosting)\w*/i],
  ['bread', /\b(bread|loaf|sourdough|focaccia|bagel|biscuit|roll|bun|dough)\w*/i],
  ['cocktails', /\b(cocktail|margarita|martini|negroni|old fashioned|spritz|mocktail|punch)\w*/i],
  ['sauces', /\b(sauce|dressing|marinade|salsa|pesto|aioli|chutney|glaze)\w*/i],
  ['sides', /\b(side|salad|slaw|roasted vegetable|mashed)\w*/i],
  ['lunch', /\b(sandwich|wrap|panini|soup|lunch)\w*/i],
  ['dinner', /\b(dinner|pasta|curry|roast|stew|casserole|chicken|steak|taco|risotto|braised)\w*/i],
];
function guessCategory(text) {
  for (const [cat, re] of CATEGORY_HINTS) if (re.test(text)) return cat;
  return 'other';
}

// ---------------------------------------------------------------------------
// Ingredient parsing
// ---------------------------------------------------------------------------
//
// Recipes on the web are text: "1 1/2 cups whole milk". To scale a recipe from
// 4 servings to 8 we need the 1.5 as a NUMBER, and to put it on the grocery
// list we need "whole milk" on its own. So every ingredient is stored three
// ways: the original line (never lost — it is what gets shown while cooking),
// a parsed quantity, and the bare item.
//
// Parsing is deliberately conservative. When a line doesn't fit the shape, qty
// stays null and the raw line is used verbatim; a wrong number in a recipe is
// far worse than no number, because you can read "a splash of vinegar" and a
// scaled 0.375 tsp you cannot.

const VULGAR = {
  '½': 0.5, '⅓': 1 / 3, '⅔': 2 / 3, '¼': 0.25, '¾': 0.75,
  '⅕': 0.2, '⅖': 0.4, '⅗': 0.6, '⅘': 0.8,
  '⅙': 1 / 6, '⅚': 5 / 6, '⅛': 0.125, '⅜': 0.375, '⅝': 0.625, '⅞': 0.875,
};

const UNITS = [
  ['cup', /^(cups?|c)\.?$/i],
  ['tbsp', /^(tbsp|tbs|tablespoons?|T)\.?$/],
  ['tsp', /^(tsp|teaspoons?|t)\.?$/],
  ['oz', /^(oz|ounces?)\.?$/i],
  ['lb', /^(lbs?|pounds?)\.?$/i],
  ['g', /^(g|grams?)\.?$/i],
  ['kg', /^(kg|kilograms?)\.?$/i],
  ['ml', /^(ml|millilitres?|milliliters?)\.?$/i],
  ['l', /^(l|litres?|liters?)\.?$/i],
  ['clove', /^(cloves?)$/i],
  ['can', /^(cans?)$/i],
  ['pinch', /^(pinch(es)?)$/i],
  ['slice', /^(slices?)$/i],
  ['stick', /^(sticks?)$/i],
  ['sprig', /^(sprigs?)$/i],
  ['piece', /^(pieces?|pcs?)$/i],
];
function normUnit(word) {
  for (const [unit, re] of UNITS) if (re.test(word)) return unit;
  return null;
}

/** "1 1/2", "1½", "0.5", "2-3" (takes the low end) → a number, or null. */
function readQty(text) {
  let s = String(text).trim();
  // Ranges: "2-3 apples" scales off the low end. Averaging invents precision
  // the recipe never had.
  s = s.replace(/\s*[-–—]\s*\d+(\.\d+)?(\s*\d+\/\d+)?/, '');
  let total = 0;
  let matched = false;

  // Leading whole number, possibly with a vulgar fraction stuck to it ("1½").
  const whole = s.match(/^(\d+(?:\.\d+)?)/);
  if (whole) { total += parseFloat(whole[1]); s = s.slice(whole[0].length); matched = true; }

  const vulgar = s.trim()[0];
  if (VULGAR[vulgar] !== undefined) { total += VULGAR[vulgar]; matched = true; }
  else {
    const frac = s.match(/^\s*(\d+)\s*\/\s*(\d+)/);
    if (frac && Number(frac[2]) !== 0) { total += Number(frac[1]) / Number(frac[2]); matched = true; }
  }
  return matched && total > 0 ? total : null;
}

/**
 * "1 1/2 cups whole milk, room temperature"
 *   → { raw, qty: 1.5, unit: 'cup', item: 'whole milk, room temperature' }
 */
function parseIngredient(line) {
  const raw = str(line, 300);
  if (!raw) return null;

  // Strip a leading bullet/dash some sites include in their JSON-LD.
  const cleaned = raw.replace(/^[\s•*\-–—]+/, '');
  const qty = readQty(cleaned);

  let rest = cleaned;
  if (qty !== null) {
    // Remove exactly the numeric part we consumed, whatever shape it took.
    rest = cleaned
      .replace(/^\s*\d+(?:\.\d+)?\s*[-–—]\s*\d+(?:\.\d+)?(?:\s*\d+\/\d+)?/, '')
      .replace(/^\s*\d+(?:\.\d+)?/, '')
      .replace(/^\s*\d+\s*\/\s*\d+/, '')
      .replace(new RegExp(`^\\s*[${Object.keys(VULGAR).join('')}]`), '')
      .trim();
  }

  let unit = null;
  const firstWord = rest.split(/\s+/)[0] || '';
  const u = normUnit(firstWord.replace(/[,.]$/, ''));
  if (u) { unit = u; rest = rest.slice(firstWord.length).trim(); }

  // Only trust an item name we actually isolated. When parsing found nothing,
  // the raw line IS the item — "salt to taste" belongs on the list as written.
  const item = str(rest.replace(/^of\s+/i, ''), 200) || raw;

  return {
    raw,
    qty,
    unit,
    item,
    aisle: hlists ? hlists.guessAisle(item) : 'other',
  };
}

/** 1.5 → "1 1/2". Recipes are read in fractions; 1.5 cups looks like a spec. */
function formatQty(n) {
  if (n === null || n === undefined || !Number.isFinite(n)) return '';
  const rounded = Math.round(n * 1000) / 1000;
  const whole = Math.floor(rounded + 1e-9);
  const frac = rounded - whole;
  const NEAR = [[0.125, '1/8'], [0.25, '1/4'], [1 / 3, '1/3'], [0.375, '3/8'], [0.5, '1/2'],
    [0.625, '5/8'], [2 / 3, '2/3'], [0.75, '3/4'], [0.875, '7/8']];
  if (frac < 0.06) return String(whole || 0);
  for (const [v, s] of NEAR) {
    if (Math.abs(frac - v) < 0.04) return whole ? `${whole} ${s}` : s;
  }
  // Nothing close to a kitchen fraction — a decimal is more honest than a
  // fraction that's quietly 8% off.
  return String(Math.round(rounded * 100) / 100);
}

/**
 * Scale one ingredient by a factor and render it the way it should appear on a
 * grocery list: "3 cups whole milk". Unparsed lines come back untouched, which
 * is the correct behaviour — you cannot double "a pinch".
 */
function scaledText(ing, factor = 1) {
  if (ing.qty === null || ing.qty === undefined) return ing.raw;
  const q = formatQty(ing.qty * factor);
  return [q, ing.unit, ing.item].filter(Boolean).join(' ');
}

// ---------------------------------------------------------------------------
// Import — schema.org JSON-LD
// ---------------------------------------------------------------------------

/** "PT1H30M" → 90. The ISO-8601 duration every recipe site publishes. */
function isoMinutes(v) {
  const m = String(v || '').match(/^P(?:(\d+)D)?T?(?:(\d+)H)?(?:(\d+)M)?/i);
  if (!m) return null;
  const mins = (Number(m[1] || 0) * 1440) + (Number(m[2] || 0) * 60) + Number(m[3] || 0);
  return mins > 0 ? mins : null;
}

/** JSON-LD instructions come as a string, a list of strings, a list of
 *  HowToStep, or a list of HowToSection each holding HowToSteps. All four. */
function flattenInstructions(v) {
  const out = [];
  const push = (s) => {
    const t = stripTags(String(s || '')).trim();
    if (t) out.push(t.slice(0, 2000));
  };
  const walk = (node) => {
    if (!node) return;
    if (typeof node === 'string') {
      // A single blob of HTML with <li> in it is common. Split on those first,
      // then on newlines, before falling back to one giant step.
      const items = String(node).match(/<li[^>]*>([\s\S]*?)<\/li>/gi);
      if (items && items.length > 1) { items.forEach(push); return; }
      const lines = stripTags(node).split(/\n+/).map((s) => s.trim()).filter(Boolean);
      if (lines.length > 1) { lines.forEach(push); return; }
      push(node);
      return;
    }
    if (Array.isArray(node)) { node.forEach(walk); return; }
    if (typeof node === 'object') {
      if (node.itemListElement) { walk(node.itemListElement); return; }
      if (node.text) { push(node.text); return; }
      if (node.name) { push(node.name); return; }
    }
  };
  walk(v);
  return out;
}

function stripTags(html) {
  return String(html || '')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|li|h[1-6]|div|tr)>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/**
 * Pull a `<meta>` content value, whichever attribute order the site used.
 * `property=` (OpenGraph) and `name=` (plain description, Twitter cards) are
 * both accepted because sites are inconsistent about which one they use for
 * which key.
 */
function metaContent(html, key) {
  const k = key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const patterns = [
    new RegExp(`<meta[^>]+(?:property|name)=["']${k}["'][^>]+content=["']([^"']*)["']`, 'i'),
    new RegExp(`<meta[^>]+content=["']([^"']*)["'][^>]+(?:property|name)=["']${k}["']`, 'i'),
  ];
  for (const re of patterns) {
    const m = html.match(re);
    if (m && m[1].trim()) return m[1].trim();
  }
  return null;
}

/**
 * The caption out of a JavaScript-rendered page.
 *
 * TikTok, Instagram and friends render everything client-side: the <body> is an
 * empty shell and the words you came for live in a JSON blob inside a <script>,
 * which stripTags() correctly throws away. Without this, an import of a TikTok
 * gets a page of nothing and Claude quite rightly says "that isn't a recipe" —
 * even though the recipe was sitting in the HTML the whole time.
 *
 * So: scan the raw HTML for JSON string fields that hold prose, and KEEP THE
 * LONGEST FEW — not just the longest one.
 *
 * Longest-one was wrong, and it cost a real import. TikTok now ships an
 * SEO write-up alongside the caption: the caption field held
 * "Cinnamon sugar Hawaiian rolls!🍯✨ … #Foodie" and a SEPARATE field held the
 * whole thing — ingredient notes, a numbered method, storage. Taking one field
 * threw the recipe away and kept the marketing blurb, and the gate then
 * correctly said there was no recipe in what it was handed.
 *
 * Two tiers of key, because the risk is not symmetric:
 *
 *   - Named prose keys (desc/description/caption/content/summary/…) — floor 60.
 *     These are where a caption lives and a short one is still a caption.
 *   - ANY other key — floor 320 AND it has to read like prose (several
 *     sentences, spaces, not a URL or a base64 blob). This is what catches the
 *     write-up, which sits under whatever key that week's build calls it.
 *     Matching a bare "text" key at floor 60 would sweep up button labels and
 *     cookie-consent paragraphs; at 320-and-prose they cannot get in.
 *
 * Substring candidates are dropped, so the caption embedded inside the longer
 * write-up doesn't get sent twice.
 */
const PROSE_KEYS = /^(?:desc|description|caption|content|summary|body|text|article|snippet|seo_?content|markup)$/i;
const CAPTION_FIELD = /"([A-Za-z_][A-Za-z0-9_]{0,40})"\s*:\s*"((?:[^"\\]|\\.){60,}?)"/g;
const IG_CAPTION = /"edge_media_to_caption"\s*:\s*\{[\s\S]{0,2000}?"text"\s*:\s*"((?:[^"\\]|\\.){40,}?)"/;

/** Several sentences of words — the test a non-whitelisted key has to pass. */
function looksLikeProse(s) {
  if (!/\s/.test(s)) return false;              // one long token: an id, a blob
  if (/^https?:\/\//i.test(s.trim())) return false;
  const words = s.split(/\s+/).length;
  const stops = (s.match(/[.!?\n]/g) || []).length;
  return words >= 50 && stops >= 3;
}

const MAX_CAPTION = 9000;

function embeddedCaption(html) {
  const found = [];
  const push = (raw) => {
    if (!raw) return;
    // The match is the INSIDE of a JSON string, so wrapping it in quotes and
    // parsing is the correct un-escaper — it handles \n, \", \uXXXX and emoji
    // surrogate pairs, all of which show up in real captions.
    try { found.push(JSON.parse(`"${raw}"`)); } catch { /* not valid JSON — skip it */ }
  };

  const ig = html.match(IG_CAPTION);
  if (ig) push(ig[1]);

  let m;
  let scanned = 0;
  CAPTION_FIELD.lastIndex = 0;
  while ((m = CAPTION_FIELD.exec(html)) !== null) {
    // A 400KB page of minified JSON holds thousands of string fields. Bound the
    // scan by fields LOOKED AT, not by fields kept — the old cap counted keeps
    // and so was effectively unbounded on a page full of short descriptions.
    if (++scanned > 4000) break;
    const key = m[1];
    const val = m[2];
    if (PROSE_KEYS.test(key)) push(val);
    else if (val.length >= 320) {
      const before = found.length;
      push(val);
      // Un-escaped first, then judged: \n in the raw is two characters and the
      // sentence count needs the real newline.
      if (found.length > before && !looksLikeProse(found[found.length - 1])) found.pop();
    }
  }

  if (!found.length) return null;

  // Longest first, drop anything already contained in something kept, then take
  // up to four. Four because a TikTok page is caption + write-up + maybe a
  // pinned comment; past that it is other people's videos.
  found.sort((a, b) => b.length - a.length);
  const kept = [];
  let budget = MAX_CAPTION;
  for (const cand of found) {
    if (kept.length >= 4) break;
    if (budget < 200) break;
    // Everything AFTER the longest has to be substantial. Sixty characters was
    // the right floor when only one field was kept and the longest always won;
    // keeping several, it lets "Sign up to see more videos from creators you
    // follow on the app." ride along with the recipe.
    if (kept.length && cand.trim().length < 120) continue;
    // Truncate rather than skip: a write-up longer than the whole budget is
    // exactly the thing we came for, and dropping it would leave only the
    // marketing blurb — the bug this function was rewritten to fix.
    const c = cand.trim().slice(0, budget);
    if (!c) continue;
    if (kept.some((k) => k.includes(c))) continue;
    kept.push(c);
    budget -= c.length + 2;
  }
  return kept.join('\n\n').slice(0, MAX_CAPTION) || null;
}

/**
 * Every photo this page might give us, best first.
 *
 * One URL was not enough. A TikTok `og:image` is SIGNED and rate-limited: it
 * 403s often enough during a bulk run that a batch of sixty lands with a
 * scattering of letter-tile placeholders, and by the time you notice, the URL
 * has expired and there is nothing left to retry. The same page also carries
 * two or three unsigned cover fields in its rehydration blob. Trying them in
 * order costs one extra request only when the first one fails.
 *
 * Ranking, and why:
 *   og:image / twitter:image  the share image — what the creator chose.
 *   cover                     TikTok's picked thumbnail, usually the same frame.
 *   originCover               the FIRST frame. Always present, sometimes a
 *                             black frame or a title card, so it ranks below.
 *   reflowCover / thumbnail   whatever is left.
 *   dynamicCover              animated WebP. Last: it plays in the card, which
 *                             is not what a cookbook wants, but a moving photo
 *                             beats a letter tile.
 */
const IMAGE_FIELD =
  /"(cover|originCover|reflowCover|dynamicCover|thumbnail|thumbnailUrl|displayUrl|imageUrl)"\s*:\s*"(https?:(?:[^"\\]|\\.){10,800}?)"/g;
const IMAGE_RANK = ['cover', 'thumbnail', 'thumbnailUrl', 'displayUrl', 'imageUrl',
                    'originCover', 'reflowCover', 'dynamicCover'];

function imageCandidates(html, first = null) {
  const out = [];
  const seen = new Set();
  const add = (u) => {
    const s = str(u, 1000);
    if (!s || !/^https?:\/\//i.test(s)) return;
    // Dedupe on the path, not the whole URL: the same TikTok frame arrives
    // under several signatures and query strings, and trying it four times is
    // four ways to get the same 403.
    let k = s;
    try { const p = new URL(s); k = p.origin + p.pathname; } catch { /* keep the raw string */ }
    if (seen.has(k)) return;
    seen.add(k);
    out.push(s);
  };

  add(first);
  add(metaContent(html, 'og:image'));
  add(metaContent(html, 'twitter:image'));
  const linkRel = html.match(/<link[^>]+rel=["']image_src["'][^>]+href=["']([^"']+)["']/i);
  if (linkRel) add(linkRel[1]);

  const byKey = new Map();
  let m;
  let scanned = 0;
  IMAGE_FIELD.lastIndex = 0;
  while ((m = IMAGE_FIELD.exec(html)) !== null) {
    if (++scanned > 3000) break;
    // The value is the inside of a JSON string: / is how every one of
    // these URLs arrives, so it has to be un-escaped before it can be fetched.
    let url;
    try { url = JSON.parse(`"${m[2]}"`); } catch { continue; }
    if (!byKey.has(m[1])) byKey.set(m[1], url);
  }
  for (const key of IMAGE_RANK) if (byKey.has(key)) add(byKey.get(key));

  // Six is well past the point of diminishing returns and bounds the worst
  // case: six failed fetches on a page that has no usable photo at all.
  return out.slice(0, 6);
}

/**
 * "@fit_foodie_lulu" out of a TikTok/Instagram URL, for the by-line.
 *
 * TikTok's DATA EXPORT does not write the pretty URL. Favourites come out as
 * `tiktokv.com/share/video/<id>` — no handle in the path at all — and the app's
 * share sheet gives `vm.tiktok.com/<code>`. Both redirect to the canonical page,
 * which is why importRecipe passes the RESOLVED url here rather than the one you
 * pasted. `share`/`video` are excluded explicitly so a share link that somehow
 * reaches this function is credited to nobody instead of to "@share".
 */
const SOCIAL_HOSTS = /(^|\.)(tiktok|tiktokv|instagram)\.com$/i;
const NOT_HANDLES = new Set(['share', 'video', 'reel', 'reels', 'p', 't', 'v', 'embed', 'explore', 'tag']);

function handleFromUrl(url) {
  try {
    const u = new URL(url);
    const host = u.hostname.replace(/^www\./, '').toLowerCase();
    if (!SOCIAL_HOSTS.test(host)) return null;
    const segs = u.pathname.split('/').filter(Boolean);

    // TikTok: a handle is ALWAYS the @-prefixed segment. Scanning for
    // "first thing that looks like a word" instead would read
    // /share/video/<id> as the handle "share", and once 'share' is excluded it
    // would happily take the video id.
    if (/(^|\.)(tiktok|tiktokv)\.com$/.test(host)) {
      const at = segs.find((x) => x.startsWith('@'));
      const t = at ? at.slice(1) : '';
      return /^[A-Za-z0-9._]{2,30}$/.test(t) ? `@${t}` : null;
    }

    // Instagram: only the FIRST segment can be a profile
    // (instagram.com/hannahmuch). /reel/<code> and /p/<code> are posts, and the
    // code after them is emphatically not a person.
    const first = (segs[0] || '').replace(/^@/, '');
    if (!first || NOT_HANDLES.has(first.toLowerCase())) return null;
    return /^[A-Za-z0-9._]{2,30}$/.test(first) ? `@${first}` : null;
  } catch { return null; }
}

/**
 * The creator, read out of the page itself.
 *
 * More reliable than the URL and the only option for a share link that redirects
 * to something without a handle in it. TikTok's rehydration blob carries
 * `"uniqueId":"fit_foodie_lulu"`; Instagram uses the same key shape.
 */
function authorFromHtml(html) {
  const m = String(html || '').match(/"uniqueId"\s*:\s*"([A-Za-z0-9._]{2,30})"/);
  return m ? `@${m[1]}` : null;
}

/**
 * A stable identity for "this is the same video/page", used to skip something
 * already in the cookbook.
 *
 * Not the raw URL: TikTok's export writes `tiktokv.com/share/video/7669…`, the
 * share sheet writes `vm.tiktok.com/ZGxyz`, and the site itself writes
 * `tiktok.com/@handle/video/7669…`. All three are one recipe. The numeric id is
 * the only part that is constant, so for those hosts the key is `tiktok:<id>`
 * and everything else falls back to origin + path with tracking junk dropped.
 *
 * A short `vm.tiktok.com` code has no id in it — those only get a key once the
 * fetch resolves, which is exactly why the dedupe check runs twice per import.
 */
function sourceKey(url) {
  try {
    const u = new URL(String(url));
    const host = u.hostname.replace(/^www\./, '').toLowerCase();
    if (/(^|\.)(tiktok|tiktokv)\.com$/.test(host)) {
      const id = u.pathname.match(/(\d{6,})/);
      if (id) return `tiktok:${id[1]}`;
    }
    if (/(^|\.)instagram\.com$/.test(host)) {
      const code = u.pathname.match(/\/(?:p|reel|reels)\/([A-Za-z0-9_-]{5,})/i);
      if (code) return `instagram:${code[1]}`;
    }
    return `${host}${u.pathname.replace(/\/+$/, '').toLowerCase()}`;
  } catch { return null; }
}

function firstImage(v) {
  if (!v) return null;
  if (typeof v === 'string') return v;
  if (Array.isArray(v)) return firstImage(v[0]);
  if (typeof v === 'object') return firstImage(v.url || v.contentUrl);
  return null;
}

function authorName(v) {
  if (!v) return null;
  if (typeof v === 'string') return v;
  if (Array.isArray(v)) return authorName(v[0]);
  if (typeof v === 'object') return v.name || null;
  return null;
}

function yieldServings(v) {
  if (v === null || v === undefined) return null;
  if (Array.isArray(v)) return yieldServings(v[0]);
  const m = String(v).match(/\d+/);
  return m ? posInt(m[0], 200) : null;
}

const typeOf = (node) => {
  const t = node && node['@type'];
  return Array.isArray(t) ? t.map(String) : [String(t || '')];
};

/** Walk every JSON-LD block on the page looking for a node typed Recipe. */
function findRecipeNode(html) {
  const blocks = html.match(/<script[^>]+application\/ld\+json[^>]*>([\s\S]*?)<\/script>/gi) || [];
  for (const block of blocks) {
    const body = block.replace(/^[\s\S]*?>/, '').replace(/<\/script>$/i, '');
    let data;
    // One malformed block on a page must not lose the good one after it.
    try { data = JSON.parse(body); } catch { continue; }
    const queue = Array.isArray(data) ? [...data] : [data];
    while (queue.length) {
      const node = queue.shift();
      if (!node || typeof node !== 'object') continue;
      if (typeOf(node).includes('Recipe')) return node;
      if (Array.isArray(node['@graph'])) queue.push(...node['@graph']);
    }
  }
  return null;
}

function recipeFromJsonLd(node, url) {
  const ingredients = (Array.isArray(node.recipeIngredient) ? node.recipeIngredient : [])
    .map(parseIngredient).filter(Boolean);
  const steps = flattenInstructions(node.recipeInstructions);
  // No ingredients means we found a Recipe node that isn't really one (a
  // roundup post, a category page). Let the AI path have it rather than saving
  // an empty shell.
  if (!ingredients.length) return null;

  const title = str(node.name, 200);
  const prep = isoMinutes(node.prepTime);
  const cook = isoMinutes(node.cookTime);
  const total = isoMinutes(node.totalTime);

  return {
    title: title || 'Untitled recipe',
    description: str(stripTags(node.description), 1000) || null,
    imageUrl: str(firstImage(node.image), 1000) || null,
    sourceUrl: url || null,
    sourceName: str(authorName(node.author), 120) || (url ? hostOf(url) : null),
    servings: yieldServings(node.recipeYield),
    prepMinutes: prep,
    // A site that publishes only totalTime gets it recorded as cook time —
    // that's the number the card shows, and dropping it to keep the field pure
    // means the card says nothing.
    cookMinutes: cook || (prep && total ? Math.max(total - prep, 0) || null : total),
    calories: posInt(String(node?.nutrition?.calories || '').match(/\d+/)?.[0], 20000),
    category: guessCategory(`${title} ${str(node.recipeCategory, 60)}`),
    skill: 'easy',
    ingredients,
    steps,
    via: 'json-ld',
  };
}

function hostOf(url) {
  try { return new URL(url).hostname.replace(/^www\./, ''); } catch { return null; }
}

// ---------------------------------------------------------------------------
// Import — fetching
// ---------------------------------------------------------------------------

const MAX_PAGE_BYTES = 3_000_000;

/**
 * Fetch a recipe page. Only ever called with a user-supplied URL from a signed-
 * in household member, but still validated: http(s) only, and no requests at
 * private address space, so a pasted link can't be used to probe the VPS's own
 * network from inside the container.
 */
async function fetchPage(url) {
  let u;
  try { u = new URL(url); } catch { throw new Error("That doesn't look like a link."); }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') throw new Error('Only http and https links.');
  if (/^(localhost$|127\.|10\.|192\.168\.|169\.254\.|172\.(1[6-9]|2\d|3[01])\.|\[?::1)/i.test(u.hostname)) {
    throw new Error('That address is not reachable from here.');
  }

  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), 15_000);
  try {
    const res = await fetch(u.toString(), {
      signal: ctl.signal,
      redirect: 'follow',
      headers: {
        // Some recipe sites serve a stub to anything that looks like a script.
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml',
        'Accept-Language': 'en-US,en;q=0.9',
      },
    });
    if (!res.ok) throw new Error(`The site returned ${res.status}.`);
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length > MAX_PAGE_BYTES) throw new Error('That page is too large to read.');
    // finalUrl, not the one we asked for: a TikTok export link is
    // tiktokv.com/share/video/<id> and redirects to the canonical page. The
    // by-line and the dedupe key both need where we LANDED.
    return { html: buf.toString('utf8'), finalUrl: res.url || u.toString() };
  } catch (e) {
    if (e.name === 'AbortError') throw new Error('That site took too long to answer.');
    throw e;
  } finally {
    clearTimeout(timer);
  }
}

// ---------------------------------------------------------------------------
// "Full recipe in bio"
// ---------------------------------------------------------------------------
//
// Creators split into two habits, and they need opposite handling:
//
//   1. The caption CONTAINS the link to the full write-up. Follow it. The blog
//      almost certainly publishes schema.org JSON-LD, so following turns a
//      partial caption into an exact recipe — for free, and better than the AI
//      could reconstruct from a summary.
//   2. The caption says "recipe in bio" / "link in bio" with no URL. There is
//      nothing to follow: a bio link is a profile page, and an aggregator like
//      linktr.ee is a menu of links, not a recipe. Import whatever the caption
//      does have and MARK IT, so you know this one is incomplete before you
//      start cooking rather than at the point you need step four.
//
// Getting this wrong in either direction is expensive: following a linktr.ee
// wastes a fetch and an AI call on a page of buttons, and silently importing
// half a recipe is worse than not importing it at all.

/** Link-in-bio aggregators. A menu of links, never a recipe. */
const AGGREGATORS = /(^|\.)((linktr\.ee)|(beacons\.ai)|(lnk\.bio)|(bio\.link)|(msha\.ke)|(stan\.store)|(komi\.io)|(linkin\.bio)|(later\.com)|(campsite\.bio)|(solo\.to)|(taplink\.cc))$/i;
/** Not recipes either — shops, socials, the app itself. */
const NOT_RECIPE_HOSTS = /(^|\.)((tiktok)|(tiktokv)|(instagram)|(facebook)|(youtube)|(youtu\.be)|(twitter)|(x\.com)|(threads\.net)|(pinterest)|(amazon)|(amzn\.to)|(spotify)|(apple)|(open\.spotify)|(shopmy\.us)|(ltk\.app)|(liketoknow\.it))\.?[a-z.]*$/i;

/** External links in a caption that might actually be a recipe page. */
function captionLinks(text) {
  const out = [];
  const seen = new Set();
  for (const raw of String(text || '').match(/https?:\/\/[^\s"'<>)\]]+/gi) || []) {
    const url = raw.replace(/[.,;:!?)\]]+$/, '');
    let host;
    try { host = new URL(url).hostname.replace(/^www\./, '').toLowerCase(); } catch { continue; }
    if (AGGREGATORS.test(host) || NOT_RECIPE_HOSTS.test(host)) continue;
    if (seen.has(host + url)) continue;
    seen.add(host + url);
    out.push(url);
    if (out.length >= 3) break;   // a caption with four links is a link dump
  }
  return out;
}

/**
 * Does the caption say the real recipe lives somewhere else?
 *
 * Returns the phrase that matched, so the note on the recipe can quote the
 * creator rather than paraphrase them — "recipe in bio" is more useful on the
 * screen than "incomplete".
 */
const ELSEWHERE_PATTERNS = [
  /\b(?:full |written |printable |detailed )?recipe (?:is )?(?:in|on|at|via) (?:my |the )?(?:bio|profile|link in bio|website|blog|linktree|link tree|newsletter|substack|patreon)\b/i,
  /\blink in (?:my )?bio\b/i,
  /\brecipe in (?:my )?bio\b/i,
  /\b(?:full|written|printable) recipe (?:linked|below|here)\b/i,
  /\bcomment ["“]?\w+["”]? (?:for|and I'?ll send) (?:the )?recipe\b/i,
  /\bDM me (?:for )?(?:the )?recipe\b/i,
  /\bgrab the (?:full )?recipe\b/i,
];

function mentionsRecipeElsewhere(text) {
  const t = String(text || '');
  for (const re of ELSEWHERE_PATTERNS) {
    const m = t.match(re);
    if (m) return m[0].trim().replace(/\s+/g, ' ').slice(0, 120);
  }
  return null;
}

// ---------------------------------------------------------------------------
// "Is this even a recipe?"
// ---------------------------------------------------------------------------
//
// A TikTok favourites export is not a recipe list. It is everything you ever
// tapped the bookmark on — editing tutorials, dog videos, a song you liked. Of
// 1,480 favourites maybe a few hundred are food.
//
// Every non-recipe still cost a full Claude call before coming back "that
// doesn't look like a recipe", which is paying an LLM to tell you something the
// caption already says. This gate reads the caption FIRST and skips the API
// entirely when there is no food in it. The page fetch still happens — it is
// free and it is what produced the caption — so the saving is precisely the
// expensive half.
//
// Deliberately GENEROUS. A false negative is a recipe you have to import by
// hand; a false positive costs about two cents. So one strong signal is enough,
// and two weak ones will do. It is a spend filter, not a classifier.

/**
 * Captions are written for the feed, not for a parser.
 *
 * "#EasyRecipes" is the word "recipes" — but `\brecipe\b` never matches it,
 * because there is no word boundary between "Easy" and "Recipes". Confirmed on
 * a real favourite (7663155313859759390, cinnamon sugar Hawaiian rolls): the
 * caption said Recipes, Foodie and HomemadeDessert, and the gate scored zero on
 * all three. So the hash goes and CamelCase is split before anything is counted.
 */
function normaliseCaption(text) {
  return String(text || '')
    .replace(/#(\w+)/g, (_, w) => ' ' + w.replace(/([a-z0-9])([A-Z])/g, '$1 $2') + ' ')
    .replace(/[_\u2019']/g, ' ')
    .replace(/\s+/g, ' ');
}

/**
 * Food vocabulary for the GATE only — deliberately not HEROES.
 *
 * HEROES answers "what is this recipe OF", so it holds things that can be a
 * main ingredient. This list answers "is this about food at all", so it holds
 * cinnamon, icing and dessert too. Merging them would file the Hawaiian rolls
 * under main_ingredient = "cinnamon", which is not what the dish is.
 */
const RE_FOOD = /\b(recipe|recipes|food|foodie|snack|dessert|breakfast|brunch|lunch|dinner|supper|meal|dish|bake|bakery|homemade|kitchen|cook|cooking|crispy|creamy|cheesy|garlicky|savou?ry|sweet|tasty|delicious|yummy|icing|frosting|glaze|dough|batter|roll|rolls|bun|buns|loaf|cinnamon|sugar|butter|cheese|cream|chocolate|vanilla|honey|syrup|sauce|marinade|seasoning|spice|crumb|crust|filling|topping|toasted|melted|stuffed|smothered|drizzled|topped)\b/gi;

/** Amounts: "500g", "2 tbsp", "1 1/2 cups", "180°C", "350F". The single most
 *  reliable tell — captions that aren't recipes rarely carry them. */
const RE_MEASURE = /\b\d+\s*(?:g|kg|ml|l|oz|lbs?|cups?|tbsp|tsp|tablespoons?|teaspoons?|cloves?|cans?|sticks?|slices?|scoops?|°?[CF]\b)/gi;
/** Method verbs — what you DO to food. */
const RE_METHOD = /\b(preheat|bake|baked|baking|roast|roasted|fry|fried|air ?fry|saut[ée]|simmer|boil|whisk|knead|marinate|marinade|season|stir|blend|blitz|drizzle|garnish|serve|serves|serving|chill|refrigerate|oven|skillet|pan|pot|grill|griddle|sear)\b/gi;
/** Words that only appear around recipes. */
const RE_RECIPE = /\b(recipe|ingredients?|instructions?|method|directions|meal prep|macros?|protein|calories|kcal|high[- ]protein|leftovers|batch|prep time|cook time)\b/gi;
/** A caption laid out as a list — "1 ciabatta loaf\n500g chicken\n1 cup…" */
const RE_LIST_LINES = /^\s*(?:[-•*]|\d+[.)]?\s|\d+\s*(?:g|ml|oz|cups?|tbsp|tsp)\b)/gim;

/**
 * Score a caption. Returns the hit counts too, so a bulk run can be tuned from
 * real numbers rather than from opinions about word lists.
 */
function recipeSignals(text) {
  const raw = String(text || '');
  // Line structure has to be read BEFORE normalising — that collapses newlines,
  // and an ingredient list is defined by its line breaks.
  const listLines = (raw.match(RE_LIST_LINES) || []).length;

  const t = normaliseCaption(raw);
  const measures = (t.match(RE_MEASURE) || []).length;
  const methods = new Set((t.match(RE_METHOD) || []).map((x) => x.toLowerCase())).size;
  const words = new Set((t.match(RE_RECIPE) || []).map((x) => x.toLowerCase())).size;
  const heroes = new Set(HEROES.filter((h) => t.toLowerCase().includes(h))).size;
  const food = new Set((t.match(RE_FOOD) || []).map((x) => x.toLowerCase())).size + heroes;

  // Any ONE of these settles it on its own.
  const strong =
    words > 0 && (measures >= 1 || listLines >= 2) ? 'recipe-word + amounts'
    : measures >= 3 ? 'three or more amounts'
    : listLines >= 4 && heroes >= 2 ? 'ingredient list + food'
    : null;

  // Otherwise two weak ones will do.
  const weak = [measures >= 1, methods >= 2, heroes >= 2, listLines >= 2, words >= 1]
    .filter(Boolean).length;

  const pass = !!strong || weak >= 2;

  // THE THIRD OUTCOME, and the one that was missing.
  //
  // "Cinnamon sugar Hawaiian rolls! Crispy on the outside… #EasyRecipes" is
  // unmistakably food and contains no recipe whatsoever — no amounts, no
  // ingredients, no method. The recipe is SPOKEN in the video.
  //
  // Importing it would not produce a recipe; it would make the model invent one,
  // which is the worst outcome available. But calling it "not food" and burying
  // it with the dog videos loses a recipe you actually want. So it gets its own
  // verdict: worth your time by hand, not worth an AI call.
  const foodNoRecipe = !pass && food >= 2;

  return { measures, methods, words, listLines, heroes, food, strong, weak, pass, foodNoRecipe };
}

const looksLikeRecipe = (text) => recipeSignals(text).pass;

/** Thrown when the gate says no. Flagged so a bulk run can record it as its own
 *  outcome — it is not a failure, and retrying it would fetch the same page to
 *  reach the same conclusion. */
function notARecipe(detail) {
  const e = new Error(`That doesn't look like a recipe${detail ? ` (${detail})` : ''}.`);
  e.notRecipe = true;
  return e;
}

/** Food, but the caption doesn't contain the recipe — it's in the video. Its own
 *  error so the by-hand list can rank it above the dog videos. */
function noWrittenRecipe(detail) {
  const e = new Error(`Looks like food, but the caption has no written recipe${detail ? ` — ${detail}` : ''}.`);
  e.notRecipe = true;
  e.foodNoRecipe = true;
  return e;
}

// ---------------------------------------------------------------------------
// Import — Claude fallback
// ---------------------------------------------------------------------------

const AI_MODEL = process.env.RECIPE_AI_MODEL || 'claude-sonnet-4-5';
const aiConfigured = () => !!process.env.ANTHROPIC_API_KEY;

const AI_PROMPT = `Extract the recipe from the text below into JSON.

Return ONLY a JSON object, no prose and no code fence, with exactly these keys:
{
  "title": string,
  "description": string | null,
  "servings": number | null,
  "prepMinutes": number | null,
  "cookMinutes": number | null,
  "calories": number | null,
  "category": "breakfast" | "lunch" | "dinner" | "dessert" | "bread" | "cocktails" | "sides" | "sauces" | "other",
  "skill": "easy" | "intermediate" | "hard",
  "ingredients": string[],
  "steps": string[]
}

Rules:
- "ingredients" are the lines EXACTLY as written ("1 1/2 cups whole milk"). Do not restructure them.
- "steps" are the instructions in order, one sentence group per step. Strip step numbers.
- Use null for anything the text does not state. Never guess a time or a calorie count.
- If the text is not a recipe, return {"error":"not a recipe"}.

TEXT:
`;

async function aiExtract(text) {
  if (!aiConfigured()) {
    throw new Error("That page has no structured recipe data, and AI import isn't set up (ANTHROPIC_API_KEY).");
  }
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), 90_000);
  try {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      signal: ctl.signal,
      headers: {
        'content-type': 'application/json',
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: AI_MODEL,
        max_tokens: 4000,
        // A recipe page is mostly life story and ads. 24k characters is well
        // past where the actual recipe sits and keeps the bill small.
        messages: [{ role: 'user', content: AI_PROMPT + String(text).slice(0, 24_000) }],
      }),
    });
    const body = await res.json().catch(() => null);
    if (!res.ok) throw new Error(body?.error?.message || `AI import failed (${res.status}).`);
    const raw = (body?.content || []).map((c) => c?.text || '').join('').trim();
    // Belt and braces: the prompt says no code fence, models occasionally add one.
    const json = raw.replace(/^```(?:json)?/i, '').replace(/```$/, '').trim();
    let parsed;
    try { parsed = JSON.parse(json); } catch { throw new Error("Couldn't read a recipe out of that."); }
    if (parsed?.error) throw new Error("That doesn't look like a recipe.");
    return parsed;
  } catch (e) {
    if (e.name === 'AbortError') throw new Error('AI import timed out.');
    throw e;
  } finally {
    clearTimeout(timer);
  }
}

function recipeFromAi(parsed, url, pageTitle) {
  const ingredients = (Array.isArray(parsed.ingredients) ? parsed.ingredients : [])
    .map(parseIngredient).filter(Boolean);
  if (!ingredients.length) throw new Error("Couldn't find any ingredients in that.");
  const title = str(parsed.title, 200) || str(pageTitle, 200) || 'Untitled recipe';
  return {
    title,
    description: str(parsed.description, 1000) || null,
    imageUrl: null,
    sourceUrl: url || null,
    sourceName: url ? hostOf(url) : null,
    servings: posInt(parsed.servings, 200),
    prepMinutes: posInt(parsed.prepMinutes, 10000),
    cookMinutes: posInt(parsed.cookMinutes, 10000),
    calories: posInt(parsed.calories, 20000),
    category: CATEGORIES.includes(parsed.category) ? parsed.category : guessCategory(title),
    skill: normSkill(parsed.skill),
    ingredients,
    steps: (Array.isArray(parsed.steps) ? parsed.steps : []).map((s) => str(s, 2000)).filter(Boolean),
    via: 'ai',
  };
}

/**
 * The import entry point. Returns a DRAFT — nothing is written to the database
 * until the user hits save on the review screen. Import is the step most likely
 * to get something subtly wrong, and a cookbook that fills up with half-read
 * pages is worse than one you paste into.
 */
async function importRecipe({ url, text, force = false, depth = 0 }) {
  const link = str(url, 2000);
  const pasted = str(text, 60_000);
  if (!link && !pasted) throw new Error('Paste a link or the recipe text.');

  if (!link) {
    // Pasted text — an Instagram caption, a screenshot transcription, a note.
    // There is no structured data to try first, so this always goes to the AI.
    // No gate here: you typed it in, so you have already decided it's a recipe.
    return recipeFromAi(await aiExtract(pasted), null, pasted.split('\n')[0]);
  }

  const { html, finalUrl } = await fetchPage(link);

  const node = findRecipeNode(html);
  if (node) {
    const fromLd = recipeFromJsonLd(node, finalUrl);
    if (fromLd) {
      // The recipe's own image first, then the page's — a food blog's og:image
      // is occasionally a logo, and the LD image never is.
      const cands = imageCandidates(html, fromLd.imageUrl);
      return {
        ...fromLd,
        imageUrl: cands[0] || fromLd.imageUrl,
        imageCandidates: cands,
        sourceKey: sourceKey(finalUrl),
      };
    }
  }

  // No usable structured data. Fall back to reading the page.
  const pageTitle = (html.match(/<title[^>]*>([\s\S]*?)<\/title>/i) || [])[1] || '';
  const ogImage = metaContent(html, 'og:image') || metaContent(html, 'twitter:image');
  const ogDesc = metaContent(html, 'og:description') || metaContent(html, 'description');

  // ORDER MATTERS. The caption goes FIRST, then the meta description, then the
  // page body — because on a JS-rendered page (TikTok, Instagram) the body is
  // an empty shell and the caption is the whole recipe, while on an ordinary
  // blog the body is the recipe and the caption extractor finds nothing. One
  // path handles both, and aiExtract's 24k cap then trims the tail of a long
  // blog post rather than the caption we specifically went looking for.
  const caption = embeddedCaption(html);
  const readable = [caption, ogDesc, stripTags(html)].filter(Boolean).join('\n\n');
  if (readable.trim().length < 40) {
    // Nothing readable at all — a hard bot wall, or a page that is pure script.
    // Say so plainly instead of paying for an AI call that can only fail.
    throw new Error("That page didn't return any readable text — it may block automated readers. Copy the recipe and use Paste.");
  }

  // ── "Full recipe in bio" ────────────────────────────────────────────────
  //
  // FOLLOW A LINK IF THERE IS ONE. A creator who links their blog has already
  // done the work of publishing a complete, structured recipe; reading it beats
  // asking an LLM to reconstruct one from a caption summary, and it is usually
  // free because the blog carries JSON-LD.
  //
  // depth stops a page that links a page that links a page. One hop is the only
  // hop worth taking: a link on a recipe page is a related recipe, not this one.
  const elsewhere = mentionsRecipeElsewhere(caption || readable);
  if (depth < 1) {
    for (const found of captionLinks(caption || readable)) {
      try {
        const followed = await importRecipe({ url: found, depth: depth + 1 });
        return {
          ...followed,
          // The ORIGINAL stays the source: it is what you saved, what you'll
          // want to watch, and — critically — what the dedupe key is built from.
          // Swapping in the blog URL would make your export list re-import every
          // one of these on the next batch.
          sourceUrl: finalUrl,
          sourceKey: sourceKey(finalUrl),
          // Credit the creator you followed, not the blog's byline.
          sourceName: authorFromHtml(html) || handleFromUrl(finalUrl) || followed.sourceName,
          // Where the full write-up actually lives, so the recipe page can
          // offer it next to the video.
          recipeUrl: found,
          // A followed link produced a complete recipe — nothing partial here.
          partial: false,
          partialNote: null,
        };
      } catch {
        // That link wasn't a recipe (a shop page, a dead domain, a paywall).
        // Try the next one, then fall through to reading the caption.
      }
    }
  }

  // THE GATE. Everything above this line is free; everything below costs money.
  // `force` is how a single manual import overrides a false negative.
  if (!force) {
    const sig = recipeSignals(readable);
    if (!sig.pass) {
      // A caption with no food in it that SAYS the recipe is in the bio is a
      // different problem from a dog video, and the by-hand list should say so
      // — one is worth chasing, the other is not.
      if (elsewhere) throw notARecipe(`the caption only says "${elsewhere}"`);
      // Food, no recipe. Worth your time by hand; not worth an AI call, because
      // there is nothing in the text for it to extract.
      if (sig.foodNoRecipe) throw noWrittenRecipe('the method is probably spoken in the video');
      throw notARecipe(`${sig.measures} amounts, ${sig.food} food words`);
    }
  }

  const draft = recipeFromAi(await aiExtract(readable), finalUrl, stripTags(pageTitle));

  // Enough in the caption to import, but the creator says the real one is
  // elsewhere — so it goes in, FLAGGED. Half a recipe you don't know is half is
  // worse than no recipe: you find out at step four, mid-cook.
  if (elsewhere) {
    draft.partial = true;
    draft.partialNote = elsewhere;
  }
  // The AI never sees images; the page's own covers are how the card gets a
  // photo on the pages that had no JSON-LD. imageUrl stays the FIRST candidate
  // — it is what renders until the copied bytes land — and the rest are the
  // fallbacks captureImage works down when a signed CDN link 403s.
  draft.imageCandidates = imageCandidates(html, ogImage);
  if (draft.imageCandidates.length) draft.imageUrl = draft.imageCandidates[0];
  // "by @fit_foodie_lulu" reads better than "by tiktokv.com" — and it's the
  // credit the creator is actually owed. The PAGE wins over the URL: an export
  // link has no handle in it at all, and the redirect target may not either.
  const handle = authorFromHtml(html) || handleFromUrl(finalUrl) || handleFromUrl(link);
  if (handle) draft.sourceName = handle;
  draft.sourceKey = sourceKey(finalUrl);
  return draft;
}

/**
 * The photo candidates for a page, without importing anything.
 *
 * The backfill's entry point: recipes saved before the importer could see kept
 * ONE url — the og:image, which on TikTok is the creator's hook frame. This
 * re-reads the page for the rest. Returns [] rather than throwing on a dead
 * link, because a backfill over eighty recipes must not stop at the first one
 * whose video was taken down.
 */
async function candidatesForUrl(url) {
  try {
    const { html } = await fetchPage(url);
    // The JSON-LD image first when the page has one: on a food blog the
    // og:image is occasionally the site logo, and the LD image never is.
    const node = findRecipeNode(html);
    const fromLd = node ? recipeFromJsonLd(node, url) : null;
    return imageCandidates(html, fromLd?.imageUrl || null);
  } catch {
    return [];
  }
}

/** Already in the cookbook? Matched on the normalised key, so a share link and
 *  the canonical page count as the same recipe. */
async function findBySourceKey(userId, key) {
  if (!key) return null;
  const { rows } = await libDb.getPool().query(
    `SELECT id, title FROM hh_recipes WHERE source_key = $2 AND ${VISIBLE} LIMIT 1`,
    [userId, String(key)]);
  return rows[0] || null;
}

// ---------------------------------------------------------------------------
// Main ingredient
// ---------------------------------------------------------------------------
//
// "What's this recipe actually OF" — the thing you sort by when you're standing
// in front of the fridge with chicken to use up. Stored as a column rather than
// derived per query, because deriving it means unpacking a JSONB array for every
// row of the index screen and you cannot ORDER BY it without doing that twice.
//
// TITLE FIRST, ingredients second. "Cheesy Butter Chicken Garlic Bread" has
// sixteen ingredients and only one of them is the point; the title already tells
// you which. Scanning the list first would file that recipe under "ciabatta
// loaf" because that's the line that happens to come first.

const HEROES = [
  // Proteins, most specific first — 'chicken thigh' must beat 'chicken', and
  // 'ground beef' must not be filed under 'bread' because of "b".
  'guanciale', 'pancetta', 'prosciutto', 'chorizo', 'bacon', 'sausage', 'meatball',
  'short rib', 'brisket', 'steak', 'ground beef', 'beef', 'lamb', 'pork belly', 'pork',
  'chicken thigh', 'chicken breast', 'chicken', 'turkey', 'duck',
  'salmon', 'tuna', 'cod', 'haddock', 'tilapia', 'prawn', 'shrimp', 'scallop', 'crab',
  'halloumi', 'paneer', 'tofu', 'tempeh', 'egg',
  // Vegetable and carb heroes — a recipe genuinely OF one thing.
  'mushroom', 'aubergine', 'eggplant', 'courgette', 'zucchini', 'cauliflower',
  'broccoli', 'sweet potato', 'potato', 'squash', 'pumpkin', 'chickpea', 'lentil',
  'black bean', 'bean', 'corn', 'tomato', 'spinach', 'kale', 'cabbage', 'leek',
  'pasta', 'gnocchi', 'rice', 'noodle', 'ramen', 'orzo', 'couscous', 'quinoa',
  'bread', 'dough', 'tortilla',
  // Sweet.
  'banana', 'apple', 'berry', 'strawberry', 'blueberry', 'raspberry', 'peach',
  'lemon', 'lime', 'orange', 'chocolate', 'caramel', 'cheesecake', 'custard',
];

/** Aisle preference when the title gives nothing away. Meat is almost always
 *  the answer; household/other never is. */
const AISLE_RANK = { meat: 0, produce: 1, dairy: 2, bakery: 3, frozen: 4, pantry: 5, other: 9, household: 9 };

/** "boneless skinless chicken thighs, trimmed" → "chicken thigh". */
function tidyIngredientName(text) {
  let t = String(text || '').toLowerCase()
    .split(',')[0]                                   // drop "…, finely diced"
    .replace(/\([^)]*\)/g, ' ')                       // drop parentheticals
    .replace(/\b(fresh|freshly|large|small|medium|boneless|skinless|ripe|raw|cooked|frozen|canned|tinned|chopped|diced|sliced|minced|grated|shredded|ground|extra|virgin|unsalted|salted|light|low[- ]fat|plain|whole|good|quality|optional|to taste|of)\b/g, ' ')
    .replace(/[^a-z\s-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  // Singularise the last word only — "chicken thighs" → "chicken thigh", but
  // never "hummus" → "hummu".
  const w = t.split(' ');
  if (w.length) {
    const last = w[w.length - 1];
    if (/(?<![su])s$/.test(last) && last.length > 3) w[w.length - 1] = last.slice(0, -1);
  }
  return w.slice(0, 3).join(' ').trim() || null;
}

function guessMainIngredient(title, ingredients) {
  const hay = String(title || '').toLowerCase();
  for (const h of HEROES) if (hay.includes(h)) return h;

  // Nothing in the title. Fall back to the best-ranked ingredient, and within a
  // rank the first one listed — recipe writers put the star first.
  const list = Array.isArray(ingredients) ? ingredients : [];
  let best = null;
  let bestRank = 99;
  for (const ing of list) {
    const rank = AISLE_RANK[ing?.aisle] ?? 9;
    if (rank < bestRank) { bestRank = rank; best = ing; }
    if (bestRank === 0) break;
  }
  // Rank 9 means everything was 'other'/'household' — a guess from that is worse
  // than admitting we don't know, because it would sort under something absurd.
  if (!best || bestRank >= 9) {
    for (const ing of list) {
      const t = tidyIngredientName(ing?.item);
      for (const h of HEROES) if (t && t.includes(h)) return h;
    }
    return null;
  }
  return tidyIngredientName(best.item);
}

// ---------------------------------------------------------------------------
// Sort
// ---------------------------------------------------------------------------
//
// A whitelist, not a string spliced into SQL. Every key maps to a fixed ORDER BY
// fragment; anything unrecognised falls back to 'recent'. There is no path from
// a query parameter into the query text.
//
// NULLS LAST everywhere it matters: a recipe with no cook time recorded should
// not lead a list sorted by cook time, and one with no main ingredient should
// not sit above every named one.
const SORTS = {
  recent:    { label: 'Recently added', sql: 'created_at DESC, id DESC' },
  updated:   { label: 'Recently changed', sql: 'updated_at DESC, id DESC' },
  name:      { label: 'Name', sql: 'lower(title) ASC' },
  main:      { label: 'Main ingredient', sql: 'main_ingredient ASC NULLS LAST, lower(title) ASC' },
  time:      { label: 'Cook time', sql: 'COALESCE(prep_minutes,0) + COALESCE(cook_minutes,0) ASC NULLS LAST, lower(title) ASC' },
  cooked:    { label: 'Most cooked', sql: 'cooked_count DESC, last_cooked_at DESC NULLS LAST' },
  calories:  { label: 'Calories', sql: 'calories ASC NULLS LAST, lower(title) ASC' },
};
const SORT_KEYS = Object.keys(SORTS);

// ---------------------------------------------------------------------------
// Read
// ---------------------------------------------------------------------------

// The list view deliberately does NOT select ingredients/steps. A cookbook of
// 300 recipes is a few hundred KB of JSONB nobody is looking at on the index
// screen, and on a phone that is the difference between instant and not.
const CARD_COLS = `id, owner_id, visibility, title, description, image_url, source_url, source_name,
  servings, prep_minutes, cook_minutes, calories, category, skill, favorite,
  main_ingredient, needs_review, recipe_url, partial, partial_note,
  cooked_count, last_cooked_at, jsonb_array_length(ingredients) AS ingredient_count,
  created_at, updated_at`;

const FULL_COLS = `id, owner_id, visibility, title, description, image_url, source_url, source_name,
  servings, prep_minutes, cook_minutes, calories, category, skill, favorite, notes,
  main_ingredient, needs_review, recipe_url, partial, partial_note, image_candidates,
  ingredients, steps, cooked_count, last_cooked_at, created_at, updated_at`;

/**
 * Whether this recipe has a stored photo, and its version.
 *
 * A correlated subquery rather than a JOIN so it can be dropped into the
 * existing column lists without touching every FROM clause — and so it NEVER
 * touches the `bytes` column. Pulling an image table into a list query by
 * accident is how a 20-row cookbook screen becomes an 8MB response.
 *
 * `image_etag` is a content hash. The client puts it in the img URL as ?v=,
 * which is what makes the year-long immutable cache header safe: replace the
 * photo, the hash changes, the URL changes, every phone refetches. Without it
 * an "immutable" cached photo would outlive three replacements.
 */
const IMG_ETAG = `(SELECT i.etag FROM hh_recipe_images i WHERE i.recipe_id = hh_recipes.id) AS image_etag`;
const CARD_SELECT = `${CARD_COLS}, ${IMG_ETAG}`;
const FULL_SELECT = `${FULL_COLS}, ${IMG_ETAG}`;

async function listRecipes(userId, { q, category, main: mainFilter, favorite, sort, needsReview } = {}) {
  const pool = libDb.getPool();
  const where = [VISIBLE];
  const vals = [userId];
  const search = str(q, 80);
  if (search) {
    vals.push(`%${search.toLowerCase()}%`);
    // Ingredients are searched too, cast to text — "what can I make with
    // gochujang" is the question you actually ask a cookbook.
    where.push(`(lower(title) LIKE $${vals.length} OR lower(coalesce(description,'')) LIKE $${vals.length}
                 OR lower(ingredients::text) LIKE $${vals.length})`);
  }
  if (category && category !== 'all') {
    vals.push(normCategory(category));
    where.push(`category = $${vals.length}`);
  }
  const main = str(mainFilter, 60);
  if (main) {
    vals.push(main.toLowerCase());
    where.push(`main_ingredient = $${vals.length}`);
  }
  if (favorite) where.push('favorite = TRUE');
  if (needsReview) where.push('needs_review = TRUE');

  // Favourites no longer jump the queue. They did while 'recently added' was the
  // only order, but "sort by name" that silently puts four starred recipes above
  // the As isn't sorted by name — it's sorted by something you didn't ask for.
  const order = SORTS[String(sort || '')] ? SORTS[sort].sql : SORTS.recent.sql;

  const { rows } = await pool.query(
    `SELECT ${CARD_SELECT} FROM hh_recipes WHERE ${where.join(' AND ')}
      ORDER BY ${order} LIMIT 500`, vals);

  const [{ rows: counts }, { rows: mains }, { rows: flags }] = await Promise.all([
    pool.query(`SELECT category, COUNT(*)::int AS n FROM hh_recipes WHERE ${VISIBLE} GROUP BY category`, [userId]),
    // The main-ingredient facet, so the UI can offer "chicken (7)" as a filter
    // rather than making you search for a word you have to already know is there.
    pool.query(`SELECT main_ingredient AS m, COUNT(*)::int AS n FROM hh_recipes
                 WHERE ${VISIBLE} AND main_ingredient IS NOT NULL
                 GROUP BY main_ingredient ORDER BY n DESC, m ASC LIMIT 40`, [userId]),
    pool.query(`SELECT COUNT(*) FILTER (WHERE needs_review)::int AS review,
                       COUNT(*)::int AS total FROM hh_recipes WHERE ${VISIBLE}`, [userId]),
  ]);

  return {
    recipes: rows,
    categories: CATEGORIES,
    counts: Object.fromEntries(counts.map((c) => [c.category, c.n])),
    mains: mains.map((r) => ({ name: r.m, n: r.n })),
    sorts: SORT_KEYS.map((k) => ({ key: k, label: SORTS[k].label })),
    sort: SORTS[String(sort || '')] ? sort : 'recent',
    needsReview: flags[0]?.review ?? 0,
    total: rows.length,
    libraryTotal: flags[0]?.total ?? 0,
    aiConfigured: aiConfigured(),
  };
}

async function getRecipe(userId, id) {
  const { rows } = await libDb.getPool().query(
    `SELECT ${FULL_SELECT} FROM hh_recipes WHERE id=$2 AND ${VISIBLE}`, [userId, Number(id)]);
  if (!rows[0]) throw new Error('Not found.');
  return rows[0];
}

// ---------------------------------------------------------------------------
// Write
// ---------------------------------------------------------------------------

/**
 * Normalise whatever the client sent into the shape the column expects.
 * Accepts either already-parsed ingredient objects (the review screen sends
 * back what import produced) or bare strings (manual entry).
 */
function normIngredients(v) {
  if (!Array.isArray(v)) return [];
  return v.map((x) => {
    if (typeof x === 'string') return parseIngredient(x);
    if (!x || typeof x !== 'object') return null;
    const raw = str(x.raw ?? x.item, 300);
    if (!raw) return null;
    const qty = Number.isFinite(Number(x.qty)) && Number(x.qty) > 0 ? Number(x.qty) : null;
    return {
      raw,
      qty,
      unit: str(x.unit, 20) || null,
      item: str(x.item, 200) || raw,
      aisle: hlists ? hlists.guessAisle(str(x.item, 200) || raw) : 'other',
    };
  }).filter(Boolean).slice(0, 200);
}

const normSteps = (v) => (Array.isArray(v) ? v.map((s) => str(s, 2000)).filter(Boolean).slice(0, 100) : []);

async function createRecipe(userId, r) {
  const title = str(r.title, 200);
  if (!title) throw new Error('Give it a name.');
  const ingredients = normIngredients(r.ingredients);
  const { rows } = await libDb.getPool().query(
    `INSERT INTO hh_recipes
       (owner_id, visibility, title, description, image_url, source_url, source_name,
        servings, prep_minutes, cook_minutes, calories, category, skill, notes, ingredients, steps,
        main_ingredient, needs_review, source_key, recipe_url, partial, partial_note,
        image_candidates)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15::jsonb,$16::jsonb,$17,$18,$19,$20,$21,$22,
             $23::jsonb)
     RETURNING ${FULL_COLS}`,
    [userId, SHARED, title, str(r.description, 1000) || null, str(r.imageUrl, 1000) || null,
     str(r.sourceUrl, 2000) || null, str(r.sourceName, 120) || null,
     posInt(r.servings, 200), posInt(r.prepMinutes, 10000), posInt(r.cookMinutes, 10000),
     posInt(r.calories, 20000),
     r.category ? normCategory(r.category) : guessCategory(title),
     normSkill(r.skill), str(r.notes, 4000) || null,
     JSON.stringify(ingredients), JSON.stringify(normSteps(r.steps)),
     guessMainIngredient(title, ingredients), !!r.needsReview,
     // Falls back to deriving it from the URL for a hand-typed recipe that was
     // never imported — those still dedupe against a later paste of the link.
     str(r.sourceKey, 200) || sourceKey(r.sourceUrl),
     str(r.recipeUrl, 2000) || null, !!r.partial, str(r.partialNote, 200) || null,
     // The list the photo was chosen FROM, kept so it can be re-chosen later
     // without re-fetching a page that may be gone by then.
     Array.isArray(r.imageCandidates) && r.imageCandidates.length
       ? JSON.stringify(r.imageCandidates.slice(0, 6).map((u) => str(u, 1000)).filter(Boolean))
       : null]);

  // Copy the photo in the BACKGROUND, deliberately not awaited. Saving a recipe
  // must not sit on someone else's CDN for ten seconds, and the gap is already
  // covered: image_url is still fresh at this moment, so the card and the
  // recipe page render from the remote URL until the stored copy exists. By
  // the time that URL expires — which is the whole reason we copy it — the
  // bytes are here. captureImage swallows its own errors, so this cannot
  // produce an unhandled rejection.
  captureImage(rows[0].id, r.imageCandidates?.length ? r.imageCandidates : r.imageUrl)
    .then((res) => { if (res) console.log(`[hh-recipes] cached image for #${rows[0].id} (${res.bytes}b ${res.mime})`); })
    .catch(() => { /* already swallowed inside; belt and braces */ });

  return rows[0];
}

async function updateRecipe(userId, id, patch) {
  const sets = ['updated_at = now()'];
  const vals = [userId, Number(id)];
  const put = (col, v) => { vals.push(v); sets.push(`${col}=$${vals.length}`); };

  if (patch.title !== undefined) {
    const t = str(patch.title, 200);
    if (!t) throw new Error('Give it a name.');
    put('title', t);
  }
  if (patch.description !== undefined) put('description', str(patch.description, 1000) || null);
  if (patch.imageUrl !== undefined) put('image_url', str(patch.imageUrl, 1000) || null);
  if (patch.sourceUrl !== undefined) put('source_url', str(patch.sourceUrl, 2000) || null);
  if (patch.sourceName !== undefined) put('source_name', str(patch.sourceName, 120) || null);
  if (patch.servings !== undefined) put('servings', posInt(patch.servings, 200));
  if (patch.prepMinutes !== undefined) put('prep_minutes', posInt(patch.prepMinutes, 10000));
  if (patch.cookMinutes !== undefined) put('cook_minutes', posInt(patch.cookMinutes, 10000));
  if (patch.calories !== undefined) put('calories', posInt(patch.calories, 20000));
  if (patch.category !== undefined) put('category', normCategory(patch.category));
  if (patch.skill !== undefined) put('skill', normSkill(patch.skill));
  if (patch.notes !== undefined) put('notes', str(patch.notes, 4000) || null);
  if (patch.ingredients !== undefined) {
    vals.push(JSON.stringify(normIngredients(patch.ingredients)));
    sets.push(`ingredients=$${vals.length}::jsonb`);
  }
  if (patch.steps !== undefined) {
    vals.push(JSON.stringify(normSteps(patch.steps)));
    sets.push(`steps=$${vals.length}::jsonb`);
  }
  if (sets.length === 1) throw new Error('Nothing to update.');

  const { rows } = await libDb.getPool().query(
    `UPDATE hh_recipes SET ${sets.join(', ')} WHERE id=$2 AND ${VISIBLE} RETURNING ${FULL_COLS}`, vals);
  if (!rows[0]) throw new Error('Not found.');

  if (patch.title !== undefined || patch.ingredients !== undefined) {
    const main = guessMainIngredient(rows[0].title, rows[0].ingredients);
    await libDb.getPool().query(`UPDATE hh_recipes SET main_ingredient=$2 WHERE id=$1`, [rows[0].id, main]);
    rows[0].main_ingredient = main;
  }

  // Pointing the recipe at a new photo re-copies it. Same background treatment
  // as create — and an explicit upload (setImageFromDataUrl) is untouched by
  // this, because that path never sets image_url.
  if (patch.imageUrl !== undefined && str(patch.imageUrl, 1000)) {
    captureImage(rows[0].id, patch.imageUrl).catch(() => {});
  }

  return rows[0];
}

async function toggleFavorite(userId, id) {
  const { rows } = await libDb.getPool().query(
    `UPDATE hh_recipes SET favorite = NOT favorite WHERE id=$2 AND ${VISIBLE} RETURNING ${CARD_COLS}`,
    [userId, Number(id)]);
  if (!rows[0]) throw new Error('Not found.');
  return rows[0];
}

/** "I made this." Drives the "cooked 4 times" line and nothing else yet. */
async function markCooked(userId, id) {
  const { rows } = await libDb.getPool().query(
    `UPDATE hh_recipes SET cooked_count = cooked_count + 1, last_cooked_at = now()
      WHERE id=$2 AND ${VISIBLE} RETURNING ${CARD_COLS}`, [userId, Number(id)]);
  if (!rows[0]) throw new Error('Not found.');
  return rows[0];
}

async function deleteRecipe(userId, id) {
  const { rowCount } = await libDb.getPool().query(
    `DELETE FROM hh_recipes WHERE id=$2 AND ${VISIBLE}`, [userId, Number(id)]);
  if (!rowCount) throw new Error('Not found.');
  return true;
}

// ---------------------------------------------------------------------------
// Hand-off to the list and the week board
// ---------------------------------------------------------------------------

/**
 * Put a recipe's ingredients on the grocery list.
 *
 * Writes ordinary hh_list_items rows — the SAME table budget.cbedge.net reads —
 * so there is no sync, no mirror and no second source of truth. Scaled to the
 * servings you're actually cooking for, and tagged with recipe_id (and meal_id
 * when planning) so the list can say where a line came from.
 *
 * `only` lets the review screen drop the four things already in the cupboard.
 */
async function addToList(userId, id, { servings, mealId, only } = {}) {
  const pool = libDb.getPool();
  const recipe = await getRecipe(userId, id);
  const base = recipe.servings || null;
  const target = posInt(servings, 200);
  // No base servings means we cannot scale honestly, so we don't — 1x it is.
  const factor = base && target ? target / base : 1;

  const pick = Array.isArray(only) && only.length
    ? new Set(only.map(Number).filter(Number.isInteger))
    : null;

  const chosen = recipe.ingredients.filter((_, i) => !pick || pick.has(i));
  if (!chosen.length) throw new Error('Nothing selected.');

  const { rows: [max] } = await pool.query(
    `SELECT COALESCE(MAX(sort_order),0) AS m FROM hh_list_items WHERE list='grocery'`);
  let order = Number(max.m);

  const added = [];
  for (const ing of chosen) {
    order += 10;
    const text = scaledText(ing, factor);
    const { rows } = await pool.query(
      `INSERT INTO hh_list_items
         (owner_id, visibility, list, text, qty, aisle, meal_id, recipe_id, sort_order)
       VALUES ($1,$2,'grocery',$3,$4,$5,$6,$7,$8)
       RETURNING id, text, qty, aisle, meal_id, recipe_id`,
      [userId, SHARED, str(text, 200),
       // qty is the display hint the list already shows in its own column.
       ing.qty !== null ? str([formatQty(ing.qty * factor), ing.unit].filter(Boolean).join(' '), 40) : null,
       ing.aisle || 'other', mealId || null, recipe.id, order]);
    added.push(rows[0]);
  }
  return { added: added.length, items: added, scaledBy: factor };
}

/**
 * Put a recipe on the week board for a given day.
 *
 * withList defaults to FALSE. It used to default true, on the theory that the
 * shop should know about anything you plan — but planning and shopping happen at
 * different moments. You plan the week on Sunday and shop on Wednesday, and a
 * plan that silently dumps forty ingredients into the list means the list is
 * full of things you already own by the time you get there. "Add all" is a
 * button on the recipe, one tap away, and it belongs to the person deciding to
 * shop rather than to the person deciding what to eat.
 */
async function planMeal(userId, id, { day, servings, withList = false } = {}) {
  if (!isDate(day)) throw new Error('Pick a day.');
  const pool = libDb.getPool();
  const recipe = await getRecipe(userId, id);

  const { rows: [max] } = await pool.query(
    `SELECT COALESCE(MAX(sort_order),0) AS m FROM hh_meals WHERE day=$1::date`, [day]);
  const { rows } = await pool.query(
    `INSERT INTO hh_meals (owner_id, visibility, day, title, notes, recipe_id, sort_order)
     VALUES ($1,$2,$3::date,$4,$5,$6,$7)
     RETURNING id, owner_id, visibility, to_char(day,'YYYY-MM-DD') AS day, title, notes, recipe_id, sort_order`,
    [userId, SHARED, day, recipe.title, recipe.source_url || null, recipe.id, Number(max.m) + 10]);
  const meal = rows[0];

  let list = null;
  if (withList) {
    // A failure here must not orphan the meal — the plan is the important part
    // and the ingredients can be added again from the recipe screen.
    list = await addToList(userId, id, { servings, mealId: meal.id }).catch(() => null);
  }
  return { meal, list };
}

// ---------------------------------------------------------------------------
// Photos
// ---------------------------------------------------------------------------
//
// Stored as BYTEA in hh_recipe_images, one row per recipe, keyed by recipe_id.
//
// WHY WE COPY THE BYTES rather than keeping the source URL: a TikTok or
// Instagram cover is a SIGNED CDN url with an expiry in the query string. It
// works when you import and 403s a day later, so a cookbook built on remote
// links quietly turns into a wall of placeholder tiles. Blogs are better
// behaved but still rename, hotlink-block and go offline.
//
// WHY A SEPARATE TABLE: so `SELECT ... FROM hh_recipes` can never drag image
// bytes into a list query by accident. The cookbook index reads twenty rows; if
// the bytes lived on that row it would be an eight-megabyte response to render
// a screen of 64px thumbnails.
//
// No resizing. That would mean sharp/canvas — a native dependency, a bigger
// image, and a build that can break on a base-image bump — to save a couple of
// hundred KB on an image the source already sized for the web. The phone
// upload path downscales in the BROWSER instead, where the canvas is free.

const MAX_IMAGE_BYTES = 8 * 1024 * 1024;
const IMAGE_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/avif']);

const crypto = require('crypto');
const etagOf = (buf) => crypto.createHash('sha1').update(buf).digest('hex').slice(0, 16);

async function putImage(recipeId, buf, mime, sourceUrl) {
  await libDb.getPool().query(
    `INSERT INTO hh_recipe_images (recipe_id, mime, bytes, etag, source_url)
     VALUES ($1,$2,$3,$4,$5)
     ON CONFLICT (recipe_id) DO UPDATE
       SET mime=EXCLUDED.mime, bytes=EXCLUDED.bytes, etag=EXCLUDED.etag,
           source_url=EXCLUDED.source_url, created_at=now()`,
    [recipeId, mime, buf, etagOf(buf), sourceUrl || null]);
  return { etag: etagOf(buf), bytes: buf.length, mime };
}

/**
 * Fetch a remote image and store it. Called on create and whenever image_url
 * changes.
 *
 * Every failure path returns null instead of throwing: a recipe that saved
 * fine must not be rolled back because a CDN was slow. The card falls back to
 * the remote URL, and re-running this later fixes it.
 */
async function captureImage(recipeId, url) {
  // A LIST is the normal case now — the first candidate is the share image and
  // the rest are the page's own cover fields, tried in order only if it fails.
  // A bare string still works: hand-edited recipes and the manual re-capture
  // route both pass one.
  // Capped here rather than only where the list is built: this value can arrive
  // from the review screen, so it is client input, and six outbound fetches is
  // the ceiling regardless of what gets posted.
  const list = (Array.isArray(url) ? url : [url]).filter(Boolean).slice(0, 6);

  // MORE THAN ONE CANDIDATE: look at them before choosing.
  //
  // A TikTok cover is a frame of a video, and the frame the site picked is the
  // creator's hook shot — which is very often their face, a hand reaching into
  // a pan, or the fridge door. Nothing in the page's metadata distinguishes
  // "plate of food" from "man holding a phone", so the only honest way to pick
  // is to look. This fetches the first few, asks Claude which one is the food,
  // and stores THOSE BYTES — no second download, so the vision pass costs one
  // API call and nothing else.
  //
  // Falls back to first-that-downloads if vision is off or undecided, which is
  // exactly the old behaviour.
  if (list.length > 1 && visionConfigured()) {
    const shots = [];
    for (const one of list) {
      if (shots.length >= VISION_MAX_SHOTS) break;
      const got = await fetchImage(one);
      if (got) shots.push({ ...got, url: one });
    }
    if (!shots.length) return null;
    if (shots.length === 1) return putImage(recipeId, shots[0].buf, shots[0].mime, shots[0].url);
    const pick = await pickFoodShot(shots);
    const chosen = shots[pick] || shots[0];
    return putImage(recipeId, chosen.buf, chosen.mime, chosen.url);
  }

  for (const one of list) {
    const got = await captureOneImage(recipeId, one);
    if (got) return got;
  }
  return null;
}

// ── Which frame is the food? ─────────────────────────────────────────────────

const VISION_MODEL = process.env.RECIPE_VISION_MODEL || AI_MODEL;
const visionConfigured = () => aiConfigured() && process.env.RECIPE_VISION !== 'off';
// Four is where this stops paying for itself: the good frame is in the first
// few or it isn't in the list at all, and each extra image is another download
// and another few thousand tokens.
const VISION_MAX_SHOTS = 4;
// Claude's vision endpoint accepts these; AVIF and GIF do not go in the prompt
// (they can still be STORED — this only limits what gets looked at).
const VISION_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);

const VISION_PROMPT = `These are candidate thumbnails for a recipe. They are frames from a cooking video, so some show the cook, their kitchen, a phone, or a title card rather than the dish.

Reply with ONLY a single digit: the 0-based index of the image that best shows the finished food — a plated dish, a pan or tray of the food, the food close up.

Prefer, in order:
1. The finished dish, plated or served.
2. The food cooking, or its ingredients laid out.
3. Anything else.

Never prefer an image whose main subject is a person, a face, or an empty kitchen, unless every image is like that. If none show food at all, reply 0.`;

/**
 * Ask Claude which of the fetched frames is actually the food.
 *
 * Returns an index into `shots`, or 0 when it can't tell — never throws. A
 * photo is a nicety; failing an import over one would be absurd.
 */
async function pickFoodShot(shots) {
  const usable = shots
    .map((s, i) => ({ ...s, i }))
    .filter((s) => VISION_TYPES.has(s.mime) && s.buf.length <= 4 * 1024 * 1024);
  if (usable.length < 2) return usable[0]?.i ?? 0;

  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), 60_000);
  try {
    const content = [];
    usable.forEach((s, n) => {
      content.push({ type: 'text', text: `Image ${n}:` });
      content.push({
        type: 'image',
        source: { type: 'base64', media_type: s.mime, data: s.buf.toString('base64') },
      });
    });
    content.push({ type: 'text', text: VISION_PROMPT });

    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      signal: ctl.signal,
      headers: {
        'content-type': 'application/json',
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: VISION_MODEL,
        max_tokens: 8,
        messages: [{ role: 'user', content }],
      }),
    });
    if (!res.ok) return usable[0].i;
    const body = await res.json().catch(() => null);
    const said = (body?.content || []).map((c) => c?.text || '').join('').trim();
    const n = Number((said.match(/\d+/) || [])[0]);
    // Index into the FILTERED list, mapped back to the caller's list — they
    // differ the moment one candidate is an AVIF.
    if (Number.isInteger(n) && n >= 0 && n < usable.length) return usable[n].i;
    return usable[0].i;
  } catch {
    return usable[0].i;
  } finally {
    clearTimeout(timer);
  }
}

async function captureOneImage(recipeId, url) {
  const got = await fetchImage(url);
  return got ? putImage(recipeId, got.buf, got.mime, str(url, 2000)) : null;
}

/** The bytes and the type, or null. Split out from the store step so the vision
 *  pass can look at several candidates and store only the winner — one download
 *  each, not two. */
async function fetchImage(url) {
  const link = str(url, 2000);
  if (!link || !/^https?:\/\//i.test(link)) return null;
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), 20_000);
  try {
    const res = await fetch(link, {
      signal: ctl.signal,
      redirect: 'follow',
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122 Safari/537.36',
        'Accept': 'image/avif,image/webp,image/*,*/*;q=0.8',
        // Some CDNs (TikTok's included) serve a 403 to a request with no
        // Referer. Sending the image's own origin is enough to look ordinary.
        'Referer': new URL(link).origin + '/',
      },
    });
    if (!res.ok) return null;
    const mime = String(res.headers.get('content-type') || '').split(';')[0].trim().toLowerCase();
    if (!IMAGE_TYPES.has(mime)) return null;
    const buf = Buffer.from(await res.arrayBuffer());
    if (!buf.length || buf.length > MAX_IMAGE_BYTES) return null;
    return { buf, mime };
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * A browser upload, as a data URL: "data:image/jpeg;base64,…".
 *
 * Not multipart, deliberately — the household backend has no multipart parser
 * and a data URL rides the existing JSON body reader. The client downscales to
 * ~1400px before encoding, so the base64 inflation (×1.37) applies to a few
 * hundred KB, not a 5MB phone original.
 */
async function setImageFromDataUrl(userId, recipeId, dataUrl) {
  // Confirms the recipe exists AND is visible to this user before we store
  // anything against its id.
  await getRecipe(userId, recipeId);

  const m = String(dataUrl || '').match(/^data:([a-z/+.-]+);base64,([A-Za-z0-9+/=\s]+)$/i);
  if (!m) throw new Error("That doesn't look like an image.");
  const mime = m[1].toLowerCase();
  if (!IMAGE_TYPES.has(mime)) throw new Error('Use a JPEG, PNG or WebP.');

  const buf = Buffer.from(m[2].replace(/\s+/g, ''), 'base64');
  if (!buf.length) throw new Error('That image is empty.');
  if (buf.length > MAX_IMAGE_BYTES) throw new Error('That image is too big.');

  return putImage(recipeId, buf, mime, null);
}

/** The bytes, for the image route. Visibility-checked like everything else. */
async function readImage(userId, recipeId) {
  const { rows } = await libDb.getPool().query(
    `SELECT i.mime, i.bytes, i.etag FROM hh_recipe_images i
       JOIN hh_recipes r ON r.id = i.recipe_id
      WHERE i.recipe_id = $2 AND (r.owner_id = $1 OR r.visibility = 'shared')`,
    [userId, Number(recipeId)]);
  return rows[0] || null;
}

async function deleteImage(userId, recipeId) {
  await getRecipe(userId, recipeId);
  await libDb.getPool().query(`DELETE FROM hh_recipe_images WHERE recipe_id=$1`, [Number(recipeId)]);
  return true;
}

// ---------------------------------------------------------------------------
// Bulk import
// ---------------------------------------------------------------------------
//
// Thirty TikTok links is thirty page fetches and — because TikTok publishes no
// structured data — thirty Claude calls. At five to twenty seconds each that is
// minutes of work, so it CANNOT be one HTTP request: nginx gives up at 180s and
// the phone screen locks long before that.
//
// So it's a job. POST returns a job id immediately, the work happens in this
// process, and the client polls. Both tables are real rows, which means the
// progress list survives a container restart and a half-finished batch can be
// picked up again instead of silently vanishing.
//
// ── THE ONE POLICY DECISION ────────────────────────────────────────────────
// Single imports never write to the database until you press save on the review
// screen. Bulk imports DO save, immediately, flagged needs_review = true.
//
// That inconsistency is deliberate. A review queue you must clear before
// anything lands is a queue nobody clears at 30 items — you'd sit through
// twenty screens or abandon the batch and lose the lot. Saving first and
// flagging second means the work is never wasted: the recipes are searchable and
// cookable straight away, and "Needs review" is a filter you work through when
// you feel like it. A wrong ingredient in a saved recipe is a small annoyance;
// re-pasting thirty links is not.

/** Sequential-ish. Two at a time is polite to the sites and keeps AI spend
 *  legible; twenty parallel fetches of one domain is how you get rate-limited
 *  into a batch of failures. */
const BULK_CONCURRENCY = 2;

/** Guard against a paste that was never a list of links. */
const BULK_MAX_URLS = 60;

/** Breather between items, per worker. See the note where it's used. */
const BULK_PAUSE_MS = 800;

/** Accepts a textarea paste: newlines, commas, or whitespace between links, with
 *  or without stray quotes and trailing punctuation. */
function parseUrlList(input) {
  const seen = new Set();
  const out = [];
  for (const raw of String(input || '').split(/[\s,]+/)) {
    const t = raw.trim().replace(/^["'<(]+|["'>).,;]+$/g, '');
    if (!/^https?:\/\//i.test(t)) continue;
    let key;
    try {
      const u = new URL(t);
      // Strip tracking junk so the same video pasted from two shares doesn't
      // import twice. Everything TikTok needs is in the path.
      key = u.origin + u.pathname.replace(/\/$/, '');
    } catch { continue; }
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(t);
    if (out.length >= BULK_MAX_URLS) break;
  }
  return out;
}

async function createImportJob(userId, urls) {
  const list = parseUrlList(urls);
  if (!list.length) throw new Error('No links found in that.');

  const pool = libDb.getPool();
  const { rows: [job] } = await pool.query(
    `INSERT INTO hh_recipe_import_jobs (owner_id, total, status)
     VALUES ($1,$2,'running') RETURNING id, total, status, created_at`,
    [userId, list.length]);

  // One INSERT for the lot — thirty round trips to record thirty URLs is thirty
  // chances for the request to die half-recorded.
  const values = list.map((_, i) => `($1, $${i + 2}, 'pending')`).join(',');
  await pool.query(
    `INSERT INTO hh_recipe_import_items (job_id, url, status) VALUES ${values}`,
    [job.id, ...list]);

  // Not awaited: the caller gets its job id now and polls. runJob owns its own
  // errors, so nothing here can produce an unhandled rejection.
  runJob(userId, job.id).catch((e) => console.error('[hh-recipes] job', job.id, 'died:', e?.message || e));
  return { ...job, urls: list.length };
}

/**
 * Work one job to completion. Safe to call twice for the same job — items are
 * claimed with a conditional UPDATE, so a second runner finds nothing to do
 * rather than importing everything a second time.
 */
async function runJob(userId, jobId) {
  const pool = libDb.getPool();

  const claim = async () => {
    const { rows } = await pool.query(
      `UPDATE hh_recipe_import_items SET status='importing', updated_at=now()
        WHERE id = (SELECT id FROM hh_recipe_import_items
                     WHERE job_id=$1 AND status='pending'
                     ORDER BY id LIMIT 1 FOR UPDATE SKIP LOCKED)
        RETURNING id, url`, [jobId]);
    return rows[0] || null;
  };

  const worker = async () => {
    for (;;) {
      // A cancel between items stops the batch without killing what's done.
      const { rows: [j] } = await pool.query(
        `SELECT status FROM hh_recipe_import_jobs WHERE id=$1`, [jobId]);
      if (!j || j.status !== 'running') return;

      const item = await claim();
      if (!item) return;

      try {
        // CHECK ONE, before spending anything. Catches a link pasted in an
        // earlier batch in its canonical form, and costs a single indexed
        // lookup instead of a page fetch and an AI call.
        const pre = await findBySourceKey(userId, sourceKey(item.url));
        if (pre) {
          await pool.query(
            `UPDATE hh_recipe_import_items
                SET status='skipped', recipe_id=$2, title=$3, error=NULL, updated_at=now()
              WHERE id=$1`, [item.id, pre.id, pre.title]);
          await pool.query(`UPDATE hh_recipe_import_jobs SET done=done+1, skipped=skipped+1 WHERE id=$1`, [jobId]);
          continue;
        }

        const draft = await importRecipe({ url: item.url });

        // CHECK TWO, after the redirect resolved. A tiktokv.com/share link and
        // a vm.tiktok.com code carry no video id, so check one cannot see they
        // are the same video you already have — only the landed URL can. The
        // fetch is already paid for here; the AI call is what this saves.
        const post = await findBySourceKey(userId, draft.sourceKey);
        if (post) {
          await pool.query(
            `UPDATE hh_recipe_import_items
                SET status='skipped', recipe_id=$2, title=$3, error=NULL, updated_at=now()
              WHERE id=$1`, [item.id, post.id, post.title]);
          await pool.query(`UPDATE hh_recipe_import_jobs SET done=done+1, skipped=skipped+1 WHERE id=$1`, [jobId]);
          continue;
        }

        const recipe = await createRecipe(userId, { ...draft, needsReview: true });
        await pool.query(
          `UPDATE hh_recipe_import_items
              SET status='saved', recipe_id=$2, title=$3, via=$4, error=NULL, updated_at=now()
            WHERE id=$1`, [item.id, recipe.id, recipe.title, draft.via]);
        await pool.query(`UPDATE hh_recipe_import_jobs SET done=done+1, ok=ok+1 WHERE id=$1`, [jobId]);
      } catch (err) {
        // A dead link must not stop the other twenty-nine. The message is kept
        // per row so the progress list can say WHY, next to the URL.
        //
        // notRecipe is NOT a failure — it is the gate doing its job, it cost no
        // AI call, and retrying it would fetch the same page to reach the same
        // conclusion. Its own status keeps it out of the retry queue and out of
        // a failure count that would otherwise read as "the import is broken".
        //
        // Three gated outcomes, not two. `nowritten` — food, but the method is
        // spoken in the video — is checked FIRST because noWrittenRecipe() also
        // sets notRecipe (it must, to stay out of the retry queue), so testing
        // notRecipe first would bury every one of them in the not-food pile.
        // That pile is the one you skim and discard; this pile is the one worth
        // opening the video for.
        const status = err?.foodNoRecipe ? 'nowritten' : err?.notRecipe ? 'notrecipe' : 'failed';
        await pool.query(
          `UPDATE hh_recipe_import_items SET status=$3, error=$2, updated_at=now() WHERE id=$1`,
          [item.id, String(err?.message || err).slice(0, 500), status]);
        await pool.query(
          `UPDATE hh_recipe_import_jobs SET done=done+1, ${status}=${status}+1 WHERE id=$1`,
          [jobId]);
      }

      // Be a good citizen. 1,480 links through two workers with no pause is a
      // sustained hammering of one host and the fastest way to get the whole
      // batch 403'd. The fetch itself already takes seconds; this barely shows.
      if (BULK_PAUSE_MS) await new Promise((r) => setTimeout(r, BULK_PAUSE_MS));
    }
  };

  await Promise.all(Array.from({ length: BULK_CONCURRENCY }, worker));

  await pool.query(
    `UPDATE hh_recipe_import_jobs
        SET status = CASE WHEN status='running' THEN 'done' ELSE status END,
            finished_at = now()
      WHERE id=$1`, [jobId]);
}

/**
 * Put the failures back in the queue.
 *
 * A batch of a hundred will always throw off a handful of timeouts and blocked
 * fetches, and re-pasting the whole list to catch six of them would re-check a
 * hundred URLs and re-import nothing. Only 'failed' rows are reset; 'saved' and
 * 'skipped' stay exactly as they are, so this is safe to press repeatedly.
 *
 * The job's counters are rewound by the number of retries rather than zeroed —
 * `done` must keep counting the work already finished or the progress bar jumps
 * backwards.
 */
async function retryImportJob(userId, jobId) {
  const pool = libDb.getPool();
  const { rows } = await pool.query(
    `UPDATE hh_recipe_import_items SET status='pending', error=NULL, updated_at=now()
      WHERE job_id=$1 AND status='failed' RETURNING id`, [Number(jobId)]);
  if (!rows.length) return getImportJob(userId, jobId);

  await pool.query(
    `UPDATE hh_recipe_import_jobs
        SET status='running', finished_at=NULL,
            done = GREATEST(done - $2, 0), failed = GREATEST(failed - $2, 0)
      WHERE id=$1`, [Number(jobId), rows.length]);

  runJob(userId, Number(jobId))
    .catch((e) => console.error('[hh-recipes] retry', jobId, 'died:', e?.message || e));
  return getImportJob(userId, jobId);
}

/**
 * Everything a bulk run did NOT import, across EVERY job — the by-hand pile.
 *
 * Deliberately not per-job: twenty-five batches means twenty-five progress
 * panels, and nobody is going to open each one to copy six URLs out of it. This
 * is the one list you work through afterwards.
 *
 * Three things are filtered out, and each matters:
 *
 *   1. A URL that succeeded in ANY job. Retry-failed and a later re-paste both
 *      leave the old failed row behind; showing it would send you chasing a
 *      recipe you already have.
 *   2. A URL whose recipe now exists by source_key — covers importing it by
 *      hand, or the same video arriving under its canonical link.
 *   3. Duplicates. DISTINCT ON keeps the most recent attempt, so the reason you
 *      see is the reason it failed LAST, not the first time you tried.
 *
 * `notrecipe` and `failed` are returned together but tagged, because they are
 * different jobs for you: a failure is worth retrying, a not-food is worth
 * eyeballing before you bother.
 */
async function listImportMisses(userId, { limit = 1000 } = {}) {
  const pool = libDb.getPool();
  const { rows } = await pool.query(
    `SELECT DISTINCT ON (i.url) i.url, i.status, i.error, i.updated_at, i.job_id
       FROM hh_recipe_import_items i
      WHERE i.status IN ('failed', 'notrecipe', 'nowritten')
        AND NOT EXISTS (
          SELECT 1 FROM hh_recipe_import_items s
           WHERE s.url = i.url AND s.status IN ('saved', 'skipped'))
      ORDER BY i.url, i.updated_at DESC
      LIMIT $1`, [Math.min(Number(limit) || 1000, 5000)]);

  // The source_key check can't be done in that query — the key is derived in JS
  // — so it happens here, on a few hundred rows at most.
  const keys = rows.map((r) => sourceKey(r.url)).filter(Boolean);
  const have = new Set();
  if (keys.length) {
    const { rows: existing } = await pool.query(
      `SELECT source_key FROM hh_recipes WHERE source_key = ANY($2::text[]) AND ${VISIBLE}`,
      [userId, keys]);
    existing.forEach((e) => have.add(e.source_key));
  }

  // Ordered by how much your time is worth on each: a video that HAS a recipe
  // you can read off the screen first, then the ones that broke, then the pile
  // that had no food in it at all — which is mostly not worth opening.
  const RANK = { nowritten: 0, failed: 1, notrecipe: 2 };
  const misses = rows
    .filter((r) => !have.has(sourceKey(r.url)))
    .sort((a, b) =>
      (RANK[a.status] ?? 9) - (RANK[b.status] ?? 9) ||
      String(b.updated_at).localeCompare(String(a.updated_at)));

  return {
    misses,
    total: misses.length,
    failed: misses.filter((m) => m.status === 'failed').length,
    notrecipe: misses.filter((m) => m.status === 'notrecipe').length,
    nowritten: misses.filter((m) => m.status === 'nowritten').length,
  };
}

async function getImportJob(userId, jobId) {
  const pool = libDb.getPool();
  const { rows: [job] } = await pool.query(
    `SELECT id, owner_id, total, done, ok, failed, skipped, notrecipe, nowritten, status, created_at, finished_at
       FROM hh_recipe_import_jobs WHERE id=$1 AND (owner_id=$2 OR TRUE)`, [Number(jobId), userId]);
  if (!job) throw new Error('Not found.');
  const { rows: items } = await pool.query(
    `SELECT id, url, status, recipe_id, title, error, via, updated_at
       FROM hh_recipe_import_items WHERE job_id=$1 ORDER BY id`, [job.id]);
  return { job, items };
}

/** The most recent job, so reopening the Add screen shows a batch still running
 *  instead of an empty form and no way back to it. */
async function latestImportJob(userId) {
  const { rows } = await libDb.getPool().query(
    `SELECT id FROM hh_recipe_import_jobs ORDER BY id DESC LIMIT 1`);
  if (!rows[0]) return null;
  return getImportJob(userId, rows[0].id);
}

async function cancelImportJob(userId, jobId) {
  const pool = libDb.getPool();
  await pool.query(
    `UPDATE hh_recipe_import_jobs SET status='cancelled', finished_at=now()
      WHERE id=$1 AND status='running'`, [Number(jobId)]);
  // Anything still queued is dropped; anything mid-flight finishes and saves,
  // because killing a Claude call we have already paid for is pure waste.
  await pool.query(
    `UPDATE hh_recipe_import_items SET status='failed', error='Cancelled', updated_at=now()
      WHERE job_id=$1 AND status='pending'`, [Number(jobId)]);
  return getImportJob(userId, jobId);
}

/**
 * Restart any job that was mid-flight when the process died.
 *
 * Called once on boot by household-server.js — NOT by the api-router fallback
 * mount, because import work has no business running inside the trading process.
 * Items left 'importing' are reset to 'pending': that item's fetch is gone, and
 * re-running one page is cheaper than leaving a batch permanently half-done.
 */
async function resumeImportJobs(ownerFallbackId) {
  if (!libDb) return 0;
  const pool = libDb.getPool();
  const { rows } = await pool.query(
    `SELECT id, owner_id FROM hh_recipe_import_jobs WHERE status='running' ORDER BY id`);
  if (!rows.length) return 0;
  await pool.query(
    `UPDATE hh_recipe_import_items SET status='pending', updated_at=now()
      WHERE status='importing' AND job_id = ANY($1::int[])`, [rows.map((r) => r.id)]);
  for (const j of rows) {
    console.log(`[hh-recipes] resuming import job ${j.id}`);
    runJob(j.owner_id || ownerFallbackId, j.id)
      .catch((e) => console.error('[hh-recipes] resume', j.id, 'failed:', e?.message || e));
  }
  return rows.length;
}

// ---------------------------------------------------------------------------
// The week
// ---------------------------------------------------------------------------
//
// What's planned, by day. Reads hh_meals — the SAME rows budget.cbedge.net's
// week board writes, and the same rows planMeal() creates. There is no second
// plan: cook something here and it shows there, move it there and it moves here.
//
// Deliberately leaner than _lib-household-lists.cjs's getWeek(): that one nests
// every ingredient under every meal because the Lists screen needs to tick them
// off. This screen needs a photo, a title and a time — pulling the items too
// would be a few hundred KB nobody looks at.

async function getPlannedWeek(userId, tz = 'America/New_York', dateStr) {
  if (!hlists) throw new Error('Lists module unavailable.');
  const pool = libDb.getPool();
  const today = hlists.todayIn(tz);
  const anchor = isDate(dateStr) ? dateStr : today;
  const start = hlists.weekStart(anchor);
  const end = hlists.addDays(start, 6);

  // LEFT JOIN, not INNER: a meal typed straight into budget.cbedge.net ("chinese
  // takeaway") has no recipe_id, and dropping those would make this screen
  // quietly disagree with the week board it shares a table with.
  const { rows } = await pool.query(
    `SELECT m.id, to_char(m.day,'YYYY-MM-DD') AS day, m.title, m.notes, m.sort_order,
            m.recipe_id,
            r.main_ingredient, r.prep_minutes, r.cook_minutes, r.servings, r.image_url,
            (SELECT i.etag FROM hh_recipe_images i WHERE i.recipe_id = r.id) AS image_etag
       FROM hh_meals m
       LEFT JOIN hh_recipes r ON r.id = m.recipe_id
      WHERE (m.owner_id = $1 OR m.visibility = 'shared')
        AND m.day BETWEEN $2::date AND $3::date
      ORDER BY m.day, m.sort_order, m.id`, [userId, start, end]);

  const days = [];
  for (let i = 0; i < 7; i++) {
    const day = hlists.addDays(start, i);
    days.push({ day, isToday: day === today, meals: rows.filter((m) => m.day === day) });
  }
  return { weekStart: start, weekEnd: end, today, days, planned: rows.length };
}

/** Take something off the plan. Deletes the hh_meals row and nothing else —
 *  its ingredients stay on the grocery list, because ON DELETE SET NULL, and
 *  because you may well still want the tortillas. */
async function unplanMeal(userId, mealId) {
  const { rowCount } = await libDb.getPool().query(
    `DELETE FROM hh_meals WHERE id=$2 AND (owner_id = $1 OR visibility = 'shared')`,
    [userId, Number(mealId)]);
  if (!rowCount) throw new Error('Not found.');
  return true;
}

/** Drag Tuesday's dinner to Thursday. */
async function moveMeal(userId, mealId, day) {
  if (!isDate(day)) throw new Error('Pick a day.');
  const { rows } = await libDb.getPool().query(
    `UPDATE hh_meals SET day=$3::date WHERE id=$2 AND (owner_id = $1 OR visibility = 'shared')
     RETURNING id, to_char(day,'YYYY-MM-DD') AS day, title, recipe_id`,
    [userId, Number(mealId), day]);
  if (!rows[0]) throw new Error('Not found.');
  return rows[0];
}

/** The one-line summary, for a Today card in the household app. */
async function summary(userId) {
  const { rows } = await libDb.getPool().query(
    `SELECT COUNT(*)::int AS n, COUNT(*) FILTER (WHERE favorite)::int AS favorites
       FROM hh_recipes WHERE ${VISIBLE}`, [userId]);
  return rows[0] || { n: 0, favorites: 0 };
}

module.exports = {
  available,
  CATEGORIES,
  aiConfigured,
  // Exported for the self-test and for anything that wants the same parsing.
  parseIngredient, formatQty, scaledText, isoMinutes, stripTags,
  guessMainIngredient, tidyIngredientName, SORTS, SORT_KEYS,
  recipeSignals, looksLikeRecipe, captionLinks, mentionsRecipeElsewhere, normaliseCaption,
  findRecipeNode, recipeFromJsonLd,
  metaContent, embeddedCaption, imageCandidates, candidatesForUrl, handleFromUrl,
  importRecipe,
  listRecipes, getRecipe, summary,
  createRecipe, updateRecipe, deleteRecipe, toggleFavorite, markCooked,
  addToList, planMeal,
  captureImage, setImageFromDataUrl, readImage, deleteImage, MAX_IMAGE_BYTES, IMAGE_TYPES,
  parseUrlList, createImportJob, getImportJob, latestImportJob, cancelImportJob, resumeImportJobs,
  retryImportJob, sourceKey, authorFromHtml, findBySourceKey, listImportMisses,
  getPlannedWeek, unplanMeal, moveMeal,
  BULK_MAX_URLS,
};
