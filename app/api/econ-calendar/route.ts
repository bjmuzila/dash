import { NextResponse } from "next/server";
import { readFileSync, writeFileSync } from "fs";
import { join } from "path";

const EVENTS_PATH = join(process.cwd(), "app/api/econ-calendar/events.json");

function readEvents() {
  try {
    return JSON.parse(readFileSync(EVENTS_PATH, "utf-8"));
  } catch {
    return [];
  }
}

export async function GET() {
  return NextResponse.json(readEvents(), {
    headers: { "Cache-Control": "no-store" },
  });
}

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const events = Array.isArray(body) ? body : body.events;
    if (!Array.isArray(events)) {
      return NextResponse.json({ error: "Expected array or { events: [] }" }, { status: 400 });
    }
    writeFileSync(EVENTS_PATH, JSON.stringify(events, null, 2), "utf-8");
    return NextResponse.json({ ok: true, count: events.length });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
