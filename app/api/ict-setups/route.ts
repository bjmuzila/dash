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

  // Trigger-bar lookup + 5m ATR(14) for the stop buffer (avoids wick stop-outs).
  const byTs = new Map<number, IctCandle>(candles.map((c) => [c.timestamp, c]));
  const atr = (() => {
    const n = Math.min(14, candles.length - 1);
    if (n <= 0) return 2;
    let sum = 0;
    for (let i = candles.length - n; i < candles.length; i++) {
      const c = candles[i], p = candles[i - 1];
      sum += Math.max(c.high - c.low, Math.abs(c.high - p.close), Math.abs(c.low - p.close));
    }
    return Math.max(1, sum / n);
  })();
  const buf = Math.max(1, atr * 0.15);

  // Structure-based stop: the nearest swing pivot on the WRONG side of entry
  // (the level that, if lost, invalidates the idea), buffered beyond by ATR.
  // Falls back to 1 ATR from entry when no qualifying pivot exists.
  // NOTE: gate on `confirmTs` (idx + k), not `ts`. A fractal pivot needs k bars to
  // its right to exist, so filtering on `p.ts <= ts` placed the stop using a level
  // that wasn't knowable until k bars AFTER entry — future data in the risk
  // denominator, which inflated every R multiple and win rate downstream.
  const structuralStop = (dir: "bull" | "bear", entry: number, ts: number): number => {
    if (dir === "bull") {
      const lows = a.pivots.filter((p) => p.type === "low" && p.confirmTs <= ts && p.price < entry).map((p) => p.price);
      const lvl = lows.length ? Math.max(...lows) : entry - atr;
      return lvl - buf;
    }
    const highs = a.pivots.filter((p) => p.type === "high" && p.confirmTs <= ts && p.price > entry).map((p) => p.price);
    const lvl = highs.length ? Math.min(...highs) : entry + atr;
    return lvl + buf;
  };

  // Generic event push. entry = trigger-bar close; invalidation = structural stop.
  // Reward is now measured in R by the grader (MFE / risk), so no fixed target.
  const pushEvent = (
    kind: string, label: string, dir: "bull" | "bear",
    ts: number, level: number, note: string,
  ) => {
    const bar = byTs.get(ts);
    const entry = bar ? bar.close : level;
    const invalidation = structuralStop(dir, entry, ts);
    // Guard against a degenerate (wrong-side) stop → force a ≥1×buf risk.
    const inval = dir === "bull"
      ? Math.min(invalidation, entry - buf)
      : Math.max(invalidation, entry + buf);
    out.push({ kind, label, dir, trigger_ts: ts, price: round2(entry), note, target: null, invalidation: inval });
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
    const sweepBar = candles.find((c) => c.timestamp > p.confirmTs &&
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
  // Valid order blocks (swept + imbalance) — the tradeable ones.
  // The trade is the RETEST of the zone after the block is confirmed, not the OB
  // candle itself: at o.ts the candle is just a candle, and it only becomes an
  // "order block" once the impulse + imbalance print (o.confirmTs). Entering at
  // o.ts booked the pre-impulse price with hindsight — that alone was producing a
  // ~94% win rate at 11R. If price never returns to the zone, there is no trade.
  for (const o of a.orderBlocks) {
    if (!o.valid) continue;
    const retest = candles.find((c) => c.timestamp > o.confirmTs && c.low <= o.top && c.high >= o.bottom);
    if (!retest) continue;
    const edge = o.dir === "bull" ? o.bottom : o.top;
    pushEvent("ob", "Order Block", o.dir, retest.timestamp, edge,
      `OB ${o.dir} ${round2(o.bottom)}–${round2(o.top)} (retest)`);
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
 * Grade one setup against the bars after its trigger — SAME methodology as the
 * fails page: reward is measured in R (MFE / risk), where risk = entry→structural
 * stop, and a trade is tracked until it actually resolves (stop hit or session
 * close). No artificial early cutoff — a setup stays "pending" (re-graded every
 * 5 min) for as long as the session runs, so winners get credit for the full
 * move instead of being frozen at whatever R they'd reached an hour in.
 *   r_multiple = max favorable R reached so far (peak MFE / risk)
 *   win  = ran ≥ 1R before the structural stop was touched, OR survived to
 *          session close with a peak ≥ 1R
 *   loss = stopped out having reached < 1R
 *   chop = survived to session close, stop never hit, but never reached 1R
 * Tier hit-rates (1R/2R/3R) are derived downstream from r_multiple.
 */
function gradeSetup(
  row: IctSetupRecord, candles: IctCandle[], sessionClosed: boolean,
): {
  outcome: "pending" | "win" | "loss" | "chop"; mfe: number; mae: number;
  r_multiple: number | null; resolved_ts: number | null; resolved_price: number | null;
} {
  const dir = row.dir as "bull" | "bear" | "neutral";
  const after = candles.filter((c) => c.timestamp > row.trigger_ts);
  const entry = row.price ?? 0;
  const inval = row.invalidation;
  if (dir === "neutral" || inval == null || !after.length) {
    return { outcome: "pending", mfe: row.mfe, mae: row.mae, r_multiple: row.r_multiple ?? null,
      resolved_ts: null, resolved_price: null };
  }
  const risk = Math.abs(entry - inval) || 1;
  let mfe = 0, mae = 0;
  for (const c of after) {
    const fav = dir === "bull" ? c.high - entry : entry - c.low;     // best favorable
    const adv = dir === "bull" ? entry - c.low : c.high - entry;     // worst adverse
    if (fav > mfe) mfe = fav;
    if (adv > mae) mae = adv;
    const hitStop = dir === "bull" ? c.low <= inval : c.high >= inval;
    if (hitStop) {
      const maxR = round2(mfe / risk);
      // Banked ≥1R before the stop = win; otherwise the stop truncated it = loss.
      return { outcome: maxR >= 1 ? "win" : "loss", mfe, mae, r_multiple: maxR,
        resolved_ts: c.timestamp, resolved_price: inval };
    }
  }
  const maxR = round2(mfe / risk);
  if (sessionClosed) {
    // Session actually ended without stopping: ≥1R reached = win, else chop (went nowhere).
    return { outcome: maxR >= 1 ? "win" : "chop", mfe, mae, r_multiple: maxR,
      resolved_ts: after[after.length - 1].timestamp, resolved_price: after[after.length - 1].close };
  }
  // Still live — keep the peak R so the log shows how far it's run so far.
  return { outcome: "pending", mfe, mae, r_multiple: maxR, resolved_ts: null, resolved_price: null };
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
      getIctSetups({ date: all ? undefined : date, sinceDate: all ? sinceDate ?? undefined : undefined, limit: 2000 }),
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
