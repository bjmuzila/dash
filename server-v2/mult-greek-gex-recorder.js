'use strict';
/**
 * server-v2/mult-greek-gex-recorder.js
 *
 * Backs the /mult-greek click card's 15m / 30m / open NET GEX change. Every ~60s
 * during RTH it pulls each roster ticker's closest expiries over the LOCAL proxy
 * (the same /proxy/api/tt/chains adapter the page uses), computes per-strike NET
 * GEX (OI+VOL basis, ±window strikes around spot), and writes:
 *   - mult_greek_gex_ring : rolling ~45-min history (for the 15m/30m lookbacks)
 *   - mult_greek_gex_open : first RTH reading of the ET day (for Δ-open)
 *
 * queryGexChange() returns the stored { vNow, v15, v30, vOpen } for one cell; the
 * client diffs its LIVE value against those. No-ops cleanly without DATABASE_URL.
 *
 * NOTE: lives in server-v2/ ROOT (not server-v2/state/, which is gitignored — a
 * new module there is silently untracked and 502s the site).
 */

const TICKERS = (process.env.MULT_GREEK_GEX_TICKERS || 'SPX,SPY,QQQ,IWM')
  .split(',').map((s) => s.trim().toUpperCase()).filter(Boolean);
const EXPIRIES_PER_TICKER = Number(process.env.MULT_GREEK_GEX_EXPIRIES || 4);
const STRIKE_WINDOW = Number(process.env.MULT_GREEK_GEX_WINDOW || 60); // ± strikes around ATM
const INTERVAL_MS = Number(process.env.MULT_GREEK_GEX_INTERVAL_MS || 60_000);
const RING_MS = Number(process.env.MULT_GREEK_GEX_RING_MS || 45 * 60_000);

// ── pg pool (mirrors gex-history-writer) ────────────────────────────────────
let pool = null;
let pgUnavailable = false;
let schemaEnsured = false;

function getPool() {
  if (pgUnavailable) return null;
  if (pool) return pool;
  if (!process.env.DATABASE_URL) { pgUnavailable = true; return null; }
  try {
    const { Pool } = require('pg');
    pool = new Pool({
      connectionString: process.env.DATABASE_URL,
      ssl: process.env.DATABASE_URL.includes('localhost') || process.env.DATABASE_URL.includes('127.0.0.1')
        ? undefined : { rejectUnauthorized: false },
      max: 2,
      keepAlive: true,
    });
    pool.on('error', (e) => {
      console.warn('[mult-greek-gex] pool error (will reconnect):', e.message);
      try { pool?.end().catch(() => {}); } catch {}
      pool = null;
    });
    return pool;
  } catch (e) {
    console.error('[mult-greek-gex] pg unavailable:', e.message);
    pgUnavailable = true;
    return null;
  }
}

async function ensureSchema(p) {
  if (schemaEnsured) return;
  await p.query(`CREATE TABLE IF NOT EXISTS mult_greek_gex_ring (
    ts bigint NOT NULL, ticker text NOT NULL, expiry date NOT NULL,
    strike double precision NOT NULL, net_gex double precision NOT NULL,
    PRIMARY KEY (ts, ticker, expiry, strike))`);
  await p.query(`CREATE INDEX IF NOT EXISTS mg_gex_ring_key ON mult_greek_gex_ring (ticker, expiry, strike, ts DESC)`);
  await p.query(`CREATE TABLE IF NOT EXISTS mult_greek_gex_open (
    session_date date NOT NULL, ticker text NOT NULL, expiry date NOT NULL,
    strike double precision NOT NULL, net_gex double precision NOT NULL, ts bigint NOT NULL,
    PRIMARY KEY (session_date, ticker, expiry, strike))`);
  schemaEnsured = true;
}

// ── ET helpers ──────────────────────────────────────────────────────────────
function nowParts() {
  const p = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York', hour: '2-digit', minute: '2-digit', weekday: 'short', hour12: false,
  }).formatToParts(new Date());
  const get = (t) => p.find((x) => x.type === t)?.value;
  return { hour: Number(get('hour')), minute: Number(get('minute')), weekday: get('weekday') };
}
function isRTH() {
  const { hour, minute, weekday } = nowParts();
  if (weekday === 'Sat' || weekday === 'Sun') return false;
  const mins = hour * 60 + minute;
  return mins >= 570 && mins < 960; // 09:30–16:00 ET
}
function todayETStr() {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(new Date()); // YYYY-MM-DD
}
function daysTo(dateStr) {
  return Math.round((new Date(dateStr).getTime() - new Date(todayETStr()).getTime()) / 86400000);
}

/** The N closest expirations, same keep-filter MultGreekClient uses. */
function pickExpiries(items, n) {
  const seen = new Set();
  const list = [];
  (items || []).forEach((item) => {
    const d = String(item['expiration-date'] ?? '');
    if (!d || seen.has(d)) return;
    seen.add(d);
    const dt = daysTo(d);
    if (dt < 0) return;
    const t = String(item['expiration-type'] ?? '').toLowerCase();
    const keep = dt <= 7 || t === 'weekly' || t === 'monthly' || new Date(d + 'T12:00:00').getDay() === 5;
    if (!keep) return;
    list.push({ date: d, daysTo: dt });
  });
  list.sort((a, b) => a.daysTo - b.daysTo);
  return list.slice(0, n).map((e) => e.date);
}

// Per-strike NET GEX (OI+VOL), windowed to the STRIKE_WINDOW strikes nearest spot.
function computeGexRows(items, spot) {
  const out = [];
  for (const grp of (items || [])) {
    for (const s of (grp.strikes || [])) {
      const strike = Number(s['strike-price']);
      if (!(strike > 0)) continue;
      const c = s.call || {}, p = s.put || {};
      const cg = Math.abs(Number(c.gamma) || 0), pg = Math.abs(Number(p.gamma) || 0);
      const cc = (Number(c['open-interest']) || 0) + (Number(c.volume) || 0);
      const pc = (Number(p['open-interest']) || 0) + (Number(p.volume) || 0);
      const net = (cg * cc - pg * pc) * spot * spot * 0.01 * 100;
      out.push({ strike, net });
    }
  }
  out.sort((a, b) => Math.abs(a.strike - spot) - Math.abs(b.strike - spot));
  return out.slice(0, STRIKE_WINDOW * 2 + 1);
}

async function fetchJson(url) {
  const res = await fetch(url, {
    cache: 'no-store',
    headers: process.env.INTERNAL_API_TOKEN ? { 'x-internal-token': process.env.INTERNAL_API_TOKEN } : {},
  });
  if (!res.ok) throw new Error(`${url} ${res.status}`);
  return res.json();
}

async function collectOnce(base, opts = {}) {
  if (!isRTH() && !opts.force) return;
  const p = getPool();
  if (!p) return;
  try { await ensureSchema(p); } catch (e) { console.warn('[mult-greek-gex] schema ensure failed:', e.message); return; }

  const now = Date.now();
  const today = todayETStr();
  const ringVals = [], ringParams = [];
  const openVals = [], openParams = [];
  let ri = 0, oi = 0;

  for (const ticker of TICKERS) {
    let exps = [];
    try {
      const expJson = await fetchJson(`${base}/proxy/api/tt/expirations/${encodeURIComponent(ticker)}`);
      exps = pickExpiries(expJson?.data?.items ?? [], EXPIRIES_PER_TICKER);
    } catch { /* fall through to chain-derived */ }
    if (!exps.length) {
      try {
        const cj = await fetchJson(`${base}/proxy/api/tt/chains/${encodeURIComponent(ticker)}?range=all`);
        exps = pickExpiries(cj?.data?.items ?? [], EXPIRIES_PER_TICKER);
      } catch { /* skip ticker */ }
    }

    for (const exp of exps) {
      try {
        const json = await fetchJson(`${base}/proxy/api/tt/chains/${encodeURIComponent(ticker)}?expiration=${encodeURIComponent(exp)}&range=all`);
        const all = json?.data?.items ?? [];
        const items = all.filter((i) => String(i['expiration-date'] ?? '').slice(0, 10) === exp.slice(0, 10));
        const spot = Number(json?.data?.underlyingPrice ?? 0) || 0;
        const use = items.length ? items : all;
        if (!(spot > 0) || !use.length) continue;
        for (const row of computeGexRows(use, spot)) {
          let net = row.net;
          if (!Number.isFinite(net)) continue;
          if (Math.abs(net) < 1e-9) net = 0;
          ringVals.push(`($${++ri}, $${++ri}, $${++ri}, $${++ri}, $${++ri})`);
          ringParams.push(now, ticker, exp, row.strike, net);
          openVals.push(`($${++oi}, $${++oi}, $${++oi}, $${++oi}, $${++oi}, $${++oi})`);
          openParams.push(today, ticker, exp, row.strike, net, now);
        }
      } catch (e) {
        console.warn(`[mult-greek-gex] ${ticker} ${exp} fetch failed: ${e.message}`);
      }
    }
  }

  if (!ringVals.length) return;
  try {
    await p.query(
      `INSERT INTO mult_greek_gex_ring (ts, ticker, expiry, strike, net_gex) VALUES ${ringVals.join(', ')}
       ON CONFLICT (ts, ticker, expiry, strike) DO NOTHING`,
      ringParams,
    );
    // Open = first RTH reading of the ET day; keep the earliest.
    await p.query(
      `INSERT INTO mult_greek_gex_open (session_date, ticker, expiry, strike, net_gex, ts) VALUES ${openVals.join(', ')}
       ON CONFLICT (session_date, ticker, expiry, strike) DO NOTHING`,
      openParams,
    );
    await p.query('DELETE FROM mult_greek_gex_ring WHERE ts < $1', [now - RING_MS]);
    await p.query("DELETE FROM mult_greek_gex_open WHERE session_date < (now() at time zone 'America/New_York')::date - 3");
  } catch (e) {
    console.warn('[mult-greek-gex] write failed:', e.message);
    const msg = String(e?.message || '');
    if (/terminat|ECONNRESET|ETIMEDOUT|Connection|socket|server closed|after calling end|cannot use a pool/i.test(msg)) {
      try { pool?.end().catch(() => {}); } catch {}
      pool = null;
    }
  }
}

/** Stored { vNow, v15, v30, vOpen } for one cell — client diffs its live value. */
async function queryGexChange(ticker, expiry, strike) {
  const p = getPool();
  if (!p) return null;
  const tk = String(ticker || '').toUpperCase();
  const st = Number(strike);
  if (!tk || !expiry || !Number.isFinite(st)) return null;
  const now = Date.now();
  const one = async (extraSql, extraParam) => {
    const params = [tk, expiry, st];
    let sql = `SELECT net_gex FROM mult_greek_gex_ring
               WHERE ticker=$1 AND expiry=$2::date AND abs(strike-$3) < 0.001`;
    if (extraSql) { params.push(extraParam); sql += ` AND ts <= $${params.length}`; }
    sql += ' ORDER BY ts DESC LIMIT 1';
    const r = await p.query(sql, params);
    return r.rows.length ? Number(r.rows[0].net_gex) : null;
  };
  try {
    const [vNow, v15, v30, openRes] = await Promise.all([
      one(false),
      one(true, now - 15 * 60_000),
      one(true, now - 30 * 60_000),
      p.query(
        `SELECT net_gex FROM mult_greek_gex_open
         WHERE ticker=$1 AND expiry=$2::date AND abs(strike-$3) < 0.001
           AND session_date = (now() at time zone 'America/New_York')::date
         LIMIT 1`,
        [tk, expiry, st],
      ),
    ]);
    return {
      vNow, v15, v30,
      vOpen: openRes.rows.length ? Number(openRes.rows[0].net_gex) : null,
    };
  } catch (e) {
    console.warn('[mult-greek-gex] query failed:', e.message);
    return null;
  }
}

function startMultGreekGexRecorder(port) {
  const base = `http://localhost:${port}`;
  console.log(`[mult-greek-gex] enabled — every ${Math.round(INTERVAL_MS / 1000)}s during RTH · tickers ${TICKERS.join(',')} · ${EXPIRIES_PER_TICKER} expiries · ±${STRIKE_WINDOW} strikes`);
  // Stagger past the other startup recorders.
  setTimeout(() => { void collectOnce(base); }, 40_000);
  let stopped = false;
  const timer = setInterval(() => { if (!stopped) void collectOnce(base); }, INTERVAL_MS);
  return () => { stopped = true; clearInterval(timer); };
}

module.exports = { startMultGreekGexRecorder, collectOnce, queryGexChange };
