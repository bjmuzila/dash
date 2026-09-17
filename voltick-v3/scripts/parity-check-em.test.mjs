#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// Unit test for parity-check-em.mjs, against fixtures rather than a browser.
//
// A checker nobody has ever seen fail is not a checker. This drives compare()
// six ways:
//
//   1. a realistic v2 harvest vs the v3 port → clean, bar the one departure the
//      port declared (the snapshot button);
//   2. the v3 page WITHOUT the enrichment blocks — no hit-rate meter, no
//      historical averages, no track record — which is precisely what a
//      subscriber saw before the /api/em-tracker auth fix, and what a v3 build
//      verified while signed in as the owner would ship without noticing;
//   3. a v3 page whose EM tiles render their labels but print "--" — the
//      failure a label-only probe sails straight past, and the reason
//      E/levelNumbers is a SET probe;
//   4. a v3 page that dropped the Far rows from both zones, keeping Near;
//   5. a v3 page that "tidied" the Sell Zone hint wording;
//   6. the case change the port makes on purpose (v2 uppercases card titles in
//      CSS) must NOT register as a loss.
//
//   node scripts/parity-check-em.test.mjs
// ─────────────────────────────────────────────────────────────────────────────

import { PROBES, compare } from './parity-check-em.mjs'

// v2 as rendered: innerText applies text-transform, so the card titles and the
// tile labels arrive uppercased.
const V2_TEXT = `Weekly Estimated Move & Zones
Enter a ticker to see this week's estimated move and the buy / sell zones.
SPX
NDX
ESU
NQU
SPY
QQQ
AAPL
NVDA
TSLA
MSFT
SPX
WEEK OF 9/4
Updated Aug 28, 04:19 PM
ESTIMATED MOVE
CLOSE
7,711.76
EM
85.33
UP
7,797.09
DOWN
7,626.43
EM HIT RATE
62% Hit
Miss (29)
62%
Hit (47)
BUY ZONE
Support area — bias long while price holds above.
NEAR
7,573.83
FAR
7,522.90
SELL ZONE
Resistance area — bias short while price stays below.
NEAR
7,840.45
FAR
7,891.37
VS HISTORICAL EM AVERAGE
VS 4-WK AVG (88.41)
▼ 3.5%
VS 12-WK AVG (100.08)
▼ 14.7%
BASED ON 12 WEEKS OF RECORDED DATA
RECENT TRACK RECORD
LAST WEEK (8/28)
HIT
LAST 5 WKS HIT %
60%
3 / 5 hit
Levels are published weekly and are informational only — not financial advice.`

// v3 as built: sentence-case titles, the same values, plus the pivot readout,
// and no snapshot button.
const V3_TEXT = V2_TEXT
  .replace('ESTIMATED MOVE', 'Estimated Move')
  .replace('BUY ZONE', 'Buy Zone')
  .replace('SELL ZONE', 'Sell Zone')
  .replace('VS HISTORICAL EM AVERAGE', 'vs Historical EM Average')
  .replace('VS 4-WK AVG (88.41)', 'vs 4-Wk Avg (88.41)')
  .replace('VS 12-WK AVG (100.08)', 'vs 12-Wk Avg (100.08)')
  .replace('BASED ON 12 WEEKS OF RECORDED DATA', 'Based on 12 weeks of recorded data')
  .replace('RECENT TRACK RECORD', 'Recent Track Record')
  .replace('LAST WEEK (8/28)', 'Last Week (8/28)')
  .replace('LAST 5 WKS HIT %', 'Last 5 Wks Hit %')
  .replace('WEEK OF 9/4', 'Week of 9/4')
  .replace(
    'Resistance area — bias short while price stays below.\nNEAR\n7,840.45\nFAR\n7,891.37',
    'Resistance area — bias short while price stays below.\nNEAR\n7,840.45\nFAR\n7,891.37\nPivot\n7,707.14',
  )

function harvest(text, opts = {}) {
  const { inputs = 1, buttons = 11, snapButtons = 0, alts = ['CB Edge'], placeholders = ['Enter ticker  (e.g. SPX, NDX, AAPL)'] } = opts
  return {
    text,
    lower: text.toLowerCase(),
    lines: text.split('\n').map((l) => l.trim()).filter(Boolean),
    titles: [],
    imgAlts: alts,
    placeholders,
    inputs,
    buttons,
    levelNumbers: text.match(/\b\d{1,3}(?:,\d{3})*\.\d{2}\b/g) || [],
    percents: text.match(/\d+(?:\.\d+)?%/g) || [],
    snapButtons,
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

console.log('\nparity-check-em self-test\n')

// ── 1. the port as built ──
{
  const a = harvest(V2_TEXT, { snapButtons: 1 })
  const b = harvest(V3_TEXT, { snapButtons: 0 })
  const { missing, softer } = compare(a, b)
  check('a faithful v3 loses nothing', missing.length === 0, missing.map((m) => m.p.id).join(', '))
  check(
    'the snapshot button is reported as the one declared departure',
    softer.length === 1 && softer[0].p.id === 'D/snapshot',
    softer.map((s) => s.p.id).join(', '),
  )
}

// ── 2. the owner-gate loss: no hit rate, no averages, no track record ──
// This is what every SUBSCRIBER saw before the /api/em-tracker auth fix, on
// both pages. Here it is v3-only, which is what a port that quietly dropped the
// three enrichment blocks would look like.
{
  const a = harvest(V2_TEXT, { snapButtons: 1 })
  const stripped = V3_TEXT
    .replace(/EM HIT RATE\n62% Hit\nMiss \(29\)\n62%\nHit \(47\)\n/, '')
    .replace(/vs Historical EM Average\nvs 4-Wk Avg \(88\.41\)\n▼ 3\.5%\nvs 12-Wk Avg \(100\.08\)\n▼ 14\.7%\nBased on 12 weeks of recorded data\n/, '')
    .replace(/Recent Track Record\nLast Week \(8\/28\)\nHIT\nLast 5 Wks Hit %\n60%\n3 \/ 5 hit\n/, '')
  const b = harvest(stripped)
  const { missing } = compare(a, b)
  const flagged = new Set(missing.map((m) => m.p.id))
  for (const id of ['E/hitRate', 'E/hitPct', 'E/miss', 'E/hit', 'G/heading', 'G/recent', 'G/mid', 'G/arrow', 'G/sample', 'H/heading', 'H/lastWeek', 'H/result', 'H/window', 'H/ratio']) {
    check(`FAILS on the missing enrichment value: ${id}`, flagged.has(id))
  }
}

// ── 3. tiles that render their labels and print "--" ──
{
  const a = harvest(V2_TEXT, { snapButtons: 1 })
  const dashed = V3_TEXT
    .replace('7,711.76', '--')
    .replace('7,797.09', '--')
    .replace('7,626.43', '--')
  const b = harvest(dashed)
  const { missing } = compare(a, b)
  const m = missing.find((x) => x.p.id === 'E/levelNumbers')
  check('a tile showing "--" fails the level-number set probe', !!m, missing.map((x) => x.p.id).join(', '))
  check(
    'and the failure names the exact figures that went missing',
    !!m && m.detail.includes('7,711.76') && m.detail.includes('7,797.09') && m.detail.includes('7,626.43'),
    m?.detail,
  )
  check(
    'while the label probes still pass, so the message points at the right thing',
    !missing.some((x) => ['E/close', 'E/up', 'E/down'].includes(x.p.id)),
  )
}

// ── 4. the Far rows dropped from both zones ──
{
  const a = harvest(V2_TEXT, { snapButtons: 1 })
  const b = harvest(V3_TEXT.replace(/FAR\n7,522\.90\n/, '').replace(/FAR\n7,891\.37\n/, ''))
  const { missing } = compare(a, b)
  check('notices both Far rows going away', missing.some((m) => m.p.id === 'F/far'))
  check('and the lost figures show up in the set probe too', missing.some((m) => m.p.id === 'E/levelNumbers'))
}

// ── 5. wording "tidied" ──
{
  const a = harvest(V2_TEXT, { snapButtons: 1 })
  const b = harvest(V3_TEXT.replace('Resistance area — bias short while price stays below.', 'Resistance zone.'))
  const { missing } = compare(a, b)
  check('notices the Sell Zone hint being rewritten', missing.some((m) => m.p.id === 'F/sellHint'))
}

// ── 6. the deliberate case change is NOT a loss ──
{
  const a = harvest(V2_TEXT, { snapButtons: 1 })
  const b = harvest(V3_TEXT)
  const { missing } = compare(a, b)
  check(
    'v2 "ESTIMATED MOVE" vs v3 "Estimated Move" is not reported as missing',
    !missing.some((m) => ['E/heading', 'F/buy', 'F/sell', 'G/heading', 'H/heading'].includes(m.p.id)),
    missing.map((m) => m.p.id).join(', '),
  )
}

console.log('')
if (failures) {
  console.log(`  ${failures} self-test failure(s) — parity-check-em.mjs is not trustworthy as written\n`)
  process.exit(1)
}
console.log(`  ✓ self-test clean (${PROBES.length} probes)\n`)
