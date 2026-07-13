'use strict';
/**
 * server-v2/day-post-writer.js
 *
 * Auto-writes the day's X posts (Anthropic) into the `day_posts` Postgres
 * table so the Social Media → Day Posts tab always has a ready copy/paste
 * list. Zero interaction: at each slot's window it pulls the live read from
 * the Next route /api/social-media/daily-input (same data the tab's "Load
 * data" uses — Next runs in-process on the same port), then asks
 * /api/social-media/day-post to write the slot's tweet, and upserts it.
 *
 * Slots (ET, Mon–Fri, non-holiday):
 *   premarket  08:40–09:15
 *   midday     12:25–13:00
 *   eod        16:03–16:40
 *
 * Guard: one row per (date, slot) — if the row already exists the slot is
 * skipped, so restarts / multiple ticks inside a window never double-generate.
 * Env: DATABASE_URL (writes), ANTHROPIC_API_KEY (used by the Next route).
 */

// Slot windows in minutes-since-midnight ET.
const SLOTS = [
  { slot: 'premarket', open: 8 * 60 + 40, close: 9 * 60 + 15 },
  { slot: 'midday',    open: 12 * 60 + 25, close: 13 * 60 },
  { slot: 'eod',       open: 16 * 60 + 3,  close: 16 * 60 + 40 },
];

// Server-to-server auth: these Next routes are owner-gated, so without the
// shared-secret header middleware redirects to "/" and we parse landing HTML.
const internalHeaders = () =>
  (process.env.INTERNAL_API_TOKEN ? { 'x-internal-token': process.env.INTERNAL_API_TOKEN } : {});

// Market holidays (ET dates) — keep in sync with eod-gex-recorder.js
const MARKET_HOLIDAYS = new Set([
  // 2026
  '2026-01-01', '2026-01-19', '2026-02-16', '2026-04-03', '2026-05-25',
  '2026-06-19', '2026-07-03', '2026-09-07', '2026-11-26', '2026-12-25',
  // 2027
  '2027-01-01', '2027-01-18', '2027-02-15', '2027-03-26', '2027-05-31',
  '2027-06-18', '2027-07-05', '2027-09-06', '2027-11-25', '2027-12-24',
]);

// ── PG pool (same lazy pattern as eod-gex-recorder.js) ───────────────────────
let pool = null;
let pgUnavailable = false;
let tableEnsured = false;

function getPool() {
  if (pgUnavailable) return null;
  if (pool) return pool;
  if (!process.env.DATABASE_URL) { pgUnavailable = true; return null; }
  try {
    const { Pool } = require('pg');
    pool = new Pool({
      connectionString: process.env.DATABASE_URL,
      ssl: process.env.DATABASE_URL.includes('localhost') || process.env.DATABASE_URL.includes('127.0.0.1')
        ? undefined
        : { rejectUnauthorized: false },
      max: 2,
      keepAlive: true,
    });
    pool.on('error', (e) => {
      console.warn('[day-post] pool error (will reconnect):', e.message);
      try { pool?.end().catch(() => {}); } catch {}
      pool = null;
    });
    return pool;
  } catch (e) {
    console.error('[day-post] pg unavailable:', e.message);
    pgUnavailable = true;
    return null;
  }
}

async function ensureTable(p) {
  if (tableEnsured) return;
  await p.query(`
    CREATE TABLE IF NOT EXISTS day_posts (
      date       TEXT NOT NULL,          -- ET session date YYYY-MM-DD
      slot       TEXT NOT NULL,          -- premarket | midday | eod
      tweet      TEXT NOT NULL,
      data       JSONB,                  -- the daily-input snapshot used
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      PRIMARY KEY (date, slot)
    )`);
  tableEnsured = true;
}

// ── Time helpers ─────────────────────────────────────────────────────────────
function etParts(d = new Date()) {
  const p = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York',
    hour: '2-digit', minute: '2-digit', weekday: 'short', hour12: false,
  }).formatToParts(d);
  const get = (t) => p.find((x) => x.type === t)?.value;
  return { hour: Number(get('hour')), minute: Number(get('minute')), weekday: get('weekday') };
}

function etDateStr(d = new Date()) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(d).filter((p) => p.type !== 'literal')
    .reduce((a, p) => ({ ...a, [p.type]: p.value }), {});
  return `${parts.year}-${parts.month}-${parts.day}`;
}

function isTradingDayNow() {
  const { weekday } = etParts();
  if (weekday === 'Sat' || weekday === 'Sun') return false;
  return !MARKET_HOLIDAYS.has(etDateStr());
}

// Slot whose window contains "now" (ET), or null.
function activeSlot() {
  const { hour, minute } = etParts();
  const mins = hour * 60 + minute;
  return SLOTS.find((s) => mins >= s.open && mins <= s.close) ?? null;
}

// ── Generation ───────────────────────────────────────────────────────────────
// Mirror of the Social Media page's regime/bias derivation (net-GEX sign is the
// source of truth; spot-vs-flip is context only).
function regimeAndBias(netGex, spot, flip) {
  const negative = Number.isFinite(netGex) && netGex < 0;
  const underFlip = Number.isFinite(spot) && Number.isFinite(flip) && spot < flip;
  if (negative) {
    return {
      regime: 'NEGATIVE GAMMA',
      bias: 'Negative-gamma regime — dealers amplify moves; downside breaks can extend, momentum over mean-reversion.',
    };
  }
  return {
    regime: 'POSITIVE GAMMA',
    bias: underFlip
      ? 'Positive-gamma regime — dealers dampen moves; mean-reversion favored, though spot under the flip keeps a downside tilt until it reclaims.'
      : 'Positive-gamma regime — dealers dampen moves; fade extremes, expect mean-reversion while spot holds over the flip.',
  };
}

/**
 * Generate + store ONE slot's post. Skips silently if the row already exists
 * (unless opts.force, which regenerates/overwrites). Returns a status string.
 */
async function runDayPostOnce(base, slot, opts = {}) {
  const p = getPool();
  if (!p) return 'no-db';
  await ensureTable(p);

  const date = etDateStr();
  if (!opts.force) {
    const { rows } = await p.query(`SELECT 1 FROM day_posts WHERE date=$1 AND slot=$2`, [date, slot]);
    if (rows.length) return 'exists';
  }

  // 1) Live read (same numbers the tab's Load data pulls).
  const diRes = await fetch(`${base}/api/social-media/daily-input`, {
    cache: 'no-store',
    redirect: 'manual',
    headers: internalHeaders(),
  });
  if (!diRes.ok) throw new Error(`daily-input ${diRes.status}${diRes.status >= 300 && diRes.status < 400 ? ' (auth redirect — INTERNAL_API_TOKEN missing?)' : ''}`);
  const di = (await diRes.json())?.data ?? {};
  if (!(Number(di.spxSpot) > 0)) throw new Error('daily-input has no SPX spot — feed not ready');

  const { regime, bias } = regimeAndBias(Number(di.netGex), Number(di.spxSpot), Number(di.gammaFlip));

  // 2) Anthropic post via the Next route (slot-aware prompt lives there).
  const genRes = await fetch(`${base}/api/social-media/day-post`, {
    method: 'POST',
    redirect: 'manual',
    headers: { 'content-type': 'application/json', ...internalHeaders() },
    body: JSON.stringify({
      slot,
      visual: null,
      spxSpot: di.spxSpot ?? null,
      spxPrevClose: di.spxPrevClose ?? null,
      gammaFlip: di.gammaFlip ?? null,
      callWall: di.callWall ?? null,
      putWall: di.putWall ?? null,
      expectedMove: di.expectedMove ?? null,
      emUpper: di.emUpper ?? null,
      emLower: di.emLower ?? null,
      netGex: di.netGex ?? null,
      gammaRegime: regime,
      bias,
    }),
  });
  const gen = await genRes.json().catch(() => ({}));
  const tweet = gen?.data?.xPost;
  if (!genRes.ok || !tweet) throw new Error(gen?.error || `day-post ${genRes.status}`);

  // 3) Upsert.
  await p.query(
    `INSERT INTO day_posts (date, slot, tweet, data, created_at)
     VALUES ($1, $2, $3, $4, now())
     ON CONFLICT (date, slot) DO UPDATE SET
       tweet = EXCLUDED.tweet, data = EXCLUDED.data, created_at = now()`,
    [date, slot, tweet, JSON.stringify({
      spxSpot: di.spxSpot, spxPrevClose: di.spxPrevClose, gammaFlip: di.gammaFlip,
      callWall: di.callWall, putWall: di.putWall, expectedMove: di.expectedMove,
      netGex: di.netGex, regime,
    })]
  );
  console.log(`[day-post] ${date} ${slot} — saved (${tweet.length} chars)`);
  return 'saved';
}

// ── Scheduler ────────────────────────────────────────────────────────────────
// 60s poll; inside a slot window on a trading day it generates once (the DB
// row guard makes further ticks no-ops). A failed attempt (feed not ready,
// Anthropic error) just retries on the next tick until the window closes.
let _timer = null;
let _running = false;

function startDayPostWriter(port) {
  const base = `http://localhost:${port}`;
  console.log('[day-post] enabled — premarket 08:40, midday 12:25, eod 16:03 ET (60s poll, one row per date+slot)');
  const tick = async () => {
    if (_running || !isTradingDayNow()) return;
    const s = activeSlot();
    if (!s) return;
    _running = true;
    try {
      await runDayPostOnce(base, s.slot);
    } catch (e) {
      console.warn(`[day-post] ${s.slot} — ${e.message} (will retry)`);
    } finally {
      _running = false;
    }
  };
  _timer = setInterval(() => { void tick(); }, 60_000);
  _timer.unref?.();
  return () => { if (_timer) clearInterval(_timer); };
}

module.exports = { startDayPostWriter, runDayPostOnce };
