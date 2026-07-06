#!/usr/bin/env node
// One-off migration: Supabase Auth (auth.users / auth.identities) -> our own
// `users` table (Render Postgres, same DB as everything else in lib/db.ts).
//
// WHY id is preserved exactly: ~15 other tables (subscriptions, td_user_prefs,
// customer_feedback, far_cb_custom_tickers, ...) key on a TEXT column
// (historically named clerk_user_id) that holds the Supabase auth.users UUID.
// As long as the new `users.id` equals the OLD Supabase id for every migrated
// account, every one of those tables keeps working with ZERO changes.
//
// Password hashes: Supabase/GoTrue hashes with bcrypt, so encrypted_password is
// copied AS-IS into password_hash. lib/auth/password.ts's verifyPassword()
// detects the bcrypt prefix and verifies it with bcryptjs, then transparently
// upgrades to scrypt on the user's next successful login — nobody has to reset
// their password because of this migration.
//
// Usage:
//   SUPABASE_DB_URL=postgres://postgres:<password>@db.<ref>.supabase.co:5432/postgres \
//   DATABASE_URL=<render postgres url> \
//   OWNER_USER_ID=<your supabase auth.users.id> \
//   node scripts/migrate-users-from-supabase.mjs
//
// SUPABASE_DB_URL is the direct Postgres connection string from
// Supabase project Settings -> Database -> Connection string (NOT the
// NEXT_PUBLIC_SUPABASE_URL / anon key — those can't read the `auth` schema).
//
// Idempotent: safe to re-run. Existing rows are updated, not duplicated.

import { Pool } from "pg";

const SUPABASE_DB_URL = process.env.SUPABASE_DB_URL;
const DATABASE_URL = process.env.DATABASE_URL;
const OWNER_USER_ID = (process.env.OWNER_USER_ID || "").trim();

if (!SUPABASE_DB_URL) {
  console.error("Missing SUPABASE_DB_URL (direct Postgres connection string for the Supabase project).");
  process.exit(1);
}
if (!DATABASE_URL) {
  console.error("Missing DATABASE_URL (the Render Postgres this app already uses via lib/db.ts).");
  process.exit(1);
}

const sourcePool = new Pool({ connectionString: SUPABASE_DB_URL, ssl: { rejectUnauthorized: false } });
const targetPool = new Pool({
  connectionString: DATABASE_URL,
  ssl: /localhost|127\.0\.0\.1/.test(DATABASE_URL) ? undefined : { rejectUnauthorized: false },
});

async function main() {
  console.log("Ensuring users table exists on target (safe no-op if already there)...");
  await targetPool.query(`
    CREATE TABLE IF NOT EXISTS users (
      id                TEXT PRIMARY KEY,
      email             TEXT NOT NULL UNIQUE,
      password_hash     TEXT,
      google_sub        TEXT UNIQUE,
      is_owner          BOOLEAN NOT NULL DEFAULT FALSE,
      email_verified_at TIMESTAMPTZ,
      created_at        TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
      updated_at        TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
    );
  `);

  console.log("Reading auth.users + auth.identities from Supabase...");
  const usersRes = await sourcePool.query(`
    SELECT id, email, encrypted_password, email_confirmed_at, created_at
      FROM auth.users
     ORDER BY created_at ASC
  `);
  const identitiesRes = await sourcePool.query(`
    SELECT user_id, provider, identity_data
      FROM auth.identities
     WHERE provider = 'google'
  `);
  const googleSubByUserId = new Map();
  for (const row of identitiesRes.rows) {
    const sub = row.identity_data?.sub || row.identity_data?.provider_id || null;
    if (sub) googleSubByUserId.set(row.user_id, String(sub));
  }

  console.log(`Found ${usersRes.rows.length} Supabase users (${googleSubByUserId.size} with a linked Google identity).`);

  let inserted = 0, updated = 0, skipped = 0;
  for (const u of usersRes.rows) {
    if (!u.email) { skipped++; continue; }
    const googleSub = googleSubByUserId.get(u.id) || null;
    const isOwner = OWNER_USER_ID ? u.id === OWNER_USER_ID : false;
    const emailVerifiedAt = u.email_confirmed_at || null;

    const result = await targetPool.query(
      `INSERT INTO users (id, email, password_hash, google_sub, is_owner, email_verified_at, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       ON CONFLICT (id) DO UPDATE SET
         email             = EXCLUDED.email,
         password_hash     = COALESCE(users.password_hash, EXCLUDED.password_hash),
         google_sub        = COALESCE(users.google_sub, EXCLUDED.google_sub),
         is_owner           = users.is_owner OR EXCLUDED.is_owner,
         email_verified_at = COALESCE(users.email_verified_at, EXCLUDED.email_verified_at),
         updated_at        = CURRENT_TIMESTAMP
       RETURNING (xmax = 0) AS inserted`,
      [u.id, u.email.trim().toLowerCase(), u.encrypted_password || null, googleSub, isOwner, emailVerifiedAt, u.created_at]
    );
    if (result.rows[0]?.inserted) inserted++; else updated++;
  }

  console.log(`Done. inserted=${inserted} updated=${updated} skipped(no-email)=${skipped}`);
  if (OWNER_USER_ID) {
    const ownerCheck = await targetPool.query(`SELECT id, email, is_owner FROM users WHERE id = $1`, [OWNER_USER_ID]);
    console.log("Owner row:", ownerCheck.rows[0] || "NOT FOUND — check OWNER_USER_ID");
  }
}

main()
  .catch((err) => {
    console.error("Migration failed:", err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await sourcePool.end().catch(() => {});
    await targetPool.end().catch(() => {});
  });
