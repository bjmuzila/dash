import { NextRequest, NextResponse } from "next/server";
import { getServerUserId } from "@/lib/supabase/server";
import { insertTickerEvent, getTickerEventCounts } from "@/lib/db";

const VALID = new Set(["click", "render"]);

// POST body accepts either a single event or a batch:
//   { ticker: "AAPL", event: "click", source?: "scanner" }
//   { events: [{ ticker, event }, ...], source?: "scanner" }
// Batching keeps high-volume 'render' impressions to one request per page load.
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const source = body.source == null ? null : String(body.source);

    const raw: Array<{ ticker?: unknown; event?: unknown }> = Array.isArray(body.events)
      ? body.events
      : [{ ticker: body.ticker, event: body.event }];

    // Dedupe (ticker,event) within a single request so a list that renders the
    // same ticker twice only logs one impression.
    const seen = new Set<string>();
    const events = raw
      .map((e) => ({
        ticker: e.ticker == null ? "" : String(e.ticker).trim().toUpperCase(),
        event: e.event == null ? "" : String(e.event),
      }))
      .filter((e) => e.ticker && VALID.has(e.event))
      .filter((e) => {
        const k = `${e.ticker}|${e.event}`;
        if (seen.has(k)) return false;
        seen.add(k);
        return true;
      });

    if (!events.length) return NextResponse.json({ ok: true, logged: 0 });

    let userId: string | null = null;
    try { userId = await getServerUserId(); } catch { /* guests are fine */ }

    // Best-effort; a logging failure must never break the UI.
    await Promise.all(
      events.map((e) =>
        insertTickerEvent({ ticker: e.ticker, event: e.event, source, user_id: userId }).catch(() => {})
      )
    );

    return NextResponse.json({ ok: true, logged: events.length });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}

// GET /api/ticker-event?sinceDays=7&source=em → aggregated click/render counts
// per ticker, optionally scoped to one surface (source omitted = all surfaces).
export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const sinceDays = Number(searchParams.get("sinceDays") ?? 0) || undefined;
    const source = searchParams.get("source") || undefined;
    const rows = await getTickerEventCounts(sinceDays, source);
    return NextResponse.json({ rows });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
