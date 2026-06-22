// Server-side only — do NOT import from client components
// Uses pg (PostgreSQL) — connects via DATABASE_URL

import { Pool } from "pg";

let _pool: Pool | null = null;
let _tablesEnsured = false;

export function getPool(): Pool {
  if (!_pool) {
    _pool = new Pool({
      connectionString: process.env.DATABASE_URL,
      ssl: process.env.DATABASE_URL?.includes("localhost") || process.env.DATABASE_URL?.includes("127.0.0.1")
        ? undefined
        : { rejectUnauthorized: false },
      max: 5,                   // cap per-instance conns (Render Postgres is connection-limited)
      idleTimeoutMillis: 30000, // hold idle conns 30s, not pg's 10s default → less connect churn
      keepAlive: true,          // TCP keepalive so dead idle sockets surface fast and reconnect
    });
    // An idle client losing its connection (e.g. Postgres restart / recovery)
    // emits 'error' on the pool. Without a listener, pg escalates it to an
    // uncaughtException that can kill the process. Log + swallow; the pool
    // discards the dead client and the next query opens a fresh one.
    _pool.on("error", (err) => {
      console.warn("[db] idle pool client error (will reconnect):", err.message);
    });
  }
  return _pool;
}

export async function getDb(): Promise<Pool> {
  const pool = getPool();
  if (!_tablesEnsured) {
    _tablesEnsured = true;
    await ensureAllTables(pool);
  }
  return pool;
}

async function ensureAllTables(pool: Pool): Promise<void> {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS flow_calls (
      id SERIAL PRIMARY KEY, ts BIGINT NOT NULL, date TEXT NOT NULL,
      source TEXT NOT NULL, symbol TEXT NOT NULL, underlying TEXT, expiration TEXT,
      strike REAL, option_type TEXT, side TEXT, action TEXT, price REAL,
      size INTEGER, premium REAL, is_otm INTEGER DEFAULT 0
    );
    CREATE INDEX IF NOT EXISTS idx_flow_calls_date ON flow_calls(date);
    CREATE INDEX IF NOT EXISTS idx_flow_calls_ts ON flow_calls(ts);

    CREATE TABLE IF NOT EXISTS mvc_snapshots (
      id SERIAL PRIMARY KEY, timestamp BIGINT NOT NULL, date TEXT NOT NULL,
      day TEXT, time TEXT, "strikeOIVol" REAL, "mvcValueOIVol" REAL, "pctOI_Vol" REAL,
      "volumeOIVol" REAL, "totalNetGEX_OI" REAL, "strikeVolOnly" REAL, "mvcValueVolOnly" REAL,
      "pctVol_Only" REAL, "volumeVolOnly" REAL, "totalNetGEX_Vol" REAL, "spxPrice" REAL,
      "esPrice" REAL, "netDEXStrike" REAL, "totalNetDEX_OI" REAL, "totalNetDEX_Vol" REAL,
      "totalAbsNetGEX" REAL, "gexFlip" REAL, "triggerType" TEXT, expiration TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_mvc_date ON mvc_snapshots(date);
    CREATE INDEX IF NOT EXISTS idx_mvc_ts ON mvc_snapshots(timestamp);

    CREATE TABLE IF NOT EXISTS premium_flow (
      id SERIAL PRIMARY KEY, timestamp BIGINT NOT NULL, date TEXT NOT NULL,
      time TEXT, "callPremium" REAL, "putPremium" REAL, "netPremium" REAL, "spxPrice" REAL
    );
    CREATE INDEX IF NOT EXISTS idx_pf_date ON premium_flow(date);
    CREATE INDEX IF NOT EXISTS idx_pf_ts ON premium_flow(timestamp);

    CREATE TABLE IF NOT EXISTS greeks_ts (
      id SERIAL PRIMARY KEY, timestamp BIGINT NOT NULL, date TEXT NOT NULL,
      time TEXT, ticker TEXT, price REAL, "gexRaw" REAL, "dexRaw" REAL, "chexRaw" REAL, "vexRaw" REAL,
      gex REAL, dex REAL, chex REAL, vex REAL, "buyScore" REAL, "sellScore" REAL
    );
    CREATE INDEX IF NOT EXISTS idx_gts_date ON greeks_ts(date);
    CREATE INDEX IF NOT EXISTS idx_gts_ts ON greeks_ts(timestamp);

    CREATE TABLE IF NOT EXISTS playbook_feed (
      id SERIAL PRIMARY KEY, timestamp BIGINT NOT NULL, date TEXT NOT NULL,
      time TEXT, text TEXT NOT NULL, color TEXT, source TEXT DEFAULT 'insights-exposure',
      expiry TEXT, regime_key TEXT, spot REAL, gex REAL, dex REAL, chex REAL, vex REAL
    );
    CREATE INDEX IF NOT EXISTS idx_playbook_date ON playbook_feed(date);
    CREATE INDEX IF NOT EXISTS idx_playbook_ts ON playbook_feed(timestamp);

    CREATE TABLE IF NOT EXISTS es_candles (
      id SERIAL PRIMARY KEY, timestamp BIGINT NOT NULL, date TEXT NOT NULL,
      "slotKey" TEXT NOT NULL UNIQUE, time TEXT, symbol TEXT, "intervalMinutes" INTEGER,
      source TEXT, open REAL, high REAL, low REAL, close REAL, volume REAL, "avgVolume" REAL
    );
    CREATE INDEX IF NOT EXISTS idx_ec_date ON es_candles(date);
    CREATE INDEX IF NOT EXISTS idx_ec_slot ON es_candles("slotKey");

    CREATE TABLE IF NOT EXISTS es_footprint (
      day TEXT PRIMARY KEY, symbol TEXT, updated_at BIGINT NOT NULL, payload JSONB NOT NULL
    );

    CREATE TABLE IF NOT EXISTS ib_levels (
      id SERIAL PRIMARY KEY, date TEXT NOT NULL UNIQUE, symbol TEXT DEFAULT '/ES',
      timestamp BIGINT NOT NULL, locked INTEGER DEFAULT 0,
      high REAL, low REAL, mid REAL, range REAL, "rangePct" REAL,
      "openPrice" REAL, "lowFirst" INTEGER, "barCount" INTEGER
    );
    CREATE INDEX IF NOT EXISTS idx_ib_date ON ib_levels(date);

    CREATE TABLE IF NOT EXISTS bzila_snapshots (
      id SERIAL PRIMARY KEY, timestamp BIGINT NOT NULL, date TEXT NOT NULL,
      time TEXT, ticker TEXT, session TEXT DEFAULT 'rth', orders TEXT, stats TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_bs_date ON bzila_snapshots(date);
    CREATE INDEX IF NOT EXISTS idx_bs_ts ON bzila_snapshots(timestamp);

    CREATE TABLE IF NOT EXISTS option_strike_gex_history (
      id SERIAL PRIMARY KEY, timestamp BIGINT NOT NULL, date TEXT NOT NULL,
      expiry TEXT NOT NULL, spot REAL, strike REAL NOT NULL, net_gex REAL NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_osgh_date ON option_strike_gex_history(date);
    CREATE INDEX IF NOT EXISTS idx_osgh_expiry ON option_strike_gex_history(expiry);
    CREATE INDEX IF NOT EXISTS idx_osgh_ts ON option_strike_gex_history(timestamp);

    CREATE TABLE IF NOT EXISTS trades (
      id SERIAL PRIMARY KEY, timestamp TEXT NOT NULL,
      symbol TEXT, side TEXT, qty REAL, price REAL, data TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_trades_ts ON trades(timestamp);

    CREATE TABLE IF NOT EXISTS expirations_cache (
      id SERIAL PRIMARY KEY, ticker TEXT NOT NULL UNIQUE,
      timestamp BIGINT NOT NULL, expirations TEXT, raw TEXT
    );

    CREATE TABLE IF NOT EXISTS snapshots (
      id SERIAL PRIMARY KEY, timestamp BIGINT NOT NULL, date TEXT NOT NULL,
      time TEXT NOT NULL, period TEXT NOT NULL DEFAULT 'weekly', "tableHtml" TEXT NOT NULL,
      expirations TEXT, created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS es_stats (
      id SERIAL PRIMARY KEY, expiration TEXT NOT NULL UNIQUE,
      no_long TEXT, up TEXT, mid TEXT, down TEXT, no_short TEXT,
      updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS page_load_status (
      id SERIAL PRIMARY KEY,
      page_key TEXT NOT NULL UNIQUE,
      page_label TEXT,
      path TEXT,
      is_loaded BOOLEAN NOT NULL DEFAULT FALSE,
      last_loaded_at TIMESTAMPTZ,
      last_unloaded_at TIMESTAMPTZ,
      updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
    );
    CREATE INDEX IF NOT EXISTS idx_page_load_status_loaded ON page_load_status(is_loaded);
    CREATE INDEX IF NOT EXISTS idx_page_load_status_updated ON page_load_status(updated_at);

    CREATE TABLE IF NOT EXISTS budget_profiles (
      id SERIAL PRIMARY KEY,
      name TEXT NOT NULL UNIQUE,
      currency TEXT NOT NULL DEFAULT 'USD',
      created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS budget_categories (
      id SERIAL PRIMARY KEY,
      profile_id INTEGER NOT NULL REFERENCES budget_profiles(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      amount REAL NOT NULL DEFAULT 0,
      period TEXT NOT NULL DEFAULT 'monthly',
      color TEXT,
      created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(profile_id, name)
    );
    CREATE INDEX IF NOT EXISTS idx_budget_categories_profile ON budget_categories(profile_id);

    CREATE TABLE IF NOT EXISTS budget_entries (
      id SERIAL PRIMARY KEY,
      profile_id INTEGER NOT NULL REFERENCES budget_profiles(id) ON DELETE CASCADE,
      category_id INTEGER REFERENCES budget_categories(id) ON DELETE SET NULL,
      type TEXT NOT NULL,
      amount REAL NOT NULL,
      title TEXT NOT NULL,
      notes TEXT,
      occurred_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
      created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
    );
    CREATE INDEX IF NOT EXISTS idx_budget_entries_profile ON budget_entries(profile_id);
    CREATE INDEX IF NOT EXISTS idx_budget_entries_occurred ON budget_entries(occurred_at);

    CREATE TABLE IF NOT EXISTS waitlist (
      id SERIAL PRIMARY KEY,
      email TEXT NOT NULL UNIQUE,
      source TEXT DEFAULT 'landing',
      referrer TEXT,
      user_agent TEXT,
      created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
    );
    CREATE INDEX IF NOT EXISTS idx_waitlist_created ON waitlist(created_at);

    -- Per-ticker weekly Estimated Move tracking. One row per (ticker, week).
    -- week_label is the human label that matches the EstimatedMoves columns
    -- (e.g. "10/3"); week_start is the Monday ISO date for ordering. em is the
    -- expected move (dollars for equities/$ index points, index points for SPX
    -- etc). ref_close is the reference close the band is centered on. The OHLC
    -- columns are the realized weekly candle; result is auto-computed:
    --   'hit'  = OHLC stayed inside the band  (win)
    --   'miss' = high or low broke the band   (loss)
    --   NULL   = not yet evaluated (week not closed / no OHLC)
    CREATE TABLE IF NOT EXISTS em_tracker (
      id SERIAL PRIMARY KEY,
      ticker TEXT NOT NULL,
      week_label TEXT NOT NULL,
      week_start DATE,
      em REAL NOT NULL,
      ref_close REAL,
      up REAL,
      down REAL,
      o REAL, h REAL, l REAL, c REAL,
      result TEXT,          -- 'hit' | 'miss' | NULL  (close inside band = hit)
      breach INTEGER,       -- 1 = high/low poked outside band intraweek, 0 = no, NULL = unknown
      result_source TEXT,   -- 'auto' | 'manual' | 'import'
      note TEXT,
      created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
    );
    CREATE INDEX IF NOT EXISTS idx_em_tracker_ticker ON em_tracker(ticker);
    CREATE INDEX IF NOT EXISTS idx_em_tracker_week ON em_tracker(week_start);

    -- Migration: add breach column to pre-existing em_tracker tables.
    ALTER TABLE em_tracker ADD COLUMN IF NOT EXISTS breach INTEGER;

    -- Uniqueness is per (ticker, week_start): week_label like "5/1" repeats every
    -- year, so 2 years of history would collide on (ticker, week_label). Keying on
    -- the Monday ISO date keeps each calendar week distinct. Drop the old label
    -- constraint if present, add the date-based one.
    ALTER TABLE em_tracker DROP CONSTRAINT IF EXISTS em_tracker_ticker_week_label_key;
    CREATE UNIQUE INDEX IF NOT EXISTS uq_em_tracker_ticker_week_start
      ON em_tracker(ticker, week_start);

    -- EOD GEX snapshot: one row per (date, symbol), upserted at 3:55–4:05 ET.
    -- total_gex  signed net GEX (same value as the dashboard header)
    -- spot       underlying price at compute time
    -- computed_at ISO timestamp of the actual computation
    CREATE TABLE IF NOT EXISTS eod_gex (
      id          SERIAL PRIMARY KEY,
      date        TEXT NOT NULL,
      symbol      TEXT NOT NULL,
      total_gex   DOUBLE PRECISION NOT NULL,
      spot        DOUBLE PRECISION NOT NULL,
      computed_at TEXT NOT NULL,
      UNIQUE (date, symbol)
    );
    CREATE INDEX IF NOT EXISTS idx_eod_gex_date ON eod_gex(date);
    CREATE INDEX IF NOT EXISTS idx_eod_gex_symbol ON eod_gex(symbol);
  `);
}

// ── EM Tracker (per-ticker weekly Estimated Move hit/miss record) ───────────

export interface EmTrackerRow {
  id?: number;
  ticker: string;
  week_label: string;
  week_start?: string | null;
  em: number;
  ref_close?: number | null;
  up?: number | null;
  down?: number | null;
  o?: number | null;
  h?: number | null;
  l?: number | null;
  c?: number | null;
  result?: "hit" | "miss" | null;
  breach?: number | null;
  result_source?: "auto" | "manual" | "import" | "seed" | null;
  note?: string | null;
  created_at?: string | null;
  updated_at?: string | null;
}

/** Insert or update one weekly EM row, keyed on (ticker, week_start).
 *  Requires week_start (the Monday ISO date) so 2+ years of weeks stay distinct.
 *  NULL incoming values never overwrite an existing non-null value. */
export async function upsertEmTrackerRow(r: EmTrackerRow): Promise<void> {
  const pool = await getDb();
  await pool.query(
    `INSERT INTO em_tracker
       (ticker, week_label, week_start, em, ref_close, up, down, o, h, l, c, result, breach, result_source, note)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)
     ON CONFLICT(ticker, week_start) DO UPDATE SET
       week_label    = COALESCE(EXCLUDED.week_label,    em_tracker.week_label),
       em            = COALESCE(EXCLUDED.em,            em_tracker.em),
       ref_close     = COALESCE(EXCLUDED.ref_close,     em_tracker.ref_close),
       up            = COALESCE(EXCLUDED.up,            em_tracker.up),
       down          = COALESCE(EXCLUDED.down,          em_tracker.down),
       o             = COALESCE(EXCLUDED.o,             em_tracker.o),
       h             = COALESCE(EXCLUDED.h,             em_tracker.h),
       l             = COALESCE(EXCLUDED.l,             em_tracker.l),
       c             = COALESCE(EXCLUDED.c,             em_tracker.c),
       result        = COALESCE(EXCLUDED.result,        em_tracker.result),
       breach        = COALESCE(EXCLUDED.breach,        em_tracker.breach),
       result_source = COALESCE(EXCLUDED.result_source, em_tracker.result_source),
       note          = COALESCE(EXCLUDED.note,          em_tracker.note),
       updated_at    = CURRENT_TIMESTAMP`,
    [
      r.ticker.toUpperCase(), r.week_label, r.week_start ?? null, r.em, r.ref_close ?? null,
      r.up ?? null, r.down ?? null, r.o ?? null, r.h ?? null, r.l ?? null, r.c ?? null,
      r.result ?? null, r.breach ?? null, r.result_source ?? null, r.note ?? null,
    ]
  );
}

/** Fill realized weekly OHLC onto an EXISTING (ticker, week_label) row without
 *  touching the EM band. No-op if the row doesn't exist (never inserts an
 *  em-less row, which would violate the NOT NULL constraint). */
export async function updateEmTrackerOhlc(
  ticker: string, week_label: string,
  ohlc: { o?: number | null; h?: number | null; l?: number | null; c?: number | null }
): Promise<void> {
  const pool = await getDb();
  await pool.query(
    `UPDATE em_tracker SET
       o = COALESCE($3, o), h = COALESCE($4, h), l = COALESCE($5, l), c = COALESCE($6, c),
       updated_at = CURRENT_TIMESTAMP
     WHERE ticker = $1 AND week_label = $2`,
    [ticker.toUpperCase(), week_label, ohlc.o ?? null, ohlc.h ?? null, ohlc.l ?? null, ohlc.c ?? null]
  );
}

/** All weekly rows, newest week first (then ticker). */
export async function getEmTrackerRows(ticker?: string): Promise<EmTrackerRow[]> {
  if (ticker) {
    return queryAll<EmTrackerRow>(
      `SELECT * FROM em_tracker WHERE ticker = ? ORDER BY week_start DESC NULLS LAST, week_label DESC`,
      [ticker.toUpperCase()]
    );
  }
  return queryAll<EmTrackerRow>(
    `SELECT * FROM em_tracker ORDER BY week_start DESC NULLS LAST, ticker ASC`
  );
}

/** Rows seeded for a given week that still need a result (band present, no
 *  result yet). Used by the Saturday evaluator. */
export async function getEmTrackerPendingForWeek(week_start: string): Promise<EmTrackerRow[]> {
  return queryAll<EmTrackerRow>(
    `SELECT * FROM em_tracker
      WHERE week_start = ? AND result IS NULL AND em IS NOT NULL
      ORDER BY ticker ASC`,
    [week_start]
  );
}

/** Per-ticker hit-rate summary: hits, evaluated weeks, total weeks, latest EM. */
export interface EmTrackerSummary {
  ticker: string;
  hits: number;
  misses: number;
  evaluated: number;   // hits + misses
  total: number;       // all weeks with an EM on record
  hit_rate: number | null; // hits / evaluated, 0..1
  latest_em: number | null;
  latest_week: string | null;
}

export async function getEmTrackerSummary(): Promise<EmTrackerSummary[]> {
  const pool = await getDb();
  const result = await pool.query(`
    SELECT
      ticker,
      COUNT(*) FILTER (WHERE result = 'hit')::int  AS hits,
      COUNT(*) FILTER (WHERE result = 'miss')::int AS misses,
      COUNT(*) FILTER (WHERE result IN ('hit','miss'))::int AS evaluated,
      COUNT(*)::int AS total,
      (SELECT em FROM em_tracker e2
         WHERE e2.ticker = e.ticker
         ORDER BY week_start DESC NULLS LAST, week_label DESC LIMIT 1) AS latest_em,
      (SELECT week_label FROM em_tracker e3
         WHERE e3.ticker = e.ticker
         ORDER BY week_start DESC NULLS LAST, week_label DESC LIMIT 1) AS latest_week
    FROM em_tracker e
    GROUP BY ticker
    ORDER BY ticker ASC
  `);
  return result.rows.map((r) => ({
    ticker: r.ticker,
    hits: Number(r.hits ?? 0),
    misses: Number(r.misses ?? 0),
    evaluated: Number(r.evaluated ?? 0),
    total: Number(r.total ?? 0),
    hit_rate: Number(r.evaluated) > 0 ? Number(r.hits) / Number(r.evaluated) : null,
    latest_em: r.latest_em != null ? Number(r.latest_em) : null,
    latest_week: r.latest_week ?? null,
  }));
}

/** Rows that have an EM + reference close + realized OHLC but no result yet —
 *  the candidates for auto-evaluation. */
export async function getEmTrackerUnevaluated(): Promise<EmTrackerRow[]> {
  return queryAll<EmTrackerRow>(
    `SELECT * FROM em_tracker
      WHERE result IS NULL AND em IS NOT NULL AND ref_close IS NOT NULL
        AND h IS NOT NULL AND l IS NOT NULL
      ORDER BY week_start ASC NULLS LAST, ticker ASC`
  );
}

/** Set the computed result for one row. */
export async function setEmTrackerResult(
  id: number, result: "hit" | "miss", source: "auto" | "manual" = "auto"
): Promise<void> {
  const pool = await getDb();
  await pool.query(
    `UPDATE em_tracker SET result = $2, result_source = $3, updated_at = CURRENT_TIMESTAMP WHERE id = $1`,
    [id, result, source]
  );
}

export async function deleteEmTrackerRow(id: number): Promise<void> {
  const pool = await getDb();
  await pool.query(`DELETE FROM em_tracker WHERE id = $1`, [id]);
}

/** Wipe going-forward em_tracker rows. Optionally only those from a given
 *  result_source (e.g. 'import' to undo a bad import without losing manual/auto
 *  weeks). Returns number of rows removed. The verified 31-week history lives in
 *  data/em-tracker-history.json and is NOT affected. */
export async function clearEmTracker(source?: string): Promise<number> {
  const pool = await getDb();
  const res = source
    ? await pool.query(`DELETE FROM em_tracker WHERE result_source = $1`, [source])
    : await pool.query(`DELETE FROM em_tracker`);
  return res.rowCount ?? 0;
}

// ── Waitlist (launch email capture) ────────────────────────────────────────

export interface WaitlistRecord {
  id?: number;
  email: string;
  source?: string | null;
  referrer?: string | null;
  user_agent?: string | null;
  created_at?: string | null;
}

/** Insert an email; returns true if newly added, false if it already existed. */
export async function addWaitlistEmail(input: {
  email: string;
  source?: string | null;
  referrer?: string | null;
  user_agent?: string | null;
}): Promise<{ added: boolean }> {
  const pool = await getDb();
  const result = await pool.query(
    `INSERT INTO waitlist (email, source, referrer, user_agent)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (email) DO NOTHING
     RETURNING id`,
    [input.email, input.source ?? "landing", input.referrer ?? null, input.user_agent ?? null]
  );
  return { added: (result.rowCount ?? 0) > 0 };
}

export async function listWaitlist(limit = 1000): Promise<WaitlistRecord[]> {
  return queryAll<WaitlistRecord>(
    "SELECT * FROM waitlist ORDER BY created_at DESC LIMIT ?",
    [limit]
  );
}

export async function countWaitlist(): Promise<number> {
  const row = await queryOne<{ n: number }>("SELECT COUNT(*)::int AS n FROM waitlist", []);
  return Number(row?.n ?? 0);
}

/** No-op: pg writes are immediate, no file persistence needed */
export function persistDb(): void {}

// ── Query helpers ─────────────────────────────────────────────────────────────

export async function queryAll<T = Record<string, unknown>>(
  sql: string,
  params: unknown[] = []
): Promise<T[]> {
  const pool = await getDb();
  // Convert ? placeholders to $1, $2, ...
  let i = 0;
  const pgSql = sql.replace(/\?/g, () => `$${++i}`);
  const result = await pool.query(pgSql, params);
  return result.rows as T[];
}

export async function queryOne<T = Record<string, unknown>>(
  sql: string,
  params: unknown[] = []
): Promise<T | undefined> {
  const rows = await queryAll<T>(sql, params);
  return rows[0];
}

// ── Common queries ────────────────────────────────────────────────────────────

export interface TradeRecord {
  id: number;
  timestamp: string;
  symbol: string;
  side: string;
  quantity: number;
  price: number;
  premium: number;
  expiration: string;
  strike: number;
  option_type: string;
}

export async function getRecentTrades(limit = 100): Promise<TradeRecord[]> {
  return queryAll<TradeRecord>(
    "SELECT * FROM trades ORDER BY timestamp DESC LIMIT ?",
    [limit]
  );
}

export async function getTradesByDate(date: string): Promise<TradeRecord[]> {
  return queryAll<TradeRecord>(
    "SELECT * FROM trades WHERE date(timestamp) = ? ORDER BY timestamp DESC",
    [date]
  );
}

// ── Snapshots (for estimated moves) ────────────────────────────────────────

export interface Snapshot {
  id?: number;
  timestamp: number;
  date: string;
  time: string;
  period: string;
  tableHtml: string;
  expirations: string[];
  created_at?: string;
}

export async function saveSnapshot(snap: Snapshot): Promise<Snapshot> {
  const pool = await getDb();
  await pool.query(
    `INSERT INTO snapshots (timestamp, date, time, period, "tableHtml", expirations)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [snap.timestamp, snap.date, snap.time, snap.period, snap.tableHtml, JSON.stringify(snap.expirations || [])]
  );
  return snap;
}

export async function getSnapshots(period?: string): Promise<Snapshot[]> {
  let sql = `SELECT * FROM snapshots`;
  const params: unknown[] = [];
  if (period) {
    sql += " WHERE period = ?";
    params.push(period);
  }
  sql += " ORDER BY id DESC";
  const snapshots = await queryAll<any>(sql, params);
  return snapshots.map((s: any) => ({
    ...s,
    expirations: typeof s.expirations === 'string' ? JSON.parse(s.expirations) : s.expirations
  }));
}

export async function deleteSnapshot(id: number): Promise<boolean> {
  await queryAll("DELETE FROM snapshots WHERE id = ?", [id]);
  return true;
}

// ── Flow Calls ─────────────────────────────────────────────────────────────────

export interface FlowCallRecord {
  id?: number;
  ts: number;
  date: string;
  source: "tape" | "rest";
  symbol: string;
  underlying?: string;
  expiration?: string;
  strike: number;
  option_type: string;
  side: string;
  action: string;
  price: number;
  size: number;
  premium: number;
  is_otm: number;
}

export async function ensureFlowCallsTable(): Promise<void> { /* handled in ensureAllTables */ }

export async function insertFlowCalls(calls: Omit<FlowCallRecord, "id">[]): Promise<void> {
  if (!calls.length) return;
  const pool = await getDb();
  for (const c of calls) {
    await pool.query(
      `INSERT INTO flow_calls (ts, date, source, symbol, underlying, expiration, strike, option_type, side, action, price, size, premium, is_otm)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)`,
      [c.ts, c.date, c.source, c.symbol, c.underlying ?? null, c.expiration ?? null,
       c.strike, c.option_type, c.side, c.action, c.price, c.size, c.premium, c.is_otm]
    );
  }
}

export async function getFlowCalls(date: string, limit = 500): Promise<FlowCallRecord[]> {
  return queryAll<FlowCallRecord>(
    "SELECT * FROM flow_calls WHERE date = ? ORDER BY ts DESC LIMIT ?",
    [date, limit]
  );
}

// ── MVC Snapshots ─────────────────────────────────────────────────────────────

export interface MvcRecord {
  id?: number;
  timestamp: number;
  date: string;
  day: string;
  time: string;
  strikeOIVol: number | null;
  mvcValueOIVol: number;
  pctOI_Vol: number | null;
  volumeOIVol: number;
  totalNetGEX_OI: number;
  strikeVolOnly: number | null;
  mvcValueVolOnly: number;
  pctVol_Only: number | null;
  volumeVolOnly: number;
  totalNetGEX_Vol: number;
  spxPrice: number;
  esPrice: number;
  netDEXStrike: number | null;
  totalNetDEX_OI: number | null;
  totalNetDEX_Vol: number | null;
  totalAbsNetGEX: number;
  gexFlip: number | null;
  triggerType: string;
  expiration: string;
}

export async function ensureMvcTable(): Promise<void> { /* handled in ensureAllTables */ }

export async function insertMvcSnapshot(r: Omit<MvcRecord, "id">): Promise<number> {
  const pool = await getDb();
  const result = await pool.query(
    `INSERT INTO mvc_snapshots (timestamp,date,day,time,"strikeOIVol","mvcValueOIVol","pctOI_Vol","volumeOIVol",
      "totalNetGEX_OI","strikeVolOnly","mvcValueVolOnly","pctVol_Only","volumeVolOnly","totalNetGEX_Vol",
      "spxPrice","esPrice","netDEXStrike","totalNetDEX_OI","totalNetDEX_Vol","totalAbsNetGEX","gexFlip","triggerType",expiration)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23) RETURNING id`,
    [r.timestamp, r.date, r.day, r.time, r.strikeOIVol ?? null, r.mvcValueOIVol, r.pctOI_Vol ?? null,
     r.volumeOIVol, r.totalNetGEX_OI, r.strikeVolOnly ?? null, r.mvcValueVolOnly, r.pctVol_Only ?? null,
     r.volumeVolOnly, r.totalNetGEX_Vol, r.spxPrice, r.esPrice, r.netDEXStrike ?? null,
     r.totalNetDEX_OI ?? null, r.totalNetDEX_Vol ?? null, r.totalAbsNetGEX, r.gexFlip ?? null,
     r.triggerType, r.expiration]
  );
  return Number(result.rows[0]?.id ?? 0);
}

export async function getMvcSnapshots(date?: string, limit = 200): Promise<MvcRecord[]> {
  if (date) {
    return queryAll<MvcRecord>(
      "SELECT * FROM mvc_snapshots WHERE date = ? ORDER BY timestamp DESC LIMIT ?",
      [date, limit]
    );
  }
  return queryAll<MvcRecord>(
    "SELECT * FROM mvc_snapshots ORDER BY timestamp DESC LIMIT ?",
    [limit]
  );
}

// ── Premium Flow ──────────────────────────────────────────────────────────────

export interface PremiumFlowRecord {
  id?: number;
  timestamp: number;
  date: string;
  time: string;
  callPremium: number;
  putPremium: number;
  netPremium: number;
  spxPrice: number;
}

export async function ensurePremiumFlowTable(): Promise<void> { /* handled in ensureAllTables */ }

export async function insertPremiumFlow(r: Omit<PremiumFlowRecord, "id">): Promise<void> {
  const pool = await getDb();
  await pool.query(
    `INSERT INTO premium_flow (timestamp,date,time,"callPremium","putPremium","netPremium","spxPrice")
     VALUES ($1,$2,$3,$4,$5,$6,$7)`,
    [r.timestamp, r.date, r.time, r.callPremium, r.putPremium, r.netPremium, r.spxPrice]
  );
}

export async function getPremiumFlow(date?: string, limit = 500): Promise<PremiumFlowRecord[]> {
  if (date) {
    return queryAll<PremiumFlowRecord>(
      "SELECT * FROM premium_flow WHERE date = ? ORDER BY timestamp ASC LIMIT ?",
      [date, limit]
    );
  }
  return queryAll<PremiumFlowRecord>(
    "SELECT * FROM premium_flow ORDER BY timestamp DESC LIMIT ?",
    [limit]
  );
}

// ── Greeks Time Series ────────────────────────────────────────────────────────

export interface GreeksTsRecord {
  id?: number;
  timestamp: number;
  date: string;
  time: string;
  ticker: string;
  price: number;
  gexRaw: number;
  dexRaw: number;
  chexRaw: number;
  vexRaw: number;
  gex: number;
  dex: number;
  chex: number;
  vex: number;
  buyScore: number;
  sellScore: number;
}

export async function ensureGreeksTsTable(): Promise<void> { /* handled in ensureAllTables */ }

export async function insertGreeksTs(r: Omit<GreeksTsRecord, "id">): Promise<void> {
  const pool = await getDb();
  await pool.query(
    `INSERT INTO greeks_ts (timestamp,date,time,ticker,price,"gexRaw","dexRaw","chexRaw","vexRaw",gex,dex,chex,vex,"buyScore","sellScore")
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)`,
    [r.timestamp, r.date, r.time, r.ticker, r.price,
     r.gexRaw, r.dexRaw, r.chexRaw, r.vexRaw,
     r.gex, r.dex, r.chex, r.vex, r.buyScore, r.sellScore]
  );
}

export async function getGreeksTs(date?: string, limit = 1000): Promise<GreeksTsRecord[]> {
  if (date) {
    return queryAll<GreeksTsRecord>(
      "SELECT * FROM greeks_ts WHERE date = ? ORDER BY timestamp ASC LIMIT ?",
      [date, limit]
    );
  }
  return queryAll<GreeksTsRecord>(
    "SELECT * FROM greeks_ts ORDER BY timestamp DESC LIMIT ?",
    [limit]
  );
}

// —— Playbook Feed ————————————————————————————————————————————————————————————————

export interface PlaybookFeedRecord {
  id?: number;
  timestamp: number;
  date: string;
  time: string;
  text: string;
  color?: string | null;
  source?: string | null;
  expiry?: string | null;
  regime_key?: string | null;
  spot?: number | null;
  gex?: number | null;
  dex?: number | null;
  chex?: number | null;
  vex?: number | null;
}

export async function insertPlaybookFeed(r: Omit<PlaybookFeedRecord, "id">): Promise<number> {
  const pool = await getDb();
  const result = await pool.query(
    `INSERT INTO playbook_feed (timestamp,date,time,text,color,source,expiry,regime_key,spot,gex,dex,chex,vex)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
     RETURNING id`,
    [
      r.timestamp,
      r.date,
      r.time,
      r.text,
      r.color ?? null,
      r.source ?? "insights-exposure",
      r.expiry ?? null,
      r.regime_key ?? null,
      r.spot ?? null,
      r.gex ?? null,
      r.dex ?? null,
      r.chex ?? null,
      r.vex ?? null,
    ]
  );
  return Number(result.rows[0]?.id ?? 0);
}

export async function getPlaybookFeed(date?: string, limit = 500): Promise<PlaybookFeedRecord[]> {
  if (date) {
    return queryAll<PlaybookFeedRecord>(
      "SELECT * FROM playbook_feed WHERE date = ? ORDER BY timestamp DESC LIMIT ?",
      [date, limit]
    );
  }
  return queryAll<PlaybookFeedRecord>(
    "SELECT * FROM playbook_feed ORDER BY timestamp DESC LIMIT ?",
    [limit]
  );
}

// ── Page load status ─────────────────────────────────────────────────────────

export interface PageLoadStatusRecord {
  id?: number;
  page_key: string;
  page_label?: string | null;
  path?: string | null;
  is_loaded: boolean;
  last_loaded_at?: string | null;
  last_unloaded_at?: string | null;
  updated_at?: string | null;
}

export async function upsertPageLoadStatus(r: Omit<PageLoadStatusRecord, "id" | "updated_at">): Promise<void> {
  const pool = await getDb();
  await pool.query(
    `INSERT INTO page_load_status (page_key, page_label, path, is_loaded, last_loaded_at, last_unloaded_at)
     VALUES ($1, $2, $3, $4, $5, $6)
     ON CONFLICT (page_key) DO UPDATE
       SET page_label = EXCLUDED.page_label,
           path = EXCLUDED.path,
           is_loaded = EXCLUDED.is_loaded,
           last_loaded_at = COALESCE(EXCLUDED.last_loaded_at, page_load_status.last_loaded_at),
           last_unloaded_at = COALESCE(EXCLUDED.last_unloaded_at, page_load_status.last_unloaded_at),
           updated_at = CURRENT_TIMESTAMP`,
    [
      r.page_key,
      r.page_label ?? null,
      r.path ?? null,
      r.is_loaded,
      r.last_loaded_at ?? null,
      r.last_unloaded_at ?? null,
    ]
  );
}

export async function getPageLoadStatus(limit = 200): Promise<PageLoadStatusRecord[]> {
  return queryAll<PageLoadStatusRecord>(
    "SELECT * FROM page_load_status ORDER BY updated_at DESC NULLS LAST, id DESC LIMIT ?",
    [limit]
  );
}

// ── ES Candles ────────────────────────────────────────────────────────────────

export interface EsCandleDbRecord {
  id?: number;
  timestamp: number;
  date: string;
  slotKey: string;
  time: string;
  symbol: string;
  intervalMinutes: number;
  source: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  avgVolume: number;
}

export async function ensureEsCandlesTable(): Promise<void> { /* handled in ensureAllTables */ }

export async function upsertEsCandle(r: Omit<EsCandleDbRecord, "id">): Promise<void> {
  const pool = await getDb();
  await pool.query(
    `INSERT INTO es_candles (timestamp,date,"slotKey",time,symbol,"intervalMinutes",source,open,high,low,close,volume,"avgVolume")
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
     ON CONFLICT("slotKey") DO UPDATE SET
       timestamp=EXCLUDED.timestamp, high=GREATEST(es_candles.high,EXCLUDED.high), low=LEAST(es_candles.low,EXCLUDED.low),
       close=EXCLUDED.close, volume=EXCLUDED.volume, "avgVolume"=EXCLUDED."avgVolume"`,
    [r.timestamp, r.date, r.slotKey, r.time ?? "", r.symbol ?? "/ES", r.intervalMinutes ?? 5,
     r.source ?? "dxlink", r.open, r.high, r.low, r.close, r.volume, r.avgVolume ?? 0]
  );
}

export async function getEsCandles(date?: string, daysBack?: number, limit = 2000): Promise<EsCandleDbRecord[]> {
  if (date) {
    return queryAll<EsCandleDbRecord>(
      `SELECT * FROM es_candles WHERE date = ? ORDER BY timestamp ASC LIMIT ?`,
      [date, limit]
    );
  }
  if (daysBack) {
    const cutoff = new Date(Date.now() - daysBack * 86400_000).toISOString().slice(0, 10);
    return queryAll<EsCandleDbRecord>(
      `SELECT * FROM es_candles WHERE date >= ? ORDER BY timestamp ASC LIMIT ?`,
      [cutoff, limit]
    );
  }
  return queryAll<EsCandleDbRecord>(
    `SELECT * FROM es_candles ORDER BY timestamp DESC LIMIT ?`,
    [limit]
  );
}

// ── IB Levels (locked Initial Balance per day) ──────────────────────────────────

export interface IbLevelsRecord {
  id?: number;
  date: string;
  symbol?: string;
  timestamp: number;
  locked: number;          // 1 once frozen at/after 10:30 ET — never overwritten after
  high: number;
  low: number;
  mid: number;
  range: number;
  rangePct: number;
  openPrice: number;
  lowFirst: number | null; // 1 = low formed first, 0 = high first, null = tie/unknown
  barCount: number;
}

/**
 * Upsert the day's IB levels. Once a row is `locked=1`, this is a no-op for that
 * date (the IB is frozen post-10:30 and must never be recomputed/overwritten).
 * While unlocked (still forming), the row is updated freely.
 */
export async function upsertIbLevels(r: Omit<IbLevelsRecord, "id">): Promise<void> {
  const pool = await getDb();
  await pool.query(
    `INSERT INTO ib_levels (date,symbol,timestamp,locked,high,low,mid,range,"rangePct","openPrice","lowFirst","barCount")
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
     ON CONFLICT(date) DO UPDATE SET
       symbol=EXCLUDED.symbol, timestamp=EXCLUDED.timestamp, locked=EXCLUDED.locked,
       high=EXCLUDED.high, low=EXCLUDED.low, mid=EXCLUDED.mid, range=EXCLUDED.range,
       "rangePct"=EXCLUDED."rangePct", "openPrice"=EXCLUDED."openPrice",
       "lowFirst"=EXCLUDED."lowFirst", "barCount"=EXCLUDED."barCount"
     WHERE ib_levels.locked = 0`,
    [r.date, r.symbol ?? "/ES", r.timestamp, r.locked ?? 0, r.high, r.low, r.mid,
     r.range, r.rangePct, r.openPrice, r.lowFirst, r.barCount]
  );
}

export async function getIbLevels(date: string): Promise<IbLevelsRecord | null> {
  const rows = await queryAll<IbLevelsRecord>(
    `SELECT * FROM ib_levels WHERE date = ? LIMIT 1`,
    [date]
  );
  return rows[0] ?? null;
}

// ── Bzila Live Snapshots ──────────────────────────────────────────────────────

export interface BzilaSnapshotRecord {
  id?: number;
  timestamp: number;
  date: string;
  time: string;
  ticker: string;
  orders: string;
  stats: string;
}

export async function ensureBzilaSnapshotsTable(): Promise<void> { /* handled in ensureAllTables */ }

export async function insertBzilaSnapshot(r: { timestamp: number; date: string; time: string; ticker: string; session?: string; orders: unknown[]; stats: unknown }): Promise<number> {
  const pool = await getDb();
  const result = await pool.query(
    `INSERT INTO bzila_snapshots (timestamp,date,time,ticker,session,orders,stats) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id`,
    [r.timestamp, r.date, r.time, r.ticker, r.session ?? "rth",
     JSON.stringify(r.orders ?? []), JSON.stringify(r.stats ?? {})]
  );
  return Number(result.rows[0]?.id ?? 0);
}

export async function getLatestBzilaSnapshot(date?: string, session?: string): Promise<{ stats: unknown; orders: unknown[] } | null> {
  let rows: BzilaSnapshotRecord[];
  if (date && session) {
    rows = await queryAll<BzilaSnapshotRecord>(
      "SELECT * FROM bzila_snapshots WHERE date = ? AND session = ? ORDER BY timestamp DESC LIMIT 1",
      [date, session]
    );
    if (!rows.length && session === "ext") {
      rows = await queryAll<BzilaSnapshotRecord>(
        "SELECT * FROM bzila_snapshots WHERE session = 'ext' ORDER BY timestamp DESC LIMIT 1"
      );
    }
  } else if (date) {
    rows = await queryAll<BzilaSnapshotRecord>(
      "SELECT * FROM bzila_snapshots WHERE date = ? ORDER BY timestamp DESC LIMIT 1",
      [date]
    );
  } else {
    rows = await queryAll<BzilaSnapshotRecord>(
      "SELECT * FROM bzila_snapshots ORDER BY timestamp DESC LIMIT 1"
    );
  }
  if (!rows.length) return null;
  const r = rows[0];
  return {
    stats: typeof r.stats === "string" ? JSON.parse(r.stats) : r.stats,
    orders: typeof r.orders === "string" ? JSON.parse(r.orders) : (r.orders ?? []),
  };
}

export async function getBzilaSnapshots(date?: string, limit = 200): Promise<BzilaSnapshotRecord[]> {
  if (date) {
    return queryAll<BzilaSnapshotRecord>(
      "SELECT * FROM bzila_snapshots WHERE date = ? ORDER BY timestamp DESC LIMIT ?",
      [date, limit]
    );
  }
  return queryAll<BzilaSnapshotRecord>(
    "SELECT * FROM bzila_snapshots ORDER BY timestamp DESC LIMIT ?",
    [limit]
  );
}

// ── Expirations Cache ─────────────────────────────────────────────────────────

export async function ensureExpirationsTable(): Promise<void> { /* handled in ensureAllTables */ }

export async function upsertExpirationCache(ticker: string, expirations: string[], raw: unknown): Promise<void> {
  const pool = await getDb();
  await pool.query(
    `INSERT INTO expirations_cache (ticker,timestamp,expirations,raw) VALUES ($1,$2,$3,$4)
     ON CONFLICT(ticker) DO UPDATE SET timestamp=EXCLUDED.timestamp, expirations=EXCLUDED.expirations, raw=EXCLUDED.raw`,
    [ticker, Date.now(), JSON.stringify(expirations), JSON.stringify(raw)]
  );
}

export async function getCachedExpirations(ticker: string): Promise<unknown | null> {
  const rows = await queryAll<{ ticker: string; timestamp: number; raw: string }>(
    "SELECT * FROM expirations_cache WHERE ticker = ? ORDER BY timestamp DESC LIMIT 1",
    [ticker]
  );
  if (!rows.length) return null;
  const r = rows[0];
  if (Date.now() - Number(r.timestamp) > 3_600_000) return null;
  return typeof r.raw === "string" ? JSON.parse(r.raw) : r.raw;
}

// ── Option Strike GEX History ─────────────────────────────────────────────────

export interface OptionStrikeGexRecord {
  id?: number;
  timestamp: number;
  date: string;
  expiry: string;
  spot: number;
  strike: number;
  net_gex: number;
}

export async function insertOptionStrikeGexRows(rows: Omit<OptionStrikeGexRecord, "id">[]): Promise<void> {
  if (!rows.length) return;
  const pool = await getDb();
  for (const row of rows) {
    await pool.query(
      `INSERT INTO option_strike_gex_history (timestamp, date, expiry, spot, strike, net_gex)
       VALUES ($1,$2,$3,$4,$5,$6)`,
      [row.timestamp, row.date, row.expiry, row.spot, row.strike, row.net_gex]
    );
  }
}

export async function getOptionStrikeRollingNetGex(
  date: string,
  expiry: string,
  sinceTimestamp: number
): Promise<Array<{ strike: number; rolling_net_gex: number; points: number }>> {
  const pool = await getDb();
  const result = await pool.query(
    `SELECT strike,
            AVG(net_gex) AS rolling_net_gex,
            COUNT(*)::int AS points
       FROM option_strike_gex_history
      WHERE date = $1
        AND expiry = $2
        AND timestamp >= $3
      GROUP BY strike
      ORDER BY strike ASC`,
    [date, expiry, sinceTimestamp]
  );
  return result.rows.map((row) => ({
    strike: Number(row.strike ?? 0),
    rolling_net_gex: Number(row.rolling_net_gex ?? 0),
    points: Number(row.points ?? 0),
  }));
}

/**
 * Per-strike net GEX as it read at the most recent snapshot AT OR BEFORE
 * `asOfTimestamp` (point-in-time, not an average). Used by the strike-detail
 * popup to compute rolling differences (current − reading N minutes ago).
 * Returns the single nearest row per strike via DISTINCT ON.
 */
export async function getOptionStrikeNetGexAsOf(
  date: string,
  expiry: string,
  asOfTimestamp: number
): Promise<Array<{ strike: number; net_gex: number; timestamp: number }>> {
  const pool = await getDb();
  const result = await pool.query(
    `SELECT DISTINCT ON (strike) strike, net_gex, timestamp
       FROM option_strike_gex_history
      WHERE date = $1
        AND expiry = $2
        AND timestamp <= $3
      ORDER BY strike ASC, timestamp DESC`,
    [date, expiry, asOfTimestamp]
  );
  return result.rows.map((row) => ({
    strike: Number(row.strike ?? 0),
    net_gex: Number(row.net_gex ?? 0),
    timestamp: Number(row.timestamp ?? 0),
  }));
}

/**
 * Per-strike net GEX at the FIRST snapshot of the session (RTH open baseline).
 * "Open" = earliest reading recorded for `date`/`expiry`.
 */
export async function getOptionStrikeNetGexAtOpen(
  date: string,
  expiry: string
): Promise<Array<{ strike: number; net_gex: number; timestamp: number }>> {
  const pool = await getDb();
  const result = await pool.query(
    `SELECT DISTINCT ON (strike) strike, net_gex, timestamp
       FROM option_strike_gex_history
      WHERE date = $1
        AND expiry = $2
      ORDER BY strike ASC, timestamp ASC`,
    [date, expiry]
  );
  return result.rows.map((row) => ({
    strike: Number(row.strike ?? 0),
    net_gex: Number(row.net_gex ?? 0),
    timestamp: Number(row.timestamp ?? 0),
  }));
}

export interface BudgetProfileRecord {
  id: number;
  name: string;
  currency: string;
  created_at?: string | null;
  updated_at?: string | null;
}

export interface BudgetCategoryRecord {
  id: number;
  profile_id: number;
  name: string;
  amount: number;
  period: string;
  color?: string | null;
  created_at?: string | null;
  updated_at?: string | null;
}

export interface BudgetEntryRecord {
  id: number;
  profile_id: number;
  category_id?: number | null;
  type: "income" | "expense";
  amount: number;
  title: string;
  notes?: string | null;
  occurred_at: string;
  created_at?: string | null;
  updated_at?: string | null;
}

export async function getOrCreateBudgetProfile(name = "Default"): Promise<BudgetProfileRecord> {
  const pool = await getDb();
  const found = await queryOne<BudgetProfileRecord>("SELECT * FROM budget_profiles WHERE name = ? LIMIT 1", [name]);
  if (found) return found;
  const result = await pool.query(
    `INSERT INTO budget_profiles (name, currency) VALUES ($1, $2) RETURNING *`,
    [name, "USD"]
  );
  return result.rows[0] as BudgetProfileRecord;
}

export async function listBudgetProfiles(): Promise<BudgetProfileRecord[]> {
  return queryAll<BudgetProfileRecord>("SELECT * FROM budget_profiles ORDER BY id ASC");
}

export async function upsertBudgetCategory(input: { profile_id: number; name: string; amount: number; period: string; color?: string | null }): Promise<BudgetCategoryRecord> {
  const pool = await getDb();
  const result = await pool.query(
    `INSERT INTO budget_categories (profile_id, name, amount, period, color)
     VALUES ($1,$2,$3,$4,$5)
     ON CONFLICT(profile_id, name) DO UPDATE SET amount = EXCLUDED.amount, period = EXCLUDED.period, color = EXCLUDED.color, updated_at = CURRENT_TIMESTAMP
     RETURNING *`,
    [input.profile_id, input.name, input.amount, input.period, input.color ?? null]
  );
  return result.rows[0] as BudgetCategoryRecord;
}

export async function listBudgetCategories(profileId: number): Promise<BudgetCategoryRecord[]> {
  return queryAll<BudgetCategoryRecord>(
    "SELECT * FROM budget_categories WHERE profile_id = ? ORDER BY id DESC",
    [profileId]
  );
}

export async function insertBudgetEntry(input: Omit<BudgetEntryRecord, "id" | "created_at" | "updated_at">): Promise<BudgetEntryRecord> {
  const pool = await getDb();
  const result = await pool.query(
    `INSERT INTO budget_entries (profile_id, category_id, type, amount, title, notes, occurred_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
    [input.profile_id, input.category_id ?? null, input.type, input.amount, input.title, input.notes ?? null, input.occurred_at]
  );
  return result.rows[0] as BudgetEntryRecord;
}

export async function listBudgetEntries(profileId: number, limit = 200): Promise<BudgetEntryRecord[]> {
  return queryAll<BudgetEntryRecord>(
    "SELECT * FROM budget_entries WHERE profile_id = ? ORDER BY occurred_at DESC, id DESC LIMIT ?",
    [profileId, limit]
  );
}

// ── EOD GEX Snapshots ─────────────────────────────────────────────────────────

export interface EodGexRecord {
  id?: number;
  date: string;
  symbol: string;
  total_gex: number;
  spot: number;
  computed_at: string;
}

/** Upsert one EOD GEX row. Overwrites an existing (date, symbol) row. */
export async function upsertEodGex(r: Omit<EodGexRecord, "id">): Promise<void> {
  const pool = await getDb();
  await pool.query(
    `INSERT INTO eod_gex (date, symbol, total_gex, spot, computed_at)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (date, symbol) DO UPDATE SET
       total_gex   = EXCLUDED.total_gex,
       spot        = EXCLUDED.spot,
       computed_at = EXCLUDED.computed_at`,
    [r.date, r.symbol, r.total_gex, r.spot, r.computed_at]
  );
}

export async function getEodGex(opts: { date?: string; symbol?: string; limit?: number } = {}): Promise<EodGexRecord[]> {
  const { date, symbol, limit = 200 } = opts;
  if (date && symbol) {
    return queryAll<EodGexRecord>(
      "SELECT * FROM eod_gex WHERE date = ? AND symbol = ? ORDER BY id DESC LIMIT ?",
      [date, symbol, limit]
    );
  }
  if (date) {
    return queryAll<EodGexRecord>(
      "SELECT * FROM eod_gex WHERE date = ? ORDER BY symbol ASC LIMIT ?",
      [date, limit]
    );
  }
  if (symbol) {
    return queryAll<EodGexRecord>(
      "SELECT * FROM eod_gex WHERE symbol = ? ORDER BY date DESC LIMIT ?",
      [symbol, limit]
    );
  }
  return queryAll<EodGexRecord>(
    "SELECT * FROM eod_gex ORDER BY date DESC, symbol ASC LIMIT ?",
    [limit]
  );
}
