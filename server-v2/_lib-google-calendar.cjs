'use strict';
/**
 * server-v2/_lib-google-calendar.cjs — read-only Google Calendar for the
 * household app.
 *
 * DESIGN RULES
 *   1. The browser NEVER sees a Google token. The SPA calls our endpoint, we
 *      call Google server-side and hand back plain event JSON. There is no
 *      client-side Google SDK, no token in localStorage, nothing to leak.
 *   2. Refresh tokens are encrypted at rest (AES-256-GCM). A refresh token is a
 *      permanent read key to someone's calendar; it does not sit in a table in
 *      plaintext.
 *   3. Scope is calendar.readonly. This app cannot create, move or delete an
 *      event even if it wanted to.
 *   4. Google being slow, down, or having had its access revoked must NEVER
 *      break the Today screen. Every read path here returns a shaped result or
 *      an { error } — it does not throw into the route.
 *
 * REQUIRED ENV (all in .env.local, mounted at runtime — never baked into the image)
 *   GOOGLE_CLIENT_ID       — OAuth 2.0 Web client id
 *   GOOGLE_CLIENT_SECRET   — its secret
 *   HH_TOKEN_KEY           — 32+ random bytes, hex. Encrypts stored refresh
 *                            tokens. Generate: openssl rand -hex 32
 *   HH_BASE_URL            — optional, defaults to https://budget.cbedge.net.
 *                            Must match the Authorised redirect URI in Google
 *                            Cloud Console EXACTLY, including scheme and path.
 *
 * Missing config is not a crash: configured() returns false and the UI shows
 * "not set up" instead of a broken Connect button.
 */

const crypto = require('crypto');

let libDb = null;
try { libDb = require('./_lib-db.cjs'); } catch { /* handled by configured() */ }

const CLIENT_ID = (process.env.GOOGLE_CLIENT_ID || '').trim();
const CLIENT_SECRET = (process.env.GOOGLE_CLIENT_SECRET || '').trim();
const TOKEN_KEY_RAW = (process.env.HH_TOKEN_KEY || '').trim();
const BASE_URL = (process.env.HH_BASE_URL || 'https://budget.cbedge.net').trim().replace(/\/+$/, '');

const REDIRECT_URI = `${BASE_URL}/api/hh/calendar/callback`;
const SCOPE = 'https://www.googleapis.com/auth/calendar.readonly';

const AUTH_ENDPOINT = 'https://accounts.google.com/o/oauth2/v2/auth';
const TOKEN_ENDPOINT = 'https://oauth2.googleapis.com/token';
const EVENTS_ENDPOINT = 'https://www.googleapis.com/calendar/v3/calendars/primary/events';
const USERINFO_ENDPOINT = 'https://www.googleapis.com/oauth2/v2/userinfo';

/** True when this deployment can actually talk to Google. */
function configured() {
  return !!(libDb && CLIENT_ID && CLIENT_SECRET && TOKEN_KEY_RAW);
}

/** Which specific piece is missing — surfaced to the owner, never to a browser. */
function missingConfig() {
  const missing = [];
  if (!CLIENT_ID) missing.push('GOOGLE_CLIENT_ID');
  if (!CLIENT_SECRET) missing.push('GOOGLE_CLIENT_SECRET');
  if (!TOKEN_KEY_RAW) missing.push('HH_TOKEN_KEY');
  if (!libDb) missing.push('_lib-db.cjs');
  return missing;
}

// ---------------------------------------------------------------------------
// Encryption at rest
// ---------------------------------------------------------------------------

// scrypt-derived so HH_TOKEN_KEY can be any string, not strictly 32 raw bytes.
let KEY = null;
function key() {
  if (!KEY) KEY = crypto.scryptSync(TOKEN_KEY_RAW, 'hh-google-token-v1', 32);
  return KEY;
}

function encrypt(plain) {
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv('aes-256-gcm', key(), iv);
  const ct = Buffer.concat([c.update(String(plain), 'utf8'), c.final()]);
  return `v1:${iv.toString('base64')}:${c.getAuthTag().toString('base64')}:${ct.toString('base64')}`;
}

function decrypt(stored) {
  try {
    const [v, ivB, tagB, ctB] = String(stored || '').split(':');
    if (v !== 'v1') return null;
    const d = crypto.createDecipheriv('aes-256-gcm', key(), Buffer.from(ivB, 'base64'));
    d.setAuthTag(Buffer.from(tagB, 'base64'));
    return Buffer.concat([d.update(Buffer.from(ctB, 'base64')), d.final()]).toString('utf8');
  } catch {
    // Wrong key (HH_TOKEN_KEY rotated) or tampered ciphertext. Treat as "no
    // token" so the user is asked to reconnect rather than seeing a 500.
    return null;
  }
}

// ---------------------------------------------------------------------------
// OAuth state — signed, short-lived, bound to one user
// ---------------------------------------------------------------------------

const STATE_TTL_MS = 10 * 60_000;

function signState(userId) {
  const payload = Buffer.from(JSON.stringify({
    uid: userId, n: crypto.randomBytes(9).toString('base64url'), exp: Date.now() + STATE_TTL_MS,
  })).toString('base64url');
  const sig = crypto.createHmac('sha256', key()).update(payload).digest('base64url');
  return `${payload}.${sig}`;
}

function verifyState(state) {
  try {
    const [payload, sig] = String(state || '').split('.');
    if (!payload || !sig) return null;
    const expect = crypto.createHmac('sha256', key()).update(payload).digest('base64url');
    const a = Buffer.from(sig), b = Buffer.from(expect);
    if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
    const data = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    if (!data?.exp || Date.now() > data.exp) return null;
    return data;
  } catch { return null; }
}

// ---------------------------------------------------------------------------
// OAuth flow
// ---------------------------------------------------------------------------

function authUrl(userId) {
  const p = new URLSearchParams({
    client_id: CLIENT_ID,
    redirect_uri: REDIRECT_URI,
    response_type: 'code',
    scope: SCOPE,
    // offline + consent is what actually returns a refresh_token. Without
    // prompt=consent Google omits it on every authorisation after the first,
    // so a reconnect would silently leave us unable to refresh.
    access_type: 'offline',
    prompt: 'consent',
    include_granted_scopes: 'true',
    state: signState(userId),
  });
  return `${AUTH_ENDPOINT}?${p}`;
}

async function postToken(params) {
  const r = await fetch(TOKEN_ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(params),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j?.error_description || j?.error || `token endpoint ${r.status}`);
  return j;
}

/** Exchange the ?code from the callback and persist the tokens. */
async function connect(userId, code) {
  const tok = await postToken({
    code, client_id: CLIENT_ID, client_secret: CLIENT_SECRET,
    redirect_uri: REDIRECT_URI, grant_type: 'authorization_code',
  });
  if (!tok.refresh_token) {
    throw new Error('Google did not return a refresh token. Remove this app at ' +
                    'myaccount.google.com/permissions and connect again.');
  }

  let email = null;
  try {
    const r = await fetch(USERINFO_ENDPOINT, { headers: { Authorization: `Bearer ${tok.access_token}` } });
    if (r.ok) email = (await r.json())?.email ?? null;
  } catch { /* the address is a nicety, not a requirement */ }

  const expiresAt = new Date(Date.now() + (Number(tok.expires_in) || 3600) * 1000);
  await libDb.getPool().query(
    `INSERT INTO hh_google_tokens (user_id, google_email, refresh_token, access_token, expires_at, scope, updated_at)
     VALUES ($1,$2,$3,$4,$5,$6,now())
     ON CONFLICT (user_id) DO UPDATE SET
       google_email=EXCLUDED.google_email, refresh_token=EXCLUDED.refresh_token,
       access_token=EXCLUDED.access_token, expires_at=EXCLUDED.expires_at,
       scope=EXCLUDED.scope, updated_at=now()`,
    [userId, email, encrypt(tok.refresh_token), encrypt(tok.access_token), expiresAt, tok.scope || SCOPE]);

  cache.delete(userId);
  return { email };
}

async function disconnect(userId) {
  // Best-effort revoke at Google first, so the grant disappears from their
  // account page too — not just from our table.
  try {
    const row = await tokenRow(userId);
    const rt = row && decrypt(row.refresh_token);
    if (rt) {
      await fetch(`https://oauth2.googleapis.com/revoke?token=${encodeURIComponent(rt)}`,
                  { method: 'POST' }).catch(() => {});
    }
  } catch { /* proceed to delete regardless */ }
  await libDb.getPool().query(`DELETE FROM hh_google_tokens WHERE user_id=$1`, [userId]);
  cache.delete(userId);
}

async function tokenRow(userId) {
  const { rows } = await libDb.getPool().query(
    `SELECT user_id, google_email, refresh_token, access_token, expires_at, scope
       FROM hh_google_tokens WHERE user_id=$1`, [userId]);
  return rows[0] || null;
}

async function status(userId) {
  if (!configured()) return { configured: false, connected: false };
  try {
    const row = await tokenRow(userId);
    return { configured: true, connected: !!row, email: row?.google_email ?? null };
  } catch { return { configured: true, connected: false }; }
}

/** A valid access token, refreshing 60s before expiry. null if not connected. */
async function accessToken(userId) {
  const row = await tokenRow(userId);
  if (!row) return null;

  const stillGood = row.access_token && row.expires_at &&
    new Date(row.expires_at).getTime() - Date.now() > 60_000;
  if (stillGood) {
    const at = decrypt(row.access_token);
    if (at) return at;
  }

  const rt = decrypt(row.refresh_token);
  if (!rt) return null; // key rotated — user must reconnect

  const tok = await postToken({
    refresh_token: rt, client_id: CLIENT_ID, client_secret: CLIENT_SECRET, grant_type: 'refresh_token',
  });
  const expiresAt = new Date(Date.now() + (Number(tok.expires_in) || 3600) * 1000);
  await libDb.getPool().query(
    `UPDATE hh_google_tokens SET access_token=$2, expires_at=$3, updated_at=now() WHERE user_id=$1`,
    [userId, encrypt(tok.access_token), expiresAt]);
  return tok.access_token;
}

// ---------------------------------------------------------------------------
// Events
// ---------------------------------------------------------------------------

// 60s per-user cache. The phone re-checks on every foreground; without this,
// pocket-to-hand-and-back would hit Google's quota for no new information.
const cache = new Map();
const CACHE_MS = 60_000;

/**
 * The UTC offset a timezone is at on a given calendar day, as "-04:00".
 * Computed for that specific day, not for "now" — otherwise a day either side
 * of a DST change gets a window shifted by an hour and drops the first or last
 * event of the day.
 */
function offsetFor(tz, dateStr) {
  try {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: tz, timeZoneName: 'longOffset',
    }).formatToParts(new Date(`${dateStr}T12:00:00Z`));
    const name = parts.find((p) => p.type === 'timeZoneName')?.value || 'GMT+00:00';
    const m = /GMT([+-])(\d{2}):(\d{2})/.exec(name);
    return m ? `${m[1]}${m[2]}:${m[3]}` : '+00:00';
  } catch { return '+00:00'; }
}

/**
 * Today's events on the user's primary calendar.
 * Returns { events } or { error } — never throws, so a Google outage degrades
 * the calendar card instead of taking down the screen it sits on.
 */
async function eventsForDay(userId, tz, dateStr) {
  if (!configured()) return { error: 'not-configured', events: [] };

  const ck = `${userId}:${dateStr}`;
  const hit = cache.get(ck);
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.value;

  try {
    const at = await accessToken(userId);
    if (!at) return { error: 'not-connected', events: [] };

    const off = offsetFor(tz, dateStr);
    const p = new URLSearchParams({
      timeMin: `${dateStr}T00:00:00${off}`,
      timeMax: `${dateStr}T23:59:59${off}`,
      // Expands recurring events into their individual instances; without it a
      // weekly standup returns as one master row and never shows on the day.
      singleEvents: 'true',
      orderBy: 'startTime',
      maxResults: '25',
      timeZone: tz,
    });

    const r = await fetch(`${EVENTS_ENDPOINT}?${p}`, { headers: { Authorization: `Bearer ${at}` } });
    if (r.status === 401 || r.status === 403) {
      // Access revoked from the Google side. Say so plainly so the UI can offer
      // Reconnect rather than showing an empty day and implying nothing's on.
      return { error: 'revoked', events: [] };
    }
    if (!r.ok) return { error: `google-${r.status}`, events: [] };

    const j = await r.json();
    const events = (j.items || [])
      .filter((e) => e.status !== 'cancelled')
      .map((e) => ({
        id: e.id,
        summary: e.summary || '(no title)',
        // All-day events carry `date`; timed ones carry `dateTime`.
        allDay: !e.start?.dateTime,
        start: e.start?.dateTime || e.start?.date || null,
        end: e.end?.dateTime || e.end?.date || null,
        location: e.location || null,
      }));

    const value = { events };
    cache.set(ck, { at: Date.now(), value });
    // Bounded so a long-running process can't grow this forever.
    if (cache.size > 200) cache.delete(cache.keys().next().value);
    return value;
  } catch (err) {
    return { error: String(err?.message || err), events: [] };
  }
}

module.exports = {
  configured, missingConfig, REDIRECT_URI, BASE_URL,
  authUrl, verifyState, connect, disconnect, status, eventsForDay,
  // exported for tests
  _encrypt: encrypt, _decrypt: decrypt, _signState: signState, _offsetFor: offsetFor,
};
