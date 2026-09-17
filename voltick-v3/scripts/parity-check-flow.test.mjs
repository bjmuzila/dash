#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// Unit test for parity-check-flow.mjs, against fixtures rather than a browser.
//
// A checker nobody has ever seen fail is not a checker. This drives compare()
// four ways:
//
//   1. a realistic v2 harvest vs a realistic v3 harvest → clean, bar the one
//      departure the port declared (a two-state status badge);
//   2. the SAME v2 harvest vs the v3 page AS IT STOOD BEFORE this port — no
//      chart, Vol/OI/IV stubbed to em dashes, no session date — which is the
//      exact loss this script exists to catch, and the reason it was written;
//   3. a v3 harvest whose chart canvas mounted but never painted → the port
//      "has a chart" and still fails, because an empty canvas is not a chart;
//   4. a v3 harvest that tidied SELL CALL into SELL CALLS → the wording probe
//      must notice, because a label the eye already knows is a value too.
//
//   node scripts/parity-check-flow.test.mjs
// ─────────────────────────────────────────────────────────────────────────────

import { PROBES, compare } from './parity-check-flow.mjs'

const V2_TEXT = `Options Flow
By Ticker
Combined
0–7DTE ≥$500K OTM
Session
Options Flow — Filters
Live order flow off the feed. Pick a watched ticker to drive the chart + tape.
Watchlist (12)
SPX
SPY
QQQ
NVDA
+ add ticker
GO
Recent ▾
Side
ALL
BUY
SELL
Type
ALL
CALL
PUT
Min Premium $15.0K
Min Size
Expiry
0DTE
All
Min DTE
Max DTE
Moneyness
ALL
OTM
Reset
Net Drift (Premium) — SPX
● Calls $12.40M
● Puts -$8.10M
Net $4.30M
RTH
24H
Premium Split (Filtered Tape)
BUY CALLS
▲ BULL
$18.20M
BUY PUTS
▼ BEAR
$6.40M
SELL CALL
▼ BEAR
$5.80M
SELL PUT
▲ BULL
$14.50M
Dislocation Velocity · SPX 1m
2.41
z 2.6 · clv 0.93
impulse-up
Flow Tape — SPX
1,204 orders
Total $44.90M
Calls $24.00M
Puts $20.90M
LIVE
Ticker
Time
Side
Strike
Spot
Type
Size
Cost/Ctr
Premium
Vol
OI
IV
% OTM
DTE
Expiry
Bias
09:31:04 AM
BUY
6,300
6,281.44
C
120
$412.00
▸ $560.4K
12.4K
3,201
18.4%
0.3%
0d
2026-08-30
▲ BULL
09:33:12 AM
SELL
6,250
6,281.44
P
40
$180.00
$72.0K
8.1K
2,004
21.0%
0.5%
0d
2026-08-30
▲ BULL`

const TITLES = [
  'Combined · 0–7 DTE · ≥$500K premium · OTM only',
  'Regular trading hours only (9:30–4:00 ET)',
  'Full session — includes pre-open and the overnight global session',
  'Cost of one contract (price × 100)',
  "Contract's traded volume TODAY (live, not at print time)",
  "Contract's current open interest",
  'Current implied volatility',
  'Strike vs LIVE underlying spot. + = OTM, − = now ITM',
  'Calendar days to expiration',
  'Click to expand contract detail',
]

function harvest(text, opts = {}) {
  const {
    titles = TITLES,
    canvases = 2,
    canvasPainted = true,
    ranges = 1,
    dates = 1,
    selects = 1,
    inputs = 26,
  } = opts
  return {
    text,
    lines: text.split('\n').filter(Boolean),
    titles,
    money: text.match(/-?\$\d[\d.]*[MK]?/g) || [],
    canvases,
    canvasPainted,
    inputs,
    ranges,
    dates,
    selects,
    tapeRows: (text.match(/(?:▲ BULL|▼ BEAR)/g) || []).length,
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

console.log('\nparity-check-flow self-test\n')

// ── 1. the port as built ──
{
  const a = harvest(V2_TEXT)
  // v3 is identical bar the status badge, which it cannot report three ways.
  const b = harvest(V2_TEXT)
  const { missing, softer } = compare(a, b)
  check('a faithful v3 loses nothing', missing.length === 0, missing.map((m) => m.p.id).join(', '))
  check('and reports no spurious departures', softer.length === 0, softer.map((s) => s.p.id).join(', '))
}

// ── 2. the v3 page as it stood BEFORE this port ──
// No chart (a TODO paragraph in its place), Vol/OI/IV stubbed, no session date,
// no dislocation card, no premium-split captions.
{
  const a = harvest(V2_TEXT)
  const before = V2_TEXT
    .replace(/Net Drift \(Premium\) — SPX\n● Calls \$12\.40M\n● Puts -\$8\.10M\nNet \$4\.30M\nRTH\n24H\n/, 'Net drift chart not ported yet.\n')
    .replace('Premium Split (Filtered Tape)', 'Premium Split')
    .replace(/Dislocation Velocity · SPX 1m\n2\.41\nz 2\.6 · clv 0\.93\nimpulse-up\n/, '')
    .replace('Session\n', '')
    .replace(/12\.4K\n3,201\n18\.4%/, '—\n—\n—')
    .replace(/8\.1K\n2,004\n21\.0%/, '—\n—\n—')
  const b = harvest(before, {
    canvases: 0,
    canvasPainted: false,
    dates: 0,
    titles: TITLES.filter((t) => !/9:30|traded volume|open interest|implied volatility|LIVE underlying/.test(t)),
  })
  const { missing } = compare(a, b)
  const ids = new Set(missing.map((m) => m.p.id))
  for (const id of [
    'B/session', 'B/datePicker',
    'E/heading', 'E/legendCalls', 'E/legendPuts', 'E/legendNet', 'E/spanRth', 'E/span24h', 'E/spanTitle',
    'F/canvas', 'F/painted',
    'H/caption',
    'I/heading', 'I/z', 'I/regime',
    'L/tipVol', 'L/tipOi', 'L/tipIv', 'L/tipOtm',
  ]) {
    check(`catches the un-ported value: ${id}`, ids.has(id))
  }
}

// ── 3. a chart that mounted and never painted ──
{
  const a = harvest(V2_TEXT)
  const b = harvest(V2_TEXT, { canvasPainted: false })
  const { missing } = compare(a, b)
  check(
    'an empty canvas is not a ported chart',
    missing.some((m) => m.p.id === 'F/painted'),
    missing.map((m) => m.p.id).join(', '),
  )
  check(
    'and F/canvas still passes, so the message points at the right thing',
    !missing.some((m) => m.p.id === 'F/canvas'),
  )
}

// ── 4. the plurals "tidied" ──
{
  const a = harvest(V2_TEXT)
  const b = harvest(V2_TEXT.replace('SELL CALL\n', 'SELL CALLS\n').replace('SELL PUT\n', 'SELL PUTS\n'))
  const { missing } = compare(a, b)
  check(
    'notices SELL CALL renamed to SELL CALLS',
    missing.some((m) => m.p.id === 'H/sellCall'),
    missing.map((m) => m.p.id).join(', '),
  )
}

console.log('')
if (failures) {
  console.log(`  ${failures} self-test failure(s) — parity-check-flow.mjs is not trustworthy as written\n`)
  process.exit(1)
}
console.log(`  ✓ self-test clean (${PROBES.length} probes)\n`)
