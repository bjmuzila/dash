/**
 * scripts/ib-eshigh-cohorts.mjs
 *
 * ES breaks its IB HIGH. Does NQ CONFIRM (also breaks high) or DIVERGE?
 * Compares ES's break quality across every NQ cohort, side by side.
 *
 *   node scripts/ib-eshigh-cohorts.mjs
 *   node scripts/ib-eshigh-cohorts.mjs --flip          (NQ is the leader, ES the confirmer)
 *   node scripts/ib-eshigh-cohorts.mjs --low           (leader breaks IB LOW instead)
 *   node scripts/ib-eshigh-cohorts.mjs --since 2023-01-01
 *   node scripts/ib-eshigh-cohorts.mjs --json
 *
 * COHORTS (leader = ES high break, close-confirmed):
 *   CONFIRM-first   NQ also close-broke high, BEFORE ES   → NQ dragged ES up
 *   CONFIRM-after   NQ also close-broke high, AFTER  ES   → ES dragged NQ up
 *   DIVERGE-low     NQ close-broke its IB LOW             → today
 *   NO-BREAK        NQ never close-broke either side      → NQ inside, ES alone
 *
 * Every metric below is ES's own, so the cohorts are directly comparable:
 * failed break, fade-to-mid, full rotation to IB low, median extension,
 * hit rates at 0.5 / 1.0 / 1.5 / 2.0 IB widths, and the IB close zone.
 *
 * NO LOOKAHEAD: all fields were stamped at their own confirm bar upstream.
 */

import fs from "node:fs";
import path from "node:path";

const ROOT = process.cwd();
const argv = process.argv.slice(2);
const FLIP = argv.includes("--flip");
const LOW = argv.includes("--low");
const AS_JSON = argv.includes("--json");
const si = argv.indexOf("--since");
const SINCE = si >= 0 && /^\d{4}-\d{2}-\d{2}$/.test(argv[si + 1] || "") ? argv[si + 1] : null;

const LEAD = FLIP ? "NQ" : "ES";
const OTHER = FLIP ? "ES" : "NQ";
const SIDE = LOW ? "L" : "H";
const OPP = LOW ? "H" : "L";
const SIDEW = LOW ? "LOW" : "HIGH";
const OPPW = LOW ? "HIGH" : "LOW";
/* the close zone that means "the leader's break worked" */
const GOOD = LOW ? "bot25" : "top25";
const BAD = LOW ? "top25" : "bot25";

function load(sym) {
  const p = path.join(ROOT, "public", "data", `ib-${sym}.json`);
  if (!fs.existsSync(p)) { console.error(`missing ${p}`); process.exit(1); }
  const m = new Map();
  for (const d of JSON.parse(fs.readFileSync(p, "utf8")).days) {
    if (!SINCE || d.date >= SINCE) m.set(d.date, d);
  }
  return m;
}
const L = load(LEAD);
const O = load(OTHER);
const dates = [...L.keys()].filter((d) => O.has(d)).sort();

const pct = (n, d) => (d ? ((100 * n) / d).toFixed(1) + "%" : "—");
const med = (a) => { if (!a.length) return null; const s = [...a].sort((x, y) => x - y); return s[Math.floor(s.length / 2)]; };
const num = (x, dg = 2) => (x == null ? "—" : x.toFixed(dg));

/* ── bucket every leader-break session ────────────────────────────────────── */

const COHORTS = {
  "CONFIRM-first": [],
  "CONFIRM-after": [],
  [`DIVERGE-${OPPW.toLowerCase()}`]: [],
  "NO-BREAK": [],
};

for (const date of dates) {
  const l = L.get(date), o = O.get(date);
  if (!l.fcb || l.fcb.side !== SIDE) continue;   // leader must close-break the chosen side
  const oSide = o.fcb ? o.fcb.side : null;

  let key;
  if (oSide === SIDE) {
    key = o.fcb.breakMin < l.fcb.breakMin ? "CONFIRM-first" : "CONFIRM-after";
  } else if (oSide === OPP) {
    key = `DIVERGE-${OPPW.toLowerCase()}`;
  } else {
    key = "NO-BREAK";
  }

  COHORTS[key].push({
    date,
    leadMin: l.fcb.breakMin,
    otherMin: o.fcb ? o.fcb.breakMin : null,
    gap: o.fcb ? o.fcb.breakMin - l.fcb.breakMin : null,
    failed: l.fcb.failed,
    fadeMid: l.fcb.fadeMid,
    fadeOpp: l.fcb.fadeOpp,
    retest: l.fcb.retest,
    retestCont: l.fcb.retestCont,
    volSurge: l.fcb.volSurge,
    rExt: l.fcb.rExt,
    hit: l.fcb.hit,
    closeZone: l.closeZone,
    otherTouchedOpp: LOW ? o.touchedH : o.touchedL,
    openType: l.openType,
  });
}

function stat(name, rs) {
  const n = rs.length;
  const c = (f) => rs.filter(f).length;
  const hit = (t) => c((r) => r.hit && r.hit[t]);
  return {
    name, n,
    failed: c((r) => r.failed),
    fadeMid: c((r) => r.fadeMid),
    fadeOpp: c((r) => r.fadeOpp),
    volSurge: c((r) => r.volSurge),
    retestCont: c((r) => r.retestCont === true),
    medExt: med(rs.map((r) => r.rExt).filter((x) => x != null)),
    h05: hit("0.5"), h10: hit("1"), h15: hit("1.5"), h20: hit("2"),
    good: c((r) => r.closeZone === GOOD),
    mid: c((r) => r.closeZone === "mid50"),
    bad: c((r) => r.closeZone === BAD),
    medGap: med(rs.map((r) => r.gap).filter((x) => x != null)),
  };
}

const order = ["CONFIRM-first", "CONFIRM-after", `DIVERGE-${OPPW.toLowerCase()}`, "NO-BREAK"];
const S = order.map((k) => stat(k, COHORTS[k]));
const ALL = stat("ALL", order.flatMap((k) => COHORTS[k]));
const CONFIRM = stat("CONFIRM (both)", [...COHORTS["CONFIRM-first"], ...COHORTS["CONFIRM-after"]]);
const total = ALL.n;

/* ── output ───────────────────────────────────────────────────────────────── */

const B = (s) => `\x1b[1m${s}\x1b[0m`;
const line = (w = 92) => console.log("─".repeat(w));
const P = (s, w) => String(s).padStart(w);
const Q = (s, w) => String(s).padEnd(w);

console.log("");
console.log(B(`LEADER = ${LEAD} close-breaks its IB ${SIDEW}   •   does ${OTHER} confirm or diverge?`));
console.log(`${dates[0]} → ${dates[dates.length - 1]}   ${dates.length} paired sessions   →   ${B(total)} ${LEAD} ${SIDEW}-break days`);

line();
console.log(B("COHORT MIX"));
for (const s of [...S, CONFIRM]) {
  console.log(`  ${Q(s.name, 16)} ${P(s.n, 5)}   ${P(pct(s.n, total), 7)}`);
}

line();
console.log(B(`${LEAD}'s BREAK QUALITY BY COHORT   (all metrics are ${LEAD}'s own — directly comparable)`));
console.log("");
const cols = [...S, ALL];
const hdr = ["metric", ...cols.map((c) => c.name)];
const W = [18, ...cols.map((c) => Math.max(13, c.name.length + 2))];
console.log(B(hdr.map((h, i) => (i ? P(h, W[i]) : Q(h, W[i]))).join("")));
console.log("  n" + cols.map((c, i) => P(c.n, W[i + 1])).join("").slice(1).padStart(0));

const rowsOut = [
  ["FAILED break", (c) => pct(c.failed, c.n)],
  ["  fade → IB mid", (c) => pct(c.fadeMid, c.n)],
  [`  fade → IB ${OPPW.toLowerCase()}`, (c) => pct(c.fadeOpp, c.n)],
  ["median ext (IBw)", (c) => num(c.medExt)],
  ["hit 0.5x", (c) => pct(c.h05, c.n)],
  ["hit 1.0x", (c) => pct(c.h10, c.n)],
  ["hit 1.5x", (c) => pct(c.h15, c.n)],
  ["hit 2.0x", (c) => pct(c.h20, c.n)],
  ["retest held", (c) => pct(c.retestCont, c.n)],
  ["vol surge on brk", (c) => pct(c.volSurge, c.n)],
  [`close ${GOOD}`, (c) => pct(c.good, c.n)],
  ["close mid50", (c) => pct(c.mid, c.n)],
  [`close ${BAD}`, (c) => pct(c.bad, c.n)],
];
for (const [label, f] of rowsOut) {
  console.log(Q(label, W[0]) + cols.map((c, i) => P(f(c), W[i + 1])).join(""));
}

line();
console.log(B("EDGE = CONFIRM minus DIVERGE"));
const CF = CONFIRM;
const DV = S.find((s) => s.name.startsWith("DIVERGE"));
const d = (a, b, k) => ((100 * a[k]) / (a.n || 1) - (100 * b[k]) / (b.n || 1)).toFixed(1);
console.log(`  failed break ....... CONFIRM ${pct(CF.failed, CF.n)}  vs  DIVERGE ${pct(DV.failed, DV.n)}   Δ ${d(CF, DV, "failed")} pts`);
console.log(`  hit 1.0x IB ........ CONFIRM ${pct(CF.h10, CF.n)}  vs  DIVERGE ${pct(DV.h10, DV.n)}   Δ ${d(CF, DV, "h10")} pts`);
console.log(`  full rotation ...... CONFIRM ${pct(CF.fadeOpp, CF.n)}  vs  DIVERGE ${pct(DV.fadeOpp, DV.n)}   Δ ${d(CF, DV, "fadeOpp")} pts`);
console.log(`  close ${GOOD} ...... CONFIRM ${pct(CF.good, CF.n)}  vs  DIVERGE ${pct(DV.good, DV.n)}   Δ ${d(CF, DV, "good")} pts`);
console.log(`  median extension ... CONFIRM ${num(CF.medExt)}  vs  DIVERGE ${num(DV.medExt)}  IB widths`);

line();
console.log(B("CONFIRMATION TIMING — when the other index joins"));
const cf = COHORTS["CONFIRM-first"], ca = COHORTS["CONFIRM-after"];
console.log(`  ${OTHER} broke FIRST ... ${P(cf.length, 4)}  ${pct(cf.length, CF.n)}   median lead ${num(Math.abs(stat("x", cf).medGap ?? 0), 0)} min   ${LEAD} failed ${pct(stat("x", cf).failed, cf.length)}`);
console.log(`  ${OTHER} broke AFTER ... ${P(ca.length, 4)}  ${pct(ca.length, CF.n)}   median lag  ${num(stat("x", ca).medGap ?? 0, 0)} min   ${LEAD} failed ${pct(stat("x", ca).failed, ca.length)}`);

line();
console.log(B(`LAST 12  ${LEAD} ${SIDEW}-BREAK SESSIONS`));
console.log(`  date         cohort           ${LEAD} t   ${OTHER} t    ext    failed  close`);
const recent = order.flatMap((k) => COHORTS[k].map((r) => ({ ...r, k }))).sort((a, b) => (a.date < b.date ? -1 : 1)).slice(-12);
const clk = (m) => (m == null ? "  —  " : `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(Math.round(m % 60)).padStart(2, "0")}`);
for (const r of recent) {
  console.log(`  ${r.date}   ${Q(r.k, 16)} ${clk(r.leadMin)}  ${clk(r.otherMin)}  ${P(num(r.rExt), 5)}   ${Q(r.failed ? "yes" : "no", 6)}  ${r.closeZone}`);
}

line();
const better = 100 * (CF.h10 / (CF.n || 1)) - 100 * (DV.h10 / (DV.n || 1));
console.log(
  B(
    DV.n < 30
      ? `VERDICT: divergence cohort n=${DV.n} — too thin to trade off.`
      : `VERDICT: ${LEAD} ${SIDEW} break with ${OTHER} CONFIRMING reaches 1.0x IB ${pct(CF.h10, CF.n)} and fails ${pct(CF.failed, CF.n)}. ` +
        `With ${OTHER} DIVERGING (${OPPW.toLowerCase()} break) it reaches 1.0x only ${pct(DV.h10, DV.n)} and fails ${pct(DV.failed, DV.n)} — ` +
        `${better >= 0 ? "confirmation is worth" : "divergence is worth"} ${Math.abs(better).toFixed(1)} pts of 1x-hit rate.`
  )
);
console.log("");

if (AS_JSON) {
  const dir = path.join(ROOT, "scripts", "out");
  fs.mkdirSync(dir, { recursive: true });
  const f = path.join(dir, `ib-${LEAD.toLowerCase()}${SIDE.toLowerCase()}-cohorts.json`);
  fs.writeFileSync(f, JSON.stringify({ leader: LEAD, side: SIDE, total, cohorts: COHORTS, stats: [...S, CONFIRM, ALL] }, null, 2));
  console.log(`wrote ${f}\n`);
}
