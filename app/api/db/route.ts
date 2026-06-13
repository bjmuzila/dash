import { NextRequest, NextResponse } from "next/server";
import { queryAll, getRecentTrades } from "@/lib/db";

const ALLOWED_TABLES = ["trades", "mvc", "premiumFlow", "greeksTs", "esCandles"];

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const table = searchParams.get("table") ?? "trades";
    const limit = Math.min(Number(searchParams.get("limit") ?? 100), 500);
    const date = searchParams.get("date");

    if (!ALLOWED_TABLES.includes(table)) {
      return NextResponse.json({ error: "Table not allowed" }, { status: 400 });
    }

    let rows: unknown[];
    if (table === "trades" && date) {
      rows = await queryAll(
        "SELECT * FROM trades WHERE date(timestamp) = ? ORDER BY timestamp DESC LIMIT ?",
        [date, limit]
      );
    } else if (table === "trades") {
      rows = await getRecentTrades(limit);
    } else {
      rows = await queryAll(
        `SELECT * FROM "${table}" ORDER BY rowid DESC LIMIT ?`,
        [limit]
      );
    }

    return NextResponse.json({ table, count: rows.length, rows });
  } catch (err) {
    console.error("[/api/db]", err);
    return NextResponse.json(
      { error: "Database error", detail: String(err) },
      { status: 500 }
    );
  }
}
