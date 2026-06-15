import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const period = searchParams.get("period");

    const pool = await getDb();
    let sql = `SELECT * FROM snapshots`;
    const params: unknown[] = [];

    if (period) {
      sql += " WHERE period = $1";
      params.push(period);
    }

    sql += " ORDER BY id DESC";

    const result = await pool.query(sql, params);
    const snapshots = result.rows.map((row: any) => ({
      ...row,
      expirations: row.expirations ? JSON.parse(row.expirations) : [],
    }));

    return NextResponse.json(snapshots);
  } catch (err) {
    console.error("[/api/snapshots GET]", err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { timestamp, date, time, period, tableHtml, expirations } = body;

    if (!timestamp || !date || !time || !period || !tableHtml) {
      return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
    }

    const pool = await getDb();
    const result = await pool.query(
      `INSERT INTO snapshots (timestamp, date, time, period, "tableHtml", expirations)
       VALUES ($1,$2,$3,$4,$5,$6) RETURNING id`,
      [timestamp, date, time, period, tableHtml, JSON.stringify(expirations || [])]
    );
    const lastId = result.rows[0]?.id ?? null;

    return NextResponse.json(
      { id: lastId, timestamp, date, time, period, tableHtml, expirations: expirations || [] },
      { status: 201 }
    );
  } catch (err) {
    console.error("[/api/snapshots POST]", err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
