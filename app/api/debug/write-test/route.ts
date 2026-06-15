import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const pool = await getDb();
    await pool.query(
      "CREATE TABLE IF NOT EXISTS _write_test (id SERIAL PRIMARY KEY, ts BIGINT, val TEXT)"
    );
    const result = await pool.query(
      "INSERT INTO _write_test (ts, val) VALUES ($1, $2) RETURNING id",
      [Date.now(), body.val ?? "ping"]
    );
    const id = result.rows[0]?.id;
    return NextResponse.json({ ok: true, id });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}

export async function GET() {
  try {
    const pool = await getDb();
    let rows: unknown[] = [];
    try {
      const r = await pool.query("SELECT * FROM _write_test ORDER BY id DESC LIMIT 10");
      rows = r.rows;
    } catch { rows = []; }
    return NextResponse.json({ rows });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
