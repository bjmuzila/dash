'use strict';
/**
 * server-v2/daily-routes.cjs — every /api/daily/* route for daily.cbedge.net.
 *
 * daily.cbedge.net is the PUBLIC, PAID version of the private household app at
 * budget.cbedge.net. Same shape of product; strangers pay for it. This file is
 * the HTTP surface of that difference, and two rules run through every handler
 * below.
 *
 * ── 1. TENANCY ────────────────────────────────────────────────────────────
 *
 * budget.cbedge.net scopes rows with `owner_id = :me OR visibility = 'shared'`,
 * which is correct for two people who live together and a data breach with a
 * default value for anyone else. Here the unit of ownership is the HOUSEHOLD:
 * every content row carries household_id NOT NULL and every query filters on it
 * through `daily.scoped(user)`. There is no visibility column and no per-row
 * sharing switch — inside a household everything is shared, across households
 * nothing is, ever.
 *
 * That is why you will not find a VISIBLE constant in this file. `scoped()`
 * builds the predicate, always, so "did this query filter by tenant?" stays
 * answerable by eye rather than by reading a predicate that might over-match.
 *
 * ── 2. ENTITLEMENT ────────────────────────────────────────────────────────
 *
 * There is no free tier. Each route declares one of three levels, and the host
 * process (daily-server.js) resolves them before the handler runs:
 *
 *   'public'  — no session. Sign-up, sign-in, the OAuth dance, the pricing
 *               page, the Stripe webhook, health.
 *   'user'    — a valid dy_session. Signed in, NOT necessarily paying. Billing,
 *               settings-of-the-account, household and onboarding live here so
 *               somebody who has signed up but not paid can still reach
 *               checkout and manage their own account. Locking these behind
 *               payment is a customer who cannot give us money.
 *   'member'  — signed in AND entitled. The host has already applied
 *               daily.subscriptionProblem(user), so a 'member' handler may
 *               assume entitlement and must NOT re-check it.
 *
 * `access` is { ok, user }, where user is the row from daily.userFromRequest —
 * id, household_id, role, tz, sub_status and friends.
 *
 * ── ERRORS ────────────────────────────────────────────────────────────────
 *
 * Nothing internal reaches a browser. A thrown error is logged server-side with
 * its path and answered with a sentence a customer can read; only errors the
 * libs raise DELIBERATELY (they carry a status and a human message — "Pick a
 * date.", "That account could not be found.") are passed through verbatim. A
 * `pg` connection failure carries the connection string in its message, and a
 * Stripe transport error can carry a key prefix; neither may ever be echoed.
 *
 * Every readJson call is size-capped, as on budget.cbedge.net.
 */

const daily = require('./_lib-daily.cjs');

// The budget, Stripe, Google, the market feeds and the mailer are all OPTIONAL
// at load time and required at run time only by the routes that use them. A box
// with no Stripe keys is a working app whose pricing page says "not set up", not
// a container that refuses to boot — and a missing lib must never take the whole
// route table down with it.
let budgetLib = null;
try { budgetLib = require('./_lib-daily-budget.cjs'); }
catch (e) { console.warn('[daily] budget lib not loaded:', e.message); }

let billing = null;
try { billing = require('./_lib-daily-billing.cjs'); }
catch (e) { console.warn('[daily] billing lib not loaded:', e.message); }

let google = null;
try { google = require('./_lib-daily-google.cjs'); }
catch (e) { console.warn('[daily] google lib not loaded:', e.message); }

let markets = null;
try { markets = require('./_lib-daily-markets.cjs'); }
catch (e) { console.warn('[daily] markets lib not loaded:', e.message); }

let mail = null;
try { mail = require('./_lib-daily-mail.cjs'); }
catch (e) { console.warn('[daily] mail lib not loaded:', e.message); }

// ---------------------------------------------------------------------------
// Column lists
// ---------------------------------------------------------------------------

/**
 * due_date is cast to TEXT deliberately. It is a Postgres DATE — a calendar day,
 * not an instant — but `pg` hydrates it into a JS Date at UTC midnight, which
 * JSON-serialises to "2026-08-10T00:00:00.000Z". Any client east or west of UTC
 * then renders the wrong day: in Eastern that is 8pm on Aug 9, so every due date
 * would display one day early and "due today" would look overdue. Sending
 * 'YYYY-MM-DD' kills the entire class of bug at the source, and it is the same
 * shape an <input type="date"> expects. Do not "simplify" this back.
 *
 * `owner_id` and `visibility` are gone — see the tenancy note in the header.
 * `created_by` replaces them: it says who added a row, which is DISPLAY ("added
 * by Sam"), never access. Access is household_id and nothing else.
 */
const TASK_COLS = `id, household_id, created_by, title, notes,
  to_char(due_date, 'YYYY-MM-DD') AS due_date, starred,
  project_id, urgent, done_at, created_at, updated_at, touched_at`;

const NOTE_COLS = `id, household_id, created_by, kind, body, created_at, last_surfaced_at`;

// created_at is sent so the list can show WHEN something was added. On a shared
// list that is the difference between "we still need milk" and "someone put milk
// on here three weeks ago and we've bought it twice since".
const ITEM_COLS = `id, household_id, created_by, list, text, qty, aisle, meal_id,
  checked_at, checked_by, sort_order, created_at`;

const MEAL_COLS = `id, household_id, created_by, to_char(day,'YYYY-MM-DD') AS day,
  title, notes, sort_order`;

const PROJECT_COLS = `id, household_id, created_by, title, summary, status,
  to_char(target_date,'YYYY-MM-DD') AS target_date, sort_order, created_at, updated_at`;

/**
 * Urgent first, always. Then the human reading order: overdue and due-soon
 * before undated. NULLS LAST is the whole trick — without it Postgres sorts
 * undated tasks to the very top and buries everything with a deadline.
 */
const OPEN_ORDER = 'ORDER BY urgent DESC, due_date ASC NULLS LAST, starred DESC, created_at DESC';

/** How long a completed task stays on the Todo screen before it clears. */
const DONE_WINDOW_DAYS = 5;

/**
 * How long an untouched task waits before Today calls it "slipping".
 *
 * A constant here rather than a per-user setting: daily's SETTING_DEFAULTS (see
 * _lib-daily.cjs) deliberately does not carry slippingDays, and putSettings
 * ignores keys it does not know — so a value written by the client would be
 * silently dropped and the screen would disagree with the settings page.
 */
const SLIPPING_DAYS = 7;

const BLOCKS = ['morning', 'afternoon', 'evening'];
const normBlock = (v) => (BLOCKS.includes(String(v || '')) ? String(v) : 'morning');

const PROJECT_STATUSES = ['active', 'someday', 'done'];
const normStatus = (v) => (PROJECT_STATUSES.includes(String(v || '')) ? String(v) : 'active');

/**
 * Aisle order is store order, not alphabetical — the whole point is walking the
 * shop once. 'other' is last because unknowns belong at the end, not the middle.
 */
const AISLES = ['produce', 'meat', 'dairy', 'bakery', 'frozen', 'pantry', 'household', 'other'];
const normAisle = (v) => (AISLES.includes(String(v || '').toLowerCase()) ? String(v).toLowerCase() : 'other');

/**
 * A small keyword guess so adding "chicken thighs" lands in Meat without the
 * user picking an aisle. Deliberately conservative: a wrong guess is worse than
 * 'other', because a misfiled item is one you walk past.
 */
const AISLE_HINTS = [
  ['produce', /\b(apple|banana|lettuce|romaine|spinach|onion|potato|tomato|carrot|celery|pepper|garlic|lemon|lime|avocado|broccoli|cucumber|berr|grape|salad|herb|cilantro|kale)\w*/i],
  ['meat', /\b(chicken|beef|pork|steak|bacon|sausage|turkey|ham|mince|ground|fish|salmon|shrimp|tilapia)\w*/i],
  ['dairy', /\b(milk|cheese|yogurt|butter|cream|egg|sour cream|half and half)\w*/i],
  ['bakery', /\b(bread|bagel|bun|roll|tortilla|muffin|croissant|pita)\w*/i],
  ['frozen', /\b(frozen|ice cream|pizza|waffle)\w*/i],
  ['household', /\b(paper towel|toilet|detergent|soap|trash bag|foil|wrap|napkin|sponge|shampoo|batter(y|ies))\w*/i],
  ['pantry', /\b(rice|pasta|bean|sauce|oil|vinegar|flour|sugar|cereal|coffee|tea|spice|salt|pepper|can|soup|stock|broth|chip|cracker|peanut butter|jelly)\w*/i],
];
function guessAisle(text) {
  for (const [aisle, re] of AISLE_HINTS) if (re.test(text)) return aisle;
  return 'other';
}

// ---------------------------------------------------------------------------
// Dates — every one of them resolved in the USER's timezone
// ---------------------------------------------------------------------------

const pad = (n) => String(n).padStart(2, '0');
const isoOf = (dt) => `${dt.getFullYear()}-${pad(dt.getMonth() + 1)}-${pad(dt.getDate())}`;

/** Shift a 'YYYY-MM-DD' by whole days without ever touching a timezone. */
function addDays(iso, days) {
  const [y, m, d] = String(iso).split('-').map(Number);
  return isoOf(new Date(y, m - 1, d + days));
}

/**
 * Today, in the user's zone. Without this a task due "today" flips to overdue at
 * 8pm Eastern, when UTC rolls over — and a routine ticked at 9pm logs tomorrow.
 */
function todayIn(tz) {
  const p = new Intl.DateTimeFormat('en-US', {
    timeZone: tz || 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(new Date());
  const m = {};
  p.forEach((x) => { m[x.type] = x.value; });
  return `${m.year}-${m.month}-${m.day}`;
}

/**
 * The Monday on or before `iso`.
 *
 * Monday, not Sunday: a meal plan is a working week, and starting on Sunday puts
 * tonight's dinner at the far right of the board every Sunday evening.
 */
function weekStart(iso) {
  const [y, m, d] = iso.split('-').map(Number);
  const back = (new Date(y, m - 1, d).getDay() + 6) % 7; // Sun=0 -> 6, Mon=1 -> 0
  return addDays(iso, -back);
}

const str = (v, max = 2000) => String(v ?? '').trim().slice(0, max);

/**
 * A date input arrives as 'YYYY-MM-DD' or empty. Anything else is dropped rather
 * than passed to Postgres, so a malformed value can't throw a 500.
 */
const dateOrNull = (v) => (/^\d{4}-\d{2}-\d{2}$/.test(String(v ?? '')) ? String(v) : null);
const isDate = (v) => /^\d{4}-\d{2}-\d{2}$/.test(String(v || ''));

const posInt = (v) => {
  const n = Number(v);
  return Number.isInteger(n) && n > 0 ? n : null;
};

// ---------------------------------------------------------------------------
// Streaks — ported from _lib-household-routines.cjs
// ---------------------------------------------------------------------------

const HISTORY_DAYS = 30;
const STREAK_LOOKBACK = 400;

/**
 * Consecutive days completed, walking backwards — but TODAY IS NOT COUNTED
 * AGAINST YOU UNTIL IT IS OVER. If the morning routine is undone at 7am the walk
 * starts from yesterday instead. A streak that resets at midnight and only
 * recovers once you have done the thing is punishing and, worse, wrong: you have
 * not broken anything at 7am.
 */
function currentStreak(days, today) {
  let cursor = days.has(today) ? today : addDays(today, -1);
  if (!days.has(cursor)) return 0; // yesterday missing too — the streak really is over
  let n = 0;
  while (days.has(cursor) && n < STREAK_LOOKBACK) {
    n++;
    cursor = addDays(cursor, -1);
  }
  return n;
}

/** Longest run anywhere in the window — the number worth beating. */
function bestStreak(days) {
  const sorted = [...days].sort();
  let best = 0;
  let run = 0;
  let prev = null;
  for (const d of sorted) {
    run = (prev && addDays(prev, 1) === d) ? run + 1 : 1;
    if (run > best) best = run;
    prev = d;
  }
  return best;
}

// ---------------------------------------------------------------------------

function registerDailyRoutes({ register, send, readJson, readRaw }) {
  if (!daily.available()) {
    console.warn('[daily] no DB layer — /api/daily/* not registered');
    return 0;
  }

  const NO_STORE = 'no-store, must-revalidate';
  const nostore = { 'Cache-Control': NO_STORE };
  let n = 0;
  const add = (path, def) => { register(path, def); n++; };

  const pool = () => daily.pool();

  // Accepts one cookie or several — PIN sign-in sets dy_session AND may re-issue
  // dy_device in the same response. Node's setHeader takes an array for that.
  const authHeaders = (cookie) => {
    const list = (Array.isArray(cookie) ? cookie : [cookie]).filter(Boolean);
    if (!list.length) return nostore;
    return { ...nostore, 'Set-Cookie': list.length === 1 ? list[0] : list };
  };

  /**
   * A real 302, not JSON. These paths are BROWSER NAVIGATIONS — a navigation
   * that answers with a JSON body dumps raw text on the screen, and a person in
   * the middle of an OAuth dance has no way to act on it.
   */
  const redirect = (res, to, cookie = null) => {
    res.statusCode = 302;
    res.setHeader('Location', to);
    res.setHeader('Cache-Control', NO_STORE);
    const list = (Array.isArray(cookie) ? cookie : [cookie]).filter(Boolean);
    if (list.length) res.setHeader('Set-Cookie', list.length === 1 ? list[0] : list);
    res.end();
  };

  const params = (req) => new URL(req.url || '/', 'http://localhost').searchParams;
  const pathOf = (req) => String(req.url || '/').split('?')[0];

  /**
   * The user shape the SPA renders. Never the password hash, never a Stripe id,
   * never a Google token — this crosses the wire to a browser.
   */
  const publicUser = (u, extra = {}) => ({
    id: u.id,
    email: u.email,
    displayName: u.display_name,
    tz: u.tz,
    role: u.role,
    householdId: u.household_id,
    householdName: u.household_name ?? null,
    emailVerified: !!u.email_verified_at,
    mustChangePassword: !!u.must_change_password,
    onboarded: !!u.onboarded_at,
    googleEmail: u.google_email ?? null,
    // The entitlement decision, already made, so the SPA never has to reason
    // about Stripe statuses to decide whether to draw the app or the paywall.
    entitled: daily.subscriptionOk(u),
    subscription: {
      status: u.sub_status || 'none',
      plan: u.sub_plan ?? null,
      currentPeriodEnd: u.sub_period_end ? new Date(u.sub_period_end).toISOString() : null,
      cancelAtPeriodEnd: !!u.sub_cancel_at_period_end,
    },
    // Whether THIS browser is armed for quick sign-in. On the user object rather
    // than a separate call because the SPA needs it on every load to decide
    // whether to offer PIN setup, and /me is already that round-trip.
    pinOnThisDevice: false,
    ...extra,
  });

  // ── Deliberate, human-readable failures ────────────────────────────────────
  // The libs raise these with a status attached, and so do the ported handlers
  // below. They are the ONLY errors whose text reaches a browser.
  const bad = (message) => Object.assign(new Error(message), { status: 400 });
  const missing = (what = 'That') => Object.assign(new Error(`${what} could not be found.`), { status: 404 });

  const SAFE_STATUS = new Set([400, 401, 402, 403, 404, 409, 429]);

  /**
   * One catch for every handler.
   *
   * A deliberate error (status 4xx + a sentence written for a customer) is
   * passed through. EVERYTHING ELSE is logged with its path and answered with a
   * generic line, because the message on an unexpected error is written for us,
   * not for them: `pg` puts the connection string in a failed-connection
   * message and a Stripe transport error can carry a key prefix. Neither may be
   * echoed to a browser, and "it worked yesterday" is not a reason to relax it.
   */
  const oops = (res, req, err, fallback = 'Something went wrong. Try again in a moment.') => {
    const status = Number(err?.status || 0);
    if (SAFE_STATUS.has(status)) {
      send(res, status, { error: String(err.message || 'Request failed.') }, nostore);
      return;
    }
    console.error(`[daily] ${req?.method || 'GET'} ${pathOf(req)} failed:`, err?.message || err);
    send(res, 500, { error: fallback }, nostore);
  };

  /**
   * A lib that is absent or unconfigured answers 503 with a reason a person can
   * act on — never a throw, and never a Connect button that dead-ends. Returns
   * true when the caller has already answered.
   */
  const unavailable = (res, lib, reason) => {
    if (lib && (typeof lib.configured !== 'function' || lib.configured())) return false;
    send(res, 503, { error: reason }, nostore);
    return true;
  };

  // ═══════════════════════════════════════════════════════════════════════════
  // Auth
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Self-signup. Creates the household and its first (owner) user, signs them in
   * and points them at checkout.
   *
   * Both emails are AWAITED but neither may fail the request — see the header of
   * _lib-daily-mail.cjs. The account exists by the time we get here, so a signup
   * that 500s because Resend is having an afternoon is a customer with a working
   * account who thinks they have nothing, and who cannot sign up again because
   * their address is now taken. `needsCheckout` is always true: there is no free
   * tier, so the very next screen is pricing.
   */
  add('/api/daily/auth/signup', {
    auth: 'public', methods: ['POST'],
    async handler(req, res) {
      try {
        const body = await readJson(req, 8192);
        const result = await daily.createAccount({
          email: body?.email,
          password: body?.password,
          displayName: body?.displayName,
          tz: body?.tz,
          req,
        });
        if (!result.ok) { send(res, result.code, { error: result.error }, nostore); return; }

        if (mail) {
          try {
            if (result.verifyToken) {
              await mail.sendVerifyEmail({
                to: result.user.email, name: result.user.display_name, token: result.verifyToken,
              });
            }
            await mail.sendWelcome({ to: result.user.email, name: result.user.display_name });
          } catch (mailErr) {
            // The mailer already swallows its own failures; this catch exists for
            // the one that gets past it. It must not undo the signup.
            console.error('[daily] signup mail failed:', mailErr?.message || mailErr);
          }
        }

        send(res, 200, { ok: true, user: publicUser(result.user), needsCheckout: true },
             authHeaders(result.cookie));
      } catch (err) { oops(res, req, err, 'Could not create that account. Try again.'); }
    },
  });

  add('/api/daily/auth/login', {
    auth: 'public', methods: ['POST'],
    async handler(req, res) {
      try {
        const body = await readJson(req, 8192);
        const result = await daily.login({ email: body?.email, password: body?.password, req });
        if (!result.ok) { send(res, result.code, { error: result.error }, nostore); return; }
        const pin = await daily.pinStatus(req, result.user.id).catch(() => ({ onThisDevice: false }));
        send(res, 200, { ok: true, user: publicUser(result.user, { pinOnThisDevice: !!pin.onThisDevice }) },
             authHeaders(result.cookie));
      } catch (err) { oops(res, req, err, 'Could not sign you in. Try again.'); }
    },
  });

  // Public so a stale or invalid cookie can still be cleared, instead of 401ing
  // into a state where you cannot sign out.
  add('/api/daily/auth/logout', {
    auth: 'public', methods: ['POST'],
    async handler(req, res) {
      try { await daily.destroySession(req); } catch { /* clear the cookie regardless */ }
      send(res, 200, { ok: true }, authHeaders(daily.clearCookie()));
    },
  });

  // Public + 401 rather than auth:'user', so a signed-out visitor gets clean JSON
  // the SPA can render a sign-in form from — no redirect, no HTML, no guessing
  // whether a 302 to /sign-in was the app or a proxy.
  add('/api/daily/auth/me', {
    auth: 'public', methods: ['GET'],
    async handler(req, res) {
      const u = await daily.userFromRequest(req);
      if (!u) { send(res, 401, { error: 'no-session' }, nostore); return; }
      let cookie = null;
      if (daily.shouldSlide(u)) {
        try {
          const r = await daily.refreshSession(req);
          if (r) cookie = daily.sessionCookie(r.token, daily.SESSION_MAX_AGE);
        } catch { /* keep the existing cookie */ }
      }
      const pin = await daily.pinStatus(req, u.id).catch(() => ({ onThisDevice: false }));
      send(res, 200, { user: publicUser(u, { pinOnThisDevice: !!pin.onThisDevice }) }, authHeaders(cookie));
    },
  });

  // 'user', not 'member': changing your own password is account hygiene, and an
  // unpaid account must still be able to secure itself.
  add('/api/daily/auth/change-password', {
    auth: 'user', methods: ['POST'],
    async handler(req, res, _ctx, access) {
      try {
        const body = await readJson(req, 8192);
        const result = await daily.changePassword({
          userId: access.user.id,
          currentPassword: body?.currentPassword,
          newPassword: body?.newPassword,
          req,
        });
        if (!result.ok) { send(res, result.code, { error: result.error }, nostore); return; }
        send(res, 200, { ok: true }, authHeaders(result.cookie));
      } catch (err) { oops(res, req, err, 'Could not change your password.'); }
    },
  });

  /**
   * Your own name and timezone.
   *
   * 'user' rather than 'member' for the same reason change-password is: someone
   * whose card just failed still owns their account and must be able to correct
   * a typo in their own name. The email address is deliberately NOT editable
   * here — changing it is an identity change that has to re-verify, and doing it
   * silently through a settings form is how an account gets taken over by a
   * stale session.
   */
  add('/api/daily/auth/profile', {
    auth: 'user', methods: ['POST'],
    async handler(req, res, _ctx, access) {
      try {
        const body = await readJson(req, 8192);
        const sets = [];
        const vals = [access.user.id];
        if (body?.displayName !== undefined) {
          const name = str(body.displayName, 80);
          if (!name) { send(res, 400, { error: 'Your name can’t be empty.' }, nostore); return; }
          vals.push(name); sets.push(`display_name=$${vals.length}`);
        }
        if (body?.tz !== undefined) {
          // Validated by asking Intl to use it. A junk zone stored here would
          // silently break every date the app computes for this person — "due
          // today" is a timezone question before it is a database one.
          const tz = str(body.tz, 60);
          try { new Intl.DateTimeFormat('en-US', { timeZone: tz }).format(new Date()); }
          catch { send(res, 400, { error: 'That isn’t a timezone we recognise.' }, nostore); return; }
          vals.push(tz); sets.push(`tz=$${vals.length}`);
        }
        if (!sets.length) { send(res, 400, { error: 'Nothing to update.' }, nostore); return; }
        await pool().query(`UPDATE daily_users SET ${sets.join(', ')} WHERE id=$1`, vals);
        send(res, 200, { ok: true, user: publicUser(await daily.userById(access.user.id)) }, nostore);
      } catch (err) { oops(res, req, err, 'Could not save your details.'); }
    },
  });

  /**
   * Mark the first-run walkthrough finished.
   *
   * This exists because the SPA cannot remember it any other way. Keeping it in
   * localStorage would send the same person through onboarding again on their
   * phone, and — worse — step two of that walkthrough leaves the app entirely
   * for Google's consent screen, so any in-memory flag is gone by the time they
   * come back. It has to be a column.
   */
  add('/api/daily/auth/onboarded', {
    auth: 'user', methods: ['POST'],
    async handler(req, res, _ctx, access) {
      try {
        await pool().query(
          `UPDATE daily_users SET onboarded_at = COALESCE(onboarded_at, now()) WHERE id=$1`,
          [access.user.id]);
        send(res, 200, { ok: true, user: publicUser(await daily.userById(access.user.id)) }, nostore);
      } catch (err) { oops(res, req, err, 'Could not finish setting up.'); }
    },
  });

  // ── Quick sign-in ──────────────────────────────────────────────────────────
  // See the PIN section of _lib-daily.cjs for why four digits are safe here: the
  // PIN is only ever half the credential, the other half being the 32-byte
  // dy_device cookie, and five wrong guesses forget the browser outright.

  // Public: the whole point is answering this while signed OUT. With no
  // dy_device cookie it returns { hasPin:false } and the SPA draws the ordinary
  // password form — a stranger learns nothing about who uses this app.
  add('/api/daily/auth/pin-status', {
    auth: 'public', methods: ['GET'],
    async handler(req, res) {
      try {
        const st = await daily.pinStatus(req);
        send(res, 200, { hasPin: !!st.armed }, nostore);
      } catch { send(res, 200, { hasPin: false }, nostore); }
    },
  });

  add('/api/daily/auth/pin-login', {
    auth: 'public', methods: ['POST'],
    async handler(req, res) {
      try {
        const body = await readJson(req, 4096);
        const result = await daily.pinLogin({ pin: body?.pin, req });
        if (!result.ok) {
          // `forgotten` means the device rows are gone. The lib hands back the
          // cookie that clears dy_device with it, so the next load asks for a
          // password instead of a PIN that can no longer be right.
          send(res, result.code,
               { error: result.error, forget: !!result.forgotten },
               result.cookie ? authHeaders(result.cookie) : nostore);
          return;
        }
        send(res, 200, { ok: true, user: publicUser(result.user, { pinOnThisDevice: true }) },
             authHeaders(result.cookie));
      } catch (err) { oops(res, req, err, 'Could not sign you in with that PIN.'); }
    },
  });

  // Arming a PIN requires a live session — a PIN is a shortcut back to access you
  // already proved with a password, never a way to create it. 'user' rather than
  // 'member' because it is sign-in plumbing, not app data.
  add('/api/daily/auth/pin', {
    auth: 'user', methods: ['GET', 'POST'],
    async handler(req, res, _ctx, access) {
      try {
        if ((req.method || 'GET').toUpperCase() === 'GET') {
          const st = await daily.pinStatus(req, access.user.id);
          send(res, 200, {
            hasPinOnThisDevice: !!st.onThisDevice,
            // Whether ANYONE is armed on this browser — a shared tablet can hold
            // a PIN for both people in a household. There is deliberately no
            // "how many other devices" count: that would need a query across
            // every browser the account has ever armed, and the only action it
            // could inform (forget them all) is not offered.
            armedOnThisDevice: !!st.armed,
          }, nostore);
          return;
        }
        const body = await readJson(req, 4096);
        const result = await daily.setPin({ userId: access.user.id, pin: body?.pin, req });
        if (!result.ok) { send(res, result.code, { error: result.error }, nostore); return; }
        send(res, 200, { ok: true }, authHeaders(result.cookie));
      } catch (err) { oops(res, req, err, 'Could not set that PIN.'); }
    },
  });

  add('/api/daily/auth/pin/remove', {
    auth: 'user', methods: ['POST'],
    async handler(req, res, _ctx, access) {
      try {
        const result = await daily.removePin({ userId: access.user.id, req });
        send(res, 200, { ok: true }, authHeaders(result.cookie || null));
      } catch (err) { oops(res, req, err, 'Could not remove that PIN.'); }
    },
  });

  /**
   * Forgot password.
   *
   * ALWAYS answers { ok:true }, and takes roughly the same time whether or not
   * the address exists. That uniformity is the entire security property of this
   * route: on a public signup form, a reply that differs — "no account with that
   * email", or simply coming back in 20ms instead of 300ms because no token was
   * minted and no mail was sent — is an account-enumeration oracle. Type an
   * address, learn whether that person is a customer. Worth nothing to a
   * legitimate user (they know whether they have an account) and worth a lot to
   * someone building a list.
   *
   * So: the token is issued and mailed ONLY when the account is real, and the
   * response is padded to a floor either way.
   */
  const FORGOT_FLOOR_MS = 400;
  add('/api/daily/auth/forgot', {
    auth: 'public', methods: ['POST'],
    async handler(req, res) {
      const started = Date.now();
      try {
        const body = await readJson(req, 4096);
        const user = await daily.findUserByEmail(body?.email).catch(() => null);
        if (user && user.active) {
          const token = await daily.issueEmailToken({ kind: 'reset', userId: user.id, email: user.email });
          if (mail) {
            await mail.sendPasswordReset({ to: user.email, name: user.display_name, token })
              .catch((e) => console.error('[daily] reset mail failed:', e?.message || e));
          }
        }
      } catch (err) {
        // Even a real failure answers ok:true — see above. It is logged here so
        // the silence is ours and not the customer's.
        console.error(`[daily] POST ${pathOf(req)} failed:`, err?.message || err);
      }
      const spent = Date.now() - started;
      if (spent < FORGOT_FLOOR_MS) {
        await new Promise((r) => setTimeout(r, FORGOT_FLOOR_MS - spent));
      }
      send(res, 200, { ok: true }, nostore);
    },
  });

  add('/api/daily/auth/reset', {
    auth: 'public', methods: ['POST'],
    async handler(req, res) {
      try {
        const body = await readJson(req, 8192);
        const result = await daily.resetPassword({
          token: body?.token, newPassword: body?.password, req,
        });
        if (!result.ok) { send(res, result.code, { error: result.error }, nostore); return; }
        send(res, 200, { ok: true, user: publicUser(result.user) }, authHeaders(result.cookie));
      } catch (err) { oops(res, req, err, 'Could not reset that password.'); }
    },
  });

  add('/api/daily/auth/verify', {
    auth: 'public', methods: ['POST'],
    async handler(req, res) {
      try {
        const body = await readJson(req, 4096);
        const row = await daily.consumeEmailToken(body?.token, 'verify');
        if (!row || !row.user_id) {
          send(res, 400, { error: 'That confirmation link has expired. Ask for a new one.' }, nostore);
          return;
        }
        await daily.markEmailVerified(row.user_id);
        send(res, 200, { ok: true }, nostore);
      } catch (err) { oops(res, req, err, 'Could not confirm that address.'); }
    },
  });

  add('/api/daily/auth/resend-verification', {
    auth: 'user', methods: ['POST'],
    async handler(req, res, _ctx, access) {
      try {
        const u = access.user;
        // Already confirmed is a success, not an error — the person clicked a
        // button whose job is done, and an error there just looks broken.
        if (u.email_verified_at) { send(res, 200, { ok: true, alreadyVerified: true }, nostore); return; }
        const token = await daily.issueEmailToken({ kind: 'verify', userId: u.id, email: u.email });
        let sent = false;
        if (mail) {
          const r = await mail.sendVerifyEmail({ to: u.email, name: u.display_name, token })
            .catch(() => ({ ok: false }));
          sent = !!r?.ok;
        }
        send(res, 200, { ok: true, sent }, nostore);
      } catch (err) { oops(res, req, err, 'Could not send that email.'); }
    },
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // Google — sign-in and calendar linking
  // ═══════════════════════════════════════════════════════════════════════════
  //
  // Both routes are auth:'public' and both END IN A REDIRECT, because they are
  // browser navigations rather than fetches. A 401 with a JSON body here puts
  // raw text on the screen in the middle of an OAuth dance; a 302 puts the
  // person somewhere they can act.
  //
  // The dy_session cookie is SameSite=Lax, which permits top-level GET
  // navigations, so it IS present when Google redirects back. (It would NOT
  // survive a POST callback — do not change response_type to one that posts.)

  add('/api/daily/google/start', {
    auth: 'public', methods: ['GET'],
    async handler(req, res) {
      try {
        const q = params(req);
        // Purpose comes from the query here and is immediately SIGNED into the
        // state by authUrl(). It is read back only from inside that verified
        // blob — never from the callback's query string, where flipping
        // 'connect' to 'signin' would turn a link click into a session mint.
        const purpose = q.get('purpose') === 'signin' ? 'signin' : 'connect';
        const next = q.get('next');

        if (!google || !google.configured()) {
          redirect(res, purpose === 'signin'
            ? '/sign-in?error=google-unavailable'
            : '/settings?google=unavailable');
          return;
        }

        if (purpose === 'connect') {
          // Linking a calendar to an account requires knowing which account.
          const u = await daily.userFromRequest(req);
          if (!u) { redirect(res, '/sign-in?next=/settings'); return; }
          redirect(res, google.authUrl({ purpose: 'connect', userId: u.id, next }));
          return;
        }
        redirect(res, google.authUrl({ purpose: 'signin', next }));
      } catch (err) {
        console.error(`[daily] GET ${pathOf(req)} failed:`, err?.message || err);
        redirect(res, '/sign-in?error=google-failed');
      }
    },
  });

  add('/api/daily/google/callback', {
    auth: 'public', methods: ['GET'],
    async handler(req, res) {
      try {
        if (!google || !google.configured()) { redirect(res, '/sign-in?error=google-unavailable'); return; }
        const q = params(req);
        const result = await google.handleCallback({
          code: q.get('code'), state: q.get('state'), req,
        });
        if (!result.ok) {
          // The lib already chose somewhere sensible for each failure — a
          // cancelled consent screen goes back where it came from, a forged or
          // expired state goes to sign-in. Never render an error page here.
          redirect(res, result.redirect || '/sign-in?error=google-failed');
          return;
        }
        // `cookie` is only present for a sign-in: the lib does not own the HTTP
        // response, so it hands the session back for us to set.
        redirect(res, result.redirect || '/today', result.cookie || null);
      } catch (err) {
        console.error(`[daily] GET ${pathOf(req)} failed:`, err?.message || err);
        redirect(res, '/sign-in?error=google-failed');
      }
    },
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // Billing
  // ═══════════════════════════════════════════════════════════════════════════
  //
  // Every route here is 'user', never 'member'. Gating checkout on entitlement
  // is a customer who cannot pay us: the whole reason these exist is that the
  // caller does NOT have a subscription yet.

  add('/api/daily/billing/plans', {
    auth: 'public', methods: ['GET'],
    async handler(req, res) {
      try {
        const configured = !!(billing && billing.configured());
        send(res, 200, { plans: billing ? billing.plans() : [], configured }, nostore);
      } catch (err) { oops(res, req, err, 'Could not load the plans.'); }
    },
  });

  add('/api/daily/billing/status', {
    auth: 'user', methods: ['GET'],
    async handler(req, res, _ctx, access) {
      try {
        if (!billing) { send(res, 503, { error: 'Billing isn’t set up on this deployment.' }, nostore); return; }
        send(res, 200, {
          ...(await billing.statusFor(access.user.household_id)),
          configured: billing.configured(),
        }, nostore);
      } catch (err) { oops(res, req, err, 'Could not read your subscription.'); }
    },
  });

  /**
   * Start a Checkout Session.
   *
   * OWNER ONLY. A household holds one subscription; a member pressing Subscribe
   * would open a second checkout against the same household and charge the house
   * twice for the same thing, with two Stripe subscriptions racing to write one
   * row. The owner is the billing contact — see _lib-daily-billing.cjs.
   */
  add('/api/daily/billing/checkout', {
    auth: 'user', methods: ['POST'],
    async handler(req, res, _ctx, access) {
      try {
        if (unavailable(res, billing, 'Billing isn’t set up on this deployment.')) return;
        const u = access.user;
        if (String(u.role) !== 'owner') {
          send(res, 403, {
            error: 'Only the account owner can start a subscription. Ask them to set it up — you’ll both get access.',
          }, nostore);
          return;
        }
        const body = await readJson(req, 4096);
        const result = await billing.createCheckoutSession({
          household: { id: u.household_id, name: u.household_name },
          user: { email: u.email, display_name: u.display_name },
          plan: body?.plan,
          req,
        });
        if (!result.ok) { send(res, result.code || 400, { error: result.error }, nostore); return; }
        send(res, 200, { ok: true, url: result.url }, nostore);
      } catch (err) { oops(res, req, err, 'Could not start checkout. Try again in a moment.'); }
    },
  });

  // Owner-only for the same reason as checkout: the portal can change the plan,
  // the card and the cancellation, and none of those are a member's to make on
  // the billing contact's behalf.
  add('/api/daily/billing/portal', {
    auth: 'user', methods: ['POST'],
    async handler(req, res, _ctx, access) {
      try {
        if (unavailable(res, billing, 'Billing isn’t set up on this deployment.')) return;
        const u = access.user;
        if (String(u.role) !== 'owner') {
          send(res, 403, { error: 'Only the account owner can manage billing.' }, nostore);
          return;
        }
        const result = await billing.createPortalSession({
          household: { id: u.household_id, name: u.household_name }, req,
        });
        if (!result.ok) { send(res, result.code || 400, { error: result.error }, nostore); return; }
        send(res, 200, { ok: true, url: result.url }, nostore);
      } catch (err) { oops(res, req, err, 'Could not open the billing portal.'); }
    },
  });

  /**
   * The repair path the post-checkout page calls.
   *
   * Not owner-only: it writes nothing a webhook would not have written anyway,
   * and the person staring at "subscription required" seconds after their
   * partner paid should be able to fix their own screen.
   */
  add('/api/daily/billing/sync', {
    auth: 'user', methods: ['POST'],
    async handler(req, res, _ctx, access) {
      try {
        if (unavailable(res, billing, 'Billing isn’t set up on this deployment.')) return;
        const result = await billing.syncFromStripe(access.user.household_id);
        // Never throws and never a 5xx: this runs on a page load, and Stripe
        // being slow must render "still setting up", not a failure.
        send(res, 200, result, nostore);
      } catch (err) { oops(res, req, err, 'Could not refresh your subscription.'); }
    },
  });

  /**
   * The Stripe webhook — the ONLY thing that grants access.
   *
   * readRaw(), never readJson(). Stripe signs the exact octets it put on the
   * wire, and JSON.parse followed by JSON.stringify is not the identity
   * function: it normalises unicode escapes, drops insignificant whitespace and
   * reformats numbers. A signature computed over a round-tripped body fails in a
   * way that looks exactly like a wrong secret, and the symptom is customers who
   * pay and never get access. Nothing may parse this body before verification.
   */
  add('/api/daily/stripe/webhook', {
    auth: 'public', methods: ['POST'],
    async handler(req, res) {
      try {
        if (!billing) { send(res, 503, { error: 'not-configured' }, nostore); return; }
        const rawBody = await readRaw(req, 1_000_000);
        const out = await billing.handleWebhook({
          rawBody, signature: req.headers['stripe-signature'],
        });
        // 200 for anything handled or deliberately ignored, 400 only for a
        // signature that does not verify — a non-2xx tells Stripe to retry, and
        // an endpoint that keeps failing gets disabled, taking real billing down
        // with the noise. The one exception is the lib's own 500, which is
        // returned precisely BECAUSE that case is worth retrying.
        const code = out?.code || 200;
        if (code === 200) { send(res, 200, { received: true, handled: !!out.handled }, nostore); return; }
        // No detail in the body on a 400: a caller who cannot sign a request has
        // no business learning which part of theirs was wrong.
        send(res, code, { error: code === 400 ? 'invalid-signature' : 'retry' }, nostore);
      } catch (err) {
        console.error(`[daily] POST ${pathOf(req)} failed:`, err?.message || err);
        // 500, so Stripe retries. Reading the body failed; the event is not lost.
        send(res, 500, { error: 'webhook-failed' }, nostore);
      }
    },
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // Household — members, invites, seats
  // ═══════════════════════════════════════════════════════════════════════════
  //
  // 'user', not 'member': somebody who has signed up and not yet paid still owns
  // their household and must be able to see and manage it.

  add('/api/daily/household', {
    auth: 'user', methods: ['GET', 'POST'],
    async handler(req, res, _ctx, access) {
      const u = access.user;
      const hid = u.household_id;
      try {
        if ((req.method || 'GET').toUpperCase() === 'GET') {
          const [members, invites] = await Promise.all([
            daily.householdMembers(hid),
            pool().query(
              `SELECT email, created_at, expires_at FROM daily_email_tokens
                WHERE kind='invite' AND household_id=$1 AND used_at IS NULL AND expires_at > now()
                ORDER BY created_at DESC`, [hid]).then((r) => r.rows).catch(() => []),
          ]);
          send(res, 200, {
            household: { id: hid, name: u.household_name, role: u.role },
            members: members.map((m) => ({
              id: m.id,
              email: m.email,
              displayName: m.display_name,
              role: m.role,
              emailVerified: !!m.email_verified_at,
              lastLoginAt: m.last_login_at,
            })),
            invites,
            seats: daily.HOUSEHOLD_SEATS,
            seatsUsed: members.length,
          }, nostore);
          return;
        }

        const body = await readJson(req, 8192);
        const action = str(body?.action, 40);
        const isOwner = String(u.role) === 'owner';

        if (action === 'rename') {
          const name = str(body?.name, 80);
          if (!name) throw bad('Give the household a name.');
          // Scoped by id even though the id came from the session: the habit is
          // the point, and a UPDATE with no WHERE is one edit away.
          const { rows } = await pool().query(
            `UPDATE daily_households SET name=$2 WHERE id=$1 RETURNING id, name`, [hid, name]);
          if (!rows[0]) throw missing('That household');
          send(res, 200, { ok: true, household: { id: rows[0].id, name: rows[0].name, role: u.role } }, nostore);
          return;
        }

        if (action === 'invite') {
          // Owner-only: an invite spends the household's second seat, and a
          // member handing it out could fill the house with someone the person
          // paying never agreed to.
          if (!isOwner) throw Object.assign(new Error('Only the account owner can invite someone.'), { status: 403 });
          const email = daily.normEmail(body?.email);
          const problem = daily.emailProblem(email);
          if (problem) throw bad(problem);

          const members = await daily.householdMembers(hid);
          if (members.length >= daily.HOUSEHOLD_SEATS) {
            throw Object.assign(
              new Error(`A household holds ${daily.HOUSEHOLD_SEATS} people. Remove someone first.`),
              { status: 409 });
          }
          if (members.some((m) => daily.normEmail(m.email) === email)) {
            throw Object.assign(new Error('They’re already in this household.'), { status: 409 });
          }

          // Bound to the HOUSEHOLD, not to a user: the person receiving it does
          // not have an account yet, and the token is the only thing that says
          // which household they are joining.
          const token = await daily.issueEmailToken({ kind: 'invite', householdId: hid, email });
          let sent = false;
          if (mail) {
            const r = await mail.sendInvite({
              to: email, inviterName: u.display_name, householdName: u.household_name, token,
            }).catch(() => ({ ok: false }));
            sent = !!r?.ok;
          }
          send(res, 200, { ok: true, sent, email }, nostore);
          return;
        }

        if (action === 'revokeInvite') {
          const email = body?.email ? daily.normEmail(body.email) : null;
          const { rowCount } = await pool().query(
            `DELETE FROM daily_email_tokens
              WHERE kind='invite' AND household_id=$1 AND used_at IS NULL
                AND ($2::text IS NULL OR email = $2)`, [hid, email]);
          send(res, 200, { ok: true, revoked: rowCount }, nostore);
          return;
        }

        if (action === 'removeMember') {
          if (!isOwner) throw Object.assign(new Error('Only the account owner can remove someone.'), { status: 403 });
          const userId = posInt(body?.userId);
          if (!userId) throw bad('Which member?');
          const result = await daily.removeMember({ householdId: hid, userId });
          if (!result.ok) { send(res, result.code, { error: result.error }, nostore); return; }
          send(res, 200, { ok: true }, nostore);
          return;
        }

        send(res, 400, { error: `Unknown action: ${action}` }, nostore);
      } catch (err) { oops(res, req, err, 'Could not update the household.'); }
    },
  });

  /**
   * Peek at an invite before accepting it.
   *
   * Public, because the recipient has no account yet — that is the entire point
   * of the link. Answers 200 with { ok:false, error } for an expired or unknown
   * token rather than a 404: the join page renders its own state, and a hard
   * error there reads as "the site is broken" when the truth is "this link is a
   * fortnight old". It reveals the household name and the inviter's name because
   * an unexplained invitation to a site you have never heard of is a phishing
   * email, and gets treated like one.
   */
  add('/api/daily/household/invite', {
    auth: 'public', methods: ['GET'],
    async handler(req, res) {
      try {
        const token = params(req).get('token');
        const row = await daily.peekEmailToken(token, 'invite');
        if (!row || !row.household_id) {
          send(res, 200, { ok: false, error: 'That invitation has expired or already been used.' }, nostore);
          return;
        }
        const { rows } = await pool().query(
          `SELECT h.name AS household_name, o.display_name AS inviter_name
             FROM daily_households h
             LEFT JOIN daily_users o ON o.id = h.owner_user_id
            WHERE h.id = $1`, [row.household_id]);
        send(res, 200, {
          ok: true,
          householdName: rows[0]?.household_name ?? null,
          inviterName: rows[0]?.inviter_name ?? null,
          email: row.email ?? null,
        }, nostore);
      } catch (err) { oops(res, req, err, 'Could not read that invitation.'); }
    },
  });

  /**
   * Accept an invite and create the second account in a household.
   *
   * Public: the caller has no session yet. The token is CONSUMED (single-use by
   * construction — see consumeEmailToken) before the account is created, so two
   * tabs racing on one link cannot both add a person, and the email the account
   * is created under comes from the TOKEN rather than the request body. A body
   * that could name its own address would let anyone who saw an invite link join
   * as themselves.
   */
  add('/api/daily/household/join', {
    auth: 'public', methods: ['POST'],
    async handler(req, res) {
      try {
        const body = await readJson(req, 8192);
        const row = await daily.consumeEmailToken(body?.token, 'invite');
        if (!row || !row.household_id) {
          send(res, 400, { error: 'That invitation has expired or already been used.' }, nostore);
          return;
        }
        const result = await daily.joinHousehold({
          householdId: row.household_id,
          email: row.email || body?.email,
          password: body?.password,
          displayName: body?.displayName,
          req,
        });
        if (!result.ok) { send(res, result.code, { error: result.error }, nostore); return; }
        send(res, 200, { ok: true, user: publicUser(result.user) }, authHeaders(result.cookie));
      } catch (err) { oops(res, req, err, 'Could not join that household.'); }
    },
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // APP DATA — everything below is auth:'member'
  // ═══════════════════════════════════════════════════════════════════════════
  //
  // 'member' means signed in AND paying. It matters most on the WRITES: an
  // account whose card finally failed must not be able to keep filing tasks,
  // meals and ledger rows into a household nobody is paying for — that is
  // storage and support cost accruing against a customer we have already lost,
  // and it makes "your subscription lapsed" a lie the moment they save anything.
  // Reads are gated for the same reason from the other side: an unpaid account
  // reading its data forever is the free tier this product does not have.
  //
  // The host has already applied daily.subscriptionProblem(user) for these, so
  // nothing below re-checks entitlement. One decision, one place.

  // ── Tasks ─────────────────────────────────────────────────────────────────

  async function listTasks(user, scope) {
    const { where, params: p } = daily.scoped(user);
    const filter =
      // 'done' is deliberately a WINDOW, not the whole history. A completed task
      // is useful for a few days ("did I actually do that?") and then it is
      // landfill. Nothing is deleted — the row stays and 'done-all' still
      // returns it — it just stops occupying the screen.
      scope === 'done' ? `${where} AND done_at >= NOW() - INTERVAL '${DONE_WINDOW_DAYS} days'`
      : scope === 'done-all' ? `${where} AND done_at IS NOT NULL`
      : scope === 'all' ? where
      : `${where} AND done_at IS NULL`;
    const order = (scope === 'done' || scope === 'done-all') ? 'ORDER BY done_at DESC' : OPEN_ORDER;
    const { rows } = await pool().query(
      `SELECT ${TASK_COLS} FROM daily_tasks WHERE ${filter} ${order} LIMIT 500`, p);
    return rows;
  }

  /**
   * A project id from a request body is checked against the caller's household
   * before it is stored. The foreign key only proves the project EXISTS — it
   * knows nothing about tenancy — so without this a guessed id would link one
   * customer's task to another customer's project and leak its name into every
   * project rollup.
   */
  async function requireProject(user, projectId) {
    const id = posInt(projectId);
    if (id === null) return null;
    const { where, params: p } = daily.scoped(user);
    const { rows } = await pool().query(
      `SELECT id FROM daily_projects WHERE ${where} AND id=$2`, [...p, id]);
    if (!rows[0]) throw missing('That project');
    return rows[0].id;
  }

  add('/api/daily/tasks', {
    auth: 'member', methods: ['GET', 'POST'],
    async handler(req, res, _ctx, access) {
      const user = access.user;
      try {
        if ((req.method || 'GET').toUpperCase() === 'GET') {
          const scope = params(req).get('scope') || 'open';
          send(res, 200, { tasks: await listTasks(user, scope) }, nostore);
          return;
        }

        const body = await readJson(req, 64_000);
        const action = str(body?.action, 40);
        const { where, params: scope } = daily.scoped(user);

        if (action === 'create') {
          const title = str(body?.title, 300);
          if (!title) throw bad('A task needs a title.');
          const projectId = body?.projectId === undefined ? null : await requireProject(user, body.projectId);
          const { rows } = await pool().query(
            `INSERT INTO daily_tasks
               (household_id, created_by, title, notes, due_date, starred, project_id, urgent)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING ${TASK_COLS}`,
            [scope[0], user.id, title, str(body?.notes, 4000) || null,
             dateOrNull(body?.dueDate), !!body?.starred, projectId, !!body?.urgent]);
          send(res, 200, { ok: true, task: rows[0] }, nostore);
          return;
        }

        const id = posInt(body?.id);
        if (id === null) throw bad('Missing task id.');
        const vals = [...scope, id];

        if (action === 'update') {
          // Only the fields actually present are touched, so a partial edit from
          // one screen can't blank a field another screen owns. touched_at moves
          // on every edit — that is what Slipping measures.
          const sets = [];
          const put = (col, v) => { vals.push(v); sets.push(`${col}=$${vals.length}`); };
          if (body?.title !== undefined) {
            const t = str(body.title, 300);
            if (!t) throw bad('A task needs a title.');
            put('title', t);
          }
          if (body?.notes !== undefined) put('notes', str(body.notes, 4000) || null);
          if (body?.dueDate !== undefined) put('due_date', dateOrNull(body.dueDate));
          if (body?.starred !== undefined) put('starred', !!body.starred);
          if (body?.urgent !== undefined) put('urgent', !!body.urgent);
          if (body?.projectId !== undefined) put('project_id', await requireProject(user, body.projectId));
          if (!sets.length) throw bad('Nothing to update.');
          const { rows } = await pool().query(
            `UPDATE daily_tasks SET ${sets.join(', ')}, updated_at=now(), touched_at=now()
              WHERE ${where} AND id=$2 RETURNING ${TASK_COLS}`, vals);
          if (!rows[0]) throw missing('That task');
          send(res, 200, { ok: true, task: rows[0] }, nostore);
          return;
        }

        const flip = {
          toggleDone: 'done_at = CASE WHEN done_at IS NULL THEN now() ELSE NULL END',
          toggleStar: 'starred = NOT starred',
          toggleUrgent: 'urgent = NOT urgent',
        }[action];
        if (flip) {
          const { rows } = await pool().query(
            `UPDATE daily_tasks SET ${flip}, updated_at=now(), touched_at=now()
              WHERE ${where} AND id=$2 RETURNING ${TASK_COLS}`, [scope[0], id]);
          if (!rows[0]) throw missing('That task');
          send(res, 200, { ok: true, task: rows[0] }, nostore);
          return;
        }

        // "I looked at this, stop calling it slipping" — resets the clock without
        // pretending the task changed, so updated_at stays honest.
        if (action === 'touch') {
          const { rows } = await pool().query(
            `UPDATE daily_tasks SET touched_at=now() WHERE ${where} AND id=$2 RETURNING ${TASK_COLS}`,
            [scope[0], id]);
          if (!rows[0]) throw missing('That task');
          send(res, 200, { ok: true, task: rows[0] }, nostore);
          return;
        }

        if (action === 'delete') {
          // budget.cbedge.net restricted deletion to the row's owner, because it
          // had one. Here there is no per-row owner to defer to: the household IS
          // the unit, both people can see and edit everything, and a shared list
          // where only one of you may tidy up is the failure mode this product
          // exists to prevent. created_by still records who added it.
          const { rowCount } = await pool().query(
            `DELETE FROM daily_tasks WHERE ${where} AND id=$2`, [scope[0], id]);
          if (!rowCount) throw missing('That task');
          send(res, 200, { ok: true }, nostore);
          return;
        }

        send(res, 400, { error: `Unknown action: ${action}` }, nostore);
      } catch (err) { oops(res, req, err, 'Could not save that task.'); }
    },
  });

  // ── Notes (the Resurfacing pool) ──────────────────────────────────────────

  add('/api/daily/notes', {
    auth: 'member', methods: ['GET', 'POST'],
    async handler(req, res, _ctx, access) {
      const user = access.user;
      try {
        const { where, params: scope } = daily.scoped(user);

        if ((req.method || 'GET').toUpperCase() === 'GET') {
          const { rows } = await pool().query(
            `SELECT ${NOTE_COLS} FROM daily_notes WHERE ${where}
              ORDER BY created_at DESC LIMIT 500`, scope);
          send(res, 200, { notes: rows }, nostore);
          return;
        }

        const body = await readJson(req, 64_000);
        const action = str(body?.action, 40);

        if (action === 'create') {
          const text = str(body?.body, 4000);
          if (!text) throw bad('Nothing to save.');
          const kind = ['note', 'quote', 'journal'].includes(body?.kind) ? body.kind : 'note';
          const { rows } = await pool().query(
            `INSERT INTO daily_notes (household_id, created_by, kind, body)
             VALUES ($1,$2,$3,$4) RETURNING ${NOTE_COLS}`,
            [scope[0], user.id, kind, text]);
          send(res, 200, { ok: true, note: rows[0] }, nostore);
          return;
        }

        if (action === 'delete') {
          const id = posInt(body?.id);
          if (id === null) throw bad('Missing note id.');
          const { rowCount } = await pool().query(
            `DELETE FROM daily_notes WHERE ${where} AND id=$2`, [scope[0], id]);
          if (!rowCount) throw missing('That note');
          send(res, 200, { ok: true }, nostore);
          return;
        }

        send(res, 400, { error: `Unknown action: ${action}` }, nostore);
      } catch (err) { oops(res, req, err, 'Could not save that note.'); }
    },
  });

  // ── Lists — meals by day, and the grocery list they feed ──────────────────
  //
  // Week / Shop / Lists are three VIEWS over two tables, never three copies.
  // Ticking "tortillas" in the shop marks the SAME row that sits under Tuesday on
  // the week board. Any design where the shopping list is generated as separate
  // rows ends with the two disagreeing about what you actually bought.

  async function getWeek(user, dateStr) {
    const today = todayIn(user.tz);
    const anchor = isDate(dateStr) ? String(dateStr) : today;
    const start = weekStart(anchor);
    const end = addDays(start, 6);
    const { where, params: scope } = daily.scoped(user);

    const [{ rows: meals }, { rows: items }] = await Promise.all([
      pool().query(
        `SELECT ${MEAL_COLS} FROM daily_meals
          WHERE ${where} AND day BETWEEN $2::date AND $3::date
          ORDER BY day, sort_order, id`, [...scope, start, end]),
      pool().query(
        `SELECT ${ITEM_COLS} FROM daily_list_items WHERE ${where} ORDER BY sort_order, id`, scope),
    ]);

    const byMeal = new Map();
    for (const it of items) {
      if (!it.meal_id) continue;
      if (!byMeal.has(it.meal_id)) byMeal.set(it.meal_id, []);
      byMeal.get(it.meal_id).push(it);
    }

    const days = [];
    for (let i = 0; i < 7; i++) {
      const day = addDays(start, i);
      const dayMeals = meals.filter((m) => m.day === day)
        .map((m) => ({ ...m, items: byMeal.get(m.id) || [] }));
      days.push({
        day,
        isToday: day === today,
        meals: dayMeals,
        // Per-day counts so the board can show "2 items" without the client
        // re-deriving it from nested arrays.
        itemCount: dayMeals.reduce((acc, m) => acc + m.items.length, 0),
        openCount: dayMeals.reduce((acc, m) => acc + m.items.filter((x) => !x.checked_at).length, 0),
      });
    }

    const grocery = items.filter((i) => i.list === 'grocery');
    const open = grocery.filter((i) => !i.checked_at);
    const checked = grocery.filter((i) => i.checked_at);

    // Aisle order is store order (see AISLES), and empty aisles are dropped so
    // the shop view is exactly as long as the walk.
    const aisles = AISLES
      .map((aisle) => ({ aisle, items: open.filter((i) => i.aisle === aisle) }))
      .filter((g) => g.items.length > 0);

    // An item can belong to a meal in ANY week — the `meals` query above only
    // covers the seven days on screen. So look up every meal actually referenced
    // and send a flat index. Without this, an ingredient for next Tuesday's
    // dinner shows on the plain list as a bare "from a meal" with no way to find
    // out which one.
    const refIds = [...new Set(items.map((i) => i.meal_id).filter(Boolean))];
    let mealRefs = [];
    if (refIds.length) {
      const { rows } = await pool().query(
        `SELECT id, to_char(day,'YYYY-MM-DD') AS day, title FROM daily_meals
          WHERE ${where} AND id = ANY($2::int[])`, [...scope, refIds]);
      mealRefs = rows;
    }

    return {
      weekStart: start,
      weekEnd: end,
      today,
      days,
      aisles,
      checked,
      other: items.filter((i) => i.list !== 'grocery'),
      mealRefs,
      counts: {
        open: open.length, checked: checked.length, total: grocery.length, meals: meals.length,
      },
      aisleOptions: AISLES,
    };
  }

  async function listsSummary(user) {
    const today = todayIn(user.tz);
    const { where, params: scope } = daily.scoped(user);
    const [{ rows: open }, { rows: meal }] = await Promise.all([
      pool().query(
        `SELECT COUNT(*)::int AS n FROM daily_list_items
          WHERE ${where} AND list='grocery' AND checked_at IS NULL`, scope),
      pool().query(
        `SELECT title FROM daily_meals WHERE ${where} AND day=$2::date
          ORDER BY sort_order, id LIMIT 1`, [...scope, today]),
    ]);
    return { groceryOpen: open[0]?.n ?? 0, tonight: meal[0]?.title ?? null };
  }

  add('/api/daily/lists', {
    auth: 'member', methods: ['GET', 'POST'],
    async handler(req, res, _ctx, access) {
      const user = access.user;
      try {
        const { where, params: scope } = daily.scoped(user);

        if ((req.method || 'GET').toUpperCase() === 'GET') {
          send(res, 200, await getWeek(user, params(req).get('week')), nostore);
          return;
        }

        const body = await readJson(req, 64_000);
        const action = str(body?.action, 40);
        const id = posInt(body?.id);

        if (action === 'addItem') {
          const text = str(body?.text, 200);
          if (!text) throw bad('What are we adding?');
          const list = str(body?.list, 30) || 'grocery';

          // A meal id from the body is checked against this household — not
          // trusted — for the same reason a task's project id is.
          let mealId = null;
          if (body?.mealId) {
            const { rows } = await pool().query(
              `SELECT id FROM daily_meals WHERE ${where} AND id=$2`, [...scope, posInt(body.mealId) ?? -1]);
            if (!rows[0]) throw missing('That meal');
            mealId = rows[0].id;
          }

          // New items land at the bottom of the list, scoped to this household —
          // a global MAX would interleave two customers' orderings.
          const { rows: [max] } = await pool().query(
            `SELECT COALESCE(MAX(sort_order),0) AS m FROM daily_list_items
              WHERE ${where} AND list=$2`, [...scope, list]);
          const { rows } = await pool().query(
            `INSERT INTO daily_list_items
               (household_id, created_by, list, text, qty, aisle, meal_id, sort_order)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING ${ITEM_COLS}`,
            [scope[0], user.id, list, text, str(body?.qty, 40) || null,
             body?.aisle ? normAisle(body.aisle) : guessAisle(text), mealId, Number(max.m) + 10]);
          send(res, 200, { ok: true, item: rows[0] }, nostore);
          return;
        }

        if (action === 'toggleItem') {
          if (id === null) throw bad('Missing item id.');
          // Records WHO. In a shop, "did you already get milk?" is the question
          // this answers.
          const { rows } = await pool().query(
            `UPDATE daily_list_items
                SET checked_at = CASE WHEN checked_at IS NULL THEN now() ELSE NULL END,
                    checked_by = CASE WHEN checked_at IS NULL THEN $3::int ELSE NULL END
              WHERE ${where} AND id=$2 RETURNING ${ITEM_COLS}`, [scope[0], id, user.id]);
          if (!rows[0]) throw missing('That item');
          send(res, 200, { ok: true, item: rows[0] }, nostore);
          return;
        }

        if (action === 'updateItem') {
          if (id === null) throw bad('Missing item id.');
          const vals = [...scope, id];
          const sets = [];
          const put = (col, v) => { vals.push(v); sets.push(`${col}=$${vals.length}`); };
          if (body?.text !== undefined) {
            const t = str(body.text, 200);
            if (!t) throw bad('Give it a name.');
            put('text', t);
          }
          if (body?.qty !== undefined) put('qty', str(body.qty, 40) || null);
          if (body?.aisle !== undefined) put('aisle', normAisle(body.aisle));
          if (!sets.length) throw bad('Nothing to update.');
          const { rows } = await pool().query(
            `UPDATE daily_list_items SET ${sets.join(', ')} WHERE ${where} AND id=$2
             RETURNING ${ITEM_COLS}`, vals);
          if (!rows[0]) throw missing('That item');
          send(res, 200, { ok: true, item: rows[0] }, nostore);
          return;
        }

        if (action === 'deleteItem') {
          if (id === null) throw bad('Missing item id.');
          const { rowCount } = await pool().query(
            `DELETE FROM daily_list_items WHERE ${where} AND id=$2`, [scope[0], id]);
          if (!rowCount) throw missing('That item');
          send(res, 200, { ok: true }, nostore);
          return;
        }

        if (action === 'clearChecked') {
          // DELETES the checked rows rather than un-ticking them: an item you
          // bought is done, and leaving it means next week's list starts with
          // last week's shopping already crossed off. Items still attached to a
          // meal are kept, so the week board doesn't lose Tuesday's ingredients.
          const { rowCount } = await pool().query(
            `DELETE FROM daily_list_items
              WHERE ${where} AND checked_at IS NOT NULL AND meal_id IS NULL`, scope);
          send(res, 200, { ok: true, removed: rowCount }, nostore);
          return;
        }

        if (action === 'addMeal') {
          const day = dateOrNull(body?.day);
          if (!day) throw bad('Pick a day.');
          const title = str(body?.title, 200);
          if (!title) throw bad('What’s for dinner?');
          const { rows: [max] } = await pool().query(
            `SELECT COALESCE(MAX(sort_order),0) AS m FROM daily_meals WHERE ${where} AND day=$2::date`,
            [...scope, day]);
          const { rows } = await pool().query(
            `INSERT INTO daily_meals (household_id, created_by, day, title, notes, sort_order)
             VALUES ($1,$2,$3::date,$4,$5,$6) RETURNING ${MEAL_COLS}`,
            [scope[0], user.id, day, title, str(body?.notes, 2000) || null, Number(max.m) + 10]);
          send(res, 200, { ok: true, meal: { ...rows[0], items: [] } }, nostore);
          return;
        }

        if (action === 'updateMeal') {
          if (id === null) throw bad('Missing meal id.');
          const vals = [...scope, id];
          const sets = [];
          const put = (col, v) => { vals.push(v); sets.push(`${col}=$${vals.length}`); };
          if (body?.title !== undefined) {
            const t = str(body.title, 200);
            if (!t) throw bad('Give it a name.');
            put('title', t);
          }
          if (body?.notes !== undefined) put('notes', str(body.notes, 2000) || null);
          if (body?.day !== undefined) {
            const d = dateOrNull(body.day);
            if (!d) throw bad('Pick a day.');
            put('day', d);
          }
          if (!sets.length) throw bad('Nothing to update.');
          const { rows } = await pool().query(
            `UPDATE daily_meals SET ${sets.join(', ')} WHERE ${where} AND id=$2 RETURNING ${MEAL_COLS}`,
            vals);
          if (!rows[0]) throw missing('That meal');
          send(res, 200, { ok: true, meal: rows[0] }, nostore);
          return;
        }

        if (action === 'deleteMeal') {
          if (id === null) throw bad('Missing meal id.');
          // Deleting "Taco night" keeps the tortillas — the FK is ON DELETE SET
          // NULL. You may still want them.
          const { rowCount } = await pool().query(
            `DELETE FROM daily_meals WHERE ${where} AND id=$2`, [scope[0], id]);
          if (!rowCount) throw missing('That meal');
          send(res, 200, { ok: true }, nostore);
          return;
        }

        send(res, 400, { error: `Unknown action: ${action}` }, nostore);
      } catch (err) { oops(res, req, err, 'Could not save that.'); }
    },
  });

  // ── Routines & habits ─────────────────────────────────────────────────────
  //
  // Deliberately NOT part of /api/daily/tasks. A routine is a recurring intention
  // that never completes; a task is done once and gone. Mixing them leaves your
  // to-do list permanently full of things you do every day, or makes habits
  // vanish the moment you tick them.

  async function getRoutines(user, dateStr) {
    const today = todayIn(user.tz);
    const day = isDate(dateStr) ? String(dateStr) : today;
    const since = addDays(day, -STREAK_LOOKBACK);
    const { where, params: scope } = daily.scoped(user);
    const logScope = daily.scoped(user, 'r.household_id');

    // One query for the routines and one for the log — not one per routine. With
    // twenty habits that would be twenty-one round trips on a phone.
    const [{ rows: routines }, { rows: log }] = await Promise.all([
      pool().query(
        `SELECT id, household_id, created_by, title, block, sort_order, active, created_at
           FROM daily_routines WHERE ${where} AND active = TRUE
          ORDER BY CASE block WHEN 'morning' THEN 0 WHEN 'afternoon' THEN 1 ELSE 2 END,
                   sort_order, id`, scope),
      pool().query(
        `SELECT l.routine_id, to_char(l.day,'YYYY-MM-DD') AS day, l.done_by
           FROM daily_routine_log l JOIN daily_routines r ON r.id = l.routine_id
          WHERE ${logScope.where} AND l.day >= $2::date`, [...logScope.params, since]),
    ]);

    const byRoutine = new Map();
    for (const r of log) {
      if (!byRoutine.has(r.routine_id)) byRoutine.set(r.routine_id, new Set());
      byRoutine.get(r.routine_id).add(r.day);
    }

    // The 30-day window, oldest first, so the chart reads left-to-right.
    const window = [];
    for (let i = HISTORY_DAYS - 1; i >= 0; i--) window.push(addDays(day, -i));

    const items = routines.map((r) => {
      const days = byRoutine.get(r.id) || new Set();
      return {
        id: r.id,
        createdBy: r.created_by,
        title: r.title,
        block: r.block,
        sortOrder: r.sort_order,
        done: days.has(day),
        streak: currentStreak(days, today),
        best: bestStreak(days),
        last30: window.filter((d) => days.has(d)).length,
        history: window.map((d) => ({ day: d, done: days.has(d) })),
      };
    });

    const blocks = BLOCKS.map((b) => {
      const list = items.filter((i) => i.block === b);
      return { block: b, items: list, done: list.filter((i) => i.done).length, total: list.length };
    });

    // Household-wide completion per day, for the summary chart.
    const history = window.map((d) => ({
      day: d,
      done: items.filter((i) => (byRoutine.get(i.id) || new Set()).has(d)).length,
      total: items.length,
    }));

    return {
      date: day,
      today,
      blocks,
      total: items.length,
      doneToday: items.filter((i) => i.done).length,
      history,
    };
  }

  add('/api/daily/routines', {
    auth: 'member', methods: ['GET', 'POST'],
    async handler(req, res, _ctx, access) {
      const user = access.user;
      try {
        const { where, params: scope } = daily.scoped(user);

        if ((req.method || 'GET').toUpperCase() === 'GET') {
          send(res, 200, await getRoutines(user, params(req).get('date')), nostore);
          return;
        }

        const body = await readJson(req, 32_000);
        const action = str(body?.action, 40);

        if (action === 'create') {
          const title = str(body?.title, 200);
          if (!title) throw bad('Give it a name.');
          const block = normBlock(body?.block);
          // New items land at the bottom of their block rather than the top — a
          // routine list is a sequence you work through, not a feed.
          const { rows: [max] } = await pool().query(
            `SELECT COALESCE(MAX(sort_order),0) AS m FROM daily_routines
              WHERE ${where} AND block=$2`, [...scope, block]);
          const { rows } = await pool().query(
            `INSERT INTO daily_routines (household_id, created_by, title, block, sort_order)
             VALUES ($1,$2,$3,$4,$5)
             RETURNING id, household_id, created_by, title, block, sort_order, active`,
            [scope[0], user.id, title, block, Number(max.m) + 10]);
          send(res, 200, { ok: true, routine: rows[0] }, nostore);
          return;
        }

        const id = posInt(body?.id);
        if (id === null) throw bad('Missing id.');

        if (action === 'toggle') {
          const day = dateOrNull(body?.date) || todayIn(user.tz);
          // Ownership is checked here rather than trusted from the client: the
          // log table has no household_id of its own, so this scoped lookup is
          // the ONLY thing standing between a guessed id and another customer's
          // habit being ticked.
          const { rows: [routine] } = await pool().query(
            `SELECT id FROM daily_routines WHERE ${where} AND id=$2`, [scope[0], id]);
          if (!routine) throw missing('That routine');

          const { rowCount } = await pool().query(
            `DELETE FROM daily_routine_log WHERE routine_id=$1 AND day=$2::date`, [id, day]);
          if (rowCount) { send(res, 200, { ok: true, done: false, day }, nostore); return; }

          // Idempotent by PRIMARY KEY (routine_id, day) — a double tap on a slow
          // connection cannot log the same day twice.
          await pool().query(
            `INSERT INTO daily_routine_log (routine_id, day, done_by) VALUES ($1,$2::date,$3)
             ON CONFLICT (routine_id, day) DO NOTHING`, [id, day, user.id]);
          send(res, 200, { ok: true, done: true, day }, nostore);
          return;
        }

        if (action === 'update') {
          const vals = [...scope, id];
          const sets = [];
          const put = (col, v) => { vals.push(v); sets.push(`${col}=$${vals.length}`); };
          if (body?.title !== undefined) {
            const t = str(body.title, 200);
            if (!t) throw bad('Give it a name.');
            put('title', t);
          }
          if (body?.block !== undefined) put('block', normBlock(body.block));
          if (body?.sortOrder !== undefined) put('sort_order', Number(body.sortOrder) || 0);
          if (!sets.length) throw bad('Nothing to update.');
          const { rows } = await pool().query(
            `UPDATE daily_routines SET ${sets.join(', ')} WHERE ${where} AND id=$2
             RETURNING id, household_id, created_by, title, block, sort_order, active`, vals);
          if (!rows[0]) throw missing('That routine');
          send(res, 200, { ok: true, routine: rows[0] }, nostore);
          return;
        }

        if (action === 'archive') {
          // Archive rather than delete. The log rows cascade away with the
          // routine, and losing a 90-day streak because you tidied your list is
          // the kind of thing that makes people stop using an app.
          const { rowCount } = await pool().query(
            `UPDATE daily_routines SET active = FALSE WHERE ${where} AND id=$2`, [scope[0], id]);
          if (!rowCount) throw missing('That routine');
          send(res, 200, { ok: true }, nostore);
          return;
        }

        if (action === 'delete') {
          const { rowCount } = await pool().query(
            `DELETE FROM daily_routines WHERE ${where} AND id=$2`, [scope[0], id]);
          if (!rowCount) throw missing('That routine');
          send(res, 200, { ok: true }, nostore);
          return;
        }

        send(res, 400, { error: `Unknown action: ${action}` }, nostore);
      } catch (err) { oops(res, req, err, 'Could not save that routine.'); }
    },
  });

  // ── Projects, milestones, time ────────────────────────────────────────────
  //
  // PROGRESS COMES FROM MILESTONES, NEVER FROM TASK COUNTS. A project with 40
  // small tasks and 3 real milestones shows 80% complete once you have cleared
  // the easy tasks — precisely the lie a progress bar exists to prevent. A
  // project with no milestones reports null progress rather than 0% or 100%: "I
  // don't know yet" is honest, either number is a guess dressed as a fact.
  //
  // Milestones and time entries carry no household_id of their own. Their tenancy
  // is the PROJECT's, resolved by a scoped lookup on every call — never by
  // trusting an id from the client.

  /**
   * daily_projects has no archived_at column (see the schema in _lib-daily.cjs);
   * `status` carries that meaning instead. So "archive" sets status='done' and
   * un-archiving sets it back to 'active', and ?archived=1 is what includes the
   * done ones. One column, no second flag to fall out of step with it.
   */
  const shapeProject = (p) => ({
    id: p.id,
    createdBy: p.created_by,
    // The column is `title`/`summary`; the SPA's Project type says
    // name/description. Mapped here, once, rather than renaming a column the
    // schema module owns.
    name: p.title,
    description: p.summary,
    status: p.status,
    target_date: p.target_date,
    sortOrder: p.sort_order,
    created_at: p.created_at,
    updated_at: p.updated_at,
  });

  async function requireOwnedProject(user, projectId) {
    const id = posInt(projectId);
    if (id === null) throw bad('Missing project id.');
    const { where, params: scope } = daily.scoped(user);
    const { rows } = await pool().query(
      `SELECT ${PROJECT_COLS} FROM daily_projects WHERE ${where} AND id=$2`, [...scope, id]);
    if (!rows[0]) throw missing('That project');
    return rows[0];
  }

  /** A milestone the caller may touch, resolved through its project. */
  async function requireOwnedMilestone(user, milestoneId) {
    const id = posInt(milestoneId);
    if (id === null) throw bad('Missing milestone id.');
    const scope = daily.scoped(user, 'p.household_id');
    const { rows } = await pool().query(
      `SELECT m.id, m.project_id FROM daily_milestones m
         JOIN daily_projects p ON p.id = m.project_id
        WHERE ${scope.where} AND m.id=$2`, [...scope.params, id]);
    if (!rows[0]) throw missing('That milestone');
    return rows[0];
  }

  async function listProjects(user, { includeDone = false } = {}) {
    const { where, params: scope } = daily.scoped(user);
    const msScope = daily.scoped(user, 'p.household_id');
    const filter = includeDone ? where : `${where} AND status <> 'done'`;

    // Three aggregate queries, not three per project. With a dozen projects the
    // per-project version is 37 round trips on a phone.
    const [{ rows: projects }, { rows: ms }, { rows: tks }, { rows: time }] = await Promise.all([
      pool().query(
        `SELECT ${PROJECT_COLS} FROM daily_projects WHERE ${filter}
          ORDER BY CASE status WHEN 'active' THEN 0 WHEN 'someday' THEN 1 ELSE 2 END,
                   target_date ASC NULLS LAST, sort_order, id DESC`, scope),
      pool().query(
        `SELECT m.project_id, COUNT(*)::int AS total, COUNT(m.done_at)::int AS done
           FROM daily_milestones m JOIN daily_projects p ON p.id = m.project_id
          WHERE ${msScope.where} GROUP BY m.project_id`, msScope.params),
      pool().query(
        `SELECT t.project_id, COUNT(*)::int AS total,
                COUNT(*) FILTER (WHERE t.done_at IS NULL)::int AS open
           FROM daily_tasks t
          WHERE t.household_id = $1 AND t.project_id IS NOT NULL
          GROUP BY t.project_id`, scope),
      pool().query(
        `SELECT l.project_id, SUM(l.minutes)::int AS minutes
           FROM daily_time_log l JOIN daily_projects p ON p.id = l.project_id
          WHERE ${msScope.where} GROUP BY l.project_id`, msScope.params),
    ]);

    const msBy = new Map(ms.map((r) => [r.project_id, r]));
    const tBy = new Map(tks.map((r) => [r.project_id, r]));
    const timeBy = new Map(time.map((r) => [r.project_id, r]));

    return projects.map((p) => {
      const m = msBy.get(p.id) || { total: 0, done: 0 };
      const t = tBy.get(p.id) || { total: 0, open: 0 };
      return {
        ...shapeProject(p),
        milestones: { total: m.total, done: m.done },
        tasks: { total: t.total, open: t.open },
        minutes: timeBy.get(p.id)?.minutes || 0,
        progress: m.total > 0 ? Math.round((m.done / m.total) * 100) : null,
      };
    });
  }

  async function getProject(user, projectId) {
    const project = await requireOwnedProject(user, projectId);
    const id = project.id;
    const { where } = daily.scoped(user);

    const [{ rows: milestones }, { rows: tasks }, { rows: time }, { rows: totals }] = await Promise.all([
      pool().query(
        `SELECT id, title, sort_order, done_at FROM daily_milestones
          WHERE project_id=$1 ORDER BY sort_order, id`, [id]),
      pool().query(
        `SELECT ${TASK_COLS} FROM daily_tasks WHERE ${where} AND project_id=$2
          ORDER BY done_at NULLS FIRST, due_date ASC NULLS LAST, id`, [user.household_id, id]),
      pool().query(
        `SELECT id, to_char(day,'YYYY-MM-DD') AS day, minutes, note, user_id
           FROM daily_time_log WHERE project_id=$1 ORDER BY day DESC, id DESC LIMIT 50`, [id]),
      pool().query(
        `SELECT COALESCE(SUM(minutes),0)::int AS total,
                COALESCE(SUM(minutes) FILTER (WHERE day >= (CURRENT_DATE - 7)),0)::int AS week
           FROM daily_time_log WHERE project_id=$1`, [id]),
    ]);

    const done = milestones.filter((m) => m.done_at).length;
    return {
      ...shapeProject(project),
      milestones,
      tasks,
      timeEntries: time,
      minutes: totals[0]?.total || 0,
      minutesThisWeek: totals[0]?.week || 0,
      progress: milestones.length ? Math.round((done / milestones.length) * 100) : null,
    };
  }

  add('/api/daily/projects', {
    auth: 'member', methods: ['GET', 'POST'],
    async handler(req, res, _ctx, access) {
      const user = access.user;
      try {
        const { where, params: scope } = daily.scoped(user);

        if ((req.method || 'GET').toUpperCase() === 'GET') {
          const q = params(req);
          const id = posInt(q.get('id'));
          if (id !== null) { send(res, 200, { project: await getProject(user, id) }, nostore); return; }
          send(res, 200, {
            projects: await listProjects(user, { includeDone: q.get('archived') === '1' }),
          }, nostore);
          return;
        }

        const body = await readJson(req, 64_000);
        const action = str(body?.action, 40);

        if (action === 'create') {
          const title = str(body?.name ?? body?.title, 200);
          if (!title) throw bad('Give the project a name.');
          const { rows } = await pool().query(
            `INSERT INTO daily_projects (household_id, created_by, title, summary, status, target_date)
             VALUES ($1,$2,$3,$4,$5,$6) RETURNING ${PROJECT_COLS}`,
            [scope[0], user.id, title,
             str(body?.description ?? body?.summary, 4000) || null,
             normStatus(body?.status), dateOrNull(body?.targetDate)]);
          send(res, 200, { ok: true, project: shapeProject(rows[0]) }, nostore);
          return;
        }

        if (action === 'update') {
          const existing = await requireOwnedProject(user, body?.id);
          const vals = [...scope, existing.id];
          const sets = [];
          const put = (col, v) => { vals.push(v); sets.push(`${col}=$${vals.length}`); };
          if (body?.name !== undefined || body?.title !== undefined) {
            const t = str(body?.name ?? body?.title, 200);
            if (!t) throw bad('Give the project a name.');
            put('title', t);
          }
          if (body?.description !== undefined || body?.summary !== undefined) {
            put('summary', str(body?.description ?? body?.summary, 4000) || null);
          }
          if (body?.status !== undefined) put('status', normStatus(body.status));
          if (body?.targetDate !== undefined) put('target_date', dateOrNull(body.targetDate));
          if (body?.sortOrder !== undefined) put('sort_order', Number(body.sortOrder) || 0);
          if (!sets.length) throw bad('Nothing to update.');
          const { rows } = await pool().query(
            `UPDATE daily_projects SET ${sets.join(', ')}, updated_at=now()
              WHERE ${where} AND id=$2 RETURNING ${PROJECT_COLS}`, vals);
          if (!rows[0]) throw missing('That project');
          send(res, 200, { ok: true, project: shapeProject(rows[0]) }, nostore);
          return;
        }

        if (action === 'archive') {
          const existing = await requireOwnedProject(user, body?.id);
          const status = body?.archived === false ? 'active' : 'done';
          const { rows } = await pool().query(
            `UPDATE daily_projects SET status=$3, updated_at=now()
              WHERE ${where} AND id=$2 RETURNING ${PROJECT_COLS}`, [scope[0], existing.id, status]);
          send(res, 200, { ok: true, project: shapeProject(rows[0]) }, nostore);
          return;
        }

        if (action === 'delete') {
          const existing = await requireOwnedProject(user, body?.id);
          // Milestones and time entries cascade with it; tasks do not, their
          // project_id is ON DELETE SET NULL. Deleting a project must not delete
          // work somebody still has to do.
          await pool().query(`DELETE FROM daily_projects WHERE ${where} AND id=$2`,
                             [scope[0], existing.id]);
          send(res, 200, { ok: true }, nostore);
          return;
        }

        if (action === 'addMilestone') {
          const project = await requireOwnedProject(user, body?.id);
          const title = str(body?.title, 200);
          if (!title) throw bad('Give the milestone a name.');
          const { rows: [max] } = await pool().query(
            `SELECT COALESCE(MAX(sort_order),0) AS m FROM daily_milestones WHERE project_id=$1`,
            [project.id]);
          const { rows } = await pool().query(
            `INSERT INTO daily_milestones (project_id, title, sort_order) VALUES ($1,$2,$3)
             RETURNING id, title, sort_order, done_at`,
            [project.id, title, Number(max.m) + 10]);
          send(res, 200, { ok: true, milestone: rows[0] }, nostore);
          return;
        }

        if (action === 'toggleMilestone') {
          const m = await requireOwnedMilestone(user, body?.milestoneId);
          const { rows } = await pool().query(
            `UPDATE daily_milestones
                SET done_at = CASE WHEN done_at IS NULL THEN now() ELSE NULL END
              WHERE id=$1 RETURNING id, title, sort_order, done_at`, [m.id]);
          send(res, 200, { ok: true, milestone: rows[0] }, nostore);
          return;
        }

        if (action === 'updateMilestone') {
          const m = await requireOwnedMilestone(user, body?.milestoneId);
          const title = str(body?.title, 200);
          if (!title) throw bad('Give the milestone a name.');
          const { rows } = await pool().query(
            `UPDATE daily_milestones SET title=$2 WHERE id=$1
             RETURNING id, title, sort_order, done_at`, [m.id, title]);
          send(res, 200, { ok: true, milestone: rows[0] }, nostore);
          return;
        }

        if (action === 'deleteMilestone') {
          const m = await requireOwnedMilestone(user, body?.milestoneId);
          await pool().query(`DELETE FROM daily_milestones WHERE id=$1`, [m.id]);
          send(res, 200, { ok: true }, nostore);
          return;
        }

        if (action === 'logTime') {
          const project = await requireOwnedProject(user, body?.id);
          const mins = Math.round(Number(body?.minutes));
          if (!Number.isFinite(mins) || mins === 0) throw bad('How long did you work?');
          // Capped at 24h per entry: anything larger is a typo (an extra zero on
          // "90"), and one bad row silently ruins every total that reads from it.
          if (Math.abs(mins) > 24 * 60) throw bad('That’s more than a day — check the number.');
          const day = dateOrNull(body?.day) || todayIn(user.tz);
          const { rows } = await pool().query(
            `INSERT INTO daily_time_log (project_id, user_id, day, minutes, note)
             VALUES ($1,$2,$3::date,$4,$5)
             RETURNING id, to_char(day,'YYYY-MM-DD') AS day, minutes, note, user_id`,
            [project.id, user.id, day, mins, str(body?.note, 500) || null]);
          send(res, 200, { ok: true, entry: rows[0] }, nostore);
          return;
        }

        if (action === 'deleteTime') {
          const entryId = posInt(body?.entryId);
          if (entryId === null) throw bad('Missing entry id.');
          // Scoped through the project, then narrowed to the person who logged
          // it: somebody else's hours are not yours to delete, even inside your
          // own household.
          const tScope = daily.scoped(user, 'p.household_id');
          const { rows } = await pool().query(
            `SELECT l.id, l.user_id FROM daily_time_log l
               JOIN daily_projects p ON p.id = l.project_id
              WHERE ${tScope.where} AND l.id=$2`, [...tScope.params, entryId]);
          if (!rows[0]) throw missing('That time entry');
          if (rows[0].user_id !== user.id) {
            throw Object.assign(new Error('Only the person who logged it can remove it.'), { status: 403 });
          }
          await pool().query(`DELETE FROM daily_time_log WHERE id=$1`, [rows[0].id]);
          send(res, 200, { ok: true }, nostore);
          return;
        }

        send(res, 400, { error: `Unknown action: ${action}` }, nostore);
      } catch (err) { oops(res, req, err, 'Could not save that project.'); }
    },
  });

  // ── Settings ──────────────────────────────────────────────────────────────
  //
  // Per USER, not per household: two people in one house share a postcode, but a
  // member who travels shouldn't have to change the other's weather tile to see
  // their own. putSettings ignores keys it does not know rather than storing
  // junk, so an unknown field is a silent no-op by design.

  add('/api/daily/settings', {
    auth: 'member', methods: ['GET', 'POST'],
    async handler(req, res, _ctx, access) {
      try {
        if ((req.method || 'GET').toUpperCase() === 'GET') {
          send(res, 200, { settings: await daily.getSettings(access.user.id) }, nostore);
          return;
        }
        const body = await readJson(req, 8192);
        if (body?.weatherZip !== undefined) {
          const z = str(body.weatherZip, 5);
          // Empty clears it — that is how you turn the weather tile off, so it
          // must not be rejected as invalid.
          if (z !== '' && !/^\d{5}$/.test(z)) throw bad('ZIP must be five digits.');
          body.weatherZip = z;
        }
        send(res, 200, { ok: true, settings: await daily.putSettings(access.user.id, body) }, nostore);
      } catch (err) { oops(res, req, err, 'Could not save those settings.'); }
    },
  });

  // ── Weather ───────────────────────────────────────────────────────────────
  //
  // Ported from budget.cbedge.net's /api/hh/weather, upstreams and all. Both
  // providers are keyless, which is why this is thirty lines rather than a
  // service.

  const WMO = {
    0: 'Clear', 1: 'Mainly Clear', 2: 'Partly Cloudy', 3: 'Overcast',
    45: 'Fog', 48: 'Rime Fog', 51: 'Light Drizzle', 53: 'Drizzle', 55: 'Heavy Drizzle',
    61: 'Light Rain', 63: 'Rain', 65: 'Heavy Rain', 66: 'Freezing Rain', 67: 'Freezing Rain',
    71: 'Light Snow', 73: 'Snow', 75: 'Heavy Snow', 77: 'Snow Grains',
    80: 'Rain Showers', 81: 'Rain Showers', 82: 'Violent Showers',
    85: 'Snow Showers', 86: 'Snow Showers', 95: 'Thunderstorm', 96: 'Thunderstorm', 99: 'Thunderstorm',
  };

  /**
   * ZIP → { at, payload }. The weather does not change in ten minutes, and Today
   * mounts this on every navigation back to the home tab — without a cache a
   * phone left open all day is a few hundred calls to somebody else's free API,
   * and here that is multiplied by every paying household. Keyed by ZIP rather
   * than by user precisely so two customers in the same town share one call.
   * Process-local, so a restart just re-warms it.
   */
  const wxCache = new Map();
  const WX_TTL_MS = 10 * 60 * 1000;

  add('/api/daily/weather', {
    auth: 'member', methods: ['GET'],
    async handler(req, res) {
      const zip = str(params(req).get('zip'), 5);
      if (!/^\d{5}$/.test(zip)) {
        send(res, 400, { error: 'Valid 5-digit US ZIP required' }, nostore);
        return;
      }

      const hit = wxCache.get(zip);
      if (hit && Date.now() - hit.at < WX_TTL_MS) { send(res, 200, hit.payload, nostore); return; }

      try {
        // Primary geocoder: zippopotam. Nominatim is the fallback.
        let loc = null;
        try {
          const geoRes = await fetch(`https://api.zippopotam.us/us/${zip}`, { cache: 'no-store' });
          if (geoRes.ok) {
            const geo = await geoRes.json();
            const p = geo?.places?.[0];
            if (p) {
              loc = {
                latitude: p.latitude, longitude: p.longitude,
                name: p['place name'], admin1: p['state abbreviation'],
              };
            }
          }
        } catch { /* fall through to Nominatim */ }

        if (!loc) {
          const nomRes = await fetch(
            `https://nominatim.openstreetmap.org/search?postalcode=${zip}&country=US&format=json&addressdetails=1&limit=1`,
            { cache: 'no-store', headers: { 'User-Agent': 'cbedge-daily/1.0' } });
          if (nomRes.ok) {
            const arr = await nomRes.json();
            const nm = Array.isArray(arr) ? arr[0] : null;
            if (nm) {
              loc = {
                latitude: nm.lat, longitude: nm.lon,
                name: nm.address?.town || nm.address?.city || nm.address?.village
                      || nm.display_name?.split(',')[0] || zip,
                admin1: nm.address?.['ISO3166-2-lvl4']?.split('-')[1] || '',
              };
            }
          }
        }

        if (!loc) { send(res, 404, { error: 'ZIP not found' }, nostore); return; }

        const wRes = await fetch(
          `https://api.open-meteo.com/v1/forecast?latitude=${loc.latitude}&longitude=${loc.longitude}`
          + '&current=temperature_2m,weather_code&temperature_unit=fahrenheit&timezone=auto',
          { cache: 'no-store' });
        const w = await wRes.json();
        const cur = w?.current;
        if (!cur) { send(res, 502, { error: 'Weather unavailable' }, nostore); return; }

        const payload = {
          tempF: Math.round(cur.temperature_2m),
          condition: WMO[cur.weather_code] ?? '—',
          code: cur.weather_code,
          place: `${loc.name}${loc.admin1 ? `, ${loc.admin1}` : ''}`,
        };
        wxCache.set(zip, { at: Date.now(), payload });
        send(res, 200, payload, nostore);
      } catch (err) {
        // No `detail` on the way out: this reaches a browser, and the message on
        // a failed fetch is written for us.
        console.error(`[daily] GET ${pathOf(req)} failed:`, err?.message || err);
        send(res, 502, { error: 'Weather is unavailable right now.' }, nostore);
      }
    },
  });

  // ── Calendar ──────────────────────────────────────────────────────────────
  //
  // EVERY READ ANSWERS 200, with an `error` string inside the body. A calendar
  // hiccup — Google slow, a grant revoked, no connection yet — is a line inside
  // the card, not a red screen for the whole app: the card renders its own state
  // from `error`, and a non-200 would make the SPA's generic failure handler eat
  // a condition nobody needs to act on. The WRITE route below is the exception,
  // because a create that silently 200s is an event the customer thinks they
  // saved.

  const calendarOff = (reason) => ({ error: reason, events: [], calendars: [] });

  add('/api/daily/calendar/status', {
    auth: 'member', methods: ['GET'],
    async handler(req, res, _ctx, access) {
      if (!google) { send(res, 200, { configured: false, connected: false, error: 'not-configured' }, nostore); return; }
      try {
        send(res, 200, { configured: google.configured(), ...(await google.statusFor(access.user)) }, nostore);
      } catch (err) {
        console.error(`[daily] GET ${pathOf(req)} failed:`, err?.message || err);
        send(res, 200, { configured: false, connected: false, error: 'unavailable' }, nostore);
      }
    },
  });

  /**
   * Fetched by the client SEPARATELY from /api/daily/today, on purpose. A call
   * out to Google can take half a second; folding it into Today would hold the
   * entire screen hostage to a third party. Today paints from our own database
   * immediately and the calendar card fills in when it fills in.
   */
  add('/api/daily/calendar/events', {
    auth: 'member', methods: ['GET'],
    async handler(req, res, _ctx, access) {
      const user = access.user;
      const q = params(req);
      const date = dateOrNull(q.get('date')) || todayIn(user.tz);
      const from = dateOrNull(q.get('from')) || date;
      const to = dateOrNull(q.get('to')) || date;
      if (!google) { send(res, 200, { date, ...calendarOff('not-configured') }, nostore); return; }
      try {
        // The HOUSEHOLD's merged view: your own connection always, plus anyone
        // who turned sharing on. That is what makes one person linking the family
        // calendar enough for both.
        const out = await google.eventsForHousehold(user, { from, to });
        send(res, 200, { date, from, to, ...out }, nostore);
      } catch (err) {
        console.error(`[daily] GET ${pathOf(req)} failed:`, err?.message || err);
        send(res, 200, { date, ...calendarOff('google-unavailable') }, nostore);
      }
    },
  });

  // Every calendar the connected account can see. A shared family calendar is a
  // SEPARATE calendar in this list, not part of `primary` — which is why reading
  // only primary would never show one of its events.
  add('/api/daily/calendar/calendars', {
    auth: 'member', methods: ['GET'],
    async handler(req, res, _ctx, access) {
      if (!google) { send(res, 200, calendarOff('not-configured'), nostore); return; }
      try { send(res, 200, await google.listCalendars(access.user), nostore); }
      catch (err) {
        console.error(`[daily] GET ${pathOf(req)} failed:`, err?.message || err);
        send(res, 200, calendarOff('google-unavailable'), nostore);
      }
    },
  });

  // Which calendars feed the Today screen, and whether the household sees them.
  add('/api/daily/calendar/select', {
    auth: 'member', methods: ['POST'],
    async handler(req, res, _ctx, access) {
      try {
        if (unavailable(res, google, 'Google isn’t set up on this deployment.')) return;
        const body = await readJson(req, 32_000);
        const ids = Array.isArray(body?.calendarIds) ? body.calendarIds : undefined;
        const share = typeof body?.shareWithHousehold === 'boolean' ? body.shareWithHousehold : undefined;
        if (ids === undefined && share === undefined) throw bad('Nothing to update.');

        if (ids !== undefined) {
          const r = await google.selectCalendars(access.user, ids);
          if (!r.ok) { send(res, 409, { error: r.error }, nostore); return; }
        }
        if (share !== undefined) {
          const r = await google.setSharing(access.user, share);
          if (!r.ok) { send(res, 409, { error: r.error }, nostore); return; }
        }
        // Answer with the whole list, so the client never has to reconcile a
        // patch against what it already had.
        send(res, 200, await google.listCalendars(access.user), nostore);
      } catch (err) { oops(res, req, err, 'Could not update your calendars.'); }
    },
  });

  add('/api/daily/calendar/disconnect', {
    auth: 'member', methods: ['POST'],
    async handler(req, res, _ctx, access) {
      try {
        if (unavailable(res, google, 'Google isn’t set up on this deployment.')) return;
        // `revoked:false` means the grant is still listed at Google even though
        // our copy of the token is gone — worth reporting so Settings can suggest
        // a tidy-up at myaccount.google.com/permissions.
        send(res, 200, await google.disconnect(access.user), nostore);
      } catch (err) { oops(res, req, err, 'Could not disconnect Google.'); }
    },
  });

  /**
   * Create or delete a calendar event — the write half of the Google scope, and
   * the reason this app asks for calendar.events rather than calendar.readonly.
   *
   * Unlike the reads above this reports failures as real HTTP errors: "add it to
   * my calendar" that answers 200 and saves nothing is the worst outcome here,
   * because the customer stops thinking about the thing they just captured.
   * calendarId is always required — the lib refuses to default to `primary`, so
   * an event can never quietly land on a personal calendar someone wasn't
   * looking at.
   */
  const EVENT_ERRORS = {
    'not-configured': [503, 'Google isn’t set up on this deployment.'],
    'not-connected': [409, 'Connect a Google account first.'],
    'no-write-scope': [409, 'Reconnect Google and allow calendar access to add events.'],
    revoked: [409, 'Google access has expired. Reconnect from Settings.'],
    'unknown-calendar': [404, 'That isn’t one of your calendars.'],
    'read-only-calendar': [403, 'You can only read that calendar, not add to it.'],
    'calendar-required': [400, 'Pick a calendar.'],
    'title-required': [400, 'Give the event a title.'],
    'start-required': [400, 'When is it?'],
    'bad-start': [400, 'That start time isn’t a date.'],
    'event-required': [400, 'Which event?'],
  };

  add('/api/daily/calendar/event', {
    auth: 'member', methods: ['POST'],
    async handler(req, res, _ctx, access) {
      try {
        if (unavailable(res, google, 'Google isn’t set up on this deployment.')) return;
        const body = await readJson(req, 16_000);
        const action = str(body?.action, 40);

        let out;
        if (action === 'create') {
          out = await google.createEvent(access.user, {
            calendarId: body?.calendarId,
            title: body?.title,
            start: body?.start,
            end: body?.end,
            allDay: !!body?.allDay,
            description: body?.description,
            location: body?.location,
          });
        } else if (action === 'delete') {
          out = await google.deleteEvent(access.user, {
            calendarId: body?.calendarId, eventId: body?.eventId,
          });
        } else {
          send(res, 400, { error: `Unknown action: ${action}` }, nostore);
          return;
        }

        if (out?.error) {
          const [code, message] = EVENT_ERRORS[out.error] || [502, 'Google couldn’t save that event.'];
          send(res, code, { error: out.error, message }, nostore);
          return;
        }
        send(res, 200, { ok: true, ...out }, nostore);
      } catch (err) { oops(res, req, err, 'Could not update your calendar.'); }
    },
  });

  // ── Markets ───────────────────────────────────────────────────────────────
  //
  // The economic and earnings calendars, straight from the lib. Both halves carry
  // their own note/warning and neither can fail the other — see the header of
  // _lib-daily-markets.cjs for why a stale calendar clearly labelled beats a
  // blank one that looks like a quiet week.

  add('/api/daily/markets/week', {
    auth: 'member', methods: ['GET'],
    async handler(req, res) {
      try {
        if (!markets) { send(res, 503, { error: 'The markets feeds aren’t available on this deployment.' }, nostore); return; }
        send(res, 200, await markets.weekAhead(), nostore);
      } catch (err) { oops(res, req, err, 'Could not load the market calendars.'); }
    },
  });

  // ── Budget ────────────────────────────────────────────────────────────────
  //
  // Every route delegates to _lib-daily-budget.cjs, which scopes each query with
  // scoped() and raises deliberate, readable errors ("Pick a date.", "Give it a
  // name.") carrying a 400 or a 404. oops() passes those through verbatim so the
  // phone can show them, and swallows everything else.
  //
  // Note there is no per-bank anything here: accounts are ROWS a customer
  // creates, so a household with one checking account sees one column and a
  // household with five sees five.

  const budgetGone = (res) => {
    if (budgetLib && budgetLib.available()) return false;
    send(res, 503, { error: 'The budget isn’t available on this deployment.' }, nostore);
    return true;
  };

  add('/api/daily/budget', {
    auth: 'member', methods: ['GET', 'POST'],
    async handler(req, res, _ctx, access) {
      try {
        if (budgetGone(res)) return;
        const user = access.user;

        if ((req.method || 'GET').toUpperCase() === 'GET') {
          send(res, 200, await budgetLib.getMonth(user, params(req).get('month')), nostore);
          return;
        }

        const body = await readJson(req, 64_000);
        const action = str(body?.action, 40);

        if (action === 'addRow') {
          send(res, 200, { ok: true, row: await budgetLib.addRow(user, {
            accountId: body?.accountId, date: body?.date, label: body?.label,
            amount: body?.amount, kind: body?.kind, categoryId: body?.categoryId,
          }) }, nostore);
          return;
        }
        if (action === 'updateRow') {
          send(res, 200, { ok: true, row: await budgetLib.updateRow(user, body?.id, {
            date: body?.date, label: body?.label, amount: body?.amount, kind: body?.kind,
            accountId: body?.accountId, categoryId: body?.categoryId,
          }) }, nostore);
          return;
        }
        if (action === 'deleteRow') {
          send(res, 200, await budgetLib.deleteRow(user, body?.id), nostore);
          return;
        }
        if (action === 'setRowCategory') {
          send(res, 200, { ok: true, row: await budgetLib.setRowCategory(user, body?.id, body?.categoryId) }, nostore);
          return;
        }
        if (action === 'markBillPaid') {
          // Idempotent in the database, by the unique index on
          // (household_id, recurring_tag) — two taps on a slow connection get
          // `already:true`, never a bill paid twice.
          send(res, 200, { ok: true, ...(await budgetLib.markBillPaid(user, {
            ruleId: body?.ruleId, date: body?.date, amount: body?.amount,
            label: body?.label, accountId: body?.accountId, categoryId: body?.categoryId,
          })) }, nostore);
          return;
        }
        if (action === 'setBalance') {
          send(res, 200, { ok: true, balance: await budgetLib.setBalance(user, {
            accountId: body?.accountId, day: body?.day, balance: body?.balance,
          }) }, nostore);
          return;
        }

        send(res, 400, { error: `Unknown action: ${action}` }, nostore);
      } catch (err) { oops(res, req, err, 'Could not save that entry.'); }
    },
  });

  add('/api/daily/budget/accounts', {
    auth: 'member', methods: ['GET', 'POST'],
    async handler(req, res, _ctx, access) {
      try {
        if (budgetGone(res)) return;
        const user = access.user;

        if ((req.method || 'GET').toUpperCase() === 'GET') {
          // Archived accounts are included by default: the month view has to be
          // able to name an account a January row points at even though it was
          // closed in March. Pass ?open=1 for the pickers.
          const includeArchived = params(req).get('open') !== '1';
          send(res, 200, { accounts: await budgetLib.listAccounts(user, { includeArchived }) }, nostore);
          return;
        }

        const body = await readJson(req, 16_000);
        const action = str(body?.action, 40);

        if (action === 'create') {
          send(res, 200, { ok: true, account: await budgetLib.createAccount(user, {
            name: body?.name, kind: body?.kind,
          }) }, nostore);
          return;
        }
        if (action === 'update') {
          send(res, 200, { ok: true, account: await budgetLib.updateAccount(user, body?.id, {
            name: body?.name, kind: body?.kind, sortOrder: body?.sortOrder, archived: body?.archived,
          }) }, nostore);
          return;
        }
        if (action === 'archive') {
          // There is no delete. Ledger rows point at this id, and a closed bank
          // account does not un-happen last year's rent.
          send(res, 200, { ok: true, account: await budgetLib.archiveAccount(user, body?.id) }, nostore);
          return;
        }

        send(res, 400, { error: `Unknown action: ${action}` }, nostore);
      } catch (err) { oops(res, req, err, 'Could not save that account.'); }
    },
  });

  add('/api/daily/budget/rules', {
    auth: 'member', methods: ['GET', 'POST'],
    async handler(req, res, _ctx, access) {
      try {
        if (budgetGone(res)) return;
        const user = access.user;

        if ((req.method || 'GET').toUpperCase() === 'GET') {
          send(res, 200, { rules: await budgetLib.listRules(user) }, nostore);
          return;
        }

        const body = await readJson(req, 16_000);
        const action = str(body?.action, 40);

        if (action === 'create') {
          send(res, 200, { ok: true, rule: await budgetLib.createRule(user, {
            accountId: body?.accountId, label: body?.label, amount: body?.amount,
            kind: body?.kind, frequency: body?.frequency, anchorDate: body?.anchorDate,
            categoryId: body?.categoryId, active: body?.active,
          }) }, nostore);
          return;
        }
        if (action === 'update') {
          send(res, 200, { ok: true, rule: await budgetLib.updateRule(user, body?.id, {
            label: body?.label, amount: body?.amount, kind: body?.kind,
            frequency: body?.frequency, anchorDate: body?.anchorDate,
            accountId: body?.accountId, categoryId: body?.categoryId, active: body?.active,
          }) }, nostore);
          return;
        }
        if (action === 'delete') {
          // Only future projections disappear — the payments this rule already
          // produced are ordinary rows and keep their place in the register.
          send(res, 200, await budgetLib.deleteRule(user, body?.id), nostore);
          return;
        }

        send(res, 400, { error: `Unknown action: ${action}` }, nostore);
      } catch (err) { oops(res, req, err, 'Could not save that scheduled bill.'); }
    },
  });

  add('/api/daily/budget/categories', {
    auth: 'member', methods: ['GET', 'POST'],
    async handler(req, res, _ctx, access) {
      try {
        if (budgetGone(res)) return;
        const user = access.user;

        if ((req.method || 'GET').toUpperCase() === 'GET') {
          send(res, 200, { categories: await budgetLib.listCategories(user) }, nostore);
          return;
        }

        const body = await readJson(req, 16_000);
        const action = str(body?.action, 40);

        if (action === 'create') {
          send(res, 200, { ok: true, category: await budgetLib.createCategory(user, {
            name: body?.name, kind: body?.kind, color: body?.color,
          }) }, nostore);
          return;
        }
        if (action === 'delete') {
          // Rows filed under it fall back into the unsorted bucket rather than
          // vanishing: removing a label must never remove the money.
          send(res, 200, await budgetLib.deleteCategory(user, body?.id), nostore);
          return;
        }

        send(res, 400, { error: `Unknown action: ${action}` }, nostore);
      } catch (err) { oops(res, req, err, 'Could not save that category.'); }
    },
  });

  // ── Today — one round trip for the whole screen ───────────────────────────
  //
  // Composed server-side on purpose. The alternative is the phone firing seven
  // requests over a mobile connection and painting the screen in seven stages;
  // this way it paints once. Every query below is scoped by scoped().
  //
  // EVERY OPTIONAL BLOCK DEGRADES TO NULL RATHER THAN THROWING. This is the home
  // screen: it is what a customer sees when they open the app, and it reads from
  // Google, from Stripe-gated budget tables and from a market feed maintained by
  // a different process. A Google outage, a missing earnings table or a budget
  // hiccup must cost exactly one card — never the screen. Anything wrapped in a
  // .catch(() => null) below is there for that reason and not as decoration.

  const orNull = (p) => Promise.resolve(p).then((v) => v, () => null);

  add('/api/daily/today', {
    auth: 'member', methods: ['GET'],
    async handler(req, res, _ctx, access) {
      const user = access.user;
      try {
        const today = todayIn(user.tz);
        const { where, params: scope } = daily.scoped(user);

        const [top3, open, slipping, counts, members, settings] = await Promise.all([
          // Top 3 — starred and open. Capped at 3 by design: a "top 3" of nine
          // items is just a list.
          pool().query(
            `SELECT ${TASK_COLS} FROM daily_tasks
              WHERE ${where} AND done_at IS NULL AND starred = TRUE
              ${OPEN_ORDER} LIMIT 3`, scope),
          pool().query(
            `SELECT ${TASK_COLS} FROM daily_tasks
              WHERE ${where} AND done_at IS NULL ${OPEN_ORDER} LIMIT 200`, scope),
          // Slipping — open, untouched for N days. Starred items are excluded:
          // they are already at the top of the screen, so flagging them again is
          // noise, not a nudge.
          pool().query(
            `SELECT ${TASK_COLS} FROM daily_tasks
              WHERE ${where} AND done_at IS NULL AND starred = FALSE
                AND touched_at < now() - ($2::int * interval '1 day')
              ORDER BY touched_at ASC LIMIT 10`, [...scope, SLIPPING_DAYS]),
          pool().query(
            `SELECT
               COUNT(*) FILTER (WHERE done_at IS NULL)::int AS open,
               COUNT(*) FILTER (WHERE done_at IS NULL AND due_date < $2::date)::int AS overdue,
               COUNT(*) FILTER (WHERE done_at IS NULL AND due_date = $2::date)::int AS due_today,
               COUNT(*) FILTER (WHERE done_at >= date_trunc('day', now()))::int AS done_today
             FROM daily_tasks WHERE ${where}`, [...scope, today]),
          // Everyone in the household, so the UI can label a row with whose it is
          // without a lookup per row.
          orNull(daily.householdMembers(user.household_id)),
          orNull(daily.getSettings(user.id)),
        ]);

        // Resurfacing — one saved note, rotating daily. Chosen by day-number
        // modulo the pool size rather than at random, so it stays stable if you
        // reload the screen ten times in a morning, and still moves tomorrow.
        let resurfacing = null;
        const { rows: noteRows } = await pool().query(
          `SELECT id, created_by, kind, body, created_at FROM daily_notes
            WHERE ${where} ORDER BY id ASC`, scope);
        if (noteRows.length) {
          const dayNum = Math.floor(new Date(`${today}T00:00:00Z`).getTime() / 86_400_000);
          resurfacing = noteRows[dayNum % noteRows.length];
          pool().query(`UPDATE daily_notes SET last_surfaced_at=now() WHERE id=$1`, [resurfacing.id])
            .catch(() => { /* cosmetic; never fail the screen over it */ });
        }

        const [calendar, lists, routines, money, week] = await Promise.all([
          // Whether to show a Connect button or fetch events. The events
          // themselves come from /api/daily/calendar/events so a slow Google call
          // never delays this response.
          google ? orNull(google.statusFor(user)) : Promise.resolve(null),
          orNull(listsSummary(user)),
          orNull(getRoutines(user).then((r) => ({ done: r.doneToday, total: r.total, date: r.date }))),
          budgetLib && budgetLib.available() ? orNull(budgetLib.summary(user)) : Promise.resolve(null),
          markets ? orNull(markets.weekAhead()) : Promise.resolve(null),
        ]);

        // A one-line TEASER, not the feed. The Markets tab renders the whole
        // week; Today gets the count of high-impact prints due today and the
        // names reporting, which is the most a home screen can say without
        // becoming a second Markets tab. Filtered on the user's own `today`
        // because both feeds are stamped in ET, the zone the calendars publish in.
        let marketsBlock = null;
        if (week) {
          const highToday = (week.econ?.events || [])
            .filter((e) => e.date === today && /high/i.test(String(e.impact || ''))).length;
          const reportingToday = (week.earnings?.rows || [])
            .filter((r) => r.date === today)
            .map((r) => r.symbol)
            .slice(0, 6);
          marketsBlock = {
            date: today,
            highImpactToday: highToday,
            earningsToday: reportingToday,
            earningsCount: (week.earnings?.rows || []).filter((r) => r.date === today).length,
            // Kept so the card can say "may be out of date" instead of rendering
            // a hard upstream failure as an ordinary quiet day.
            warning: week.econ?.warning ?? null,
            note: week.earnings?.note ?? null,
          };
        }

        send(res, 200, {
          today,
          tz: user.tz,
          slippingDays: SLIPPING_DAYS,
          top3: top3.rows,
          open: open.rows,
          slipping: slipping.rows,
          counts: counts.rows[0] || { open: 0, overdue: 0, due_today: 0, done_today: 0 },
          resurfacing,
          people: (members || []).map((m) => ({ id: m.id, displayName: m.display_name })),
          settings: settings || null,
          calendar: calendar || { configured: false, connected: false },
          lists,
          routines,
          money,
          markets: marketsBlock,
        }, nostore);
      } catch (err) { oops(res, req, err, 'Could not load your day.'); }
    },
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // Health
  // ═══════════════════════════════════════════════════════════════════════════
  //
  // Public, because the thing checking it is a deploy script or an uptime probe
  // with no session. Booleans only: missingConfig() names ENV VARIABLES, and
  // while a variable name is not a secret, publishing the shape of a
  // deployment's configuration to anyone who curls it is free reconnaissance.
  // Whoever is deploying can read the container log, which says exactly what is
  // missing.

  add('/api/daily/health', {
    auth: 'public', methods: ['GET'],
    async handler(req, res) {
      let db = false;
      try {
        await pool().query('SELECT 1');
        db = true;
      } catch (err) {
        console.error('[daily] health: database unreachable:', err?.message || err);
      }
      send(res, 200, {
        ok: db,
        routes: n,
        db,
        google: !!(google && google.configured()),
        billing: !!(billing && billing.configured()),
        mail: !!(mail && mail.configured()),
        // The market feeds have no configured() of their own — they need only the
        // database and a cache file, both covered above.
        markets: !!markets,
      }, nostore);
    },
  });

  return n;
}

module.exports = { registerDailyRoutes };
