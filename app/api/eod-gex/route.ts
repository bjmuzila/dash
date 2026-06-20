import { NextRequest, NextResponse } from "next/server";
import { getEodGex } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  try {
    const sp = new URL(req.url).searchParams;
    const date   = sp.get("date")   ?? "";
    const symbol = sp.get("symbol") ?? "";
    const limit  = Math.min(Number(sp.get("limit") ?? 200), 1000);

    const rows = await getEodGex({
      date:   date   || undefined,
      symbol: symbol || undefined,
      limit,
    });

    return NextResponse.json({ count: rows.length, rows });
  } catch (err) {
    console.error("[/api/eod-gex]", err);
    return NextResponse.json(
      { error: "Database error", detail: String(err) },
      { status: 500 }
    );
  }
}
