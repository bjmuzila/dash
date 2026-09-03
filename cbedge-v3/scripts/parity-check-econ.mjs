#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// parity-check-econ.mjs — did the /economic-calendar port lose anything?
//
// Drives /app/economic-calendar (v2) and /v3/economic-calendar (v3) in ONE
// browser, against ONE backend, in the same minute — so both pages read the
// same ForexFactory window, the same presidential feed and the same
// earnings_calendar rows — then harvests the LABELLED VALUES out of each and
// fails on anything v2 renders and v3 does not.
//
// Why text and not selectors: the port replaces every class name and most of
// the DOM shape on purpose. A structural diff would be all noise. What must
// survive a port is the VALUES and their labels.
//
// ── THREE SCENARIOS, not one ─────────────────────────────────────────────────
// This page is two tabs over one feed, and the earnings tab has two more
// toggles on top of that. A single harvest would leave three quarters of the
// page unexercised, so each side is driven through:
//
//   calendar        the default tab — events, day separators, A/F/P, the woven
//                   earnings blocks
//   earnings-this   the week board, this week, Anticipated
//   earnings-next   the week board, next week, All names
//
// The driver CLICKS the tab rather than deep-linking it, because v2 has no
// ?tab= at all (that is one of the four defects the port fixed — see Part Q of
// docs/parity/economic-calendar.md). Clicking is the one path both sides share.
//
// ── Two things this checker does that the others do not ──────────────────────
//
//   1. A SET PROBE OVER THE TICKER SYMBOLS. Every earnings chip on either tab
//      is an <a> to finance.yahoo.com/quote/<SYM>. Rather than trying to pair
//      each chip with its column across two different DOMs, `T/symbols` asserts
//      that every symbol v2 linked also appears in v3's links. A board that
//      renders its columns and its counts but drops a session bucket fails
//      this, which is exactly the failure a label-only probe sails past.
//
//   2. A SET PROBE OVER THE HOVER TEXT. Cap and EPS estimate are not on screen
//      anywhere — they live in each chip's `title`. `T/caps` asserts every
//      market-cap string v2 put in a tooltip is in v3's, so dropping the
//      tooltip (or dropping fmtMcap's sub-billion branch, which is what used to
//      render every small cap as "$0B") fails rather than passing silently.
//
// Case-insensitive matching throughout: v2 uppercases several labels in CSS and
// `innerText` returns text as RENDERED, so v2 says "EARNINGS" where v3 may say
// "Earnings". That is a declared change of render layer, not a lost value.
//
// The spec is docs/parity/economic-calendar.md. A probe here is a row there; if
// you add a row, add a probe.
//
//   node scripts/parity-check-econ.mjs
//
// Env:
//   PARITY_ORIGIN   where both apps are served from. Default http://127.0.0.1:3000
//   PARITY_COOKIE   the session Cookie header. Both pages need a signed-in
//                   session — /api/calendar and /proxy/earnings-week are
//                   subscriber-gated. Copy it out of devtools.
//   PARITY_SETTLE   ms to wait after load for the three feeds. Default 9000.
//
// ⚠ RUN THIS ONCE AS THE OWNER *AND* ONCE AS A PLAIN SUBSCRIBER.
//    The feed-health banner and the raw error banner are owner-only on BOTH
//    pages, so an owner run is the only one that exercises them — and a
//    subscriber run is the only one that proves they stayed hidden.
//
// ⚠ A WEEKEND RUN PROVES LESS THAN IT LOOKS. etMonFri rolls weekends forward,
//    so "this week" on a Saturday is the week that has not started; if the
//    recorder has not swept it, BOTH sides render the empty-state ladder and
//    every board probe passes vacuously. The run says so when it happens.
//
// Exit codes: 0 pass · 1 parity failure · 2 could not run (no playwright, no
// session, a page did not load). A run that could not look is never a pass.
// ─────────────────────────────────────────────────────────────────────────────

import { createRequire } from 'node:module'
import { argv } from 'node:process'
import { pathToFileURL } from 'node:url'

const ORIGIN = (process.env.PARITY_ORIGIN || 'http://127.0.0.1:3000').replace(/\/$/, '')
const COOKIE = process.env.PARITY_COOKIE || ''
const SETTLE = Number(process.env.PARITY_SETTLE || 9_000)

const V2 = `${ORIGIN}/app/economic-calendar`
const V3 = `${ORIGIN}/v3/economic-calendar`

/** The three states each side is driven through. See the header. */
export const SCENARIOS = [
  { id: 'calendar', label: 'Calendar tab', tab: 'calendar' },
  { id: 'earnings-this', label: 'Earnings — this week, Anticipated', tab: 'earnings', week: 0, view: 'anticipated' },
  { id: 'earnings-next', label: 'Earnings — next week, All names', tab: 'earnings', week: 1, view: 'all' },
]

// ── Harvest ──────────────────────────────────────────────────────────────────
// Runs INSIDE the page. Deliberately dumb: it returns raw material and every
// judgement is made in node below, so both sides are read by the same code.

export function harvestInPage() {
  const norm = (s) => (s || '').replace(/\u00a0/g, ' ').replace(/[ \t]+/g, ' ').trim()
  const text = norm(document.body.innerText).replace(/\n{2,}/g, '\n')
  const titles = [...document.querySelectorAll('[title]')]
    .map((el) => norm(el.getAttribute('title')))
    .filter(Boolean)
  return {
    text,
    lower: text.toLowerCase(),
    lines: (document.body.innerText || '').split('\n').map(norm).filter(Boolean),
    titles,
    imgAlts: [...document.querySelectorAll('img')].map((i) => norm(i.getAttribute('alt'))).filter(Boolean),
    imgSrcs: [...document.querySelectorAll('img')].map((i) => i.getAttribute('src') || ''),
    placeholders: [...document.querySelectorAll('input')].map((i) => norm(i.getAttribute('placeholder'))).filter(Boolean),
    inputs: document.querySelectorAll('input').length,
    buttons: document.querySelectorAll('button').length,
    // EVERY earnings chip, on either tab, is a link to this host. Uppercased so
    // an encoding difference in the href cannot read as a lost name.
    symbols: [...new Set(
      [...document.querySelectorAll('a[href*="finance.yahoo.com/quote/"]')]
        .map((a) => decodeURIComponent((a.getAttribute('href') || '').split('/quote/')[1] || ''))
        .filter(Boolean)
        .map((s) => s.toUpperCase()),
    )],
    // Cap / EPS live ONLY in the hover text.
    caps: [...new Set(titles.flatMap((t) => t.match(/\$[\d.]+[TBM]\b/g) || []))],
    epsHints: titles.filter((t) => /· est /.test(t)).length,
    // Day separators on the calendar tab: "MONDAY SEPTEMBER 1" / "TODAY".
    dayHeads: [...new Set(text.match(/\b(?:MONDAY|TUESDAY|WEDNESDAY|THURSDAY|FRIDAY|SATURDAY|SUNDAY)\b[^\n]*/gi) || [])],
    // Board column dates: "SEP 1".
    boardDates: [...new Set(text.match(/\b(?:JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|OCT|NOV|DEC) \d{1,2}\b/gi) || [])],
    // Every A: / F: / P: figure printed on the calendar tab.
    afp: text.match(/\b[AFP]:\s*[^\n]+/g) || [],
    // Impact tags actually rendered.
    impacts: [...new Set(text.match(/\b(?:High|Medium|Low|Holiday|President)\b/g) || [])],
    // Country codes in the event rows.
    countries: [...new Set(text.match(/\b[A-Z]{3}\b/g) || [])].filter((c) => /^(USD|EUR|GBP|JPY|CAD|AUD|NZD|CHF|CNY)$/.test(c)),
  }
}

// ── Probes ───────────────────────────────────────────────────────────────────
// Each pulls a single value (or a count, or a set) out of a harvest. `soft`
// reports a difference without failing — for the things the port deliberately
// changed. `optional` reports without failing when the value legitimately may
// not exist in this run.

const has = (h, s) => (h.lower.includes(s.toLowerCase()) ? s : null)
const rx = (h, re) => {
  const m = h.text.match(re)
  return m ? m[0] : null
}
const line = (h, s) => (h.lines.some((l) => l.toLowerCase() === s.toLowerCase()) ? s : null)
const anyTitle = (h, re) => h.titles.find((t) => re.test(t)) ?? null

/** Probes that apply to BOTH tabs — the frame, the toolbar, the identity. */
export const FRAME_PROBES = [
  // ── Part A ──
  { id: 'A/title', label: 'Page title', get: (h) => has(h, 'Economic Calendar') },
  { id: 'A/logo', label: 'CB Edge logo', get: (h) => (h.imgAlts.some((a) => /cb edge/i.test(a)) ? 'CB Edge' : null) },
  { id: 'A/date', label: 'ET date chip', get: (h) => rx(h, /\b20\d\d-\d\d-\d\d\b/) },

  // ── Part B ──
  { id: 'B/tabCalendar', label: '"Calendar" tab', get: (h) => has(h, 'Calendar') },
  { id: 'B/tabEarnings', label: '"Earnings" tab', get: (h) => has(h, 'Earnings') },

  // ── Part E ──
  { id: 'E/mcapTag', label: 'MCAP button tag', get: (h) => has(h, 'MCAP') },
  { id: 'E/mcapLabel', label: 'Current cap floor label', get: (h) => rx(h, /All caps|≥ \$\d+[BT]/) },

  // ── Part F ──
  { id: 'F/search', label: 'Search input', count: true, get: (h) => h.inputs },
  { id: 'F/placeholder', label: 'Search placeholder wording', get: (h) => (h.placeholders.find((p) => /^search/i.test(p)) ?? null) },
  { id: 'F/refresh', label: '"↻ Now" refresh control', get: (h) => rx(h, /↻\s*Now/i) },
  {
    id: 'F/copy',
    label: '"⧉ Copy" screenshot button',
    soft:
      'MOVED, not missing — v3 DOES capture both targets (the board alone on the ' +
      'earnings tab, the page on the calendar tab), but the camera is the single ' +
      'one in the toolbar and this page publishes itself to that menu. No button ' +
      'in the page toolbar, so this probe is null by design. Spec Part P.',
    get: (h) => rx(h, /⧉\s*Copy|✓ Copied|✓ Saved/i),
  },
]

/** Calendar tab only. */
export const CALENDAR_PROBES = [
  // ── Part C ──
  { id: 'C/filterLabel', label: 'Impact filter trigger label', get: (h) => line(h, 'ALL') ?? rx(h, /\bALL\b/) },

  // ── Part G ──
  {
    id: 'G/quote',
    label: 'Quote of the day',
    optional: true,
    get: (h) => rx(h, /[“"][^\n]{20,}[”"]/),
  },

  // ── Part H ──
  { id: 'H/dayHeads', label: 'Every day separator v2 printed', set: true, get: (h) => h.dayHeads },
  { id: 'H/today', label: 'TODAY pill', optional: true, get: (h) => line(h, 'TODAY') },

  // ── Part I ──
  { id: 'I/impacts', label: 'Every impact tag v2 printed', set: true, get: (h) => h.impacts },
  { id: 'I/countries', label: 'Every country code v2 printed', set: true, get: (h) => h.countries },
  { id: 'I/afp', label: 'Every A: / F: / P: figure v2 printed', set: true, get: (h) => h.afp },
  { id: 'I/times', label: 'Event times printed', count: true, get: (h) => (h.text.match(/\b\d{1,2}:\d{2}\s*[AP]M\b/g) || []).length },

  // ── Part J — the woven earnings blocks ──
  { id: 'J/pre', label: 'PRE / MARKET block', optional: true, get: (h) => has(h, 'Premarket earnings') },
  { id: 'J/after', label: 'AFTER / HOURS block', optional: true, get: (h) => has(h, 'After-hours earnings') },
  { id: 'J/tbd', label: 'TIME / TBD block', optional: true, get: (h) => has(h, 'Time unconfirmed') },
  { id: 'J/symbols', label: 'Every woven ticker v2 linked', set: true, get: (h) => h.symbols },
  { id: 'J/caps', label: 'Every market cap v2 put in a tooltip', set: true, get: (h) => h.caps },
  { id: 'J/eps', label: 'EPS-estimate tooltips', count: true, get: (h) => h.epsHints },
]

/** Earnings tab only. */
export const EARNINGS_PROBES = [
  // ── Part D ──
  { id: 'D/weekThis', label: '"This wk" toggle', get: (h) => has(h, 'This wk') },
  { id: 'D/weekNext', label: '"Next wk" toggle', get: (h) => has(h, 'Next wk') },
  { id: 'D/weekTip', label: 'Week toggle tooltip carries the date range', get: (h) => anyTitle(h, /^[A-Z]{3} \d{1,2} – [A-Z]{3} \d{1,2}$/i) },
  { id: 'D/viewAnticipated', label: '"Anticipated" view', get: (h) => has(h, 'Anticipated') },
  { id: 'D/viewAll', label: '"All" view', get: (h) => rx(h, /\bAll\b/) },
  { id: 'D/viewHint', label: 'View toggle tooltips', get: (h) => anyTitle(h, /Most-watched names|Every name on the Nasdaq calendar/i) },

  // ── Part K — board frame ──
  { id: 'K/boardTitle', label: 'EARNINGS THIS/NEXT WEEK header', get: (h) => rx(h, /EARNINGS (?:THIS|NEXT) WEEK/i) },
  { id: 'K/boardRange', label: 'Board week range', get: (h) => rx(h, /[A-Z]{3} \d{1,2} – [A-Z]{3} \d{1,2}/i) },
  { id: 'K/wordmark', label: '"cbedge.net" run', get: (h) => has(h, 'cbedge.net') },
  { id: 'K/signature', label: 'CB Edge signature banner', get: (h) => (h.imgSrcs.some((s) => /cbedge3\.0\.png/i.test(s)) ? 'cbedge3.0.png' : null) },

  // ── Part L — day columns ──
  { id: 'L/weekdays', label: 'Every weekday column head v2 printed', set: true, get: (h) => h.dayHeads },
  { id: 'L/dates', label: 'Every column date v2 printed', set: true, get: (h) => h.boardDates },
  { id: 'L/counts', label: 'Per-column name counts', count: true, get: (h) => (h.text.match(/^\d+$/gm) || []).length },

  // ── Part M — sessions and chips ──
  { id: 'M/pre', label: '"Premarket" session label', optional: true, get: (h) => has(h, 'Premarket') },
  { id: 'M/after', label: '"After hours" session label', optional: true, get: (h) => has(h, 'After hours') },
  { id: 'M/tbd', label: '"Time unconfirmed" session label', optional: true, get: (h) => has(h, 'Time unconfirmed') },
  { id: 'M/symbols', label: 'Every ticker on the board v2 linked', set: true, get: (h) => h.symbols },
  { id: 'M/caps', label: 'Every market cap v2 put in a tooltip', set: true, get: (h) => h.caps },
  { id: 'M/logos', label: 'Ticker logo chips', count: true, get: (h) => h.imgSrcs.filter((s) => /\/logos\/|ticker-logo/.test(s)).length },

  // ── Part N — the empty-state ladder. Only one can be true in a run, and all
  //    four are optional for that reason: a board with names renders none. ──
  { id: 'N/reason', label: 'Named empty-state reason', optional: true, get: (h) => rx(h, /No earnings loaded\.|Nothing stored for [^\n]+ yet\.|No earnings [^\n]+ try a lower cap\.|No earnings match\./i) },
]

export const PROBES_BY_TAB = {
  calendar: [...FRAME_PROBES, ...CALENDAR_PROBES],
  earnings: [...FRAME_PROBES, ...EARNINGS_PROBES],
}

// ── Judgement ────────────────────────────────────────────────────────────────

/**
 * The whole judgement, over two harvests. Split out from the browser driving so
 * parity-check-econ.test.mjs can exercise every probe against fixtures — a
 * checker nobody has ever seen fail is not a checker.
 */
export function compare(a, b, probes) {
  const missing = []
  const softer = []
  const differ = []
  const rows = []

  for (const p of probes) {
    const va = p.get(a)
    const vb = p.get(b)

    let gone
    let detail = null
    if (p.set) {
      // Every value v2 printed must appear in v3's. Extra values in v3 are an
      // addition, not a loss — "All names" legitimately shows more than
      // "Anticipated" did.
      const seen = new Set(vb || [])
      const lost = [...new Set(va || [])].filter((v) => !seen.has(v))
      gone = lost.length > 0
      if (gone) detail = lost.join(', ')
    } else if (p.count) {
      gone = Number(va) > 0 && !(Number(vb) > 0)
    } else {
      gone = va != null && vb == null
    }
    const changed = !gone && !p.set && String(va) !== String(vb)

    let mark = '✓'
    if (gone && p.soft) {
      mark = '~'
      softer.push({ p, va, vb })
    } else if (gone) {
      mark = '✗'
      if (!p.optional) missing.push({ p, va, vb, detail })
    } else if (changed) {
      mark = '·'
      differ.push({ p, va, vb })
    }
    rows.push({ mark, p, va, vb })
  }
  return { rows, missing, softer, differ }
}

// ── Run ──────────────────────────────────────────────────────────────────────

/**
 * Put a page into a scenario by CLICKING, because v2 has no ?tab=. Matched on
 * the button's own text so one driver works on both sides.
 */
async function drive(page, scenario) {
  const clickText = async (labels) => {
    for (const label of labels) {
      const hit = await page
        .locator('button', { hasText: new RegExp(`^\\s*${label}\\s*$`, 'i') })
        .first()
      if (await hit.count().catch(() => 0)) {
        await hit.click({ timeout: 4_000 }).catch(() => {})
        await page.waitForTimeout(400)
        return true
      }
    }
    return false
  }
  if (scenario.tab === 'earnings') {
    if (!(await clickText(['Earnings']))) return false
    if (scenario.week === 1 && !(await clickText(['Next wk']))) return false
    if (scenario.view === 'all' && !(await clickText(['All']))) return false
  }
  await page.waitForTimeout(600)
  return true
}

async function grab(context, url, name, scenario) {
  const page = await context.newPage()
  const errors = []
  page.on('pageerror', (e) => errors.push(String(e)))
  const res = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45_000 }).catch(() => null)
  if (!res) {
    console.error(`  ! ${name}/${scenario.id}: ${url} did not load`)
    await page.close()
    return null
  }
  if (res.status() >= 400) {
    console.error(`  ! ${name}/${scenario.id}: ${url} returned HTTP ${res.status()}`)
    await page.close()
    return null
  }
  // Three feeds fan out on mount and none has a loading flag reachable from
  // outside, so this waits rather than racing.
  await page.waitForTimeout(SETTLE)
  const drove = await drive(page, scenario)
  if (!drove) {
    console.error(`  ! ${name}/${scenario.id}: could not reach the scenario (a control did not appear)`)
    await page.close()
    return null
  }
  const h = await page.evaluate(harvestInPage)
  if (/sign in|log in/i.test(h.text) && h.text.length < 900) {
    console.error(`  ! ${name}/${scenario.id}: looks like a sign-in page — set PARITY_COOKIE`)
    await page.close()
    return null
  }
  if (errors.length) console.error(`  ! ${name}/${scenario.id}: ${errors.length} page error(s), first: ${errors[0]}`)
  await page.close()
  return h
}

function pad(s, n) {
  const t = Array.isArray(s) ? `${s.length} value(s)` : String(s ?? '—')
  return t.length > n ? `${t.slice(0, n - 1)}…` : t.padEnd(n)
}

async function main() {
  const require = createRequire(import.meta.url)
  let chromium
  try {
    ;({ chromium } = require('playwright'))
  } catch {
    console.error('playwright not found — `npm i -D playwright` to run this check')
    process.exit(2)
  }

  const browser = await chromium.launch()
  const context = await browser.newContext({ viewport: { width: 1800, height: 1300 } })
  if (COOKIE) {
    const { hostname, protocol } = new URL(ORIGIN)
    await context.addCookies(
      COOKIE.split(';')
        .map((c) => c.trim())
        .filter(Boolean)
        .map((c) => {
          const eq = c.indexOf('=')
          return {
            name: c.slice(0, eq),
            value: c.slice(eq + 1),
            domain: hostname,
            path: '/',
            secure: protocol === 'https:',
          }
        }),
    )
  } else {
    console.error('  ! PARITY_COOKIE is not set — both pages need a signed-in session')
  }

  console.log(`\nparity-check-econ — ${V2}  vs  ${V3}\n`)

  let failures = 0
  let vacuous = 0
  let probeCount = 0

  for (const scenario of SCENARIOS) {
    const a = await grab(context, V2, 'v2', scenario)
    const b = await grab(context, V3, 'v3', scenario)
    if (!a || !b) {
      console.error(`\n  Could not read both pages for "${scenario.label}". Nothing was compared — this is NOT a pass.\n`)
      await browser.close()
      process.exit(2)
    }

    const probes = PROBES_BY_TAB[scenario.tab]
    probeCount += probes.length
    const { rows, missing, softer, differ } = compare(a, b, probes)

    console.log(`\n── ${scenario.label} ─────────────────────────────────────────────`)
    console.log(`  ${pad('probe', 22)}${pad('v2', 34)}${pad('v3', 34)}`)
    console.log(`  ${'─'.repeat(90)}`)
    for (const r of rows) console.log(`${r.mark} ${pad(r.p.id, 22)}${pad(r.va, 34)}${pad(r.vb, 34)}`)
    console.log('')

    // A board with no names passes every board probe for the wrong reason. Say
    // so rather than banking it.
    if (scenario.tab === 'earnings' && a.symbols.length === 0) {
      vacuous++
      console.log(
        `  i  v2 rendered NO earnings names in "${scenario.label}". Either the recorder\n` +
          `     has not swept that week, or the session cannot read /proxy/earnings-week.\n` +
          `     Parts K, L, M and N were NOT exercised — do not read this as covering them.\n`,
      )
    }
    if (scenario.tab === 'calendar' && a.afp.length === 0) {
      vacuous++
      console.log(
        '  i  v2 printed no A:/F:/P: figures in this run — a quiet calendar day, or a\n' +
          '     feed serving from cache. Part I\'s value probes were not exercised.\n',
      )
    }

    if (differ.length) {
      console.log('  · present on both sides but not identical:')
      for (const d of differ) console.log(`      ${d.p.id} — ${d.p.label}\n        v2 ${d.va}\n        v3 ${d.vb}`)
      console.log('')
    }
    if (softer.length) {
      console.log('  ~ known, deliberate departures (recorded in docs/parity/economic-calendar.md):')
      for (const s of softer) console.log(`      ${s.p.id} — ${s.p.label}\n        ${s.p.soft}`)
      console.log('')
    }
    if (missing.length) {
      failures += missing.length
      console.log(`  ✗ ${missing.length} value(s) present in v2 and MISSING from v3:\n`)
      for (const m of missing) {
        console.log(`      ${m.p.id} — ${m.p.label}`)
        console.log(`        v2 has: ${m.detail ?? (Array.isArray(m.va) ? m.va.join(', ') : m.va)}`)
      }
      console.log('')
    }
  }

  await browser.close()

  if (failures) {
    console.log(`\n  ✗ ${failures} value(s) lost across ${SCENARIOS.length} scenarios.`)
    console.log('  Each is a row in docs/parity/economic-calendar.md that has not landed.\n')
    process.exit(1)
  }
  console.log(`\n  ✓ all ${probeCount} probes accounted for across ${SCENARIOS.length} scenarios`)
  if (vacuous) console.log(`  i ${vacuous} scenario(s) had nothing to compare — see the notes above.`)
  console.log('')
}

// Importable for the unit test; only the direct run drives a browser.
if (argv[1] && import.meta.url === pathToFileURL(argv[1]).href) {
  await main()
}
