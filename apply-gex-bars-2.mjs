#!/usr/bin/env node
/**
 * apply-gex-bars-2.mjs — follow-up to apply-gex-bars.mjs. Two changes:
 *
 * 1. The 0DTE "Net gamma exposure by strike" card switches from the cumulative
 *    curve to per-strike bars, so all three net-gamma cards now match.
 *    (The flip is still drawn, as a dashed vertical line, since bars can't show
 *    it the way the curve's zero-crossing did.)
 *
 * 2. All three bar charts move to a SIGNED SQUARE-ROOT height scale.
 *    Why: on the whole board, 0DTE ATM gamma is ~98.6% of the total — a handful
 *    of strikes near 400bn beside hundreds at 1-10bn. Linear heights render that
 *    as six spikes and a flat line. sign(v)·√|v| keeps the sign, keeps the
 *    ordering, keeps the spikes tallest, and lifts the small strikes off the
 *    axis: a 2bn strike goes from 0.8px to 11.3px, a 10bn from 4.2px to 25.2px.
 *
 *    Axis labels remain TRUE dollar values (endpoints plus quarter points, which
 *    is where the compression shows: a quarter-value label sits at half height).
 *    A small "√ scale" marker sits above the axis. Tooltips are unaffected.
 *
 * Requires apply-gex-bars.mjs to have been run first.
 * Safe to run twice. All-or-nothing: any unresolved anchor writes nothing.
 *
 * RUN THIS ON THE LAPTOP, not the VPS — the anchors are CRLF, matching the
 * Windows checkout. Git checks the repo out with LF on Linux and nothing
 * will match there.
 *
 * Run from the repo root:  node apply-gex-bars-2.mjs
 *   --dry   report what would change, write nothing
 *   --file <path>  target a different file (default app/test/page.tsx)
 */
import { readFileSync, writeFileSync, copyFileSync, existsSync } from 'node:fs';

const argv = process.argv.slice(2);
const dry = argv.includes('--dry');
const fi = argv.indexOf('--file');
const TARGET = fi !== -1 ? argv[fi + 1] : 'app/test/page.tsx';

// [anchor, replacement, label]
const EDITS = [
  [
    "  const vals = shown.map((r) => glOiVolNet(r));\r\n  let minV = Math.min(0, ...vals), maxV = Math.max(0, ...vals);\r\n  if (minV === maxV) { minV -= 1; maxV += 1; }\r\n  const y = (v: number) => padT + (1 - (v - minV) / (maxV - minV)) * (H - padT - padB);\r\n  const y0 = y(0);\r\n  const barW = Math.max(2, ((W - padL - padR) / shown.length) * 0.62);\r\n  const flipInView = neutral != null && neutral >= xlo && neutral <= xhi;",
    "  const vals = shown.map((r) => glOiVolNet(r));\r\n  let minV = Math.min(0, ...vals), maxV = Math.max(0, ...vals);\r\n  if (minV === maxV) { minV -= 1; maxV += 1; }\r\n  // SIGNED SQUARE-ROOT height scale, not linear.\r\n  //\r\n  // On the whole board, 0DTE ATM gamma is ~98.6% of the total \u2014 a handful of\r\n  // strikes at 400bn next to hundreds at 1\u201310bn. Linear bar heights render that\r\n  // as six spikes and a flat line, which hides everything the chart is for.\r\n  // sign(v)\u00b7\u221a|v| keeps the sign, keeps the ordering (it's monotone), and keeps\r\n  // the spikes tallest, while lifting the small strikes off the axis.\r\n  //\r\n  // The axis labels still print TRUE dollar values (glFmtBn of the real\r\n  // endpoints), so nothing misreports its magnitude \u2014 only the bar geometry is\r\n  // compressed. Tooltips are unaffected.\r\n  const sq = (v: number) => Math.sign(v) * Math.sqrt(Math.abs(v));\r\n  const sMin = sq(minV), sMax = sq(maxV);\r\n  const y = (v: number) => padT + (1 - (sq(v) - sMin) / ((sMax - sMin) || 1)) * (H - padT - padB);\r\n  const y0 = y(0);\r\n  const barW = Math.max(2, ((W - padL - padR) / shown.length) * 0.62);\r\n  const flipInView = neutral != null && neutral >= xlo && neutral <= xhi;",
    "NetGammaBarsByStrikeChart: signed \u221a height scale (0DTE ATM no longer flattens everything else)"
  ],
  [
    "          <line x1={x(neutral as number)} x2={x(neutral as number)} y1={padT} y2={H - padB} stroke={GEX_POS_GREEN} strokeWidth={1} strokeDasharray=\"4 3\" opacity={0.55} />\r\n        )}\r\n        <line x1={x(spot)} x2={x(spot)} y1={padT} y2={H - padB} stroke={LIGHT_BLUE} strokeWidth={1} strokeDasharray=\"2 3\" opacity={0.75} />\r\n        {[minV, 0, maxV].map((v, i) => (\r\n          <text key={i} x={padL - 8} y={y(v) + 4} textAnchor=\"end\" fontSize={10} fill={HOME_THEME.text} opacity={0.55}>{glFmtBn(v)}</text>\r\n        ))}\r\n        {[xlo, (xlo + xhi) / 2, xhi].map((k, i) => (\r\n          <text key={i} x={x(k)} y={H - padB + 16} textAnchor=\"middle\" fontSize={10} fill={HOME_THEME.text} opacity={0.55}>{glFmt0(k)}</text>\r\n        ))}",
    "          <line x1={x(neutral as number)} x2={x(neutral as number)} y1={padT} y2={H - padB} stroke={GEX_POS_GREEN} strokeWidth={1} strokeDasharray=\"4 3\" opacity={0.55} />\r\n        )}\r\n        <line x1={x(spot)} x2={x(spot)} y1={padT} y2={H - padB} stroke={LIGHT_BLUE} strokeWidth={1} strokeDasharray=\"2 3\" opacity={0.75} />\r\n        {/* Ticks at the true endpoints PLUS the quarter points, so the\r\n            compression is legible: on a \u221a scale the quarter-value label sits\r\n            at half height, which is the visual tell that this axis is not\r\n            linear. Every label is a TRUE dollar value. */}\r\n        {[maxV, maxV * 0.25, 0, minV * 0.25, minV]\r\n          .filter((v, i, a) => Number.isFinite(v) && a.indexOf(v) === i)\r\n          .map((v, i) => (\r\n            <text key={i} x={padL - 8} y={y(v) + 4} textAnchor=\"end\" fontSize={10} fill={HOME_THEME.text} opacity={v === 0 ? 0.55 : 0.42}>{glFmtBn(v)}</text>\r\n          ))}\r\n        <text x={padL - 8} y={padT - 5} textAnchor=\"end\" fontSize={9} fill={HOME_THEME.text} opacity={0.4}>\u221a scale</text>\r\n        {[xlo, (xlo + xhi) / 2, xhi].map((k, i) => (\r\n          <text key={i} x={x(k)} y={H - padB + 16} textAnchor=\"middle\" fontSize={10} fill={HOME_THEME.text} opacity={0.55}>{glFmt0(k)}</text>\r\n        ))}",
    "NetGammaBarsByStrikeChart: quarter-point axis ticks + \u221a-scale marker"
  ],
  [
    "                    variant=\"budget\"\r\n                    accent={LIGHT_BLUE}\r\n                    title={<CardTitleRow label={`Net gamma exposure by strike (0DTE${snap?.expiry ? ` \u00b7 ${glFmtExpiryLabel(snap.expiry)}` : \"\"})`} onDragStart={rightOrder.handleDragStart(\"netGamma\")} onDragEnd={rightOrder.handleDragEnd} />}\r\n                    subtitle=\"The live feed's SINGLE expiry. Cumulative across ALL its strikes \u2014 green above zero (dealers long gamma), red below (short gamma); crosses zero at the gamma flip (Neutral) \u00b7 scroll to zoom, drag to pan, double-click to reset\"\r\n                  >\r\n                    <NetGammaByStrikeChart rows={d.rows} spot={d.spot} neutral={d.neutral} />\r\n                    <ChartLegend items={[{ label: \"Positive gamma$\", color: GEX_POS_GREEN }, { label: \"Negative gamma$\", color: HOME_THEME.red }, { label: \"Spot\", color: LIGHT_BLUE }]} />\r\n                  </Card>\r\n                ),\r\n                netGammaAll: (",
    "                    variant=\"budget\"\r\n                    accent={LIGHT_BLUE}\r\n                    title={<CardTitleRow label={`Net gamma exposure by strike (0DTE${snap?.expiry ? ` \u00b7 ${glFmtExpiryLabel(snap.expiry)}` : \"\"})`} onDragStart={rightOrder.handleDragStart(\"netGamma\")} onDragEnd={rightOrder.handleDragEnd} />}\r\n                    subtitle=\"The live feed's SINGLE expiry \u2014 gamma$ per strike, green above zero (dealers long gamma), red below (short gamma) \u00b7 \u221a height scale so small strikes stay visible; axis labels are true values \u00b7 dashed line = the flip (Neutral) \u00b7 scroll to zoom, drag to pan, double-click to reset\"\r\n                  >\r\n                    <NetGammaBarsByStrikeChart rows={d.rows} spot={d.spot} neutral={d.neutral} />\r\n                    <ChartLegend items={[{ label: \"Positive gamma$\", color: GEX_POS_GREEN }, { label: \"Negative gamma$\", color: HOME_THEME.red }, { label: \"Spot\", color: LIGHT_BLUE }, { label: \"Flip\", color: GEX_POS_GREEN }]} />\r\n                  </Card>\r\n                ),\r\n                netGammaAll: (",
    "0DTE card: switch from the cumulative curve to per-strike bars"
  ],
  [
    "                    variant=\"budget\"\r\n                    accent={LIGHT_BLUE}\r\n                    title={<CardTitleRow label=\"Net gamma exposure by strike (all expirations)\" onDragStart={rightOrder.handleDragStart(\"netGammaAll\")} onDragEnd={rightOrder.handleDragEnd} />}\r\n                    subtitle=\"Every listed expiration combined, 0DTE included \u2014 gamma$ per strike, green above zero / red below \u00b7 OI+Vol basis \u00b7 scroll to zoom, drag to pan, double-click to reset \u00b7 refreshed once a minute\"\r\n                  >\r\n                    <NetGammaMultiPanel\r\n                      ladder={multi.data?.all ?? null}",
    "                    variant=\"budget\"\r\n                    accent={LIGHT_BLUE}\r\n                    title={<CardTitleRow label=\"Net gamma exposure by strike (all expirations)\" onDragStart={rightOrder.handleDragStart(\"netGammaAll\")} onDragEnd={rightOrder.handleDragEnd} />}\r\n                    subtitle=\"Every listed expiration combined, 0DTE included \u2014 gamma$ per strike, green above zero / red below \u00b7 OI+Vol basis \u00b7 \u221a height scale (axis labels are true values) \u00b7 scroll to zoom, drag to pan, double-click to reset \u00b7 refreshed once a minute\"\r\n                  >\r\n                    <NetGammaMultiPanel\r\n                      ladder={multi.data?.all ?? null}",
    "all-expirations card: subtitle notes the \u221a scale"
  ],
  [
    "                    variant=\"budget\"\r\n                    accent={LIGHT_BLUE}\r\n                    title={<CardTitleRow label=\"Net gamma exposure by strike (ex-0DTE)\" onDragStart={rightOrder.handleDragStart(\"netGammaEx0dte\")} onDragEnd={rightOrder.handleDragEnd} />}\r\n                    subtitle=\"Same board with the 0DTE expiry removed \u2014 gamma$ per strike, what's left standing after today expires \u00b7 OI+Vol basis \u00b7 scroll to zoom, drag to pan \u00b7 refreshed once a minute\"\r\n                  >\r\n                    <NetGammaMultiPanel\r\n                      ladder={multi.data?.ex0dte ?? null}",
    "                    variant=\"budget\"\r\n                    accent={LIGHT_BLUE}\r\n                    title={<CardTitleRow label=\"Net gamma exposure by strike (ex-0DTE)\" onDragStart={rightOrder.handleDragStart(\"netGammaEx0dte\")} onDragEnd={rightOrder.handleDragEnd} />}\r\n                    subtitle=\"Same board with the 0DTE expiry removed \u2014 gamma$ per strike, what's left standing after today expires \u00b7 OI+Vol basis \u00b7 \u221a height scale (axis labels are true values) \u00b7 scroll to zoom, drag to pan \u00b7 refreshed once a minute\"\r\n                  >\r\n                    <NetGammaMultiPanel\r\n                      ladder={multi.data?.ex0dte ?? null}",
    "ex-0DTE card: subtitle notes the \u221a scale"
  ]
];

if (!existsSync(TARGET)) {
  console.error(`not found: ${TARGET}  (run this from the repo root, or pass --file)`);
  process.exit(2);
}

const original = readFileSync(TARGET, 'utf8');
let src = original;
const applied = [], already = [], missing = [];

for (const [anchor, replacement, label] of EDITS) {
  // Check "already applied" FIRST. An edit that INSERTS a block ahead of its
  // anchor leaves that anchor intact, so testing hits first would re-apply it
  // and duplicate the insertion on every run. Presence of the replacement is
  // the only reliable "done" signal.
  if (src.includes(replacement)) { already.push(label); continue; }
  const hits = src.split(anchor).length - 1;
  if (hits === 1) {
    src = src.replace(anchor, replacement);
    applied.push(label);
  } else {
    missing.push({ label, hits });
  }
}

const w = (s) => process.stdout.write(s + '\n');
w('');
w(`${TARGET}`);
w(`  applied  ${applied.length}`);
w(`  already  ${already.length}`);
w(`  missing  ${missing.length}`);
for (const a of applied) w(`    + ${a}`);
for (const a of already) w(`    = ${a} (already present)`);
for (const m of missing) w(`    ! ${m.label} — anchor found ${m.hits}x, expected 1`);

if (missing.length) {
  w('');
  w('NOTHING WRITTEN. An anchor above did not resolve, which means that exact');
  w('block of the file changed. Fix by hand, or send me `git diff -- ' + TARGET + '`');
  w('and I will rebuild the edit against your current version.');
  process.exit(1);
}

if (!applied.length) {
  w('');
  w('All edits already present — nothing to do.');
  process.exit(0);
}

if (dry) {
  w('');
  w(`--dry: ${applied.length} edit(s) would be applied, nothing written.`);
  process.exit(0);
}

copyFileSync(TARGET, TARGET + '.bak');
writeFileSync(TARGET, src);
w('');
w(`Wrote ${TARGET}  (backup at ${TARGET}.bak)`);
w(`${original.length} -> ${src.length} bytes`);
