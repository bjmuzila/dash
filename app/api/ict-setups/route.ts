import { NextRequest, NextResponse } from "next/server";
import {
  insertIctSetup, updateIctSetupGrade, getIctSetups, getPendingIctSetups,
  getIctSetupSummary, getEsCandles, type IctSetupRecord,
} from "@/lib/db";
import { analyzeICT, type IctCandle } from "@/lib/calculations/ictConcepts";

// ICT setup recorder.
//   GET  ?date=YYYY-MM-DD            → { setups, summary } for the recap panel
//   POST { action:"scan", date }     → detect every live setup over the day's
//                                       candles, record new ones, grade pending
//   POST { action:"grade", date }    → grade pending only (no new detection)
//
// Detection reuses the SAME analyzeICT the /ict page renders — one source of
// truth. The server-v2 cron (ict-setup-tracker) calls action:"scan" every 5m
// during RTH; writes are token-gated like the other server-facing routes.

const INTERVAL_MS = 5 * 60_000;

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

// ── Candle fetch — read Postgres directly (no self-referential HTTP) ─────────
// Previously fetched `${origin}/api/snapshots/candles`; behind the proxy `origin`
// resolves to the public https host, so the in-process loopback got ECONNREFUSED.
// getEsCandles returns the SAME rows that endpoint serves.
async function fetchCandles(_origin: string, date: string): Promise<IctCandle[]> {
  const rows = await getEsCandles(date, undefined, 2000);
  return rows
    .map((c) => ({
      timestamp: Number(c.timestamp),
      open: Number(c.open), high: Number(c.high), low: Number(c.low), close: Number(c.close),
      volume: Number(c.volume ?? 0), date: String(c.date ?? date),
    }))
    .filter((c: IctCandle) => Number.isFinite(c.timestamp) && c.high >= c.low)
    .sort((a: IctCandle, b: IctCandle) => a.timestamp - b.timestamp);
}

// ── A normalized "setup to record" extracted from an IctAnalysis ─────────────
type Detected = {
  kind: string; label: string; dir: "bull" | "bear" | "neutral";
  trigger_ts: number; price: number; note: string;
  target: number | null; invalidation: number | null;
};

const round2 = (n: number) => Math.round(n * 100) / 100;
const keyFor = (d: Detected) => `${d.kind}:${d.dir}:${d.trigger_ts}:${Math.round(d.price)}`;

/**
 * Flatten an IctAnalysis into the discrete, timestamped setups worth recording —
 * every concept that "fires" at a specific bar. Standing context (bias, dealing
 * range as a whole, PD zones) is intentionally NOT recorded; only point-in-time
 * triggers get a row. target/invalidation seed the follow-through grader.
 */
function extractSetups(candles: IctCandle[]): Detected[] {
  const a = analyzeICT(candles);
  const out: Detected[] = [];
  const lastClose = candles.length ? candles[candles.length - 1].close : 0;

  // Nearest unswept liquidity pool beyond `price` in `dir` → a natural target.
  const drawTarget = (dir: "bull" | "bear", price: number): number | null => {
    const pools = a.liquidity.filter((p) => !p.swept);
    const cands = pools
      .map((p) => p.price)
      .filter((lvl) => (dir === "bull" ? lvl > price : lvl < price));
    if (!cands.length) return a.range ? (dir === "bull" ? a.range.high : a.range.low) : null;
    return dir === "bull" ? Math.min(...cands) : Math.max(...cands);
  };

  // Generic event push with structure-derived target/invalidation.
  const pushEvent = (
    kind: string, label: string, dir: "bull" | "bear",
    ts: number, price: number, note: string,
  ) => {
    const target = drawTarget(dir, price);
    // Invalidation = a buffer beyond the trigger level on the wrong side.
    const buf = Math.max(2, Math.abs((target ?? price) - price) * 0.5);
    const invalidation = dir === "bull" ? price - buf : price + buf;
    out.push({ kind, label, dir, trigger_ts: ts, price, note, target, invalidation });
  };

  // Structure breaks: BOS / CHOCH / MSS
  for (const s of a.structure) {
    const label = s.kind;
    pushEvent(s.kind.toLowerCase(), label, s.dir, s.ts, s.price,
      `${s.kind} ${s.dir} @ ${round2(s.price)}`);
  }
  // Displacement legs
  for (const d of a.displacement) {
    pushEvent("displacement", "Displacement", d.dir, d.endTs, d.endPrice,
      `displacement ${d.dir} ×${round2(d.bodyRatio)} ATR`);
  }
  // Liquidity sweeps (only the moment a pool is swept counts as an event)
  for (const p of a.liquidity) {
    if (!p.swept) continue;
    const sweepBar = candles.find((c) => c.timestamp > p.ts &&
      (p.side === "BSL" ? c.high > p.price : c.low < p.price));
    if (!sweepBar) continue;
    // A sweep is a reversal cue → expected move OPPOSITE the sweep direction.
    const dir: "bull" | "bear" = p.side === "BSL" ? "bear" : "bull";
    const kind = p.count >= 2 ? "eqhl" : "liquidity";
    const label = p.count >= 2 ? `EQ${p.side === "BSL" ? "H" : "L"} swept` : `${p.side} swept`;
    pushEvent(kind, label, dir, sweepBar.timestamp, p.price,
      `${p.side}${p.count > 1 ? ` ×${p.count}` : ""} swept @ ${round2(p.price)}`);
  }
  // Model / signal detectors (already point-in-time, with their own dir)
  const signalGroups = [
    { sigs: a.inducement, label: "Inducement" },
    { sigs: a.turtleSoup, label: "Turtle Soup" },
    { sigs: a.judas,      label: "Judas Swing" },
    { sigs: a.breakers,   label: "Breaker" },
    { sigs: a.cisd,       label: "CISD" },
    { sigs: a.model2022,  label: "2022 Model" },
  ];
  for (const { sigs, label } of signalGroups) {
    for (const s of sigs) {
      pushEvent(s.kind, label, s.dir, s.ts, s.price, s.note ?? `${label} ${s.dir}`);
    }
  }
  // FVG / IFVG creation (the bar the gap is confirmed). dir = activeDir.
  for (const f of a.fvgs) {
    const ts = f.inverted && f.invertedTs ? f.invertedTs : f.ts;
    const mid = (f.top + f.bottom) / 2;
    pushEvent(f.inverted ? "ifvg" : "fvg", f.inverted ? "IFVG" : "FVG",
      f.activeDir, ts, mid,
      `${f.inverted ? "IFVG" : "FVG"} ${f.activeDir} ${round2(f.bottom)}–${round2(f.top)}`);
  }
  // Valid order blocks (swept + imbalance) — the tradeable ones
  for (const o of a.orderBlocks) {
    if (!o.valid) continue;
    const edge = o.dir === "bull" ? o.bottom : o.top;
    pushEvent("ob", "Order Block", o.dir, o.ts, edge,
      `OB ${o.dir} ${round2(o.bottom)}–${round2(o.top)}`);
  }
  // OTE band entry: record the first bar that trades into the OTE zone
  if (a.range) {
    const lo = Math.min(a.range.ote.from, a.range.ote.to);
    const hi = Math.max(a.range.ote.from, a.range.ote.to);
    const entry = candles.find((c) => c.low <= hi && c.high >= lo);
    if (entry) {
      pushEvent("ote", "OTE entry", a.range.dir, entry.timestamp, (lo + hi) / 2,
        `OTE ${round2(lo)}–${round2(hi)} (${a.range.dir})`);
    }
  }
  void lastClose;
  // De-dup on the stable key (same event seen twice in one scan).
  const seen = new Set<string>();
  return out.filter((d) => {
    if (!Number.isFinite(d.price) || !Number.isFinite(d.trigger_ts)) return false;
    const k = keyFor(d);
    return seen.has(k) ? false : (seen.add(k), true);
  });
}

/**
 * Grade one pending setup against the bars that came AFTER its trigger.
 * win  = price reached `target` before touching `invalidation`
 * loss = price touched `invalidation` first
 * chop = neither hit, but ≥ GRADE_AFTER bars have elapsed (or session ended)
 * Tracks MFE/MAE (favorable/adverse excursion, pts) and an R multiple on win.
 */
const GRADE_AFTER_BARS = 12; // ~1h of 5m bars with no resolution → call it chop
function gradeSetup(
  row: IctSetupRecord, candles: IctCandle[], sessionClosed: boolean,
): {
  outcome: "pending" | "win" | "loss" | "chop"; mfe: number; mae: number;
  r_multiple: number | null; resolved_ts: number | null; resolved_price: number | null;
} {
  const dir = row.dir as "bull" | "bear" | "neutral";
  const after = candles.filter((c) => c.timestamp > row.trigger_ts);
  const entry = row.price ?? 0;
  const target = row.target;
  const inval = row.invalidation;
  if (dir === "neutral" || target == null || inval == null || !after.length) {
    return { outcome: "pending", mfe: row.mfe, mae: row.mae, r_multiple: null,
      resolved_ts: null, resolved_price: null };
  }
  const risk = Math.abs(entry - inval) || 1;
  let mfe = 0, mae = 0;
  for (const c of after) {
    const fav = dir === "bull" ? c.high - entry : entry - c.low;     // best favorable
    const adv = dir === "bull" ? entry - c.low : c.high - entry;     // worst adverse
    if (fav > mfe) mfe = fav;
    if (adv > mae) mae = adv;
    const hitTarget = dir === "bull" ? c.high >= target : c.low <= target;
    const hitInval  = dir === "bull" ? c.low <= inval  : c.high >= inval;
    // If both happen on the same bar, treat the closer-to-entry level (invalidation)
    // as hit first — conservative.
    if (hitInval) {
      return { outcome: "loss", mfe, mae, r_multiple: -1,
        resolved_ts: c.timestamp, resolved_price: inval };
    }
    if (hitTarget) {
      const r = Math.abs(target - entry) / risk;
      return { outcome: "win", mfe, mae, r_multiple: round2(r),
        resolved_ts: c.timestamp, resolved_price: target };
    }
  }
  if (after.length >= GRADE_AFTER_BARS || sessionClosed) {
    return { outcome: "chop", mfe, mae, r_multiple: round2(mfe / risk),
      resolved_ts: after[after.length - 1].timestamp, resolved_price: after[after.length - 1].close };
  }
  return { outcome: "pending", mfe, mae, r_multiple: null, resolved_ts: null, resolved_price: null };
}

export async function GET(req: NextRequest) {
  try {
    const sp = req.nextUrl.searchParams;
    const date = sp.get("date") || etDateStr();
    const all = sp.get("all") === "1";
    // Optional "last N days" window for the results page (e.g. since=7).
    const sinceDays = sp.get("since") ? Number(sp.get("since")) : null;
    const sinceDate = sinceDays && sinceDays > 0
      ? etDateStr(new Date(Date.now() - sinceDays * 86_400_000))
      : null;

    const summaryOpts = all
      ? (sinceDate ? { sinceDate } : {})
      : { date };
    const [setups, summary] = await Promise.all([
      getIctSetups(all ? undefined : date, 300),
      getIctSetupSummary(summaryOpts),
    ]);
    return NextResponse.json({ date, sinceDate, setups, summary });
  } catch (err) {
    console.error("[/api/ict-setups GET]", err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    if (!tokenOk(req)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    const body = await req.json().catch(() => ({}));
    const action = String(body.action || "scan");
    const date = String(body.date || etDateStr());
    const origin = req.nextUrl.origin;

    const candles = await fetchCandles(origin, date);
    if (!candles.length) {
      return NextResponse.json({ ok: true, date, detected: 0, recorded: 0, graded: 0, note: "no candles" });
    }

    // Session is closed if the newest bar is at/after 15:55 ET (last RTH bar).
    const lastSlot = (() => {
      const t = candles[candles.length - 1].timestamp;
      return new Intl.DateTimeFormat("en-US", {
        timeZone: "America/New_York", hour: "2-digit", minute: "2-digit", hour12: false,
      }).format(new Date(t));
    })();
    const sessionClosed = lastSlot >= "15:55";

    let recorded = 0;
    let detected = 0;

    if (action === "scan") {
      const setups = extractSetups(candles);
      detected = setups.length;
      for (const d of setups) {
        const { inserted } = await insertIctSetup({
          setup_key: keyFor(d), date, kind: d.kind, label: d.label, dir: d.dir,
          trigger_ts: d.trigger_ts, price: round2(d.price), note: d.note,
          target: d.target != null ? round2(d.target) : null,
          invalidation: d.invalidation != null ? round2(d.invalidation) : null,
        });
        if (inserted) recorded++;
      }
    }

    // Grade every pending row for the day (runs for both scan + grade).
    const pending = await getPendingIctSetups(date);
    let graded = 0;
    for (const row of pending) {
      const g = gradeSetup(row, candles, sessionClosed);
      // Always persist ratcheted mfe/mae; only count a "grade" when it resolves.
      await updateIctSetupGrade({
        setup_key: row.setup_key, outcome: g.outcome,
        mfe: round2(g.mfe), mae: round2(g.mae), r_multiple: g.r_multiple,
        resolved_ts: g.resolved_ts, resolved_price: g.resolved_price,
      });
      if (g.outcome !== "pending") graded++;
    }

    return NextResponse.json({ ok: true, date, detected, recorded, graded, sessionClosed });
  } catch (err) {
    console.error("[/api/ict-setups POST]", err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}

export { INTERVAL_MS };
