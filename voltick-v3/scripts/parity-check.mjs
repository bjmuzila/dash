#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// parity-check.mjs — did the v3 port lose anything?
//
// Drives /app/traders-dashboard (v2) and /v3/traders-dashboard (v3) in one
// browser, against ONE backend, in the same minute — so both pages see the same
// quotes, the same overview and the same sector sweep — then harvests the
// LABELLED VALUES out of each and fails on anything v2 renders and v3 does not.
//
// Why text and not selectors: the port deliberately replaces every class name
// and most of the DOM shape. A structural diff would be all noise. What must
// survive a port is the VALUES and their labels, so the probes below key on
// the things a reader actually sees — the card headings, the futures tile
// symbols, the uppercase section runs, the wheel's own <text> nodes, the
// `{covered}/{universe} names` footer.
//
// The spec is docs/parity/traders-dashboard.md. A probe here is a row there;
// if you add a row, add a probe.
//
//   node scripts/parity-check.mjs
//
// Env:
//   PARITY_ORIGIN   where both apps are served from. Default http://127.0.0.1:3000
//   PARITY_COOKIE   the session Cookie header. BOTH pages need a signed-in
//                   session — /v3 is owner-gated by middleware.ts and the prefs
//                   route 401s without one. Copy it out of devtools.
//   PARITY_SETTLE   ms to wait after load for the slow feeds. Default 9000.
//
// Exit codes: 0 pass · 1 parity failure · 2 could not run (no playwright, no
// session, a page did not load). A run that could not look is never a pass.
// ─────────────────────────────────────────────────────────────────────────────

import { createRequire } from 'node:module'
import { argv } from 'node:process'
import { pathToFileURL } from 'node:url'

const ORIGIN = (process.env.PARITY_ORIGIN || 'http://127.0.0.1:3000').replace(/\/$/, '')
const COOKIE = process.env.PARITY_COOKIE || ''
const SETTLE = Number(process.env.PARITY_SETTLE || 9000)

const V2 = `${ORIGIN}/app/traders-dashboard`
const V3 = `${ORIGIN}/v3/traders-dashboard`

// ── Harvest ──────────────────────────────────────────────────────────────────
// Runs INSIDE the page. Deliberately dumb: it returns raw material, and every
// judgement is made in node below, so both sides are read by exactly the same
// code.

export function harvestInPage() {
  const norm = (s) => (s || '').replace(/ /g, ' ').replace(/[ \t]+/g, ' ').trim()
  return {
    text: norm(document.body.innerText).replace(/\n{2,}/g, '\n'),
    lines: (document.body.innerText || '')
      .split('\n')
      .map((l) => norm(l))
      .filter(Boolean),
    svgText: [...document.querySelectorAll('svg text')].map((t) => norm(t.textContent)).filter(Boolean),
    svgPaths: document.querySelectorAll('svg path').length,
    // Every tile/row that carries a signed percentage, with whatever label sits
    // beside it. Covers the futures tiles, the movers rows and the wheel's
    // Top/Bottom list without knowing any of their markup.
    pctCells: [...document.querySelectorAll('div,span,td,li,a')]
      .map((el) => norm(el.textContent))
      .filter((t) => t && t.length < 60 && /[+−-]\d+\.\d{1,2}%/.test(t)),
    inputs: document.querySelectorAll('input, select, button').length,
    checkboxes: document.querySelectorAll('input[type=checkbox]').length,
  }
}

// ── Probes ───────────────────────────────────────────────────────────────────
// Each one pulls a single value (or a count) out of a harvest. `soft: true`
// reports a difference without failing — for the four things the port
// deliberately changed.

const RX = {
  countdown: /(?:\d+d )?\d{2}:\d{2}:\d{2}/,
  target: /Target: [^\n]*?(?:AM|PM) EST/,
  progress: /Task Progress\s*\n?\s*(\d{1,3})%/,
  coverage: /(\d+)\/(\d+) names/,
  asOf: /as of \d{1,2}:\d{2} ET/,
  generated: /Generated \d{1,2}:\d{2} (?:AM|PM) ET/,
  netPct: /^[+−]\d+\.\d{2}%$/,
  breadth: /^\d+ up · \d+ down$/,
}

const first = (h, rx) => {
  const m = h.text.match(rx)
  return m ? m[0] : null
}
const has = (h, s) => (h.text.includes(s) ? s : null)
const svgHas = (h, rx) => h.svgText.find((t) => rx.test(t)) ?? null

/** Body text between two headings — how a per-section count is taken. */
function section(h, from, to) {
  const i = h.text.indexOf(from)
  if (i < 0) return ''
  const j = to ? h.text.indexOf(to, i + from.length) : -1
  return h.text.slice(i + from.length, j < 0 ? h.text.length : j)
}
const countPct = (s) => (s.match(/[+−-]\d+\.\d{1,2}%/g) || []).length

export const PROBES = [
  // ── Part A — header ──
  { id: 'A/title', label: 'Page title', get: (h) => has(h, 'Traders Dashboard') },
  {
    id: 'A/date',
    label: 'Date line',
    get: (h) => first(h, /\b(?:Mon|Tues|Wednes|Thurs|Fri|Satur|Sun)day, [A-Z][a-z]+ \d{1,2}, \d{4}/),
  },
  { id: 'A/premarket', label: 'Premarket Prep button', get: (h) => has(h, 'Premarket Prep') },
  { id: 'A/econcal', label: 'Economic Calendar button', get: (h) => has(h, 'Economic Calendar') },
  {
    id: 'A/snapshot',
    label: 'Snapshot button',
    soft: 'not ported — v3 ships no DOM-to-canvas renderer',
    get: (h) => (h.text.includes('Snapshot') ? 'Snapshot' : null),
  },
  { id: 'A/zip', label: 'ZIP entry or weather readout', get: (h) => (/ZIP|°F/.test(h.text) ? 'present' : null) },

  // ── Part B — countdown ──
  {
    id: 'B/heading',
    label: 'Countdown heading',
    get: (h) => first(h, /Countdown to Market (?:Open|Close)/),
  },
  { id: 'B/value', label: 'Countdown value', get: (h) => first(h, RX.countdown) },
  { id: 'B/target', label: 'Countdown target label', get: (h) => first(h, RX.target) },

  // ── Part C — overnight overview ──
  { id: 'C/heading', label: 'Overnight Market Overview', get: (h) => has(h, 'Overnight Market Overview') },
  { id: 'C/generated', label: 'Generated … ET chip', get: (h) => first(h, RX.generated), optional: true },
  {
    id: 'C/sentiment',
    label: 'Sentiment line (or its placeholder)',
    get: (h) => (/Sentiment:|generated automatically at 7:00 AM ET/.test(h.text) ? 'present' : null),
  },
  { id: 'C/futuresLabel', label: 'Overnight Futures label', get: (h) => first(h, /Overnight Futures[^\n]*/) },
  { id: 'C/ES', label: 'ES tile', get: (h) => (/(^|\n)ES(\n|$)/.test(h.text) ? 'ES' : null) },
  { id: 'C/NQ', label: 'NQ tile', get: (h) => (/(^|\n)NQ(\n|$)/.test(h.text) ? 'NQ' : null) },
  { id: 'C/YM', label: 'YM tile', get: (h) => (/(^|\n)YM(\n|$)/.test(h.text) ? 'YM' : null) },
  { id: 'C/trendingLabel', label: 'Trending Now label', get: (h) => has(h, 'Trending Now') },
  {
    id: 'C/trendingRows',
    label: 'Trending Now — rows carrying a %',
    count: true,
    get: (h) => countPct(section(h, 'Trending Now', 'Key Drivers')),
  },
  {
    id: 'C/trendingOrder',
    label: 'Trending Now — sorted high→low',
    soft: 'v3 re-sorts one ranking; v2 prints top-5 then bottom-5',
    get: (h) => {
      const nums = (section(h, 'Trending Now', 'Key Drivers').match(/[+−-]\d+\.\d{1,2}%/g) || []).map((s) =>
        Number(s.replace('−', '-').replace('%', '')),
      )
      if (nums.length < 2) return null
      return nums.every((n, i) => i === 0 || nums[i - 1] >= n) ? 'descending' : 'not sorted'
    },
  },
  { id: 'C/driversLabel', label: 'Key Drivers Today label', get: (h) => has(h, 'Key Drivers Today') },
  {
    id: 'C/driversBody',
    label: 'Key Drivers — content or empty line',
    get: (h) => {
      const s = section(h, 'Key Drivers Today', 'Morning Schedule').trim()
      return s ? (s.length > 40 ? `${s.slice(0, 40)}…` : s) : null
    },
  },

  // ── Part D — schedule ──
  { id: 'D/heading', label: 'Morning Schedule', get: (h) => has(h, 'Morning Schedule') },
  { id: 'D/hint', label: 'Schedule hint line', get: (h) => has(h, 'swap in your own routine') },
  {
    id: 'D/rows',
    label: 'Schedule rows (times)',
    count: true,
    get: (h) => (section(h, 'Morning Schedule', 'Pre-Market Tasks').match(/\d{1,2}:\d{2} ?(?:AM|PM)/g) || []).length,
  },

  // ── Part E — tasks ──
  { id: 'E/heading', label: 'Pre-Market Tasks', get: (h) => has(h, 'Pre-Market Tasks') },
  { id: 'E/hint', label: 'Tasks hint line', get: (h) => has(h, 'to make them your own') },
  { id: 'E/checkboxes', label: 'Task checkboxes', count: true, get: (h) => h.checkboxes },
  { id: 'E/progress', label: 'Task Progress %', get: (h) => first(h, RX.progress) },

  // ── Part F — sector wheel ──
  { id: 'F/heading', label: 'S&P Sector Wheel', get: (h) => (/S&P Sector Wheel/.test(h.text) ? 'present' : null) },
  {
    id: 'F/howto',
    label: 'How-to-read line',
    get: (h) => (/Bar length = size of move|click the middle to go back/.test(h.text) ? 'present' : null),
  },
  { id: 'F/caps', label: 'Scale toggles 2/3/5%', get: (h) => (/2%[\s\S]{0,40}3%[\s\S]{0,40}5%/.test(h.text) ? 'present' : null) },
  { id: 'F/expand', label: 'Expand control', get: (h) => (/Expand/.test(h.text) ? 'present' : null) },
  { id: 'F/arcs', label: 'Wheel arcs drawn', count: true, get: (h) => h.svgPaths },
  { id: 'F/hubScope', label: 'Hub scope label', get: (h) => h.svgText.find((t) => t === 'S&P 500') ?? null },
  { id: 'F/hubNet', label: 'Hub net %', get: (h) => svgHas(h, RX.netPct) },
  { id: 'F/hubBreadth', label: 'Hub breadth "N up · M down"', get: (h) => svgHas(h, RX.breadth) },
  {
    id: 'F/callouts',
    label: 'Rim callouts (TICKER ±n.n%)',
    count: true,
    get: (h) => h.svgText.filter((t) => /^[A-Z.]{1,6} [+−]\d+\.\d%$/.test(t)).length,
  },
  { id: 'F/top', label: 'Top movers heading', get: (h) => (/\bTop\b/.test(h.text) ? 'Top' : null) },
  { id: 'F/bottom', label: 'Bottom movers heading', get: (h) => (/\bBottom\b/.test(h.text) ? 'Bottom' : null) },
  { id: 'F/coverage', label: 'Coverage footer {covered}/{universe} names', get: (h) => first(h, RX.coverage) },
  { id: 'F/asOf', label: 'Wheel "as of … ET"', get: (h) => first(h, RX.asOf) },

  // ── Part G — quick links ──
  { id: 'G/heading', label: 'Quick Links', get: (h) => has(h, 'Quick Links') },
  {
    id: 'G/tiles',
    label: 'Quick Links tiles',
    count: true,
    get: (h) => (section(h, 'Quick Links', null).match(/→/g) || []).length,
  },
]

// ── Run ──────────────────────────────────────────────────────────────────────

async function grab(context, url, name) {
  const page = await context.newPage()
  const errors = []
  page.on('pageerror', (e) => errors.push(String(e)))
  const res = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45_000 }).catch(() => null)
  if (!res) {
    console.error(`  ! ${name}: ${url} did not load`)
    return null
  }
  if (res.status() >= 400) {
    console.error(`  ! ${name}: ${url} returned HTTP ${res.status()}`)
    return null
  }
  // The slow half of this page is the sector sweep and the movers poll; both
  // are plain fetches with no loading flag reachable from outside, so this
  // waits rather than races them.
  await page.waitForTimeout(SETTLE)
  const h = await page.evaluate(harvestInPage)
  if (/sign in|log in/i.test(h.text) && h.text.length < 900) {
    console.error(`  ! ${name}: ${url} looks like a sign-in page — set PARITY_COOKIE`)
    await page.close()
    return null
  }
  if (errors.length) console.error(`  ! ${name}: ${errors.length} page error(s), first: ${errors[0]}`)
  await page.close()
  return h
}

function pad(s, n) {
  const t = String(s ?? '—')
  return t.length > n ? `${t.slice(0, n - 1)}…` : t.padEnd(n)
}

/**
 * The whole judgement, over two harvests. Split out from the browser driving so
 * scripts/parity-check.test.mjs can exercise every probe against fixtures — a
 * checker nobody has ever seen fail is not a checker.
 */
export function compare(a, b) {
  const missing = []
  const softer = []
  const differ = []
  const rows = []

  for (const p of PROBES) {
    const va = p.get(a)
    const vb = p.get(b)
    const gone = p.count ? Number(va) > 0 && !(Number(vb) > 0) : va != null && vb == null
    const changed = !gone && String(va) !== String(vb)

    let mark = '✓'
    if (gone && p.soft) {
      mark = '~'
      softer.push({ p, va, vb })
    } else if (gone) {
      mark = '✗'
      if (!p.optional) missing.push({ p, va, vb })
    } else if (changed) {
      mark = '·'
      differ.push({ p, va, vb })
    }
    rows.push({ mark, p, va, vb })
  }
  return { rows, missing, softer, differ }
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
  const context = await browser.newContext({ viewport: { width: 1600, height: 1200 } })
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
    console.error('  ! PARITY_COOKIE is not set \u2014 both pages need a signed-in session')
  }

  console.log(`\nparity-check \u2014 ${V2}  vs  ${V3}\n`)

  const a = await grab(context, V2, 'v2')
  const b = await grab(context, V3, 'v3')
  await browser.close()

  if (!a || !b) {
    console.error('\n  Could not read both pages. Nothing was compared \u2014 this is NOT a pass.\n')
    process.exit(2)
  }

  const { rows, missing, softer, differ } = compare(a, b)

  console.log(`  ${pad('probe', 34)}${pad('v2', 30)}${pad('v3', 30)}`)
  console.log(`  ${'\u2500'.repeat(92)}`)
  for (const r of rows) console.log(`${r.mark} ${pad(r.p.id, 34)}${pad(r.va, 30)}${pad(r.vb, 30)}`)
  console.log('')

  if (differ.length) {
    console.log('  \u00b7 present on both sides but not identical (usually just a live tick):')
    for (const d of differ) console.log(`      ${d.p.id} \u2014 ${d.p.label}\n        v2 ${d.va}\n        v3 ${d.vb}`)
    console.log('')
  }

  if (softer.length) {
    console.log('  ~ known, deliberate departures (recorded in docs/parity/traders-dashboard.md):')
    for (const s of softer) console.log(`      ${s.p.id} \u2014 ${s.p.label}: ${s.p.soft}`)
    console.log('')
  }

  if (missing.length) {
    console.log(`  \u2717 ${missing.length} value(s) present in v2 and MISSING from v3:\n`)
    for (const m of missing) console.log(`      ${m.p.id} \u2014 ${m.p.label}\n        v2 has: ${m.va}`)
    console.log('\n  Each of these is a row in docs/parity/traders-dashboard.md that has not landed.\n')
    process.exit(1)
  }

  console.log(`  \u2713 all ${PROBES.length} probes accounted for\n`)
}

// Importable for the unit test; only the direct run drives a browser.
if (argv[1] && import.meta.url === pathToFileURL(argv[1]).href) {
  await main()
}
