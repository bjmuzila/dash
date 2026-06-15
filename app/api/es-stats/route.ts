import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";

let _tableEnsured = false;

export async function GET() {
  try {
    const pool = await getDb();

    if (!_tableEnsured) {
      await pool.query(`
        CREATE TABLE IF NOT EXISTS es_stats (
          id SERIAL PRIMARY KEY, expiration TEXT NOT NULL UNIQUE,
          no_long TEXT, up TEXT, mid TEXT, down TEXT, no_short TEXT,
          updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
        )
      `);
      _tableEnsured = true;
    }

    let result = await pool.query(
      "SELECT * FROM es_stats WHERE expiration = 'WEEKLY' LIMIT 1"
    );

    if (!result.rows.length) {
      result = await pool.query("SELECT * FROM es_stats ORDER BY id DESC LIMIT 1");
    }

    if (!result.rows.length) return NextResponse.json(null);
    return NextResponse.json(result.rows[0]);
  } catch (err) {
    console.error("[/api/es-stats GET]", err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { expiration } = body;
    if (!expiration) return NextResponse.json({ error: "Missing expiration" }, { status: 400 });

    const pool = await getDb();
    await pool.query(
      `INSERT INTO es_stats (expiration, no_long, up, mid, down, no_short)
       VALUES ($1,$2,$3,$4,$5,$6)
       ON CONFLICT(expiration) DO UPDATE SET
         no_long  = CASE WHEN EXCLUDED.no_long  IS NOT NULL THEN EXCLUDED.no_long  ELSE es_stats.no_long  END,
         up       = CASE WHEN EXCLUDED.up        IS NOT NULL THEN EXCLUDED.up       ELSE es_stats.up       END,
         mid      = CASE WHEN EXCLUDED.mid       IS NOT NULL THEN EXCLUDED.mid      ELSE es_stats.mid      END,
         down     = CASE WHEN EXCLUDED.down      IS NOT NULL THEN EXCLUDED.down     ELSE es_stats.down     END,
         no_short = CASE WHEN EXCLUDED.no_short  IS NOT NULL THEN EXCLUDED.no_short ELSE es_stats.no_short END,
         updated_at = CURRENT_TIMESTAMP`,
      [expiration, body.no_long ?? null, body.up ?? null, body.mid ?? null, body.down ?? null, body.no_short ?? null]
    );
    return NextResponse.json({ ok: true, expiration });
  } catch (err) {
    console.error("[/api/es-stats POST]", err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
