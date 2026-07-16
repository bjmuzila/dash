'use strict';
/**
 * server-v2/gex-levels-history-recorder.js
 *
 * Hard-persists the /test → GEX Levels "History of key level changes" table
 * into Postgres FOREVER (previously browser-localStorage only, 60-day cap).
 *
 * One row per (date, symbol), upserted in place all session; once the ET date
 * rolls over the row is frozen. Fields mirror the client's deriveGexLevels():
 *   spot, resistance (callWall), support (putWall), neutral (gexFlip),
 *   dollar_gamma (totalNetGex), cpg_ratio, r2, s2, open_int (ΣcallOI+ΣputOI).
 *
 * Source: /proxy/gex live snapshot (same feed the tab renders from), so the
 * saved row always matches what the tab showed.
 *
 * Cadence: every POLL_MINS (default 5) during 09:25–16:10 ET on trading days.
 * Wiring: startGexLevelsHistoryRecorder(PORT) in server-with-proxy.js.
 * Read API: GET /proxy/gex-levels-history  (route in server-with-proxy.js).
 */

const POLL_MINS = Number(process.env.GEX_LEVELS_HISTORY_POLL_MINS || 5);

// RTH-ish window (ET minutes-since-midnight): 09:25–16:10.
const WINDOW_OPEN_MINS = 9 * 60 + 25;
const WINDOW_CLOSE_MINS = 16 * 60 + 10;

// Market holidays — keep in sync with eod-gex-recorder.js / mvc-auto-snapshot.js
const MARKET_HOLIDAYS = new Set([
  '2026-01-01', '2026-01-19', '2026-02-16', '2026-04-03', '2026-05-25',
  '2026-06-19', '2026-07-03', '2026-09-07', '2026-11-26', '2026-12-25',
  '2027-01-01', '2027-01-18', '2027-02-15', '2027-03-26', '2027-05-31',
  '2027-06-18', '2027-07-05', '2027-09-06', '2027-11-25', '2027-12-24',
]);

// ── PG pool (same lazy, no-DB-safe pattern as eod-gex-recorder.js) ───────────

let pool = null;
let pgUnavailable = false;
let _schemaReady = false;

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
      console.warn('[gex-levels-hist] pool error (will reconnect):', e.message);
      try { pool?.end().catch(() => {}); } catch {}
      pool = null;
      _schemaReady = false;
    });
    return pool;
  } catch (e) {
    console.error('[gex-levels-hist] pg unavailable:', e.message);
    pgUnavailable = true;
    return null;
  }
}

async function ensureSchema() {
  const p = getPool();
  if (!p) return false;
  if (_schemaReady) return true;
  await p.query(`
    CREATE TABLE IF NOT EXISTS gex_levels_history (
      date         DATE NOT NULL,
      symbol       TEXT NOT NULL DEFAULT '$SPX',
      spot         DOUBLE PRECISION NOT NULL,
      resistance   DOUBLE PRECISION,
      support      DOUBLE PRECISION,
      neutral      DOUBLE PRECISION,
      dollar_gamma DOUBLE PRECISION NOT NULL DEFAULT 0,
      cpg_ratio    DOUBLE PRECISION NOT NULL DEFAULT 0,
      r2           DOUBLE PRECISION,
      s2           DOUBLE PRECISION,
      open_int     DOUBLE PRECISION NOT NULL DEFAULT 0,
      curve        JSONB,
      updated_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
      PRIMARY KEY (date, symbol)
    )
  `);
  // Additive for tables created before the curve snapshot existed — pre-curve
  // rows stay NULL and the client renders a dash for them.
  await p.query(`ALTER TABLE gex_levels_history ADD COLUMN IF NOT EXISTS curve JSONB`);
  _schemaReady = true;
  return true;
}

// ── Time helpers ─────────────────────────────────────────────────────────────

function etDateStr(d = new Date()) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(d);
}

function inWindow() {
  const p = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York', hour: '2-digit', minute: '2-digit', weekday: 'short', hour12: false,
  }).formatToParts(new Date());
  const get = (t) => p.find((x) => x.type === t)?.value;
  const weekday = get('weekday');
  if (weekday === 'Sat' || weekday === 'Sun') return false;
  if (MARKET_HOLIDAYS.has(etDateStr())) return false;
  const mins = Number(get('hour')) * 60 + Number(get('minute'));
  return mins >= WINDOW_OPEN_MINS && mins <= WINDOW_CLOSE_MINS;
}

// ── Derivation — mirrors deriveGexLevels() in app/test/page.tsx ──────────────

const oiVolNet = (r) => (Number(r.netGEX) || 0) + (Number(r.netVolGEX) || 0);

// Downsampled cumulative net-GEX-by-strike curve (running sum from the lowest
// strike up — same math as glCumulativeByStrike / findGexFlip). Snapshotted per
// day so the tab's history table can sparkline the whole gamma profile, not
// just the walls. Kept to GL_CURVE_POINTS so the JSONB stays a few KB/day.
// `rows` must already be sorted ascending by strike.
const GL_CURVE_POINTS = 48;
function cumulativeCurve(rows) {
  let cum = 0;
  const pts = rows.map((r) => { cum += oiVolNet(r); return { k: Number(r.strike), c: cum }; });
  const at = (p) => ({ k: Number(p.k.toFixed(2)), c: Math.round(p.c) });
  if (pts.length <= GL_CURVE_POINTS) return pts.map(at);
  const step = (pts.length - 1) / (GL_CURVE_POINTS - 1);
  return Array.from({ length: GL_CURVE_POINTS }, (_, i) => at(pts[Math.round(i * step)]));
}

function deriveFromSnapshot(v2) {
  const rows = (Array.isArray(v2.gexRows) ? v2.gexRows : [])
    .filter((r) => Number.isFinite(Number(r.strike)))
    .sort((a, b) => a.strike - b.strike);
  const spot = Number(v2.spot ?? 0);
  if (!rows.length || !(spot > 0)) return null;

  const resistance = Number.isFinite(Number(v2.callWall)) ? Number(v2.callWall) : null;
  const support = Number.isFinite(Number(v2.putWall)) ? Number(v2.putWall) : null;
  const neutral = Number.isFinite(Number(v2.gexFlip)) ? Number(v2.gexFlip) : null;
  const dollarGamma = Number.isFinite(Number(v2.totalNetGex))
    ? Number(v2.totalNetGex)
    : rows.reduce((s, r) => s + oiVolNet(r), 0);

  let totalCallGEX = 0, totalPutGEXabs = 0, totalCallOI = 0, totalPutOI = 0;
  for (const r of rows) {
    totalCallGEX += Math.max(0, Number(r.callGEX) || 0);
    totalPutGEXabs += Math.abs(Number(r.putGEX) || 0);
    totalCallOI += Number(r.callOI) || 0;
    totalPutOI += Number(r.putOI) || 0;
  }
  const cpgRatio = totalPutGEXabs > 0 ? totalCallGEX / totalPutGEXabs : 0;

  // R2/S2 — 2nd-strongest wall each side, excluding the #1 winner.
  const above = rows
    .filter((r) => r.strike > spot && oiVolNet(r) > 0 && r.strike !== resistance)
    .sort((a, b) => oiVolNet(b) - oiVolNet(a));
  const below = rows
    .filter((r) => r.strike < spot && oiVolNet(r) < 0 && r.strike !== support)
    .sort((a, b) => oiVolNet(a) - oiVolNet(b));
  const r2 = above[0]?.strike ?? null;
  const s2 = below[0]?.strike ?? null;

  return {
    spot, resistance, support, neutral, dollarGamma, cpgRatio, r2, s2,
    openInt: totalCallOI + totalPutOI,
    curve: cumulativeCurve(rows),
  };
}

// ── Collect + upsert ─────────────────────────────────────────────────────────

async function collectGexLevelsHistory(base, opts = {}) {
  const force = !!opts.force;
  if (!force && !inWindow()) return null;
  if (!(await ensureSchema())) return null;

  const res = await fetch(`${base}/proxy/gex`, {
    cache: 'no-store',
    headers: process.env.INTERNAL_API_TOKEN
      ? { 'x-internal-token': process.env.INTERNAL_API_TOKEN } : {},
  });
  if (!res.ok) throw new Error(`/proxy/gex returned ${res.status}`);
  const v2 = await res.json();

  const d = deriveFromSnapshot(v2);
  if (!d) throw new Error('snapshot not ready (no rows / spot 0)');

  const symbol = String(v2.symbol || '$SPX');
  const date = etDateStr();
  const p = getPool();
  if (!p) return null;
  await p.query(
    `INSERT INTO gex_levels_history
       (date, symbol, spot, resistance, support, neutral, dollar_gamma, cpg_ratio, r2, s2, open_int, curve, updated_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12::jsonb, now())
     ON CONFLICT (date, symbol) DO UPDATE SET
       spot = EXCLUDED.spot, resistance = EXCLUDED.resistance, support = EXCLUDED.support,
       neutral = EXCLUDED.neutral, dollar_gamma = EXCLUDED.dollar_gamma, cpg_ratio = EXCLUDED.cpg_ratio,
       r2 = EXCLUDED.r2, s2 = EXCLUDED.s2, open_int = EXCLUDED.open_int,
       curve = EXCLUDED.curve, updated_at = now()`,
    [date, symbol, d.spot, d.resistance, d.support, d.neutral, d.dollarGamma, d.cpgRatio, d.r2, d.s2, d.openInt,
     d.curve?.length ? JSON.stringify(d.curve) : null]
  );
  return { date, symbol, ...d };
}

// ── Scheduler ────────────────────────────────────────────────────────────────

let _timer = null;

function startGexLevelsHistoryRecorder(port) {
  const base = `http://localhost:${port}`;
  console.log(`[gex-levels-hist] enabled — ${POLL_MINS}m poll, 09:25–16:10 ET trading days → gex_levels_history`);
  const tick = async () => {
    try { await collectGexLevelsHistory(base); }
    catch (e) { if (inWindow()) console.warn('[gex-levels-hist] tick:', e.message); }
  };
  // Fire once shortly after boot (covers mid-session restarts), then poll.
  setTimeout(() => { void tick(); }, 30_000).unref?.();
  _timer = setInterval(() => { void tick(); }, POLL_MINS * 60_000);
  _timer.unref?.();
  return () => { if (_timer) clearInterval(_timer); };
}

module.exports = { startGexLevelsHistoryRecorder, collectGexLevelsHistory, ensureSchema, getPool };
