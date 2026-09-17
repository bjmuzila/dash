#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// parity-check-replay.mjs — did the /replay port lose anything?
//
// Drives /app/replay (v2) and /v3/replay (v3) in ONE browser against ONE
// backend in the same minute — so both pages read the same recorder, the same
// sessions and the same frames — then harvests the LABELLED VALUES out of each
// and fails on anything v2 renders and v3 does not.
//
// Why text and not selectors: the port replaces every class name and most of the
// DOM shape on purpose. A structural diff would be all noise. What must survive
// a port is the VALUES and their labels.
//
// ── This page is FOUR pages behind a tab bar ─────────────────────────────────
// Only one tab is in the DOM at a time — switching unmounts the previous one
// entirely. A harvest of the page as loaded would score zero for three quarters
// of the checklist and pass. So the run CLICKS EACH TAB and harvests after each,
// then compares tab-for-tab. Tabs are found by their label text on a
// `[role="tab"]`, which both sides carry.
//
// ── Pin the clock before comparing values ────────────────────────────────────
// Every number on a rewound surface depends on which frame is selected. Both
// sides land on the LAST recorded step by construction (docs/parity/replay.md
// C20, D37) — `*/landsLast` asserts exactly that, and it is the probe to read
// first when the value probes disagree: if the two sides are parked on different
// frames, every downstream difference is noise.
//
// ── The caveat lines are not chrome ──────────────────────────────────────────
// "recorded walls only", "sweeps held to the minute", "Δ and EM off while
// rewound" are the sentences stopping a rewound grid being read as a live one.
// They are the rows most likely to be dropped as decoration in a port, so each
// one is its own probe rather than being folded into a page-text check.
//
// ── Declared departures ──────────────────────────────────────────────────────
// A `soft` probe reports a v2 value v3 does NOT have, without failing the run.
// Every one is a decision recorded in docs/parity/replay.md:
//   D/snapshotBtn    v2's MultiGreekSnapshotBtn emits today's LIVE walls while
//                    rewound. Not ported — the bug was the feature.
//   D/capture        📷 / Discord: v3 ships no DOM-to-canvas renderer.
//   D/oiBasis        OI-only basis dropped; the recorder has no OI-only series,
//                    so v2's option silently showed OI+VOL.
//   B/brandMark      the in-ladder logo, already a declared chain departure.
// The point of `soft` rather than `optional` is that the run still PRINTS them.
// A dropped feature that stops being mentioned is one nobody remembers deciding
// to drop.
//
// The spec is docs/parity/replay.md. A probe here is a row there; if you add a
// row, add a probe.
//
//   node scripts/parity-check-replay.mjs
//
// Env:
//   PARITY_ORIGIN   where both apps are served from. Default http://127.0.0.1:3000
//   PARITY_COOKIE   the session Cookie header. BOTH pages need a signed-in
//                   session — /v3 is owner-gated by middleware.ts.
//   PARITY_SETTLE   ms to wait after each tab click for its recorder fetches.
//                   Default 14000 — the Multi Greek tab fires EIGHT calls (four
//                   replay-meta, four frames-by-expiry) and shows nothing until
//                   the second wave lands.
//
// ⚠ RUN THIS ON A DAY THE RECORDER HAS DATA FOR. Every value probe below reads
//    a recorded session. With an empty recorder both sides render their empty
//    states, compare() finds nothing missing on either, and the run passes
//    having proved nothing. `*/hasSession` is printed on every run for exactly
//    that reason — read it before trusting a green.
//
// Exit codes: 0 pass · 1 parity failure · 2 could not run. A run that could not
// look is never a pass.
// ─────────────────────────────────────────────────────────────────────────────

import { createRequire } from 'node:module'
import { argv } from 'node:process'
import { pathToFileURL } from 'node:url'

const ORIGIN = (process.env.PARITY_ORIGIN || 'http://127.0.0.1:3000').replace(/\/$/, '')
const COOKIE = process.env.PARITY_COOKIE || ''
const SETTLE = Number(process.env.PARITY_SETTLE || 14_000)

const V2 = `${ORIGIN}/app/replay`
const V3 = `${ORIGIN}/v3/replay`

/** The four tabs, by the label both sides print on their `[role="tab"]`. */
export const TABS = [
  { id: 'chain-ladder', label: 'Chain ladder' },
  { id: 'gex-levels', label: 'GEX levels' },
  { id: 'mult-greek', label: 'Multi Greek' },
  { id: 'options-chain', label: 'Options chain' },
]

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
    titles: [...document.querySelectorAll('[title]')].map((el) => norm(el.getAttribute('title'))).filter(Boolean),
    tabs: [...document.querySelectorAll('[role="tab"]')].map((el) => norm(el.textContent)).filter(Boolean),
    imgAlts: [...document.querySelectorAll('img')].map((i) => norm(i.getAttribute('alt'))).filter(Boolean),
    // The scrubber, and where it is parked. `max` and `value` are what prove
    // both sides landed on the LAST step rather than the first.
    ranges: [...document.querySelectorAll('input[type="range"]')].map((r) => ({
      min: Number(r.min),
      max: Number(r.max),
      value: Number(r.value),
      disabled: !!r.disabled,
    })),
    selects: [...document.querySelectorAll('select')].map((s) => ({
      value: s.value,
      options: [...s.options].map((o) => o.value),
    })),
    buttons: [...document.querySelectorAll('button')].map((b) => norm(b.textContent)).filter(Boolean),
    // Every GEX-shaped figure the page printed: a K/M/B magnitude, optionally
    // signed and optionally with a $. Pairing each with its label across two
    // different DOMs is hopeless; asserting that none of v2's went missing is
    // not, and it catches the failure a label-only probe sails past — a grid
    // that renders every heading and prints "--" in every cell.
    magnitudes: text.match(/[+\-−]?\$?\d+(?:\.\d+)?[KMB]\b/g) || [],
    strikes: text.match(/\b\d{3,6}(?:\.\d{1,2})?\b/g) || [],
    snapButtons: [...document.querySelectorAll('button')].filter(
      (b) => /📷|📸/.test(b.textContent || '') || /screenshot|snapshot|discord/i.test(b.getAttribute('title') || ''),
    ).length,
  }
}

// ── Probes ───────────────────────────────────────────────────────────────────

const has = (h, s) => (h.lower.includes(s.toLowerCase()) ? s : null)
const rx = (h, re) => {
  const m = h.text.match(re)
  return m ? m[0] : null
}
const line = (h, s) => (h.lines.some((l) => l.toLowerCase() === s.toLowerCase()) ? s : null)
const title = (h, re) => h.titles.find((t) => re.test(t)) ?? null
const btn = (h, s) => (h.buttons.some((b) => b.toLowerCase() === s.toLowerCase()) ? s : null)

/** The transport, which every tab but none of the live pages carries. */
const transportProbes = (part) => [
  { id: `${part}/replayLabel`, label: '"Replay" bar label', get: (h) => has(h, 'Replay') },
  { id: `${part}/scrubber`, label: 'Scrubber', count: true, get: (h) => h.ranges.length },
  {
    id: `${part}/landsLast`,
    label: 'Lands on the LAST recorded step',
    get: (h) => {
      const r = h.ranges.find((x) => x.max > 0)
      if (!r) return null
      return r.value === r.max ? 'last' : `step ${r.value} of ${r.max}`
    },
  },
  { id: `${part}/dateSelect`, label: 'Session date dropdown', count: true, get: (h) => h.selects.length },
  {
    id: `${part}/sessionDate`,
    label: 'A YYYY-MM-DD session is selected',
    get: (h) => h.selects.map((s) => s.value).find((v) => /^\d{4}-\d{2}-\d{2}$/.test(v)) ?? null,
  },
  ...[0.5, 1, 2, 4, 8].map((sp) => ({
    id: `${part}/speed:${sp}`,
    label: `${sp}× speed tile`,
    get: (h) => btn(h, `${sp}×`),
  })),
  { id: `${part}/play`, label: 'Play / pause control', get: (h) => (h.buttons.some((b) => /^(▶|❚❚)$/.test(b) || /^(▶ Play|❚❚ Pause)$/.test(b)) ? 'play' : null) },
  { id: `${part}/step`, label: 'Step-back control', get: (h) => btn(h, '◀') },
]

export const PROBES = {
  // ── Part A — the hub itself ──
  hub: [
    { id: 'A/tablist', label: 'Four tabs', count: true, get: (h) => h.tabs.length },
    ...TABS.map((t) => ({
      id: `A/tab:${t.id}`,
      label: `"${t.label}" tab`,
      get: (h) => (h.tabs.some((x) => x.toLowerCase() === t.label.toLowerCase()) ? t.label : null),
    })),
    {
      id: 'A/blurb:chain-ladder',
      label: 'Chain ladder tooltip wording',
      get: (h) => title(h, /Per-strike net GEX for one expiry, played through the session/i),
    },
    {
      id: 'A/blurb:gex-levels',
      label: 'GEX levels tooltip wording',
      get: (h) => title(h, /one expiry beside the whole board ex-0DTE/i),
    },
    {
      id: 'A/blurb:mult-greek',
      label: 'Multi Greek tooltip wording',
      get: (h) => title(h, /Four tickers rewound off one shared clock/i),
    },
    {
      id: 'A/blurb:options-chain',
      label: 'Options chain tooltip wording',
      get: (h) => title(h, /The full grid — every strike and column — rewound/i),
    },
  ],

  // ── Part B — Chain ladder ──
  'chain-ladder': [
    { id: 'B/title', label: 'Card title', get: (h) => has(h, 'Option chain replay') },
    ...transportProbes('B'),
    { id: 'B/scaleFrame', label: '"frame" scale tile', get: (h) => btn(h, 'frame') },
    { id: 'B/scaleDay', label: '"day" scale tile', get: (h) => btn(h, 'day') },
    {
      id: 'B/scaleTipFrame',
      label: 'frame-scale tooltip wording',
      get: (h) => title(h, /Rescale each snapshot to its own peak — bars always readable/i),
    },
    {
      id: 'B/scaleTipDay',
      label: 'day-scale tooltip wording',
      get: (h) => title(h, /Fixed session-wide scale — magnitudes comparable across time/i),
    },
    { id: 'B/clock', label: 'Frame clock (HH:MM ET)', get: (h) => rx(h, /\b\d{2}:\d{2}(?::\d{2})? ET\b/) },
    { id: 'B/spot', label: 'Recorded spot readout', get: (h) => rx(h, /spot \d[\d,]*\.\d{2}/) },
    { id: 'B/counter', label: 'Frame counter', get: (h) => rx(h, /Frame \d+ \/ \d+/i) },
    { id: 'B/stampExpiry', label: 'Provenance expiry chip (0DTE or EXP …)', get: (h) => rx(h, /\b(0DTE|EXP [A-Z][a-z]{2} \d{1,2})\b/) },
    { id: 'B/stampDate', label: 'Provenance date stamp', get: (h) => rx(h, /[A-Z][a-z]{2} [A-Z][a-z]{2} \d{1,2}/) },
    {
      id: 'B/ladderValues',
      label: 'Every ladder magnitude v2 printed',
      set: true,
      get: (h) => h.magnitudes,
    },
    { id: 'B/hasSession', label: 'A session actually loaded', get: (h) => (h.ranges.some((r) => r.max > 0) ? 'yes' : null) },
    {
      id: 'B/brandMark',
      label: 'In-ladder CB Edge mark',
      soft: 'NOT PORTED — v3 ships no in-ladder logo; the same departure already declared for the chain (docs/parity/options-chain.md, Part O).',
      get: (h) => (h.imgAlts.some((a) => /cb edge/i.test(a)) ? 'CB Edge' : null),
    },
  ],

  // ── Part C — GEX levels ──
  'gex-levels': [
    { id: 'C/title', label: 'Card title', get: (h) => has(h, 'GEX levels replay') },
    ...transportProbes('C'),
    { id: 'C/left', label: '"By expiration" pane', get: (h) => has(h, 'By expiration') },
    { id: 'C/right', label: '"All expirations · ex-0DTE" pane', get: (h) => has(h, 'All expirations') },
    { id: 'C/netGex', label: 'Net GEX stat label', get: (h) => has(h, 'Net GEX') },
    { id: 'C/core', label: 'Core (CB) chip', get: (h) => has(h, 'Core (CB)') },
    { id: 'C/callWall', label: 'Call wall chip', get: (h) => has(h, 'Call wall') },
    { id: 'C/putWall', label: 'Put wall chip', get: (h) => has(h, 'Put wall') },
    { id: 'C/regime', label: 'Positive / Negative gamma pill', get: (h) => rx(h, /(Positive|Negative) gamma/i) },
    { id: 'C/read', label: '"The read" block', get: (h) => has(h, 'The read') },
    { id: 'C/flip', label: 'Gamma flip sentence', get: (h) => rx(h, /Gamma flip [\d,]+(?:\.\d+)?/i) },
    { id: 'C/atmOff', label: '± Move / ATM IV suppressed while rewound', get: (h) => rx(h, /± Move .{0,4}· ATM IV/i) },
    {
      id: 'C/caveat',
      label: 'Coverage caveat line',
      get: (h) => rx(h, /recorded walls only · sweeps held to the minute/i),
    },
    {
      id: 'C/caveatOff',
      label: 'Caveat names what is switched off',
      get: (h) => rx(h, /Move, ATM IV and Δ 1D off while rewound/i),
    },
    { id: 'C/coverage', label: 'Right-pane "recorded walls only" coverage line', get: (h) => rx(h, /excl\. 0DTE.*recorded walls only/i) },
    { id: 'C/disclaimer', label: 'Recorded-sweeps disclaimer', get: (h) => rx(h, /recorded strike_growth sweeps/i) },
    { id: 'C/values', label: 'Every ladder magnitude v2 printed', set: true, get: (h) => h.magnitudes },
    { id: 'C/hasSession', label: 'A session actually loaded', get: (h) => (h.ranges.some((r) => r.max > 0) ? 'yes' : null) },
  ],

  // ── Part D — Multi Greek ──
  'mult-greek': [
    ...transportProbes('D'),
    { id: 'D/strike', label: 'STRIKE rail header', get: (h) => line(h, 'Strike') },
    { id: 'D/total', label: 'TOTAL row label', get: (h) => line(h, 'Total') },
    { id: 'D/dte', label: 'Column DTE headers', get: (h) => rx(h, /\b\d+DTE\b/) },
    { id: 'D/gexSub', label: 'Column "GEX · MM-DD" sub-line', get: (h) => rx(h, /GEX · \d{2}-\d{2}/) },
    { id: 'D/all', label: 'ALL / EX-0DTE total column', get: (h) => has(h, 'EX-0DTE') },
    {
      id: 'D/allTip',
      label: 'ALL column tooltip wording',
      get: (h) => title(h, /Total NET GEX per strike across .* excluding 0DTE/i),
    },
    { id: 'D/posPct', label: 'Positive-share percentage on the total', get: (h) => rx(h, /\b\d{1,3}%/) },
    {
      id: 'D/caveat',
      label: 'Coverage caveat line',
      get: (h) => rx(h, /recorded walls only · sweeps held to the minute/i),
    },
    {
      id: 'D/caveatOff',
      label: 'Caveat names what is switched off',
      get: (h) => rx(h, /Δ and EM off while rewound/i),
    },
    {
      id: 'D/noHistory',
      label: '"no history: …" caveat when a ticker has no session',
      optional: true,
      get: (h) => rx(h, /no history: [A-Z]/),
    },
    { id: 'D/cbTip', label: 'Core Bullseye marker', get: (h) => title(h, /Core Bullseye|highest \|GEX\| level/i) },
    { id: 'D/cwTip', label: 'Call Wall marker', get: (h) => title(h, /Call Wall|highest \+GEX level/i) },
    { id: 'D/pwTip', label: 'Put Wall marker', get: (h) => title(h, /Put Wall|most −GEX level/i) },
    { id: 'D/levels', label: 'CB / CW / PW badges on the grid', get: (h) => rx(h, /\b(CB|CW|PW)\b/) },
    { id: 'D/values', label: 'Every cell magnitude v2 printed', set: true, get: (h) => h.magnitudes },
    { id: 'D/strikes', label: 'Every strike v2 printed on a rail', set: true, get: (h) => h.strikes },
    { id: 'D/hasSession', label: 'A session actually loaded', get: (h) => (h.ranges.some((r) => r.max > 0) ? 'yes' : null) },
    {
      id: 'D/snapshotBtn',
      label: 'Level-snapshot button',
      count: true,
      soft: 'NOT PORTED — v2\'s MultiGreekSnapshotBtn is not replay-aware: pressed while rewound it emits TODAY\'S live CB/CW/PW. docs/parity/replay.md, declared departures.',
      get: (h) => h.buttons.filter((b) => /snapshot|ladders|table/i.test(b)).length,
    },
    {
      id: 'D/capture',
      label: '📷 / Discord capture buttons',
      count: true,
      soft: 'NOT PORTED — v3 ships no DOM-to-canvas renderer. Same departure as the chain (C/snapshot) and /em (D/snapshot).',
      get: (h) => h.snapButtons,
    },
    {
      id: 'D/oiBasis',
      label: 'OI-only basis option',
      soft: 'NOT PORTED — the recorder stores net and volume, not the two legs, so v2\'s OI option silently showed OI+VOL and said so in a caveat. Dropping the option removes the caveat with it.',
      get: (h) => (h.buttons.some((b) => /^OI$/i.test(b)) ? 'OI' : null),
    },
  ],

  // ── Part E — Options chain ──
  'options-chain': [
    ...transportProbes('E'),
    { id: 'E/replayPill', label: 'REPLAY (not LIVE) state pill', get: (h) => line(h, 'REPLAY') },
    { id: 'E/scope0dte', label: '0DTE scope button', get: (h) => btn(h, '0DTE') },
    { id: 'E/scopeAll', label: '"All exp" scope button', get: (h) => btn(h, 'All exp') },
    {
      id: 'E/opensAt0dte',
      label: 'Opens SCOPED TO 0DTE',
      get: (h) => (/0DTE/.test(h.text) && !/⅀|Total\b/i.test(h.text) ? '0dte' : /0DTE/.test(h.text) ? '0dte (total col present)' : null),
    },
    { id: 'E/clock', label: 'Frame clock with seconds', get: (h) => rx(h, /\b\d{2}:\d{2}:\d{2} ET\b/) },
    { id: 'E/spot', label: 'Recorded spot', get: (h) => rx(h, /spot \d[\d,]*\.\d{2}/) },
    { id: 'E/counter', label: '"frame n / N" counter', get: (h) => rx(h, /frame \d+ \/ \d+/i) },
    {
      id: 'E/coverage',
      label: 'Coverage line — recorded walls + cell count',
      get: (h) => rx(h, /recorded walls only .*cells this frame · GEX only/i),
    },
    { id: 'E/ladderBtn', label: '⛶ Ladder button', get: (h) => (h.buttons.some((b) => /Ladder/i.test(b)) ? 'Ladder' : null) },
    {
      id: 'E/pinnedTip',
      label: 'Greek tabs inert with a reason',
      get: (h) => title(h, /GEX only in replay/i),
    },
    { id: 'E/values', label: 'Every cell magnitude v2 printed', set: true, get: (h) => h.magnitudes },
    { id: 'E/hasSession', label: 'A session actually loaded', get: (h) => (h.ranges.some((r) => r.max > 0) ? 'yes' : null) },
  ],
}

// ── Judgement ────────────────────────────────────────────────────────────────

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

/** Every probe, across every tab — what the summary line counts. */
export function allProbes() {
  return Object.values(PROBES).flat()
}

// ── Run ──────────────────────────────────────────────────────────────────────

function pad(s, n) {
  const t = Array.isArray(s) ? `${s.length} value(s)` : String(s ?? '—')
  return t.length > n ? `${t.slice(0, n - 1)}…` : t.padEnd(n)
}

async function openTabs(context, url, name) {
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
  await page.waitForTimeout(SETTLE)

  const first = await page.evaluate(harvestInPage)
  if (/sign in|log in/i.test(first.text) && first.text.length < 900) {
    console.error(`  ! ${name}: ${url} looks like a sign-in page — set PARITY_COOKIE`)
    await page.close()
    return null
  }

  const out = { hub: first }
  for (const t of TABS) {
    const clicked = await page
      .locator('[role="tab"]', { hasText: t.label })
      .first()
      .click({ timeout: 8_000 })
      .then(() => true)
      .catch(() => false)
    if (!clicked) {
      console.error(`  ! ${name}: could not click the "${t.label}" tab`)
      out[t.id] = null
      continue
    }
    // Each tab remounts its surface and refires its recorder calls from nothing
    // — the previous tab was unmounted, so none of it is warm.
    await page.waitForTimeout(SETTLE)
    out[t.id] = await page.evaluate(harvestInPage)
  }

  if (errors.length) console.error(`  ! ${name}: ${errors.length} page error(s), first: ${errors[0]}`)
  await page.close()
  return out
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

  console.log(`\nparity-check-replay — ${V2}  vs  ${V3}\n`)

  const a = await openTabs(context, V2, 'v2')
  const b = await openTabs(context, V3, 'v3')
  await browser.close()

  if (!a || !b) {
    console.error('\n  Could not read both pages. Nothing was compared — this is NOT a pass.\n')
    process.exit(2)
  }

  let missingTotal = 0
  let softTotal = 0
  const unreadable = []

  for (const [key, probes] of Object.entries(PROBES)) {
    const ha = a[key]
    const hb = b[key]
    const heading = key === 'hub' ? 'HUB — tab bar' : TABS.find((t) => t.id === key)?.label
    console.log(`  ── ${heading} ${'─'.repeat(Math.max(0, 64 - heading.length))}`)
    if (!ha || !hb) {
      console.log(`     ! one side did not open this tab — NOT compared\n`)
      unreadable.push(heading)
      continue
    }
    const { rows, missing, softer, differ } = compare(ha, hb, probes)
    for (const r of rows) console.log(`  ${r.mark} ${pad(r.p.id, 22)}${pad(r.va, 30)}${pad(r.vb, 30)}`)

    if (differ.length) {
      console.log('\n    · present on both sides but not identical:')
      for (const d of differ) console.log(`        ${d.p.id} — ${d.p.label}\n          v2 ${d.va}\n          v3 ${d.vb}`)
    }
    if (softer.length) {
      console.log('\n    ~ declared departures (docs/parity/replay.md):')
      for (const s of softer) console.log(`        ${s.p.id} — ${s.p.label}\n          ${s.p.soft}`)
    }
    if (missing.length) {
      console.log(`\n    ✗ ${missing.length} value(s) present in v2 and MISSING from v3:`)
      for (const m of missing) {
        console.log(`        ${m.p.id} — ${m.p.label}`)
        console.log(`          v2 has: ${m.detail ?? (Array.isArray(m.va) ? m.va.join(', ') : m.va)}`)
      }
    }
    missingTotal += missing.length
    softTotal += softer.length
    console.log('')
  }

  // The empty-recorder trap, stated on every run rather than left in a doc.
  const noSession = Object.keys(PROBES).filter(
    (k) => k !== 'hub' && a[k] && !a[k].ranges.some((r) => r.max > 0),
  )
  if (noSession.length) {
    console.log(
      `  i  v2 rendered NO recorded session on: ${noSession.join(', ')}.\n` +
        '     Either the recorder has no data for those symbols, or the session is\n' +
        '     not authorised to read /proxy/strike-growth. Those tabs were NOT\n' +
        '     exercised — do not read this run as covering them.\n',
    )
  }
  if (unreadable.length) {
    console.error(`\n  ${unreadable.length} tab(s) could not be opened on both sides — this is NOT a pass.\n`)
    process.exit(2)
  }

  if (missingTotal) {
    console.log(`\n  ✗ ${missingTotal} value(s) missing across all tabs.`)
    console.log('  Each is a row in docs/parity/replay.md that has not landed.\n')
    process.exit(1)
  }

  console.log(`  ✓ all ${allProbes().length} probes accounted for (${softTotal} declared departure(s))\n`)
}

// Importable for the unit test; only the direct run drives a browser.
if (argv[1] && import.meta.url === pathToFileURL(argv[1]).href) {
  await main()
}
