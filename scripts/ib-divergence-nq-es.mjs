/**
 * NQ / ES IB-high DIVERGENCE.
 *
 *   node scripts/ib-divergence-nq-es.mjs           # close-confirmed breaks (default)
 *   node scripts/ib-divergence-nq-es.mjs touch     # any-wick touches instead
 *
 * The question: on sessions where NQ closes above its IB high but ES does NOT,
 * where do the two actually end up? Is the ES a laggard that catches up (buy the
 * ES), or is the NQ break the fake-out (fade the NQ)?
 *
 * Joins public/data/ib-NQ.json and ib-ES.json on the session date, so only days
 * present in BOTH datasets are scored.
 *
 * NOTE ON RESOLUTION: these exports are 1m bars. A "close-confirmed break" is one
 * 1m close beyond the level, and "failed" is one 1m close back inside — both fire
 * on noise. Read the DIRECTION of the divergence, not the absolute magnitudes.
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const mode = (process.argv[2] ?? "close").toLowerCase();   // "close" | "touch"
const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const load = (s) => JSON.parse(readFileSync(join(root, "public", "data", `ib-${s}.json`), "utf8"));

const nqDs = load("NQ");
const esDs = load("ES");

const esBy = new Map(esDs.days.map((d) => [d.date, d]));
const pairs = nqDs.days
  .filter((n) => esBy.has(n.date))
  .map((n) => ({ date: n.date, nq: n, es: esBy.get(n.date) }));

const pct = (n, d) => (d ? `${((100 * n) / d).toFixed(1)}%` : "—");
const cell = (h, n) => `${pct(h, n)} (${h}/${n})`;
const f2 = (n) => (Number.isFinite(n) ? n.toFixed(2) : "—");
const avg = (a) => (a.length ? a.reduce((s, x) => s + x, 0) / a.length : NaN);
const clock = (m) => (Number.isFinite(m) ? `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}` : "—");

/* break definitions */
const brokeH = (d) => (mode === "touch" ? d.touchedH : !!d.fcb && d.fcb.side === "H");
const brokeL = (d) => (mode === "touch" ? d.touchedL : !!d.fcb && d.fcb.side === "L");
const hit = (d, t) => !!d.fcb?.hit?.[t];
const hiBreak = (d) => (d.fcb && d.fcb.side === "H" ? d.fcb : null);

/* ── the four states ───────────────────────────────────────────────────────── */
const bothH = pairs.filter((p) => brokeH(p.nq) && brokeH(p.es));
const nqOnly = pairs.filter((p) => brokeH(p.nq) && !brokeH(p.es));   // <- the divergence
const esOnly = pairs.filter((p) => !brokeH(p.nq) && brokeH(p.es));   // <- the mirror
const neither = pairs.filter((p) => !brokeH(p.nq) && !brokeH(p.es));

console.log(`\nNQ vs ES · IB HIGH · ${pairs.length} matched sessions · ${mode === "touch" ? "ANY-WICK touch" : "CLOSE-confirmed break"} · ${nqDs.barMinutes}m bars`);
console.log(`\n${"─".repeat(88)}\nHOW OFTEN DO THEY AGREE?\n${"─".repeat(88)}`);
console.log(`BOTH break the high          ${cell(bothH.length, pairs.length)}`);
console.log(`NQ breaks, ES does NOT       ${cell(nqOnly.length, pairs.length)}   <- the setup`);
console.log(`ES breaks, NQ does NOT       ${cell(esOnly.length, pairs.length)}   <- the mirror`);
console.log(`NEITHER breaks               ${cell(neither.length, pairs.length)}`);

/* ── the core question ─────────────────────────────────────────────────────── */
console.log(`\n${"─".repeat(88)}\nNQ BREAKS THE HIGH, ES DOESN'T — where does each one go?   (n=${nqOnly.length})\n${"─".repeat(88)}`);
const row = (label, fn, pop = nqOnly) => console.log(`${label.padEnd(50)}${cell(pop.filter(fn).length, pop.length).padStart(20)}`);

console.log(`\n  ES — the laggard:`);
row("  ES still WICKS its IB high (no close)", (p) => p.es.touchedH && !(p.es.fcb && p.es.fcb.side === "H"));
row("  ES never touches its high at all", (p) => !p.es.touchedH);
row("  ES breaks its IB LOW instead", (p) => brokeL(p.es));
row("  ES touches its low (any wick)", (p) => p.es.touchedL);
row("  ES stays fully contained in its IB", (p) => !p.es.touchedH && !p.es.touchedL);

console.log(`\n  NQ — was its own break real?`);
row("  NQ break FAILED back inside <=30m", (p) => !!hiBreak(p.nq)?.failed);
row("  NQ ran >= 0.5x IB width past the high", (p) => hit(p.nq, "0.5"));
row("  NQ ran >= 1x IB width past the high", (p) => hit(p.nq, "1"));
row("  NQ ran >= 2x IB width past the high", (p) => hit(p.nq, "2"));
row("  NQ came back to its IB midpoint", (p) => !!hiBreak(p.nq)?.fadeMid);
row("  NQ went all the way to its IB LOW", (p) => !!hiBreak(p.nq)?.fadeOpp);
row("  NQ also broke its LOW (full rotation)", (p) => p.nq.touchedL);

/* ── HOW MUCH DOES THE ORIGINAL STAT MOVE? ─────────────────────────────────
 * The baseline is EVERY NQ close-confirmed high break, regardless of what ES
 * did — i.e. exactly the number ib-wick-vs-close.mjs prints. Then we split that
 * same population by whether ES confirmed, and show the swing from baseline.
 * If the DELTA column is ~0, the ES filter is worthless: it's just the base rate.
 */
const allH = pairs.filter((p) => brokeH(p.nq));   // the original, unfiltered stat
console.log(`\n${"─".repeat(104)}\nHOW MUCH DOES THE ORIGINAL STAT CHANGE?\n${"─".repeat(104)}`);
console.log(`${"".padEnd(38)}${`BASELINE all NQ (n=${allH.length})`.padStart(22)}${`ES DIVERGED (n=${nqOnly.length})`.padStart(22)}${"DELTA".padStart(11)}${`ES CONFIRMED (n=${bothH.length})`.padStart(23)}`);
const cmp = (label, fn) => {
  const p0 = (100 * allH.filter(fn).length) / (allH.length || 1);
  const pd = (100 * nqOnly.filter(fn).length) / (nqOnly.length || 1);
  const pc = (100 * bothH.filter(fn).length) / (bothH.length || 1);
  const delta = pd - p0;
  const flag = Math.abs(delta) >= 10 ? "  **" : Math.abs(delta) >= 5 ? "  *" : "";
  console.log(
    `${label.padEnd(38)}${`${p0.toFixed(1)}%`.padStart(22)}${`${pd.toFixed(1)}%`.padStart(22)}${`${delta >= 0 ? "+" : ""}${delta.toFixed(1)}pt`.padStart(11)}${`${pc.toFixed(1)}%`.padStart(23)}${flag}`
  );
};
cmp("NQ break FAILED <=30m", (p) => !!hiBreak(p.nq)?.failed);
cmp("NQ ran >= 0.5x IB width", (p) => hit(p.nq, "0.5"));
cmp("NQ ran >= 1x IB width", (p) => hit(p.nq, "1"));
cmp("NQ ran >= 2x IB width", (p) => hit(p.nq, "2"));
cmp("NQ faded to its IB midpoint", (p) => !!hiBreak(p.nq)?.fadeMid);
cmp("NQ faded to its IB LOW", (p) => !!hiBreak(p.nq)?.fadeOpp);
cmp("NQ single-break day (low untouched)", (p) => !p.nq.touchedL);
cmp("NQ low ALSO breaks (rotation)", (p) => p.nq.touchedL);
console.log(`\n* = the ES filter moves the original stat >=5pt   ** = >=10pt`);
console.log(`DELTA ~0 across the board  ->  ES non-confirmation is noise; ignore it and trade the NQ stat as-is.`);
console.log(`FAILED / faded much HIGHER when diverged  ->  the lone NQ break is the fake-out; the filter earns its keep.`);

/* ── does the ES eventually catch up, and how late? ────────────────────────── */
const esLate = nqOnly.filter((p) => p.es.touchedH);
const nqBm = nqOnly.map((p) => hiBreak(p.nq)?.breakMin).filter(Number.isFinite);
console.log(`\n${"─".repeat(88)}\nLEAD / LAG\n${"─".repeat(88)}`);
console.log(`Avg minute NQ breaks its high (diverged days)   ${clock(Math.round(avg(nqBm)))} ET   (n=${nqBm.length})`);
console.log(`ES at least WICKS its high on those days        ${cell(esLate.length, nqOnly.length)}`);
console.log(`  -> ES gets there but can't close through: the divergence is a FAILURE TO CONFIRM, not absence of strength`);

/* ── the mirror, for symmetry ──────────────────────────────────────────────── */
console.log(`\n${"─".repeat(88)}\nMIRROR — ES breaks, NQ doesn't   (n=${esOnly.length})\n${"─".repeat(88)}`);
row("  ES break FAILED back inside <=30m", (p) => !!hiBreak(p.es)?.failed, esOnly);
row("  ES ran >= 1x IB width", (p) => hit(p.es, "1"), esOnly);
row("  ES faded to its IB LOW", (p) => !!hiBreak(p.es)?.fadeOpp, esOnly);
row("  NQ breaks its IB LOW instead", (p) => brokeL(p.nq), esOnly);
console.log(`\nA clean edge should NOT be symmetric. If the mirror looks identical, you're measuring`);
console.log(`the definition (one index always lags), not a tradeable divergence.\n`);

/* ── size ──────────────────────────────────────────────────────────────────── */
const mfe = nqOnly.map((p) => hiBreak(p.nq)?.rExt).filter(Number.isFinite);
const mae = nqOnly.map((p) => hiBreak(p.nq)?.rAdv).filter(Number.isFinite);
const bMfe = bothH.map((p) => hiBreak(p.nq)?.rExt).filter(Number.isFinite);
console.log(`${"─".repeat(88)}\nSIZE OF THE NQ MOVE (x IB width)\n${"─".repeat(88)}`);
console.log(`Avg MFE, ES diverged     ${f2(avg(mfe))}   (n=${mfe.length})`);
console.log(`Avg MFE, ES confirmed    ${f2(avg(bMfe))}   (n=${bMfe.length})`);
console.log(`Avg MAE, ES diverged     ${f2(avg(mae))}   (n=${mae.length})\n`);
