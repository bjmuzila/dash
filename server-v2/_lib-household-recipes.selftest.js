'use strict';
/**
 * server-v2/_lib-household-recipes.selftest.js
 *
 *   node server-v2/_lib-household-recipes.selftest.js
 *
 * No database and no network. Everything here is the pure half of the recipes
 * lib — ingredient parsing, quantity formatting, ISO durations, JSON-LD
 * extraction — which is exactly the half that silently produces wrong food.
 *
 * The formatQty cases are ALSO the contract for the duplicate implementation in
 * recipe-vite/src/pages/Recipe.tsx. The client has to re-render on every tap of
 * the servings stepper and cannot round-trip for it, so the function exists
 * twice on purpose. If you change one, change both and update this file.
 */

const r = require('./_lib-household-recipes.cjs');

let pass = 0;
const fails = [];

function eq(actual, expected, what) {
  const a = JSON.stringify(actual);
  const b = JSON.stringify(expected);
  if (a === b) { pass++; return; }
  fails.push(`${what}\n    expected ${b}\n    got      ${a}`);
}

function near(actual, expected, what, tol = 1e-6) {
  if (typeof actual === 'number' && Math.abs(actual - expected) < tol) { pass++; return; }
  fails.push(`${what}\n    expected ~${expected}\n    got      ${actual}`);
}

// ── Quantities ───────────────────────────────────────────────────────────────

eq(r.formatQty(1), '1', 'formatQty whole');
eq(r.formatQty(0.5), '1/2', 'formatQty half');
eq(r.formatQty(1.5), '1 1/2', 'formatQty mixed');
eq(r.formatQty(0.25), '1/4', 'formatQty quarter');
eq(r.formatQty(1 / 3), '1/3', 'formatQty third');
eq(r.formatQty(2 / 3), '2/3', 'formatQty two thirds');
// Nothing near a kitchen fraction — a decimal is more honest than a fraction
// that's quietly 8% off.
eq(r.formatQty(1.42), '1.42', 'formatQty falls back to a decimal');
// Rounding noise from scaling must not print "2 1/16".
eq(r.formatQty(2.02), '2', 'formatQty absorbs float noise');

// ── Ingredient parsing ───────────────────────────────────────────────────────

const milk = r.parseIngredient('1 1/2 cups whole milk');
near(milk.qty, 1.5, 'parse "1 1/2 cups" qty');
eq(milk.unit, 'cup', 'parse "1 1/2 cups" unit');
eq(milk.item, 'whole milk', 'parse "1 1/2 cups" item');
eq(milk.aisle, 'dairy', 'milk lands in dairy');

const vulgar = r.parseIngredient('1½ tsp vanilla extract');
near(vulgar.qty, 1.5, 'parse a vulgar fraction glued to a number');
eq(vulgar.unit, 'tsp', 'vulgar-fraction unit');

const bananas = r.parseIngredient('4 ripe bananas');
near(bananas.qty, 4, 'parse a bare count');
eq(bananas.unit, null, 'a bare count has no unit');
eq(bananas.aisle, 'produce', 'bananas land in produce');

// A range scales off the LOW end. Averaging invents precision the recipe
// never had.
near(r.parseIngredient('2-3 cloves garlic').qty, 2, 'ranges take the low end');

// The whole point of the conservative parser: an unparseable line keeps its
// text and gets NO quantity, so scaling leaves it alone.
const pinch = r.parseIngredient('A pinch of flaky salt');
eq(pinch.qty, null, 'unparseable line has no qty');
eq(pinch.item, 'A pinch of flaky salt', 'unparseable line keeps its whole text');
eq(r.scaledText(pinch, 4), 'A pinch of flaky salt', 'scaling cannot multiply a pinch');

eq(r.scaledText(milk, 2), '3 cup whole milk', 'scaling doubles a parsed line');
eq(r.scaledText(milk, 1 / 3), '1/2 cup whole milk', 'scaling down a parsed line');

eq(r.parseIngredient('  '), null, 'blank line is dropped');
eq(r.parseIngredient('• 2 eggs').item, 'eggs', 'a leading bullet is stripped');

// ── ISO 8601 durations ───────────────────────────────────────────────────────

eq(r.isoMinutes('PT1H30M'), 90, 'PT1H30M');
eq(r.isoMinutes('PT45M'), 45, 'PT45M');
eq(r.isoMinutes('PT2H'), 120, 'PT2H');
eq(r.isoMinutes('nonsense'), null, 'garbage duration is null, not 0');

// ── JSON-LD extraction ───────────────────────────────────────────────────────

const PAGE = `<html><head>
<script type="application/ld+json">{"@context":"https://schema.org","@graph":[
  {"@type":"WebSite","name":"A Food Blog"},
  {"@type":"Recipe","name":"Sticky Banana Bread Pudding Cake",
   "description":"<p>Warm and cozy.</p>",
   "image":["https://example.com/cake.jpg"],
   "author":{"@type":"Person","name":"The Salty Cooker"},
   "recipeYield":"8 servings","prepTime":"PT20M","cookTime":"PT40M",
   "nutrition":{"@type":"NutritionInformation","calories":"350 kcal"},
   "recipeIngredient":["4 ripe bananas","1 1/2 cups whole milk","2 tsp vanilla extract"],
   "recipeInstructions":[{"@type":"HowToStep","text":"Heat the oven to 350F."},
                         {"@type":"HowToStep","text":"Whisk everything together."}]}
]}</script></head><body>life story</body></html>`;

const node = r.findRecipeNode(PAGE);
eq(!!node, true, 'finds a Recipe inside @graph');

const got = r.recipeFromJsonLd(node, 'https://example.com/cake');
eq(got.title, 'Sticky Banana Bread Pudding Cake', 'json-ld title');
eq(got.description, 'Warm and cozy.', 'json-ld description is de-tagged');
eq(got.servings, 8, 'json-ld yield → servings');
eq(got.prepMinutes, 20, 'json-ld prepTime');
eq(got.cookMinutes, 40, 'json-ld cookTime');
eq(got.calories, 350, 'json-ld calories digits only');
eq(got.sourceName, 'The Salty Cooker', 'json-ld author');
eq(got.imageUrl, 'https://example.com/cake.jpg', 'json-ld image (array form)');
eq(got.ingredients.length, 3, 'json-ld ingredient count');
eq(got.steps, ['Heat the oven to 350F.', 'Whisk everything together.'], 'json-ld HowToStep list');
eq(got.category, 'dessert', 'category guessed from the title');
eq(got.via, 'json-ld', 'reports how it was read');

// A Recipe node with no ingredients is a roundup post, not a recipe. Returning
// null is what sends it to the AI path instead of saving an empty shell.
eq(r.recipeFromJsonLd({ '@type': 'Recipe', name: 'Best Cakes of 2026' }, 'x'), null,
   'a Recipe node with no ingredients is rejected');

// One malformed block must not lose the good one after it.
const MESSY = `<script type="application/ld+json">{ not json </script>` + PAGE;
eq(!!r.findRecipeNode(MESSY), true, 'a broken JSON-LD block is skipped, not fatal');

// Instructions as one HTML blob of <li> — very common.
eq(r.recipeFromJsonLd({
  '@type': 'Recipe',
  name: 'Toast',
  recipeIngredient: ['2 slices bread'],
  recipeInstructions: '<ol><li>Toast the bread.</li><li>Butter it.</li></ol>',
}, null).steps, ['Toast the bread.', 'Butter it.'], 'instructions as an <li> blob');

// ── JS-rendered pages (TikTok / Instagram) ───────────────────────────────────
//
// These sites render everything client-side: the <body> is an empty shell and
// the caption — the entire recipe — sits in a JSON blob inside a <script>,
// which stripTags() correctly throws away. Confirmed against a real TikTok on
// 2026-08-12: og:description was absent, `"desc"` held the whole thing.

const TIKTOK = `<html><head><title>TikTok - Make Your Day</title>
<meta property="og:image" content="https://p16.tiktokcdn.com/thumb.jpg"/></head>
<body><div id="app"></div>
<script id="__UNIVERSAL_DATA_FOR_REHYDRATION__" type="application/json">
{"a":{"b":{"desc":"CHEESY BUTTER CHICKEN GARLIC BREAD \\ud83e\\udd56 Creamy, cheesy and garlicky.\\nIngredients\\n1 Ciabatta loaf\\n500g chicken breast\\n1 cup mozzarella cheese\\n2 tbsp tomato paste","nickname":"lulu"},
 "c":{"desc":"short one"},
 "d":{"description":"Sign up to see more videos from creators you follow on the app."}}}
</script></body></html>`;

const cap = r.embeddedCaption(TIKTOK);
eq(/^CHEESY BUTTER CHICKEN GARLIC BREAD/.test(cap || ''), true, 'caption pulled from a script JSON blob');
eq(cap.includes('1 cup mozzarella cheese'), true, 'caption keeps its ingredient lines');
// \n arrives escaped inside the JSON string and must come back as a real
// newline, or the AI sees one run-on paragraph.
eq(cap.includes('\n'), true, 'JSON escapes are decoded');
eq(cap.includes('🥖'), true, 'surrogate-pair emoji survives');
// Longest-wins, so the boilerplate "Sign up to see more videos" loses.
eq(cap.includes('Sign up'), false, 'boilerplate description loses to the real caption');

// stripTags is what made this necessary — proof the body alone is useless.
eq(r.stripTags(TIKTOK).includes('mozzarella'), false, 'the caption is NOT in the page body');

// Instagram nests it one level deeper.
const IG = `<script>{"edge_media_to_caption":{"edges":[{"node":{"text":"Miso mushroom pasta. 200g pasta, 2 tbsp miso, 300g mushrooms, 1 clove garlic."}}]}}</script>`;
eq(/^Miso mushroom pasta/.test(r.embeddedCaption(IG) || ''), true, 'Instagram caption edge');

// An ordinary blog has no caption JSON — the extractor must return null rather
// than dredging up some random short string.
eq(r.embeddedCaption('<html><body><p>Just a normal page.</p></body></html>'), null,
   'no caption on an ordinary page');

// Meta, both attribute orders.
eq(r.metaContent('<meta property="og:description" content="Hello there"/>', 'og:description'),
   'Hello there', 'meta property=… content=…');
eq(r.metaContent('<meta content="Hello there" name="description"/>', 'description'),
   'Hello there', 'meta content=… name=… (reversed)');
eq(r.metaContent('<html></html>', 'og:image'), null, 'missing meta is null');

// The by-line credits the creator, not the domain.
eq(r.handleFromUrl('https://www.tiktok.com/@fit_foodie_lulu/video/7672328780597267730'),
   '@fit_foodie_lulu', 'tiktok handle');
eq(r.handleFromUrl('https://www.instagram.com/reel/Cxyz/'), '@reel', 'instagram path first segment');
eq(r.handleFromUrl('https://thesaltycooker.com/banana-cake'), null, 'ordinary site has no handle');

// ── Main ingredient ──────────────────────────────────────────────────────────
//
// TITLE FIRST, and this is the case that proves why: sixteen ingredients, and
// the one that matters is the only one named in the title. An ingredient-first
// scan files this under "ciabatta loaf" — the line that happens to be listed
// first.
const gbIngredients = [
  '1 Ciabatta loaf sliced in half lengthways',
  '500g chicken breast or tenders',
  '1 cup mozzarella cheese',
].map(r.parseIngredient);

eq(r.guessMainIngredient('Cheesy Butter Chicken Garlic Bread', gbIngredients), 'chicken',
   'title beats ingredient order');
// Most specific hero wins, so a thigh recipe is not filed under plain chicken.
eq(r.guessMainIngredient('Crispy chicken thighs with lemon', []), 'chicken thigh',
   'longer hero match wins');
eq(r.guessMainIngredient('Miso, Mushroom & Guanciale Pasta', []), 'guanciale',
   'first hero in the list order wins, not first in the string');
eq(r.guessMainIngredient('Fajita Steak Loaded Sweet Potato Nachos', []), 'steak', 'steak over sweet potato');

// No hero in the title → best-ranked aisle, meat first.
eq(r.guessMainIngredient('Tuesday tray bake', [
  r.parseIngredient('2 tbsp olive oil'),
  r.parseIngredient('500 g pork shoulder'),
  r.parseIngredient('3 carrots'),
]), 'pork shoulder', 'falls back to the meat-aisle ingredient');

// Everything unrecognisable → NULL, not a wrong guess. A recipe filed under a
// random pantry item sorts somewhere absurd.
eq(r.guessMainIngredient('Mystery dish', [r.parseIngredient('a splash of something')]), null,
   'no confident guess returns null');

eq(r.tidyIngredientName('boneless skinless chicken thighs, trimmed'), 'chicken thigh',
   'descriptors stripped, last word singularised');
eq(r.tidyIngredientName('2 large ripe bananas'), 'banana', 'adjectives dropped');
eq(r.tidyIngredientName('hummus'), 'hummus', "words ending in 'us' are not butchered");

// ── Sort whitelist ───────────────────────────────────────────────────────────
// There must be no path from a query parameter into SQL.
eq(r.SORT_KEYS.includes('main') && r.SORT_KEYS.includes('name'), true, 'sort keys exposed');
eq(Object.values(r.SORTS).every((s) => typeof s.sql === 'string' && !/\$|;/.test(s.sql)), true,
   'every sort is a fixed fragment with no placeholders or statement breaks');

// ── Bulk URL parsing ─────────────────────────────────────────────────────────
const pasted = `
https://www.tiktok.com/@a/video/111
  https://www.tiktok.com/@b/video/222?is_from_webapp=1&sender_device=pc
"https://www.tiktok.com/@c/video/333",
https://www.tiktok.com/@a/video/111/
not-a-link
mailto:someone@example.com
`;
const urls = r.parseUrlList(pasted);
eq(urls.length, 3, 'three unique links out of that paste');
eq(urls[0], 'https://www.tiktok.com/@a/video/111', 'plain link kept verbatim');
// Query junk is ignored for DEDUPE but kept on the URL we actually fetch —
// stripping params could break a link that needs them.
eq(urls[1].includes('is_from_webapp'), true, 'tracking params are not stripped from the fetch URL');
eq(urls[2], 'https://www.tiktok.com/@c/video/333', 'quotes and trailing comma trimmed');
eq(r.parseUrlList('nothing here at all').length, 0, 'no links → empty, and the route turns that into an error');
eq(r.parseUrlList(Array.from({ length: 200 }, (_, i) => `https://x.com/v/${i}`).join('\n')).length,
   r.BULK_MAX_URLS, 'capped at BULK_MAX_URLS');

// ── Report ───────────────────────────────────────────────────────────────────

if (fails.length) {
  console.error(`\n${fails.length} FAILED, ${pass} passed\n`);
  fails.forEach((f) => console.error('  ✗ ' + f + '\n'));
  process.exit(1);
}
console.log(`recipes selftest: ${pass} passed`);
