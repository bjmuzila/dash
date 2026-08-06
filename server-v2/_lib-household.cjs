'use strict';
/**
 * server-v2/_lib-household.cjs — auth + storage for budget.cbedge.net.
 *
 * WHY THIS IS SEPARATE FROM CB EDGE AUTH
 *   budget.cbedge.net is the household life-OS. It must NOT share an identity
 *   with cbedge.net: a CB Edge customer session grants nothing here, and the
 *   household cookie can never be sent to the main site. That is enforced two
 *   ways:
 *     1. Different cookie NAME (hh_session, not cbe_session).
 *     2. The Set-Cookie carries NO Domain attribute, so the browser scopes it
 *        host-only to budget.cbedge.net. Never add `Domain=.cbedge.net` here —
 *        that would leak the household session to every subdomain including
 *        the customer app.
 *   The owner gate (OWNER_USER_ID / users.is_owner) is untouched. /owner/budget
 *   on cbedge.net keeps working exactly as before.
 *
 * TABLES
 *   Self-bootstrapping via CREATE TABLE IF NOT EXISTS on first use — the same
 *   pattern api-router.js uses for day_posts and cb-contract-track uses for its
 *   own tables. No migration runner, nothing to remember on deploy.
 *
 * BUDGET DATA
 *   NOT duplicated. app/api/budget already scopes every row by profile_id via
 *   getOrCreateBudgetProfile(key) — the single existing profile is keyed
 *   'owner'. A household user carries budget_profile_key; both users defaulting
 *   to 'owner' means they share the existing register with zero migration.
 *   Point one at another key later and that person gets a private budget.
 *
 * PASSWORDS
 *   scrypt from node:crypto. No new dependency, no native build step.
 *   Stored as  scrypt$<N>$<r>$<p>$<saltB64>$<hashB64>.
 *
 * SESSIONS
 *   The cookie holds a 32-byte random token. The DB stores only its SHA-256, so
 *   a database dump does not hand anyone a live session.
 */

const crypto = require('crypto');

let libDb = null;
try { libDb = require('./_lib-db.cjs'); }
catch (e) { console.warn('[household] _lib-db.cjs not loaded — household routes disabled:', e.message); }

const COOKIE_NAME = 'hh_session';
const SESSION_DAYS = 30;
const SESSION_MS = SESSION_DAYS * 24 * 60 * 60 * 1000;
// Re-issue the cookie when the session is more than a day old (sliding window)
// so a daily user is never logged out, but an abandoned session still expires.
const SLIDE_AFTER_MS = 24 * 60 * 60 * 1000;

const MAX_FAILS = 5;
const LOCKOUT_MS = 15 * 60 * 1000;

const SCRYPT = { N: 16384, r: 8, p: 1, keylen: 64 };

// ---------------------------------------------------------------------------
// Schema
// ---------------------------------------------------------------------------

let ready = null;
async function ensureSchema() {
  if (!libDb) throw new Error('household: no database');
  if (ready) return ready;
  ready = (async () => {
    const pool = libDb.getPool();
    await pool.query(`
      CREATE TABLE IF NOT EXISTS hh_users (
        id                   SERIAL PRIMARY KEY,
        email                TEXT NOT NULL UNIQUE,
        password_hash        TEXT NOT NULL,
        display_name         TEXT NOT NULL,
        budget_profile_key   TEXT NOT NULL DEFAULT 'owner',
        tz                   TEXT NOT NULL DEFAULT 'America/New_York',
        must_change_password BOOLEAN NOT NULL DEFAULT TRUE,
        active               BOOLEAN NOT NULL DEFAULT TRUE,
        created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
        last_login_at        TIMESTAMPTZ
      )`);
    await pool.query(`
      CREATE TABLE IF NOT EXISTS hh_sessions (
        token_hash TEXT PRIMARY KEY,
        user_id    INTEGER NOT NULL REFERENCES hh_users(id) ON DELETE CASCADE,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        expires_at TIMESTAMPTZ NOT NULL,
        user_agent TEXT,
        ip         TEXT
      )`);
    await pool.query(`CREATE INDEX IF NOT EXISTS hh_sessions_user_idx ON hh_sessions(user_id)`);
    await pool.query(`
      CREATE TABLE IF NOT EXISTS hh_login_attempts (
        id    SERIAL PRIMARY KEY,
        email TEXT NOT NULL,
        ip    TEXT,
        ok    BOOLEAN NOT NULL,
        at    TIMESTAMPTZ NOT NULL DEFAULT now()
      )`);
    await pool.query(`CREATE INDEX IF NOT EXISTS hh_login_attempts_email_at_idx ON hh_login_attempts(email, at DESC)`);

    // ── Life-OS tables (phase 1 uses tasks + notes; created now so step 4 is
    //    routes and UI only) ─────────────────────────────────────────────────
    // owner_id + visibility is THE per-person / opt-in-sharing pattern:
    //   read : owner_id = :me OR visibility = 'shared'
    //   write: owner_id = :me OR visibility = 'shared'
    // 'private' means only its owner sees it. 'shared' means both of you can
    // see AND edit it — a shared list only one person can change is useless.
    await pool.query(`
      CREATE TABLE IF NOT EXISTS hh_tasks (
        id         SERIAL PRIMARY KEY,
        owner_id   INTEGER NOT NULL REFERENCES hh_users(id) ON DELETE CASCADE,
        visibility TEXT NOT NULL DEFAULT 'private',
        title      TEXT NOT NULL,
        notes      TEXT,
        due_date   DATE,
        starred    BOOLEAN NOT NULL DEFAULT FALSE,
        project    TEXT,
        done_at    TIMESTAMPTZ,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        touched_at TIMESTAMPTZ NOT NULL DEFAULT now()
      )`);
    await pool.query(`CREATE INDEX IF NOT EXISTS hh_tasks_open_idx ON hh_tasks(owner_id, done_at, due_date)`);
    await pool.query(`
      CREATE TABLE IF NOT EXISTS hh_notes (
        id              SERIAL PRIMARY KEY,
        owner_id        INTEGER NOT NULL REFERENCES hh_users(id) ON DELETE CASCADE,
        visibility      TEXT NOT NULL DEFAULT 'private',
        kind            TEXT NOT NULL DEFAULT 'note',
        body            TEXT NOT NULL,
        created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
        last_surfaced_at TIMESTAMPTZ
      )`);
    // ── Routines & habits ────────────────────────────────────────────────
    // A routine is a recurring intention, not a task: it never "completes", it
    // just gets done again tomorrow. So the item and the daily tick are
    // separate tables — one row per routine, one row per (routine, day).
    await pool.query(`
      CREATE TABLE IF NOT EXISTS hh_routines (
        id         SERIAL PRIMARY KEY,
        owner_id   INTEGER NOT NULL REFERENCES hh_users(id) ON DELETE CASCADE,
        visibility TEXT NOT NULL DEFAULT 'private',
        title      TEXT NOT NULL,
        block      TEXT NOT NULL DEFAULT 'morning',
        sort_order INTEGER NOT NULL DEFAULT 0,
        active     BOOLEAN NOT NULL DEFAULT TRUE,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now()
      )`);
    // PRIMARY KEY (routine_id, day) is what makes ticking idempotent: a double
    // tap on a slow connection can't log the same day twice, and a shared
    // routine ticked by one person is simply done for the household.
    // `day` is a DATE in the user's timezone, resolved before it gets here —
    // never now()::date, which would roll over at 8pm Eastern.
    await pool.query(`
      CREATE TABLE IF NOT EXISTS hh_routine_log (
        routine_id INTEGER NOT NULL REFERENCES hh_routines(id) ON DELETE CASCADE,
        day        DATE NOT NULL,
        done_by    INTEGER REFERENCES hh_users(id) ON DELETE SET NULL,
        done_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
        PRIMARY KEY (routine_id, day)
      )`);
    await pool.query(`CREATE INDEX IF NOT EXISTS hh_routine_log_day_idx ON hh_routine_log(day DESC)`);

    // Urgent is separate from `starred`. Starred means "one of my Top 3 today";
    // urgent means "this can't wait". Overloading one flag would make pinning
    // something to Today silently mark it as an emergency.
    await pool.query(`ALTER TABLE hh_tasks ADD COLUMN IF NOT EXISTS urgent BOOLEAN NOT NULL DEFAULT FALSE`);

    // ── Lists: meals by day, and the grocery list they feed ──────────────
    // A meal is planned for a DAY. Its ingredients are ordinary list items that
    // carry meal_id, so the same row can be ticked off in the shop and still
    // show under Tuesday on the week board — one record, two views.
    await pool.query(`
      CREATE TABLE IF NOT EXISTS hh_meals (
        id         SERIAL PRIMARY KEY,
        owner_id   INTEGER NOT NULL REFERENCES hh_users(id) ON DELETE CASCADE,
        visibility TEXT NOT NULL DEFAULT 'shared',
        day        DATE NOT NULL,
        title      TEXT NOT NULL,
        notes      TEXT,
        sort_order INTEGER NOT NULL DEFAULT 0,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now()
      )`);
    await pool.query(`CREATE INDEX IF NOT EXISTS hh_meals_day_idx ON hh_meals(day)`);
    // ON DELETE SET NULL, not CASCADE: deleting "Taco night" must not silently
    // remove the tortillas from your grocery list — you may still want them.
    await pool.query(`
      CREATE TABLE IF NOT EXISTS hh_list_items (
        id         SERIAL PRIMARY KEY,
        owner_id   INTEGER NOT NULL REFERENCES hh_users(id) ON DELETE CASCADE,
        visibility TEXT NOT NULL DEFAULT 'shared',
        list       TEXT NOT NULL DEFAULT 'grocery',
        text       TEXT NOT NULL,
        qty        TEXT,
        aisle      TEXT NOT NULL DEFAULT 'other',
        meal_id    INTEGER REFERENCES hh_meals(id) ON DELETE SET NULL,
        checked_at TIMESTAMPTZ,
        checked_by INTEGER REFERENCES hh_users(id) ON DELETE SET NULL,
        sort_order INTEGER NOT NULL DEFAULT 0,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now()
      )`);
    await pool.query(`CREATE INDEX IF NOT EXISTS hh_list_items_list_idx ON hh_list_items(list, checked_at)`);
    await pool.query(`CREATE INDEX IF NOT EXISTS hh_list_items_meal_idx ON hh_list_items(meal_id)`);

    // ── Projects ─────────────────────────────────────────────────────────
    // A project groups work and shows how far along it is. Progress is computed
    // from MILESTONES, not from tasks: a project with 40 small tasks and 3 real
    // milestones reads as 80% done when you've knocked out the easy tasks, which
    // is the exact lie a progress bar exists to prevent.
    await pool.query(`
      CREATE TABLE IF NOT EXISTS hh_projects (
        id          SERIAL PRIMARY KEY,
        owner_id    INTEGER NOT NULL REFERENCES hh_users(id) ON DELETE CASCADE,
        visibility  TEXT NOT NULL DEFAULT 'private',
        name        TEXT NOT NULL,
        description TEXT,
        status      TEXT NOT NULL DEFAULT 'active',
        color       TEXT,
        target_date DATE,
        created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
        archived_at TIMESTAMPTZ
      )`);
    await pool.query(`
      CREATE TABLE IF NOT EXISTS hh_milestones (
        id         SERIAL PRIMARY KEY,
        project_id INTEGER NOT NULL REFERENCES hh_projects(id) ON DELETE CASCADE,
        title      TEXT NOT NULL,
        sort_order INTEGER NOT NULL DEFAULT 0,
        done_at    TIMESTAMPTZ,
        done_by    INTEGER REFERENCES hh_users(id) ON DELETE SET NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now()
      )`);
    await pool.query(`CREATE INDEX IF NOT EXISTS hh_milestones_project_idx ON hh_milestones(project_id, sort_order)`);
    // Time logging. Stored in whole minutes — a stopwatch is more precision than
    // anyone reviews, and minutes keep every total exact in integer arithmetic.
    await pool.query(`
      CREATE TABLE IF NOT EXISTS hh_time_log (
        id         SERIAL PRIMARY KEY,
        project_id INTEGER NOT NULL REFERENCES hh_projects(id) ON DELETE CASCADE,
        user_id    INTEGER NOT NULL REFERENCES hh_users(id) ON DELETE CASCADE,
        day        DATE NOT NULL,
        minutes    INTEGER NOT NULL,
        note       TEXT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now()
      )`);
    await pool.query(`CREATE INDEX IF NOT EXISTS hh_time_log_project_idx ON hh_time_log(project_id, day DESC)`);
    // Tasks gain a real project link. Added as an ALTER because hh_tasks already
    // exists on the deployed box — CREATE TABLE IF NOT EXISTS would skip it.
    // The old free-text `project` column stays for anything already using it.
    await pool.query(`ALTER TABLE hh_tasks ADD COLUMN IF NOT EXISTS project_id INTEGER REFERENCES hh_projects(id) ON DELETE SET NULL`);
    await pool.query(`CREATE INDEX IF NOT EXISTS hh_tasks_project_idx ON hh_tasks(project_id)`);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS hh_settings (
        user_id INTEGER NOT NULL REFERENCES hh_users(id) ON DELETE CASCADE,
        key     TEXT NOT NULL,
        value   JSONB NOT NULL,
        PRIMARY KEY (user_id, key)
      )`);
    // Google Calendar tokens live server-side only; the SPA never sees one.
    await pool.query(`
      CREATE TABLE IF NOT EXISTS hh_google_tokens (
        user_id       INTEGER PRIMARY KEY REFERENCES hh_users(id) ON DELETE CASCADE,
        google_email  TEXT,
        refresh_token TEXT NOT NULL,
        access_token  TEXT,
        expires_at    TIMESTAMPTZ,
        scope         TEXT,
        updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
      )`);
    // Added after the table shipped, so these are separate ALTERs rather than
    // part of the CREATE — an existing deployment already has the table and
    // CREATE TABLE IF NOT EXISTS would skip new columns silently.
    //   share_with_household — one person connects, both see the events. This
    //     is what makes a shared family calendar work without the other person
    //     doing the Google dance at all.
    //   selected_calendars   — JSON array of calendar ids to actually show.
    //     NULL means "not chosen yet" and falls back to the primary calendar;
    //     an empty array means "deliberately none".
    await pool.query(`ALTER TABLE hh_google_tokens ADD COLUMN IF NOT EXISTS share_with_household BOOLEAN NOT NULL DEFAULT FALSE`);
    await pool.query(`ALTER TABLE hh_google_tokens ADD COLUMN IF NOT EXISTS selected_calendars JSONB`);
    return true;
  })().catch((e) => { ready = null; throw e; });
  return ready;
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
    // Constant-time — a length mismatch would make timingSafeEqual throw.
    if (actual.length !== expected.length) return false;
    return crypto.timingSafeEqual(actual, expected);
  } catch { return false; }
}

// A password policy that is actually enforceable for two people who will pick
// their own: length is the only thing that reliably buys entropy.
function passwordProblem(plain) {
  const s = String(plain || '');
  if (s.length < 10) return 'Password must be at least 10 characters.';
  if (s.length > 200) return 'Password is too long.';
  return null;
}

// ---------------------------------------------------------------------------
// Users
// ---------------------------------------------------------------------------

const normEmail = (e) => String(e || '').trim().toLowerCase();

const PUBLIC_USER_COLS = `id, email, display_name, budget_profile_key, tz,
  must_change_password, active, created_at, last_login_at`;

async function createUser({ email, displayName, password, budgetProfileKey = 'owner', tz = 'America/New_York' }) {
  await ensureSchema();
  const problem = passwordProblem(password);
  if (problem) throw new Error(problem);
  const pool = libDb.getPool();
  const { rows } = await pool.query(
    `INSERT INTO hh_users (email, password_hash, display_name, budget_profile_key, tz)
     VALUES ($1,$2,$3,$4,$5)
     ON CONFLICT (email) DO NOTHING
     RETURNING ${PUBLIC_USER_COLS}`,
    [normEmail(email), hashPassword(password), String(displayName || '').trim() || normEmail(email), budgetProfileKey, tz],
  );
  if (!rows[0]) throw new Error(`user already exists: ${normEmail(email)}`);
  return rows[0];
}

async function listUsers() {
  await ensureSchema();
  const { rows } = await libDb.getPool().query(
    `SELECT ${PUBLIC_USER_COLS} FROM hh_users ORDER BY id`);
  return rows;
}

async function setPassword(email, password) {
  await ensureSchema();
  const problem = passwordProblem(password);
  if (problem) throw new Error(problem);
  const { rowCount } = await libDb.getPool().query(
    `UPDATE hh_users SET password_hash=$2, must_change_password=FALSE WHERE email=$1`,
    [normEmail(email), hashPassword(password)]);
  if (!rowCount) throw new Error(`no such user: ${normEmail(email)}`);
  return true;
}

// ---------------------------------------------------------------------------
// Login throttling
// ---------------------------------------------------------------------------

async function recentFailures(email) {
  const { rows } = await libDb.getPool().query(
    `SELECT COUNT(*)::int AS n FROM hh_login_attempts
      WHERE email=$1 AND ok=FALSE AND at > now() - ($2::int * interval '1 millisecond')`,
    [normEmail(email), LOCKOUT_MS]);
  return rows[0]?.n ?? 0;
}

async function logAttempt(email, ip, ok) {
  try {
    await libDb.getPool().query(
      `INSERT INTO hh_login_attempts (email, ip, ok) VALUES ($1,$2,$3)`,
      [normEmail(email), ip || null, !!ok]);
  } catch { /* never let the audit log break a login */ }
}

// ---------------------------------------------------------------------------
// Sessions
// ---------------------------------------------------------------------------

const sha256 = (s) => crypto.createHash('sha256').update(String(s)).digest('hex');

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

// NOTE the deliberate absence of `Domain=`. Host-only cookie — see the header
// comment. Secure is on always: budget.cbedge.net is HTTPS via the tunnel.
function sessionCookie(token, maxAgeSec) {
  return [
    `${COOKIE_NAME}=${encodeURIComponent(token)}`,
    'Path=/',
    'HttpOnly',
    'Secure',
    'SameSite=Lax',
    `Max-Age=${maxAgeSec}`,
  ].join('; ');
}

const clearCookie = () => `${COOKIE_NAME}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`;

async function createSession(userId, req) {
  const token = crypto.randomBytes(32).toString('base64url');
  const expires = new Date(Date.now() + SESSION_MS);
  await libDb.getPool().query(
    `INSERT INTO hh_sessions (token_hash, user_id, expires_at, user_agent, ip)
     VALUES ($1,$2,$3,$4,$5)`,
    [sha256(token), userId, expires,
     String(req?.headers?.['user-agent'] || '').slice(0, 300) || null, clientIp(req)]);
  return { token, expires };
}

function clientIp(req) {
  const fwd = req?.headers?.['cf-connecting-ip'] || req?.headers?.['x-forwarded-for'];
  if (fwd) return String(fwd).split(',')[0].trim().slice(0, 64);
  return String(req?.socket?.remoteAddress || '').slice(0, 64) || null;
}

/** Resolve the household user for a request, or null. Never throws. */
async function userFromRequest(req) {
  if (!libDb) return null;
  try {
    const token = parseCookies(req)[COOKIE_NAME];
    if (!token) return null;
    await ensureSchema();
    const { rows } = await libDb.getPool().query(
      `SELECT u.id, u.email, u.display_name, u.budget_profile_key, u.tz,
              u.must_change_password, u.active, s.created_at AS session_created_at
         FROM hh_sessions s JOIN hh_users u ON u.id = s.user_id
        WHERE s.token_hash = $1 AND s.expires_at > now()`,
      [sha256(token)]);
    const u = rows[0];
    if (!u || !u.active) return null;
    return u;
  } catch { return null; }
}

/** True when the cookie is old enough to be worth re-issuing (sliding window). */
function shouldSlide(user) {
  const created = user?.session_created_at ? new Date(user.session_created_at).getTime() : 0;
  return created > 0 && Date.now() - created > SLIDE_AFTER_MS;
}

async function refreshSession(req) {
  const token = parseCookies(req)[COOKIE_NAME];
  if (!token) return null;
  const expires = new Date(Date.now() + SESSION_MS);
  await libDb.getPool().query(
    `UPDATE hh_sessions SET expires_at=$2, created_at=now() WHERE token_hash=$1`,
    [sha256(token), expires]);
  return { token, expires };
}

async function destroySession(req) {
  const token = parseCookies(req)[COOKIE_NAME];
  if (!token) return;
  try {
    await libDb.getPool().query(`DELETE FROM hh_sessions WHERE token_hash=$1`, [sha256(token)]);
  } catch { /* signing out is best-effort; the cookie is cleared regardless */ }
}

async function destroyAllSessions(userId) {
  await libDb.getPool().query(`DELETE FROM hh_sessions WHERE user_id=$1`, [userId]);
}

/** Opportunistic cleanup so hh_sessions doesn't grow forever. */
async function pruneSessions() {
  try { await libDb.getPool().query(`DELETE FROM hh_sessions WHERE expires_at < now()`); }
  catch { /* ignore */ }
}

// ---------------------------------------------------------------------------
// Login
// ---------------------------------------------------------------------------

/**
 * Returns { ok:true, user, cookie } or { ok:false, code, error }.
 * Deliberately returns the SAME message for unknown-email and wrong-password —
 * with exactly two accounts, distinguishing them tells an attacker which email
 * is real.
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

  const { rows } = await libDb.getPool().query(
    `SELECT id, email, password_hash, display_name, budget_profile_key, tz,
            must_change_password, active
       FROM hh_users WHERE email=$1`, [e]);
  const u = rows[0];

  // Burn roughly the same CPU on an unknown email as on a real one so response
  // time doesn't leak which addresses exist.
  if (!u || !u.active) {
    verifyPassword(String(password), hashPassword('decoy-not-a-real-password'));
    await logAttempt(e, ip, false);
    return { ok: false, code: 401, error: 'Email or password is incorrect.' };
  }

  if (!verifyPassword(password, u.password_hash)) {
    await logAttempt(e, ip, false);
    return { ok: false, code: 401, error: 'Email or password is incorrect.' };
  }

  await logAttempt(e, ip, true);
  void pruneSessions();
  const { token } = await createSession(u.id, req);
  await libDb.getPool().query(`UPDATE hh_users SET last_login_at=now() WHERE id=$1`, [u.id]);

  delete u.password_hash;
  return { ok: true, user: u, cookie: sessionCookie(token, SESSION_DAYS * 24 * 60 * 60) };
}

/** Change your own password. Requires the current one. Kills other sessions. */
async function changePassword({ userId, currentPassword, newPassword, req }) {
  await ensureSchema();
  const problem = passwordProblem(newPassword);
  if (problem) return { ok: false, code: 400, error: problem };
  const pool = libDb.getPool();
  const { rows } = await pool.query(`SELECT password_hash FROM hh_users WHERE id=$1`, [userId]);
  if (!rows[0]) return { ok: false, code: 404, error: 'User not found.' };
  if (!verifyPassword(currentPassword, rows[0].password_hash)) {
    return { ok: false, code: 401, error: 'Current password is incorrect.' };
  }
  await pool.query(
    `UPDATE hh_users SET password_hash=$2, must_change_password=FALSE WHERE id=$1`,
    [userId, hashPassword(newPassword)]);
  // Every other device gets signed out, then this one is re-issued.
  await destroyAllSessions(userId);
  const { token } = await createSession(userId, req);
  return { ok: true, cookie: sessionCookie(token, SESSION_DAYS * 24 * 60 * 60) };
}

// ---------------------------------------------------------------------------
// Settings (per user, JSONB key/value)
// ---------------------------------------------------------------------------

const DEFAULT_SETTINGS = {
  // Days an open task can go untouched before Today flags it as "Slipping".
  // Changeable per person without a deploy.
  slippingDays: 7,
};

async function getSettings(userId) {
  await ensureSchema();
  const { rows } = await libDb.getPool().query(
    `SELECT key, value FROM hh_settings WHERE user_id=$1`, [userId]);
  const out = { ...DEFAULT_SETTINGS };
  for (const r of rows) out[r.key] = r.value;
  return out;
}

async function setSetting(userId, key, value) {
  await ensureSchema();
  await libDb.getPool().query(
    `INSERT INTO hh_settings (user_id, key, value) VALUES ($1,$2,$3)
     ON CONFLICT (user_id, key) DO UPDATE SET value = EXCLUDED.value`,
    [userId, String(key), JSON.stringify(value)]);
  return getSettings(userId);
}

module.exports = {
  COOKIE_NAME,
  SESSION_DAYS,
  DEFAULT_SETTINGS,
  getSettings,
  setSetting,
  /** Raw pg pool, for the route module's task/note queries. */
  pool: () => libDb.getPool(),
  ensureSchema,
  hashPassword,
  verifyPassword,
  passwordProblem,
  createUser,
  listUsers,
  setPassword,
  login,
  changePassword,
  userFromRequest,
  shouldSlide,
  refreshSession,
  destroySession,
  destroyAllSessions,
  sessionCookie,
  clearCookie,
  clientIp,
  available: () => !!libDb,
};
