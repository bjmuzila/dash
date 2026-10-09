'use strict';
// ─────────────────────────────────────────────────────────────────────────────
// VELA TELEMETRY — the server half (Brandon, 2026-10-07: "need vela tracking on
// the owner.cbedge.net page — how many on and who, what tickers being used,
// what indicators being used, anything and everything possible to track").
//
// The Vela page (cbedge-v3/src/pages/vela/telemetry.ts) posts a heartbeat every
// 30 s per open tab: a snapshot of every chart on screen, the visible / engaged
// time since the last beat, and the actions taken since. Three tables, created
// lazily here (the level-log pattern in api-router.js — no _lib-db.cjs rebuild):
//
//   vela_sessions  one row per tab: who (user_id → users.email), where (host,
//                  device, browser, OS, IP, city), when (start, last seen, end),
//                  how long (visible / engaged seconds, beats) and the latest
//                  snapshot — what that tab shows right now
//   vela_events    every action, with its details (JSONB)
//   vela_usage     seconds per day (ET) × user × kind × key, from the visible
//                  time of each beat: ticker (any chart on screen),
//                  ticker_active (the chart in focus), timeframe, indicator,
//                  layout, device, host, gex, hour (dow-hh, for the heatmap)
//                  and total. "How much was X used" is a SUM over this table.
//
// Routes
//   POST /api/vela/telemetry            the beat (public + identify: a guest
//                                       is recorded by session id alone)
//   GET  /api/owner/vela/live           who is on now (seen in the last 75 s)
//   GET  /api/owner/vela/summary        ?days=1|7|30|90|0 &user=<id|sid:…> &hideOwner=1
//   GET  /api/owner/vela/events         ?limit &user &name &before (the feed)
//   GET  /api/owner/vela/session        ?sid (one tab: snapshot + its events)
//
// The `?` placeholders are libDb.queryAll's (rewritten to $n), so no JSONB `?`
// operator appears in any statement below.
// ─────────────────────────────────────────────────────────────────────────────

const LIVE_SEC = 75;
const MAX_BEAT_SEC = 120; // one beat never credits more than this (sleep, throttled timers)
const MAX_EVENTS = 300;
const EVENT_KEEP_DAYS = 365;

const s = (v, n = 120) => (v == null ? null : String(v).slice(0, n));
const num = (v, lo, hi, d = 0) => {
  const x = Number(v);
  return Number.isFinite(x) ? Math.max(lo, Math.min(hi, x)) : d;
};
const SYM_RE = /^[A-Z0-9^$/._-]{1,16}$/;
const cleanSym = (v) => {
  const x = String(v ?? '').trim().toUpperCase();
  return SYM_RE.test(x) ? x : null;
};

// ── the snapshot, cleaned: never trust its shape or its size ──
function cleanSnapshot(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const cells = (Array.isArray(raw.cells) ? raw.cells : []).slice(0, 16).map((c) => ({
    id: s(c?.id, 40),
    symbol: cleanSym(c?.symbol),
    tf: s(c?.tf, 8),
    session: s(c?.session, 12),
    active: !!c?.active,
    replay: !!c?.replay,
    drawings: num(c?.drawings, 0, 100000),
    indicators: (Array.isArray(c?.indicators) ? c.indicators : []).slice(0, 60).map((i) => ({
      name: s(i?.name, 60) || 'Indicator',
      type: s(i?.type, 60),
      hidden: !!i?.hidden,
    })),
  }));
  return {
    layout: s(raw.layout, 20),
    maximized: s(raw.maximized, 40),
    panel: s(raw.panel, 40),
    gex: s(raw.gex, 10),
    phone: !!raw.phone,
    viewport: s(raw.viewport, 20),
    cells,
  };
}

/** Seconds this beat adds, per usage key. */
function usageRows(snap, sec, nowEt) {
  const rows = [];
  if (sec <= 0) return rows;
  const add = (kind, key) => { if (key) rows.push([kind, String(key).slice(0, 60), sec]); };
  add('total', 'all');
  add('hour', `${nowEt.dow}-${String(nowEt.hour).padStart(2, '0')}`);
  if (!snap) return rows;
  add('device', snap.phone ? 'phone' : 'desktop');
  add('layout', snap.layout ? `${snap.layout} · ${snap.cells.length} chart${snap.cells.length === 1 ? '' : 's'}` : null);
  add('gex', snap.gex);
  const syms = new Set();
  const tfs = new Set();
  const inds = new Set();
  // a maximized chart is the only one on screen
  const shown = snap.maximized ? snap.cells.filter((c) => c.id === snap.maximized) : snap.cells;
  for (const c of shown) {
    if (c.symbol) syms.add(c.symbol);
    if (c.tf) tfs.add(c.tf);
    for (const i of c.indicators) if (!i.hidden) inds.add(i.name);
    if (c.active && c.symbol) add('ticker_active', c.symbol);
  }
  for (const x of syms) add('ticker', x);
  for (const x of tfs) add('timeframe', x);
  for (const x of inds) add('indicator', x);
  return rows;
}


function registerVelaTelemetryRoutes({ register, send, readJson, libDb, clientIp, clientGeo, visitAttribution }) {
  if (!libDb) return 0;
  const q = (sql, params = []) => libDb.queryAll(sql, params);

  let schema = null;
  function ensureSchema() {
    if (!schema) {
      schema = (async () => {
        await q(`CREATE TABLE IF NOT EXISTS vela_sessions (
          sid TEXT PRIMARY KEY,
          user_id TEXT,
          host TEXT, path TEXT, device TEXT,
          browser TEXT, os TEXT, ua TEXT,
          ip TEXT, country TEXT, region TEXT, city TEXT,
          tz TEXT, lang TEXT, screen TEXT,
          started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          last_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          ended_at TIMESTAMPTZ,
          visible_sec INTEGER NOT NULL DEFAULT 0,
          engaged_sec INTEGER NOT NULL DEFAULT 0,
          beats INTEGER NOT NULL DEFAULT 0,
          visible BOOLEAN,
          snapshot JSONB
        )`);
        await q('CREATE INDEX IF NOT EXISTS vela_sessions_seen_idx ON vela_sessions (last_seen_at DESC)');
        await q('CREATE INDEX IF NOT EXISTS vela_sessions_user_idx ON vela_sessions (user_id, last_seen_at DESC)');
        await q(`CREATE TABLE IF NOT EXISTS vela_events (
          id BIGSERIAL PRIMARY KEY,
          ts TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          sid TEXT NOT NULL,
          user_id TEXT,
          name TEXT NOT NULL,
          props JSONB
        )`);
        await q('CREATE INDEX IF NOT EXISTS vela_events_ts_idx ON vela_events (ts DESC)');
        await q('CREATE INDEX IF NOT EXISTS vela_events_name_idx ON vela_events (name, ts DESC)');
        await q('CREATE INDEX IF NOT EXISTS vela_events_user_idx ON vela_events (user_id, ts DESC)');
        await q('CREATE INDEX IF NOT EXISTS vela_events_sid_idx ON vela_events (sid, ts DESC)');
        await q(`CREATE TABLE IF NOT EXISTS vela_usage (
          day DATE NOT NULL,
          user_key TEXT NOT NULL,
          kind TEXT NOT NULL,
          key TEXT NOT NULL,
          sec INTEGER NOT NULL DEFAULT 0,
          PRIMARY KEY (day, user_key, kind, key)
        )`);
        await q('CREATE INDEX IF NOT EXISTS vela_usage_kind_idx ON vela_usage (kind, day)');
      })().catch((e) => { schema = null; throw e; });
    }
    return schema;
  }

  // ET calendar day / weekday / hour, in JS. Used to be a DB round trip per beat.
  const ET_FMT = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit',
    weekday: 'short', hour: '2-digit', hourCycle: 'h23',
  });
  const DOW = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
  function nowInEt() {
    const parts = Object.fromEntries(ET_FMT.formatToParts(new Date()).map((x) => [x.type, x.value]));
    return { day: `${parts.year}-${parts.month}-${parts.day}`, dow: DOW[parts.weekday] ?? 0, hour: Number(parts.hour) % 24 };
  }

  // ── The write buffer (2026-10-09 audit) ─────────────────────────────────────
  // Every open Vela tab beats every 30s (plus 3s after a change, plus a beacon
  // on hide). Each beat used to run up to 5 sequential queries on the shared
  // 10-connection pool — a SELECT, an INSERT or a non-HOT UPDATE that rewrote
  // the JSONB snapshot, an events INSERT, a SELECT just to read the ET date,
  // and a usage upsert — and the response waited on all of them. At 300 users
  // that is a steady ~50 statements a second competing with chart reads.
  //
  // Now a beat only updates memory and answers at once. Every FLUSH_MS the
  // buffer is written in at most four multi-row statements: new sessions, one
  // aggregated UPDATE for every session that beat, the events, and the summed
  // usage. The owner's live view reads last_seen_at within LIVE_SEC (75s), so
  // a 10s delay does not show. A crash loses at most one window of telemetry.
  const FLUSH_MS = 10_000;
  const MAX_PENDING_SESSIONS = 5_000; // memory bound under a flood of fake sids
  const MAX_PENDING_EVENTS = 20_000;
  const CHUNK = 400;
  const knownSids = new Set();       // sessions this process has already inserted
  let newSessions = new Map();       // sid → insert row
  let sessionAgg = new Map();        // sid → aggregated beat
  let eventRows = [];                // [tsMs, sid, userId, name, propsJson]
  let usageAgg = new Map();          // `${day}\u0001${userKey}\u0001${kind}\u0001${key}` → sec
  let flushing = false;
  const stats = { beats: 0, dropped: 0, flushes: 0, failures: 0, lastError: null };

  function bufferBeat(req, body, userId) {
    const sid = s(body?.sid, 64);
    const snap = cleanSnapshot(body?.snapshot);
    const visibleSec = Math.round(num(body?.visibleMs, 0, MAX_BEAT_SEC * 1000) / 1000);
    const engagedSec = Math.min(visibleSec, Math.round(num(body?.engagedMs, 0, MAX_BEAT_SEC * 1000) / 1000));
    const end = !!body?.end;

    if (!sessionAgg.has(sid) && sessionAgg.size >= MAX_PENDING_SESSIONS) { stats.dropped += 1; return; }
    stats.beats += 1;

    // who / where, worked out once per tab per process
    if (!knownSids.has(sid) && !newSessions.has(sid)) {
      let geo = {};
      let attr = {};
      try { geo = clientGeo ? clientGeo(req) || {} : {}; } catch { geo = {}; }
      try { attr = visitAttribution ? visitAttribution(req, {}) || {} : {}; } catch { attr = {}; }
      newSessions.set(sid, [
        sid, userId, s(body?.host, 80), s(body?.path, 120), snap?.phone ? 'phone' : (attr.device_type || 'desktop'),
        s(attr.browser, 40), s(attr.os, 40), s(req.headers['user-agent'], 300),
        (() => { try { return clientIp ? clientIp(req) : null; } catch { return null; } })(),
        s(geo.country, 8), s(geo.region, 60), s(geo.city, 80),
        s(body?.tz, 60), s(body?.lang, 20), s(body?.screen, 30),
      ]);
    }

    const agg = sessionAgg.get(sid) || { userId: null, end: false, vis: 0, eng: 0, beats: 0, visible: false, snap: null };
    agg.userId = userId || agg.userId;
    agg.end = end;
    agg.vis += visibleSec;
    agg.eng += engagedSec;
    agg.beats += 1;
    agg.visible = !!body?.visible;
    if (snap) agg.snap = JSON.stringify(snap);
    sessionAgg.set(sid, agg);

    // the actions since the last beat
    const events = (Array.isArray(body?.events) ? body.events : []).slice(-MAX_EVENTS);
    const nowMs = Date.now();
    for (const e of events) {
      if (eventRows.length >= MAX_PENDING_EVENTS) { stats.dropped += 1; break; }
      const name = s(e?.name, 40);
      if (!name) continue;
      // the client's clock, kept within reason of ours
      const ts = num(e?.ts, nowMs - 15 * 60_000, nowMs + 60_000, nowMs);
      let props = null;
      if (e?.props && typeof e.props === 'object') {
        const o = {};
        for (const [k, v] of Object.entries(e.props).slice(0, 16)) {
          o[String(k).slice(0, 24)] = typeof v === 'number' || typeof v === 'boolean' || v == null ? v : String(v).slice(0, 200);
        }
        props = JSON.stringify(o);
      }
      eventRows.push([ts, sid, userId, name, props]);
    }

    // time on tickers / timeframes / indicators …
    if (visibleSec > 0) {
      const et = nowInEt();
      const userKey = userId || `sid:${sid}`;
      for (const [kind, key, sec] of usageRows(snap, visibleSec, et)) {
        const k = `${et.day}\u0001${userKey}\u0001${kind}\u0001${key}`;
        usageAgg.set(k, (usageAgg.get(k) || 0) + sec);
      }
    }
  }

  async function flush() {
    if (flushing) return;
    if (!newSessions.size && !sessionAgg.size && !eventRows.length && !usageAgg.size) return;
    flushing = true;
    // Swap the buffers first: beats that land during the writes go to the next window.
    const ins = newSessions; newSessions = new Map();
    const upd = sessionAgg; sessionAgg = new Map();
    const evs = eventRows; eventRows = [];
    const use = usageAgg; usageAgg = new Map();
    try {
      await ensureSchema();
      const insRows = [...ins.values()];
      for (let i = 0; i < insRows.length; i += CHUNK) {
        const part = insRows.slice(i, i + CHUNK);
        await q(
          `INSERT INTO vela_sessions (sid, user_id, host, path, device, browser, os, ua, ip, country, region, city, tz, lang, screen)
           VALUES ${part.map(() => '(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)').join(', ')}
           ON CONFLICT (sid) DO NOTHING`,
          part.flat(),
        );
      }
      for (const sid of ins.keys()) knownSids.add(sid);
      if (knownSids.size > 50_000) knownSids.clear(); // re-inserting is a no-op; this only bounds memory

      const updRows = [...upd.entries()];
      for (let i = 0; i < updRows.length; i += CHUNK) {
        const part = updRows.slice(i, i + CHUNK);
        await q(
          `UPDATE vela_sessions AS t SET
             user_id = COALESCE(v.user_id, t.user_id),
             last_seen_at = NOW(),
             ended_at = CASE WHEN v.ended THEN NOW() ELSE NULL END,
             visible_sec = t.visible_sec + v.vis,
             engaged_sec = t.engaged_sec + v.eng,
             beats = t.beats + v.beats,
             visible = v.visible,
             snapshot = COALESCE(v.snap, t.snapshot)
           FROM (VALUES ${part.map(() => '(?::text, ?::text, ?::boolean, ?::int, ?::int, ?::int, ?::boolean, ?::jsonb)').join(', ')})
             AS v(sid, user_id, ended, vis, eng, beats, visible, snap)
           WHERE t.sid = v.sid`,
          part.flatMap(([sid, a]) => [sid, a.userId, a.end, a.vis, a.eng, a.beats, a.visible, a.snap]),
        );
      }

      for (let i = 0; i < evs.length; i += CHUNK) {
        const part = evs.slice(i, i + CHUNK);
        await q(
          `INSERT INTO vela_events (ts, sid, user_id, name, props)
           VALUES ${part.map(() => '(to_timestamp(?::double precision / 1000.0), ?, ?, ?, ?::jsonb)').join(', ')}`,
          part.flat(),
        );
      }

      const useRows = [...use.entries()].map(([k, sec]) => [...k.split('\u0001'), sec]);
      for (let i = 0; i < useRows.length; i += CHUNK) {
        const part = useRows.slice(i, i + CHUNK);
        await q(
          `INSERT INTO vela_usage (day, user_key, kind, key, sec)
           VALUES ${part.map(() => '(?::date, ?, ?, ?, ?)').join(', ')}
           ON CONFLICT (day, user_key, kind, key) DO UPDATE SET sec = vela_usage.sec + EXCLUDED.sec`,
          part.flat(),
        );
      }

      // keep the event log bounded (moved off the request path)
      if (Math.random() < 0.01) {
        q(`DELETE FROM vela_events WHERE ts < NOW() - make_interval(days => ?)`, [EVENT_KEEP_DAYS]).catch(() => {});
      }
      stats.flushes += 1;
    } catch (err) {
      // Telemetry is not worth retrying into a struggling database; this
      // window is dropped and the next one starts clean.
      stats.failures += 1;
      stats.lastError = String(err?.message || err).slice(0, 160);
      console.warn('[vela-telemetry] flush failed (window dropped):', stats.lastError);
    } finally {
      flushing = false;
    }
  }
  const flushTimer = setInterval(() => { flush().catch(() => {}); }, FLUSH_MS);
  if (flushTimer.unref) flushTimer.unref();

  // ═══════════════════════════════════════════════════════════════════════════
  // POST /api/vela/telemetry
  // ═══════════════════════════════════════════════════════════════════════════
  register('/api/vela/telemetry', {
    auth: 'public', identify: true, methods: ['POST'],
    async handler(req, res, ctx, access) {
      try {
        const body = await readJson(req, 256 * 1024);
        const sid = s(body?.sid, 64);
        if (!sid || !/^[A-Za-z0-9-]{8,64}$/.test(sid)) return send(res, 400, { error: 'bad sid' });
        const userId = access?.userId ? String(access.userId) : null;
        bufferBeat(req, body, userId);
        return send(res, 200, { ok: true });
      } catch (err) {
        return send(res, 500, { error: 'telemetry failed', detail: String(err?.message || err) });
      }
    },
  });
  registerVelaTelemetryRoutes._stats = () => ({ ...stats, pendingSessions: sessionAgg.size, pendingEvents: eventRows.length, pendingUsage: usageAgg.size });
  registerVelaTelemetryRoutes._flush = flush;

  // ═══════════════════════════════════════════════════════════════════════════
  // Owner reads
  // ═══════════════════════════════════════════════════════════════════════════

  /** user_id → { email, isOwner } for a set of ids. */
  async function people(ids) {
    const list = [...new Set(ids.filter(Boolean).map(String))];
    if (!list.length) return new Map();
    try {
      const rows = await q('SELECT id::text AS id, email, COALESCE(is_owner, FALSE) AS is_owner FROM users WHERE id::text = ANY(?::text[])', [list]);
      return new Map(rows.map((r) => [r.id, { email: r.email, isOwner: !!r.is_owner }]));
    } catch {
      return new Map();
    }
  }

  const params = (req) => new URL(req.url || '/', 'http://localhost').searchParams;
  const daysOf = (sp) => {
    const d = Number(sp.get('days') ?? 7);
    return Number.isFinite(d) && d >= 0 ? Math.min(Math.round(d), 3650) : 7;
  };

  // GET /api/owner/vela/live
  register('/api/owner/vela/live', {
    auth: 'owner', methods: ['GET'],
    async handler(req, res) {
      try {
        await ensureSchema();
        const rows = await q(
          `SELECT sid, user_id, host, path, device, browser, os, country, region, city, tz, screen,
                  started_at, last_seen_at, visible_sec, engaged_sec, beats, visible, snapshot
             FROM vela_sessions
            WHERE last_seen_at > NOW() - make_interval(secs => ?) AND ended_at IS NULL
            ORDER BY started_at`,
          [LIVE_SEC],
        );
        const who = await people(rows.map((r) => r.user_id));
        // the last thing each tab did
        const last = rows.length
          ? await q(
            `SELECT DISTINCT ON (sid) sid, name, props, ts FROM vela_events
              WHERE sid = ANY(?::text[]) AND name NOT IN ('tab_visible', 'tab_hidden', 'load')
              ORDER BY sid, ts DESC, id DESC`,
            [rows.map((r) => r.sid)],
          )
          : [];
        const lastBySid = new Map(last.map((r) => [r.sid, r]));
        const out = rows.map((r) => ({
          sid: r.sid,
          userId: r.user_id,
          email: who.get(String(r.user_id))?.email ?? null,
          isOwner: who.get(String(r.user_id))?.isOwner ?? false,
          host: r.host, path: r.path, device: r.device, browser: r.browser, os: r.os,
          place: [r.city, r.region, r.country].filter(Boolean).join(', ') || null,
          tz: r.tz, screen: r.screen,
          startedAt: r.started_at, lastSeenAt: r.last_seen_at,
          visibleSec: r.visible_sec, engagedSec: r.engaged_sec, visible: r.visible,
          snapshot: r.snapshot,
          lastAction: lastBySid.get(r.sid) ? { name: lastBySid.get(r.sid).name, props: lastBySid.get(r.sid).props, ts: lastBySid.get(r.sid).ts } : null,
        }));
        const users = new Set(out.map((o) => o.userId || `sid:${o.sid}`));
        send(res, 200, { ok: true, tabs: out.length, users: users.size, rows: out, at: new Date().toISOString() }, { 'Cache-Control': 'no-store' });
      } catch (err) { send(res, 500, { error: 'live failed', detail: String(err?.message || err) }); }
    },
  });

  // GET /api/owner/vela/summary
  register('/api/owner/vela/summary', {
    auth: 'owner', methods: ['GET'],
    async handler(req, res, ctx) {
      try {
        await ensureSchema();
        const sp = params(req);
        const days = daysOf(sp);
        const user = s(sp.get('user'), 80);
        const hideOwner = sp.get('hideOwner') === '1';
        const ownerId = ctx?.ownerUserId ? String(ctx.ownerUserId) : null;

        // windows: usage by ET day, sessions / events by time
        const dayFrom = days > 0 ? `day > (NOW() AT TIME ZONE 'America/New_York')::date - ${days}` : 'TRUE';
        const tsFrom = (col) => (days > 0 ? `${col} >= (date_trunc('day', NOW() AT TIME ZONE 'America/New_York') - make_interval(days => ${days - 1})) AT TIME ZONE 'America/New_York'` : 'TRUE');
        const uWhere = [dayFrom];
        const uParams = [];
        if (user) { uWhere.push('user_key = ?'); uParams.push(user); }
        if (hideOwner && ownerId) { uWhere.push('user_key <> ?'); uParams.push(ownerId); }
        const sWhere = [tsFrom('last_seen_at')];
        const sParams = [];
        const eWhere = [tsFrom('ts')];
        const eParams = [];
        if (user) {
          const isSid = user.startsWith('sid:');
          sWhere.push(isSid ? 'sid = ?' : 'user_id = ?'); sParams.push(isSid ? user.slice(4) : user);
          eWhere.push(isSid ? 'sid = ?' : 'user_id = ?'); eParams.push(isSid ? user.slice(4) : user);
        }
        if (hideOwner && ownerId) {
          sWhere.push('(user_id IS NULL OR user_id <> ?)'); sParams.push(ownerId);
          eWhere.push('(user_id IS NULL OR user_id <> ?)'); eParams.push(ownerId);
        }
        const U = uWhere.join(' AND ');
        const S = sWhere.join(' AND ');
        const E = eWhere.join(' AND ');

        const [totals, usage, daily, actions, indActs, loads, errors, perUser, perUserTop, places, browsers] = await Promise.all([
          q(`SELECT COUNT(*)::int AS sessions,
                    COUNT(DISTINCT COALESCE(user_id, 'sid:' || sid))::int AS users,
                    COALESCE(SUM(visible_sec), 0)::int AS visible_sec,
                    COALESCE(SUM(engaged_sec), 0)::int AS engaged_sec,
                    COALESCE(AVG(visible_sec), 0)::int AS avg_session_sec,
                    COALESCE(MAX(visible_sec), 0)::int AS longest_session_sec
               FROM vela_sessions WHERE ${S}`, sParams),
          q(`SELECT kind, key, SUM(sec)::int AS sec, COUNT(DISTINCT user_key)::int AS users
               FROM vela_usage WHERE ${U} AND kind <> 'total'
              GROUP BY kind, key ORDER BY kind, sec DESC`, uParams),
          q(`SELECT day::text AS day, COUNT(DISTINCT user_key)::int AS users, SUM(sec)::int AS sec
               FROM vela_usage WHERE ${U} AND kind = 'total'
              GROUP BY day ORDER BY day`, uParams),
          q(`SELECT name, COUNT(*)::int AS n, COUNT(DISTINCT COALESCE(user_id, sid))::int AS users
               FROM vela_events WHERE ${E} GROUP BY name ORDER BY n DESC`, eParams),
          q(`SELECT props->>'name' AS name,
                    COUNT(*) FILTER (WHERE name = 'indicator_add')::int AS adds,
                    COUNT(*) FILTER (WHERE name = 'indicator_remove')::int AS removes,
                    COUNT(*) FILTER (WHERE name = 'indicator_settings')::int AS settings,
                    COUNT(*) FILTER (WHERE name = 'indicator_hide')::int AS hides,
                    COUNT(*) FILTER (WHERE name = 'indicator_error')::int AS errors,
                    COUNT(*) FILTER (WHERE name = 'picker_add')::int AS from_picker
               FROM vela_events
              WHERE ${E} AND name IN ('indicator_add', 'indicator_remove', 'indicator_settings', 'indicator_hide', 'indicator_error', 'picker_add')
              GROUP BY 1`, eParams),
          q(`SELECT props->>'symbol' AS symbol, props->>'tf' AS tf, COUNT(*)::int AS n,
                    ROUND(AVG((props->>'ms')::numeric))::int AS avg_ms,
                    ROUND(percentile_cont(0.5) WITHIN GROUP (ORDER BY (props->>'ms')::numeric))::int AS p50_ms,
                    ROUND(percentile_cont(0.95) WITHIN GROUP (ORDER BY (props->>'ms')::numeric))::int AS p95_ms,
                    MAX((props->>'ms')::numeric)::int AS max_ms
               FROM vela_events WHERE ${E} AND name = 'load' AND (props->>'ms') ~ '^[0-9]+$'
              GROUP BY 1, 2 ORDER BY n DESC LIMIT 40`, eParams),
          q(`SELECT ts, sid, user_id, name, props FROM vela_events
              WHERE ${E} AND name IN ('js_error', 'indicator_error') ORDER BY ts DESC LIMIT 60`, eParams),
          q(`SELECT COALESCE(user_id, 'sid:' || sid) AS user_key, MAX(user_id) AS user_id,
                    COUNT(*)::int AS sessions, SUM(visible_sec)::int AS visible_sec, SUM(engaged_sec)::int AS engaged_sec,
                    MIN(started_at) AS first_seen, MAX(last_seen_at) AS last_seen,
                    STRING_AGG(DISTINCT device, ', ') AS devices, STRING_AGG(DISTINCT host, ', ') AS hosts,
                    STRING_AGG(DISTINCT NULLIF(CONCAT_WS(', ', city, country), ''), ' · ') AS places
               FROM vela_sessions WHERE ${S}
              GROUP BY 1 ORDER BY visible_sec DESC NULLS LAST LIMIT 200`, sParams),
          q(`SELECT user_key, kind, key, sec FROM (
               SELECT user_key, kind, key, SUM(sec)::int AS sec,
                      ROW_NUMBER() OVER (PARTITION BY user_key, kind ORDER BY SUM(sec) DESC) AS rk
                 FROM vela_usage WHERE ${U} AND kind IN ('ticker', 'indicator', 'timeframe')
                GROUP BY user_key, kind, key) t
              WHERE rk <= 5`, uParams),
          q(`SELECT NULLIF(CONCAT_WS(', ', city, region, country), '') AS place, COUNT(*)::int AS sessions,
                    COUNT(DISTINCT COALESCE(user_id, sid))::int AS users
               FROM vela_sessions WHERE ${S} GROUP BY 1 ORDER BY sessions DESC LIMIT 30`, sParams),
          q(`SELECT CONCAT_WS(' · ', COALESCE(browser, 'unknown'), COALESCE(os, 'unknown')) AS key, COUNT(*)::int AS sessions
               FROM vela_sessions WHERE ${S} GROUP BY 1 ORDER BY sessions DESC LIMIT 20`, sParams),
        ]);

        const who = await people([...perUser.map((r) => r.user_id), ...errors.map((r) => r.user_id)]);
        const byKind = {};
        for (const r of usage) (byKind[r.kind] ||= []).push({ key: r.key, sec: r.sec, users: r.users });
        const tops = new Map();
        for (const r of perUserTop) {
          const t = tops.get(r.user_key) || { ticker: [], indicator: [], timeframe: [] };
          t[r.kind].push({ key: r.key, sec: r.sec });
          tops.set(r.user_key, t);
        }
        for (const t of tops.values()) for (const k of Object.keys(t)) t[k].sort((a, b) => b.sec - a.sec);
        const ind = new Map(indActs.map((r) => [r.name, r]));
        const indicators = (byKind.indicator || []).map((r) => ({ ...r, ...(ind.get(r.key) || {}) }));
        for (const r of indActs) if (r.name && !indicators.some((i) => i.key === r.name)) indicators.push({ key: r.name, sec: 0, users: 0, ...r });

        send(res, 200, {
          ok: true,
          days,
          totals: totals[0],
          usage: byKind,
          indicators,
          daily,
          actions,
          loads,
          errors: errors.map((e) => ({ ...e, email: who.get(String(e.user_id))?.email ?? null })),
          users: perUser.map((u) => ({
            ...u,
            email: who.get(String(u.user_id))?.email ?? null,
            isOwner: who.get(String(u.user_id))?.isOwner ?? false,
            top: tops.get(u.user_key) || { ticker: [], indicator: [], timeframe: [] },
          })),
          places,
          browsers,
          at: new Date().toISOString(),
        }, { 'Cache-Control': 'no-store' });
      } catch (err) { send(res, 500, { error: 'summary failed', detail: String(err?.message || err) }); }
    },
  });

  // GET /api/owner/vela/events — the activity feed
  register('/api/owner/vela/events', {
    auth: 'owner', methods: ['GET'],
    async handler(req, res, ctx) {
      try {
        await ensureSchema();
        const sp = params(req);
        const limit = num(sp.get('limit'), 1, 1000, 200);
        const where = [`name NOT IN ('tab_visible', 'tab_hidden')`];
        const p = [];
        const user = s(sp.get('user'), 80);
        if (user) {
          if (user.startsWith('sid:')) { where.push('sid = ?'); p.push(user.slice(4)); }
          else { where.push('user_id = ?'); p.push(user); }
        }
        const name = s(sp.get('name'), 40);
        if (name) { where.push('name = ?'); p.push(name); }
        const before = Number(sp.get('before'));
        if (Number.isFinite(before) && before > 0) { where.push('id < ?'); p.push(before); }
        if (sp.get('hideOwner') === '1' && ctx?.ownerUserId) { where.push('(user_id IS NULL OR user_id <> ?)'); p.push(String(ctx.ownerUserId)); }
        if (sp.get('noLoads') === '1') where.push(`name <> 'load'`);
        p.push(limit);
        const rows = await q(`SELECT id, ts, sid, user_id, name, props FROM vela_events WHERE ${where.join(' AND ')} ORDER BY id DESC LIMIT ?`, p);
        const who = await people(rows.map((r) => r.user_id));
        send(res, 200, { ok: true, rows: rows.map((r) => ({ ...r, id: Number(r.id), email: who.get(String(r.user_id))?.email ?? null })) }, { 'Cache-Control': 'no-store' });
      } catch (err) { send(res, 500, { error: 'events failed', detail: String(err?.message || err) }); }
    },
  });

  // GET /api/owner/vela/session?sid= — one tab, whole story
  register('/api/owner/vela/session', {
    auth: 'owner', methods: ['GET'],
    async handler(req, res) {
      try {
        await ensureSchema();
        const sid = s(params(req).get('sid'), 64);
        if (!sid) return send(res, 400, { error: 'sid required' });
        const [row] = await q('SELECT * FROM vela_sessions WHERE sid = ?', [sid]);
        if (!row) return send(res, 404, { error: 'not found' });
        const events = await q('SELECT id, ts, name, props FROM vela_events WHERE sid = ? ORDER BY ts DESC LIMIT 500', [sid]);
        const who = await people([row.user_id]);
        send(res, 200, { ok: true, session: { ...row, email: who.get(String(row.user_id))?.email ?? null }, events: events.map((e) => ({ ...e, id: Number(e.id) })) }, { 'Cache-Control': 'no-store' });
      } catch (err) { send(res, 500, { error: 'session failed', detail: String(err?.message || err) }); }
    },
  });

  return 5;
}

module.exports = { registerVelaTelemetryRoutes, cleanSnapshot, usageRows };
