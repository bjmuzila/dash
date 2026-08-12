#!/usr/bin/env node
'use strict';
/**
 * server-v2/scripts/backfill-recipe-derived.js
 *
 *   docker compose exec -T household node server-v2/scripts/backfill-recipe-derived.js
 *   ... --force    recompute every recipe, not just the ones with no value
 *   ... --dry      print what it would set and change nothing
 *
 * Fills in the two DERIVED columns for recipes that predate them:
 *
 *   main_ingredient  — without it, "sort by main ingredient" puts your whole
 *                      existing cookbook in the NULLS LAST bucket and the
 *                      feature looks broken on the one screen you'd check.
 *   source_key       — without it, bulk import cannot tell that a link you are
 *                      about to paste is a recipe you already have, and a
 *                      hundred-link batch re-imports everything.
 *
 * Both are derived from data already on the row, so re-running is always safe
 * and never overwrites anything a human typed. --force is for after you have
 * edited the HEROES list.
 *
 * (Was backfill-recipe-mains.js until source_key joined it — same job, and one
 * command to run after a deploy beats two.)
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
    SELECT id, title, ingredients, main_ingredient, source_url, source_key
      FROM hh_recipes
     ${FORCE ? '' : 'WHERE main_ingredient IS NULL OR (source_key IS NULL AND source_url IS NOT NULL)'}
     ORDER BY id`);

  if (!rows.length) {
    console.log('Nothing to do — every recipe already has a main ingredient.');
    process.exit(0);
  }
  console.log(`${rows.length} recipe(s)${FORCE ? ' (forced)' : ''}${DRY ? ' — DRY RUN' : ''}.\n`);

  let set = 0;
  let blank = 0;
  let same = 0;
  let keys = 0;

  for (const r of rows) {
    // source_key first — it is cheap, never ambiguous, and the thing bulk
    // import needs before you paste a long list.
    const key = recipes.sourceKey(r.source_url);
    if (key && key !== r.source_key) {
      if (!DRY) await pool.query(`UPDATE hh_recipes SET source_key=$2 WHERE id=$1`, [r.id, key]);
      keys++;
    }

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

  console.log(`\n${set} main ingredient(s) set, ${blank} left blank, ${same} already correct.`);
  console.log(`${keys} source key(s) written — that is what stops bulk import re-adding links you already have.`);
  if (blank) console.log('Blanks sort last. Set one by hand by editing the recipe title, or extend HEROES and re-run with --force.');
  process.exit(0);
})().catch((e) => {
  console.error('Backfill failed:', e?.message || e);
  process.exit(1);
});
