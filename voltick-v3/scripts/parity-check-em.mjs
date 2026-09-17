#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// parity-check-em.mjs — did the /em port lose anything?
//
// Drives /app/em (v2) and /v3/em (v3) in one browser, against ONE backend, in
// the same minute — so both pages read the same published levels row, the same
// tracker table and the same history file — then harvests the LABELLED VALUES
// out of each and fails on anything v2 renders and v3 does not.
//
// Why text and not selectors: the port replaces every class name and most of
// the DOM shape on purpose. A structural diff would be all noise. What must
// survive a port is the VALUES and their labels, so the probes below key on
// what a reader actually sees.
//
// Two things this checker does that the others do not:
//
//   1. CASE-INSENSITIVE matching. v2 uppercases its card titles in CSS and
//      `innerText` returns text as RENDERED, so v2 says "ESTIMATED MOVE" where
//      v3 says "Estimated Move". That is a declared change of render layer, not
//      a lost value, and a case-sensitive probe would report ten false losses.
//
//   2. A SET probe over the level numbers. Every figure this page shows is a
//      comma-formatted string straight out of ticker_levels — close, em, up,
//      down and the four zone bounds. Rather than trying to pair each number
//      with its label across two different DOMs, `E/levelNumbers` asserts that
//      every number v2 printed also appears in v3. A tile that renders but
//      shows `--` fails it, which is exactly the failure a label-only probe
//      sails past.
//
// The spec is docs/parity/em.md. A probe here is a row there; if you add a row,
// add a probe.
//
//   node scripts/parity-check-em.mjs
//
// Env:
//   PARITY_ORIGIN   where both apps are served from. Default http://127.0.0.1:3000
//   PARITY_COOKIE   the session Cookie header. BOTH pages need a signed-in
//                   session — /v3 is owner-gated by middleware.ts. Copy it out
//                   of devtools.
//   PARITY_SETTLE   ms to wait after load for the enrichment wave. Default 8000.
//   PARITY_TICKER   which ticker to compare. Default SPX.
//
// ⚠ RUN THIS SIGNED IN AS THE OWNER *AND* ONCE AS A PLAIN SUBSCRIBER.
//    Until 2026-08-31 /api/em-tracker and /api/em-tracker/history were
//    owner-only, so the EM Hit Rate meter and the whole Recent Track Record
//    card were invisible to every customer — on BOTH pages, which means a
//    signed-in-as-owner run and a subscriber run would each have passed while
//    the customer saw neither block. The routes are subscriber-readable now;
//    the subscriber run is what proves it stayed that way.
//
// Exit codes: 0 pass · 1 parity failure · 2 could not run (no playwright, no
// session, a page did not load). A run that could not look is never a pass.
// ─────────────────────────────────────────────────────────────────────────────

import { createRequire } from 'node:module'
import { argv } from 'node:process'
import { pathToFileURL } from 'node:url'

const ORIGIN = (process.env.PARITY_ORIGIN || 'http://127.0.0.1:3000').replace(/\/$/, '')
const COOKIE = process.env.PARITY_COOKIE || ''
const SETTLE = Number(process.env.PARITY_SETTLE || 8_000)
const TICKER = (process.env.PARITY_TICKER || 'SPX').toUpperCase()

const V2 = `${ORIGIN}/app/em?ticker=${TICKER}`
const V3 = `${ORIGIN}/v3/em?ticker=${TICKER}`

// ── Harvest ──────────────────────────────────────────────────────────────────
// Runs INSIDE the page. Deliberately dumb: it returns raw material and every
// judgement is made in node below, so both sides are read by the same code.

export function harvestInPage() {
  const norm = (s) => (s || '').replace(/ /g, ' ').replace(/[ \t]+/g, ' ').trim()
  const text = norm(document.body.innerText).replace(/\n{2,}/g, '\n')
  return {
    text,
    lower: text.toLowerCase(),
    lines: (document.body.innerText || '').split('\n').map(norm).filter(Boolean),
    titles: [...document.querySelectorAll('[title]')]
      .map((el) => norm(el.getAttribute('title')))
      .filter(Boolean),
    imgAlts: [...document.querySelectorAll('img')].map((i) => norm(i.getAttribute('alt'))).filter(Boolean),
    placeholders: [...document.querySelectorAll('input')]
      .map((i) => norm(i.getAttribute('placeholder')))
      .filter(Boolean),
    inputs: document.querySelectorAll('input').length,
    buttons: document.querySelectorAll('button').length,
    // Every published level figure: a comma-grouped decimal, which is exactly
    // the shape ticker_levels stores and the page prints unmodified.
    levelNumbers: text.match(/\b\d{1,3}(?:,\d{3})*\.\d{2}\b/g) || [],
    percents: text.match(/\d+(?:\.\d+)?%/g) || [],
    // The snapshot control, by any of the three things that identify it.
    snapButtons: [...document.querySelectorAll('button')].filter(
      (b) =>
        /📸/.test(b.textContent || '') ||
        /screenshot|snapshot/i.test(b.getAttribute('title') || ''),
    ).length,
  }
}

// ── Probes ───────────────────────────────────────────────────────────────────
// Each pulls a single value (or a count, or a set) out of a harvest. `soft`
// reports a difference without failing — for the things the port deliberately
// changed. `optional` reports without failing when the value legitimately may
// not exist in this run.

/** Case-insensitive: see note 1 in the header. */
const has = (h, s) => (h.lower.includes(s.toLowerCase()) ? s : null)
const rx = (h, re) => {
  const m = h.text.match(re)
  return m ? m[0] : null
}
const line = (h, s) => (h.lines.some((l) => l.toLowerCase() === s.toLowerCase()) ? s : null)

const CHIPS = ['SPX', 'NDX', 'ESU', 'NQU', 'SPY', 'QQQ', 'AAPL', 'NVDA', 'TSLA', 'MSFT']

export const PROBES = [
  // ── Part A — frame and header ──
  { id: 'A/title', label: 'Page title', get: (h) => has(h, 'Weekly Estimated Move') },
  { id: 'A/zones', label: 'Title says "& Zones"', get: (h) => has(h, 'Zones') },
  {
    id: 'A/sub',
    label: 'Sub-line',
    get: (h) => rx(h, /Enter a ticker to see this week.s estimated move and the buy \/ sell zones\./i),
  },
  { id: 'A/logo', label: 'CB Edge logo', get: (h) => (h.imgAlts.some((a) => /cb edge/i.test(a)) ? 'CB Edge' : null) },

  // ── Part B — search card ──
  { id: 'B/input', label: 'Ticker input', count: true, get: (h) => h.inputs },
  {
    id: 'B/placeholder',
    label: 'Input placeholder wording',
    get: (h) => (h.placeholders.some((p) => /enter ticker/i.test(p)) ? 'Enter ticker…' : null),
  },
  { id: 'B/submit', label: 'Get Levels button', get: (h) => has(h, 'Get Levels') },
  ...CHIPS.map((c) => ({ id: `B/chip:${c}`, label: `${c} quick chip`, get: (h) => line(h, c) })),

  // ── Part D — result header ──
  { id: 'D/ticker', label: 'Result ticker heading', get: (h) => line(h, TICKER) },
  { id: 'D/week', label: '"Week of …" label', get: (h) => rx(h, /Week of \S+/i) },
  { id: 'D/updated', label: '"Updated …" stamp', get: (h) => rx(h, /Updated [A-Z][a-z]{2} \d{1,2}, \d{2}:\d{2} [AP]M/) },
  {
    id: 'D/snapshot',
    label: 'Snapshot (📸) button',
    count: true,
    soft: 'MOVED, not missing — v3 DOES capture this block (src/shell/snapshot.ts; no dependency, the browser renders it), but the camera is the single owner-gated one in the toolbar and the page publishes itself to that menu once a ticker is looked up. No button inside the result block, so this count is 0 by design. docs/parity/em.md Part D.',
    get: (h) => h.snapButtons,
  },

  // ── Part E — Estimated Move ──
  { id: 'E/heading', label: '"Estimated Move" card title', get: (h) => has(h, 'Estimated Move') },
  { id: 'E/close', label: 'Close tile label', get: (h) => has(h, 'Close') },
  { id: 'E/em', label: 'EM tile label', get: (h) => line(h, 'EM') },
  { id: 'E/up', label: 'Up tile label', get: (h) => line(h, 'Up') },
  { id: 'E/down', label: 'Down tile label', get: (h) => line(h, 'Down') },
  {
    id: 'E/levelNumbers',
    label: 'Every published level figure v2 printed',
    set: true,
    get: (h) => h.levelNumbers,
  },
  // NOT `optional`. A ticker with no evaluated weeks renders none of these on
  // EITHER page, and compare() only fails when v2 HAS a value and v3 does not —
  // so "the data might not exist this run" is already handled, and marking
  // these optional would only buy silence on the exact loss this file exists to
  // catch. See the owner-gate warning in the header.
  { id: 'E/hitRate', label: 'EM Hit Rate meter', get: (h) => has(h, 'EM Hit Rate') },
  { id: 'E/hitPct', label: '"N% Hit" headline', get: (h) => rx(h, /\d+% Hit\b/i) },
  { id: 'E/miss', label: 'Miss (n) legend', get: (h) => rx(h, /Miss \(\d+\)/i) },
  { id: 'E/hit', label: 'Hit (n) legend', get: (h) => rx(h, /Hit \(\d+\)/i) },

  // ── Part F — zones ──
  { id: 'F/buy', label: 'Buy Zone card', get: (h) => has(h, 'Buy Zone') },
  { id: 'F/buyHint', label: 'Buy Zone hint wording', get: (h) => rx(h, /Support area — bias long while price holds above\./i) },
  { id: 'F/sell', label: 'Sell Zone card', get: (h) => has(h, 'Sell Zone') },
  { id: 'F/sellHint', label: 'Sell Zone hint wording', get: (h) => rx(h, /Resistance area — bias short while price stays below\./i) },
  { id: 'F/near', label: 'Near rows (both zones)', count: true, get: (h) => h.lines.filter((l) => /^near$/i.test(l)).length },
  { id: 'F/far', label: 'Far rows (both zones)', count: true, get: (h) => h.lines.filter((l) => /^far$/i.test(l)).length },

  // ── Part G — historical averages ──
  { id: 'G/heading', label: '"vs Historical EM Average" card', get: (h) => has(h, 'vs Historical EM Average') },
  { id: 'G/recent', label: 'vs 4-Wk Avg tile', get: (h) => has(h, 'vs 4-Wk Avg') },
  { id: 'G/mid', label: 'vs 12-Wk Avg tile', get: (h) => has(h, 'vs 12-Wk Avg') },
  { id: 'G/arrow', label: 'Up/down arrow + percentage', get: (h) => rx(h, /[▲▼] \d+\.\d%/) },
  { id: 'G/sample', label: '"Based on N weeks of recorded data" footer', get: (h) => rx(h, /Based on \d+ weeks? of recorded data/i) },

  // ── Part H — track record ──
  { id: 'H/heading', label: '"Recent Track Record" card', get: (h) => has(h, 'Recent Track Record') },
  { id: 'H/lastWeek', label: 'Last Week (label) tile', get: (h) => rx(h, /Last Week(?: \([^)]+\))?/i) },
  { id: 'H/result', label: 'HIT / MISS verdict', get: (h) => rx(h, /\b(HIT|MISS)\b/) },
  { id: 'H/window', label: '"Last N Wks Hit %" tile', get: (h) => rx(h, /Last \d+ Wks? Hit %/i) },
  { id: 'H/ratio', label: '"n / n hit" sub-line', get: (h) => rx(h, /\d+ \/ \d+ hit/i) },

  // ── Part I — disclaimer ──
  {
    id: 'I/disclaimer',
    label: 'Weekly-levels disclaimer',
    get: (h) => rx(h, /Levels are published weekly and are informational only — not financial advice\./i),
  },

  // ── Additions the port makes on purpose. Reported, never failed: `compare`
  //    only fails on something v2 HAS and v3 lacks, so a value that exists only
  //    in v3 lands in the `differ` list and gets printed. ──
  { id: 'X/pivot', label: 'Pivot readout (v3 only — v2 fetched it and rendered it nowhere)', optional: true, get: (h) => line(h, 'Pivot') },
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
  // The deep-linked lookup fires on mount and fans out to seven requests; none
  // has a loading flag reachable from outside, so this waits rather than racing.
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
  const t = Array.isArray(s) ? `${s.length} value(s)` : String(s ?? '—')
  return t.length > n ? `${t.slice(0, n - 1)}…` : t.padEnd(n)
}

/**
 * The whole judgement, over two harvests. Split out from the browser driving so
 * parity-check-em.test.mjs can exercise every probe against fixtures — a
 * checker nobody has ever seen fail is not a checker.
 */
export function compare(a, b, probes = PROBES) {
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
      // addition, not a loss.
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

  console.log(`\nparity-check-em — ${V2}  vs  ${V3}\n`)

  const a = await grab(context, V2, 'v2')
  const b = await grab(context, V3, 'v3')
  await browser.close()

  if (!a || !b) {
    console.error('\n  Could not read both pages. Nothing was compared — this is NOT a pass.\n')
    process.exit(2)
  }

  const { rows, missing, softer, differ } = compare(a, b)

  console.log(`  ${pad('probe', 22)}${pad('v2', 34)}${pad('v3', 34)}`)
  console.log(`  ${'─'.repeat(90)}`)
  for (const r of rows) console.log(`${r.mark} ${pad(r.p.id, 22)}${pad(r.va, 34)}${pad(r.vb, 34)}`)
  console.log('')

  // The owner-gate trap, stated on every run rather than left in a doc.
  if (!a.text.includes('EM Hit Rate')) {
    console.log(
      '  i  v2 did not render the EM Hit Rate meter in this run. Either this ticker\n' +
        '     has no evaluated weeks, or the session is not authorised to read\n' +
        '     /api/em-tracker. Parts E2 and H were NOT exercised — do not read this\n' +
        '     run as covering them.\n',
    )
  }

  if (differ.length) {
    console.log('  · present on both sides but not identical:')
    for (const d of differ) console.log(`      ${d.p.id} — ${d.p.label}\n        v2 ${d.va}\n        v3 ${d.vb}`)
    console.log('')
  }

  if (softer.length) {
    console.log('  ~ known, deliberate departures (recorded in docs/parity/em.md):')
    for (const s of softer) console.log(`      ${s.p.id} — ${s.p.label}\n        ${s.p.soft}`)
    console.log('')
  }

  if (missing.length) {
    console.log(`  ✗ ${missing.length} value(s) present in v2 and MISSING from v3:\n`)
    for (const m of missing) {
      console.log(`      ${m.p.id} — ${m.p.label}`)
      console.log(`        v2 has: ${m.detail ?? (Array.isArray(m.va) ? m.va.join(', ') : m.va)}`)
    }
    console.log('\n  Each of these is a row in docs/parity/em.md that has not landed.\n')
    process.exit(1)
  }

  console.log(`  ✓ all ${PROBES.length} probes accounted for\n`)
}

// Importable for the unit test; only the direct run drives a browser.
if (argv[1] && import.meta.url === pathToFileURL(argv[1]).href) {
  await main()
}
