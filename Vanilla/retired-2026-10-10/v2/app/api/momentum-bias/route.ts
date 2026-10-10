import { NextRequest, NextResponse } from "next/server";
import { getMomentumBiasSignals, getMomentumBiasSummary } from "@/lib/db";

// Momentum Bias signals reader (read-only).
//   GET ?date=YYYY-MM-DD   → { date, signals, summary } for a single ET date
//   GET ?since=YYYY-MM-DD  → signals on/after a date (newest first)
//   GET ?all=1             → most recent signals across all dates
//
// Recording + grading happen in-process (the feed records CLOSED-bar TP triggers
// in _flushEsCandles; server-v2/momentum-bias-tracker grades them). This route
// just surfaces momentum_bias_signals for a card / verification.

export const dynamic = "force-dynamic";

function etDateStr(d = new Date()): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit",
  }).formatToParts(d).filter((p) => p.type !== "literal")
    .reduce((a, p) => ({ ...a, [p.type]: p.value }), {} as Record<string, string>);
  return `${parts.year}-${parts.month}-${parts.day}`;
}

export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const since = sp.get("since") || undefined;
  const all = sp.get("all") === "1";
  const limit = Math.min(1000, Math.max(1, Number(sp.get("limit")) || 200));
  const date = all || since ? undefined : (sp.get("date") || etDateStr());

  try {
    const [signals, summary] = await Promise.all([
      getMomentumBiasSignals({ date, sinceDate: since, limit }),
      getMomentumBiasSummary({ date, sinceDate: since }),
    ]);
    return NextResponse.json({ date: date ?? null, since: since ?? null, signals, summary });
  } catch (e) {
    return NextResponse.json(
      { error: (e as Error).message, signals: [], summary: [] },
      { status: 500 }
    );
  }
}
