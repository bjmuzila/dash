#!/usr/bin/env node
'use strict';
/**
 * server-v2/scripts/backfill-recipe-mains.js
 *
 *   docker compose exec -T household node server-v2/scripts/backfill-recipe-mains.js
 *   ... --force    recompute every recipe, not just the ones with no value
 *   ... --dry      print what it would set and change nothing
 *
 * Fills in main_ingredient for recipes imported before the column existed.
 * Without this, "sort by main ingredient" puts your whole existing cookbook in
 * the NULLS LAST bucket and the feature looks broken on the one screen you'd
 * check it on.
 *
 * --force is for after you've edited the HEROES list: the guess is derived, so
 * re-deriving it is always safe and never loses anything a human typed.
 */

const recipes = require('../_lib-household-recipes.cjs');
const libDb = require('../_lib-db.cjs');

const FORCE = process.argv.includes('--force');
const DRY = process.argv.includes('--dry');

(async () => {
  if (!recipes.available()) {
    console.error('No database layer — is DATABASE_URL set?');
    process.exit(1);
  }
  const pool = libDb.getPool();
  const { rows } = await pool.query(`
    SELECT id, title, ingredients, main_ingredient
      FROM hh_recipes
     ${FORCE ? '' : 'WHERE main_ingredient IS NULL'}
     ORDER BY id`);

  if (!rows.length) {
    console.log('Nothing to do — every recipe already has a main ingredient.');
    process.exit(0);
  }
  console.log(`${rows.length} recipe(s)${FORCE ? ' (forced)' : ''}${DRY ? ' — DRY RUN' : ''}.\n`);

  let set = 0;
  let blank = 0;
  let same = 0;
  for (const r of rows) {
    const main = recipes.guessMainIngredient(r.title, r.ingredients);
    if (main === r.main_ingredient) { same++; continue; }
    if (!main) {
      // Deliberately left NULL rather than guessed: a recipe filed under a
      // random pantry item sorts somewhere absurd, which is worse than sitting
      // in the unsorted bucket where you can see it needs a hand.
      blank++;
      console.log(`  · #${r.id} ${r.title} — no confident guess, left blank`);
      continue;
    }
    if (!DRY) await pool.query(`UPDATE hh_recipes SET main_ingredient=$2 WHERE id=$1`, [r.id, main]);
    set++;
    console.log(`  ✓ #${r.id} ${r.title} → ${main}`);
  }

  console.log(`\n${set} set, ${blank} left blank, ${same} already correct.`);
  if (blank) console.log('Blanks sort last. Set one by hand by editing the recipe title, or extend HEROES and re-run with --force.');
  process.exit(0);
})().catch((e) => {
  console.error('Backfill failed:', e?.message || e);
  process.exit(1);
});
