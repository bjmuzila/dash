import { NextRequest, NextResponse } from "next/server";
import { insertBzilaSnapshot, getLatestBzilaSnapshot, getBzilaSnapshots } from "@/lib/db";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const now = new Date();
    const etDate = new Intl.DateTimeFormat("en-US", {
      timeZone: "America/New_York",
      year: "numeric", month: "2-digit", day: "2-digit",
    }).formatToParts(now).filter(p => p.type !== "literal")
      .reduce((a, p) => ({ ...a, [p.type]: p.value }), {} as Record<string, string>);

    const id = await insertBzilaSnapshot({
      timestamp: body.timestamp ?? now.getTime(),
      date:      body.date ?? `${etDate.year}-${etDate.month}-${etDate.day}`,
      time:      body.time ?? now.toTimeString().split(" ")[0],
      ticker:    body.ticker ?? "SPX",
      session:   body.session ?? "rth",
      orders:    Array.isArray(body.orders) ? body.orders : [],
      stats:     body.stats ?? {},
    });
    return NextResponse.json({ ok: true, id });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const date    = searchParams.get("date") ?? undefined;
    const session = searchParams.get("session") ?? undefined;
    const latest  = searchParams.get("latest") === "1";
    const limit   = Math.min(Number(searchParams.get("limit") ?? 200), 1000);

    if (latest) {
      const snap = await getLatestBzilaSnapshot(date, session);
      return NextResponse.json({ snap });
    }
    const rows = await getBzilaSnapshots(date, limit);
    // Parse JSON fields for API consumers
    const parsed = rows.map(r => ({
      ...r,
      orders: typeof r.orders === "string" ? JSON.parse(r.orders) : r.orders,
      stats:  typeof r.stats  === "string" ? JSON.parse(r.stats)  : r.stats,
    }));
    return NextResponse.json({ rows: parsed });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
