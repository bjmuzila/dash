var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// obook-compute.ts
var obook_compute_exports = {};
__export(obook_compute_exports, {
  computeObook: () => computeObook,
  dynamic: () => dynamic,
  revalidate: () => revalidate,
  runtime: () => runtime
});
module.exports = __toCommonJS(obook_compute_exports);
function proxyFetch(path) {
  return fetch(`http://127.0.0.1:${process.env.PORT || "3001"}${path}`, {
    cache: "no-store",
    headers: process.env.INTERNAL_API_TOKEN ? { "x-internal-token": process.env.INTERNAL_API_TOKEN } : {}
  });
}
var runtime = "nodejs";
var dynamic = "force-dynamic";
var revalidate = 0;
var RECORDED = ["SPX", "SPY", "QQQ"];
var MONTHS = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"];
var fmtM = (n) => `$${(Math.abs(n) / 1e6).toFixed(1)}M`;
var sgnM = (n) => `${n >= 0 ? "+" : "\u2212"}${fmtM(n)}`;
var fmtK = (n) => `${n >= 0 ? "+" : "\u2212"}${Math.abs(Math.round(n / 1e3)).toLocaleString()}K`;
var ratio = (a, b) => b <= 0 ? "\u2014" : `${(a / b).toFixed(2)}\xD7`;
var isCall = (o) => o.type === "C";
var isBought = (o) => o.side === "buy";
var isBullish = (o) => isCall(o) ? isBought(o) : !isBought(o);
var deltaMag = (o) => o.isOtm ? 0.35 : 0.55;
var fmtExp = (iso) => {
  const m = /(\d{4})-(\d{2})-(\d{2})/.exec(iso || "");
  return m ? `${m[3]} ${MONTHS[+m[2] - 1]}` : (iso || "").toUpperCase();
};
var etTime = (ts) => new Date(ts).toLocaleTimeString("en-US", { timeZone: "America/New_York", hour12: false, hour: "2-digit", minute: "2-digit" });
function agg(rows) {
  let callPrem = 0, putPrem = 0, bullPrem = 0, bearPrem = 0, delta = 0;
  let otmCall = 0, otmPut = 0, callFlow = 0, putFlow = 0;
  for (const o of rows) {
    const prem = o.premium || 0;
    const dir = isBought(o) ? 1 : -1;
    if (isCall(o)) {
      callPrem += prem;
      callFlow += dir * prem;
      if (o.isOtm) otmCall += dir * prem;
    } else {
      putPrem += prem;
      putFlow += dir * prem;
      if (o.isOtm) otmPut += dir * prem;
    }
    if (isBullish(o)) bullPrem += prem;
    else bearPrem += prem;
    delta += (isBullish(o) ? 1 : -1) * (o.size || 0) * 100 * deltaMag(o);
  }
  return { callPrem, putPrem, bullPrem, bearPrem, delta, otmCall, otmPut, callFlow, putFlow, prem: callPrem + putPrem, n: rows.length };
}
async function computeObook(searchParams) {
  const ticker = (searchParams.get("ticker") || "").trim().toUpperCase();
  if (!ticker) return { status: 400, body: { error: "ticker required" } };
  let rows = [];
  try {
    const resp = await proxyFetch(`/proxy/flow-history?underlying=${encodeURIComponent(ticker)}&limit=20000`);
    const json = await resp.json().catch(() => ({}));
    rows = Array.isArray(json?.tape) ? json.tape : [];
  } catch (e) {
    return { status: 502, body: { error: `tape: ${String(e)}` } };
  }
  rows = rows.filter((o) => o && o.premium && o.expiration).sort((a, b) => a.ts - b.ts);
  if (!rows.length) return { status: 404, body: { error: "no tape", ticker, available: RECORDED } };
  const exps = Array.from(new Set(rows.map((r) => r.expiration || "").filter(Boolean))).sort();
  const frontExp = exps[0] || "";
  const front = rows.filter((r) => r.expiration === frontExp);
  const inter = rows.filter((r) => r.expiration && r.expiration !== frontExp);
  const A = agg(rows), F = agg(front), I = agg(inter);
  const spots = rows.map((r) => r.spot).filter((v) => typeof v === "number" && v > 0);
  const open = spots[0], last = spots[spots.length - 1];
  const hasSpot = spots.length > 0 && open != null && last != null;
  const spotMovePct = hasSpot && open ? (last - open) / open * 100 : null;
  const spotStr = hasSpot ? `${open.toFixed(1)} \u2192 ${last.toFixed(1)}` : "\u2014";
  const spotChgStr = hasSpot ? `(${last - open >= 0 ? "+" : "\u2212"}${Math.abs(last - open).toFixed(1)})` : "";
  const rangeStr = hasSpot ? `${Math.min(...spots).toFixed(1)} \u2013 ${Math.max(...spots).toFixed(1)}` : "\u2014";
  const soldPuts = /* @__PURE__ */ new Map();
  for (const r of front) if (!isCall(r) && !isBought(r)) soldPuts.set(r.strike, (soldPuts.get(r.strike) || 0) + (r.premium || 0));
  const topPuts = [...soldPuts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 2);
  const floorStr = topPuts.length ? topPuts.map(([k]) => k).sort((a, b) => a - b).join(" / ") + " P" : "\u2014";
  const floorPrem = topPuts.reduce((a, [, v]) => a + v, 0);
  const curve = exps.map((e) => {
    const g = agg(rows.filter((r) => r.expiration === e));
    return { e, net: g.bullPrem - g.bearPrem };
  });
  const maxAbs = Math.max(1, ...curve.map((c) => Math.abs(c.net)));
  const expiries = curve.sort((a, b) => a.e.localeCompare(b.e)).slice(0, 8).map((c) => ({ date: fmtExp(c.e), tag: c.e === frontExp ? "FM" : "IT", val: sgnM(c.net), pct: Math.round(Math.abs(c.net) / maxAbs * 100), dir: c.net >= 0 ? 1 : -1 }));
  const frontBull = F.bullPrem >= F.bearPrem, interBull = I.bullPrem >= I.bearPrem;
  const combLean = A.delta >= 0 ? "net long" : "net short";
  const cpTone = A.callPrem >= A.putPrem ? "bull" : "orange";
  const tenor = (g, metaExp, tag, label, isFront) => {
    const bull = g.bullPrem >= g.bearPrem;
    return {
      tag,
      label,
      meta: `${metaExp || "\u2014"} \xB7 ${g.n.toLocaleString()} prints \xB7 ${fmtM(g.prem)}`,
      head: bull ? "BULLISH \u2192 DIP-BUYING" : "BEARISH \u2192 HEDGING",
      side: bull ? "bull" : "bear",
      rows: [
        ["Bull / Bear premium", ratio(g.bullPrem, g.bearPrem)],
        ["Delta-weighted flow", `${fmtK(g.delta)} ${g.delta >= 0 ? "long" : "short"}`],
        isFront ? ["OTM call flow", `${sgnM(g.otmCall)} (${g.otmCall >= 0 ? "bought" : "net sold"})`] : ["OTM put flow", `${sgnM(g.otmPut)} (${g.otmPut >= 0 ? "bought" : "net sold"})`],
        isFront ? ["Put flow", `${sgnM(g.putFlow)} (${g.putFlow >= 0 ? "bought" : "net sold"})`] : ["Call flow", `${sgnM(g.callFlow)} (${g.callFlow >= 0 ? "bought" : "net sold"})`]
      ],
      note: bull ? "Calls bought / puts sold into the tape \u2014 a bounce-positioning, floor-setting footprint on this tenor." : "Puts bought / calls sold \u2014 downside protection built out, hedging against continued weakness."
    };
  };
  const nowDate = new Date(rows[rows.length - 1].ts).toLocaleDateString("en-US", { timeZone: "America/New_York", month: "long", day: "numeric", year: "numeric" });
  const data = {
    ticker,
    date: nowDate,
    subtitle: `Front month (${fmtExp(frontExp)}) vs intermediate term \xB7 live tape`,
    session: `${etTime(rows[0].ts)} \u2192 ${etTime(rows[rows.length - 1].ts)} ET`,
    spot: spotStr,
    spotChg: spotChgStr,
    range: rangeStr,
    prints: A.n.toLocaleString(),
    premium: fmtM(A.prem),
    readTitle: `Tenor Split \u2014 front-month ${frontBull ? "dip bought" : "hedged"}, longer-term ${interBull ? "leaning long" : "hedged"}`,
    readMeta: `${combLean} \xB7 ${Math.abs(A.delta) > 2e5 ? "notable" : "low"} conviction`,
    readBody1: `traded ${A.n.toLocaleString()} classified prints for ${fmtM(A.prem)}. Combined C/P premium is ${ratio(A.callPrem, A.putPrem)} (${A.callPrem >= A.putPrem ? "call" : "put"}-heavy) with delta-flow ${fmtK(A.delta)} share-equiv \u2014 ${combLean}. The two tenors split: front vs back is where the signal sits.`,
    readBody2: `Front month (${fmtExp(frontExp)}) is ${frontBull ? "bullish" : "bearish"} \u2014 ${ratio(F.bullPrem, F.bearPrem)} bull/bear, ${fmtK(F.delta)} delta. Intermediate term is ${interBull ? "bullish" : "bearish"} \u2014 ${ratio(I.bullPrem, I.bearPrem)}, ${fmtK(I.delta)} delta. Read it as ${frontBull && !interBull ? "fading the move near-term while adding longer-dated hedges" : frontBull && interBull ? "leaning long across the curve" : "hedged near-term with " + (interBull ? "longer-dated upside" : "protection layered out")} \u2014 an interpretive posture, not a signal.`,
    metrics: [
      { label: "Combined C/P Premium", value: ratio(A.callPrem, A.putPrem), sub: `${A.callPrem >= A.putPrem ? "call" : "put"}-heavy tape`, tone: cpTone },
      { label: "Combined Delta Flow", value: fmtK(A.delta), sub: `${combLean}`, tone: A.delta >= 0 ? "bull" : "bear" },
      { label: "Front-Month Bull/Bear", value: ratio(F.bullPrem, F.bearPrem), sub: `${frontBull ? "bullish" : "bearish"} \xB7 ${fmtK(F.delta)} delta`, tone: frontBull ? "bull" : "bear" },
      { label: "Interm-Term Bull/Bear", value: ratio(I.bullPrem, I.bearPrem), sub: `${interBull ? "bullish" : "bearish"} \xB7 ${fmtK(I.delta)} delta`, tone: interBull ? "bull" : "bear" },
      { label: "Bounce Floor", value: floorStr, sub: `${fmtM(floorPrem)} sold (FM)`, tone: "cyan" },
      { label: "Spot Move", value: spotMovePct != null ? `${spotMovePct >= 0 ? "+" : "\u2212"}${Math.abs(spotMovePct).toFixed(1)}%` : "\u2014", sub: spotStr, tone: (spotMovePct ?? 0) >= 0 ? "bull" : "bear" }
    ],
    tenors: [
      tenor(F, fmtExp(frontExp), "FRONT MONTH", "FM", true),
      tenor(I, exps.length > 1 ? `${fmtExp(exps[1])}\u2013${fmtExp(exps[exps.length - 1])}` : "\u2014", "INTERMEDIATE TERM", "IT", false)
    ],
    notes: [
      { tone: "cyan", t: "Why the ratio can mislead", b: `Raw C/P (${ratio(A.callPrem, A.putPrem)}) reads one way, but side-of-market flips the sign: puts that were SOLD are floor-setting, not bearish. Delta-flow (${fmtK(A.delta)}) reflects the aggressor side, not just the contract type.` },
      { tone: "orange", t: "The structure", b: `${frontBull && !interBull ? "Buy the near-term, hedge the back \u2014 a tactical-long / strategic-hedge posture." : "Flow leans " + combLean + " with the tenors " + (frontBull === interBull ? "aligned" : "split") + " across the curve."} Weigh conviction against the split.` },
      { tone: "bull", t: "Net lean", b: `Combined ${ratio(A.bullPrem, A.bearPrem)} bull/bear and ${fmtK(A.delta)} delta tilt it ${combLean}. ${frontBull === interBull ? "Tenors agree \u2014 cleaner read." : "Intermediate " + (interBull ? "support" : "hedging") + " caps conviction: a tenor-split footprint, not an all-clear."}` }
    ],
    expiries,
    curveNote: `Net directional premium across the curve: ${expiries.map((e) => `${e.date} ${e.val}`).join(", ")}. Front-month ${frontBull ? "positive" : "negative"} vs intermediate ${interBull ? "positive" : "negative"} \u2014 the defining feature of today's ${ticker} tape.`,
    disclaimer: "Interpretive output only. Aggressor classification is an estimate, not exchange-tagged order flow; delta-weighted flow is approximated from moneyness (no per-print greeks); deep-ITM calls may be stock substitutes; multi-leg structures may classify per-leg. Not investment advice \u2014 research/discretionary context within an AMT framework."
  };
  return { status: 200, body: data, headers: { "Cache-Control": "public, max-age=30" } };
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  computeObook,
  dynamic,
  revalidate,
  runtime
});
