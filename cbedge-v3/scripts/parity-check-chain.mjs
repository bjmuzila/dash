#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// parity-check-chain.mjs — did the Options Chain port lose anything?
//
// Sibling of parity-check.mjs (which does the Traders Dashboard). Same shape,
// same exit codes, its own probes: drives /app/options-chain (v2) and
// /v3/options-chain (v3) in ONE browser against ONE backend in the same minute —
// so both pages see the same chain, the same expirations and the same recorder —
// then harvests the LABELLED VALUES out of each and fails on anything v2 renders
// and v3 does not.
//
// Why text and not selectors: the port replaces every class name and most of the
// DOM shape on purpose. A structural diff would be all noise. What must survive
// is the VALUES and their labels.
//
// ── The settings menu ────────────────────────────────────────────────────────
// Most of this page's controls live behind a cog on BOTH sides, so a harvest of
// the closed page would silently score zero for eighteen checklist rows. The
// harvest therefore opens the cog on both pages (they share the aria-label
// "Options chain settings") and, on v2, clicks through its tab row as well —
// v2's DockCogMenu mounts only the ACTIVE tab's body, so Heat/Stamps/Replay are
// genuinely not in the DOM until you click them. v3's popover stacks all four
// sections at once, which is why several Part D probes below are `optional`:
// they are things v3 shows and v2 hides one click deeper, and that direction is
// never a parity failure.
//
// The spec is docs/parity/options-chain.md. A probe here is a row there; if you
// add a row, add a probe.
//
//   node scripts/parity-check-chain.mjs
//
// Env:
//   PARITY_ORIGIN   where both apps are served from. Default http://127.0.0.1:3000
//   PARITY_COOKIE   the session Cookie header. BOTH pages need a signed-in
//                   session — /v3 is owner-gated by middleware.ts. Copy it out
//                   of devtools.
//   PARITY_SETTLE   ms to wait after load for the chain fetch. Default 12000 —
//                   this page fires 14 /api/chains calls in parallel and paints
//                   in a single commit, so there is nothing on screen until they
//                   all land.
//
// Exit codes: 0 pass · 1 parity failure · 2 could not run. A run that could not
// look is never a pass.
// ─────────────────────────────────────────────────────────────────────────────

import { createRequire } from 'node:module'
import { argv } from 'node:process'
import { pathToFileURL } from 'node:url'

const ORIGIN = (process.env.PARITY_ORIGIN || 'http://127.0.0.1:3000').replace(/\/$/, '')
const COOKIE = process.env.PARITY_COOKIE || ''
const SETTLE = Number(process.env.PARITY_SETTLE || 12000)

const V2 = `${ORIGIN}/app/options-chain`
const V3 = `${ORIGIN}/v3/options-chain`

const COG = '[aria-label="Options chain settings"]'

// ── Harvest ──────────────────────────────────────────────────────────────────
// Runs INSIDE the page. Deliberately dumb: it returns raw material and every
// judgement is made in node below, so both sides are read by the same code.

export function harvestInPage() {
  const norm = (s) => (s || '').replace(/ /g, ' ').replace(/[ \t]+/g, ' ').trim()
  const lines = (document.body.innerText || '')
    .split('\n')
    .map((l) => norm(l))
    .filter(Boolean)
  return {
    text: norm(document.body.innerText).replace(/\n{2,}/g, '\n'),
    lines,
    /** Every `title` on the page — the chain says a lot in tooltips. */
    titles: [...document.querySelectorAll('[title]')].map((el) => norm(el.getAttribute('title'))).filter(Boolean),
    inputs: document.querySelectorAll('input, select, button').length,
    ranges: document.querySelectorAll('input[type=range]').length,
  }
}

/** Two harvests unioned — the closed page and the page with its cog open. */
function merge(a, b) {
  const lines = [...a.lines, ...b.lines]
  return {
    text: `${a.text}\n${b.text}`,
    lines,
    titles: [...a.titles, ...b.titles],
    inputs: Math.max(a.inputs, b.inputs),
    ranges: Math.max(a.ranges, b.ranges),
  }
}

// ── Probe helpers ────────────────────────────────────────────────────────────

const has = (h, s) => (h.text.includes(s) ? s : null)
const hasI = (h, s) => (h.text.toLowerCase().includes(s.toLowerCase()) ? s : null)
const first = (h, rx) => {
  const m = h.text.match(rx)
  return m ? m[0] : null
}
const titleLike = (h, rx) => h.titles.find((t) => rx.test(t)) ?? null
const countLines = (h, rx) => h.lines.filter((l) => rx.test(l)).length

/** An expiry column header, as fmtExpHeader writes it: "Mon 06-23". */
const RX_EXP_HEADER = /^(?:Sun|Mon|Tue|Wed|Thu|Fri|Sat) \d{2}-\d{2}(?: ·Δ(?:15|30|60|15m))?$/
/** A money figure, in either skin: "+$1.23M", "$1.23M", "-$45.6K", "+$0". */
const RX_MONEY = /^[+−-]?\$[\d,]+(?:\.\d+)?[MK]?$/
/** A strike, as the rails print it. */
const RX_STRIKE = /^\d{1,6}(?:\.\d{2})?$/

export const PROBES = [
  // ── Part A/B — page frame and toolbar identity ──
  { id: 'A/title', label: 'Page title "Options Chain"', get: (h) => hasI(h, 'Options Chain') },
  {
    id: 'B/ticker',
    label: 'Active ticker readout',
    get: (h) => h.lines.find((l) => /^[A-Z][A-Z.]{0,5}$/.test(l)) ?? null,
  },
  {
    id: 'B/modeline',
    label: 'GREEK · BASIS · % readout',
    get: (h) => first(h, /\b(?:GEX|DEX|CHEX|VEX|OI|VOL) · (?:OI \+ Vol|Vol Only|Flow GEX) · \d+%/),
  },
  { id: 'B/livechip', label: 'LIVE / REPLAY chip', get: (h) => first(h, /\b(?:LIVE|REPLAY)\b/) },
  {
    id: 'B/focus',
    label: 'FOCUS chip (only while something is selected)',
    optional: true,
    get: (h) => first(h, /FOCUS: [^\n]*/),
  },
  {
    id: 'B/oiprovenance',
    label: 'OI provenance line (OI tab only)',
    optional: true,
    get: (h) => first(h, /(?:ΔOI \d{4}-\d{2}-\d{2} vs \d{4}-\d{2}-\d{2}|no prior snapshot yet|OI snapshot not recorded)/),
  },

  // ── Part C — toolbar actions ──
  { id: 'C/tickers', label: 'Ticker picker', get: (h) => hasI(h, 'Tickers') },
  {
    id: 'C/go',
    label: 'GO button',
    soft: 'not ported — v3 has one board-wide symbol, and the picker commits to it directly',
    get: (h) => (/(^|\n)GO(\n|$)/.test(h.text) ? 'GO' : null),
  },
  { id: 'C/recent', label: 'Recent tickers dropdown', optional: true, get: (h) => hasI(h, 'Recent') },
  { id: 'C/refresh', label: 'Refresh button', get: (h) => first(h, /↻ Now|↻ Refreshing…|✓ Refreshed|✗ Failed/) },
  {
    id: 'C/snapshot',
    label: 'Snapshot button',
    soft: 'not ported — v3 ships no DOM-to-canvas renderer',
    get: (h) => (h.text.includes('📸') ? '📸' : null),
  },
  { id: 'C/cog', label: 'Settings cog', get: (h) => titleLike(h, /Options chain settings/) },

  // ── Part D — settings ──
  { id: 'D/gridSection', label: '"Grid" section', get: (h) => hasI(h, 'Grid') },
  { id: 'D/strikesField', label: '"Strikes" field', get: (h) => hasI(h, 'Strikes') },
  { id: 'D/strikePct', label: '% strikes option', get: (h) => first(h, /\d+% strikes/) },
  { id: 'D/greekField', label: '"Greek" field', get: (h) => hasI(h, 'Greek') },
  {
    id: 'D/greekTabs',
    label: 'Six greek tiles (GEX/DEX/CHEX/VEX/OI/VOL)',
    count: true,
    get: (h) => ['GEX', 'DEX', 'CHEX', 'VEX', 'OI', 'VOL'].filter((g) => h.lines.includes(g)).length,
  },
  { id: 'D/basisField', label: '"Basis" field', get: (h) => hasI(h, 'Basis') },
  // Standalone LINES, not substrings: "OI + Vol" also appears inside the
  // toolbar's "GEX · OI + Vol · 10%" readout, so a substring test would score a
  // page whose Basis control never rendered as a pass.
  { id: 'D/basisOiVol', label: 'Basis "OI + Vol"', get: (h) => (h.lines.includes('OI + Vol') ? 'OI + Vol' : null) },
  { id: 'D/basisVolOnly', label: 'Basis "Vol Only"', get: (h) => (h.lines.includes('Vol Only') ? 'Vol Only' : null) },
  {
    id: 'D/changeModes',
    label: 'Δ change modes (Live / 15m Δ / 30m Δ / 60m Δ)',
    optional: true,
    count: true,
    get: (h) => ['Live', '15m Δ', '30m Δ', '60m Δ'].filter((m) => h.lines.includes(m)).length,
  },
  { id: 'D/heatSection', label: '"Heat" section', optional: true, get: (h) => hasI(h, 'Heat') },
  { id: 'D/intensity', label: '"Intensity" control', optional: true, get: (h) => hasI(h, 'Intensity') },
  {
    id: 'D/intensityHint',
    label: 'Intensity hint (levels-only explanation)',
    optional: true,
    get: (h) => titleLike(h, /only CB \/ CW \/ PW stay marked/),
  },
  {
    id: 'D/intensityReadout',
    label: 'Intensity readout (LEVELS or N.NNx)',
    optional: true,
    get: (h) => first(h, /LEVELS|\d\.\d{2}x/),
  },
  { id: 'D/skinClassic', label: 'Skin CLASSIC', optional: true, get: (h) => has(h, 'CLASSIC') },
  { id: 'D/skinVivid', label: 'Skin VIVID', optional: true, get: (h) => has(h, 'VIVID') },
  { id: 'D/stampsSection', label: '"Stamps" section', optional: true, get: (h) => hasI(h, 'Stamps') },
  { id: 'D/delta15', label: 'Δ15m toggle', optional: true, get: (h) => has(h, 'Δ15m') },
  {
    id: 'D/delta15Tip',
    label: 'Δ15m tooltip (top 5 strikes per side)',
    optional: true,
    get: (h) => titleLike(h, /top 5 strikes per side of ATM/),
  },
  { id: 'D/replaySection', label: '"Replay" section', optional: true, get: (h) => hasI(h, 'Replay') },
  {
    id: 'D/replayToggle',
    label: 'Replay enter/exit button',
    optional: true,
    get: (h) => first(h, /▶ Replay|■ Exit Replay/),
  },
  {
    id: 'D/replayTip',
    label: 'Replay tooltip (rewind the grid itself)',
    optional: true,
    get: (h) => titleLike(h, /Rewind the grid itself/),
  },

  // ── Part G/H — the grid frame and its headers ──
  { id: 'G/strikeRails', label: 'Both "Strike" rail headers', count: true, get: (h) => countLines(h, /^Strike$/) },
  { id: 'H/expHeaders', label: 'Expiry column headers', count: true, get: (h) => countLines(h, RX_EXP_HEADER) },
  {
    id: 'H/expClickTip',
    label: 'Expiry header focus tooltip',
    get: (h) => titleLike(h, /Click to focus this expiration/),
  },
  { id: 'H/totalHeader', label: '⅀ Total column header', get: (h) => first(h, /^Total$|Sel \d+/m) },

  // ── Part I — rails and row markers ──
  { id: 'I/atm', label: 'ATM tag', get: (h) => (h.lines.includes('ATM') ? 'ATM' : null) },
  { id: 'I/atmTip', label: 'ATM tooltip with spot', get: (h) => titleLike(h, /At-the-money — nearest strike to spot/) },
  { id: 'I/em1', label: 'EM ±1σ tags', optional: true, count: true, get: (h) => countLines(h, /^EM [+−]1σ$/) },
  { id: 'I/em2', label: 'EM ±2σ tags', optional: true, count: true, get: (h) => countLines(h, /^EM [+−]2σ$/) },
  {
    id: 'I/emTip',
    label: 'EM tooltip (weekly expected move)',
    optional: true,
    get: (h) => titleLike(h, /weekly expected move/),
  },
  {
    id: 'I/strikeClickTip',
    label: 'Strike focus tooltip',
    get: (h) => titleLike(h, /Click to focus this strike/),
  },
  { id: 'I/strikeRows', label: 'Strike labels rendered', count: true, get: (h) => countLines(h, RX_STRIKE) },

  // ── Part J/K/L — cells ──
  { id: 'J/cellFigures', label: 'Money figures in cells and totals', count: true, get: (h) => countLines(h, RX_MONEY) },
  { id: 'J/cellTip', label: 'Cell click tooltip', get: (h) => titleLike(h, /Click for volume \/ OI \/ net premium/) },
  { id: 'J/cbMarker', label: '★ Core Bullseye tooltip', get: (h) => titleLike(h, /Core Bullseye/) },
  {
    id: 'J/volMvc',
    label: '✕ highest-volume-GEX tooltip',
    optional: true,
    get: (h) => titleLike(h, /Highest volume GEX/),
  },
  { id: 'J/emptyCells', label: '"·" empty-cell mark', optional: true, count: true, get: (h) => countLines(h, /^·$/) },
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
  // This page paints in ONE commit after 14 parallel /api/chains calls resolve,
  // and there is no loading flag reachable from outside — so this waits rather
  // than racing it.
  await page.waitForTimeout(SETTLE)

  let h = await page.evaluate(harvestInPage)

  // Open the settings menu and read again. On v2, also click through its tab
  // row — only the active tab's body is mounted there.
  const cog = await page.$(COG)
  if (cog) {
    await cog.click().catch(() => {})
    await page.waitForTimeout(400)
    h = merge(h, await page.evaluate(harvestInPage))
    const tabs = await page.$$('[role=tab]')
    for (const tab of tabs) {
      await tab.click().catch(() => {})
      await page.waitForTimeout(250)
      h = merge(h, await page.evaluate(harvestInPage))
    }
  } else {
    console.error(`  ! ${name}: no settings cog found (${COG}) — Part D probes will read empty`)
  }

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
 * scripts/parity-check-chain.test.mjs can exercise every probe against fixtures
 * — a checker nobody has ever seen fail is not a checker.
 */
export function compare(a, b) {
  const missing = []
  const softer = []
  const differ = []
  const rows = []

  for (const p of PROBES) {
    const va = p.get(a)
    const vb = p.get(b)
    // A COUNT probe fails on zero, and also on a HALVING. "Present but a third
    // of the size" is the exact shape of this port's failure mode — a matrix
    // that came out as one column still renders expiry headers, so a >0 test
    // alone would wave it straight through. `ratio` is per-probe; 0.5 by
    // default, because a small drift between two live reads is normal and
    // losing half of something is not.
    const ratio = p.ratio ?? 0.5
    const gone = p.count
      ? Number(va) > 0 && !(Number(vb) >= Math.max(1, Math.floor(Number(va) * ratio)))
      : va != null && vb == null
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
    console.error('  ! PARITY_COOKIE is not set — both pages need a signed-in session')
  }

  console.log(`\nparity-check-chain — ${V2}  vs  ${V3}\n`)

  const a = await grab(context, V2, 'v2')
  const b = await grab(context, V3, 'v3')
  await browser.close()

  if (!a || !b) {
    console.error('\n  Could not read both pages. Nothing was compared — this is NOT a pass.\n')
    process.exit(2)
  }

  const { rows, missing, softer, differ } = compare(a, b)

  console.log(`  ${pad('probe', 26)}${pad('v2', 32)}${pad('v3', 32)}`)
  console.log(`  ${'─'.repeat(92)}`)
  for (const r of rows) console.log(`${r.mark} ${pad(r.p.id, 26)}${pad(r.va, 32)}${pad(r.vb, 32)}`)
  console.log('')

  if (differ.length) {
    console.log('  · present on both sides but not identical (usually a live tick or a count):')
    for (const d of differ) console.log(`      ${d.p.id} — ${d.p.label}\n        v2 ${d.va}\n        v3 ${d.vb}`)
    console.log('')
  }

  if (softer.length) {
    console.log('  ~ known, deliberate departures (recorded in docs/parity/options-chain.md):')
    for (const s of softer) console.log(`      ${s.p.id} — ${s.p.label}: ${s.p.soft}`)
    console.log('')
  }

  if (missing.length) {
    console.log(`  ✗ ${missing.length} value(s) present in v2 and MISSING from v3:\n`)
    for (const m of missing) console.log(`      ${m.p.id} — ${m.p.label}\n        v2 has: ${m.va}`)
    console.log('\n  Each of these is a row in docs/parity/options-chain.md that has not landed.\n')
    process.exit(1)
  }

  console.log(`  ✓ all ${PROBES.length} probes accounted for\n`)
}

// Importable for the unit test; only the direct run drives a browser.
if (argv[1] && import.meta.url === pathToFileURL(argv[1]).href) {
  await main()
}
