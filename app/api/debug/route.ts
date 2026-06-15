import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import path from "path";
import fs from "fs";

export async function GET() {
  try {
    const db = await getDb();

    const tables = db.exec(`SELECT name FROM sqlite_master WHERE type='table' ORDER BY name`);
    const tableNames = tables[0]?.values.map(r => String(r[0])) ?? [];

    const counts: Record<string, number> = {};
    for (const t of tableNames) {
      const r = db.exec(`SELECT COUNT(*) FROM "${t}"`);
      counts[t] = Number(r[0]?.values[0]?.[0] ?? 0);
    }

    // Latest bzila snapshot
    let latestBzila = null;
    try {
      const r = db.exec(`SELECT timestamp, date, time FROM bzila_snapshots ORDER BY timestamp DESC LIMIT 1`);
      if (r[0]?.values[0]) {
        latestBzila = { timestamp: r[0].values[0][0], date: r[0].values[0][1], time: r[0].values[0][2] };
      }
    } catch {}

    // DB file info
    const cwd = process.cwd();
    const dbPath = path.resolve(cwd, "data", "trading_metrics.db");
    const dbExists = fs.existsSync(dbPath);
    const dbSize = dbExists ? fs.statSync(dbPath).size : 0;
    const dbMtime = dbExists ? fs.statSync(dbPath).mtime : null;

    return NextResponse.json({
      cwd,
      dbPath,
      dbExists,
      dbSize,
      dbMtime,
      tables: tableNames,
      counts,
      latestBzila,
    });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
