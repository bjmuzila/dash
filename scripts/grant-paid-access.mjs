#!/usr/bin/env node
/* Grant COMPED paid-customer access to an existing account, by email.
 *
 * WHAT IT DOES
 *   Upserts a row in `subscriptions` with status='active' for the user's id.
 *   That is exactly what the paywall reads:
 *     lib/db.ts getSessionWithUser() ->
 *       COALESCE(sub.status IN ('active','trialing'), FALSE) AS is_paid
 *   which feeds middleware.ts's PAID gate. Nothing else changes.
 *
 * WHAT IT DELIBERATELY DOES NOT DO
 *   - Does NOT touch users.is_owner. The account stays a normal customer, so
 *     every /owner/*, /social-media, /home3, /v3 route and every ownerApiGate
 *     endpoint keeps rejecting it.
 *   - Writes no stripe_customer_id / stripe_subscription_id / price_id, so the
 *     comp never looks like real revenue and the Stripe webhook has nothing to
 *     collide with.
 *   - Stamps welcome_email_sent_at so the founder auto-welcome email does not
 *     fire at a comped account.
 *
 * The account must already exist (have them sign up at /sign-up first).
 *
 * USAGE (on the VPS):
 *   docker exec -i dashboard-dashboard-1 node - bzilatrades@gmail.com \
 *     < scripts/grant-paid-access.mjs
 *
 *   Revoke later:
 *   docker exec -i dashboard-dashboard-1 node - bzilatrades@gmail.com --revoke \
 *     < scripts/grant-paid-access.mjs
 *
 * Takes effect within ~8s (lib/auth/session.ts validation cache TTL); a full
 * sign-out/sign-in makes it instant.
 *
 * PLAIN-SQL EQUIVALENT (psql), if you'd rather not run node:
 *   INSERT INTO subscriptions (clerk_user_id, status, cancel_at_period_end,
 *                              current_period_end, welcome_email_sent_at, updated_at)
 *   SELECT id, 'active', 0, 4102444800, NOW(), NOW()
 *     FROM users WHERE lower(email) = 'bzilatrades@gmail.com'
 *   ON CONFLICT (clerk_user_id) DO UPDATE
 *     SET status = 'active', cancel_at_period_end = 0,
 *         current_period_end = 4102444800, updated_at = NOW();
 */
import pg from "pg";

const args = process.argv.slice(2);
const revoke = args.includes("--revoke");
const email = (args.find((a) => !a.startsWith("--")) || "").trim().toLowerCase();

if (!email) {
  console.error("Usage: node grant-paid-access.mjs <email> [--revoke]");
  process.exit(1);
}
if (!process.env.DATABASE_URL) {
  console.error("Missing DATABASE_URL in the environment.");
  process.exit(1);
}

// Far-future period end (2100-01-01) so anything that displays a renewal date
// or does grace-window math treats the comp as current.
const FAR_FUTURE = 4102444800;

const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL.includes("localhost") ? false : { rejectUnauthorized: false },
});

async function main() {
  const { rows: users } = await pool.query(
    `SELECT id, email, is_owner FROM users WHERE lower(email) = $1`,
    [email]
  );
  if (!users.length) {
    console.error(
      `No account found for ${email}.\n` +
        `Have them sign up at https://cbedge.net/sign-up first, then re-run this.`
    );
    process.exit(2);
  }
  const user = users[0];

  if (revoke) {
    const { rowCount } = await pool.query(
      `UPDATE subscriptions
          SET status = 'canceled', updated_at = NOW()
        WHERE clerk_user_id = $1`,
      [user.id]
    );
    console.log(
      rowCount
        ? `Revoked paid access for ${user.email} (${user.id}).`
        : `No subscription row for ${user.email} — nothing to revoke.`
    );
  } else {
    await pool.query(
      `INSERT INTO subscriptions
         (clerk_user_id, status, cancel_at_period_end, current_period_end,
          welcome_email_sent_at, created_at, updated_at)
       VALUES ($1, 'active', 0, $2, NOW(), NOW(), NOW())
       ON CONFLICT (clerk_user_id) DO UPDATE
         SET status               = 'active',
             cancel_at_period_end = 0,
             current_period_end   = EXCLUDED.current_period_end,
             welcome_email_sent_at = COALESCE(subscriptions.welcome_email_sent_at, NOW()),
             updated_at           = NOW()`,
      [user.id, FAR_FUTURE]
    );
    console.log(`Granted comped paid access to ${user.email} (${user.id}).`);
  }

  // Read back the exact expression the paywall evaluates, so the output is
  // proof of the gate state rather than proof of the write.
  const { rows: check } = await pool.query(
    `SELECT u.is_owner,
            COALESCE(sub.status IN ('active','trialing'), FALSE) AS is_paid,
            sub.status
       FROM users u
       LEFT JOIN subscriptions sub ON sub.clerk_user_id = u.id
      WHERE u.id = $1`,
    [user.id]
  );
  const c = check[0] || {};
  console.log(`  is_paid  = ${c.is_paid}   (status=${c.status ?? "none"})`);
  console.log(`  is_owner = ${c.is_owner}  <- must stay false`);
  if (c.is_owner) {
    console.warn("  WARNING: this account has the owner flag set. Clear it with:");
    console.warn(`    UPDATE users SET is_owner = FALSE WHERE id = '${user.id}';`);
  }
  console.log("Takes effect within ~8s (session cache TTL), or instantly after a re-login.");

  await pool.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
