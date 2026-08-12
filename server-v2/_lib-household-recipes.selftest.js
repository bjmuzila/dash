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

// ── Report ───────────────────────────────────────────────────────────────────

if (fails.length) {
  console.error(`\n${fails.length} FAILED, ${pass} passed\n`);
  fails.forEach((f) => console.error('  ✗ ' + f + '\n'));
  process.exit(1);
}
console.log(`recipes selftest: ${pass} passed`);
