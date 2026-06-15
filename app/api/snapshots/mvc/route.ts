import { NextRequest, NextResponse } from "next/server";
import { insertMvcSnapshot, getMvcSnapshots } from "@/lib/db";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const now = new Date();
    const days = ["Sun","Mon","Tue","Wed","Thu","Fri","Sat"];
    const etDate = new Intl.DateTimeFormat("en-US", {
      timeZone: "America/New_York",
      year: "numeric", month: "2-digit", day: "2-digit",
    }).formatToParts(now).filter(p => p.type !== "literal")
      .reduce((a, p) => ({ ...a, [p.type]: p.value }), {} as Record<string, string>);

    const id = await insertMvcSnapshot({
      timestamp:       body.timestamp ?? now.getTime(),
      date:            body.date ?? `${etDate.year}-${etDate.month}-${etDate.day}`,
      day:             body.day  ?? days[now.getDay()],
      time:            body.time ?? now.toTimeString().split(" ")[0],
      strikeOIVol:     body.strikeOIVol     ?? null,
      mvcValueOIVol:   body.mvcValueOIVol   ?? 0,
      pctOI_Vol:       body.pctOI_Vol       ?? null,
      volumeOIVol:     body.volumeOIVol     ?? 0,
      totalNetGEX_OI:  body.totalNetGEX_OI  ?? 0,
      strikeVolOnly:   body.strikeVolOnly   ?? null,
      mvcValueVolOnly: body.mvcValueVolOnly ?? 0,
      pctVol_Only:     body.pctVol_Only     ?? null,
      volumeVolOnly:   body.volumeVolOnly   ?? 0,
      totalNetGEX_Vol: body.totalNetGEX_Vol ?? 0,
      spxPrice:        body.spxPrice        ?? 0,
      esPrice:         body.esPrice         ?? 0,
      netDEXStrike:    body.netDEXStrike    ?? null,
      totalNetDEX_OI:  body.totalNetDEX_OI  ?? null,
      totalNetDEX_Vol: body.totalNetDEX_Vol ?? null,
      totalAbsNetGEX:  body.totalAbsNetGEX  ?? 0,
      gexFlip:         body.gexFlip         ?? null,
      triggerType:     body.triggerType     ?? "manual",
      expiration:      body.expiration      ?? "—",
    });
    return NextResponse.json({ ok: true, id });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const date  = searchParams.get("date")  ?? undefined;
    const limit = Math.min(Number(searchParams.get("limit") ?? 200), 1000);
    const rows  = await getMvcSnapshots(date, limit);
    return NextResponse.json({ rows });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
