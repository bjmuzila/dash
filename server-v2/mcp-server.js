'use strict';
/**
 * server-v2/mcp-server.js — CB Edge as a ChatGPT connector (remote MCP server).
 *
 * ── What it does ─────────────────────────────────────────────────────────────
 * Serves the Model Context Protocol at https://www.cbedge.net/mcp so a CB Edge
 * member can add CB Edge to an AI app and ask things like "where are the SPX
 * walls?" or "what's on the calendar today?":
 *
 *   ChatGPT  Settings → Developer mode on → Apps → create, URL
 *            https://www.cbedge.net/mcp, auth OAuth (Pro, or Business/Enterprise)
 *   Gemini   gemini.google.com → Settings → Connected Apps → Add a custom app,
 *            URL https://www.cbedge.net/mcp, Advanced settings left blank
 *            (personal Google account, US, 18+, Keep Activity on)
 *
 * Use the www URL. Cloudflare redirects cbedge.net → www.cbedge.net, the issuer
 * is www, and an app that starts on the bare domain ends up holding metadata
 * for one host and a client registered on the other ("unknown client_id").
 *
 * Either one signs the member in with their normal cbedge.net login — see
 * server-v2/mcp-oauth.js for that half.
 *
 * Every tool is READ-ONLY and is a thin adapter over data the dashboard already
 * serves. Nothing here computes a level of its own:
 *
 *   spx_gamma_levels    /proxy/gex (the live 0DTE board) + today's daily_em row
 *   spx_gex_by_strike   /proxy/gex, strike ladder around spot
 *   expected_move       daily_em rows (READ only — see note below)
 *   gex_levels_history  /api/walls-range + /proxy/walls (walls_log, scanner
 *                       series, touch events): open (09:29) and close (16:00)
 *                       call wall / put wall / CORE / flip for past sessions,
 *                       plus a multi-session summary computed here from them,
 *                       any of the Open bracket anchors (09:29 / 09:35 /
 *                       09:45 / 10:00), and /api/core-hold's own verdicts
 *   weekly_levels       /api/levels?ticker=
 *   economic_calendar   /api/calendar
 *   earnings_today      /api/earnings-today
 *
 * Reads go through ctx.internalFetch (loopback + x-internal-token), the same
 * hop every ported api-router route uses, so the numbers are byte-for-byte the
 * ones on the board.
 *
 * expected_move deliberately does NOT call /api/daily-em: that route RECORDS
 * the session's band on its first read, and a band recorded by a chat at 2pm
 * is priced off a half-decayed straddle (see the caveat in daily-em.js). The
 * board's morning read stays the one that defines the day; this only reads.
 *
 * ── Transport ────────────────────────────────────────────────────────────────
 * Streamable HTTP, stateless: every JSON-RPC request is a POST answered with a
 * single application/json body. No SSE stream (GET → 405, which the spec
 * allows) and no Mcp-Session-Id. No SDK dependency — the surface is six
 * methods, hand-rolled below, and adding a package means a new Docker layer.
 *
 * ── Auth ─────────────────────────────────────────────────────────────────────
 * Every /mcp request needs `Authorization: Bearer cbe_mcp_at_…`. Missing or bad
 * → 401 with the WWW-Authenticate challenge that starts ChatGPT's OAuth flow.
 * Each tools/call then re-checks the member's entitlement (owner / subscribed /
 * comped, 60s cache), so a cancelled membership stops answering within a minute.
 *
 * ── Kill switch ──────────────────────────────────────────────────────────────
 * MCP_CONNECTOR=0 in .env.local → none of these routes are registered and every
 * path here falls through to Next (404), exactly as before this file existed.
 * Mounted from api-router.js, so it also needs API_ROUTER=1 (already on in prod).
 *
 * Educational market analytics, not investment advice — the server
 * `instructions` say so to the model, the same line the site carries.
 */

const oauth = require('./mcp-oauth');

let libDb = null;
try { libDb = require('./_lib-db.cjs'); }
catch (e) { console.warn('[mcp] _lib-db.cjs not loaded — expected_move unavailable:', e.message); }

const PROTOCOL_VERSIONS = ['2025-11-25', '2025-06-18', '2025-03-26', '2024-11-05'];
const SERVER_INFO = { name: 'cbedge', title: 'CB Edge', version: '1.0.0' };

const INSTRUCTIONS = [
  'CB Edge is an options-analytics platform focused on SPX 0DTE dealer gamma exposure (GEX).',
  'Use spx_gamma_levels first for any question about SPX levels, walls, the gamma flip or the gamma regime;',
  'spx_gex_by_strike for the strike-by-strike ladder; expected_move and weekly_levels for EM bands and weekly zones;',
  'gex_levels_history for PAST sessions — walls, CORE and flip at the open and at the close, how they moved, touches,',
  'and for several sessions a computed summary (averages, distance from spot, how often price closed inside the opening walls) — quote it rather than averaging rows yourself;',
  'economic_calendar and earnings_today for scheduled events.',
  'All times are US/Eastern. GEX values are dealer gamma exposure as shown on the CB Edge board (calls +, puts −).',
  'Data is for educational market analysis only and is not investment advice; say so if the user asks what to trade.',
].join(' ');

const UPSTREAM_TIMEOUT_MS = 15_000;
const TOOL_CALLS_PER_MIN = 60;

// ── Helpers ─────────────────────────────────────────────────────────────────

const num = (v) => { const x = Number(v); return Number.isFinite(x) ? x : null; };
const round = (v, dp = 2) => { const x = num(v); if (x == null) return null; const f = 10 ** dp; return Math.round(x * f) / f; };

function etDate(d = new Date()) {
  const p = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(d).filter((x) => x.type !== 'literal')
    .reduce((a, x) => ({ ...a, [x.type]: x.value }), {});
  return `${p.year}-${p.month}-${p.day}`;
}

function etStamp(ms) {
  const n = num(ms);
  if (!n || n <= 0) return null;
  const s = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
  }).format(new Date(n));
  return `${s} ET`;
}

function addDays(ymd, n) {
  const d = new Date(`${ymd}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

function cleanTicker(raw, fallback) {
  const t = String(raw ?? fallback ?? '').trim().toUpperCase().replace(/^\$/, '');
  return /^[A-Z0-9./^-]{1,12}$/.test(t) ? t : null;
}

class ToolError extends Error {}

async function fetchJson(ctx, path) {
  let r;
  try {
    r = await ctx.internalFetch(path, { cache: 'no-store', signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS) });
  } catch (e) {
    throw new ToolError(`CB Edge data service did not answer (${e?.name === 'TimeoutError' ? 'timeout' : e?.message || e}).`);
  }
  if (!r.ok) throw new ToolError(`CB Edge data service returned HTTP ${r.status} for ${path.split('?')[0]}.`);
  try { return await r.json(); }
  catch { throw new ToolError(`CB Edge data service sent an unreadable response for ${path.split('?')[0]}.`); }
}

// Small TTL cache for upstreams that cost a third-party request (Yahoo,
// ForexFactory) so a chatty conversation cannot run up their rate limits.
const _cache = new Map();
async function cached(key, ttlMs, fn) {
  const hit = _cache.get(key);
  if (hit && Date.now() - hit.at < ttlMs) return hit.value;
  const value = await fn();
  _cache.set(key, { at: Date.now(), value });
  if (_cache.size > 200) for (const [k, v] of _cache) if (Date.now() - v.at >= ttlMs) _cache.delete(k);
  return value;
}

// ── Data readers ────────────────────────────────────────────────────────────

const oiNet = (r) => num(r.netGEX) ?? 0;
const volNet = (r) => num(r.netVolGEX) ?? 0;
const oiVolNet = (r) => oiNet(r) + volNet(r); // same as gex-calculator.js oiVolNet()

async function readBoard(ctx) {
  const g = await fetchJson(ctx, '/proxy/gex');
  const rows = Array.isArray(g.gexRows) ? g.gexRows.filter((r) => num(r?.strike) != null) : [];
  return { g, rows, spot: num(g.spot) };
}

/**
 * The frozen daily expected-move row (written by daily-em.js), never computed
 * here. Falls back to the most recent earlier session so a 6am question still
 * gets yesterday's band, labelled as such.
 */
async function readDailyEm(ticker, date) {
  if (!libDb) return null;
  try {
    const r = await libDb.pgQuery(
      `SELECT * FROM daily_em WHERE ticker = $1 AND session_date <= $2
        ORDER BY session_date DESC LIMIT 1`,
      [ticker, date],
    );
    const row = r.rows?.[0];
    if (!row) return null;
    return {
      sessionDate: row.session_date,
      referenceClose: round(row.ref_close),
      expectedMove: round(row.em),
      upper: round(row.up),
      lower: round(row.down),
      expiry: row.expiry ?? null,
      method: row.method ?? null,
      recordedAt: etStamp(row.recorded_at),
    };
  } catch (e) {
    // No table yet (daily-em never ran on this box) reads as "not recorded".
    if (!/does not exist/i.test(e?.message || '')) console.warn('[mcp] daily_em read failed:', e.message);
    return null;
  }
}

// ── Historical levels ───────────────────────────────────────────────────────
// Read through the dashboard's own history routes, the ones the Walls and Level
// Log pages draw from — nothing is recomputed here:
//   /api/walls-range   walls_log: call wall / put wall / CORE, the 09:29 open
//                      baseline plus every change on the 15-minute grid, and
//                      the session's sampled spot path
//   /proxy/walls?…&series=1   scanner_snapshots: the full board sample (flip,
//                      net GEX, GEX at each level) every 1–5 minutes
//   /proxy/walls?date=&symbol=   that day's touch events and how they resolved

const HIST_LEVELS = { call_wall: 'callWall', put_wall: 'putWall', cb: 'core' };
const OPEN_BASELINE_MINS = 9 * 60 + 29; // walls-recorder slot 0, captured before the bell
const BELL_MINS = 9 * 60 + 30;
const CLOSE_MINS = 16 * 60;
const HIST_SCOPES = { nearest: '0dte', all_other: 'agg' };
// WHEN THE OPENING LEVELS ARE TAKEN — the same four anchors as owner.cbedge.net
// → Results → Open bracket (server-v2/core-hold.js ANCHORS). 09:29 is the
// recorder's own pre-bell capture; a later anchor is the first sweep at or after
// that clock time, within ANCHOR_GRACE_MINS, exactly as core-hold takes it.
const HIST_ANCHORS = {
  open: { key: 'open', label: '09:29', mins: 9 * 60 + 29 },
  '09:35': { key: '0935', label: '09:35', mins: 9 * 60 + 35 },
  '09:45': { key: '0945', label: '09:45', mins: 9 * 60 + 45 },
  '10:00': { key: '1000', label: '10:00', mins: 10 * 60 },
};
const ANCHOR_GRACE_MINS = 10;
const CORE_POS_TEXT = {
  cw: 'the CORE is the call wall',
  pw: 'the CORE is the put wall',
  interior: 'the CORE sits between the walls',
  outside: 'the CORE sits outside the walls',
};
const pctOf = (r) => (r == null ? null : round(r * 100, 1));
const MAX_SESSIONS = 60;
// Past this many sessions each row comes back compact (levels + spot only) —
// the summary carries the read, and 60 full rows would bury it.
const FULL_ROWS_MAX = 10;
const SERIES_CONCURRENCY = 6;
const MAX_MOVES = 40;

const REACTION_TEXT = {
  reject: 'rejected — price tagged it and turned back',
  break_lt5: 'broke through, by under 5 points',
  break_5: 'broke through, by 5+ points',
  consolidated: 'broke through and held beyond it',
  new_wall: 'the wall itself moved to a new strike after the touch',
  pin: 'pinned — price sat on the level',
  rolled_over: 'approached without touching, then reversed away',
};

const _etHm = new Intl.DateTimeFormat('en-US', {
  timeZone: 'America/New_York', hour12: false, hour: '2-digit', minute: '2-digit',
});
/** ET minutes since midnight for a timestamp, or null. */
function etMins(ts) {
  const d = new Date(ts);
  if (Number.isNaN(d.getTime())) return null;
  const parts = _etHm.formatToParts(d);
  const h = Number(parts.find((x) => x.type === 'hour')?.value);
  const m = Number(parts.find((x) => x.type === 'minute')?.value);
  return Number.isFinite(h) && Number.isFinite(m) ? (h % 24) * 60 + m : null;
}
const hhmm = (mins) => (mins == null ? null
  : `${String(Math.floor(mins / 60)).padStart(2, '0')}:${String(mins % 60).padStart(2, '0')}`);

/** A past session never changes again; today's is still being written. */
const histTtl = (date) => (date < etDate() ? 30 * 60_000 : 60_000);

/** Like round(), but a NULL column stays null instead of becoming 0. */
const nn = (v, dp = 2) => (v == null || v === '' ? null : round(v, dp));

/** One full board sample (scanner_snapshots / scanner_variants row). */
function boardSample(row) {
  if (!row) return null;
  return {
    time: hhmm(etMins(row.ts)),
    spot: nn(row.spot),
    callWall: nn(row.call_wall),
    putWall: nn(row.put_wall),
    core: nn(row.cb),
    gammaFlip: nn(row.gex_flip),
    totalNetGex: nn(row.total_net_gex, 0),
    // Recorded from late August 2026 on; null on older sessions.
    callWallGex: nn(row.call_wall_gex, 0),
    putWallGex: nn(row.put_wall_gex, 0),
    coreGex: nn(row.cb_gex, 0),
    expiry: row.expiry || null,
  };
}

/** Where a price sat against a put-wall / call-wall bracket. */
function sideOf(px, put, call) {
  if (px == null || put == null || call == null) return null;
  const lo = Math.min(put, call);
  const hi = Math.max(put, call);
  if (px > hi) return 'above the call wall';
  if (px < lo) return 'below the put wall';
  return 'inside the walls';
}

/**
 * One session: the levels at the open and at the close, how they moved in
 * between, and (optionally) what price did at them.
 */
async function buildSession(ctx, ticker, day, scope, opts) {
  const { at, withMoves, withTouches, compact, anchor, bracket } = opts;
  const atOpen = anchor.key === 'open';
  const log = Array.isArray(day.log) ? day.log : [];
  const open = {};
  const close = {};
  let openSpot = null;
  for (const r of log) {
    const name = HIST_LEVELS[r.level_type];
    if (!name) continue;
    if (Number(r.slot) === 0) {
      open[name] = nn(r.strike);
      if (openSpot == null) openSpot = nn(r.spot);
    }
    close[name] = nn(r.strike); // ordered by slot, so the last write is the 16:00 state
  }

  // The fuller board sample (flip, net GEX) sits in the scanner series.
  let series = [];
  try {
    const s = await cached(`hist:series:${ticker}:${day.date}:${scope}`, histTtl(day.date),
      () => fetchJson(ctx, `/proxy/walls?date=${day.date}&symbol=${encodeURIComponent(ticker)}&series=1&scope=${scope}&basis=oivol`));
    series = Array.isArray(s?.series) ? s.series : [];
  } catch { /* walls alone still answer the question */ }
  const timed = series.map((r) => ({ r, m: etMins(r.ts) })).filter((x) => x.m != null);
  const lastAtOrBefore = (mins) => {
    let hit = null;
    for (const x of timed) if (x.m <= mins) hit = x.r;
    return hit;
  };
  // The open: the last sample at or before 09:29. A later anchor: the FIRST
  // sample at or after its clock time, inside the grace window — core-hold's rule.
  const firstWithin = (from, to) => timed.find((x) => x.m >= from && x.m <= to)?.r || null;
  const openRow = atOpen
    ? (lastAtOrBefore(OPEN_BASELINE_MINS) || timed[0]?.r || null)
    : firstWithin(anchor.mins, anchor.mins + ANCHOR_GRACE_MINS);
  const closeRow = lastAtOrBefore(CLOSE_MINS) || timed[timed.length - 1]?.r || null;

  const today = etDate();
  const nowMins = etMins(Date.now());
  const inProgress = day.date === today && nowMins != null && nowMins < CLOSE_MINS;

  // Price path: the sampled spot the Level Log draws, inside the session.
  const path = (Array.isArray(day.spot) ? day.spot : [])
    .filter((p) => Array.isArray(p) && p[0] >= BELL_MINS && p[0] <= CLOSE_MINS && nn(p[1]) != null);
  const firstPx = path.length ? num(path[0][1]) : null;
  // The close the Open bracket page scores against: the true daily close where
  // the daily-bar backfill has it, else the last sweep sample.
  const lastPx = !inProgress && nn(bracket?.close) != null ? nn(bracket.close)
    : (path.length ? num(path[path.length - 1][1]) : null);
  const closeSource = !inProgress && nn(bracket?.close) != null ? (bracket.close_src === 'daily' ? 'daily bar' : 'sweep sample')
    : (path.length ? 'sweep sample' : null);
  const pxs = path.map((p) => Number(p[1]));

  // Walls at the anchor: the Open bracket page's own reading first, then the
  // 09:29 log (open anchor only), then the sweep sample.
  const pick = (...v) => v.find((x) => x != null) ?? null;
  const openSnap = {
    ...(boardSample(openRow) || {}),
    time: anchor.label,
    callWall: pick(nn(bracket?.call_wall), atOpen ? open.callWall : null, nn(openRow?.call_wall)),
    putWall: pick(nn(bracket?.put_wall), atOpen ? open.putWall : null, nn(openRow?.put_wall)),
    core: pick(nn(bracket?.core), atOpen ? open.core : null, nn(openRow?.cb)),
    spot: pick(nn(bracket?.spot), atOpen ? openSpot : null, nn(openRow?.spot)),
  };
  const closeSnap = {
    ...(boardSample(closeRow) || {}),
    callWall: close.callWall ?? nn(closeRow?.call_wall),
    putWall: close.putWall ?? nn(closeRow?.put_wall),
    core: close.core ?? nn(closeRow?.cb),
  };
  if (!inProgress) closeSnap.time = '16:00';

  const diff = (a, b) => (a == null || b == null ? null : round(b - a));
  const out = {
    date: day.date,
    sessionComplete: !inProgress,
  };
  const slim = (snap) => (compact
    ? { time: snap.time, spot: snap.spot, callWall: snap.callWall, putWall: snap.putWall, core: snap.core, gammaFlip: snap.gammaFlip ?? null }
    : snap);
  if (at !== 'close') out.open = slim(openSnap);
  if (at !== 'open') out[inProgress ? 'latest' : 'close'] = slim(closeSnap);
  if (at === 'both') {
    out.openToClose = {
      callWall: diff(openSnap.callWall, closeSnap.callWall),
      putWall: diff(openSnap.putWall, closeSnap.putWall),
      core: diff(openSnap.core, closeSnap.core),
      gammaFlip: diff(openSnap.gammaFlip, closeSnap.gammaFlip),
    };
  }
  const high = pxs.length ? round(Math.max(...pxs)) : null;
  const low = pxs.length ? round(Math.min(...pxs)) : null;
  const closeSide = sideOf(lastPx, openSnap.putWall, openSnap.callWall);
  out.price = compact
    ? { [inProgress ? 'last' : 'close']: round(lastPx), high, low, closeVsOpeningWalls: closeSide }
    : {
      firstPrint: round(firstPx),
      [inProgress ? 'last' : 'close']: round(lastPx),
      closeSource,
      high,
      low,
      closeVsOpeningWalls: closeSide,
      samples: pxs.length,
    };
  // The Open bracket page's verdict on this session, field for field.
  if (bracket) {
    out.openBracket = compact
      ? { status: bracket.status, insideAtClose: bracket.inside ?? null, neverLeft: bracket.never_left ?? null }
      : {
        anchor: anchor.label,
        status: bracket.status,
        insideAtClose: bracket.inside ?? null,
        neverLeft: bracket.never_left ?? null,
        widthPctOfSpot: nn(bracket.width_pct),
        corePosition: CORE_POS_TEXT[bracket.core_pos] || null,
        closeVsCore: bracket.core_side || null,
        wallRollsAfterAnchor: nn(bracket.rolled, 0),
      };
  }

  const moves = log.filter((r) => Number(r.slot) > 0 && r.reason === 'change' && HIST_LEVELS[r.level_type]);
  out.wallMoves = moves.length;
  // Everything the multi-session summary needs, whatever `at` trimmed above.
  const raw = {
    date: day.date, inProgress, open: openSnap, close: closeSnap,
    closeSpot: round(lastPx), high, low, closeSide, wallMoves: moves.length,
  };
  if (withMoves) {
    out.moves = moves.slice(0, MAX_MOVES).map((r) => ({
      at: r.at || null,
      level: HIST_LEVELS[r.level_type],
      from: nn(r.prev_strike),
      to: nn(r.strike),
      spot: nn(r.spot),
    }));
    if (moves.length > MAX_MOVES) out.movesTruncated = moves.length - MAX_MOVES;
  }

  if (withTouches) {
    try {
      const d = await cached(`hist:events:${ticker}:${day.date}:${scope}`, histTtl(day.date),
        () => fetchJson(ctx, `/proxy/walls?date=${day.date}&symbol=${encodeURIComponent(ticker)}&scope=${scope}&basis=oivol`));
      const evs = (Array.isArray(d?.events) ? d.events : [])
        .filter((e) => e.kind === 'touch' || e.reaction === 'rolled_over');
      out.touches = evs.slice(0, MAX_MOVES).map((e) => ({
        at: e.at || null,
        level: HIST_LEVELS[e.level_type] || e.level_type,
        strike: nn(e.strike),
        kind: e.kind || 'touch',
        reaction: e.reaction || 'unresolved',
        meaning: REACTION_TEXT[e.reaction] || (e.reaction ? e.reaction : 'still being scored'),
        note: e.note || null,
        attemptsAtThisLevel: nn(e.attempts, 0),
      }));
    } catch { out.touches = null; }
  }
  return { out, raw };
}

/** Promise.all with at most `limit` in flight, results in input order. */
async function mapLimit(items, limit, fn) {
  const out = new Array(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i], i); // eslint-disable-line no-await-in-loop
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return out;
}

/** avg / median / min / max over the non-null values, or null if there are none. */
function stats(values, dp = 2) {
  const v = values.filter((x) => x != null && Number.isFinite(x)).sort((a, b) => a - b);
  if (!v.length) return null;
  const mid = Math.floor(v.length / 2);
  return {
    avg: round(v.reduce((a, b) => a + b, 0) / v.length, dp),
    median: round(v.length % 2 ? v[mid] : (v[mid - 1] + v[mid]) / 2, dp),
    min: round(v[0], dp),
    max: round(v[v.length - 1], dp),
    n: v.length,
  };
}

const HIST_FIELDS = ['callWall', 'putWall', 'core', 'gammaFlip'];

/** The levels at one end of the session, across sessions: where they sat, and
 *  where they sat RELATIVE TO SPOT — the comparable number when price drifts. */
function endStats(snaps, spotOf) {
  const level = {};
  const fromSpot = {};
  for (const f of HIST_FIELDS) {
    level[f] = stats(snaps.map((s) => s.snap[f]));
    fromSpot[f] = stats(snaps.map((s) => {
      const px = spotOf(s);
      return s.snap[f] == null || px == null ? null : s.snap[f] - px;
    }));
  }
  const count = (pred) => snaps.filter(pred).length;
  const withFlip = snaps.filter((s) => s.snap.gammaFlip != null && spotOf(s) != null);
  return {
    sessions: snaps.length,
    spot: stats(snaps.map(spotOf)),
    levels: level,
    pointsFromSpot: fromSpot,
    wallWidth: stats(snaps.map((s) => (s.snap.callWall == null || s.snap.putWall == null ? null : s.snap.callWall - s.snap.putWall))),
    spotAboveFlip: withFlip.length ? { sessions: count((s) => withFlip.includes(s) && spotOf(s) > s.snap.gammaFlip), of: withFlip.length } : null,
    coreAboveSpot: { sessions: count((s) => s.snap.core != null && spotOf(s) != null && s.snap.core > spotOf(s)), of: count((s) => s.snap.core != null && spotOf(s) != null) },
  };
}

/** The multi-session read: averages, distances from spot, open→close drift, and
 *  how the close sat against the opening walls. Computed here, not by the model. */
function summarize(raws, at, page, anchor) {
  const done = raws.filter((r) => !r.inProgress);
  const out = {
    sessions: raws.length,
    from: raws[raws.length - 1]?.date ?? null,
    to: raws[0]?.date ?? null,
  };
  if (at !== 'close') out.open = endStats(raws.map((r) => ({ snap: r.open })), (s) => s.snap.spot ?? null);
  if (at !== 'open') {
    out.close = endStats(done.map((r) => ({ snap: r.close, px: r.closeSpot ?? r.close.spot })), (s) => s.px ?? null);
  }
  if (at === 'both') {
    const drift = {};
    for (const f of HIST_FIELDS) {
      const d = done.map((r) => (r.open[f] == null || r.close[f] == null ? null : r.close[f] - r.open[f])).filter((x) => x != null);
      drift[f] = d.length ? {
        avgChange: round(d.reduce((a, b) => a + b, 0) / d.length),
        avgAbsChange: round(d.reduce((a, b) => a + Math.abs(b), 0) / d.length),
        rose: d.filter((x) => x > 0).length,
        fell: d.filter((x) => x < 0).length,
        unchanged: d.filter((x) => x === 0).length,
      } : null;
    }
    out.openToClose = drift;
    const sides = done.map((r) => r.closeSide).filter(Boolean);
    const inside = sides.filter((x) => x === 'inside the walls').length;
    // When the Open bracket page's own numbers are here (below), they ARE the
    // containment answer — a second, differently-counted one would only conflict.
    if (!page) out.closeVsOpeningWalls = sides.length ? {
      inside,
      aboveCallWall: sides.filter((x) => x === 'above the call wall').length,
      belowPutWall: sides.filter((x) => x === 'below the put wall').length,
      insidePct: round((inside / sides.length) * 100, 1),
      of: sides.length,
    } : null;
    out.sessionRange = stats(done.map((r) => (r.high == null || r.low == null ? null : r.high - r.low)));
  }
  if (page && at !== 'open') {
    // owner.cbedge.net → Results → Open bracket, this ticker's row, same window
    // and anchor — the page's arithmetic (server-v2/core-hold.js), not a re-count.
    out.openBracket = {
      anchor: anchor.label,
      sessions: page.sessions,
      scored: page.scored,
      closedInside: page.inside,
      insidePct: pctOf(page.inside_rate),
      neverLeftPct: pctOf(page.never_left_rate),
      neverLeftOf: page.path_sessions,
      closedAboveCorePct: pctOf(page.above_core_rate),
      coreBetweenWallsPct: pctOf(page.core_interior_rate),
      medianWidthPctOfSpot: nn(page.width_pct),
      openedOutside: page.opened_outside,
      wallsRolledPct: pctOf(page.rolled_rate),
      closesFromSweepNotDailyBar: page.scanner_closes,
      readFirst: 'Read medianWidthPctOfSpot before insidePct: a wide bracket that contains the close says little.',
    };
  }
  out.wallMovesPerSession = stats(raws.map((r) => r.wallMoves), 1);
  if (raws.length !== done.length) out.note = 'Today is still trading: it counts toward the open figures only.';
  return out;
}

// ── Tools ───────────────────────────────────────────────────────────────────

const READ_ONLY = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false };
const SECURITY = [{ type: 'oauth2', scopes: [oauth.SCOPE] }];

const TOOLS = [
  {
    name: 'spx_gamma_levels',
    title: 'SPX gamma levels (live)',
    description:
      'Live SPX 0DTE dealer gamma levels from the CB Edge board: spot, call wall, put wall, gamma flip, '
      + 'net GEX, gamma regime, the biggest positive/negative GEX strikes near spot, and today\'s daily '
      + 'expected-move band. Use this for any question about SPX levels, walls, the flip, or whether '
      + 'dealers are long or short gamma.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    async run(ctx) {
      const { g, rows, spot } = await readBoard(ctx);
      const em = await readDailyEm('SPX', etDate());
      if (!rows.length || !(spot > 0)) {
        return {
          available: false,
          note: 'The live SPX board has not published yet (feed warming up, or the market is closed and the board has not loaded).',
          spot: round(spot),
          dailyExpectedMove: em,
        };
      }
      const netOiVol = num(g.totalNetGex) ?? rows.reduce((s, r) => s + oiVolNet(r), 0);
      const netOi = rows.reduce((s, r) => s + oiNet(r), 0);
      const flip = num(g.gexFlip);
      const callWall = num(g.callWall);
      const putWall = num(g.putWall);
      const regime = flip != null ? (spot >= flip ? 'positive' : 'negative') : (netOiVol >= 0 ? 'positive' : 'negative');
      const near = rows.filter((r) => Math.abs(num(r.strike) - spot) <= spot * 0.03);
      const pick = (sign) => near
        .filter((r) => Math.sign(oiVolNet(r)) === sign)
        .sort((a, b) => Math.abs(oiVolNet(b)) - Math.abs(oiVolNet(a)))
        .slice(0, 5)
        .map((r) => ({ strike: num(r.strike), netGexMillions: round(oiVolNet(r) / 1e6, 1) }));
      const prev = num(g.prevClose);
      return {
        available: true,
        symbol: g.symbol || 'SPX',
        expiry: g.expiry ?? null,
        spot: round(spot),
        prevClose: round(prev),
        change: prev ? round(spot - prev) : null,
        changePct: prev ? round(((spot - prev) / prev) * 100) : null,
        callWall,
        putWall,
        gammaFlip: round(flip),
        distanceFromSpot: {
          callWall: callWall != null ? round(callWall - spot) : null,
          putWall: putWall != null ? round(putWall - spot) : null,
          gammaFlip: flip != null ? round(flip - spot) : null,
        },
        gammaRegime: regime,
        regimeNote: regime === 'positive'
          ? 'Positive gamma: dealer hedging tends to dampen moves (more mean-reverting, pinning toward big strikes).'
          : 'Negative gamma: dealer hedging tends to amplify moves (wider ranges, faster trends).',
        netGexBillions: { openInterestPlusVolume: round(netOiVol / 1e9, 3), openInterestOnly: round(netOi / 1e9, 3) },
        largestPositiveStrikes: pick(1),
        largestNegativeStrikes: pick(-1),
        dailyExpectedMove: em,
        updatedAt: etStamp(g.updatedAt),
        dataAgeSeconds: num(g.updatedAt) ? Math.max(0, Math.round((Date.now() - num(g.updatedAt)) / 1000)) : null,
      };
    },
  },
  {
    name: 'spx_gex_by_strike',
    title: 'SPX GEX by strike',
    description:
      'The live SPX 0DTE gamma-exposure ladder strike by strike around spot, with call/put open interest '
      + 'and volume. Use for "what does GEX look like between 6800 and 6900" or "how big is the 6850 strike".',
    inputSchema: {
      type: 'object',
      properties: {
        range_points: { type: 'number', minimum: 5, maximum: 400, default: 50, description: 'Strikes within ± this many SPX points of spot.' },
        basis: {
          type: 'string', enum: ['oi_volume', 'open_interest', 'volume'], default: 'oi_volume',
          description: 'Which GEX to rank by: open interest + today\'s volume (the board default), open interest only, or volume only.',
        },
      },
      additionalProperties: false,
    },
    async run(ctx, args) {
      const range = Math.min(400, Math.max(5, num(args.range_points) ?? 50));
      const basis = ['oi_volume', 'open_interest', 'volume'].includes(args.basis) ? args.basis : 'oi_volume';
      const pickNet = basis === 'open_interest' ? oiNet : basis === 'volume' ? volNet : oiVolNet;
      const { g, rows, spot } = await readBoard(ctx);
      if (!rows.length || !(spot > 0)) {
        return { available: false, note: 'The live SPX board has not published yet.' };
      }
      const callWall = num(g.callWall);
      const putWall = num(g.putWall);
      const flip = num(g.gexFlip);
      const ladder = rows
        .filter((r) => Math.abs(num(r.strike) - spot) <= range)
        .slice(0, 160)
        .map((r) => {
          const k = num(r.strike);
          const tags = [];
          if (k === callWall) tags.push('call_wall');
          if (k === putWall) tags.push('put_wall');
          return {
            strike: k,
            netGexMillions: round(pickNet(r) / 1e6, 2),
            callOI: num(r.callOI),
            putOI: num(r.putOI),
            callVolume: num(r.callVolume),
            putVolume: num(r.putVolume),
            ...(tags.length ? { tags } : {}),
          };
        });
      return {
        available: true,
        symbol: g.symbol || 'SPX',
        expiry: g.expiry ?? null,
        spot: round(spot),
        basis,
        rangePoints: range,
        callWall,
        putWall,
        gammaFlip: round(flip),
        strikes: ladder,
        updatedAt: etStamp(g.updatedAt),
      };
    },
  },
  {
    name: 'expected_move',
    title: 'Daily expected move',
    description:
      'The CB Edge daily expected-move band for a ticker: previous close ± the front-expiry ATM straddle, '
      + 'recorded once each morning and frozen for the session. Defaults to SPX.',
    inputSchema: {
      type: 'object',
      properties: {
        ticker: { type: 'string', default: 'SPX', description: 'Ticker symbol, e.g. SPX, SPY, QQQ.' },
        date: { type: 'string', pattern: '^\\d{4}-\\d{2}-\\d{2}$', description: 'Session date (YYYY-MM-DD, ET). Defaults to today.' },
      },
      additionalProperties: false,
    },
    async run(ctx, args) {
      const ticker = cleanTicker(args.ticker, 'SPX');
      if (!ticker) throw new ToolError('That ticker does not look valid.');
      const today = etDate();
      const date = /^\d{4}-\d{2}-\d{2}$/.test(String(args.date || '')) ? args.date : today;
      const band = await readDailyEm(ticker, date);
      if (!band) {
        return { ticker, date, available: false, note: `No daily expected move has been recorded for ${ticker} on or before ${date}.` };
      }
      return {
        ticker,
        requestedDate: date,
        available: true,
        isRequestedSession: band.sessionDate === date,
        ...band,
        note: band.sessionDate === date
          ? 'Previous close ± the front-expiry ATM straddle, frozen at the first read of the session.'
          : `Nothing recorded for ${date} yet; this is the most recent earlier session (${band.sessionDate}).`,
      };
    },
  },
  {
    name: 'gex_levels_history',
    title: 'Historical GEX levels (open & close)',
    description:
      'Past sessions\' gamma levels for SPX or any ticker in the CB Edge scanner (~170 names): call wall, '
      + 'put wall, CORE (the strike with the largest absolute net GEX) and gamma flip AT THE OPEN (09:29 ET, '
      + 'captured just before the bell) and AT THE CLOSE (16:00 ET), with spot, the session high/low, '
      + 'where the close landed against the opening walls, how the walls moved during the day, and — for a '
      + 'single session — every touch of a level and whether it rejected or broke. Over several sessions (up to '
      + `${MAX_SESSIONS}) it also returns a computed SUMMARY: average / median / min / max of each opening and `
      + 'closing level, how far each sat from spot on average (the comparable number when price drifts), the '
      + 'average open→close change, how often the close finished inside / above / below the opening walls, '
      + 'how often spot opened above the flip, and wall moves per session — plus, in summary.openBracket, the '
      + 'owner Open bracket page\'s own figures (close inside the opening walls %, never-left %, median bracket '
      + 'width). The opening levels can be taken at 09:29 (default) or at 09:35, 09:45 or 10:00 via `anchor`. '
      + 'Quote the summary\'s numbers rather than averaging the rows yourself. '
      + 'Use for "where were the SPX walls at the open on Sept 12?", "average 9:45 levels this week", '
      + '"average opening levels over the last 5 days", "how often did SPX close inside the opening walls this '
      + 'month?". For TODAY\'s live levels use spx_gamma_levels instead.',
    inputSchema: {
      type: 'object',
      properties: {
        ticker: { type: 'string', default: 'SPX', description: 'Ticker symbol, e.g. SPX, SPY, QQQ, NVDA.' },
        date: {
          type: 'string', pattern: '^\\d{4}-\\d{2}-\\d{2}$',
          description: 'Session date (YYYY-MM-DD, ET). With sessions > 1 this is the LAST session of the run. '
            + 'Defaults to the most recent session. A weekend or holiday returns the session before it.',
        },
        sessions: {
          type: 'integer', minimum: 1, maximum: MAX_SESSIONS, default: 1,
          description: `How many recorded sessions, ending at date (1–${MAX_SESSIONS}; about 21 is a month). `
            + `Over ${FULL_ROWS_MAX} the per-session rows come back compact.`,
        },
        at: {
          type: 'string', enum: ['open', 'close', 'both'], default: 'both',
          description: 'Opening levels, closing levels, or both (with the open→close change).',
        },
        anchor: {
          type: 'string', enum: ['open', '09:35', '09:45', '10:00'], default: 'open',
          description: 'WHEN the opening levels are taken: open = 09:29 ET, before the bell (default); or the first '
            + 'reading at/after 09:35, 09:45 or 10:00. The same anchors as the Open bracket page. A later anchor '
            + 'has full history for SPX, SPY, QQQ, NDX, VIX and the big tech names, about 10 sessions for the rest.',
        },
        scope: {
          type: 'string', enum: ['nearest', 'all_other'], default: 'nearest',
          description: 'nearest = the nearest expiry (0DTE for SPX; the board default). '
            + 'all_other = every other listed expiry summed, the structural levels behind the day\'s.',
        },
        include_moves: {
          type: 'boolean',
          description: 'List each wall move (time, from → to). Default: on for one session, off for several.',
        },
        summary_only: {
          type: 'boolean',
          description: 'Return just the multi-session summary, without the per-session rows. Default false.',
        },
      },
      additionalProperties: false,
    },
    async run(ctx, args) {
      const ticker = cleanTicker(args.ticker, 'SPX');
      if (!ticker) throw new ToolError('That ticker does not look valid.');
      const today = etDate();
      const date = /^\d{4}-\d{2}-\d{2}$/.test(String(args.date || '')) ? args.date : today;
      if (date > today) throw new ToolError(`${date} has not happened yet — history runs up to today (${today}).`);
      const sessions = Math.max(1, Math.min(MAX_SESSIONS, Math.floor(num(args.sessions) || 1)));
      const at = ['open', 'close', 'both'].includes(args.at) ? args.at : 'both';
      const scopeName = args.scope === 'all_other' ? 'all_other' : 'nearest';
      const scope = HIST_SCOPES[scopeName];
      const anchorIn = String(args.anchor || 'open').replace(/^(\d{2})(\d{2})$/, '$1:$2');
      const anchor = HIST_ANCHORS[anchorIn] || HIST_ANCHORS.open;
      const compact = sessions > FULL_ROWS_MAX;
      const withMoves = !compact && (typeof args.include_moves === 'boolean' ? args.include_moves : sessions === 1);
      const summaryOnly = args.summary_only === true;

      const range = await cached(`hist:range:${ticker}:${date}:${sessions}:${scope}`, histTtl(date),
        () => fetchJson(ctx, `/api/walls-range?symbol=${encodeURIComponent(ticker)}&days=${sessions}&end=${date}&scope=${scope}&basis=oivol`));
      // walls-range falls back to SPX for a symbol it cannot parse — never pass that off as the ticker asked for.
      const days = range?.symbol === ticker && Array.isArray(range?.days) ? range.days : [];
      if (!days.length) {
        return {
          ticker, requestedDate: date, available: false,
          note: `CB Edge has no recorded levels for ${ticker} on or before ${date}. `
            + 'History covers the scanner universe (SPX, SPY, QQQ, NDX and ~165 stocks/ETFs) from when each was added.',
        };
      }
      const ordered = [...days].sort((a, b) => (a.date < b.date ? 1 : -1)); // newest first

      // The Open bracket page's study for this ticker, same window, scope and
      // anchor — its per-session verdicts and its row. Optional: without it the
      // levels still come from walls_log and the sweep series.
      let page = null;
      const brackets = new Map();
      try {
        const ch = await cached(`hist:bracket:${ticker}:${date}:${sessions}:${scope}:${anchor.key}`, histTtl(date),
          () => fetchJson(ctx, `/api/core-hold?symbols=${encodeURIComponent(ticker)}&days=${sessions}&end=${date}`
            + `&anchor=${anchor.key}&scope=${scope}&basis=oivol&detail=1`));
        if (ch?.ok) {
          page = (Array.isArray(ch.rows) ? ch.rows : []).find((r) => r.symbol === ticker) || null;
          for (const d of Array.isArray(ch.detail) ? ch.detail : []) if (d.symbol === ticker) brackets.set(d.date, d);
        }
      } catch { /* degrade to the walls log + series */ }

      const built = await mapLimit(ordered, SERIES_CONCURRENCY, (day) => buildSession(ctx, ticker, day, scope, {
        at, withMoves, withTouches: sessions === 1, compact, anchor, bracket: brackets.get(day.date) || null,
      }));
      const newest = ordered[0].date;
      const multi = built.length > 1;
      return {
        ticker,
        scope: scopeName === 'nearest' ? 'nearest expiry (0DTE for SPX)' : 'all other expiries summed',
        basis: 'net GEX on open interest + that session\'s volume (calls +, puts −)',
        requestedDate: date,
        available: true,
        isRequestedSession: newest === date,
        sessionsRequested: sessions,
        sessionsFound: built.length,
        anchor: anchor.label,
        ...(multi ? { summary: summarize(built.map((b) => b.raw), at, page, anchor) } : {}),
        ...(summaryOnly && multi ? {} : { sessions: built.map((b) => b.out) }),
        notes: [
          newest === date ? null : `No recorded session on ${date} (weekend, holiday, or not recorded); the most recent earlier session is ${newest}.`,
          built.length < sessions ? `Only ${built.length} recorded session${built.length === 1 ? '' : 's'} on or before ${date} for ${ticker}.` : null,
          multi ? 'summary.*.pointsFromSpot = level minus spot at that moment (positive = above price), averaged across sessions.' : null,
          anchor.key === 'open'
            ? 'Open = the levels captured at 09:29 ET, before the bell (open interest settled overnight, no volume yet). '
              + 'Close = the levels standing at 16:00 ET. Times are ET.'
            : `"open" here = the first reading at or after ${anchor.label} ET (within ${ANCHOR_GRACE_MINS} min), as the Open bracket page takes it. `
              + 'Close = the levels standing at 16:00 ET. Times are ET.',
          page ? 'openBracket fields are the owner Open bracket page\'s own numbers for this ticker, window and anchor.' : null,
          'High/low and prices come from the 1–5 minute samples the levels were taken from, not tick data.',
        ].filter(Boolean),
      };
    },
  },
  {
    name: 'weekly_levels',
    title: 'Weekly levels',
    description:
      'CB Edge weekly levels for a ticker: the weekly expected-move band (close ± EM for the week\'s '
      + 'expiration) plus the weekly zones (buy zone near/far, sell zone near/far, pivot) from weekly candles. '
      + 'Covers SPX, the index ETFs, ES/NQ futures and the CB Edge watchlist.',
    inputSchema: {
      type: 'object',
      properties: { ticker: { type: 'string', description: 'Ticker symbol, e.g. SPX, QQQ, NVDA, ES.' } },
      required: ['ticker'],
      additionalProperties: false,
    },
    async run(ctx, args) {
      const ticker = cleanTicker(args.ticker);
      if (!ticker) throw new ToolError('Give a ticker symbol, e.g. SPX or NVDA.');
      const row = await fetchJson(ctx, `/api/levels?ticker=${encodeURIComponent(ticker)}`);
      if (!row || typeof row !== 'object' || row.error) {
        return { ticker, available: false, note: `CB Edge has no weekly levels for ${ticker}.` };
      }
      return {
        ticker: row.ticker || ticker,
        available: true,
        label: row.label ?? null,
        weekExpiration: row.exp_label ?? null,
        close: num(row.close),
        expectedMove: num(row.em),
        upper: num(row.up),
        lower: num(row.down),
        buyZoneNear: num(row.buy_near),
        buyZoneFar: num(row.buy_far),
        sellZoneNear: num(row.sell_near),
        sellZoneFar: num(row.sell_far),
        pivot: num(row.pivot),
        updatedAt: row.updated_at ?? null,
        expectedMoveUpdatedAt: row.em_updated_at ?? null,
      };
    },
  },
  {
    name: 'economic_calendar',
    title: 'Economic calendar',
    description:
      'Scheduled economic releases (CPI, FOMC, jobs, etc.) from the CB Edge calendar, in US/Eastern time, '
      + 'with forecast / previous / actual. Use for "what\'s on the calendar today/this week".',
    inputSchema: {
      type: 'object',
      properties: {
        days: { type: 'integer', minimum: 1, maximum: 7, default: 1, description: 'How many days ahead, starting today (1 = today only).' },
        impact: {
          type: 'string', enum: ['high', 'medium', 'all'], default: 'high',
          description: 'high = high-impact only; medium = medium and high; all = everything incl. low impact and presidential schedule.',
        },
        country: { type: 'string', default: 'USD', description: 'Currency/country code (USD, EUR, GBP, JPY…) or "all".' },
      },
      additionalProperties: false,
    },
    async run(ctx, args) {
      const days = Math.min(7, Math.max(1, Math.round(num(args.days) ?? 1)));
      const impact = ['high', 'medium', 'all'].includes(args.impact) ? args.impact : 'high';
      const country = String(args.country || 'USD').trim().toUpperCase();
      const data = await cached('calendar', 5 * 60_000, () => fetchJson(ctx, '/api/calendar'));
      const from = etDate();
      const to = addDays(from, days - 1);
      const allowImpact = impact === 'all' ? null
        : impact === 'medium' ? new Set(['high', 'medium']) : new Set(['high']);
      const events = (Array.isArray(data?.events) ? data.events : [])
        .filter((e) => e && e.date >= from && e.date <= to)
        .filter((e) => {
          const imp = String(e.impact || '').toLowerCase();
          if (imp === 'president') return impact === 'all';
          return !allowImpact || allowImpact.has(imp);
        })
        .filter((e) => {
          if (country === 'ALL') return true;
          const c = String(e.country || '').toUpperCase();
          return c === country || (country === 'USD' && c === 'US') || (country === 'US' && c === 'USD');
        })
        .slice(0, 150)
        .map((e) => ({
          date: e.date,
          time: e.time_formatted || e.time || null,
          title: e.title,
          country: e.country,
          impact: e.impact,
          forecast: e.forecast || null,
          previous: e.previous || null,
          actual: e.actual || null,
        }));
      return {
        from, to, impact, country,
        count: events.length,
        events,
        ...(data?.warning ? { warning: data.warning } : {}),
      };
    },
  },
  {
    name: 'earnings_today',
    title: "Today's earnings",
    description: "US companies reporting earnings today, largest market cap first, with before-open / after-close timing.",
    inputSchema: {
      type: 'object',
      properties: { limit: { type: 'integer', minimum: 1, maximum: 100, default: 25, description: 'How many companies to return.' } },
      additionalProperties: false,
    },
    async run(ctx, args) {
      const limit = Math.min(100, Math.max(1, Math.round(num(args.limit) ?? 25)));
      const data = await cached(`earnings:${etDate()}`, 15 * 60_000, () => fetchJson(ctx, '/api/earnings-today'));
      const timing = { BMO: 'before open', AMC: 'after close', TAS: 'during session', TNS: 'time not supplied' };
      const rows = (Array.isArray(data?.earnings) ? data.earnings : []).slice(0, limit).map((r) => ({
        symbol: r.symbol,
        company: r.company,
        timing: timing[String(r.callTime || '').toUpperCase()] || (r.callTime || null),
        marketCapBillions: num(r.marketCap) ? round(num(r.marketCap) / 1e9, 1) : null,
      }));
      return {
        date: data?.date || etDate(),
        totalReporting: num(data?.count) ?? rows.length,
        earnings: rows,
        ...(data?.error ? { warning: `Earnings feed problem: ${data.error}` } : {}),
      };
    },
  },
];

const TOOL_BY_NAME = new Map(TOOLS.map((t) => [t.name, t]));

function toolListing() {
  return TOOLS.map(({ name, title, description, inputSchema }) => ({
    name,
    title,
    description,
    inputSchema,
    annotations: { title, ...READ_ONLY },
    securitySchemes: SECURITY,
    _meta: {
      securitySchemes: SECURITY,
      'openai/toolInvocation/invoking': 'Reading CB Edge…',
      'openai/toolInvocation/invoked': 'Read CB Edge',
    },
  }));
}

// ── Per-user rate limit ─────────────────────────────────────────────────────

const _calls = new Map(); // userId -> [timestamps]
function rateOk(userId) {
  const now = Date.now();
  const hits = (_calls.get(userId) || []).filter((t) => now - t < 60_000);
  if (hits.length >= TOOL_CALLS_PER_MIN) { _calls.set(userId, hits); return false; }
  hits.push(now);
  _calls.set(userId, hits);
  return true;
}

// ── JSON-RPC ────────────────────────────────────────────────────────────────

const rpcResult = (id, result) => ({ jsonrpc: '2.0', id, result });
const rpcError = (id, code, message) => ({ jsonrpc: '2.0', id: id ?? null, error: { code, message } });
const textResult = (obj, isError = false) => ({
  content: [{ type: 'text', text: typeof obj === 'string' ? obj : JSON.stringify(obj) }],
  ...(typeof obj === 'object' && obj && !isError ? { structuredContent: obj } : {}),
  isError,
});

async function callTool(params, ctx, who) {
  const name = params?.name;
  const tool = TOOL_BY_NAME.get(name);
  if (!tool) return { error: [-32602, `Unknown tool: ${name}`] };
  const args = params?.arguments && typeof params.arguments === 'object' ? params.arguments : {};

  const log = (outcome, ms) => oauth.recordToolCall({
    userId: who.userId, clientId: who.clientId, familyId: who.familyId, tool: name, outcome, ms,
  });
  const ent = await oauth.checkEntitlement(who.userId);
  if (!ent.ok) {
    if (!ent.transient) log('no_membership', 0);
    return {
      result: textResult(ent.transient
        ? 'CB Edge could not verify your membership just now. Try again in a minute.'
        : 'Your CB Edge membership is not active, so CB Edge data is unavailable. Renew at cbedge.net/pricing, then reconnect.', true),
    };
  }
  if (!rateOk(who.userId)) {
    log('rate_limited', 0);
    return { result: textResult('Too many CB Edge requests in the last minute. Wait a moment and try again.', true) };
  }

  const t0 = Date.now();
  try {
    const out = await tool.run(ctx, args);
    console.log(`[mcp] ${name} user=${who.userId} ${Date.now() - t0}ms`);
    log('ok', Date.now() - t0);
    return { result: textResult(out) };
  } catch (e) {
    const msg = e instanceof ToolError ? e.message : 'CB Edge hit an internal error reading that data.';
    console.warn(`[mcp] ${name} user=${who.userId} failed after ${Date.now() - t0}ms:`, e?.message || e);
    log('error', Date.now() - t0);
    return { result: textResult(msg, true) };
  }
}

async function dispatch(msg, ctx, who) {
  if (!msg || typeof msg !== 'object' || msg.jsonrpc !== '2.0' || typeof msg.method !== 'string') {
    // A response object from the client (no method) is acknowledged silently.
    if (msg && typeof msg === 'object' && msg.jsonrpc === '2.0' && !('method' in msg)) return null;
    return rpcError(msg?.id, -32600, 'Invalid Request');
  }
  const isNotification = !('id' in msg);
  if (isNotification) return null; // notifications/initialized, notifications/cancelled, …
  const { id, method, params } = msg;

  switch (method) {
    case 'initialize': {
      const asked = params?.protocolVersion;
      return rpcResult(id, {
        protocolVersion: PROTOCOL_VERSIONS.includes(asked) ? asked : PROTOCOL_VERSIONS[0],
        capabilities: { tools: { listChanged: false } },
        serverInfo: SERVER_INFO,
        instructions: INSTRUCTIONS,
      });
    }
    case 'ping':
      return rpcResult(id, {});
    case 'tools/list':
      return rpcResult(id, { tools: toolListing() });
    case 'tools/call': {
      const out = await callTool(params, ctx, who);
      return out.error ? rpcError(id, out.error[0], out.error[1]) : rpcResult(id, out.result);
    }
    case 'resources/list':
      return rpcResult(id, { resources: [] });
    case 'resources/templates/list':
      return rpcResult(id, { resourceTemplates: [] });
    case 'prompts/list':
      return rpcResult(id, { prompts: [] });
    default:
      return rpcError(id, -32601, `Method not found: ${method}`);
  }
}

function readBody(req, maxBytes = 1_000_000) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > maxBytes) { reject(new Error('body too large')); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

function writeJson(res, status, body, extra = {}) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Cache-Control', 'no-store');
  for (const [k, v] of Object.entries(extra)) res.setHeader(k, v);
  res.end(body == null ? '' : JSON.stringify(body));
}

const MAX_BATCH = 10;

async function handleMcp(req, res, ctx) {
  oauth.setCors(res);
  if (req.method === 'OPTIONS') { res.statusCode = 204; res.end(); return; }
  const origin = oauth.publicOrigin(req);

  // Bearer first, for every method — the 401 is what tells ChatGPT to start OAuth.
  const m = /^Bearer\s+(\S+)\s*$/i.exec(String(req.headers.authorization || ''));
  if (!m) {
    return writeJson(res, 401, { error: 'unauthorized', error_description: 'Sign in with CB Edge to use this connector.' },
      { 'WWW-Authenticate': oauth.challengeHeader(origin) });
  }
  // A caller that keeps presenting bad tokens is cut off before the DB is asked.
  const ipKey = oauth.clientKey(req);
  if (oauth.authFailures.blocked(ipKey)) {
    return writeJson(res, 429, { error: 'slow_down' }, { 'Retry-After': '60' });
  }
  let who;
  try { who = await oauth.validateAccessToken(m[1]); }
  catch (e) {
    console.warn('[mcp] token check failed:', e?.message || e);
    return writeJson(res, 503, { error: 'temporarily_unavailable' }, { 'Retry-After': '5' });
  }
  if (!who || (who.resource && who.resource !== oauth.resourceUrl(origin) && who.resource !== origin)) {
    oauth.authFailures.hit(ipKey);
    return writeJson(res, 401, { error: 'invalid_token', error_description: 'Token is invalid or expired.' },
      { 'WWW-Authenticate': oauth.challengeHeader(origin, 'invalid_token') });
  }

  if (req.method !== 'POST') {
    // No server-initiated SSE stream and no sessions to DELETE.
    return writeJson(res, 405, { error: 'method_not_allowed' }, { Allow: 'POST, OPTIONS' });
  }

  let payload;
  try {
    const raw = await readBody(req);
    payload = JSON.parse(raw);
  } catch {
    return writeJson(res, 400, rpcError(null, -32700, 'Parse error'));
  }

  if (Array.isArray(payload)) {
    // JSON-RPC batch (2025-03-26 clients). Later protocol versions dropped it,
    // but answering one costs nothing.
    if (!payload.length || payload.length > MAX_BATCH) {
      return writeJson(res, 400, rpcError(null, -32600, `Batch must hold 1–${MAX_BATCH} messages`));
    }
    const out = (await Promise.all(payload.map((msg) => dispatch(msg, ctx, who)))).filter(Boolean);
    return out.length ? writeJson(res, 200, out) : writeJson(res, 202, null);
  }
  const reply = await dispatch(payload, ctx, who);
  return reply ? writeJson(res, 200, reply) : writeJson(res, 202, null);
}

async function guardedMcp(req, res, ctx) {
  try { await handleMcp(req, res, ctx); }
  catch (e) {
    console.warn('[mcp] request failed:', e?.message || e);
    if (!res.headersSent) writeJson(res, 500, rpcError(null, -32603, 'Internal error'));
    else res.end();
  }
}

// ── Mount ───────────────────────────────────────────────────────────────────

/**
 * Called once by api-router.js with its `register`. Every connector route is
 * 'public' to the router — each handler does its own auth (cookie for
 * /oauth/authorize, bearer for /mcp, client credentials for /oauth/token). The
 * two /api/admin/mcp-connections routes are 'owner', enforced by the router.
 */
function registerRoutes(register) {
  // The owner tracker (owner.cbedge.net → AI Connections) mounts even with the
  // connector switched off, so the history and the switch's effect stay visible.
  try { require('./mcp-admin').registerAdminRoutes(register); }
  catch (e) { console.warn('[mcp] owner tracker routes not loaded:', e?.message || e); }
  if (process.env.MCP_CONNECTOR === '0') {
    console.log('[mcp] ChatGPT connector disabled (MCP_CONNECTOR=0)');
    return false;
  }
  const meta = ['GET', 'OPTIONS'];
  register('/.well-known/oauth-authorization-server', { auth: 'public', methods: meta, handler: oauth.handleAsMetadata });
  register('/.well-known/oauth-protected-resource', { auth: 'public', methods: meta, handler: oauth.handlePrMetadata });
  register('/.well-known/oauth-protected-resource/mcp', { auth: 'public', methods: meta, handler: oauth.handlePrMetadata });
  register('/oauth/register', { auth: 'public', methods: ['POST', 'OPTIONS'], handler: oauth.handleRegister });
  register('/oauth/authorize', { auth: 'public', methods: ['GET', 'POST'], handler: oauth.handleAuthorize });
  register('/oauth/token', { auth: 'public', methods: ['POST', 'OPTIONS'], handler: oauth.handleToken });
  register('/oauth/revoke', { auth: 'public', methods: ['POST', 'OPTIONS'], handler: oauth.handleRevoke });
  const mcpRoute = { auth: 'public', methods: ['GET', 'POST', 'DELETE', 'OPTIONS'], handler: guardedMcp };
  register('/mcp', mcpRoute);
  register('/mcp/', mcpRoute); // a pasted URL with a trailing slash must still get the 401 challenge
  return true;
}

module.exports = {
  registerRoutes,
  handleMcp: guardedMcp,
  TOOLS,
  /** Selftest hooks only. */
  _test: { dispatch, reset() { _calls.clear(); _cache.clear(); } },
};
