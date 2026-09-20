#!/usr/bin/env node
/**
 * stripe-stop-renewals.mjs — switch off renewal on every live CB Edge subscription.
 *
 * WHY THIS EXISTS
 * ---------------
 * CB Edge is joining Voltick and sales are closed (lib/salesClosed.ts). The
 * merger notice, the pricing page, the sign-up page and the announcement email
 * all promise the same two things:
 *
 *   1. every current member keeps full access to the LAST DAY of the term they
 *      already paid for — a yearly member keeps all twelve months;
 *   2. nobody is billed again.
 *
 * The site keeps half of that on its own: checkout refuses, sign-up refuses.
 * The other half lives in Stripe. A subscription left alone RENEWS — Stripe will
 * charge the card on the period-end date whatever the site says — so without
 * this, promise (2) is broken on the first renewal date after the announcement.
 *
 * Stripe's dashboard has no bulk "cancel at period end". It is one subscription
 * at a time, three clicks each, and the one that gets missed is the one that
 * charges somebody. This does all of them from one list, and reports every
 * subscription it did NOT touch and why.
 *
 * THIS STRIPE ACCOUNT IS SHARED — SCOPE BEFORE ANYTHING ELSE
 * ---------------------------------------------------------
 * The same Stripe account also bills Brandon's separate, personal Discord
 * membership, which is NOT part of the merger and must keep renewing. So "every
 * live subscription in the account" is the wrong set, and the first version of
 * this script (2026-09-20, never run) used exactly that set.
 *
 * A subscription is touched ONLY if it passes BOTH tests:
 *
 *   1. IT IS CB EDGE, proven by one of:
 *        · its price belongs to a CB Edge PRODUCT — resolved at start-up from
 *          the prices checkout actually sells (STRIPE_PRICE_ID_MONTHLY,
 *          STRIPE_PRICE_ID_YEARLY, STRIPE_PRICE_ID; see lib/stripe.ts), plus
 *          any --product you pass; or
 *        · `metadata.clerk_user_id` is set — app/api/stripe/checkout stamps it
 *          onto every subscription it creates, and nothing else does.
 *   2. IT STARTED ON OR AFTER THE CUTOFF — 2026-06-01 00:00 America/New_York by
 *      default (Brandon: "anyone who joined after 6/1/2026"), `--since` to move
 *      it. Measured on `start_date`, the date the membership began, not
 *      `created`, which can differ on a migrated or re-created subscription.
 *
 * Two independent tests on purpose. Either one alone has a way to be wrong —
 * a Discord member who joined in July passes the date; a CB Edge price that was
 * retired before the env vars were last set fails the product check — and the
 * cost of a false positive here is charging nobody for something they are
 * still paying for. When the two DISAGREE the subscription is not guessed at:
 * it is listed under NEEDS YOU with the reason.
 *
 * Everything live that fails test 1 is listed under NOT CB EDGE with its
 * product name, so the dry run shows you, by name, every Discord subscription
 * being left alone. Read that list before --apply.
 *
 * WHAT IT DOES — AND THE ONE THING IT MUST NOT DO
 * ------------------------------------------------
 * Sets `cancel_at_period_end: true`. That is "don't renew", NOT "cancel":
 *
 *   · status stays `active` (or `trialing`) until the period ends, and access is
 *     gated on status IN ('active','trialing') — getSessionWithUser() in
 *     lib/db.ts, isPaid() in lib/subscription.ts. So access is untouched, to the
 *     day, which is promise (1).
 *   · at period end Stripe ends the subscription with no invoice, fires
 *     customer.subscription.deleted, the webhook writes `canceled`, and the paid
 *     gate in middleware.ts moves them to /home. No code change is needed for
 *     that — it is the path every voluntary cancellation already takes.
 *
 * It NEVER calls subscriptions.cancel(). That ends access NOW — the exact
 * opposite of promise (1) — and depending on account settings can issue
 * prorations. There is deliberately no flag in this file that does it.
 *
 * WHAT THE WEBHOOK DOES WITH EACH UPDATE (read before --apply)
 * -------------------------------------------------------------
 * Each update fires customer.subscription.updated. Walking syncSubscription()
 * in app/api/stripe/webhook/route.ts:
 *
 *   · upsertSubscription — writes cancel_at_period_end=true, status unchanged.
 *     Access unchanged.                                                     ✓
 *   · maybeSendWelcome   — already claimed for anyone who has been paid.
 *     No email.                                                             ✓
 *   · Discord role       — synced to status, which is still paid. Kept.     ✓
 *   · maybeSendWinback   — shouldOfferWinback() refuses anything still live
 *     and anyone who has ever paid. No email.                               ✓
 *   · recordChurn        — `leaving` is true, so it WRITES A CHURN ROW for
 *     every subscription this touches. Stripe will stamp reason
 *     'cancellation_requested'. That is why every update below carries
 *     cancellation_details.comment = 'voltick-merger': filter on it, or the
 *     owner Sales page will show the whole book as having quit on one day.
 *     `feedback` is deliberately left alone — that field is the customer's own
 *     survey answer, and a value we invented would be a lie in their name.
 *
 * USAGE
 *   Run inside the app container, where STRIPE_SECRET_KEY is already set:
 *
 *   docker compose exec -T dashboard node scripts/stripe-stop-renewals.mjs
 *       dry run — lists every subscription and what would happen. Writes nothing.
 *
 *   docker compose exec -T dashboard node scripts/stripe-stop-renewals.mjs --only sub_123
 *       dry run for ONE subscription.
 *
 *   docker compose exec -T dashboard node scripts/stripe-stop-renewals.mjs --only sub_123 --apply
 *       do ONE for real. Do this on a subscription you can check first.
 *
 *   docker compose exec -T dashboard node scripts/stripe-stop-renewals.mjs --apply
 *       do all of them.
 *
 *   Options: --since YYYY-MM-DD   move the join cutoff (default 2026-06-01)
 *            --product prod_...   treat another product as CB Edge (repeatable)
 *
 * SAFE TO RE-RUN. A subscription that is already set to end is reported and
 * skipped before any API call, so a second --apply is a list of "already off"
 * and nothing else. Worth re-running before any renewal date as a backstop: if
 * a member re-enables renewal from the Stripe billing portal, this catches it.
 */

import Stripe from "stripe";

const argv = process.argv.slice(2);
const APPLY = argv.includes("--apply");
const onlyIdx = argv.indexOf("--only");
const ONLY = onlyIdx >= 0 ? argv[onlyIdx + 1] : null;

const TAG = "voltick-merger";

function argAll(flag) {
  const out = [];
  argv.forEach((a, i) => { if (a === flag && argv[i + 1]) out.push(argv[i + 1]); });
  return out;
}

// Join cutoff, as midnight in New York. Built from the wall-clock date so the
// ET offset (EDT -4 in June) is computed, not hard-coded.
const SINCE = (argAll("--since")[0] ?? "2026-06-01").trim();
if (!/^\d{4}-\d{2}-\d{2}$/.test(SINCE)) {
  console.error("[stop-renewals] --since must be YYYY-MM-DD");
  process.exit(1);
}
function nyMidnight(ymd) {
  // Find the UTC instant whose New York wall-clock reads `ymd 00:00`.
  const guess = Date.parse(`${ymd}T00:00:00Z`);
  const ny = new Date(new Date(guess).toLocaleString("en-US", { timeZone: "America/New_York" }));
  const utc = new Date(new Date(guess).toLocaleString("en-US", { timeZone: "UTC" }));
  return Math.floor((guess + (utc - ny)) / 1000);
}
const CUTOFF = nyMidnight(SINCE);

const EXTRA_PRODUCTS = argAll("--product");

// Anything that can still produce a charge. past_due is here on purpose: Stripe
// is still retrying that card, and a retry that succeeds renews the term.
const LIVE = new Set(["active", "trialing", "past_due"]);

const { STRIPE_SECRET_KEY } = process.env;
if (!STRIPE_SECRET_KEY) fail("STRIPE_SECRET_KEY not set — run this inside the dashboard container.");
if (onlyIdx >= 0 && !(ONLY && ONLY.startsWith("sub_"))) fail("--only needs a subscription id, e.g. --only sub_1Abc...");

function fail(msg) {
  console.error(`[stop-renewals] ${msg}`);
  process.exit(1);
}

// sk_ = secret, rk_ = restricted. Printed first, in capitals, so a dry run
// against the test account can never be mistaken for the real one.
const MODE = /^(sk|rk)_live_/.test(STRIPE_SECRET_KEY)
  ? "LIVE"
  : /^(sk|rk)_test_/.test(STRIPE_SECRET_KEY)
    ? "TEST"
    : "UNKNOWN";

// The SDK sends its own idempotency key on POST retries, so a network blip
// mid-update cannot double-apply. The skip-if-already-set check below is what
// makes a whole second RUN safe.
const stripe = new Stripe(STRIPE_SECRET_KEY, { maxNetworkRetries: 2 });

/**
 * The CB Edge product ids, from the prices checkout sells. Resolved from Stripe
 * rather than trusting a product id typed into env, so a price that was moved
 * to another product is followed, not missed. If NOT ONE resolves the script
 * refuses to run: with no product to match, test 1 would rest on metadata alone,
 * and that is not the evidence this account needs.
 */
async function resolveCbProducts() {
  const priceIds = [
    process.env.STRIPE_PRICE_ID_MONTHLY,
    process.env.STRIPE_PRICE_ID_YEARLY,
    process.env.STRIPE_PRICE_ID,
  ].filter(Boolean);
  const products = new Set(EXTRA_PRODUCTS);
  for (const id of new Set(priceIds)) {
    try {
      const price = await stripe.prices.retrieve(id);
      const prod = typeof price.product === "string" ? price.product : price.product?.id;
      if (prod) products.add(prod);
    } catch (err) {
      console.log(`  ! could not read CB Edge price ${id}: ${err?.message ?? err}`);
    }
  }
  if (!products.size) {
    fail("no CB Edge product could be resolved (STRIPE_PRICE_ID_MONTHLY / _YEARLY / STRIPE_PRICE_ID, or --product). Refusing to run — this Stripe account is shared.");
  }
  return products;
}

const productNames = new Map();
async function productName(id) {
  if (!id) return "—";
  if (productNames.has(id)) return productNames.get(id);
  let name = id;
  try { name = (await stripe.products.retrieve(id)).name || id; } catch { /* keep the id */ }
  productNames.set(id, name);
  return name;
}

function productOf(sub) {
  const p = sub.items?.data?.[0]?.price?.product;
  return typeof p === "string" ? p : p?.id ?? null;
}

/** Stripe moved current_period_end onto the ITEM. Same helper as reconcile. */
function periodEnd(sub) {
  const item = sub.items?.data?.[0];
  return item?.current_period_end ?? sub.current_period_end ?? null;
}

// Dates print in New York, the same clock the cutoff is measured on. In UTC a
// membership that began at 11pm ET on May 31 printed as "joined 2026-06-01,
// BEFORE 2026-06-01" — true to the second and unreadable.
const NY_DAY = new Intl.DateTimeFormat("en-CA", {
  timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit",
});
function day(ts) {
  return ts ? NY_DAY.format(new Date(ts * 1000)) : "—";
}

function emailOf(sub) {
  const c = sub.customer;
  return (c && typeof c !== "string" && c.email) || (typeof c === "string" ? c : "—");
}

function planOf(sub) {
  const price = sub.items?.data?.[0]?.price;
  if (!price) return "—";
  const amt = price.unit_amount != null ? `$${(price.unit_amount / 100).toFixed(2)}` : "?";
  const every = price.recurring?.interval ?? "?";
  return `${amt}/${every}`;
}

/**
 * The verdict for one subscription. Every "skip" names its reason, because the
 * point of the report is that nothing is silently left renewing.
 */
function verdict(sub, cbProducts) {
  if (!LIVE.has(sub.status)) return { act: false, why: `status ${sub.status} — nothing left to renew` };

  // ── Scope. Before anything about renewal state, because a Discord sub that
  //    happens to be "already off" is still not ours to report on as CB Edge.
  const byProduct = cbProducts.has(productOf(sub));
  const byMeta = Boolean(sub.metadata?.clerk_user_id);
  const isCb = byProduct || byMeta;
  const started = sub.start_date ?? sub.created ?? 0;
  const afterCutoff = started >= CUTOFF;

  if (!isCb && !afterCutoff) return { act: false, notCb: true, why: `not CB Edge · joined ${day(started)}` };
  if (!isCb && afterCutoff) return { act: false, notCb: true, why: `not CB Edge · joined ${day(started)} (after cutoff, but no CB Edge product or clerk_user_id)` };
  if (isCb && !afterCutoff) {
    return {
      act: false,
      manual: true,
      why: `CB Edge ${byProduct ? "product" : "clerk_user_id"} but joined ${day(started)}, BEFORE ${SINCE} — left alone, you decide`,
    };
  }

  if (sub.cancel_at_period_end) return { act: false, why: "already off" };
  if (sub.cancel_at) return { act: false, why: `already set to end ${day(sub.cancel_at)}` };
  // A subscription driven by a schedule rejects cancel_at_period_end — the
  // schedule owns its future phases. These must be done by hand in the
  // dashboard (release or end the schedule), so they are shouted, not skipped.
  if (sub.schedule) return { act: false, why: "ON A SCHEDULE — do this one by hand in Stripe", manual: true };
  return { act: true, why: `stop renewal — access runs to ${day(periodEnd(sub))}` };
}

async function listSubs() {
  if (ONLY) return [await stripe.subscriptions.retrieve(ONLY, { expand: ["customer"] })];
  const out = [];
  for await (const sub of stripe.subscriptions.list({ status: "all", limit: 100, expand: ["data.customer"] })) {
    out.push(sub);
  }
  return out;
}

async function main() {
  console.log("");
  console.log(`  STRIPE ${MODE} · ${APPLY ? "APPLY — WRITING TO STRIPE" : "DRY RUN — nothing will change"}${ONLY ? ` · only ${ONLY}` : ""}`);
  console.log("");
  if (MODE === "UNKNOWN") fail("could not tell whether this key is live or test — refusing to guess.");

  const cbProducts = await resolveCbProducts();
  const cbNames = [];
  for (const id of cbProducts) cbNames.push(`${await productName(id)} (${id})`);
  console.log(`  CB Edge = product ${cbNames.join(", ")}  OR  metadata.clerk_user_id`);
  console.log(`  AND joined on/after ${SINCE} 00:00 New York`);
  console.log("");

  const subs = await listSubs();

  const todo = [];
  const skipped = [];
  const manual = [];
  const notCb = [];

  for (const sub of subs) {
    const v = verdict(sub, cbProducts);
    const row = {
      id: sub.id,
      email: emailOf(sub),
      status: sub.status,
      plan: planOf(sub),
      ends: day(periodEnd(sub)),
      product: await productName(productOf(sub)),
      why: v.why,
    };
    if (v.act) todo.push({ sub, row });
    else if (v.notCb) notCb.push(row);
    else if (v.manual) manual.push(row);
    else if (LIVE.has(sub.status)) skipped.push(row); // dead subs are noise; don't list them
  }

  const print = (label, rows) => {
    if (!rows.length) return;
    console.log(`  ${label} (${rows.length})`);
    for (const r of rows) {
      console.log(
        `    ${r.id.padEnd(30)} ${String(r.email).padEnd(30)} ${String(r.product).slice(0, 22).padEnd(22)} ${r.status.padEnd(9)} ${r.plan.padEnd(12)} ends ${r.ends}  ${r.why}`,
      );
    }
    console.log("");
  };

  print(APPLY ? "STOPPING RENEWAL" : "WOULD STOP RENEWAL", todo.map((t) => t.row));
  print("ALREADY ENDING — left alone", skipped);
  print("NOT CB EDGE — left alone, will keep renewing (check these are Discord)", notCb);
  print("NEEDS YOU — could not be done here", manual);

  if (!APPLY) {
    console.log(`  Dry run. ${todo.length} would change · ${notCb.length} not CB Edge, untouched · ${manual.length} need you.`);
    console.log("  Read the NOT CB EDGE list before --apply: every Discord subscription should be on it.");
    console.log("");
    return;
  }

  let ok = 0;
  const failed = [];
  for (const { sub, row } of todo) {
    try {
      await stripe.subscriptions.update(sub.id, {
        cancel_at_period_end: true,
        // The churn-row tag — see "WHAT THE WEBHOOK DOES" at the top.
        cancellation_details: { comment: TAG },
        metadata: { renewal_stopped_by: TAG },
      });
      ok += 1;
      console.log(`  ✓ ${row.id}  ${row.email}  — access runs to ${row.ends}`);
    } catch (err) {
      failed.push({ ...row, why: err?.message ?? String(err) });
      console.log(`  ✗ ${row.id}  ${row.email}  — ${err?.message ?? err}`);
    }
  }

  console.log("");
  console.log(`  Done. ${ok} stopped · ${failed.length} failed · ${skipped.length} already ending · ${notCb.length} not CB Edge (untouched) · ${manual.length} need you.`);
  if (failed.length || manual.length) {
    console.log("  Anything failed or flagged above is STILL SET TO RENEW. Fix those in the Stripe dashboard.");
    process.exitCode = 1;
  }
  console.log("");
}

main().catch((err) => {
  console.error("[stop-renewals] fatal:", err?.message ?? err);
  process.exit(1);
});
