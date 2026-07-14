/**
 * scripts/ib-es-high-nq-low.mjs
 *
 * Conditional study: ES breaks its IB HIGH, NQ does NOT.
 * How often does NQ then go hit its IB LOW — and does the ES high break fade?
 *
 *   node scripts/ib-es-high-nq-low.mjs
 *   node scripts/ib-es-high-nq-low.mjs --flip        (NQ-high / ES-low, the mirror)
 *   node scripts/ib-es-high-nq-low.mjs --since 2023-01-01
 *   node scripts/ib-es-high-nq-low.mjs --json
 *
 * Reads public/data/ib-ES.json + ib-NQ.json (slim export, lib/ibStats.ts shapes).
 *
 * SETUP  = leader has a close-confirmed break of its IB HIGH (fcb.side === "H")
 *          AND laggard did NOT close-break its own IB high.
 * ASK    = did the laggard close-break its IB LOW? did it even TOUCH the low?
 *          did the leader's high break FAIL (close back inside within 30m)?
 *
 * DATA LIMIT — read this before you trust a number:
 *   The slim export only timestamps the FIRST close-break of each session
 *   (fcb.breakMin) and the first WICK touch (firstTouchMin). A laggard's SECOND
 *   break has no timestamp. So "NQ broke low AFTER ES broke high" is only
 *   provable when NQ's low break was its FIRST break. Those rows are counted
 *   under `sequenced`. Rows where NQ's low came second are counted under
 *   `unsequenced` — real, but order-unverified. Do not merge the two.
 */

import fs from "node:fs";
import path from "node:path";

const ROOT = process.cwd();
const argv = process.argv.slice(2);
const FLIP = argv.includes("--flip");
const AS_JSON = argv.includes("--json");
const si = argv.indexOf("--since");
const SINCE = si >= 0 && /^\d{4}-\d{2}-\d{2}$/.test(argv[si + 1] || "") ? argv[si + 1] : null;

const LEAD = FLIP ? "NQ" : "ES";
const LAG = FLIP ? "ES" : "NQ";

function load(sym) {
  const p = path.join(ROOT, "public", "data", `ib-${sym}.json`);
  if (!fs.existsSync(p)) { console.error(`missing ${p}`); process.exit(1); }
  const ds = JSON.parse(fs.readFileSync(p, "utf8"));
  const m = new Map();
  for (const d of ds.days) { if (!SINCE || d.date >= SINCE) m.set(d.date, d); }
  return m;
}

const L = load(LEAD);
const G = load(LAG);
const dates = [...L.keys()].filter((d) => G.has(d)).sort();

const pct = (n, d) => (d ? ((100 * n) / d).toFixed(1) + "%" : "—");
const clock = (m) => (m == null ? "  —  " : `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(Math.round(m % 60)).padStart(2, "0")}`);
const med = (a) => { if (!a.length) return null; const s = [...a].sort((x, y) => x - y); return s[Math.floor(s.length / 2)]; };
const wilson = (k, n) => {
  if (!n) return null;
  const z = 1.96, p = k / n, d = 1 + (z * z) / n;
  const c = p + (z * z) / (2 * n), m = z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n));
  return [(c - m) / d, (c + m) / d].map((x) => (100 * x).toFixed(1) + "%");
};

/* ── build the setup population ───────────────────────────────────────────── */

const rows = [];
for (const date of dates) {
  const l = L.get(date), g = G.get(date);
  if (!l.fcb || l.fcb.side !== "H") continue;      // leader must close-break its IB HIGH
  const gSide = g.fcb ? g.fcb.side : null;
  if (gSide === "H") continue;                     // laggard confirmed HIGH too → not the setup

  const lagLowBreak = gSide === "L";               // laggard close-broke its low
  const lagLowFirst = lagLowBreak && g.fcb.breakMin != null && l.fcb.breakMin != null
    ? g.fcb.breakMin < l.fcb.breakMin              // laggard's low break PRECEDED the leader's high break
    : null;

  rows.push({
    date,
    leadMin: l.fcb.breakMin,
    leadFailed: l.fcb.failed,
    leadExt: l.fcb.rExt,
    leadFadeMid: l.fcb.fadeMid,
    leadFadeOpp: l.fcb.fadeOpp,
    lagBreak: gSide,                               // "L" or null (never "H" here)
    lagMin: g.fcb ? g.fcb.breakMin : null,
    lagFailed: g.fcb ? g.fcb.failed : null,
    lagExt: g.fcb ? g.fcb.rExt : null,
    lagTouchedL: g.touchedL,                       // wick touch of the laggard's IB low, any time
    lagTouchedH: g.touchedH,
    lagCloseZone: g.closeZone,
    leadCloseZone: l.closeZone,
    lagLowFirst,
    openType: l.openType,
  });
}

const N = rows.length;
const lowBreak = rows.filter((r) => r.lagBreak === "L");
const lowTouchOnly = rows.filter((r) => r.lagBreak !== "L" && r.lagTouchedL);
const noLow = rows.filter((r) => r.lagBreak !== "L" && !r.lagTouchedL);

/* order-verified subsets */
const lowAfter = lowBreak.filter((r) => r.lagLowFirst === false);   // leader broke high FIRST, laggard low after
const lowBefore = lowBreak.filter((r) => r.lagLowFirst === true);   // laggard was already short before the leader's high break
const lowSameBar = lowBreak.filter((r) => r.lagLowFirst === null || r.lagMin === r.leadMin);

/* the money question: given LEADER breaks high FIRST, does the laggard then break its low? */
const leadFirstPop = rows.filter((r) => r.lagMin == null || r.leadMin <= r.lagMin);
const leadFirstThenLow = leadFirstPop.filter((r) => r.lagBreak === "L");
const leadFirstThenTouch = leadFirstPop.filter((r) => r.lagTouchedL);

/* leader's high break quality inside this setup vs the whole book */
const leadFail = rows.filter((r) => r.leadFailed).length;
const leadFadeMid = rows.filter((r) => r.leadFadeMid).length;
const leadFadeOpp = rows.filter((r) => r.leadFadeOpp).length;

const allLeadHigh = [...L.values()].filter((d) => d.fcb && d.fcb.side === "H");
const baseFail = allLeadHigh.filter((d) => d.fcb.failed).length;

/* did the day resolve? */
const closedUp = rows.filter((r) => r.leadCloseZone === "top25").length;
const closedDown = rows.filter((r) => r.leadCloseZone === "bot25").length;
const closedMid = rows.filter((r) => r.leadCloseZone === "mid50").length;

const out = {
  generated: new Date().toISOString(),
  setup: `${LEAD} close-breaks IB HIGH, ${LAG} does not`,
  range: { from: dates[0], to: dates[dates.length - 1], sessions: dates.length },
  n: N,
  lagLowBreak: lowBreak.length,
  lagLowTouchOnly: lowTouchOnly.length,
  lagNoLow: noLow.length,
  sequenced: {
    lagLowAfterLeadHigh: lowAfter.length,
    lagLowBeforeLeadHigh: lowBefore.length,
    sameBarOrUnknown: lowSameBar.length,
  },
  leadBrokeFirst: {
    n: leadFirstPop.length,
    thenLagLowBreak: leadFirstThenLow.length,
    thenLagLowTouch: leadFirstThenTouch.length,
  },
  leadQuality: {
    failedBreak: leadFail,
    failedPct: (100 * leadFail) / (N || 1),
    baselineFailedPct: (100 * baseFail) / (allLeadHigh.length || 1),
    fadeToMid: leadFadeMid,
    fadeToOpposite: leadFadeOpp,
    medExt: med(rows.map((r) => r.leadExt).filter((x) => x != null)),
  },
  closeZone: { up: closedUp, down: closedDown, mid: closedMid },
  rows,
};

if (AS_JSON) {
  const dir = path.join(ROOT, "scripts", "out");
  fs.mkdirSync(dir, { recursive: true });
  const f = path.join(dir, `ib-${LEAD.toLowerCase()}high-${LAG.toLowerCase()}low.json`);
  fs.writeFileSync(f, JSON.stringify(out, null, 2));
  console.log(`wrote ${f}`);
}

const B = (s) => `\x1b[1m${s}\x1b[0m`;
const line = () => console.log("─".repeat(74));

console.log("");
console.log(B(`SETUP: ${LEAD} close-breaks IB HIGH  •  ${LAG} does NOT break its IB high`));
console.log(`${dates[0]} → ${dates[dates.length - 1]}   ${dates.length} paired sessions   →   ${B(N + " setup days")}  (${pct(N, dates.length)})`);

line();
console.log(B(`Q: does ${LAG} go hit its IB LOW?`));
console.log(`${LAG} CLOSE-BROKE its IB low .... ${String(lowBreak.length).padStart(4)}   ${pct(lowBreak.length, N)}   95% CI ${wilson(lowBreak.length, N)?.join(" – ") ?? "—"}`);
console.log(`${LAG} only WICKED the low ....... ${String(lowTouchOnly.length).padStart(4)}   ${pct(lowTouchOnly.length, N)}`);
console.log(`${LAG} never reached the low ..... ${String(noLow.length).padStart(4)}   ${pct(noLow.length, N)}`);
console.log(`─ any contact with the low ...... ${String(lowBreak.length + lowTouchOnly.length).padStart(4)}   ${pct(lowBreak.length + lowTouchOnly.length, N)}`);

line();
console.log(B("ORDER OF EVENTS  (only the laggard's FIRST break is timestamped — see header)"));
console.log(`${LAG} low broke AFTER ${LEAD}'s high break ... ${String(lowAfter.length).padStart(4)}   ${pct(lowAfter.length, lowBreak.length)} of low-breaks`);
console.log(`${LAG} was ALREADY short before it ......... ${String(lowBefore.length).padStart(4)}   ${pct(lowBefore.length, lowBreak.length)}   ← today's shape`);
console.log(`same bar / unsequenced ................ ${String(lowSameBar.length).padStart(4)}   ${pct(lowSameBar.length, lowBreak.length)}`);
console.log("");
console.log(`Given ${LEAD} broke high FIRST (n=${leadFirstPop.length}):`);
console.log(`   ${LAG} then close-broke its low .... ${String(leadFirstThenLow.length).padStart(4)}   ${pct(leadFirstThenLow.length, leadFirstPop.length)}`);
console.log(`   ${LAG} then touched its low ........ ${String(leadFirstThenTouch.length).padStart(4)}   ${pct(leadFirstThenTouch.length, leadFirstPop.length)}`);

line();
console.log(B(`${LEAD}'s HIGH BREAK QUALITY in this setup  (does the "fade" read hold?)`));
console.log(`failed break (back inside ≤30m) . ${pct(leadFail, N)}   vs ${pct(baseFail, allLeadHigh.length)} on ALL ${LEAD} high breaks`);
console.log(`faded to IB mid ................. ${pct(leadFadeMid, N)}`);
console.log(`faded to IB LOW (full rotation) . ${pct(leadFadeOpp, N)}`);
console.log(`median extension ................ ${out.leadQuality.medExt?.toFixed(2) ?? "—"} IB widths`);
console.log(`${LEAD} close zone:  top25 ${pct(closedUp, N)}   mid50 ${pct(closedMid, N)}   bot25 ${pct(closedDown, N)}`);

line();
console.log(B("LAST 12 OCCURRENCES"));
console.log(`  date         ${LEAD}-H t   ${LAG} brk  t      ${LAG} hit low   ${LEAD} failed   ${LEAD} close`);
for (const r of rows.slice(-12)) {
  console.log(
    `  ${r.date}   ${clock(r.leadMin)}   ${(r.lagBreak ?? "—").padEnd(3)} ${clock(r.lagMin)}   ` +
    `${(r.lagBreak === "L" ? "BROKE" : r.lagTouchedL ? "wick" : "no").padEnd(9)}  ${(r.leadFailed ? "yes" : "no").padEnd(8)}  ${r.leadCloseZone}`
  );
}

line();
const anyLow = lowBreak.length + lowTouchOnly.length;
console.log(
  B(
    N < 30
      ? `VERDICT: n=${N}. Too thin. Anecdote, not an edge.`
      : `VERDICT: when ${LEAD} breaks IB high and ${LAG} doesn't, ${LAG} closes below its IB low ${pct(lowBreak.length, N)} of the time (${pct(anyLow, N)} at least touch it), and ${LEAD}'s own high break fails ${pct(leadFail, N)}. n=${N}.`
  )
);
console.log("");
