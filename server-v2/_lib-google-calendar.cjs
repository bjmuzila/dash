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
const CAL_BASE = 'https://www.googleapis.com/calendar/v3';
const CALENDAR_LIST_ENDPOINT = `${CAL_BASE}/users/me/calendarList`;
const eventsEndpoint = (calId) => `${CAL_BASE}/calendars/${encodeURIComponent(calId)}/events`;
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
  // A new connection shares with the household by default — one person linking
  // the family calendar so both can see it is the common case here. It shares
  // only the SELECTED calendars, and selection starts at primary-only until the
  // user picks, so this never exposes a calendar they haven't chosen.
  await libDb.getPool().query(
    `UPDATE hh_google_tokens SET share_with_household = TRUE WHERE user_id=$1`, [userId]);

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

const TOKEN_COLS = `user_id, google_email, refresh_token, access_token, expires_at,
  scope, share_with_household, selected_calendars, last_synced_at`;

/**
 * Stamp "Google answered" on a connection.
 *
 * Deliberately NOT `updated_at`, which moves on every silent access-token
 * refresh and so tells you nothing about whether the EVENTS you are looking at
 * are current. This moves only when a real events fetch came back — which is
 * the question "last synced" is actually asking.
 *
 * Fire-and-forget: a failed write here must never turn a good calendar read
 * into an error, and the events are already in hand by the time it runs. At
 * most one write per minute per connection, because eventsForDay caches.
 */
function touchSync(tokenUserId) {
  libDb.getPool()
    .query(`UPDATE hh_google_tokens SET last_synced_at = now() WHERE user_id=$1`, [tokenUserId])
    .catch(() => { /* the timestamp is a nicety; the events are not */ });
}

async function tokenRow(userId) {
  const { rows } = await libDb.getPool().query(
    `SELECT ${TOKEN_COLS} FROM hh_google_tokens WHERE user_id=$1`, [userId]);
  return rows[0] || null;
}

/**
 * Which connection should serve this user's calendar?
 *
 * Own connection first. Failing that, any connection someone has marked
 * share_with_household — that is the whole point of the feature: one person
 * links the shared family calendar and the other just sees it, without ever
 * touching Google.
 *
 * Only the calendars explicitly selected on that connection are exposed, so
 * "shared" never means "everything in my Google account".
 */
async function resolveSource(userId) {
  const own = await tokenRow(userId);
  if (own) return { row: own, source: 'own' };
  const { rows } = await libDb.getPool().query(
    `SELECT ${TOKEN_COLS} FROM hh_google_tokens
      WHERE share_with_household = TRUE ORDER BY user_id LIMIT 1`);
  return rows[0] ? { row: rows[0], source: 'household' } : null;
}

async function status(userId) {
  if (!configured()) return { configured: false, connected: false, source: null };
  try {
    const own = await tokenRow(userId);
    const resolved = own ? { row: own, source: 'own' } : await resolveSource(userId);
    if (!resolved) {
      return { configured: true, connected: false, ownConnection: false, source: null };
    }
    let sharedByName = null;
    if (resolved.source === 'household') {
      const { rows } = await libDb.getPool().query(
        `SELECT display_name FROM hh_users WHERE id=$1`, [resolved.row.user_id]);
      sharedByName = rows[0]?.display_name ?? null;
    }
    return {
      configured: true,
      connected: true,
      // Distinguished so Settings can show "Connect your own" even when the
      // household connection is already feeding your Today screen.
      ownConnection: !!own,
      source: resolved.source,
      sharedBy: sharedByName,
      email: own?.google_email ?? null,
      shareWithHousehold: own ? !!own.share_with_household : null,
      selectedCalendars: own ? (own.selected_calendars ?? null) : null,
      // From the connection that actually SERVES this user, so on a shared
      // household calendar you see when the other person's link last pulled —
      // which is the feed you are reading — not your own null.
      lastSyncedAt: resolved.row.last_synced_at
        ? new Date(resolved.row.last_synced_at).toISOString() : null,
    };
  } catch { return { configured: true, connected: false, source: null }; }
}

/** A valid access token for a specific token row, refreshing 60s before expiry. */
async function accessTokenFor(row) {
  if (!row) return null;
  const userId = row.user_id;

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
 * Floor between two FORCED syncs for one user (the Sync button in Settings).
 *
 * The cache above exists so idle glances don't cost a Google call; a deliberate
 * press should always be allowed through it. But a person who taps a button and
 * sees nothing change taps it again, and again — this keeps that from becoming
 * a burst of calendarList + events requests against the quota. Well under the
 * time it takes to press twice on purpose, so it is invisible in normal use.
 */
const FORCE_MIN_MS = 4_000;
const lastForce = new Map();

/** True if this user may force a refresh now; stamps the attempt when it does. */
function allowForce(userId) {
  const prev = lastForce.get(userId) || 0;
  if (Date.now() - prev < FORCE_MIN_MS) return false;
  lastForce.set(userId, Date.now());
  // Bounded — same reasoning as the events cache below.
  if (lastForce.size > 200) lastForce.delete(lastForce.keys().next().value);
  return true;
}

/**
 * The UTC offset a timezone is at on a given calendar day, as "-04:00".
 * Computed for that specific day, not for "now" — otherwise a day either side
 * of a DST change gets a window shifted by an hour and drops the first or last
 * event of the day.
 */
function addDaysIso(iso, days) {
  const [y, m, d] = iso.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + days));
  return dt.toISOString().slice(0, 10);
}

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
 * Every calendar the connected account can see — personal, shared, subscribed,
 * holidays, birthdays. This is how a shared family calendar becomes reachable:
 * it is a SEPARATE calendar in the list, not part of `primary`, so reading only
 * primary would never show a single one of its events.
 *
 * `showHidden=true` is load-bearing and easy to lose. Google DEFAULTS it to
 * false, and "hidden" there means only "unticked in Google's own sidebar" — a
 * calendar someone hid because they didn't want it cluttering google.com is
 * exactly the one they then can't find in this picker. Without it the list
 * silently comes back short with no error to explain the gap.
 */
async function listCalendars(userId) {
  if (!configured()) return { error: 'not-configured', calendars: [] };
  try {
    const row = await tokenRow(userId);
    if (!row) return { error: 'not-connected', calendars: [] };
    const at = await accessTokenFor(row);
    if (!at) return { error: 'not-connected', calendars: [] };

    const r = await fetch(`${CALENDAR_LIST_ENDPOINT}?maxResults=250&minAccessRole=reader&showHidden=true`,
                          { headers: { Authorization: `Bearer ${at}` } });
    if (r.status === 401 || r.status === 403) return { error: 'revoked', calendars: [] };
    if (!r.ok) return { error: `google-${r.status}`, calendars: [] };

    const j = await r.json();
    const calendars = (j.items || []).map((c) => ({
      id: c.id,
      name: c.summaryOverride || c.summary || c.id,
      description: c.description || null,
      primary: !!c.primary,
      color: c.backgroundColor || null,
      accessRole: c.accessRole || null,
      // Google's own "is this hidden in the UI" flag — a good hint for which
      // ones the user actually cares about.
      selectedInGoogle: c.selected !== false,
    }));
    // Primary first, then alphabetical — matches how Google itself lists them.
    calendars.sort((a, b) => (b.primary ? 1 : 0) - (a.primary ? 1 : 0) || a.name.localeCompare(b.name));

    const selected = row.selected_calendars ?? null;
    return { calendars, selected, shareWithHousehold: !!row.share_with_household };
  } catch (err) {
    return { error: String(err?.message || err), calendars: [] };
  }
}

/** Persist which calendars to show and whether to share them with the household. */
async function saveSelection(userId, { calendarIds, shareWithHousehold }) {
  const sets = ['updated_at=now()'];
  const vals = [userId];
  if (Array.isArray(calendarIds)) {
    vals.push(JSON.stringify(calendarIds.map(String).slice(0, 50)));
    sets.push(`selected_calendars=$${vals.length}`);
  }
  if (typeof shareWithHousehold === 'boolean') {
    vals.push(shareWithHousehold);
    sets.push(`share_with_household=$${vals.length}`);
  }
  const { rowCount } = await libDb.getPool().query(
    `UPDATE hh_google_tokens SET ${sets.join(', ')} WHERE user_id=$1`, vals);
  // Everyone's view can change when a shared connection's selection changes,
  // so the whole cache goes, not just this user's slice.
  cache.clear();
  return rowCount > 0;
}

/**
 * Colour per calendar, from calendarList. Cached alongside the events cache
 * because it changes about once a year and is needed on every event read —
 * fetching the list on every request would double the Google calls for a value
 * that never moves.
 *
 * Same `showHidden=true` as listCalendars, and for a sharper reason: a hidden
 * calendar can still be TICKED here, so leaving it off would return its events
 * with no colour and no name at all.
 */
const colourCache = new Map();
const COLOUR_MS = 10 * 60_000;

async function calendarColours(row, accessTok) {
  const key = row.user_id;
  const hit = colourCache.get(key);
  if (hit && Date.now() - hit.at < COLOUR_MS) return hit.map;
  try {
    const r = await fetch(`${CALENDAR_LIST_ENDPOINT}?maxResults=250&minAccessRole=reader&showHidden=true`,
                          { headers: { Authorization: `Bearer ${accessTok}` } });
    if (!r.ok) return hit?.map || new Map();
    const j = await r.json();
    const map = new Map();
    for (const c of j.items || []) {
      const entry = { colour: c.backgroundColor || null, name: c.summaryOverride || c.summary || c.id };
      map.set(c.id, entry);
      // We read the default calendar via the literal id "primary", but
      // calendarList returns it under the account's EMAIL. Without this alias
      // every event on the default calendar comes back with no colour — which
      // is the default for anyone who hasn't opened the picker.
      if (c.primary) map.set('primary', entry);
    }
    colourCache.set(key, { at: Date.now(), map });
    return map;
  } catch { return hit?.map || new Map(); }
}

/** Which calendar ids a token row should be read from. */
function calendarIdsFor(row) {
  const sel = row.selected_calendars;
  // NULL = never chosen. Primary is the safe default: it's the account's own
  // calendar, never a subscribed holiday feed.
  if (!Array.isArray(sel)) return ['primary'];
  return sel.slice(0, 50);
}

/**
 * Today's events, merged across every selected calendar on whichever connection
 * serves this user (their own, or the household-shared one).
 *
 * Returns { events, source, ... } or { error } — never throws, so a Google
 * outage degrades this card instead of taking down the screen it sits on.
 *
 * `opts.force` is the Sync button: skip the 60s cache and ask Google now. It is
 * rate-limited per user (see allowForce) and, when it does go out, also drops
 * the colour/name cache — a calendar renamed or recoloured in Google is exactly
 * the kind of thing someone presses Sync to pick up.
 */
async function eventsForDay(userId, tz, dateStr, opts = {}) {
  if (!configured()) return { error: 'not-configured', events: [] };

  const ck = `${userId}:${dateStr}`;
  const hit = cache.get(ck);
  // A rate-limited force falls back to the cache rather than erroring — the
  // caller asked for the freshest thing available, and this is it.
  const force = !!opts.force && allowForce(userId);
  if (!force && hit && Date.now() - hit.at < CACHE_MS) return hit.value;

  try {
    const resolved = await resolveSource(userId);
    if (!resolved) return { error: 'not-connected', events: [] };

    if (force) colourCache.delete(resolved.row.user_id);

    const at = await accessTokenFor(resolved.row);
    if (!at) return { error: 'not-connected', events: [] };

    const ids = calendarIdsFor(resolved.row);
    if (!ids.length) return { error: 'none-selected', events: [], source: resolved.source };

    const off = offsetFor(tz, dateStr);
    const qs = new URLSearchParams({
      timeMin: `${dateStr}T00:00:00${off}`,
      timeMax: `${dateStr}T23:59:59${off}`,
      // Expands recurring events into their individual instances; without it a
      // weekly standup returns as one master row and never shows on the day.
      singleEvents: 'true',
      orderBy: 'startTime',
      maxResults: '25',
      timeZone: tz,
    });

    // In parallel — with several calendars selected, sequential fetches would
    // stack their latency and the card would visibly lag the rest of the screen.
    const results = await Promise.all(ids.map(async (calId) => {
      try {
        const r = await fetch(`${eventsEndpoint(calId)}?${qs}`, { headers: { Authorization: `Bearer ${at}` } });
        if (r.status === 401 || r.status === 403) return { fatal: 'revoked', failed: true, items: [] };
        // A single calendar that 404s (deleted, or unshared since it was
        // picked) must not blank out the others — but it IS recorded as a
        // failure, see the all-failed check below.
        if (!r.ok) return { failed: true, err: `google-${r.status}`, items: [] };
        const j = await r.json();
        return { items: (j.items || []).map((e) => ({ ...e, _cal: calId })) };
      } catch (e) { return { failed: true, err: String(e?.message || e), items: [] }; }
    }));

    // Revoked is account-wide, so one calendar reporting it means the whole
    // connection is dead — say so instead of showing a misleading empty day.
    if (results.some((r) => r.fatal === 'revoked')) return { error: 'revoked', events: [] };

    // If EVERY calendar failed, this is an outage, not an empty day. Tolerating
    // per-calendar failures (above) is right — one deleted calendar shouldn't
    // hide the others — but silently returning [] when nothing succeeded would
    // render as "nothing on today", which is the one lie this card must never
    // tell. A partial failure still shows what we did get.
    if (results.length && results.every((r) => r.failed)) {
      return { error: results.find((r) => r.err)?.err || 'google-unavailable', events: [] };
    }
    const partialFailures = results.filter((r) => r.failed).length;

    const colours = await calendarColours(resolved.row, at);
    const shape = (e) => ({
      // Ids repeat across calendars for the same invite, so the React key has
      // to include the calendar or one of the copies silently disappears.
      id: `${e._cal}:${e.id}`,
      calendarId: e._cal,
      summary: e.summary || '(no title)',
      // All-day events carry `date`; timed ones carry `dateTime`.
      allDay: !e.start?.dateTime,
      start: e.start?.dateTime || e.start?.date || null,
      end: e.end?.dateTime || e.end?.date || null,
      location: e.location || null,
      // Google's per-calendar colour, so the client can tint each event by
      // which calendar it came from. Per-EVENT colorId is deliberately ignored:
      // it would make two events on the same calendar look unrelated.
      colour: colours.get(e._cal)?.colour || null,
      calendarName: colours.get(e._cal)?.name || null,
    });

    const events = results
      .flatMap((r) => r.items)
      .filter((e) => e.status !== 'cancelled')
      .map(shape)
      // All-day first, then chronological. Comparing the raw strings works
      // because every timed value from Google carries the same day's offset.
      .sort((a, b) => (b.allDay ? 1 : 0) - (a.allDay ? 1 : 0) ||
                      String(a.start).localeCompare(String(b.start)))
      .slice(0, 40);

    // Look-ahead for the "Upcoming" list. One extra request per calendar over a
    // 21-day window — cheap, and it lands in the same 60s cache as today's.
    let upcoming = [];
    try {
      const ahead = new URLSearchParams({
        timeMin: `${addDaysIso(dateStr, 1)}T00:00:00${off}`,
        timeMax: `${addDaysIso(dateStr, 21)}T23:59:59${off}`,
        singleEvents: 'true', orderBy: 'startTime', maxResults: '15', timeZone: tz,
      });
      const more = await Promise.all(ids.map(async (calId) => {
        try {
          const r = await fetch(`${eventsEndpoint(calId)}?${ahead}`, { headers: { Authorization: `Bearer ${at}` } });
          if (!r.ok) return [];
          const j = await r.json();
          return (j.items || []).map((e) => ({ ...e, _cal: calId }));
        } catch { return []; }
      }));
      upcoming = more.flat()
        .filter((e) => e.status !== 'cancelled')
        .map(shape)
        .sort((a, b) => String(a.start).localeCompare(String(b.start)))
        .slice(0, 5);
    } catch { /* the look-ahead is a nicety; today's events still stand */ }

    // Google answered. Stamped before the cache write so the timestamp reflects
    // the fetch, not the next cache miss a minute later.
    touchSync(resolved.row.user_id);

    const value = {
      events, upcoming, source: resolved.source, calendarCount: ids.length,
      // >0 means some calendars are shown and some couldn't be reached, so the
      // card can say the list may be incomplete rather than implying it's whole.
      partialFailures,
      syncedAt: new Date().toISOString(),
    };
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
  authUrl, verifyState, connect, disconnect, status, eventsForDay, addDaysIso,
  listCalendars, saveSelection, resolveSource,
  // exported for tests
  _encrypt: encrypt, _decrypt: decrypt, _signState: signState, _offsetFor: offsetFor,
};
