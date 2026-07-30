#!/usr/bin/env node
/**
 * snapshot-fixtures.mjs — behavioural tests for lib/snapshot.ts.
 *
 * The capture engine is the kind of code that can't be checked by reading it:
 * every rule in it exists because html2canvas does something a browser wouldn't,
 * and the only way to know a change is safe is to render a real DOM in a real
 * Chromium and measure the pixels that come out. This does that.
 *
 * Each fixture is a page shape that produced a wrong capture at some point, kept
 * here so it can't come back:
 *
 *   A  options-chain    fixed-height flex column, scrollable body, 60 rows of
 *                       which ~22 fit on screen. All 60 must be in the PNG.
 *   B  mult-greek       width:fit-content grid running well past the viewport,
 *                       captured with fitContent. Off-screen right-hand columns
 *                       must be present, and the content-crop must not eat the
 *                       image (it referenced a sampled corner pixel, which is
 *                       content — not background — whenever the grid reaches the
 *                       right edge, so the crop bounds came out arbitrary).
 *   C  mixed panel      stat rows + one small sparkline canvas. The bare-canvas
 *                       fast path must NOT claim this. It used to trigger on
 *                       `el.querySelector("canvas")`, so a 5-row panel with a
 *                       120x30 sparkline captured as a 120x74 PNG of just the
 *                       sparkline.
 *   D  canvas chart     a real GexChart-shaped target: one canvas filling the
 *                       element. This one SHOULD take the fast path, band and
 *                       all — C's fix must not break it.
 *
 * Prerequisites (not in the app's dependency tree — this is a local dev tool):
 *   npm i -D playwright esbuild && npx playwright install chromium
 *
 * Usage:  node scripts/snapshot-fixtures.mjs
 * Exits non-zero on any failure, so it can be wired into CI once Chromium is
 * available there. Deliberately NOT part of `prebuild` — the Docker build has no
 * browser, and failing the deploy over a missing dev dependency would be worse
 * than not running it.
 */

import fs from 'fs';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'snapfix-'));

let chromium, esbuild;
try {
  ({ chromium } = await import('playwright'));
  esbuild = await import('esbuild');
} catch {
  console.error(
    'snapshot-fixtures: needs playwright + esbuild.\n' +
    '  npm i -D playwright esbuild && npx playwright install chromium',
  );
  process.exit(2);
}

// ── Bundle the real engine, with the theme import stubbed ───────────────────
// Stubbed rather than imported so this runs without the Next module resolver,
// and so a theme edit can't quietly change what the fixtures assert.
const BG = '#05060A';
fs.writeFileSync(path.join(TMP, 'theme-stub.ts'), `
export const HOME_THEME = {
  bg: "${BG}", panel: "#0D1119", cyan: "#219EBC", purple: "#126783",
  orange: "#FB8501", green: "#8ECAE6", red: "#EF4444", muted: "#FFFFFF",
  text: "#FFFFFF", border: "rgba(255,255,255,0.10)",
  panelBg: "rgba(13,17,25,0.45)", panelBgStrong: "rgba(13,17,25,0.72)", shellGlow: "none",
};
`);
fs.writeFileSync(path.join(TMP, 'entry.ts'),
  `import * as snap from ${JSON.stringify(path.join(REPO, 'lib/snapshot.ts'))};\n` +
  `(window as any).SNAP = snap;\n`);

await esbuild.build({
  entryPoints: [path.join(TMP, 'entry.ts')],
  bundle: true,
  format: 'iife',
  outfile: path.join(TMP, 'snap.js'),
  target: 'chrome110',
  logLevel: 'error',
  alias: {
    '@/components/shared/homeTheme': path.join(TMP, 'theme-stub.ts'),
    html2canvas: path.join(REPO, 'node_modules/html2canvas/dist/html2canvas.js'),
  },
});

// ── Fixtures ────────────────────────────────────────────────────────────────
const ROWS = 60, ROW_H = 24, HEADER_H = 40, VIEW_H = 600;
const GRID_ROWS = 30, GRID_H = 22, GRID_COLS = 28, CELL_W = 90;
const BAND = 44;

fs.writeFileSync(path.join(TMP, 'fixture.html'), `<!doctype html>
<html><head><meta charset="utf-8"><style>
  *{box-sizing:border-box;margin:0}
  body{background:${BG};color:#fff;font:12px Arial,sans-serif}
</style></head><body>

<div id="chain" style="height:${VIEW_H}px;width:900px;overflow:hidden;display:flex;flex-direction:column;background:${BG}">
  <div style="flex-shrink:0;height:${HEADER_H}px;background:#0D1119">HEADER ROW</div>
  <div id="chainbody" style="flex:1;overflow:auto;min-height:0"></div>
</div>

<div id="mg" style="display:block;height:auto;width:fit-content;min-width:min-content;overflow:visible;background:${BG}">
  <div id="mgtable"></div>
</div>

<div id="mixed" style="width:800px;background:${BG}">
  <div style="height:30px;color:#8ECAE6">TOTAL NET GEX  +1.23B</div>
  <div style="height:30px;color:#8ECAE6">GAMMA FLIP  6410</div>
  <canvas id="spark" width="120" height="30" style="width:120px;height:30px"></canvas>
  <div style="height:30px;color:#8ECAE6">CALL WALL  6450</div>
  <div style="height:30px;color:#8ECAE6">PUT WALL  6350</div>
</div>

<div id="chart" style="width:600px;height:300px;background:${BG}">
  <canvas id="cc" width="600" height="300" style="width:600px;height:300px"></canvas>
</div>

<script>
  const body = document.getElementById('chainbody');
  for (let i = 0; i < ${ROWS}; i++) {
    const r = document.createElement('div');
    r.style.cssText = 'height:${ROW_H}px;line-height:${ROW_H}px;padding:0 8px;color:#8ECAE6';
    r.textContent = 'STRIKE-ROW-' + String(i).padStart(3, '0');
    body.appendChild(r);
  }
  const t = document.getElementById('mgtable');
  for (let y = 0; y < ${GRID_ROWS}; y++) {
    const row = document.createElement('div');
    row.style.cssText = 'display:flex';
    for (let x = 0; x < ${GRID_COLS}; x++) {
      const c = document.createElement('div');
      c.style.cssText = 'width:${CELL_W}px;height:${GRID_H}px;line-height:${GRID_H}px;background:#126783;color:#fff;border:1px solid ${BG}';
      c.textContent = y + ',' + x;
      row.appendChild(c);
    }
    t.appendChild(row);
  }
  document.getElementById('spark').getContext('2d').fillStyle = '#FB8501';
  document.getElementById('spark').getContext('2d').fillRect(0, 0, 120, 30);
  const cg = document.getElementById('cc').getContext('2d');
  cg.fillStyle = '#219EBC'; cg.fillRect(0, 0, 600, 300);
</script>
<script src="./snap.js"></script>
</body></html>`);

// ── Run ─────────────────────────────────────────────────────────────────────
// SNAP_CHROMIUM lets a CI image point at a Chromium it already has, instead of
// making this script depend on `npx playwright install` having been run there.
const launchOpts = process.env.SNAP_CHROMIUM
  ? { executablePath: process.env.SNAP_CHROMIUM }
  : {};
const browser = await chromium.launch(launchOpts);
const page = await browser.newPage({ viewport: { width: 1400, height: 900 }, deviceScaleFactor: 1 });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
await page.goto('file://' + path.join(TMP, 'fixture.html'));
await page.waitForFunction(() => !!window.SNAP);

/** Capture `selector` and report size + where content ends, in device pixels. */
const measure = (selector, opts) =>
  page.evaluate(async ([selector, opts, bg]) => {
    const canvas = await window.SNAP.captureToCanvas(document.querySelector(selector), opts);
    const ctx = canvas.getContext('2d');
    const { width: w, height: h } = canvas;
    const d = ctx.getImageData(0, 0, w, h).data;
    const [br, bgr, bb] = [parseInt(bg.slice(1, 3), 16), parseInt(bg.slice(3, 5), 16), parseInt(bg.slice(5, 7), 16)];
    const isBg = (i) => Math.abs(d[i] - br) + Math.abs(d[i + 1] - bgr) + Math.abs(d[i + 2] - bb) < 24;
    let lastY = -1, lastX = -1, bright = 0;
    for (let y = h - 1; y >= 0 && lastY < 0; y--)
      for (let x = 0; x < w; x += 2) if (!isBg((y * w + x) * 4)) { lastY = y; break; }
    for (let x = w - 1; x >= 0 && lastX < 0; x--)
      for (let y = 0; y < h; y += 2) if (!isBg((y * w + x) * 4)) { lastX = x; break; }
    // White pixels in the top band = the title/watermark text rendered.
    for (let i = 0; i < w * Math.min(h, 50) * 4; i += 4)
      if (d[i] > 200 && d[i + 1] > 200 && d[i + 2] > 200) bright += 1;
    return { w, h, lastY, lastX, bandText: bright };
  }, [selector, opts, BG]);

const results = [];
const check = (name, pass, detail) => {
  results.push({ name, pass, detail });
  console.log(`  ${pass ? 'ok  ' : 'FAIL'}  ${name}${detail ? `  — ${detail}` : ''}`);
};

console.log('\nlib/snapshot.ts — capture behaviour\n');

// A — options-chain: every row of a scrolled body must be in the PNG.
{
  const r = await measure('#chain', { framed: true });
  const want = HEADER_H + ROWS * ROW_H + BAND + 4;
  check('A options-chain: full chain captured, not just the visible rows',
    Math.abs(r.h - want) <= 8, `${r.w}x${r.h}, expected height ~${want}`);
  check('A options-chain: no large empty void at the bottom',
    (r.h - 1 - r.lastY) / r.h < 0.05, `trailing void ${r.h - 1 - r.lastY}px`);
}

// B — mult-greek: off-screen columns present, and the crop leaves the image alone.
{
  const scrollW = await page.evaluate(() => document.getElementById('mg').scrollWidth);
  const r = await measure('#mg', { framed: true, fitContent: true });
  const want = GRID_ROWS * GRID_H + BAND + 4;
  check('B mult-greek: columns past the viewport edge are captured',
    r.lastX > scrollW * 0.9, `content to x=${r.lastX} of ${scrollW}px wide (viewport 1400)`);
  check('B mult-greek: content-crop did not eat the image',
    r.h >= want * 0.9, `${r.w}x${r.h}, floor ${Math.round(want * 0.9)}`);
}

// C — a panel that merely CONTAINS a canvas is a normal DOM capture.
{
  const r = await measure('#mixed', { framed: true });
  check('C mixed panel: not hijacked by the bare-canvas fast path',
    r.w >= 700 && r.h >= 180, `${r.w}x${r.h} (the bug gave 120x74 — the sparkline alone)`);
}

// D — a real canvas chart still takes the fast path, band included.
{
  const r = await measure('#chart', { framed: true, title: 'SPX GEX' });
  check('D canvas chart: bare-canvas fast path still applies',
    r.w === 600 && r.h === 300 + BAND, `${r.w}x${r.h}`);
  check('D canvas chart: title band + watermark rendered',
    r.bandText > 50, `${r.bandText} text pixels in the band`);
}

if (errors.length) check('no uncaught page errors', false, errors.join(' | '));

await browser.close();
fs.rmSync(TMP, { recursive: true, force: true });

const failed = results.filter((r) => !r.pass);
console.log(`\n${results.length - failed.length}/${results.length} passed\n`);
process.exit(failed.length ? 1 : 0);
