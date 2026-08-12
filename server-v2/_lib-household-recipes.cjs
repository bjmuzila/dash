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
 * So: scan the raw HTML for JSON string fields that hold prose, and take the
 * longest one. Keys are restricted to desc/description/caption (plus
 * Instagram's nested caption edge) — matching a bare "text" key would sweep up
 * button labels and menu items, and the longest-wins rule would then pick some
 * cookie-consent paragraph instead of the recipe.
 *
 * Length floors do the rest of the filtering: a real recipe caption is
 * hundreds of characters, an SEO blurb is not.
 */
const CAPTION_KEYS = /"(?:desc|description|caption)"\s*:\s*"((?:[^"\\]|\\.){60,}?)"/g;
const IG_CAPTION = /"edge_media_to_caption"\s*:\s*\{[\s\S]{0,2000}?"text"\s*:\s*"((?:[^"\\]|\\.){40,}?)"/;

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
  CAPTION_KEYS.lastIndex = 0;
  while ((m = CAPTION_KEYS.exec(html)) !== null) {
    push(m[1]);
    // A 400KB page of minified JSON can hold a lot of matches; the recipe is
    // never the two-hundredth one.
    if (found.length > 200) break;
  }

  if (!found.length) return null;
  found.sort((a, b) => b.length - a.length);
  return found[0].slice(0, 8000);
}

/** "@fit_foodie_lulu" out of a TikTok/Instagram URL, for the by-line. */
function handleFromUrl(url) {
  try {
    const u = new URL(url);
    if (!/(^|\.)(tiktok|instagram)\.com$/i.test(u.hostname.replace(/^www\./, ''))) return null;
    const m = u.pathname.match(/\/@?([A-Za-z0-9._]{2,30})(?:\/|$)/);
    return m ? `@${m[1].replace(/^@/, '')}` : null;
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
    return buf.toString('utf8');
  } catch (e) {
    if (e.name === 'AbortError') throw new Error('That site took too long to answer.');
    throw e;
  } finally {
    clearTimeout(timer);
  }
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
async function importRecipe({ url, text }) {
  const link = str(url, 2000);
  const pasted = str(text, 60_000);
  if (!link && !pasted) throw new Error('Paste a link or the recipe text.');

  if (!link) {
    // Pasted text — an Instagram caption, a screenshot transcription, a note.
    // There is no structured data to try first, so this always goes to the AI.
    return recipeFromAi(await aiExtract(pasted), null, pasted.split('\n')[0]);
  }

  const html = await fetchPage(link);

  const node = findRecipeNode(html);
  if (node) {
    const fromLd = recipeFromJsonLd(node, link);
    if (fromLd) return fromLd;
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

  const draft = recipeFromAi(await aiExtract(readable), link, stripTags(pageTitle));
  // The AI never sees images; og:image is how the card gets a photo on the
  // pages that had no JSON-LD.
  if (ogImage) draft.imageUrl = str(ogImage, 1000);
  // "by @fit_foodie_lulu" reads better than "by tiktok.com" — and it's the
  // credit the creator is actually owed.
  const handle = handleFromUrl(link);
  if (handle) draft.sourceName = handle;
  return draft;
}

// ---------------------------------------------------------------------------
// Read
// ---------------------------------------------------------------------------

// The list view deliberately does NOT select ingredients/steps. A cookbook of
// 300 recipes is a few hundred KB of JSONB nobody is looking at on the index
// screen, and on a phone that is the difference between instant and not.
const CARD_COLS = `id, owner_id, visibility, title, description, image_url, source_url, source_name,
  servings, prep_minutes, cook_minutes, calories, category, skill, favorite,
  cooked_count, last_cooked_at, jsonb_array_length(ingredients) AS ingredient_count,
  created_at, updated_at`;

const FULL_COLS = `id, owner_id, visibility, title, description, image_url, source_url, source_name,
  servings, prep_minutes, cook_minutes, calories, category, skill, favorite, notes,
  ingredients, steps, cooked_count, last_cooked_at, created_at, updated_at`;

async function listRecipes(userId, { q, category, favorite } = {}) {
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
  if (favorite) where.push('favorite = TRUE');

  const { rows } = await pool.query(
    `SELECT ${CARD_COLS} FROM hh_recipes WHERE ${where.join(' AND ')}
      ORDER BY favorite DESC, updated_at DESC LIMIT 500`, vals);

  const { rows: counts } = await pool.query(
    `SELECT category, COUNT(*)::int AS n FROM hh_recipes WHERE ${VISIBLE} GROUP BY category`, [userId]);

  return {
    recipes: rows,
    categories: CATEGORIES,
    counts: Object.fromEntries(counts.map((c) => [c.category, c.n])),
    total: rows.length,
    aiConfigured: aiConfigured(),
  };
}

async function getRecipe(userId, id) {
  const { rows } = await libDb.getPool().query(
    `SELECT ${FULL_COLS} FROM hh_recipes WHERE id=$2 AND ${VISIBLE}`, [userId, Number(id)]);
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
        servings, prep_minutes, cook_minutes, calories, category, skill, notes, ingredients, steps)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15::jsonb,$16::jsonb)
     RETURNING ${FULL_COLS}`,
    [userId, SHARED, title, str(r.description, 1000) || null, str(r.imageUrl, 1000) || null,
     str(r.sourceUrl, 2000) || null, str(r.sourceName, 120) || null,
     posInt(r.servings, 200), posInt(r.prepMinutes, 10000), posInt(r.cookMinutes, 10000),
     posInt(r.calories, 20000),
     r.category ? normCategory(r.category) : guessCategory(title),
     normSkill(r.skill), str(r.notes, 4000) || null,
     JSON.stringify(ingredients), JSON.stringify(normSteps(r.steps))]);
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
 * Put a recipe on the week board for a given day, and (by default) its
 * ingredients on the list attached to that meal — which is the whole point of
 * planning something: the shop knows about it.
 */
async function planMeal(userId, id, { day, servings, withList = true } = {}) {
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
  findRecipeNode, recipeFromJsonLd,
  metaContent, embeddedCaption, handleFromUrl,
  importRecipe,
  listRecipes, getRecipe, summary,
  createRecipe, updateRecipe, deleteRecipe, toggleFavorite, markCooked,
  addToList, planMeal,
};
