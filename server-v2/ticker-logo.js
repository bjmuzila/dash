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

// ── Raw byte path (?raw=1) ───────────────────────────────────────────────────
/**
 * Same resolution, but WE fetch the image and hand back the bytes instead of
 * 302-ing the browser to GitHub or Commons.
 *
 * The redirect is cheaper for us and worse for everything downstream. A 302 to a
 * third-party host makes the image cross-origin no matter how same-origin the
 * `<img src>` looked, and drawing a cross-origin image into a canvas TAINTS it —
 * `toBlob()` then throws SecurityError and the whole screenshot dies. So
 * lib/snapshot.ts strips every `/proxy/*` image out of the capture and swaps in
 * the ticker-text chip, which is why the earnings board's PNG showed marks only
 * for the handful of names mirrored into public/logos and plain text for the
 * rest. Streaming the bytes makes the response genuinely same-origin, so the
 * capture can draw it.
 *
 * The 302 is still the default — `resolveLogo` and the plain route are
 * untouched, so anything already pointing at this endpoint behaves exactly as
 * before. `?raw=1` is opt-in.
 *
 * Bounded on purpose: logos are small, but the calendar's ticker list is now the
 * whole Nasdaq universe, so the buffer cache is capped by count and each image
 * by size. A miss (no logo, a non-image content type, a fetch that throws) is
 * cached as null too — otherwise every render of a logo-less ticker would walk
 * the GitHub HEAD + Wikidata path again.
 */
const RAW_MAX_ENTRIES = 500;
const RAW_MAX_BYTES = 512 * 1024;
const rawMem = new Map(); // symbol → { buf, type } | null

function rawRemember(sym, val) {
  rawMem.set(sym, val);
  // Map preserves insertion order, so the first key is the oldest.
  while (rawMem.size > RAW_MAX_ENTRIES) {
    const oldest = rawMem.keys().next().value;
    if (oldest === undefined) break;
    rawMem.delete(oldest);
  }
  return val;
}

/**
 * @returns {Promise<{buf: Buffer, type: string} | null>} null = no logo, and the
 *          caller should 404 (the client falls back to its ticker-text chip).
 */
async function fetchLogoBytes(symbol, name) {
  const sym = String(symbol || '').toUpperCase().trim();
  if (!sym) return null;
  if (rawMem.has(sym)) return rawMem.get(sym);

  let url = null;
  try { url = await resolveLogo(sym, name); }
  catch (e) { console.warn('[ticker-logo] resolve', sym, e.message); }
  if (!url) return rawRemember(sym, null);

  try {
    const r = await fetch(url, { headers: { 'User-Agent': UA, Accept: 'image/*' } });
    if (!r.ok) return rawRemember(sym, null);
    const type = String(r.headers.get('content-type') || '').split(';')[0].trim();
    // Commons FilePath can answer with an HTML error page at 200; an <img> of
    // that renders as a broken icon, and caching it would pin the breakage.
    if (!type.startsWith('image/')) return rawRemember(sym, null);
    const buf = Buffer.from(await r.arrayBuffer());
    if (!buf.length || buf.length > RAW_MAX_BYTES) return rawRemember(sym, null);
    return rawRemember(sym, { buf, type });
  } catch (e) {
    console.warn('[ticker-logo] raw', sym, e.message);
    return rawRemember(sym, null);
  }
}

/** Clear a bad/stale entry so the next request re-resolves. */
async function forgetLogo(symbol) {
  const sym = String(symbol || '').toUpperCase().trim();
  mem.delete(sym);
  rawMem.delete(sym);
  if (await ensureSchema()) await getPool().query('DELETE FROM ticker_logos WHERE symbol = $1', [sym]);
}

module.exports = { resolveLogo, fetchLogoBytes, forgetLogo, ensureSchema, getPool };
