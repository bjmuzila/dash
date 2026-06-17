import { NextRequest, NextResponse } from "next/server";
import { queryAll, getRecentTrades } from "@/lib/db";

const ALLOWED_TABLES: Record<string, { dateCol?: string }> = {
  trades:            { dateCol: "date(timestamp)" },
  snapshots:         { dateCol: "date" },
  flow_calls:        { dateCol: "date" },
  mvc_snapshots:     { dateCol: "date" },
  premium_flow:      { dateCol: "date" },
  greeks_ts:         { dateCol: "date" },
  playbook_feed:     { dateCol: "date" },
  page_load_status:  {},
  es_candles:        { dateCol: "date" },
  bzila_snapshots:   { dateCol: "date" },
  bzila_gex_history: { dateCol: "date" },
  bzila_strike_gex_history: { dateCol: "date" },
  expirations_cache: {},
};

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const table = searchParams.get("table") ?? "mvc_snapshots";
    const limit = Math.min(Number(searchParams.get("limit") ?? 200), 1000);
    const date  = searchParams.get("date") ?? "";

    if (!ALLOWED_TABLES[table]) {
      return NextResponse.json({ error: "Table not allowed" }, { status: 400 });
    }

    let rows: unknown[];
    const meta = ALLOWED_TABLES[table];

    if (table === "trades") {
      if (date) {
        rows = await queryAll(
          "SELECT * FROM trades WHERE date(timestamp) = ? ORDER BY timestamp DESC LIMIT ?",
          [date, limit]
        );
      } else {
        rows = await getRecentTrades(limit);
      }
    } else if (date && meta.dateCol) {
      rows = await queryAll(
        `SELECT * FROM "${table}" WHERE ${meta.dateCol} = ? ORDER BY id DESC LIMIT ?`,
        [date, limit]
      );
    } else {
      rows = await queryAll(
        `SELECT * FROM "${table}" ORDER BY id DESC LIMIT ?`,
        [limit]
      );
    }

    // Filter flow_calls by size >= 100
    if (table === "flow_calls") {
      rows = rows.filter(r => {
        const size = typeof r === "object" && r !== null && "size" in r ? (r as Record<string, unknown>).size : 0;
        return typeof size === "number" && size >= 100;
      });
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
