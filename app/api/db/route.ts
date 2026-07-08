import { NextRequest, NextResponse } from "next/server";
import { queryAll, queryOne, getRecentTrades } from "@/lib/db";

// Column priority used to pick an ORDER BY / date-filter column when a table
// doesn't fit the old hardcoded whitelist. Every real table in this schema has
// at least one of these.
const ORDER_COL_PRIORITY = ["id", "created_at", "ts", "timestamp", "updated_at"];
const DATE_COL_PRIORITY = ["date", "day", "entry_date", "work_date"];

async function tableExists(table: string): Promise<boolean> {
  const row = await queryOne<{ ok: boolean }>(
    `SELECT true AS ok FROM information_schema.tables
      WHERE table_schema = 'public' AND table_type = 'BASE TABLE' AND table_name = ?`,
    [table]
  );
  return !!row?.ok;
}

async function getColumns(table: string): Promise<string[]> {
  const rows = await queryAll<{ column_name: string }>(
    `SELECT column_name FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = ? ORDER BY ordinal_position`,
    [table]
  );
  return rows.map((r) => r.column_name);
}

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const table = searchParams.get("table") ?? "mvc_snapshots";
    const limit = Math.min(Number(searchParams.get("limit") ?? 200), 1000);
    const date = searchParams.get("date") ?? "";
    const countOnly = searchParams.get("countOnly") === "true";

    // Validate against the real table list (information_schema), not a curated
    // whitelist — this is what lets the /database page browse EVERY table.
    if (!(await tableExists(table))) {
      return NextResponse.json({ error: "Table not allowed" }, { status: 400 });
    }

    // Trades keeps its bespoke path (existing behavior / index usage).
    if (table === "trades") {
      if (countOnly) {
        const row = date
          ? await queryOne<{ c: number }>(`SELECT COUNT(*) AS c FROM trades WHERE date(timestamp) = ?`, [date])
          : await queryOne<{ c: number }>(`SELECT COUNT(*) AS c FROM trades`);
        return NextResponse.json({ table, count: Number(row?.c ?? 0) });
      }
      const rows = date
        ? await queryAll(`SELECT * FROM trades WHERE date(timestamp) = ? ORDER BY timestamp DESC LIMIT ?`, [date, limit])
        : await getRecentTrades(limit);
      return NextResponse.json({ table, count: rows.length, rows });
    }

    const cols = await getColumns(table);
    const orderCol = ORDER_COL_PRIORITY.find((c) => cols.includes(c));
    const dateCol = DATE_COL_PRIORITY.find((c) => cols.includes(c))
      ?? (cols.includes("created_at") ? "created_at::date" : undefined);

    if (countOnly) {
      let row: { c?: number } | null | undefined;
      if (date && dateCol) {
        row = await queryOne<{ c: number }>(`SELECT COUNT(*) AS c FROM "${table}" WHERE ${dateCol} = ?`, [date]);
      } else {
        row = await queryOne<{ c: number }>(`SELECT COUNT(*) AS c FROM "${table}"`);
      }
      return NextResponse.json({ table, count: Number(row?.c ?? 0) });
    }

    const orderSql = orderCol ? ` ORDER BY "${orderCol}" DESC` : "";
    let rows: unknown[];
    if (date && dateCol) {
      rows = await queryAll(`SELECT * FROM "${table}" WHERE ${dateCol} = ?${orderSql} LIMIT ?`, [date, limit]);
    } else {
      rows = await queryAll(`SELECT * FROM "${table}"${orderSql} LIMIT ?`, [limit]);
    }

    // Filter flow_calls by size >= 100 (existing behavior, preserved).
    if (table === "flow_calls") {
      rows = rows.filter((r) => {
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
