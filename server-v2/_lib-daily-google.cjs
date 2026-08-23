'use strict';
/**
 * server-v2/_lib-daily-google.cjs — Google identity and Google Calendar for
 * daily.cbedge.net.
 *
 * Ported from _lib-google-calendar.cjs (the private budget.cbedge.net build) and
 * widened in two directions: this one can WRITE events, and the same OAuth
 * client also signs people in. The design rules the original file was built on
 * survive intact; two of them are restated below because the widening puts real
 * pressure on them.
 *
 * ── DESIGN RULES ──────────────────────────────────────────────────────────
 *
 *   1. The browser NEVER sees a Google token. Not the access token, not the
 *      refresh token, not the id_token. The SPA calls our endpoints, we call
 *      Google server-side, and the browser gets plain JSON back. There is no
 *      client-side Google SDK, nothing in localStorage, and nothing in a URL
 *      fragment. This is the single rule most worth keeping: a token that never
 *      reaches a browser cannot be exfiltrated by an XSS bug in our own SPA.
 *
 *   2. Refresh tokens are encrypted at rest with AES-256-GCM, keyed by scrypt
 *      from DAILY_TOKEN_KEY. A refresh token is a permanent key to a paying
 *      customer's calendar — and now a permanent WRITE key. A dump of
 *      daily_google_tokens without the env file is inert.
 *
 *   3. Scope now includes calendar.events, which is read AND write. Be honest
 *      about the cost: this app can create, modify and delete events on any
 *      calendar the account can write to, and a compromised server could do it
 *      silently. The old app deliberately took calendar.readonly so that even a
 *      total compromise was a confidentiality problem and never an integrity
 *      one. That protection is gone.
 *
 *      It is justified because the product's promise is "add it to my calendar
 *      from Today" — a planner that can only read is a viewer, and the whole
 *      reason someone pays for this is to capture a thing in one tap while it
 *      is still in their head. What we DON'T do is spend the extra power
 *      casually:
 *
 *        * calendar.readonly is still requested alongside, because reading
 *          subscribed/holiday calendars a user cannot write to is what makes
 *          the Today screen complete, and events-scope alone would not see them.
 *        * every write path requires an explicit calendarId from the caller.
 *          There is no "default to primary" branch anywhere in this file. A
 *          missing or unknown calendar id is an error, never a guess — the
 *          failure that prevents is an event silently landing on someone's
 *          personal calendar when they meant the shared family one, which is
 *          the kind of bug people discover at a dentist's office.
 *        * before any write we confirm the target calendar is one this account
 *          actually holds owner/writer on, so a tampered request body cannot
 *          aim a POST at an arbitrary calendar id and let Google decide.
 *
 *   4. Google being slow, down, rate-limited or revoked must NEVER break the
 *      Today screen. Every read path returns a shaped result or an { error }.
 *      Nothing in here throws into a route.
 *
 * ── SIGN IN WITH GOOGLE ───────────────────────────────────────────────────
 *
 * One OAuth client, one callback URL, two purposes, told apart by our own
 * signed `state`:
 *
 *   purpose:'connect' — a signed-in user linking their Google account so the
 *                       calendar features light up. Identity already known.
 *   purpose:'signin'  — a signed-out visitor authenticating. Identity is the
 *                       entire output, so it has to be PROVEN, not read.
 *
 * For 'signin' we verify the id_token ourselves against Google's published
 * JWKS: RS256 signature, `iss`, `aud` equal to our client id, `exp`, and
 * `email_verified`. Only a token that passes all of it reaches
 * daily.loginWithGoogle(), which trusts its input completely and will happily
 * link an existing password account by email address. Skipping any one of those
 * checks — most sharply the `aud` check — turns "sign in with Google" into
 * "sign in as anyone", because an id_token minted for a DIFFERENT application
 * is still a perfectly valid, correctly signed Google token.
 *
 * No JWT library: node:crypto's createPublicKey (JWK input) plus createVerify
 * is the whole implementation, and it keeps this file at zero dependencies.
 *
 * ── ENV ───────────────────────────────────────────────────────────────────
 *   GOOGLE_CLIENT_ID      — OAuth 2.0 Web client id (also the expected `aud`)
 *   GOOGLE_CLIENT_SECRET  — its secret
 *   DAILY_TOKEN_KEY       — 32+ random bytes, hex. Encrypts stored refresh
 *                           tokens and signs OAuth state. openssl rand -hex 32
 *   DAILY_BASE_URL        — optional, defaults to https://daily.cbedge.net.
 *                           Must match the Authorised redirect URI in Google
 *                           Cloud Console EXACTLY, scheme and path included.
 *
 * Missing config is not a crash: configured() returns false and the UI shows
 * "not set up" rather than a Connect button that dead-ends on Google's error
 * page.
 */

const crypto = require('crypto');

let daily = null;
try { daily = require('./_lib-daily.cjs'); }
catch (e) { console.warn('[daily-google] _lib-daily.cjs not loaded — Google disabled:', e.message); }

const CLIENT_ID = (process.env.GOOGLE_CLIENT_ID || '').trim();
const CLIENT_SECRET = (process.env.GOOGLE_CLIENT_SECRET || '').trim();
const TOKEN_KEY_RAW = (process.env.DAILY_TOKEN_KEY || '').trim();
const BASE_URL = (process.env.DAILY_BASE_URL || 'https://daily.cbedge.net').trim().replace(/\/+$/, '');

const REDIRECT_URI = `${BASE_URL}/api/daily/google/callback`;

/**
 * The full scope set for a connect. `openid email profile` is what makes the
 * same grant usable for authentication; the two calendar scopes are explained
 * in design rule 3. Order is irrelevant to Google but kept stable so that the
 * string stored in `scope` is comparable across rows by eye.
 */
const SCOPE_CONNECT = [
  'openid',
  'email',
  'profile',
  'https://www.googleapis.com/auth/calendar.events',
  'https://www.googleapis.com/auth/calendar.readonly',
].join(' ');

/**
 * Sign-in asks for identity ONLY. A stranger who has not yet created an account
 * should not be shown a consent screen listing calendar write access — it is
 * the highest-friction moment in the funnel and we would be asking for power we
 * cannot use yet (there is no household to attach a token to). Calendar access
 * is requested later, from Settings, by someone who has already decided to stay.
 */
const SCOPE_SIGNIN = 'openid email profile';

const AUTH_ENDPOINT = 'https://accounts.google.com/o/oauth2/v2/auth';
const TOKEN_ENDPOINT = 'https://oauth2.googleapis.com/token';
const REVOKE_ENDPOINT = 'https://oauth2.googleapis.com/revoke';
const JWKS_ENDPOINT = 'https://www.googleapis.com/oauth2/v3/certs';
const USERINFO_ENDPOINT = 'https://www.googleapis.com/oauth2/v2/userinfo';
const CAL_BASE = 'https://www.googleapis.com/calendar/v3';
const CALENDAR_LIST_ENDPOINT = `${CAL_BASE}/users/me/calendarList`;
const eventsEndpoint = (calId) => `${CAL_BASE}/calendars/${encodeURIComponent(calId)}/events`;
const eventEndpoint = (calId, evId) =>
  `${CAL_BASE}/calendars/${encodeURIComponent(calId)}/events/${encodeURIComponent(evId)}`;

/** Google's own issuer values. Both spellings are legitimate and both appear in
 *  the wild depending on the flow, so both are accepted — and nothing else is. */
const ISSUERS = new Set(['accounts.google.com', 'https://accounts.google.com']);

/** Tolerance for clock drift between this box and Google when checking exp/iat.
 *  Small on purpose: it exists for NTP jitter, not for accepting stale tokens. */
const CLOCK_SKEW_MS = 60_000;

const available = () => !!(daily && daily.available && daily.available());

/** True when this deployment can actually talk to Google. */
function configured() {
  return !!(available() && CLIENT_ID && CLIENT_SECRET && TOKEN_KEY_RAW);
}

/** Which specific piece is missing — surfaced to the owner, never to a browser. */
function missingConfig() {
  const missing = [];
  if (!CLIENT_ID) missing.push('GOOGLE_CLIENT_ID');
  if (!CLIENT_SECRET) missing.push('GOOGLE_CLIENT_SECRET');
  if (!TOKEN_KEY_RAW) missing.push('DAILY_TOKEN_KEY');
  if (!available()) missing.push('_lib-daily.cjs');
  return missing;
}

function pool() { return daily.pool(); }

// ---------------------------------------------------------------------------
// Encryption at rest
// ---------------------------------------------------------------------------

// scrypt-derived so DAILY_TOKEN_KEY can be any string, not strictly 32 raw
// bytes. Derived once and held, because scrypt is deliberately slow and this
// key is needed on every single token read.
let KEY = null;
function key() {
  if (!KEY) KEY = crypto.scryptSync(TOKEN_KEY_RAW, 'daily-google-token-v1', 32);
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
    // Wrong key (DAILY_TOKEN_KEY rotated) or tampered ciphertext. Treated as
    // "no token" so the user is asked to reconnect rather than shown a 500 they
    // can do nothing about.
    return null;
  }
}

// ---------------------------------------------------------------------------
// OAuth state — signed, short-lived, and it carries the purpose
// ---------------------------------------------------------------------------

const STATE_TTL_MS = 10 * 60_000;

/**
 * The state is not just CSRF protection here; it is the only thing that tells
 * the callback whether it is finishing a link or an authentication. That makes
 * it security-relevant in a second way: an attacker who could flip
 * purpose:'connect' to purpose:'signin' would turn a link click into a session
 * mint. Hence the HMAC over the whole payload, and hence purpose is read only
 * from inside the verified blob — never from a query parameter.
 */
function signState({ purpose, userId = null, next = null }) {
  const payload = Buffer.from(JSON.stringify({
    p: purpose,
    uid: userId,
    next: safeNext(next),
    n: crypto.randomBytes(9).toString('base64url'),
    exp: Date.now() + STATE_TTL_MS,
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
    if (data.p !== 'connect' && data.p !== 'signin') return null;
    return data;
  } catch { return null; }
}

/**
 * Where we are allowed to send the browser after the callback.
 *
 * `next` arrives from a link the user clicked and comes straight back out of
 * this module as a redirect Location. Anything that is not a single-slash
 * site-relative path is dropped, because "//evil.example" and
 * "https://evil.example" are both valid Location values and both turn our
 * OAuth callback into an open redirect — the classic way a phishing page
 * borrows a trusted domain's URL bar.
 */
function safeNext(next) {
  const s = String(next || '');
  if (!s.startsWith('/') || s.startsWith('//')) return null;
  return s.slice(0, 512);
}

// ---------------------------------------------------------------------------
// Consent URL
// ---------------------------------------------------------------------------

/**
 * Build the Google consent URL for either purpose.
 *
 * For 'connect' we send access_type=offline AND prompt=consent. Both are
 * needed and the second is the one that gets dropped by someone tidying up:
 * Google returns a refresh_token only on an authorisation where the user is
 * actually shown the consent screen. On a RE-authorisation — the same account
 * that has already granted these scopes, which is exactly what a reconnect is —
 * Google recognises the existing grant, skips consent, and returns an access
 * token with no refresh_token at all. The symptom is nasty precisely because it
 * is intermittent: the first connect on a fresh account works, every reconnect
 * afterwards stores nothing refreshable, and the connection dies silently an
 * hour later when the access token expires. prompt=consent forces the screen
 * every time and therefore forces the refresh_token every time.
 *
 * For 'signin' none of that applies — we want an id_token, not long-lived
 * access — so we ask for select_account instead, which is also what a person
 * with two Google accounts expects when they click "sign in".
 */
function authUrl({ purpose = 'connect', userId = null, next = null } = {}) {
  if (!configured()) return null;
  if (purpose !== 'connect' && purpose !== 'signin') {
    throw new Error(`daily-google: unknown purpose ${purpose}`);
  }
  if (purpose === 'connect' && !userId) {
    throw new Error('daily-google: connect requires a signed-in userId');
  }

  const p = new URLSearchParams({
    client_id: CLIENT_ID,
    redirect_uri: REDIRECT_URI,
    response_type: 'code',
    scope: purpose === 'connect' ? SCOPE_CONNECT : SCOPE_SIGNIN,
    state: signState({ purpose, userId, next }),
    include_granted_scopes: 'true',
  });
  if (purpose === 'connect') {
    p.set('access_type', 'offline');
    p.set('prompt', 'consent');
  } else {
    p.set('prompt', 'select_account');
  }
  return `${AUTH_ENDPOINT}?${p}`;
}

// ---------------------------------------------------------------------------
// Token endpoint
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// id_token verification
// ---------------------------------------------------------------------------

/**
 * Google's signing keys, cached.
 *
 * Google rotates these on the order of days and publishes the rotation window
 * in Cache-Control, so we honour max-age rather than picking a number. The
 * cache matters for a plain reason: without it every sign-in costs a second
 * outbound round trip before we can even look at the token, and a JWKS fetch
 * that fails would take the whole login with it.
 */
const jwks = { keys: new Map(), at: 0, ttl: 0, refetchedAt: 0 };

async function loadJwks(force = false) {
  const fresh = jwks.keys.size > 0 && Date.now() - jwks.at < jwks.ttl;
  if (fresh && !force) return jwks.keys;

  // A token naming a kid we don't hold could be a genuine rotation — or a
  // forgery with a random kid. Refetching on demand handles the first; the
  // one-minute floor stops the second from becoming an outbound request per
  // attempt, which is a free amplifier pointed at Google on our quota.
  if (force && Date.now() - jwks.refetchedAt < 60_000) return jwks.keys;
  if (force) jwks.refetchedAt = Date.now();

  const r = await fetch(JWKS_ENDPOINT);
  if (!r.ok) throw new Error(`jwks ${r.status}`);
  const body = await r.json();

  const next = new Map();
  for (const jwk of body?.keys || []) {
    if (jwk.kty !== 'RSA' || (jwk.alg && jwk.alg !== 'RS256')) continue;
    try { next.set(jwk.kid, crypto.createPublicKey({ key: jwk, format: 'jwk' })); }
    catch { /* one unusable key must not poison the rest of the set */ }
  }
  if (!next.size) throw new Error('jwks: no usable RSA keys');

  const maxAge = /max-age=(\d+)/i.exec(r.headers.get('cache-control') || '');
  jwks.keys = next;
  jwks.at = Date.now();
  jwks.ttl = Math.max(5 * 60_000, (maxAge ? Number(maxAge[1]) : 3600) * 1000);
  return jwks.keys;
}

function b64urlJson(seg) {
  return JSON.parse(Buffer.from(String(seg), 'base64url').toString('utf8'));
}

/**
 * Verify a Google id_token and return its claims.
 *
 * Throws on anything suspect. Every check below is load-bearing:
 *
 *   alg           — must be RS256 and must come from OUR table of keys, not
 *                   from the token. A verifier that trusts the header's alg is
 *                   the "alg:none" bug, and its close cousin where an attacker
 *                   downgrades RS256 to HS256 and signs with the public key.
 *   signature     — proves Google minted it.
 *   iss           — proves it came from Google's identity service.
 *   aud           — proves it was minted FOR US. Without this, any id_token
 *                   from any other Google-integrated app on the internet is a
 *                   valid login here, and those tokens are handed to whoever
 *                   runs that other app.
 *   exp           — proves it is not a replay of an old capture.
 *   email_verified— proves the address is really theirs. loginWithGoogle links
 *                   an existing password account by email, so an unverified
 *                   address would be an account-takeover primitive: sign up to
 *                   Google with someone else's address, click the button, land
 *                   inside their household.
 */
async function verifyIdToken(idToken) {
  const parts = String(idToken || '').split('.');
  if (parts.length !== 3) throw new Error('id_token: malformed');

  const header = b64urlJson(parts[0]);
  if (header.alg !== 'RS256') throw new Error(`id_token: unexpected alg ${header.alg}`);

  let keys = await loadJwks();
  let pub = keys.get(header.kid);
  if (!pub) { keys = await loadJwks(true); pub = keys.get(header.kid); }
  if (!pub) throw new Error('id_token: unknown signing key');

  const signed = `${parts[0]}.${parts[1]}`;
  const ok = crypto.createVerify('RSA-SHA256')
    .update(signed)
    .verify(pub, Buffer.from(parts[2], 'base64url'));
  if (!ok) throw new Error('id_token: bad signature');

  const claims = b64urlJson(parts[1]);
  if (!ISSUERS.has(String(claims.iss))) throw new Error('id_token: bad issuer');
  if (String(claims.aud) !== CLIENT_ID) throw new Error('id_token: wrong audience');

  const now = Date.now();
  if (!claims.exp || now > Number(claims.exp) * 1000 + CLOCK_SKEW_MS) {
    throw new Error('id_token: expired');
  }
  if (claims.iat && Number(claims.iat) * 1000 - CLOCK_SKEW_MS > now) {
    throw new Error('id_token: issued in the future');
  }
  // Google sends this as a real boolean, but older/edge responses have used the
  // string "true"; accepting both is safe, accepting anything else is not.
  const verified = claims.email_verified === true || claims.email_verified === 'true';
  if (!claims.email || !verified) throw new Error('id_token: email not verified');
  if (!claims.sub) throw new Error('id_token: no subject');

  return {
    sub: String(claims.sub),
    email: String(claims.email),
    name: claims.name || null,
    given_name: claims.given_name || null,
    picture: claims.picture || null,
  };
}

// ---------------------------------------------------------------------------
// Callback
// ---------------------------------------------------------------------------

/**
 * Finish either flow. Returns a shaped result — including on failure — because
 * the callback route's job is to redirect a human somewhere sensible, not to
 * render a stack trace at the end of an OAuth dance.
 *
 * Shape: { ok, purpose, userId, profile, cookie?, redirect, error? }
 */
async function handleCallback({ code, state, req } = {}) {
  if (!configured()) {
    return { ok: false, purpose: null, userId: null, profile: null,
             error: 'not-configured', redirect: '/settings?google=unavailable' };
  }

  const st = verifyState(state);
  if (!st) {
    // Expired (the tab sat open for an hour) or forged. Same answer either way:
    // start over. Never fall back to trusting the query string.
    return { ok: false, purpose: null, userId: null, profile: null,
             error: 'bad-state', redirect: '/signin?google=expired' };
  }
  if (!code) {
    // The user pressed Cancel on Google's screen. Not an error worth shouting
    // about — put them back where they were.
    return { ok: false, purpose: st.p, userId: st.uid, profile: null, error: 'cancelled',
             redirect: st.p === 'signin' ? '/signin?google=cancelled' : (st.next || '/settings') };
  }

  try {
    const tok = await postToken({
      code,
      client_id: CLIENT_ID,
      client_secret: CLIENT_SECRET,
      redirect_uri: REDIRECT_URI,
      grant_type: 'authorization_code',
    });
    return st.p === 'signin'
      ? await finishSignin(tok, st, req)
      : await finishConnect(tok, st);
  } catch (err) {
    const msg = String(err?.message || err);
    return { ok: false, purpose: st.p, userId: st.uid, profile: null, error: msg,
             redirect: st.p === 'signin' ? '/signin?google=failed' : '/settings?google=failed' };
  }
}

async function finishSignin(tok, st, req) {
  if (!tok.id_token) throw new Error('Google returned no id_token');
  const profile = await verifyIdToken(tok.id_token);

  // Only now, with the signature, audience, issuer, expiry and email_verified
  // all checked, is this profile safe to hand over — loginWithGoogle trusts it
  // completely and may link it onto an existing password account by email.
  const res = await daily.loginWithGoogle({ profile, req });
  if (!res?.ok) {
    return { ok: false, purpose: 'signin', userId: null, profile,
             error: res?.error || 'sign-in refused', redirect: '/signin?google=refused' };
  }
  return {
    ok: true,
    purpose: 'signin',
    userId: res.user?.id ?? null,
    profile,
    // The session cookie is passed back out rather than set here: this module
    // does not own the HTTP response, and a library that quietly writes headers
    // is a library you cannot test.
    cookie: res.cookie,
    redirect: st.next || (res.created ? '/welcome' : '/today'),
  };
}

async function finishConnect(tok, st) {
  const userId = st.uid;
  if (!userId) throw new Error('connect callback without a user');

  if (!tok.refresh_token) {
    // With prompt=consent above this should not happen; when it does, the fix
    // is on Google's side of the relationship, so say exactly what to do rather
    // than storing a connection that will stop working within the hour.
    throw new Error('Google did not return a refresh token. Remove this app at ' +
                    'myaccount.google.com/permissions and connect again.');
  }

  // The household id is copied onto the token row so eventsForHousehold can find
  // sharing members with one indexed query instead of a join on every read.
  const { rows } = await pool().query(
    `SELECT id, household_id FROM daily_users WHERE id=$1 AND active`, [userId]);
  if (!rows[0]) throw new Error('connect callback for an unknown user');
  const householdId = rows[0].household_id;

  // Prefer the id_token's email — it is signed. userinfo is the fallback for a
  // grant that somehow came back without one; the address is a display nicety,
  // so a failure here must not sink an otherwise good connection.
  let email = null;
  if (tok.id_token) {
    try { email = (await verifyIdToken(tok.id_token)).email; } catch { /* fall through */ }
  }
  if (!email) {
    try {
      const r = await fetch(USERINFO_ENDPOINT, { headers: { Authorization: `Bearer ${tok.access_token}` } });
      if (r.ok) email = (await r.json())?.email ?? null;
    } catch { /* nicety, not a requirement */ }
  }

  const expiresAt = new Date(Date.now() + (Number(tok.expires_in) || 3600) * 1000);
  await pool().query(
    `INSERT INTO daily_google_tokens
       (user_id, household_id, google_email, refresh_token, access_token, expires_at, scope, updated_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,now())
     ON CONFLICT (user_id) DO UPDATE SET
       household_id=EXCLUDED.household_id, google_email=EXCLUDED.google_email,
       refresh_token=EXCLUDED.refresh_token, access_token=EXCLUDED.access_token,
       expires_at=EXCLUDED.expires_at, scope=EXCLUDED.scope, updated_at=now()`,
    [userId, householdId, email, encrypt(tok.refresh_token),
     encrypt(tok.access_token), expiresAt, tok.scope || SCOPE_CONNECT]);

  // share_with_household defaults TRUE in the schema and we leave it alone here.
  // A household is two people who already share a fridge calendar; the common
  // case is one of them linking it so both stop asking each other what's on. It
  // only ever exposes the SELECTED calendars, and a reconnect must not silently
  // re-enable sharing someone deliberately turned off — hence no UPDATE.
  clearCaches(userId);
  needsReconnect.delete(userId);

  return {
    ok: true,
    purpose: 'connect',
    userId,
    profile: { email },
    redirect: st.next || '/settings?google=connected',
  };
}

// ---------------------------------------------------------------------------
// Token rows and access tokens
// ---------------------------------------------------------------------------

const TOKEN_COL_LIST = [
  'user_id', 'household_id', 'google_email', 'refresh_token', 'access_token',
  'expires_at', 'scope', 'share_with_household', 'selected_calendars', 'last_synced_at',
];
const TOKEN_COLS = TOKEN_COL_LIST.join(', ');
/** The same columns qualified for a join — kept derived rather than written out
 *  twice, because the two lists drifting apart is a silent missing-column bug. */
const TOKEN_COLS_G = TOKEN_COL_LIST.map((c) => `g.${c}`).join(', ');

/**
 * Connections whose refresh failed and that therefore need the user to press
 * Connect again.
 *
 * Deliberately in memory: the schema for daily_google_tokens is owned by
 * _lib-daily.cjs and this module does not get to add a column to it. Losing the
 * flag on restart is harmless — the very next refresh attempt fails the same
 * way and re-sets it, at the cost of one wasted round trip. What the flag buys
 * in the meantime is that Settings can say "reconnect Google" instead of the
 * Today screen quietly showing an empty day forever.
 */
const needsReconnect = new Set();

async function tokenRow(userId) {
  const { rows } = await pool().query(
    `SELECT ${TOKEN_COLS} FROM daily_google_tokens WHERE user_id=$1`, [userId]);
  return rows[0] || null;
}

/**
 * A usable access token for one connection, refreshed 2 minutes before expiry.
 *
 * The margin is not decoration: an access token that is valid when we check it
 * and expired by the time Google reads it produces a 401 that looks exactly
 * like a revoked grant, and we would tell the user to reconnect a connection
 * that was fine. Two minutes covers a slow request and a drifting clock.
 *
 * Returns null instead of throwing on failure — a dead refresh token is a
 * "please reconnect" state, not a 500 on the Today screen.
 */
async function accessTokenFor(row) {
  if (!row) return null;
  const userId = row.user_id;

  const stillGood = row.access_token && row.expires_at &&
    new Date(row.expires_at).getTime() - Date.now() > 120_000;
  if (stillGood) {
    const at = decrypt(row.access_token);
    if (at) return at;
  }

  const rt = decrypt(row.refresh_token);
  if (!rt) { needsReconnect.add(userId); return null; } // key rotated, or tampered

  try {
    const tok = await postToken({
      refresh_token: rt, client_id: CLIENT_ID, client_secret: CLIENT_SECRET,
      grant_type: 'refresh_token',
    });
    const expiresAt = new Date(Date.now() + (Number(tok.expires_in) || 3600) * 1000);
    await pool().query(
      `UPDATE daily_google_tokens SET access_token=$2, expires_at=$3, updated_at=now()
        WHERE user_id=$1`,
      [userId, encrypt(tok.access_token), expiresAt]);
    needsReconnect.delete(userId);
    return tok.access_token;
  } catch {
    // The user revoked us at myaccount.google.com, changed their password, or
    // Google's token endpoint is down. We cannot tell which from here, and
    // guessing wrong is cheap either way: mark it, return null, let the caller
    // report 'not-connected'. A transient outage clears itself on the next try.
    needsReconnect.add(userId);
    return null;
  }
}

/**
 * Stamp "Google actually answered" on a connection.
 *
 * Deliberately not updated_at, which moves on every silent access-token refresh
 * and therefore says nothing about whether the EVENTS on screen are current.
 * Fire-and-forget: a failed timestamp write must never turn a good calendar
 * read into an error, and the events are already in hand when it runs.
 */
function touchSync(userId) {
  pool().query(`UPDATE daily_google_tokens SET last_synced_at=now() WHERE user_id=$1`, [userId])
    .catch(() => { /* the timestamp is a nicety; the events are not */ });
}

// ---------------------------------------------------------------------------
// Caches
// ---------------------------------------------------------------------------

// 60s per-range event cache. A phone re-checks on every foreground; without
// this, pocket-to-hand-and-back costs a Google call per calendar for no new
// information, and quota is per project, shared across every customer.
const eventCache = new Map();
const EVENT_CACHE_MS = 60_000;

// Calendar lists move about once a year and are needed on every read (for
// colours and names) and before every write (for access role). 5 minutes.
const calCache = new Map();
const CAL_CACHE_MS = 5 * 60_000;

function clearCaches(userId) {
  calCache.delete(userId);
  // Event cache keys are prefixed by the READER's id, and a change on one
  // connection can alter what every household member sees, so the whole map
  // goes rather than one slice.
  eventCache.clear();
}

function cacheGet(map, k, ttl) {
  const hit = map.get(k);
  if (hit && Date.now() - hit.at < ttl) return hit.value;
  return undefined;
}

function cacheSet(map, k, value, cap = 200) {
  map.set(k, { at: Date.now(), value });
  // Bounded so a long-lived process can't grow these without limit.
  if (map.size > cap) map.delete(map.keys().next().value);
  return value;
}

// ---------------------------------------------------------------------------
// Calendar list
// ---------------------------------------------------------------------------

/**
 * Every calendar the connected account can see — personal, shared, subscribed,
 * holidays, birthdays.
 *
 * `showHidden=true` is load-bearing and easy to lose in a tidy-up. Google
 * defaults it to false, and "hidden" there means only "unticked in Google's own
 * sidebar" — a calendar someone hid because it cluttered google.com is exactly
 * the one they then cannot find in our picker. The list simply comes back short
 * with no error to explain the gap.
 *
 * Returns raw-ish entries; the public listCalendars() shapes them.
 */
async function fetchCalendars(row, accessTok) {
  const cached = cacheGet(calCache, row.user_id, CAL_CACHE_MS);
  if (cached) return cached;

  const r = await fetch(`${CALENDAR_LIST_ENDPOINT}?maxResults=250&minAccessRole=reader&showHidden=true`,
                        { headers: { Authorization: `Bearer ${accessTok}` } });
  if (r.status === 401 || r.status === 403) { needsReconnect.add(row.user_id); throw new Error('revoked'); }
  if (!r.ok) throw new Error(`google-${r.status}`);
  const j = await r.json();

  const items = (j.items || []).map((c) => ({
    id: c.id,
    summary: c.summaryOverride || c.summary || c.id,
    primary: !!c.primary,
    backgroundColor: c.backgroundColor || null,
    accessRole: c.accessRole || 'reader',
    // Google's own "is this ticked in my sidebar" flag — a decent hint for
    // which ones a user actually cares about when we render the picker.
    selectedInGoogle: c.selected !== false,
  }));
  items.sort((a, b) => (b.primary ? 1 : 0) - (a.primary ? 1 : 0) || a.summary.localeCompare(b.summary));
  return cacheSet(calCache, row.user_id, items);
}

/** owner and writer can create events; reader and freeBusyReader cannot. */
const WRITABLE_ROLES = new Set(['owner', 'writer']);

/** Which calendar ids to READ for a connection. */
function calendarIdsFor(row) {
  const sel = row.selected_calendars;
  // NULL means "never opened the picker". Primary is the safe default for a
  // READ: it is the account's own calendar, never a subscribed holiday feed.
  // Note this is a read-side default only — writes never fall back like this.
  if (!Array.isArray(sel) || !sel.length) return ['primary'];
  return sel.slice(0, 50);
}

/** Colour/name lookup for tinting events, keyed by calendar id. */
function calendarIndex(items) {
  const map = new Map();
  for (const c of items) {
    const entry = { colour: c.backgroundColor, name: c.summary, accessRole: c.accessRole };
    map.set(c.id, entry);
    // We read the default calendar by the literal id "primary", but
    // calendarList returns it under the account's email address. Without this
    // alias every event on the default calendar comes back with no colour and
    // no name — which is the default for anyone who hasn't opened the picker.
    if (c.primary) map.set('primary', entry);
  }
  return map;
}

// ---------------------------------------------------------------------------
// Public: status and settings
// ---------------------------------------------------------------------------

async function statusFor(user) {
  const base = {
    connected: false, googleEmail: null, shareWithHousehold: null,
    selectedCalendars: null, lastSyncedAt: null, scopes: [],
  };
  if (!configured()) return { ...base, error: 'not-configured' };
  try {
    const row = await tokenRow(user?.id);
    if (!row) return base;
    return {
      connected: true,
      googleEmail: row.google_email ?? null,
      shareWithHousehold: !!row.share_with_household,
      selectedCalendars: Array.isArray(row.selected_calendars) ? row.selected_calendars : null,
      lastSyncedAt: row.last_synced_at ? new Date(row.last_synced_at).toISOString() : null,
      // The scopes actually GRANTED, not the ones we asked for. A user can
      // untick calendar access on Google's consent screen and still complete
      // the flow, and the UI needs to say "reconnect to allow adding events"
      // rather than offering an Add button that 403s.
      scopes: String(row.scope || '').split(/\s+/).filter(Boolean),
      needsReconnect: needsReconnect.has(row.user_id),
    };
  } catch (err) {
    return { ...base, error: String(err?.message || err) };
  }
}

/** The user's calendars, with what we hold selected. Shaped or { error }. */
async function listCalendars(user) {
  if (!configured()) return { error: 'not-configured', calendars: [] };
  try {
    const row = await tokenRow(user?.id);
    if (!row) return { error: 'not-connected', calendars: [] };
    const at = await accessTokenFor(row);
    if (!at) return { error: 'not-connected', calendars: [] };

    const items = await fetchCalendars(row, at);
    return {
      calendars: items.map((c) => ({
        id: c.id,
        summary: c.summary,
        primary: c.primary,
        backgroundColor: c.backgroundColor,
        accessRole: c.accessRole,
        // Surfaced so the client can grey out "add to this one" instead of
        // letting someone compose an event and lose it to a 403 on save.
        writable: WRITABLE_ROLES.has(c.accessRole),
      })),
      selected: Array.isArray(row.selected_calendars) ? row.selected_calendars : null,
      shareWithHousehold: !!row.share_with_household,
    };
  } catch (err) {
    const msg = String(err?.message || err);
    return { error: msg === 'revoked' ? 'revoked' : msg, calendars: [] };
  }
}

/** Persist which calendars feed this user's Today screen. */
async function selectCalendars(user, ids) {
  if (!configured()) return { ok: false, error: 'not-configured' };
  try {
    const clean = (Array.isArray(ids) ? ids : [])
      .map((s) => String(s).trim()).filter(Boolean).slice(0, 50);
    const { rowCount } = await pool().query(
      `UPDATE daily_google_tokens SET selected_calendars=$2, updated_at=now() WHERE user_id=$1`,
      [user?.id, JSON.stringify(clean)]);
    clearCaches(user?.id);
    return rowCount ? { ok: true, selected: clean } : { ok: false, error: 'not-connected' };
  } catch (err) {
    return { ok: false, error: String(err?.message || err) };
  }
}

/** Turn household sharing on or off for this user's connection. */
async function setSharing(user, share) {
  if (!configured()) return { ok: false, error: 'not-configured' };
  try {
    const { rowCount } = await pool().query(
      `UPDATE daily_google_tokens SET share_with_household=$2, updated_at=now() WHERE user_id=$1`,
      [user?.id, !!share]);
    clearCaches(user?.id);
    return rowCount ? { ok: true, shareWithHousehold: !!share } : { ok: false, error: 'not-connected' };
  } catch (err) {
    return { ok: false, error: String(err?.message || err) };
  }
}

/**
 * Unlink Google.
 *
 * Revoking at Google first is the part that matters to a person who is
 * disconnecting because they no longer trust us: it removes the grant from
 * their own account page, not just from our table. But the revoke is a network
 * call to a third party and the DELETE is not — so a failed revoke must never
 * leave the row behind. "Disconnect didn't work, try again" while we still hold
 * a live write key to their calendar is the worst possible outcome here.
 */
async function disconnect(user) {
  if (!configured()) return { ok: false, error: 'not-configured' };
  const userId = user?.id;
  let revoked = false;
  try {
    const row = await tokenRow(userId);
    const rt = row && decrypt(row.refresh_token);
    if (rt) {
      const r = await fetch(`${REVOKE_ENDPOINT}?token=${encodeURIComponent(rt)}`, { method: 'POST' })
        .catch(() => null);
      revoked = !!(r && r.ok);
    }
  } catch { /* proceed to delete regardless */ }

  try {
    await pool().query(`DELETE FROM daily_google_tokens WHERE user_id=$1`, [userId]);
  } catch (err) {
    return { ok: false, error: String(err?.message || err) };
  }
  clearCaches(userId);
  needsReconnect.delete(userId);
  // revoked:false is worth reporting so Settings can suggest a manual tidy-up
  // at myaccount.google.com/permissions — the local link is already gone.
  return { ok: true, revoked };
}

// ---------------------------------------------------------------------------
// Time windows
// ---------------------------------------------------------------------------

/**
 * The UTC offset a timezone is at on a given calendar DAY, as "-04:00".
 *
 * Computed for that specific day rather than for "now", because a day on the
 * far side of a DST change would otherwise get a window shifted by an hour and
 * silently drop the first or last event of the day.
 */
function offsetFor(tz, dateStr) {
  try {
    const parts = new Intl.DateTimeFormat('en-US', { timeZone: tz, timeZoneName: 'longOffset' })
      .formatToParts(new Date(`${dateStr}T12:00:00Z`));
    const name = parts.find((p) => p.type === 'timeZoneName')?.value || 'GMT+00:00';
    const m = /GMT([+-])(\d{2}):(\d{2})/.exec(name);
    return m ? `${m[1]}${m[2]}:${m[3]}` : '+00:00';
  } catch { return '+00:00'; }
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Turn a caller's { from, to } into RFC3339 bounds.
 *
 * A bare "2026-08-23" is interpreted in the USER's timezone, not the server's.
 * A server in UTC reading a New York user's "today" as UTC midnight-to-midnight
 * is off by four or five hours in both directions: it hides the 8pm dinner and
 * shows tomorrow's 8am school run as if it were today.
 */
function windowFor(tz, from, to) {
  const f = String(from || '');
  const t = String(to || '');
  const timeMin = ISO_DATE.test(f) ? `${f}T00:00:00${offsetFor(tz, f)}` : f;
  const timeMax = ISO_DATE.test(t) ? `${t}T23:59:59${offsetFor(tz, t)}` : t;
  if (!timeMin || !timeMax) return null;
  return { timeMin, timeMax };
}

function shapeEvent(e, index) {
  const meta = index.get(e._cal);
  return {
    // Ids repeat across calendars for the same invite (you and your partner
    // both hold a copy), so the client's React key has to include the calendar
    // or one of the copies silently vanishes from the list.
    id: `${e._cal}:${e.id}`,
    eventId: e.id,
    calendarId: e._cal,
    calendarName: meta?.name || null,
    summary: e.summary || '(no title)',
    description: e.description || null,
    location: e.location || null,
    // All-day events carry `date`; timed ones carry `dateTime`.
    allDay: !e.start?.dateTime,
    start: e.start?.dateTime || e.start?.date || null,
    end: e.end?.dateTime || e.end?.date || null,
    colour: meta?.colour || null,
    // Per-calendar colour only. Per-EVENT colorId is deliberately ignored: it
    // would make two events on the same calendar look unrelated on a screen
    // whose whole job is grouping by whose calendar an event is on.
    htmlLink: e.htmlLink || null,
    // The client uses this to decide whether to offer Delete at all.
    canEdit: WRITABLE_ROLES.has(meta?.accessRole || 'reader'),
  };
}

/**
 * Read one connection's selected calendars over a window.
 *
 * Per-calendar failures are tolerated — a calendar that was deleted or unshared
 * since it was picked must not blank out the others — but they are COUNTED, and
 * if every calendar failed we report an error rather than an empty list. "You
 * have nothing on today" is the one lie this screen must never tell.
 */
async function readEvents(row, tz, timeMin, timeMax, { max = 100 } = {}) {
  const at = await accessTokenFor(row);
  if (!at) return { error: 'not-connected', events: [] };

  let index = new Map();
  try { index = calendarIndex(await fetchCalendars(row, at)); }
  catch (e) {
    if (String(e?.message) === 'revoked') return { error: 'revoked', events: [] };
    // Colours are cosmetic; a failed calendarList must not cost us the events.
  }

  const ids = calendarIdsFor(row);
  const qs = new URLSearchParams({
    timeMin, timeMax,
    // Expands recurring events into instances. Without it a weekly standup
    // comes back as a single master row and never appears on any given day.
    singleEvents: 'true',
    orderBy: 'startTime',
    maxResults: String(Math.min(250, max)),
    timeZone: tz,
  });

  // In parallel: with several calendars selected, sequential fetches stack
  // their latency and the card visibly lags the rest of the screen.
  const results = await Promise.all(ids.map(async (calId) => {
    try {
      const r = await fetch(`${eventsEndpoint(calId)}?${qs}`,
                            { headers: { Authorization: `Bearer ${at}` } });
      if (r.status === 401 || r.status === 403) return { fatal: 'revoked', failed: true, items: [] };
      if (!r.ok) return { failed: true, err: `google-${r.status}`, items: [] };
      const j = await r.json();
      return { items: (j.items || []).map((e) => ({ ...e, _cal: calId })) };
    } catch (e) { return { failed: true, err: String(e?.message || e), items: [] }; }
  }));

  // Revocation is account-wide, so one calendar reporting it means the whole
  // connection is dead. Say so instead of rendering a misleadingly empty day.
  if (results.some((r) => r.fatal === 'revoked')) {
    needsReconnect.add(row.user_id);
    return { error: 'revoked', events: [] };
  }
  if (results.length && results.every((r) => r.failed)) {
    return { error: results.find((r) => r.err)?.err || 'google-unavailable', events: [] };
  }

  const events = results.flatMap((r) => r.items)
    .filter((e) => e.status !== 'cancelled')
    .map((e) => shapeEvent(e, index));

  touchSync(row.user_id);
  return { events, partialFailures: results.filter((r) => r.failed).length };
}

function sortEvents(events) {
  // All-day first, then chronological. Comparing the raw strings is sound
  // because every timed value Google returns for one window carries the same
  // offset, and all-day values are plain dates.
  return events.sort((a, b) => (b.allDay ? 1 : 0) - (a.allDay ? 1 : 0) ||
                               String(a.start).localeCompare(String(b.start)));
}

/** This user's own events over a window. Shaped result or { error } — never throws. */
async function eventsFor(user, { from, to } = {}) {
  if (!configured()) return { error: 'not-configured', events: [] };
  const tz = user?.tz || 'America/New_York';
  const win = windowFor(tz, from, to);
  if (!win) return { error: 'bad-range', events: [] };

  const ck = `own:${user?.id}:${win.timeMin}:${win.timeMax}`;
  const hit = cacheGet(eventCache, ck, EVENT_CACHE_MS);
  if (hit) return hit;

  try {
    const row = await tokenRow(user?.id);
    if (!row) return { error: 'not-connected', events: [] };
    const res = await readEvents(row, tz, win.timeMin, win.timeMax);
    if (res.error) return res; // errors are not cached — the next try should retry
    const value = {
      events: sortEvents(res.events),
      partialFailures: res.partialFailures,
      syncedAt: new Date().toISOString(),
    };
    return cacheSet(eventCache, ck, value);
  } catch (err) {
    return { error: String(err?.message || err), events: [] };
  }
}

/**
 * Everyone's events, merged.
 *
 * The caller's own connection is always included (it is their calendar; sharing
 * is about showing it to the OTHER person, not about seeing it yourself). Every
 * other member of the same household is included only when they have
 * share_with_household on, and even then only the calendars they selected — so
 * "shared" never silently means "everything in my Google account".
 *
 * One member's Google failure degrades to a note in `failedMembers` rather than
 * an error for the whole household: your partner's revoked token is not a
 * reason to hide your own morning.
 */
async function eventsForHousehold(user, { from, to } = {}) {
  if (!configured()) return { error: 'not-configured', events: [] };
  const tz = user?.tz || 'America/New_York';
  const win = windowFor(tz, from, to);
  if (!win) return { error: 'bad-range', events: [] };

  const ck = `hh:${user?.id}:${win.timeMin}:${win.timeMax}`;
  const hit = cacheGet(eventCache, ck, EVENT_CACHE_MS);
  if (hit) return hit;

  try {
    // scoped() is the house rule for tenancy, and it applies here as much as
    // anywhere: without household_id in this WHERE clause, one customer's Today
    // screen shows another customer's calendar.
    const { where, params } = daily.scoped(user, 'g.household_id');
    const { rows } = await pool().query(
      `SELECT ${TOKEN_COLS_G}, u.display_name
         FROM daily_google_tokens g
         JOIN daily_users u ON u.id = g.user_id AND u.active
        WHERE ${where} AND (g.share_with_household = TRUE OR g.user_id = $${params.length + 1})
        ORDER BY g.user_id`,
      [...params, user?.id]);

    if (!rows.length) return { error: 'not-connected', events: [] };

    const per = await Promise.all(rows.map(async (row) => {
      try {
        const res = await readEvents(row, tz, win.timeMin, win.timeMax, { max: 50 });
        if (res.error) return { failed: row.display_name || row.google_email || `user ${row.user_id}`, events: [] };
        // Tag each event with WHOSE calendar it came from. This is the whole
        // point of the merged view — "dentist at 3" means something different
        // depending on whether it is yours or theirs.
        const owned = res.events.map((e) => ({
          ...e,
          ownerUserId: row.user_id,
          ownerName: row.display_name || null,
          ownerGoogleEmail: row.google_email || null,
          mine: row.user_id === user?.id,
        }));
        return { failed: null, events: owned };
      } catch {
        return { failed: row.display_name || `user ${row.user_id}`, events: [] };
      }
    }));

    const failedMembers = per.map((p) => p.failed).filter(Boolean);
    const events = sortEvents(per.flatMap((p) => p.events)).slice(0, 200);

    // Everyone failed — that is an outage, not an empty household calendar.
    if (!events.length && failedMembers.length === per.length) {
      return { error: 'google-unavailable', events: [], failedMembers };
    }

    const value = {
      events,
      memberCount: rows.length,
      failedMembers,
      syncedAt: new Date().toISOString(),
    };
    return cacheSet(eventCache, ck, value);
  } catch (err) {
    return { error: String(err?.message || err), events: [] };
  }
}

// ---------------------------------------------------------------------------
// Writes
// ---------------------------------------------------------------------------

/**
 * Resolve the connection and confirm the caller may WRITE to this exact
 * calendar.
 *
 * calendarId is required and is never defaulted. Two failures this prevents:
 *
 *   1. A caller that omits it — a half-finished form, a client bug — would
 *      otherwise post to "primary", and the event lands on a personal calendar
 *      the user wasn't looking at. Silent, and discovered late.
 *   2. A tampered request body naming a calendar id that belongs to someone
 *      else. Google would enforce its own permissions, but only after we had
 *      sent it, and a 403 from Google is not a sentence we can put in front of
 *      a user. Checking against the account's own calendarList means the answer
 *      is "that isn't one of your calendars", which is both true and useful.
 */
async function writableTarget(user, calendarId) {
  if (!configured()) return { error: 'not-configured' };
  const id = String(calendarId || '').trim();
  if (!id) return { error: 'calendar-required' };

  const row = await tokenRow(user?.id);
  if (!row) return { error: 'not-connected' };
  const at = await accessTokenFor(row);
  if (!at) return { error: 'not-connected' };

  // The events scope can be granted without calendar.readonly if a user
  // unticked one on the consent screen; a write with no write scope will fail
  // at Google, so say it plainly up front.
  const scopes = String(row.scope || '').split(/\s+/);
  if (!scopes.includes('https://www.googleapis.com/auth/calendar.events')) {
    return { error: 'no-write-scope' };
  }

  let items;
  try { items = await fetchCalendars(row, at); }
  catch (e) { return { error: String(e?.message) === 'revoked' ? 'revoked' : String(e?.message || e) }; }

  const cal = items.find((c) => c.id === id);
  if (!cal) return { error: 'unknown-calendar' };
  if (!WRITABLE_ROLES.has(cal.accessRole)) return { error: 'read-only-calendar' };
  return { row, at, cal };
}

/**
 * Create an event on a named calendar.
 *
 * `end` is optional for a timed event (we give it an hour, which is what a
 * person means by "lunch at 1") but the all-day case gets a comment of its own:
 * Google treats an all-day event's end DATE as exclusive. Sending
 * start=2026-08-23, end=2026-08-23 produces a zero-length event that renders
 * nowhere at all, which is a bug people report as "it didn't save".
 */
async function createEvent(user, { calendarId, title, start, end, allDay, description, location } = {}) {
  const target = await writableTarget(user, calendarId);
  if (target.error) return { error: target.error };

  const summary = String(title || '').trim();
  if (!summary) return { error: 'title-required' };
  if (!start) return { error: 'start-required' };

  const body = { summary };
  if (description) body.description = String(description).slice(0, 8000);
  if (location) body.location = String(location).slice(0, 1000);

  if (allDay) {
    const s = String(start).slice(0, 10);
    if (!ISO_DATE.test(s)) return { error: 'bad-start' };
    const e = end ? String(end).slice(0, 10) : null;
    body.start = { date: s };
    body.end = { date: e && e > s ? e : addDaysIso(s, 1) };
  } else {
    const s = new Date(start);
    if (Number.isNaN(s.getTime())) return { error: 'bad-start' };
    let e = end ? new Date(end) : null;
    if (!e || Number.isNaN(e.getTime()) || e <= s) e = new Date(s.getTime() + 60 * 60_000);
    // timeZone is sent alongside the instant so that a recurring copy or a
    // later edit in Google's own UI behaves the way the user expects.
    const tz = user?.tz || 'America/New_York';
    body.start = { dateTime: s.toISOString(), timeZone: tz };
    body.end = { dateTime: e.toISOString(), timeZone: tz };
  }

  try {
    const r = await fetch(`${eventsEndpoint(target.cal.id)}?sendUpdates=none`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${target.at}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (r.status === 401 || r.status === 403) {
      needsReconnect.add(user?.id);
      return { error: 'revoked' };
    }
    if (!r.ok) {
      const j = await r.json().catch(() => ({}));
      return { error: j?.error?.message || `google-${r.status}` };
    }
    const e = await r.json();
    // The new event changes what every household member's merged view should
    // show, so the cache goes wholesale rather than by key.
    eventCache.clear();
    return {
      ok: true,
      event: shapeEvent({ ...e, _cal: target.cal.id },
                        calendarIndex([target.cal])),
    };
  } catch (err) {
    return { error: String(err?.message || err) };
  }
}

/**
 * Delete an event from a named calendar.
 *
 * 404 and 410 are reported as success: the event is gone, which is what the
 * user asked for. Returning an error there would mean a double-tap on Delete
 * shows a failure for work that actually completed.
 */
async function deleteEvent(user, { calendarId, eventId } = {}) {
  const target = await writableTarget(user, calendarId);
  if (target.error) return { error: target.error };
  const id = String(eventId || '').trim();
  if (!id) return { error: 'event-required' };

  try {
    const r = await fetch(`${eventEndpoint(target.cal.id, id)}?sendUpdates=none`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${target.at}` },
    });
    if (r.status === 401 || r.status === 403) {
      needsReconnect.add(user?.id);
      return { error: 'revoked' };
    }
    if (!r.ok && r.status !== 404 && r.status !== 410 && r.status !== 204) {
      const j = await r.json().catch(() => ({}));
      return { error: j?.error?.message || `google-${r.status}` };
    }
    eventCache.clear();
    return { ok: true, alreadyGone: r.status === 404 || r.status === 410 };
  } catch (err) {
    return { error: String(err?.message || err) };
  }
}

/** Date arithmetic on a plain YYYY-MM-DD, via UTC so it can't be dragged an
 *  hour either way by the server's own timezone. */
function addDaysIso(iso, days) {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}

// ---------------------------------------------------------------------------

module.exports = {
  available, configured, missingConfig,
  REDIRECT_URI, BASE_URL, SCOPE_CONNECT, SCOPE_SIGNIN,
  authUrl, handleCallback,
  statusFor, listCalendars, selectCalendars, setSharing, disconnect,
  eventsFor, eventsForHousehold, createEvent, deleteEvent,
  // exported for tests — none of these are route-facing
  _encrypt: encrypt, _decrypt: decrypt,
  _signState: signState, _verifyState: verifyState,
  _verifyIdToken: verifyIdToken, _offsetFor: offsetFor,
  _windowFor: windowFor, _addDaysIso: addDaysIso, _safeNext: safeNext,
};
