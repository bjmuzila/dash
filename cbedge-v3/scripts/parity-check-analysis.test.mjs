#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// Unit test for parity-check-analysis.mjs, against fixtures rather than a
// browser.
//
// A checker nobody has ever seen fail is not a checker. This drives compare()
// five ways, and four of the five are failures that ACTUALLY HAPPENED on this
// port rather than hypotheticals:
//
//   1. a realistic v2 harvest vs a faithful v3 harvest → clean, bar the one
//      departure the port declared (the earnings chip logo);
//   2. the v3 page AS IT STOOD BEFORE the rebuild — Ticker Lookup, Multi Greek,
//      Econ Calendar and Initial Balance all stubs. Four whole cards gone;
//   3. Ticker Levels regressed from v2's searchable menu to four hardcoded
//      pills. The page still renders every NUMBER, so a text-only diff passes
//      it — the picker is a control, and its loss is invisible until you go
//      looking for the control itself;
//   4. a v3 painted in v3's OWN palette — every value present, every label
//      right, and #5b8cff where v2 paints #219EBC. This is the one
//      check-theme.mjs structurally cannot catch, and the reason the colour
//      probes exist;
//   5. a v3 that reached for a grey secondary. v2 has none — "muted" there is
//      white at an opacity — so a slate label is a colour regression too.
//
//   node scripts/parity-check-analysis.test.mjs
// ─────────────────────────────────────────────────────────────────────────────

import { PROBES, compare, normColor } from './parity-check-analysis.mjs'

// ── The v2 palette, as the browser resolves it ───────────────────────────────
const V2C = {
  cyan: 'rgb(33, 158, 188)', // #219EBC
  cb: 'rgb(255, 214, 0)', // #ffd600
  cw: 'rgb(41, 182, 246)', // #29b6f6
  pw: 'rgb(255, 71, 87)', // #ff4757
  ink: 'rgb(11, 15, 26)', // #0b0f1a
  white: 'rgb(255, 255, 255)',
  plate: 'rgba(13, 17, 25, 0.45)',
  edge: 'rgba(255, 255, 255, 0.1)',
}

// ── The v3 palette, which this page must NOT use ─────────────────────────────
const V3C = {
  accent: 'rgb(91, 140, 255)', // --color-accent #5b8cff
  line: 'rgb(35, 39, 46)', // --color-line #23272e
  surface: 'rgb(20, 23, 29)', // --color-surface2 #14171d
  slate: 'rgb(122, 130, 141)', // --color-flat #7a828d — a grey v2 does not have
}

const BODY = `Ticker Lookup
$SPX
GEX levels
6412.50
Positive gamma
SPX · Sep 5 · 6DTE · 2026-08-30
↻ Now
⏱ Replay
SPX
SPY
QQQ
NVDA
TSLA
By expiration
Net GEX
+1.2B
Sep 5 · 6DTE
Sep 12 · 13DTE
± Move ±42.50 · ATM IV 12.4%
Strike
Net GEX
Value
6450
CB
+880M
6400
CW
+512M
6350
PW
-410M
Core (CB)
6450
37.50 above
biggest magnet
Call wall
6400
ceiling
Put wall
6350
floor
All expirations · ex-0DTE
Net GEX
+4.8B
38 expirations · excl. 0DTE · whole board
Δ 1D vs close 2026-08-29
The read:
Net positive gamma across the board — dealers sell rallies and buy dips, so price tends to pin and mean-revert. Core magnet 6450. Call wall 6400. Put wall 6350. Gamma flip 6377.25 — pinning above, trending below.
OI+Vol basis · left pane shares Multi Greek's formula · right pane is the server full-board sweep · educational only, not investment advice
updated 3:42:18 PM ET
Multi Greek
peak strike
GEX · peak strike
6450
+880M
DEX · peak strike
6400
+1.1B
CHEX · peak strike
6350
-240M
VEX · peak strike
6500
+96M
updated 3:42:20 PM ET
Estimated Move
weekly
More →
EM Up
6512
Spot
6412.5
EM Down
6312
Distance to nearer band (Down)
100.5 pts
1.57%
ESU
NQU
updated 3:42:21 PM ET
Premarket
2026-08-31
Global tape is firm into the open with European indices adding half a percent.
/ES gap: +12.25 pts (0.19%)
updated 3:42:22 PM ET
Economic Calendar
2026-08-30
TODAY
High
USD
Core PCE Price Index m/m
A: 0.3%
F: 0.2%
P: 0.2%
PRE
MKT
Premarket earnings
Confidence Score
BETA
2026-08-30
More →
72
/100
HIT
Current SPX CB
6450
Distance to CB
+12.5
CB checkpoints
9:45
6450
HIT
10:30
6450
HIT
12:00
6450
pending
updated 3:42:23 PM ET
Net Greeks
now · Δ15m · Δ30m
Net GEX
+1.2B
15m
+40M
30m
-12M
Net DEX
+3.4B
Net CHEX
-240M
Net VEX
+96M
updated 3:42:24 PM ET
Initial Balance
ES
IB locked
IB High
6438
IB Mid
6421
IB Low
6404
Range
34 pts
IB read
Trend ↑
long
Trend up — favor break-&-retest longs above IB/PDH; stops below IB low.
Rules in play (2)
updated 3:42:25 PM ET
Ticker Levels
Sep 5 · 6DTE
Spot
6412.5
Call Wall
6450
Put Wall
6350
Core
6440
+27.5
Distance to nearer wall (Put)
62.5 pts
0.97%
updated 3:42:26 PM ET
Strategy Builder
NOT FINANCIAL ADVICE
2026-08-30
long
Key levels
Primary idea
Entry
Stop
Target
SPX
Confirmation triggers
updated 3:42:27 PM ET`

const TITLES = [
  'Re-fetch the chain, the listing and the whole-board sweep',
  'Replay — scrub both ladders back through a recorded session (recorded walls only, ~5 trading days)',
  'Core — biggest magnet',
  'Call wall — ceiling',
  'Put wall — floor',
  'Select ticker',
  'Levels computed on the 2026-09-05 chain',
]

/** A harvest, with everything defaulted to the faithful case. */
function harvest(over = {}) {
  const text = over.text ?? BODY
  return {
    text,
    lines: text.split('\n').map((s) => s.trim()).filter(Boolean),
    titles: over.titles ?? TITLES,
    inputs: 24,
    ranges: 0,
    selects: 0,
    ladderRows: over.ladderRows ?? 41,
    stamps: (text.match(/updated (?:\d|—)/g) || []).length,
    colors: {
      titleMultiGreek: V2C.cyan,
      titleTickerLevels: V2C.cyan,
      titleInitialBalance: V2C.cyan,
      titleLookup: V2C.cyan,
      tagCB: V2C.cb,
      tagCW: V2C.cw,
      tagPW: V2C.pw,
      inkCB: V2C.ink,
      labelSpot: V2C.white,
      labelCore: V2C.white,
      ...(over.colors ?? {}),
    },
    plate: over.plate ?? { bg: V2C.plate, border: V2C.edge, radius: '18px' },
  }
}

// ── Harness ──────────────────────────────────────────────────────────────────
let failed = 0
function ok(cond, what) {
  console.log(`  ${cond ? '✓' : '✗'} ${what}`)
  if (!cond) failed++
}
const ids = (list) => list.map((m) => m.p.id).sort()

console.log('\nparity-check-analysis self-test\n')

// ── 1. A faithful port loses nothing ─────────────────────────────────────────
{
  const { missing, wrongColour, softer } = compare(harvest(), harvest())
  ok(missing.length === 0, `a faithful v3 loses nothing${missing.length ? ` — ${ids(missing)}` : ''}`)
  ok(wrongColour.length === 0, 'and every colour resolves the same')
  ok(softer.length === 0, 'and reports no spurious departures')
}

// ── 2. The port as it stood BEFORE the rebuild: four stubbed cards ───────────
{
  // Everything from "Multi Greek" through the end of Initial Balance, minus the
  // cards that were stubs. This is the real diff, not an invented one.
  const stubbed = BODY.split('\n')
    .filter(
      (l) =>
        !/^(Ticker Lookup|\$SPX|GEX levels|Positive gamma|By expiration|All expirations|Core \(CB\)|Call wall|Put wall|The read:|Net positive gamma|OI\+Vol basis|Strike|Value|CB|CW|PW|biggest magnet|ceiling|floor|± Move|⏱ Replay|↻ Now|38 expirations|Δ 1D vs close|Multi Greek|peak strike|(?:GEX|DEX|CHEX|VEX) · peak strike|Economic Calendar|TODAY|High|USD|Core PCE|[AFP]: |PRE|MKT|Premarket earnings|Initial Balance|IB (?:locked|High|Mid|Low|read)|Range|Rules in play|Trend ↑|long$|Trend up)/.test(
          l,
        ),
    )
    .join('\n')
  const { missing } = compare(harvest(), harvest({ text: stubbed, ladderRows: 0, titles: ['Select ticker'] }))
  const lost = ids(missing)
  for (const id of ['C/heading', 'I/title', 'L/title', 'O/title', 'F/tagCB', 'G/read']) {
    ok(lost.includes(id), `catches the stubbed card: ${id}`)
  }
  ok(missing.length > 20, `…and reports the whole loss, not one row (${missing.length})`)
}

// ── 3. Ticker Levels regressed to a fixed pill row ───────────────────────────
// Every NUMBER still renders, so the text diff is clean. Only the control is
// gone, which is exactly why this probe reads the picker and not the values.
{
  const { missing } = compare(harvest(), harvest({ titles: TITLES.filter((t) => t !== 'Select ticker') }))
  ok(ids(missing).includes('P/picker'), 'catches the ticker picker regressed to fixed pills')
  ok(missing.length === 1, 'and reports nothing else, because nothing else was lost')
}

// ── 4. THE COLOUR REGRESSION — v3's own palette, every value present ─────────
{
  const { missing, wrongColour } = compare(
    harvest(),
    harvest({
      colors: {
        titleMultiGreek: V3C.accent,
        titleTickerLevels: V3C.accent,
        titleInitialBalance: V3C.accent,
      },
      plate: { bg: V3C.surface, border: V3C.line, radius: '6px' },
    }),
  )
  ok(missing.length === 0, 'a wrongly-coloured port loses no VALUES — a text diff passes it')
  const bad = ids(wrongColour)
  for (const id of ['S/titleCyan', 'S/titleCyan2', 'S/titleCyan3', 'S/plateBg', 'S/plateEdge']) {
    ok(bad.includes(id), `…and the colour probe catches it: ${id}`)
  }
  ok(!bad.includes('S/tagCB'), 'while the wall tags, which DO match, stay quiet')
}

// ── 5. A grey secondary, which v2 does not have ──────────────────────────────
{
  const { wrongColour } = compare(harvest(), harvest({ colors: { labelSpot: V3C.slate } }))
  ok(ids(wrongColour).includes('S/label'), 'catches a label painted a grey instead of white')
}

// ── 6. normColor: the same pixel, three engine spellings ─────────────────────
{
  ok(normColor('rgb(33, 158, 188)') === 'rgba(33,158,188,1)', 'normColor: rgb()')
  ok(normColor('rgba(13, 17, 25, 0.45)') === 'rgba(13,17,25,0.45)', 'normColor: rgba()')
  ok(
    normColor('color(srgb 0.129412 0.619608 0.737255)') === 'rgba(33,158,188,1)',
    'normColor: color(srgb …) resolves to the same pixel as rgb()',
  )
  ok(normColor(null) === null, 'normColor: a missing colour stays missing, not black')
}

// ── 7. Every probe finds something in the faithful fixture ───────────────────
// The trap this closes: a probe whose regex never matches is silently green on
// both sides forever, and reports a value as "ported" that neither page has.
{
  const h = harvest()
  const blind = PROBES.filter((p) => {
    const v = p.get(h)
    return p.count ? !(Number(v) > 0) : v == null
  }).filter((p) => !p.optional)
  ok(blind.length === 0, `every non-optional probe matches the fixture${blind.length ? ` — blind: ${blind.map((p) => p.id)}` : ''}`)
}

console.log(
  failed === 0
    ? `\n  ✓ self-test clean (${PROBES.length} probes)\n`
    : `\n  ✗ ${failed} self-test failure(s)\n`,
)
process.exit(failed === 0 ? 0 : 1)
