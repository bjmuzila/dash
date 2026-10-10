'use strict';
/**
 * ─────────────────────────────────────────────────────────────────────────────
 * VOLTICK SANDBOX VISITS · who opened which page on voltick.cbedge.net, and how
 * many times they signed in to get there.
 *
 * Brandon, 2026-10-10: "need to track each page visit by who on the
 * voltick.cbedge.net, and how many sign ins. add it to the owner.cbedge.net".
 *
 *   POST /api/voltick/visit    the sandbox's route beacon (voltick-vite/src/lib/visit.ts).
 *                              One row per page opened, with the account and the
 *                              SESSION it was opened under.
 *   GET  /api/voltick/visits   owner only. ?days=N (default 30, 0 = all time).
 *                              Read by owner.cbedge.net → Voltick usage
 *                              (owner-vite/src/pages/VoltickUsage.tsx).
 *
 * ── WHY A TABLE OF ITS OWN, NOT page_visits ──────────────────────────────────
 * page_visits is CB Edge's customer analytics: the owner Visitors map, the
 * acquisition channels, the "is the beacon alive" health check. A handful of
 * invited sandbox testers clicking around would be counted as customer traffic
 * there. This keeps the sandbox's numbers apart and its rows small.
 *
 * ── WHAT "A SIGN-IN" IS HERE ─────────────────────────────────────────────────
 * The sandbox has no sign-in form of its own: people sign in at cbedge.net and
 * the domain-wide cbe_session cookie carries them over. A `sessions` row is only
 * ever created at login (lib/auth/session.ts createSession) and is keyed by
 * sha256(cookie) (ws-auth.js), so every visit stores that same hash. Then:
 *
 *   sign-ins on Voltick = distinct sessions a person used on voltick.cbedge.net
 *   each one's time     = sessions.created_at for that hash (when they logged in),
 *                         falling back to the first visit if the row is gone
 *
 * A person who signs in once and comes back daily for a week is ONE sign-in and
 * many visits, which is the honest reading. The cookie itself is never stored.
 *
 * Owner rows are recorded too (useful while building) and flagged, and the page
 * can hide them.
 * ─────────────────────────────────────────────────────────────────────────────
 */

const crypto = require('node:crypto');

const SESSION_COOKIE = 'cbe_session'; // sync with ws-auth.js / lib/auth/session.ts
/** The same page opened twice inside this window is one visit (a remount, a double effect). */
const DEDUPE_MS = 5_000;
const MAX_PATH = 300;
const MAX_LABEL = 120;

/** sha256 of the session cookie, read exactly as ws-auth.js parseCookies() reads it
 *  (decodeURIComponent, and the LAST cbe_session wins), so it equals sessions.token_hash. */
function sessionHash(req) {
  const raw = String(req.headers?.cookie || '');
  let v = null;
  for (const part of raw.split(';')) {
    const i = part.indexOf('=');
    if (i < 0) continue;
    if (part.slice(0, i).trim() !== SESSION_COOKIE) continue;
    v = part.slice(i + 1).trim();
    try { v = decodeURIComponent(v); } catch { /* use as sent */ }
  }
  return v ? crypto.createHash('sha256').update(v).digest('hex') : null;
}

function cleanPath(p) {
  const s = String(p ?? '').trim();
  if (!s.startsWith('/')) return null;
  // the path only: never a query string or a hash, which can carry anything
  return s.split(/[?#]/)[0].slice(0, MAX_PATH) || '/';
}

function registerVoltickVisitRoutes({ register, send, readJson, libDb, clientIp, clientGeo, visitAttribution }) {
  if (!libDb) return 0;
  const q = (sql, params = []) => libDb.queryAll(sql, params);

  let schema = null;
  const ensure = () => {
    if (!schema) {
      schema = (async () => {
        await q(`CREATE TABLE IF NOT EXISTS voltick_visits (
          id BIGSERIAL PRIMARY KEY,
          user_id TEXT NOT NULL,
          session_hash TEXT,
          path TEXT NOT NULL,
          label TEXT,
          at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          ip TEXT,
          country TEXT,
          city TEXT,
          browser TEXT,
          os TEXT,
          device_type TEXT
        )`);
        await q('CREATE INDEX IF NOT EXISTS voltick_visits_at_idx ON voltick_visits (at)');
        await q('CREATE INDEX IF NOT EXISTS voltick_visits_user_idx ON voltick_visits (user_id, at)');
      })().catch((e) => { schema = null; throw e; });
    }
    return schema;
  };

  // ── the beacon ──
  register('/api/voltick/visit', {
    // 'user': any signed-in account. The page it fires from is already behind
    // the sandbox gate (/api/voltick/verify), so nobody else can load it.
    auth: 'user', methods: ['POST'],
    async handler(req, res, ctx, verdict) {
      const userId = String(verdict?.userId || '').trim();
      if (!userId) return send(res, 401, { ok: false });
      try {
        await ensure();
        const b = (await readJson(req, 4 * 1024).catch(() => null)) || {};
        const path = cleanPath(b.path);
        if (!path) return send(res, 400, { ok: false, error: 'path required' });
        const label = b.label == null ? null : String(b.label).slice(0, MAX_LABEL);
        const sh = sessionHash(req);
        const dup = await q(
          `SELECT 1 FROM voltick_visits WHERE user_id = ? AND path = ? AND session_hash IS NOT DISTINCT FROM ?
              AND at > NOW() - (? * INTERVAL '1 millisecond') LIMIT 1`,
          [userId, path, sh, DEDUPE_MS],
        );
        if (dup.length) return send(res, 200, { ok: true, deduped: true }, { 'Cache-Control': 'no-store' });
        let geo = {};
        let attr = {};
        try { geo = clientGeo ? clientGeo(req) || {} : {}; } catch { /* enrichment only */ }
        try { attr = visitAttribution ? visitAttribution(req, {}) || {} : {}; } catch { /* enrichment only */ }
        await q(
          `INSERT INTO voltick_visits (user_id, session_hash, path, label, ip, country, city, browser, os, device_type)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [userId, sh, path, label, clientIp ? clientIp(req) : null,
            geo.country ?? null, geo.city ?? null, attr.browser ?? null, attr.os ?? null, attr.device_type ?? null],
        );
        return send(res, 200, { ok: true }, { 'Cache-Control': 'no-store' });
      } catch (e) {
        // a beacon never breaks the page that sent it
        return send(res, 200, { ok: false, error: String(e?.message || e).slice(0, 120) }, { 'Cache-Control': 'no-store' });
      }
    },
  });

  // ── the owner's read ──
  register('/api/voltick/visits', {
    auth: 'owner', methods: ['GET'],
    async handler(req, res, ctx) {
      try {
        await ensure();
        const sp = new URL(req.url || '/', 'http://localhost').searchParams;
        const daysRaw = sp.get('days');
        const days = daysRaw == null ? 30 : Math.max(0, Math.min(3650, Number(daysRaw) || 0));
        // `since` as a timestamp bound; 0 days = all time
        const since = days > 0 ? `NOW() - (${Math.round(days)} * INTERVAL '1 day')` : `'-infinity'::timestamptz`;
        const ownerId = ctx?.ownerUserId || '';

        const [people, sessions, pages, recent, daily, granted] = await Promise.all([
          q(`SELECT v.user_id, u.email, u.is_owner,
                    COUNT(*)::int AS visits,
                    COUNT(DISTINCT v.path)::int AS pages,
                    COUNT(DISTINCT v.session_hash)::int AS sign_ins,
                    COUNT(DISTINCT (v.at AT TIME ZONE 'America/New_York')::date)::int AS days_active,
                    (EXTRACT(EPOCH FROM MIN(v.at)) * 1000)::bigint AS first_ms,
                    (EXTRACT(EPOCH FROM MAX(v.at)) * 1000)::bigint AS last_ms,
                    MODE() WITHIN GROUP (ORDER BY v.path) AS top_path
               FROM voltick_visits v
               LEFT JOIN users u ON u.id = v.user_id
              WHERE v.at >= ${since}
              GROUP BY v.user_id, u.email, u.is_owner
              ORDER BY MAX(v.at) DESC`),
          q(`SELECT v.session_hash, v.user_id, u.email, u.is_owner,
                    (EXTRACT(EPOCH FROM s.created_at) * 1000)::bigint AS signed_in_ms,
                    (EXTRACT(EPOCH FROM MIN(v.at)) * 1000)::bigint AS first_ms,
                    (EXTRACT(EPOCH FROM MAX(v.at)) * 1000)::bigint AS last_ms,
                    COUNT(*)::int AS visits,
                    MAX(v.browser) AS browser, MAX(v.os) AS os, MAX(v.device_type) AS device_type,
                    MAX(v.city) AS city, MAX(v.country) AS country
               FROM voltick_visits v
               LEFT JOIN users u ON u.id = v.user_id
               LEFT JOIN sessions s ON s.token_hash = v.session_hash
              WHERE v.at >= ${since} AND v.session_hash IS NOT NULL
              GROUP BY v.session_hash, v.user_id, u.email, u.is_owner, s.created_at
              ORDER BY MIN(v.at) DESC
              LIMIT 300`),
          q(`SELECT v.path, MAX(v.label) AS label,
                    COUNT(*)::int AS visits,
                    COUNT(DISTINCT v.user_id)::int AS people,
                    (EXTRACT(EPOCH FROM MAX(v.at)) * 1000)::bigint AS last_ms
               FROM voltick_visits v
              WHERE v.at >= ${since}
              GROUP BY v.path
              ORDER BY COUNT(*) DESC`),
          q(`SELECT v.id, v.user_id, u.email, u.is_owner, v.path, v.label,
                    (EXTRACT(EPOCH FROM v.at) * 1000)::bigint AS at_ms,
                    v.device_type, v.browser, v.city, v.country
               FROM voltick_visits v
               LEFT JOIN users u ON u.id = v.user_id
              WHERE v.at >= ${since}
              ORDER BY v.at DESC
              LIMIT 250`),
          q(`SELECT to_char((v.at AT TIME ZONE 'America/New_York')::date, 'YYYY-MM-DD') AS day,
                    COUNT(*)::int AS visits,
                    COUNT(DISTINCT v.user_id)::int AS people,
                    COUNT(DISTINCT v.session_hash)::int AS sign_ins
               FROM voltick_visits v
              WHERE v.at >= ${since}
              GROUP BY 1 ORDER BY 1`),
          // everyone with a live grant, so "invited, never opened it" shows too
          q(`SELECT va.email, u.id AS user_id,
                    (EXTRACT(EPOCH FROM va.granted_at) * 1000)::bigint AS granted_ms
               FROM voltick_access va
               LEFT JOIN users u ON LOWER(u.email) = va.email
              WHERE va.revoked_at IS NULL AND (va.expires_at IS NULL OR va.expires_at > NOW())`).catch(() => []),
        ]);

        const num = (v) => (v == null ? null : Number(v));
        const isOwner = (r) => Boolean(r.is_owner) || (ownerId !== '' && r.user_id === ownerId);
        const seen = new Set(people.map((p) => p.user_id));
        const neverOpened = granted
          .filter((g) => !g.user_id || !seen.has(g.user_id))
          .map((g) => ({ email: g.email, hasAccount: Boolean(g.user_id), grantedAt: num(g.granted_ms) }));

        const out = {
          days,
          serverNow: Date.now(),
          totals: {
            visits: people.reduce((n, p) => n + p.visits, 0),
            people: people.length,
            signIns: sessions.length,
            pages: pages.length,
            granted: granted.length,
          },
          people: people.map((p) => ({
            userId: p.user_id, email: p.email ?? null, isOwner: isOwner(p),
            visits: p.visits, pages: p.pages, signIns: p.sign_ins, daysActive: p.days_active,
            firstAt: num(p.first_ms), lastAt: num(p.last_ms), topPath: p.top_path ?? null,
          })),
          signIns: sessions.map((s) => ({
            userId: s.user_id, email: s.email ?? null, isOwner: isOwner(s),
            signedInAt: num(s.signed_in_ms), firstAt: num(s.first_ms), lastAt: num(s.last_ms),
            visits: s.visits, browser: s.browser ?? null, os: s.os ?? null, device: s.device_type ?? null,
            city: s.city ?? null, country: s.country ?? null,
          })),
          pages: pages.map((p) => ({ path: p.path, label: p.label ?? null, visits: p.visits, people: p.people, lastAt: num(p.last_ms) })),
          recent: recent.map((r) => ({
            id: Number(r.id), userId: r.user_id, email: r.email ?? null, isOwner: isOwner(r),
            path: r.path, label: r.label ?? null, at: num(r.at_ms),
            device: r.device_type ?? null, browser: r.browser ?? null, city: r.city ?? null, country: r.country ?? null,
          })),
          daily: daily.map((d) => ({ day: d.day, visits: d.visits, people: d.people, signIns: d.sign_ins })),
          neverOpened,
        };
        return send(res, 200, out, { 'Cache-Control': 'no-store' });
      } catch (e) {
        return send(res, 500, { error: String(e?.message || e).slice(0, 200) });
      }
    },
  });
  return 2;
}

module.exports = { registerVoltickVisitRoutes, _test: { sessionHash, cleanPath } };
