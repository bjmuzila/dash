import { NextResponse } from "next/server";
import { getDb, persistDb } from "@/lib/db";
import path from "path";
import fs from "fs";

function resolveAllCandidatePaths() {
  const cwd = process.cwd();
  return {
    cwd,
    envDbPath: process.env.DB_PATH ?? null,
    hasSlashData: fs.existsSync("/data"),
    candidates: {
      env:       process.env.DB_PATH ? path.resolve(cwd, process.env.DB_PATH) : null,
      slashData: "/data/trading_metrics.db",
      cwdData:   path.resolve(cwd, "data", "trading_metrics.db"),
      cwd:       path.resolve(cwd, "trading_metrics.db"),
      parent:    path.resolve(cwd, "../trading_db_complete/trading_metrics.db"),
    },
  };
}

export async function GET() {
  try {
    const paths = resolveAllCandidatePaths();

    // Check which candidate paths exist
    const pathExistence: Record<string, { exists: boolean; size?: number; mtime?: Date }> = {};
    for (const [key, p] of Object.entries(paths.candidates)) {
      if (!p) { pathExistence[key] = { exists: false }; continue; }
      const exists = fs.existsSync(p);
      pathExistence[key] = exists
        ? { exists: true, size: fs.statSync(p).size, mtime: fs.statSync(p).mtime }
        : { exists: false };
    }

    const db = await getDb();

    // Do a test write to verify persist works
    db.run("CREATE TABLE IF NOT EXISTS _debug_ping (ts INTEGER)");
    db.run("INSERT INTO _debug_ping (ts) VALUES (?)", [Date.now()]);
    persistDb();

    // Verify the file was actually written
    const cwdDataPath = path.resolve(paths.cwd, "data", "trading_metrics.db");
    const afterWrite = fs.existsSync(cwdDataPath)
      ? { exists: true, size: fs.statSync(cwdDataPath).size, mtime: fs.statSync(cwdDataPath).mtime }
      : { exists: false };

    const tables = db.exec(`SELECT name FROM sqlite_master WHERE type='table' ORDER BY name`);
    const tableNames = tables[0]?.values.map(r => String(r[0])) ?? [];

    const counts: Record<string, number> = {};
    for (const t of tableNames) {
      try {
        const r = db.exec(`SELECT COUNT(*) FROM "${t}"`);
        counts[t] = Number(r[0]?.values[0]?.[0] ?? 0);
      } catch { counts[t] = -1; }
    }

    let latestBzila = null;
    try {
      const r = db.exec(`SELECT id, timestamp, date, time, session FROM bzila_snapshots ORDER BY timestamp DESC LIMIT 1`);
      if (r[0]?.values[0]) {
        const [id, timestamp, date, time, session] = r[0].values[0];
        latestBzila = { id, timestamp, date, time, session };
      }
    } catch (e) { latestBzila = { error: String(e) }; }

    let latestGreeks = null;
    try {
      const r = db.exec(`SELECT id, timestamp, date, time FROM greeks_ts ORDER BY timestamp DESC LIMIT 1`);
      if (r[0]?.values[0]) {
        const [id, timestamp, date, time] = r[0].values[0];
        latestGreeks = { id, timestamp, date, time };
      }
    } catch (e) { latestGreeks = { error: String(e) }; }

    return NextResponse.json({
      paths,
      pathExistence,
      afterWrite,
      tables: tableNames,
      counts,
      latestBzila,
      latestGreeks,
    });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
