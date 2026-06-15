import { NextRequest, NextResponse } from "next/server";
import { getDb, persistDb } from "@/lib/db";

const CREATE_TABLE = `
  CREATE TABLE IF NOT EXISTS es_stats (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    expiration TEXT NOT NULL UNIQUE,
    no_long TEXT,
    up TEXT,
    mid TEXT,
    down TEXT,
    no_short TEXT,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )
`;

export async function GET() {
  try {
    const db = await getDb();
    db.run(CREATE_TABLE);
    let results = db.exec("SELECT * FROM es_stats WHERE expiration = 'WEEKLY' LIMIT 1");
    if (!results.length) results = db.exec("SELECT * FROM es_stats ORDER BY id DESC LIMIT 1");
    if (!results.length) return NextResponse.json(null);
    const { columns, values } = results[0];
    const row = Object.fromEntries(columns.map((col, i) => [col, values[0][i]]));
    return NextResponse.json(row);
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

    const db = await getDb();
    db.run(CREATE_TABLE);

    // Upsert row, only overwriting fields that were provided
    db.run(
      `INSERT INTO es_stats (expiration, no_long, up, mid, down, no_short)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(expiration) DO UPDATE SET
         no_long  = CASE WHEN excluded.no_long  IS NOT NULL THEN excluded.no_long  ELSE no_long  END,
         up       = CASE WHEN excluded.up        IS NOT NULL THEN excluded.up       ELSE up       END,
         mid      = CASE WHEN excluded.mid       IS NOT NULL THEN excluded.mid      ELSE mid      END,
         down     = CASE WHEN excluded.down      IS NOT NULL THEN excluded.down     ELSE down     END,
         no_short = CASE WHEN excluded.no_short  IS NOT NULL THEN excluded.no_short ELSE no_short END,
         updated_at = CURRENT_TIMESTAMP`,
      [expiration, body.no_long ?? null, body.up ?? null, body.mid ?? null, body.down ?? null, body.no_short ?? null]
    );
    persistDb();
    return NextResponse.json({ ok: true, expiration });
  } catch (err) {
    console.error("[/api/es-stats POST]", err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
