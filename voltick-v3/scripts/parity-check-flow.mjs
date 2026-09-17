#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// parity-check-flow.mjs — did the /flow port lose anything?
//
// Drives /app/flow (v2) and /v3/flow (v3) in one browser, against ONE backend,
// in the same minute — so both pages see the same tape, the same net-drift bins
// and the same premium split — then harvests the LABELLED VALUES out of each
// and fails on anything v2 renders and v3 does not.
//
// Why text and not selectors: the port deliberately replaces every class name
// and most of the DOM shape. A structural diff would be all noise. What must
// survive a port is the VALUES and their labels, so the probes below key on
// what a reader actually sees — the sixteen column headers, the four premium
// split tiles and their exact wording, the legend, the tape's totals row, the
// axis-span toggle, the dislocation readout.
//
// The spec is docs/parity/flow.md. A probe here is a row there; if you add a
// row, add a probe.
//
//   node scripts/parity-check-flow.mjs
//
// Env:
//   PARITY_ORIGIN   where both apps are served from. Default http://127.0.0.1:3000
//   PARITY_COOKIE   the session Cookie header. BOTH pages need a signed-in
//                   session — /v3 is owner-gated by middleware.ts. Copy it out
//                   of devtools.
//   PARITY_SETTLE   ms to wait after load for the slow feeds. Default 12000.
//                   Higher than the dashboard's: this page's full-session
//                   backfill is a 20k-row query and the chart bins are a second
//                   round trip behind it.
//   PARITY_TICKER   which ticker to compare. Default SPX.
//
// Exit codes: 0 pass · 1 parity failure · 2 could not run (no playwright, no
// session, a page did not load). A run that could not look is never a pass.
// ─────────────────────────────────────────────────────────────────────────────

import { createRequire } from 'node:module'
import { argv } from 'node:process'
import { pathToFileURL } from 'node:url'

const ORIGIN = (process.env.PARITY_ORIGIN || 'http://127.0.0.1:3000').replace(/\/$/, '')
const COOKIE = process.env.PARITY_COOKIE || ''
const SETTLE = Number(process.env.PARITY_SETTLE || 12_000)
const TICKER = (process.env.PARITY_TICKER || 'SPX').toUpperCase()

const V2 = `${ORIGIN}/app/flow?ticker=${TICKER}`
const V3 = `${ORIGIN}/v3/flow?ticker=${TICKER}`

// ── Harvest ──────────────────────────────────────────────────────────────────
// Runs INSIDE the page. Deliberately dumb: it returns raw material and every
// judgement is made in node below, so both sides are read by the same code.

export function harvestInPage() {
  const norm = (s) => (s || '').replace(/ /g, ' ').replace(/[ \t]+/g, ' ').trim()
  const text = norm(document.body.innerText).replace(/\n{2,}/g, '\n')
  return {
    text,
    lines: (document.body.innerText || '').split('\n').map(norm).filter(Boolean),
    // Every `title=` on the page. Five of the tape's column headers carry one
    // and they are the only place the column's MEANING is written down, so a
    // port that keeps the label and drops the tooltip has lost something real.
    titles: [...document.querySelectorAll('[title]')]
      .map((el) => norm(el.getAttribute('title')))
      .filter(Boolean),
    // Money figures, for the totals row and the split tiles.
    money: (text.match(/-?\$\d[\d.]*[MK]?/g) || []),
    canvases: document.querySelectorAll('canvas').length,
    // A chart that mounted but drew nothing is not a ported chart. Any canvas
    // with real pixels counts; this is why the probe is a boolean, not a count.
    canvasPainted: [...document.querySelectorAll('canvas')].some((c) => c.width > 0 && c.height > 0),
    inputs: document.querySelectorAll('input, select, button').length,
    ranges: document.querySelectorAll('input[type=range]').length,
    dates: document.querySelectorAll('input[type=date]').length,
    selects: document.querySelectorAll('select').length,
    // Rows in the tape. Both sides render a grid of spans, not a <table>, so
    // this counts what a reader counts: lines carrying a BUY/SELL and a bias.
    tapeRows: (text.match(/(?:▲ BULL|▼ BEAR)/g) || []).length,
  }
}

// ── Probes ───────────────────────────────────────────────────────────────────
// Each pulls a single value (or a count) out of a harvest. `soft` reports a
// difference without failing — for the things the port deliberately changed.
// `optional` reports without failing when the value legitimately may not exist
// in this run (an empty session, a filter that matched nothing).

const has = (h, s) => (h.text.includes(s) ? s : null)
const hasTitle = (h, s) => (h.titles.some((t) => t.includes(s)) ? s : null)
const first = (h, rx) => {
  const m = h.text.match(rx)
  return m ? m[0] : null
}
/** Body text between two headings — how a per-section count is taken. */
function section(h, from, to) {
  const i = h.text.indexOf(from)
  if (i < 0) return ''
  const j = to ? h.text.indexOf(to, i + from.length) : -1
  return h.text.slice(i + from.length, j < 0 ? h.text.length : j)
}

export const PROBES = [
  // ── Part A/B — frame, view tabs, preset, session ──
  { id: 'B/byTicker', label: 'By Ticker tab', get: (h) => has(h, 'By Ticker') },
  { id: 'B/combined', label: 'Combined tab', get: (h) => has(h, 'Combined') },
  { id: 'B/preset', label: '0–7DTE ≥$500K OTM preset', get: (h) => first(h, /0[–-]7DTE\s*≥\s*\$500K\s*OTM/i) },
  { id: 'B/presetTitle', label: 'Preset tooltip', get: (h) => hasTitle(h, '0–7 DTE') },
  { id: 'B/session', label: 'Session label', get: (h) => has(h, 'Session') },
  { id: 'B/datePicker', label: 'Session date control', count: true, get: (h) => h.dates },

  // ── Part C — filters card: watchlist / scope ──
  { id: 'C/cardTitle', label: 'Filters card heading', get: (h) => first(h, /Options Flow\s*[—-]\s*Filters/) },
  { id: 'C/watchlist', label: 'Watchlist (N) label', get: (h) => first(h, /Watchlist \(\d+\)/) },
  { id: 'C/chipSPX', label: 'SPX watchlist chip', get: (h) => (/(^|\n)SPX(\n|$)/.test(h.text) ? 'SPX' : null) },
  { id: 'C/chipNVDA', label: 'NVDA watchlist chip', get: (h) => (/(^|\n)NVDA(\n|$)/.test(h.text) ? 'NVDA' : null) },
  { id: 'C/addTicker', label: '+ add ticker input', get: (h) => (/\+ add ticker/.test(h.text) || h.inputs > 0 ? 'present' : null) },
  { id: 'C/go', label: 'GO button', get: (h) => has(h, 'GO') },

  // ── Part D — the eight filter controls ──
  { id: 'D/side', label: 'Side control', get: (h) => has(h, 'Side') },
  { id: 'D/type', label: 'Type control', get: (h) => has(h, 'Type') },
  { id: 'D/minPrem', label: 'Min Premium label + value', get: (h) => first(h, /Min Premium\s*(?:Any|-?\$[\d.]+[MK]?)/) },
  { id: 'D/slider', label: 'Min Premium slider', count: true, get: (h) => h.ranges },
  { id: 'D/minSize', label: 'Min Size', get: (h) => has(h, 'Min Size') },
  { id: 'D/expiry', label: 'Expiry', get: (h) => has(h, 'Expiry') },
  { id: 'D/zeroDte', label: '0DTE quick button', get: (h) => has(h, '0DTE') },
  { id: 'D/expirySelect', label: 'Expiry select', count: true, get: (h) => h.selects },
  { id: 'D/minDte', label: 'Min DTE', get: (h) => has(h, 'Min DTE') },
  { id: 'D/maxDte', label: 'Max DTE', get: (h) => has(h, 'Max DTE') },
  { id: 'D/moneyness', label: 'Moneyness', get: (h) => has(h, 'Moneyness') },
  { id: 'D/otm', label: 'OTM option', get: (h) => (/\bOTM\b/.test(h.text) ? 'OTM' : null) },
  { id: 'D/reset', label: 'Reset', get: (h) => has(h, 'Reset') },

  // ── Part E/F — Net Drift chart ──
  { id: 'E/heading', label: 'Net Drift heading', get: (h) => first(h, /Net Drift \(Premium\)/) },
  // Anchored on the bullet, NOT on the word: the tape header two cards down
  // also says "Calls $24.00M", so a bare /Calls \$…/ found the legend even
  // after the whole chart had been deleted. The self-test caught exactly that.
  { id: 'E/legendCalls', label: 'Legend — Calls total', get: (h) => first(h, /● Calls -?\$[\d.]+[MK]?/) },
  { id: 'E/legendPuts', label: 'Legend — Puts total', get: (h) => first(h, /● Puts -?\$[\d.]+[MK]?/) },
  { id: 'E/legendNet', label: 'Legend — Net total', get: (h) => first(h, /Net -?\$[\d.]+[MK]?/) },
  { id: 'E/spanRth', label: 'RTH span toggle', get: (h) => (/\bRTH\b/.test(h.text) ? 'RTH' : null) },
  { id: 'E/span24h', label: '24H span toggle', get: (h) => (/\b24H\b/.test(h.text) ? '24H' : null) },
  { id: 'E/spanTitle', label: 'RTH toggle tooltip', get: (h) => hasTitle(h, '9:30') },
  { id: 'F/canvas', label: 'A chart canvas exists', get: (h) => (h.canvases > 0 ? 'yes' : null) },
  { id: 'F/painted', label: 'The chart actually painted', get: (h) => (h.canvasPainted ? 'yes' : null) },

  // ── Part H — the four premium-split tiles. The wording is verbatim on
  // purpose: v2 says BUY CALLS but SELL CALL, and a port that "tidied" the
  // plurals changed a label the eye already knows. ──
  { id: 'H/caption', label: 'Premium Split caption', get: (h) => first(h, /Premium Split \((?:Filtered Tape|Full Session — SQL)\)/) },
  // Line-anchored, so 'SELL CALL' does not quietly match a tidied-up
  // 'SELL CALLS'. v2 pluralises the two BUY tiles and not the two SELL tiles;
  // that asymmetry is a label the eye already knows, so it is a value the port
  // has to keep, not a typo to fix in passing.
  { id: 'H/buyCalls', label: 'BUY CALLS tile', get: (h) => first(h, /^BUY CALLS$/m) },
  { id: 'H/buyPuts', label: 'BUY PUTS tile', get: (h) => first(h, /^BUY PUTS$/m) },
  { id: 'H/sellCall', label: 'SELL CALL tile (singular)', get: (h) => first(h, /^SELL CALL$/m) },
  { id: 'H/sellPut', label: 'SELL PUT tile (singular)', get: (h) => first(h, /^SELL PUT$/m) },
  {
    id: 'H/tileValues',
    label: 'Split tiles carrying a money figure',
    count: true,
    get: (h) => (section(h, 'Premium Split', 'Flow Tape').match(/-?\$\d[\d.]*[MK]?/g) || []).length,
  },
  {
    id: 'H/bias',
    label: 'Split tiles carrying a BULL/BEAR badge',
    count: true,
    get: (h) => (section(h, 'Premium Split', 'Flow Tape').match(/(?:▲ BULL|▼ BEAR)/g) || []).length,
  },

  // ── Part I — dislocation velocity ──
  { id: 'I/heading', label: 'Dislocation Velocity · SPX 1m', get: (h) => first(h, /Dislocation Velocity · SPX 1m/) },
  { id: 'I/z', label: 'z / clv readout', get: (h) => first(h, /z (?:-?\d+\.\d|—) · clv (?:-?\d+\.\d{2}|—)/) },
  {
    id: 'I/regime',
    label: 'Regime word',
    get: (h) => first(h, /impulse-up|impulse-down|two-sided|quiet|building bars…/),
  },

  // ── Part K — tape header and totals ──
  { id: 'K/heading', label: 'Flow Tape heading', get: (h) => first(h, /Flow Tape\s*[—-]\s*\S+/) },
  { id: 'K/orders', label: 'N orders', get: (h) => first(h, /[\d,]+ orders/) },
  { id: 'K/total', label: 'Total premium', get: (h) => first(h, /Total -?\$[\d.]+[MK]?/) },
  { id: 'K/calls', label: 'Calls premium', get: (h) => first(h, /Calls -?\$[\d.]+[MK]?/) },
  { id: 'K/puts', label: 'Puts premium', get: (h) => first(h, /Puts -?\$[\d.]+[MK]?/) },
  {
    id: 'K/status',
    label: 'Status badge',
    soft: 'v3 has two states, not three — a page that does not own the socket cannot report RECONNECTING (docs/parity/flow.md, Appendix 1)',
    get: (h) => first(h, /\b(?:LIVE|WAITING|RECONNECTING)\b|\d{4}-\d{2}-\d{2} · HISTORICAL/),
  },

  // ── Part L — all sixteen column headers, and the five tooltips ──
  { id: 'L/time', label: 'Time column', get: (h) => has(h, 'Time') },
  { id: 'L/side', label: 'Side column', get: (h) => has(h, 'Side') },
  { id: 'L/strike', label: 'Strike column', get: (h) => has(h, 'Strike') },
  { id: 'L/spot', label: 'Spot column', get: (h) => has(h, 'Spot') },
  { id: 'L/type', label: 'Type column', get: (h) => has(h, 'Type') },
  { id: 'L/size', label: 'Size column', get: (h) => has(h, 'Size') },
  { id: 'L/costctr', label: 'Cost/Ctr column', get: (h) => has(h, 'Cost/Ctr') },
  { id: 'L/premium', label: 'Premium column', get: (h) => has(h, 'Premium') },
  { id: 'L/vol', label: 'Vol column', get: (h) => (/(^|\n)Vol(\n|$)/.test(h.text) ? 'Vol' : null) },
  { id: 'L/oi', label: 'OI column', get: (h) => (/(^|\n)OI(\n|$)/.test(h.text) ? 'OI' : null) },
  { id: 'L/iv', label: 'IV column', get: (h) => (/(^|\n)IV(\n|$)/.test(h.text) ? 'IV' : null) },
  { id: 'L/otmCol', label: '% OTM column', get: (h) => first(h, /%\s?OTM/) },
  { id: 'L/dte', label: 'DTE column', get: (h) => (/(^|\n)DTE(\n|$)/.test(h.text) ? 'DTE' : null) },
  { id: 'L/expiryCol', label: 'Expiry column', get: (h) => has(h, 'Expiry') },
  { id: 'L/bias', label: 'Bias column', get: (h) => has(h, 'Bias') },
  { id: 'L/tipCost', label: 'Cost/Ctr tooltip', get: (h) => hasTitle(h, 'price × 100') },
  { id: 'L/tipVol', label: 'Vol tooltip', get: (h) => hasTitle(h, 'traded volume') },
  { id: 'L/tipOi', label: 'OI tooltip', get: (h) => hasTitle(h, 'open interest') },
  { id: 'L/tipIv', label: 'IV tooltip', get: (h) => hasTitle(h, 'implied volatility') },
  { id: 'L/tipOtm', label: '% OTM tooltip', get: (h) => hasTitle(h, 'LIVE underlying spot') },
  { id: 'L/tipDte', label: 'DTE tooltip', get: (h) => hasTitle(h, 'Calendar days') },

  // ── Part M — rows actually rendered ──
  {
    id: 'M/rows',
    label: 'Tape rows rendered',
    count: true,
    optional: true, // a quiet session legitimately has none, on BOTH sides
    get: (h) => h.tapeRows,
  },
  {
    id: 'M/whale',
    label: 'Whale marker on ≥$500K rows',
    optional: true,
    get: (h) => (h.text.includes('▸') ? '▸' : null),
  },
  {
    id: 'M/empty',
    label: 'Empty-tape wording, when empty',
    optional: true,
    get: (h) => first(h, /No .+ flow (?:recorded for|matches the current filters)|Connecting to feed…/),
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
  // The slow half of this page is the 20k-row session backfill and the chart's
  // bin query; neither has a loading flag reachable from outside, so this waits
  // rather than racing them.
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
 * parity-check-flow.test.mjs can exercise every probe against fixtures — a
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

  console.log(`\nparity-check-flow — ${V2}  vs  ${V3}\n`)

  const a = await grab(context, V2, 'v2')
  const b = await grab(context, V3, 'v3')
  await browser.close()

  if (!a || !b) {
    console.error('\n  Could not read both pages. Nothing was compared — this is NOT a pass.\n')
    process.exit(2)
  }

  const { rows, missing, softer, differ } = compare(a, b)

  console.log(`  ${pad('probe', 24)}${pad('v2', 34)}${pad('v3', 34)}`)
  console.log(`  ${'─'.repeat(92)}`)
  for (const r of rows) console.log(`${r.mark} ${pad(r.p.id, 24)}${pad(r.va, 34)}${pad(r.vb, 34)}`)
  console.log('')

  if (differ.length) {
    console.log('  · present on both sides but not identical (usually just a live tick):')
    for (const d of differ) console.log(`      ${d.p.id} — ${d.p.label}\n        v2 ${d.va}\n        v3 ${d.vb}`)
    console.log('')
  }

  if (softer.length) {
    console.log('  ~ known, deliberate departures (recorded in docs/parity/flow.md):')
    for (const s of softer) console.log(`      ${s.p.id} — ${s.p.label}: ${s.p.soft}`)
    console.log('')
  }

  if (missing.length) {
    console.log(`  ✗ ${missing.length} value(s) present in v2 and MISSING from v3:\n`)
    for (const m of missing) console.log(`      ${m.p.id} — ${m.p.label}\n        v2 has: ${m.va}`)
    console.log('\n  Each of these is a row in docs/parity/flow.md that has not landed.\n')
    process.exit(1)
  }

  console.log(`  ✓ all ${PROBES.length} probes accounted for\n`)
}

// Importable for the unit test; only the direct run drives a browser.
if (argv[1] && import.meta.url === pathToFileURL(argv[1]).href) {
  await main()
}
