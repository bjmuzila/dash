import { NextResponse } from "next/server";
import { insertFlowCalls, getFlowCalls } from "@/lib/db";

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const calls = Array.isArray(body) ? body : [body];
    await insertFlowCalls(calls);
    return NextResponse.json({ ok: true, count: calls.length });
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const date = searchParams.get("date") ?? new Date().toISOString().slice(0, 10);
    const limit = Number(searchParams.get("limit") ?? 500);
    const rows = await getFlowCalls(date, limit);
    return NextResponse.json(rows);
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
