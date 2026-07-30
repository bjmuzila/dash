#!/usr/bin/env node
/**
 * apply-gex-bars.mjs — switches the two MULTI-EXPIRY net-gamma cards from the
 * cumulative curve to PER-STRIKE BARS.
 *
 * Scope: "Net gamma exposure by strike (all expirations)" and "(ex-0DTE)" only.
 * The 0DTE card keeps its cumulative curve deliberately — that curve's
 * zero-crossing IS the gamma flip, which per-strike bars cannot show.
 *
 * The new NetGammaBarsByStrikeChart reuses the exact bar mechanics of the
 * existing "Net delta by strike" card (pan, zoom, hover, spot line), valued on
 * glOiVolNet (netGEX + netVolGEX = the OI+Vol basis) and coloured with the gamma
 * convention: green positive, red negative. Because bars lose the flip, it is
 * drawn as a dashed vertical line where one is in view.
 *
 * Requires apply-gex-cards.mjs to have been run first (it needs the multi-expiry
 * cards to exist). Safe to run twice. All-or-nothing: if an anchor fails to
 * resolve, nothing is written.
 *
 * Run from the repo root:  node apply-gex-bars.mjs
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
    "  );\r\n}\r\n\r\n// Net Delta by strike \u2014 same bar treatment as Net Gamma, using r.netDEX.\r\nfunction NetDeltaByStrikeChart({ rows, spot }: { rows: GexLevelsRow[]; spot: number }) {\r\n  const W = 720, H = 220, padL = 50, padR = 16, padB = 26, padT = 18;",
    "  );\r\n}\r\n\r\n// Net gamma by strike as PER-STRIKE BARS (not the cumulative mountain).\r\n//\r\n// The 0DTE card above draws the cumulative curve, whose zero-crossing IS the\r\n// gamma flip. These bars answer the other question: how much gamma$ sits at each\r\n// individual strike, and on which side. Used by the two multi-expiry cards,\r\n// where \"where is the gamma concentrated across the whole board\" is the point\r\n// and the running total is less readable across ~1500 strikes.\r\n//\r\n// Same bar mechanics as NetDeltaByStrikeChart (pan/zoom/hover), but valued on\r\n// glOiVolNet (netGEX + netVolGEX \u2014 the OI+Vol basis) and coloured with the gamma\r\n// convention: green = positive gamma$, red = negative. The flip is drawn as a\r\n// dashed vertical line since bars can't show it the way the curve does.\r\nfunction NetGammaBarsByStrikeChart({ rows, spot, neutral }: { rows: GexLevelsRow[]; spot: number; neutral?: number | null }) {\r\n  const W = 720, H = 220, padL = 56, padR = 16, padB = 26, padT = 18;\r\n  const { containerRef, hover, show, hide } = useChartHover();\r\n  const pan = useChartPan(rows, spot);\r\n  if (!rows.length) return <GlEmpty note=\"no chain rows\" />;\r\n  const sortedAll = rows.slice().sort((a, b) => a.strike - b.strike);\r\n  let shown = sortedAll.filter((r) => r.strike >= pan.center - pan.winHalf && r.strike <= pan.center + pan.winHalf);\r\n  if (shown.length <= 4) shown = sortedAll;\r\n  const xlo = shown[0].strike, xhi = shown[shown.length - 1].strike;\r\n  const x = (k: number) => padL + ((k - xlo) / (xhi - xlo || 1)) * (W - padL - padR);\r\n  const pxPerStrike = (W - padL - padR) / ((xhi - xlo) || 1);\r\n  const vals = shown.map((r) => glOiVolNet(r));\r\n  let minV = Math.min(0, ...vals), maxV = Math.max(0, ...vals);\r\n  if (minV === maxV) { minV -= 1; maxV += 1; }\r\n  const y = (v: number) => padT + (1 - (v - minV) / (maxV - minV)) * (H - padT - padB);\r\n  const y0 = y(0);\r\n  const barW = Math.max(2, ((W - padL - padR) / shown.length) * 0.62);\r\n  const flipInView = neutral != null && neutral >= xlo && neutral <= xhi;\r\n\r\n  return (\r\n    <div\r\n      ref={mergeRefs(containerRef, pan.wheelRef)}\r\n      style={{ position: \"relative\", cursor: pan.canPan ? (pan.isDragging ? \"grabbing\" : \"grab\") : \"default\", userSelect: pan.isDragging ? \"none\" : undefined }}\r\n      onMouseDown={(e) => { e.preventDefault(); pan.onDragStart(e.clientX, pxPerStrike); }}\r\n      onMouseMove={(e) => pan.onDragMove(e.clientX)}\r\n      onMouseUp={pan.onDragEnd}\r\n      onMouseLeave={() => { pan.onDragEnd(); hide(); }}\r\n      onDoubleClick={pan.resetPan}\r\n    >\r\n      <svg viewBox={`0 0 ${W} ${H}`} width=\"100%\" preserveAspectRatio=\"xMidYMid meet\" style={{ display: \"block\", maxHeight: 240 }}>\r\n        <line x1={padL} x2={W - padR} y1={y0} y2={y0} stroke={HOME_THEME.border} strokeWidth={1} />\r\n        {shown.map((r, i) => {\r\n          const v = glOiVolNet(r);\r\n          const top = v >= 0 ? y(v) : y0;\r\n          const h = Math.max(1, Math.abs(y(v) - y0));\r\n          return (\r\n            <rect\r\n              key={r.strike}\r\n              x={x(r.strike) - barW / 2}\r\n              y={top}\r\n              width={barW}\r\n              height={h}\r\n              fill={v >= 0 ? GEX_POS_GREEN : HOME_THEME.red}\r\n              opacity={hover?.idx === i ? 1 : 0.85}\r\n              style={{ cursor: \"inherit\" }}\r\n              onMouseMove={(e) => { if (!pan.draggingRef.current) show(i, e); }}\r\n            />\r\n          );\r\n        })}\r\n        {flipInView && (\r\n          <line x1={x(neutral as number)} x2={x(neutral as number)} y1={padT} y2={H - padB} stroke={GEX_POS_GREEN} strokeWidth={1} strokeDasharray=\"4 3\" opacity={0.55} />\r\n        )}\r\n        <line x1={x(spot)} x2={x(spot)} y1={padT} y2={H - padB} stroke={LIGHT_BLUE} strokeWidth={1} strokeDasharray=\"2 3\" opacity={0.75} />\r\n        {[minV, 0, maxV].map((v, i) => (\r\n          <text key={i} x={padL - 8} y={y(v) + 4} textAnchor=\"end\" fontSize={10} fill={HOME_THEME.text} opacity={0.55}>{glFmtBn(v)}</text>\r\n        ))}\r\n        {[xlo, (xlo + xhi) / 2, xhi].map((k, i) => (\r\n          <text key={i} x={x(k)} y={H - padB + 16} textAnchor=\"middle\" fontSize={10} fill={HOME_THEME.text} opacity={0.55}>{glFmt0(k)}</text>\r\n        ))}\r\n      </svg>\r\n      {hover && !pan.isDragging && (\r\n        <ChartTooltip x={hover.x} y={hover.y}>\r\n          <div style={{ fontWeight: 800 }}>Strike {glFmt2(shown[hover.idx].strike)}</div>\r\n          <div>Net gamma$: {glFmtBn(glOiVolNet(shown[hover.idx]))}</div>\r\n        </ChartTooltip>\r\n      )}\r\n    </div>\r\n  );\r\n}\r\n\r\n// Net Delta by strike \u2014 same bar treatment as Net Gamma, using r.netDEX.\r\nfunction NetDeltaByStrikeChart({ rows, spot }: { rows: GexLevelsRow[]; spot: number }) {\r\n  const W = 720, H = 220, padL = 50, padR = 16, padB = 26, padT = 18;",
    "add NetGammaBarsByStrikeChart (per-strike gamma$ bars)"
  ],
  [
    "        <GlEmpty note={loading ? \"sweeping the board\u2026\" : err ? \"no ladder available\" : \"no strikes returned\"} />\r\n      ) : (\r\n        <>\r\n          <NetGammaByStrikeChart rows={ladder.rows} spot={spot} neutral={ladder.gexFlip} />\r\n          <ChartLegend items={[{ label: \"Positive gamma$\", color: GEX_POS_GREEN }, { label: \"Negative gamma$\", color: HOME_THEME.red }, { label: \"Spot\", color: LIGHT_BLUE }]} />\r\n        </>\r\n      )}\r\n    </div>",
    "        <GlEmpty note={loading ? \"sweeping the board\u2026\" : err ? \"no ladder available\" : \"no strikes returned\"} />\r\n      ) : (\r\n        <>\r\n          <NetGammaBarsByStrikeChart rows={ladder.rows} spot={spot} neutral={ladder.gexFlip} />\r\n          <ChartLegend items={[{ label: \"Positive gamma$\", color: GEX_POS_GREEN }, { label: \"Negative gamma$\", color: HOME_THEME.red }, { label: \"Spot\", color: LIGHT_BLUE }, { label: \"Flip\", color: GEX_POS_GREEN }]} />\r\n        </>\r\n      )}\r\n    </div>",
    "NetGammaMultiPanel: render bars instead of the cumulative curve"
  ],
  [
    "                    variant=\"budget\"\r\n                    accent={LIGHT_BLUE}\r\n                    title={<CardTitleRow label=\"Net gamma exposure by strike (all expirations)\" onDragStart={rightOrder.handleDragStart(\"netGammaAll\")} onDragEnd={rightOrder.handleDragEnd} />}\r\n                    subtitle=\"Every listed expiration combined, 0DTE included \u2014 the whole board's cumulative gamma$ profile \u00b7 OI+Vol basis \u00b7 refreshed once a minute\"\r\n                  >\r\n                    <NetGammaMultiPanel\r\n                      ladder={multi.data?.all ?? null}",
    "                    variant=\"budget\"\r\n                    accent={LIGHT_BLUE}\r\n                    title={<CardTitleRow label=\"Net gamma exposure by strike (all expirations)\" onDragStart={rightOrder.handleDragStart(\"netGammaAll\")} onDragEnd={rightOrder.handleDragEnd} />}\r\n                    subtitle=\"Every listed expiration combined, 0DTE included \u2014 gamma$ per strike, green above zero / red below \u00b7 OI+Vol basis \u00b7 scroll to zoom, drag to pan, double-click to reset \u00b7 refreshed once a minute\"\r\n                  >\r\n                    <NetGammaMultiPanel\r\n                      ladder={multi.data?.all ?? null}",
    "all-expirations card: subtitle now describes bars"
  ],
  [
    "                    variant=\"budget\"\r\n                    accent={LIGHT_BLUE}\r\n                    title={<CardTitleRow label=\"Net gamma exposure by strike (ex-0DTE)\" onDragStart={rightOrder.handleDragStart(\"netGammaEx0dte\")} onDragEnd={rightOrder.handleDragEnd} />}\r\n                    subtitle=\"Same board with the 0DTE expiry removed \u2014 what's left standing after today expires \u00b7 OI+Vol basis \u00b7 refreshed once a minute\"\r\n                  >\r\n                    <NetGammaMultiPanel\r\n                      ladder={multi.data?.ex0dte ?? null}",
    "                    variant=\"budget\"\r\n                    accent={LIGHT_BLUE}\r\n                    title={<CardTitleRow label=\"Net gamma exposure by strike (ex-0DTE)\" onDragStart={rightOrder.handleDragStart(\"netGammaEx0dte\")} onDragEnd={rightOrder.handleDragEnd} />}\r\n                    subtitle=\"Same board with the 0DTE expiry removed \u2014 gamma$ per strike, what's left standing after today expires \u00b7 OI+Vol basis \u00b7 scroll to zoom, drag to pan \u00b7 refreshed once a minute\"\r\n                  >\r\n                    <NetGammaMultiPanel\r\n                      ladder={multi.data?.ex0dte ?? null}",
    "ex-0DTE card: subtitle now describes bars"
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
