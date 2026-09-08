'use strict';
/**
 * server-v2/bot-targets-store.js
 *
 * The Discord routing table behind the owner BOT page.
 *
 * WHY THIS EXISTS
 *   The first cut keyed destinations off numbered env vars
 *   (DISCORD_WEBHOOK_1_URL...). That models "one Discord, one channel" and
 *   nothing else — and the real shape is not that. Some servers take everything
 *   in a single channel; Bzila's own has FOUR channels with a webhook each, one
 *   per asset class. An env list cannot express "options goes here, futures goes
 *   there, and this other server takes the lot in one room", and even if it
 *   could, changing it would mean editing the VPS environment and restarting —
 *   which is not a thing to do mid-session because a channel moved.
 *
 * THE MODEL — two levels, and the second one is the point
 *   A DISCORD is a destination the composer offers (a server, named by you).
 *   A ROUTE is where one asset class lands inside it: (discord, asset_class) ->
 *   webhook URL + optional role ping.
 *
 *   asset_class is 'options' | 'futures' | 'notes' | 'equity' | 'default'.
 *   Resolution is exactly one fallback deep:
 *
 *       routeFor(discord, 'options')  ->  routes['options'] ?? routes['default']
 *
 *   So the three real cases each have an obvious encoding:
 *     · one channel for everything      -> set 'default' only
 *     · a channel per class (Bzila's)   -> set all four, no 'default'
 *     · mostly one, options split out   -> set 'default' + 'options'
 *
 *   A discord with NO usable route for the class being sent is not a silent
 *   no-op: resolve() reports it, and the composer greys the destination out
 *   before you can pick it.
 *
 * SECRECY
 *   Webhook URLs live here and ONLY here. Every read path that a browser can
 *   reach goes through maskUrl() — the client sees the webhook id and the last
 *   four characters of the token, never enough to post. A blank url on a write
 *   means "keep what's stored", so the owner page can edit a label or a ping
 *   without round-tripping a credential it was never given.
 *
 * FAIL-SOFT, same contract as roster-store.js
 *   No DATABASE_URL, dead pool, bad query -> fall back to the numbered env vars
 *   as single-'default'-route discords. That keeps the page working on a fresh
 *   box before anything is configured, and it is why the env scheme is still
 *   read at all. `live:false` on the payload tells the owner page it is looking
 *   at env, not the DB, so an edit there would not stick.
 */

const ASSET_CLASSES = ['options', 'futures', 'notes', 'equity'];
const ROUTE_KEYS = [...ASSET_CLASSES, 'default'];
const WEBHOOK_SLOTS = 8;
const CACHE_TTL_MS = Number(process.env.BOT_TARGETS_CACHE_TTL_MS || 10_000);

// ── PG pool (same defensive shape as roster-store.js) ────────────────────────
let pool = null;
let pgUnavailable = false;
let ensured = false;

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
      max: 2, keepAlive: true,
    });
    pool.on('error', (e) => {
      console.warn('[bot-targets] pool error (will reconnect):', e.message);
      try { pool?.end().catch(() => {}); } catch {}
      pool = null; ensured = false;
    });
    return pool;
  } catch (e) {
    console.error('[bot-targets] pg unavailable:', e.message);
    pgUnavailable = true; return null;
  }
}

async function ensureSchema() {
  if (ensured) return true;
  const p = getPool();
  if (!p) return false;
  try {
    await p.query(`
      CREATE TABLE IF NOT EXISTS bot_discords (
        id         TEXT PRIMARY KEY,
        label      TEXT        NOT NULL,
        enabled    BOOLEAN     NOT NULL DEFAULT TRUE,
        sort_idx   INTEGER     NOT NULL DEFAULT 0,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      CREATE TABLE IF NOT EXISTS bot_routes (
        discord_id  TEXT NOT NULL,
        asset_class TEXT NOT NULL,
        webhook_url TEXT NOT NULL,
        ping        TEXT NOT NULL DEFAULT '',
        updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        PRIMARY KEY (discord_id, asset_class)
      );
      CREATE INDEX IF NOT EXISTS idx_bot_routes_discord ON bot_routes(discord_id);
    `);
    ensured = true;
    return true;
  } catch (e) {
    console.error('[bot-targets] ensureSchema error:', e.message);
    return false;
  }
}

// ── Helpers ──────────────────────────────────────────────────────────────────

/** Slug from a label. Stable id so routes survive a rename. */
function slug(s) {
  return String(s || '').toLowerCase().trim()
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || `d${Date.now().toString(36)}`;
}

/**
 * "https://discord.com/api/webhooks/154692.../lrEzTG...gv9Wu" -> what the client
 * is allowed to see. Enough to tell two webhooks apart, useless for posting.
 */
function maskUrl(url) {
  if (!url) return '';
  const m = /\/webhooks\/(\d+)\/(.+)$/.exec(url);
  if (!m) return '••••';
  const [, id, token] = m;
  return `${id} · …${token.slice(-4)}`;
}

/** Reject anything that is not a real Discord webhook before it is stored. */
function validUrl(url) {
  return /^https:\/\/(canary\.|ptb\.)?discord(app)?\.com\/api\/(v\d+\/)?webhooks\/\d+\/[\w-]+$/.test(String(url || '').trim());
}

const isClassKey = (k) => ROUTE_KEYS.includes(k);

// ── Env fallback ─────────────────────────────────────────────────────────────
/**
 * The pre-DB shape: DISCORD_WEBHOOK_<n>_URL/_LABEL/_PING, each one a discord
 * with a single 'default' route. Read only when the DB has nothing to say.
 */
function envDiscords() {
  const out = [];
  for (let i = 1; i <= WEBHOOK_SLOTS; i++) {
    const url = (process.env[`DISCORD_WEBHOOK_${i}_URL`] || '').trim();
    if (!url) continue;
    out.push({
      id: String(i),
      label: (process.env[`DISCORD_WEBHOOK_${i}_LABEL`] || `Discord ${i}`).trim(),
      enabled: true,
      sortIdx: i,
      routes: { default: { url, ping: (process.env[`DISCORD_WEBHOOK_${i}_PING`] || '').trim() } },
    });
  }
  return out;
}

// ── Load ─────────────────────────────────────────────────────────────────────
let cache = null; // { at, live, discords }

/** Full config WITH secrets. Server-side only — never hand this to a response. */
async function loadRaw({ fresh = false } = {}) {
  if (!fresh && cache && Date.now() - cache.at < CACHE_TTL_MS) return cache;

  const p = getPool();
  if (p && (await ensureSchema())) {
    try {
      const [d, r] = await Promise.all([
        p.query('SELECT id, label, enabled, sort_idx FROM bot_discords ORDER BY sort_idx, label'),
        p.query('SELECT discord_id, asset_class, webhook_url, ping FROM bot_routes'),
      ]);
      if (d.rows.length) {
        const byId = new Map(d.rows.map((row) => [row.id, {
          id: row.id, label: row.label, enabled: !!row.enabled, sortIdx: row.sort_idx, routes: {},
        }]));
        for (const row of r.rows) {
          const disc = byId.get(row.discord_id);
          if (disc && isClassKey(row.asset_class)) {
            disc.routes[row.asset_class] = { url: row.webhook_url, ping: row.ping || '' };
          }
        }
        cache = { at: Date.now(), live: true, discords: [...byId.values()] };
        return cache;
      }
      // Table exists but is empty — fall through to env so a fresh box works.
    } catch (e) {
      console.error('[bot-targets] load error:', e.message);
    }
  }

  cache = { at: Date.now(), live: false, discords: envDiscords() };
  return cache;
}

/** Client-safe view: masked URLs, nothing that can post. */
async function loadMasked(opts) {
  const { live, discords } = await loadRaw(opts);
  return {
    live,
    classes: ASSET_CLASSES,
    discords: discords.map((d) => ({
      id: d.id,
      label: d.label,
      enabled: d.enabled,
      sortIdx: d.sortIdx,
      routes: Object.fromEntries(
        Object.entries(d.routes).map(([k, v]) => [k, { masked: maskUrl(v.url), ping: v.ping || '' }]),
      ),
    })),
  };
}

/**
 * What the COMPOSER needs: enabled destinations plus, per asset class, whether
 * this discord can actually take one. The composer greys out a destination with
 * no channel for the selected class rather than letting you send into nothing.
 */
async function loadTargets() {
  const { live, discords } = await loadRaw();
  return {
    live,
    targets: discords.filter((d) => d.enabled).map((d) => ({
      id: d.id,
      label: d.label,
      accepts: Object.fromEntries(
        ASSET_CLASSES.map((c) => [c, !!(d.routes[c] || d.routes.default)]),
      ),
    })),
  };
}

/**
 * Destination + asset class -> the webhook that should receive it.
 * Exactly one fallback: the class's own route, else 'default', else null.
 */
async function resolve(ids, assetClass) {
  const { discords } = await loadRaw();
  const want = new Set((ids || []).map(String));
  const cls = ASSET_CLASSES.includes(assetClass) ? assetClass : 'notes';
  return discords
    .filter((d) => want.has(d.id) && d.enabled)
    .map((d) => {
      const route = d.routes[cls] || d.routes.default || null;
      return route
        ? { id: d.id, label: d.label, url: route.url, ping: route.ping || '' }
        : { id: d.id, label: d.label, url: null, error: `No ${cls} channel mapped for ${d.label}` };
    });
}

// ── Writes ───────────────────────────────────────────────────────────────────

/**
 * Upsert one discord and its routes.
 *
 * A route's `url` is three-valued on purpose:
 *   omitted / ''  -> KEEP whatever is stored (the client never had the secret)
 *   a valid URL   -> replace it
 *   null          -> delete that route
 */
async function saveDiscord(input) {
  const p = getPool();
  if (!p || !(await ensureSchema())) throw new Error('Config storage unavailable (no DATABASE_URL)');

  const label = String(input?.label || '').trim();
  if (!label) throw new Error('Label is required');
  const id = String(input?.id || '').trim() || slug(label);
  const enabled = input?.enabled !== false;
  const sortIdx = Number.isFinite(Number(input?.sortIdx)) ? Number(input.sortIdx) : 0;

  const routes = input?.routes && typeof input.routes === 'object' ? input.routes : {};
  for (const [k, v] of Object.entries(routes)) {
    if (!isClassKey(k)) throw new Error(`Unknown route key: ${k}`);
    if (v && typeof v.url === 'string' && v.url.trim() && !validUrl(v.url)) {
      throw new Error(`${k}: that does not look like a Discord webhook URL`);
    }
  }

  const client = await p.connect();
  try {
    await client.query('BEGIN');
    await client.query(
      `INSERT INTO bot_discords (id, label, enabled, sort_idx) VALUES ($1,$2,$3,$4)
       ON CONFLICT (id) DO UPDATE SET label=EXCLUDED.label, enabled=EXCLUDED.enabled, sort_idx=EXCLUDED.sort_idx`,
      [id, label, enabled, sortIdx],
    );
    for (const [cls, v] of Object.entries(routes)) {
      if (v === null || v?.url === null) {
        await client.query('DELETE FROM bot_routes WHERE discord_id=$1 AND asset_class=$2', [id, cls]);
        continue;
      }
      const url = typeof v?.url === 'string' ? v.url.trim() : '';
      const ping = typeof v?.ping === 'string' ? v.ping.trim() : '';
      if (url) {
        await client.query(
          `INSERT INTO bot_routes (discord_id, asset_class, webhook_url, ping, updated_at)
           VALUES ($1,$2,$3,$4,NOW())
           ON CONFLICT (discord_id, asset_class)
           DO UPDATE SET webhook_url=EXCLUDED.webhook_url, ping=EXCLUDED.ping, updated_at=NOW()`,
          [id, cls, url, ping],
        );
      } else {
        // Ping-only edit: touch nothing if the route does not exist yet.
        await client.query(
          'UPDATE bot_routes SET ping=$3, updated_at=NOW() WHERE discord_id=$1 AND asset_class=$2',
          [id, cls, ping],
        );
      }
    }
    await client.query('COMMIT');
  } catch (e) {
    try { await client.query('ROLLBACK'); } catch {}
    throw e;
  } finally {
    client.release();
  }

  cache = null;
  return id;
}

async function deleteDiscord(id) {
  const p = getPool();
  if (!p || !(await ensureSchema())) throw new Error('Config storage unavailable (no DATABASE_URL)');
  await p.query('DELETE FROM bot_routes WHERE discord_id=$1', [id]);
  await p.query('DELETE FROM bot_discords WHERE id=$1', [id]);
  cache = null;
}

/**
 * One-time lift of the numbered env vars into the table, so the existing
 * DISCORD_WEBHOOK_<n>_* setup becomes editable rows instead of having to be
 * retyped. No-op once any row exists — it will not clobber edited config.
 */
async function importFromEnv() {
  const p = getPool();
  if (!p || !(await ensureSchema())) throw new Error('Config storage unavailable (no DATABASE_URL)');
  const existing = await p.query('SELECT COUNT(*)::int AS n FROM bot_discords');
  if (existing.rows[0]?.n > 0) return { imported: 0, skipped: 'config already exists' };
  const rows = envDiscords();
  for (const d of rows) {
    await saveDiscord({ id: slug(d.label), label: d.label, enabled: true, sortIdx: d.sortIdx, routes: d.routes });
  }
  cache = null;
  return { imported: rows.length };
}

module.exports = {
  ASSET_CLASSES,
  ROUTE_KEYS,
  maskUrl,
  validUrl,
  loadMasked,
  loadTargets,
  resolve,
  saveDiscord,
  deleteDiscord,
  importFromEnv,
};
