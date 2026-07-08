import { NextResponse } from "next/server";
import { queryAll } from "@/lib/db";

export interface DbTableInfo {
  name: string;
  approx_rows: number;
}

/**
 * Lists every base table in the public schema (not a curated whitelist), so the
 * /database page can show literally everything being written to Postgres,
 * including tables added after this route was written. approx_rows comes from
 * pg_stat_user_tables (live tuple estimate) instead of COUNT(*) so listing ~70+
 * tables stays fast — it's a stats lookup, not a table scan.
 */
export async function GET() {
  try {
    const rows = await queryAll<{ name: string; approx_rows: number }>(
      `SELECT t.table_name AS name, COALESCE(s.n_live_tup, 0)::int AS approx_rows
         FROM information_schema.tables t
         LEFT JOIN pg_stat_user_tables s
           ON s.relname = t.table_name AND s.schemaname = 'public'
        WHERE t.table_schema = 'public' AND t.table_type = 'BASE TABLE'
        ORDER BY t.table_name ASC`
    );
    return NextResponse.json({ tables: rows });
  } catch (err) {
    console.error("[/api/db/tables]", err);
    return NextResponse.json({ error: "Database error", detail: String(err) }, { status: 500 });
  }
}
