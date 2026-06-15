import { NextRequest, NextResponse } from "next/server";
import { insertGreeksTs, getGreeksTs } from "@/lib/db";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const now = new Date();
    const etDate = new Intl.DateTimeFormat("en-US", {
      timeZone: "America/New_York",
      year: "numeric", month: "2-digit", day: "2-digit",
    }).formatToParts(now).filter(p => p.type !== "literal")
      .reduce((a, p) => ({ ...a, [p.type]: p.value }), {} as Record<string, string>);

    const gexB  = Number(body.gex  ?? 0);
    const dexB  = Number(body.dex  ?? 0);
    const chexM = Number(body.chex ?? 0);
    const vexM  = Number(body.vex  ?? 0);

    await insertGreeksTs({
      timestamp: body.timestamp ?? now.getTime(),
      date:      body.date ?? `${etDate.year}-${etDate.month}-${etDate.day}`,
      time:      body.time ?? now.toTimeString().split(" ")[0],
      ticker:    body.ticker ?? "SPXW",
      price:     Number(body.price ?? 0),
      gexRaw:    gexB * 1e9,
      dexRaw:    dexB * 1e9,
      chexRaw:   chexM * 1e6,
      vexRaw:    vexM * 1e6,
      gex:       gexB,
      dex:       dexB,
      chex:      chexM,
      vex:       vexM,
      buyScore:  Number(body.buyScore  ?? 0),
      sellScore: Number(body.sellScore ?? 0),
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
    const limit = Math.min(Number(searchParams.get("limit") ?? 1000), 5000);
    const rows  = await getGreeksTs(date, limit);
    return NextResponse.json({ rows });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
