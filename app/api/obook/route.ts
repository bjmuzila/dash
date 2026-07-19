import { NextRequest, NextResponse } from "next/server";
import { queryAll, type FlowCallRecord } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

/**
 * GET /api/obook?ticker=QQQ[&date=YYYY-MM-DD]
 *
 * Builds the Order-Book "Tenor Split" interpretation for ANY ticker from the
 * classified time-&-sales tape in flow_calls (bought/sold aggressor prints),
 * split front-month vs intermediate-term. Spot/range come from a Yahoo chart
 * lookup. Returns the ObookData shape /obook renders; 404 when the tape is
 * empty for that symbol/date so the page falls back to its sample.
 *
 * NOTE: delta-weighted flow is an ESTIMATE — flow_calls has no per-print delta,
 * so we approximate |Δ| by moneyness (OTM 0.35 / ITM 0.55). Premium/ratios are
 * exact from the tape.
 */

type Tone = "bull" | "bear" | "neutral" | "cyan" | "orange";
type Tenor = { tag: string; label: string; meta: string; head: string; side: "bull" | "bear"; rows: [string, string][]; note: string };
type Expiry = { date: string; tag: string; val: string; pct: number; dir: 1 | -1 };
type ObookData = {
  ticker: string; date: string; subtitle: string;
  session: string; spot: string; spotChg: string; range: string; prints: string; premium: string;
  readTitle: string; readMeta: string; readBody1: string; readBody2: string;
  metrics: { label: string; value: string; sub: string; tone: Tone }[];
  tenors: Tenor[];
  notes: { tone: "cyan" | "orange" | "bull"; t: string; b: string }[];
  expiries: Expiry[];
  curveNote: string; disclaimer: string;
};

const MONTHS = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"];
const fmtM = (n: number) => `$${(Math.abs(n) / 1e6).toFixed(1)}M`;
const sgnM = (n: number) => `${n >= 0 ? "+" : "−"}${fmtM(n)}`;
const fmtK = (n: number) => `${n >= 0 ? "+" : "−"}${Math.abs(Math.round(n / 1000)).toLocaleString()}K`;
const ratio = (a: number, b: number) => (b <= 0 ? "—" : `${(a / b).toFixed(2)}×`);
const isCall = (r: FlowCallRecord) => (r.option_type || "").toLowerCase().startsWith("c");
function isBought(r: FlowCallRecord): boolean {
  const a = (r.action || "").toLowerCase(), s = (r.side || "").toLowerCase();
  if (/(bought|buy)/.test(a)) return true;
  if (/(sold|sell)/.test(a)) return false;
  if (s.startsWith("a")) return true;   // ask = lifted = bought
  if (s.startsWith("b")) return false;  // bid = hit = sold
  return true;
}
// Bullish = long calls or short puts; Bearish = short calls or long puts.
const isBullish = (r: FlowCallRecord) => (isCall(r) ? isBought(r) : !isBought(r));
const deltaMag = (r: FlowCallRecord) => (r.is_otm ? 0.35 : 0.55);
const fmtExp = (iso: string) => {
  const m = /(\d{4})-(\d{2})-(\d{2})/.exec(iso || "");
  return m ? `${m[3]} ${MONTHS[+m[2] - 1]}` : (iso || "").toUpperCase();
};

// One aggregate over a subset of prints.
function agg(rows: FlowCallRecord[]) {
  let callPrem = 0, putPrem = 0, bullPrem = 0, bearPrem = 0, delta = 0;
  let otmCall = 0, otmPut = 0, callFlow = 0, putFlow = 0;
  for (const r of rows) {
    const prem = r.premium || 0;
    const bought = isBought(r);
    const dir = bought ? 1 : -1;
    if (isCall(r)) { callPrem += prem; callFlow += dir * prem; if (r.is_otm) otmCall += dir * prem; }
    else { putPrem += prem; putFlow += dir * prem; if (r.is_otm) otmPut += dir * prem; }
    if (isBullish(r)) bullPrem += prem; else bearPrem += prem;
    delta += (isBullish(r) ? 1 : -1) * (r.size || 0) * 100 * deltaMag(r);
  }
  return { callPrem, putPrem, bullPrem, bearPrem, delta, otmCall, otmPut, callFlow, putFlow, prem: callPrem + putPrem, n: rows.length };
}

function toYahoo(sym: string): string {
  const s = sym.trim().toUpperCase();
  if (s === "SPX" || s === "$SPX") return "^GSPC";
  if (s === "NDX") return "^NDX";
  if (s === "RUT") return "^RUT";
  if (s === "VIX") return "^VIX";
  if (s === "DJX" || s === "DJI") return "^DJI";
  if (s.startsWith("/ES")) return "ES=F";
  if (s.startsWith("/NQ")) return "NQ=F";
  if (s.startsWith("/")) return s.slice(1) + "=F";
  return s;
}
async function spotInfo(ticker: string): Promise<{ last: number; prev: number; high: number; low: number } | null> {
  try {
    const y = toYahoo(ticker);
    const r = await fetch(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(y)}?range=1d&interval=1d`,
      { cache: "no-store", headers: { "User-Agent": "Mozilla/5.0" } });
    if (!r.ok) return null;
    const m = (await r.json())?.chart?.result?.[0]?.meta;
    if (!m || typeof m.regularMarketPrice !== "number") return null;
    return {
      last: m.regularMarketPrice,
      prev: m.chartPreviousClose ?? m.previousClose ?? m.regularMarketPrice,
      high: m.regularMarketDayHigh ?? m.regularMarketPrice,
      low: m.regularMarketDayLow ?? m.regularMarketPrice,
    };
  } catch { return null; }
}

const etTime = (ts: number) =>
  new Date(ts).toLocaleTimeString("en-US", { timeZone: "America/New_York", hour12: false, hour: "2-digit", minute: "2-digit" });
const etLong = (iso: string) =>
  new Date(iso + "T12:00:00Z").toLocaleDateString("en-US", { timeZone: "America/New_York", month: "long", day: "numeric", year: "numeric" });

export async function GET(req: NextRequest) {
  const sp = new URL(req.url).searchParams;
  const ticker = (sp.get("ticker") || "").trim().toUpperCase();
  const wantDate = (sp.get("date") || new Date().toLocaleDateString("en-CA", { timeZone: "America/New_York" })).trim();
  const symMatch = "(UPPER(COALESCE(underlying,'')) = ? OR UPPER(symbol) = ? OR UPPER(symbol) LIKE ?)";
  const symArgs = [ticker, ticker, `${ticker}%`];
  if (!ticker) return NextResponse.json({ error: "ticker required" }, { status: 400 });

  let rows: FlowCallRecord[] = [];
  let date = wantDate;
  try {
    // Resolve the effective date: exact request, else the latest session that
    // actually has tape for this symbol (so off-hours/weekends show last session).
    const latest = await queryAll<{ d: string }>(
      `SELECT date AS d FROM flow_calls WHERE ${symMatch} AND date <= ? ORDER BY date DESC LIMIT 1`,
      [...symArgs, wantDate]
    );
    date = latest[0]?.d || wantDate;
    rows = await queryAll<FlowCallRecord>(
      `SELECT * FROM flow_calls WHERE date = ? AND ${symMatch} ORDER BY ts ASC LIMIT 50000`,
      [date, ...symArgs]
    );
  } catch (e) {
    return NextResponse.json({ error: `db: ${String(e)}` }, { status: 500 });
  }
  if (!rows.length) {
    // Nothing for this symbol at all — hand back what IS recorded, recently.
    let available: string[] = [];
    try {
      const av = await queryAll<{ u: string }>(
        `SELECT DISTINCT UPPER(COALESCE(NULLIF(underlying,''), symbol)) AS u
         FROM flow_calls WHERE date >= ? ORDER BY u LIMIT 60`,
        [new Date(Date.now() - 14 * 864e5).toISOString().slice(0, 10)]
      );
      available = av.map((r) => r.u).filter(Boolean);
    } catch { /* ignore */ }
    return NextResponse.json({ error: "no tape", ticker, date: wantDate, available }, { status: 404 });
  }

  // ── tenor split: front = earliest expiration present, intermediate = the rest.
  const exps = Array.from(new Set(rows.map((r) => r.expiration || "").filter(Boolean))).sort();
  const frontExp = exps[0] || "";
  const front = rows.filter((r) => r.expiration === frontExp);
  const inter = rows.filter((r) => r.expiration && r.expiration !== frontExp);
  const A = agg(rows), F = agg(front), I = agg(inter);

  // ── spot / range
  const s = await spotInfo(ticker);
  const spotMovePct = s && s.prev ? ((s.last - s.prev) / s.prev) * 100 : null;
  const spotStr = s ? `${s.prev.toFixed(1)} → ${s.last.toFixed(1)}` : "—";
  const spotChgStr = s ? `(${s.last - s.prev >= 0 ? "+" : "−"}${Math.abs(s.last - s.prev).toFixed(1)})` : "";
  const rangeStr = s ? `${s.low.toFixed(1)} – ${s.high.toFixed(1)}` : "—";

  // ── bounce floor: biggest SOLD puts in the front tenor.
  const soldPuts = new Map<number, number>();
  for (const r of front) if (!isCall(r) && !isBought(r)) soldPuts.set(r.strike, (soldPuts.get(r.strike) || 0) + (r.premium || 0));
  const topPuts = [...soldPuts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 2);
  const floorStr = topPuts.length ? topPuts.map(([k]) => k).sort((a, b) => a - b).join(" / ") + " P" : "—";
  const floorPrem = topPuts.reduce((a, [, v]) => a + v, 0);

  // ── expiry curve (net directional premium per expiration)
  const curve = exps.map((e) => { const g = agg(rows.filter((r) => r.expiration === e)); return { e, net: g.bullPrem - g.bearPrem }; });
  const maxAbs = Math.max(1, ...curve.map((c) => Math.abs(c.net)));
  const expiries: Expiry[] = curve
    .sort((a, b) => a.e.localeCompare(b.e)).slice(0, 8)
    .map((c) => ({ date: fmtExp(c.e), tag: c.e === frontExp ? "FM" : "IT", val: sgnM(c.net), pct: Math.round((Math.abs(c.net) / maxAbs) * 100), dir: c.net >= 0 ? 1 : -1 }));

  const cpTone: Tone = A.callPrem >= A.putPrem ? "bull" : "orange";
  const frontBull = F.bullPrem >= F.bearPrem, interBull = I.bullPrem >= I.bearPrem;
  const combLean = A.delta >= 0 ? "net long" : "net short";

  const tenor = (g: ReturnType<typeof agg>, metaExp: string, tag: string, label: string, isFront: boolean): Tenor => {
    const bull = g.bullPrem >= g.bearPrem;
    return {
      tag, label, meta: `${metaExp || "—"} · ${g.n.toLocaleString()} prints · ${fmtM(g.prem)}`,
      head: bull ? "BULLISH → DIP-BUYING" : "BEARISH → HEDGING", side: bull ? "bull" : "bear",
      rows: [
        ["Bull / Bear premium", ratio(g.bullPrem, g.bearPrem)],
        ["Delta-weighted flow", `${fmtK(g.delta)} ${g.delta >= 0 ? "long" : "short"}`],
        isFront ? ["OTM call flow", `${sgnM(g.otmCall)} (${g.otmCall >= 0 ? "bought" : "net sold"})`]
                : ["OTM put flow", `${sgnM(g.otmPut)} (${g.otmPut >= 0 ? "bought" : "net sold"})`],
        isFront ? ["Put flow", `${sgnM(g.putFlow)} (${g.putFlow >= 0 ? "bought" : "net sold"})`]
                : ["Call flow", `${sgnM(g.callFlow)} (${g.callFlow >= 0 ? "bought" : "net sold"})`],
      ],
      note: bull
        ? "Calls bought / puts sold into the tape — a bounce-positioning, floor-setting footprint on this tenor."
        : "Puts bought / calls sold — downside protection built out, hedging against continued weakness.",
    };
  };

  const data: ObookData = {
    ticker, date: etLong(date),
    subtitle: `Front month (${fmtExp(frontExp)}) vs intermediate term · time & sales`,
    session: `${etTime(rows[0].ts)} → ${etTime(rows[rows.length - 1].ts)} ET`,
    spot: spotStr, spotChg: spotChgStr, range: rangeStr,
    prints: A.n.toLocaleString(), premium: fmtM(A.prem),
    readTitle: `Tenor Split — front-month ${frontBull ? "dip bought" : "hedged"}, longer-term ${interBull ? "leaning long" : "hedged"}`,
    readMeta: `${combLean} · ${Math.abs(A.delta) > 200000 ? "notable" : "low"} conviction`,
    readBody1: `traded ${A.n.toLocaleString()} classified prints for ${fmtM(A.prem)}. Combined C/P premium is ${ratio(A.callPrem, A.putPrem)} (${A.callPrem >= A.putPrem ? "call" : "put"}-heavy) with delta-flow ${fmtK(A.delta)} share-equiv — ${combLean}. The two tenors split: front vs back is where the signal sits.`,
    readBody2: `Front month (${fmtExp(frontExp)}) is ${frontBull ? "bullish" : "bearish"} — ${ratio(F.bullPrem, F.bearPrem)} bull/bear, ${fmtK(F.delta)} delta. Intermediate term is ${interBull ? "bullish" : "bearish"} — ${ratio(I.bullPrem, I.bearPrem)}, ${fmtK(I.delta)} delta. Read it as ${frontBull && !interBull ? "fading the move near-term while adding longer-dated hedges" : frontBull && interBull ? "leaning long across the curve" : "hedged near-term with " + (interBull ? "longer-dated upside" : "protection layered out")} — an interpretive posture, not a signal.`,
    metrics: [
      { label: "Combined C/P Premium", value: ratio(A.callPrem, A.putPrem), sub: `${A.callPrem >= A.putPrem ? "call" : "put"}-heavy tape`, tone: cpTone },
      { label: "Combined Delta Flow", value: fmtK(A.delta), sub: `${combLean}`, tone: A.delta >= 0 ? "bull" : "bear" },
      { label: "Front-Month Bull/Bear", value: ratio(F.bullPrem, F.bearPrem), sub: `${frontBull ? "bullish" : "bearish"} · ${fmtK(F.delta)} delta`, tone: frontBull ? "bull" : "bear" },
      { label: "Interm-Term Bull/Bear", value: ratio(I.bullPrem, I.bearPrem), sub: `${interBull ? "bullish" : "bearish"} · ${fmtK(I.delta)} delta`, tone: interBull ? "bull" : "bear" },
      { label: "Bounce Floor", value: floorStr, sub: `${fmtM(floorPrem)} sold (FM)`, tone: "cyan" },
      { label: "Spot Move", value: spotMovePct != null ? `${spotMovePct >= 0 ? "+" : "−"}${Math.abs(spotMovePct).toFixed(1)}%` : "—", sub: spotStr, tone: (spotMovePct ?? 0) >= 0 ? "bull" : "bear" },
    ],
    tenors: [
      tenor(F, fmtExp(frontExp), "FRONT MONTH", "FM", true),
      tenor(I, exps.length > 1 ? `${fmtExp(exps[1])}–${fmtExp(exps[exps.length - 1])}` : "—", "INTERMEDIATE TERM", "IT", false),
    ],
    notes: [
      { tone: "cyan", t: "Why the ratio can mislead", b: `Raw C/P (${ratio(A.callPrem, A.putPrem)}) reads one way, but side-of-market flips the sign: puts that were SOLD are floor-setting, not bearish. Delta-flow (${fmtK(A.delta)}) reflects the aggressor side, not just the contract type.` },
      { tone: "orange", t: "The structure", b: `${frontBull && !interBull ? "Buy the near-term, hedge the back — a tactical-long / strategic-hedge posture." : "Flow leans " + combLean + " with the tenors " + (frontBull === interBull ? "aligned" : "split") + " across the curve."} Weigh conviction against the split.` },
      { tone: "bull", t: "Net lean", b: `Combined ${ratio(A.bullPrem, A.bearPrem)} bull/bear and ${fmtK(A.delta)} delta tilt it ${combLean}. ${frontBull === interBull ? "Tenors agree — cleaner read." : "Intermediate " + (interBull ? "support" : "hedging") + " caps conviction: a tenor-split footprint, not an all-clear."}` },
    ],
    expiries,
    curveNote: `Net directional premium across the curve: ${expiries.map((e) => `${e.date} ${e.val}`).join(", ")}. Front-month ${frontBull ? "positive" : "negative"} vs intermediate ${interBull ? "positive" : "negative"} — the defining feature of today's ${ticker} tape.`,
    disclaimer: "Interpretive output only. Aggressor classification is an estimate, not exchange-tagged order flow; delta-weighted flow is approximated from moneyness (no per-print greeks); deep-ITM calls may be stock substitutes; multi-leg structures may classify per-leg. Not investment advice — research/discretionary context within an AMT framework.",
  };

  return NextResponse.json(data, { headers: { "Cache-Control": "public, max-age=30" } });
}
