'use strict';
/**
 * server-v2/ticker-logo.js
 *
 * Resolves a transparent logo image URL for a ticker and 302-redirects to it,
 * so the client can just use it as an <img src>.
 *
 * Resolution order (first hit wins, then cached forever in PG):
 *   1. davidepalazzo/ticker-logos  → ticker_icons/<SYM>.png  (transparent, dark-theme)
 *   2. Wikidata P154 (logo image)  → Commons Special:FilePath (transparent PNG/SVG render)
 *   3. null → 404, client falls back to the ticker text chip.
 *
 * Route: GET /proxy/ticker-logo?sym=ASML&name=ASML%20Holding%20N.V.
 */

const GH_BASE = 'https://raw.githubusercontent.com/davidepalazzo/ticker-logos/main/ticker_icons';
const UA = 'cbedge-dashboard/1.0 (logo resolver; contact bjmuzila@gmail.com)';

let pool = null;
let pgUnavailable = false;
let _schemaReady = false;
const mem = new Map(); // symbol → url | null

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
      console.warn('[ticker-logo] pool error:', e.message);
      try { pool?.end().catch(() => {}); } catch {}
      pool = null; _schemaReady = false;
    });
    return pool;
  } catch (e) { pgUnavailable = true; return null; }
}

async function ensureSchema() {
  const p = getPool();
  if (!p) return false;
  if (_schemaReady) return true;
  await p.query(`
    CREATE TABLE IF NOT EXISTS ticker_logos (
      symbol     TEXT PRIMARY KEY,
      url        TEXT,                -- null = looked up, none found
      source     TEXT,                -- gh | wikidata
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);
  _schemaReady = true;
  return true;
}

async function headOk(url) {
  try {
    const r = await fetch(url, { method: 'HEAD', headers: { 'User-Agent': UA } });
    return r.ok;
  } catch { return false; }
}

/** Wikidata → P154 (logo image) → Commons FilePath thumbnail. */
async function wikidataLogo(symbol, name) {
  const q = (name || symbol).replace(/\b(inc|corp|corporation|co|ltd|plc|n\.?v\.?|s\.?a\.?|holdings?|group|company|the)\b\.?/gi, '').trim() || symbol;
  const sRes = await fetch(
    `https://www.wikidata.org/w/api.php?action=wbsearchentities&format=json&language=en&type=item&limit=5&search=${encodeURIComponent(q)}`,
    { headers: { 'User-Agent': UA } }
  );
  if (!sRes.ok) return null;
  const sJson = await sRes.json();
  const ids = (sJson?.search || []).map((s) => s.id).filter(Boolean);
  for (const id of ids) {
    const cRes = await fetch(
      `https://www.wikidata.org/w/api.php?action=wbgetclaims&format=json&property=P154&entity=${id}`,
      { headers: { 'User-Agent': UA } }
    );
    if (!cRes.ok) continue;
    const cJson = await cRes.json();
    const file = cJson?.claims?.P154?.[0]?.mainsnak?.datavalue?.value;
    if (!file) continue;
    return `https://commons.wikimedia.org/wiki/Special:FilePath/${encodeURIComponent(String(file).replace(/ /g, '_'))}?width=128`;
  }
  return null;
}

async function resolveLogo(symbol, name) {
  const sym = String(symbol || '').toUpperCase().trim();
  if (!sym) return null;
  if (mem.has(sym)) return mem.get(sym);

  // PG cache
  if (await ensureSchema()) {
    const { rows } = await getPool().query('SELECT url FROM ticker_logos WHERE symbol = $1', [sym]);
    if (rows.length) { mem.set(sym, rows[0].url); return rows[0].url; }
  }

  let url = null;
  let source = null;
  const gh = `${GH_BASE}/${sym}.png`;
  if (await headOk(gh)) { url = gh; source = 'gh'; }
  else {
    try { url = await wikidataLogo(sym, name); if (url) source = 'wikidata'; }
    catch (e) { console.warn('[ticker-logo] wikidata', sym, e.message); }
  }

  mem.set(sym, url);
  if (await ensureSchema()) {
    await getPool().query(
      `INSERT INTO ticker_logos (symbol, url, source, updated_at) VALUES ($1,$2,$3, now())
       ON CONFLICT (symbol) DO UPDATE SET url = EXCLUDED.url, source = EXCLUDED.source, updated_at = now()`,
      [sym, url, source]
    );
  }
  return url;
}

/** Clear a bad/stale entry so the next request re-resolves. */
async function forgetLogo(symbol) {
  const sym = String(symbol || '').toUpperCase().trim();
  mem.delete(sym);
  if (await ensureSchema()) await getPool().query('DELETE FROM ticker_logos WHERE symbol = $1', [sym]);
}

module.exports = { resolveLogo, forgetLogo, ensureSchema, getPool };
