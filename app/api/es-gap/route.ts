import { NextRequest, NextResponse } from "next/server";
import { getEsGap, postEsGap, updateEsGapFill } from "@/lib/db";

// ES overnight gap — one row per trading day.
//   GET  ?date=YYYY-MM-DD      → that day's gap row (defaults to today ET)
//   POST { action:"post", ... } → cron posts the locked 9:30 gap row (write-once)
//   POST { action:"fill", ... } → cron pushes a ratcheting fill update
//
// Writes are gated by the shared internal token (same pattern as the other
// server-v2 cron-facing routes): without it, Clerk middleware would 302 these
// server-to-server calls to the landing page. Reads are open (the panel polls GET).

function etDateStr(d = new Date()): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit",
  }).formatToParts(d).filter((p) => p.type !== "literal")
    .reduce((a, p) => ({ ...a, [p.type]: p.value }), {} as Record<string, string>);
  return `${parts.year}-${parts.month}-${parts.day}`;
}

function tokenOk(req: NextRequest): boolean {
  const expected = process.env.INTERNAL_API_TOKEN;
  if (!expected) return true; // no token configured → allow (dev/local)
  return req.headers.get("x-internal-token") === expected;
}

export async function GET(req: NextRequest) {
  try {
    const date = req.nextUrl.searchParams.get("date") || etDateStr();
    const row = await getEsGap(date);
    return NextResponse.json({ date, gap: row });
  } catch (err) {
    console.error("[/api/es-gap GET]", err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    if (!tokenOk(req)) {
      return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    }
    const body = await req.json();
    const action = String(body.action || "");

    if (action === "post") {
      const date = String(body.date || "");
      const prior_close = Number(body.prior_close);
      const open_0930 = Number(body.open_0930);
      if (!date || !isFinite(prior_close) || !isFinite(open_0930)) {
        return NextResponse.json({ error: "missing date/prior_close/open_0930" }, { status: 400 });
      }
      const gap_pts = open_0930 - prior_close;
      const gap_dir = gap_pts > 0 ? "up" : gap_pts < 0 ? "down" : "flat";
      await postEsGap({
        date,
        symbol: body.symbol ? String(body.symbol) : "/ES",
        prior_close, open_0930, gap_pts, gap_dir,
        open_ts: Number(body.open_ts) || Date.now(),
      });
      const row = await getEsGap(date);
      return NextResponse.json({ ok: true, gap: row }, { status: 201 });
    }

    if (action === "fill") {
      const date = String(body.date || "");
      if (!date) return NextResponse.json({ error: "missing date" }, { status: 400 });
      await updateEsGapFill({
        date,
        pct_filled:    Number(body.pct_filled) || 0,
        extreme_after: Number(body.extreme_after),
        filled:        !!body.filled,
        fill_ts:       body.fill_ts != null ? Number(body.fill_ts) : null,
      });
      const row = await getEsGap(date);
      return NextResponse.json({ ok: true, gap: row });
    }

    return NextResponse.json({ error: `unknown action '${action}'` }, { status: 400 });
  } catch (err) {
    console.error("[/api/es-gap POST]", err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
