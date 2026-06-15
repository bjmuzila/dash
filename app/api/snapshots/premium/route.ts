import { NextRequest, NextResponse } from "next/server";
import { insertPremiumFlow, getPremiumFlow } from "@/lib/db";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const now = new Date();
    const etDate = new Intl.DateTimeFormat("en-US", {
      timeZone: "America/New_York",
      year: "numeric", month: "2-digit", day: "2-digit",
    }).formatToParts(now).filter(p => p.type !== "literal")
      .reduce((a, p) => ({ ...a, [p.type]: p.value }), {} as Record<string, string>);

    await insertPremiumFlow({
      timestamp:    body.timestamp  ?? now.getTime(),
      date:         body.date       ?? `${etDate.year}-${etDate.month}-${etDate.day}`,
      time:         body.time       ?? now.toTimeString().split(" ")[0],
      callPremium:  body.callPremium ?? 0,
      putPremium:   body.putPremium  ?? 0,
      netPremium:   body.netPremium  ?? 0,
      spxPrice:     body.spxPrice    ?? 0,
    });
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const date  = searchParams.get("date")  ?? undefined;
    const limit = Math.min(Number(searchParams.get("limit") ?? 500), 2000);
    const rows  = await getPremiumFlow(date, limit);
    return NextResponse.json({ rows });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
