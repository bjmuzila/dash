import { NextRequest, NextResponse } from "next/server";
import { getPlaybookFeed, insertPlaybookFeed } from "@/lib/db";

function etDateParts(now: Date) {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now).filter((p) => p.type !== "literal")
    .reduce((acc, part) => ({ ...acc, [part.type]: part.value }), {} as Record<string, string>);
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const now = new Date();
    const etDate = etDateParts(now);

    const id = await insertPlaybookFeed({
      timestamp: Number(body.timestamp ?? now.getTime()),
      date: body.date ?? `${etDate.year}-${etDate.month}-${etDate.day}`,
      time: body.time ?? now.toTimeString().split(" ")[0],
      text: String(body.text ?? ""),
      color: body.color ? String(body.color) : null,
      source: body.source ? String(body.source) : "insights-exposure",
      expiry: body.expiry ? String(body.expiry) : null,
      regime_key: body.regimeKey ? String(body.regimeKey) : null,
      spot: body.spot == null ? null : Number(body.spot),
      gex: body.gex == null ? null : Number(body.gex),
      dex: body.dex == null ? null : Number(body.dex),
      chex: body.chex == null ? null : Number(body.chex),
      vex: body.vex == null ? null : Number(body.vex),
    });

    return NextResponse.json({ ok: true, id });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const date = searchParams.get("date") ?? undefined;
    const limit = Math.min(Number(searchParams.get("limit") ?? 200), 2000);
    const rows = await getPlaybookFeed(date, limit);
    return NextResponse.json({ rows });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
