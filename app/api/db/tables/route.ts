import { NextRequest, NextResponse } from "next/server";
import { queryAll, queryOne } from "@/lib/db";

export interface DbTableInfo {
  name: string;
  approx_rows: number;
  today_rows?: number | null;
}

// Same priority list /api/db uses to pick a date column.
const DATE_COL_PRIORITY = ["date", "day", "entry_date", "work_date"];

// today-counts are exact COUNT(*)s across ~80 tables — cache them briefly so
// tab clicks / re-renders don't re-scan the DB.
let todayCache: { key: string; at: number; counts: Record<string, number | null> } | null = null;
const TODAY_TTL_MS = 60_000;

async function todayCounts(date: string): Promise<Record<string, number | null>> {
  if (todayCache && todayCache.key === date && Date.now() - todayCache.at < TODAY_TTL_MS) {
    return todayCache.counts;
  }
  const colRows = await queryAll<{ table_name: string; column_name: string }>(
    `SELECT table_name, column_name FROM information_schema.columns WHERE table_schema = 'public'`
  );
  const byTable = new Map<string, string[]>();
  for (const r of colRows) {
    const list = byTable.get(r.table_name) ?? [];
    list.push(r.column_name);
    byTable.set(r.table_name, list);
  }

  const counts: Record<string, number | null> = {};
  await Promise.all(
    [...byTable.entries()].map(async ([table, cols]) => {
      let expr: string | undefined;
      if (table === "trades") expr = `date(timestamp)`;
      else {
        const dc = DATE_COL_PRIORITY.find((c) => cols.includes(c));
        if (dc) expr = `"${dc}"`;
        else if (cols.includes("created_at")) expr = `created_at::date`;
        else if (cols.includes("timestamp")) expr = `date(timestamp)`;
      }
      if (!expr) { counts[table] = null; return; }
      try {
        const row = await queryOne<{ c: number }>(
          `SELECT COUNT(*) AS c FROM "${table}" WHERE ${expr} = ?`,
          [date]
        );
        counts[table] = Number(row?.c ?? 0);
      } catch { counts[table] = null; }
    })
  );
  todayCache = { key: date, at: Date.now(), counts };
  return counts;
}

/**
 * Lists every base table in the public schema (not a curated whitelist), so the
 * /database page can show literally everything being written to Postgres,
 * including tables added after this route was written. approx_rows comes from
 * pg_stat_user_tables (live tuple estimate) instead of COUNT(*) so listing ~70+
 * tables stays fast — it's a stats lookup, not a table scan.
 */
export async function GET(req: NextRequest) {
  try {
    const date = new URL(req.url).searchParams.get("today") ?? "";
    const rows = await queryAll<{ name: string; approx_rows: number }>(
      `SELECT t.table_name AS name, COALESCE(s.n_live_tup, 0)::int AS approx_rows
         FROM information_schema.tables t
         LEFT JOIN pg_stat_user_tables s
           ON s.relname = t.table_name AND s.schemaname = 'public'
        WHERE t.table_schema = 'public' AND t.table_type = 'BASE TABLE'
        ORDER BY t.table_name ASC`
    );
    if (!date) return NextResponse.json({ tables: rows });
    const counts = await todayCounts(date);
    return NextResponse.json({
      tables: rows.map((r) => ({ ...r, today_rows: counts[r.name] ?? null })),
    });
  } catch (err) {
    console.error("[/api/db/tables]", err);
    return NextResponse.json({ error: "Database error", detail: String(err) }, { status: 500 });
  }
}
