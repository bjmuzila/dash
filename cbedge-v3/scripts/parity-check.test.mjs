#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// Unit test for parity-check.mjs, against fixtures rather than a browser.
//
// A checker nobody has ever seen fail is not a checker. This drives compare()
// three ways:
//
//   1. a realistic v2 harvest vs a realistic v3 harvest → clean, bar the one
//      departure the port declared (no snapshot button);
//   2. the SAME v2 harvest vs the v3 page as it stood BEFORE this port, with
//      the sector wheel still a placeholder → the wheel probes must all fail,
//      which is precisely the class of loss this script exists to catch;
//   3. a v3 harvest with Trending Now left in v2's two-descent order → the
//      sort probe must notice.
//
//   node scripts/parity-check.test.mjs
// ─────────────────────────────────────────────────────────────────────────────

import { PROBES, compare } from './parity-check.mjs'

const V2_TEXT = `Traders Dashboard
Sunday, August 30, 2026
🌅 Premarket Prep →
🗓 Economic Calendar →
📸 Snapshot
☀ 71°F
Clear, Holton, MI
Change ZIP
Countdown to Market Open
16:42:07
Target: Monday 9:30 AM EST
📈 Overnight Market Overview
Generated 07:02 AM ET
Sentiment: Futures firm overnight on a soft dollar.
📉 Overnight Futures (Live)
ES
+0.34%
NQ
+0.512%
YM
-0.08%
🔥 Trending Now
NVDA
NVDA
+4.21%
PM
AVGO
AVGO
+2.80%
PLTR
PLTR
-3.95%
🗓 Key Drivers Today
08:30 AM
Core PCE Price Index
High-impact USD event · USD
10:00 AM
Consumer Sentiment
High-impact USD event · USD
🕐 Morning Schedule
Edit
These are sample times — tap Edit to swap in your own routine.
08:00 AM
Coffee & Market Review
08:30 AM
Daily Planning
09:00 AM
Pre-Market Analysis
09:30 AM
Market Open
✅ Pre-Market Tasks
Edit
Sample tasks — tap Edit to make them your own.
Review portfolio allocations
Quick workout (15 mins)
Task Progress
50%
🌐 S&P Sector Wheel
2%
3%
5%
📸 Snap
⤢ Expand
Bar length = size of move, color = direction. Click a sector to zoom.
Top
NVDA
+4.21%
AVGO
+2.80%
Bottom
PLTR
-3.95%
198/203 names
as of 09:12 ET
🔗 Quick Links
Premarket Prep →
Home →
Multi Greek →
Analytics →`

const V3_TEXT = V2_TEXT
  // v3 has no snapshot button, and its wheel toolbar has no Snap.
  .replace('📸 Snapshot\n', '')
  .replace('📸 Snap\n', '')
  // one ranking, positives down to negatives
  .replace('NVDA\nNVDA\n+4.21%\nPM\nAVGO\nAVGO\n+2.80%\nPLTR\nPLTR\n-3.95%', 'NVDA\nNVDA\n+4.21%\nPM\nAVGO\nAVGO\n+2.80%\nPLTR\nPLTR\n-3.95%')

const WHEEL_SVG = ['S&P 500', '+0.42%', '134 up · 64 down', 'Technology', 'NVDA +4.2%', 'PLTR −4.0%', 'AVGO +2.8%']

function harvest(text, { svgText = WHEEL_SVG, svgPaths = 412, checkboxes = 4 } = {}) {
  return {
    text,
    lines: text.split('\n').filter(Boolean),
    svgText,
    svgPaths,
    pctCells: text.split('\n').filter((l) => /[+−-]\d+\.\d{1,2}%/.test(l)),
    inputs: 20,
    checkboxes,
  }
}

let failures = 0
function check(name, cond, detail) {
  if (cond) {
    console.log(`  ✓ ${name}`)
  } else {
    console.log(`  ✗ ${name}${detail ? ` — ${detail}` : ''}`)
    failures++
  }
}

console.log('\nparity-check self-test\n')

// ── 1. the port as built ──
{
  const a = harvest(V2_TEXT)
  const b = harvest(V3_TEXT)
  const { missing, softer } = compare(a, b)
  check(
    'a faithful v3 loses nothing',
    missing.length === 0,
    missing.map((m) => m.p.id).join(', '),
  )
  check(
    'the missing snapshot button is reported as a declared departure, not a failure',
    softer.some((s) => s.p.id === 'A/snapshot'),
  )
}

// ── 2. the v3 page as it stood before this port ──
{
  const a = harvest(V2_TEXT)
  const before = V3_TEXT.replace(
    /🌐 S&P Sector Wheel[\s\S]*?🔗 Quick Links/,
    'Sector Rotation\nSector rotation sunburst not yet ported — see v2 SectorSunburst.tsx.\n🔗 Quick Links',
  )
  const b = harvest(before, { svgText: [], svgPaths: 0 })
  const { missing } = compare(a, b)
  const ids = new Set(missing.map((m) => m.p.id))
  for (const id of ['F/heading', 'F/howto', 'F/caps', 'F/expand', 'F/arcs', 'F/hubScope', 'F/hubNet', 'F/hubBreadth', 'F/callouts', 'F/coverage', 'F/asOf']) {
    check(`catches the un-ported wheel: ${id}`, ids.has(id))
  }
  check('and reports nothing else as missing', missing.every((m) => m.p.id.startsWith('F/')), [...ids].join(', '))
}

// ── 3. Trending Now left in v2's order ──
{
  const a = harvest(V2_TEXT)
  const unsorted = V3_TEXT.replace(
    'NVDA\nNVDA\n+4.21%\nPM\nAVGO\nAVGO\n+2.80%\nPLTR\nPLTR\n-3.95%',
    'NVDA\nNVDA\n+4.21%\nPM\nPLTR\nPLTR\n-3.95%\nAVGO\nAVGO\n+2.80%',
  )
  const b = harvest(unsorted)
  const { rows } = compare(a, b)
  const probe = rows.find((r) => r.p.id === 'C/trendingOrder')
  check('notices Trending Now out of order', probe?.vb === 'not sorted', String(probe?.vb))
}

console.log('')
if (failures) {
  console.log(`  ${failures} self-test failure(s) — parity-check.mjs is not trustworthy as written\n`)
  process.exit(1)
}
console.log(`  ✓ self-test clean (${PROBES.length} probes)\n`)
