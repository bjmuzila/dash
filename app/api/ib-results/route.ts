import { NextRequest, NextResponse } from "next/server";
import {
  getEsCandles, getNqCandles, getIbTrailingStats,
  upsertIbDailyResult, getIbDailyResults,
  type EsCandleDbRecord, type IbDailyResultRow,
} from "@/lib/db";
import { computeIbDaily, classifyWidth, type IbBar } from "@/lib/ibDaily";

// EOD IB results.
//   GET  ?symbol=ES|NQ&limit=90        → { rows } newest first (the Results table)
//   POST { action:"record", date? }    → compute + upsert ES and NQ for the date
//                                        (default: today ET). Token-gated; the
//                                        server-v2 ib-results-recorder calls this
//                                        daily at 16:30 ET.
// Compute lives in lib/ibDaily.ts — same rule semantics as the live RuleBoard.

export const dynamic = "force-dynamic";

const SYMBOLS = [
  { symbol: "ES", table: "es_candles" as const, get: getEsCandles },
  { symbol: "NQ", table: "nq_candles" as const, get: getNqCandles },
];

function etDateStr(d = new Date()): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit",
  }).formatToParts(d).filter((p) => p.type !== "literal")
    .reduce((a, p) => ({ ...a, [p.type]: p.value }), {} as Record<string, string>);
  return `${parts.year}-${parts.month}-${parts.day}`;
}

function tokenOk(req: NextRequest): boolean {
  const expected = process.env.INTERNAL_API_TOKEN;
  if (!expected) return true; // dev/local
  return req.headers.get("x-internal-token") === expected;
}

/** DB candle rows → RTH IbBars. `time` is zero-padded ET 'HH:MM'. */
function toRthBars(rows: EsCandleDbRecord[]): IbBar[] {
  return rows
    .map((r) => {
      const [h, m] = String(r.time || "").split(":").map(Number);
      return {
        min: (Number.isFinite(h) ? h : 0) * 60 + (Number.isFinite(m) ? m : 0),
        o: Number(r.open), h: Number(r.high), l: Number(r.low), c: Number(r.close),
        v: Number(r.volume ?? 0),
      };
    })
    .filter((b) => b.min >= 570 && b.min < 960 && Number.isFinite(b.c) && b.h >= b.l)
    .sort((a, b) => a.min - b.min);
}

const b01 = (v: boolean | null | undefined) => (v == null ? null : v ? 1 : 0);

async function recordSymbol(
  symbol: string,
  table: "es_candles" | "nq_candles",
  get: typeof getEsCandles,
  date: string
): Promise<boolean> {
  const bars = toRthBars(await get(date, undefined, 2000));
  if (bars.length < 3) return false;

  // Trailing sessions before `date`: width bucket + prior RTH range (rule 11).
  const trailing = await getIbTrailingStats(table, date, 70);
  const priorDate = trailing.length ? trailing[trailing.length - 1].date : null;
  let priorRth: { high: number; low: number } | null = null;
  if (priorDate) {
    const prior = toRthBars(await get(priorDate, undefined, 2000));
    if (prior.length) {
      priorRth = { high: Math.max(...prior.map((b) => b.h)), low: Math.min(...prior.map((b) => b.l)) };
    }
  }

  const ibBars = bars.filter((b) => b.min < 630);
  const width = ibBars.length ? Math.max(...ibBars.map((b) => b.h)) - Math.min(...ibBars.map((b) => b.l)) : 0;
  const rec = computeIbDaily(bars, priorRth, classifyWidth(width, trailing));
  if (!rec) return false;

  const row: Omit<IbDailyResultRow, "id"> = {
    date, symbol,
    ib_high: rec.ibHigh, ib_low: rec.ibLow, ib_mid: rec.ibMid, ib_width: rec.ibWidth,
    width_bucket: rec.widthBucket, bias: rec.bias, first_formed: rec.first,
    close_zone: rec.closeZone, open_type: rec.openType, orb_dir: rec.orbDir, fvg: rec.fvg,
    break_side: rec.breakSide, break_min: rec.breakMin,
    failed: b01(rec.failed), retest: b01(rec.retest), retest_cont: b01(rec.retestCont),
    vol_surge: b01(rec.volSurge),
    single_break: b01(rec.singleBreak), both_broke: b01(rec.bothBroke), neither_broke: b01(rec.neitherBroke),
    contained_at2: b01(rec.containedAt2), contained_broke_late: b01(rec.containedBrokeLate),
    ext_05: b01(rec.ext05), ext_10: b01(rec.ext10), ext_15: b01(rec.ext15), ext_20: b01(rec.ext20),
    first_touch_side: rec.firstTouchSide, first_touch_min: rec.firstTouchMin,
    day_high: rec.dayHigh, day_low: rec.dayLow, day_close: rec.dayClose,
    rules: rec.rules, computed_at: Date.now(),
  };
  await upsertIbDailyResult(row);
  return true;
}

export async function GET(req: NextRequest) {
  try {
    const u = new URL(req.url);
    const symbol = (u.searchParams.get("symbol") || "ES").toUpperCase() === "NQ" ? "NQ" : "ES";
    const limit = Math.min(365, Math.max(1, Number(u.searchParams.get("limit") || 90)));
    const rows = await getIbDailyResults(symbol, limit);
    return NextResponse.json({ symbol, rows });
  } catch (e) {
    return NextResponse.json({ error: String((e as Error)?.message || e) }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  if (!tokenOk(req)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  try {
    const body = await req.json().catch(() => ({}));
    if (body?.action !== "record") {
      return NextResponse.json({ error: "unknown action" }, { status: 400 });
    }
    const date = typeof body.date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(body.date)
      ? body.date : etDateStr();

    const saved: string[] = [];
    for (const { symbol, table, get } of SYMBOLS) {
      try {
        if (await recordSymbol(symbol, table, get, date)) saved.push(symbol);
      } catch (e) {
        console.warn(`[ib-results] ${symbol} ${date} —`, (e as Error)?.message || e);
      }
    }
    return NextResponse.json({ date, saved });
  } catch (e) {
    return NextResponse.json({ error: String((e as Error)?.message || e) }, { status: 500 });
  }
}
