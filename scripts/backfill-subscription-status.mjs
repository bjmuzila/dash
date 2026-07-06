#!/usr/bin/env node
/* One-off backfill: copies every row from Render's `subscriptions` table into
 * Supabase's `subscription_status` (see supabase/migrations/0004 + 0005).
 * The webhook only mirrors NEW events going forward — this catches everyone
 * who was already paid before that patch shipped.
 *
 * Requires DATABASE_URL (Render), NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
 * all set in the environment this runs in.
 *
 * Run on VPS:  docker exec -i dashboard-dashboard-1 node - < scripts/backfill-subscription-status.mjs
 */
import pg from "pg";
import { createClient } from "@supabase/supabase-js";

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });

const SUPABASE_URL = (process.env.NEXT_PUBLIC_SUPABASE_URL || "").trim();
const SERVICE_KEY = (process.env.SUPABASE_SERVICE_ROLE_KEY || "").trim();
if (!SUPABASE_URL || !SERVICE_KEY) {
  console.error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
  process.exit(1);
}
const admin = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });

async function main() {
  // Skip pre-migration Clerk-format ids (orphaned by design, see
  // MIGRATION-SUPABASE-AUTH.md) and rows with no status yet (checkout started,
  // subscription never completed — linkStripeCustomer creates these before the
  // webhook sets status).
  const { rows } = await pool.query(
    `SELECT clerk_user_id AS user_id, status FROM subscriptions
      WHERE clerk_user_id ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
        AND status IS NOT NULL`
  );
  console.log(`Found ${rows.length} subscription rows to mirror.`);

  let ok = 0, failed = 0;
  for (const r of rows) {
    const { error } = await admin
      .from("subscription_status")
      .upsert({ user_id: r.user_id, status: r.status, updated_at: new Date().toISOString() });
    if (error) {
      failed++;
      console.error(`  FAILED user_id=${r.user_id}: ${error.message}`);
    } else {
      ok++;
    }
  }
  console.log(`Done. ${ok} upserted, ${failed} failed.`);
  await pool.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
