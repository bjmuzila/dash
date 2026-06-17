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

    CREATE TABLE IF NOT EXISTS bzila_snapshots (
      id SERIAL PRIMARY KEY, timestamp BIGINT NOT NULL, date TEXT NOT NULL,
      time TEXT, ticker TEXT, session TEXT DEFAULT 'rth', orders TEXT, stats TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_bs_date ON bzila_snapshots(date);
    CREATE INDEX IF NOT EXISTS idx_bs_ts ON bzila_snapshots(timestamp);

    CREATE TABLE IF NOT EXISTS bzila_gex_history (
      id SERIAL PRIMARY KEY, timestamp BIGINT NOT NULL, date TEXT NOT NULL,
      session TEXT DEFAULT 'rth', call REAL, put REAL, net REAL, spot REAL
    );
    CREATE INDEX IF NOT EXISTS idx_bgh_date ON bzila_gex_history(date);
    CREATE INDEX IF NOT EXISTS idx_bgh_session ON bzila_gex_history(session);

    CREATE TABLE IF NOT EXISTS bzila_strike_gex_history (
      id SERIAL PRIMARY KEY, timestamp BIGINT NOT NULL, date TEXT NOT NULL,
      session TEXT DEFAULT 'rth', expiry TEXT, spot REAL, strike REAL,
      bucket TEXT, rank_index INTEGER, call_gex REAL, put_gex REAL, net_gex REAL, net_gex_change REAL
    );
    CREATE INDEX IF NOT EXISTS idx_bsg_date ON bzila_strike_gex_history(date);
    CREATE INDEX IF NOT EXISTS idx_bsg_session ON bzila_strike_gex_history(session);
    CREATE INDEX IF NOT EXISTS idx_bsg_ts ON bzila_strike_gex_history(timestamp);

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
  `);
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

// ── Bzila GEX History ─────────────────────────────────────────────────────────

export interface BzilaGexPoint {
  id?: number;
  timestamp: number;
  date: string;
  session?: string;
  call: number;
  put: number;
  net: number;
  spot: number;
}

export async function ensureBzilaGexHistoryTable(): Promise<void> { /* handled in ensureAllTables */ }

export async function insertBzilaGexPoint(r: Omit<BzilaGexPoint, "id">): Promise<void> {
  const pool = await getDb();
  await pool.query(
    `INSERT INTO bzila_gex_history (timestamp,date,session,call,put,net,spot) VALUES ($1,$2,$3,$4,$5,$6,$7)`,
    [r.timestamp, r.date, r.session ?? "rth", r.call, r.put, r.net, r.spot]
  );
}

export async function getBzilaGexHistory(date?: string, session?: string): Promise<BzilaGexPoint[]> {
  if (date && session) {
    return queryAll<BzilaGexPoint>(
      "SELECT * FROM bzila_gex_history WHERE date = ? AND session = ? ORDER BY timestamp ASC",
      [date, session]
    );
  }
  if (session) {
    const latest = await queryOne<{ date: string }>(
      "SELECT date FROM bzila_gex_history WHERE session = ? ORDER BY timestamp DESC LIMIT 1",
      [session]
    );
    if (!latest?.date) return [];
    return queryAll<BzilaGexPoint>(
      "SELECT * FROM bzila_gex_history WHERE date = ? AND session = ? ORDER BY timestamp ASC",
      [latest.date, session]
    );
  }
  if (!date) return [];
  return queryAll<BzilaGexPoint>(
    "SELECT * FROM bzila_gex_history WHERE date = ? ORDER BY timestamp ASC",
    [date]
  );
}

// ── Bzila Strike GEX History ──────────────────────────────────────────────────

export interface BzilaStrikeGexRecord {
  id?: number;
  timestamp: number;
  date: string;
  session?: string;
  expiry: string;
  spot: number;
  strike: number;
  bucket: "above" | "below";
  rank_index: number;
  call_gex: number;
  put_gex: number;
  net_gex: number;
  net_gex_change: number;
}

export interface OptionStrikeGexRecord {
  id?: number;
  timestamp: number;
  date: string;
  expiry: string;
  spot: number;
  strike: number;
  net_gex: number;
}

export async function ensureBzilaStrikeGexTable(): Promise<void> { /* handled in ensureAllTables */ }

export async function insertBzilaStrikeGexRows(rows: Omit<BzilaStrikeGexRecord, "id">[]): Promise<void> {
  if (!rows.length) return;
  const pool = await getDb();
  for (const row of rows) {
    await pool.query(
      `INSERT INTO bzila_strike_gex_history
       (timestamp, date, session, expiry, spot, strike, bucket, rank_index, call_gex, put_gex, net_gex, net_gex_change)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
      [row.timestamp, row.date, row.session ?? "rth", row.expiry, row.spot,
       row.strike, row.bucket, row.rank_index, row.call_gex, row.put_gex, row.net_gex, row.net_gex_change]
    );
  }
}

export async function getBzilaStrikeGexHistory(date?: string, session?: string, limit = 5000): Promise<BzilaStrikeGexRecord[]> {
  if (date && session) {
    return queryAll<BzilaStrikeGexRecord>(
      "SELECT * FROM bzila_strike_gex_history WHERE date = ? AND session = ? ORDER BY timestamp ASC, bucket ASC, rank_index ASC LIMIT ?",
      [date, session, limit]
    );
  }
  if (session) {
    const latest = await queryOne<{ date: string }>(
      "SELECT date FROM bzila_strike_gex_history WHERE session = ? ORDER BY timestamp DESC LIMIT 1",
      [session]
    );
    if (!latest?.date) return [];
    return queryAll<BzilaStrikeGexRecord>(
      "SELECT * FROM bzila_strike_gex_history WHERE date = ? AND session = ? ORDER BY timestamp ASC, bucket ASC, rank_index ASC LIMIT ?",
      [latest.date, session, limit]
    );
  }
  if (date) {
    return queryAll<BzilaStrikeGexRecord>(
      "SELECT * FROM bzila_strike_gex_history WHERE date = ? ORDER BY timestamp ASC, bucket ASC, rank_index ASC LIMIT ?",
      [date, limit]
    );
  }
  return queryAll<BzilaStrikeGexRecord>(
    "SELECT * FROM bzila_strike_gex_history ORDER BY timestamp DESC, bucket ASC, rank_index ASC LIMIT ?",
    [limit]
  );
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
