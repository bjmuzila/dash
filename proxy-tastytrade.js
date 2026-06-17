/**
 * proxy-tastytrade.js  —  complete rewrite
 * TastyTrade API proxy + dxLink WebSocket bridge
 *
 * Endpoints:
 *   GET  /proxy/api/auto-connect        check/refresh auth
 *   GET  /proxy/api/tt/quote/:symbol    market-metrics
 *   GET  /proxy/api/tt/chains/:symbol   option-chains nested
 *   POST /proxy/dxlink/subscribe        add symbols { symbols:[] }
 *   GET  /proxy/api/status              debug info
 *   WS   /ws/dxlink                     relay FEED_DATA to browsers
 */
'use strict';

require('dotenv').config();

const http      = require('http');
const https     = require('https');
const fs        = require('fs');
const path      = require('path');
const { URL }   = require('url');
const { spawn }  = require('child_process');
const WebSocket = require('ws');
// const Database  = require('better-sqlite3');  // Optional - comment out if build fails

// ─── Config ──────────────────────────────────────────────────────────────────
const PORT           = parseInt(process.env.PORT || '3001', 10);
const TOKEN_FILE     = path.join(__dirname, 'tastytrade_token.json');
const SCHWAB_TOKEN_FILE = path.join(__dirname, '.schwab_tokens.json');
const BACKUP_DIR     = path.join(__dirname, 'data');
const DB_FILE        = path.join(__dirname, 'data', 'trading.db');
const BUY_SELL_BACKUP_FILE = path.join(BACKUP_DIR, 'buy-sell-scores.json');
const DAILY_CLOSES_FILE    = path.join(BACKUP_DIR, 'daily-closes.json');
const REFRESH_ENV    = process.env.REFRESH_TOKEN || process.env.TT_REFRESH_TOKEN || '';
const CLIENT_SECRET  = process.env.CLIENT_SECRET  || process.env.TT_CLIENT_SECRET || '';
const SCHWAB_CLIENT_ID = process.env.SCHWAB_CLIENT_ID || 'REDACTED';
const SCHWAB_CLIENT_SECRET = process.env.SCHWAB_CLIENT_SECRET || 'REDACTED';
const SCHWAB_BASE   = 'api.schwabapi.com';
const DISCORD_WEBHOOK_URL = process.env.DISCORD_WEBHOOK_URL || 'https://discord.com/api/webhooks/1466249857122570454/REDACTED';

// Google OAuth — token stored in google_token.json after first auth
const GOOGLE_TOKEN_FILE     = path.join(__dirname, 'google_token.json');
const GOOGLE_CREDENTIALS_FILE = path.join(__dirname, 'google_credentials.json');
const GOOGLE_SCOPES         = 'https://www.googleapis.com/auth/spreadsheets';

// ─── State ───────────────────────────────────────────────────────────────────
let accessToken  = null;
let refreshToken = null;
let tokenExpiry  = 0;
let schwabAccessToken  = null;
let schwabRefreshToken = null;
let schwabTokenExpiry  = 0;

// ─── OPTION CHAIN CACHE (IN-MEMORY + SQLite) ──────────────────────────────────
// Caches fetched option chains to eliminate redundant TT API calls and subscriptions
// TTL: 1 hour per symbol (or 10 min if no explicit expiration)
const chainCache = new Map();
const CHAIN_CACHE_TTL_MS = 30000;  // 30 sec for explicit expiration (short-dated options change fast)
const CHAIN_CACHE_TTL_DEFAULT_MS = 30000;  // 30 sec for default (nearest) expirations

function getChainsFromCache(symbol, expiration) {
  const key = `${symbol.toUpperCase()}:${expiration || 'DEFAULT'}`;
  const ttl = expiration ? CHAIN_CACHE_TTL_MS : CHAIN_CACHE_TTL_DEFAULT_MS;

  // Check in-memory cache first
  const cached = chainCache.get(key);
  if (cached) {
    const age = Date.now() - cached.timestamp;
    if (age <= ttl) {
      log(`[CACHE HIT] ${key} (${Math.round(age / 1000)}s old, ${chainCacheItemCount(cached.data)} expirations)`);
      return cached.data;
    }
    chainCache.delete(key);
  }

  // Check SQLite if DB ready
  if (db) {
    try {
      const row = db.prepare('SELECT data, timestamp FROM chains_cache WHERE symbol = ? AND expiration = ?').get(symbol.toUpperCase(), expiration || 'DEFAULT');
      if (row) {
        const age = Date.now() - row.timestamp;
        if (age <= ttl) {
          const data = JSON.parse(row.data);
          // Restore to in-memory cache for next access
          chainCache.set(key, { timestamp: row.timestamp, data });
          log(`[CACHE HIT-DB] ${key} (${Math.round(age / 1000)}s old, ${chainCacheItemCount(data)} expirations)`);
          return data;
        } else {
          db.prepare('DELETE FROM chains_cache WHERE symbol = ? AND expiration = ?').run(symbol.toUpperCase(), expiration || 'DEFAULT');
        }
      }
    } catch (e) {
      console.warn('[CACHE] SQLite read error:', e.message);
    }
  }

  return null;
}

function chainCacheItemCount(data) {
  return Array.isArray(data) ? data.length : Array.isArray(data?.items) ? data.items.length : 0;
}

function setChainsInCache(symbol, expiration, strikeData) {
  const key = `${symbol.toUpperCase()}:${expiration || 'DEFAULT'}`;
  const timestamp = Date.now();

  // Store in-memory
  chainCache.set(key, { timestamp, data: strikeData });

  // Store in SQLite if ready
  if (db) {
    try {
      const data = JSON.stringify(strikeData);
      db.prepare(`
        INSERT OR REPLACE INTO chains_cache (symbol, expiration, data, timestamp)
        VALUES (?, ?, ?, ?)
      `).run(symbol.toUpperCase(), expiration || 'DEFAULT', data, timestamp);
      log(`[CACHE SET-DB] ${key} (${chainCacheItemCount(strikeData)} expirations)`);
    } catch (e) {
      console.warn('[CACHE] SQLite write error:', e.message);
    }
  } else {
    log(`[CACHE SET] ${key} (${chainCacheItemCount(strikeData)} expirations, DB not ready)`);
  }
}

function ensureBackupDir() {
  if (!fs.existsSync(BACKUP_DIR)) fs.mkdirSync(BACKUP_DIR, { recursive: true });
}

// ─── SQLite DB ────────────────────────────────────────────────────────────────
let db = null;

function initDB() {
  ensureBackupDir();
  db = new Database(DB_FILE);
  db.pragma('journal_mode = WAL');  // safe concurrent reads
  db.pragma('synchronous = NORMAL');

  db.exec(`
    CREATE TABLE IF NOT EXISTS chains_cache (
      symbol      TEXT NOT NULL,
      expiration  TEXT NOT NULL,
      data        TEXT NOT NULL,
      timestamp   INTEGER NOT NULL,
      PRIMARY KEY (symbol, expiration)
    );
    CREATE INDEX IF NOT EXISTS idx_chains_ts ON chains_cache(timestamp);

    CREATE TABLE IF NOT EXISTS mvc (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      timestamp   INTEGER NOT NULL,
      date        TEXT NOT NULL,
      triggerType TEXT NOT NULL,
      data        TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_mvc_date ON mvc(date);
    CREATE INDEX IF NOT EXISTS idx_mvc_ts ON mvc(timestamp);

    CREATE TABLE IF NOT EXISTS premium_flow (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      timestamp   INTEGER NOT NULL,
      date        TEXT NOT NULL,
      ticker      TEXT NOT NULL,
      data        TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_pf_ticker ON premium_flow(ticker);
    CREATE INDEX IF NOT EXISTS idx_pf_date ON premium_flow(date);

    CREATE TABLE IF NOT EXISTS chain_snapshots (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      timestamp   INTEGER NOT NULL,
      date        TEXT NOT NULL,
      symbol      TEXT NOT NULL,
      data        TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_cs_date ON chain_snapshots(date);
    CREATE INDEX IF NOT EXISTS idx_cs_symbol ON chain_snapshots(symbol);

    CREATE TABLE IF NOT EXISTS greeks_history (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      timestamp   INTEGER NOT NULL,
      strike      REAL NOT NULL,
      expiration  TEXT NOT NULL,
      data        TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_gh_strike_exp ON greeks_history(strike, expiration);

    CREATE TABLE IF NOT EXISTS multi_stock_flow (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      timestamp   INTEGER NOT NULL,
      date        TEXT NOT NULL,
      stock       TEXT NOT NULL,
      dte         INTEGER NOT NULL,
      data        TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_msf_stock_dte ON multi_stock_flow(stock, dte);
    CREATE INDEX IF NOT EXISTS idx_msf_date ON multi_stock_flow(date);

    CREATE TABLE IF NOT EXISTS greeks_time_series (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      timestamp   INTEGER NOT NULL,
      date        TEXT NOT NULL,
      ticker      TEXT NOT NULL,
      data        TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_gts_ticker ON greeks_time_series(ticker);
    CREATE INDEX IF NOT EXISTS idx_gts_date ON greeks_time_series(date);

    CREATE TABLE IF NOT EXISTS big_trades (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      timestamp   INTEGER NOT NULL,
      date        TEXT NOT NULL,
      ticker      TEXT NOT NULL,
      data        TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_bt_ticker ON big_trades(ticker);
    CREATE INDEX IF NOT EXISTS idx_bt_date ON big_trades(date);

    CREATE TABLE IF NOT EXISTS es_15m_candles (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      timestamp   INTEGER NOT NULL,
      date        TEXT NOT NULL,
      slot_key    TEXT NOT NULL UNIQUE,
      data        TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_ec_date ON es_15m_candles(date);
    CREATE INDEX IF NOT EXISTS idx_ec_slotkey ON es_15m_candles(slot_key);

    CREATE TABLE IF NOT EXISTS gex_top3 (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      timestamp   INTEGER NOT NULL,
      date        TEXT NOT NULL,
      ticker      TEXT NOT NULL,
      data        TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_gt_ticker ON gex_top3(ticker);
    CREATE INDEX IF NOT EXISTS idx_gt_date ON gex_top3(date);

    CREATE TABLE IF NOT EXISTS bzila_live_snapshots (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      timestamp   INTEGER NOT NULL,
      date        TEXT NOT NULL,
      ticker      TEXT NOT NULL,
      data        TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_bls_ticker ON bzila_live_snapshots(ticker);
    CREATE INDEX IF NOT EXISTS idx_bls_date ON bzila_live_snapshots(date);

    CREATE TABLE IF NOT EXISTS greeks_intraday (
      id        INTEGER PRIMARY KEY AUTOINCREMENT,
      ts        INTEGER NOT NULL,
      date      TEXT    NOT NULL,
      time      TEXT    NOT NULL,
      gex       REAL    NOT NULL,
      dex       REAL    NOT NULL,
      chex      REAL    NOT NULL,
      vex       REAL    NOT NULL,
      buy_pct   REAL    NOT NULL DEFAULT 0,
      spot      REAL    NOT NULL DEFAULT 0
    );
    CREATE INDEX IF NOT EXISTS idx_greeks_date ON greeks_intraday(date);

    CREATE TABLE IF NOT EXISTS buy_sell_scores (
      id        INTEGER PRIMARY KEY AUTOINCREMENT,
      ts        INTEGER NOT NULL,
      date      TEXT    NOT NULL,
      time      TEXT    NOT NULL,
      slot_key  TEXT    NOT NULL UNIQUE,
      spx_price REAL    NOT NULL DEFAULT 0,
      side      TEXT    NOT NULL DEFAULT 'Buy',
      score     REAL    NOT NULL DEFAULT 0,
      buy_pct   REAL    NOT NULL DEFAULT 0,
      sell_pct  REAL    NOT NULL DEFAULT 0,
      gex       REAL    NOT NULL DEFAULT 0,
      dex       REAL    NOT NULL DEFAULT 0,
      chex      REAL    NOT NULL DEFAULT 0,
      vex       REAL    NOT NULL DEFAULT 0
    );
    CREATE INDEX IF NOT EXISTS idx_bss_date ON buy_sell_scores(date);

    CREATE TABLE IF NOT EXISTS gex_levels (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      ts         INTEGER NOT NULL,
      date       TEXT    NOT NULL,
      call_wall  REAL    NOT NULL DEFAULT 0,
      put_wall   REAL    NOT NULL DEFAULT 0,
      zero_gamma REAL    NOT NULL DEFAULT 0,
      spot       REAL    NOT NULL DEFAULT 0,
      es_spot    REAL    NOT NULL DEFAULT 0
    );
    CREATE INDEX IF NOT EXISTS idx_gex_date ON gex_levels(date);
  `);

  log('[DB] SQLite initialized at', DB_FILE);
}

// ── Prepared statements (lazy, created after initDB) ─────────────────────────
let _stmts = null;
function stmts() {
  if (_stmts) return _stmts;
  _stmts = {
    insertGreeks: db.prepare(`
      INSERT INTO greeks_intraday (ts, date, time, gex, dex, chex, vex, buy_pct, spot)
      VALUES (@ts, @date, @time, @gex, @dex, @chex, @vex, @buy_pct, @spot)
    `),
    queryGreeksByDate: db.prepare(`
      SELECT * FROM greeks_intraday WHERE date = ? ORDER BY ts ASC
    `),
    queryGreeksRange: db.prepare(`
      SELECT * FROM greeks_intraday WHERE ts >= ? ORDER BY ts ASC
    `),
    insertBSS: db.prepare(`
      INSERT INTO buy_sell_scores
        (ts, date, time, slot_key, spx_price, side, score, buy_pct, sell_pct, gex, dex, chex, vex)
      VALUES
        (@ts, @date, @time, @slot_key, @spx_price, @side, @score, @buy_pct, @sell_pct, @gex, @dex, @chex, @vex)
      ON CONFLICT(slot_key) DO UPDATE SET
        ts=excluded.ts, spx_price=excluded.spx_price, side=excluded.side,
        score=excluded.score, buy_pct=excluded.buy_pct, sell_pct=excluded.sell_pct,
        gex=excluded.gex, dex=excluded.dex, chex=excluded.chex, vex=excluded.vex
    `),
    queryBSSByDate: db.prepare(`
      SELECT * FROM buy_sell_scores WHERE date = ? ORDER BY ts ASC
    `),
    insertGexLevel: db.prepare(`
      INSERT INTO gex_levels (ts, date, call_wall, put_wall, zero_gamma, spot, es_spot)
      VALUES (@ts, @date, @call_wall, @put_wall, @zero_gamma, @spot, @es_spot)
    `),
    deleteOldRecords: db.prepare(`
      DELETE FROM greeks_intraday WHERE date < ?
    `),
    deleteOldBSS: db.prepare(`
      DELETE FROM buy_sell_scores WHERE date < ?
    `),
    deleteOldGex: db.prepare(`
      DELETE FROM gex_levels WHERE date < ?
    `),
  };
  return _stmts;
}

function dbEtDate(nowMs) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit'
  }).formatToParts(new Date(nowMs || Date.now()));
  const m = Object.fromEntries(parts.filter(p => p.type !== 'literal').map(p => [p.type, p.value]));
  return `${m.year}-${m.month}-${m.day}`;
}

function dbInsertGreeks(snapshot) {
  if (!db) return;
  try {
    stmts().insertGreeks.run({
      ts: snapshot.ts, date: dbEtDate(snapshot.ts), time: snapshot.time,
      gex: snapshot.gex, dex: snapshot.dex, chex: snapshot.chex, vex: snapshot.vex,
      buy_pct: snapshot.buyPct || 0, spot: snapshot.spot || 0,
    });
  } catch (e) {
    if (!e.message.includes('UNIQUE')) log('[DB] insertGreeks error:', e.message);
  }
}

function dbInsertBSS(record) {
  if (!db) return;
  try {
    stmts().insertBSS.run({
      ts: Number(record.timestamp || Date.now()),
      date: String(record.date || dbEtDate()),
      time: String(record.time || ''),
      slot_key: String(record.slotKey),
      spx_price: Number(record.spxPrice || 0),
      side: String(record.side || 'Buy'),
      score: Number(record.score || 0),
      buy_pct: Number(record.buyPct || 0),
      sell_pct: Number(record.sellPct || 0),
      gex: Number(record.gex || 0),
      dex: Number(record.dex || 0),
      chex: Number(record.chex || 0),
      vex: Number(record.vex || 0),
    });
  } catch (e) {
    log('[DB] insertBSS error:', e.message);
  }
}

function dbInsertGexLevel(levels) {
  if (!db) return;
  try {
    stmts().insertGexLevel.run({
      ts: Date.now(), date: dbEtDate(),
      call_wall: levels.callWall || 0, put_wall: levels.putWall || 0,
      zero_gamma: levels.zeroGamma || 0, spot: levels.spot || 0, es_spot: levels.esSpot || 0,
    });
  } catch (e) {
    log('[DB] insertGexLevel error:', e.message);
  }
}

// Nightly clear: delete records older than today (runs at 4:05am ET)
function scheduleNightlyClear() {
  function msUntilNext405amET() {
    const now = new Date();
    const etStr = new Date(now.toLocaleString('en-US', { timeZone: 'America/New_York' }));
    const target = new Date(etStr);
    target.setHours(4, 5, 0, 0);
    if (etStr >= target) target.setDate(target.getDate() + 1);
    return target - etStr;
  }
  function doClear() {
    const today = dbEtDate();
    if (!db) return;
    try {
      const s = stmts();
      s.deleteOldRecords.run(today);
      s.deleteOldBSS.run(today);
      s.deleteOldGex.run(today);

      // Delete old records from new IndexedDB-replacement tables
      const tablesToClean = ['mvc','premium_flow','chain_snapshots','multi_stock_flow','greeks_time_series','big_trades','es_15m_candles','gex_top3','bzila_live_snapshots'];
      for (const tbl of tablesToClean) {
        try {
          db.prepare(`DELETE FROM ${tbl} WHERE date < ?`).run(today);
        } catch (e) {
          // Table may not exist yet, ignore
        }
      }

      log('[DB] Nightly clear complete — kept date:', today);
    } catch (e) {
      log('[DB] Nightly clear error:', e.message);
    }
    setTimeout(() => { doClear(); setTimeout(doClear, 24 * 60 * 60 * 1000); }, msUntilNext405amET());
  }
  setTimeout(doClear, msUntilNext405amET());
  log('[DB] Nightly clear scheduled, next run in', Math.round(msUntilNext405amET() / 60000), 'minutes');
}

function readBuySellBackup() {
  ensureBackupDir();
  if (!fs.existsSync(BUY_SELL_BACKUP_FILE)) return [];
  try {
    const data = JSON.parse(fs.readFileSync(BUY_SELL_BACKUP_FILE, 'utf8'));
    return Array.isArray(data) ? data : [];
  } catch (err) {
    return [];
  }
}

function writeBuySellBackup(records) {
  ensureBackupDir();
  fs.writeFileSync(BUY_SELL_BACKUP_FILE, JSON.stringify(records, null, 2));
}

function readRequestJson(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', chunk => {
      body += chunk;
      if (body.length > 1024 * 1024) {
        reject(new Error('Request body too large'));
        req.destroy();
      }
    });
    req.on('end', () => {
      try {
        resolve(body ? JSON.parse(body) : {});
      } catch (err) {
        reject(err);
      }
    });
    req.on('error', reject);
  });
}

// ─── Google OAuth helpers ─────────────────────────────────────────────────────
let googleAccessToken  = null;
let googleTokenExpiry  = 0;

async function getGoogleAccessToken() {
  // Return cached token if still valid (5 min buffer)
  if (googleAccessToken && Date.now() < googleTokenExpiry - 300000) {
    return googleAccessToken;
  }

  // Read stored token file
  if (!fs.existsSync(GOOGLE_TOKEN_FILE)) {
    throw new Error('google_token.json not found — run node google-auth.js first');
  }

  const stored = JSON.parse(fs.readFileSync(GOOGLE_TOKEN_FILE, 'utf8'));

  // If access token still valid, use it
  if (stored.access_token && stored.expiry_date && Date.now() < stored.expiry_date - 300000) {
    googleAccessToken = stored.access_token;
    googleTokenExpiry = stored.expiry_date;
    return googleAccessToken;
  }

  // Refresh using refresh_token
  if (!stored.refresh_token) throw new Error('No refresh_token in google_token.json');

  if (!fs.existsSync(GOOGLE_CREDENTIALS_FILE)) {
    throw new Error('google_credentials.json not found');
  }
  const creds = JSON.parse(fs.readFileSync(GOOGLE_CREDENTIALS_FILE, 'utf8'));
  const { client_id, client_secret } = creds.installed || creds.web || {};
  if (!client_id || !client_secret) throw new Error('Invalid google_credentials.json');

  const body = new URLSearchParams({
    client_id, client_secret,
    refresh_token: stored.refresh_token,
    grant_type: 'refresh_token'
  }).toString();

  const newToken = await new Promise((resolve, reject) => {
    const req = https.request({
      hostname: 'oauth2.googleapis.com',
      path: '/token',
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'Content-Length': Buffer.byteLength(body) }
    }, res => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        try { resolve(JSON.parse(data)); } catch(e) { reject(e); }
      });
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });

  if (!newToken.access_token) throw new Error('Google token refresh failed: ' + JSON.stringify(newToken));

  // Save updated token
  stored.access_token = newToken.access_token;
  stored.expiry_date  = Date.now() + (newToken.expires_in * 1000);
  fs.writeFileSync(GOOGLE_TOKEN_FILE, JSON.stringify(stored, null, 2));

  googleAccessToken = stored.access_token;
  googleTokenExpiry = stored.expiry_date;
  log('Google token refreshed');
  return googleAccessToken;
}


let dxSocket         = null;
let dxQuoteToken     = null;
let dxWssUrl         = null;
let dxAuthorized     = false;
let dxChannelOpen    = false;
let keepAliveInterval= null;
const DX_CHANNEL     = 1;          // AUTO channel for Quote/Trade/Greeks/Summary
const DX_CHANNEL_HISTORY = 3;      // HISTORY channel for Candle (time-series)
const MAX_DXLINK_AUTO_SYMBOLS = 2000;
let dxHistoryChannelOpen = false;
let dxHistoryConfigured = false;

// ── Subscription rate-limiting ──────────────────────────────────────────
const subscriptionQueue = [];
let subscriptionSending = false;
const queuedSubscriptionKeys = new Set();
const activeAutoSubscriptionKeys = new Set();
const activeCandleSubscriptionKeys = new Set();
const SUBSCRIPTION_BATCH_SIZE = 50;     // dxLink limit ~100, use 50 to be safe
const SUBSCRIPTION_BATCH_DELAY_BASE = 1000;  // 1 second between batches
const SUBSCRIPTION_BATCH_DELAY_MAX = 5000;   // 5 second max backoff
let subscriptionBatchDelay = SUBSCRIPTION_BATCH_DELAY_BASE;
let subscriptionErrorCount = 0;
let pendingNewSubscriptions = false;  // Track if there are new subscriptions to send

// ─── Subscription Lifecycle Tracking ─────────────────────────────────────
const subscriptionCreatedAt = new Map(); // symbol → creation timestamp
const IDLE_SUBSCRIPTION_MAX_AGE_MS = 30 * 60 * 1000; // 30 minutes
const PRUNE_INTERVAL_MS = 10 * 60 * 1000; // Check every 10 minutes

const CORE_LIVE_SUBSCRIPTIONS = new Set([
  'SPX',
  'VIX',
  'NDX',
  'SPY',
  'QQQ',
  'AAPL',
  'AMD',
  'AMZN',
  'GOOGL',
  'META',
  'MSFT',
  'NVDA',
  'SPCX',
  'TSLA',
  'SMH',
  '/ESU26',
  '/ESU6',
  '/ES:XCME',
  '/NQ:XCME',
  'US10Y',
  '2YY',
  '2Y',
  '/2YY',
  'TNX',
  '^TNX',
  'TNX.X',
  'UST10Y',
  'CL:NYMEX:N26',
  'CL',
  '/CL',
  '@CL'
]);

const CORE_LIVE_TYPES = ['Quote', 'Trade', 'TradeETH', 'Summary'];

function normalizeSubscriptionSymbol(sym) {
  return String(sym || '').trim().replace(/^\$/, '').toUpperCase();
}

function isCoreLiveSubscription(sym) {
  const clean = normalizeSubscriptionSymbol(sym);
  return CORE_LIVE_SUBSCRIPTIONS.has(clean);
}

function seedCoreLiveSubscriptions() {
  CORE_LIVE_SUBSCRIPTIONS.forEach(sym => addAutoSubscription(sym, CORE_LIVE_TYPES));
}

async function bootstrapDashboardCoreData() {
  await ensureTodaySpxOptionSubscriptions();
  seedCoreLiveSubscriptions();
}

async function bootstrapDashboardCorePhases() {
  log('[BOOT] Phase 1: SPX 0DTE bootstrap');
  await ensureTodaySpxOptionSubscriptions();

  log('[BOOT] Phase 2: core quote warmup');
  seedCoreLiveSubscriptions();

  log('[BOOT] Phase 3: SPY/QQQ option prewarm (non-blocking)');
  // Run SPY/QQQ prewarm in background—don't wait for it
  prewarmCache().catch(e => log('Prewarm error:', e.message));

  log('[BOOT] Phase 4: Start cache pruning');
  const cachePruneTimer = setInterval(pruneStaleQuoteCache, CACHE_PRUNE_INTERVAL_MS);

  log('[BOOT] Phase 5: Start subscription lifecycle management');
  startSubscriptionPruning();

  log('[BOOT] Phase 6: page-requested subscriptions remain deferred');
}

function subscriptionKey(item) {
  return `${item.type}:${item.symbol}`;
}

function queueAutoSubscription(item) {
  // Validate symbol before queuing
  const validated = normalizeDxCacheSymbol(item.symbol);
  if (!validated) {
    log(`[SUBSCRIPTIONS] Rejected invalid symbol: "${item.symbol}"`);
    return;
  }

  const key = subscriptionKey(item);
  if (activeAutoSubscriptionKeys.has(key) || queuedSubscriptionKeys.has(key)) return;
  queuedSubscriptionKeys.add(key);
  subscriptionQueue.push(item);
}

function removeAutoSubscription(sym, reason = 'release') {
  if (!sym || isCoreLiveSubscription(sym)) return false;
  const types = subscriptionTypesBySymbol.get(sym);
  if (!subscriptions.has(sym) && !types) return false;

  subscriptions.delete(sym);
  subscriptionTypesBySymbol.delete(sym);
  subscriptionCreatedAt.delete(sym);

  if (types) {
    types.forEach(type => {
      const key = `${type}:${sym}`;
      activeAutoSubscriptionKeys.delete(key);
      queuedSubscriptionKeys.delete(key);
    });
  }

  for (let i = subscriptionQueue.length - 1; i >= 0; i--) {
    if (subscriptionQueue[i]?.symbol === sym) {
      subscriptionQueue.splice(i, 1);
    }
  }

  log(`[SUBSCRIPTIONS] Released ${sym} (${reason})`);
  return true;
}

function defaultAutoTypesForSymbol(sym) {
  if (/\{type=optstat\}$/i.test(String(sym || ''))) return ['Message', 'Configuration'];
  if (/^\/(ES|NQ)/.test(sym)) return ['Quote','Trade','TradeETH','Summary'];
  if (isSpxwSymbol(sym)) return ['Quote','Trade','TradeETH','Greeks','Summary'];
  if (/^\$?(SPX|NDX)$/i.test(sym)) return ['Quote','Trade','TradeETH','Summary'];
  if (/^(VIX|QQQ)$/i.test(sym)) return ['Quote','Trade','TradeETH','Summary'];
  return ['Quote','Trade','Greeks','Summary','TradeETH'];
}

function addAutoSubscription(sym, types = null) {
  if (!sym) return;
  const isNew = !subscriptions.has(sym);
  subscriptions.add(sym);

  // Track creation time for idle pruning
  if (isNew) {
    subscriptionCreatedAt.set(sym, Date.now());
  }

  const current = subscriptionTypesBySymbol.get(sym) || new Set();
  const incoming = types || defaultAutoTypesForSymbol(sym);
  incoming.forEach(type => {
    if (type === 'Underlying' || type === 'Series') {
      current.add(type === 'Underlying' ? 'Message' : 'Configuration');
    } else {
      current.add(type);
    }
  });
  subscriptionTypesBySymbol.set(sym, current);
  if (isNew) {
    pendingNewSubscriptions = true;  // Mark that we have new subs to queue
    // Immediately try to send if channel is open
    if (dxSocket && dxSocket.readyState === WebSocket.OPEN && dxChannelOpen) {
      sendSubscriptions();
    }
  }
  if (/\{type=optstat\}$/i.test(String(sym))) {
    log('!!!!!!!!!! OPTSTAT SUBSCRIBE QUEUED !!!!!!!!!!', sym, 'types=', [...current].join(','));
  }
}

async function sendSubscriptionsRateLimited() {
  if (subscriptionSending || subscriptionQueue.length === 0) return;
  subscriptionSending = true;

  try {
    while (subscriptionQueue.length > 0) {
      if (!dxSocket || dxSocket.readyState !== WebSocket.OPEN) {
        log('[SUBSCRIPTIONS] WebSocket not open, pausing subscriptions');
        break;
      }

      // Wait BEFORE sending (not after) to respect rate limit
      if (subscriptionErrorCount > 0) {
        const delay = Math.min(subscriptionBatchDelay, SUBSCRIPTION_BATCH_DELAY_MAX);
        log(`[SUBSCRIPTIONS] Backing off ${delay}ms (error count: ${subscriptionErrorCount})`);
        await new Promise(resolve => setTimeout(resolve, delay));
      }

      const batch = subscriptionQueue.splice(0, SUBSCRIPTION_BATCH_SIZE);
      batch.forEach(item => queuedSubscriptionKeys.delete(subscriptionKey(item)));

      if (batch.length === 0) break;

      // Log batch contents for debugging symbol mismatches
      const batchSymbols = [...new Set(batch.map(b => b.symbol))];
      const batchTypes = [...new Set(batch.map(b => b.type))];
      log(`[SUBSCRIPTIONS] Sending batch: ${batch.length} items (${batchSymbols.length} unique symbols, ${batchTypes.length} types)`);
      log(`  Symbols: ${batchSymbols.slice(0, 10).join(', ')}${batchSymbols.length > 10 ? ' ... (' + batchSymbols.length + ' total)' : ''}`);
      log(`  Types: ${batchTypes.join(', ')}`);
      log(`  Queue remaining: ${subscriptionQueue.length}`);

      const sendPromise = new Promise((resolve, reject) => {
        try {
          dxSocket.send(JSON.stringify({
            type: 'FEED_SUBSCRIPTION',
            channel: DX_CHANNEL,
            reset: false,
            add: batch
          }));

          // Log what was actually sent
          log(`[SUBSCRIPTIONS] Batch sent to dxLink (waiting 100ms for ACK)`);

          setTimeout(() => {
            batch.forEach(item => activeAutoSubscriptionKeys.add(subscriptionKey(item)));
            subscriptionErrorCount = 0;
            resolve();
          }, 200);
        } catch (err) {
          reject(err);
        }
      });

      try {
        await sendPromise;
      } catch (err) {
        subscriptionErrorCount++;
        subscriptionBatchDelay = Math.min(subscriptionBatchDelay * 1.5, SUBSCRIPTION_BATCH_DELAY_MAX);
        log(`[SUBSCRIPTIONS] Send error: ${err.message} | next delay: ${subscriptionBatchDelay}ms`);
      }

      // Wait between batches
      if (subscriptionQueue.length > 0) {
        await new Promise(resolve => setTimeout(resolve, SUBSCRIPTION_BATCH_DELAY_BASE));
      }
    }
  } finally {
    subscriptionSending = false;
  }
}

async function pruneIdleSubscriptions() {
  const now = Date.now();
  let removed = 0;

  for (const sym of [...subscriptions]) {
    // Never prune core subscriptions
    if (isCoreLiveSubscription(sym)) continue;

    const createdAt = subscriptionCreatedAt.get(sym);
    if (!createdAt) continue; // Skip if no timestamp

    const age = now - createdAt;
    if (age > IDLE_SUBSCRIPTION_MAX_AGE_MS) {
      log(`[PRUNE] Removing idle subscription: ${sym} (${Math.round(age/1000)}s old)`);
      if (removeAutoSubscription(sym, 'idle-prune')) {
        removed++;
      }
    }
  }

  if (removed > 0) {
    log(`[PRUNE] Session total: removed ${removed} idle subscriptions (total remaining: ${subscriptions.size})`);
  }
}

let pruneTimer = null;

function startSubscriptionPruning() {
  if (pruneTimer) return; // Already running
  pruneTimer = setInterval(pruneIdleSubscriptions, PRUNE_INTERVAL_MS);
  log('[PRUNE] Idle subscription pruning started (interval: ' + (PRUNE_INTERVAL_MS/1000) + 's)');
}

const dxClients     = new Set();
const subscriptions = new Set();
const subscriptionTypesBySymbol = new Map();
const candleSubscriptions = new Set();  // separate set for candle symbols
const dxCandleCache = {};

// ─── Persistent daily closes (survives proxy restarts) ───────────────────────
// Saved to data/daily-closes.json whenever dxLink streams a close after 4pm ET
let savedDailyCloses = { date: '', ES: 0, SPX: 0, VIX: 0 };
function loadDailyCloses() {
  try {
    ensureBackupDir();
    if (fs.existsSync(DAILY_CLOSES_FILE)) {
      const d = JSON.parse(fs.readFileSync(DAILY_CLOSES_FILE, 'utf8'));
      if (d?.date) savedDailyCloses = d;
    }
  } catch(_) {}
}
function saveDailyCloses() {
  try {
    ensureBackupDir();
    fs.writeFileSync(DAILY_CLOSES_FILE, JSON.stringify(savedDailyCloses), 'utf8');
  } catch(_) {}
}
loadDailyCloses();

// ─── Live prev-close cache (auto-refreshed daily, no manual updates needed) ───
const livePrevCloses = {
  VIX:  0,   // ^VIX
  ES:   0,   // /ESU26
  SPX:  0,   // $SPX
  NQ:   0,   // /NQM26
  date: '',  // ET date string for which these closes were fetched
};

async function refreshLivePrevCloses() {
  try {
    const etNow = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/New_York' }));
    const yest = new Date(etNow);
    yest.setDate(yest.getDate() - 1);
    while (yest.getDay() === 0 || yest.getDay() === 6) yest.setDate(yest.getDate() - 1);
    const closeDateStr = yest.toISOString().slice(0, 10);

    // Primary: dxSummaryCache (TT dxLink stream) — already in memory, most accurate
    // After 4pm ET use dayClosePrice (today's close); before use prevDayClosePrice
    const etMins = getEtMinutes();
    const useToday = etMins >= 960;
    const getDX = (...keys) => {
      for (const k of keys) {
        const s = dxSummaryCache[k] || {};
        const v = firstFiniteNumber(
          useToday ? s.dayClosePrice : null,
          s.prevDayClosePrice,
          dxTradeCache[k]?.price,
          0
        );
        if (v > 0) return v;
      }
      return 0;
    };

    let es  = getDX('/ESU26', '/ESU6', '/ES:XCME', '/ES');
    let nq  = getDX('/NQ:XCME', '/NQU26', '/NQU6', '/NQM26', '/NQM6');
    let vix = getDX('VIX', '$VIX', '$VIX.X');
    // SPX: after close use last trade price; dxSummaryCache rarely has dayClosePrice for indices
    let spx = useToday
      ? firstFiniteNumber(dxTradeCache['SPX']?.price, dxTradeCache['$SPX']?.price, getDX('SPX', '$SPX', '$SPX.X'), 0)
      : getDX('SPX', '$SPX', '$SPX.X');

    // After close: savedDailyCloses has closes captured from dxLink at 4pm (persisted to disk)
    const today = new Date(new Date().toLocaleString('en-US',{timeZone:'America/New_York'})).toISOString().slice(0,10);
    if (useToday && savedDailyCloses.date === today) {
      if (savedDailyCloses.ES  > 0) es  = savedDailyCloses.ES;
      if (savedDailyCloses.NQ  > 0) nq  = savedDailyCloses.NQ;
      if (savedDailyCloses.SPX > 0) spx = savedDailyCloses.SPX;
      if (savedDailyCloses.VIX > 0) vix = savedDailyCloses.VIX;
    }

    // Fallback: Yahoo Finance daily close bar (handles cases where dxLink hasn't streamed yet)
    const period2 = Math.floor(new Date(closeDateStr + 'T21:00:00Z').getTime() / 1000);
    const period1 = period2 - 86400 * 3;
    const yf = async (ticker) => {
      try {
        const r = await fetch(
          `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(ticker)}?period1=${period1}&period2=${period2}&interval=1d`,
          { headers: { 'User-Agent': 'Mozilla/5.0', 'Accept': 'application/json' } }
        );
        if (!r.ok) return 0;
        const d = await r.json();
        const closes = d?.chart?.result?.[0]?.indicators?.quote?.[0]?.close || [];
        const filtered = closes.filter(v => v > 0);
        return filtered[filtered.length - 1] || 0;
      } catch (_) { return 0; }
    };

    if (!spx || !es || !vix || !nq) {
      // Primary fallback: TT REST market-data (authenticated, accurate, once-daily is fine)
      const [ttSpx, ttEs, ttVix, ttNq] = await Promise.all([
        spx ? Promise.resolve(spx) : fetchTTDailyClose('SPX'),
        es  ? Promise.resolve(es)  : fetchTTDailyClose('/ESU26'),
        vix ? Promise.resolve(vix) : fetchTTDailyClose('VIX'),
        nq  ? Promise.resolve(nq)  : fetchTTDailyClose('/NQM26'),
      ]);
      if (!spx && ttSpx > 0) spx = ttSpx;
      if (!es  && ttEs  > 0) es  = ttEs;
      if (!vix && ttVix > 0) vix = ttVix;
      if (!nq  && ttNq  > 0) nq  = ttNq;
    }

    // Final fallback: Yahoo (no auth needed but ES=F returns live price after hours)
    if (!spx || !vix) {
      const [ySpx, yVix] = await Promise.all([
        spx ? Promise.resolve(spx) : yf('^GSPC'),
        vix ? Promise.resolve(vix) : yf('^VIX'),
      ]);
      if (!spx && ySpx > 0) spx = ySpx;
      if (!vix && yVix > 0) vix = yVix;
    }

    if (spx > 0) livePrevCloses.SPX = spx;
    if (es  > 0) livePrevCloses.ES  = es;
    if (vix > 0) livePrevCloses.VIX = vix;
    livePrevCloses.date = closeDateStr;
    console.log(`[prevCloses] refreshed for ${closeDateStr}: SPX=${spx.toFixed(2)} ES=${es.toFixed(2)} VIX=${vix.toFixed(2)}`);
  } catch (e) {
    console.error('[prevCloses] refresh error:', e.message);
  }
}

// Startup call is deferred to after log() is defined — see schedulePrevCloseRefresh() below

// ─── dxLink market data cache (Greeks + Summary per streamer-symbol) ──────────
const dxGreeksCache  = {};   // streamer-symbol → {delta, gamma, theta, vega, iv}
const marketDataPrevCloseCache = {}; // symbol → prev-close from TastyTrade market-data
const dxSummaryCache = {};   // streamer-symbol → {openInterest, dayVolume}
const dxQuoteCache   = {};   // streamer-symbol → {bid, ask, last}
const dxTradeCache   = {};   // streamer-symbol → {price, dayVolume, size}
const dxOpenInterestCache = {}; // streamer-symbol → last known non-zero open interest
const marketDataSnapshotCache = {}; // symbol → { value, ts }
const prevCloseFallbackCache = {}; // symbol -> { value, ts }
const historyDailyCache = new Map(); // symbol -> { ts, payload }
const historyDailyInFlight = new Map(); // symbol -> Promise<payload>
let spx0dteEnsurePromise = null;
let putCallCache = { ratio: 0, date: '', source: '', ts: 0 };

// ─── Cache TTL Management ─────────────────────────────────────────────────
const CACHE_MAX_AGE_MS = 60000; // 1 minute max age
const CACHE_PRUNE_INTERVAL_MS = 30000; // Check every 30s

function pruneStaleQuoteCache() {
  const now = Date.now();
  let pruned = 0;

  for (const key of Object.keys(dxQuoteCache)) {
    const entry = dxQuoteCache[key];
    if (entry && entry.timestamp && now - entry.timestamp > CACHE_MAX_AGE_MS) {
      delete dxQuoteCache[key];
      pruned++;
    }
  }

  if (pruned > 0) {
    log(`[CACHE] Pruned ${pruned} stale quotes (max age: ${CACHE_MAX_AGE_MS}ms)`);
  }
}

// ─── Server-side SPX 0DTE Flow Accumulator ───────────────────────────────────
// Accumulates premium flow from dxLink Trade events regardless of browser state.
// Posts to Next.js API (localhost:3002) every 30s for premium snapshots,
// and batches individual flow calls every 10s.
const spxFlow = {
  callPremium: 0,
  putPremium: 0,
  netPremium: 0,
  seenKeys: new Set(),
  pendingCalls: [],       // batched individual flow orders
  lastPremiumPost: 0,     // ms timestamp of last premium snapshot POST
  lastCallsPost: 0,       // ms timestamp of last flow calls POST
};

function spxFlowCurrentSession() {
  const mins = getEtMinutes();
  return (mins >= 570 && mins < 1020) ? 'rth' : 'ext';
}

function spxFlow0DTEExpiry() {
  const { compact } = todayYmd();
  const etMins = getEtMinutes();
  if (etMins >= 960) {
    // After 4pm ET: tomorrow's 0DTE
    const d = new Date();
    const etStr = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(d);
    const next = new Date(etStr + 'T12:00:00');
    do { next.setDate(next.getDate() + 1); } while (next.getDay() === 0 || next.getDay() === 6);
    const yy = String(next.getFullYear()).slice(2);
    const mm = String(next.getMonth() + 1).padStart(2, '0');
    const dd = String(next.getDate()).padStart(2, '0');
    return `${yy}${mm}${dd}`;
  }
  return compact;
}

function spxFlowProcessTrade(sym, price, size, time, aggressorSide) {
  if (!isSpxwSymbol(sym)) return;
  const expiry = optionExpirationCompact(sym);
  if (!expiry || expiry !== spxFlow0DTEExpiry()) return;
  if (!price || !size) return;

  // Dedup by sym|price|size|time
  const key = `${sym}|${price}|${size}|${time}`;
  if (spxFlow.seenKeys.has(key)) return;
  spxFlow.seenKeys.add(key);
  // Trim seen set to avoid unbounded growth
  if (spxFlow.seenKeys.size > 50000) spxFlow.seenKeys.clear();

  // Determine direction from quote cache, then aggressorSide fallback
  const quote = dxQuoteCache[sym] || {};
  let dir = 0;
  if (quote.bidPrice > 0 && quote.askPrice > 0) {
    if (price >= quote.askPrice) dir = 1;
    else if (price <= quote.bidPrice) dir = -1;
  }
  if (dir === 0 && aggressorSide) {
    if (aggressorSide === 'BUY') dir = 1;
    else if (aggressorSide === 'SELL') dir = -1;
  }
  if (dir === 0) return; // can't determine aggressor, skip

  const optType = /\d{6}C/.test(sym) ? 'C' : 'P';
  const side = dir > 0 ? 'buy' : 'sell';
  const premium = price * size * 100;
  const isBull = (optType === 'C' && side === 'buy') || (optType === 'P' && side === 'sell');

  // Accumulate running totals
  if (optType === 'C') {
    spxFlow.callPremium += dir > 0 ? premium : -premium;
    spxFlow.netPremium  += dir > 0 ? premium : -premium;
  } else {
    spxFlow.putPremium  += dir > 0 ? premium : -premium;
    spxFlow.netPremium  -= dir > 0 ? premium : -premium;
  }

  // Parse strike from symbol
  const strikeM = sym.match(/[CP](\d+(?:\.\d+)?)$/);
  const strike = strikeM ? (strikeM[1].length === 8 ? Number(strikeM[1]) / 1000 : Number(strikeM[1])) : 0;

  // Spot price for OTM check
  const spot = dxTradeCache['SPX']?.price || dxTradeCache['$SPX']?.price || 0;
  const isOtm = spot > 0 ? (optType === 'C' ? strike > spot : strike < spot) : false;

  const date = dbEtDate(Number(time) || Date.now());
  spxFlow.pendingCalls.push({
    ts: Number(time) || Date.now(),
    date,
    source: 'tape',
    symbol: sym,
    underlying: 'SPX',
    expiration: (() => { const m = sym.match(/(\d{6})[CP]/); return m ? `20${m[1].slice(0,2)}-${m[1].slice(2,4)}-${m[1].slice(4,6)}` : null; })(),
    strike,
    option_type: optType,
    side,
    action: optType === 'C' ? (side === 'buy' ? 'BUY CALL' : 'SELL CALL') : (side === 'buy' ? 'BUY PUT' : 'SELL PUT'),
    price,
    size,
    premium,
    is_otm: isOtm ? 1 : 0,
  });
}

async function spxFlowFlushPremium() {
  const now = Date.now();
  if (now - spxFlow.lastPremiumPost < 30000) return;
  if (spxFlow.callPremium === 0 && spxFlow.putPremium === 0) return;
  spxFlow.lastPremiumPost = now;
  const spot = dxTradeCache['SPX']?.price || dxTradeCache['$SPX']?.price || 0;
  try {
    await fetch('http://localhost:3002/api/snapshots/premium', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        timestamp: now,
        callPremium: spxFlow.callPremium,
        putPremium: spxFlow.putPremium,
        netPremium: spxFlow.netPremium,
        spxPrice: spot,
      }),
    });
  } catch (_) {}
}

async function spxFlowFlushCalls() {
  const now = Date.now();
  if (now - spxFlow.lastCallsPost < 10000) return;
  if (!spxFlow.pendingCalls.length) return;
  spxFlow.lastCallsPost = now;
  const batch = spxFlow.pendingCalls.splice(0);
  try {
    await fetch('http://localhost:3002/api/flow/calls', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(batch),
    });
  } catch (_) {
    // Put them back on failure so we don't lose data
    spxFlow.pendingCalls.unshift(...batch);
    if (spxFlow.pendingCalls.length > 5000) spxFlow.pendingCalls.splice(0, spxFlow.pendingCalls.length - 5000);
  }
}

// Schedule periodic flushes
setInterval(() => { spxFlowFlushPremium().catch(() => {}); spxFlowFlushCalls().catch(() => {}); }, 10000);

// Reset accumulator at RTH open (9:30 ET) and EXT open (17:00 ET) each day
let _spxFlowLastSession = spxFlowCurrentSession();
setInterval(() => {
  const sess = spxFlowCurrentSession();
  if (sess !== _spxFlowLastSession) {
    // Flush before reset
    spxFlowFlushPremium().catch(() => {});
    spxFlowFlushCalls().catch(() => {});
    spxFlow.callPremium = 0;
    spxFlow.putPremium  = 0;
    spxFlow.netPremium  = 0;
    spxFlow.seenKeys.clear();
    spxFlow.pendingCalls.length = 0;
    spxFlow.lastPremiumPost = 0;
    spxFlow.lastCallsPost   = 0;
    _spxFlowLastSession = sess;
    log('[spxFlow] Session changed to', sess, '— accumulators reset');
  }
}, 30000);

// ─── MotiveWave GEX Level Export ──────────────────────────────────────────────
const GEX_CSV_PATH = path.join(__dirname, 'gex_levels.csv');
let gexLevelCache = { callWall: 0, putWall: 0, zeroGamma: 0, spot: 0, esSpot: 0, basis: 0, ts: 0 };

// ─── Intraday Greeks History ──────────────────────────────────────────────────
// Stores GEX/DEX/CHEX/VEX snapshots every 30s during market hours
// Cleared at midnight ET each day
const INTRADAY_FILE = path.join(__dirname, 'data', 'intraday-greeks.json');
let intradayGreeksHistory = [];  // [{ time, ts, gex, dex, chex, vex, buyPct, spot }]
let lastIntradayDate = '';

function loadIntradayHistory() {
  ensureBackupDir();
  try {
    if (fs.existsSync(INTRADAY_FILE)) {
      const data = JSON.parse(fs.readFileSync(INTRADAY_FILE, 'utf8'));
      if (Array.isArray(data.records) && data.date === new Date().toISOString().split('T')[0]) {
        intradayGreeksHistory = data.records;
        lastIntradayDate = data.date;
        return;
      }
    }
  } catch(e) {}
  intradayGreeksHistory = [];
  lastIntradayDate = new Date().toISOString().split('T')[0];
}

function saveIntradayHistory() {
  ensureBackupDir();
  try {
    writeFileAtomic(INTRADAY_FILE, JSON.stringify({
      date: new Date().toISOString().split('T')[0],
      records: intradayGreeksHistory
    }, null, 0));
  } catch(e) {}
}

function computeIntradaySnapshot(spot) {
  // GEX: net gamma exposure in billions (same formula as computeAndCacheGexLevels)
  let totalGEX = 0;
  let totalDeltaCall = 0, totalDeltaPut = 0;
  let totalCharmCall = 0, totalCharmPut = 0;
  let totalVegaCall  = 0, totalVegaPut  = 0;

  // Filter to today's 0DTE symbols only. dxGreeksCache accumulates ALL subscribed expirations
  // (it's never pruned), so we must filter explicitly. todayYmd() now uses ET timezone so
  // the YYMMDD compact date matches SPXW symbol date stamps correctly.
  const todayCompact = todayYmd().compact;
  for (const [sym, greeks] of Object.entries(dxGreeksCache)) {
    if (!isSpxwSymbol(sym)) continue;
    if (optionExpirationCompact(sym) !== todayCompact) continue;
    const summary  = dxSummaryCache[sym] || {};
    const oi       = maxWholeNumber(summary.openInterest) || 0;
    const vol      = maxWholeNumber(summary.dayVolume) || 0;
    const contracts = oi + vol;
    if (!contracts) continue;
    const gamma    = firstFiniteNumber(greeks.gamma,  0);
    const delta    = firstFiniteNumber(greeks.delta,  0);
    const theta    = firstFiniteNumber(greeks.theta,  0); // charm proxy
    const vega     = firstFiniteNumber(greeks.vega,   0);
    const isCall   = /C\d{4,8}$/.test(sym);
    // Formulas mirror mult-greek.js exactly:
    //   GEX  = gamma  * contracts * spot² (spot*spot*0.01*100 = spot²)
    //   DEX  = |delta| * contracts * spot * 100 (calls positive, puts negative)
    //   CHEX/VEX = theta/vega * contracts * spot * 100
    const mult     = 100 * spot;   // for DEX/CHEX/VEX
    const gexMult  = spot * spot;  // for GEX: spot² matches mult-greek's spot*spot*0.01*100

    if (isCall) {
      totalGEX        += Math.abs(gamma) * contracts * gexMult;
      totalDeltaCall  += Math.abs(delta) * contracts * mult;  // abs: matches mult-greek
      totalCharmCall  += (-theta) * contracts * mult;         // matches mult-greek sign
      totalVegaCall   += vega  * contracts * mult;
    } else {
      totalGEX        -= Math.abs(gamma) * contracts * gexMult;
      totalDeltaPut   -= Math.abs(delta) * contracts * mult;  // negative contribution
      totalCharmPut   += theta  * contracts * mult;           // matches mult-greek sign
      totalVegaPut    -= vega   * contracts * mult;
    }
  }

  const gex  = totalGEX / 1e9;
  const dex  = (totalDeltaCall + totalDeltaPut) / 1e9;
  const chex = (totalCharmCall + totalCharmPut) / 1e6;
  const vex  = (totalVegaCall  + totalVegaPut)  / 1e6;

  // Buy % from buy-sell backup (most recent record)
  const bsRecords = readBuySellBackup();
  const latest = bsRecords.length ? bsRecords[bsRecords.length - 1] : null;
  const buyPct = latest ? Number(latest.buyPct || 0) : 0;

  const now = new Date();
  const time = now.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false, timeZone: 'America/New_York' });

  return { time, ts: now.getTime(), gex, dex, chex, vex, buyPct, spot };
}

// ES basis = yesterday's 4pm settlement spread: ES_close - SPX_close
// Formula: SPX_from_ES = ES - (ES_close_yesterday - SPX_close_yesterday)
// Fetched once per calendar day; stable intraday
let esBasisCache = { basis: 0, spxClose: 0, esClose: 0, date: '', ts: 0 };

async function fetchEsBasis() {
  const todayDate = todayYmd().ymd;
  if (esBasisCache.date === todayDate && esBasisCache.ts > 0) return esBasisCache.basis;
  
  try {
    const [esPrice, spxPrice] = await Promise.all([
      fetchUnderlyingLast('/ES').catch(() => 0),
      fetchUnderlyingLast('SPX').catch(() => 0)
    ]);
    
    if (esPrice > 0 && spxPrice > 0) {
      const basis = esPrice - spxPrice;
      esBasisCache = { basis, spxClose: spxPrice, esClose: esPrice, date: todayDate, ts: Date.now() };
      log(`ES basis (live): SPX=${spxPrice.toFixed(2)}  ES=${esPrice.toFixed(2)}  basis=${basis.toFixed(2)}`);
      return basis;
    }
  } catch(e) {
    log('fetchEsBasis error:', e.message);
  }
  return esBasisCache.basis;
}

// ─── 0DTE Expiration Staleness Check ──────────────────────────────────────
function is0dteExpired(expiryDate) {
  // SPX 0DTE expires at 4:00 PM ET
  const now = new Date();
  const etTime = new Date(now.toLocaleString('en-US', { timeZone: 'America/New_York' }));

  const todayStr = todayYmd();
  if (expiryDate !== todayStr) return false; // Not today's option

  // If past 4:00 PM ET and it's today's option, it's expired
  if (etTime.getHours() >= 16) {
    return true;
  }
  return false;
}

function spxLevelToEs(spxLevel, basis) {
  // Apply the live basis offset so the level plots correctly on the ES chart
  return Math.round((spxLevel + basis) * 4) / 4; // round to nearest 0.25 (ES tick)
}

function writeFileAtomic(targetPath, content) {
  const tempPath = `${targetPath}.tmp`;
  fs.writeFileSync(tempPath, content);
  fs.renameSync(tempPath, targetPath);
}

function writeGexCsvFile(levels) {
  const { callWall, putWall, zeroGamma, basis } = levels;
  const rows = [
    'Symbol,Price,Label,Text Color,Line Color,Band Color,Band Offset,Show Label,Show Price'
  ];
  // Convert each SPX level to ES using live basis
  if (callWall  > 0) rows.push(`ESU6,${spxLevelToEs(callWall,  basis).toFixed(2)},Call Wall,#000000,RED,#80808027,10,TRUE,TRUE`);
  if (putWall   > 0) rows.push(`ESU6,${spxLevelToEs(putWall,   basis).toFixed(2)},Put Wall,#000000,GREEN,#80808027,10,TRUE,TRUE`);
  if (zeroGamma > 0) rows.push(`ESU6,${spxLevelToEs(zeroGamma, basis).toFixed(2)},Zero Gamma,#000000,WHITE,#80808027,10,TRUE,TRUE`);
  try { writeFileAtomic(GEX_CSV_PATH, rows.join('\n') + '\n'); } catch(e) { log('GEX CSV write error:', e.message); }
}

function computeAndCacheGexLevels(underlyingPrice, esBasis = esBasisCache.basis) {
  const allSyms = Object.keys(dxGreeksCache);
  log('dxGreeksCache has ' + allSyms.length + ' symbols. Sample 5:', allSyms.slice(0, 5));
  
  const strikes = [];
  for (const [sym, greeks] of Object.entries(dxGreeksCache)) {
    if (!isSpxwSymbol(sym)) continue;
    const summary = dxSummaryCache[sym] || {};
    const gamma   = Math.abs(firstFiniteNumber(greeks.gamma, 0));
    const oi      = maxWholeNumber(summary.openInterest);
    const isCall  = /C\d{4,8}$/.test(sym);
    const m       = String(sym).match(/[CP](\d{4,6})$/);
    if (!m) continue;
    const strike = parseInt(m[1], 10);
    if (!strike) continue;
    let row = strikes.find(r => r.strike === strike);
    if (!row) { row = { strike, callGamma: 0, callOI: 0, putGamma: 0, putOI: 0 }; strikes.push(row); }
    if (isCall) { row.callGamma = gamma; row.callOI = oi; }
    else        { row.putGamma  = gamma; row.putOI  = oi; }
  }
  if (strikes.length < 5) return;

  const spot = firstFiniteNumber(underlyingPrice, gexLevelCache.spot, 0);
  if (!(spot > 0)) return;

  strikes.forEach(r => {
    r.callGEX = r.callGamma * r.callOI * spot * spot;
    r.putGEX  = r.putGamma  * r.putOI  * spot * spot;
    r.netGEX  = r.callGEX - r.putGEX;
  });

  const callWall = strikes.reduce((max, r) => r.callGEX > max.callGEX ? r : max, strikes[0]).strike;
  const putWall  = strikes.reduce((max, r) => Math.abs(r.putGEX) > Math.abs(max.putGEX) ? r : max, strikes[0]).strike;

  const sorted = [...strikes].sort((a, b) => a.strike - b.strike);
  let zeroGamma = 0;
  for (let i = 0; i < sorted.length - 1; i++) {
    const a = sorted[i], b = sorted[i + 1];
    if (a.netGEX !== undefined && b.netGEX !== undefined && Math.sign(a.netGEX) !== Math.sign(b.netGEX)) {
      const slope = (b.netGEX - a.netGEX) / (b.strike - a.strike);
      zeroGamma = Math.round((a.strike - a.netGEX / slope) * 100) / 100;
      break;
    }
  }

  const esSpot = spot + esBasis;
  const levels = { callWall, putWall, zeroGamma, spot, esSpot, basis: esBasis, ts: Date.now() };
  gexLevelCache = levels;
  writeGexCsvFile(levels);
  log(`GEX levels → SPX: CW=${callWall} PW=${putWall} ZG=${zeroGamma.toFixed(2)} | basis=${esBasis.toFixed(2)} | ES: CW=${spxLevelToEs(callWall,esBasis)} PW=${spxLevelToEs(putWall,esBasis)} ZG=${spxLevelToEs(zeroGamma,esBasis)}`);
}

// ─── Helpers ─────────────────────────────────────────────────────────────────
const LOG_LEVEL = process.env.LOG_LEVEL || 'warn'; // 'debug', 'info', 'warn', 'error'
const LOG_LEVELS = { debug: 0, info: 1, warn: 2, error: 3 };
const CURRENT_LEVEL = LOG_LEVELS[LOG_LEVEL] || 1;
const REST_MONITOR_STALL_MS = parseInt(process.env.REST_MONITOR_STALL_MS || '30000', 10);
const REST_MONITOR_SUMMARY_MS = parseInt(process.env.REST_MONITOR_SUMMARY_MS || '60000', 10);
const REST_MONITOR_TICK_MS = parseInt(process.env.REST_MONITOR_TICK_MS || '5000', 10);
const restMonitor = {
  paths: new Map(),
  startedAt: Date.now()
};

// Log to file for debugging
const logStream = fs.createWriteStream(path.join(__dirname, 'proxy.log'), { flags: 'a' });

function log(...a) {
  const msg = '[TT-Proxy] ' + a.join(' ');
  console.log(msg);
  logStream.write(msg + '\n');
}

// ─── Schedule prev-close refresh (must be after log() is defined) ────────────
refreshLivePrevCloses();
(function scheduleMidnightRefresh() {
  const etNow = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/New_York' }));
  const nextMidnight = new Date(etNow);
  nextMidnight.setHours(24, 1, 0, 0); // 12:01am ET
  const msUntil = nextMidnight - etNow;
  setTimeout(() => {
    refreshLivePrevCloses();
    setInterval(refreshLivePrevCloses, 24 * 60 * 60 * 1000);
  }, msUntil);
})();
function warn(...a) { console.warn('[TT-Proxy]', ...a); }
function error(...a) { console.error('[TT-Proxy]', ...a); }
function formatEtTimestamp(ts = Date.now()) {
  return new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false
  }).format(ts);
}
function getRestMonitorEntry(apiPath) {
  let entry = restMonitor.paths.get(apiPath);
  if (!entry) {
    entry = {
      count: 0,
      firstSeenAt: 0,
      lastSeenAt: 0,
      lastSummaryCount: 0,
      lastSummaryAt: 0,
      stalled: false
    };
    restMonitor.paths.set(apiPath, entry);
  }
  return entry;
}
function noteRestApiPull(apiPath) {
  const now = Date.now();
  const entry = getRestMonitorEntry(apiPath);
  if (!entry.firstSeenAt) entry.firstSeenAt = now;
  const gapSeconds = entry.lastSeenAt ? ((now - entry.lastSeenAt) / 1000).toFixed(1) : 'first';
  entry.count += 1;
  entry.lastSeenAt = now;
  entry.stalled = false;
  warn(`REST API ${formatEtTimestamp(now)} ET | ${apiPath} | request #${entry.count} | gap ${gapSeconds === 'first' ? gapSeconds : `${gapSeconds}s`}`);
}
function emitRestMonitorSummary() {
  const now = Date.now();
  for (const [apiPath, entry] of restMonitor.paths.entries()) {
    if (!entry.lastSeenAt) continue;
    const sinceSummary = now - entry.lastSummaryAt;
    if (sinceSummary < REST_MONITOR_SUMMARY_MS) continue;
    const delta = entry.count - entry.lastSummaryCount;
    const ageMs = now - entry.lastSeenAt;
    warn(`REST MONITOR ${formatEtTimestamp(now)} ET | ${apiPath} | ${delta} pulls in ${Math.round(sinceSummary / 1000)}s | last seen ${Math.round(ageMs / 1000)}s ago`);
    entry.lastSummaryAt = now;
    entry.lastSummaryCount = entry.count;
  }
}
function checkRestMonitorStalls() {
  const now = Date.now();
  for (const [apiPath, entry] of restMonitor.paths.entries()) {
    if (!entry.lastSeenAt || entry.stalled) continue;
    const ageMs = now - entry.lastSeenAt;
    if (ageMs < REST_MONITOR_STALL_MS) continue;
    entry.stalled = true;
    warn(`REST MONITOR STALLED ${formatEtTimestamp(now)} ET | ${apiPath} | no pulls for ${Math.round(ageMs / 1000)}s`);
  }
}
function finiteNumber(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}
function firstFiniteNumber(...vals) {
  for (const v of vals) {
    const n = finiteNumber(v);
    if (n !== null) return n;
  }
  return 0;
}
function resolveQuoteCurrentPrice(q = {}, t = {}, s = {}) {
  const bid = firstFiniteNumber(q.bidPrice, q.bid, 0);
  const ask = firstFiniteNumber(q.askPrice, q.ask, 0);
  const mid = bid > 0 && ask > 0 ? (bid + ask) / 2 : 0;
  return firstFiniteNumber(
    t.price,
    s.dayClosePrice,
    s.dayOpenPrice,
    q.lastPrice,
    q.last,
    q.mark,
    q.mid,
    q.price,
    q['last-price'],
    q['mark-price'],
    q['mid-price'],
    q['last-trade-price'],
    s.lastPrice,
    s.last,
    mid,
    0
  );
}
function resolveQuotePrevClose(q = {}, s = {}) {
  return firstFiniteNumber(
    s.prevDayClosePrice,
    s.prevClosePrice,
    s.prevClose,
    s.previousClose,
    q['prev-close'],
    q.prevClose,
    q.previousClose,
    q.prevDayClosePrice,
    q['prev-day-close-price'],
    q.closePrice,
    s.dayClosePrice,
    0
  );
}
function getEtMinutes(date = new Date()) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false
  }).formatToParts(date);
  const map = Object.fromEntries(parts.filter(part => part.type !== 'literal').map(part => [part.type, part.value]));
  return (Number(map.hour || 0) * 60) + Number(map.minute || 0);
}
function isRegularEquitySessionEt(date = new Date()) {
  const mins = getEtMinutes(date);
  return mins >= 570 && mins < 960;
}
function isFuturesSymbol(symbol = '') {
  return String(symbol).startsWith('/');
}
function firstVolumeNumber(...vals) {
  const nums = vals.map(finiteNumber).filter(n => n !== null && n >= 0);
  const whole = nums.find(n => Number.isInteger(n));
  return whole ?? nums[0] ?? 0;
}
function maxWholeNumber(...vals) {
  const nums = vals.map(finiteNumber).filter(n => n !== null && n >= 0 && Number.isInteger(n));
  return nums.length ? Math.max(...nums) : 0;
}

function optionDistance(option, underlyingPrice) {
  const strike = parseFloat(option?.['strike-price'] || option?.strike || 0);
  return Math.abs(strike - underlyingPrice);
}

function todayYmd() {
  // Use ET date so option expiry compact (YYMMDD) matches SPXW symbol date stamps
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York',
    year: 'numeric', month: '2-digit', day: '2-digit'
  }).formatToParts(new Date());
  const map = Object.fromEntries(parts.filter(p => p.type !== 'literal').map(p => [p.type, p.value]));
  const yy = map.year.slice(2);
  const mm = map.month;
  const dd = map.day;
  return { yy, mm, dd, ymd: `${map.year}-${mm}-${dd}`, compact: `${yy}${mm}${dd}` };
}

function optionExpirationCompact(symbol) {
  const m = String(symbol || '').match(/(\d{6})[CP]/);
  return m ? m[1] : '';
}

function isSpxwSymbol(symbol) {
  return /^\.?SPXW\d{6}[CP]/.test(String(symbol || ''));
}

function inferUnderlyingPrice(options, fallback = 0) {
  for (const opt of options || []) {
    const n = firstFiniteNumber(opt?.['underlying-price'], opt?.underlyingPrice, opt?.underlying_price, NaN);
    if (n > 0) return n;
  }
  return firstFiniteNumber(fallback, 0);
}

function estimateOptionGreekFallback(opt, underlyingPrice, side) {
  const price = firstFiniteNumber(underlyingPrice, 0);
  const strike = firstFiniteNumber(opt?.['strike-price'], opt?.strike, 0);
  if (!(price > 0) || !(strike > 0)) return { delta: 0, gamma: 0 };
  const expDate = opt?.['expiration-date'] || '';
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const exp = expDate ? new Date(`${expDate}T12:00:00`) : today;
  exp.setHours(0, 0, 0, 0);
  const dte = Math.max(0, Math.round((exp - today) / 86400000));
  const width = Math.max(18, price * (0.006 + Math.min(dte, 14) * 0.0016));
  const moneyness = (strike - price) / width;
  const density = Math.exp(-0.5 * moneyness * moneyness);
  const gamma = Math.max(0.00002, Math.min(0.0035, density / (price * (0.05 + Math.sqrt(dte + 1) * 0.16))));
  const sigmoid = 1 / (1 + Math.exp(moneyness));
  const delta = side === 'call' ? sigmoid : -(1 - sigmoid);
  return { delta, gamma };
}

function pickNearestOptionStreamerSymbols(options, underlyingPrice, maxSymbols = MAX_DXLINK_AUTO_SYMBOLS) {
  const price = firstFiniteNumber(underlyingPrice, 0);
  if (!(price > 0)) return (options || []).map(o => o['streamer-symbol']).filter(Boolean).slice(0, maxSymbols);
  return options
    .slice()
    .sort((a, b) => optionDistance(a, price) - optionDistance(b, price))
    .map(o => o['streamer-symbol'])
    .filter(Boolean)
    .slice(0, maxSymbols);
}

function buildSyntheticPriceHistory(symbol, lastPrice, closePrice) {
  const safeLast = firstFiniteNumber(lastPrice, closePrice, 0);
  const safeClose = firstFiniteNumber(closePrice, safeLast, 0);
  const now = new Date();
  const candles = [];
  const count = 390;
  const start = new Date(now);
  start.setUTCHours(13, 30, 0, 0);
  let prev = safeClose || safeLast || 0;
  const drift = safeLast && safeClose ? (safeLast - safeClose) / count : 0;
  for (let i = 0; i < count; i++) {
    const t = new Date(start.getTime() + i * 60000);
    const wave = Math.sin(i / 17) * 0.45 + Math.cos(i / 31) * 0.28;
    const target = i === count - 1 ? safeLast : prev + drift + wave * 0.08;
    const open = prev;
    const close = target;
    const high = Math.max(open, close) + Math.abs(wave) * 0.22;
    const low = Math.min(open, close) - Math.abs(wave) * 0.22;
    candles.push({
      open: Number(open.toFixed(2)),
      high: Number(high.toFixed(2)),
      low: Number(low.toFixed(2)),
      close: Number(close.toFixed(2)),
      volume: Math.max(1, Math.round(900 + Math.abs(wave) * 1800 + i * 2)),
      datetime: t.getTime()
    });
    prev = close;
  }
  return { symbol, empty: false, candles };
}

function buildDailyHistoryFromCandles(symbol, candles) {
  const items = (Array.isArray(candles) ? candles : [])
    .map(c => ({
      time: c.time || c.datetime || c.date || null,
      open: firstFiniteNumber(c.open, c['open-price'], 0),
      high: firstFiniteNumber(c.high, c['high-price'], 0),
      low: firstFiniteNumber(c.low, c['low-price'], 0),
      close: firstFiniteNumber(c.close, c['close-price'], 0),
      volume: firstFiniteNumber(c.volume, 0),
    }))
    .filter(c => c.time && c.close > 0);
  return { data: { items } };
}

async function getDailyHistoryPayload(symbol) {
  const clean = String(symbol || '').replace(/^\$/, '').trim().toUpperCase();
  if (!clean) return { status: 400, payload: { error: 'Invalid symbol' } };

  const cached = historyDailyCache.get(clean);
  const now = Date.now();
  if (cached && (now - cached.ts) < 15 * 60 * 1000) {
    return { status: 200, payload: cached.payload };
  }
  if (historyDailyInFlight.has(clean)) {
    return { status: 200, payload: await historyDailyInFlight.get(clean) };
  }

  const requestPromise = (async () => {
    const end = new Date();
    const start = new Date();
    start.setFullYear(start.getFullYear() - 1);
    const fmt = d => d.toISOString().split('T')[0];

    const { status, data } = await ttGet(
      `/market-data/history/${encodeURIComponent(clean)}?start-date=${fmt(start)}&end-date=${fmt(end)}&interval=1Day`
    );

    if (status === 200) {
      const raw = data?.data?.candles || data?.data?.items || data?.candles || [];
      const payload = buildDailyHistoryFromCandles(clean, raw);
      if (payload.data.items.length) {
        historyDailyCache.set(clean, { ts: Date.now(), payload });
        return payload;
      }
    }

    const cachedStale = historyDailyCache.get(clean);
    if ((status === 429 || status === 400) && cachedStale?.payload?.data?.items?.length) {
      return cachedStale.payload;
    }

    const dxKeyMap = { SPX:'$SPX', NDX:'NDX', VIX:'VIX' };
    const dxKey = dxKeyMap[clean] || clean;
    const quote = dxQuoteCache[dxKey] || dxQuoteCache[clean] || {};
    const trade = dxTradeCache[dxKey] || dxTradeCache[clean] || {};
    const summary = dxSummaryCache[dxKey] || dxSummaryCache[clean] || {};
    const bid = firstFiniteNumber(quote.bidPrice, 0);
    const ask = firstFiniteNumber(quote.askPrice, 0);
    const last = firstFiniteNumber(trade.price, bid && ask ? (bid + ask) / 2 : 0, 0);
    const close = firstFiniteNumber(summary.prevDayClosePrice, await fetchPrevCloseFallback(clean), last, 0);
    if (last > 0 || close > 0) {
      const synthetic = buildSyntheticPriceHistory(clean, last, close);
      const payload = buildDailyHistoryFromCandles(clean, synthetic.candles);
      historyDailyCache.set(clean, { ts: Date.now(), payload });
      return payload;
    }

    throw Object.assign(new Error(`History unavailable for ${clean}`), { status, data });
  })();

  historyDailyInFlight.set(clean, requestPromise);
  try {
    return { status: 200, payload: await requestPromise };
  } finally {
    historyDailyInFlight.delete(clean);
  }
}

function buildSyntheticFiveMinuteHistory(symbol, lastPrice, closePrice) {
  const safeLast = firstFiniteNumber(lastPrice, closePrice, 0);
  const safeClose = firstFiniteNumber(closePrice, safeLast, 0);
  const candles = [];
  const count = 288;
  const interval = 5 * 60 * 1000;
  const end = Math.floor(Date.now() / interval) * interval;
  let prev = safeClose || safeLast || 0;
  const drift = safeLast && safeClose ? (safeLast - safeClose) / count : 0;
  for (let i = 0; i < count; i++) {
    const t = end - (count - 1 - i) * interval;
    const wave = Math.sin(i / 9) * 0.65 + Math.cos(i / 19) * 0.35;
    const close = i === count - 1 ? safeLast : prev + drift + wave * 0.35;
    const open = prev;
    const high = Math.max(open, close) + Math.abs(wave) * 0.7;
    const low = Math.min(open, close) - Math.abs(wave) * 0.7;
    candles.push({
      datetime: t,
      open: Number(open.toFixed(2)),
      high: Number(high.toFixed(2)),
      low: Number(low.toFixed(2)),
      close: Number(close.toFixed(2)),
      volume: Math.max(1, Math.round(100 + Math.abs(wave) * 250))
    });
    prev = close;
  }
  return { symbol, empty: false, candles };
}

function loadTokenFile() {
  try {
    if (fs.existsSync(TOKEN_FILE)) {
      const t = JSON.parse(fs.readFileSync(TOKEN_FILE, 'utf8'));
      accessToken  = t.access_token  || null;
      refreshToken = t.refresh_token || REFRESH_ENV || null;
      tokenExpiry  = t.expiry        || 0;
      log('Token loaded. Expires:', new Date(tokenExpiry).toISOString());
    }
  } catch(e) { log('Token file error:', e.message); }
  if (!refreshToken) refreshToken = REFRESH_ENV;
}

function saveTokenFile(t) {
  try { fs.writeFileSync(TOKEN_FILE, JSON.stringify(t, null, 2)); } catch(e) {}
}

function isExpired() { return !accessToken || Date.now() >= (tokenExpiry - 60_000); }

function httpsRequest(opts, body) {
  return new Promise((resolve, reject) => {
    const req = https.request(opts, res => {
      let raw = '';
      res.on('data', c => raw += c);
      res.on('end', () => {
        try { resolve({ status: res.statusCode, data: JSON.parse(raw) }); }
        catch { resolve({ status: res.statusCode, data: raw }); }
      });
    });
    req.on('error', reject);
    if (body) req.write(body);
    req.end();
  });
}

// ─── Auth ─────────────────────────────────────────────────────────────────────
async function refreshAccessToken() {
  if (!refreshToken) { log('No refresh token'); return false; }
  log('Refreshing access token...');
  try {
    const params = new URLSearchParams({ grant_type:'refresh_token', refresh_token: refreshToken });
    if (CLIENT_SECRET) params.set('client_secret', CLIENT_SECRET);
    const body = params.toString();
    const { status, data } = await httpsRequest({
      hostname: 'api.tastytrade.com',
      path:     '/oauth/token',
      method:   'POST',
      headers:  { 'Content-Type': 'application/x-www-form-urlencoded', 'Content-Length': Buffer.byteLength(body), 'User-Agent': 'spx-gex-dashboard/1.0' }
    }, body);

    if (status !== 200 || !data.access_token) {
      log('Token refresh failed:', status, JSON.stringify(data));
      return false;
    }
    accessToken  = data.access_token;
    refreshToken = data.refresh_token || refreshToken;
    tokenExpiry  = Date.now() + (data.expires_in || 10800) * 1000;
    saveTokenFile({ access_token: accessToken, refresh_token: refreshToken, expiry: tokenExpiry, savedAt: new Date().toISOString() });
    log('Token refreshed. Expires:', new Date(tokenExpiry).toISOString());
    return true;
  } catch(e) { log('refreshAccessToken error:', e.message); return false; }
}

async function ensureToken() {
  if (!isExpired()) return true;
  return refreshAccessToken();
}

// ─── TT REST ──────────────────────────────────────────────────────────────────
async function ttGet(apiPath) {
  await ensureToken();
  noteRestApiPull(apiPath);
  return httpsRequest({
    hostname: 'api.tastytrade.com',
    path:     apiPath,
    method:   'GET',
    headers:  { 'Authorization': `Bearer ${accessToken}`, 'Content-Type': 'application/json', 'User-Agent': 'spx-gex-dashboard/1.0' }
  });
}

async function fetchUnderlyingLast(symbol) {
  const clean = normalizeRestSymbol(symbol || 'SPXW');
  const cached = marketDataSnapshotCache[clean];
  if (cached && Number.isFinite(cached.value) && cached.value > 0 && (Date.now() - cached.ts) < 5 * 60 * 1000) {
    return cached.value;
  }
  const qs = clean === 'SPX' || clean === 'NDX' || clean === 'VIX'
    ? `index[]=${encodeURIComponent(clean)}`
    : marketDataQueryForSymbols([clean]);
  const { status, data } = await ttGet(`/market-data/by-type?${qs}`);
  if (status !== 200) return 0;
  const item = data?.data?.items?.[0] || {};
  const value = firstFiniteNumber(
    item.last,
    item.mark,
    item.mid,
    item['last-price'],
    item['mark-price'],
    item.closePrice,
    item['close-price'],
    0
  );
  if (value > 0) marketDataSnapshotCache[clean] = { value, ts: Date.now() };
  return value;
}


// Fetch OI from Yahoo Finance option chain — works 24/7, no auth needed.
// Returns Map of streamerSymbol -> { oi, volume } e.g. '.AAPL260605C307.5' -> { oi: 3498, volume: 120 }
const yahooOiCache = new Map(); // key: 'AAPL|2026-06-05', ttl 15min
async function fetchYahooOI(symbol, expDate) {
  // Skip Yahoo for index options (SPX/SPXW) — use CBOE instead
  if (/^SPX[W]?$/i.test(symbol)) return new Map();

  const cacheKey = symbol + '|' + expDate;
  const cached = yahooOiCache.get(cacheKey);
  if (cached && Date.now() - cached.ts < 15 * 60 * 1000) return cached.map;

  try {
    const helperPath = path.join(__dirname, 'yahoo_oi_fetch.py');
    const pyExe = process.env.PYTHON || process.env.PYTHON_EXECUTABLE || 'python';
    const payload = await new Promise((resolve, reject) => {
      const proc = spawn(pyExe, [helperPath, symbol, expDate], { windowsHide: true });
      let stdout = '';
      let stderr = '';
      proc.stdout.on('data', chunk => stdout += chunk.toString('utf8'));
      proc.stderr.on('data', chunk => stderr += chunk.toString('utf8'));
      proc.on('error', reject);
      proc.on('close', code => {
        if (code !== 0 && !stdout.trim()) return reject(new Error(stderr.trim() || 'yfinance helper exited ' + code));
        try {
          resolve(JSON.parse(stdout || '{}'));
        } catch (e) {
          reject(new Error((stderr || stdout || e.message).trim()));
        }
      });
    });
    if (payload?.error) throw new Error(payload.error);
    const items = payload?.items || {};
    const oiMap = new Map();
    Object.entries(items).forEach(([dxSym, info]) => {
      const item = { oi: maxWholeNumber(info?.oi), volume: firstVolumeNumber(info?.volume) };
      oiMap.set(dxSym, item);
      if (info?.contractSymbol) oiMap.set(String(info.contractSymbol).toUpperCase(), item);
    });
    yahooOiCache.set(cacheKey, { map: oiMap, ts: Date.now() });
    log('Yahoo OI fetched for', symbol, expDate, '- contracts:', oiMap.size);
    return oiMap;
  } catch(e) {
    log('Yahoo OI fetch error:', e.message);
    return new Map();
  }
}

// ─── CBOE OI for SPX / SPXW ──────────────────────────────────────────────────
// CBOE CDN delayed quotes. Yahoo returns 0 for index options; CBOE is authoritative.
// _SPX.json  = standard monthly (AM-settled)
// _SPXW.json = weekly/PM-settled expirations (may return empty outside market hours)
// Both are fetched in parallel and merged. Each cached separately for 15 min.
const cboeSpxCache  = { data: null, date: null, pending: null };
const cboeSpxwCache = { data: null, date: null, pending: null };

function cboeHttpFetch(url) {
  return new Promise((resolve) => {
    const req2 = https.get(
      url,
      { headers: { 'User-Agent': 'Mozilla/5.0', 'Accept': 'application/json' }, timeout: 12000 },
      (res2) => {
        let raw = '';
        res2.on('data', c => raw += c);
        res2.on('end', () => {
          const contentType = String(res2.headers['content-type'] || '').toLowerCase();
          if (res2.statusCode !== 200) {
            log('CBOE fetch error', url, 'status', res2.statusCode, 'content-type', contentType || 'unknown');
            resolve([]);
            return;
          }
          if (contentType && !contentType.includes('json')) {
            log('CBOE unexpected content', url, 'status', res2.statusCode, 'content-type', contentType);
            resolve([]);
            return;
          }
          try {
            const json = JSON.parse(raw);
            resolve(json?.data?.options || []);
          } catch(e) {
            log('CBOE parse error', url, e.message, 'content-type', contentType || 'unknown');
            resolve([]);
          }
        });
      }
    );
    req2.on('error',   (e) => { log('CBOE fetch error', url, e.message); resolve([]); });
    req2.on('timeout', ()  => { req2.destroy(); resolve([]); });
  });
}

async function refreshCboeCache(cache, url) {
  if (cache.pending) { await cache.pending; return; }
  // Cache entire trading day (until next market open)
  const today = new Date().toISOString().split('T')[0];
  if (cache.data && cache.date === today) return;
  cache.pending = cboeHttpFetch(url).then(opts => {
    cache.data = opts;
    cache.date = today;
    log('CBOE cached', url, '-', (opts.length || 0), 'contracts');
  }).finally(() => { cache.pending = null; });
  await cache.pending;
}

async function fetchCboeSpxOI(expDate) {
  // Fetch both monthly and weekly in parallel
  await Promise.all([
    refreshCboeCache(cboeSpxCache,  'https://cdn.cboe.com/api/global/delayed_quotes/options/_SPX.json'),
    refreshCboeCache(cboeSpxwCache, 'https://cdn.cboe.com/api/global/delayed_quotes/options/_SPXW.json'),
  ]);
  const allOpts = [...(cboeSpxCache.data || []), ...(cboeSpxwCache.data || [])];
  return buildCboeOiMap(allOpts, expDate);
}

// OCC symbol format: {ROOT}{YYMMDD}{CP}{strike×1000 zero-padded 8 digits}
// e.g. SPX260515C05800000 → root=SPX, date=260515, C, strike=5800
const OCC_RX = /^([A-Z]{1,6})(\d{6})([CP])(\d{8})$/;

function buildCboeOiMap(options, expDate) {
  const oiMap = new Map();
  for (const opt of options) {
    const occSym = String(opt.option || '').trim().toUpperCase();
    const m = occSym.match(OCC_RX);
    if (!m) continue;

    const [, root, yymmdd, side, strikeRaw] = m;
    // Filter by expiration date (YYYY-MM-DD)
    const yy = yymmdd.slice(0,2), mm = yymmdd.slice(2,4), dd = yymmdd.slice(4,6);
    const isoExp = `20${yy}-${mm}-${dd}`;
    if (expDate && isoExp !== expDate) continue;

    // OCC strike encoding: value × 1000, zero-padded to 8 digits
    const strikeNum = parseInt(strikeRaw, 10) / 1000;
    const strikeStr = Number.isInteger(strikeNum) ? String(strikeNum) : String(strikeNum);

    const oi  = Math.round(Number(opt.open_interest) || 0);
    const vol = Math.round(Number(opt.volume) || 0);
    const item = { oi, volume: vol };

    // Register under both dxFeed key variants (.SPX... and .SPXW...)
    oiMap.set(`.${root}${yymmdd}${side}${strikeStr}`, item);
    if (root === 'SPX')  oiMap.set(`.SPXW${yymmdd}${side}${strikeStr}`, item);
    if (root === 'SPXW') oiMap.set(`.SPX${yymmdd}${side}${strikeStr}`,  item);
    // Also store keyed by the raw OCC symbol for direct lookup
    oiMap.set(occSym, item);
  }
  log('CBOE OI map for', expDate || 'all', ':', oiMap.size, 'entries');
  return oiMap;
}

async function ensureTodaySpxOptionSubscriptions() {
  if (spx0dteEnsurePromise) return spx0dteEnsurePromise;
  spx0dteEnsurePromise = (async () => {
    const { status: s1, data: d1 } = await ttGet('/option-chains/SPX/nested');
    if (s1 !== 200 || !d1?.data?.items?.length) {
      log('SPX 0DTE subscribe: nested chain failed', s1);
      return 0;
    }

    const chainObj = d1.data.items.find(c => c['root-symbol'] === 'SPXW') || d1.data.items[0];
    const rootSymbol = chainObj['root-symbol'] || 'SPXW';
    const allExpDates = (chainObj.expirations || []).map(e => e['expiration-date']).filter(Boolean).sort();
    const expDate = getTargetExpirationDate(allExpDates);
    if (!expDate) return 0;
    const compactExp = String(expDate).replace(/-/g, '').slice(2);
    const already = [...subscriptions].filter(s => isSpxwSymbol(s) && optionExpirationCompact(s) === compactExp);
    if (already.length >= 160) return already.length;

    const { status: s2, data: d2 } = await ttGet(`/option-chains/${encodeURIComponent(rootSymbol)}?expiration-date=${expDate}`);
    const options = s2 === 200 && d2?.data?.items ? d2.data.items : [];
    const quotePrice = await fetchUnderlyingLast('SPX').catch(() => 0);
    const dxSpot = firstFiniteNumber(dxQuoteCache['SPX']?.last, dxQuoteCache['$SPX']?.last, dxTradeCache['$SPX']?.price, dxQuoteCache['SPX']?.bidPrice, dxQuoteCache['$SPX']?.bidPrice, 0);
    const underlyingPrice = inferUnderlyingPrice(options, quotePrice || dxSpot) || dxSpot || 5800;
    const syms = pickNearestOptionStreamerSymbols(options, underlyingPrice, 160);
    if (!syms.length) return already.length;

    syms.forEach(sym => addAutoSubscription(sym, ['Quote','Trade','TradeETH','Greeks','Summary']));
    log('SPX 0DTE subscribe:', syms.length, 'symbols for', expDate, 'around', underlyingPrice);
    return syms.length;
  })().finally(() => { spx0dteEnsurePromise = null; });
  return spx0dteEnsurePromise;
}

function normalizeRestSymbol(symbol) {
  const s = String(symbol || '').trim().replace(/^\$/, '');
  if (s === 'SPX.X') return 'SPX';
  if (s === 'VIX.X') return 'VIX';
  return s;
}

function normalizeDxCacheSymbol(symbol) {
  let s = String(symbol || '').trim();
  if (!s) return s;

  // Strip leading dot (TastyTrade streamer-symbol format: .SPXW260717C7505)
  s = s.replace(/^\./, '');

  // Normalize futures contracts (normalize to explicit year)
  if (/^\/ESU(26|6)?$/i.test(s)) return '/ESU26';
  if (/^\/ES(:XCME)?$/i.test(s)) return '/ES:XCME';
  if (/^\/NQU(26|6)?$/i.test(s)) return '/NQU26';
  if (/^\/NQ(:XCME)?$/i.test(s)) return '/NQ:XCME';

  // Accept any symbol with C/P + digits (option format)
  if (/[CP]\d/.test(s)) {
    return s.toUpperCase();
  }

  // Validate stock tickers: SPX, AAPL, VIX, etc.
  if (/^[A-Z]{1,5}$/.test(s) && !s.includes('/')) {
    return s.toUpperCase();
  }

  // Silently reject malformed symbols (don't spam logs)
  return null;
}

function getDxCacheAliases(symbol, normalized) {
  const aliases = new Set([normalized]);
  const raw = String(symbol || '').trim();
  if (raw) aliases.add(raw);
  if (normalized && /^[A-Z]+\d{6}[CP]\d+$/i.test(normalized)) {
    aliases.add(normalized.replace(/^\./, ''));
    aliases.add('.' + normalized.replace(/^\./, ''));
  }
  if (/^\/ESU(26|6)?$/i.test(raw)) {
    aliases.add('/ESU26');
    aliases.add('/ESU6');
  } else if (/^\/ES(:XCME)?$/i.test(raw)) {
    aliases.add('/ES:XCME');
    aliases.add('/ES');
  } else if (/^\/NQU(26|6)?$/i.test(raw)) {
    aliases.add('/NQU26');
    aliases.add('/NQU6');
  } else if (/^\/NQ(:XCME)?$/i.test(raw)) {
    aliases.add('/NQ:XCME');
    aliases.add('/NQ');
  } else if (/^SPX$/i.test(normalized)) {
    aliases.add('$SPX');
    aliases.add('SPX');
  } else if (/^VIX$/i.test(normalized)) {
    aliases.add('$VIX.X');
    aliases.add('VIX');
  } else if (/^NDX$/i.test(normalized)) {
    aliases.add('NDX');
  }
  return [...aliases].filter(Boolean);
}

function isAfter8pmEtNow() {
  const now = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/New_York' }));
  return now.getHours() >= 20;
}

async function fetchTodayRegularSessionClose(symbol) {
  const clean = normalizeRestSymbol(symbol);
  const yahooSymbolMap = {
    SPX: '^GSPC',
    VIX: '^VIX',
    NDX: '^NDX',
    '/ES:XCME': 'ES=F',
    '/NQ:XCME': 'NQ=F'
  };
  const yahooSymbol = yahooSymbolMap[clean] || clean;
  try {
    const resp = await fetch(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(yahooSymbol)}?range=1d&interval=1m&includePrePost=false`, {
      headers: { 'User-Agent': 'Mozilla/5.0', 'Accept': 'application/json' }
    });
    if (!resp.ok) return 0;
    const data = await resp.json();
    const result = data?.chart?.result?.[0];
    const timestamps = result?.timestamp || [];
    const quotes = result?.indicators?.quote?.[0] || {};
    const closes = quotes.close || [];
    let lastRegular = 0;
    for (let i = 0; i < timestamps.length && i < closes.length; i++) {
      const d = new Date(timestamps[i] * 1000);
      const et = new Date(d.toLocaleString('en-US', { timeZone: 'America/New_York' }));
      const mins = et.getHours() * 60 + et.getMinutes();
      if (mins <= 960) {
        const c = firstFiniteNumber(closes[i], 0);
        if (c > 0) lastRegular = c;
      }
    }
    return lastRegular;
  } catch (_) {
    return 0;
  }
}

async function fetchYahooIntradayQuote(symbol) {
  const clean = normalizeRestSymbol(symbol);
  const yahooSymbolMap = {
    SPX: '^GSPC',
    VIX: '^VIX',
    NDX: '^NDX',
    '/ES:XCME': 'ES=F',
    '/NQ:XCME': 'NQ=F'
  };
  const yahooSymbol = yahooSymbolMap[clean] || clean;
  try {
    const resp = await fetch(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(yahooSymbol)}?range=1d&interval=1m&includePrePost=false`, {
      headers: { 'User-Agent': 'Mozilla/5.0', 'Accept': 'application/json' }
    });
    if (!resp.ok) return null;
    const data = await resp.json();
    const result = data?.chart?.result?.[0];
    const timestamps = result?.timestamp || [];
    const quotes = result?.indicators?.quote?.[0] || {};
    const closes = quotes.close || [];
    let last = 0;
    for (let i = 0; i < timestamps.length && i < closes.length; i++) {
      const c = firstFiniteNumber(closes[i], 0);
      if (c > 0) last = c;
    }
    const prevClose = firstFiniteNumber(
      result?.meta?.regularMarketPreviousClose,
      result?.meta?.previousClose,
      result?.meta?.chartPreviousClose,
      0
    );
    return { last, prevClose };
  } catch (_) {
    return null;
  }
}

async function fetchTodayIntradayCandles(symbol) {
  const clean = normalizeRestSymbol(symbol);
  const yahooSymbolMap = {
    SPX: '^GSPC',
    VIX: '^VIX',
    NDX: '^NDX',
    '/ES:XCME': 'ES=F',
    '/NQ:XCME': 'NQ=F'
  };
  const yahooSymbol = yahooSymbolMap[clean] || clean;
  try {
    const resp = await fetch(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(yahooSymbol)}?range=1d&interval=1m&includePrePost=false`, {
      headers: { 'User-Agent': 'Mozilla/5.0', 'Accept': 'application/json' }
    });
    if (!resp.ok) return [];
    const data = await resp.json();
    const result = data?.chart?.result?.[0];
    const timestamps = result?.timestamp || [];
    const quotes = result?.indicators?.quote?.[0] || {};
    const opens = quotes.open || [];
    const highs = quotes.high || [];
    const lows = quotes.low || [];
    const closes = quotes.close || [];
    const volumes = quotes.volume || [];
    const candles = [];
    for (let i = 0; i < timestamps.length; i++) {
      const time = timestamps[i] * 1000;
      const candle = {
        time,
        open: firstFiniteNumber(opens[i], closes[i], 0),
        high: firstFiniteNumber(highs[i], opens[i], closes[i], 0),
        low: firstFiniteNumber(lows[i], opens[i], closes[i], 0),
        close: firstFiniteNumber(closes[i], opens[i], 0),
        volume: firstFiniteNumber(volumes[i], 0)
      };
      if (Number.isFinite(candle.close) && candle.close > 0) candles.push(candle);
    }
    return candles;
  } catch (_) {
    return [];
  }
}

function marketDataQueryForSymbols(symbols) {
  const parts = [];
  symbols.map(normalizeRestSymbol).filter(Boolean).forEach(sym => {
    if (sym === 'SPX' || sym === 'NDX' || sym === 'VIX') parts.push('index[]=' + encodeURIComponent(sym));
    else if (/^\//.test(sym)) parts.push('future[]=' + encodeURIComponent(sym));
    else parts.push('equity[]=' + encodeURIComponent(sym));
  });
  return parts.join('&');
}

// Fetch yesterday's close for a symbol from TT REST market-data/history (1 daily bar)
async function fetchTTDailyClose(symbol) {
  try {
    const clean = normalizeRestSymbol(symbol);
    const qs = clean === 'SPX' || clean === 'NDX' || clean === 'VIX'
      ? `index[]=${encodeURIComponent(clean)}`
      : marketDataQueryForSymbols([clean]);
    const { status, data } = await ttGet(`/market-data/by-type?${qs}`);
    if (status !== 200) return 0;
    const item = data?.data?.items?.[0] || {};
    // TT market-data returns prev-close and close fields
    const close = firstFiniteNumber(
      item['prev-close'],
      item['previous-close'],
      item.prevClose,
      item['close-price'],
      item.closePrice,
      0
    );
    return close;
  } catch (_) { return 0; }
}

async function fetchPrevCloseFallback(symbol) {
  const clean = normalizeRestSymbol(symbol);
  const cached = prevCloseFallbackCache[clean];
  const now = Date.now();
  if (cached && cached.value > 0 && (now - cached.ts) < 6 * 60 * 60 * 1000) return cached.value;

  const yahooSymbolMap = {
    SPX: '^GSPC',
    VIX: '^VIX',
    NDX: '^NDX',
    '/ES:XCME': 'ES=F',
    '/NQ:XCME': 'NQ=F'
  };
  const yahooSymbol = yahooSymbolMap[clean] || clean;

  try {
    const resp = await fetch(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(yahooSymbol)}?range=5d&interval=1d`, {
      headers: { 'User-Agent': 'Mozilla/5.0', 'Accept': 'application/json' }
    });
    if (!resp.ok) return 0;
    const data = await resp.json();
    const result = data?.chart?.result?.[0] || {};
    const meta = result?.meta || {};
    const closeSeries = result?.indicators?.quote?.[0]?.close || [];
    const finiteCloses = closeSeries.map(v => firstFiniteNumber(v, 0)).filter(v => v > 0);
    // Yahoo's last daily candle is often today's in-progress bar, so use the
    // prior completed close when at least two daily closes are present.
    const prevCloseFromSeries = finiteCloses.length >= 2
      ? finiteCloses[finiteCloses.length - 2]
      : (finiteCloses[0] || 0);
    const metaPrevClose = firstFiniteNumber(
      meta.regularMarketPreviousClose,
      meta.previousClose,
      meta.chartPreviousClose,
      0
    );
    const prevClose = firstFiniteNumber(prevCloseFromSeries, metaPrevClose, 0);
    if (prevClose > 0) prevCloseFallbackCache[clean] = { value: prevClose, ts: now };
    return prevClose;
  } catch (_) {
    return 0;
  }
}

function quoteValue(q, ...keys) {
  for (const key of keys) {
    const n = finiteNumber(q?.[key]);
    if (n !== null) return n;
  }
  return 0;
}

function schwabLikeQuotePayload(requestedSymbols, items) {
  const byCleanSymbol = new Map();
  (items || []).forEach(item => {
    const clean = normalizeRestSymbol(item.symbol || item['underlying-symbol'] || item['root-symbol']);
    if (clean) byCleanSymbol.set(clean, item);
  });
  const out = {};
  requestedSymbols.forEach(original => {
    const clean = normalizeRestSymbol(original);
    const item = byCleanSymbol.get(clean) || byCleanSymbol.get(clean.replace(/^\//, '')) || {};
    const q = item.quote || item;
    out[original] = {
      assetMainType: item.instrumentType || item['instrument-type'] || '',
      symbol: original,
      quote: {
        symbol: original,
        lastPrice: quoteValue(q, 'last', 'last-price', 'last-trade-price', 'mark', 'mark-price', 'mid-price'),
        netChange: quoteValue(q, 'change', 'net-change', 'day-change'),
        netPercentChange: quoteValue(q, 'change-percent', 'net-percent-change', 'day-change-percent'),
        bidPrice: quoteValue(q, 'bid', 'bid-price'),
        askPrice: quoteValue(q, 'ask', 'ask-price'),
        totalVolume: quoteValue(q, 'volume', 'day-volume', 'volume-count'),
        quoteTime: Date.now()
      }
    };
  });
  return out;
}

async function sendSchwabLikeQuotes(res, symbols) {
  const requested = symbols.map(s => String(s || '').trim()).filter(Boolean);
  if (!requested.length) return sendJSON(res, 400, { error: 'missing symbols' });
  const query = marketDataQueryForSymbols(requested);
  const { status, data } = await ttGet(`/market-data/by-type?${query}`);
  if (status !== 200) return sendJSON(res, status, data);
  return sendJSON(res, 200, schwabLikeQuotePayload(requested, data?.data?.items || []));
}

async function fetchSchwabLikeChain(symbol, contractType = 'ALL', strikeCount = 60) {
  const sym = normalizeRestSymbol(symbol);
  const { status: nestedStatus, data: nestedData } = await ttGet(`/option-chains/${encodeURIComponent(sym)}/nested`);
  if (nestedStatus !== 200 || !nestedData?.data?.items?.length) {
    return { status: nestedStatus, data: nestedData };
  }

  // FORCE SPXW FOR WEEKLIES
  const chainObj = nestedData.data.items.find(c => c['root-symbol'] === 'SPXW') || nestedData.data.items[0];
  const rootSymbol = chainObj['root-symbol'] || sym;
  const expirations = (chainObj.expirations || []).map(e => e['expiration-date']).filter(Boolean).sort();
  const expDate = expirations[0];
  if (!expDate) return { status: 200, data: { symbol: sym, underlyingPrice: 0, callExpDateMap: {}, putExpDateMap: {} } };

  const { status, data } = await ttGet(`/option-chains/${encodeURIComponent(rootSymbol)}?expiration-date=${expDate}`);
  if (status !== 200) return { status, data };

  const options = data?.data?.items || [];
  const underlyingPrice = firstFiniteNumber(options[0]?.['underlying-price'], options[0]?.underlyingPrice, 0);
  const sorted = options
    .filter(o => o['expiration-date'] === expDate)
    .sort((a, b) => Math.abs(firstFiniteNumber(a['strike-price'], 0) - underlyingPrice) - Math.abs(firstFiniteNumber(b['strike-price'], 0) - underlyingPrice))
    .slice(0, Math.max(1, Number(strikeCount) || 60) * 2);

  const callExpDateMap = {};
  const putExpDateMap = {};
  const expKey = expDate;
  callExpDateMap[expKey] = {};
  putExpDateMap[expKey] = {};

  sorted.forEach(opt => {
    const rawType = String(opt['option-type'] || '').toUpperCase();
    const isCall = rawType === 'C' || rawType === 'CALL';
    const isPut = rawType === 'P' || rawType === 'PUT';
    if ((contractType === 'CALL' && !isCall) || (contractType === 'PUT' && !isPut)) return;
    if (!isCall && !isPut) return;
    const strike = String(parseFloat(opt['strike-price'] || 0));
    const streamerSym = opt['streamer-symbol'] || '';
    const greeks = dxGreeksCache[streamerSym] || {};
    const summary = dxSummaryCache[streamerSym] || {};
    const quote = dxQuoteCache[streamerSym] || {};
    const trade = dxTradeCache[streamerSym] || {};
    const row = {
      symbol: opt.symbol || '',
      putCall: isCall ? 'CALL' : 'PUT',
      strikePrice: parseFloat(strike),
      expirationDate: expDate,
      bid: firstFiniteNumber(quote.bidPrice, opt.bid, opt['bid-price']),
      ask: firstFiniteNumber(quote.askPrice, opt.ask, opt['ask-price']),
      last: firstFiniteNumber(opt.last, opt['last-price'], opt['close-price']),
      totalVolume: firstVolumeNumber(trade.dayVolume, opt['day-volume'], opt['day-volume-count'], opt['volume-count'], opt.volume, opt['volume'], summary.dayVolume),
      openInterest: maxWholeNumber(opt['open-interest'], opt.openInterest, summary.openInterest),
      volatility: firstFiniteNumber(greeks.volatility, opt['implied-volatility']),
      delta: firstFiniteNumber(greeks.delta, opt.delta),
      gamma: firstFiniteNumber(greeks.gamma, opt.gamma),
      theta: firstFiniteNumber(greeks.theta, opt.theta),
      vega: firstFiniteNumber(greeks.vega, opt.vega)
    };
    const target = isCall ? callExpDateMap : putExpDateMap;
    if (!target[expKey][strike]) target[expKey][strike] = [];
    target[expKey][strike].push(row);
  });

  return { status: 200, data: { symbol: sym, underlyingPrice, callExpDateMap, putExpDateMap } };
}

// ─── dxLink ───────────────────────────────────────────────────────────────────
async function fetchDxLinkToken() {
  const { status, data } = await ttGet('/api-quote-tokens');
  if (status !== 200 || !data?.data?.token) { log('api-quote-token failed:', status); return false; }
  dxQuoteToken = data.data.token;
  dxWssUrl     = data.data['dxlink-url'] || 'wss://tasty-openapi-ws.dxfeed.com/realtime';
  log('dxLink token OK. URL:', dxWssUrl);
  return true;
}

function broadcast(msg) {
  const s = typeof msg === 'string' ? msg : JSON.stringify(msg);
  dxClients.forEach(ws => { if (ws.readyState === WebSocket.OPEN) ws.send(s); });
}

async function ensureDxLinkReady() {
  if (dxSocket && dxSocket.readyState === WebSocket.OPEN && dxChannelOpen) return true;
  const ok = await ensureToken();
  if (!ok) return false;
  const dxOk = await fetchDxLinkToken();
  if (!dxOk) return false;
  if (!dxSocket || (dxSocket.readyState !== WebSocket.OPEN && dxSocket.readyState !== WebSocket.CONNECTING)) {
    connectDxLink();
  }
  const started = Date.now();
  while (Date.now() - started < 5000) {
    if (dxSocket && dxSocket.readyState === WebSocket.OPEN && dxChannelOpen) return true;
    await sleep(100);
  }
  return !!(dxSocket && dxSocket.readyState === WebSocket.OPEN && dxChannelOpen);
}

function sendSubscriptions() {
  // AUTO channel - queue ONLY NEW subscriptions (not re-queuing old ones)
  if (!dxSocket || dxSocket.readyState !== WebSocket.OPEN || !dxChannelOpen) return;
  if (!pendingNewSubscriptions) return;  // Exit early if no new subscriptions

  pendingNewSubscriptions = false;  // Reset flag

  // Log current state
  if (subscriptions.size > 1000) {
    log(`[SUBSCRIPTIONS] WARNING: subscriptions set has ${subscriptions.size} symbols!`);
  }

  // Queue only symbols that haven't been queued or activated yet
  let newCount = 0;
  subscriptions.forEach(sym => {
    const types = [...(subscriptionTypesBySymbol.get(sym) || new Set(defaultAutoTypesForSymbol(sym)))];
    types.forEach(t => {
      const key = `${t}:${sym}`;
      // Only queue if not already active or queued
      if (!activeAutoSubscriptionKeys.has(key) && !queuedSubscriptionKeys.has(key)) {
        queueAutoSubscription({ type: t, symbol: sym });
        newCount++;
      }
    });
  });

  if (newCount > 0) {
    log(`[SUBSCRIPTIONS] Found ${newCount} new subscription items to queue (total symbols: ${subscriptions.size})`);
    sendSubscriptionsRateLimited();
  }
}

function shouldAcceptBrowserSubscription(sym, msg = {}) {
  if (!sym) return false;
  if (isCoreLiveSubscription(sym)) return true;
  if (/\{type=optstat\}$/i.test(String(sym))) return true;
  if (/\{=/.test(String(sym))) return true;
  if (msg?.spxSubscribe && isSpxwSymbol(sym)) return true;
  return false;
}

function sendCandleSubscriptions() {
  // HISTORY channel - Candle subscriptions with fromTime (24h ago in ms)
  if (!dxSocket || dxSocket.readyState !== WebSocket.OPEN || !dxHistoryChannelOpen) return;
  if (candleSubscriptions.size === 0) return;
  const fromTimeMs = Date.now() - 86400000;
  const add = [];
  candleSubscriptions.forEach(sym => {
    const key = `Candle:${sym}`;
    if (!activeCandleSubscriptionKeys.has(key)) {
      add.push({ type: 'Candle', symbol: sym, fromTime: fromTimeMs });
    }
  });
  if (add.length === 0) return;
  log('HISTORY FEED_SUBSCRIPTION:', add.length, 'candle subs (fromTime ms:', fromTimeMs, ')');
  for (let i = 0; i < add.length; i += 10) {
    dxSocket.send(JSON.stringify({
      type:'FEED_SUBSCRIPTION',
      channel: DX_CHANNEL_HISTORY,
      reset: i === 0,
      add: add.slice(i, i + 10)
    }));
    add.slice(i, i + 10).forEach(item => activeCandleSubscriptionKeys.add(`Candle:${item.symbol}`));
  }
}

function compactRows(eventType, rows, fields) {
  if (!Array.isArray(rows)) return [];
  const rowsIncludeType = rows[0] === eventType;
  const step = fields.length + (rowsIncludeType ? 2 : 1);
  const out = [];
  for (let i = 0; i < rows.length; i += step) {
    const base = i + (rowsIncludeType ? 2 : 1);
    const item = { eventType, eventSymbol: rowsIncludeType ? rows[i + 1] : rows[i] };
    fields.forEach((f, j) => item[f] = rows[base + j]);
    if (item.eventSymbol) out.push(item);
  }
  return out;
}

function normalizeCandle(c) {
  const t = firstFiniteNumber(c.time, c.eventTime, 0);
  const open = finiteNumber(c.open);
  const high = finiteNumber(c.high);
  const low = finiteNumber(c.low);
  const close = finiteNumber(c.close);
  if (!t || open === null || high === null || low === null || close === null) return null;
  // dxFeed REMOVE_EVENT flag (bit 1, value=2) marks placeholder candles - skip them
  const flags = Number(c.eventFlags) || 0;
  if (flags & 0x02) return null;
  // dxFeed Candle.time is always in milliseconds per dxFeed API spec
  return {
    datetime: t,
    open,
    high,
    low,
    close,
    volume: firstFiniteNumber(c.volume, 0)
  };
}

function cacheCandles(candleSymbol, rows) {
  if (!dxCandleCache[candleSymbol]) dxCandleCache[candleSymbol] = new Map();
  const cache = dxCandleCache[candleSymbol];
  rows.forEach(row => {
    const c = normalizeCandle(row);
    if (c) cache.set(c.datetime, c);
  });
  const sortedKeys = [...cache.keys()].sort((a, b) => a - b);
  while (sortedKeys.length > 5000) cache.delete(sortedKeys.shift());
}

function cacheTradeAsFiveMinuteCandle(sym, price, size) {
  const p = finiteNumber(price);
  if (!/^\/(ES|NQ)/.test(sym) || p === null || p <= 0) return;
  const bucket = Math.floor(Date.now() / 300000) * 300000;
  const candleSymbol = `${sym}{=5m}`;
  if (!dxCandleCache[candleSymbol]) dxCandleCache[candleSymbol] = new Map();
  const cache = dxCandleCache[candleSymbol];
  const prev = cache.get(bucket);
  const volume = firstFiniteNumber(size, 0);
  cache.set(bucket, prev ? {
    datetime: bucket,
    open: prev.open,
    high: Math.max(prev.high, p),
    low: Math.min(prev.low, p),
    close: p,
    volume: (prev.volume || 0) + volume
  } : {
    datetime: bucket,
    open: p,
    high: p,
    low: p,
    close: p,
    volume
  });
  const sortedKeys = [...cache.keys()].sort((a, b) => a - b);
  while (sortedKeys.length > 5000) cache.delete(sortedKeys.shift());
}

function normalizeRequestedCandleSymbols(sym) {
  const raw = String(sym || '');
  const match = raw.match(/^(.*?)(\{=.*\})$/);
  if (!match) return [raw];
  const base = match[1];
  const suffix = match[2];
  const out = new Set([raw]);
  if (/^\/?ES/.test(base)) {
    out.add(`/ES:XCME${suffix}`);
    out.add(`/ES${suffix}`);
    out.add(`/ESU6${suffix}`);
    out.add(`/ESU26${suffix}`);
  }
  if (/^\/?NQ/.test(base)) {
    out.add(`/NQ:XCME${suffix}`);
    out.add(`/NQU6${suffix}`);
    out.add(`/NQU26${suffix}`);
    out.add(`/NQM6${suffix}`);
    out.add(`/NQM26${suffix}`);
  }
  return [...out];
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// ─── Subscription Manager v2 ────────────────────────────────────────────────
// Simplified: Just dedup subscriptions, return immediately (don't wait for cache)
// Pages get whatever's in REST response, live data arrives via WebSocket
const subscriptionManager = {
  pageOwnedSubscriptions: new Map(),
  pageRequests: new Map(),

  releaseSymbols(symbols, reason = 'page-release') {
    if (!symbols || symbols.size === 0) return 0;

    let removed = 0;
    symbols.forEach(sym => {
      const currentCount = this.pageOwnedSubscriptions.get(sym) || 0;
      if (currentCount > 1) {
        this.pageOwnedSubscriptions.set(sym, currentCount - 1);
        return;
      }

      this.pageOwnedSubscriptions.delete(sym);
      if (removeAutoSubscription(sym, reason)) {
        removed++;
      }
    });

    return removed;
  },

  /**
   * Register a page's interest in symbols
   * Just deduplicates subscriptions, returns immediately
   */
  async request(pageId, symbols, options = {}) {
    if (!Array.isArray(symbols) || symbols.length === 0) {
      return { ready: true, count: 0, total: 0 };
    }

    const uniqueSymbols = [...new Set(symbols.filter(Boolean))];
    const nextSymbols = new Set(uniqueSymbols);
    const previous = this.pageRequests.get(pageId)?.symbols || new Set();
    const addedSymbols = uniqueSymbols.filter(sym => !previous.has(sym));
    const removedSymbols = new Set([...previous].filter(sym => !nextSymbols.has(sym)));

    if (removedSymbols.size > 0) {
      const removed = this.releaseSymbols(removedSymbols, `page-refresh:${pageId}`);
      if (removed > 0) {
        log(`[SubscriptionMgr] Released ${removed} stale subscriptions for page ${pageId}`);
      }
    }

    // Register page
    this.pageRequests.set(pageId, {
      symbols: nextSymbols,
      requested: Date.now()
    });

    // Subscribe only NEW symbols to dxLink
    const newSymbols = addedSymbols.filter(sym => !this.pageOwnedSubscriptions.has(sym) && !subscriptions.has(sym));
    if (newSymbols.length > 0) {
      log(`[SubscriptionMgr] Adding ${newSymbols.length} new subscriptions for page ${pageId}`);
      newSymbols.forEach(sym => {
        addAutoSubscription(sym, ['Quote','Greeks','Summary','Trade']);
      });
      sendSubscriptionsRateLimited();
    }

    addedSymbols.forEach(sym => {
      const currentCount = this.pageOwnedSubscriptions.get(sym) || 0;
      this.pageOwnedSubscriptions.set(sym, currentCount + 1);
    });

    // Return immediately - don't wait for cache
    // Pages will get live updates via WebSocket as data arrives
    log(`[SubscriptionMgr] Subscription registered: ${uniqueSymbols.length} symbols (${newSymbols.length} new)`);
    return { ready: true, count: uniqueSymbols.length, total: uniqueSymbols.length, newCount: newSymbols.length };
  },

  cleanup() {
    const now = Date.now();
    const timeout = 5 * 60 * 1000;
    let removed = 0;

    for (const [pageId, data] of this.pageRequests) {
      if (now - data.requested > timeout) {
        log(`[SubscriptionMgr] Cleanup: Removing stale page ${pageId}`);
        this.releaseSymbols(data.symbols, `page-timeout:${pageId}`);
        this.pageRequests.delete(pageId);
        removed++;
      }
    }

    if (removed > 0) log(`[SubscriptionMgr] Cleanup: Removed ${removed} stale page(s)`);
  }
};

setInterval(() => subscriptionManager.cleanup(), 60000);

async function waitForOptionData(streamerSymbols, timeoutMs = 3000) {
  const sample = [...new Set((streamerSymbols || []).filter(Boolean))];
  if (!sample.length) return;
  const started = Date.now();
  const threshold = Math.max(1, Math.floor(sample.length * 0.6)); // return when 60% have data
  while (Date.now() - started < timeoutMs) {
    let readyCount = 0;
    for (const sym of sample) {
      const hasSummary = !!dxSummaryCache[sym] && Object.keys(dxSummaryCache[sym]).length > 0;
      const hasGreeks = !!dxGreeksCache[sym] && Object.keys(dxGreeksCache[sym]).length > 0;
      if (hasSummary || hasGreeks) readyCount++;
    }
    if (readyCount >= threshold) return;
    await sleep(120);
  }
}

function convertCompactToObjects(data) {
  if (!Array.isArray(data) || data.length < 2) return [];
  const eventType = data[0];
  const rows = data[1];
  if (typeof eventType !== 'string' || !Array.isArray(rows)) return [];

  const fieldsByType = {
    Quote:   ['bidPrice','askPrice','bidSize','askSize'],
    Trade:   ['price','dayVolume','size'],
    TradeETH:['price','dayVolume','size'],
    Greeks:  ['volatility','delta','gamma','theta','rho','vega'],
    Summary: ['openInterest','dayVolume','dayOpenPrice','dayHighPrice','dayLowPrice','dayClosePriceType','dayLowPrice','dayClosePrice','prevClosePriceType','prevDayVolume','prevDayClosePrice'],
    TimeAndSale: ['time','sequence','exchangeCode','price','size','bidPrice','askPrice','saleConditions','flags'],
    Candle:  ['eventFlags','index','time','sequence','count','open','high','low','close','volume','vwap','bidVolume','askVolume','impVolatility'],
    Message: ['eventTime','attachment'],
    Configuration: ['eventTime','version','attachment']
  };
  
  const fields = fieldsByType[eventType];
  if (!fields) return [];
  
  if (eventType === 'Message' || eventType === 'Configuration') {
    const objects = [];
    const rowsIncludeType = rows[0] === eventType;
    const startIdx = rowsIncludeType ? 1 : 0;
    const stride = rowsIncludeType ? 3 : 2;
    for (let i = startIdx; i < rows.length; i += stride) {
      const sym = rows[i];
      if (typeof sym !== 'string' || !sym) continue;
      let attachment = null;
      for (let j = i + 1; j < Math.min(rows.length, i + stride); j++) {
        const val = rows[j];
        if (typeof val === 'string' && (/OptionStatisticsData\{/.test(val) || /[\w]+\{/.test(val))) {
          attachment = val;
          break;
        }
      }
      objects.push({ eventType, eventSymbol: sym, attachment });
    }
    return objects;
  }

  if (eventType === 'Message' || eventType === 'Configuration') {
    const objects = [];
    const rowsIncludeType = rows[0] === eventType;
    const startIdx = rowsIncludeType ? 1 : 0;
    const stride = rowsIncludeType ? 3 : 2;
    for (let i = startIdx; i < rows.length; i += stride) {
      const sym = rows[i];
      if (typeof sym !== 'string' || !sym) continue;
      let attachment = null;
      for (let j = i + 1; j < Math.min(rows.length, i + stride); j++) {
        const val = rows[j];
        if (typeof val === 'string' && (/OptionStatisticsData\{/.test(val) || /[\w]+\{/.test(val))) {
          attachment = val;
          break;
        }
      }
      objects.push({ eventType, eventSymbol: sym, attachment });
    }
    return objects;
  }

  const objects = [];
  // COMPACT format: [sym, field1, field2, ..., sym, field1, field2, ...]
  // Some dxFeed streams include eventType as rows[0]; check for it
  const rowsIncludeType = rows[0] === eventType;
  const startIdx = rowsIncludeType ? 1 : 0;
  const fieldCount = fields.length + 1; // +1 for symbol
  const stride = rowsIncludeType ? fieldCount + 1 : fieldCount; // +1 if type is included

  for (let i = startIdx; i + fieldCount <= rows.length; i += stride) {
    const sym = rows[i];
    if (typeof sym !== 'string' || !sym) continue; // skip malformed/non-string rows
    const obj = { eventType, eventSymbol: sym };
    for (let j = 0; j < fields.length; j++) {
      obj[fields[j]] = rows[i + 1 + j];
    }
    if (eventType === 'Message' || eventType === 'Configuration') {
      const attachment = obj.attachment;
      if (attachment) {
        global.dxOptionStatsCache = global.dxOptionStatsCache || {};
        const dxKey = sym.startsWith('$') ? sym.substring(1) : sym;
        try {
          const parsed = typeof attachment === 'string' ? JSON.parse(String(attachment).replace(/^[A-Za-z]+\{/, '{')) : attachment;
          const att = parsed && typeof parsed === 'object' ? parsed : null;
          if (att) {
            global.dxOptionStatsCache[dxKey] = att;
            global.dxOptionStatsCache[sym] = att;
          }
        } catch {}
      }
    }
    objects.push(obj);
  }
  return objects;
}

function connectDxLink() {
  if (dxSocket && (dxSocket.readyState === WebSocket.OPEN || dxSocket.readyState === WebSocket.CONNECTING)) {
    console.log('[DX] Already connecting/connected');
    return;
  }

  console.log('[DX] Connecting to:', dxWssUrl);
  dxSocket      = new WebSocket(dxWssUrl);
  dxSocket.on('error', e => console.log('[DX] WebSocket error:', e.message));
  dxAuthorized  = false;
  dxChannelOpen = false;
  dxHistoryChannelOpen = false;
  dxHistoryConfigured = false;
  activeAutoSubscriptionKeys.clear();
  activeCandleSubscriptionKeys.clear();

  dxSocket.on('open', () => {
    console.log('[DX] WebSocket connected, sending SETUP...');
    log('[dxLink] Connected, flushing subscriptions after reconnect');

    // On reconnect, clear all tracking and re-queue subscriptions
    // This ensures symbols that were subscribed before disconnect are re-subscribed
    activeAutoSubscriptionKeys.clear();
    queuedSubscriptionKeys.clear();
    pendingNewSubscriptions = true;

    if (dxSocket?.readyState === WebSocket.OPEN) {
      dxSocket.send(JSON.stringify({ type:'SETUP', channel:0, version:'0.1-DXF-JS/0.3.0', keepaliveTimeout:60, acceptKeepaliveTimeout:60 }));
    }

    // Wait for channel handshake, then flush subscriptions
    setTimeout(() => {
      if (dxChannelOpen && dxSocket.readyState === WebSocket.OPEN) {
        log('[dxLink] Sending subscription flush after reconnect (' + subscriptions.size + ' symbols)');
        sendSubscriptions();
      }
    }, 100);

    clearInterval(keepAliveInterval);
    keepAliveInterval = setInterval(() => {
      if (dxSocket?.readyState === WebSocket.OPEN) dxSocket.send(JSON.stringify({ type:'KEEPALIVE', channel:0 }));
    }, 30_000);
  });

  dxSocket.on('message', raw => {
    let msg;
    try { msg = JSON.parse(raw); } catch { return; }

    if (msg.type === 'AUTH_STATE') {
      if (msg.state === 'UNAUTHORIZED' && dxSocket?.readyState === WebSocket.OPEN) {
        dxSocket.send(JSON.stringify({ type:'AUTH', channel:0, token: dxQuoteToken }));
      } else if (msg.state === 'AUTHORIZED' && dxSocket?.readyState === WebSocket.OPEN) {
        dxAuthorized = true;
        // Open AUTO channel for Quote/Trade/Greeks/Summary
        dxSocket.send(JSON.stringify({ type:'CHANNEL_REQUEST', channel: DX_CHANNEL, service:'FEED', parameters:{ contract:'AUTO' } }));
        // Open dedicated HISTORY channel for Candle (time-series snapshots require HISTORY)
        dxSocket.send(JSON.stringify({ type:'CHANNEL_REQUEST', channel: DX_CHANNEL_HISTORY, service:'FEED', parameters:{ contract:'HISTORY' } }));
      }
    }
    else if (msg.type === 'CHANNEL_OPENED' && msg.channel === DX_CHANNEL) {
      console.log('[DX] CHANNEL_OPENED for AUTO (channel 1)');
      dxChannelOpen = true;
      if (dxSocket?.readyState === WebSocket.OPEN) dxSocket.send(JSON.stringify({
        type:'FEED_SETUP', channel: DX_CHANNEL,
        acceptAggregationPeriod: 0.1, acceptDataFormat:'COMPACT',
        acceptEventFields:{
          Quote:   ['eventType','eventSymbol','bidPrice','askPrice','bidSize','askSize'],
          Trade:   ['eventType','eventSymbol','price','dayVolume','size'],
          TradeETH:['eventType','eventSymbol','price','dayVolume','size'],
          TimeAndSale: ['eventType','eventSymbol','time','sequence','exchangeCode','price','size','bidPrice','askPrice','saleConditions','flags'],
          Greeks:  ['eventType','eventSymbol','volatility','delta','gamma','theta','rho','vega'],
          Summary: ['eventType','eventSymbol','openInterest','dayVolume','dayOpenPrice','dayHighPrice','dayLowPrice','dayClosePriceType','dayLowPrice','dayClosePrice','prevClosePriceType','prevDayVolume','prevDayClosePrice']
        }
      }));
      sendSubscriptions();
    }
    else if (msg.type === 'CHANNEL_OPENED' && msg.channel === DX_CHANNEL_HISTORY) {
      dxHistoryChannelOpen = true;
      if (dxSocket?.readyState === WebSocket.OPEN) dxSocket.send(JSON.stringify({
        type:'FEED_SETUP', channel: DX_CHANNEL_HISTORY,
        acceptAggregationPeriod: 0.1, acceptDataFormat:'COMPACT',
        acceptEventFields:{
          Candle: ['eventType','eventSymbol','eventFlags','index','time','sequence','count','open','high','low','close','volume','vwap','bidVolume','askVolume','impVolatility']
        }
      }));
      dxHistoryConfigured = true;
      sendCandleSubscriptions();
    }
    else if (msg.type === 'FEED_DATA') {
      // Log incoming data to verify dxLink is sending
      if (Array.isArray(msg.data) && msg.data.length >= 2) {
        const eventType = msg.data[0];
        const rows = msg.data[1];
        const rowCount = Array.isArray(rows) ? rows.length : 0;
        const fieldCount = rowCount > 0 ? Math.floor(rowCount / 10) : 0; // rough estimate of fields
        log(`[DX FEED_DATA] ${eventType} with ${rowCount} values (${fieldCount} records est.)`);
      }
      
      // Convert COMPACT format to object format for browser clients
      const convertedData = convertCompactToObjects(msg.data);
      
      // COMPACT format: data = [eventType, [sym, val1, val2, ...], ...]
      // Cache Greeks/Summary/Quote for option chain enrichment
      if (Array.isArray(msg.data) && msg.data.length >= 2) {
        const eventType = msg.data[0];
        const rows = msg.data[1];
        if (typeof eventType === 'string' && Array.isArray(rows)) {
          // COMPACT: rows = [sym, v1, v2, sym, v1, v2, ...]
          // Fields defined by FEED_SETUP acceptEventFields order
          const greeksFields  = ['volatility','delta','gamma','theta','rho','vega'];
          const summaryFields = ['openInterest','dayVolume','dayOpenPrice','dayHighPrice','dayLowPrice','dayClosePriceType','dayLowPrice','dayClosePrice','prevClosePriceType','prevDayVolume','prevDayClosePrice'];
          const quoteFields   = ['bidPrice','askPrice','bidSize','askSize'];
          const tradeFields   = ['price','dayVolume','size'];
          const candleFields  = ['eventFlags','index','time','sequence','count','open','high','low','close','volume','vwap','bidVolume','askVolume','impVolatility'];
          const rowsIncludeType = rows[0] === eventType;
          const timeAndSaleFields = ['time','sequence','exchangeCode','price','size','bidPrice','askPrice','saleConditions','flags'];
          const fieldCount = eventType === 'Greeks' ? greeksFields.length + (rowsIncludeType ? 2 : 1)
                           : eventType === 'Summary' ? summaryFields.length + (rowsIncludeType ? 2 : 1)
                           : eventType === 'Quote'   ? quoteFields.length + (rowsIncludeType ? 2 : 1)
                           : (eventType === 'Trade' || eventType === 'TradeETH') ? tradeFields.length + (rowsIncludeType ? 2 : 1)
                           : eventType === 'TimeAndSale' ? timeAndSaleFields.length + (rowsIncludeType ? 2 : 1)
                           : eventType === 'Candle' ? candleFields.length + (rowsIncludeType ? 2 : 1) : 0;
          if (eventType === 'Candle') {
            const candles = compactRows(eventType, rows, candleFields);
            const bySymbol = {};
            candles.forEach(c => {
              if (!bySymbol[c.eventSymbol]) bySymbol[c.eventSymbol] = [];
              bySymbol[c.eventSymbol].push(c);
            });
            Object.entries(bySymbol).forEach(([sym, list]) => cacheCandles(sym, list));
            // Normalize before broadcast so browser gets proper millisecond timestamps
            const normalizedForBroadcast = candles.map(c => {
              const n = normalizeCandle(c);
              if (!n) return null;
              return { ...n, eventSymbol: c.eventSymbol, eventType: c.eventType };
            }).filter(Boolean);
            broadcast({ type: 'CANDLE_DATA', data: normalizedForBroadcast });
            return;
          }
      if (fieldCount > 0) {
            for (let i = 0; i < rows.length; i += fieldCount) {
              const sym = rowsIncludeType ? rows[i + 1] : rows[i];
              const base = i + (rowsIncludeType ? 2 : 1);
              if (!sym) continue;
              if (eventType === 'Message' || eventType === 'Configuration') {
                const sample = rows.slice(base, Math.min(rows.length, base + 8));
                log('!!!!!!!!!! OPTSTAT EVENT RECEIVED !!!!!!!!!!', eventType, sym, 'sample=', JSON.stringify(sample));
              }
              if (eventType === 'Greeks') {
                const key = normalizeDxCacheSymbol(sym);
                const entry = {};
                getDxCacheAliases(sym, key).forEach(alias => { dxGreeksCache[alias] = entry; });
                greeksFields.forEach((f, j) => entry[f] = rows[base + j]);
                if (String(sym).includes('SPX') || String(sym).includes('SPY')) log(`[DX CACHE] Greeks for ${sym} → key: ${key}`);
              } else if (eventType === 'Summary') {
                const key = normalizeDxCacheSymbol(sym);
                const entry = {};
                getDxCacheAliases(sym, key).forEach(alias => { dxSummaryCache[alias] = entry; });
                summaryFields.forEach((f, j) => entry[f] = rows[base + j]);
                if (String(sym).includes('SPX') || String(sym).includes('SPY')) log(`[DX CACHE] Summary for ${sym} → key: ${key}`);
                const oi = Number(entry.openInterest ?? 0) || 0;
                if (oi > 0) {
                  getDxCacheAliases(sym, key).forEach(alias => { dxOpenInterestCache[alias] = oi; });
                }
                // Re-seed prevCloses once we have real dxLink data (runs at most once per session)
                if (!refreshLivePrevCloses._seededFromDX && (sym === 'SPX' || sym === '$SPX' || sym === 'VIX') && entry.prevDayClosePrice > 0) {
                  refreshLivePrevCloses._seededFromDX = true;
                  setTimeout(refreshLivePrevCloses, 500);
                }
                // After 4pm: capture dayClosePrice to persistent file so it survives restarts
                const etM = getEtMinutes();
                if (etM >= 960 && entry.dayClosePrice > 0) {
                  const today = new Date(new Date().toLocaleString('en-US',{timeZone:'America/New_York'})).toISOString().slice(0,10);
                  if (savedDailyCloses.date !== today) savedDailyCloses = { date: today, ES: 0, SPX: 0, VIX: 0 };
                  const rootSym = String(sym).split(':')[0];
                  if (rootSym.startsWith('/ES') && savedDailyCloses.ES === 0) { savedDailyCloses.ES = entry.dayClosePrice; saveDailyCloses(); }
                  if ((rootSym === 'SPX' || rootSym === '$SPX') && savedDailyCloses.SPX === 0) { savedDailyCloses.SPX = entry.dayClosePrice; saveDailyCloses(); }
                  if ((rootSym === 'VIX' || rootSym === '$VIX') && savedDailyCloses.VIX === 0) { savedDailyCloses.VIX = entry.dayClosePrice; saveDailyCloses(); }
                }

              } else if (eventType === 'Quote') {
                const key = normalizeDxCacheSymbol(sym);
                const entry = {};
                getDxCacheAliases(sym, key).forEach(alias => { dxQuoteCache[alias] = entry; });
                quoteFields.forEach((f, j) => entry[f] = rows[base + j]);
                if (String(sym).includes('SPX') || String(sym).includes('SPY')) log(`[DX CACHE] Quote for ${sym} → key: ${key}`);
                if (!/(^$|^NDX$|^VIX$)/.test(sym)) {
                  if (sym === 'SPY' || sym === 'SPX' || sym === '$SPX') {
                  }
                }
              } else if (eventType === 'Trade' || eventType === 'TradeETH') {
                const key = normalizeDxCacheSymbol(sym);
                const entry = dxTradeCache[key] || {};
                getDxCacheAliases(sym, key).forEach(alias => { dxTradeCache[alias] = entry; });
                tradeFields.forEach((f, j) => entry[f] = rows[base + j]);
                if (/(NDX|SPX|VIX)/.test(sym)) {
                }
                // Server-side SPX 0DTE flow accumulation
                if (isSpxwSymbol(sym)) {
                  spxFlowProcessTrade(sym, entry.price, entry.size, entry.time || Date.now());
                }
                cacheTradeAsFiveMinuteCandle(key, entry.price, entry.size);
              } else if (eventType === 'TimeAndSale') {
                const key = normalizeDxCacheSymbol(sym);
                const entry = dxTradeCache[key] || {};
                getDxCacheAliases(sym, key).forEach(alias => { dxTradeCache[alias] = entry; });
                timeAndSaleFields.forEach((f, j) => entry[f] = rows[base + j]);
                // Server-side SPX 0DTE flow accumulation (TimeAndSale has aggressorSide)
                if (isSpxwSymbol(sym)) {
                  spxFlowProcessTrade(sym, entry.price, entry.size, entry.time || Date.now(), entry.aggressorSide);
                }
                cacheTradeAsFiveMinuteCandle(key, entry.price, entry.size);
              }
            }
          }
        }
      }
      // Broadcast converted objects to browser clients
      if (convertedData && convertedData.length > 0) {
        broadcast({ type: 'FEED_DATA', data: convertedData });
      }
    }
    else if (msg.type === 'KEEPALIVE' && dxSocket?.readyState === WebSocket.OPEN) {
      dxSocket.send(JSON.stringify({ type:'KEEPALIVE', channel:0 }));
    }
    else if (msg.type === 'ERROR') {
      log('dxLink ERROR:', JSON.stringify(msg));
      if (msg.error === 'BAD_ACTION' && /subscription rate/i.test(String(msg.message || ''))) {
        subscriptionBatchDelay = Math.min(subscriptionBatchDelay * 2, SUBSCRIPTION_BATCH_DELAY_MAX);
        log('dxLink subscription throttle increased to', subscriptionBatchDelay, 'ms');
      }
    }
  });

  dxSocket.on('close', (code, reason) => {
    console.log('[DX] WebSocket closed:', code, reason);
    log(`dxLink closed (${code}) — reconnecting in 5s`);
    dxAuthorized = dxChannelOpen = dxHistoryChannelOpen = dxHistoryConfigured = false;
    activeAutoSubscriptionKeys.clear();
    activeCandleSubscriptionKeys.clear();
    clearInterval(keepAliveInterval);
    dxSocket = null;
    if (dxClients.size > 0) setTimeout(async () => {
      await ensureToken(); await fetchDxLinkToken(); connectDxLink();
    }, 5000);
  });

  dxSocket.on('error', e => log('dxLink error:', e.message));
}

// ─── HTTP Server ──────────────────────────────────────────────────────────────
function sendJSON(res, status, obj) {
  res.writeHead(status, { 'Content-Type':'application/json', 'Access-Control-Allow-Origin':'*', 'Access-Control-Allow-Headers':'*', 'Access-Control-Allow-Methods':'GET,POST,OPTIONS' });
  res.end(JSON.stringify(obj));
}

const server = http.createServer(async (req, res) => {
  if (req.method === 'OPTIONS') {
    res.writeHead(204, { 'Access-Control-Allow-Origin':'*', 'Access-Control-Allow-Headers':'*', 'Access-Control-Allow-Methods':'GET,POST,OPTIONS' });
    return res.end();
  }

  const u = new URL(req.url, `http://localhost:${PORT}`);
  const p = u.pathname;
  if (CURRENT_LEVEL <= LOG_LEVELS.info) warn(req.method, p); // warn level for request entry
  else log(req.method, p);

  // ── HEALTH CHECK ──────────────────────────────────────────────
  if (p === '/health') {
    if (!schwabAccessToken && fs.existsSync(SCHWAB_TOKEN_FILE)) {
      try {
        const saved = JSON.parse(fs.readFileSync(SCHWAB_TOKEN_FILE, 'utf8'));
        if (saved.accessToken && saved.expiresAt && Date.now() < saved.expiresAt) {
          schwabAccessToken = saved.accessToken;
          schwabRefreshToken = saved.refreshToken;
          schwabTokenExpiry = saved.expiresAt;
        }
      } catch(e) {}
    }
    const REDIRECT_URI = 'https://127.0.0.1:3001/callback';
    const params = new URLSearchParams({ client_id: SCHWAB_CLIENT_ID, redirect_uri: REDIRECT_URI });
    return sendJSON(res, 200, {
      ok: true, port: PORT,
      schwab_connected: !!(schwabAccessToken && Date.now() < schwabTokenExpiry),
      tastytrade_connected: !!(accessToken && Date.now() < tokenExpiry),
      authUrl: `https://api.schwabapi.com/v1/oauth/authorize?response_type=code&${params}`,
      redirectUri: REDIRECT_URI
    });
  }

  // ── SCHWAB PROXY ROUTES ───────────────────────────────────────
  if (p.startsWith('/proxy/schwab/')) {
    if (!schwabAccessToken) return sendJSON(res, 401, { error: 'Schwab not connected' });
    const schwabPath = p.replace('/proxy/schwab', '') + (u.search || '');
    const opts = {
      hostname: SCHWAB_BASE, port: 443, path: schwabPath, method: 'GET',
      headers: { 'Authorization': `Bearer ${schwabAccessToken}`, 'Accept': 'application/json' }
    };
    const schwabReq = https.request(opts, schwabRes => {
      let raw = '';
      schwabRes.on('data', c => raw += c);
      schwabRes.on('end', () => {
        try {
          const data = JSON.parse(raw);
          res.writeHead(schwabRes.statusCode, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify(data));
        } catch(e) {
          res.writeHead(schwabRes.statusCode, { 'Content-Type': 'application/json' });
          res.end(raw);
        }
      });
    });
    schwabReq.on('error', err => sendJSON(res, 502, { error: err.message }));
    schwabReq.end();
    return;
  }

  if (req.method === 'GET' && (p === '/proxy/api/auto-connect' || p === '/proxy/auto-connect')) {
    const ok = await ensureToken();
    return sendJSON(res, 200, {
      connected: ok,
      hasToken: !!accessToken,
      access_token: accessToken,
      tokenExpiry,
      dxConnected: dxSocket?.readyState === WebSocket.OPEN,
      dxAuthorized
    });
  }

  // ── TRUMP CALENDAR REFRESH ────────────────────────────────────
  if (req.method === 'POST' && p === '/proxy/api/trump-calendar-refresh') {
    try {
      const https_module = require('https');
      const calendarUrl = 'https://media-cdn.factba.se/rss/json/trump/calendar-full.json';
      const outputPath = path.join(__dirname, 'data', 'trump_calendar_latest.json');
      const dataDir = path.join(__dirname, 'data');

      // Ensure data directory exists
      if (!fs.existsSync(dataDir)) {
        fs.mkdirSync(dataDir, { recursive: true });
      }

      https_module.get(calendarUrl, { headers: { 'User-Agent': 'Mozilla/5.0' } }, (calRes) => {
        let data = '';
        calRes.on('data', chunk => data += chunk);
        calRes.on('end', () => {
          try {
            let calendarData = JSON.parse(data);

            // API returns an array directly, wrap it
            if (Array.isArray(calendarData)) {
              calendarData = {
                events: calendarData,
                count: calendarData.length,
                fetched: new Date().toISOString(),
                source: calendarUrl
              };
            }

            fs.writeFileSync(outputPath, JSON.stringify(calendarData, null, 2));
            log(`[Trump Calendar] Fetched ${calendarData.count || calendarData.events.length} events`);
            return sendJSON(res, 200, {
              ok: true,
              count: calendarData.count || calendarData.events.length,
              fetched: calendarData.fetched,
              message: 'Calendar updated successfully'
            });
          } catch (e) {
            warn(`[Trump Calendar] Parse error: ${e.message}`);
            return sendJSON(res, 500, { ok: false, error: 'Failed to parse calendar data' });
          }
        });
      }).on('error', (err) => {
        warn(`[Trump Calendar] Fetch error: ${err.message}`);
        return sendJSON(res, 502, { ok: false, error: 'Failed to fetch calendar' });
      });
      return;
    } catch (e) {
      warn(`[Trump Calendar] Error: ${e.message}`);
      return sendJSON(res, 500, { ok: false, error: e.message });
    }
  }

  if (req.method === 'GET' && p === '/proxy/api/backup/buy-sell-scores') {
    const date = u.searchParams.get('date') || dbEtDate();
    let records = [];
    if (db) {
      try {
        const rows = stmts().queryBSSByDate.all(date);
        records = rows.map(r => ({
          timestamp: r.ts, date: r.date, time: r.time,
          slotKey: r.slot_key, spxPrice: r.spx_price,
          side: r.side, score: r.score,
          buyPct: r.buy_pct, sellPct: r.sell_pct,
          gex: r.gex, dex: r.dex, chex: r.chex, vex: r.vex,
        }));
      } catch (e) {
        log('[DB] buy-sell-scores query error:', e.message);
        // fallback to JSON file
        records = readBuySellBackup().filter(r => !date || r.date === date)
          .sort((a, b) => Number(a.timestamp || 0) - Number(b.timestamp || 0));
      }
    } else {
      records = readBuySellBackup().filter(r => !date || r.date === date)
        .sort((a, b) => Number(a.timestamp || 0) - Number(b.timestamp || 0));
    }
    return sendJSON(res, 200, { ok: true, records });
  }

  if (req.method === 'POST' && p === '/proxy/api/backup/buy-sell-scores') {
    try {
      const incoming = await readRequestJson(req);
      const record = incoming.record || incoming;
      if (!record || !record.slotKey) {
        return sendJSON(res, 400, { ok: false, error: 'Missing slotKey' });
      }
      const existing = readBuySellBackup();
      const nextRecord = {
        timestamp: Number(record.timestamp || Date.now()),
        date: String(record.date || new Date().toISOString().split('T')[0]),
        time: String(record.time || new Date().toTimeString().split(' ')[0]),
        slotKey: String(record.slotKey),
        spxPrice: Number(record.spxPrice || 0),
        side: String(record.side || 'Buy'),
        score: Number(record.score || 0),
        buyPct: Number(record.buyPct || 0),
        sellPct: Number(record.sellPct || 0),
        // Greeks exposures at time of signal
        gex: Number(record.gex ?? 0),
        dex: Number(record.dex ?? 0),
        chex: Number(record.chex ?? 0),
        vex: Number(record.vex ?? 0)
      };
      const merged = [nextRecord, ...existing.filter(r => r.slotKey !== nextRecord.slotKey)]
        .sort((a, b) => Number(a.timestamp || 0) - Number(b.timestamp || 0));
      writeBuySellBackup(merged);
      dbInsertBSS(nextRecord);  // also persist to SQLite
      return sendJSON(res, 200, { ok: true, count: merged.length, file: BUY_SELL_BACKUP_FILE });
    } catch (err) {
      return sendJSON(res, 500, { ok: false, error: err.message });
    }
  }

  // ── EM SNAPSHOT CACHE ─────────────────────────────────────────────────────────
  // GET  /proxy/api/em/:date          fetch saved EM straddle values
  // POST /proxy/api/em/:date          save EM straddle values (call from frontend at 3:55 PM)
  const EM_CACHE_FILE = path.join(BACKUP_DIR, 'em-cache.json');

  function readEMCache() {
    ensureBackupDir();
    if (!fs.existsSync(EM_CACHE_FILE)) return {};
    try {
      return JSON.parse(fs.readFileSync(EM_CACHE_FILE, 'utf8'));
    } catch (_) {
      return {};
    }
  }

  function writeEMCache(cache) {
    ensureBackupDir();
    fs.writeFileSync(EM_CACHE_FILE, JSON.stringify(cache, null, 2));
  }

  if (req.method === 'GET' && p === '/proxy/api/em/latest') {
    const cache = readEMCache();
    const entries = Object.entries(cache);
    if (!entries.length) return sendJSON(res, 200, { ok: false, error: 'no data' });
    // Return the most recently saved entry
    entries.sort((a, b) => (b[1].timestamp || 0) - (a[1].timestamp || 0));
    const [date, data] = entries[0];
    return sendJSON(res, 200, { ok: true, date, ...data });
  }

  if (req.method === 'GET' && p.startsWith('/proxy/api/em/')) {
    const date = p.slice('/proxy/api/em/'.length);
    const cache = readEMCache();
    const data = cache[date];
    return sendJSON(res, 200, data ? { ok: true, date, ...data } : { ok: false, error: 'not found' });
  }

  if (req.method === 'POST' && p.startsWith('/proxy/api/em/')) {
    try {
      const date = p.slice('/proxy/api/em/'.length);
      const body = await readRequestJson(req);
      const cache = readEMCache();
      cache[date] = {
        timestamp: Date.now(),
        time: new Date().toLocaleTimeString('en-US', { timeZone: 'America/New_York' }),
        spx: Number(body.spx || 0),
        ndx: Number(body.ndx || 0),
        spxStrike: Number(body.spxStrike || 0),
        ndxStrike: Number(body.ndxStrike || 0),
        spxCall: Number(body.spxCall || 0),
        spxPut: Number(body.spxPut || 0),
        ndxCall: Number(body.ndxCall || 0),
        ndxPut: Number(body.ndxPut || 0)
      };
      writeEMCache(cache);
      return sendJSON(res, 200, { ok: true, date, saved: cache[date] });
    } catch (err) {
      return sendJSON(res, 500, { ok: false, error: err.message });
    }
  }

  if (req.method === 'GET' && p.startsWith('/proxy/api/yahoo/')) {
    const ticker = decodeURIComponent(p.slice('/proxy/api/yahoo/'.length));
    const period1 = u.searchParams.get('period1') || Math.floor(Date.now() / 1000) - 86400 * 3;
    const period2 = u.searchParams.get('period2') || Math.floor(Date.now() / 1000) + 86400;
    try {
      const r = await fetch(
        `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(ticker)}?period1=${period1}&period2=${period2}&interval=1d`,
        { headers: { 'User-Agent': 'Mozilla/5.0', 'Accept': 'application/json' } }
      );
      const data = await r.json();
      return sendJSON(res, 200, data);
    } catch (err) {
      return sendJSON(res, 502, { error: err.message });
    }
  }

  if (req.method === 'POST' && p === '/proxy/refresh') {
    const ok = await refreshAccessToken();
    return ok
      ? sendJSON(res, 200, { access_token: accessToken, refresh_token: refreshToken })
      : sendJSON(res, 401, { error: 'Refresh failed' });
  }

  if (req.method === 'GET' && p.startsWith('/proxy/api/tt/quote/')) {
    const sym = decodeURIComponent(p.slice('/proxy/api/tt/quote/'.length));
    const { status, data } = await ttGet(`/market-metrics?symbols=${sym.split(',').map(s => encodeURIComponent(s.trim())).join(',')}`);
    return sendJSON(res, status, data);
  }

  // ── GET /proxy/api/tt/em-closes  ─────────────────────────────────────────────
  // PRIMARY: Yahoo Finance. Fetches the COMPLETED session close (targetExp - 1 day).
  // period2 = end of closeDate in UTC. period1 = 2 days before.
  // FALLBACK: dxTradeCache / dxSummaryCache.
  if (req.method === 'GET' && p === '/proxy/api/tt/em-closes') {
    // closeDate = the trading day whose close we want (passed as ?closeDate=YYYY-MM-DD)
    // If not passed, default to yesterday ET
    const etNow = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/New_York' }));
    const closeDateParam = u.searchParams.get('closeDate');
    let closeDate;
    if (closeDateParam) {
      closeDate = new Date(closeDateParam + 'T20:00:00Z');
    } else {
      // Use yesterday (previous completed trading session)
      closeDate = new Date(etNow);
      closeDate.setDate(closeDate.getDate() - 1);
      while (closeDate.getDay() === 0 || closeDate.getDay() === 6) closeDate.setDate(closeDate.getDate() - 1);
      closeDate = new Date(closeDate.toISOString().slice(0,10) + 'T20:00:00Z');
    }
    const period2 = Math.floor(closeDate.getTime() / 1000) + 3600; // +1hr buffer
    const period1 = period2 - 86400 * 3;

    async function yahooClose(ticker) {
      try {
        const r = await fetch(
          `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(ticker)}?period1=${period1}&period2=${period2}&interval=1d`,
          { headers: { 'User-Agent': 'Mozilla/5.0', 'Accept': 'application/json' } }
        );
        if (!r.ok) return 0;
        const d = await r.json();
        const result = d?.chart?.result?.[0] || {};
        const closes = result?.indicators?.quote?.[0]?.close || [];
        const stamps = result?.timestamp || [];
        const closeDateMs = closeDate.getTime();
        for (let i = stamps.length - 1; i >= 0; i--) {
          const ts = Number(stamps[i]) * 1000;
          const close = Number(closes[i]);
          if (Number.isFinite(ts) && ts <= closeDateMs + 23 * 60 * 60 * 1000 && close > 0) {
            return close;
          }
        }
        const filtered = closes.filter(v => v > 0);
        return firstFiniteNumber(filtered[filtered.length - 1], 0);
      } catch(_) { return 0; }
    }

    const [spx, es, ndx, nq] = await Promise.all([
      yahooClose('^SPX'),
      yahooClose('ES=F'),
      yahooClose('^NDX'),
      yahooClose('NQ=F'),
    ]);

    // dxLink fallbacks
    const getClose = (sym) => {
      const s = dxSummaryCache[sym] || {};
      return sym.startsWith('/')
        ? firstFiniteNumber(s.prevDayClosePrice, marketDataPrevCloseCache[sym], 0)
        : firstFiniteNumber(dxTradeCache[sym]?.price, s.prevDayClosePrice, marketDataPrevCloseCache[sym], 0);
    };
    const spxFinal = spx || getClose('SPX') || getClose('$SPX');
    const esFinal  = es  || getClose('/ESU26') || getClose('/ESU6') || getClose('/ES:XCME') || getClose('/ES');
    const ndxFinal = ndx || getClose('NDX') || getClose('$NDX');
    const nqFinal  = nq  || getClose('/NQ:XCME') || getClose('/NQU6') || getClose('/NQM6');
    const basis   = spxFinal > 0 && esFinal > 0 ? esFinal - spxFinal : firstFiniteNumber(esBasisCache.basis, 0);
    const nqBasis = ndxFinal > 0 && nqFinal > 0 ? nqFinal - ndxFinal : 0;
    return sendJSON(res, 200, { data: { spx: spxFinal, es: esFinal, ndx: ndxFinal, nq: nqFinal, basis, nqBasis, closeDate: closeDate.toISOString().slice(0,10) } });
  }

  // ── GET /proxy/api/tt/prev-closes  ───────────────────────────────────────────
  // Returns cached prev closes. POST forces a refresh.
  if (p === '/proxy/api/tt/prev-closes') {
    if (req.method === 'POST') {
      await refreshLivePrevCloses();
    }
    const etMins = getEtMinutes();
    const debug = {
      esSummary: dxSummaryCache['/ESU26'] || dxSummaryCache['/ESU6'] || dxSummaryCache['/ES:XCME'] || dxSummaryCache['/ES'] || null,
      esSummaryKeys: Object.keys(dxSummaryCache).filter(k => k.includes('ES')).slice(0,10),
      esBasisCache,
      savedDailyCloses,
      spxTrade:  dxTradeCache['SPX'] || dxTradeCache['$SPX'] || null,
      etMins,
      isAfterClose: etMins >= 960,
    };
    return sendJSON(res, 200, { data: livePrevCloses, debug });
  }

  // ── GET /proxy/api/tt/debug-summary  ─────────────────────────────────────────
  if (req.method === 'GET' && p === '/proxy/api/tt/debug-summary') {
    const target = ['SPX','$SPX','/ESU26','/ESU6','/ES:XCME','/ES','NDX','$NDX','/NQU6','/NQM6','/NQ:XCME'];
    const found = {};
    target.forEach(k => { if (dxSummaryCache[k]) found[k] = dxSummaryCache[k]; });
    const allKeys = Object.keys(dxSummaryCache).filter(k => /SPX|NDX|ES|NQ/.test(k) && !k.startsWith('.')).slice(0,20);
    const rawTrade = {};
    ['SPX','$SPX','/ESU26','/ESU6','/ES:XCME','/ES','NDX','$NDX','/NQU6','/NQM6','/NQ:XCME'].forEach(k => { if (dxTradeCache[k]) rawTrade[k] = dxTradeCache[k]; });
    return sendJSON(res, 200, { data: found, allKeys, totalKeys: Object.keys(dxSummaryCache).length, rawTrade });
  }

  // ── GET /proxy/api/tt/option-marks?symbols=SYM1,SYM2  ────────────────────────
  if (req.method === 'GET' && p === '/proxy/api/tt/option-marks') {
    const syms = String(u.searchParams.get('symbols') || '').split(',').map(s => s.trim()).filter(Boolean);
    if (!syms.length) return sendJSON(res, 400, { error: 'symbols required' });
    const query = syms.map(s => `equity[]=${encodeURIComponent(s)}`).join('&');
    const { status, data } = await ttGet(`/market-data/by-type?${query}`);
    if (status !== 200) return sendJSON(res, status, data);
    const items = data?.data?.items || [];
    const result = syms.map(sym => {
      const item = items.find(i => (i.symbol||'').replace(/ /g,'') === sym.replace(/ /g,'') || i.symbol === sym) || {};
      const bid  = firstFiniteNumber(item.bid, item['bid-price'], 0);
      const ask  = firstFiniteNumber(item.ask, item['ask-price'], 0);
      const last = firstFiniteNumber(item.last, item['last-price'], item['last-trade-price'], 0);
      const mark = firstFiniteNumber(item.mark, item['mark-price'], last > 0 ? last : (bid+ask)/2, 0);
      return { symbol: sym, bid, ask, last, mark };
    });
    return sendJSON(res, 200, { data: { items: result } });
  }

  // ── GET /proxy/api/tt/gex  ────────────────────────────────────────────────────
  // Live GEX levels + total net GEX using same formula as computeAndCacheGexLevels
  if (req.method === 'GET' && p === '/proxy/api/tt/gex') {
    let esSpot = firstFiniteNumber(dxTradeCache['/ESU26']?.price, dxTradeCache['/ESU6']?.price, dxTradeCache['/ES:XCME']?.price, dxTradeCache['/ES']?.price, gexLevelCache.esSpot, 0);

    let spxSpot = firstFiniteNumber(gexLevelCache.spot, 0);
    const basis = firstFiniteNumber(esBasisCache.basis, gexLevelCache.basis, 0);
    const inMarketHours = isRegularEquitySessionEt();

    // Prefer dxLink cache. Only fall back to REST during market hours.
    if (!(esSpot > 0) && inMarketHours) esSpot = await fetchUnderlyingLast('/ESU26').catch(() => fetchUnderlyingLast('/ESU6').catch(() => 0));
    if (!(spxSpot > 0) && inMarketHours) spxSpot = await fetchUnderlyingLast('SPX').catch(() => 0);
    if (!(spxSpot > 0)) spxSpot = firstFiniteNumber(dxTradeCache['$SPX']?.price, dxQuoteCache['$SPX']?.last, dxQuoteCache['$SPX']?.mark, 0);
    if (!(esSpot > 0)) esSpot = firstFiniteNumber(dxTradeCache['/ES:XCME']?.price, dxQuoteCache['/ES:XCME']?.last, dxQuoteCache['/ES:XCME']?.mark, 0);

    // Aggregate by strike — mirrors computeAndCacheGexLevels exactly
    const strikeMap = {};
    for (const [sym, greeks] of Object.entries(dxGreeksCache)) {
      if (!isSpxwSymbol(sym)) continue;
      const m = String(sym).match(/[CP](\d{4,6})$/);
      if (!m) continue;
      const strike = parseInt(m[1], 10);
      if (!strike) continue;
      const summary = dxSummaryCache[sym] || {};
      const gamma   = Math.abs(firstFiniteNumber(greeks.gamma, 0));
      const oi      = maxWholeNumber(summary.openInterest);
      const isCall  = /C\d{4,8}$/.test(sym);
      if (!strikeMap[strike]) strikeMap[strike] = { callGamma: 0, callOI: 0, putGamma: 0, putOI: 0 };
      if (isCall) { strikeMap[strike].callGamma = gamma; strikeMap[strike].callOI = oi; }
      else        { strikeMap[strike].putGamma  = gamma; strikeMap[strike].putOI  = oi; }
    }

    // Sum total net GEX across all strikes: same formula as existing code
    let totalNetGex = 0;
    const strikeCount = Object.keys(strikeMap).length;
    for (const r of Object.values(strikeMap)) {
      const callGEX = r.callGamma * r.callOI * 100 * spxSpot;
      const putGEX  = r.putGamma  * r.putOI  * 100 * spxSpot;
      totalNetGex  += callGEX - putGEX;
    }

    const flipSpx = gexLevelCache.zeroGamma || 0;
    const flipEs  = flipSpx > 0 ? spxLevelToEs(flipSpx, basis) : 0;

    return sendJSON(res, 200, {
      data: {
        net_gex_dollars:  totalNetGex,
        net_gex_billions: totalNetGex / 1e9,
        call_wall_spx:    gexLevelCache.callWall || 0,
        put_wall_spx:     gexLevelCache.putWall  || 0,
        gamma_flip_spx:   flipSpx,
        gamma_flip_es:    flipEs,
        gamma_flip_node:  flipEs || flipSpx,
        spot:             esSpot,
        spx_spot:         spxSpot,
        strikes_cached:   strikeCount,
        ts: Date.now()
      }
    });
  }

  // ── GET /proxy/api/tt/gex-top-3  ─────────────────────────────────────────────
  // Return the three highest-magnitude net GEX strikes for the premium chart.
  // Includes per-strike avg delta so the client can compute delta-weighted GEX.
  if (req.method === 'GET' && p === '/proxy/api/tt/gex-top-3') {
    let spxSpot = firstFiniteNumber(gexLevelCache.spot, 0);
    if (!(spxSpot > 0)) spxSpot = await fetchUnderlyingLast('SPX').catch(() => 0);

    const strikeMap = {};
    for (const [sym, greeks] of Object.entries(dxGreeksCache)) {
      if (!isSpxwSymbol(sym)) continue;
      const m = String(sym).match(/[CP](\d{4,6})$/);
      if (!m) continue;
      const strike = parseInt(m[1], 10);
      if (!strike) continue;
      const summary = dxSummaryCache[sym] || {};
      const gamma = firstFiniteNumber(greeks.gamma, 0);
      const delta = firstFiniteNumber(greeks.delta, 0);
      const oi = maxWholeNumber(summary.openInterest);
      const isCall = /C\d{4,8}$/.test(sym);
      if (!strikeMap[strike]) strikeMap[strike] = {
        strike, callGEX: 0, putGEX: 0, netGEX: 0,
        callDelta: 0, putDelta: 0, callCount: 0, putCount: 0
      };
      const gex = gamma * oi * 100 * spxSpot;
      if (isCall) {
        strikeMap[strike].callGEX += gex;
        strikeMap[strike].netGEX += gex;
        strikeMap[strike].callDelta += delta;
        strikeMap[strike].callCount += 1;
      } else {
        strikeMap[strike].putGEX += gex;
        strikeMap[strike].netGEX -= gex;
        strikeMap[strike].putDelta += Math.abs(delta); // store as positive magnitude
        strikeMap[strike].putCount += 1;
      }
    }

    // Avg delta per strike
    const rows = Object.values(strikeMap).map(r => ({
      strike: r.strike,
      callGEX: r.callGEX,
      putGEX: r.putGEX,
      netGEX: r.netGEX,
      callDelta: r.callCount > 0 ? r.callDelta / r.callCount : 0,
      putDelta:  r.putCount  > 0 ? r.putDelta  / r.putCount  : 0,
    }));

    const top3 = rows
      .sort((a, b) => Math.abs(b.netGEX) - Math.abs(a.netGEX))
      .slice(0, 3)
      .sort((a, b) => a.strike - b.strike);

    return sendJSON(res, 200, {
      spot: spxSpot,
      ts: Date.now(),
      rows: top3
    });
  }

  // ── GET /proxy/api/tt/gex-expirations  ───────────────────────────────────────
  // Returns sorted list of available expiration dates in dxGreeksCache (YYYY-MM-DD).
  if (req.method === 'GET' && p === '/proxy/api/tt/gex-expirations') {
    const expSet = new Set();
    for (const sym of Object.keys(dxGreeksCache)) {
      if (!isSpxwSymbol(sym)) continue;
      const compact = optionExpirationCompact(sym); // YYMMDD
      if (compact.length === 6) {
        const yy = compact.slice(0,2), mm = compact.slice(2,4), dd = compact.slice(4,6);
        expSet.add(`20${yy}-${mm}-${dd}`);
      }
    }
    const today = todayYmd().ymd;
    const expirations = [...expSet].filter(d => d >= today).sort();
    return sendJSON(res, 200, { expirations, today });
  }

  // ── GET /proxy/api/tt/gex-chain  ─────────────────────────────────────────────
  // Full per-strike GEX chain for the bzila-dashboard GEX chart.
  // Optional ?expiry=YYYY-MM-DD to filter by expiration date (default: all dates).
  // Returns all SPXW strikes with callGamma, callDelta, callOI, putGamma, putDelta,
  // putOI, callGEX, putGEX, netGEX, callVol, putVol, plus spot + gexLevelCache summary.
  if (req.method === 'GET' && p === '/proxy/api/tt/gex-chain') {
    let spxSpot = firstFiniteNumber(gexLevelCache.spot, 0);
    if (!(spxSpot > 0)) spxSpot = firstFiniteNumber(dxTradeCache['$SPX']?.price, dxQuoteCache['$SPX']?.last, dxTradeCache['SPX']?.price, dxQuoteCache['SPX']?.last, 0);
    if (!(spxSpot > 0)) spxSpot = await fetchUnderlyingLast('SPX').catch(() => 0);

    // Optional expiry filter (not used in REST fallback but needed for response)
    const expiryParam = u.searchParams.get('expiry') || '';
    let filterCompact = '';
    if (expiryParam && /^\d{4}-\d{2}-\d{2}$/.test(expiryParam)) {
      filterCompact = expiryParam.replace(/-/g, '').slice(2);
    }

    const strikeMap = {};
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    log(`[GEX-CHAIN] accessToken=${accessToken ? 'SET' : 'NULL'}, cache=${Object.keys(dxGreeksCache).length} symbols`);

    // Step 1: Fetch full chain structure from REST API
    let token = accessToken;
    if (!token) {
      try {
        const tokenData = JSON.parse(fs.readFileSync(TOKEN_FILE, 'utf8'));
        token = tokenData.access_token;
        log(`[GEX-CHAIN] Read token from file`);
      } catch (e) {
        log(`[GEX-CHAIN] Failed to read token file: ${e.message}`);
      }
    }

    if (token) {
      try {
        const chainResp = await fetch(`https://api.tastyworks.com/option-chains/SPXW/nested`, {
          headers: { Authorization: `Bearer ${token}` }
        });
        if (chainResp.ok) {
          const chainData = await chainResp.json();
          const expirations = chainData?.data?.items?.[0]?.expirations || [];
          log(`[GEX-CHAIN] REST returned ${expirations.length} expirations`);

          for (const exp of expirations) {
            const expDate = exp['expiration-date'];
            if (!expDate) continue;

            const [yy, mm, dd] = expDate.split('-');
            const dte = Math.max(0, Math.floor((new Date(yy, mm - 1, dd) - today) / (1000 * 60 * 60 * 24)));

            for (const option of exp['option-chains'] || []) {
              const strike = parseInt(parseFloat(option['strike-price']), 10);
              if (!strike || strike <= 0) continue;

              if (!strikeMap[strike]) {
                strikeMap[strike] = {
                  strike, dte,
                  callGamma: 0, callDelta: 0, callOI: 0, callVol: 0,
                  putGamma: 0, putDelta: 0, putOI: 0, putVol: 0
                };
              }
            }
          }
          log(`[GEX-CHAIN] REST structure: ${Object.keys(strikeMap).length} strikes`);
        } else {
          log(`[GEX-CHAIN] REST error: ${chainResp.status}`);
        }
      } catch (err) {
        log(`[GEX-CHAIN] REST fetch error: ${err.message}`);
      }
    }

    // Step 2: Enrich with Greeks from dxGreeksCache
    for (const [symbolKey, greeksData] of Object.entries(dxGreeksCache)) {
      const match = symbolKey.match(/\.?SPXW(\d{2})(\d{2})(\d{2})([CP])(\d+)/);
      if (!match) continue;

      const [, yy, mm, dd, optType, strikeStr] = match;
      const strike = parseInt(strikeStr, 10);
      const expDate = new Date(2000 + parseInt(yy, 10), parseInt(mm, 10) - 1, parseInt(dd, 10));
      const dte = Math.max(0, Math.floor((expDate - today) / (1000 * 60 * 60 * 24)));

      // Initialize strike entry if new
      if (!strikeMap[strike]) {
        strikeMap[strike] = {
          strike, dte,
          callGamma: 0, callDelta: 0, callOI: 0, callVol: 0,
          putGamma: 0, putDelta: 0, putOI: 0, putVol: 0
        };
      }

      // Populate Greeks from cache
      const isCall = optType === 'C';
      const gamma = Math.abs(greeksData.gamma || 0);
      const delta = greeksData.delta || 0;

      if (isCall) {
        strikeMap[strike].callGamma = gamma;
        strikeMap[strike].callDelta = delta;
      } else {
        strikeMap[strike].putGamma = gamma;
        strikeMap[strike].putDelta = delta;
      }
    }

    log(`[GEX-CHAIN] Final: ${Object.keys(strikeMap).length} strikes with Greeks enrich`);
    const rows = Object.values(strikeMap).map(r => {
      const callGEX = r.callGamma * r.callOI * spxSpot * spxSpot;
      const putGEX  = r.putGamma  * r.putOI  * spxSpot * spxSpot * -1;
      return { strike: r.strike, dte: r.dte, callGamma: r.callGamma, callDelta: r.callDelta, callOI: r.callOI, callVol: r.callVol, putGamma: r.putGamma, putDelta: r.putDelta, putOI: r.putOI, putVol: r.putVol, callGEX, putGEX, netGEX: callGEX + putGEX };
    }).sort((a, b) => a.strike - b.strike);

    return sendJSON(res, 200, {
      spot:      spxSpot,
      expiry:    filterCompact ? expiryParam : null,
      callWall:  gexLevelCache.callWall  || 0,
      putWall:   gexLevelCache.putWall   || 0,
      gexFlip:   gexLevelCache.zeroGamma || 0,
      ts:        Date.now(),
      rows,
    });
  }

  // ── GET /proxy/api/tt/vix  ────────────────────────────────────────────────────
  // VIX spot (30D), VIX1D proxy, 10D realized vol
  if (req.method === 'GET' && p === '/proxy/api/tt/vix') {
    let vix30 = firstFiniteNumber(dxTradeCache['VIX']?.price, dxTradeCache['$VIX.X']?.price, 0);
    if (!(vix30 > 0) && isRegularEquitySessionEt()) vix30 = await fetchUnderlyingLast('VIX').catch(() => 0);
    if (!(vix30 > 0)) vix30 = firstFiniteNumber(dxTradeCache['VIX']?.price, dxQuoteCache['VIX']?.last, dxQuoteCache['$VIX.X']?.last, 0);

    // VIX1D: use subscribed cache or derive structural proxy
    let vix1d = firstFiniteNumber(dxTradeCache['VIX1D']?.price, dxTradeCache['VIXST']?.price, 0);
    if (!(vix1d > 0) && vix30 > 0) vix1d = parseFloat((vix30 * Math.sqrt(1 / 30)).toFixed(2));

    // 10D Realized: Parkinson estimate from SPX day range, fallback 0.85x VIX
    let realized10d = 0;
    const spxS = dxSummaryCache['SPX'] || dxSummaryCache['$SPX.X'];
    if (spxS?.dayHighPrice > 0 && spxS?.dayLowPrice > 0) {
      realized10d = parseFloat((Math.sqrt(252 / (4 * Math.log(2))) * Math.log(spxS.dayHighPrice / spxS.dayLowPrice) * 100).toFixed(2));
    }
    if (!(realized10d > 0) && vix30 > 0) realized10d = parseFloat((vix30 * 0.85).toFixed(2));

    return sendJSON(res, 200, {
      data: { vix_spot: vix30, vix_1d: vix1d, realized_10d: realized10d, ts: Date.now() }
    });
  }

  // ── POST /proxy/api/volatility/probabilities  ─────────────────────────────────
  // Historical regime probability lookup
  if (req.method === 'POST' && p === '/proxy/api/volatility/probabilities') {
    const body = await readRequestJson(req).catch(() => ({}));
    const { gex_regime, term_structure_spread, vrp_profile } = body;

    const posGex = gex_regime === 'positive';
    const ts = Number(term_structure_spread);
    const contango = ts < 0;
    const backwardation = ts > 0;
    const coiling = ts >= -0.5 && ts <= 0.2;
    const vrpOver = vrp_profile === 'overpriced';

    let p_bull = 11, p_bear = 10, p_chop = 79, n_matches = 38;
    if      (posGex  && contango     && vrpOver)  { p_bull = 11; p_bear = 10; p_chop = 79; n_matches = 38; }
    else if (posGex  && contango     && !vrpOver) { p_bull = 18; p_bear = 12; p_chop = 70; n_matches = 29; }
    else if (!posGex && backwardation)             { p_bull = 15; p_bear = 25; p_chop = 60; n_matches = 42; }
    else if (posGex  && coiling      && !vrpOver) { p_bull = 22; p_bear = 18; p_chop = 60; n_matches = 35; }
    else if (!posGex && coiling)                   { p_bull = 20; p_bear = 35; p_chop = 45; n_matches = 27; }

    return sendJSON(res, 200, { p_bull, p_bear, p_chop, total_matches: n_matches, regime: gex_regime, ts: Date.now() });
  }

  if (req.method === 'GET' && (p === '/proxy/api/mark' || p === '/proxy/api/mark/')) {
    const rawSymbols = u.searchParams.getAll('symbol');
    const single = u.searchParams.get('symbols') || u.searchParams.get('sym') || '';
    const requested = [...rawSymbols, ...single.split(',')]
      .map(s => String(s || '').trim())
      .filter(Boolean);
    const symbols = requested.length ? requested : ['SPX'];
    const query = symbols.map(s => encodeURIComponent(String(s).replace(/^\$/, ''))).join(',');
    const { status, data } = await ttGet(`/market-metrics?symbols=${query}`);
    return sendJSON(res, status, data);
  }

  if (req.method === 'GET' && p === '/proxy/api/marketdata/v1/quotes') {
    const symbols = String(u.searchParams.get('symbols') || '')
      .split(',')
      .map(s => decodeURIComponent(s))
      .filter(Boolean);
    return sendSchwabLikeQuotes(res, symbols);
  }

  if (req.method === 'GET' && p === '/proxy/api/schwab/quotes-batch') {
    const symbols = String(u.searchParams.get('symbols') || '')
      .split(',')
      .map(s => decodeURIComponent(s))
      .filter(Boolean);
    return sendSchwabLikeQuotes(res, symbols);
  }

  if (req.method === 'GET' && p.startsWith('/proxy/api/schwab/quote/')) {
    const sym = decodeURIComponent(p.slice('/proxy/api/schwab/quote/'.length));
    return sendSchwabLikeQuotes(res, [sym]);
  }

  if (req.method === 'GET' && p === '/proxy/api/marketdata/v1/chains') {
    const sym = u.searchParams.get('symbol') || 'SPX';
    const contractType = String(u.searchParams.get('contractType') || 'ALL').toUpperCase();
    const strikeCount = parseInt(u.searchParams.get('strikeCount') || '60', 10);
    const { status, data } = await fetchSchwabLikeChain(sym, contractType, strikeCount);
    return sendJSON(res, status, data);
  }

  if (req.method === 'GET' && p.startsWith('/proxy/api/schwab/chains/')) {
    const sym = decodeURIComponent(p.slice('/proxy/api/schwab/chains/'.length));
    const { status, data } = await fetchSchwabLikeChain(sym, 'ALL', 60);
    return sendJSON(res, status, data);
  }

  if (req.method === 'GET' && p === '/proxy/api/marketdata/v1/pricehistory') {
    const rawSymbol = String(u.searchParams.get('symbol') || 'SPX').replace(/^\$/, '');
    const symbol = rawSymbol === 'SPX.X' ? 'SPX' : rawSymbol;
    let parts = [];
    if (symbol === 'SPX') parts = ['index[]=SPX'];
    else if (symbol === 'NDX') parts = ['index[]=NDX'];
    else if (symbol === 'VIX.X' || symbol === 'VIX') parts = ['index[]=VIX'];
    else if (/^\/ES/i.test(symbol)) parts = ['future[]=' + encodeURIComponent('/ESU6')];
    else if (/^\/NQ/i.test(symbol)) parts = ['future[]=' + encodeURIComponent('/NQU6')];
    else parts = ['equity[]=' + encodeURIComponent(symbol)];
    const { status, data } = await ttGet(`/market-data/by-type?${parts.join('&')}`);
    const item = data?.data?.items?.[0] || {};
    const q = item.quote || item;
    const last = firstFiniteNumber(
      q.last,
      q['last-price'],
      q['last-trade-price'],
      q.mark,
      q['mark-price'],
      q['mid-price'],
      q.closePrice
    );
    const close = firstFiniteNumber(
      q.closePrice,
      q['close-price'],
      last - firstFiniteNumber(q.netChange, q['net-change'], 0),
      last
    );
    return sendJSON(res, status === 200 ? 200 : 200, buildSyntheticPriceHistory(symbol, last, close));
  }

  if (req.method === 'GET' && p.startsWith('/proxy/api/tt/intraday-history/')) {
    const sym = decodeURIComponent(p.slice('/proxy/api/tt/intraday-history/'.length));
    const candles = await fetchTodayIntradayCandles(sym);
    return sendJSON(res, 200, { symbol: normalizeRestSymbol(sym), empty: candles.length === 0, candles });
  }

  // ── GET /proxy/api/tt/quotes-batch  — serve from dxLink cache ──────────
  // TT REST /market-data/by-type only works for index[] (SPX/VIX).
  // Equities and futures return nothing. Use dxLink cache instead.
  if (req.method === 'GET' && p === '/proxy/api/tt/quotes-batch') {
    const requestedSyms = [
      ...u.searchParams.getAll('index[]'),
      ...u.searchParams.getAll('future[]'),
      ...u.searchParams.getAll('equity[]'),
      ...u.searchParams.getAll('symbols')
        .flatMap(v => String(v || '').split(','))
    ].map(s => String(s || '').trim()).filter(Boolean);
    const allSyms = requestedSyms.length ? requestedSyms : [
      'SPX','VIX','/ES:XCME','/NQ:XCME',
      'SPY','QQQ','SMH','AAPL','AMD','AMZN','GOOGL','META','MSFT','NVDA','TSLA',
      'COIN','HOOD','IWM','NFLX','PLTR','NDX'
    ];
    // Normalize symbols to cache keys (strips leading dots, normalizes futures)
    const items = await Promise.all(allSyms.map(async sym => {
      const normalized = normalizeDxCacheSymbol(sym);
      const q = dxQuoteCache[normalized] || dxQuoteCache[sym] || {};
      const t = dxTradeCache[normalized] || dxTradeCache[sym] || {};
      const s = dxSummaryCache[normalized] || dxSummaryCache[sym] || {};
      const yahooRaw = sym === 'VIX' ? await fetchYahooIntradayQuote(sym) : null;
      // Always prefer livePrevCloses (auto-refreshed from Yahoo daily close) over intraday meta
      const vixKnownPrev = livePrevCloses.VIX || 0;
      const yahooOverride = yahooRaw
        ? { ...yahooRaw, prevClose: firstFiniteNumber(vixKnownPrev, yahooRaw.prevClose) }
        : (sym === 'VIX' ? { last: 0, prevClose: vixKnownPrev } : null);
      const qLast = firstFiniteNumber(
        yahooOverride?.last,
        q.last,
        q.lastPrice,
        q['last-price'],
        q['last-trade-price'],
        0
      );
      const bid  = firstFiniteNumber(q.bidPrice, 0);
      const ask  = firstFiniteNumber(q.askPrice, 0);
      const mid = bid > 0 && ask > 0 ? (bid + ask) / 2 : 0;
      const tradeLast = firstFiniteNumber(t.price, qLast, 0);
      const dayOpen = firstFiniteNumber(s.dayOpenPrice, 0);
      const dayHigh = firstFiniteNumber(s.dayHighPrice, 0);
      const dayLow = firstFiniteNumber(s.dayLowPrice, 0);
      const useMidForOffHours = !isFuturesSymbol(sym) && !isRegularEquitySessionEt() && mid > 0;
      let last = useMidForOffHours
        ? mid
        : firstFiniteNumber(t.price, s.dayClosePrice, s.dayOpenPrice, tradeLast, mid, qLast, bid, ask, 0);
      if (!last && !bid && !ask) {
        last = await fetchUnderlyingLast(sym).catch(() => 0);
      }
      if (!useMidForOffHours && tradeLast > 0 && mid > 0) {
        const spreadPct = Math.abs(ask - bid) / mid;
        const tradeVsMidPct = Math.abs(tradeLast - mid) / mid;
        const inDayRange = dayLow > 0 && dayHigh > 0 && tradeLast >= dayLow && tradeLast <= dayHigh;
        const openVsMidPct = dayOpen > 0 ? Math.abs(dayOpen - mid) / dayOpen : 0;
        const likelyStaleTrade =
          !inDayRange &&
          tradeVsMidPct > 0.03 &&
          spreadPct < 0.015 &&
          (!dayOpen || openVsMidPct < 0.08);
        if (likelyStaleTrade) last = mid;
      }
      // After 4pm ET: today's dayClosePrice is the new reference (session just closed)
      // During market hours: use prevDayClosePrice (yesterday's settlement)
      const etMins = getEtMinutes();
      const isAfterClose = etMins >= 960; // 4:00pm ET = 960 mins
      const knownPrev = sym.startsWith('/ES') ? (livePrevCloses.ES  || 0)
                      : sym.startsWith('/NQ') ? (livePrevCloses.NQ  || 0)
                      : sym === 'SPX' || sym === '$SPX' ? (livePrevCloses.SPX || 0)
                      : 0;
      // For futures: prefer knownPrev (from TT REST / savedDailyCloses) over dxLink fields
      // which can be stale or use wrong session reference. Fall back to dxLink if knownPrev=0.
      const prev = isFuturesSymbol(sym)
        ? firstFiniteNumber(knownPrev || null, isAfterClose ? s.dayClosePrice : null, s.prevDayClosePrice, marketDataPrevCloseCache[sym], 0)
        : firstFiniteNumber(marketDataPrevCloseCache[sym], isAfterClose ? s.dayClosePrice : null, resolveQuotePrevClose(q, s), knownPrev, 0);
      const baseClose = sym === 'VIX'
        ? firstFiniteNumber(yahooOverride?.prevClose, prev, 0)
        : prev;
      if (!last && !bid && !ask && !prev) return null;
      const rawChange = firstFiniteNumber(
        q.change,
        q.netChange,
        q['net-change'],
        q['day-change'],
        0
      );
      const yahooChange = yahooOverride?.last > 0 && prev > 0 ? yahooOverride.last - prev : 0;
      const change    = baseClose > 0 && last > 0 ? (rawChange || (last - baseClose)) : rawChange;
      const rawChangePct = firstFiniteNumber(
        q.changePercent,
        q.percentChange,
        q['change-percent'],
        q['percent-change'],
        q.netPercentChange,
        q['net-percent-change'],
        q['day-change-percent'],
        0
      );
      const changePct = baseClose > 0 && last > 0 ? (rawChangePct || ((last - baseClose) / baseClose) * 100) : rawChangePct;
      const finalLast = yahooOverride?.last > 0 ? yahooOverride.last : last;
      const finalPrev = sym === 'VIX'
        ? firstFiniteNumber(yahooOverride?.prevClose, baseClose, prev, 0)
        : (yahooOverride?.prevClose > 0 ? yahooOverride.prevClose : (baseClose || prev || (
            sym === '/NQ:XCME' ? firstFiniteNumber(marketDataPrevCloseCache.NDX, dxSummaryCache.NDX?.prevDayClosePrice, dxSummaryCache.NDX?.dayOpenPrice, 0) :
            sym === '/ES:XCME' ? firstFiniteNumber(marketDataPrevCloseCache.SPX, dxSummaryCache.SPX?.prevDayClosePrice, dxSummaryCache.SPX?.dayOpenPrice, 0) :
            0
          )));
      const finalChange = yahooOverride?.last > 0 && finalPrev > 0 ? (yahooOverride.last - finalPrev) : change;
      const finalPct = finalPrev > 0 && finalLast > 0 ? ((finalLast - finalPrev) / finalPrev) * 100 : changePct;
      return {
        symbol:            sym,
        last:              finalLast,
        mark:              bid && ask ? (bid+ask)/2 : finalLast,
        bid:               bid,
        ask:               ask,
        'prev-close':      finalPrev,
        'day-close':       isFuturesSymbol(sym) ? firstFiniteNumber(s.dayClosePrice, s.dayLowPrice, 0) : firstFiniteNumber(s.dayClosePrice, 0),
        change:            finalChange,
        'percent-change':  finalPct,
        volume:            firstFiniteNumber(t.dayVolume, s.dayVolume, 0),
      };
    }));
    const filteredItems = items.filter(Boolean);
    // log suppressed — cache-only, no TT REST calls
    return sendJSON(res, 200, { data: { items: filteredItems } });
  }

  if (req.method === 'GET' && p.startsWith('/proxy/api/tt/chains/')) {
    let sym = decodeURIComponent(p.slice('/proxy/api/tt/chains/'.length).split('?')[0]);
    sym = sym.replace(/^\$/, '');
    const pageId = u.searchParams.get('pageId') || '';
    const noSubscribe = u.searchParams.get('noSubscribe') === '1';
    const allowAutoSubscribe = !pageId;
    // awaitDX=1: subscribe chain to dxLink and wait for live Greeks before responding
    const awaitDX = u.searchParams.get('awaitDX') === '1';

    // REMOVED: SPY block (2026-06-11) - allow SPY/QQQ chains to fetch and subscribe for OI real-time updates
    // SPY and QQQ need dxLink Summary events for openInterest to populate

    const exp = u.searchParams.get('expiration') || '';
    const rangeRaw = u.searchParams.get('range') || '';
    const rangeParam = rangeRaw === 'all' ? 'all' : (rangeRaw ? parseInt(rangeRaw, 10) : 0);
    const noCache = u.searchParams.get('noCache') === '1';

    // CHECK CACHE (2026-06-12): Return cached chain data if fresh (<1hr for explicit exp, <10min for defaults)
    // This eliminates redundant TT API calls and massive subscription queues
    const cachedPayload = noCache || pageId ? null : getChainsFromCache(sym, exp);
    const cachedItems = Array.isArray(cachedPayload) ? cachedPayload : cachedPayload?.items;
    if (cachedItems && !awaitDX) {
      const cachedUnderlyingPrice = Array.isArray(cachedPayload) ? 0 : firstFiniteNumber(cachedPayload?.underlyingPrice, 0);
      const cachedRootSymbol = Array.isArray(cachedPayload) ? sym : (cachedPayload?.rootSymbol || sym);
      // Still subscribe to symbols if not already subscribed (cache doesn't prevent live updates)
      const streamerSyms = noSubscribe ? [] : cachedItems
        .flatMap(eg => eg.strikes || [])
        .flatMap(strike => [strike.call?.['streamer-symbol'], strike.put?.['streamer-symbol']])
        .filter(Boolean);
      const newSyms = streamerSyms.filter(sym => !subscriptions.has(sym));
      if (allowAutoSubscribe && newSyms.length && dxSocket && dxSocket.readyState === WebSocket.OPEN && dxChannelOpen) {
        newSyms.forEach(sym => {
          addAutoSubscription(sym, ['Quote','Greeks','Summary','Trade']);
          queueAutoSubscription({ type: 'Quote',   symbol: sym });
          queueAutoSubscription({ type: 'Greeks',  symbol: sym });
          queueAutoSubscription({ type: 'Summary', symbol: sym });
          queueAutoSubscription({ type: 'Trade',   symbol: sym });
        });
        sendSubscriptionsRateLimited();
        log('Subscribed', newSyms.length, 'NEW symbols from CACHED chain');
      }
      return sendJSON(res, 200, { data: { items: cachedItems, underlyingPrice: cachedUnderlyingPrice, symbol: sym, rootSymbol: cachedRootSymbol }, context: 'cache' });
    }

    const { status: s1, data: d1 } = await ttGet(`/option-chains/${encodeURIComponent(sym)}/nested`);
    if (s1 !== 200 || !d1?.data?.items?.length) {
      return sendJSON(res, s1, d1);
    }

    // TT nested chain: items = array of chain objects, each with expirations[]
    // Prefer SPXW (weeklys) for SPX to get 0DTE and 5-point strike density
    const chainObj = d1.data.items.find(c => c['root-symbol'] === 'SPXW') || d1.data.items[0];
    const rootSymbol = chainObj['root-symbol'] || sym;
    const expirations = chainObj.expirations || [];
    log('chains root-symbol:', rootSymbol, 'expirations:', expirations.length);

    // Step 2: fetch full option chain for root symbol to get strikes+OI+greeks
    // Filter to requested expiration or nearest few
    let targetExps = expirations.map(e => e['expiration-date']).filter(Boolean).sort();
    if (exp) targetExps = targetExps.filter(e => e === exp);
    else {
      // FIXED (2026-06-12): Ensure 0DTE is included when no explicit expiration is passed
      // Previous behavior skipped 0DTE if not in top 2, causing QQQ to show no data
      const todayDate = todayYmd().ymd;
      const hasTodayExpiry = targetExps.some(d => d === todayDate);
      if (hasTodayExpiry) {
        // Prioritize 0DTE, then add up to 2 more nearby expirations
        targetExps = [todayDate, ...targetExps.filter(d => d !== todayDate).slice(0, 2)];
      } else {
        // No 0DTE today, just fetch 3 nearest expirations
        targetExps = targetExps.slice(0, 3);
      }
    }

    // Fetch underlying price first so chain requests are centered on ATM
    const quotePrice = await fetchUnderlyingLast(sym).catch(() => 0);
    // For non-index tickers use their own dxLink cache entry; fall back to SPX only for SPX/SPXW
    const isSpxFamily = /^SPX[W]?$/i.test(sym);
    const dxSpotKey = isSpxFamily ? 'SPX' : sym.toUpperCase();
    // SPX in dxFeed is keyed as '$SPX' — check both
    const dxCacheEntry = dxQuoteCache[dxSpotKey] || dxQuoteCache['$' + dxSpotKey] || dxQuoteCache[sym] || {};
    const dxSpotPrice = firstFiniteNumber(dxCacheEntry.last, dxCacheEntry.bidPrice, dxCacheEntry.askPrice,
      dxTradeCache[dxSpotKey]?.price, dxTradeCache['$' + dxSpotKey]?.price, 0);
    // Use quote first, fallback to dxLink spot, then hardcoded
    let underlyingPrice = firstFiniteNumber(quotePrice, dxSpotPrice, isSpxFamily ? 5800 : 0);
    log('chains: quotePrice=' + quotePrice + ', dxSpot=' + dxSpotPrice + ', final underlyingPrice=' + underlyingPrice);

    // Fetch full chain — TT returns all strikes for the expiry
    const chainResponses = await Promise.all(targetExps.map(expDate => (
      ttGet(`/option-chains/${encodeURIComponent(rootSymbol)}?expiration-date=${expDate}`)
        .then(result => ({ expDate, ...result }))
        .catch(error => ({ expDate, status: 500, data: null, error }))
    )));

    let allOptions = [];
    for (const { status: s2, data: d2 } of chainResponses) {
      if (s2 === 200 && d2?.data?.items) {
        allOptions = allOptions.concat(d2.data.items);
      }
    }

    // Read underlying price from option data (TT includes 'underlying-price' on each option)
    // Always try this — overrides hardcoded fallback (e.g. 5800) when SPX has moved significantly
    if (allOptions.length > 0) {
      for (const o of allOptions.slice(0, 30)) {
        const p = firstFiniteNumber(o['underlying-price'], o.underlyingPrice, o.underlying_price, 0);
        if (p > 0) { underlyingPrice = p; break; }
      }
      if (underlyingPrice > 0) log('chains: inferred underlyingPrice from option data:', underlyingPrice);
    }

    const targetExpSet = new Set(targetExps);
    let filteredOptions = allOptions.filter(o => targetExpSet.has(o['expiration-date']));

    // On initial load, filter to ±10% of underlying = ~20 strikes per side + ATM = 41 total.
    // Client can pass ?range=20 to widen to 20%, or ?range=all for no filter.
    // rangeParam is a percentage (e.g., 10 = 10%) or 'all'
    let chainRange = Infinity;
    if (rangeParam === 'all') {
      chainRange = Infinity;
    } else if (exp) {
      // Explicit expiration: return all strikes
      chainRange = Infinity;
    } else if (rangeParam > 0) {
      // rangeParam is a percentage
      chainRange = rangeParam;
    } else {
      // Default: ±10%
      chainRange = 10;
    }
    // If underlying price is still unknown, derive it from the median strike in the option data.
    // This prevents returning an unfiltered 100-900+ strike range for equities like QQQ when
    // the quote fetch fails (e.g., proxy just started or market closed).
    if (!(underlyingPrice > 0) && chainRange < Infinity && filteredOptions.length > 0) {
      const strikesFromData = filteredOptions
        .map(o => parseFloat(o['strike-price'] || 0))
        .filter(v => v > 0)
        .sort((a, b) => a - b);
      const medianStrike = strikesFromData[Math.floor(strikesFromData.length / 2)] || 0;
      if (medianStrike > 0) {
        underlyingPrice = medianStrike;
        log('chains: underlyingPrice unknown — using median strike as ATM center:', underlyingPrice);
      }
    }
    if (chainRange < Infinity && underlyingPrice > 0) {
      const beforeCount = filteredOptions.length;
      const percentRange = chainRange / 100; // Convert percentage to decimal
      const lowerBound = underlyingPrice * (1 - percentRange);
      const upperBound = underlyingPrice * (1 + percentRange);
      filteredOptions = filteredOptions.filter(o => {
        const strike = parseFloat(o['strike-price'] || 0);
        return strike > 0 && strike >= lowerBound && strike <= upperBound;
      });
      log('chains filtered to ±' + chainRange + '% range around ' + underlyingPrice + ' (' + lowerBound.toFixed(2) + '-' + upperBound.toFixed(2) + '):', beforeCount, '→', filteredOptions.length);
    } else {
      log('chains total options fetched:', allOptions.length, '→ returned full strike set:', filteredOptions.length, '(underlyingPrice:', underlyingPrice, ')');
    }

    // Only subscribe the selected expiration's symbols — prevents dxLink flooding.
    const subscribeOptions = exp
      ? filteredOptions.filter(o => o['expiration-date'] === exp)
      : filteredOptions;
    const streamerSyms = noSubscribe ? [] : subscribeOptions.map(o => o['streamer-symbol']).filter(Boolean);
    // Only subscribe symbols not already active — prevents re-flooding on every chain fetch
    const newSyms = streamerSyms.filter(sym => !subscriptions.has(sym));
    if (allowAutoSubscribe && newSyms.length && dxSocket && dxSocket.readyState === WebSocket.OPEN && dxChannelOpen) {
      newSyms.forEach(sym => {
        addAutoSubscription(sym, ['Quote','Greeks','Summary','Trade']);
        queueAutoSubscription({ type: 'Quote',   symbol: sym });
        queueAutoSubscription({ type: 'Greeks',  symbol: sym });
        queueAutoSubscription({ type: 'Summary', symbol: sym });
        queueAutoSubscription({ type: 'Trade',   symbol: sym });
      });
      sendSubscriptionsRateLimited();
      log('Subscribed', newSyms.length, 'NEW symbols (', streamerSyms.length - newSyms.length, 'already active) for expiry', exp || 'nearest');
    } else if (!allowAutoSubscribe && streamerSyms.length) {
      log('Chain fetch deferred page-scoped subscriptions for', streamerSyms.length, 'symbols | pageId:', pageId);
    } else if (streamerSyms.length) {
      log('Chain fetch: all', streamerSyms.length, 'symbols already subscribed, skipping queue');
    }

    // awaitDX: wait for live dxLink Greeks to populate before building response
    if (awaitDX && streamerSyms.length) {
      log('[awaitDX] Waiting for dxLink Summary for', streamerSyms.length, 'symbols…');
      await waitForOptionData(streamerSyms, 4000);
      log('[awaitDX] dxLink wait complete');
    }

    // REMOVED: Yahoo/CBOE fallbacks (2026-06-11)
    // OI now comes from TastyTrade REST data directly (opt['open-interest'])
    // Real-time updates via dxLink Summary.openInterest
    const oiFallbackMaps = new Map();

    // Build nested structure: data.data.items = array of expGroups
    const expMap = {};
    // Debug: Log sample OI from TT REST data
    if (filteredOptions.length > 0) {
      const sampleOI = [
        filteredOptions[0]?.['open-interest'] ?? filteredOptions[0]?.openInterest,
        filteredOptions[Math.floor(filteredOptions.length / 4)]?.['open-interest'] ?? filteredOptions[Math.floor(filteredOptions.length / 4)]?.openInterest,
        filteredOptions[Math.floor(filteredOptions.length / 2)]?.['open-interest'] ?? filteredOptions[Math.floor(filteredOptions.length / 2)]?.openInterest
      ].filter(x => x > 0);
      if (sampleOI.length > 0) log('DEBUG [Chain OI] symbol:', sym, 'expDate:', targetExps[0] || 'all', 'total options:', filteredOptions.length, 'sample OI:', sampleOI.slice(0, 3));
    }

    // NOTE (2026-06-15): Build OI cache from REST data + market-data fallback
    // Many strikes DO have OI in REST response; just need to extract & cache it
    const oiCache = {};

    // First pass: cache OI from REST response itself (only if > 0)
    filteredOptions.forEach(opt => {
      const streamerSym = opt['streamer-symbol'] || '';
      const restOI = Number(opt['open-interest'] ?? opt.openInterest ?? opt['open-interest-quantity'] ?? null);
      if (isFinite(restOI) && restOI > 0 && streamerSym) {
        oiCache[streamerSym] = restOI;
      }
    });
    const restOICount = Object.keys(oiCache).length;

    // Second pass: fetch OI from market-data in batches
    const allSymsForOI = filteredOptions
      .map(o => o['streamer-symbol'])
      .filter(Boolean);

    // Batch the market-data requests (TT has rate limits)
    const BATCH_SIZE = 50;
    for (let i = 0; i < allSymsForOI.length; i += BATCH_SIZE) {
      if (Object.keys(oiCache).length >= allSymsForOI.length) break; // Already have all OI
      const batch = allSymsForOI.slice(i, i + BATCH_SIZE);
      try {
        const qs = batch.map(s => `symbol[]=${encodeURIComponent(s)}`).join('&');
        const { status: s3, data: d3 } = await ttGet(`/market-data?${qs}`);
        if (s3 === 200 && d3?.data?.items) {
          d3.data.items.forEach(item => {
            const sym = item.symbol || '';
            const oi = Number(item['open-interest'] ?? item.openInterest ?? null);
            if (isFinite(oi) && oi > 0 && !oiCache[sym]) oiCache[sym] = oi;
          });
        }
      } catch (e) {
        log('market-data batch fetch failed:', e.message);
      }
    }

    const marketDataOICount = Object.keys(oiCache).length - restOICount;
    if (marketDataOICount > 0) {
      log('Added', marketDataOICount, 'symbols from market-data (', restOICount, 'from REST)');
    }

    if (restOICount > 0) {
      log('Cached OI for', Object.keys(oiCache).length, 'symbols total');
    }

    for (const opt of filteredOptions) {
      const expDate = opt['expiration-date'] || '';
      const strikePrice = parseFloat(opt['strike-price'] || 0);
      const rawType = (opt['option-type'] || '').toUpperCase();
      const side = rawType === 'C' ? 'call' : rawType === 'P' ? 'put' : rawType.toLowerCase();
      if (!expDate || !strikePrice || !side || (side !== 'call' && side !== 'put')) continue;
      if (!expMap[expDate]) expMap[expDate] = { 'expiration-date': expDate, strikes: {} };
      if (!expMap[expDate].strikes[strikePrice]) expMap[expDate].strikes[strikePrice] = { 'strike-price': String(strikePrice) };
      const streamerSym = opt['streamer-symbol'] || '';
      const greeks  = dxGreeksCache[streamerSym]  || {};
      const summary = dxSummaryCache[streamerSym] || {};
      const quote   = dxQuoteCache[streamerSym]   || {};
      const trade   = dxTradeCache[streamerSym]   || {};
      const fallbackGreeks = estimateOptionGreekFallback(opt, underlyingPrice, side);
      const liveDelta = firstFiniteNumber(greeks.delta, opt.delta, opt['delta'], null);
      const liveGamma = firstFiniteNumber(greeks.gamma, opt.gamma, opt['gamma'], null);
      const liveTheta = firstFiniteNumber(greeks.theta, opt.theta, opt['theta'], null);
      const liveVega  = firstFiniteNumber(greeks.vega, opt.vega, opt['vega'], null);
      const liveIv    = greeks.volatility > 0 ? greeks.volatility : firstFiniteNumber(opt['implied-volatility'], opt['iv']);

      // OI: Priority chain (2026-06-15 fix)
      // 1. Merged cache (REST + market-data pre-cached above)
      // 2. dxLink Summary cache (historical)
      // 3. Last known non-zero dxLink OI from cache
      // 4. Default to 0
      const cachedMergedOI = Number(oiCache[streamerSym] ?? 0) || 0;
      const liveOI  = Number(summary.openInterest ?? summary['open-interest'] ?? summary.open_interest ?? 0) || 0;
      const cachedDxOI = Number(dxOpenInterestCache[streamerSym] || 0) || 0;
      const finalOI = cachedMergedOI || liveOI || cachedDxOI;
      if (finalOI > 0 && !cachedDxOI && streamerSym) dxOpenInterestCache[streamerSym] = finalOI;
      // Volume: prefer TT REST day-volume, fall back to dxLink Trade dayVolume or Summary dayVolume
      const restVol  = Number(opt['day-volume'] ?? opt['volume'] ?? opt.totalVolume ?? 0) || 0;
      const liveVol  = Number(trade.dayVolume ?? summary.dayVolume ?? 0) || 0;
      const finalVol = restVol || liveVol;

      expMap[expDate].strikes[strikePrice][side] = {
        symbol:               opt.symbol || '',
        'streamer-symbol':    streamerSym,
        'open-interest':      finalOI,
        openInterest:         finalOI,
        volume:               finalVol,
        _rawOpenInterest:     opt['open-interest'] ?? opt.openInterest ?? null,
        _summaryOpenInterest: summary.openInterest ?? null,
        _rawVolume:           opt.volume ?? opt['volume'] ?? opt['day-volume'] ?? null,
        _tradeDayVolume:      trade.dayVolume ?? null,
        _summaryDayVolume:    summary.dayVolume ?? null,
        _fallbackVolume:      null,
        bid:                  firstFiniteNumber(quote.bidPrice, opt['bid-price'], opt.bid),
        ask:                  firstFiniteNumber(quote.askPrice, opt['ask-price'], opt.ask),
        last:                 firstFiniteNumber(trade.price, opt['last-price'], opt.last, 0),
        mark:                 firstFiniteNumber(opt['mid-price'], opt['mark'], opt.mark, 0),
        delta:                liveDelta !== null && Math.abs(liveDelta) > 0 ? liveDelta : fallbackGreeks.delta,
        gamma:                liveGamma !== null && liveGamma > 0 ? liveGamma : fallbackGreeks.gamma,
        theta:                liveTheta !== null ? liveTheta : fallbackGreeks.theta,
        vega:                 liveVega !== null ? liveVega : fallbackGreeks.vega,
        'implied-volatility': liveIv,
      };
    }

    // Convert map to items array, sorting strikes by distance from ATM for natural centering
    const items = Object.values(expMap).map(eg => ({
      'expiration-date': eg['expiration-date'],
      strikes: Object.values(eg.strikes).sort((a, b) => {
        const aDist = Math.abs(parseFloat(a['strike-price']) - underlyingPrice);
        const bDist = Math.abs(parseFloat(b['strike-price']) - underlyingPrice);
        return aDist - bDist; // closest to ATM first
      }),
    })).sort((a, b) => a['expiration-date'].localeCompare(b['expiration-date']));

    const cachedGreeks = Object.keys(dxGreeksCache).length;
    log('chains built items:', items.length, 'first strikes:', items[0]?.strikes?.length, '| dxLink greeks cached:', cachedGreeks, '| underlying:', underlyingPrice);

    // SAVE TO CACHE (2026-06-12): Cache the built items for future requests
    setChainsInCache(sym, exp, { items, underlyingPrice, rootSymbol });

    return sendJSON(res, 200, { data: { items, underlyingPrice, symbol: sym, rootSymbol }, context: '/option-chains/' + sym + '/nested' });
  }

  // ── GET /api/chains  ──────────────────────────────────────────────────────────
  // React endpoint: fetch option chain with Greeks merged from dxGreeksCache
  if (req.method === 'GET' && p === '/api/chains') {
    const qs = new URL(req.url, `http://${req.headers.host}`).searchParams;
    const sym = (qs.get('ticker') || 'SPX').toUpperCase();
    qs.delete('ticker');
    if (!qs.has('range')) qs.set('range', 'all');

    try {
      const target = `http://127.0.0.1:${PORT}/proxy/api/tt/chains/${encodeURIComponent(sym)}?${qs.toString()}`;
      const upstream = await fetch(target, { signal: AbortSignal.timeout(20000) });
      const json = await upstream.json().catch(() => ({ error: 'Invalid proxy response' }));
      return sendJSON(res, upstream.status, json);
    } catch (e) {
      log('[/api/chains] error:', e.message);
      return sendJSON(res, 500, { error: e.message });
    }
  }

  if (req.method === 'POST' && p === '/proxy/dxlink/subscribe') {
    let body = '';
    req.on('data', c => body += c);
    req.on('end', async () => {
      try {
        const parsed = JSON.parse(body);
        const { symbols, feedTypesBySymbol, feedTypes } = parsed;
        log('dxlink subscribe body:', JSON.stringify(parsed));
        if (Array.isArray(symbols)) {
          symbols.forEach(s => normalizeRequestedCandleSymbols(s).forEach(sym => {
            const requestedTypes = Array.isArray(feedTypesBySymbol?.[s])
              ? feedTypesBySymbol[s]
              : (Array.isArray(feedTypes) ? feedTypes : null);
            const optstatTypes = /\{type=optstat\}$/i.test(String(sym))
              ? ['Message', 'Configuration']
              : requestedTypes;
            addAutoSubscription(sym, optstatTypes);
          }));
          await ensureDxLinkReady();
          sendSubscriptions();
        }
      } catch(e) {}
      sendJSON(res, 200, { ok:true, subscriptions:[...subscriptions] });
    });
    return;
  }

  // ── POST /proxy/api/subscription-ready ─────────────────────────────────────
  // Just registers subscription, returns immediately
  // Live data arrives via WebSocket /ws/dxlink
  if (req.method === 'POST' && p === '/proxy/api/subscription-ready') {
    let body = '';
    req.on('data', c => { if (body.length < 10000) body += c; });
    req.on('error', e => {
      log('[subscription-ready] Request error:', e.message);
      if (!res.writableEnded) sendJSON(res, 400, { error: 'Bad request' });
    });
    req.on('end', () => {
      try {
        const parsed = JSON.parse(body);
        const { pageId, symbols } = parsed;

        if (!pageId || !Array.isArray(symbols) || symbols.length === 0) {
          return sendJSON(res, 400, { error: 'pageId and symbols required' });
        }

        subscriptionManager.request(pageId, symbols).then(result => {
          sendJSON(res, 200, {
            ready: true,
            symbols: symbols.length,
            newSubscriptions: result.newCount ?? result.count,
            message: `Subscribed to ${symbols.length} symbols. Live data arrives via WebSocket.`
          });
        }).catch(e => {
          log('[subscription-ready] Request error:', e.message);
          if (!res.writableEnded) sendJSON(res, 500, { error: e.message });
        });
      } catch (e) {
        log('[subscription-ready] Parse error:', e.message);
        if (!res.writableEnded) sendJSON(res, 500, { error: e.message });
      }
    });
    return;
  }

  // ── GET /proxy/api/tt/top10-test ─────────────────────────────────────────────
  // Subscribes TastyTrade market indicator symbols to dxLink and dumps whatever
  // comes back from Quote/Trade/Summary/Greeks cache after a short wait.
  // Use this to discover what event types/fields these symbols actually return.
  if (req.method === 'GET' && p === '/proxy/api/tt/top10-test') {
    const TOP10_SYMBOLS = [
      '$TOP10GS',  // SP500 absolute gainers
      '$TOP10PGS', // SP500 relative gainers
      '$TOP10LS',  // SP500 absolute losers
      '$TOP10PLS', // SP500 relative losers
      '$TOP10VS',  // SP500 volume
      '$TOP10G/Q', // NASDAQ absolute gainers
      '$TOP10PG/Q',// NASDAQ relative gainers
    ];

    // Subscribe to all event types for these symbols
    TOP10_SYMBOLS.forEach(sym => {
      addAutoSubscription(sym, ['Quote','Trade','TradeETH','Summary','Greeks']);
      ['Quote','Trade','TradeETH','Summary','Greeks'].forEach(type => {
        queueAutoSubscription({ type, symbol: sym });
      });
    });
    sendSubscriptionsRateLimited();

    // Wait up to 3s for data to arrive
    await sleep(3000);

    // Dump whatever landed in the caches for these symbols
    const result = {};
    TOP10_SYMBOLS.forEach(sym => {
      result[sym] = {
        quote:   dxQuoteCache[sym]   || null,
        trade:   dxTradeCache[sym]   || null,
        summary: dxSummaryCache[sym] || null,
        greeks:  dxGreeksCache[sym]  || null,
      };
    });

    console.log('[TOP10-TEST] Cache dump:', JSON.stringify(result, null, 2));
    return sendJSON(res, 200, {
      ok: true,
      subscribed: TOP10_SYMBOLS,
      cacheAfter3s: result,
      note: 'Check proxy console for full dump. Non-null fields = data arrived.'
    });
  }

  if (req.method === 'GET' && p === '/proxy/api/status') {
    const candleStats = {};
    for (const [key, cache] of Object.entries(dxCandleCache)) {
      candleStats[key] = {
        count: cache.size,
        oldest: cache.size ? new Date(Math.min(...cache.keys())).toISOString() : null,
        newest: cache.size ? new Date(Math.max(...cache.keys())).toISOString() : null
      };
    }
    return sendJSON(res, 200, {
      proxy:'tastytrade', tokenValid:!isExpired(), tokenExpiry:new Date(tokenExpiry).toISOString(),
      dxState: dxSocket ? ['CONNECTING','OPEN','CLOSING','CLOSED'][dxSocket.readyState] : 'null',
      dxAuthorized, dxChannelOpen, dxHistoryChannelOpen,
      subscriptions:[...subscriptions], candleSubscriptions:[...candleSubscriptions],
      browserClients:dxClients.size,
      candleCache: candleStats
    });
  }

  if (req.method === 'GET' && p === '/proxy/api/dxlink/candles') {
    const symbol = String(u.searchParams.get('symbol') || '/ES{=5m}');
    const fromParam = Number(u.searchParams.get('start') || 0);
    const toParam = Number(u.searchParams.get('end') || 0);
    log('Candles HTTP request for symbol:', symbol);
    
    const candidates = [
      symbol,
      ...normalizeRequestedCandleSymbols(symbol),
      symbol.replace('/ESU26', '/ES').replace('/NQU26', '/NQU6'),
      symbol.replace('/ES', '/ESU26').replace('/NQ', '/NQU26'),
      symbol.replace(/^\/ES[^{}]*/, '/ES:XCME'),
      symbol.replace(/^\/NQ[^{}]*/, '/NQ:XCME'),
    ];
    
    // Ensure dxLink is connected and HISTORY channel is ready
    if (!dxSocket || dxSocket.readyState !== WebSocket.OPEN) {
      log('dxLink not connected for candles request');
      return sendJSON(res, 503, { error: 'dxLink not connected', empty: true, candles: [] });
    }
    
    if (!dxHistoryChannelOpen) {
      log('HISTORY channel not open - waiting for reconnect...');
      return sendJSON(res, 503, { error: 'HISTORY channel not ready', empty: true, candles: [] });
    }

    // Directly subscribe to candle symbols on HISTORY channel (bypassing candleSubscriptions set)
    const fromTimeMs = Number.isFinite(fromParam) && fromParam > 0 ? fromParam : Date.now() - 86400000;
    const candleSubs = [...new Set(candidates.filter(s => /\{=/.test(s)))];
    
    if (candleSubs.length > 0) {
      log(`HTTP endpoint subscribing to ${candleSubs.length} candle(s) on HISTORY channel for 24h`);
      const removeList = candleSubs.map(s => ({ type: 'Candle', symbol: s }));
      const addList = candleSubs.map(s => ({ type: 'Candle', symbol: s, fromTime: fromTimeMs }));

      for (let i = 0; i < removeList.length; i += 10) {
        const remove = removeList.slice(i, i + 10);
        if (dxSocket?.readyState === WebSocket.OPEN) dxSocket.send(JSON.stringify({
          type: 'FEED_SUBSCRIPTION',
          channel: DX_CHANNEL_HISTORY,
          reset: false,
          remove
        }));
      }

      for (let i = 0; i < addList.length; i += 10) {
        const add = addList.slice(i, i + 10);
        if (dxSocket?.readyState === WebSocket.OPEN) dxSocket.send(JSON.stringify({
          type: 'FEED_SUBSCRIPTION',
          channel: DX_CHANNEL_HISTORY,
          reset: false,
          add
        }));
        add.forEach(item => activeCandleSubscriptionKeys.add(`Candle:${item.symbol}`));
      }
    }

    // Wait for candles to arrive in cache
    const waitStart = Date.now();
    const countParam = Number(u.searchParams.get('count') || 0);
    const targetCount = countParam > 0 ? countParam : (symbol.includes('{=1m}') ? 60 : 200);
    const waitTimeout = 10000;
    
    while (Date.now() - waitStart < waitTimeout) {
      // Check all candidate cache keys
      let bestCache = null;
      let bestCount = 0;
      for (const candidate of candidates) {
        const c = dxCandleCache[candidate];
        if (c && c.size > bestCount) {
          bestCache = c;
          bestCount = c.size;
        }
      }
      
      if (bestCount >= targetCount) {
        const candles = [...bestCache.values()]
          .filter(c => !toParam || c.datetime <= toParam)
          .sort((a, b) => a.datetime - b.datetime);
        log(`HTTP: Returning ${candles.length} candles from cache (found ${bestCount} after ${Date.now() - waitStart}ms)`);
        return sendJSON(res, 200, { symbol: [...candidates].find((s, i) => dxCandleCache[s]?.size === bestCount), empty: false, candles: candles.slice(-targetCount) });
      }
      
      await sleep(200);
    }

    // After timeout, return whatever we have (even if less than targetCount)
    let finalCache = null;
    let finalCount = 0;
    for (const candidate of candidates) {
      const c = dxCandleCache[candidate];
      if (c && c.size > finalCount) {
        finalCache = c;
        finalCount = c.size;
      }
    }
    
    if (finalCache && finalCount > 0) {
      const candles = [...finalCache.values()]
        .filter(c => !toParam || c.datetime <= toParam)
        .sort((a, b) => a.datetime - b.datetime);
      log(`HTTP: Timeout reached. Returning ${candles.length} candles (less than target)`);
      return sendJSON(res, 200, { empty: false, candles: candles.slice(-targetCount) });
    }

    log('HTTP: No candles received after 8s - returning empty');
    return sendJSON(res, 200, { empty: true, candles: [] });
  }

  // ── GET /proxy/api/tt/market-data/history/:symbol ────────────────────
  // Returns 1 year of daily OHLCV candles for any equity/index symbol.
  // Response shape: { data: { items: [{open,high,low,close,volume,time}] } }
  const histMatch = p.match(/^\/proxy\/api\/tt\/market-data\/history\/(.+)$/);
  if (req.method === 'GET' && histMatch) {
    const sym = decodeURIComponent(histMatch[1]);
    try {
      const { payload } = await getDailyHistoryPayload(sym);
      return sendJSON(res, 200, payload);
    } catch (err) {
      const status = Number(err?.status) || 502;
      return sendJSON(res, status, err?.data || { error: err?.message || 'History unavailable' });
    }
  }

  // ── GET /proxy/api/cboe/putcall ───────────────────────────────────────
  // Returns today's equity put/call ratio from CBOE, with TT fallback.
  // Response shape: { ratio: number, date: string, source: string }
  if (req.method === 'GET' && p === '/proxy/api/cboe/putcall') {
    // Check cache first (refresh every 5 minutes)
    if (putCallCache.ratio > 0 && Date.now() - putCallCache.ts < 300_000) {
      return sendJSON(res, 200, { ratio: putCallCache.ratio, date: putCallCache.date, source: putCallCache.source });
    }
    // Primary: CBOE daily equity P/C CSV
    const fetchCboe = (url) => new Promise((resolve, reject) => {
      const req2 = https.get(url, { headers: { 'User-Agent': 'Mozilla/5.0' }, timeout: 5000 }, res2 => {
        let raw = '';
        res2.on('data', c => raw += c);
        res2.on('end', () => resolve({ status: res2.statusCode, text: raw }));
      });
      req2.on('error', reject);
      req2.on('timeout', () => { req2.destroy(); reject(new Error('timeout')); });
    });
    try {
      const { status: s1, text: t1 } = await fetchCboe(
        'https://cdn.cboe.com/data/us/options/market_statistics/daily_equity_pc_ratio.csv'
      );
      if (s1 === 200) {
        const lines = t1.trim().split('\n').filter(l => l.trim() && !l.startsWith('DATE'));
        const last  = lines[lines.length - 1].split(',');
        const ratio = parseFloat(last[1]);
        const date  = (last[0] || '').trim();
        if (ratio > 0 && ratio < 5) {
          putCallCache = { ratio, date, source: 'CBOE Equity P/C', ts: Date.now() };
          return sendJSON(res, 200, { ratio, date, source: 'CBOE Equity P/C' });
        }
      }
    } catch(e) {
      log('CBOE putcall primary error:', e.message);
    }
    try {
      // Fallback: CBOE index P/C CSV
      const { status: s2, text: t2 } = await fetchCboe(
        'https://cdn.cboe.com/data/us/options/market_statistics/daily_index_pc_ratio.csv'
      );
      if (s2 === 200) {
        const lines = t2.trim().split('\n').filter(l => l.trim() && !l.startsWith('DATE'));
        const last  = lines[lines.length - 1].split(',');
        const ratio = parseFloat(last[1]);
        const date  = (last[0] || '').trim();
        if (ratio > 0 && ratio < 5) {
          putCallCache = { ratio, date, source: 'CBOE Index P/C', ts: Date.now() };
          return sendJSON(res, 200, { ratio, date, source: 'CBOE Index P/C' });
        }
      }
    } catch(e) {
      log('CBOE putcall fallback error:', e.message);
    }
    // Final fallback: return cached value if available, or unavailable
    if (putCallCache.ratio > 0) {
      return sendJSON(res, 200, { ratio: putCallCache.ratio, date: putCallCache.date, source: putCallCache.source + ' (cached)' });
    }
    return sendJSON(res, 200, { ratio: 0, date: '', source: 'unavailable', error: 'CBOE P/C data unavailable' });
  }

  // ── GET /proxy/api/optstat/:symbol ──────────────────────────────────────
  // Returns IV and option stats from DXLink cache or TT API
  const optstatMatch = p.match(/^\/proxy\/api\/optstat\/(.+)$/);
  if (req.method === 'GET' && optstatMatch) {
    const sym = normalizeRestSymbol(decodeURIComponent(optstatMatch[1]));
    try {
      // Try DXLink optstat cache first
      const dxKey = sym.startsWith('$') ? sym.substring(1) : sym;
      const dxOptionStatsCacheRef = global.dxOptionStatsCache || {};
      const dxOptionStats = dxOptionStatsCacheRef[dxKey] || dxOptionStatsCacheRef[sym];
      if (dxOptionStats) {
        return sendJSON(res, 200, {
          ...dxOptionStats,
          source: 'dxlink',
          symbol: sym
        });
      }
      
      // Fallback to TT market-metrics
      const { status, data } = await ttGet(`/market-metrics/${encodeURIComponent(sym)}`);
      if (status === 200 && data?.data?.items?.[0]?.['implied-volatility']) {
        const iv = Number(data.data.items[0]['implied-volatility']);
        return sendJSON(res, 200, { iv: iv * 100, source: 'tastytrade', symbol: sym });
      }
      return sendJSON(res, 200, { source: 'unavailable', symbol: sym, empty: true });
    } catch (e) {
      log('optstat error:', e.message);
      return sendJSON(res, 500, { error: e.message, symbol: sym });
    }
  }

  // ── GET /proxy/api/tt/expirations/:symbol ─────────────────────────────
  // Returns available expiration dates for a symbol from the nested chain.
  const expMatch = p.match(/^\/proxy\/api\/tt\/expirations\/(.+)$/);
  if (req.method === 'GET' && expMatch) {
    const sym = normalizeRestSymbol(decodeURIComponent(expMatch[1]));
    try {
      const { status: s1, data: d1 } = await ttGet(`/option-chains/${encodeURIComponent(sym)}/nested`);
      if (s1 !== 200 || !d1?.data?.items?.length) {
        return sendJSON(res, s1, d1);
      }
      const byDate = new Map();
      const roots = d1.data.items || [];
      roots.forEach(chainObj => {
        const rootSymbol = chainObj['root-symbol'] || sym;
        (chainObj.expirations || []).forEach(e => {
          const expDate = e['expiration-date'];
          if (!expDate) return;
          const existing = byDate.get(expDate) || {};
          const rootLooksMonthly = rootSymbol === sym && !/W$/i.test(rootSymbol);
          const incomingType = e['expiration-type'] || (rootLooksMonthly ? 'Monthly' : 'Weekly');
          byDate.set(expDate, {
            'expiration-date': expDate,
            'expiration-type': existing['expiration-type'] === 'Monthly' || incomingType === 'Monthly' ? 'Monthly' : incomingType,
            'strike-count': Math.max(existing['strike-count'] || 0, (e.strikes || []).length),
            'root-symbol': existing['root-symbol'] || rootSymbol
          });
        });
      });
      const expirations = [...byDate.values()].sort((a, b) => a['expiration-date'].localeCompare(b['expiration-date']));
      const preferredRoot = roots.find(c => c['root-symbol'] === 'SPXW')?.['root-symbol'] || roots[0]?.['root-symbol'] || sym;
      return sendJSON(res, 200, { data: { items: expirations, symbol: sym, rootSymbol: preferredRoot } });
    } catch (e) {
      log('expirations error:', e.message);
      return sendJSON(res, 500, { error: e.message });
    }
  }

  // ── GET /proxy/api/google/token ──────────────────────────────────────────
  // Returns a valid Google access token, refreshing if needed
  if (req.method === 'GET' && p === '/proxy/api/google/token') {
    try {
      const token = await getGoogleAccessToken();
      return sendJSON(res, 200, { access_token: token });
    } catch (e) {
      log('Google token error:', e.message);
      return sendJSON(res, 500, { error: e.message });
    }
  }

  // ── GET /proxy/api/quote/:symbol ─────────────────────────────────────────────
  if (req.method === 'GET' && p.match(/^\/proxy\/api\/quote\/(.+)$/)) {
    const symbol = decodeURIComponent(RegExp.$1);
    
    // Try DXLink cache first (for subscribed symbols)
    const cached = dxQuoteCache[symbol];
    if (cached) {
      const summary = dxSummaryCache[symbol] || dxSummaryCache[symbol.replace(/^\/NQ:XCME$/, 'NDX')] || dxSummaryCache[symbol.replace(/^\/ES:XCME$/, 'SPX')] || {};
      const closePrice = firstFiniteNumber(
        cached.prevDayClosePrice,
        cached.closePrice,
        summary.prevDayClosePrice,
        summary.dayOpenPrice,
        marketDataPrevCloseCache[symbol],
        symbol === '/NQ:XCME' ? marketDataPrevCloseCache.NDX : 0,
        symbol === '/ES:XCME' ? marketDataPrevCloseCache.SPX : 0,
        summary.dayClosePrice,
        0
      );
      const trade = dxTradeCache[symbol] || {};
      return sendJSON(res, 200, {
        quote: {
          lastPrice: cached.last || cached.mark || cached.bidPrice || 0,
          bidPrice: cached.bidPrice,
          askPrice: cached.askPrice,
          closePrice,
          dayVolume: trade.dayVolume || summary.dayVolume || 0
        }
      });
    }
    
    // Fall back to Schwab HTTP request
    if (!schwabAccessToken) return sendJSON(res, 401, { error: 'Schwab not connected' });
    const opts = {
      hostname: SCHWAB_BASE, port: 443,
      path: `/marketdata/v1/quotes?symbols=${encodeURIComponent(symbol)}`,
      method: 'GET',
      headers: { 'Authorization': `Bearer ${schwabAccessToken}`, 'Accept': 'application/json' }
    };
    const schwabReq = https.request(opts, schwabRes => {
      let raw = '';
      schwabRes.on('data', c => raw += c);
      schwabRes.on('end', () => {
        try {
          const data = JSON.parse(raw);
          res.writeHead(schwabRes.statusCode, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify(data));
        } catch(e) {
          res.writeHead(schwabRes.statusCode, { 'Content-Type': 'application/json' });
          res.end(raw);
        }
      });
    });
    schwabReq.on('error', err => sendJSON(res, 502, { error: err.message }));
    schwabReq.end();
  }

  // ── GET /proxy/api/quote-of-day ──────────────────────────────────────────
  if (req.method === 'GET' && p === '/proxy/api/quote-of-day') {
    try {
      const sheetId = '1NzeEb9KZgQQLIFkQ0ipxDPM2zQDBO1Yy-0As7O5q9Vg';
      const gid = '135604923'; // Quote sheet gid
      const csvUrl = `https://docs.google.com/spreadsheets/d/${sheetId}/export?format=csv&gid=${gid}`;
      const data = await new Promise((resolve, reject) => {
        function doGet(url, redirects) {
          if (redirects > 5) return reject(new Error('Too many redirects'));
          const u = new URL(url);
          https.get({ hostname: u.hostname, path: u.pathname + u.search, headers: { 'User-Agent': 'Mozilla/5.0' } }, r => {
            if ((r.statusCode === 301 || r.statusCode === 302 || r.statusCode === 307) && r.headers.location) {
              return doGet(r.headers.location, redirects + 1);
            }
            let d = '';
            r.on('data', c => d += c);
            r.on('end', () => resolve(d));
          }).on('error', reject);
        }
        doGet(csvUrl, 0);
      });
      const lines = data.split('\n').slice(1).filter(l => l.trim());
      const today = new Date();
      const mm = today.getMonth() + 1;
      const dd = today.getDate();
      const yyyy = today.getFullYear();
      let quote = '';
      for (const line of lines) {
        const parts = line.split(',');
        const date = (parts[0] || '').replace(/"/g, '').trim();
        if (date === `${mm}/${dd}/${yyyy}` || date === `${mm}/${dd}`) {
          quote = parts.slice(1).join(',').replace(/^"+|"+$/g, '').trim();
          break;
        }
      }
      return sendJSON(res, 200, { quote });
    } catch(e) {
      log('quote-of-day error:', e.message);
      return sendJSON(res, 500, { error: e.message });
    }
  }

  // ── ANY /proxy/api/sheets/* → proxy to Google Sheets API ────────────────
  if (p.startsWith('/proxy/api/sheets/')) {
    try {
      const token = await getGoogleAccessToken();
      const sheetsPath = p.replace('/proxy/api/sheets', '');
      const url = new URL(req.url, 'http://localhost');
      const qs = url.search || '';
      const sheetsUrl = `https://sheets.googleapis.com/v4/spreadsheets${sheetsPath}${qs}`;

      let bodyChunks = [];
      req.on('data', c => bodyChunks.push(c));
      req.on('end', async () => {
        const body = Buffer.concat(bodyChunks);
        const options = new URL(sheetsUrl);
        const sheetsReq = https.request(options, {
          method: req.method,
          headers: {
            'Authorization': `Bearer ${token}`,
            'Content-Type': req.headers['content-type'] || 'application/json',
            ...(body.length ? { 'Content-Length': body.length } : {})
          }
        }, sheetsRes => {
          let data = '';
          sheetsRes.on('data', c => data += c);
          sheetsRes.on('end', () => {
            res.writeHead(sheetsRes.statusCode, {
              'Content-Type': 'application/json',
              'Access-Control-Allow-Origin': '*'
            });
            res.end(data);
          });
        });
        sheetsReq.on('error', err => sendJSON(res, 502, { error: err.message }));
        if (body.length) sheetsReq.write(body);
        sheetsReq.end();
      });
      return;
    } catch (e) {
      log('Sheets proxy error:', e.message);
      return sendJSON(res, 500, { error: e.message });
    }
  }


  // ── POST /proxy/api/discord-webhook  (Discord webhook relay via .env) ────────
  const webhookMatch = p.match(/^\/proxy\/api\/webhooks\/([^/]+)\/([^/]+)$/);
  if (req.method === 'POST' && webhookMatch) {
    const discordUrl = `https://discord.com/api/webhooks/${webhookMatch[1]}/${webhookMatch[2]}`;
    const chunks = [];
    req.on('data', c => chunks.push(c));
    req.on('end', () => {
      const body = Buffer.concat(chunks);
      const contentType = req.headers['content-type'] || '';
      const discordReq = https.request(new URL(discordUrl), {
        method: 'POST',
        headers: { 'Content-Type': contentType, 'Content-Length': body.length }
      }, discordRes => {
        res.writeHead(discordRes.statusCode, {
          'Content-Type': discordRes.headers['content-type'] || 'application/json',
          'Access-Control-Allow-Origin': '*'
        });
        discordRes.pipe(res);
      });
      discordReq.on('error', e => sendJSON(res, 500, { error: e.message }));
      if (body.length) discordReq.write(body);
      discordReq.end();
    });
    return;
  }

  if (req.method === 'POST' && p === '/proxy/api/discord-webhook') {
    if (!DISCORD_WEBHOOK_URL) return sendJSON(res, 500, { error: 'DISCORD_WEBHOOK_URL not configured' });
    const chunks = [];
    req.on('data', c => chunks.push(c));
    req.on('end', () => {
      const body = Buffer.concat(chunks);
      const contentType = req.headers['content-type'] || '';
      const discordReq = https.request(new URL(DISCORD_WEBHOOK_URL), {
        method: 'POST',
        headers: { 'Content-Type': contentType, 'Content-Length': body.length }
      }, discordRes => {
        res.writeHead(discordRes.statusCode, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
        discordRes.pipe(res);
      });
      discordReq.on('error', e => sendJSON(res, 500, { error: e.message }));
      discordReq.write(body);
      discordReq.end();
    });
    return;
  }

  // ── GET /proxy/api/greeks-intraday ─────────────────────────────────────────
  // Returns today's intraday GEX/DEX/CHEX/VEX history — reads SQLite first,
  // falls back to in-memory array if DB not ready
  if (req.method === 'GET' && p === '/proxy/api/greeks-intraday') {
    const date = u.searchParams.get('date') || dbEtDate();
    let records = [];
    if (db) {
      try {
        const rows = stmts().queryGreeksByDate.all(date);
        records = rows.map(r => ({
          ts: r.ts, time: r.time,
          gex: r.gex, dex: r.dex, chex: r.chex, vex: r.vex,
          buyPct: r.buy_pct, spot: r.spot,
        }));
      } catch (e) {
        log('[DB] greeks-intraday query error:', e.message);
      }
    }
    // Merge in-memory ring buffer for any points not yet committed
    if (records.length < intradayGreeksHistory.length) {
      const lastDbTs = records.length ? records[records.length - 1].ts : 0;
      const fresh = intradayGreeksHistory.filter(r => r.ts > lastDbTs);
      records = [...records, ...fresh];
    }
    return sendJSON(res, 200, { ok: true, date, records, count: records.length });
  }

  if (req.method === 'GET' && p === '/proxy/api/gex-levels') {
    const url = new URL('http://localhost' + req.url);
    const callWallParam = parseFloat(url.searchParams.get('callWall')) || 0;
    const putWallParam = parseFloat(url.searchParams.get('putWall')) || 0;
    const zeroGammaParam = parseFloat(url.searchParams.get('zeroGamma')) || 0;
    
    let basis = esBasisCache.basis;
    if (!basis || basis === 0) {
      basis = await fetchEsBasis().catch(() => esBasisCache.basis);
    }
    
    const rows = ['Symbol,Price,Label,Text Color,Line Color,Band Color,Band Offset,Show Label,Show Price'];
    
    if (callWallParam > 0) {
      const esPrice = Math.round((callWallParam + basis) * 4) / 4;
      rows.push(`ESU6,${esPrice.toFixed(2)},Call Wall,#000000,RED,#80808027,10,TRUE,TRUE`);
    }
    if (putWallParam > 0) {
      const esPrice = Math.round((putWallParam + basis) * 4) / 4;
      rows.push(`ESU6,${esPrice.toFixed(2)},Put Wall,#000000,GREEN,#80808027,10,TRUE,TRUE`);
    }
    if (zeroGammaParam > 0) {
      const esPrice = Math.round((zeroGammaParam + basis) * 4) / 4;
      rows.push(`ESU6,${esPrice.toFixed(2)},Zero Gamma,#000000,WHITE,#80808027,10,TRUE,TRUE`);
    }
    
    const csv = rows.join('\n') + '\n';

    // If params were provided, save to file for MotiveWave to read
    if (callWallParam > 0 || putWallParam > 0) {
      try { writeFileAtomic(GEX_CSV_PATH, csv); } catch(e) { log('GEX CSV write error:', e.message); }
      log('GEX levels CSV: SPX cw=' + callWallParam + ' pw=' + putWallParam + ' zg=' + zeroGammaParam + ' | basis=' + basis.toFixed(2));
      res.writeHead(200, { 'Content-Type': 'text/csv', 'Access-Control-Allow-Origin': '*', 'Cache-Control': 'no-cache' });
      return res.end(csv);
    }

    // No params — serve the last saved file
    const savedCsv = fs.existsSync(GEX_CSV_PATH) ? fs.readFileSync(GEX_CSV_PATH, 'utf8') : rows[0] + '\n';
    res.writeHead(200, { 'Content-Type': 'text/csv', 'Access-Control-Allow-Origin': '*', 'Cache-Control': 'no-cache' });
    return res.end(savedCsv);
  }

  // ── DATABASE REST API ─────────────────────────────────────────
  // POST /proxy/api/db/insert: Insert row into table { table, data }
  if (req.method === 'POST' && p === '/proxy/api/db/insert') {
    let body = '';
    req.on('data', c => body += c);
    req.on('end', () => {
      try {
        const { table, data } = JSON.parse(body);
        if (!db || !table) return sendJSON(res, 400, { error: 'Missing table' });

        const tableMap = {
          'mvc': { cols: ['timestamp','date','triggerType','data'] },
          'premium_flow': { cols: ['timestamp','date','ticker','data'] },
          'chain_snapshots': { cols: ['timestamp','date','symbol','data'] },
          'greeks_history': { cols: ['timestamp','strike','expiration','data'] },
          'multi_stock_flow': { cols: ['timestamp','date','stock','dte','data'] },
          'greeks_time_series': { cols: ['timestamp','date','ticker','data'] },
          'big_trades': { cols: ['timestamp','date','ticker','data'] },
          'es_15m_candles': { cols: ['timestamp','date','slot_key','data'] },
          'gex_top3': { cols: ['timestamp','date','ticker','data'] },
          'bzila_live_snapshots': { cols: ['timestamp','date','ticker','data'] }
        };

        const schema = tableMap[table];
        if (!schema) return sendJSON(res, 400, { error: 'Unknown table' });

        const cols = schema.cols.join(',');
        const placeholders = schema.cols.map(() => '?').join(',');
        const values = schema.cols.map(c => {
          if (c === 'data' && typeof data[c] === 'object') return JSON.stringify(data[c]);
          return data[c];
        });

        db.prepare(`INSERT INTO ${table} (${cols}) VALUES (${placeholders})`).run(...values);
        return sendJSON(res, 200, { ok: true });
      } catch (e) {
        log('[DB API] Insert error:', e.message);
        return sendJSON(res, 500, { error: e.message });
      }
    });
    return;
  }

  // GET /proxy/api/db/query?table=...&date=...&limit=1000: Query table
  if (req.method === 'GET' && p === '/proxy/api/db/query') {
    try {
      if (!db) return sendJSON(res, 500, { error: 'DB not initialized' });

      const table = u.searchParams.get('table');
      const date = u.searchParams.get('date');
      const ticker = u.searchParams.get('ticker');
      const limit = Math.min(parseInt(u.searchParams.get('limit') || '1000', 10), 10000);

      if (!table) return sendJSON(res, 400, { error: 'Missing table param' });

      let query = `SELECT * FROM ${table}`;
      const params = [];

      if (date) { query += ` WHERE date = ?`; params.push(date); }
      else if (ticker) { query += ` WHERE ticker = ? OR stock = ?`; params.push(ticker, ticker); }

      query += ` ORDER BY timestamp DESC LIMIT ?`;
      params.push(limit);

      const rows = db.prepare(query).all(...params);

      // Parse JSON columns
      const parsed = rows.map(r => {
        if (r.data && typeof r.data === 'string') {
          try { r.data = JSON.parse(r.data); } catch (e) { }
        }
        return r;
      });

      return sendJSON(res, 200, { data: parsed });
    } catch (e) {
      log('[DB API] Query error:', e.message);
      return sendJSON(res, 500, { error: e.message });
    }
  }

  // GET /proxy/api/db/cleanup: Delete records older than N days (admin only)
  if (req.method === 'GET' && p === '/proxy/api/db/cleanup') {
    try {
      if (!db) return sendJSON(res, 500, { error: 'DB not initialized' });

      const days = parseInt(u.searchParams.get('days') || '7', 10);
      const cutoffDate = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString().split('T')[0];

      const tables = ['mvc','premium_flow','chain_snapshots','multi_stock_flow','greeks_time_series','big_trades','es_15m_candles','gex_top3','bzila_live_snapshots'];
      let totalDeleted = 0;

      for (const tbl of tables) {
        const result = db.prepare(`DELETE FROM ${tbl} WHERE date < ?`).run(cutoffDate);
        totalDeleted += result.changes;
      }

      return sendJSON(res, 200, { deleted: totalDeleted, cutoffDate });
    } catch (e) {
      log('[DB API] Cleanup error:', e.message);
      return sendJSON(res, 500, { error: e.message });
    }
  }

  // ── STATIC FILE SERVING ───────────────────────────────────────
  {
    const MIME = {
      '.html':'text/html', '.js':'application/javascript', '.css':'text/css',
      '.json':'application/json', '.png':'image/png', '.ico':'image/x-icon',
      '.svg':'image/svg+xml', '.woff2':'font/woff2', '.woff':'font/woff'
    };
    const filePath = p === '/' ? 'index.html' : p.slice(1);
    const abs = path.resolve(__dirname, filePath);
    if (abs.startsWith(path.resolve(__dirname)) && fs.existsSync(abs) && fs.statSync(abs).isFile()) {
      const ext = path.extname(abs).toLowerCase();
      const mime = MIME[ext] || 'application/octet-stream';
      res.writeHead(200, { 'Content-Type': mime, 'Access-Control-Allow-Origin': '*', 'Cache-Control': 'no-cache' });
      return fs.createReadStream(abs).pipe(res);
    }
  }

  sendJSON(res, 404, { error:'Unknown route', path:p });
});

// ─── WebSocket Bridge ─────────────────────────────────────────────────────────
const wss = new WebSocket.Server({ server, path:'/ws/dxlink' });

wss.on('connection', ws => {
  dxClients.add(ws);
  let subscriptionDebounceTimer = null;

  if (!dxSocket || dxSocket.readyState === WebSocket.CLOSED) {
    ensureDxLinkReady().catch(e => log('ensureDxLinkReady on browser connect failed:', e.message));
  }

  // Send cached quotes immediately so topbar populates without waiting for next tick
  setTimeout(() => {
    if (ws.readyState !== WebSocket.OPEN) return;
    ['SPX','VIX','/ES:XCME','/NQ:XCME','QQQ','SMH','AAPL','AMD','AMZN','GOOGL','META','MSFT','NVDA','TSLA'].forEach(sym => {
      if (dxQuoteCache[sym]) {
        const q = dxQuoteCache[sym];
        ws.send(JSON.stringify({ type:'FEED_DATA', data:['Quote',[sym, q.bidPrice, q.askPrice, q.bidSize, q.askSize]] }));
      }
      if (dxTradeCache[sym]) {
        const t = dxTradeCache[sym];
        ws.send(JSON.stringify({ type:'FEED_DATA', data:['Trade',[sym, t.price, t.dayVolume, t.size]] }));
      }
      // Replay Summary so browser has prevDayClosePrice immediately on connect
      // Send as object array (same format as live broadcast) so browser parses correctly
      const s = dxSummaryCache[sym];
      if (s || sym === '/NQ:XCME' || sym === '/ES:XCME') {
        const prevClose = firstFiniteNumber(
          marketDataPrevCloseCache[sym],
          s?.prevDayClosePrice,
          sym === '/NQ:XCME' ? marketDataPrevCloseCache.NDX : 0,
          sym === '/ES:XCME' ? marketDataPrevCloseCache.SPX : 0,
          0
        );
        ws.send(JSON.stringify({ type:'FEED_DATA', data:[{
          eventType: 'Summary', eventSymbol: sym,
          openInterest: s?.openInterest || 0, dayVolume: s?.dayVolume || 0,
          dayOpenPrice: s?.dayOpenPrice || 0, dayHighPrice: s?.dayHighPrice || 0,
          dayLowPrice: s?.dayLowPrice || 0, prevDayClosePrice: prevClose
        }] }));
      }
    });
    // Send full intraday history on connect so chart populates immediately
    if (intradayGreeksHistory.length > 0) {
      ws.send(JSON.stringify({ type: 'GREEKS_INTRADAY_HISTORY', data: intradayGreeksHistory }));
    }
  }, 200);

  if (!dxSocket || dxSocket.readyState === WebSocket.CLOSED) {
    // Market-data seeding happens at proxy startup in server.listen()
  }
  ws.on('message', async raw => {
    try {
      const msg = JSON.parse(raw);
      if (msg.type === 'subscribe' && Array.isArray(msg.symbols)) {
        // DISABLED: WebSocket subscriptions cause massive queuing on refresh
        // All subscriptions must come via REST POST /proxy/dxlink/subscribe instead
        log(`[WS] Browser subscribe IGNORED (${msg.symbols.length} symbols) — use REST POST instead`);
        return;
      }
    } catch(e) {
      console.error('[WS] Message parse error:', e.message);
    }
  });
  ws.on('close', () => {
    dxClients.delete(ws);
    if (dxClients.size === 0 && dxSocket) { clearInterval(keepAliveInterval); dxSocket.close(); dxSocket = null; }
  });
  ws.on('error', e => console.error('[WS] Browser error:', e.message));
});

// ─── Start ────────────────────────────────────────────────────────────────────
// Pre-warm: fetch SPX chain + subscribe all streamer-symbols to dxLink at startup
// ─── Target Expiration Logic ──────────────────────────────────────────────────
// 9:30am–4:00pm ET  → 0DTE (today)
// 4:00pm–midnight ET → next trading day expiration
// midnight–9:30am ET → 0DTE (today, new day)
function getTargetExpirationDate(availableExpirations) {
  const now    = new Date();
  const et     = isDST(now) ? -4 : -5;
  const etNow  = new Date(now.getTime() + et * 3600000);
  const etHour = etNow.getUTCHours();
  const etMin  = etNow.getUTCMinutes();
  const etTime = etHour * 60 + etMin;

  const MARKET_OPEN  = 9  * 60 + 30;  // 570  — 9:30 AM ET
  const MARKET_CLOSE = 16 * 60;        // 960  — 4:00 PM ET
  const MIDNIGHT     = 0;              // 0    — 12:00 AM ET

  // ET calendar date string (YYYY-MM-DD)
  const etDateStr = etNow.toISOString().split('T')[0];

  const sorted = [...availableExpirations].filter(Boolean).sort();
  if (!sorted.length) return null;

  // Helper: next trading day from a given YYYY-MM-DD string
  function nextTradingDay(fromYmd) {
    const d = new Date(`${fromYmd}T12:00:00Z`);
    do { d.setUTCDate(d.getUTCDate() + 1); }
    while (d.getUTCDay() === 0 || d.getUTCDay() === 6); // skip Sun/Sat
    return d.toISOString().split('T')[0];
  }

  // Nearest available expiry >= a target date
  function nearestOnOrAfter(target) {
    return sorted.find(e => e >= target) || sorted[sorted.length - 1];
  }

  if (etTime >= MARKET_OPEN && etTime < MARKET_CLOSE) {
    // 9:30 AM – 4:00 PM ET → today's SPX chain (0DTE)
    return nearestOnOrAfter(etDateStr);
  } else if (etTime >= MARKET_CLOSE) {
    // 4:00 PM – midnight ET → tomorrow / next trading day (1DTE)
    const nextDay = nextTradingDay(etDateStr);
    return nearestOnOrAfter(nextDay);
  } else {
    // Midnight – 9:30 AM ET → next trading day 0DTE chain
    // (same target as after-hours: pre-load tomorrow's chain)
    const nextDay = nextTradingDay(etDateStr);
    return nearestOnOrAfter(nextDay);
  }
}

function isDST(date) {
  // US DST: second Sunday of March through first Sunday of November
  const jan = new Date(date.getFullYear(), 0, 1).getTimezoneOffset();
  const jul = new Date(date.getFullYear(), 6, 1).getTimezoneOffset();
  return Math.max(jan, jul) !== date.getTimezoneOffset();
}

async function prewarmCache() {
  log('Pre-warming dxLink cache for SPX, SPY, QQQ options...');
  const allPrewarmSyms = [];

  try {
    // Helper to prewarm a single symbol (0DTE only)
    const prewarmSymbol = async (symbol, rootSymbol, rangeType) => {
      try {
        const { status: s1, data: d1 } = await ttGet(`/option-chains/${encodeURIComponent(symbol)}/nested`);
        if (s1 !== 200 || !d1?.data?.items?.length) { log(`Prewarm: nested chain failed for ${symbol}`, s1); return; }
        const chainObj = d1.data.items[0];
        const allExpDates = (chainObj.expirations || []).map(e => e['expiration-date']).filter(Boolean).sort();

        // CRITICAL: Only 0DTE (today's expiration)
        const today = new Date().toISOString().split('T')[0];
        const todayExp = allExpDates.find(d => d === today);
        if (!todayExp) { log(`Prewarm: no 0DTE expiration for ${symbol}`); return []; }

        const { status: s2, data: d2 } = await ttGet(`/option-chains/${encodeURIComponent(symbol)}?expiration-date=${todayExp}`);
        if (s2 !== 200 || !d2?.data?.items) { log(`Prewarm: chain fetch failed for ${symbol}`, s2); return; }

        const quotePrice = await fetchUnderlyingLast(symbol).catch(() => 0);
        const underlyingPrice = quotePrice > 0 ? quotePrice : (symbol === 'SPY' ? 725 : symbol === 'QQQ' ? 700 : 5800);

        // Range: $50 for SPX (tighter), 10% for stocks (much tighter for faster prewarm)
        let rangeAbs = 50;
        if (rangeType === 'pct20') {
          rangeAbs = underlyingPrice * 0.10;  // Changed from 0.20 to 0.10 for faster prewarm
        }

        const rangeFiltered = d2.data.items
          .filter(o => {
            const strike = parseFloat(o?.['strike-price'] || o?.strike || 0);
            return strike > 0 && Math.abs(strike - underlyingPrice) <= rangeAbs;
          })
          .sort((a, b) => {
            const da = Math.abs(parseFloat(a?.['strike-price'] || 0) - underlyingPrice);
            const db = Math.abs(parseFloat(b?.['strike-price'] || 0) - underlyingPrice);
            return da - db;
          });

        const syms = rangeFiltered.map(o => o['streamer-symbol']).filter(Boolean);
        log(`Prewarm: ${symbol} 0DTE ${todayExp}: got ${d2.data.items.length} total, filtered to ±${rangeAbs.toFixed(0)} range: ${rangeFiltered.length} strikes, ${syms.length} symbols around $${underlyingPrice.toFixed(2)}`);

        return syms;
      } catch(e) {
        log(`Prewarm error for ${symbol}:`, e.message);
        return [];
      }
    };

    // Prewarm ONLY 0DTE SPX, SPY, QQQ — hard cap to keep queue small
    const SPX_CAP = 200, SPY_CAP = 100, QQQ_CAP = 100;
    const spxSyms = (await prewarmSymbol('SPX', 'SPXW', 'dollar100')) || [];
    const spySyms = (await prewarmSymbol('SPY', 'SPY', 'pct20')) || [];
    const qqqSyms = (await prewarmSymbol('QQQ', 'QQQ', 'pct20')) || [];

    allPrewarmSyms.push(
      ...spxSyms.slice(0, SPX_CAP),
      ...spySyms.slice(0, SPY_CAP),
      ...qqqSyms.slice(0, QQQ_CAP)
    );
    log(`Prewarm: total ${allPrewarmSyms.length} option symbols (SPX: ${Math.min(spxSyms.length, SPX_CAP)}, SPY: ${Math.min(spySyms.length, SPY_CAP)}, QQQ: ${Math.min(qqqSyms.length, QQQ_CAP)})`);

    // Wait for dxLink to be ready, then subscribe via rate-limited queue
    const waitAndSubscribe = () => {
      if (!dxSocket || dxSocket.readyState !== WebSocket.OPEN || !dxChannelOpen) {
        setTimeout(waitAndSubscribe, 1000);
        return;
      }
      allPrewarmSyms.forEach(sym => {
        addAutoSubscription(sym, ['Greeks','Summary','Quote','Trade','TradeETH']);
        queueAutoSubscription({ type: 'Greeks',  symbol: sym });
        queueAutoSubscription({ type: 'Summary', symbol: sym });
        queueAutoSubscription({ type: 'Quote',   symbol: sym });
        queueAutoSubscription({ type: 'Trade',   symbol: sym });
        queueAutoSubscription({ type: 'TradeETH', symbol: sym });
      });
      log(`Prewarm: queued ${allPrewarmSyms.length} option symbols (${subscriptionQueue.length} total items) - sending rate-limited`);
      sendSubscriptionsRateLimited();
    };
    waitAndSubscribe();

    // Also subscribe index/futures quotes needed for topbar
    seedCoreLiveSubscriptions();
    log('Prewarm: queued index/futures symbols for topbar quotes');
  } catch(e) { log('Prewarm error:', e.message); }
}

server.listen(PORT, async () => {
  log(`Proxy running on port ${PORT}`);
  warn(`REST monitor enabled | stall=${Math.round(REST_MONITOR_STALL_MS / 1000)}s | summary=${Math.round(REST_MONITOR_SUMMARY_MS / 1000)}s | tick=${Math.round(REST_MONITOR_TICK_MS / 1000)}s`);

  // ── Init SQLite DB ───────────────────────────────────────────────────────────
  try {
    initDB();
    scheduleNightlyClear();
  } catch (e) {
    log('[DB] SQLite init failed (better-sqlite3 not installed?). Run: npm install better-sqlite3');
    log('[DB] Error:', e.message);
    // Non-fatal — proxy continues with JSON fallback
  }

  loadTokenFile();
  const ok = await refreshAccessToken();
      if (ok) {
    const dxOk = await fetchDxLinkToken();
    if (dxOk) {
      // Seed market-data prev-closes at startup so quotes-batch can avoid TT REST.
      try {
        const indices = ['SPX','VIX','NDX'];
        const futures = ['/ES','/NQ'];
        const equities = ['SPY','QQQ','SMH','AAPL','AMD','AMZN','GOOGL','META','MSFT','NVDA','TSLA','COIN','HOOD','IWM','NFLX','PLTR'];
        
        const indResp = await ttGet(`/market-data/by-type?${indices.map(s => `index[]=${encodeURIComponent(s)}`).join('&')}`);
        const indItems = indResp.data?.data?.items || indResp.data?.items || [];
        indItems.forEach(item => {
          if (item.symbol && item['prev-close']) {
            marketDataPrevCloseCache[item.symbol] = parseFloat(item['prev-close']);
          }
        });
        
        const eqResp = await ttGet(`/market-data/by-type?${equities.map(s => `equity[]=${encodeURIComponent(s)}`).join('&')}`);
        const eqItems = eqResp.data?.data?.items || eqResp.data?.items || [];
        eqItems.forEach(item => {
          if (item.symbol && item['prev-close']) {
            marketDataPrevCloseCache[item.symbol] = parseFloat(item['prev-close']);
          }
        });

        const futResp = await ttGet(`/market-data/by-type?${futures.map(s => `future[]=${encodeURIComponent(s)}`).join('&')}`);
        const futItems = futResp.data?.data?.items || futResp.data?.items || [];
        futItems.forEach(item => {
          if (item.symbol && item['prev-close']) {
            const dxKey = item.symbol.replace(/^\/([A-Z]+).*/, '/$1:XCME');
            marketDataPrevCloseCache[dxKey] = parseFloat(item['prev-close']);
            marketDataPrevCloseCache[item.symbol] = parseFloat(item['prev-close']);
          }
        });

        // Fallback: derive futures from index if TT didn't return them
        if (!marketDataPrevCloseCache['/ES:XCME'] && marketDataPrevCloseCache['SPX']) {
          marketDataPrevCloseCache['/ES:XCME'] = marketDataPrevCloseCache['SPX'];
        }
        if (!marketDataPrevCloseCache['/NQ:XCME'] && marketDataPrevCloseCache['NDX']) {
          marketDataPrevCloseCache['/NQ:XCME'] = marketDataPrevCloseCache['NDX'];
        }
        log('Seeded market-data prev-closes for', Object.keys(marketDataPrevCloseCache).length, 'symbols');
        log('DEBUG marketDataPrevCloseCache:', JSON.stringify(marketDataPrevCloseCache));
      } catch(e) {
        console.warn('[Startup] Market-data seed failed:', e.message);
      }
      await bootstrapDashboardCorePhases();
      connectDxLink();
      // EM symbol subscriptions now happen on-demand when user clicks Start
      // (subscribed via /proxy/dxlink/subscribe endpoint from estimated-moves.js)
    }
  } else {
    log('⚠ Token refresh failed — check REFRESH_TOKEN or TT_REFRESH_TOKEN');
  }
  // Auto-refresh every 90 min
  setInterval(async () => {
    if (isExpired()) {
      const ok = await refreshAccessToken();
      if (ok) { await fetchDxLinkToken(); if (!dxSocket || dxSocket.readyState !== WebSocket.OPEN) connectDxLink(); }
    }
  }, 90 * 60 * 1000);

  // ─── Auto-refresh GEX levels every 5 minutes (24/7) ─────────────────────────
  setInterval(async () => {
    try {
      const ok = await ensureToken();
      if (!ok) return;

      // Always re-subscribe to the current target expiry chain (rolls to next day after 4PM)
      if (dxSocket?.readyState === WebSocket.OPEN && dxChannelOpen) {
        const { status: sNested, data: dNested } = await ttGet('/option-chains/SPX/nested');
        const chainObjR = dNested?.data?.items?.find(c => c['root-symbol'] === 'SPXW') || dNested?.data?.items?.[0];
        const allExpDatesR = (chainObjR?.expirations || []).map(e => e['expiration-date']).filter(Boolean).sort();
        const targetExpR = getTargetExpirationDate(allExpDatesR);
        if (targetExpR) {
          const spot0 = firstFiniteNumber(gexLevelCache.spot, dxTradeCache['$SPX']?.price, dxQuoteCache['$SPX']?.last, 5800);
          const { status, data } = await ttGet(`/option-chains/SPXW?expiration-date=${targetExpR}`);
          if (status === 200 && data?.data?.items?.length) {
            const syms = pickNearestOptionStreamerSymbols(data.data.items, spot0, 200);
            syms.forEach(sym => {
              queueAutoSubscription({ type: 'Greeks',  symbol: sym });
              queueAutoSubscription({ type: 'Summary', symbol: sym });
            });
            await sendSubscriptionsRateLimited();
            await sleep(2000); // let Greeks populate
          }
        }
      }

      // Compute and cache GEX levels (uses dxGreeksCache populated above)
      const [spot, basis] = await Promise.all([
        fetchUnderlyingLast('SPX').catch(() => firstFiniteNumber(gexLevelCache.spot, 0)),
        fetchEsBasis().catch(() => esBasisCache.basis)
      ]);
      if (spot > 0) computeAndCacheGexLevels(spot, basis);
      log('Auto GEX refresh complete. Spot:', spot || '(off-hours, skipping computeAndCache)');
    } catch(e) {
      log('Auto GEX refresh error:', e.message);
    }
  }, 5 * 60 * 1000);

  // ─── Intraday Greeks snapshot every 30 seconds ──────────────────────────────
  setInterval(() => {
    emitRestMonitorSummary();
    checkRestMonitorStalls();
  }, REST_MONITOR_TICK_MS);

  loadIntradayHistory();
  setInterval(() => {
    try {
      const now = new Date();
      // Use Intl for correct ET offset (handles EDT/EST automatically)
      const etParts = new Intl.DateTimeFormat('en-US', {
        timeZone: 'America/New_York',
        weekday: 'short', hour: 'numeric', minute: 'numeric', hour12: false
      }).formatToParts(now);
      const etMap = Object.fromEntries(etParts.filter(p => p.type !== 'literal').map(p => [p.type, p.value]));
      const etWeekday = etMap.weekday; // 'Sun','Mon',...
      if (etWeekday === 'Sun' || etWeekday === 'Sat') return;
      const etHour = parseInt(etMap.hour, 10);
      const etMin  = parseInt(etMap.minute, 10);
      const etTime = etHour * 60 + etMin;
      if (etTime < 9 * 60 || etTime > 16 * 60) return;

      const spot = firstFiniteNumber(
        dxTradeCache['SPX']?.price,
        dxTradeCache['/ESU6']?.price,
        gexLevelCache.spot, 0
      );
      if (!(spot > 0)) return;

      // Clear history if new day
      const today = now.toISOString().split('T')[0];
      if (lastIntradayDate !== today) {
        intradayGreeksHistory = [];
        lastIntradayDate = today;
      }

      const snapshot = computeIntradaySnapshot(spot);

      // Keep in-memory ring buffer (fallback / WS history on connect)
      intradayGreeksHistory.push(snapshot);
      if (intradayGreeksHistory.length > 800) intradayGreeksHistory.shift();

      // Persist to SQLite (primary) + JSON file (legacy fallback)
      dbInsertGreeks(snapshot);
      if (intradayGreeksHistory.length % 5 === 0) saveIntradayHistory();

      // Broadcast to all connected browser clients
      broadcast({ type: 'GREEKS_INTRADAY', data: snapshot });

    } catch(e) {
      log('Intraday snapshot error:', e.message);
    }
  }, 30 * 1000);
});
