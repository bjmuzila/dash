#!/usr/bin/env node
/**
 * audit-ui.mjs — repeatable static audit of two recurring UI defect classes.
 *
 *   1. BUTTON CENTERING — labels sitting at the top of their button instead of
 *      the middle. The global `button { display: inline-flex; align-items:
 *      center; justify-content: center; line-height: 1 }` rule in
 *      app/globals.css now handles this for every button that doesn't override
 *      `display` inline. So what this checks is buttons that DEFEAT that rule:
 *      an inline `display: block/inline-block/inline` together with a height the
 *      label then can't centre inside. Those are build-breaking (--strict).
 *      Padding-only buttons are reported as a count only — they're covered.
 *
 *   2. SNAPSHOT CAPTURE DRIFT — a second html2canvas engine appearing outside
 *      lib/snapshot.ts. There used to be eight, each with its own background
 *      (six different values), its own scale (four), and its own subset of the
 *      workarounds html2canvas needs — which is why some snapshots came out
 *      blank (no live-<canvas> rehydration), some with invisible headings (no
 *      gradient-text flattening), and all of them differently toned. The rule
 *      now is that only lib/snapshot.ts may reach html2canvas; anything else
 *      calls captureToCanvas/captureToBlob/captureAndCopy. This checks IMPORTS,
 *      not call sites, because `import h from "html2canvas"` + `h(el, {...})`
 *      is a second engine that a call-site scan never sees. Build-breaking.
 *
 * Usage:  node scripts/audit-ui.mjs            # report
 *         node scripts/audit-ui.mjs --strict   # exit 1 on either defect class
 *         node scripts/audit-ui.mjs --json     # machine-readable
 *
 * Wired in as the root `prebuild` script, so `npm run build` runs it — same
 * pattern as app-vite/scripts/check-routes.mjs guarding the route table.
 *
 * Run it from the repo root. Safe: reads only, writes nothing.
 */

import fs from 'fs';
import path from 'path';

const ROOTS = ['app', 'components', 'lib', 'app-vite/src', 'hooks'];
const STRICT = process.argv.includes('--strict');
const JSON_OUT = process.argv.includes('--json');

// ── collect source files ────────────────────────────────────────────────────
const files = [];
(function walk(dirs) {
  for (const d of dirs) {
    if (!fs.existsSync(d)) continue;
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      if (e.name === 'node_modules' || e.name === '.next' || e.name === 'dist') continue;
      const p = path.join(d, e.name);
      if (e.isDirectory()) walk([p]);
      else if (/\.(tsx|jsx|ts)$/.test(e.name)) files.push(p);
    }
  }
})(ROOTS);

const lineOf = (src, idx) => src.slice(0, idx).split('\n').length;

// ── 1. button centering ─────────────────────────────────────────────────────
const buttons = { scanned: 0, coveredByGlobalRule: [], defeatsGlobalRule: [] };

for (const f of files) {
  if (!/\.(tsx|jsx)$/.test(f)) continue;
  const src = fs.readFileSync(f, 'utf8');
  const re = /<button\b/g;
  let m;
  while ((m = re.exec(src))) {
    // capture the opening tag, tracking JSX brace depth so style={{...}} survives
    let depth = 0, tag = '', i = m.index + 7;
    for (; i < src.length; i++) {
      const c = src[i];
      if (c === '{') depth++;
      else if (c === '}') depth--;
      else if (c === '>' && depth === 0) break;
      tag += c;
    }
    if (!/style=\{\{/.test(tag)) continue; // className-styled: out of scope

    // A button with no label has nothing to centre — icon-only swatches and
    // avatars (`<button ... />`) are not defects, so don't report them.
    if (/\/\s*$/.test(tag)) continue;
    const close = src.indexOf('</button>', i);
    const inner = close > 0 ? src.slice(i + 1, close) : '';
    if (!/\S/.test(inner.replace(/<[^>]*>/g, ''))) continue;

    // A button laying its children out deliberately (a stacked calendar cell,
    // a space-between row) is centring nothing; the global rule doesn't apply.
    if (/flexDirection:\s*["']column/.test(tag)) continue;
    if (/justifyContent:\s*["']space-between/.test(tag)) continue;

    buttons.scanned++;

    const displayHit = /display:\s*["']([a-z-]+)["']/.exec(tag);
    const display = displayHit ? displayHit[1] : null;
    const isFlexish = display ? /flex|grid/.test(display) : false;
    const hasHeight = /\bheight:\s*\d/.test(tag) || /minHeight:\s*\d/.test(tag);
    const centred =
      /alignItems:\s*["']center/.test(tag) && /justifyContent:\s*["']center/.test(tag);

    const rec = { file: f, line: lineOf(src, m.index), display, hasHeight };
    if (display && !isFlexish && hasHeight && !centred) {
      // Inline `display` overrides the global rule, and there's a height the
      // label now can't centre inside. Nothing but a hand fix helps here.
      buttons.defeatsGlobalRule.push(rec);
    } else if (!display) {
      // Relies on the global rule. Fine — counted so the number is visible.
      buttons.coveredByGlobalRule.push(rec);
    }
  }
}

// ── 2. snapshot capture drift ───────────────────────────────────────────────
const ENGINE_FILE = path.join('lib', 'snapshot.ts');

// The load-bearing check: who IMPORTS html2canvas. Matching call sites by name
// isn't enough — `import h from "html2canvas"` and then `h(el, {...})` is a
// second engine that a /html2canvas\(/ scan never sees. Only lib/snapshot.ts may
// import it, aliased or not, statically or dynamically.
const importers = [];
for (const f of files) {
  if (f === ENGINE_FILE) continue;
  const src = fs.readFileSync(f, 'utf8');
  const hit = /(?:from|import|require)\s*\(?\s*['"]html2canvas['"]/.exec(src);
  if (hit) importers.push({ file: f, line: lineOf(src, hit.index) });
}

// Per-call-site option detail, for the report.
const engines = [];
for (const f of files) {
  const src = fs.readFileSync(f, 'utf8');
  const re = /html2canvas\s*\(/g;
  let m;
  while ((m = re.exec(src))) {
    if (/import\(/.test(src.slice(Math.max(0, m.index - 40), m.index))) continue;
    // skip prose mentions inside // and * comment lines
    const lineStart = src.lastIndexOf('\n', m.index) + 1;
    if (/^\s*(\/\/|\*|\/\*)/.test(src.slice(lineStart, m.index))) continue;
    const body = src.slice(m.index, m.index + 1600);
    const grab = (k) => {
      const hit = new RegExp(k + '\\s*:\\s*([^,\\n}]+)').exec(body);
      return hit ? hit[1].trim() : null;
    };
    engines.push({
      file: f,
      line: lineOf(src, m.index),
      backgroundColor: grab('backgroundColor'),
      scale: grab('scale'),
      useCORS: !!grab('useCORS'),
      allowTaint: !!grab('allowTaint'),
      onclone: /onclone/.test(body),
      windowWidth: grab('windowWidth'),
      // The two known-required fixes. Scanned file-wide, not just inside the
      // options object — both are normally applied by a helper called from
      // `onclone` rather than inline.
      flattensGradientText: /data-snap-plain|webkitTextFillColor/.test(src),
      rehydratesLiveCanvas: /__ltScreenshot|takeScreenshot|drawImage/.test(src),
    });
  }
}

const uniq = (a) => [...new Set(a.filter(Boolean))];
const bgs = uniq(engines.map((e) => e.backgroundColor));
const scales = uniq(engines.map((e) => e.scale));

// ── 3. capture hazards present in the DOM ───────────────────────────────────
const count = (pat) => {
  let n = 0;
  for (const f of files) n += (fs.readFileSync(f, 'utf8').match(pat) || []).length;
  return n;
};
const hazards = {
  gradientText: count(/backgroundClip:\s*["']text|WebkitBackgroundClip:\s*["']text/g),
  gradientTextMarked: count(/data-snap-plain/g),
  backdropFilter: count(/backdropFilter/g),
  ignoreMarkers: count(/data-html2canvas-ignore/g),
};

// ── report ──────────────────────────────────────────────────────────────────
const result = { buttons, importers, engines, bgs, scales, hazards };
if (JSON_OUT) {
  console.log(JSON.stringify(result, null, 2));
} else {
  const L = (s = '') => console.log(s);
  L('════ UI AUDIT ════════════════════════════════════════════════════');
  L(`files scanned: ${files.length}`);
  L();
  L('── 1. BUTTON VERTICAL CENTERING ─────────────────────────────────');
  L(`labelled inline-styled <button>s:     ${buttons.scanned}`);
  L(`covered by the globals.css rule:      ${buttons.coveredByGlobalRule.length}`);
  L(`DEFEAT the rule (must hand-fix):      ${buttons.defeatsGlobalRule.length}`);
  buttons.defeatsGlobalRule.forEach((r) =>
    L(`    ${r.file}:${r.line}   display:${r.display} + explicit height`),
  );
  L();
  L('── 2. SNAPSHOT ENGINES ──────────────────────────────────────────');
  L(`files importing html2canvas outside`);
  L(`  lib/snapshot.ts (must be 0):         ${importers.length}`);
  importers.forEach((i) => L(`    ${i.file}:${i.line}`));
  L(`html2canvas() call sites:             ${engines.length}`);
  L(`distinct backgroundColor values:      ${bgs.length}  ${bgs.join(', ')}`);
  L(`distinct scale values:                ${scales.length}  ${scales.join(', ')}`);
  L(`call sites with onclone fixes:        ${engines.filter((e) => e.onclone).length}/${engines.length}`);
  L(`call sites flattening gradient text:  ${engines.filter((e) => e.flattensGradientText).length}/${engines.length}`);
  L(`call sites rehydrating live <canvas>: ${engines.filter((e) => e.rehydratesLiveCanvas).length}/${engines.length}`);
  L();
  engines.forEach((e) =>
    L(
      `    ${e.file}:${e.line}\n       bg=${e.backgroundColor} scale=${e.scale} ` +
        `onclone=${e.onclone ? 'y' : 'N'} gradientTextFix=${e.flattensGradientText ? 'y' : 'N'} ` +
        `canvasFix=${e.rehydratesLiveCanvas ? 'y' : 'N'}`,
    ),
  );
  L();
  L('── 3. CAPTURE HAZARDS IN THE DOM ────────────────────────────────');
  L(`background-clip:text headings:        ${hazards.gradientText}`);
  L(`  of those marked data-snap-plain:    ${hazards.gradientTextMarked}`);
  L(`backdrop-filter panels:               ${hazards.backdropFilter}`);
  L(`data-html2canvas-ignore markers:      ${hazards.ignoreMarkers}`);
  L('  (lib/snapshot.ts flattens gradient text and de-frosts backdrop panels');
  L('   for every capture, so these are informational, not defects.)');
  L('══════════════════════════════════════════════════════════════════');
}

if (STRICT) {
  const problems = [];
  // The whole point of lib/snapshot.ts: exactly one engine, and it lives there.
  const strays = [
    ...importers,
    ...engines.filter((e) => e.file !== ENGINE_FILE && !importers.some((i) => i.file === e.file)),
  ];
  if (strays.length) {
    problems.push(
      `${strays.length} file(s) reach html2canvas outside lib/snapshot.ts:\n` +
        strays.map((e) => `    ${e.file}:${e.line}`).join('\n') +
        '\n  Add an option to lib/snapshot.ts instead of standing up a second engine.',
    );
  }
  if (buttons.defeatsGlobalRule.length) {
    problems.push(
      `${buttons.defeatsGlobalRule.length} button(s) override display with an explicit ` +
        `height, defeating the globals.css centring rule:\n` +
        buttons.defeatsGlobalRule.map((r) => `    ${r.file}:${r.line}`).join('\n'),
    );
  }
  if (problems.length) {
    console.error('\naudit-ui: FAIL (--strict)\n');
    problems.forEach((p) => console.error('  • ' + p + '\n'));
    process.exit(1);
  }
  console.log('\naudit-ui: OK');
}
