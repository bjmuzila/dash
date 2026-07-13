/**
 * IB HIGH break — WICK-only vs CLOSE-confirmed.
 *
 *   node scripts/ib-wick-vs-close.mjs        # NQ (default)
 *   node scripts/ib-wick-vs-close.mjs ES
 *
 * Reads public/data/ib-<SYM>.json (the slim per-session export).
 *
 * Definitions, straight off the dataset:
 *   touchedH        — any bar HIGH traded above the IB high (a wick counts)
 *   fcb.side === H  — a bar CLOSED above the IB high (close-confirmed break)
 *   WICK-ONLY       — touchedH && the first close-confirmed break was NOT the high
 *                     (i.e. the high got poked but never closed through it)
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const sym = (process.argv[2] ?? "NQ").toUpperCase();
const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const ds = JSON.parse(readFileSync(join(root, "public", "data", `ib-${sym}.json`), "utf8"));
const days = ds.days;

const pct = (n, d) => (d ? `${((100 * n) / d).toFixed(1)}%` : "—");
const f2 = (n) => (Number.isFinite(n) ? n.toFixed(2) : "—");
const avg = (a) => (a.length ? a.reduce((s, x) => s + x, 0) / a.length : NaN);

/* ── the three populations ─────────────────────────────────────────────────── */
const touchedH = days.filter((d) => d.touchedH);
const closeH = days.filter((d) => d.fcb && d.fcb.side === "H");            // closed above the IB high
const wickH = touchedH.filter((d) => !(d.fcb && d.fcb.side === "H"));      // poked it, never closed through
const noTouchH = days.filter((d) => !d.touchedH);

console.log(`\n${ds.symbol} · ${ds.sessions} sessions · ${ds.from} → ${ds.to} · ${ds.barMinutes}m RTH bars`);
console.log(`\n${"─".repeat(78)}\nIB HIGH — how the high gets taken\n${"─".repeat(78)}`);
console.log(`Never touched the high        ${String(noTouchH.length).padStart(4)}   ${pct(noTouchH.length, days.length)}`);
console.log(`Touched the high (any wick)   ${String(touchedH.length).padStart(4)}   ${pct(touchedH.length, days.length)}`);
console.log(`  └ CLOSE-confirmed break     ${String(closeH.length).padStart(4)}   ${pct(closeH.length, days.length)} of all days · ${pct(closeH.length, touchedH.length)} of the touches`);
console.log(`  └ WICK-ONLY (the trap)      ${String(wickH.length).padStart(4)}   ${pct(wickH.length, days.length)} of all days · ${pct(wickH.length, touchedH.length)} of the touches`);

/* ── what happens next ─────────────────────────────────────────────────────── */
const hit = (d, t) => !!d.fcb?.hit?.[t];

console.log(`\n${"─".repeat(90)}\nWHAT HAPPENS NEXT   (hits / n)\n${"─".repeat(90)}`);
console.log(`${"".padEnd(38)}${`CLOSE-confirmed (n=${closeH.length})`.padStart(24)}${`WICK-only (n=${wickH.length})`.padStart(26)}`);
const cell = (hits, n) => `${pct(hits, n)} (${hits}/${n})`;
const row = (label, cFn, wFn) =>
  console.log(
    `${label.padEnd(38)}${cell(closeH.filter(cFn).length, closeH.length).padStart(24)}${cell(wickH.filter(wFn).length, wickH.length).padStart(26)}`
  );

row("Low ALSO breaks (rotation)", (d) => d.touchedL, (d) => d.touchedL);
row("Low NEVER breaks (clean one-sided)", (d) => !d.touchedL, (d) => !d.touchedL);
row("Ran >= 0.5x IB width past the high", (d) => hit(d, "0.5"), () => false);
row("Ran >= 1x IB width past the high", (d) => hit(d, "1"), () => false);
row("Ran >= 2x IB width past the high", (d) => hit(d, "2"), () => false);
row("Break FAILED back inside <=30m", (d) => d.fcb.failed, () => false);
row("Reached the IB MIDPOINT after", (d) => d.fcb.fadeMid, (d) => d.fcb ? d.fcb.fadeMid : false);
row("Reached the IB LOW after", (d) => d.fcb.fadeOpp, (d) => d.fcb ? d.fcb.fadeOpp : false);

/* the wick-only column above can't use fcb ext stats (there's no high break to
   measure from), so quantify the wick-only day directly instead */
console.log(`\n${"─".repeat(90)}\nWICK-ONLY DAYS — what the high poke actually led to   (n=${wickH.length})\n${"─".repeat(90)}`);
const wickThenLow = wickH.filter((d) => d.fcb && d.fcb.side === "L");
const wickChop = wickH.filter((d) => !d.fcb);
console.log(`Wicked the high, then CLOSED below the LOW   ${cell(wickThenLow.length, wickH.length)}  <- the reversal`);
console.log(`Wicked the high, no close break either side  ${cell(wickChop.length, wickH.length)}  <- chopped inside`);
if (wickThenLow.length) {
  console.log(`  of those, the low break ran >= 1x IB width  ${cell(wickThenLow.filter((d) => hit(d, "1")).length, wickThenLow.length)}`);
  console.log(`  of those, the low break FAILED             ${cell(wickThenLow.filter((d) => d.fcb.failed).length, wickThenLow.length)}`);
}

/* ── first-touch framing: if the HIGH is the first side touched ─────────────── */
const ftH = days.filter((d) => d.firstTouchSide === "H");
const ftH_close = ftH.filter((d) => d.fcb && d.fcb.side === "H");
const ftH_wick = ftH.filter((d) => !(d.fcb && d.fcb.side === "H"));
console.log(`\n${"─".repeat(90)}\nWHEN THE HIGH IS THE FIRST SIDE TOUCHED\n${"─".repeat(90)}`);
console.log(`High touched first                          ${cell(ftH.length, days.length)} of all days`);
console.log(`  └ it closed through                       ${cell(ftH_close.length, ftH.length)}`);
console.log(`  └ it was a wick / trap                    ${cell(ftH_wick.length, ftH.length)}`);

/* ── excursion: how far the wick actually poked ────────────────────────────── */
const failedH = closeH.filter((d) => d.fcb.failed);
console.log(`\n${"─".repeat(90)}\nSIZE OF THE MOVE\n${"─".repeat(90)}`);
console.log(`Avg IB width                                ${f2(avg(days.map((d) => d.width)))} pts   (n=${days.length})`);
console.log(`Avg MFE past the high, close-confirmed      ${f2(avg(closeH.map((d) => d.fcb.rExt)))} x IB width   (n=${closeH.length})`);
console.log(`Avg MAE (heat) on close-confirmed breaks    ${f2(avg(closeH.map((d) => d.fcb.rAdv)))} x IB width   (n=${closeH.length})`);
console.log(`Avg peak before a FAILED high break         ${f2(avg(failedH.map((d) => d.fcb.peakBeforeFail)))} pts   (n=${failedH.length})\n`);
