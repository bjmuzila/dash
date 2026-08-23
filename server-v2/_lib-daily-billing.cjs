'use strict';
/**
 * server-v2/_lib-daily-billing.cjs — Stripe subscriptions for daily.cbedge.net.
 *
 * daily.cbedge.net is paid, with no free tier and no trial: an account without a
 * live subscription can sign in, see the pricing page, and do nothing else. That
 * makes this file part of the critical path for every customer, which is why it
 * is written the way it is.
 *
 * ── BILLING IS PER HOUSEHOLD ──────────────────────────────────────────────
 *
 * The thing being sold is "our life runs on this", not a seat. One household
 * holds up to two people and exactly one subscription, so every function here
 * takes a household id and daily_subscriptions has household_id as its PRIMARY
 * KEY. A second person joining does not create a second charge, and removing a
 * member does not cancel anything.
 *
 * ── NO STRIPE SDK, ON PURPOSE ─────────────────────────────────────────────
 *
 * `require('stripe')` is deliberately absent. The container image for this box
 * is `pg` plus node builtins and nothing else, and keeping it that way is worth
 * more than the convenience: a one-line fix in this file ships as a file copy
 * and a restart, not an npm install, a lockfile churn and a multi-minute image
 * rebuild at the exact moment billing is broken and customers are watching.
 *
 * So Stripe is spoken to as what it is — a REST API. Requests are
 * application/x-www-form-urlencoded (Stripe's only accepted request encoding),
 * responses are JSON, and webhook signatures are verified by hand with
 * crypto.createHmac + crypto.timingSafeEqual. The SDK does nothing here that
 * fifty lines of `fetch` do not.
 *
 * ── THE WEBHOOK IS THE SOURCE OF TRUTH ────────────────────────────────────
 *
 * Nothing in daily_subscriptions is ever written from what a browser tells us.
 * The browser can be closed, refreshed, or lying; the only actor that knows
 * whether money moved is Stripe, and the only channel Stripe uses to say so is
 * the webhook. Every status transition in this file therefore originates in
 * handleWebhook().
 *
 * syncFromStripe() is the REPAIR PATH for that, not a second source of truth.
 * If the container was restarting during the thirty seconds after someone paid,
 * the checkout.session.completed webhook hit a closed port; Stripe will retry,
 * but "retry in a few minutes" is no comfort to a customer staring at
 * "subscription required" on the page they landed on straight after entering
 * their card. So /welcome calls syncFromStripe(), which re-asks Stripe the same
 * question the webhook would have answered and writes the same row. It is
 * idempotent with the webhook by construction: both end in upsertSubscription()
 * with data fetched from Stripe.
 *
 * ── REQUIRED ENV (.env.local, mounted at runtime — never baked into the image)
 *   STRIPE_SECRET_KEY             — sk_live_… / sk_test_…. SHARED with the
 *                                   existing CB Edge Stripe account; daily's
 *                                   products live alongside CB Edge's, which is
 *                                   why every object created here carries
 *                                   metadata[household_id] to mark it as ours.
 *   DAILY_STRIPE_PRICE_MONTHLY    — price_… for the monthly plan
 *   DAILY_STRIPE_PRICE_ANNUAL     — price_… for the annual plan
 *   DAILY_STRIPE_WEBHOOK_SECRET   — whsec_… from the endpoint's signing secret.
 *                                   NOT the API key, and not shared with any
 *                                   other endpoint on the account.
 *   DAILY_BASE_URL                — optional, defaults to https://daily.cbedge.net.
 *                                   Used to build success/cancel/return URLs, so
 *                                   it must be the origin the customer's browser
 *                                   is actually on.
 *
 * Missing config is not a crash. configured() returns false and missingConfig()
 * names the gap, so the pricing route can answer "billing isn't set up" instead
 * of throwing a 500 at someone who was about to give us money.
 */

const crypto = require('crypto');

let core = null;
try { core = require('./_lib-daily.cjs'); }
catch (e) { console.warn('[daily-billing] _lib-daily.cjs not loaded — billing disabled:', e.message); }

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const SECRET_KEY = (process.env.STRIPE_SECRET_KEY || '').trim();
const PRICE_MONTHLY = (process.env.DAILY_STRIPE_PRICE_MONTHLY || '').trim();
const PRICE_ANNUAL = (process.env.DAILY_STRIPE_PRICE_ANNUAL || '').trim();
const WEBHOOK_SECRET = (process.env.DAILY_STRIPE_WEBHOOK_SECRET || '').trim();
const BASE_URL = (process.env.DAILY_BASE_URL || 'https://daily.cbedge.net').trim().replace(/\/+$/, '');

const SUCCESS_URL = `${BASE_URL}/welcome?checkout=success`;
const CANCEL_URL = `${BASE_URL}/pricing?checkout=cancelled`;
const PORTAL_RETURN_URL = `${BASE_URL}/settings`;

const STRIPE_API = 'https://api.stripe.com/v1';

/**
 * Pinned rather than left to the account default. The default moves when the
 * Stripe dashboard is upgraded — by a person who is not thinking about this
 * file — and an API version bump silently reshapes the subscription object.
 * Pinning means that change arrives as a deliberate edit here with a test,
 * instead of as a field that quietly went missing in production.
 */
const STRIPE_API_VERSION = '2024-06-20';

/** A hung Stripe call must not hold an HTTP request open until the proxy gives
 *  up. Fifteen seconds is far beyond any healthy response and well inside the
 *  patience of someone who just clicked Subscribe. */
const STRIPE_TIMEOUT_MS = 15_000;

/**
 * `available()` is "is the module wired up at all", `configured()` is "can it
 * actually take money". They differ: a box with the DB but no Stripe keys is a
 * working app whose pricing page must say so, not a stack trace.
 *
 * The webhook secret is part of configured() on purpose, even though checkout
 * itself does not need it. Selling a subscription with no way to receive the
 * event that grants access produces the worst possible outcome — a customer who
 * has paid and has no account — so a deployment missing it is not "partly set
 * up", it is not set up.
 */
const available = () => !!(core && core.available());

function configured() {
  return !!(available() && SECRET_KEY && WEBHOOK_SECRET && (PRICE_MONTHLY || PRICE_ANNUAL));
}

/** Which specific piece is missing. For the owner's eyes — never a browser's. */
function missingConfig() {
  const missing = [];
  if (!SECRET_KEY) missing.push('STRIPE_SECRET_KEY');
  if (!PRICE_MONTHLY) missing.push('DAILY_STRIPE_PRICE_MONTHLY');
  if (!PRICE_ANNUAL) missing.push('DAILY_STRIPE_PRICE_ANNUAL');
  if (!WEBHOOK_SECRET) missing.push('DAILY_STRIPE_WEBHOOK_SECRET');
  if (!available()) missing.push('_lib-daily.cjs');
  return missing;
}

// ---------------------------------------------------------------------------
// Plans
// ---------------------------------------------------------------------------

/**
 * The plan descriptors the pricing page renders.
 *
 * The AMOUNTS ARE DUPLICATED from the Stripe dashboard, which is a real cost and
 * a deliberate one. plans() is called by the public landing page on every single
 * load, including by crawlers; making that page's first paint wait on a Stripe
 * round trip would put an unauthenticated, uncacheable dependency on a third
 * party in front of every visitor, and rate-limit us for the privilege.
 *
 * The duplication is safe because it is only ever COPY. Stripe charges what the
 * price object says, and Checkout shows the real figure on the page where the
 * card is typed — so a stale number here is a wrong marketing line that the
 * customer sees corrected before they can be charged, not a wrong charge. Change
 * a price in Stripe and change it here in the same commit.
 */
const PLAN_DEFS = [
  {
    id: 'monthly',
    priceId: PRICE_MONTHLY,
    name: 'Monthly',
    interval: 'month',
    amount: 800,
    currency: 'usd',
    priceLabel: '$8',
    intervalLabel: 'per month',
    blurb: 'Everything, billed monthly. Cancel any time.',
  },
  {
    id: 'annual',
    priceId: PRICE_ANNUAL,
    name: 'Annual',
    interval: 'year',
    amount: 8000,
    currency: 'usd',
    priceLabel: '$80',
    intervalLabel: 'per year',
    blurb: 'Two months free. Same everything.',
    badge: 'Best value',
  },
];

/**
 * Only plans that have a price id are returned. A card whose Subscribe button
 * dead-ends because DAILY_STRIPE_PRICE_ANNUAL was never set is worse than a
 * pricing page with one option on it — and the route checks configured() first
 * anyway, so an empty list here means the page is already showing "not set up".
 *
 * Frozen copies, because this array is module-level and shared: a caller that
 * decorates a descriptor for one render must not mutate it for everyone.
 */
function plans() {
  return PLAN_DEFS.filter((p) => !!p.priceId).map((p) => Object.freeze({ ...p }));
}

const planForPrice = (priceId) =>
  PLAN_DEFS.find((p) => p.priceId && p.priceId === priceId)?.id ?? null;

const planById = (id) => PLAN_DEFS.find((p) => p.id === String(id || '')) || null;

// ---------------------------------------------------------------------------
// Talking to Stripe
// ---------------------------------------------------------------------------

/**
 * Stripe's request format is form encoding with bracketed paths —
 * `metadata[household_id]=7`, `line_items[0][price]=price_x`. This walks a
 * normal JS object into that shape so callers can write the nesting naturally
 * instead of hand-building key strings and getting one bracket wrong at 2am.
 *
 * null and undefined values are DROPPED rather than sent as the strings "null"
 * or "undefined", which Stripe would happily store as a metadata value.
 */
function formEncode(obj, prefix = '', out = new URLSearchParams()) {
  for (const [rawKey, value] of Object.entries(obj || {})) {
    if (value === null || value === undefined) continue;
    const key = prefix ? `${prefix}[${rawKey}]` : rawKey;
    if (Array.isArray(value)) {
      value.forEach((v, i) => {
        if (v === null || v === undefined) return;
        if (typeof v === 'object') formEncode(v, `${key}[${i}]`, out);
        else out.append(`${key}[${i}]`, String(v));
      });
    } else if (typeof value === 'object') {
      formEncode(value, key, out);
    } else if (typeof value === 'boolean') {
      out.append(key, value ? 'true' : 'false');
    } else {
      out.append(key, String(value));
    }
  }
  return out;
}

/**
 * One call to the Stripe REST API.
 *
 * Throws on a non-2xx with Stripe's own message attached, because every caller
 * here either wants that message in a log line or is inside a try/catch that
 * turns it into an { ok:false } for the route. The `stripeCode` and
 * `httpStatus` properties are what let a caller tell "this customer id no longer
 * exists" apart from "Stripe is having an outage".
 */
async function stripeCall(path, { method = 'GET', form = null, idempotencyKey = null } = {}) {
  if (!SECRET_KEY) throw new Error('daily-billing: STRIPE_SECRET_KEY is not set');

  const headers = {
    Authorization: `Bearer ${SECRET_KEY}`,
    'Stripe-Version': STRIPE_API_VERSION,
  };
  let body;
  if (form) {
    body = formEncode(form).toString();
    headers['Content-Type'] = 'application/x-www-form-urlencoded';
  }
  // Stripe replays an idempotent request's original response rather than
  // performing it twice, which is what stops a double-clicked Subscribe button
  // from creating two customers.
  if (idempotencyKey) headers['Idempotency-Key'] = idempotencyKey;

  let res;
  try {
    res = await fetch(`${STRIPE_API}${path}`, {
      method, headers, body, signal: AbortSignal.timeout(STRIPE_TIMEOUT_MS),
    });
  } catch (err) {
    const e = new Error(`Stripe ${method} ${path} failed: ${err?.message || err}`);
    e.transport = true;
    throw e;
  }

  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    const e = new Error(json?.error?.message || `Stripe ${method} ${path} → ${res.status}`);
    e.httpStatus = res.status;
    e.stripeCode = json?.error?.code || null;
    e.stripeType = json?.error?.type || null;
    throw e;
  }
  return json;
}

// ---------------------------------------------------------------------------
// Reading Stripe's subscription shape
// ---------------------------------------------------------------------------

const unixToDate = (n) => {
  const v = Number(n);
  return Number.isFinite(v) && v > 0 ? new Date(v * 1000) : null;
};

/**
 * When does the paid period this customer is in actually run out?
 *
 * Older API versions put `current_period_end` on the subscription; newer ones
 * moved it onto each subscription ITEM, and a subscription that has only the
 * item-level field reads back as `undefined` from the old path. Checking both
 * costs four lines and prevents a silent regression where every renewal date in
 * the app becomes null on the day Stripe's version is bumped. The latest item
 * end is the one that matters — that is when access should lapse.
 */
function periodEndOf(sub) {
  const direct = unixToDate(sub?.current_period_end);
  if (direct) return direct;
  const items = Array.isArray(sub?.items?.data) ? sub.items.data : [];
  const ends = items
    .map((i) => Number(i?.current_period_end))
    .filter((n) => Number.isFinite(n) && n > 0);
  return ends.length ? new Date(Math.max(...ends) * 1000) : null;
}

function priceIdOf(sub) {
  const items = Array.isArray(sub?.items?.data) ? sub.items.data : [];
  return items[0]?.price?.id || sub?.plan?.id || null;
}

const customerIdOf = (obj) =>
  (typeof obj?.customer === 'string' ? obj.customer : obj?.customer?.id) || null;

const subscriptionIdOf = (obj) =>
  (typeof obj?.subscription === 'string' ? obj.subscription : obj?.subscription?.id) || null;

// ---------------------------------------------------------------------------
// Writing our side
// ---------------------------------------------------------------------------

const pool = () => core.pool();

/**
 * The single place daily_subscriptions is written.
 *
 * Every field except `status` and `cancel_at_period_end` is COALESCEd against
 * what is already stored, and that is the important part. Events arrive knowing
 * different amounts: `invoice.paid` knows the customer and that money moved but
 * carries no plan, while `customer.subscription.updated` knows everything. If a
 * thin event overwrote the row wholesale, an ordinary renewal would blank the
 * plan and the price id and the app would stop being able to say what anyone is
 * paying for.
 *
 * `status` and `cancel_at_period_end` are the exceptions because they are the
 * two fields an event exists to change, and both have meaningful "off" values
 * that COALESCE would refuse to write.
 */
async function upsertSubscription({
  householdId, customerId = null, subscriptionId = null,
  status, plan = null, priceId = null, periodEnd = null, cancelAtPeriodEnd = false,
}) {
  await core.ensureSchema();
  try {
    await pool().query(
      `INSERT INTO daily_subscriptions
         (household_id, stripe_customer_id, stripe_subscription_id, status, plan,
          price_id, current_period_end, cancel_at_period_end, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,now())
       ON CONFLICT (household_id) DO UPDATE SET
         stripe_customer_id     = COALESCE(EXCLUDED.stripe_customer_id,     daily_subscriptions.stripe_customer_id),
         stripe_subscription_id = COALESCE(EXCLUDED.stripe_subscription_id, daily_subscriptions.stripe_subscription_id),
         status                 = EXCLUDED.status,
         plan                   = COALESCE(EXCLUDED.plan,                   daily_subscriptions.plan),
         price_id               = COALESCE(EXCLUDED.price_id,               daily_subscriptions.price_id),
         current_period_end     = COALESCE(EXCLUDED.current_period_end,     daily_subscriptions.current_period_end),
         cancel_at_period_end   = EXCLUDED.cancel_at_period_end,
         updated_at             = now()`,
      [householdId, customerId, subscriptionId, String(status || 'none'),
       plan, priceId, periodEnd, !!cancelAtPeriodEnd]);
    return true;
  } catch (err) {
    // stripe_customer_id and stripe_subscription_id are UNIQUE, so this fires
    // when a Stripe object is already claimed by a DIFFERENT household — two
    // accounts pointed at one customer record. That is a data problem no retry
    // will fix, and it must not take down the webhook endpoint, so it is logged
    // loudly and swallowed.
    if (err && err.code === '23505') {
      console.error('[daily-billing] refusing to move a Stripe object between households:', {
        householdId, customerId, subscriptionId, detail: err.detail,
      });
      return false;
    }
    throw err;
  }
}

/** Write a Stripe subscription object onto its household, in full. */
async function storeSubscription(householdId, sub) {
  const priceId = priceIdOf(sub);
  return upsertSubscription({
    householdId,
    customerId: customerIdOf(sub),
    subscriptionId: sub?.id || null,
    status: sub?.status || 'none',
    plan: planForPrice(priceId),
    priceId,
    periodEnd: periodEndOf(sub),
    cancelAtPeriodEnd: !!sub?.cancel_at_period_end,
  });
}

async function householdExists(householdId) {
  if (!Number.isInteger(householdId) || householdId <= 0) return false;
  const { rows } = await pool().query(`SELECT 1 FROM daily_households WHERE id=$1`, [householdId]);
  return !!rows[0];
}

async function householdForCustomer(customerId) {
  if (!customerId) return null;
  const { rows } = await pool().query(
    `SELECT household_id FROM daily_subscriptions WHERE stripe_customer_id=$1`, [customerId]);
  return rows[0]?.household_id ?? null;
}

/**
 * Which household does this Stripe object belong to?
 *
 * Three routes, in descending order of directness:
 *   1. client_reference_id — set on the Checkout Session, so it is present the
 *      very first time we ever hear about this customer, before any row links
 *      them to us.
 *   2. metadata.household_id — stamped on the customer, the session AND the
 *      subscription itself (see createCheckoutSession), which is what makes a
 *      customer.subscription.updated arriving months later self-describing.
 *   3. the stripe_customer_id we already stored — the fallback for invoice
 *      events, which carry no metadata of ours at all.
 *
 * Returns null when none of them land on a household that exists. The caller
 * must ACKNOWLEDGE that event rather than fail it: a subscription belonging to
 * some other product on this shared Stripe account, or to a household that has
 * since been deleted, would otherwise be retried by Stripe for days and
 * eventually disable the endpoint for everyone.
 */
async function resolveHousehold(obj) {
  const candidates = [obj?.client_reference_id, obj?.metadata?.household_id];
  for (const raw of candidates) {
    const id = Number.parseInt(String(raw ?? ''), 10);
    if (Number.isInteger(id) && await householdExists(id)) return id;
  }
  const viaCustomer = await householdForCustomer(customerIdOf(obj));
  if (viaCustomer && await householdExists(viaCustomer)) return viaCustomer;
  return null;
}

// ---------------------------------------------------------------------------
// Checkout
// ---------------------------------------------------------------------------

/**
 * Find or create this household's Stripe customer, and record it immediately.
 *
 * The write happens BEFORE the checkout session is created, not after it
 * succeeds, and that ordering is the whole point. Someone who opens Checkout,
 * thinks better of it, and comes back an hour later must land on the same
 * customer record — otherwise every abandoned checkout leaves a fresh orphan
 * customer in the account and the customer-id lookup in resolveHousehold has
 * several rows to choose from.
 */
async function ensureCustomer({ household, user }) {
  const existing = await core.subscriptionFor(household.id);
  if (existing?.stripe_customer_id) return existing.stripe_customer_id;

  const customer = await stripeCall('/customers', {
    method: 'POST',
    form: {
      email: user?.email || undefined,
      name: household.name || user?.display_name || undefined,
      // This Stripe account also serves cbedge.net. Stamping the household id on
      // the customer is what lets anyone looking at the dashboard — or at a
      // webhook we did not expect — tell a daily.cbedge.net customer from a CB
      // Edge one without guessing from the email address.
      metadata: { household_id: String(household.id), app: 'daily.cbedge.net' },
    },
    // Two Subscribe clicks a second apart must not mint two customers.
    idempotencyKey: `daily-customer-${household.id}`,
  });

  await upsertSubscription({
    householdId: household.id,
    customerId: customer.id,
    // Status is untouched-in-spirit: this household has a customer record, not a
    // subscription. 'none' is what daily_subscriptions already defaults to and
    // what subscriptionProblem() reads as "subscription-required".
    status: existing?.status || 'none',
  });

  return customer.id;
}

/**
 * Start a Checkout Session. Returns { ok, url } or { ok:false, code, error }.
 *
 * Note what is NOT here: no card details, no price amount, no confirmation
 * screen of our own. Stripe Checkout is a hosted page precisely so that no card
 * number ever touches this process, and reimplementing any part of it would drag
 * this box into PCI scope for no gain.
 */
async function createCheckoutSession({ household, user, plan, req }) {
  if (!configured()) {
    return { ok: false, code: 503, error: 'Billing isn’t set up on this deployment.' };
  }
  if (!household?.id) return { ok: false, code: 400, error: 'No household on this request.' };

  const def = planById(plan);
  if (!def || !def.priceId) {
    return { ok: false, code: 400, error: 'Pick a monthly or annual plan.' };
  }

  try {
    // Already paying? Sending them through Checkout again would create a SECOND
    // subscription on the same customer and charge them twice. The portal is
    // where a plan change belongs.
    const current = await core.subscriptionFor(household.id);
    if (current && ['active', 'trialing', 'past_due'].includes(String(current.status))) {
      return {
        ok: false, code: 409,
        error: 'This household already has a subscription. Manage it from Settings.',
      };
    }

    const customerId = await ensureCustomer({ household, user });

    const session = await stripeCall('/checkout/sessions', {
      method: 'POST',
      form: {
        mode: 'subscription',
        customer: customerId,
        line_items: [{ price: def.priceId, quantity: 1 }],
        // Both, and they are not redundant. client_reference_id is the field
        // Stripe echoes on the session event; metadata is what survives onto
        // objects we look at later in the dashboard.
        client_reference_id: String(household.id),
        metadata: { household_id: String(household.id), plan: def.id },
        // Stamped onto the SUBSCRIPTION as well, so that every future
        // customer.subscription.* event names its household directly instead of
        // depending on our customer-id row still being intact.
        subscription_data: {
          metadata: { household_id: String(household.id), plan: def.id },
        },
        success_url: SUCCESS_URL,
        cancel_url: CANCEL_URL,
        allow_promotion_codes: true,
      },
    });

    if (!session?.url) {
      return { ok: false, code: 502, error: 'Stripe did not return a checkout URL.' };
    }
    console.log('[daily-billing] checkout session', session.id, 'household', household.id,
                'plan', def.id, 'ip', core.clientIp(req));
    return { ok: true, url: session.url };
  } catch (err) {
    console.error('[daily-billing] createCheckoutSession failed:', err?.message || err);
    return { ok: false, code: 502, error: 'Couldn’t reach Stripe. Try again in a moment.' };
  }
}

/**
 * The billing portal — change card, switch plan, cancel, download invoices.
 *
 * All of that is Stripe's hosted UI rather than screens in this app, which is
 * why "cancel my subscription" is not an endpoint here at all. The cancellation
 * comes back as a customer.subscription.updated webhook like any other change.
 */
async function createPortalSession({ household, req }) {
  if (!configured()) {
    return { ok: false, code: 503, error: 'Billing isn’t set up on this deployment.' };
  }
  if (!household?.id) return { ok: false, code: 400, error: 'No household on this request.' };

  try {
    const row = await core.subscriptionFor(household.id);
    if (!row?.stripe_customer_id) {
      return { ok: false, code: 409, error: 'This household hasn’t subscribed yet.' };
    }
    const session = await stripeCall('/billing_portal/sessions', {
      method: 'POST',
      form: { customer: row.stripe_customer_id, return_url: PORTAL_RETURN_URL },
    });
    if (!session?.url) {
      return { ok: false, code: 502, error: 'Stripe did not return a portal URL.' };
    }
    console.log('[daily-billing] portal session for household', household.id,
                'ip', core.clientIp(req));
    return { ok: true, url: session.url };
  } catch (err) {
    console.error('[daily-billing] createPortalSession failed:', err?.message || err);
    return { ok: false, code: 502, error: 'Couldn’t reach Stripe. Try again in a moment.' };
  }
}

// ---------------------------------------------------------------------------
// Webhook signature
// ---------------------------------------------------------------------------

/** Stripe's documented tolerance. Five minutes is generous for clock skew and
 *  narrow enough that a captured request body is worthless by the time anyone
 *  has it. */
const SIGNATURE_TOLERANCE_MS = 5 * 60 * 1000;

/**
 * Verify a Stripe-Signature header against the RAW request bytes.
 *
 * RAW BYTES, not a parsed-and-reserialised object, and this is the single
 * easiest thing to get wrong in this file. Stripe signs the exact octets it put
 * on the wire. JSON.parse followed by JSON.stringify is not the identity
 * function — it reorders nothing but it does normalise unicode escapes, drop
 * insignificant whitespace and reformat numbers — so a signature computed over
 * a round-tripped body fails for reasons that look like a wrong secret. The
 * route must therefore hand this the untouched Buffer, and must not let any body
 * parser near the webhook path.
 *
 * The header looks like `t=1699999999,v1=abc…,v1=def…`. Several v1 values appear
 * while an endpoint's secret is being rotated, so every one is checked.
 *
 * Returns { ok:true, event } or { ok:false, reason }.
 */
function verifySignature({ rawBody, signature }) {
  if (!WEBHOOK_SECRET) return { ok: false, reason: 'no-webhook-secret' };
  if (!rawBody || !rawBody.length) return { ok: false, reason: 'empty-body' };

  const raw = Buffer.isBuffer(rawBody) ? rawBody : Buffer.from(String(rawBody), 'utf8');

  let timestamp = null;
  const signatures = [];
  for (const part of String(signature || '').split(',')) {
    const i = part.indexOf('=');
    if (i < 0) continue;
    const k = part.slice(0, i).trim();
    const v = part.slice(i + 1).trim();
    if (k === 't') timestamp = v;
    else if (k === 'v1') signatures.push(v);
  }
  if (!timestamp || !signatures.length) return { ok: false, reason: 'malformed-signature' };

  // Replay window, checked BEFORE the HMAC so an old-but-validly-signed body —
  // exactly what an attacker replaying a captured "invoice.paid" would send — is
  // rejected on age alone.
  const sentAtMs = Number(timestamp) * 1000;
  if (!Number.isFinite(sentAtMs)) return { ok: false, reason: 'malformed-timestamp' };
  if (Math.abs(Date.now() - sentAtMs) > SIGNATURE_TOLERANCE_MS) {
    return { ok: false, reason: 'timestamp-outside-tolerance' };
  }

  // The signed payload is `${t}.${body}`, fed in as bytes so no encoding step
  // can alter the body on the way through.
  const hmac = crypto.createHmac('sha256', WEBHOOK_SECRET);
  hmac.update(`${timestamp}.`, 'utf8');
  hmac.update(raw);
  const expected = Buffer.from(hmac.digest('hex'), 'utf8');

  const matched = signatures.some((sig) => {
    const given = Buffer.from(sig, 'utf8');
    // timingSafeEqual THROWS on a length mismatch, so the lengths are compared
    // first — that comparison leaks nothing an attacker could not already see.
    return given.length === expected.length && crypto.timingSafeEqual(given, expected);
  });
  if (!matched) return { ok: false, reason: 'signature-mismatch' };

  try {
    return { ok: true, event: JSON.parse(raw.toString('utf8')) };
  } catch {
    return { ok: false, reason: 'body-not-json' };
  }
}

// ---------------------------------------------------------------------------
// Webhook
// ---------------------------------------------------------------------------

const HANDLED_TYPES = new Set([
  'checkout.session.completed',
  'customer.subscription.created',
  'customer.subscription.updated',
  'customer.subscription.deleted',
  'invoice.payment_failed',
  'invoice.paid',
]);

/**
 * Claim an event id. Returns true if this process is the first to see it.
 *
 * daily_stripe_events exists because Stripe guarantees AT LEAST ONCE delivery,
 * not exactly once. It retries on any non-2xx, it retries on a timeout even when
 * we did the work, and it will happily deliver the same event twice for reasons
 * of its own. Most of our handlers are idempotent by construction — writing the
 * same subscription row twice is a no-op — but "most" is not a property worth
 * relying on as this file grows, and one INSERT with ON CONFLICT DO NOTHING buys
 * the guarantee outright.
 */
async function claimEvent(id, type) {
  const { rows } = await pool().query(
    `INSERT INTO daily_stripe_events (id, type) VALUES ($1,$2)
     ON CONFLICT (id) DO NOTHING
     RETURNING id`, [String(id), type ? String(type) : null]);
  return !!rows[0];
}

/** Release a claim so Stripe's retry can do real work. See handleWebhook. */
async function releaseEvent(id) {
  try { await pool().query(`DELETE FROM daily_stripe_events WHERE id=$1`, [String(id)]); }
  catch (e) { console.error('[daily-billing] could not release event', id, e?.message || e); }
}

/**
 * Fetch a subscription from Stripe and write it to its household.
 *
 * Handlers re-fetch rather than trusting the object embedded in the event, for
 * two reasons: an out-of-order retry can deliver a stale snapshot after a newer
 * one, and invoice events carry no subscription fields at all. One extra API
 * call is a cheap price for "the row always reflects what Stripe thinks now".
 */
async function pullSubscription(householdId, subscriptionId) {
  const sub = await stripeCall(`/subscriptions/${encodeURIComponent(subscriptionId)}`);
  await storeSubscription(householdId, sub);
  return sub;
}

/**
 * Handle one webhook delivery. Returns { ok, code, handled }.
 *
 * `code` is the HTTP status the route should send back. Only a signature failure
 * gets a 4xx — everything else answers 200, including events we do not care
 * about and events for households we cannot find, because a non-2xx tells Stripe
 * to retry and there is nothing here a retry would fix. Stripe disables an
 * endpoint that keeps failing, which would take real billing down along with the
 * noise.
 *
 * `handled: false` means "acknowledged, but nothing was written".
 */
async function handleWebhook({ rawBody, signature }) {
  if (!available()) return { ok: false, code: 503, handled: false };

  const verified = verifySignature({ rawBody, signature });
  if (!verified.ok) {
    // 400, and deliberately no detail in the response body. A caller who cannot
    // sign a request has no business learning which part of theirs was wrong.
    console.warn('[daily-billing] webhook rejected:', verified.reason);
    return { ok: false, code: 400, handled: false, reason: verified.reason };
  }

  const event = verified.event;
  const type = String(event?.type || '');
  const id = String(event?.id || '');
  if (!id) return { ok: true, code: 200, handled: false };

  await core.ensureSchema();

  if (!HANDLED_TYPES.has(type)) {
    // Not ours to act on — this endpoint may be subscribed to more than we use,
    // and the CB Edge Stripe account has other products firing events. Recorded
    // anyway so the table doubles as a log of what actually arrives.
    await claimEvent(id, type);
    return { ok: true, code: 200, handled: false };
  }

  const first = await claimEvent(id, type);
  if (!first) {
    console.log('[daily-billing] duplicate event ignored:', id, type);
    return { ok: true, code: 200, handled: false, duplicate: true };
  }

  try {
    const handled = await dispatchEvent(type, event);
    return { ok: true, code: 200, handled };
  } catch (err) {
    // The claim is given back before answering, so that Stripe's retry finds an
    // unseen event rather than a de-dupe row that makes it skip the work this
    // attempt failed to do. Without this, one transient Postgres blip would
    // permanently lose a subscription change.
    await releaseEvent(id);
    console.error('[daily-billing] handler failed for', type, id, '-', err?.message || err);
    // 500 asks Stripe to try again, which is right: this one IS retryable.
    return { ok: false, code: 500, handled: false };
  }
}

async function dispatchEvent(type, event) {
  const obj = event?.data?.object || {};
  const householdId = await resolveHousehold(obj);

  if (!householdId) {
    // Logged with everything needed to work out what it was, then acknowledged.
    // See resolveHousehold for why this must never become a retry.
    console.warn('[daily-billing] event for unknown household — acknowledged:', {
      type, event: event?.id, customer: customerIdOf(obj),
      clientRef: obj?.client_reference_id ?? null,
      metaHousehold: obj?.metadata?.household_id ?? null,
    });
    return false;
  }

  switch (type) {
    case 'checkout.session.completed': {
      // The session says money was taken; it does not say what the subscription
      // now looks like. Record the customer straight away (so a repeat checkout
      // reuses it even if the fetch below fails), then pull the real thing.
      const customerId = customerIdOf(obj);
      const subId = subscriptionIdOf(obj);
      if (customerId) {
        await upsertSubscription({
          householdId, customerId, status: 'incomplete',
        });
      }
      if (!subId) {
        // A one-off payment session on this shared account, not one of ours.
        console.warn('[daily-billing] checkout.session.completed with no subscription:', event?.id);
        return false;
      }
      await pullSubscription(householdId, subId);
      console.log('[daily-billing] household', householdId, 'subscribed via', event?.id);
      return true;
    }

    case 'customer.subscription.created':
    case 'customer.subscription.updated': {
      if (!obj?.id) return false;
      await pullSubscription(householdId, obj.id);
      return true;
    }

    case 'customer.subscription.deleted': {
      // The subscription object is gone at Stripe, so there is nothing to
      // re-fetch — the event body is the final word. The row is kept rather than
      // deleted: it holds the customer id that lets this household resubscribe
      // onto the same Stripe customer, and their invoice history with it.
      await upsertSubscription({
        householdId,
        customerId: customerIdOf(obj),
        subscriptionId: obj?.id || null,
        status: obj?.status || 'canceled',
        plan: planForPrice(priceIdOf(obj)),
        priceId: priceIdOf(obj),
        periodEnd: periodEndOf(obj),
        cancelAtPeriodEnd: false,
      });
      console.log('[daily-billing] household', householdId, 'subscription ended');
      return true;
    }

    case 'invoice.payment_failed': {
      // NOT a lockout. Stripe moves the subscription to past_due and then retries
      // the card for days, and past_due is inside ACTIVE_SUB in _lib-daily.cjs on
      // purpose: taking away someone's grocery list on the morning their card
      // expired is a far worse experience than a few days of unpaid access, and
      // most of these resolve themselves without the customer doing anything. The
      // app shows a banner (see statusFor().needsAction) throughout. Access ends
      // only when Stripe gives up and the subscription becomes unpaid or
      // canceled, which arrives as its own event.
      const subId = subscriptionIdOf(obj);
      if (!subId) return false;
      await pullSubscription(householdId, subId);
      console.warn('[daily-billing] payment failed for household', householdId,
                   '— access continues while Stripe retries');
      return true;
    }

    case 'invoice.paid': {
      // The renewal path, and the recovery path: this is what clears a past_due
      // back to active once a retry finally succeeds, and what pushes
      // current_period_end forward a month or a year.
      const subId = subscriptionIdOf(obj);
      if (!subId) return false;
      await pullSubscription(householdId, subId);
      return true;
    }

    default:
      return false;
  }
}

// ---------------------------------------------------------------------------
// Repair path
// ---------------------------------------------------------------------------

/**
 * Re-ask Stripe what this household's subscription is, and write the answer.
 *
 * Called by the /welcome page the customer lands on straight after paying. In
 * the normal case the webhook has already run and this changes nothing; in the
 * case this exists for — the container was restarting, or the endpoint was
 * briefly unreachable — it is what stops a paying customer from being told
 * "subscription required" seconds after entering their card.
 *
 * The lookup falls back to listing by CUSTOMER, because that is precisely the
 * situation being repaired: ensureCustomer() stored the customer id before
 * checkout began, but the subscription id only ever arrives by webhook. So the
 * household we are rescuing has a customer and no subscription, and asking "what
 * subscriptions does this customer have" is the only question that can answer.
 *
 * Never throws: this runs on a page load, and Stripe being slow must show a
 * "still setting up" state rather than a 500 on the welcome screen.
 */
async function syncFromStripe(householdId) {
  if (!configured()) return { ok: false, reason: 'not-configured' };
  try {
    await core.ensureSchema();
    const row = await core.subscriptionFor(householdId);
    if (!row?.stripe_customer_id && !row?.stripe_subscription_id) {
      return { ok: false, reason: 'no-stripe-customer' };
    }

    let sub = null;
    if (row.stripe_subscription_id) {
      sub = await stripeCall(`/subscriptions/${encodeURIComponent(row.stripe_subscription_id)}`);
    } else {
      // status=all so a subscription sitting in `incomplete` — the card is
      // authorising, or 3-D Secure is mid-flight — is still found. Filtering to
      // active here would report "no subscription" for the exact customer this
      // function exists to rescue.
      const list = await stripeCall(
        `/subscriptions?customer=${encodeURIComponent(row.stripe_customer_id)}&status=all&limit=10`);
      const all = Array.isArray(list?.data) ? list.data : [];
      // Newest first is Stripe's order; prefer a live one over a dead one so a
      // resubscribe is not masked by last year's cancellation.
      sub = all.find((s) => ['active', 'trialing', 'past_due', 'incomplete'].includes(s?.status))
         || all[0] || null;
    }

    if (!sub) {
      return { ok: false, reason: 'no-subscription-at-stripe' };
    }
    await storeSubscription(householdId, sub);
    return { ok: true, status: sub.status, plan: planForPrice(priceIdOf(sub)) };
  } catch (err) {
    console.error('[daily-billing] syncFromStripe failed for household', householdId,
                  '-', err?.message || err);
    return { ok: false, reason: 'stripe-error' };
  }
}

// ---------------------------------------------------------------------------
// What the SPA renders
// ---------------------------------------------------------------------------

/**
 * Statuses where the customer must go and do something about a card.
 *
 * past_due is in here while NOT being locked out — the two ideas are separate on
 * purpose. _lib-daily.cjs decides access; this decides whether to show a banner.
 * A person whose card is failing needs to know that quietly and early, not by
 * discovering one morning that the app has stopped working.
 */
const NEEDS_ACTION = new Set(['past_due', 'unpaid', 'incomplete', 'incomplete_expired']);

/** The subscription shape the SPA renders. Never throws — a billing lookup that
 *  fails must degrade to "we don't know yet", not break the settings screen. */
async function statusFor(householdId) {
  const unknown = {
    status: 'none', plan: null, currentPeriodEnd: null,
    cancelAtPeriodEnd: false, needsAction: false,
  };
  if (!available()) return unknown;
  try {
    const row = await core.subscriptionFor(householdId);
    if (!row) return unknown;
    const status = String(row.status || 'none');
    return {
      status,
      plan: row.plan || planForPrice(row.price_id),
      // ISO, not a Date — this crosses JSON to a browser, and `pg` hands back a
      // Date object that would serialise inconsistently depending on the caller.
      currentPeriodEnd: row.current_period_end
        ? new Date(row.current_period_end).toISOString() : null,
      cancelAtPeriodEnd: !!row.cancel_at_period_end,
      needsAction: NEEDS_ACTION.has(status),
    };
  } catch (err) {
    console.error('[daily-billing] statusFor failed for household', householdId,
                  '-', err?.message || err);
    return unknown;
  }
}

// ---------------------------------------------------------------------------

module.exports = {
  available, configured, missingConfig,
  plans,
  createCheckoutSession, createPortalSession,
  handleWebhook,
  syncFromStripe,
  statusFor,
  // Exported for the routes' own logging and for tests; not part of the contract
  // other modules are written against.
  SIGNATURE_TOLERANCE_MS,
};
