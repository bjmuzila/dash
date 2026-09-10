'use strict';
/**
 * server-v2/scheduled-posts-store.js
 *
 * The settings table behind the owner BOT page's "Scheduled" tab: every post
 * this server sends on a timer, editable from the browser instead of the VPS
 * environment.
 *
 * WHY
 *   The scheduled posts each started life reading their own env vars
 *   (ECON_CAL_POST_ET, MG_LADDER_INTERVAL_MIN, ...). Changing when one fires,
 *   or which channel it lands in, meant editing the environment and restarting
 *   the box — which is not a thing to do mid-session because a channel moved.
 *   Same lesson bot-targets-store.js learned about destinations; this is the
 *   same fix applied to schedules.
 *
 * THE MODEL
 *   One row per JOB. A job is a thing the server posts on its own — identified
 *   by a stable id the code knows (`econ-calendar`), not by anything the owner
 *   types. JOB_DEFS below is that registry: it is what the page lists, and a
 *   job with no row yet is seeded from its defaults on first load, so a fresh
 *   box shows the full list rather than an empty table.
 *
 *   Per row: enabled, post_at (HH:MM ET), days, webhook_url, identity
 *   (username / avatar), the message line, and whether to post on a day with
 *   nothing on it. Plus last_run_at / last_status / last_error, written by the
 *   job itself, so the page can say what actually happened without a log dive.
 *
 * SECRECY — same contract as bot-targets-store.js
 *   webhook_url lives here and ONLY here. Every read path a browser can reach
 *   goes through maskUrl(); the client sees the webhook id and the last four
 *   characters of the token, never enough to post. A BLANK url on a write means
 *   "keep what is stored", so the time or the message can be edited without
 *   round-tripping a credential the page was never given. Sending the literal
 *   string "-" clears it (falls back to env).
 *
 * FAIL-SOFT
 *   No DATABASE_URL, dead pool, bad query -> every getJob() falls back to the
 *   job's env vars and its defaults, exactly as before this file existed, and
 *   loadMasked() reports `live:false` so the page can say an edit would not
 *   stick. A scheduled post must never stop working because the settings table
 *   is unreachable.
 */

const CACHE_TTL_MS = Number(process.env.SCHEDULED_POSTS_CACHE_TTL_MS || 10_000);

/**
 * The job registry. Adding a scheduled post to the owner page is an entry here
 * plus a runner in api-router's /api/scheduled-posts/run — nothing else.
 *
 * `envWebhook` is the fallback chain used when the row has no url of its own,
 * and is what every job read before this table existed. Keep a job's historical
 * env vars in it, in their old precedence, or upgrading the box silently
 * re-points a live post at a different channel.
 */
const JOB_DEFS = [
  {
    id: 'econ-calendar',
    label: 'Economic Calendar',
    hint: 'The calendar snapshot image — same picture as the 📅 button on the Economic Calendar toolbar.',
    envWebhook: ['ECON_CAL_DISCORD_WEBHOOK', 'DISCORD_WEBHOOK_URL'],
    defaults: {
      enabled: true,
      postAt: '08:00',
      days: 'mon,tue,wed,thu,fri',
      username: 'CB Edge Signals',
      avatarUrl: '',
      message: '📅 **Economic Calendar** — {date} · {time} ET',
      postEmpty: false,
    },
  },
];

const JOB_IDS = JOB_DEFS.map((j) => j.id);
const byId = (id) => JOB_DEFS.find((j) => j.id === id) || null;

const DAY_KEYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];

// ── PG pool (same defensive shape as bot-targets-store.js) ───────────────────
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
      console.warn('[scheduled-posts] pool error (will reconnect):', e.message);
      try { pool?.end().catch(() => {}); } catch {}
      pool = null; ensured = false;
    });
    return pool;
  } catch (e) {
    console.error('[scheduled-posts] pg unavailable:', e.message);
    pgUnavailable = true; return null;
  }
}

async function ensureSchema() {
  if (ensured) return true;
  const p = getPool();
  if (!p) return false;
  try {
    await p.query(`
      CREATE TABLE IF NOT EXISTS scheduled_posts (
        id          TEXT PRIMARY KEY,
        enabled     BOOLEAN     NOT NULL DEFAULT FALSE,
        post_at     TEXT        NOT NULL DEFAULT '08:00',
        days        TEXT        NOT NULL DEFAULT 'mon,tue,wed,thu,fri',
        webhook_url TEXT        NOT NULL DEFAULT '',
        username    TEXT        NOT NULL DEFAULT '',
        avatar_url  TEXT        NOT NULL DEFAULT '',
        message     TEXT        NOT NULL DEFAULT '',
        post_empty  BOOLEAN     NOT NULL DEFAULT FALSE,
        last_run_at TIMESTAMPTZ,
        last_status TEXT        NOT NULL DEFAULT '',
        last_error  TEXT        NOT NULL DEFAULT '',
        updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `);
    ensured = true;
    return true;
  } catch (e) {
    console.error('[scheduled-posts] ensureSchema error:', e.message);
    return false;
  }
}

// ── Helpers ──────────────────────────────────────────────────────────────────

/** Same mask bot-targets-store uses — enough to tell two webhooks apart. */
function maskUrl(url) {
  if (!url) return '';
  const m = /\/webhooks\/(\d+)\/(.+)$/.exec(url);
  if (!m) return '••••';
  const [, id, token] = m;
  return `${id} · …${token.slice(-4)}`;
}

function validUrl(url) {
  return /^https:\/\/(canary\.|ptb\.)?discord(app)?\.com\/api\/webhooks\/\d+\/[\w-]+$/.test(String(url || '').trim());
}

/** "8:0" / "08:00" / junk -> "08:00". Anything unparseable keeps the default. */
function normalizeTime(raw, fallback = '08:00') {
  const m = String(raw || '').trim().match(/^(\d{1,2}):(\d{2})$/);
  if (!m) return fallback;
  const h = Number(m[1]);
  const mm = Number(m[2]);
  if (h < 0 || h > 23 || mm < 0 || mm > 59) return fallback;
  return `${String(h).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
}

/** Free-form day list -> canonical, ordered, deduped "mon,tue,...". */
function normalizeDays(raw, fallback = 'mon,tue,wed,thu,fri') {
  const want = new Set(
    String(raw || '').toLowerCase().split(/[^a-z]+/).map((s) => s.slice(0, 3)).filter((s) => DAY_KEYS.includes(s)),
  );
  if (want.size === 0) return fallback;
  return DAY_KEYS.filter((d) => want.has(d)).join(',');
}

function envWebhook(def) {
  for (const key of def?.envWebhook || []) {
    const v = (process.env[key] || '').trim();
    if (v) return v;
  }
  return '';
}

/** A job as it looks with nothing stored: defaults + whatever env provides. */
function fallbackJob(def) {
  return {
    id: def.id,
    label: def.label,
    hint: def.hint,
    ...def.defaults,
    webhookUrl: envWebhook(def),
    webhookFromEnv: true,
    lastRunAt: null,
    lastStatus: '',
    lastError: '',
  };
}

function rowToJob(def, row) {
  const stored = (row.webhook_url || '').trim();
  return {
    id: def.id,
    label: def.label,
    hint: def.hint,
    enabled: !!row.enabled,
    postAt: normalizeTime(row.post_at, def.defaults.postAt),
    days: normalizeDays(row.days, def.defaults.days),
    username: row.username || '',
    avatarUrl: row.avatar_url || '',
    message: row.message || def.defaults.message,
    postEmpty: !!row.post_empty,
    // The row's own url wins; env is the fallback, which is what keeps a box
    // that has never opened the page posting exactly where it always did.
    webhookUrl: stored || envWebhook(def),
    webhookFromEnv: !stored,
    lastRunAt: row.last_run_at ? new Date(row.last_run_at).toISOString() : null,
    lastStatus: row.last_status || '',
    lastError: row.last_error || '',
  };
}

// ── Load ─────────────────────────────────────────────────────────────────────

let cache = { at: 0, jobs: null, live: false };

async function loadAll({ fresh = false } = {}) {
  if (!fresh && cache.jobs && Date.now() - cache.at < CACHE_TTL_MS) return cache;

  const ok = await ensureSchema();
  if (!ok) {
    cache = { at: Date.now(), jobs: JOB_DEFS.map(fallbackJob), live: false };
    return cache;
  }
  try {
    const p = getPool();
    // Seed any job the code knows about but the table has never seen, so the
    // page lists every job on a fresh box instead of an empty table.
    for (const def of JOB_DEFS) {
      await p.query(
        `INSERT INTO scheduled_posts (id, enabled, post_at, days, username, avatar_url, message, post_empty)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT (id) DO NOTHING`,
        [def.id, !!def.defaults.enabled, def.defaults.postAt, def.defaults.days,
          def.defaults.username || '', def.defaults.avatarUrl || '', def.defaults.message || '', !!def.defaults.postEmpty],
      );
    }
    const { rows } = await p.query(`SELECT * FROM scheduled_posts WHERE id = ANY($1)`, [JOB_IDS]);
    const map = new Map(rows.map((r) => [r.id, r]));
    cache = {
      at: Date.now(),
      jobs: JOB_DEFS.map((def) => (map.has(def.id) ? rowToJob(def, map.get(def.id)) : fallbackJob(def))),
      live: true,
    };
    return cache;
  } catch (e) {
    console.error('[scheduled-posts] load error:', e.message);
    cache = { at: Date.now(), jobs: JOB_DEFS.map(fallbackJob), live: false };
    return cache;
  }
}

/** Browser-facing: identical shape, webhook replaced by its mask. */
async function loadMasked(opts = {}) {
  const { jobs, live } = await loadAll(opts);
  return {
    live,
    jobs: jobs.map(({ webhookUrl, ...rest }) => ({
      ...rest,
      webhookMask: maskUrl(webhookUrl),
      hasWebhook: !!webhookUrl,
    })),
  };
}

/** Server-side: the full row INCLUDING the real webhook. Never send this out. */
async function getJob(id, opts = {}) {
  const def = byId(id);
  if (!def) return null;
  const { jobs, live } = await loadAll(opts);
  // `live` rides along so a caller can tell "this is what the owner page says"
  // from "the table was unreachable, these are defaults" — the difference
  // decides whether a legacy env var is still allowed to override.
  return { ...(jobs.find((j) => j.id === id) || fallbackJob(def)), live };
}

// ── Save ─────────────────────────────────────────────────────────────────────

/**
 * Patch one job. Only the keys present are written; a blank/absent webhookUrl
 * keeps what is stored, and "-" clears it back to the env fallback.
 */
async function save(patch) {
  const def = byId(String(patch?.id || '').trim());
  if (!def) throw new Error(`Unknown scheduled post "${String(patch?.id || '').slice(0, 40)}"`);
  if (!(await ensureSchema())) throw new Error('Settings table unavailable — check DATABASE_URL');

  const raw = String(patch.webhookUrl ?? '').trim();
  let urlSql = 'webhook_url';           // default: keep
  const vals = [];
  if (raw === '-') {
    urlSql = "''";
  } else if (raw) {
    if (!validUrl(raw)) {
      throw new Error('That does not look like a Discord webhook URL (https://discord.com/api/webhooks/<id>/<token>)');
    }
    vals.push(raw);
    urlSql = `$${vals.length}`;
  }

  const set = (col, v) => { vals.push(v); return `${col} = $${vals.length}`; };
  const parts = [];
  if (patch.enabled !== undefined) parts.push(set('enabled', !!patch.enabled));
  if (patch.postAt !== undefined) parts.push(set('post_at', normalizeTime(patch.postAt, def.defaults.postAt)));
  if (patch.days !== undefined) parts.push(set('days', normalizeDays(patch.days, def.defaults.days)));
  if (patch.username !== undefined) parts.push(set('username', String(patch.username || '').slice(0, 80)));
  if (patch.avatarUrl !== undefined) parts.push(set('avatar_url', String(patch.avatarUrl || '').slice(0, 500)));
  if (patch.message !== undefined) parts.push(set('message', String(patch.message || '').slice(0, 1000)));
  if (patch.postEmpty !== undefined) parts.push(set('post_empty', !!patch.postEmpty));
  parts.push(`webhook_url = ${urlSql}`);
  parts.push('updated_at = NOW()');

  vals.push(def.id);
  await getPool().query(`UPDATE scheduled_posts SET ${parts.join(', ')} WHERE id = $${vals.length}`, vals);
  cache = { at: 0, jobs: null, live: false };
  return loadMasked({ fresh: true });
}

/** Called by the job itself after a run. Best-effort — never throws upward. */
async function markRun(id, { status, error = '' } = {}) {
  if (!byId(id)) return;
  try {
    if (!(await ensureSchema())) return;
    await getPool().query(
      `UPDATE scheduled_posts SET last_run_at = NOW(), last_status = $1, last_error = $2 WHERE id = $3`,
      [String(status || '').slice(0, 40), String(error || '').slice(0, 500), id],
    );
    cache = { at: 0, jobs: null, live: false };
  } catch (e) {
    console.warn('[scheduled-posts] markRun failed:', e.message);
  }
}

module.exports = {
  JOB_DEFS, JOB_IDS, DAY_KEYS,
  maskUrl, validUrl, normalizeTime, normalizeDays,
  loadMasked, getJob, save, markRun,
};
