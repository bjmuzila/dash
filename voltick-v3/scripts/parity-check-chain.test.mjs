#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// Unit test for parity-check-chain.mjs, against fixtures rather than a browser.
//
// A checker nobody has ever seen fail is not a checker. This drives compare()
// five ways:
//
//   1. a realistic v2 harvest vs a realistic v3 harvest → clean, bar the one
//      departure the port declared (no GO button, no snapshot button);
//   2. the SAME v2 harvest vs the v3 page AS IT STOOD BEFORE this port — the
//      550-line single-expiry ladder, with no matrix, no heat skins, no replay
//      → the grid probes must all fail, which is precisely the class of loss
//      this script exists to catch;
//   3. a v3 harvest that renders the grid but never opens its settings menu →
//      the Part D probes must notice, because eighteen controls silently
//      missing behind a cog is the easiest way for a port to look finished;
//   4. every probe against every fixture → a probe that can NEVER return a
//      value would otherwise read as a silent pass forever;
//   5. the OI tab with a focus selection → the two conditional toolbar readouts
//      (the FOCUS chip and the ΔOI provenance line) are only on screen there.
//
//   node scripts/parity-check-chain.test.mjs
// ─────────────────────────────────────────────────────────────────────────────

import { PROBES, compare } from './parity-check-chain.mjs'

// ── Fixtures ─────────────────────────────────────────────────────────────────
// Written as the page's innerText actually comes out: one DOM box per line.

const TOOLBAR_V2 = `Options Chain
SPX
GEX · OI + Vol · 10%
LIVE
Tickers
GO
Recent
↻ Now
📸`

// v3's page carries no ticker control of its own — the SPX above is the app
// toolbar's picker trigger, which renders above every page.
const TOOLBAR_V3 = `SPX
Options Chain
SPX
GEX · OI + Vol · 10%
LIVE
↻ Now`

const COG = `Grid
Strikes
10% strikes
Greek
GEX
DEX
CHEX
VEX
OI
VOL
Basis
OI + Vol
Vol Only
Change
Live
15m Δ
30m Δ
60m Δ
Heat
Intensity
3.00x
Skin
CLASSIC
VIVID
Stamps
Δ15m
Replay
▶ Replay`

/** v3's cog: no Change row, no Stamps row — both dropped 2026-08-30. */
const COG_V3 = `Grid
Strikes
10% strikes
Greek
GEX
DEX
CHEX
VEX
OI
VOL
Basis
OI + Vol
Vol Only
Heat
Intensity
3.00x
Skin
CLASSIC
VIVID
Replay
▶ Replay`

const GRID = `Strike
Fri 08-30
+$1.23M
Mon 09-02
-$840.2K
Tue 09-03
+$12.40M
Total
+$14.55M
Strike
ATM
6420
$1.23M
$840.2K
-$44.10K
$14.55M
6420
EM +1σ
6440
-$220.4K
·
$1.02M
$1.55M
6440
EM −1σ
6400
$98.10K
$4.20K
·
$1.10M
6400
EM +2σ
6460
·
·
$310.0K
$310.0K
6460
EM −2σ
6380
-$12.00K
·
·
-$12.00K
6380`

const TITLES_V2 = [
  'Options chain settings',
  'Click to focus this expiration (shift-click = only this one)',
  'Click to focus this strike (shift-click = only this one)',
  'At-the-money — nearest strike to spot (6421.44)',
  '1× weekly expected move up (6415 ± 42)',
  'Click for volume / OI / net premium',
  'CB - Core Bullseye — highest |net GEX|',
  'Highest volume GEX (+$4.10M) — positive gamma',
  'Heat intensity. At the minimum stop the gamma wash switches off and only CB / CW / PW stay marked.',
  'Stamp each front-expiry cell with its 15-minute net-GEX change (top 5 strikes per side of ATM)',
  "Rewind the grid itself through the session's recorded net-GEX snapshots",
]

const TITLES_V3 = [
  // The Δ15m tooltip is gone with the control it explained; the toolbar picker's
  // is new, and is what C/tickers matches on the v3 side.
  ...TITLES_V2.filter((t) => !/top 5 strikes per side of ATM/.test(t)),
  "The board's symbol — every page that can follow a ticker is showing this one. Star the ones you rotate between.",
]

function harvest(text, titles) {
  const lines = text
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
  return { text, lines, titles, inputs: 24, ranges: 1 }
}

const V2 = harvest(`${TOOLBAR_V2}\n${COG}\n${GRID}`, TITLES_V2)
const V3 = harvest(`${TOOLBAR_V3}\n${COG_V3}\n${GRID}`, TITLES_V3)

/** v3 as it stood BEFORE the port: a single-expiry calls/puts ladder. */
const V3_BEFORE = harvest(
  `Options Chain
SPX
Expiration
Fri, 08-30-2026
Strike range
10%
Calls
Puts
Strike
6420
6440
6400
Options chain — TODO
`,
  ['Refresh the chain'],
)

/** v3 with the grid, but the settings menu never opened. */
const V3_NO_COG = harvest(`${TOOLBAR_V3}\n${GRID}`, TITLES_V3.filter((t) => !/intensity|Stamp each|Rewind/i.test(t)))

/** The OI tab, with one expiry focused — the two conditional toolbar readouts. */
const V2_OI = harvest(
  `Options Chain
SPX
OI · OI + Vol · 10%
LIVE
FOCUS: 1 exp ✕
\u0394OI 2026-08-29 vs 2026-08-28
${GRID}`,
  TITLES_V2,
)
const V3_OI = harvest(
  `SPX
Options Chain
SPX
OI · OI + Vol · 10%
LIVE
FOCUS: 1 exp ✕
\u0394OI 2026-08-29 vs 2026-08-28
${GRID}`,
  TITLES_V3,
)

// ── Assertions ───────────────────────────────────────────────────────────────

let failures = 0
function check(name, ok, detail) {
  if (ok) {
    console.log(`  ✓ ${name}`)
  } else {
    failures++
    console.log(`  ✗ ${name}${detail ? `\n      ${detail}` : ''}`)
  }
}

console.log('\nparity-check-chain.test — compare() against fixtures\n')

// 1. The finished port.
{
  const { missing, softer } = compare(V2, V3)
  check('finished port reports no missing values', missing.length === 0, missing.map((m) => m.p.id).join(', '))
  const softIds = softer.map((s) => s.p.id).sort()
  check(
    'all five declared departures are reported as soft, not as losses',
    softIds.join(',') === 'C/go,C/recent,C/snapshot,D/changeModes,D/delta15,D/delta15Tip,D/stampsSection',
    `got: ${softIds.join(',') || '(none)'}`,
  )
}

// 2. The pre-port page. Every grid probe must fail.
{
  const { missing } = compare(V2, V3_BEFORE)
  const ids = new Set(missing.map((m) => m.p.id))
  const mustCatch = [
    'B/modeline',
    'B/livechip',
    'C/refresh',
    'C/cog',
    'D/greekField',
    'D/basisField',
    'H/expHeaders',
    'H/totalHeader',
    'I/atm',
    'I/atmTip',
    'J/cellFigures',
    'J/cbMarker',
  ]
  const uncaught = mustCatch.filter((id) => !ids.has(id))
  check(
    'the pre-port ladder is caught losing the matrix',
    uncaught.length === 0,
    uncaught.length ? `these probes did NOT fail and should have: ${uncaught.join(', ')}` : '',
  )
  check('…and reports more than 10 losses in total', missing.length > 10, `got ${missing.length}`)
}

// 3. The grid is there, the settings are not.
{
  const { missing } = compare(V2, V3_NO_COG)
  const ids = new Set(missing.map((m) => m.p.id))
  const mustCatch = ['D/strikesField', 'D/greekField', 'D/greekTabs', 'D/basisField', 'D/basisOiVol', 'D/basisVolOnly']
  const uncaught = mustCatch.filter((id) => !ids.has(id))
  check(
    'a page whose settings never opened is caught',
    uncaught.length === 0,
    uncaught.length ? `these probes did NOT fail and should have: ${uncaught.join(', ')}` : '',
  )
}

// 4. Every probe is exercised by at least one fixture, so a probe that can never
//    return a value is caught here rather than reading as a silent pass forever.
{
  const all = [V2, V3, V2_OI, V3_OI]
  const dead = PROBES.filter((p) => all.every((h) => p.get(h) == null)).map((p) => p.id)
  check('every probe finds something in at least one fixture', dead.length === 0, `never matched: ${dead.join(', ')}`)
}

// 5. The OI tab, with a focus selection — the two conditional readouts must be
//    seen on both sides, and nothing else may go missing while a tab is switched.
{
  const { missing } = compare(V2_OI, V3_OI)
  check('the OI tab with a focus selection reports no missing values', missing.length === 0, missing.map((m) => m.p.id).join(', '))
}

console.log('')
if (failures) {
  console.log(`  ${failures} self-test failure(s) — the parity checker itself is wrong.\n`)
  process.exit(1)
}
console.log(`  ✓ ${PROBES.length} probes, 5 assertions passed\n`)
