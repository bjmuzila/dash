#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// Unit test for parity-check-replay.mjs, against fixtures rather than a browser.
//
// A checker nobody has ever seen fail is not a checker. This drives compare()
// seven ways:
//
//   1. a realistic v2 harvest vs the v3 port → clean, bar the four departures
//      the port declared;
//   2. a tab quietly missing from the tab bar;
//   3. a Multi Greek grid that renders every heading and prints "--" in every
//      cell — the failure a label-only probe sails straight past, and the reason
//      D/values is a SET probe;
//   4. the caveat lines dropped as "chrome" — the single most likely loss in
//      this port and the one that makes a rewound grid read as live;
//   5. landing on the FIRST frame instead of the last, which silently changes
//      every value on the page and would otherwise show up as forty unrelated
//      differences;
//   6. the Options Chain tab opening on "all expiries" instead of 0DTE;
//   7. the deliberate case change (v2 uppercases in CSS) must NOT register as
//      a loss.
//
//   node scripts/parity-check-replay.test.mjs
// ─────────────────────────────────────────────────────────────────────────────

import { PROBES, TABS, allProbes, compare } from './parity-check-replay.mjs'

const TAB_LABELS = TABS.map((t) => t.label)

const TAB_TITLES = [
  'Per-strike net GEX for one expiry, played through the session. Its own symbol and date pickers.',
  "The Ticker Lookup's two ladders — one expiry beside the whole board ex-0DTE — with the walls and gamma flip they imply.",
  'Four tickers rewound off one shared clock.',
  'The full grid — every strike and column — rewound.',
]

const SPEEDS = ['0.5×', '1×', '2×', '4×', '8×']

function harvest(text, opts = {}) {
  const {
    tabs = TAB_LABELS,
    titles = TAB_TITLES,
    buttons = [],
    ranges = [{ min: 0, max: 389, value: 389, disabled: false }],
    selects = [{ value: '2026-08-28', options: ['2026-08-28', '2026-08-27'] }],
    alts = [],
    snapButtons = 0,
  } = opts
  return {
    text,
    lower: text.toLowerCase(),
    lines: text.split('\n').map((l) => l.trim()).filter(Boolean),
    titles,
    tabs,
    imgAlts: alts,
    ranges,
    selects,
    buttons,
    magnitudes: text.match(/[+\-−]?\$?\d+(?:\.\d+)?[KMB]\b/g) || [],
    strikes: text.match(/\b\d{3,6}(?:\.\d{1,2})?\b/g) || [],
    snapButtons,
  }
}

// ── Fixtures ─────────────────────────────────────────────────────────────────

const HUB_TEXT = ['Chain ladder', 'GEX levels', 'Multi Greek', 'Options chain'].join('\n')

const LADDER_TEXT = `Option chain replay
MSFT
2026-08-28
▶ Play
Speed
0.5×
1×
2×
4×
8×
Scale
frame
day
13:42 ET · spot 6112.44
Frame 183 / 390
MSFT
0DTE
Fri Aug 28 · 13:42:07 ET
6150 +1.2B
6125 +840M
6100 -420M
6075 -1.1B
spot 6112.44`
const LADDER_BUTTONS = ['▶ Play', ...SPEEDS, 'frame', 'day']
const LADDER_TITLES = [
  ...TAB_TITLES,
  'Rescale each snapshot to its own peak — bars always readable',
  'Fixed session-wide scale — magnitudes comparable across time',
]

const LEVELS_TEXT = `GEX levels replay
Replay
◀
▶
Speed
0.5×
1×
2×
4×
8×
10:42 ET
183 / 390
· recorded walls only · sweeps held to the minute · ± Move, ATM IV and Δ 1D off while rewound
Ticker Lookup
$SPX
GEX levels
6,112.44
Positive gamma
SPX · AUG 8 · 3DTE · 2026-08-28 · 10:42 ET
By expiration
Net GEX
+1.2B
± Move — · ATM IV —
Strike
Net GEX
Value
6150
+840M
6100
-420M
Core (CB)
6150
Call wall
6200
Put wall
6050
All expirations · ex-0DTE
Net GEX
+3.4B
7 expirations · excl. 0DTE (2026-08-28) · recorded walls only
The read: Net positive gamma across the board — dealers sell rallies and buy dips, so price tends to pin and mean-revert. Core magnet 6150. Call wall 6200. Put wall 6050. Gamma flip 6087.25 — pinning above, trending below.
OI+Vol basis · recorded strike_growth sweeps for 2026-08-28 · walls only, not the whole ladder · educational only, not investment advice`
const LEVELS_BUTTONS = ['◀', '▶', '❚❚', ...SPEEDS, '⏱ Replay']

const MG_TEXT = `Replay
2026-08-28
◀
▶
Speed
0.5×
1×
2×
4×
8×
09:35 ET
12 / 390
· recorded walls only · sweeps held to the minute · Δ and EM off while rewound
SPX
6112.44
Strike
Total
0DTE
GEX · 08-28
+1.2B
62%
3DTE
GEX · 08-31
+840M
55%
ALL
EX-0DTE
+3.4B
71%
6150
+420M
+210M
+630M
6125
-180M
+90M
-90M
6100
+1.1B
+300M
+1.4B
SPY
612.44
QQQ
548.10
NDX
19850.25`
const MG_BUTTONS = ['◀', '▶', '❚❚', ...SPEEDS, '⚙']
const MG_TITLES = [
  ...TAB_TITLES,
  'Total NET GEX per strike across 6 recorded expiration(s), excluding 0DTE',
  'Core Bullseye',
  'Call Wall',
  'Put Wall',
]
const MG_LEVELS_TEXT = '\nCB\nCW\nPW'

const CHAIN_TEXT = `REPLAY
2026-08-28
Exp
0DTE
All exp
◀
▶
Speed
0.5×
1×
2×
4×
8×
13:42:07 ET
spot 6112.44
frame 183 / 390
· recorded walls only · 2026-08-28 of 7 recorded · 412/840 cells this frame · GEX only
⛶ Ladder
6150
+1.2B
6125
+840M
6100
-420M`
const CHAIN_BUTTONS = ['0DTE', 'All exp', '◀', '▶', '❚❚', ...SPEEDS, '⛶ Ladder']
const CHAIN_TITLES = [...TAB_TITLES, 'GEX only in replay — DEX/CHEX/VEX/OI/VOL are not recorded']

/** v2 as rendered, per tab. innerText applies text-transform, so v2's headings
 *  arrive uppercased where v3's are sentence case. */
function v2() {
  return {
    hub: harvest(HUB_TEXT),
    'chain-ladder': harvest(LADDER_TEXT.replace('Option chain replay', 'OPTION CHAIN REPLAY'), {
      buttons: LADDER_BUTTONS,
      titles: LADDER_TITLES,
      alts: ['CB Edge'],
    }),
    'gex-levels': harvest(LEVELS_TEXT.replace('GEX levels replay', 'GEX LEVELS REPLAY'), {
      buttons: LEVELS_BUTTONS,
    }),
    'mult-greek': harvest(MG_TEXT + MG_LEVELS_TEXT, {
      buttons: [...MG_BUTTONS, 'OI+VOL', 'VOL', 'OI', 'LADDERS', 'Snapshot'],
      titles: MG_TITLES,
      snapButtons: 2,
    }),
    'options-chain': harvest(CHAIN_TEXT, { buttons: CHAIN_BUTTONS, titles: CHAIN_TITLES }),
  }
}

/** v3 as built: same values, sentence-case headings, four declared departures. */
function v3(mutate = (x) => x) {
  return mutate({
    hub: harvest(HUB_TEXT),
    'chain-ladder': harvest(LADDER_TEXT, { buttons: LADDER_BUTTONS, titles: LADDER_TITLES, alts: [] }),
    'gex-levels': harvest(LEVELS_TEXT, { buttons: LEVELS_BUTTONS }),
    'mult-greek': harvest(MG_TEXT + MG_LEVELS_TEXT, {
      buttons: [...MG_BUTTONS, 'OI+VOL', 'VOL'],
      titles: MG_TITLES,
      snapButtons: 0,
    }),
    'options-chain': harvest(CHAIN_TEXT, { buttons: CHAIN_BUTTONS, titles: CHAIN_TITLES }),
  })
}

// ── Harness ──────────────────────────────────────────────────────────────────

let failures = 0
function check(name, cond, detail) {
  if (cond) {
    console.log(`  ✓ ${name}`)
  } else {
    console.log(`  ✗ ${name}${detail ? ` — ${detail}` : ''}`)
    failures++
  }
}

/** Run every tab's probes and collect the ids that failed / went soft. */
function run(a, b) {
  const missing = []
  const softer = []
  for (const [key, probes] of Object.entries(PROBES)) {
    const r = compare(a[key], b[key], probes)
    missing.push(...r.missing.map((m) => ({ ...m, tab: key })))
    softer.push(...r.softer.map((s) => ({ ...s, tab: key })))
  }
  return { missing, softer, ids: new Set(missing.map((m) => m.p.id)) }
}

console.log('\nparity-check-replay self-test\n')

// ── 1. the port as built ──
{
  const { missing, softer } = run(v2(), v3())
  check('a faithful v3 loses nothing', missing.length === 0, missing.map((m) => `${m.tab}:${m.p.id}`).join(', '))
  const softIds = softer.map((s) => s.p.id).sort()
  check(
    'and reports exactly the four declared departures',
    softIds.join(',') === 'B/brandMark,D/capture,D/oiBasis,D/snapshotBtn',
    softIds.join(', '),
  )
}

// ── 2. a tab quietly missing from the bar ──
{
  const { ids } = run(
    v2(),
    v3((x) => {
      x.hub = harvest(HUB_TEXT.replace('Multi Greek\n', ''), { tabs: TAB_LABELS.filter((t) => t !== 'Multi Greek') })
      return x
    }),
  )
  check('notices a tab dropped from the tab bar', ids.has('A/tab:mult-greek'))
}

// ── 3. a grid that renders its headings and prints "--" ──
{
  const { missing, ids } = run(
    v2(),
    v3((x) => {
      x['mult-greek'] = harvest(MG_TEXT.replace(/[+\-]\d+(?:\.\d+)?[KMB]/g, '--') + MG_LEVELS_TEXT, {
        buttons: [...MG_BUTTONS, 'OI+VOL', 'VOL'],
        titles: MG_TITLES,
      })
      return x
    }),
  )
  const m = missing.find((x) => x.p.id === 'D/values')
  check('a cell showing "--" fails the magnitude set probe', !!m, [...ids].join(', '))
  check('and the failure names the exact figures that went missing', !!m && m.detail.includes('+1.2B'), m?.detail)
  check(
    'while the heading probes still pass, so the message points at the right thing',
    !ids.has('D/strike') && !ids.has('D/dte') && !ids.has('D/all'),
  )
}

// ── 4. the caveat lines dropped as "chrome" ──
{
  const { ids } = run(
    v2(),
    v3((x) => {
      x['mult-greek'] = harvest(
        MG_TEXT.replace('· recorded walls only · sweeps held to the minute · Δ and EM off while rewound\n', '') +
          MG_LEVELS_TEXT,
        { buttons: [...MG_BUTTONS, 'OI+VOL', 'VOL'], titles: MG_TITLES },
      )
      x['gex-levels'] = harvest(
        LEVELS_TEXT.replace(
          '· recorded walls only · sweeps held to the minute · ± Move, ATM IV and Δ 1D off while rewound\n',
          '',
        ),
        { buttons: LEVELS_BUTTONS },
      )
      x['options-chain'] = harvest(
        CHAIN_TEXT.replace(
          '· recorded walls only · 2026-08-28 of 7 recorded · 412/840 cells this frame · GEX only\n',
          '',
        ),
        { buttons: CHAIN_BUTTONS, titles: CHAIN_TITLES },
      )
      return x
    }),
  )
  for (const id of ['D/caveat', 'D/caveatOff', 'C/caveat', 'C/caveatOff', 'E/coverage']) {
    check(`FAILS on the dropped caveat: ${id}`, ids.has(id))
  }
}

// ── 5. landing on the FIRST frame instead of the last ──
// This is the quiet one. Every number on the page depends on which frame is
// selected, so a v3 that lands on frame 1 while v2 lands on frame 390 does not
// FAIL any value probe — it just reports forty unrelated differences and lets a
// reader conclude the port is fine. The landing probe is what names the cause.
{
  const rewound = v3((x) => {
    for (const k of ['chain-ladder', 'gex-levels', 'mult-greek', 'options-chain']) {
      x[k] = { ...x[k], ranges: [{ min: 0, max: 389, value: 0, disabled: false }] }
    }
    return x
  })
  const a = v2()
  const missing = []
  const diffIds = []
  for (const [key, probes] of Object.entries(PROBES)) {
    const r = compare(a[key], rewound[key], probes)
    missing.push(...r.missing)
    diffIds.push(...r.differ.map((d) => d.p.id))
  }
  check('no value probe fires (the numbers are identical)', missing.length === 0, missing.map((m) => m.p.id).join(', '))
  check(
    'but every tab reports the landing position as different',
    ['B/landsLast', 'C/landsLast', 'D/landsLast', 'E/landsLast'].every((id) => diffIds.includes(id)),
    diffIds.join(', '),
  )
}

// ── 6. the chain tab opening on all expiries instead of 0DTE ──
{
  const { ids } = run(
    v2(),
    v3((x) => {
      x['options-chain'] = harvest(CHAIN_TEXT.replace(/\b0DTE\b/g, 'All'), {
        buttons: CHAIN_BUTTONS.filter((b) => b !== '0DTE'),
        titles: CHAIN_TITLES,
      })
      return x
    }),
  )
  check('notices the 0DTE scope going away', ids.has('E/scope0dte'))
  check('and notices the tab no longer opening scoped to it', ids.has('E/opensAt0dte'))
}

// ── 7. the deliberate case change is NOT a loss ──
{
  const { ids } = run(v2(), v3())
  check(
    'v2 "OPTION CHAIN REPLAY" vs v3 "Option chain replay" is not reported as missing',
    !ids.has('B/title') && !ids.has('C/title'),
    [...ids].join(', '),
  )
}

console.log('')
if (failures) {
  console.log(`  ${failures} self-test failure(s) — parity-check-replay.mjs is not trustworthy as written\n`)
  process.exit(1)
}
console.log(`  ✓ self-test clean (${allProbes().length} probes across ${Object.keys(PROBES).length} surfaces)\n`)
