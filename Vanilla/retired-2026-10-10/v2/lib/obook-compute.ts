// Extracted verbatim from app/api/obook/route.ts for the in-process API router.
// Only changes: no next/server; forwardGet → a direct same-origin /proxy fetch;
// pure fn taking URLSearchParams → { status, body, headers }. Zero @/ deps → bundles trivially:
//   esbuild lib/obook-compute.ts --bundle --platform=node --format=cjs --outfile=server-v2/_lib-obook.cjs
function proxyFetch(path: string) {
  return fetch(`http://127.0.0.1:${process.env.PORT || "3001"}${path}`, {
    cache: "no-store",
    headers: process.env.INTERNAL_API_TOKEN ? { "x-internal-token": process.env.INTERNAL_API_TOKEN } : {},
  });
}

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

/**
 * GET /api/obook?ticker=SPX|SPY|QQQ
 *
 * Order-Book "Tenor Split" read, built from the SAME live tape the /test Flow
 * Inventory tab uses: server-v2 /proxy/flow-history?underlying=X, which returns
 * { tape: FlowOrder[] } — aggressor-classified prints (buy/sell) with per-print
 * spot, tagged by underlying. Split front-month vs intermediate-term.
 *
 * Only the recorded roots (SPX / SPY / QQQ) have a tape; anything else 404s and
 * the page falls back to its QQQ sample. Delta-weighted flow is an ESTIMATE —
 * the tape has no per-print greeks, so |Δ| is approximated by moneyness.
 */

const RECORDED = ["SPX", "SPY", "QQQ"];

type FlowOrder = {
  ts: number; expiration?: string; strike: number;
  type: "C" | "P"; side: "buy" | "sell";
  premium: number; size: number; isOtm: boolean; spot?: number;
};

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
const isCall = (o: FlowOrder) => o.type === "C";
const isBought = (o: FlowOrder) => o.side === "buy";
// Bullish = long calls or short puts; Bearish = short calls or long puts.
const isBullish = (o: FlowOrder) => (isCall(o) ? isBought(o) : !isBought(o));
const deltaMag = (o: FlowOrder) => (o.isOtm ? 0.35 : 0.55);
const fmtExp = (iso: string) => {
  const m = /(\d{4})-(\d{2})-(\d{2})/.exec(iso || "");
  return m ? `${m[3]} ${MONTHS[+m[2] - 1]}` : (iso || "").toUpperCase();
};
const etTime = (ts: number) =>
  new Date(ts).toLocaleTimeString("en-US", { timeZone: "America/New_York", hour12: false, hour: "2-digit", minute: "2-digit" });

function agg(rows: FlowOrder[]) {
  let callPrem = 0, putPrem = 0, bullPrem = 0, bearPrem = 0, delta = 0;
  let otmCall = 0, otmPut = 0, callFlow = 0, putFlow = 0;
  for (const o of rows) {
    const prem = o.premium || 0;
    const dir = isBought(o) ? 1 : -1;
    if (isCall(o)) { callPrem += prem; callFlow += dir * prem; if (o.isOtm) otmCall += dir * prem; }
    else { putPrem += prem; putFlow += dir * prem; if (o.isOtm) otmPut += dir * prem; }
    if (isBullish(o)) bullPrem += prem; else bearPrem += prem;
    delta += (isBullish(o) ? 1 : -1) * (o.size || 0) * 100 * deltaMag(o);
  }
  return { callPrem, putPrem, bullPrem, bearPrem, delta, otmCall, otmPut, callFlow, putFlow, prem: callPrem + putPrem, n: rows.length };
}

export async function computeObook(
  searchParams: URLSearchParams,
): Promise<{ status: number; body: unknown; headers?: Record<string, string> }> {
  const ticker = (searchParams.get("ticker") || "").trim().toUpperCase();
  if (!ticker) return { status: 400, body: { error: "ticker required" } };

  let rows: FlowOrder[] = [];
  try {
    const resp = await proxyFetch(`/proxy/flow-history?underlying=${encodeURIComponent(ticker)}&limit=20000`);
    const json = await resp.json().catch(() => ({}));
    rows = Array.isArray(json?.tape) ? (json.tape as FlowOrder[]) : [];
  } catch (e) {
    return { status: 502, body: { error: `tape: ${String(e)}` } };
  }
  rows = rows.filter((o) => o && o.premium && o.expiration).sort((a, b) => a.ts - b.ts);
  if (!rows.length) return { status: 404, body: { error: "no tape", ticker, available: RECORDED } };

  // ── tenor split: front = earliest expiration present, intermediate = the rest.
  const exps = Array.from(new Set(rows.map((r) => r.expiration || "").filter(Boolean))).sort();
  const frontExp = exps[0] || "";
  const front = rows.filter((r) => r.expiration === frontExp);
  const inter = rows.filter((r) => r.expiration && r.expiration !== frontExp);
  const A = agg(rows), F = agg(front), I = agg(inter);

  // ── spot / range from per-print spot (session open = first print, last = last).
  const spots = rows.map((r) => r.spot).filter((v): v is number => typeof v === "number" && v > 0);
  const open = spots[0], last = spots[spots.length - 1];
  const hasSpot = spots.length > 0 && open != null && last != null;
  const spotMovePct = hasSpot && open ? ((last - open) / open) * 100 : null;
  const spotStr = hasSpot ? `${open.toFixed(1)} → ${last.toFixed(1)}` : "—";
  const spotChgStr = hasSpot ? `(${last - open >= 0 ? "+" : "−"}${Math.abs(last - open).toFixed(1)})` : "";
  const rangeStr = hasSpot ? `${Math.min(...spots).toFixed(1)} – ${Math.max(...spots).toFixed(1)}` : "—";

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

  const frontBull = F.bullPrem >= F.bearPrem, interBull = I.bullPrem >= I.bearPrem;
  const combLean = A.delta >= 0 ? "net long" : "net short";
  const cpTone: Tone = A.callPrem >= A.putPrem ? "bull" : "orange";

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

  const nowDate = new Date(rows[rows.length - 1].ts).toLocaleDateString("en-US", { timeZone: "America/New_York", month: "long", day: "numeric", year: "numeric" });

  const data: ObookData = {
    ticker, date: nowDate,
    subtitle: `Front month (${fmtExp(frontExp)}) vs intermediate term · live tape`,
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

  return { status: 200, body: data, headers: { "Cache-Control": "public, max-age=30" } };
}
