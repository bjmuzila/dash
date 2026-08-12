#!/usr/bin/env node
'use strict';
/**
 * server-v2/scripts/backfill-recipe-images.js
 *
 *   docker compose exec -T dashboard node server-v2/scripts/backfill-recipe-images.js
 *   ... --force     re-copy even recipes that already have a stored photo
 *
 * Copies the photo for every recipe that has an image_url but no stored bytes.
 *
 * Run it once after deploying the photo feature: recipes imported before it
 * only ever kept the remote URL, and for anything from TikTok or Instagram that
 * URL is signed and short-lived. Run it soon — a link that expired last week
 * cannot be recovered from here, only by re-importing.
 *
 * Sequential on purpose. This is a household cookbook of tens of rows against
 * other people's CDNs; twenty parallel fetches would save four seconds and look
 * like scraping.
 */

const recipes = require('../_lib-household-recipes.cjs');
const libDb = require('../_lib-db.cjs');

const FORCE = process.argv.includes('--force');

(async () => {
  if (!recipes.available()) {
    console.error('No database layer — is DATABASE_URL set?');
    process.exit(1);
  }

  const pool = libDb.getPool();
  const { rows } = await pool.query(`
    SELECT r.id, r.title, r.image_url
      FROM hh_recipes r
      LEFT JOIN hh_recipe_images i ON i.recipe_id = r.id
     WHERE r.image_url IS NOT NULL AND r.image_url <> ''
       ${FORCE ? '' : 'AND i.recipe_id IS NULL'}
     ORDER BY r.id`);

  if (!rows.length) {
    console.log('Nothing to do — every recipe with a photo URL already has its bytes.');
    process.exit(0);
  }

  console.log(`${rows.length} recipe(s) to copy${FORCE ? ' (forced)' : ''}.\n`);

  let ok = 0;
  const failed = [];
  for (const r of rows) {
    const res = await recipes.captureImage(r.id, r.image_url);
    if (res) {
      ok++;
      console.log(`  ✓ #${r.id} ${r.title} — ${Math.round(res.bytes / 1024)}KB ${res.mime}`);
    } else {
      failed.push(r);
      // Almost always an expired signed CDN URL. Naming the recipe matters:
      // re-importing it is the only fix, and you need to know which one.
      console.log(`  ✗ #${r.id} ${r.title} — could not fetch (link likely expired)`);
    }
  }

  console.log(`\n${ok} copied, ${failed.length} failed.`);
  if (failed.length) {
    console.log('Failed ones keep their remote URL and will show the letter tile once it dies.');
    console.log('Re-import them, or set a photo by hand from the recipe screen.');
  }
  process.exit(0);
})().catch((e) => {
  console.error('Backfill failed:', e?.message || e);
  process.exit(1);
});
