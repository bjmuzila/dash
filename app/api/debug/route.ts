import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const pool = await getDb();

    // Test write
    await pool.query("CREATE TABLE IF NOT EXISTS _debug_ping (ts BIGINT)");
    await pool.query("INSERT INTO _debug_ping (ts) VALUES ($1)", [Date.now()]);

    const tablesResult = await pool.query(
      `SELECT tablename AS name FROM pg_tables WHERE schemaname = 'public' ORDER BY tablename`
    );
    const tableNames = tablesResult.rows.map((r: any) => r.name);

    const counts: Record<string, number> = {};
    for (const t of tableNames) {
      try {
        const r = await pool.query(`SELECT COUNT(*) FROM "${t}"`);
        counts[t] = Number(r.rows[0]?.count ?? 0);
      } catch { counts[t] = -1; }
    }

    let latestBzila = null;
    try {
      const r = await pool.query(
        `SELECT id, timestamp, date, time, session FROM bzila_snapshots ORDER BY timestamp DESC LIMIT 1`
      );
      if (r.rows[0]) latestBzila = r.rows[0];
    } catch (e) { latestBzila = { error: String(e) }; }

    let latestGreeks = null;
    try {
      const r = await pool.query(
        `SELECT id, timestamp, date, time FROM greeks_ts ORDER BY timestamp DESC LIMIT 1`
      );
      if (r.rows[0]) latestGreeks = r.rows[0];
    } catch (e) { latestGreeks = { error: String(e) }; }

    return NextResponse.json({
      database: "postgresql",
      tables: tableNames,
      counts,
      latestBzila,
      latestGreeks,
    });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
