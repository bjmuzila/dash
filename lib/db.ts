// Server-side only — do NOT import from client components
// Uses sql.js (pure WASM) — no native compile needed

import path from "path";
import fs from "fs";
import initSqlJs, { type Database, type QueryExecResult, type SqlValue } from "sql.js";

function resolveDbPath(): string {
  const envPath = process.env.DB_PATH?.trim();
  const localDataPath = path.resolve(process.cwd(), "data", "trading_metrics.db");
  const candidates = [
    envPath ? path.resolve(process.cwd(), envPath) : null,
    fs.existsSync("/data") ? "/data/trading_metrics.db" : null,
    localDataPath,
    path.resolve(process.cwd(), "trading_metrics.db"),
    path.resolve(process.cwd(), "../trading_db_complete/trading_metrics.db"),
  ].filter((value): value is string => Boolean(value));

  const existing = candidates.find((candidate) => fs.existsSync(candidate));
  return existing ?? localDataPath;
}

const DB_PATH = resolveDbPath();

let _db: Database | null = null;

export async function getDb(): Promise<Database> {
  if (_db) return _db;

  const wasmPath = path.resolve(
    process.cwd(),
    "node_modules/sql.js/dist/sql-wasm.wasm"
  );
  const SQL = await initSqlJs({
    locateFile: () => wasmPath,
  });

  if (fs.existsSync(DB_PATH)) {
    const fileBuffer = fs.readFileSync(DB_PATH);
    _db = new SQL.Database(fileBuffer);
  } else {
    // First run on fresh disk — create empty DB
    _db = new SQL.Database();
  }

  return _db;
}

/** Write in-memory DB back to disk (call after every mutation) */
export function persistDb(): void {
  if (!_db) return;
  const data = _db.export();
  fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
  fs.writeFileSync(DB_PATH, Buffer.from(data));
}

// ── Query helpers ─────────────────────────────────────────────────────────────

/** Run a SELECT and return rows as plain objects */
export async function queryAll<T = Record<string, unknown>>(
  sql: string,
  params: SqlValue[] = []
): Promise<T[]> {
  const db = await getDb();
  const results: QueryExecResult[] = db.exec(sql, params);
  if (!results.length) return [];
  const { columns, values } = results[0];
  return values.map((row) =>
    Object.fromEntries(columns.map((col, i) => [col, row[i]]))
  ) as T[];
}

export async function queryOne<T = Record<string, unknown>>(
  sql: string,
  params: SqlValue[] = []
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
  const db = await getDb();
  db.run(`
    CREATE TABLE IF NOT EXISTS snapshots (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      timestamp INTEGER NOT NULL,
      date TEXT NOT NULL,
      time TEXT NOT NULL,
      period TEXT NOT NULL DEFAULT 'weekly',
      tableHtml TEXT NOT NULL,
      expirations TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);
  db.run(
    `INSERT INTO snapshots (timestamp, date, time, period, tableHtml, expirations) VALUES (?, ?, ?, ?, ?, ?)`,
    [snap.timestamp, snap.date, snap.time, snap.period, snap.tableHtml, JSON.stringify(snap.expirations || [])]
  );
  persistDb();
  return snap;
}

export async function getSnapshots(period?: string): Promise<Snapshot[]> {
  let sql = "SELECT * FROM snapshots";
  const params: SqlValue[] = [];
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
  const db = await getDb();
  db.run("DELETE FROM snapshots WHERE id = ?", [id]);
  persistDb();
  return true;
}

// ── Flow Calls (individual SPX 0DTE + REST tape entries) ─────────────────────

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
  is_otm: number; // 0 | 1
}

export async function ensureFlowCallsTable(): Promise<void> {
  const db = await getDb();
  db.run(`
    CREATE TABLE IF NOT EXISTS flow_calls (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      ts INTEGER NOT NULL,
      date TEXT NOT NULL,
      source TEXT NOT NULL,
      symbol TEXT NOT NULL,
      underlying TEXT,
      expiration TEXT,
      strike REAL,
      option_type TEXT,
      side TEXT,
      action TEXT,
      price REAL,
      size INTEGER,
      premium REAL,
      is_otm INTEGER DEFAULT 0
    )
  `);
  db.run("CREATE INDEX IF NOT EXISTS idx_flow_calls_date ON flow_calls(date)");
  db.run("CREATE INDEX IF NOT EXISTS idx_flow_calls_ts ON flow_calls(ts)");
}

export async function insertFlowCalls(calls: Omit<FlowCallRecord, "id">[]): Promise<void> {
  if (!calls.length) return;
  const db = await getDb();
  await ensureFlowCallsTable();
  for (const c of calls) {
    db.run(
      `INSERT INTO flow_calls (ts, date, source, symbol, underlying, expiration, strike, option_type, side, action, price, size, premium, is_otm)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [c.ts, c.date, c.source, c.symbol, c.underlying ?? null, c.expiration ?? null,
       c.strike, c.option_type, c.side, c.action, c.price, c.size, c.premium, c.is_otm]
    );
  }
  persistDb();
}

export async function getFlowCalls(date: string, limit = 500): Promise<FlowCallRecord[]> {
  await ensureFlowCallsTable();
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

export async function ensureMvcTable(): Promise<void> {
  const db = await getDb();
  db.run(`
    CREATE TABLE IF NOT EXISTS mvc_snapshots (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      timestamp INTEGER NOT NULL,
      date TEXT NOT NULL,
      day TEXT,
      time TEXT,
      strikeOIVol REAL,
      mvcValueOIVol REAL,
      pctOI_Vol REAL,
      volumeOIVol REAL,
      totalNetGEX_OI REAL,
      strikeVolOnly REAL,
      mvcValueVolOnly REAL,
      pctVol_Only REAL,
      volumeVolOnly REAL,
      totalNetGEX_Vol REAL,
      spxPrice REAL,
      esPrice REAL,
      netDEXStrike REAL,
      totalNetDEX_OI REAL,
      totalNetDEX_Vol REAL,
      totalAbsNetGEX REAL,
      gexFlip REAL,
      triggerType TEXT,
      expiration TEXT
    )
  `);
  db.run("CREATE INDEX IF NOT EXISTS idx_mvc_date ON mvc_snapshots(date)");
  db.run("CREATE INDEX IF NOT EXISTS idx_mvc_ts ON mvc_snapshots(timestamp)");
}

export async function insertMvcSnapshot(r: Omit<MvcRecord, "id">): Promise<number> {
  const db = await getDb();
  await ensureMvcTable();
  db.run(
    `INSERT INTO mvc_snapshots (timestamp,date,day,time,strikeOIVol,mvcValueOIVol,pctOI_Vol,volumeOIVol,
      totalNetGEX_OI,strikeVolOnly,mvcValueVolOnly,pctVol_Only,volumeVolOnly,totalNetGEX_Vol,
      spxPrice,esPrice,netDEXStrike,totalNetDEX_OI,totalNetDEX_Vol,totalAbsNetGEX,gexFlip,triggerType,expiration)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    [r.timestamp, r.date, r.day, r.time, r.strikeOIVol ?? null, r.mvcValueOIVol, r.pctOI_Vol ?? null,
     r.volumeOIVol, r.totalNetGEX_OI, r.strikeVolOnly ?? null, r.mvcValueVolOnly, r.pctVol_Only ?? null,
     r.volumeVolOnly, r.totalNetGEX_Vol, r.spxPrice, r.esPrice, r.netDEXStrike ?? null,
     r.totalNetDEX_OI ?? null, r.totalNetDEX_Vol ?? null, r.totalAbsNetGEX, r.gexFlip ?? null,
     r.triggerType, r.expiration]
  );
  persistDb();
  const row = db.exec("SELECT last_insert_rowid() as id");
  return Number(row[0]?.values[0]?.[0] ?? 0);
}

export async function getMvcSnapshots(date?: string, limit = 200): Promise<MvcRecord[]> {
  await ensureMvcTable();
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

export async function ensurePremiumFlowTable(): Promise<void> {
  const db = await getDb();
  db.run(`
    CREATE TABLE IF NOT EXISTS premium_flow (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      timestamp INTEGER NOT NULL,
      date TEXT NOT NULL,
      time TEXT,
      callPremium REAL,
      putPremium REAL,
      netPremium REAL,
      spxPrice REAL
    )
  `);
  db.run("CREATE INDEX IF NOT EXISTS idx_pf_date ON premium_flow(date)");
  db.run("CREATE INDEX IF NOT EXISTS idx_pf_ts ON premium_flow(timestamp)");
}

export async function insertPremiumFlow(r: Omit<PremiumFlowRecord, "id">): Promise<void> {
  const db = await getDb();
  await ensurePremiumFlowTable();
  db.run(
    `INSERT INTO premium_flow (timestamp,date,time,callPremium,putPremium,netPremium,spxPrice)
     VALUES (?,?,?,?,?,?,?)`,
    [r.timestamp, r.date, r.time, r.callPremium, r.putPremium, r.netPremium, r.spxPrice]
  );
  persistDb();
}

export async function getPremiumFlow(date?: string, limit = 500): Promise<PremiumFlowRecord[]> {
  await ensurePremiumFlowTable();
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

export async function ensureGreeksTsTable(): Promise<void> {
  const db = await getDb();
  db.run(`
    CREATE TABLE IF NOT EXISTS greeks_ts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      timestamp INTEGER NOT NULL,
      date TEXT NOT NULL,
      time TEXT,
      ticker TEXT,
      price REAL,
      gexRaw REAL,
      dexRaw REAL,
      chexRaw REAL,
      vexRaw REAL,
      gex REAL,
      dex REAL,
      chex REAL,
      vex REAL,
      buyScore REAL,
      sellScore REAL
    )
  `);
  db.run("CREATE INDEX IF NOT EXISTS idx_gts_date ON greeks_ts(date)");
  db.run("CREATE INDEX IF NOT EXISTS idx_gts_ts ON greeks_ts(timestamp)");
}

export async function insertGreeksTs(r: Omit<GreeksTsRecord, "id">): Promise<void> {
  const db = await getDb();
  await ensureGreeksTsTable();
  db.run(
    `INSERT INTO greeks_ts (timestamp,date,time,ticker,price,gexRaw,dexRaw,chexRaw,vexRaw,gex,dex,chex,vex,buyScore,sellScore)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    [r.timestamp, r.date, r.time, r.ticker, r.price,
     r.gexRaw, r.dexRaw, r.chexRaw, r.vexRaw,
     r.gex, r.dex, r.chex, r.vex, r.buyScore, r.sellScore]
  );
  persistDb();
}

export async function getGreeksTs(date?: string, limit = 1000): Promise<GreeksTsRecord[]> {
  await ensureGreeksTsTable();
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

export async function ensureEsCandlesTable(): Promise<void> {
  const db = await getDb();
  db.run(`
    CREATE TABLE IF NOT EXISTS es_candles (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      timestamp INTEGER NOT NULL,
      date TEXT NOT NULL,
      slotKey TEXT NOT NULL UNIQUE,
      time TEXT,
      symbol TEXT,
      intervalMinutes INTEGER,
      source TEXT,
      open REAL,
      high REAL,
      low REAL,
      close REAL,
      volume REAL,
      avgVolume REAL DEFAULT 0
    )
  `);
  db.run("CREATE INDEX IF NOT EXISTS idx_ec_date ON es_candles(date)");
  db.run("CREATE INDEX IF NOT EXISTS idx_ec_slot ON es_candles(slotKey)");
}

export async function upsertEsCandle(r: Omit<EsCandleDbRecord, "id">): Promise<void> {
  const db = await getDb();
  await ensureEsCandlesTable();
  db.run(
    `INSERT INTO es_candles (timestamp,date,slotKey,time,symbol,intervalMinutes,source,open,high,low,close,volume,avgVolume)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)
     ON CONFLICT(slotKey) DO UPDATE SET
       timestamp=excluded.timestamp, high=MAX(high,excluded.high), low=MIN(low,excluded.low),
       close=excluded.close, volume=excluded.volume, avgVolume=excluded.avgVolume`,
    [r.timestamp, r.date, r.slotKey, r.time ?? "", r.symbol ?? "/ES", r.intervalMinutes ?? 5,
     r.source ?? "dxlink", r.open, r.high, r.low, r.close, r.volume, r.avgVolume ?? 0]
  );
  persistDb();
}

export async function getEsCandles(date?: string, daysBack?: number, limit = 2000): Promise<EsCandleDbRecord[]> {
  await ensureEsCandlesTable();
  if (date) {
    return queryAll<EsCandleDbRecord>(
      "SELECT * FROM es_candles WHERE date = ? ORDER BY timestamp ASC LIMIT ?",
      [date, limit]
    );
  }
  if (daysBack) {
    const cutoff = new Date(Date.now() - daysBack * 86400_000).toISOString().slice(0, 10);
    return queryAll<EsCandleDbRecord>(
      "SELECT * FROM es_candles WHERE date >= ? ORDER BY timestamp ASC LIMIT ?",
      [cutoff, limit]
    );
  }
  return queryAll<EsCandleDbRecord>(
    "SELECT * FROM es_candles ORDER BY timestamp DESC LIMIT ?",
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
  orders: string;   // JSON
  stats: string;    // JSON
}

export async function ensureBzilaSnapshotsTable(): Promise<void> {
  const db = await getDb();
  db.run(`
    CREATE TABLE IF NOT EXISTS bzila_snapshots (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      timestamp INTEGER NOT NULL,
      date TEXT NOT NULL,
      time TEXT,
      ticker TEXT,
      session TEXT DEFAULT 'rth',
      orders TEXT,
      stats TEXT
    )
  `);
  db.run("CREATE INDEX IF NOT EXISTS idx_bs_date ON bzila_snapshots(date)");
  db.run("CREATE INDEX IF NOT EXISTS idx_bs_ts ON bzila_snapshots(timestamp)");
  // Migrate: add session column if missing
  try { db.run("ALTER TABLE bzila_snapshots ADD COLUMN session TEXT DEFAULT 'rth'"); } catch {}
}

export async function insertBzilaSnapshot(r: { timestamp: number; date: string; time: string; ticker: string; session?: string; orders: unknown[]; stats: unknown }): Promise<number> {
  const db = await getDb();
  await ensureBzilaSnapshotsTable();
  db.run(
    `INSERT INTO bzila_snapshots (timestamp,date,time,ticker,session,orders,stats) VALUES (?,?,?,?,?,?,?)`,
    [r.timestamp, r.date, r.time, r.ticker, r.session ?? "rth",
     JSON.stringify(r.orders ?? []), JSON.stringify(r.stats ?? {})]
  );
  persistDb();
  const row = db.exec("SELECT last_insert_rowid() as id");
  return Number(row[0]?.values[0]?.[0] ?? 0);
}

export async function getLatestBzilaSnapshot(date?: string, session?: string): Promise<{ stats: unknown; orders: unknown[] } | null> {
  await ensureBzilaSnapshotsTable();
  let rows: BzilaSnapshotRecord[];
  if (date && session) {
    rows = await queryAll<BzilaSnapshotRecord>(
      "SELECT * FROM bzila_snapshots WHERE date = ? AND session = ? ORDER BY timestamp DESC LIMIT 1",
      [date, session]
    );
    // For ext session, also check previous date (ext spans midnight)
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
  await ensureBzilaSnapshotsTable();
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

export async function ensureExpirationsTable(): Promise<void> {
  const db = await getDb();
  db.run(`
    CREATE TABLE IF NOT EXISTS expirations_cache (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      ticker TEXT NOT NULL,
      timestamp INTEGER NOT NULL,
      expirations TEXT,
      raw TEXT
    )
  `);
  db.run("CREATE INDEX IF NOT EXISTS idx_exp_ticker ON expirations_cache(ticker)");
}

export async function upsertExpirationCache(ticker: string, expirations: string[], raw: unknown): Promise<void> {
  const db = await getDb();
  await ensureExpirationsTable();
  // Keep only latest per ticker — delete old then insert
  db.run("DELETE FROM expirations_cache WHERE ticker = ?", [ticker]);
  db.run(
    `INSERT INTO expirations_cache (ticker,timestamp,expirations,raw) VALUES (?,?,?,?)`,
    [ticker, Date.now(), JSON.stringify(expirations), JSON.stringify(raw)]
  );
  persistDb();
}

export async function getCachedExpirations(ticker: string): Promise<unknown | null> {
  await ensureExpirationsTable();
  const rows = await queryAll<{ ticker: string; timestamp: number; raw: string }>(
    "SELECT * FROM expirations_cache WHERE ticker = ? ORDER BY timestamp DESC LIMIT 1",
    [ticker]
  );
  if (!rows.length) return null;
  const r = rows[0];
  // Stale after 1 hour
  if (Date.now() - r.timestamp > 3_600_000) return null;
  return typeof r.raw === "string" ? JSON.parse(r.raw) : r.raw;
}

// ── Bzila GEX History (intraday chart) ────────────────────────────────────────

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

export async function ensureBzilaGexHistoryTable(): Promise<void> {
  const db = await getDb();
  db.run(`
    CREATE TABLE IF NOT EXISTS bzila_gex_history (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      timestamp INTEGER NOT NULL,
      date TEXT NOT NULL,
      session TEXT DEFAULT 'rth',
      call REAL,
      put REAL,
      net REAL,
      spot REAL
    )
  `);
  db.run("CREATE INDEX IF NOT EXISTS idx_bgh_date ON bzila_gex_history(date)");
  db.run("CREATE INDEX IF NOT EXISTS idx_bgh_session ON bzila_gex_history(session)");
  try { db.run("ALTER TABLE bzila_gex_history ADD COLUMN session TEXT DEFAULT 'rth'"); } catch {}
}

export async function insertBzilaGexPoint(r: Omit<BzilaGexPoint, "id">): Promise<void> {
  const db = await getDb();
  await ensureBzilaGexHistoryTable();
  db.run(
    `INSERT INTO bzila_gex_history (timestamp,date,session,call,put,net,spot) VALUES (?,?,?,?,?,?,?)`,
    [r.timestamp, r.date, r.session ?? "rth", r.call, r.put, r.net, r.spot]
  );
  persistDb();
}

export async function getBzilaGexHistory(date?: string, session?: string): Promise<BzilaGexPoint[]> {
  await ensureBzilaGexHistoryTable();
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

// Bzila Strike GEX History (top 10 above / below spot snapshots)

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

export async function ensureBzilaStrikeGexTable(): Promise<void> {
  const db = await getDb();
  db.run(`
    CREATE TABLE IF NOT EXISTS bzila_strike_gex_history (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      timestamp INTEGER NOT NULL,
      date TEXT NOT NULL,
      session TEXT DEFAULT 'rth',
      expiry TEXT,
      spot REAL,
      strike REAL NOT NULL,
      bucket TEXT NOT NULL,
      rank_index INTEGER NOT NULL,
      call_gex REAL,
      put_gex REAL,
      net_gex REAL,
      net_gex_change REAL
    )
  `);
  db.run("CREATE INDEX IF NOT EXISTS idx_bsg_date ON bzila_strike_gex_history(date)");
  db.run("CREATE INDEX IF NOT EXISTS idx_bsg_session ON bzila_strike_gex_history(session)");
  db.run("CREATE INDEX IF NOT EXISTS idx_bsg_ts ON bzila_strike_gex_history(timestamp)");
  db.run("CREATE INDEX IF NOT EXISTS idx_bsg_strike ON bzila_strike_gex_history(strike)");
  try { db.run("ALTER TABLE bzila_strike_gex_history ADD COLUMN session TEXT DEFAULT 'rth'"); } catch {}
}

export async function insertBzilaStrikeGexRows(rows: Omit<BzilaStrikeGexRecord, "id">[]): Promise<void> {
  if (!rows.length) return;
  const db = await getDb();
  await ensureBzilaStrikeGexTable();
  for (const row of rows) {
    db.run(
      `INSERT INTO bzila_strike_gex_history
       (timestamp, date, session, expiry, spot, strike, bucket, rank_index, call_gex, put_gex, net_gex, net_gex_change)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        row.timestamp,
        row.date,
        row.session ?? "rth",
        row.expiry,
        row.spot,
        row.strike,
        row.bucket,
        row.rank_index,
        row.call_gex,
        row.put_gex,
        row.net_gex,
        row.net_gex_change,
      ]
    );
  }
  persistDb();
}

export async function getBzilaStrikeGexHistory(date?: string, session?: string, limit = 5000): Promise<BzilaStrikeGexRecord[]> {
  await ensureBzilaStrikeGexTable();
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
