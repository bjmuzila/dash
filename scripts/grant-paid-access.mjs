#!/usr/bin/env node
/* Grant COMPED paid-customer access to an email — CLI equivalent of the
 * "Comped Access" card on the owner Admin page.
 *
 * WHAT IT DOES
 *   Upserts a row in `comp_access`. That is the whole mechanism:
 *     lib/db.ts getSessionWithUser() ->
 *       is_paid = (stripe sub active/trialing) OR (live comp_access row)
 *   and middleware.ts gates every paid route on is_paid.
 *
 * WHAT IT DELIBERATELY DOES NOT DO
 *   - Does NOT touch users.is_owner. The account stays a normal customer, so
 *     every /owner/*, /social-media, /home3, /v3 route and every ownerApiGate
 *     endpoint keeps rejecting it.
 *   - Does NOT write to `subscriptions`. That table mirrors Stripe; a fake row
 *     there is indistinguishable from a real customer to everything that reads
 *     it, and the Stripe webhook would clobber it if that person ever did
 *     subscribe. (An EARLIER version of this script did exactly that — see
 *     --check below, which reports leftover fake rows so you can clear them.)
 *
 * The account does NOT need to exist yet. A comp for an email with no account
 * simply waits, and applies the moment someone signs up with that address.
 *
 * USAGE (on the VPS):
 *   docker exec -i dashboard-dashboard-1 node - name@example.com \
 *     < scripts/grant-paid-access.mjs
 *
 *   With a note and an expiry (expires at end of that day, ET):
 *     ... node - name@example.com --note "beta tester" --until 2026-12-31 < ...
 *
 *   Revoke:            ... node - name@example.com --revoke < ...
 *   List live comps:   ... node - --list                    < ...
 *   Audit old fakes:   ... node - --check                   < ...
 *
 * Takes effect within ~8s (lib/auth/session.ts validation cache TTL); a full
 * sign-out/sign-in makes it instant.
 *
 * PLAIN-SQL EQUIVALENT (psql):
 *   INSERT INTO comp_access (email, note, granted_by)
 *   VALUES ('name@example.com', 'beta tester', 'cli')
 *   ON CONFLICT (email) DO UPDATE
 *     SET revoked_at = NULL, granted_at = NOW();
 */
import pg from "pg";

const argv = process.argv.slice(2);
const flag = (name) => argv.includes(`--${name}`);
const valueOf = (name) => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 ? (argv[i + 1] ?? "") : "";
};
// Positional = anything that isn't a flag and isn't a flag's value.
const flagValueIdx = new Set();
for (const n of ["note", "until"]) {
  const i = argv.indexOf(`--${n}`);
  if (i >= 0) flagValueIdx.add(i + 1);
}
const email = (argv.find((a, i) => !a.startsWith("--") && !flagValueIdx.has(i)) || "")
  .trim()
  .toLowerCase();

const doList = flag("list");
const doCheck = flag("check");
const doRevoke = flag("revoke");

if (!process.env.DATABASE_URL) {
  console.error("Missing DATABASE_URL in the environment.");
  process.exit(1);
}
if (!email && !doList && !doCheck) {
  console.error("Usage: node grant-paid-access.mjs <email> [--note \"why\"] [--until YYYY-MM-DD] [--revoke]");
  console.error("       node grant-paid-access.mjs --list | --check");
  process.exit(1);
}

const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL.includes("localhost") ? false : { rejectUnauthorized: false },
});

async function listLive() {
  const { rows } = await pool.query(
    `SELECT ca.email, ca.note, ca.expires_at, ca.granted_at, u.id AS user_id
       FROM comp_access ca
       LEFT JOIN users u ON LOWER(u.email) = ca.email
      WHERE ca.revoked_at IS NULL
        AND (ca.expires_at IS NULL OR ca.expires_at > NOW())
      ORDER BY ca.granted_at DESC`
  );
  if (!rows.length) { console.log("No live comps."); return; }
  console.log(`${rows.length} live comp(s):`);
  for (const r of rows) {
    const until = r.expires_at ? `until ${new Date(r.expires_at).toISOString().slice(0, 10)}` : "no expiry";
    const acct = r.user_id ? "" : "  [PENDING SIGNUP]";
    console.log(`  ${r.email}  ${until}${r.note ? `  — ${r.note}` : ""}${acct}`);
  }
}

// Leftovers from the first version of this script: an 'active' subscriptions row
// with no Stripe ids is not a real customer. Report them so they can be cleared
// once the same people are on comp_access instead.
async function checkFakeSubs() {
  const { rows } = await pool.query(
    `SELECT u.email, sub.status
       FROM subscriptions sub
       JOIN users u ON u.id = sub.clerk_user_id
      WHERE sub.stripe_subscription_id IS NULL
        AND sub.status IN ('active','trialing')
      ORDER BY u.email`
  );
  if (!rows.length) { console.log("No hand-written subscriptions rows. Clean."); return; }
  console.log(`${rows.length} subscriptions row(s) with no Stripe subscription id — probably hand-granted:`);
  for (const r of rows) console.log(`  ${r.email}  (status=${r.status})`);
  console.log("\nTo move one to the comp_access mechanism and drop the fake row:");
  console.log("  node grant-paid-access.mjs <email> --note 'migrated from manual grant'");
  console.log("  psql: DELETE FROM subscriptions WHERE clerk_user_id = (SELECT id FROM users WHERE lower(email)='<email>') AND stripe_subscription_id IS NULL;");
}

async function main() {
  if (doList) { await listLive(); await pool.end(); return; }
  if (doCheck) { await checkFakeSubs(); await pool.end(); return; }

  if (doRevoke) {
    const { rowCount } = await pool.query(
      `UPDATE comp_access SET revoked_at = NOW() WHERE email = $1 AND revoked_at IS NULL`,
      [email]
    );
    console.log(rowCount ? `Revoked comped access for ${email}.` : `No live comp for ${email} — nothing to revoke.`);
    await pool.end();
    return;
  }

  const note = valueOf("note").trim() || null;
  const until = valueOf("until").trim();
  let expiresAt = null;
  if (until) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(until)) {
      console.error("--until must be YYYY-MM-DD");
      process.exit(1);
    }
    // End of that day, EST-anchored — same rule as the API route. Deliberately
    // an hour generous in summer rather than an hour short.
    expiresAt = new Date(`${until}T23:59:59-05:00`).toISOString();
  }

  await pool.query(
    `INSERT INTO comp_access (email, note, expires_at, granted_by, granted_at, revoked_at)
     VALUES ($1, $2, $3, 'cli', NOW(), NULL)
     ON CONFLICT (email) DO UPDATE
       SET note = EXCLUDED.note, expires_at = EXCLUDED.expires_at,
           granted_by = EXCLUDED.granted_by, granted_at = NOW(), revoked_at = NULL`,
    [email, note, expiresAt]
  );

  // Read back through the SAME expression the paywall evaluates, so the output
  // is proof of the gate state rather than proof of the write.
  const { rows } = await pool.query(
    `SELECT u.id, u.is_owner,
            (COALESCE(sub.status IN ('active','trialing'), FALSE) OR ca.email IS NOT NULL) AS is_paid,
            (ca.email IS NOT NULL) AS is_comped
       FROM users u
       LEFT JOIN subscriptions sub ON sub.clerk_user_id = u.id
       LEFT JOIN comp_access ca
              ON ca.email = LOWER(u.email)
             AND ca.revoked_at IS NULL
             AND (ca.expires_at IS NULL OR ca.expires_at > NOW())
      WHERE LOWER(u.email) = $1`,
    [email]
  );

  console.log(`Granted comped access to ${email}${expiresAt ? ` (until ${until})` : ""}.`);
  if (!rows.length) {
    console.log("  No account with this email YET — the comp applies automatically");
    console.log("  as soon as they sign up at https://cbedge.net/sign-up.");
  } else {
    const c = rows[0];
    console.log(`  is_paid   = ${c.is_paid}  (comped=${c.is_comped})`);
    console.log(`  is_owner  = ${c.is_owner}  <- must stay false`);
    if (c.is_owner) {
      console.warn("  WARNING: this account has the owner flag set. Clear it with:");
      console.warn(`    UPDATE users SET is_owner = FALSE WHERE id = '${c.id}';`);
    }
    console.log("  Takes effect within ~8s (session cache TTL), or instantly after a re-login.");
  }

  await pool.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
