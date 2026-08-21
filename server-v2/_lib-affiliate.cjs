'use strict';
/**
 * server-v2/_lib-affiliate.cjs — storage + auth for affiliate.cbedge.net.
 *
 * WHY THIS IS SEPARATE FROM CB EDGE AUTH (and from household auth)
 *   An affiliate is not a customer. Most of them will never hold a cbedge.net
 *   subscription, and the ones who do must not get an affiliate dashboard for
 *   free — so this app carries its OWN identity, exactly like the household
 *   app does:
 *     1. Different cookie NAME (aff_session, not cbe_session / hh_session).
 *     2. The Set-Cookie carries NO Domain attribute, so the browser scopes it
 *        host-only to affiliate.cbedge.net. NEVER add `Domain=.cbedge.net` —
 *        that would hand the affiliate cookie to the customer app.
 *   The one deliberate exception is the ATTRIBUTION cookie (cbe_ref) minted by
 *   the click redirect below: that one IS domain-wide, because its whole job is
 *   to survive the hop from affiliate.cbedge.net to cbedge.net/pricing. It
 *   carries a public referral code and nothing else — no session, no identity.
 *
 * TABLES
 *   Self-bootstrapping via CREATE TABLE IF NOT EXISTS on first use — the same
 *   pattern _lib-household.cjs and cb-contract-track.js use. No migration
 *   runner, nothing to remember on deploy. This module is required lazily by
 *   server-v2/affiliate-routes.cjs, and if _lib-db.cjs is missing the routes
 *   simply never register.
 *
 * PASSWORDS
 *   scrypt from node:crypto, stored as scrypt$<N>$<r>$<p>$<salt>$<hash>.
 *   Copied deliberately from _lib-household.cjs rather than shared: these two
 *   apps must be able to change their own password policy without touching
 *   each other.
 *
 * MONEY
 *   Every amount is an INTEGER of CENTS. There is no float anywhere in this
 *   file, and there must never be one — a 15% commission on $148.50 is 2227.5
 *   cents, and the rounding of that half-cent has to happen in exactly one
 *   place (commissionCents below), not wherever a page happens to multiply.
 *
 * THE APPROVAL RULE
 *   Nothing an affiliate does takes effect on its own. Applying creates a
 *   `pending` row with NO code. Approval is what issues the code and flips the
 *   dashboard on. A code EDIT does not change aff_affiliates.code — it writes
 *   an aff_code_requests row and waits. Same for payouts: commission accrues
 *   automatically, but a payout is only ever `paid` because the owner said so.
 */

const crypto = require('crypto');

let libDb = null;
try { libDb = require('./_lib-db.cjs'); }
catch (e) { console.warn('[affiliate] _lib-db.cjs not loaded — affiliate routes disabled:', e.message); }

const COOKIE_NAME = 'aff_session';
const SESSION_DAYS = 30;
const SESSION_MS = SESSION_DAYS * 24 * 60 * 60 * 1000;
const SLIDE_AFTER_MS = 24 * 60 * 60 * 1000;

/** The domain-wide attribution cookie. Public code only — never a session. */
const REF_COOKIE = 'cbe_ref';
const REF_COOKIE_DOMAIN = (process.env.AFFILIATE_COOKIE_DOMAIN || '.cbedge.net').trim();
const DEFAULT_COOKIE_DAYS = 60;

const MAX_FAILS = 5;
const LOCKOUT_MS = 15 * 60 * 1000;

const SCRYPT = { N: 16384, r: 8, p: 1, keylen: 64 };

/**
 * THE RATE. A flat 20% of collected revenue, the same for everybody.
 *
 * There are no tiers. A tier ladder only earns its complexity when the top rung
 * is worth chasing, and when the whole ladder is one number there is nothing to
 * chase — it just gives every applicant a reason to ask why they are not on the
 * good rate yet, and gives the owner a per-affiliate decision to make on every
 * approval that has no right answer.
 *
 * `tier_pct` on aff_affiliates is kept as the COLUMN NAME (renaming it would
 * churn every query and the payout rows already written for no gain), but it
 * now means "this affiliate's rate", and it is 20 unless someone deliberately
 * overrode it in the approve dialog.
 */
const RATE_PCT = Math.max(0, Math.min(100, Number(process.env.AFFILIATE_RATE_PCT || 20)));

/**
 * Typo guard, not a policy. The rate only ever arrives from the owner's own
 * input, so this exists so a fat-fingered "200" cannot quietly commit the
 * business to paying twice what it collects. Anything at or under this is
 * accepted verbatim.
 */
const MAX_RATE_PCT = 50;

/** Payout rails. Stripe + PayPal + Zelle — nothing else is wired. */
const PAYOUT_METHODS = ['stripe', 'paypal', 'zelle'];

/**
 * Codes nobody may own. These read as official ("use code CBEDGE") and would
 * let one affiliate collect on traffic the brand earned. Checked on apply, on
 * a code-edit request, and again at approval time, because the owner can type
 * a replacement code by hand in the approve dialog.
 */
const RESERVED_CODES = new Set([
  'CBEDGE', 'CB', 'EDGE', 'ADMIN', 'OWNER', 'SUPPORT', 'HELP', 'BILLING',
  'FREE', 'TRIAL', 'TEST', 'DEMO', 'OFFICIAL', 'STAFF', 'TEAM', 'GEX', 'SPX',
]);

// ---------------------------------------------------------------------------
// Schema
// ---------------------------------------------------------------------------

let ready = null;
async function ensureSchema() {
  if (!libDb) throw new Error('affiliate: no database');
  if (ready) return ready;
  ready = (async () => {
    const pool = libDb.getPool();

    // One row per applicant, from the moment they submit the form. `code` is
    // NULL until approval — that NULL is the source of truth for "not live
    // yet", which is why it is nullable rather than pre-filled with the
    // requested code. requested_code keeps what they asked for so the owner
    // review screen can show it without inventing state.
    await pool.query(`
      CREATE TABLE IF NOT EXISTS aff_affiliates (
        id                SERIAL PRIMARY KEY,
        email             TEXT NOT NULL UNIQUE,
        password_hash     TEXT NOT NULL,
        name              TEXT NOT NULL,
        status            TEXT NOT NULL DEFAULT 'pending',
        code              TEXT UNIQUE,
        requested_code    TEXT NOT NULL,
        tier_pct          INTEGER NOT NULL DEFAULT ${RATE_PCT},
        cookie_days       INTEGER NOT NULL DEFAULT ${DEFAULT_COOKIE_DAYS},
        channels          JSONB,
        primary_link      TEXT,
        audience_size     TEXT,
        promo_plan        TEXT,
        other_products    TEXT,
        payout_method     TEXT NOT NULL DEFAULT 'stripe',
        payout_detail     TEXT,
        promotion_code_id TEXT,
        internal_note     TEXT,
        decline_reason    TEXT,
        applied_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
        approved_at       TIMESTAMPTZ,
        decided_at        TIMESTAMPTZ,
        last_login_at     TIMESTAMPTZ
      )`);
    await pool.query(`CREATE INDEX IF NOT EXISTS aff_affiliates_status_idx ON aff_affiliates(status, applied_at DESC)`);
    await pool.query(`CREATE INDEX IF NOT EXISTS aff_affiliates_code_idx ON aff_affiliates(code)`);
    // Older code kept the previous code live for a grace window after a swap so
    // links already in the wild keep attributing. Added separately (not in the
    // CREATE above) so an existing deployment picks it up.
    await pool.query(`ALTER TABLE aff_affiliates ADD COLUMN IF NOT EXISTS prev_code TEXT`);
    await pool.query(`ALTER TABLE aff_affiliates ADD COLUMN IF NOT EXISTS prev_code_until TIMESTAMPTZ`);
    // The program launched briefly with a 10/15/20 tier ladder and a default of
    // 10. It is a flat 20 now (see RATE_PCT). Move the column default, and lift
    // anyone still sitting on the old starter rate who has NOT been approved yet
    // — nobody has been promised anything until they are, and nothing they have
    // earned can move, because an approved affiliate's rate is frozen onto their
    // link rows in recordReferral().
    await pool.query(`ALTER TABLE aff_affiliates ALTER COLUMN tier_pct SET DEFAULT ${RATE_PCT}`);
    await pool.query(
      `UPDATE aff_affiliates SET tier_pct = $1 WHERE approved_at IS NULL AND tier_pct <> $1`,
      [RATE_PCT]);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS aff_sessions (
        token_hash   TEXT PRIMARY KEY,
        affiliate_id INTEGER NOT NULL REFERENCES aff_affiliates(id) ON DELETE CASCADE,
        created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
        expires_at   TIMESTAMPTZ NOT NULL,
        user_agent   TEXT,
        ip           TEXT
      )`);
    await pool.query(`CREATE INDEX IF NOT EXISTS aff_sessions_aff_idx ON aff_sessions(affiliate_id)`);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS aff_login_attempts (
        id    SERIAL PRIMARY KEY,
        email TEXT NOT NULL,
        ip    TEXT,
        ok    BOOLEAN NOT NULL,
        at    TIMESTAMPTZ NOT NULL DEFAULT now()
      )`);
    await pool.query(`CREATE INDEX IF NOT EXISTS aff_login_attempts_email_at_idx ON aff_login_attempts(email, at DESC)`);

    // One row per redirect through /api/aff/go. Deliberately NOT one row per
    // page view: this counts link clicks, which is the number the affiliate is
    // judged on and the denominator of the conversion rate on both dashboards.
    await pool.query(`
      CREATE TABLE IF NOT EXISTS aff_clicks (
        id           BIGSERIAL PRIMARY KEY,
        affiliate_id INTEGER REFERENCES aff_affiliates(id) ON DELETE CASCADE,
        code         TEXT NOT NULL,
        at           TIMESTAMPTZ NOT NULL DEFAULT now(),
        referrer     TEXT,
        source       TEXT,
        landing      TEXT,
        ip_hash      TEXT,
        user_agent   TEXT
      )`);
    await pool.query(`CREATE INDEX IF NOT EXISTS aff_clicks_aff_at_idx ON aff_clicks(affiliate_id, at DESC)`);

    // The money ledger. TWO kinds of row:
    //   kind='link'       one per attributed subscription. gross/commission are
    //                     ZERO — it exists to remember WHICH affiliate owns this
    //                     subscription, at what rate, so renewals can be credited
    //                     later without re-deriving attribution from a cookie
    //                     that expired months ago.
    //   kind='initial'    the first paid invoice.
    //   kind='renewal'    every paid invoice after it.
    //   kind='refund'     a manual clawback entered by the owner (negative).
    // invoice_id is UNIQUE so a Stripe webhook retry cannot double-pay.
    await pool.query(`
      CREATE TABLE IF NOT EXISTS aff_referrals (
        id                     BIGSERIAL PRIMARY KEY,
        affiliate_id           INTEGER NOT NULL REFERENCES aff_affiliates(id) ON DELETE CASCADE,
        code                   TEXT,
        kind                   TEXT NOT NULL DEFAULT 'initial',
        stripe_subscription_id TEXT,
        stripe_customer_id     TEXT,
        invoice_id             TEXT UNIQUE,
        customer_email         TEXT,
        plan                   TEXT,
        gross_cents            INTEGER NOT NULL DEFAULT 0,
        rate_pct               INTEGER NOT NULL DEFAULT 0,
        commission_cents       INTEGER NOT NULL DEFAULT 0,
        period                 TEXT NOT NULL,
        status                 TEXT NOT NULL DEFAULT 'holding',
        note                   TEXT,
        created_at             TIMESTAMPTZ NOT NULL DEFAULT now()
      )`);
    await pool.query(`CREATE INDEX IF NOT EXISTS aff_referrals_aff_idx ON aff_referrals(affiliate_id, created_at DESC)`);
    await pool.query(`CREATE INDEX IF NOT EXISTS aff_referrals_sub_idx ON aff_referrals(stripe_subscription_id)`);
    await pool.query(`CREATE INDEX IF NOT EXISTS aff_referrals_period_idx ON aff_referrals(period)`);

    // A code edit is a REQUEST, never an edit. Approving one is what actually
    // moves aff_affiliates.code.
    await pool.query(`
      CREATE TABLE IF NOT EXISTS aff_code_requests (
        id           SERIAL PRIMARY KEY,
        affiliate_id INTEGER NOT NULL REFERENCES aff_affiliates(id) ON DELETE CASCADE,
        from_code    TEXT,
        to_code      TEXT NOT NULL,
        reason       TEXT,
        status       TEXT NOT NULL DEFAULT 'pending',
        created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
        decided_at   TIMESTAMPTZ,
        decided_note TEXT
      )`);
    await pool.query(`CREATE INDEX IF NOT EXISTS aff_code_requests_status_idx ON aff_code_requests(status, created_at DESC)`);

    // One row per (affiliate, period). Created lazily when the owner opens the
    // payouts tab for a closed period — see buildPayouts().
    await pool.query(`
      CREATE TABLE IF NOT EXISTS aff_payouts (
        id               SERIAL PRIMARY KEY,
        affiliate_id     INTEGER NOT NULL REFERENCES aff_affiliates(id) ON DELETE CASCADE,
        period           TEXT NOT NULL,
        sales            INTEGER NOT NULL DEFAULT 0,
        gross_cents      INTEGER NOT NULL DEFAULT 0,
        refunds_cents    INTEGER NOT NULL DEFAULT 0,
        commission_cents INTEGER NOT NULL DEFAULT 0,
        method           TEXT,
        status           TEXT NOT NULL DEFAULT 'pending',
        reference        TEXT,
        note             TEXT,
        created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
        approved_at      TIMESTAMPTZ,
        paid_at          TIMESTAMPTZ,
        UNIQUE (affiliate_id, period)
      )`);
    await pool.query(`CREATE INDEX IF NOT EXISTS aff_payouts_period_idx ON aff_payouts(period, status)`);
  })().catch((e) => { ready = null; throw e; });
  return ready;
}

// ---------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------

const sha256 = (s) => crypto.createHash('sha256').update(String(s)).digest('hex');
const normEmail = (e) => String(e || '').trim().toLowerCase();

/** Current accrual period, ET. Payout periods are calendar months. */
function currentPeriod(d = new Date()) {
  const s = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/New_York', year: 'numeric', month: '2-digit',
  }).format(d);
  return s.slice(0, 7); // YYYY-MM
}

/**
 * Commission in whole cents. ONE rounding site for the entire system — see the
 * MONEY note at the top. Math.round, not floor: floor systematically
 * under-pays, and over a few hundred invoices that is a real number.
 */
function commissionCents(grossCents, ratePct) {
  const g = Math.max(0, Math.round(Number(grossCents) || 0));
  const r = Math.min(MAX_RATE_PCT, Math.max(0, Math.round(Number(ratePct) || 0)));
  return Math.round((g * r) / 100);
}

/**
 * Normalise + validate a referral code. Returns { code } or { error }.
 * Uppercase A-Z0-9 only: the code is typed by hand at checkout and read off a
 * screenshot, so anything case-sensitive or punctuated is a support ticket.
 */
function normalizeCode(raw) {
  const code = String(raw || '').trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (code.length < 4) return { error: 'Code must be at least 4 characters.' };
  if (code.length > 16) return { error: 'Code must be 16 characters or fewer.' };
  if (/^\d+$/.test(code)) return { error: 'Code needs at least one letter.' };
  if (RESERVED_CODES.has(code)) return { error: `"${code}" is reserved.` };
  return { code };
}

/** True when nobody else holds this code (live, previous, or requested). */
async function codeAvailable(code, exceptId = null) {
  await ensureSchema();
  const { rows } = await libDb.getPool().query(
    `SELECT 1 FROM aff_affiliates
      WHERE (code = $1 OR prev_code = $1) AND ($2::int IS NULL OR id <> $2) LIMIT 1`,
    [code, exceptId]);
  if (rows.length) return false;
  const pend = await libDb.getPool().query(
    `SELECT 1 FROM aff_code_requests
      WHERE to_code = $1 AND status = 'pending' AND ($2::int IS NULL OR affiliate_id <> $2) LIMIT 1`,
    [code, exceptId]);
  return pend.rows.length === 0;
}

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

function passwordProblem(plain) {
  const s = String(plain || '');
  if (s.length < 10) return 'Password must be at least 10 characters.';
  if (s.length > 200) return 'Password is too long.';
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

// ---------------------------------------------------------------------------
// Cookies
// ---------------------------------------------------------------------------

// NOTE the deliberate absence of `Domain=` — host-only, see the header comment.
function sessionCookie(token, maxAgeSec) {
  return [
    `${COOKIE_NAME}=${encodeURIComponent(token)}`,
    'Path=/', 'HttpOnly', 'Secure', 'SameSite=Lax', `Max-Age=${maxAgeSec}`,
  ].join('; ');
}
const clearCookie = () => `${COOKIE_NAME}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`;

/**
 * The attribution cookie. This one IS domain-wide on purpose: it is set on
 * affiliate.cbedge.net and has to be readable by the checkout route running on
 * cbedge.net. HttpOnly because nothing in a browser needs to read it — only
 * app/api/stripe/checkout does, server-side.
 */
function refCookie(code, days = DEFAULT_COOKIE_DAYS) {
  const parts = [
    `${REF_COOKIE}=${encodeURIComponent(code)}`,
    'Path=/', 'HttpOnly', 'Secure', 'SameSite=Lax',
    `Max-Age=${Math.max(1, days) * 24 * 60 * 60}`,
  ];
  if (REF_COOKIE_DOMAIN) parts.push(`Domain=${REF_COOKIE_DOMAIN}`);
  return parts.join('; ');
}

// ---------------------------------------------------------------------------
// Sessions
// ---------------------------------------------------------------------------

async function createSession(affiliateId, req) {
  const token = crypto.randomBytes(32).toString('base64url');
  const expires = new Date(Date.now() + SESSION_MS);
  await libDb.getPool().query(
    `INSERT INTO aff_sessions (token_hash, affiliate_id, expires_at, user_agent, ip)
     VALUES ($1,$2,$3,$4,$5)`,
    [sha256(token), affiliateId, expires,
     String(req?.headers?.['user-agent'] || '').slice(0, 300) || null, clientIp(req)]);
  return { token, expires };
}

/** Resolve the affiliate for a request, or null. Never throws. */
async function affiliateFromRequest(req) {
  if (!libDb) return null;
  try {
    const token = parseCookies(req)[COOKIE_NAME];
    if (!token) return null;
    await ensureSchema();
    const { rows } = await libDb.getPool().query(
      `SELECT a.*, s.created_at AS session_created_at
         FROM aff_sessions s JOIN aff_affiliates a ON a.id = s.affiliate_id
        WHERE s.token_hash = $1 AND s.expires_at > now()`,
      [sha256(token)]);
    return rows[0] || null;
  } catch { return null; }
}

function shouldSlide(row) {
  const created = row?.session_created_at ? new Date(row.session_created_at).getTime() : 0;
  return created > 0 && Date.now() - created > SLIDE_AFTER_MS;
}

async function refreshSession(req) {
  const token = parseCookies(req)[COOKIE_NAME];
  if (!token) return null;
  const expires = new Date(Date.now() + SESSION_MS);
  await libDb.getPool().query(
    `UPDATE aff_sessions SET expires_at=$2, created_at=now() WHERE token_hash=$1`,
    [sha256(token), expires]);
  return { token, expires };
}

async function destroySession(req) {
  const token = parseCookies(req)[COOKIE_NAME];
  if (!token) return;
  try { await libDb.getPool().query(`DELETE FROM aff_sessions WHERE token_hash=$1`, [sha256(token)]); }
  catch { /* signing out is best-effort; the cookie is cleared regardless */ }
}

async function recordAttempt(email, ip, ok) {
  try {
    await libDb.getPool().query(
      `INSERT INTO aff_login_attempts (email, ip, ok) VALUES ($1,$2,$3)`,
      [normEmail(email), ip || null, !!ok]);
  } catch { /* never let the audit log break a login */ }
}

async function lockedOut(email) {
  const { rows } = await libDb.getPool().query(
    `SELECT COUNT(*)::int AS n FROM aff_login_attempts
      WHERE email = $1 AND ok = FALSE AND at > now() - ($2::int * INTERVAL '1 millisecond')`,
    [normEmail(email), LOCKOUT_MS]);
  return (rows[0]?.n || 0) >= MAX_FAILS;
}

// ---------------------------------------------------------------------------
// Apply / login
// ---------------------------------------------------------------------------

/**
 * Create a pending application. Returns { ok, affiliate, cookie } or
 * { ok:false, code, error }.
 *
 * The applicant is signed IN immediately even though they are `pending` — the
 * dashboard they land on is the waiting-room view. Without a session they
 * would have no way back to check on it, and "re-apply to see your status" is
 * how duplicate rows get created.
 */
async function apply(input, req) {
  await ensureSchema();
  const email = normEmail(input?.email);
  const name = String(input?.name || '').trim().slice(0, 120);
  if (!email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return { ok: false, code: 400, error: 'A valid email is required.' };
  if (!name) return { ok: false, code: 400, error: 'Your name is required.' };

  const pwProblem = passwordProblem(input?.password);
  if (pwProblem) return { ok: false, code: 400, error: pwProblem };

  const c = normalizeCode(input?.requested_code);
  if (c.error) return { ok: false, code: 400, error: c.error };
  if (!(await codeAvailable(c.code))) return { ok: false, code: 409, error: `"${c.code}" is already taken.` };

  const method = PAYOUT_METHODS.includes(String(input?.payout_method)) ? String(input.payout_method) : 'stripe';
  const channels = Array.isArray(input?.channels) ? input.channels.slice(0, 12).map((s) => String(s).slice(0, 40)) : [];

  const exists = await libDb.getPool().query(`SELECT id, status FROM aff_affiliates WHERE email=$1`, [email]);
  if (exists.rows.length) {
    return { ok: false, code: 409, error: 'There is already an application for that email. Sign in instead.' };
  }

  const { rows } = await libDb.getPool().query(
    `INSERT INTO aff_affiliates
       (email, password_hash, name, requested_code, channels, primary_link,
        audience_size, promo_plan, other_products, payout_method, payout_detail)
     VALUES ($1,$2,$3,$4,$5::jsonb,$6,$7,$8,$9,$10,$11)
     RETURNING *`,
    [email, hashPassword(input.password), name, c.code, JSON.stringify(channels),
     String(input?.primary_link || '').slice(0, 300) || null,
     String(input?.audience_size || '').slice(0, 40) || null,
     String(input?.promo_plan || '').slice(0, 4000) || null,
     String(input?.other_products || '').slice(0, 2000) || null,
     method,
     String(input?.payout_detail || '').slice(0, 200) || null]);

  const row = rows[0];
  const { token } = await createSession(row.id, req);
  return { ok: true, affiliate: row, cookie: sessionCookie(token, SESSION_DAYS * 24 * 60 * 60) };
}

async function login({ email, password, req }) {
  await ensureSchema();
  const e = normEmail(email);
  if (!e || !password) return { ok: false, code: 400, error: 'Email and password are required.' };
  if (await lockedOut(e)) return { ok: false, code: 429, error: 'Too many attempts. Try again in 15 minutes.' };

  const { rows } = await libDb.getPool().query(`SELECT * FROM aff_affiliates WHERE email=$1`, [e]);
  const row = rows[0];
  // Same message + same work either way, so the response cannot be used to
  // enumerate which emails have applied.
  if (!row || !verifyPassword(password, row.password_hash)) {
    await recordAttempt(e, clientIp(req), false);
    return { ok: false, code: 401, error: 'Email or password is incorrect.' };
  }
  if (row.status === 'declined') {
    await recordAttempt(e, clientIp(req), false);
    return { ok: false, code: 403, error: 'This application was not approved.' };
  }
  await recordAttempt(e, clientIp(req), true);
  await libDb.getPool().query(`UPDATE aff_affiliates SET last_login_at = now() WHERE id=$1`, [row.id]);
  const { token } = await createSession(row.id, req);
  return { ok: true, affiliate: row, cookie: sessionCookie(token, SESSION_DAYS * 24 * 60 * 60) };
}

/** The shape the affiliate app is allowed to see. Never leaks password_hash. */
function publicAffiliate(row) {
  if (!row) return null;
  return {
    id: row.id,
    name: row.name,
    email: row.email,
    status: row.status,
    code: row.code,
    requested_code: row.requested_code,
    prev_code: row.prev_code,
    prev_code_until: row.prev_code_until,
    // Named tier_pct for the column, but there are no tiers — it is this
    // affiliate's rate, 20 unless the owner overrode it at approval.
    tier_pct: row.tier_pct,
    cookie_days: row.cookie_days,
    channels: row.channels || [],
    primary_link: row.primary_link,
    payout_method: row.payout_method,
    payout_detail: row.payout_detail,
    applied_at: row.applied_at,
    approved_at: row.approved_at,
    decline_reason: row.status === 'declined' ? row.decline_reason : null,
  };
}

// ---------------------------------------------------------------------------
// Clicks + attribution
// ---------------------------------------------------------------------------

/**
 * Resolve a code (live OR still-in-grace previous code) to an affiliate.
 * Returns the row or null. A paused affiliate resolves to null — a paused code
 * must stop earning, and silently crediting it would be worse than a dead link.
 */
async function affiliateByCode(code) {
  if (!code) return null;
  await ensureSchema();
  const c = String(code).trim().toUpperCase();
  const { rows } = await libDb.getPool().query(
    `SELECT * FROM aff_affiliates
      WHERE status = 'active'
        AND (code = $1 OR (prev_code = $1 AND prev_code_until > now()))
      LIMIT 1`, [c]);
  return rows[0] || null;
}

async function affiliateByPromotionCode(promotionCodeId) {
  if (!promotionCodeId) return null;
  await ensureSchema();
  const { rows } = await libDb.getPool().query(
    `SELECT * FROM aff_affiliates WHERE promotion_code_id = $1 AND status = 'active' LIMIT 1`,
    [promotionCodeId]);
  return rows[0] || null;
}

/** Log a click. Best-effort by design — a logging failure must not break the
 *  redirect, because the redirect is the thing the visitor came for. */
async function recordClick(code, req, landing) {
  try {
    await ensureSchema();
    const aff = await affiliateByCode(code);
    const ip = clientIp(req);
    await libDb.getPool().query(
      `INSERT INTO aff_clicks (affiliate_id, code, referrer, source, landing, ip_hash, user_agent)
       VALUES ($1,$2,$3,$4,$5,$6,$7)`,
      [aff?.id || null, String(code).toUpperCase(),
       String(req.headers?.referer || '').slice(0, 400) || null,
       String(req.headers?.['cf-ipcountry'] || '').slice(0, 8) || null,
       String(landing || '').slice(0, 200) || null,
       ip ? sha256(ip).slice(0, 32) : null,
       String(req.headers?.['user-agent'] || '').slice(0, 300) || null]);
    return aff;
  } catch { return null; }
}

// ---------------------------------------------------------------------------
// Referrals (the money ledger)
// ---------------------------------------------------------------------------

/**
 * Called by the Stripe webhook through the internal endpoint. Idempotent on
 * invoice_id: Stripe retries webhooks, and a retry must never pay twice.
 *
 * `kind` is 'link' for the attribution row written at checkout (zero money) and
 * 'initial' / 'renewal' for real invoices.
 */
async function recordReferral(input) {
  await ensureSchema();
  const pool = libDb.getPool();

  // Resolve the affiliate: an explicit id wins, then the code the customer
  // actually typed at checkout (a promotion code), then the cookie code, then
  // — for a renewal — whoever owns the subscription from the original link row.
  let aff = null;
  if (input?.affiliate_id) {
    const r = await pool.query(`SELECT * FROM aff_affiliates WHERE id=$1`, [input.affiliate_id]);
    aff = r.rows[0] || null;
  }
  if (!aff && input?.promotion_code_id) aff = await affiliateByPromotionCode(input.promotion_code_id);
  if (!aff && input?.code) aff = await affiliateByCode(input.code);
  if (!aff && input?.stripe_subscription_id) {
    const r = await pool.query(
      `SELECT a.*, r.rate_pct AS linked_rate
         FROM aff_referrals r JOIN aff_affiliates a ON a.id = r.affiliate_id
        WHERE r.stripe_subscription_id = $1
        ORDER BY r.created_at ASC LIMIT 1`, [input.stripe_subscription_id]);
    aff = r.rows[0] || null;
  }
  if (!aff) return { ok: false, reason: 'no-affiliate' };

  const kind = ['link', 'initial', 'renewal', 'refund'].includes(input?.kind) ? input.kind : 'initial';
  // The rate is FROZEN at the rate on the link row when one exists. A tier bump
  // must not retroactively re-price invoices that were already earned — and,
  // more importantly, must not silently re-price the ones still holding.
  let rate = Number(aff.linked_rate ?? aff.tier_pct) || 0;
  if (kind !== 'link') {
    const linked = await pool.query(
      `SELECT rate_pct FROM aff_referrals
        WHERE stripe_subscription_id = $1 AND kind = 'link' LIMIT 1`,
      [input?.stripe_subscription_id || null]);
    if (linked.rows[0]) rate = linked.rows[0].rate_pct;
  }
  const gross = kind === 'link' ? 0 : Math.round(Number(input?.gross_cents) || 0);
  const commission = kind === 'link' ? 0 : commissionCents(gross, rate);

  const { rows } = await pool.query(
    `INSERT INTO aff_referrals
       (affiliate_id, code, kind, stripe_subscription_id, stripe_customer_id,
        invoice_id, customer_email, plan, gross_cents, rate_pct, commission_cents,
        period, status, note)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
     ON CONFLICT (invoice_id) DO NOTHING
     RETURNING *`,
    [aff.id, aff.code, kind,
     input?.stripe_subscription_id || null, input?.stripe_customer_id || null,
     input?.invoice_id || null, input?.customer_email || null, input?.plan || null,
     gross, rate, commission,
     input?.period || currentPeriod(), input?.status || (kind === 'link' ? 'linked' : 'holding'),
     input?.note || null]);

  return { ok: true, duplicate: rows.length === 0, affiliate_id: aff.id, row: rows[0] || null };
}

/**
 * Clear the refund window. Anything older than HOLD_DAYS that is still
 * 'holding' becomes 'cleared' and can be paid. Called opportunistically on
 * every owner payouts read — there is no scheduler to remember.
 */
const HOLD_DAYS = Number(process.env.AFFILIATE_HOLD_DAYS || 30);
async function clearHolds() {
  try {
    await libDb.getPool().query(
      `UPDATE aff_referrals SET status='cleared'
        WHERE status='holding' AND created_at < now() - ($1::int * INTERVAL '1 day')`,
      [HOLD_DAYS]);
  } catch { /* best effort */ }
}

// ---------------------------------------------------------------------------
// Stats
// ---------------------------------------------------------------------------

/** The affiliate's own dashboard payload. */
async function affiliateStats(affiliateId) {
  await ensureSchema();
  const pool = libDb.getPool();
  const period = currentPeriod();

  const [totals, clicks, series, recent, payouts] = await Promise.all([
    pool.query(
      `SELECT
         COALESCE(SUM(CASE WHEN status IN ('holding','cleared') THEN commission_cents END),0)::int AS unpaid_cents,
         COALESCE(SUM(CASE WHEN status = 'paid' THEN commission_cents END),0)::int              AS paid_cents,
         COALESCE(SUM(CASE WHEN period = $2 THEN commission_cents END),0)::int                  AS mtd_cents,
         COUNT(*) FILTER (WHERE kind = 'link')::int                                              AS members
       FROM aff_referrals WHERE affiliate_id = $1`, [affiliateId, period]),
    pool.query(
      `SELECT COUNT(*)::int AS all_time,
              COUNT(*) FILTER (WHERE at > now() - INTERVAL '30 days')::int AS last30,
              COUNT(*) FILTER (WHERE at::date = (now() AT TIME ZONE 'America/New_York')::date)::int AS today
         FROM aff_clicks WHERE affiliate_id = $1`, [affiliateId]),
    pool.query(
      `SELECT to_char(created_at AT TIME ZONE 'America/New_York','YYYY-MM-DD') AS d,
              COALESCE(SUM(commission_cents),0)::int AS cents
         FROM aff_referrals
        WHERE affiliate_id = $1 AND created_at > now() - INTERVAL '30 days'
        GROUP BY 1 ORDER BY 1`, [affiliateId]),
    pool.query(
      `SELECT id, kind, plan, customer_email, gross_cents, commission_cents, status, created_at
         FROM aff_referrals
        WHERE affiliate_id = $1 AND kind <> 'link'
        ORDER BY created_at DESC LIMIT 12`, [affiliateId]),
    pool.query(
      `SELECT period, sales, gross_cents, refunds_cents, commission_cents,
              method, status, reference, paid_at
         FROM aff_payouts WHERE affiliate_id = $1 ORDER BY period DESC LIMIT 24`, [affiliateId]),
  ]);

  const t = totals.rows[0] || {};
  const c = clicks.rows[0] || {};
  const members = Number(t.members || 0);
  const clicksAll = Number(c.all_time || 0);

  return {
    period,
    unpaid_cents: Number(t.unpaid_cents || 0),
    paid_cents: Number(t.paid_cents || 0),
    mtd_cents: Number(t.mtd_cents || 0),
    members,
    clicks: clicksAll,
    clicks_30d: Number(c.last30 || 0),
    clicks_today: Number(c.today || 0),
    // Guard the divide: a brand-new affiliate has zero clicks, and 0/0 renders
    // as "NaN%" on the tile rather than the honest "—".
    conversion_pct: clicksAll > 0 ? Math.round((members / clicksAll) * 1000) / 10 : null,
    series: series.rows.map((r) => ({ d: r.d, cents: Number(r.cents) })),
    recent: recent.rows,
    payouts: payouts.rows,
  };
}

/** Everything the owner's Active tab needs, one row per affiliate. */
async function ownerRoster() {
  await ensureSchema();
  const { rows } = await libDb.getPool().query(`
    SELECT a.id, a.name, a.email, a.status, a.code, a.requested_code, a.tier_pct,
           a.payout_method, a.primary_link, a.channels, a.audience_size,
           a.applied_at, a.approved_at, a.promo_plan, a.other_products,
           a.internal_note, a.payout_detail,
           COALESCE(cl.n, 0)::int                       AS clicks,
           COALESCE(rf.members, 0)::int                 AS members,
           COALESCE(rf.unpaid_cents, 0)::int            AS unpaid_cents,
           COALESCE(rf.paid_cents, 0)::int              AS paid_cents,
           COALESCE(rf.mtd_gross_cents, 0)::int         AS mtd_gross_cents,
           cr.id          AS pending_request_id,
           cr.to_code     AS pending_to_code,
           cr.reason      AS pending_reason,
           cr.created_at  AS pending_requested_at
      FROM aff_affiliates a
      LEFT JOIN (SELECT affiliate_id, COUNT(*) n FROM aff_clicks GROUP BY 1) cl
             ON cl.affiliate_id = a.id
      LEFT JOIN (
        SELECT affiliate_id,
               COUNT(*) FILTER (WHERE kind = 'link')                                         AS members,
               SUM(CASE WHEN status IN ('holding','cleared') THEN commission_cents ELSE 0 END) AS unpaid_cents,
               SUM(CASE WHEN status = 'paid' THEN commission_cents ELSE 0 END)                 AS paid_cents,
               SUM(CASE WHEN period = to_char(now() AT TIME ZONE 'America/New_York','YYYY-MM')
                        THEN gross_cents ELSE 0 END)                                           AS mtd_gross_cents
          FROM aff_referrals GROUP BY 1
      ) rf ON rf.affiliate_id = a.id
      LEFT JOIN LATERAL (
        SELECT id, to_code, reason, created_at FROM aff_code_requests
         WHERE affiliate_id = a.id AND status = 'pending'
         ORDER BY created_at DESC LIMIT 1
      ) cr ON TRUE
     ORDER BY a.applied_at DESC`);
  return rows;
}

/**
 * Payout rows for a period, created on demand from the ledger.
 *
 * Deliberately NOT a scheduled job. A month closes whether or not a cron fired,
 * and a payout row that exists only because a scheduler ran is a payout that
 * silently does not exist when it didn't. Opening the tab is the trigger.
 */
async function buildPayouts(period) {
  await ensureSchema();
  await clearHolds();
  const pool = libDb.getPool();
  const p = String(period || currentPeriod()).slice(0, 7);

  // Upsert one row per affiliate that earned anything in the period. An already
  // PAID row is never recomputed — the ledger it was built from can still move
  // (a late refund), and a paid payout is a historical fact, not a live view.
  await pool.query(`
    INSERT INTO aff_payouts (affiliate_id, period, sales, gross_cents, refunds_cents, commission_cents, method)
    SELECT r.affiliate_id, $1,
           COUNT(*) FILTER (WHERE r.kind IN ('initial','renewal'))::int,
           COALESCE(SUM(GREATEST(r.gross_cents, 0)), 0)::int,
           COALESCE(SUM(CASE WHEN r.kind = 'refund' THEN ABS(r.commission_cents) ELSE 0 END), 0)::int,
           COALESCE(SUM(r.commission_cents), 0)::int,
           MAX(a.payout_method)
      FROM aff_referrals r JOIN aff_affiliates a ON a.id = r.affiliate_id
     WHERE r.period = $1 AND r.kind <> 'link'
     GROUP BY r.affiliate_id
    ON CONFLICT (affiliate_id, period) DO UPDATE
      SET sales            = EXCLUDED.sales,
          gross_cents      = EXCLUDED.gross_cents,
          refunds_cents    = EXCLUDED.refunds_cents,
          commission_cents = EXCLUDED.commission_cents,
          method           = COALESCE(aff_payouts.method, EXCLUDED.method)
      WHERE aff_payouts.status <> 'paid'`, [p]);

  const { rows } = await pool.query(`
    SELECT p.*, a.name, a.email, a.code, a.tier_pct, a.payout_method, a.payout_detail
      FROM aff_payouts p JOIN aff_affiliates a ON a.id = p.affiliate_id
     WHERE p.period = $1
     ORDER BY p.commission_cents DESC`, [p]);
  return rows;
}

module.exports = {
  // constants
  COOKIE_NAME, REF_COOKIE, SESSION_DAYS, RATE_PCT, MAX_RATE_PCT, PAYOUT_METHODS,
  RESERVED_CODES, DEFAULT_COOKIE_DAYS, HOLD_DAYS,
  // plumbing
  ensureSchema, parseCookies, clientIp, sha256, currentPeriod, commissionCents,
  normalizeCode, codeAvailable, hashPassword, verifyPassword, passwordProblem,
  sessionCookie, clearCookie, refCookie,
  // auth
  apply, login, affiliateFromRequest, shouldSlide, refreshSession, destroySession,
  publicAffiliate,
  // data
  affiliateByCode, affiliateByPromotionCode, recordClick, recordReferral,
  clearHolds, affiliateStats, ownerRoster, buildPayouts,
  get pool() { return libDb ? libDb.getPool() : null; },
  get available() { return !!libDb; },
};
