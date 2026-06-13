// Server-side only — do NOT import from client components
// Uses sql.js (pure WASM) — no native compile needed

import path from "path";
import fs from "fs";
import initSqlJs, { type Database, type QueryExecResult, type SqlValue } from "sql.js";

const DB_PATH =
  process.env.DB_PATH ??
  path.resolve(process.cwd(), "../trading_db_complete/trading_metrics.db");

let _db: Database | null = null;

export async function getDb(): Promise<Database> {
  if (_db) return _db;

  const SQL = await initSqlJs();
  const fileBuffer = fs.readFileSync(DB_PATH);
  _db = new SQL.Database(fileBuffer);
  return _db;
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
  const sql = `
    INSERT INTO snapshots (timestamp, date, time, period, tableHtml, expirations)
    VALUES (?, ?, ?, ?, ?, ?)
  `;
  // Note: Using sync exec for simplicity, should use prepare/bind for production
  db.run(sql, [
    snap.timestamp,
    snap.date,
    snap.time,
    snap.period,
    snap.tableHtml,
    JSON.stringify(snap.expirations || [])
  ]);
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
  return true;
}
