'use strict';
/**
 * ─────────────────────────────────────────────────────────────────────────────
 * /healthz — the whole box, from inside, in one answer (2026-10-08).
 *
 * Before this, "is anything wrong" meant opening owner → Admin → System Health,
 * which polls seven endpoints from the browser and assembles the picture there.
 * Nothing could be curled, nothing could be pointed at by a monitor, and the
 * one public probe (/proxy/health) answers `ok: true` from the moment the
 * process listens — through a dead feed, a dead database and a stopped recorder.
 *
 * Two answers, modelled on Voltick's (server/server.js healthzBody):
 *
 *   /healthz        OWNER. Every number below, built at most once per HOLD_MS
 *   /api/healthz    and shared by every reader, so an open console refreshed
 *                   all day never builds it twice in a breath. ?fresh=1 skips
 *                   the hold. Codes and counts only — no keys, no tokens, no
 *                   customer data, nothing a screenshot could leak.
 *
 *   /healthz/ready  PUBLIC, cheap. The one an outside monitor should watch.
 *   /api/healthz/ready
 *                   Three questions: does the process answer, does Postgres
 *                   answer, and — DURING REGULAR HOURS ONLY — is the feed live
 *                   and fresh. Outside RTH an old spot is correct (the last
 *                   tick was at the close); paging on it every evening is how a
 *                   monitor earns its way into being muted. 200 ready, 503 not,
 *                   with the reason codes either way.
 *
 * Subsystems that live in other closures (the chains SWR cache, the Vela
 * history cache, the LSE vault) report through probe(name, fn): a function
 * that returns a small plain object. A probe that throws reports
 * { error } and never takes the rest of the body down with it.
 *
 * Every DB read here is index-backed (max() on an indexed timestamp, or a
 * max(date) then that day's rows) and raced against a timeout, so a slow or
 * locked table costs this route a "timeout" cell, not a hung request.
 * ─────────────────────────────────────────────────────────────────────────────
 */

const { monitorEventLoopDelay } = require('perf_hooks');

const HOLD_MS = 30_000;
const READY_HOLD_MS = 5_000;
const Q_TIMEOUT_MS = 2_500;
const BOOT_AT = Date.now();

let VERSION = null;
try { VERSION = require('../package.json').version || null; } catch { /* keep null */ }

// NYSE full-day closures — the same list the recorders carry (ib-results-recorder.js).
const MARKET_HOLIDAYS = new Set([
  '2026-01-01', '2026-01-19', '2026-02-16', '2026-04-03', '2026-05-25',
  '2026-06-19', '2026-07-03', '2026-09-07', '2026-11-26', '2026-12-25',
  '2027-01-01', '2027-01-18', '2027-02-15', '2027-03-26', '2027-05-31',
  '2027-06-18', '2027-07-05', '2027-09-06', '2027-11-25', '2027-12-24',
]);

/* ── the loop, measured all the time (cheap) ──────────────────────────────────
   The histogram gives p50/p99/max since the last full build read it. The drift
   timer counts STALLS: a 500ms tick that landed more than STALL_MS late means
   the main thread was blocked for that long, and the last few are kept with
   their time so "it froze at 10:31" can be read off this route afterwards. */
const STALL_MS = 250;
const loopHist = monitorEventLoopDelay({ resolution: 20 });
loopHist.enable();
const stalls = { count: 0, worstMs: 0, recent: [] };
let peakRss = 0;
{
  let last = Date.now();
  let n = 0;
  const t = setInterval(() => {
    const now = Date.now();
    const late = now - last - 500;
    last = now;
    if (late > STALL_MS) {
      stalls.count += 1;
      if (late > stalls.worstMs) stalls.worstMs = late;
      stalls.recent.push({ at: now, ms: late });
      if (stalls.recent.length > 10) stalls.recent.shift();
    }
    if ((n++ % 10) === 0) {
      try { const r = process.memoryUsage.rss(); if (r > peakRss) peakRss = r; } catch { /* ignore */ }
    }
  }, 500);
  t.unref?.();
}

// Deploys, nightly restarts, the Vela library check (server-v2/activity.cjs).
// Loading it records this boot; a failure to load just leaves the card empty.
let activity = null;
try { activity = require('./activity.cjs'); }
catch (e) { console.warn('[healthz] activity.cjs not loaded:', e.message); }

const probes = new Map();
/** Register a subsystem's own report. fn() returns a small plain object. */
function probe(name, fn) { if (typeof fn === 'function') probes.set(name, fn); }

/* ── helpers ──────────────────────────────────────────────────────────────── */
const mb = (b) => (Number.isFinite(b) ? Math.round(b / 1048576) : null);
const sec = (ms) => (Number.isFinite(ms) && ms >= 0 ? Math.round(ms / 1000) : null);
function etParts(d = new Date()) {
  const p = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', weekday: 'short', hour12: false,
  }).formatToParts(d);
  const g = (t) => p.find((x) => x.type === t)?.value;
  return { date: `${g('year')}-${g('month')}-${g('day')}`, hour: Number(g('hour')) % 24, minute: Number(g('minute')), weekday: g('weekday') };
}
/** Regular hours: a trading weekday, 09:30–16:00 ET. */
function isRth(d = new Date()) {
  const { date, hour, minute, weekday } = etParts(d);
  if (weekday === 'Sat' || weekday === 'Sun' || MARKET_HOLIDAYS.has(date)) return false;
  const m = hour * 60 + minute;
  return m >= 570 && m < 960;
}
function withTimeout(p, ms = Q_TIMEOUT_MS) {
  let t;
  return Promise.race([
    Promise.resolve(p).finally(() => clearTimeout(t)),
    new Promise((_, rej) => { t = setTimeout(() => rej(new Error('timeout')), ms); }),
  ]);
}
/** A cell that failed reads as { error: '<short code>' } — never a stack. */
function errCell(e) {
  const m = String(e?.message || e || 'error');
  if (m === 'timeout') return { error: 'timeout' };
  if (/ECONNREFUSED|ENOTFOUND|EAI_AGAIN/.test(m)) return { error: 'unreachable' };
  if (/does not exist/.test(m)) return { error: 'missing' };
  return { error: m.slice(0, 120) };
}
/** Epoch ms from a BIGINT that may be seconds or ms, or a Date/ISO. */
function toMs(v) {
  if (v == null) return null;
  if (v instanceof Date) return v.getTime();
  const n = Number(v);
  if (Number.isFinite(n)) return n < 1e12 ? n * 1000 : n;
  const t = Date.parse(v);
  return Number.isFinite(t) ? t : null;
}

async function getJson(ctx, path) {
  const r = await withTimeout(ctx.internalFetch(path, { cache: 'no-store' }));
  if (!r.ok) throw new Error(`http ${r.status}`);
  return r.json();
}

/* ── the recorders: what each one wrote last, and how old that is ─────────────
   maxAgeSec is judged during RTH only. Every query is index-backed — see the
   CREATE INDEX lines named beside each. */
const RECORDERS = [
  // idx_osgh_ts (timestamp)
  { key: 'strikeGex', table: 'option_strike_gex_history', maxAgeSec: 300,
    sql: 'SELECT max(timestamp) AS t FROM option_strike_gex_history' },
  // flow_prints_date_ts_idx (date, ts)
  { key: 'flowTape', table: 'flow_prints', maxAgeSec: 300,
    sql: 'SELECT max(ts) AS t FROM flow_prints WHERE date = (SELECT max(date) FROM flow_prints)' },
  // idx_gts_ts (timestamp)
  { key: 'greeks', table: 'greeks_ts', maxAgeSec: 600,
    sql: 'SELECT max(timestamp) AS t FROM greeks_ts' },
  // idx_ec_date (date) — futures, but only judged in RTH like the rest
  { key: 'esCandles', table: 'es_candles', maxAgeSec: 600,
    sql: 'SELECT max(timestamp) AS t FROM es_candles WHERE date = (SELECT max(date) FROM es_candles)' },
  // PK (symbol, timestamp) — one symbol per row is a single index probe
  { key: 'etfCandles', table: 'etf_candles', maxAgeSec: 600, perSymbol: ['SPY', 'QQQ', 'SPX'],
    sql: 'SELECT max(timestamp) AS t FROM etf_candles WHERE symbol = $1' },
];

async function recorderSection(libDb, rth) {
  const now = Date.now();
  const out = {};
  await Promise.all(RECORDERS.map(async (r) => {
    const judge = (t) => {
      const ageSec = t ? sec(now - t) : null;
      let state = 'ok';
      if (!t) state = 'empty';
      else if (rth && ageSec > r.maxAgeSec) state = 'stale';
      return { newestAt: t ? new Date(t).toISOString() : null, ageSec, maxAgeSec: r.maxAgeSec, state };
    };
    try {
      if (r.perSymbol) {
        const per = {};
        await Promise.all(r.perSymbol.map(async (s) => {
          try {
            const res = await withTimeout(libDb.pgQuery(r.sql, [s]));
            per[s] = judge(toMs(res.rows[0]?.t));
          } catch (e) { per[s] = { ...errCell(e), state: 'error' }; }
        }));
        const states = Object.values(per).map((x) => x.state);
        const worst = ['error', 'stale', 'empty', 'ok'].find((s) => states.includes(s)) || 'ok';
        const firstErr = Object.entries(per).find(([, x]) => x.error);
        out[r.key] = { table: r.table, state: worst, symbols: per, ...(firstErr ? { error: `${firstErr[0]}: ${firstErr[1].error}` } : {}) };
      } else {
        const res = await withTimeout(libDb.pgQuery(r.sql));
        out[r.key] = { table: r.table, ...judge(toMs(res.rows[0]?.t)) };
      }
    } catch (e) {
      out[r.key] = { table: r.table, ...errCell(e), state: 'error' };
    }
  }));
  return out;
}

async function dbSection(libDb) {
  const t0 = Date.now();
  try {
    await withTimeout(libDb.pgQuery('SELECT 1'));
    const latencyMs = Date.now() - t0;
    let pool = null;
    try {
      const p = await libDb.getDb();
      pool = { total: p.totalCount, idle: p.idleCount, waiting: p.waitingCount, max: p.options?.max ?? null };
    } catch { /* pool stats are a bonus */ }
    let sizeMb = null;
    let conns = null;
    try {
      const r = await withTimeout(libDb.pgQuery(
        `SELECT pg_database_size(current_database()) AS size,
                (SELECT count(*) FROM pg_stat_activity WHERE datname = current_database()) AS conns`));
      sizeMb = mb(Number(r.rows[0]?.size));
      conns = Number(r.rows[0]?.conns);
    } catch { /* size is a bonus */ }
    return { ok: true, latencyMs, pool, sizeMb, connections: conns };
  } catch (e) {
    return { ok: false, latencyMs: Date.now() - t0, ...errCell(e) };
  }
}

/** Vela usage, from its own event table (vela-telemetry.cjs) — vela_events_ts_idx. */
async function velaUsageSection(libDb) {
  try {
    const r = await withTimeout(libDb.pgQuery(
      `SELECT
         (SELECT extract(epoch FROM max(ts)) * 1000 FROM vela_events) AS newest,
         (SELECT count(DISTINCT sid) FROM vela_events WHERE ts > now() - interval '15 minutes') AS sessions15m,
         (SELECT count(*) FROM vela_events WHERE ts > now() - interval '1 hour') AS events1h,
         (SELECT count(DISTINCT coalesce(user_id, sid)) FROM vela_events WHERE ts > now() - interval '24 hours') AS people24h`));
    const row = r.rows[0] || {};
    const newest = toMs(row.newest);
    return {
      sessions15m: Number(row.sessions15m) || 0,
      events1h: Number(row.events1h) || 0,
      people24h: Number(row.people24h) || 0,
      newestEventAgeSec: newest ? sec(Date.now() - newest) : null,
    };
  } catch (e) { return errCell(e); }
}

function processSection() {
  const m = process.memoryUsage();
  if (m.rss > peakRss) peakRss = m.rss;
  const loop = {
    p50Ms: Math.round(loopHist.percentile(50) / 1e6),
    p99Ms: Math.round(loopHist.percentile(99) / 1e6),
    maxMs: Math.round(loopHist.max / 1e6),
    windowSec: sec(Date.now() - (processSection.lastReset || BOOT_AT)),
    stalls: stalls.count,
    worstStallMs: Math.round(stalls.worstMs),
    recentStalls: stalls.recent.map((s) => ({ at: new Date(s.at).toISOString(), ms: Math.round(s.ms) })),
  };
  loopHist.reset();
  processSection.lastReset = Date.now();
  return {
    uptimeSec: Math.round(process.uptime()),
    startedAt: new Date(BOOT_AT).toISOString(),
    node: process.version,
    rssMb: mb(m.rss), peakRssMb: mb(peakRss), heapMb: mb(m.heapUsed), heapTotalMb: mb(m.heapTotal), externalMb: mb(m.external),
    loop,
  };
}

/* Env flags that live ONLY in .env.local on the box (AGENTS.md "Env flags — NOT
   in git"). A rebuilt env silently reverts them; this is where that shows. Only
   whether each is set the way the box expects — never a value that is a secret. */
function envSection() {
  const e = process.env;
  return {
    WS_DEFLATE: e.WS_DEFLATE || 'off',
    WS_AUTH_REQUIRED: e.WS_AUTH_REQUIRED === '1',
    PROXY_AUTH_REQUIRED: e.PROXY_AUTH_REQUIRED === '1',
    API_ROUTER: e.API_ROUTER === '1',
    FLOW_BROADCAST_TAPE_MAX: e.FLOW_BROADCAST_TAPE_MAX ? Number(e.FLOW_BROADCAST_TAPE_MAX) : null,
    INTERNAL_API_TOKEN: Boolean(e.INTERNAL_API_TOKEN),
    WS_ALERT_WEBHOOK: Boolean(e.WS_ALERT_WEBHOOK || e.DISCORD_WEBHOOK_URL),
    LSE_API_KEY: Boolean(e.LSE_API_KEY || e.LSE_API_KEYS),
  };
}

function feedSection(status, rth) {
  if (!status || status.error) return status || { error: 'unreachable' };
  const now = Date.now();
  const lastFeed = toMs(status.lastFeedAt);
  return {
    ttAuthenticated: Boolean(status.ttAuthenticated),
    dxlinkConnected: Boolean(status.dxlinkConnected),
    idle: Boolean(status.idle),
    chartReady: Boolean(status.chartReady),
    contractsSubscribed: Number(status.contractsSubscribed) || 0,
    oiCoveragePct: Number.isFinite(status.oiCoverage) ? Math.round(status.oiCoverage * 100) : null,
    greeksCoveragePct: Number.isFinite(status.greeksCoverage) ? Math.round(status.greeksCoverage * 100) : null,
    lastFeedAgeSec: lastFeed ? sec(now - lastFeed) : null,
    spot: Number.isFinite(status.spot) ? status.spot : null,
    spotAgeSec: Number.isFinite(status.spotAgeMs) ? sec(status.spotAgeMs) : null,
    boardAgeSec: status.updatedAt ? sec(now - toMs(status.updatedAt)) : null,
    lastError: status.lastError ? String(status.lastError).slice(0, 160) : null,
    rth,
  };
}

function socketSection(self) {
  const bw = self?.wsBandwidth;
  if (!bw) return self?.error ? self : { error: 'not-attached' };
  const total = bw.lastMinTotal || 0;
  const top = Object.entries(bw.lastMin || {}).sort((a, b) => b[1] - a[1]).slice(0, 6)
    .map(([type, bytes]) => ({ type, kb: Math.round(bytes / 1024), pct: total ? Math.round((bytes / total) * 100) : 0 }));
  const snap = (bw.lastMin || {}).snapshot || 0;
  return {
    clients: bw.clients,
    mbPerMin: Math.round((total / 1048576) * 100) / 100,
    projectedGbPerDay: Math.round(((total * 1440) / 1073741824) * 10) / 10,
    connectsLastMin: bw.connectsLastMin,
    totalConnects: bw.totalConnects,
    snapshotPct: total ? Math.round((snap / total) * 100) : 0,
    top,
  };
}

/* ── verdict: every problem as a code + severity ─────────────────────────────
   'down' = something a member would notice now. 'warn' = degraded, or a setting
   that will bite later. ok is false only when something is down. */
function problemsOf(b) {
  const p = [];
  const add = (code, level, note) => p.push({ code, level, ...(note ? { note } : {}) });
  const f = b.feed || {};
  if (f.error) add('feed.unreachable', 'down');
  else if (b.rth) {
    if (f.idle) add('feed.idle', 'down', 'owner idle switch is on during RTH');
    if (!f.ttAuthenticated) add('feed.tt-auth', 'down');
    if (!f.dxlinkConnected) add('feed.dxlink', 'down');
    if (f.spotAgeSec != null && f.spotAgeSec > 90) add('feed.spot-stale', 'down', `${f.spotAgeSec}s`);
    if (f.lastFeedAgeSec != null && f.lastFeedAgeSec > 90) add('feed.stale', 'down', `${f.lastFeedAgeSec}s`);
    if (!f.chartReady) add('feed.chart-not-ready', 'warn');
  }
  if (!b.db?.ok) add('db.down', 'down', b.db?.error);
  else if (b.db.latencyMs > 500) add('db.slow', 'warn', `${b.db.latencyMs}ms`);
  if (b.db?.pool?.waiting > 0) add('db.pool-waiting', 'warn', `${b.db.pool.waiting} waiting`);
  for (const [k, r] of Object.entries(b.recorders || {})) {
    if (r.state === 'stale') add(`recorder.${k}.stale`, 'warn', r.ageSec != null ? `${r.ageSec}s` : undefined);
    else if (r.state === 'error') add(`recorder.${k}.error`, 'warn', r.error);
    else if (r.state === 'empty' && b.rth) add(`recorder.${k}.empty`, 'warn');
  }
  const s = b.socket || {};
  if (s.connectsLastMin >= 30 && s.clients <= 1) add('ws.reconnect-storm', 'down', `${s.connectsLastMin} connects/min`);
  if (s.mbPerMin >= 30) add('ws.bandwidth', 'warn', `${s.mbPerMin} MB/min`);
  if (s.snapshotPct >= 50 && s.mbPerMin >= 5) add('ws.snapshot-churn', 'warn', `${s.snapshotPct}% snapshots`);
  const pr = b.process || {};
  if (pr.loop?.maxMs >= 1000) add('loop.block', 'warn', `${pr.loop.maxMs}ms`);
  if (pr.rssMb >= 3072) add('mem.high', 'warn', `${pr.rssMb}MB`);
  const env = b.env || {};
  if (env.WS_DEFLATE !== 'default') add('env.WS_DEFLATE', 'warn', `is ${env.WS_DEFLATE}, expected default`);
  if (!env.WS_AUTH_REQUIRED) add('env.WS_AUTH_REQUIRED', 'warn', 'paid feed open to anyone with the URL');
  const night = b.activity?.lastNightly;
  if (night && night.level !== 'ok' && Date.now() - Date.parse(night.at) < 24 * 3600_000) {
    add('schedule.nightly-restart', 'warn', night.level === 'down' ? 'did not run last night' : 'only part of the stack restarted');
  }
  for (const [k, v] of Object.entries(b.probes || {})) {
    if (v && v.error) add(`probe.${k}`, 'warn', v.error);
    for (const w of (v && Array.isArray(v.problems) ? v.problems : [])) add(`${k}.${w.code}`, w.level || 'warn', w.note);
  }
  return p;
}

/* ── the two builders ─────────────────────────────────────────────────────── */
let held = null;       // { at, body }
let building = null;   // in-flight promise — concurrent readers join it

async function buildBody(ctx, libDb) {
  const rth = isRth();
  const [status, self, db, recorders, vela] = await Promise.all([
    getJson(ctx, '/proxy/status').catch(errCell),
    getJson(ctx, '/proxy/self-metrics').catch(errCell),
    libDb ? dbSection(libDb) : { ok: false, error: 'db-layer-not-loaded' },
    libDb ? recorderSection(libDb, rth).catch(errCell) : {},
    libDb ? velaUsageSection(libDb) : { error: 'db-layer-not-loaded' },
  ]);
  const probeOut = {};
  for (const [name, fn] of probes) {
    try { probeOut[name] = await withTimeout(Promise.resolve().then(fn), 1500); }
    catch (e) { probeOut[name] = errCell(e); }
  }
  const body = {
    ok: true,
    verdict: 'ok',
    build: { version: VERSION, node: process.version },
    asOf: new Date().toISOString(),
    rth,
    feed: feedSection(status, rth),
    socket: socketSection(self),
    process: processSection(),
    db,
    recorders,
    vela: { usage: vela, history: probeOut.velaHistory, chains: probeOut.chains },
    probes: probeOut,
    env: envSection(),
    activity: (() => { try { return activity ? activity.section() : { error: 'not-loaded' }; } catch (e) { return errCell(e); } })(),
  };
  body.problems = problemsOf(body);
  body.ok = !body.problems.some((x) => x.level === 'down');
  body.verdict = !body.ok ? 'down' : body.problems.length ? 'warn' : 'ok';
  return body;
}

/** The full body, held HOLD_MS for every reader. fresh=true rebuilds now. */
async function full(ctx, libDb, { fresh = false } = {}) {
  const now = Date.now();
  if (!fresh && held && now >= held.at && now - held.at < HOLD_MS) return { ...held.body, heldAt: held.at };
  if (!building) {
    building = buildBody(ctx, libDb)
      .then((body) => { held = { at: Date.now(), body }; return held; })
      .finally(() => { building = null; });
  }
  const h = await building;
  return { ...h.body, heldAt: h.at };
}

let readyHeld = null;
/** The cheap one — in-memory status + SELECT 1, held READY_HOLD_MS. */
async function ready(ctx, libDb) {
  const now = Date.now();
  if (readyHeld && now >= readyHeld.at && now - readyHeld.at < READY_HOLD_MS) return readyHeld.body;
  const rth = isRth();
  const reasons = [];
  let status = null;
  try { status = await getJson(ctx, '/proxy/status'); } catch { reasons.push('server.status-unreachable'); }
  let dbMs = null;
  if (libDb) {
    const t0 = Date.now();
    try { await withTimeout(libDb.pgQuery('SELECT 1'), 2000); dbMs = Date.now() - t0; }
    catch { reasons.push('db.down'); }
  } else reasons.push('db.layer-not-loaded');
  const lastFeed = toMs(status?.lastFeedAt);
  const feedAgeSec = lastFeed ? sec(now - lastFeed) : null;
  const spotAgeSec = Number.isFinite(status?.spotAgeMs) ? sec(status.spotAgeMs) : null;
  if (status && rth) {
    if (status.idle) reasons.push('feed.idle');
    if (!status.ttAuthenticated) reasons.push('feed.tt-auth');
    if (!status.dxlinkConnected) reasons.push('feed.dxlink');
    if (spotAgeSec == null || spotAgeSec > 90) reasons.push('feed.spot-stale');
    if (feedAgeSec != null && feedAgeSec > 90) reasons.push('feed.stale');
  }
  const body = {
    ok: reasons.length === 0,
    rth,
    reasons,
    feed: status ? { tt: Boolean(status.ttAuthenticated), dxlink: Boolean(status.dxlinkConnected), idle: Boolean(status.idle), spotAgeSec, feedAgeSec } : null,
    dbMs,
    uptimeSec: Math.round(process.uptime()),
    version: VERSION,
    ts: now,
  };
  readyHeld = { at: now, body };
  return body;
}

module.exports = { probe, full, ready, isRth, _problemsOf: problemsOf };
