import { NextRequest, NextResponse } from "next/server";
import { insertBzilaGexPoint, getBzilaGexHistory } from "@/lib/db";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const points = Array.isArray(body) ? body : [body];
    for (const p of points) {
      const date = p.date ?? new Date(p.timestamp).toISOString().slice(0, 10);
      await insertBzilaGexPoint({
        timestamp: Number(p.timestamp),
        date,
        session: p.session === "ext" ? "ext" : "rth",
        call: Number(p.call ?? 0),
        put:  Number(p.put  ?? 0),
        net:  Number(p.net  ?? 0),
        spot: Number(p.spot ?? 0),
      });
    }
    return NextResponse.json({ ok: true, count: points.length });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const date = searchParams.get("date") ?? new Date().toISOString().slice(0, 10);
    const session = searchParams.get("session") ?? undefined;
    const rows = await getBzilaGexHistory(date, session === "ext" ? "ext" : session === "rth" ? "rth" : undefined);
    return NextResponse.json({ rows });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
