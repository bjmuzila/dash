#!/usr/bin/env node
'use strict';
/**
 * server-v2/scripts/backfill-recipe-photos.js
 *
 *   docker compose exec -T household node server-v2/scripts/backfill-recipe-photos.js
 *   ... --dry        list what it would do, change nothing, spend nothing
 *   ... --force      re-do recipes that already have a candidate list
 *   ... --limit=20   stop after N recipes (a cheap way to sanity-check the bill)
 *   ... --id=41,52   just these
 *
 * Re-picks the photo for recipes imported before the importer could see.
 *
 * Those rows kept exactly one image URL — whatever the page's og:image was —
 * and on TikTok that is a frame of the VIDEO, chosen by the creator as their
 * hook shot. Which is why a cookbook of eighty-five ends up with a wall of
 * faces, hands and fridge doors instead of food.
 *
 * For each recipe it re-fetches the SOURCE PAGE, rebuilds the candidate list,
 * stores it, and lets captureImage look at the frames and keep the food one.
 * Storing the list matters as much as the pick: it is what puts the "other
 * frames" strip on the recipe page, so a bad automatic choice is one tap to fix
 * rather than a re-run of this script.
 *
 * COSTS MONEY — one vision call per recipe (skipped when a page yields fewer
 * than two usable frames). Roughly a third of a cent each on Haiku, a penny on
 * Sonnet. Set RECIPE_VISION_MODEL to choose; RECIPE_VISION=off disables the
 * looking entirely and falls back to first-that-downloads.
 *
 * Sequential and paced, on purpose. This is a household cookbook against other
 * people's CDNs; twenty parallel page fetches would save a minute and look
 * exactly like scraping.
 */

const recipes = require('../_lib-household-recipes.cjs');
const libDb = require('../_lib-db.cjs');

const arg = (name) => {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : null;
};
const DRY = process.argv.includes('--dry');
const FORCE = process.argv.includes('--force');
const LIMIT = Number(arg('limit')) || 0;
const IDS = (arg('id') || '').split(',').map((n) => Number(n.trim())).filter(Boolean);
const PAUSE_MS = Number(process.env.BACKFILL_PAUSE_MS || 1200);

(async () => {
  if (!recipes.available()) {
    console.error('No database layer — is DATABASE_URL set?');
    process.exit(1);
  }
  if (!recipes.aiConfigured()) {
    console.warn('! ANTHROPIC_API_KEY is not set — frames will not be looked at,');
    console.warn('  so this will only rebuild the candidate lists. That still gives');
    console.warn('  you the "other frames" strip to pick from by hand.');
  }

  const pool = libDb.getPool();
  const where = ["r.source_url IS NOT NULL", "r.source_url <> ''"];
  const vals = [];
  if (IDS.length) { vals.push(IDS); where.push(`r.id = ANY($${vals.length}::int[])`); }
  // Without --force, skip anything already carrying a candidate list: those
  // were imported by the version that looks, and re-running would pay for the
  // same answer.
  else if (!FORCE) where.push('r.image_candidates IS NULL');

  const { rows } = await pool.query(
    `SELECT r.id, r.title, r.source_url
       FROM hh_recipes r
      WHERE ${where.join(' AND ')}
      ORDER BY r.id
      ${LIMIT ? `LIMIT ${LIMIT}` : ''}`, vals);

  if (!rows.length) {
    console.log('Nothing to do.');
    process.exit(0);
  }
  console.log(`${rows.length} recipe${rows.length === 1 ? '' : 's'}${DRY ? ' (dry run)' : ''}\n`);

  let done = 0, skipped = 0, failed = 0;

  for (const r of rows) {
    const tag = `#${r.id} ${String(r.title).slice(0, 48)}`;
    try {
      const cands = await recipes.candidatesForUrl(r.source_url);
      if (!cands.length) {
        console.log(`  –  ${tag} — the page offered no photo`);
        skipped++;
        continue;
      }
      if (DRY) {
        console.log(`  ?  ${tag} — ${cands.length} candidate${cands.length === 1 ? '' : 's'}`);
        done++;
        continue;
      }

      await pool.query(
        `UPDATE hh_recipes SET image_candidates = $2::jsonb WHERE id = $1`,
        [r.id, JSON.stringify(cands)]);

      const out = await recipes.captureImage(r.id, cands);
      if (out) {
        console.log(`  ✓  ${tag} — ${cands.length} frames, kept ${Math.round(out.bytes / 1024)}KB ${out.mime}`);
        done++;
      } else {
        // The list is still stored, so the strip works and you can pick by hand.
        console.log(`  !  ${tag} — every frame failed to download (expired links)`);
        failed++;
      }
    } catch (e) {
      console.log(`  ✗  ${tag} — ${String(e?.message || e).slice(0, 120)}`);
      failed++;
    }
    if (PAUSE_MS) await new Promise((res) => setTimeout(res, PAUSE_MS));
  }

  console.log(`\n${done} done · ${skipped} no photo on the page · ${failed} failed`);
  process.exit(0);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
