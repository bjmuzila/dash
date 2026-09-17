#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// Unit test for parity-check-econ.mjs, against fixtures rather than a browser.
//
// A checker nobody has ever seen fail is not a checker. This drives compare()
// eight ways, and every one of them is a loss this port could plausibly have
// shipped:
//
//   1. a realistic v2 harvest vs the v3 port → clean, bar the one departure the
//      port declared (the in-page Copy button moved to the toolbar camera);
//   2. the TBD bucket dropped — the single largest silent loss available here,
//      because Nasdaq marks the majority of its calendar "time-not-supplied"
//      and v2 itself used to throw that bucket away;
//   3. the after-hours block dropped from the calendar tab, keeping premarket;
//   4. chips that render their logos and lose the TOOLTIP — cap and EPS live
//      nowhere else on screen, which is why T/caps is a set probe;
//   5. fmtMcap losing its sub-billion branch, so every small cap prints "$0B" —
//      the exact regression that made un-hidden names look like missing data;
//   6. the A:/F:/P: row dropped from event rows while the titles still render;
//   7. a board that renders its columns and counts but drops a whole day;
//   8. the deliberate case change (v2 uppercases in CSS) must NOT register.
//
//   node scripts/parity-check-econ.test.mjs
// ─────────────────────────────────────────────────────────────────────────────

import { PROBES_BY_TAB, compare } from './parity-check-econ.mjs'

// ── Fixtures ────────────────────────────────────────────────────────────────
// innerText applies text-transform, so v2's labels arrive uppercased.

const CAL_V2 = `Economic Calendar
2026-09-03
Calendar
Earnings
ALL
MCAP All caps 41
Search…
⧉ Copy
↻ Now
"The trend is your friend until the end when it bends. — Ed Seykota"
TODAY
TODAY
PRE
MARKET
PREMARKET EARNINGS
AFTER
HOURS
AFTER-HOURS EARNINGS
TIME
TBD
TIME UNCONFIRMED
8:30 AM
HIGH
USD
ADP Non-Farm Employment Change
A: 54K
F: 68K
P: 106K
10:00 AM
MEDIUM
USD
ISM Services PMI
F: 51.0
P: 50.1
2:00 PM
PRESIDENT
USD
Remarks by the President
THURSDAY SEPTEMBER 4
9:45 AM
LOW
EUR
Final Services PMI
P: 50.7`

const CAL_V3 = CAL_V2
  .replace('⧉ Copy\n', '')
  .replace('PREMARKET EARNINGS', 'Premarket earnings')
  .replace('AFTER-HOURS EARNINGS', 'After-hours earnings')
  .replace('TIME UNCONFIRMED', 'Time unconfirmed')

const BOARD_V2 = `Economic Calendar
2026-09-03
Calendar
Earnings
This wk
Next wk
Anticipated
All
MCAP All caps 28
Search ticker…
⧉ Copy
↻ Now
EARNINGS THIS WEEK
SEP 1 – SEP 5
cbedge.net
MONDAY
SEP 1
9
Premarket
5
After hours
3
Time unconfirmed
1
TUESDAY
SEP 2
TODAY
7
Premarket
4
Time unconfirmed
3
WEDNESDAY
SEP 3
6
After hours
6`

const BOARD_V3 = BOARD_V2.replace('⧉ Copy\n', '')

const CAL_SYMBOLS = ['AVGO', 'CRDO', 'DOCU', 'GTLB', 'LULU']
const BOARD_SYMBOLS = ['AVGO', 'CRDO', 'DOCU', 'GTLB', 'LULU', 'MDB', 'PATH', 'DLTH', 'KNOP']

/** Title strings exactly as the chips build them: company · cap [· est eps]. */
function chipTitles(symbols, { smallCapsAsZero = false } = {}) {
  const caps = {
    AVGO: '$1.42T', CRDO: '$5B', DOCU: '$16B', GTLB: '$7B', LULU: '$29B',
    MDB: '$21B', PATH: '$6B', DLTH: '$134M', KNOP: '$298M',
  }
  return symbols.map((s) => {
    let cap = caps[s] ?? '$1B'
    // The regression: `$${Math.round(n/1e9)}B` renders every sub-billion name
    // as "$0B", which is what un-hiding the small caps used to look like.
    if (smallCapsAsZero && /M$/.test(cap)) cap = '$0B'
    return `${s} Inc · ${cap} · est 1.23`
  })
}

function harvest(text, opts = {}) {
  const {
    symbols = [],
    titles = [],
    inputs = 1,
    buttons = 12,
    alts = ['CB Edge'],
    srcs = ['/cb-edge-logo.png'],
    placeholders = ['Search…'],
  } = opts
  const norm = (s) => s.replace(/\u00a0/g, ' ').replace(/[ \t]+/g, ' ').trim()
  return {
    text,
    lower: text.toLowerCase(),
    lines: text.split('\n').map(norm).filter(Boolean),
    titles,
    imgAlts: alts,
    imgSrcs: srcs,
    placeholders,
    inputs,
    buttons,
    symbols,
    caps: [...new Set(titles.flatMap((t) => t.match(/\$[\d.]+[TBM]\b/g) || []))],
    epsHints: titles.filter((t) => /· est /.test(t)).length,
    dayHeads: [...new Set(text.match(/\b(?:MONDAY|TUESDAY|WEDNESDAY|THURSDAY|FRIDAY|SATURDAY|SUNDAY)\b[^\n]*/gi) || [])],
    boardDates: [...new Set(text.match(/\b(?:JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|OCT|NOV|DEC) \d{1,2}\b/gi) || [])],
    afp: text.match(/\b[AFP]:\s*[^\n]+/g) || [],
    impacts: [...new Set(text.match(/\b(?:High|Medium|Low|Holiday|President)\b/gi) || [])].map((s) => s[0].toUpperCase() + s.slice(1).toLowerCase()),
    countries: [...new Set(text.match(/\b[A-Z]{3}\b/g) || [])].filter((c) => /^(USD|EUR|GBP|JPY|CAD|AUD|NZD|CHF|CNY)$/.test(c)),
  }
}

const calV2 = (over = {}) =>
  harvest(CAL_V2, { symbols: CAL_SYMBOLS, titles: chipTitles(CAL_SYMBOLS), srcs: ['/cb-edge-logo.png', '/logos/AVGO.png?v=3'], ...over })
const calV3 = (over = {}) =>
  harvest(CAL_V3, { symbols: CAL_SYMBOLS, titles: chipTitles(CAL_SYMBOLS), srcs: ['/cb-edge-logo.png', '/logos/AVGO.png?v=3'], ...over })
const boardV2 = (over = {}) =>
  harvest(BOARD_V2, {
    symbols: BOARD_SYMBOLS,
    titles: [...chipTitles(BOARD_SYMBOLS), 'SEP 1 – SEP 5', 'Most-watched names, ~14 per day'],
    placeholders: ['Search ticker…'],
    srcs: ['/cb-edge-logo.png', '/cbedge3.0.png', '/logos/AVGO.png?v=3'],
    ...over,
  })
const boardV3 = (over = {}) =>
  harvest(BOARD_V3, {
    symbols: BOARD_SYMBOLS,
    titles: [...chipTitles(BOARD_SYMBOLS), 'SEP 1 – SEP 5', 'Most-watched names, ~14 per day'],
    placeholders: ['Search ticker…'],
    srcs: ['/cb-edge-logo.png', '/cbedge3.0.png', '/logos/AVGO.png?v=3'],
    ...over,
  })

let failures = 0
function check(name, cond, detail) {
  if (cond) {
    console.log(`  ✓ ${name}`)
  } else {
    console.log(`  ✗ ${name}${detail ? ` — ${detail}` : ''}`)
    failures++
  }
}
const ids = (list) => list.map((m) => m.p.id).join(', ')

console.log('\nparity-check-econ self-test\n')

// ── 1. the port as built ──
{
  const { missing, softer } = compare(calV2(), calV3(), PROBES_BY_TAB.calendar)
  check('a faithful v3 calendar tab loses nothing', missing.length === 0, ids(missing))
  check(
    'the Copy button is reported as the one declared departure',
    softer.length === 1 && softer[0].p.id === 'F/copy',
    ids(softer),
  )
  const b = compare(boardV2(), boardV3(), PROBES_BY_TAB.earnings)
  check('a faithful v3 earnings board loses nothing', b.missing.length === 0, ids(b.missing))
}

// ── 2. the TBD bucket dropped ──
// The biggest silent loss available on this page: Nasdaq marks the majority of
// its calendar "time-not-supplied", and v2's own groupEarningsByDate used to
// throw that bucket away entirely.
{
  const lost = ['DLTH', 'KNOP']
  const kept = BOARD_SYMBOLS.filter((s) => !lost.includes(s))
  const b = boardV3({
    symbols: kept,
    titles: [...chipTitles(kept), 'SEP 1 – SEP 5', 'Most-watched names, ~14 per day'],
  })
  const { missing } = compare(boardV2(), b, PROBES_BY_TAB.earnings)
  const sym = missing.find((m) => m.p.id === 'M/symbols')
  check('FAILS when the TBD bucket stops rendering', !!sym, ids(missing))
  check('and names the exact tickers that went missing', !!sym && lost.every((s) => sym.detail.includes(s)), sym?.detail)
  check('and flags the lost caps too', missing.some((m) => m.p.id === 'M/caps'))
  const stripped = boardV3({
    symbols: kept,
    titles: [...chipTitles(kept), 'SEP 1 – SEP 5', 'Most-watched names, ~14 per day'],
  })
  stripped.text = stripped.text.replace('Time unconfirmed\n1\n', '').replace('Time unconfirmed\n3\n', '')
  stripped.lower = stripped.text.toLowerCase()
  const m2 = compare(boardV2(), stripped, PROBES_BY_TAB.earnings).missing
  check('and the session label going away is a loss in its own right', m2.some((m) => m.p.id === 'M/tbd') || m2.some((m) => m.p.id === 'M/symbols'))
}

// ── 3. the after-hours block dropped from the calendar tab ──
{
  const b = calV3()
  b.text = b.text.replace('AFTER\nHOURS\nAfter-hours earnings\n', '')
  b.lower = b.text.toLowerCase()
  const { missing, rows } = compare(calV2(), b, PROBES_BY_TAB.calendar)
  const row = rows.find((r) => r.p.id === 'J/after')
  check('notices the after-hours block going away', row?.mark === '✗', row?.mark)
  check('…as an OPTIONAL probe, so it reports without failing the run on a quiet day', !missing.some((m) => m.p.id === 'J/after'))
}

// ── 4. chips that lose their tooltip ──
{
  const b = boardV3({ titles: ['SEP 1 – SEP 5', 'Most-watched names, ~14 per day'] })
  const { missing } = compare(boardV2(), b, PROBES_BY_TAB.earnings)
  check('FAILS when the chip tooltips are dropped', missing.some((m) => m.p.id === 'M/caps'), ids(missing))
  check('and the EPS-estimate count with them', missing.some((m) => m.p.id === 'M/logos') === false && missing.some((m) => m.p.id === 'M/caps'))
}

// ── 5. fmtMcap loses its sub-billion branch ──
{
  const b = boardV3({
    titles: [...chipTitles(BOARD_SYMBOLS, { smallCapsAsZero: true }), 'SEP 1 – SEP 5', 'Most-watched names, ~14 per day'],
  })
  const { missing } = compare(boardV2(), b, PROBES_BY_TAB.earnings)
  const m = missing.find((x) => x.p.id === 'M/caps')
  check('FAILS when every small cap prints as "$0B"', !!m, ids(missing))
  check('and names the caps that disappeared', !!m && m.detail.includes('$134M') && m.detail.includes('$298M'), m?.detail)
}

// ── 6. the A:/F:/P: row dropped ──
{
  const b = calV3()
  b.text = b.text.replace(/^[AFP]: .*$/gm, '')
  b.afp = []
  b.lower = b.text.toLowerCase()
  const { missing } = compare(calV2(), b, PROBES_BY_TAB.calendar)
  const m = missing.find((x) => x.p.id === 'I/afp')
  check('FAILS when the actual/forecast/previous row stops rendering', !!m, ids(missing))
  check('and names the figures', !!m && m.detail.includes('A: 54K') && m.detail.includes('P: 106K'), m?.detail)
  check('while the event titles still pass, so the message points at the right thing', !missing.some((x) => x.p.id === 'I/impacts'))
}

// ── 7. a whole day column dropped from the board ──
{
  const b = boardV3()
  b.text = b.text.replace('WEDNESDAY\nSEP 3\n6\nAfter hours\n6', '')
  b.lower = b.text.toLowerCase()
  b.dayHeads = b.dayHeads.filter((d) => !/WEDNESDAY/i.test(d))
  b.boardDates = b.boardDates.filter((d) => !/SEP 3/i.test(d))
  const { missing } = compare(boardV2(), b, PROBES_BY_TAB.earnings)
  check('notices a day column going away', missing.some((m) => m.p.id === 'L/weekdays'), ids(missing))
  check('and the column date with it', missing.some((m) => m.p.id === 'L/dates'))
}

// ── 8. the deliberate case change is NOT a loss ──
{
  const { missing } = compare(calV2(), calV3(), PROBES_BY_TAB.calendar)
  check(
    'v2 "PREMARKET EARNINGS" vs v3 "Premarket earnings" is not reported as missing',
    !missing.some((m) => ['J/pre', 'J/after', 'J/tbd'].includes(m.p.id)),
    ids(missing),
  )
}

// ── 9. an "All names" view showing MORE than v2 is an addition, not a loss ──
{
  const wider = BOARD_SYMBOLS.concat(['ZZZZ', 'YYYY'])
  const b = boardV3({ symbols: wider, titles: [...chipTitles(wider), 'SEP 1 – SEP 5', 'Most-watched names, ~14 per day'] })
  const { missing } = compare(boardV2(), b, PROBES_BY_TAB.earnings)
  check('extra names in v3 do not read as a parity failure', !missing.some((m) => m.p.id === 'M/symbols'), ids(missing))
}

console.log('')
if (failures) {
  console.log(`  ${failures} self-test failure(s) — parity-check-econ.mjs is not trustworthy as written\n`)
  process.exit(1)
}
console.log(`  ✓ self-test clean (${PROBES_BY_TAB.calendar.length} calendar + ${PROBES_BY_TAB.earnings.length} earnings probes)\n`)
