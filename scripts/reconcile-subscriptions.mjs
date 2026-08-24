#!/usr/bin/env node
/**
 * reconcile-subscriptions.mjs — make the local `subscriptions` table match Stripe.
 *
 * WHY THIS EXISTS
 * ---------------
 * Access is gated on our OWN copy of the subscription status, not on Stripe:
 * getSessionWithUser() in lib/db.ts resolves is_paid from
 * `sub.status IN ('active','trialing')`. That copy is written in exactly one
 * place — the Stripe webhook (app/api/stripe/webhook/route.ts). So the gate is
 * only ever as correct as the last webhook that landed.
 *
 * On 2026-08-24 the endpoint turned out to be subscribed to only three event
 * types (checkout.session.completed, customer.subscription.created,
 * customer.subscription.deleted). `customer.subscription.updated` was NOT among
 * them, so no past_due transition had EVER reached the database — two customers
 * whose cards were declined kept full access for a month while Stripe retried.
 *
 * Fixing the event list stops that specific hole. This script is the safety net
 * underneath it: any future missed delivery — a bad deploy, an endpoint 500, a
 * Stripe outage, another event type nobody remembered to enable — costs one
 * night instead of one month. Stripe is the source of truth; this makes our
 * mirror agree with it.
 *
 * USAGE
 *   node scripts/reconcile-subscriptions.mjs            # dry run — prints drift, writes nothing
 *   node scripts/reconcile-subscriptions.mjs --apply    # writes the corrections
 *   node scripts/reconcile-subscriptions.mjs --apply --quiet   # only prints if drift was found
 *
 * Run it inside the app container so DATABASE_URL and STRIPE_SECRET_KEY are set:
 *   docker compose exec -T dashboard node scripts/reconcile-subscriptions.mjs
 *
 * SAFE TO RUN ANY TIME. Dry run by default. The write is the same idempotent
 * upsert the webhook uses, keyed on clerk_user_id, so running it twice is a
 * no-op and running it concurrently with a live webhook cannot corrupt a row.
 */

import pg from "pg";
import Stripe from "stripe";

const APPLY = process.argv.includes("--apply");
const QUIET = process.argv.includes("--quiet");

const { DATABASE_URL, STRIPE_SECRET_KEY } = process.env;
if (!DATABASE_URL) fail("DATABASE_URL not set");
if (!STRIPE_SECRET_KEY) fail("STRIPE_SECRET_KEY not set");

function fail(msg) {
  console.error(`[reconcile] ${msg}`);
  process.exit(1);
}

const stripe = new Stripe(STRIPE_SECRET_KEY);
const pool = new pg.Pool({
  connectionString: DATABASE_URL,
  // Mirrors lib/db.ts: local Postgres speaks plaintext, anything else is remote
  // and presents a cert we don't pin.
  ssl: /localhost|127\.0\.0\.1/.test(DATABASE_URL) ? undefined : { rejectUnauthorized: false },
  max: 3,
});

/** Stripe moved current_period_end onto the subscription ITEM. Prefer the item,
 *  fall back to the subscription for older API versions. */
function periodEnd(sub) {
  const item = sub.items?.data?.[0];
  return item?.current_period_end ?? sub.current_period_end ?? null;
}

function priceId(sub) {
  return sub.items?.data?.[0]?.price?.id ?? null;
}

function customerIdOf(v) {
  if (!v) return null;
  return typeof v === "string" ? v : v.id;
}

/**
 * Resolve our user id for a Stripe subscription — same two-step the webhook
 * uses: the metadata we stamped at checkout, then the customer→user mapping we
 * already hold. A subscription we cannot attribute is REPORTED, never guessed
 * at: writing a status onto the wrong user would hand someone else's access
 * away, which is far worse than a stale row.
 */
async function resolveUserId(sub, customerId) {
  const fromMeta = sub.metadata?.clerk_user_id;
  if (fromMeta) return fromMeta;
  const { rows } = await pool.query(
    "SELECT clerk_user_id FROM subscriptions WHERE stripe_customer_id = $1 LIMIT 1",
    [customerId]
  );
  return rows[0]?.clerk_user_id ?? null;
}

/** Every subscription in the account, all statuses, auto-paginated. */
async function fetchAllStripeSubs() {
  const out = [];
  for await (const sub of stripe.subscriptions.list({ status: "all", limit: 100 })) {
    out.push(sub);
  }
  return out;
}

// The upsert is a byte-for-byte copy of upsertSubscription() in lib/db.ts.
// Deliberate duplication: this script is a plain .mjs run by node inside the
// container and cannot import the TypeScript module. If that function's SQL
// changes, change it here too.
const UPSERT_SQL = `
  INSERT INTO subscriptions
    (clerk_user_id, stripe_customer_id, stripe_subscription_id, status,
     price_id, current_period_end, cancel_at_period_end)
  VALUES ($1,$2,$3,$4,$5,$6,$7)
  ON CONFLICT (clerk_user_id) DO UPDATE SET
    stripe_customer_id     = COALESCE(EXCLUDED.stripe_customer_id,     subscriptions.stripe_customer_id),
    stripe_subscription_id = COALESCE(EXCLUDED.stripe_subscription_id, subscriptions.stripe_subscription_id),
    status                 = COALESCE(EXCLUDED.status,                 subscriptions.status),
    price_id               = COALESCE(EXCLUDED.price_id,               subscriptions.price_id),
    current_period_end     = COALESCE(EXCLUDED.current_period_end,     subscriptions.current_period_end),
    cancel_at_period_end   = EXCLUDED.cancel_at_period_end,
    updated_at             = CURRENT_TIMESTAMP`;

const PAID = new Set(["active", "trialing"]);

async function main() {
  const subs = await fetchAllStripeSubs();

  const { rows: localRows } = await pool.query(
    `SELECT s.clerk_user_id, s.stripe_subscription_id, s.status,
            s.current_period_end, s.cancel_at_period_end, u.email
       FROM subscriptions s LEFT JOIN users u ON u.id = s.clerk_user_id`
  );
  const byUser = new Map(localRows.map(r => [r.clerk_user_id, r]));

  const drift = [];
  const orphans = [];

  for (const sub of subs) {
    const customerId = customerIdOf(sub.customer);
    if (!customerId) continue;

    const userId = await resolveUserId(sub, customerId);
    if (!userId) {
      orphans.push({ sub: sub.id, customer: customerId, status: sub.status });
      continue;
    }

    const local = byUser.get(userId);
    const want = {
      status: sub.status,
      period_end: periodEnd(sub),
      cancel_at_period_end: sub.cancel_at_period_end ? 1 : 0,
    };
    const have = {
      status: local?.status ?? null,
      period_end: local?.current_period_end ?? null,
      cancel_at_period_end: Number(local?.cancel_at_period_end ?? 0),
    };

    const changed =
      have.status !== want.status ||
      have.period_end !== want.period_end ||
      have.cancel_at_period_end !== want.cancel_at_period_end;
    if (!changed) continue;

    // The line that actually matters: did this drift hand out access, or take
    // it away? A local 'active' against a Stripe 'past_due' is unpaid service.
    const accessNow = PAID.has(have.status);
    const accessAfter = PAID.has(want.status);

    drift.push({
      email: local?.email ?? "(no user row)",
      user_id: userId,
      subscription: sub.id,
      local_status: have.status,
      stripe_status: want.status,
      access: accessNow === accessAfter ? "unchanged" : accessNow ? "REVOKES" : "GRANTS",
    });

    if (APPLY) {
      await pool.query(UPSERT_SQL, [
        userId,
        customerId,
        sub.id,
        sub.status,
        priceId(sub),
        want.period_end,
        want.cancel_at_period_end,
      ]);
    }
  }

  if (QUIET && !drift.length && !orphans.length) return;

  console.log(
    `[reconcile] ${subs.length} Stripe subscriptions checked — ` +
    `${drift.length} drifted${APPLY ? " (written)" : " (dry run, nothing written)"}`
  );

  if (drift.length) {
    console.table(drift);
    const revokes = drift.filter(d => d.access === "REVOKES").length;
    const grants = drift.filter(d => d.access === "GRANTS").length;
    if (revokes) console.log(`[reconcile] ${revokes} account(s) were being served WITHOUT a paying subscription.`);
    if (grants) console.log(`[reconcile] ${grants} paying account(s) were being denied access.`);
  }

  // A subscription we cannot map to a user is not a drift we can fix — it needs
  // a human to look at it, so it is listed rather than silently dropped.
  if (orphans.length) {
    console.log(`[reconcile] ${orphans.length} subscription(s) could not be matched to a user:`);
    console.table(orphans);
  }

  if (!APPLY && drift.length) {
    console.log("[reconcile] re-run with --apply to write these corrections.");
  }
}

main()
  .then(() => pool.end())
  .catch(async (err) => {
    console.error("[reconcile] failed:", err.message);
    await pool.end().catch(() => {});
    process.exit(1);
  });
