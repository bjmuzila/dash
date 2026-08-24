'use strict';
/**
 * server-v2/_lib-daily.cjs — identity, tenancy and storage for daily.cbedge.net.
 *
 * daily.cbedge.net is the PUBLIC, paid version of the household life-OS that
 * runs privately at budget.cbedge.net. It is a separate product with separate
 * customers, and this file is where that separation is actually enforced.
 *
 * ── WHY NOT REUSE hh_* ────────────────────────────────────────────────────
 *
 * budget.cbedge.net is a two-person app whose schema says, in so many words,
 * "everything is shared": every content row defaults to visibility='shared'
 * and every read is `owner_id = :me OR visibility = 'shared'`. With two trusted
 * people that is a feature. With paying strangers on the same tables it is a
 * data breach with a default value — one new signup and a customer's Today
 * screen shows the owner's journal.
 *
 * So daily.cbedge.net gets its own tables (daily_*), its own users, its own
 * sessions and its own cookie namespace. budget.cbedge.net and its hh_* tables
 * are NOT touched by any code in this file, and nothing here can read them.
 * The two apps share exactly one thing: a Postgres server.
 *
 * ── TENANCY: household_id, on every row, always ───────────────────────────
 *
 * The unit of ownership is a HOUSEHOLD, not a user, even though a household
 * here holds exactly one person (see HOUSEHOLD_SEATS). That looks like an
 * indirection with nothing behind it and is not: fusing the tenant key to the
 * user id would make "whose row is this" and "who is signed in" the same
 * question, and separating them again later means touching every query in every
 * module. One column now, or a migration across the whole codebase later.
 *
 * The rule, without exception:
 *
 *     every content row carries household_id NOT NULL
 *     every read and every write filters on household_id = <caller's>
 *
 * There is no visibility column and no per-row sharing switch — with one person
 * per household there is nobody to hide a row from, and across households
 * nothing is shared, ever. A missing WHERE clause is therefore a bug you can
 * find by grepping for a table name without `household_id` beside it, rather
 * than a subtle predicate that silently over-matches.
 *
 * `scoped()` below is the helper every route module must use to build that
 * predicate. Do not hand-roll it.
 *
 * ── AUTH ──────────────────────────────────────────────────────────────────
 *
 * Ported from _lib-household.cjs — scrypt passwords, an opaque session token
 * whose SHA-256 is what the database stores, and the device-bound 4-digit PIN
 * for quick sign-in on a phone. What is NEW here, because this one has paying
 * customers rather than two known people:
 *
 *   * public self-signup, with email verification
 *   * password reset by emailed token
 *   * a subscription gate — see subscriptionProblem() and _lib-daily-billing
 *
 * Accounts are email and password only. loginWithGoogle() below still exists and
 * is correct, but the route that reached it is switched off — Google is a
 * calendar integration here and nothing else. See /api/daily/google/start.
 *
 * Cookies are dy_session / dy_device and carry NO Domain attribute, so the
 * browser scopes them host-only to daily.cbedge.net. Never add
 * `Domain=.cbedge.net`: that would hand a daily.cbedge.net session to
 * cbedge.net, budget.cbedge.net and every other subdomain at once.
 *
 * ── TABLES ────────────────────────────────────────────────────────────────
 *
 * Self-bootstrapping via CREATE TABLE IF NOT EXISTS on first use, the same
 * pattern _lib-household.cjs and api-router.js already use. No migration
 * runner, nothing to remember on deploy.
 */

const crypto = require('crypto');

let libDb = null;
try { libDb = require('./_lib-db.cjs'); }
catch (e) { console.warn('[daily] _lib-db.cjs not loaded — daily routes disabled:', e.message); }

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const COOKIE_NAME = 'dy_session';
const SESSION_DAYS = 30;
const SESSION_MS = SESSION_DAYS * 24 * 60 * 60 * 1000;
const SLIDE_AFTER_MS = 24 * 60 * 60 * 1000;

const MAX_FAILS = 5;
const LOCKOUT_MS = 15 * 60 * 1000;

const DEVICE_COOKIE = 'dy_device';
const DEVICE_DAYS = 400;
const MAX_PIN_FAILS = 5;

const SCRYPT = { N: 16384, r: 8, p: 1, keylen: 64 };

/** Email tokens. Verification is generous, reset is deliberately not. */
const VERIFY_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const RESET_TTL_MS = 60 * 60 * 1000;

/**
 * How many people one account may hold. ONE — Daily is a single-person product.
 *
 * The tenancy is still keyed on `household_id` rather than `user_id`, and that
 * is deliberate rather than leftover. A household of one is a household; making
 * the tenant key the user id would fuse identity and ownership, and un-fusing
 * them later means rewriting every query in every module. This way the seat cap
 * is a number in one place.
 *
 * Setting it to 1 is what actually turns invites off — the invite route and
 * joinHousehold() both check it, so neither can add a second person while this
 * says one, whatever the UI does or doesn't show.
 */
const HOUSEHOLD_SEATS = 1;

/**
 * Site owner(s) — the people who run daily.cbedge.net, as opposed to the people
 * who pay for it.
 *
 * By EMAIL and from the environment, not a column and not a role on the row. A
 * boolean in the database is one bad UPDATE away from making a customer an
 * admin, and there is no UI anywhere that can grant this — you get it by having
 * shell access to the box that sets the variable, which is the same access you
 * would need to grant yourself a column anyway.
 *
 * Comma-separated, matched case-insensitively against the account's email, and
 * defaulting to the owner's address so a deployment that forgets the variable
 * still has somebody who can get in.
 */
const ADMIN_EMAILS = new Set(
  String(process.env.DAILY_ADMIN_EMAILS || 'bjmuzila@gmail.com')
    .split(',')
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean),
);

/** True for the site owner. Takes the user row, never a raw string from a
 *  request — the email being compared has to be the one on the session. */
function isAdmin(user) {
  const email = String(user?.email || '').trim().toLowerCase();
  return !!email && ADMIN_EMAILS.has(email);
}

const available = () => !!libDb;

// ---------------------------------------------------------------------------
// Schema
// ---------------------------------------------------------------------------

let ready = null;
async function ensureSchema() {
  if (!libDb) throw new Error('daily: no database');
  if (ready) return ready;
  ready = (async () => {
    const pool = libDb.getPool();

    // ── Tenancy root ─────────────────────────────────────────────────────
    // A household is created by the signup that pays for it. owner_user_id is
    // nullable ONLY for the instant between INSERT household and INSERT user,
    // which is inside one transaction in createAccount().
    await pool.query(`
      CREATE TABLE IF NOT EXISTS daily_households (
        id            SERIAL PRIMARY KEY,
        name          TEXT NOT NULL DEFAULT 'My household',
        owner_user_id INTEGER,
        tz            TEXT NOT NULL DEFAULT 'America/New_York',
        created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
      )`);

    // ── Users ────────────────────────────────────────────────────────────
    // password_hash is NULLABLE: an account created with "Sign in with Google"
    // has no password at all, and inventing one would mean emailing a secret
    // nobody asked for. Such an account can add a password later from Settings.
    //
    // role is 'owner' | 'member'. Every account created today is an owner —
    // 'member' is reachable only through joinHousehold(), which the seat cap now
    // refuses. The column stays because the billing routes read it, and because
    // dropping a column is the one schema change that cannot be undone by
    // adding it back.
    await pool.query(`
      CREATE TABLE IF NOT EXISTS daily_users (
        id                   SERIAL PRIMARY KEY,
        household_id         INTEGER NOT NULL REFERENCES daily_households(id) ON DELETE CASCADE,
        email                TEXT NOT NULL UNIQUE,
        password_hash        TEXT,
        display_name         TEXT NOT NULL,
        role                 TEXT NOT NULL DEFAULT 'owner',
        tz                   TEXT NOT NULL DEFAULT 'America/New_York',
        google_sub           TEXT UNIQUE,
        email_verified_at    TIMESTAMPTZ,
        must_change_password BOOLEAN NOT NULL DEFAULT FALSE,
        active               BOOLEAN NOT NULL DEFAULT TRUE,
        created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
        last_login_at        TIMESTAMPTZ
      )`);
    await pool.query(`CREATE INDEX IF NOT EXISTS daily_users_hh_idx ON daily_users(household_id)`);
    // Added after the table shipped; ALTER rather than CREATE so an existing
    // deployment actually gets the column (CREATE TABLE IF NOT EXISTS is a
    // no-op on a table that exists and would skip it in silence).
    await pool.query(`ALTER TABLE daily_users ADD COLUMN IF NOT EXISTS google_email TEXT`);
    await pool.query(`ALTER TABLE daily_users ADD COLUMN IF NOT EXISTS onboarded_at TIMESTAMPTZ`);

    // Now the FK back the other way, once both tables exist.
    await pool.query(`
      DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM pg_constraint WHERE conname = 'daily_households_owner_fk'
        ) THEN
          ALTER TABLE daily_households
            ADD CONSTRAINT daily_households_owner_fk
            FOREIGN KEY (owner_user_id) REFERENCES daily_users(id) ON DELETE SET NULL;
        END IF;
      END $$;`);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS daily_sessions (
        token_hash TEXT PRIMARY KEY,
        user_id    INTEGER NOT NULL REFERENCES daily_users(id) ON DELETE CASCADE,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        expires_at TIMESTAMPTZ NOT NULL,
        user_agent TEXT,
        ip         TEXT
      )`);
    await pool.query(`CREATE INDEX IF NOT EXISTS daily_sessions_user_idx ON daily_sessions(user_id)`);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS daily_login_attempts (
        id    SERIAL PRIMARY KEY,
        email TEXT NOT NULL,
        ip    TEXT,
        ok    BOOLEAN NOT NULL,
        at    TIMESTAMPTZ NOT NULL DEFAULT now()
      )`);
    await pool.query(`CREATE INDEX IF NOT EXISTS daily_login_attempts_email_at_idx
                        ON daily_login_attempts(email, at DESC)`);

    // Composite key, exactly as hh_device_pins learned the hard way: one browser
    // can hold a quick sign-in for BOTH people in a household. The device token
    // is per-browser; the PIN is what says which person.
    await pool.query(`
      CREATE TABLE IF NOT EXISTS daily_device_pins (
        device_hash  TEXT NOT NULL,
        user_id      INTEGER NOT NULL REFERENCES daily_users(id) ON DELETE CASCADE,
        pin_hash     TEXT NOT NULL,
        fails        INTEGER NOT NULL DEFAULT 0,
        user_agent   TEXT,
        created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
        last_used_at TIMESTAMPTZ,
        PRIMARY KEY (device_hash, user_id)
      )`);
    await pool.query(`CREATE INDEX IF NOT EXISTS daily_device_pins_user_idx ON daily_device_pins(user_id)`);

    // ── Email tokens: verification, password reset, household invites ────
    // One table, three kinds. Only the SHA-256 is stored — the token in the
    // email is the only copy, so a database dump cannot be used to take over
    // an account by replaying a reset link.
    await pool.query(`
      CREATE TABLE IF NOT EXISTS daily_email_tokens (
        token_hash   TEXT PRIMARY KEY,
        kind         TEXT NOT NULL,
        user_id      INTEGER REFERENCES daily_users(id) ON DELETE CASCADE,
        household_id INTEGER REFERENCES daily_households(id) ON DELETE CASCADE,
        email        TEXT,
        created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
        expires_at   TIMESTAMPTZ NOT NULL,
        used_at      TIMESTAMPTZ
      )`);
    await pool.query(`CREATE INDEX IF NOT EXISTS daily_email_tokens_user_idx
                        ON daily_email_tokens(user_id, kind)`);

    // ── Per-user preferences ─────────────────────────────────────────────
    // weatherZip lives here. It is per USER, not per household: two people in
    // one house share a postcode, but a member who travels shouldn't have to
    // change the other's weather tile to see their own.
    await pool.query(`
      CREATE TABLE IF NOT EXISTS daily_settings (
        user_id INTEGER NOT NULL REFERENCES daily_users(id) ON DELETE CASCADE,
        key     TEXT NOT NULL,
        value   JSONB NOT NULL,
        PRIMARY KEY (user_id, key)
      )`);

    // ── Google tokens ────────────────────────────────────────────────────
    // Server-side only; the SPA never sees a token. share_with_household lets
    // one person connect and both see the events, which is what makes a shared
    // family calendar work without the other doing the Google dance.
    await pool.query(`
      CREATE TABLE IF NOT EXISTS daily_google_tokens (
        user_id              INTEGER PRIMARY KEY REFERENCES daily_users(id) ON DELETE CASCADE,
        household_id         INTEGER NOT NULL REFERENCES daily_households(id) ON DELETE CASCADE,
        google_email         TEXT,
        refresh_token        TEXT NOT NULL,
        access_token         TEXT,
        expires_at           TIMESTAMPTZ,
        scope                TEXT,
        share_with_household BOOLEAN NOT NULL DEFAULT TRUE,
        selected_calendars   JSONB,
        last_synced_at       TIMESTAMPTZ,
        updated_at           TIMESTAMPTZ NOT NULL DEFAULT now()
      )`);
    await pool.query(`CREATE INDEX IF NOT EXISTS daily_google_tokens_hh_idx
                        ON daily_google_tokens(household_id)`);

    // ── Billing ──────────────────────────────────────────────────────────
    // One subscription per HOUSEHOLD — the thing being sold is "our life runs
    // on this", not a seat. Written only by _lib-daily-billing.cjs from Stripe
    // webhooks; every other module reads it.
    await pool.query(`
      CREATE TABLE IF NOT EXISTS daily_subscriptions (
        household_id           INTEGER PRIMARY KEY REFERENCES daily_households(id) ON DELETE CASCADE,
        stripe_customer_id     TEXT UNIQUE,
        stripe_subscription_id TEXT UNIQUE,
        status                 TEXT NOT NULL DEFAULT 'none',
        plan                   TEXT,
        price_id               TEXT,
        current_period_end     TIMESTAMPTZ,
        cancel_at_period_end   BOOLEAN NOT NULL DEFAULT FALSE,
        updated_at             TIMESTAMPTZ NOT NULL DEFAULT now()
      )`);
    await pool.query(`CREATE INDEX IF NOT EXISTS daily_subscriptions_cust_idx
                        ON daily_subscriptions(stripe_customer_id)`);
    // Webhook idempotency. Stripe retries, and a retried
    // customer.subscription.updated that re-ran a downgrade would be harmless,
    // but a retried invoice event that re-ran a credit would not. Cheap
    // insurance either way.
    await pool.query(`
      CREATE TABLE IF NOT EXISTS daily_stripe_events (
        id          TEXT PRIMARY KEY,
        type        TEXT,
        received_at TIMESTAMPTZ NOT NULL DEFAULT now()
      )`);

    // ── Content ──────────────────────────────────────────────────────────
    // Ported from hh_* with owner_id/visibility replaced by household_id.
    // created_by is kept for "who added this", which is display, never access.
    await pool.query(`
      CREATE TABLE IF NOT EXISTS daily_tasks (
        id           SERIAL PRIMARY KEY,
        household_id INTEGER NOT NULL REFERENCES daily_households(id) ON DELETE CASCADE,
        created_by   INTEGER REFERENCES daily_users(id) ON DELETE SET NULL,
        title        TEXT NOT NULL,
        notes        TEXT,
        due_date     DATE,
        starred      BOOLEAN NOT NULL DEFAULT FALSE,
        urgent       BOOLEAN NOT NULL DEFAULT FALSE,
        project_id   INTEGER,
        done_at      TIMESTAMPTZ,
        created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
        touched_at   TIMESTAMPTZ NOT NULL DEFAULT now()
      )`);
    await pool.query(`CREATE INDEX IF NOT EXISTS daily_tasks_open_idx
                        ON daily_tasks(household_id, done_at, due_date)`);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS daily_notes (
        id               SERIAL PRIMARY KEY,
        household_id     INTEGER NOT NULL REFERENCES daily_households(id) ON DELETE CASCADE,
        created_by       INTEGER REFERENCES daily_users(id) ON DELETE SET NULL,
        kind             TEXT NOT NULL DEFAULT 'note',
        body             TEXT NOT NULL,
        created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
        last_surfaced_at TIMESTAMPTZ
      )`);
    await pool.query(`CREATE INDEX IF NOT EXISTS daily_notes_hh_idx
                        ON daily_notes(household_id, created_at DESC)`);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS daily_routines (
        id           SERIAL PRIMARY KEY,
        household_id INTEGER NOT NULL REFERENCES daily_households(id) ON DELETE CASCADE,
        created_by   INTEGER REFERENCES daily_users(id) ON DELETE SET NULL,
        title        TEXT NOT NULL,
        block        TEXT NOT NULL DEFAULT 'morning',
        sort_order   INTEGER NOT NULL DEFAULT 0,
        active       BOOLEAN NOT NULL DEFAULT TRUE,
        created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
      )`);
    await pool.query(`CREATE INDEX IF NOT EXISTS daily_routines_hh_idx
                        ON daily_routines(household_id, active, sort_order)`);
    // PRIMARY KEY (routine_id, day) makes ticking idempotent: a double tap on a
    // slow connection cannot log the same day twice. `day` is a DATE already
    // resolved in the user's timezone — never now()::date, which rolls over at
    // 8pm Eastern.
    await pool.query(`
      CREATE TABLE IF NOT EXISTS daily_routine_log (
        routine_id INTEGER NOT NULL REFERENCES daily_routines(id) ON DELETE CASCADE,
        day        DATE NOT NULL,
        done_by    INTEGER REFERENCES daily_users(id) ON DELETE SET NULL,
        done_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
        PRIMARY KEY (routine_id, day)
      )`);
    await pool.query(`CREATE INDEX IF NOT EXISTS daily_routine_log_day_idx ON daily_routine_log(day DESC)`);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS daily_meals (
        id           SERIAL PRIMARY KEY,
        household_id INTEGER NOT NULL REFERENCES daily_households(id) ON DELETE CASCADE,
        created_by   INTEGER REFERENCES daily_users(id) ON DELETE SET NULL,
        day          DATE NOT NULL,
        title        TEXT NOT NULL,
        notes        TEXT,
        sort_order   INTEGER NOT NULL DEFAULT 0,
        created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
      )`);
    await pool.query(`CREATE INDEX IF NOT EXISTS daily_meals_day_idx ON daily_meals(household_id, day)`);

    // ON DELETE SET NULL, not CASCADE: deleting "Taco night" must not silently
    // remove the tortillas from the grocery list — you may still want them.
    await pool.query(`
      CREATE TABLE IF NOT EXISTS daily_list_items (
        id           SERIAL PRIMARY KEY,
        household_id INTEGER NOT NULL REFERENCES daily_households(id) ON DELETE CASCADE,
        created_by   INTEGER REFERENCES daily_users(id) ON DELETE SET NULL,
        list         TEXT NOT NULL DEFAULT 'grocery',
        text         TEXT NOT NULL,
        qty          TEXT,
        aisle        TEXT NOT NULL DEFAULT 'other',
        meal_id      INTEGER REFERENCES daily_meals(id) ON DELETE SET NULL,
        checked_at   TIMESTAMPTZ,
        checked_by   INTEGER REFERENCES daily_users(id) ON DELETE SET NULL,
        sort_order   INTEGER NOT NULL DEFAULT 0,
        created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
      )`);
    await pool.query(`CREATE INDEX IF NOT EXISTS daily_list_items_list_idx
                        ON daily_list_items(household_id, list, checked_at)`);
    await pool.query(`CREATE INDEX IF NOT EXISTS daily_list_items_meal_idx ON daily_list_items(meal_id)`);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS daily_projects (
        id           SERIAL PRIMARY KEY,
        household_id INTEGER NOT NULL REFERENCES daily_households(id) ON DELETE CASCADE,
        created_by   INTEGER REFERENCES daily_users(id) ON DELETE SET NULL,
        title        TEXT NOT NULL,
        summary      TEXT,
        status       TEXT NOT NULL DEFAULT 'active',
        target_date  DATE,
        sort_order   INTEGER NOT NULL DEFAULT 0,
        created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
      )`);
    await pool.query(`CREATE INDEX IF NOT EXISTS daily_projects_hh_idx
                        ON daily_projects(household_id, status, sort_order)`);
    await pool.query(`
      CREATE TABLE IF NOT EXISTS daily_milestones (
        id         SERIAL PRIMARY KEY,
        project_id INTEGER NOT NULL REFERENCES daily_projects(id) ON DELETE CASCADE,
        title      TEXT NOT NULL,
        done_at    TIMESTAMPTZ,
        sort_order INTEGER NOT NULL DEFAULT 0,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now()
      )`);
    await pool.query(`CREATE INDEX IF NOT EXISTS daily_milestones_project_idx
                        ON daily_milestones(project_id, sort_order)`);
    await pool.query(`
      CREATE TABLE IF NOT EXISTS daily_time_log (
        id         SERIAL PRIMARY KEY,
        project_id INTEGER NOT NULL REFERENCES daily_projects(id) ON DELETE CASCADE,
        user_id    INTEGER REFERENCES daily_users(id) ON DELETE SET NULL,
        day        DATE NOT NULL,
        minutes    INTEGER NOT NULL,
        note       TEXT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now()
      )`);
    await pool.query(`CREATE INDEX IF NOT EXISTS daily_time_log_project_idx
                        ON daily_time_log(project_id, day DESC)`);
    // daily_tasks.project_id points at daily_projects. Declared here rather than
    // inline above because daily_projects is created after daily_tasks.
    await pool.query(`
      DO $$
      BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'daily_tasks_project_fk') THEN
          ALTER TABLE daily_tasks
            ADD CONSTRAINT daily_tasks_project_fk
            FOREIGN KEY (project_id) REFERENCES daily_projects(id) ON DELETE SET NULL;
        END IF;
      END $$;`);

    // Budget tables are owned by _lib-daily-budget.cjs and created there, so
    // the money schema stays next to the money logic.
    return true;
  })().catch((e) => { ready = null; throw e; });
  return ready;
}

// ---------------------------------------------------------------------------
// The tenancy helper every route module must use
// ---------------------------------------------------------------------------

/**
 * Build the household predicate for a query.
 *
 *   const { where, params } = scoped(user, 'household_id');
 *   pool.query(`SELECT * FROM daily_tasks WHERE ${where} AND done_at IS NULL`, params)
 *
 * It exists so that "did this query filter by tenant?" is answerable by eye. A
 * route module that builds its own `household_id = ${x}` string is the one that
 * will eventually interpolate a value from the request body.
 *
 * Throws on a user without a household rather than returning a predicate that
 * matches nothing — a silently empty screen is a much worse bug report than a
 * 500 with a stack trace.
 */
function scoped(user, column = 'household_id', startAt = 1) {
  const hid = user?.household_id;
  if (!Number.isInteger(hid)) throw new Error('daily: request has no household');
  return { where: `${column} = $${startAt}`, params: [hid], next: startAt + 1 };
}

/** Assert a row you just read really belongs to the caller. Belt and braces for
 *  the by-id routes, where the id comes from the URL. */
function assertOwned(user, row, column = 'household_id') {
  if (!row) return false;
  return row[column] === user?.household_id;
}

// ---------------------------------------------------------------------------
// Passwords
// ---------------------------------------------------------------------------

function hashPassword(plain) {
  const salt = crypto.randomBytes(16);
  const key = crypto.scryptSync(String(plain), salt, SCRYPT.keylen, { N: SCRYPT.N, r: SCRYPT.r, p: SCRYPT.p });
  return `scrypt$${SCRYPT.N}$${SCRYPT.r}$${SCRYPT.p}$${salt.toString('base64')}$${key.toString('base64')}`;
}

function verifyPassword(plain, stored) {
  try {
    const parts = String(stored || '').split('$');
    if (parts.length !== 6 || parts[0] !== 'scrypt') return false;
    const [, N, r, p, saltB64, hashB64] = parts;
    const salt = Buffer.from(saltB64, 'base64');
    const expected = Buffer.from(hashB64, 'base64');
    const actual = crypto.scryptSync(String(plain), salt, expected.length, { N: Number(N), r: Number(r), p: Number(p) });
    if (actual.length !== expected.length) return false;
    return crypto.timingSafeEqual(actual, expected);
  } catch { return false; }
}

/**
 * Length is the only password rule that reliably buys entropy, and the only one
 * that doesn't push people toward `Password1!`. Ten characters, nothing else.
 */
function passwordProblem(plain) {
  const s = String(plain || '');
  if (s.length < 10) return 'Password must be at least 10 characters.';
  if (s.length > 200) return 'Password is too long.';
  return null;
}

function pinProblem(pin) {
  const s = String(pin ?? '');
  if (!/^\d{4}$/.test(s)) return 'Your PIN must be exactly 4 digits.';
  if (/^(\d)\1{3}$/.test(s)) return 'Pick a PIN that isn’t the same digit four times.';
  if ('0123456789'.includes(s) || '9876543210'.includes(s)) {
    return 'Pick a PIN that isn’t four digits in a row.';
  }
  return null;
}

// ---------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------

const sha256 = (s) => crypto.createHash('sha256').update(String(s)).digest('hex');
const normEmail = (e) => String(e || '').trim().toLowerCase();

/**
 * Good enough to reject typos and obvious junk at signup; deliberately NOT an
 * RFC-complete grammar. The real proof that an address works is the
 * verification email, which we send anyway.
 */
function emailProblem(email) {
  const e = normEmail(email);
  if (!e) return 'Email is required.';
  if (e.length > 254) return 'That email address is too long.';
  if (!/^[^\s@]+@[^\s@.]+(\.[^\s@.]+)+$/.test(e)) return 'That doesn’t look like an email address.';
  return null;
}

function parseCookies(req) {
  const raw = req.headers?.cookie || '';
  const out = {};
  for (const part of raw.split(';')) {
    const i = part.indexOf('=');
    if (i < 0) continue;
    out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

function clientIp(req) {
  const fwd = req?.headers?.['cf-connecting-ip'] || req?.headers?.['x-forwarded-for'];
  if (fwd) return String(fwd).split(',')[0].trim().slice(0, 64);
  return String(req?.socket?.remoteAddress || '').slice(0, 64) || null;
}

const uaOf = (req) => String(req?.headers?.['user-agent'] || '').slice(0, 300) || null;

// NOTE the deliberate absence of `Domain=`. Host-only — see the header comment.
function sessionCookie(token, maxAgeSec) {
  return [
    `${COOKIE_NAME}=${encodeURIComponent(token)}`,
    'Path=/', 'HttpOnly', 'Secure', 'SameSite=Lax', `Max-Age=${maxAgeSec}`,
  ].join('; ');
}
const clearCookie = () => `${COOKIE_NAME}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`;

function deviceCookie(token) {
  return [
    `${DEVICE_COOKIE}=${encodeURIComponent(token)}`,
    'Path=/', 'HttpOnly', 'Secure', 'SameSite=Lax',
    `Max-Age=${DEVICE_DAYS * 24 * 60 * 60}`,
  ].join('; ');
}
const clearDeviceCookie = () => `${DEVICE_COOKIE}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`;
const deviceToken = (req) => parseCookies(req)[DEVICE_COOKIE] || null;

const SESSION_MAX_AGE = SESSION_DAYS * 24 * 60 * 60;

// ---------------------------------------------------------------------------
// Sessions
// ---------------------------------------------------------------------------

async function createSession(userId, req) {
  const token = crypto.randomBytes(32).toString('base64url');
  const expires = new Date(Date.now() + SESSION_MS);
  await libDb.getPool().query(
    `INSERT INTO daily_sessions (token_hash, user_id, expires_at, user_agent, ip)
     VALUES ($1,$2,$3,$4,$5)`,
    [sha256(token), userId, expires, uaOf(req), clientIp(req)]);
  return { token, expires };
}

/**
 * The single column list every "who is this" query selects. Includes the
 * household's subscription status by join, because almost every caller
 * immediately needs to know whether this account is paid.
 */
const USER_SELECT = `
  u.id, u.household_id, u.email, u.display_name, u.role, u.tz,
  u.google_email, u.email_verified_at, u.must_change_password, u.active,
  u.onboarded_at, u.created_at, u.last_login_at,
  h.name AS household_name,
  COALESCE(s.status, 'none')          AS sub_status,
  s.plan                              AS sub_plan,
  s.current_period_end                AS sub_period_end,
  COALESCE(s.cancel_at_period_end, FALSE) AS sub_cancel_at_period_end`;

const USER_FROM = `
  FROM daily_users u
  JOIN daily_households h ON h.id = u.household_id
  LEFT JOIN daily_subscriptions s ON s.household_id = u.household_id`;

/** Resolve the daily user for a request, or null. Never throws. */
async function userFromRequest(req) {
  if (!libDb) return null;
  try {
    const token = parseCookies(req)[COOKIE_NAME];
    if (!token) return null;
    await ensureSchema();
    const { rows } = await libDb.getPool().query(
      `SELECT ${USER_SELECT}, sess.created_at AS session_created_at
       ${USER_FROM}
       JOIN daily_sessions sess ON sess.user_id = u.id
       WHERE sess.token_hash = $1 AND sess.expires_at > now()`,
      [sha256(token)]);
    const u = rows[0];
    if (!u || !u.active) return null;
    return u;
  } catch { return null; }
}

async function userById(id) {
  const { rows } = await libDb.getPool().query(
    `SELECT ${USER_SELECT} ${USER_FROM} WHERE u.id = $1`, [id]);
  return rows[0] || null;
}

function shouldSlide(user) {
  const created = user?.session_created_at ? new Date(user.session_created_at).getTime() : 0;
  return created > 0 && Date.now() - created > SLIDE_AFTER_MS;
}

async function refreshSession(req) {
  const token = parseCookies(req)[COOKIE_NAME];
  if (!token) return null;
  const expires = new Date(Date.now() + SESSION_MS);
  await libDb.getPool().query(
    `UPDATE daily_sessions SET expires_at=$2, created_at=now() WHERE token_hash=$1`,
    [sha256(token), expires]);
  return { token, expires };
}

async function destroySession(req) {
  const token = parseCookies(req)[COOKIE_NAME];
  if (!token) return;
  try { await libDb.getPool().query(`DELETE FROM daily_sessions WHERE token_hash=$1`, [sha256(token)]); }
  catch { /* signing out is best-effort; the cookie is cleared regardless */ }
}

async function destroyAllSessions(userId) {
  await libDb.getPool().query(`DELETE FROM daily_sessions WHERE user_id=$1`, [userId]);
}

async function pruneSessions() {
  try {
    await libDb.getPool().query(`DELETE FROM daily_sessions WHERE expires_at < now()`);
    await libDb.getPool().query(`DELETE FROM daily_email_tokens WHERE expires_at < now() - interval '7 days'`);
  } catch { /* ignore */ }
}

// ---------------------------------------------------------------------------
// Login throttling
// ---------------------------------------------------------------------------

async function recentFailures(email) {
  const { rows } = await libDb.getPool().query(
    `SELECT COUNT(*)::int AS n FROM daily_login_attempts
      WHERE email=$1 AND ok=FALSE AND at > now() - ($2::int * interval '1 millisecond')`,
    [normEmail(email), LOCKOUT_MS]);
  return rows[0]?.n ?? 0;
}

async function logAttempt(email, ip, ok) {
  try {
    await libDb.getPool().query(
      `INSERT INTO daily_login_attempts (email, ip, ok) VALUES ($1,$2,$3)`,
      [normEmail(email), ip || null, !!ok]);
  } catch { /* never let the audit log break a login */ }
}

// ---------------------------------------------------------------------------
// Signup
// ---------------------------------------------------------------------------

/**
 * Create a household and its first user, in ONE transaction.
 *
 * The transaction is not decoration. Without it a failure between the two
 * INSERTs leaves an orphan household with no owner, and the retry — same email
 * — hits the UNIQUE index and reports "that email is taken" to the person who
 * has never successfully signed up. That is an unrecoverable dead end for a
 * customer whose card you are about to charge.
 *
 * Returns { ok, user, cookie, verifyToken } — verifyToken is handed to the
 * caller to email; it is never stored in plaintext.
 */
async function createAccount({ email, password, displayName, tz, req, googleSub = null, googleEmail = null }) {
  await ensureSchema();

  const eProblem = emailProblem(email);
  if (eProblem) return { ok: false, code: 400, error: eProblem };

  // A Google signup has no password by design; a normal one must have a good one.
  if (!googleSub) {
    const pProblem = passwordProblem(password);
    if (pProblem) return { ok: false, code: 400, error: pProblem };
  }

  const e = normEmail(email);
  const name = String(displayName || '').trim() || e.split('@')[0];
  const zone = String(tz || 'America/New_York');
  const pool = libDb.getPool();
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    // Check inside the transaction, not before it — two signups racing on the
    // same address must not both pass a pre-check and then one blow up mid-way.
    const dupe = await client.query(`SELECT id FROM daily_users WHERE email=$1`, [e]);
    if (dupe.rows[0]) {
      await client.query('ROLLBACK');
      return { ok: false, code: 409, error: 'An account already exists for that email.' };
    }

    const hh = await client.query(
      `INSERT INTO daily_households (name, tz) VALUES ($1,$2) RETURNING id`,
      [`${name}’s household`, zone]);
    const householdId = hh.rows[0].id;

    const ins = await client.query(
      `INSERT INTO daily_users
         (household_id, email, password_hash, display_name, role, tz, google_sub, google_email, email_verified_at)
       VALUES ($1,$2,$3,$4,'owner',$5,$6,$7,$8)
       RETURNING id`,
      [householdId, e, password ? hashPassword(password) : null, name, zone,
       googleSub, googleEmail,
       // Google has already proven the address. Asking someone who just signed
       // in with Google to also click a link in their email is theatre.
       googleSub ? new Date() : null]);
    const userId = ins.rows[0].id;

    await client.query(`UPDATE daily_households SET owner_user_id=$2 WHERE id=$1`, [householdId, userId]);
    await client.query(
      `INSERT INTO daily_subscriptions (household_id, status) VALUES ($1,'none')
       ON CONFLICT (household_id) DO NOTHING`, [householdId]);

    await client.query('COMMIT');

    const { token } = await createSession(userId, req);
    await pool.query(`UPDATE daily_users SET last_login_at=now() WHERE id=$1`, [userId]);
    const user = await userById(userId);

    const verifyToken = googleSub ? null : await issueEmailToken({ kind: 'verify', userId, email: e });

    return { ok: true, user, cookie: sessionCookie(token, SESSION_MAX_AGE), verifyToken };
  } catch (err) {
    try { await client.query('ROLLBACK'); } catch { /* connection already gone */ }
    // A UNIQUE violation that got past the in-transaction check means a genuine
    // race, and "that email is taken" is the honest answer for it.
    if (err && err.code === '23505') {
      return { ok: false, code: 409, error: 'An account already exists for that email.' };
    }
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Add a second person to an existing household, from an invite token.
 * Seat-capped at HOUSEHOLD_SEATS — see the constant for why.
 */
async function joinHousehold({ householdId, email, password, displayName, req, googleSub = null, googleEmail = null }) {
  await ensureSchema();
  const eProblem = emailProblem(email);
  if (eProblem) return { ok: false, code: 400, error: eProblem };
  if (!googleSub) {
    const pProblem = passwordProblem(password);
    if (pProblem) return { ok: false, code: 400, error: pProblem };
  }
  const pool = libDb.getPool();
  const e = normEmail(email);

  const seats = await pool.query(
    `SELECT COUNT(*)::int AS n FROM daily_users WHERE household_id=$1 AND active`, [householdId]);
  if ((seats.rows[0]?.n ?? 0) >= HOUSEHOLD_SEATS) {
    return { ok: false, code: 409, error: 'This household is already full.' };
  }

  const name = String(displayName || '').trim() || e.split('@')[0];
  try {
    const ins = await pool.query(
      `INSERT INTO daily_users
         (household_id, email, password_hash, display_name, role, tz, google_sub, google_email, email_verified_at)
       VALUES ($1,$2,$3,$4,'member',
               (SELECT tz FROM daily_households WHERE id=$1),$5,$6,now())
       RETURNING id`,
      [householdId, e, password ? hashPassword(password) : null, name, googleSub, googleEmail]);
    const userId = ins.rows[0].id;
    const { token } = await createSession(userId, req);
    return { ok: true, user: await userById(userId), cookie: sessionCookie(token, SESSION_MAX_AGE) };
  } catch (err) {
    if (err && err.code === '23505') {
      return { ok: false, code: 409, error: 'An account already exists for that email.' };
    }
    throw err;
  }
}

// ---------------------------------------------------------------------------
// Login
// ---------------------------------------------------------------------------

/**
 * Returns { ok:true, user, cookie } or { ok:false, code, error }.
 *
 * Unknown-email and wrong-password give the SAME message and burn roughly the
 * same CPU. On a public signup form the alternative is an account-enumeration
 * oracle: type an address, learn whether that person is a customer.
 */
async function login({ email, password, req }) {
  await ensureSchema();
  const e = normEmail(email);
  const ip = clientIp(req);

  if (!e || !password) return { ok: false, code: 400, error: 'Email and password are required.' };

  if (await recentFailures(e) >= MAX_FAILS) {
    await logAttempt(e, ip, false);
    return { ok: false, code: 429, error: 'Too many attempts. Try again in 15 minutes.' };
  }

  // Just the three columns the decision needs. The full user record is fetched
  // by id once the password has actually checked out.
  const { rows } = await libDb.getPool().query(
    `SELECT id, password_hash, active FROM daily_users WHERE email=$1`, [e]);
  const u = rows[0];

  if (!u || !u.active || !u.password_hash) {
    verifyPassword(String(password), hashPassword('decoy-not-a-real-password'));
    await logAttempt(e, ip, false);
    // The no-password case is a Google-only account. Saying so would confirm the
    // address exists, so it gets the same answer — the "Sign in with Google"
    // button is right there on the same screen.
    return { ok: false, code: 401, error: 'Email or password is incorrect.' };
  }

  if (!verifyPassword(password, u.password_hash)) {
    await logAttempt(e, ip, false);
    return { ok: false, code: 401, error: 'Email or password is incorrect.' };
  }

  await logAttempt(e, ip, true);
  void pruneSessions();
  const { token } = await createSession(u.id, req);
  await libDb.getPool().query(`UPDATE daily_users SET last_login_at=now() WHERE id=$1`, [u.id]);

  return { ok: true, user: await userById(u.id), cookie: sessionCookie(token, SESSION_MAX_AGE) };
}

/**
 * Sign in (or up) with Google.
 *
 * `profile` is the verified payload from _lib-daily-google.cjs — it must
 * already have checked the id_token signature, `aud` and `iss`. This function
 * trusts it completely, so nothing else may ever call it with an unverified
 * blob.
 *
 * Matching order is sub first, then email:
 *   - google_sub is stable forever and survives a Google address change;
 *   - email is the bridge for someone who signed up with a password and is now
 *     clicking the Google button for the first time. Linking on email is only
 *     safe because Google asserts email_verified, which the caller checks.
 */
async function loginWithGoogle({ profile, req }) {
  await ensureSchema();
  const pool = libDb.getPool();
  const sub = String(profile?.sub || '');
  const email = normEmail(profile?.email);
  if (!sub || !email) return { ok: false, code: 400, error: 'Google did not return an email address.' };

  let { rows } = await pool.query(`SELECT id, active FROM daily_users WHERE google_sub=$1`, [sub]);
  if (!rows[0]) {
    ({ rows } = await pool.query(`SELECT id, active FROM daily_users WHERE email=$1`, [email]));
    if (rows[0]) {
      await pool.query(
        `UPDATE daily_users
            SET google_sub=$2, google_email=$3, email_verified_at=COALESCE(email_verified_at, now())
          WHERE id=$1`,
        [rows[0].id, sub, email]);
    }
  }

  if (rows[0]) {
    if (!rows[0].active) return { ok: false, code: 403, error: 'That account is disabled.' };
    const { token } = await createSession(rows[0].id, req);
    await pool.query(`UPDATE daily_users SET last_login_at=now() WHERE id=$1`, [rows[0].id]);
    await logAttempt(email, clientIp(req), true);
    return { ok: true, user: await userById(rows[0].id), cookie: sessionCookie(token, SESSION_MAX_AGE), created: false };
  }

  const made = await createAccount({
    email, password: null, displayName: profile.name || profile.given_name, req,
    googleSub: sub, googleEmail: email,
  });
  return made.ok ? { ...made, created: true } : made;
}

/** Change your own password. Requires the current one — unless there isn't one
 *  yet, which is the Google-only account adding a password from Settings. */
async function changePassword({ userId, currentPassword, newPassword, req }) {
  await ensureSchema();
  const problem = passwordProblem(newPassword);
  if (problem) return { ok: false, code: 400, error: problem };
  const pool = libDb.getPool();
  const { rows } = await pool.query(`SELECT password_hash FROM daily_users WHERE id=$1`, [userId]);
  if (!rows[0]) return { ok: false, code: 404, error: 'User not found.' };
  if (rows[0].password_hash && !verifyPassword(currentPassword, rows[0].password_hash)) {
    return { ok: false, code: 401, error: 'Current password is incorrect.' };
  }
  await pool.query(
    `UPDATE daily_users SET password_hash=$2, must_change_password=FALSE WHERE id=$1`,
    [userId, hashPassword(newPassword)]);
  // Every other device is signed out, then this one is re-issued. A password
  // change that leaves an old phone signed in is not a password change.
  await destroyAllSessions(userId);
  const { token } = await createSession(userId, req);
  return { ok: true, cookie: sessionCookie(token, SESSION_MAX_AGE) };
}

// ---------------------------------------------------------------------------
// Email tokens — verification, password reset, invites
// ---------------------------------------------------------------------------

/**
 * Mint a single-use token and return the PLAINTEXT. Only its hash is stored, so
 * this return value is the one and only copy — hand it straight to the mailer
 * and never log it.
 */
async function issueEmailToken({ kind, userId = null, householdId = null, email = null }) {
  await ensureSchema();
  const ttl = kind === 'reset' ? RESET_TTL_MS : VERIFY_TTL_MS;
  const token = crypto.randomBytes(32).toString('base64url');
  // A second reset request must invalidate the first; two live reset links for
  // one account is one more than anybody needs.
  if (userId) {
    await libDb.getPool().query(
      `DELETE FROM daily_email_tokens WHERE user_id=$1 AND kind=$2 AND used_at IS NULL`,
      [userId, kind]);
  }
  await libDb.getPool().query(
    `INSERT INTO daily_email_tokens (token_hash, kind, user_id, household_id, email, expires_at)
     VALUES ($1,$2,$3,$4,$5,$6)`,
    [sha256(token), kind, userId, householdId, email ? normEmail(email) : null,
     new Date(Date.now() + ttl)]);
  return token;
}

/** Look a token up without spending it. Returns the row or null. */
async function peekEmailToken(token, kind) {
  if (!token) return null;
  await ensureSchema();
  const { rows } = await libDb.getPool().query(
    `SELECT * FROM daily_email_tokens
      WHERE token_hash=$1 AND kind=$2 AND used_at IS NULL AND expires_at > now()`,
    [sha256(token), kind]);
  return rows[0] || null;
}

/**
 * Spend a token. The UPDATE ... WHERE used_at IS NULL RETURNING is the whole
 * point: two tabs racing on the same reset link means exactly one of them gets
 * a row back, so a token can never be redeemed twice.
 */
async function consumeEmailToken(token, kind) {
  if (!token) return null;
  await ensureSchema();
  const { rows } = await libDb.getPool().query(
    `UPDATE daily_email_tokens SET used_at = now()
      WHERE token_hash=$1 AND kind=$2 AND used_at IS NULL AND expires_at > now()
      RETURNING *`,
    [sha256(token), kind]);
  return rows[0] || null;
}

async function markEmailVerified(userId) {
  await libDb.getPool().query(
    `UPDATE daily_users SET email_verified_at = COALESCE(email_verified_at, now()) WHERE id=$1`,
    [userId]);
}

/**
 * Finish a password reset. Kills every session on the account: a reset is what
 * you do when you think someone else might be in there.
 */
async function resetPassword({ token, newPassword, req }) {
  const problem = passwordProblem(newPassword);
  if (problem) return { ok: false, code: 400, error: problem };
  const row = await consumeEmailToken(token, 'reset');
  if (!row) return { ok: false, code: 400, error: 'That reset link has expired. Request a new one.' };
  await libDb.getPool().query(
    `UPDATE daily_users SET password_hash=$2, must_change_password=FALSE,
            email_verified_at = COALESCE(email_verified_at, now())
      WHERE id=$1`,
    [row.user_id, hashPassword(newPassword)]);
  await destroyAllSessions(row.user_id);
  const { token: sess } = await createSession(row.user_id, req);
  return { ok: true, user: await userById(row.user_id), cookie: sessionCookie(sess, SESSION_MAX_AGE) };
}

/** Find a user for "forgot password". Returns null rather than throwing — the
 *  route must answer identically whether or not the address exists. */
async function findUserByEmail(email) {
  await ensureSchema();
  const { rows } = await libDb.getPool().query(
    `SELECT id, email, display_name, active FROM daily_users WHERE email=$1`, [normEmail(email)]);
  return rows[0] || null;
}

// ---------------------------------------------------------------------------
// Quick sign-in (4-digit PIN, bound to one device)
// ---------------------------------------------------------------------------

/**
 * A 4-digit PIN is 10,000 guesses — worthless alone. It is safe here because it
 * is only ever HALF the credential: the other half is the 32-byte device token
 * in the HttpOnly dy_device cookie, which never leaves the browser it was
 * issued to. The same PIN typed anywhere else authenticates nothing.
 *
 * Five wrong PINs DELETE the device rows rather than starting a timed lockout.
 * With 10,000 possibilities, "try again in 15 minutes" is an invitation.
 */
async function setPin({ userId, pin, req }) {
  await ensureSchema();
  const problem = pinProblem(pin);
  if (problem) return { ok: false, code: 400, error: problem };

  const pool = libDb.getPool();
  // KEEP the browser's existing token when one is present. Minting a fresh one
  // would cut loose any other person already armed on this browser — the exact
  // bug hh_device_pins had before its key became composite.
  let token = deviceToken(req);
  if (!token) token = crypto.randomBytes(32).toString('base64url');
  const hash = sha256(token);

  // Two people on one browser must not choose the same four digits, or the
  // pin-login lookup has no way to tell which of them is typing.
  const clash = await pool.query(
    `SELECT user_id, pin_hash FROM daily_device_pins WHERE device_hash=$1 AND user_id <> $2`,
    [hash, userId]);
  for (const row of clash.rows) {
    if (verifyPassword(pin, row.pin_hash)) {
      return { ok: false, code: 409, error: 'That PIN is already used on this device. Pick another.' };
    }
  }

  await pool.query(
    `INSERT INTO daily_device_pins (device_hash, user_id, pin_hash, fails, user_agent)
     VALUES ($1,$2,$3,0,$4)
     ON CONFLICT (device_hash, user_id)
     DO UPDATE SET pin_hash=EXCLUDED.pin_hash, fails=0, user_agent=EXCLUDED.user_agent`,
    [hash, userId, hashPassword(pin), uaOf(req)]);

  return { ok: true, cookie: deviceCookie(token) };
}

async function pinStatus(req, userId = null) {
  await ensureSchema();
  const token = deviceToken(req);
  if (!token) return { armed: false, onThisDevice: false };
  const { rows } = await libDb.getPool().query(
    `SELECT user_id FROM daily_device_pins WHERE device_hash=$1`, [sha256(token)]);
  return {
    armed: rows.length > 0,
    onThisDevice: userId ? rows.some((r) => r.user_id === userId) : rows.length > 0,
  };
}

/**
 * Sign in with a PIN. The device cookie chooses the candidate rows; the PIN
 * chooses which of them. A wrong PIN increments every candidate's counter,
 * because we cannot tell who was being guessed at.
 */
async function pinLogin({ pin, req }) {
  await ensureSchema();
  if (!/^\d{4}$/.test(String(pin ?? ''))) {
    return { ok: false, code: 400, error: 'Enter your 4-digit PIN.' };
  }
  const token = deviceToken(req);
  if (!token) return { ok: false, code: 401, error: 'Quick sign-in isn’t set up on this device.' };
  const pool = libDb.getPool();
  const hash = sha256(token);

  const { rows } = await pool.query(
    `SELECT d.user_id, d.pin_hash, d.fails, u.active
       FROM daily_device_pins d JOIN daily_users u ON u.id = d.user_id
      WHERE d.device_hash=$1`, [hash]);
  if (!rows.length) return { ok: false, code: 401, error: 'Quick sign-in isn’t set up on this device.' };

  const hit = rows.find((r) => r.active && verifyPassword(pin, r.pin_hash));
  if (!hit) {
    const { rows: after } = await pool.query(
      `UPDATE daily_device_pins SET fails = fails + 1 WHERE device_hash=$1 RETURNING fails`, [hash]);
    const worst = Math.max(0, ...after.map((r) => r.fails));
    if (worst >= MAX_PIN_FAILS) {
      await pool.query(`DELETE FROM daily_device_pins WHERE device_hash=$1`, [hash]);
      return {
        ok: false, code: 401, forgotten: true, cookie: clearDeviceCookie(),
        error: 'Too many wrong PINs. Sign in with your email and password.',
      };
    }
    return { ok: false, code: 401, error: `Wrong PIN. ${MAX_PIN_FAILS - worst} attempts left.` };
  }

  await pool.query(
    `UPDATE daily_device_pins SET fails=0, last_used_at=now() WHERE device_hash=$1 AND user_id=$2`,
    [hash, hit.user_id]);
  const { token: sess } = await createSession(hit.user_id, req);
  await pool.query(`UPDATE daily_users SET last_login_at=now() WHERE id=$1`, [hit.user_id]);
  return { ok: true, user: await userById(hit.user_id), cookie: sessionCookie(sess, SESSION_MAX_AGE) };
}

/** Forget this browser for this person. Deliberately explicit — signing out
 *  does NOT do this, because quick sign-in is what signing out recovers from. */
async function removePin({ userId, req }) {
  await ensureSchema();
  const token = deviceToken(req);
  if (!token) return { ok: true };
  const hash = sha256(token);
  await libDb.getPool().query(
    `DELETE FROM daily_device_pins WHERE device_hash=$1 AND user_id=$2`, [hash, userId]);
  const { rows } = await libDb.getPool().query(
    `SELECT 1 FROM daily_device_pins WHERE device_hash=$1 LIMIT 1`, [hash]);
  // Only drop the browser's device cookie once nobody is using it any more.
  return { ok: true, cookie: rows.length ? undefined : clearDeviceCookie() };
}

// ---------------------------------------------------------------------------
// Subscription gate
// ---------------------------------------------------------------------------

/**
 * Statuses that may use the app.
 *
 * past_due is IN, on purpose. A card that expired on the 3rd should not lock
 * someone out of their grocery list on the 3rd — Stripe retries for days, and
 * the app shows a banner throughout. Stripe moves the subscription to `unpaid`
 * or `canceled` when it finally gives up, and those are out.
 */
const ACTIVE_SUB = new Set(['active', 'trialing', 'past_due']);

function subscriptionOk(user) {
  // Mirrors subscriptionProblem() — these two must never disagree, or the SPA
  // draws a paywall the server would have let through (or worse, the reverse).
  if (isAdmin(user)) return true;
  return ACTIVE_SUB.has(String(user?.sub_status || 'none'));
}

/**
 * The whole entitlement decision, in one place, so a route never has to reason
 * about statuses. Returns null when the caller may proceed, or a
 * { code, reason } to send back.
 */
function subscriptionProblem(user) {
  // The site owner is never billed and is never locked out. This is the ONLY
  // bypass, and it is here rather than sprinkled through the routes so that
  // "who can use the app without paying" is one function you can read.
  //
  // It deliberately does not fake a subscription row: statusFor() still reports
  // the truth, so the Settings screen says "no subscription" for an admin rather
  // than inventing a plan that Stripe has never heard of.
  if (isAdmin(user)) return null;

  const status = String(user?.sub_status || 'none');
  if (ACTIVE_SUB.has(status)) return null;
  if (status === 'none') return { code: 402, reason: 'subscription-required' };
  return { code: 402, reason: `subscription-${status}` };
}

async function subscriptionFor(householdId) {
  await ensureSchema();
  const { rows } = await libDb.getPool().query(
    `SELECT * FROM daily_subscriptions WHERE household_id=$1`, [householdId]);
  return rows[0] || null;
}

// ---------------------------------------------------------------------------
// Household members
// ---------------------------------------------------------------------------

async function householdMembers(householdId) {
  await ensureSchema();
  const { rows } = await libDb.getPool().query(
    `SELECT id, email, display_name, role, email_verified_at, last_login_at, created_at
       FROM daily_users WHERE household_id=$1 AND active ORDER BY id`, [householdId]);
  return rows;
}

async function removeMember({ householdId, userId }) {
  await ensureSchema();
  const pool = libDb.getPool();
  const { rows } = await pool.query(
    `SELECT role FROM daily_users WHERE id=$1 AND household_id=$2`, [userId, householdId]);
  if (!rows[0]) return { ok: false, code: 404, error: 'No such member.' };
  if (rows[0].role === 'owner') return { ok: false, code: 400, error: 'The account owner can’t be removed.' };
  // Deactivate rather than DELETE: their name is on rows all over the household
  // (checked_by, done_by, created_by) and a hard delete would either cascade
  // those away or leave dangling ids.
  await pool.query(`UPDATE daily_users SET active=FALSE WHERE id=$1`, [userId]);
  await destroyAllSessions(userId);
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Settings
// ---------------------------------------------------------------------------

const SETTING_DEFAULTS = {
  weatherZip: '',
  /** Which market feeds the Markets tab shows. Both on by default — it is the
   *  reason a CB Edge customer would pick this over any other planner. */
  showEconCalendar: true,
  showEarnings: true,
  /** Home screen ordering, so someone who never uses Money can push it down. */
  todayOrder: null,
};

async function getSettings(userId) {
  await ensureSchema();
  const { rows } = await libDb.getPool().query(
    `SELECT key, value FROM daily_settings WHERE user_id=$1`, [userId]);
  const out = { ...SETTING_DEFAULTS };
  for (const r of rows) out[r.key] = r.value;
  return out;
}

async function putSettings(userId, patch) {
  await ensureSchema();
  const pool = libDb.getPool();
  for (const [key, value] of Object.entries(patch || {})) {
    if (!(key in SETTING_DEFAULTS)) continue; // ignore unknown keys rather than storing junk
    await pool.query(
      `INSERT INTO daily_settings (user_id, key, value) VALUES ($1,$2,$3)
       ON CONFLICT (user_id, key) DO UPDATE SET value=EXCLUDED.value`,
      [userId, key, JSON.stringify(value)]);
  }
  return getSettings(userId);
}

// ---------------------------------------------------------------------------

module.exports = {
  available, ensureSchema,
  // tenancy
  scoped, assertOwned, HOUSEHOLD_SEATS,
  // identity
  userFromRequest, userById, findUserByEmail, householdMembers, removeMember,
  createAccount, joinHousehold, login, loginWithGoogle, changePassword,
  // sessions
  createSession, destroySession, destroyAllSessions, refreshSession, shouldSlide,
  sessionCookie, clearCookie, SESSION_MAX_AGE, SESSION_DAYS,
  // pins
  setPin, pinLogin, pinStatus, removePin, deviceCookie, clearDeviceCookie,
  // email tokens
  issueEmailToken, peekEmailToken, consumeEmailToken, markEmailVerified, resetPassword,
  // billing gate
  subscriptionOk, subscriptionProblem, subscriptionFor,
  // site owner
  isAdmin, ADMIN_EMAILS,
  // settings
  getSettings, putSettings, SETTING_DEFAULTS,
  // primitives other daily modules need
  pool: () => libDb.getPool(),
  parseCookies, clientIp, sha256, normEmail, emailProblem,
  hashPassword, verifyPassword, passwordProblem, pinProblem,
};
