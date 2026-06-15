// Server-side only — do NOT import from client components
// Uses sql.js (pure WASM) — no native compile needed

import path from "path";
import fs from "fs";
import initSqlJs, { type Database, type QueryExecResult, type SqlValue } from "sql.js";

// On Render: use /data (persistent disk). Locally: fall back to project db.
const DB_PATH =
  process.env.DB_PATH ??
  (fs.existsSync("/data") ? "/data/trading_metrics.db" : path.resolve(process.cwd(), "../trading_db_complete/trading_metrics.db"));

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
