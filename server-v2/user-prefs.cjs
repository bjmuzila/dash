'use strict';
// ─────────────────────────────────────────────────────────────────────────────
// USER PREFS: every setting, indicator and layout, saved per account
// (Brandon, 2026-10-08: "all settings, indicators, anything that saves layouts
// or anything needs to save per user name in postgres").
//
// The v3 SPA (cbedge.net/v3/*) and its standalone Vela build (vela.cbedge.net)
// keep their settings in the browser's localStorage, under about eighty keys
// written by about ninety files: the board layout and every card's settings,
// the Vela workspace document (layout, charts, indicators and their inputs,
// drawings), indicator presets / favourites / lists, watchlists, scripts,
// alerts, the chain's columns, the scanner's card layout, and so on. Before
// this, all of it stayed in ONE browser: a new laptop, the phone, or
// vela.cbedge.net (a different origin, so a different localStorage) started
// from nothing.
//
// cbedge-v3/src/data/prefsSync.ts mirrors the keys that are SETTINGS (an
// allowlist kept there, next to the code that knows what each key is) into
// this table, keyed by the signed-in user's id, and writes the account's copy
// back into localStorage BEFORE the app reads it. So none of those ninety
// files had to change: they keep reading and writing localStorage, and the
// account follows.
//
//   user_prefs   one row per (user, key). `value` is the browser's own string,
//                VERBATIM: most are JSON but some are bare words ('1',
//                'voltick', '24h'), and the client must get back exactly what
//                it stored. `rev` comes off one sequence, so a client can say
//                "I hold rev N of this key" and be sent only what changed.
//
// Routes (auth 'user': any signed-in account, paid or not. A Vela beta tester
// is not a subscriber and must still keep their layout):
//
//   POST /api/user-prefs/sync   { u, have: { key: rev } }
//        → { user, keys: { key: rev }, values: { key: value } }
//        `keys` is the whole account; `values` only what the browser does not
//        already hold (rev differs). When `u` is not this session's user (a
//        different account last used this browser) `have` is ignored and
//        everything comes back.
//   POST|PUT /api/user-prefs    { u, set: { key: value }, del: [key] }
//        → { revs: { key: rev }, deleted: [key], rejected: { key: reason } }
//        409 when `u` is not this session's user: a tab left open under one
//        account must never write into another's after a sign-in elsewhere.
//   GET  /api/user-prefs        this account's keys with sizes and times, no
//        values. For a look from the console or the owner's tools.
//
// Limits: a key is at most KEY_MAX_BYTES (a notes list full of chart clips can
// pass it; it then simply stays in that browser, as it always did), an account
// at most USER_MAX_BYTES across USER_MAX_KEYS keys. Small keys are accepted
// before big ones when a write would cross the quota, so one huge document can
// never cost an account its settings.
//
// Look at it from psql:
//   SELECT u.email, p.pref_key, p.bytes, p.updated_at
//     FROM user_prefs p JOIN users u ON u.id = p.user_id
//    ORDER BY u.email, p.pref_key;
//
// The table is created lazily, behind a catalog check, so an already-applied
// DDL never takes a lock on a live request (the 2026-09-16 lock storms). The
// `?` placeholders are libDb.queryAll's (rewritten to $n): no statement below
// may contain a literal `?` for any other reason.
// ─────────────────────────────────────────────────────────────────────────────

const KEY_MAX_BYTES = 2 * 1024 * 1024;
const USER_MAX_BYTES = 32 * 1024 * 1024;
const USER_MAX_KEYS = 600;
/** One write request: a few documents at most, JSON-escaped on the wire. */
const BODY_MAX_CHARS = 8 * 1024 * 1024; // bytes, as read
/** The sync request carries only key names and revs. */
const SYNC_MAX_CHARS = 256 * 1024; // bytes, as read
/** What a key may look like: the app's own names (cb-v3-…, alerts:shown, cb.chain.nearCore, sidebar-notes-v1:<id>). */
const KEY_RE = /^[A-Za-z0-9_.:\-]{1,160}$/;

const LIMITS = { keyMaxBytes: KEY_MAX_BYTES, userMaxBytes: USER_MAX_BYTES, userMaxKeys: USER_MAX_KEYS };

/**
 * The body as JSON, decoded as UTF-8 ONCE over the whole buffer. The router's
 * readJson appends chunk by chunk (`body += chunk`), which decodes each chunk
 * on its own: a multi-byte character split across two chunks becomes U+FFFD,
 * and with megabyte documents (Vela's workspace, scripts, notes) that is a
 * when, not an if. Oversize answers 413 (not a dropped socket), so the client
 * can tell "never" from "try again".
 */
function readBody(req, maxBytes) {
  return new Promise((resolve, reject) => {
    const parts = [];
    let size = 0;
    let over = false;
    req.on('data', (c) => {
      if (over) return;
      size += c.length;
      if (size > maxBytes) {
        over = true;
        parts.length = 0;
        return;
      }
      parts.push(typeof c === 'string' ? Buffer.from(c, 'utf8') : c);
    });
    req.on('end', () => {
      if (over) return reject(Object.assign(new Error('body too large'), { status: 413 }));
      try {
        const text = Buffer.concat(parts).toString('utf8');
        resolve(text ? JSON.parse(text) : {});
      } catch (e) {
        reject(Object.assign(e, { status: 400 }));
      }
    });
    req.on('error', reject);
  });
}

// `readJson` is accepted for the router's calling convention and not used: see readBody.
function registerUserPrefsRoutes({ register, send, readJson, libDb }) {
  if (!libDb || typeof libDb.queryAll !== 'function') return 0;
  const q = (sql, params = []) => libDb.queryAll(sql, params);

  let schema = null;
  function ensureSchema() {
    if (!schema) {
      schema = (async () => {
        const have = await q(`SELECT to_regclass('public.user_prefs') AS t`);
        if (have[0] && have[0].t) return;
        await q('CREATE SEQUENCE IF NOT EXISTS user_prefs_rev_seq');
        await q(`CREATE TABLE IF NOT EXISTS user_prefs (
          user_id    TEXT        NOT NULL,
          pref_key   TEXT        NOT NULL,
          value      TEXT        NOT NULL,
          bytes      INTEGER     NOT NULL,
          rev        BIGINT      NOT NULL DEFAULT nextval('user_prefs_rev_seq'),
          updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          PRIMARY KEY (user_id, pref_key)
        )`);
      })().catch((e) => {
        schema = null;
        throw e;
      });
    }
    return schema;
  }

  const userOf = (access) => (access && access.userId ? String(access.userId) : null);
  const NO_STORE = { 'Cache-Control': 'private, no-store' };

  // ═══════════════════════════════════════════════════════════════════════════
  // POST /api/user-prefs/sync: the boot read (index.html / vela.html start it
  // before the bundle has downloaded; prefsSync.ts applies it before any page
  // module runs).
  // ═══════════════════════════════════════════════════════════════════════════
  register('/api/user-prefs/sync', {
    auth: 'user',
    methods: ['POST'],
    async handler(req, res, ctx, access) {
      const userId = userOf(access);
      if (!userId) return send(res, 401, { error: 'no-session' });
      let body;
      try {
        body = await readBody(req, SYNC_MAX_CHARS);
      } catch (e) {
        return send(res, e.status === 413 ? 413 : 400, { error: e.status === 413 ? 'body-too-large' : 'bad-json' });
      }
      // What the browser already holds, cleaned: a rev it cannot read is a rev it does not have.
      const have = {};
      if (body && body.u === userId && body.have && typeof body.have === 'object' && !Array.isArray(body.have)) {
        for (const [k, v] of Object.entries(body.have)) {
          const r = Number(v);
          if (KEY_RE.test(k) && Number.isSafeInteger(r) && r > 0) have[k] = r;
        }
      }
      try {
        await ensureSchema();
        // One statement, so `keys` and `values` are the same snapshot of the account.
        const rows = await q(
          `SELECT pref_key, rev,
                  CASE WHEN rev IS DISTINCT FROM (?::jsonb ->> pref_key)::bigint THEN value END AS value
             FROM user_prefs
            WHERE user_id = ?`,
          [JSON.stringify(have), userId],
        );
        const keys = {};
        const values = {};
        for (const r of rows) {
          keys[r.pref_key] = Number(r.rev);
          if (r.value != null) values[r.pref_key] = r.value;
        }
        return send(res, 200, { ok: true, user: userId, keys, values, limits: LIMITS }, NO_STORE);
      } catch (err) {
        return send(res, 503, { error: 'prefs-unavailable', detail: String((err && err.message) || err) });
      }
    },
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // /api/user-prefs: write (POST / PUT, POST so navigator.sendBeacon can flush
  // on a closing tab) and list (GET).
  // ═══════════════════════════════════════════════════════════════════════════
  register('/api/user-prefs', {
    auth: 'user',
    methods: ['GET', 'POST', 'PUT'],
    async handler(req, res, ctx, access) {
      const userId = userOf(access);
      if (!userId) return send(res, 401, { error: 'no-session' });

      if (req.method === 'GET') {
        try {
          await ensureSchema();
          const rows = await q(
            `SELECT pref_key, bytes, rev, updated_at
               FROM user_prefs
              WHERE user_id = ?
              ORDER BY pref_key`,
            [userId],
          );
          let total = 0;
          const keys = rows.map((r) => {
            total += Number(r.bytes) || 0;
            return {
              key: r.pref_key,
              bytes: Number(r.bytes) || 0,
              rev: Number(r.rev),
              updatedAt: r.updated_at instanceof Date ? r.updated_at.toISOString() : String(r.updated_at),
            };
          });
          return send(res, 200, { ok: true, user: userId, totalBytes: total, keys, limits: LIMITS }, NO_STORE);
        } catch (err) {
          return send(res, 503, { error: 'prefs-unavailable', detail: String((err && err.message) || err) });
        }
      }

      let body;
      try {
        body = await readBody(req, BODY_MAX_CHARS);
      } catch (e) {
        return send(res, e.status === 413 ? 413 : 400, { error: e.status === 413 ? 'body-too-large' : 'bad-json' });
      }
      if (!body || body.u !== userId) return send(res, 409, { error: 'user-mismatch' });

      const set = body.set && typeof body.set === 'object' && !Array.isArray(body.set) ? body.set : {};
      const rejected = {};
      /** [key, value, bytes] */
      const incoming = [];
      for (const [k, v] of Object.entries(set)) {
        if (!KEY_RE.test(k)) {
          rejected[k] = 'bad-key';
          continue;
        }
        // Postgres TEXT cannot hold U+0000; one such value would fail the whole INSERT.
        if (typeof v !== 'string' || v.includes('\u0000')) {
          rejected[k] = 'bad-value';
          continue;
        }
        const bytes = Buffer.byteLength(v, 'utf8');
        if (bytes > KEY_MAX_BYTES) {
          rejected[k] = 'too-large';
          continue;
        }
        incoming.push([k, v, bytes]);
      }
      const dels = [
        ...new Set((Array.isArray(body.del) ? body.del : []).filter((k) => typeof k === 'string' && KEY_RE.test(k) && !(k in set))),
      ].slice(0, USER_MAX_KEYS);
      if (!incoming.length && !dels.length) return send(res, 200, { ok: true, revs: {}, deleted: [], rejected }, NO_STORE);

      try {
        await ensureSchema();
        // The quota, from what the account holds OUTSIDE the keys this request writes or deletes.
        const touched = [...incoming.map((x) => x[0]), ...dels];
        const held = await q(
          `SELECT COUNT(*)::int AS n, COALESCE(SUM(bytes), 0)::bigint AS total
             FROM user_prefs
            WHERE user_id = ? AND NOT (pref_key = ANY(?::text[]))`,
          [userId, touched],
        );
        let count = Number(held[0] && held[0].n) || 0;
        let used = Number(held[0] && held[0].total) || 0;
        // Small first: settings before big documents, so a quota hit lands on the document.
        incoming.sort((a, b) => a[2] - b[2]);
        const accept = [];
        for (const it of incoming) {
          if (count + 1 > USER_MAX_KEYS || used + it[2] > USER_MAX_BYTES) {
            rejected[it[0]] = 'quota';
            continue;
          }
          count += 1;
          used += it[2];
          accept.push(it);
        }

        const revs = {};
        if (accept.length) {
          const rows = await q(
            `INSERT INTO user_prefs (user_id, pref_key, value, bytes)
             SELECT ?, t.k, t.v, t.b
               FROM unnest(?::text[], ?::text[], ?::int[]) AS t(k, v, b)
             ON CONFLICT (user_id, pref_key) DO UPDATE
                SET value = EXCLUDED.value,
                    bytes = EXCLUDED.bytes,
                    rev = EXCLUDED.rev,
                    updated_at = NOW()
             RETURNING pref_key, rev`,
            [userId, accept.map((x) => x[0]), accept.map((x) => x[1]), accept.map((x) => x[2])],
          );
          for (const r of rows) revs[r.pref_key] = Number(r.rev);
        }
        if (dels.length) {
          await q('DELETE FROM user_prefs WHERE user_id = ? AND pref_key = ANY(?::text[])', [userId, dels]);
        }
        // A key that was not on the server is deleted all the same, as far as the browser is concerned.
        return send(res, 200, { ok: true, revs, deleted: dels, rejected }, NO_STORE);
      } catch (err) {
        return send(res, 503, { error: 'prefs-unavailable', detail: String((err && err.message) || err) });
      }
    },
  });

  return 2;
}

module.exports = { registerUserPrefsRoutes, LIMITS, KEY_RE };
