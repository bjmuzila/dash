#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// parity-check-analysis.mjs — did the /analytics port lose anything?
//
// Drives /app/analytics (v2) and /v3/analytics (v3) in one browser, against ONE
// backend, in the same minute — so both pages see the same chain, the same
// walls and the same recorder state — then harvests the LABELLED VALUES out of
// each and fails on anything v2 renders and v3 does not.
//
// Why text and not selectors: the port replaces every class name and most of
// the DOM shape, so a structural diff would be all noise. What must survive a
// port is the VALUES and their labels.
//
// ── AND THE COLOURS, WHICH IS WHY THIS ONE IS DIFFERENT ──────────────────────
//
// This page carries an explicit requirement that the other ports do not: it
// must render v2's palette, not v3's ("keep colors the same as the v2 version",
// 2026-08-30). Nothing else in the repo can enforce that.
//
// scripts/check-theme.mjs bans colour LITERALS — it cannot see a token that
// resolves to the wrong colour. `T.cyan` passes every scan it makes and paints
// #5b8cff where v2 paints #219EBC. So the colour probes below read
// getComputedStyle off BOTH pages and compare the resolved pixels. That is the
// only mechanism in this repo that can catch the failure, and it is the failure
// the port was most likely to ship.
//
// The spec is docs/parity/analysis.md. A probe here is a row there; if you add
// a row, add a probe.
//
//   node scripts/parity-check-analysis.mjs
//
// Env:
//   PARITY_ORIGIN   where both apps are served from. Default http://127.0.0.1:3000
//   PARITY_COOKIE   the session Cookie header. BOTH pages need a signed-in
//                   session — /v3 is owner-gated by middleware.ts. Copy it out
//                   of devtools.
//   PARITY_SETTLE   ms to wait after load. Default 15000 — higher than the other
//                   parity checks because Ticker Lookup's right pane is ONE
//                   /api/chains call per listed expiration, six in flight, and
//                   SPX lists forty of them.
//   PARITY_TICKER   which ticker Ticker Lookup opens on. Default SPX.
//
// Exit codes: 0 pass · 1 parity failure · 2 could not run (no playwright, no
// session, a page did not load). A run that could not look is never a pass.
// ─────────────────────────────────────────────────────────────────────────────

import { createRequire } from 'node:module'
import { argv } from 'node:process'
import { pathToFileURL } from 'node:url'

const ORIGIN = (process.env.PARITY_ORIGIN || 'http://127.0.0.1:3000').replace(/\/$/, '')
const COOKIE = process.env.PARITY_COOKIE || ''
const SETTLE = Number(process.env.PARITY_SETTLE || 15_000)
const TICKER = (process.env.PARITY_TICKER || 'SPX').toUpperCase()

const V2 = `${ORIGIN}/app/analytics`
const V3 = `${ORIGIN}/v3/analytics`

// ── Harvest ──────────────────────────────────────────────────────────────────
// Runs INSIDE the page. Deliberately dumb: it returns raw material and every
// judgement is made in node below, so both sides are read by the same code.

export function harvestInPage() {
  const norm = (s) => (s || '').replace(/ /g, ' ').replace(/[ \t]+/g, ' ').trim()
  const text = norm(document.body.innerText).replace(/\n{2,}/g, '\n')

  // Leaf elements only. A card title is a leaf span on both sides; matching an
  // ancestor would return the colour of a container that paints nothing.
  const leaves = [...document.querySelectorAll('span, div, button, a, li, p, h1, h2, h3')].filter(
    (e) => e.children.length === 0,
  )
  const byText = (t) => leaves.find((e) => norm(e.textContent) === t) || null

  const cs = (el) => (el ? getComputedStyle(el) : null)

  /** The computed text colour of the leaf whose text is exactly `t`. */
  const colorOf = (t) => {
    const s = cs(byText(t))
    return s ? s.color : null
  }
  /** The computed background of that leaf — for the solid level tags. */
  const bgOf = (t) => {
    const s = cs(byText(t))
    return s ? s.backgroundColor : null
  }

  /**
   * The CARD PLATE behind a title: the nearest ancestor that actually paints a
   * background. Walking up rather than naming a selector is what lets this read
   * v2's `Card variant="budget"` and v3's `Card plate="v2"` with one probe.
   */
  const plateOf = (t) => {
    let el = byText(t)
    for (let i = 0; el && i < 8; i++, el = el.parentElement) {
      const s = getComputedStyle(el)
      const bg = s.backgroundColor
      if (bg && bg !== 'transparent' && !/rgba\(0, 0, 0, 0\)/.test(bg)) {
        return { bg, border: s.borderTopColor, radius: s.borderTopLeftRadius }
      }
    }
    return null
  }

  return {
    text,
    lines: (document.body.innerText || '').split('\n').map(norm).filter(Boolean),
    // Every `title=` on the page. The ladder's level tags and several captions
    // carry one, and it is the only place that meaning is written down.
    titles: [...document.querySelectorAll('[title]')]
      .map((el) => norm(el.getAttribute('title')))
      .filter(Boolean),
    inputs: document.querySelectorAll('input, select, button').length,
    ranges: document.querySelectorAll('input[type=range]').length,
    selects: document.querySelectorAll('select').length,
    // Ladder rows carry data-tl-strike in v3; v2 uses the same attribute, which
    // is why the port kept the name. Falls back to counting CB/CW/PW tags.
    ladderRows: document.querySelectorAll('[data-tl-strike]').length,
    // "updated … ET" — one per card that owns a fetch.
    stamps: (text.match(/updated (?:\d|—)/g) || []).length,

    colors: {
      titleMultiGreek: colorOf('Multi Greek'),
      titleTickerLevels: colorOf('Ticker Levels'),
      titleInitialBalance: colorOf('Initial Balance'),
      titleLookup: colorOf('Ticker Lookup'),
      // The three wall badges are SOLID fills with ink on top — the one place
      // on the page where the colour is the whole message.
      tagCB: bgOf('CB'),
      tagCW: bgOf('CW'),
      tagPW: bgOf('PW'),
      inkCB: colorOf('CB'),
      // Labels are white at an opacity on both sides. v2 has no grey secondary,
      // and a port that reached for one would show up here.
      labelSpot: colorOf('Spot'),
      labelCore: colorOf('Core'),
    },
    plate: plateOf('Multi Greek'),
  }
}

// ── Colour normalisation ─────────────────────────────────────────────────────
// v2 types `rgba(33,158,188,.25)`; v3 reaches the same pixel through
// `color-mix(in srgb, var(--color-v2-cyan) 25%, transparent)`. Chrome may report
// either as `rgb()`, `rgba()` or `color(srgb …)` depending on how it was
// authored, so compare NUMBERS, not the strings the engine happened to print.

export function normColor(v) {
  if (!v) return null
  const s = String(v).trim()

  const srgb = s.match(/^color\(srgb\s+([\d.]+)\s+([\d.]+)\s+([\d.]+)(?:\s*\/\s*([\d.]+))?\)$/i)
  if (srgb) {
    const [, r, g, b, a] = srgb
    return rgba(Number(r) * 255, Number(g) * 255, Number(b) * 255, a === undefined ? 1 : Number(a))
  }

  const m = s.match(/^rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)(?:[,/\s]+([\d.%]+))?\s*\)$/i)
  if (m) {
    const [, r, g, b, rawA] = m
    let a = 1
    if (rawA !== undefined) a = rawA.endsWith('%') ? Number(rawA.slice(0, -1)) / 100 : Number(rawA)
    return rgba(Number(r), Number(g), Number(b), a)
  }
  return s // an engine form we do not know — compare it verbatim rather than lie
}

function rgba(r, g, b, a) {
  const i = (n) => Math.round(Math.max(0, Math.min(255, n)))
  // Alpha to 2dp: a 0.45 plate and a 0.450001 plate are the same plate, and
  // sub-percent drift is not a parity failure anyone can see.
  return `rgba(${i(r)},${i(g)},${i(b)},${Math.round(a * 100) / 100})`
}

// ── Probes ───────────────────────────────────────────────────────────────────
// Each pulls a single value (or a count) out of a harvest. `soft` reports a
// difference without failing — for the things the port deliberately changed.
// `optional` reports without failing when the value legitimately may not exist
// in this run (a card outside its window, a recorder that has not run).

const has = (h, s) => (h.text.includes(s) ? s : null)
const hasTitle = (h, s) => (h.titles.some((t) => t.includes(s)) ? s : null)
const first = (h, rx) => {
  const m = h.text.match(rx)
  return m ? m[0] : null
}
const line = (h, s) => (h.lines.includes(s) ? s : null)
const color = (h, k) => normColor(h.colors?.[k])

export const PROBES = [
  // ── Part C/D — Ticker Lookup: controls and identity line ──
  { id: 'C/heading', label: 'Ticker Lookup heading', get: (h) => has(h, 'Ticker Lookup') },
  { id: 'C/symbol', label: '$SYMBOL', get: (h) => first(h, /\$[A-Z][A-Z.]{0,5}/) },
  { id: 'C/gexLevels', label: '"GEX levels" caption', get: (h) => has(h, 'GEX levels') },
  { id: 'C/refresh', label: 'Refresh button', get: (h) => first(h, /↻ (?:Now|Refreshing…|Refreshed)|✓ Refreshed|✗ Failed/) },
  { id: 'C/refreshTitle', label: 'Refresh tooltip', get: (h) => hasTitle(h, 'Re-fetch the chain') },
  { id: 'C/replay', label: 'Replay toggle', get: (h) => has(h, '⏱ Replay') },
  { id: 'C/replayTitle', label: 'Replay tooltip', get: (h) => hasTitle(h, 'recorded walls only') },
  { id: 'C/quickSPX', label: 'Quick row — SPX', get: (h) => line(h, 'SPX') },
  { id: 'C/quickNVDA', label: 'Quick row — NVDA', get: (h) => line(h, 'NVDA') },
  { id: 'C/quickTSLA', label: 'Quick row — TSLA', get: (h) => line(h, 'TSLA') },
  { id: 'D/gamma', label: 'Gamma regime pill', get: (h) => first(h, /(?:Positive|Negative) gamma/) },
  { id: 'D/meta', label: 'Ticker · expiry · session line', get: (h) => first(h, /[A-Z]{1,6} · [A-Z][a-z]{2} \d{1,2} · \d+DTE/) },

  // ── Part D/E — the two panes ──
  { id: 'D/leftTitle', label: '"By expiration" pane', get: (h) => has(h, 'By expiration') },
  { id: 'E/rightTitle', label: '"All expirations · ex-0DTE" pane', get: (h) => first(h, /All expirations · ex-0DTE/) },
  { id: 'D/netGex', label: 'Net GEX stat (both panes)', count: true, get: (h) => (h.text.match(/Net GEX/g) || []).length },
  { id: 'D/expiryPill', label: 'Expiry pill — "Aug 8 · 0DTE"', get: (h) => first(h, /[A-Z][a-z]{2} \d{1,2} · \d+DTE/) },
  { id: 'D/atm', label: '± Move · ATM IV caption', get: (h) => first(h, /± Move (?:—|±[\d.]+) · ATM IV (?:—|[\d.]+%)/) },
  { id: 'E/coverage', label: 'Board coverage caption', get: (h) => first(h, /\d+ expirations? · excl\. 0DTE|sweeping the board…|front expirations · excl\. 0DTE/) },
  {
    id: 'E/deltaBaseline',
    label: 'Δ 1D baseline caption',
    get: (h) => first(h, /Δ 1D vs close \d{4}-\d{2}-\d{2}|Δ 1D — (?:first snapshot recorded|no end-of-day history yet)/),
  },

  // ── Part F — the ladder ──
  { id: 'F/colStrike', label: 'Strike column', get: (h) => line(h, 'Strike') },
  { id: 'F/colNetGex', label: 'Net GEX column', get: (h) => has(h, 'Net GEX') },
  { id: 'F/colValue', label: 'Value column', get: (h) => line(h, 'Value') },
  { id: 'F/tagCB', label: 'CB tag on the ladder', get: (h) => line(h, 'CB') },
  { id: 'F/tagCW', label: 'CW tag on the ladder', get: (h) => line(h, 'CW') },
  { id: 'F/tagPW', label: 'PW tag on the ladder', get: (h) => line(h, 'PW') },
  { id: 'F/tipCB', label: 'CB tooltip', get: (h) => hasTitle(h, 'Core — biggest magnet') },
  { id: 'F/tipCW', label: 'CW tooltip', get: (h) => hasTitle(h, 'Call wall — ceiling') },
  { id: 'F/tipPW', label: 'PW tooltip', get: (h) => hasTitle(h, 'Put wall — floor') },
  { id: 'F/rows', label: 'Ladder rungs rendered', count: true, get: (h) => h.ladderRows },

  // ── Part G — chips, the read, the disclaimer ──
  { id: 'G/chipCore', label: 'Core (CB) chip', get: (h) => has(h, 'Core (CB)') },
  { id: 'G/chipCall', label: 'Call wall chip', get: (h) => has(h, 'Call wall') },
  { id: 'G/chipPut', label: 'Put wall chip', get: (h) => has(h, 'Put wall') },
  { id: 'G/chipNote', label: 'Chip note — "biggest magnet"', get: (h) => has(h, 'biggest magnet') },
  { id: 'G/chipDist', label: 'Chip distance line', get: (h) => first(h, /[\d,.]+ (?:above|below)|at price/) },
  { id: 'G/read', label: '"The read:" block', get: (h) => has(h, 'The read:') },
  { id: 'G/regime', label: 'Regime sentence', get: (h) => first(h, /Net (?:positive|negative) gamma across the board/) },
  { id: 'G/flip', label: 'Gamma flip clause', optional: true, get: (h) => first(h, /Gamma flip [\d,.]+ — pinning above, trending below/) },
  { id: 'G/disclaimer', label: 'OI+Vol basis disclaimer', get: (h) => first(h, /OI\+Vol basis .* educational only, not investment advice/) },

  // ── Part I — Multi Greek ──
  { id: 'I/title', label: 'Multi Greek card', get: (h) => has(h, 'Multi Greek') },
  { id: 'I/peakCaption', label: '"peak strike" caption', get: (h) => has(h, 'peak strike') },
  { id: 'I/gex', label: 'GEX · peak strike tile', get: (h) => first(h, /GEX · peak strike/) },
  { id: 'I/dex', label: 'DEX · peak strike tile', get: (h) => first(h, /DEX · peak strike/) },
  { id: 'I/chex', label: 'CHEX · peak strike tile', get: (h) => first(h, /CHEX · peak strike/) },
  { id: 'I/vex', label: 'VEX · peak strike tile', get: (h) => first(h, /VEX · peak strike/) },

  // ── Part J — Estimated Move ──
  { id: 'J/title', label: 'Estimated Move card', get: (h) => has(h, 'Estimated Move') },
  { id: 'J/weekly', label: '"weekly" caption', get: (h) => line(h, 'weekly') },
  { id: 'J/more', label: 'More → link', get: (h) => has(h, 'More →') },
  { id: 'J/emUp', label: 'EM Up', get: (h) => has(h, 'EM Up') },
  { id: 'J/emDown', label: 'EM Down', get: (h) => has(h, 'EM Down') },
  { id: 'J/spotLabel', label: 'Spot / Close / Mid label', get: (h) => first(h, /^(?:Spot|Close|Mid)$/m) },
  { id: 'J/band', label: 'Distance to nearer band', get: (h) => first(h, /Distance to nearer band \((?:Up|Down)\)(?: · crossed)?/) },
  { id: 'J/bandPts', label: 'Band distance in pts', get: (h) => first(h, /-?[\d,.]+ pts/) },
  { id: 'J/esu', label: 'ESU ticker pill', get: (h) => line(h, 'ESU') },
  { id: 'J/nqu', label: 'NQU ticker pill', get: (h) => line(h, 'NQU') },

  // ── Part K — Premarket ──
  { id: 'K/title', label: 'Premarket card', get: (h) => line(h, 'Premarket') },
  {
    id: 'K/body',
    label: 'Bullets, or the 8am message',
    get: (h) => first(h, /Summary will be up at 8:00 AM Eastern\.|[A-Z][^\n]{40,}/),
  },
  { id: 'K/gap', label: '/ES gap line', optional: true, get: (h) => first(h, /\/ES gap: [+-]?[\d.]+ pts/) },

  // ── Part L — Economic Calendar ──
  { id: 'L/title', label: 'Economic Calendar header', get: (h) => has(h, 'Economic Calendar') },
  { id: 'L/date', label: 'Header date', get: (h) => first(h, /\d{4}-\d{2}-\d{2}/) },
  { id: 'L/today', label: 'TODAY separator/badge', optional: true, get: (h) => line(h, 'TODAY') },
  { id: 'L/impact', label: 'An impact word', optional: true, get: (h) => first(h, /^(?:High|Medium|Low|Holiday|President)$/m) },
  { id: 'L/afp', label: 'A: / F: / P: figures', optional: true, get: (h) => first(h, /[AFP]: ?[^\n]+/) },
  {
    id: 'L/earnLogo',
    label: 'Earnings chip logo',
    soft: 'v3 renders the text chip that v2\'s ChipLogo falls back to — the local-mirror → /proxy/ticker-logo image pipeline is not ported (docs/parity/analysis.md, Part L)',
    get: (h) => (h.text.includes('PRE') || h.text.includes('AFTER') ? 'earnings block' : null),
  },

  // ── Part M — Confidence Score ──
  { id: 'M/title', label: 'Confidence Score card', get: (h) => has(h, 'Confidence Score') },
  { id: 'M/beta', label: 'BETA tag', get: (h) => line(h, 'BETA') },
  { id: 'M/more', label: 'More → to /confidence-score', get: (h) => has(h, 'More →') },
  { id: 'M/outOf', label: '/100', get: (h) => has(h, '/100') },
  { id: 'M/band', label: 'HIT / PIVOT / CHOP band', get: (h) => first(h, /^(?:HIT|PIVOT|CHOP)$/m) },
  { id: 'M/cb', label: 'Current SPX CB', get: (h) => has(h, 'Current SPX CB') },
  { id: 'M/dist', label: 'Distance to CB', get: (h) => has(h, 'Distance to CB') },
  { id: 'M/checkpoints', label: 'CB checkpoints label', get: (h) => has(h, 'CB checkpoints') },
  { id: 'M/cp945', label: '9:45 checkpoint', get: (h) => line(h, '9:45') },
  { id: 'M/cp1030', label: '10:30 checkpoint', get: (h) => line(h, '10:30') },
  { id: 'M/cp1200', label: '12:00 checkpoint', get: (h) => line(h, '12:00') },
  { id: 'M/chip', label: 'A checkpoint chip', get: (h) => first(h, /HIT · CHOP|MISS|HIT|pending|CB CHANGED · PENDING/) },

  // ── Part N — Net Greeks ──
  { id: 'N/title', label: 'Net Greeks card', get: (h) => has(h, 'Net Greeks') },
  { id: 'N/caption', label: 'now · Δ15m · Δ30m caption', get: (h) => first(h, /now · Δ15m · Δ30m|live chain|last session · \d{4}-\d{2}-\d{2}/) },
  { id: 'N/netGex', label: 'Net GEX tile', get: (h) => has(h, 'Net GEX') },
  { id: 'N/netDex', label: 'Net DEX tile', get: (h) => has(h, 'Net DEX') },
  { id: 'N/netChex', label: 'Net CHEX tile', get: (h) => has(h, 'Net CHEX') },
  { id: 'N/netVex', label: 'Net VEX tile', get: (h) => has(h, 'Net VEX') },
  { id: 'N/d15', label: '15m delta', get: (h) => line(h, '15m') },
  { id: 'N/d30', label: '30m delta', get: (h) => line(h, '30m') },

  // ── Part O — Initial Balance ──
  { id: 'O/title', label: 'Initial Balance card', get: (h) => has(h, 'Initial Balance') },
  { id: 'O/es', label: 'ES caption', get: (h) => line(h, 'ES') },
  { id: 'O/countdown', label: 'IB countdown', get: (h) => first(h, /IB forms in \d+m \d{2}s|Forming — \d+m \d{2}s left|IB locked/) },
  { id: 'O/high', label: 'IB High', get: (h) => has(h, 'IB High') },
  { id: 'O/mid', label: 'IB Mid', get: (h) => has(h, 'IB Mid') },
  { id: 'O/low', label: 'IB Low', get: (h) => has(h, 'IB Low') },
  { id: 'O/range', label: 'Range', get: (h) => line(h, 'Range') },
  { id: 'O/read', label: 'IB read label', get: (h) => has(h, 'IB read') },
  { id: 'O/rules', label: 'Rules in play (N)', optional: true, get: (h) => first(h, /Rules in play \(\d+\)/) },
  { id: 'O/dayType', label: 'Day-type label', optional: true, get: (h) => first(h, /Trend ↑|Trend ↓|Reversal ↑|Reversal ↓|Balance \/ Two-sided|Balance|Forming/) },

  // ── Part P — Ticker Levels ──
  { id: 'P/title', label: 'Ticker Levels card', get: (h) => has(h, 'Ticker Levels') },
  { id: 'P/expiry', label: 'Expiry chip', get: (h) => first(h, /exp —|[A-Z][a-z]{2} \d{1,2} · \d+DTE/) },
  { id: 'P/spot', label: 'Spot', get: (h) => line(h, 'Spot') },
  { id: 'P/callWall', label: 'Call Wall', get: (h) => has(h, 'Call Wall') },
  { id: 'P/putWall', label: 'Put Wall', get: (h) => has(h, 'Put Wall') },
  { id: 'P/core', label: 'Core', get: (h) => line(h, 'Core') },
  { id: 'P/wall', label: 'Distance to nearer wall', get: (h) => first(h, /Distance to nearer wall \((?:Call|Put)\)(?: · through)?/) },
  {
    id: 'P/picker',
    label: 'Searchable ticker picker (not a fixed pill row)',
    // THE REGRESSION THIS PROBE EXISTS FOR: the first v3 port replaced v2's
    // searchable, star-to-favourite, add-your-own menu with four hardcoded
    // pills. The menu is a control, so it is invisible to a text diff until you
    // open it — hence the aria-label rather than a string in the body.
    get: (h) => (h.titles.some((t) => /Select ticker/i.test(t)) || h.text.includes('Search or add…') ? 'picker' : null),
  },

  // ── Part Q — Strategy Builder ──
  { id: 'Q/title', label: 'Strategy Builder card', get: (h) => has(h, 'Strategy Builder') },
  { id: 'Q/nfa', label: 'NOT FINANCIAL ADVICE tag', get: (h) => has(h, 'NOT FINANCIAL ADVICE') },
  {
    id: 'Q/body',
    label: 'Plan, or the out-of-window line',
    get: (h) => first(h, /Available 9:00 AM – 4:00 PM ET on weekdays\.|Key levels|No strategy yet/),
  },
  { id: 'Q/levels', label: 'Key levels section', optional: true, get: (h) => has(h, 'Key levels') },
  { id: 'Q/idea', label: 'Primary idea section', optional: true, get: (h) => has(h, 'Primary idea') },
  { id: 'Q/triggers', label: 'Confirmation triggers section', optional: true, get: (h) => has(h, 'Confirmation triggers') },
  { id: 'Q/entry', label: 'Entry / Stop / Target', optional: true, get: (h) => line(h, 'Entry') },
  { id: 'Q/spxTag', label: 'SPX suffix on prices', optional: true, get: (h) => line(h, 'SPX') },

  // ── Part B — the per-card stamps ──
  { id: 'B/stamps', label: '"updated … ET" stamps', count: true, get: (h) => h.stamps },

  // ── Part S — COLOUR. See the header. ─────────────────────────────────────
  // These compare resolved pixels, so `count` and the em-dash logic do not
  // apply: a colour that is PRESENT but WRONG must fail, which the `differ`
  // bucket alone would only report. `colour: true` marks them for that.
  { id: 'S/titleCyan', label: 'Card title colour', colour: true, get: (h) => color(h, 'titleMultiGreek') },
  { id: 'S/titleCyan2', label: 'Card title colour (Ticker Levels)', colour: true, get: (h) => color(h, 'titleTickerLevels') },
  { id: 'S/titleCyan3', label: 'Card title colour (Initial Balance)', colour: true, get: (h) => color(h, 'titleInitialBalance') },
  { id: 'S/tagCB', label: 'CB tag fill', colour: true, get: (h) => color(h, 'tagCB') },
  { id: 'S/tagCW', label: 'CW tag fill', colour: true, get: (h) => color(h, 'tagCW') },
  { id: 'S/tagPW', label: 'PW tag fill', colour: true, get: (h) => color(h, 'tagPW') },
  { id: 'S/inkCB', label: 'Ink on the CB tag', colour: true, get: (h) => color(h, 'inkCB') },
  { id: 'S/label', label: 'Label colour (white, not a grey)', colour: true, get: (h) => color(h, 'labelSpot') },
  { id: 'S/plateBg', label: 'Card plate fill', colour: true, get: (h) => normColor(h.plate?.bg) },
  { id: 'S/plateEdge', label: 'Card plate edge', colour: true, get: (h) => normColor(h.plate?.border) },
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
  // Ticker Lookup's right pane is one /api/chains call per listed expiration at
  // a concurrency of six; on SPX that is forty requests. Nothing about it is
  // reachable from outside as a loading flag, so this waits rather than racing.
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
 * parity-check-analysis.test.mjs can exercise every probe against fixtures — a
 * checker nobody has ever seen fail is not a checker.
 */
export function compare(a, b, probes = PROBES) {
  const missing = []
  const wrongColour = []
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
    } else if (changed && p.colour) {
      // A COLOUR THAT IS PRESENT BUT WRONG IS A FAILURE, not a difference.
      // Every other probe tolerates drift because a live tick moves the number;
      // a resolved colour does not tick. This is the branch that catches
      // `T.cyan` painting #5b8cff where v2 paints #219EBC — the thing
      // check-theme.mjs structurally cannot see.
      mark = '✗'
      if (!p.optional) wrongColour.push({ p, va, vb })
    } else if (changed) {
      mark = '·'
      differ.push({ p, va, vb })
    }
    rows.push({ mark, p, va, vb })
  }
  return { rows, missing, wrongColour, softer, differ }
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

  console.log(`\nparity-check-analysis — ${V2}  vs  ${V3}   (${TICKER})\n`)

  const a = await grab(context, V2, 'v2')
  const b = await grab(context, V3, 'v3')
  await browser.close()

  if (!a || !b) {
    console.error('\n  Could not read both pages. Nothing was compared — this is NOT a pass.\n')
    process.exit(2)
  }

  const { rows, missing, wrongColour, softer, differ } = compare(a, b)

  console.log(`  ${pad('probe', 22)}${pad('v2', 34)}${pad('v3', 34)}`)
  console.log(`  ${'─'.repeat(90)}`)
  for (const r of rows) console.log(`${r.mark} ${pad(r.p.id, 22)}${pad(r.va, 34)}${pad(r.vb, 34)}`)
  console.log('')

  if (differ.length) {
    console.log('  · present on both sides but not identical (usually just a live tick):')
    for (const d of differ) console.log(`      ${d.p.id} — ${d.p.label}\n        v2 ${d.va}\n        v3 ${d.vb}`)
    console.log('')
  }

  if (softer.length) {
    console.log('  ~ known, deliberate departures (recorded in docs/parity/analysis.md):')
    for (const s of softer) console.log(`      ${s.p.id} — ${s.p.label}: ${s.p.soft}`)
    console.log('')
  }

  if (wrongColour.length) {
    console.log(`  ✗ ${wrongColour.length} colour(s) resolved DIFFERENTLY from v2:\n`)
    for (const w of wrongColour) {
      console.log(`      ${w.p.id} — ${w.p.label}\n        v2 ${w.va}\n        v3 ${w.vb}`)
    }
    console.log(
      '\n  "Keep colors the same as the v2 version" is a requirement on this page.\n' +
        '  check-theme.mjs cannot catch this — it bans literals, not tokens that\n' +
        '  resolve wrong. Use the V2/V2W tokens in src/design/theme.ts, not T.*.\n',
    )
  }

  if (missing.length) {
    console.log(`  ✗ ${missing.length} value(s) present in v2 and MISSING from v3:\n`)
    for (const m of missing) console.log(`      ${m.p.id} — ${m.p.label}\n        v2 has: ${m.va}`)
    console.log('\n  Each of these is a row in docs/parity/analysis.md that has not landed.\n')
  }

  if (missing.length || wrongColour.length) process.exit(1)

  console.log(`  ✓ all ${PROBES.length} probes accounted for\n`)
}

// Importable for the unit test; only the direct run drives a browser.
if (argv[1] && import.meta.url === pathToFileURL(argv[1]).href) {
  await main()
}
