import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import type { SqlValue } from "sql.js";

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const period = searchParams.get("period");

    const db = await getDb();
    let sql = "SELECT * FROM snapshots";
    const params: SqlValue[] = [];

    if (period) {
      sql += " WHERE period = ?";
      params.push(period);
    }

    sql += " ORDER BY id DESC";

    const results = db.exec(sql, params);
    if (!results.length) {
      return NextResponse.json([]);
    }

    const { columns, values } = results[0];
    const snapshots = values.map((row) => {
      const obj = Object.fromEntries(columns.map((col, i) => [col, row[i]])) as any;
      return {
        ...obj,
        expirations: obj.expirations ? JSON.parse(obj.expirations) : [],
      };
    });

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
      return NextResponse.json(
        { error: "Missing required fields" },
        { status: 400 }
      );
    }

    const db = await getDb();

    // Ensure table exists
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

    const sql = `
      INSERT INTO snapshots (timestamp, date, time, period, tableHtml, expirations)
      VALUES (?, ?, ?, ?, ?, ?)
    `;

    db.run(sql, [
      timestamp,
      date,
      time,
      period,
      tableHtml,
      JSON.stringify(expirations || []),
    ]);

    // Get the last inserted ID
    const idResult = db.exec("SELECT last_insert_rowid() as id");
    const lastId = idResult.length > 0 ? idResult[0].values[0][0] : null;

    return NextResponse.json(
      {
        id: lastId,
        timestamp,
        date,
        time,
        period,
        tableHtml,
        expirations: expirations || [],
      },
      { status: 201 }
    );
  } catch (err) {
    console.error("[/api/snapshots POST]", err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
