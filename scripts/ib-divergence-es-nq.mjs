/**
 * scripts/ib-divergence-es-nq.mjs
 *
 * ES vs NQ Initial Balance break divergence — who LEADS and who LAGS.
 *
 *   node scripts/ib-divergence-es-nq.mjs
 *   node scripts/ib-divergence-es-nq.mjs --since 2024-01-01
 *   node scripts/ib-divergence-es-nq.mjs --json
 *
 * Reads the precomputed slim datasets written by ib-backtest-esu6.html:
 *   public/data/ib-ES.json
 *   public/data/ib-NQ.json
 *
 * Definitions (same as lib/ibStats.ts — do not redefine here):
 *   break     = first 5m CLOSE outside the 09:30–10:30 IB  (fcb)
 *   side      = "H" | "L"
 *   divergent = ES fcb.side !== NQ fcb.side on the same session
 *   resolved  = day's IB close-zone agrees with that instrument's break side
 *               (top25 => "H", bot25 => "L", mid50 => neither)
 *
 * NO LOOKAHEAD: every field consumed here was stamped at its own confirm bar
 * upstream. Nothing in this file peeks forward.
 */

import fs from "node:fs";
import path from "node:path";

const ROOT = process.cwd();
const args = process.argv.slice(2);
const SINCE = (args[args.indexOf("--since") + 1] || "").match(/^\d{4}-\d{2}-\d{2}$/)
  ? args[args.indexOf("--since") + 1]
  : null;
const AS_JSON = args.includes("--json");

/* ── load ─────────────────────────────────────────────────────────────────── */

function load(sym) {
  const p = path.join(ROOT, "public", "data", `ib-${sym}.json`);
  if (!fs.existsSync(p)) {
    console.error(`missing ${p} — export it from ib-backtest-esu6.html first`);
    process.exit(1);
  }
  const ds = JSON.parse(fs.readFileSync(p, "utf8"));
  const map = new Map();
  for (const d of ds.days) {
    if (SINCE && d.date < SINCE) continue;
    map.set(d.date, d);
  }
  return { ds, map };
}

const ES = load("ES");
const NQ = load("NQ");

/* ── pair up sessions ─────────────────────────────────────────────────────── */

const dates = [...ES.map.keys()].filter((d) => NQ.map.has(d)).sort();
if (!dates.length) {
  console.error("no overlapping sessions between ib-ES.json and ib-NQ.json");
  process.exit(1);
}

const side = (d) => (d.fcb ? d.fcb.side : null);
const closeSide = (d) => (d.closeZone === "top25" ? "H" : d.closeZone === "bot25" ? "L" : null);
const pct = (n, d) => (d ? ((100 * n) / d).toFixed(1) + "%" : "—");
const clock = (m) =>
  m == null ? "—" : `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(Math.round(m % 60)).padStart(2, "0")}`;
const median = (a) => {
  if (!a.length) return null;
  const s = [...a].sort((x, y) => x - y);
  return s[Math.floor(s.length / 2)];
};

const rows = dates.map((date) => {
  const e = ES.map.get(date);
  const n = NQ.map.get(date);
  const es = side(e), nq = side(n);
  return {
    date,
    esSide: es, nqSide: nq,
    esMin: e.fcb ? e.fcb.breakMin : null,
    nqMin: n.fcb ? n.fcb.breakMin : null,
    esFailed: e.fcb ? e.fcb.failed : null,
    nqFailed: n.fcb ? n.fcb.failed : null,
    esExt: e.fcb ? e.fcb.rExt : null,
    nqExt: n.fcb ? n.fcb.rExt : null,
    esClose: closeSide(e), nqClose: closeSide(n),
    openType: e.openType,
    widthBucket: e.widthBucket,
    // classification
    kind:
      es && nq ? (es === nq ? "agree" : "divergent")
      : es || nq ? "one-sided"
      : "no-break",
  };
});

const agree = rows.filter((r) => r.kind === "agree");
const diverge = rows.filter((r) => r.kind === "divergent");
const oneSided = rows.filter((r) => r.kind === "one-sided");
const noBreak = rows.filter((r) => r.kind === "no-break");

/* ── 1. leader / lagger on divergent days ─────────────────────────────────── */
/* whoever's break direction the SESSION closes with is the leader that day.
 * "closes with X" = BOTH instruments' IB close-zones agree with X's break side. */

function resolve(r) {
  const withEs = r.esClose === r.esSide && r.nqClose === r.esSide;
  const withNq = r.nqClose === r.nqSide && r.esClose === r.nqSide;
  if (withEs && !withNq) return "ES";
  if (withNq && !withEs) return "NQ";
  return "neither";
}
const divRes = diverge.map(resolve);
const esLed = divRes.filter((x) => x === "ES").length;
const nqLed = divRes.filter((x) => x === "NQ").length;
const noLead = divRes.filter((x) => x === "neither").length;

/* soft read — each instrument judged on its OWN close only (mid50 = unresolved) */
const esOwn = diverge.filter((r) => r.esClose === r.esSide).length;
const nqOwn = diverge.filter((r) => r.nqClose === r.nqSide).length;

/* ── 2. failed-break rate on divergent days — the fake is the one that fails ── */
const esFailDiv = diverge.filter((r) => r.esFailed).length;
const nqFailDiv = diverge.filter((r) => r.nqFailed).length;

/* ── 3. mechanical leader on AGREEING days — who breaks first ─────────────── */
const gaps = agree.filter((r) => r.esMin != null && r.nqMin != null);
const esFirst = gaps.filter((r) => r.esMin < r.nqMin);
const nqFirst = gaps.filter((r) => r.nqMin < r.esMin);
const tied = gaps.filter((r) => r.esMin === r.nqMin);
const medGap = median(gaps.map((r) => Math.abs(r.esMin - r.nqMin)));
/* "follow the first breaker" win rate — did the day close with the first breaker's side? */
const followWins = gaps.filter((r) => {
  const firstSide = r.esMin <= r.nqMin ? r.esSide : r.nqSide;
  return r.esClose === firstSide || r.nqClose === firstSide;
}).length;

/* ── 4. the exact pattern: ES break-HIGH / NQ break-LOW ───────────────────── */
const pat = diverge.filter((r) => r.esSide === "H" && r.nqSide === "L");
const patRes = pat.map(resolve);
const patEs = patRes.filter((x) => x === "ES").length;
const patNq = patRes.filter((x) => x === "NQ").length;
const patNone = patRes.filter((x) => x === "neither").length;
const patEsFail = pat.filter((r) => r.esFailed).length;
const patNqFail = pat.filter((r) => r.nqFailed).length;
const patInv = diverge.filter((r) => r.esSide === "L" && r.nqSide === "H");

/* ── 5. slices ────────────────────────────────────────────────────────────── */
function slice(label, subset) {
  const res = subset.map(resolve);
  return {
    label,
    n: subset.length,
    es: res.filter((x) => x === "ES").length,
    nq: res.filter((x) => x === "NQ").length,
    none: res.filter((x) => x === "neither").length,
  };
}
const slices = [
  slice("open: OAR-H", diverge.filter((r) => r.openType === "OAR-H")),
  slice("open: OAR-L", diverge.filter((r) => r.openType === "OAR-L")),
  slice("open: HIR", diverge.filter((r) => r.openType === "HIR")),
  slice("open: LIR", diverge.filter((r) => r.openType === "LIR")),
  slice("IB narrow", diverge.filter((r) => r.widthBucket === "narrow")),
  slice("IB normal", diverge.filter((r) => r.widthBucket === "normal")),
  slice("IB wide", diverge.filter((r) => r.widthBucket === "wide")),
];

/* ── output ───────────────────────────────────────────────────────────────── */

const out = {
  generated: new Date().toISOString(),
  range: { from: dates[0], to: dates[dates.length - 1], sessions: dates.length },
  mix: {
    agree: agree.length,
    divergent: diverge.length,
    oneSided: oneSided.length,
    noBreak: noBreak.length,
    divergentPct: (100 * diverge.length) / dates.length,
  },
  divergent: {
    n: diverge.length,
    esLed, nqLed, neither: noLead,
    esOwnClose: esOwn, nqOwnClose: nqOwn,
    esFailedBreak: esFailDiv, nqFailedBreak: nqFailDiv,
    esMedExt: median(diverge.map((r) => r.esExt).filter((x) => x != null)),
    nqMedExt: median(diverge.map((r) => r.nqExt).filter((x) => x != null)),
  },
  agreeing: {
    n: gaps.length,
    esBrokeFirst: esFirst.length,
    nqBrokeFirst: nqFirst.length,
    tied: tied.length,
    medianGapMin: medGap,
    followFirstBreakerWinPct: gaps.length ? (100 * followWins) / gaps.length : null,
  },
  pattern_ES_high_NQ_low: {
    n: pat.length,
    esLed: patEs, nqLed: patNq, neither: patNone,
    esFailedBreak: patEsFail, nqFailedBreak: patNqFail,
  },
  pattern_ES_low_NQ_high: { n: patInv.length },
  slices,
  rows: diverge,
};

if (AS_JSON) {
  const dir = path.join(ROOT, "scripts", "out");
  fs.mkdirSync(dir, { recursive: true });
  const f = path.join(dir, "ib-divergence-es-nq.json");
  fs.writeFileSync(f, JSON.stringify(out, null, 2));
  console.log(`wrote ${f}`);
}

const B = (s) => `\x1b[1m${s}\x1b[0m`;
const line = () => console.log("─".repeat(72));

console.log("");
console.log(B(`ES vs NQ — IB break divergence   ${dates[0]} → ${dates[dates.length - 1]}   (${dates.length} sessions)`));
line();
console.log(`both broke, SAME side .... ${String(agree.length).padStart(5)}   ${pct(agree.length, dates.length)}`);
console.log(`both broke, OPPOSITE ..... ${String(diverge.length).padStart(5)}   ${pct(diverge.length, dates.length)}  ← divergence set`);
console.log(`only one broke ........... ${String(oneSided.length).padStart(5)}   ${pct(oneSided.length, dates.length)}`);
console.log(`neither broke ............ ${String(noBreak.length).padStart(5)}   ${pct(noBreak.length, dates.length)}`);

line();
console.log(B("LEADER / LAGGER — divergent days (which break the day closed with)"));
console.log(`ES led ................... ${String(esLed).padStart(5)}   ${pct(esLed, diverge.length)}`);
console.log(`NQ led ................... ${String(nqLed).padStart(5)}   ${pct(nqLed, diverge.length)}`);
console.log(`neither (chop / mid) ..... ${String(noLead).padStart(5)}   ${pct(noLead, diverge.length)}`);
console.log(`own-close only  ES ${pct(esOwn, diverge.length)}   NQ ${pct(nqOwn, diverge.length)}`);
console.log(`failed break    ES ${pct(esFailDiv, diverge.length)}   NQ ${pct(nqFailDiv, diverge.length)}   ← the one that fails is the fake`);
console.log(`median rExt     ES ${out.divergent.esMedExt?.toFixed(2) ?? "—"}   NQ ${out.divergent.nqMedExt?.toFixed(2) ?? "—"}   (IB widths)`);

line();
console.log(B("MECHANICAL LEADER — agreeing days (who breaks first)"));
console.log(`ES broke first ........... ${String(esFirst.length).padStart(5)}   ${pct(esFirst.length, gaps.length)}`);
console.log(`NQ broke first ........... ${String(nqFirst.length).padStart(5)}   ${pct(nqFirst.length, gaps.length)}`);
console.log(`same bar ................. ${String(tied.length).padStart(5)}   ${pct(tied.length, gaps.length)}`);
console.log(`median gap ............... ${medGap != null ? medGap + " min" : "—"}`);
console.log(`follow-the-first-breaker . ${out.agreeing.followFirstBreakerWinPct?.toFixed(1) ?? "—"}%`);

line();
console.log(B("TODAY'S PATTERN — ES break HIGH / NQ break LOW"));
console.log(`sample ................... ${pat.length} sessions`);
console.log(`ES led (day closed up) ... ${String(patEs).padStart(5)}   ${pct(patEs, pat.length)}`);
console.log(`NQ led (day closed down) . ${String(patNq).padStart(5)}   ${pct(patNq, pat.length)}`);
console.log(`neither .................. ${String(patNone).padStart(5)}   ${pct(patNone, pat.length)}`);
console.log(`ES break failed .......... ${pct(patEsFail, pat.length)}`);
console.log(`NQ break failed .......... ${pct(patNqFail, pat.length)}`);
console.log(`(mirror: ES-low/NQ-high = ${patInv.length} sessions)`);

line();
console.log(B("SLICES — divergent days"));
console.log("  slice          n     ES led    NQ led    neither");
for (const s of slices) {
  console.log(
    `  ${s.label.padEnd(12)} ${String(s.n).padStart(4)}   ${pct(s.es, s.n).padStart(7)}   ${pct(s.nq, s.n).padStart(7)}   ${pct(s.none, s.n).padStart(7)}`
  );
}

line();
console.log(B("LAST 10 DIVERGENT SESSIONS"));
console.log("  date         ES    t      NQ    t      closed with");
for (const r of diverge.slice(-10)) {
  console.log(
    `  ${r.date}   ${r.esSide}  ${clock(r.esMin).padEnd(6)} ${r.nqSide}  ${clock(r.nqMin).padEnd(6)} ${resolve(r)}`
  );
}

line();
if (pat.length < 20) {
  console.log(B(`VERDICT: sample too thin (${pat.length}) — treat as anecdote, not an edge.`));
} else {
  const lead = patEs > patNq ? "ES" : patNq > patEs ? "NQ" : "neither";
  console.log(
    B(
      `VERDICT: on ES-up / NQ-down divergence, ${lead} is the LEADER — day closes with ES ${pct(patEs, pat.length)}, with NQ ${pct(patNq, pat.length)}, chop ${pct(patNone, pat.length)} (n=${pat.length}).`
    )
  );
}
console.log("");
