// ─────────────────────────────────────────────────────────────────────────────
// THE ECONOMIC CALENDAR TEMPLATE — v2's 1280×720 Discord card, on v3.
//
// This is not a screenshot of the board card. It is a POSTER: a fixed-size
// layout built for one job, which is to be pasted into Discord and read at a
// glance on a phone. Three lanes — the presidential schedule, today's economic
// prints, today's earnings — under a title bar and the quote of the day, with
// the CB Edge mark in the corner. Every other CopyShot in this app photographs
// something already on the screen; this one composes something that never
// appears on it.
//
// Transcribed from v2's `lib/discord/econSnapshot.ts`, and it is meant to come
// out looking the same: this asset has been going into the same Discord channel
// for months and people know its shape. The palette is v3's — the impact ramp
// is `--color-impact-*`, which carries v2's exact reds and ambers — and the
// title/label accent is `--color-cal-accent`, v2's teal, deliberately rather
// than v3's blue: the poster is a brand asset, not a page.
//
// ── What did NOT come across, and why ────────────────────────────────────────
// v2 renders this through html2canvas, which is not a browser, and a third of
// that file is workarounds for it. The two that mattered:
//
//   · PILL_NUDGE_EM. html2canvas puts a text baseline at (top + ascent) and
//     ignores line-height's half-leading, so nothing centres vertically; v2
//     compensates with asymmetric padding tuned off a real render — 0.42em of
//     it. v3 renders through `<foreignObject>`, which IS a browser: it centres
//     correctly, and carrying the nudge over would push every pill's text
//     visibly low. Gone, replaced with `display:flex; align-items:center`.
//   · The JS text truncation STAYED. html2canvas implements neither
//     `text-overflow:ellipsis` nor `line-clamp`, so v2 clips in JS against a
//     measured column width. v3 would not need it — but the measurements are
//     tuned, the result is deterministic, and matching v2's line breaks is the
//     point of the exercise.
//
// ── The scoping rule ─────────────────────────────────────────────────────────
// The poster is mounted into the LIVE document (off-screen) rather than an
// iframe, because the capture engine inlines computed style off a laid-out
// element and that means the element has to be in this document. So every rule
// below is scoped under `.${ROOT_CLASS}` — which also puts it at specificity
// (0,1,0), above Tailwind's preflight at (0,0,0). Without that the preflight's
// `border:0 solid currentColor` and `margin:0` would be fighting the poster's
// own reset. See also the ALWAYS set in shell/snapshot.ts, which is the same
// hazard from the other end.
// ─────────────────────────────────────────────────────────────────────────────

import { tokenHex, tokenHexAlpha } from '@/design/theme'
import { etToday, type CalEvent, type EarnRow } from '@/data/econCalendar'
import type { ShotResult } from '@/shell/snapshot'

/** Everything below is scoped under this, and nothing above it. */
const ROOT_CLASS = 'cbx-econ-poster'

/**
 * The canvas. LOCKED — anything that overflows shrinks, it never grows.
 *
 * 1280×672, which is v2's `.snapshot` rather than v2's `<body>`. v2's body was
 * 1280×720 with 24px of padding around a 1280-wide child, so the poster
 * overflowed it symmetrically — and it never mattered, because the capture
 * targeted `#root` (the poster) and the body was only ever the thing it sat in.
 * Here the poster IS the captured element, so the padding would be 48px of lane
 * width quietly removed from the arithmetic below. There is no wrapper.
 */
const CANVAS_W = 1280
const CANVAS_H = 672

/**
 * Lane widths for the three panels, in grid fr units.
 *
 * Change them HERE and nowhere else: the `.grid` rule and the truncation maths
 * (which needs each panel's pixel width) both read them through `laneW()`. v2
 * had them hardcoded in the CSS plus two open-coded fractions further down,
 * which is exactly the setup where a lane gets widened and the titles keep
 * truncating to the old width.
 */
const LANE_PRES = 1.75
const LANE_ECON = 3.15
const LANE_ERN = 1.4
const LANE_TOTAL = LANE_PRES + LANE_ECON + LANE_ERN
/** 1280 canvas − 2 border − 60 poster padding − 36 grid gaps. */
const GRID_W = CANVAS_W - 2 - 60 - 36
const laneW = (fr: number) => Math.round(GRID_W * (fr / LANE_TOTAL))

/**
 * THE POSTER'S FIXED CHROME SIZES, in canvas pixels.
 *
 * Every OTHER size in this file is already arithmetic — `px(16, econScale)`,
 * `Math.round(ern.sym * 0.95)` — because the three lanes re-scale with how many
 * rows land in them, and because the JS truncation divides by those very
 * numbers (`econMaxChars`, `presMaxChars`). These five are the sizes that do
 * NOT re-scale: the title badge, the date pills, the quote, the panel heads and
 * the empty-panel line all sit on chrome whose box is the same on a quiet day
 * as on a busy one. They were the only ones still typed as literals in the
 * stylesheet below, which is why `check-theme` flagged six lines here and none
 * of the twelve computed ones.
 *
 * WHY PIXELS AND NOT THE APP'S TYPE SCALE. This is a 1280×672 composition, not
 * a UI: nothing here reflows, the height is locked ("anything that overflows
 * shrinks, it never grows"), and the asset has been going into the same Discord
 * channel for months. `--text-*` is a rem ladder, so a viewer with a non-16px
 * root would rescale the badge and nothing else on a canvas where every other
 * number is absolute — and the two nearest scale steps (17→18, 30→32) would
 * push the quote's `max-width:1120px` block toward a second line on a long
 * quote, on a poster that cannot grow. This is the same carve-out AGENTS.md
 * makes for a canvas or a chart config: the number stays a number.
 *
 * Change one and you change a published brand asset. Re-run
 * `board/econCalendar` through a real capture before you do.
 */
const BADGE_SIZE = 24
const DATE_PILL_SIZE = 17
const QUOTE_SIZE = 30
const PANEL_HEAD_SIZE = 14
const EMPTY_PANEL_SIZE = 14

// ── Palette ──────────────────────────────────────────────────────────────────
//
// Read once per build. `tokenHex` resolves the custom property against the live
// document, so the poster follows tokens.css exactly like everything else — and
// it has to be hex rather than `var(--…)` because these are interpolated into a
// stylesheet the poster carries with it.

interface Palette {
  bg: string
  panel: string
  border: string
  accent: string
  text: string
  muted: string
  light: string
  high: string
  medium: string
  neutral: string
  neutralBg: string
  neutralEdge: string
}

function palette(): Palette {
  return {
    bg: tokenHex('--color-bg'),
    panel: tokenHex('--color-surface'),
    border: tokenHex('--color-line'),
    // v2's teal, not v3's blue. See the header.
    accent: tokenHex('--color-cal-accent'),
    text: tokenHex('--color-fg'),
    muted: tokenHexAlpha('--color-fg', 0.72),
    light: tokenHex('--color-series-5'),
    high: tokenHex('--color-impact-high'),
    medium: tokenHex('--color-impact-medium'),
    neutral: tokenHexAlpha('--color-fg', 0.7),
    neutralBg: tokenHexAlpha('--color-fg', 0.06),
    neutralEdge: tokenHexAlpha('--color-fg', 0.12),
  }
}

/** A hex token at an alpha, as `#rrggbbaa` — the form a stylesheet accepts. */
function fade(name: string, a: number): string {
  return tokenHexAlpha(name, a)
}

// ── Data shaping ─────────────────────────────────────────────────────────────

function todayLong(): string {
  return new Date().toLocaleDateString('en-US', {
    timeZone: 'America/New_York',
    weekday: 'long',
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  })
}

function fmtTime(ev: CalEvent): string {
  return ev.time_formatted || ev.time || 'TBD'
}

/**
 * The White House feed writes every entry as "The President <verb>s …", so the
 * lane repeated its own panel title once per row and spent ~14 characters of a
 * narrow column saying nothing. Drop the subject, keep the action.
 *
 * NOT stripped when the subject is compound ("The President and the First Lady
 * host …") — that would leave a dangling "and …".
 */
function stripPresidentSubject(title: string): string {
  const s = (title || '').trim()
  const m = s.match(/^(?:the\s+)?president(?:\s+trump)?\s+(?!and\b)(.+)$/i)
  if (!m?.[1]) return s
  const rest = m[1].trim()
  return rest.charAt(0).toUpperCase() + rest.slice(1)
}

/**
 * Match the board card's default all-USD scope. Quiet days — only Low-impact
 * USD prints, a CB Leading Index and nothing else — used to render an empty
 * panel even though the card was showing the events.
 */
function includeEvent(ev: CalEvent): boolean {
  return ev.impact === 'President' || (ev.country === 'USD' && ev.impact !== 'Holiday')
}

/**
 * Which prints lead the panel. The lane holds eight rows and a heavy day has
 * twenty; without an opinion about which eight, the poster is whatever the feed
 * happened to list first. Rank 1 is the print that moves the tape most.
 */
const HEADLINE_PRIORITY: RegExp[] = [
  // "non-farm" and "employment change" are here and are NOT in v2's copy of
  // this table. ForexFactory titles the print "Non-Farm Employment Change", and
  // v2 only ever matched "nonfarm payrolls", so THE payroll number fell to
  // unranked and sorted below Crude Oil Inventories on jobs Friday. Faithful to
  // v2 everywhere else; this one is a bug, not a decision.
  /\b(non[- ]?farm(?: payrolls?| employment change)?|nfp|unemployment rate|average hourly earnings|hourly earnings)\b/i,
  /\b(cpi|consumer price index|headline cpi|core cpi)\b/i,
  /\b(fomc|fed rate decision|federal funds rate|powell|dot plot|rate decision)\b/i,
  /\b(gdp|gross domestic product|advance gdp|second estimate|third estimate)\b/i,
  /\b(ppi|producer price index)\b/i,
  /\b(ism manufacturing|manufacturing pmi)\b/i,
  /\b(ism services|services pmi|non-manufacturing pmi)\b/i,
  /\b(retail sales)\b/i,
  /\b(adp|private payrolls?)\b/i,
  /\b(initial jobless claims|jobless claims)\b/i,
  /\b(pce|personal consumption expenditures)\b/i,
  /\b(durable goods)\b/i,
  /\b(industrial production)\b/i,
  /\b(housing starts|building permits)\b/i,
  /\b(existing home sales)\b/i,
  /\b(jolts|job openings)\b/i,
  /\b(consumer confidence|michigan sentiment|consumer sentiment)\b/i,
  /\b(factory orders)\b/i,
  /\b(trade balance)\b/i,
  /\b(ecb|boe|bank of england|bank of canada|boj|snb|rba|riksbank|central bank|global cpi|global gdp|global pmi)\b/i,
]

function priorityOf(ev: CalEvent): number {
  const hay = `${ev.title} ${ev.country} ${ev.impact}`.toLowerCase()
  const i = HEADLINE_PRIORITY.findIndex((re) => re.test(hay))
  return i === -1 ? Number.MAX_SAFE_INTEGER : i
}

/**
 * HIGH is RED, MEDIUM is AMBER, everything else is the neutral pill.
 *
 * Matched on the leading word, case-insensitively, so a provider spelling —
 * "HIGH", "high", "High Impact" — cannot slip past an exact-match test and fall
 * through to another colour. A High print rendering in Medium amber is the one
 * mistake on this poster that actively misleads.
 */
function impactBadge(impact: string, p: Palette): { bg: string; edge: string; ink: string } {
  const key = (impact || '').trim().toLowerCase()
  if (key.startsWith('high')) {
    return { bg: fade('--color-impact-high', 0.18), edge: fade('--color-impact-high', 0.5), ink: p.high }
  }
  if (key.startsWith('med')) {
    return { bg: fade('--color-impact-medium', 0.16), edge: fade('--color-impact-medium', 0.4), ink: p.medium }
  }
  return { bg: p.neutralBg, edge: p.neutralEdge, ink: p.neutral }
}

/**
 * Fewer rows in a lane → bigger type (fills the panel); more rows → smaller
 * type (keeps everything on-canvas). Six rows is the neutral baseline: a light
 * day of four or five events should read BIG rather than leave the panel half
 * empty.
 */
function densityScale(n: number): number {
  return Math.max(0.85, Math.min(1.25, 1 + (6 - n) * 0.07))
}

/**
 * The presidential lane is the sparsest on the canvas — most days it holds one
 * or two entries in a panel ~400px tall, and at densityScale's cap that read as
 * a couple of small lines floating in an empty box. This curve is deliberately
 * steeper: a one-event day should be BIG. The lane's title budget is computed
 * from the resulting row height, so growing the type here cannot push a row off
 * the locked canvas — it just spends the empty space.
 */
function presDensityScale(n: number): number {
  if (n <= 1) return 1.8
  if (n === 2) return 1.5
  if (n === 3) return 1.3
  if (n === 4) return 1.15
  return 1
}

/**
 * Earnings chip geometry, SOLVED for the panel rather than scaled by a curve.
 *
 * A fixed 4-wide strip of 36px logos left the bottom half of the lane blank on
 * a normal day. Scaling the chips by a hand-tuned curve produced awkward counts
 * — two per row with a wide gutter — so instead walk the candidate chips-per-row
 * from widest to narrowest and take the first whose rows actually fit. Fewer per
 * row means bigger chips, so this lands on the largest chip the day's name count
 * allows, and fixed columns always divide the width exactly.
 */
function earnLayout(groupSizes: number[], availW: number, bodyH: number) {
  const gap = 12
  /** Per group: 14px padding top and bottom, the label, 12px label margin. */
  const overhead = groupSizes.length * 52
  let last = { perRow: 6, chipW: 30, logo: 24, sym: 10, gap }
  for (const perRow of [2, 3, 4, 5, 6]) {
    const chipW = Math.floor((availW - gap * (perRow - 1)) / perRow)
    const logo = Math.min(58, Math.round(chipW * 0.78))
    const sym = Math.max(10, Math.min(18, Math.round(logo * 0.33)))
    const rowH = logo + 5 + sym + 3 + gap
    const rows = groupSizes.reduce((a, n) => a + Math.ceil(n / perRow), 0)
    last = { perRow, chipW, logo, sym, gap }
    if (rows * rowH + overhead <= bodyH) return last
  }
  // More names than even the tightest layout fits. The 12-per-session slices
  // upstream bound this, so the last candidate is the floor.
  return last
}

const EARN_GROUP_LABEL: Record<EarnRow['session'], string> = {
  pre: 'Premarket',
  after: 'After hours',
  // `/proxy/earnings-week` reports "unknown" when the provider has not confirmed
  // the slot. These used to be filtered into oblivion — only pre and after were
  // rendered — so a name like AMZN could be in today's feed and simply never
  // appear. Give them a group rather than guessing a session or dropping them.
  unknown: 'Time TBD',
}

/** Text is data. It goes into an HTML string, so it gets escaped. */
function esc(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1).trimEnd()}…` : s)

// ── The poster ───────────────────────────────────────────────────────────────

export interface EconPosterInput {
  events: CalEvent[]
  earnings: EarnRow[]
  /** Quote of the day, from /api/calendar-quote. Omitted when it is empty. */
  quote?: string
  /** The CB Edge square, as a data URI. */
  markDataUrl?: string
  /** symbol → data URI. A missing logo falls back to the ticker text. */
  tickerLogos?: Record<string, string>
}

/** `{ css, html }` for the poster, scoped under ROOT_CLASS. */
export function buildEconPoster(input: EconPosterInput): { css: string; html: string } {
  const p = palette()
  const today = etToday()

  const todays = input.events
    .filter((e) => e.date === today && includeEvent(e))
    .sort((a, b) => priorityOf(a) - priorityOf(b) || a.time.localeCompare(b.time))

  // The presidential schedule is its own lane — never mixed into the economic
  // table, because it is a different kind of event entirely.
  const econEvents = todays.filter((e) => e.impact !== 'President').slice(0, 8)
  const presEvents = todays
    .filter((e) => e.impact === 'President')
    .sort((a, b) => a.time.localeCompare(b.time))
    .slice(0, 6)

  const presScale = presDensityScale(presEvents.length)
  const econScale = densityScale(Math.max(econEvents.length, 1))
  const px = (base: number, scale: number) => Math.round(base * scale)

  // Presidential rows are STACKED — time on its own line, title underneath — so
  // there is no time column and the title gets the full panel width.
  const presTimeSize = px(15, presScale)
  const presTitleSize = px(16, presScale)
  // Measured off a real render: the presidential body is ~400px tall and the
  // rows split it evenly. Stacking costs a line of height per row, so the
  // padding has to give way on a busy day or the last row falls off the canvas.
  const PRES_BODY_H = 400
  const presRowH = PRES_BODY_H / Math.max(presEvents.length, 1)
  const presRowPadV = Math.max(5, Math.min(px(14, presScale), Math.round(presRowH * 0.12)))
  const presTimeLine = presTimeSize + 6
  const presStackGap = 5

  // Actual / Forecast / Previous are deliberately NOT on this poster. It goes
  // out before the numbers print, so all three columns would read "–" while the
  // Event title — the only thing anyone actually reads here — was squeezed into
  // ~300px. Time / Event / Impact only, and Event keeps the width.
  const econHeadSize = px(10, econScale)
  const econTimeSize = px(14, econScale)
  const econEventSize = px(16, econScale)
  const econRowPadV = px(12, econScale)
  const pillFontSize = px(11, econScale)
  const pillHeight = px(22, econScale)
  const pillPadH = px(10, econScale)
  const econTimeCol = px(74, econScale)
  const econImpactCol = px(74, econScale)
  const econColGap = 6
  const econRowPadH = 14

  const ECON_PANEL_W = laneW(LANE_ECON)
  const econEventColW = Math.max(
    120,
    ECON_PANEL_W - econRowPadH * 2 - econTimeCol - econImpactCol - econColGap * 2,
  )
  const econMaxChars = Math.max(12, Math.floor(econEventColW / (econEventSize * 0.56)))

  const PRES_PANEL_W = laneW(LANE_PRES)
  // Stacked rows: the title spans the panel, so the only things subtracted are
  // the body padding (14px a side) and the row padding (6px a side).
  const presTitleColW = Math.max(120, PRES_PANEL_W - 14 * 2 - 6 * 2)
  // The line budget comes from the row's actual leftover height rather than a
  // fixed 2. One event owns the whole panel and should show its full title; six
  // events get a line each. Ellipsing text there is obvious room for was the
  // main thing wrong with a fixed number.
  const presTitleLines = Math.max(
    1,
    Math.min(
      6,
      Math.floor((presRowH - presRowPadV * 2 - presTimeLine - presStackGap - 1) / (presTitleSize * 1.3)),
    ),
  )
  const presMaxChars = Math.max(18, Math.floor((presTitleColW / (presTitleSize * 0.56)) * presTitleLines))

  const preRows = input.earnings.filter((e) => e.session === 'pre').slice(0, 12)
  const afterRows = input.earnings.filter((e) => e.session === 'after').slice(0, 12)
  const tbdRows = input.earnings.filter((e) => e.session !== 'pre' && e.session !== 'after').slice(0, 12)
  // Count what is actually ON the poster, so the badge can never claim more (or
  // fewer) names than you can see.
  const ernCount = preRows.length + afterRows.length + tbdRows.length

  // Both numbers MEASURED off a real render, not estimated. Note the −2: the
  // panel's 1px border on each side is the difference between three chips
  // fitting a row and wrapping to two with a dead gutter.
  const ERN_BODY_H = 413
  const ern = earnLayout(
    [preRows.length, afterRows.length, tbdRows.length].filter((n) => n > 0),
    laneW(LANE_ERN) - 2 - 32,
    ERN_BODY_H,
  )
  const ernLabelSize = Math.max(11, Math.min(15, Math.round(ern.sym * 0.95)))
  const chipFbSize = Math.max(9, Math.round(ern.logo * 0.27))

  const quote = (() => {
    const raw = (input.quote || '').trim()
    if (!raw) return ''
    let q = raw.replace(/[“”]/g, '"').replace(/[‘’]/g, "'").trim()
    let author = ''
    const m = q.match(/\s[-–—]\s([^"-][^-–—]+)$/)
    if (m?.[1]) {
      author = m[1].trim().replace(/^"+|"+$/g, '')
      q = q.slice(0, m.index ?? 0).trim()
    }
    q = q.replace(/^"+|"+$/g, '').trim()
    return author ? `"${q}" - ${author}` : `"${q}"`
  })()

  const econRows = econEvents
    .map((ev) => {
      const b = impactBadge(ev.impact, p)
      return `
      <div class="econ-row">
        <div class="ec-time">${esc(fmtTime(ev))}</div>
        <div class="ec-event">${esc(clip(ev.title, econMaxChars))}</div>
        <div class="ec-impact"><span class="impact-pill" style="background:${b.bg};border-color:${b.edge};color:${b.ink}">${esc(ev.impact)}</span></div>
      </div>`
    })
    .join('')

  const presRows = presEvents
    .map(
      (ev) => `
      <div class="pres-row">
        <div class="pr-time">${esc(fmtTime(ev))}</div>
        <div class="pr-title">${esc(clip(stripPresidentSubject(ev.title), presMaxChars))}</div>
      </div>`,
    )
    .join('')

  const logos = input.tickerLogos ?? {}
  const chips = (rows: EarnRow[]) =>
    rows
      .map((r) => {
        const src = logos[r.symbol]
        const art = src
          ? `<img src="${src}" alt="${esc(r.symbol)}" />`
          : `<span class="chip-fb">${esc(r.symbol.slice(0, 4))}</span>`
        return `<div class="ern-chip"><span class="chip-logo">${art}</span><span class="chip-sym">${esc(r.symbol)}</span></div>`
      })
      .join('')

  const group = (kind: EarnRow['session'], rows: EarnRow[]) =>
    rows.length === 0
      ? ''
      : `<div class="ern-group"><div class="ern-group-label">${EARN_GROUP_LABEL[kind]}</div><div class="ern-chips">${chips(rows)}</div></div>`

  const R = `.${ROOT_CLASS}`

  const css = `
${R},${R} *{box-sizing:border-box;margin:0;padding:0;border:0 solid transparent;font-family:'Inter','Helvetica Neue',Arial,sans-serif}
${R}{width:${CANVAS_W}px;height:${CANVAS_H}px;display:flex;flex-direction:column;position:relative;overflow:hidden;border-radius:24px;color:${p.text};background:radial-gradient(circle at 15% 50%,${fade('--color-cal-accent', 0.06)} 0%,transparent 50%),radial-gradient(circle at 85% 30%,${fade('--color-series-5', 0.07)} 0%,transparent 50%),${p.bg};border:1px solid ${p.border};padding:26px 30px 30px}
${R} .topbar{display:flex;justify-content:space-between;align-items:center;gap:16px;flex-shrink:0}
/* Every pill centres with flex. v2 could not — html2canvas ignores
   align-items on a line box — and compensated with asymmetric padding tuned
   off a real render. Here the browser does the centring, so that nudge is not
   only unnecessary, it would push the text visibly low. See the header. */
${R} .badge{display:flex;align-items:center;justify-content:center;height:56px;background:${fade('--color-cal-accent', 0.12)};border:1px solid ${fade('--color-cal-accent', 0.4)};color:${p.accent};padding:0 26px;font-size:${BADGE_SIZE}px;font-weight:800;border-radius:10px;text-transform:uppercase;letter-spacing:0.07em}
${R} .date-group{display:flex;gap:10px;align-items:center}
${R} .date-pill,${R} .today-pill{display:flex;align-items:center;justify-content:center;height:40px;border-radius:8px;padding:0 18px;font-weight:800;text-transform:uppercase;font-size:${DATE_PILL_SIZE}px;letter-spacing:0.06em}
${R} .date-pill{background:${p.neutralBg};border:1px solid ${p.border};color:${p.text}}
${R} .today-pill{background:${fade('--color-cal-accent', 0.16)};border:1px solid ${fade('--color-cal-accent', 0.4)};color:${p.accent}}
${R} .quote{margin:22px auto 6px;text-align:center;font-family:Georgia,'Times New Roman',serif;font-size:${QUOTE_SIZE}px;font-style:italic;color:${p.muted};padding:0 36px;max-width:1120px;flex-shrink:0}
/* Lane widths come from LANE_* at the top of this file — never hardcode them
   here, or the truncation maths and the rendered columns drift apart. */
${R} .grid{display:grid;grid-template-columns:${LANE_PRES}fr ${LANE_ECON}fr ${LANE_ERN}fr;gap:18px;margin-top:20px;flex:1;min-height:0}
${R} .panel{border-radius:18px;border:1px solid ${p.border};background:radial-gradient(circle at 50% 0%,${fade('--color-series-5', 0.1)} 0%,transparent 60%),${p.panel};box-shadow:0 18px 40px ${fade('--color-app', 0.5)};overflow:hidden;height:100%;display:flex;flex-direction:column}
${R} .panel-head{display:flex;justify-content:space-between;align-items:center;padding:16px 20px;border-bottom:1px solid ${p.border};flex-shrink:0}
${R} .panel-title{font-size:${PANEL_HEAD_SIZE}px;font-weight:800;letter-spacing:0.12em;text-transform:uppercase;color:${p.text};line-height:1}
${R} .panel-count{display:flex;align-items:center;justify-content:center;min-width:26px;height:26px;font-size:${PANEL_HEAD_SIZE}px;font-weight:800;color:${p.light};background:${fade('--color-series-5', 0.1)};border-radius:8px;padding:0 7px}
${R} .ern-body{display:flex;flex-direction:column;flex:1}
${R} .ern-group{padding:14px 16px;border-bottom:1px solid ${p.border};flex:1}
${R} .ern-group:last-child{border-bottom:0}
${R} .ern-group-label{font-size:${ernLabelSize}px;font-weight:800;letter-spacing:0.1em;text-transform:uppercase;color:${p.accent};margin-bottom:12px;line-height:1}
${R} .ern-chips{display:flex;flex-wrap:wrap;gap:${ern.gap}px}
${R} .ern-chip{width:${ern.chipW}px;text-align:center;flex-shrink:0}
${R} .chip-logo{display:block;width:${ern.logo}px;height:${ern.logo}px;margin:0 auto 5px;border-radius:8px;overflow:hidden}
${R} .chip-logo img{width:${ern.logo}px;height:${ern.logo}px;object-fit:contain;display:block}
${R} .chip-fb{display:flex;align-items:center;justify-content:center;width:${ern.logo}px;height:${ern.logo}px;border-radius:8px;background:${fade('--color-cal-accent', 0.1)};border:1px solid ${p.border};font-size:${chipFbSize}px;font-weight:800;color:${p.accent}}
${R} .chip-sym{display:block;font-size:${ern.sym}px;font-weight:800;color:${p.text};letter-spacing:0.02em;line-height:${ern.sym + 3}px;white-space:nowrap}
${R} .pres-body{padding:8px 14px;flex:1;display:flex;flex-direction:column}
${R} .pres-row{display:flex;flex-direction:column;gap:${presStackGap}px;padding:${presRowPadV}px 6px;border-bottom:1px solid ${p.border};flex:1;justify-content:center;min-width:0}
${R} .pres-row:last-child{border-bottom:0}
${R} .pr-time{color:${p.light};font-weight:700;font-size:${presTimeSize}px;line-height:${presTimeLine}px;letter-spacing:0.02em;white-space:nowrap}
${R} .pr-title{font-size:${presTitleSize}px;font-weight:600;line-height:1.3;min-width:0}
${R} .empty-panel{flex:1;display:flex;align-items:center;justify-content:center;text-align:center;color:${fade('--color-fg', 0.35)};font-size:${EMPTY_PANEL_SIZE}px}
${R} .econ-table{display:flex;flex-direction:column;flex:1}
${R} .econ-row{display:grid;grid-template-columns:${econTimeCol}px 1fr ${econImpactCol}px;gap:${econColGap}px;padding:${econRowPadV}px ${econRowPadH}px;align-items:center;border-bottom:1px solid ${p.border};flex:1;min-width:0}
${R} .econ-row:last-child{border-bottom:0}
/* nowrap so a tight fit never silently becomes two lines. */
${R} .econ-row.head{background:${fade('--color-fg', 0.03)};font-size:${econHeadSize}px;font-weight:800;letter-spacing:0.04em;text-transform:uppercase;color:${fade('--color-fg', 0.45)};flex:0 0 auto;white-space:nowrap}
${R} .ec-time{font-size:${econTimeSize}px;line-height:${econTimeSize + 8}px;font-weight:700;color:${p.muted};white-space:nowrap}
/* No overflow:hidden. Titles are already truncated in JS, so clipping earns
   nothing and only risks shearing a descender. */
${R} .ec-event{font-size:${econEventSize}px;line-height:${econEventSize + 8}px;font-weight:600;white-space:nowrap;min-width:0}
${R} .ec-impact{display:flex;justify-content:flex-start;min-width:0}
${R} .impact-pill{display:flex;align-items:center;justify-content:center;height:${pillHeight}px;border:1px solid;border-radius:8px;padding:0 ${pillPadH}px;font-size:${pillFontSize}px;font-weight:800;text-transform:uppercase;letter-spacing:0.04em;white-space:nowrap}
${R} .mark{position:absolute;bottom:18px;right:22px;display:flex;align-items:center;justify-content:flex-end;opacity:0.96}
${R} .mark img{width:80px;height:80px;object-fit:contain}
`

  const html = `
  <div class="topbar">
    <div class="badge">Economic Calendar</div>
    <div class="date-group">
      <div class="date-pill">${esc(todayLong())}</div>
      <div class="today-pill">Today</div>
    </div>
  </div>
  ${quote ? `<div class="quote">${esc(quote)}</div>` : ''}
  <div class="grid">
    <div class="panel">
      <div class="panel-head">
        <div class="panel-title">Presidential Schedule</div>
        <div class="panel-count">${presEvents.length}</div>
      </div>
      ${presEvents.length ? `<div class="pres-body">${presRows}</div>` : `<div class="empty-panel">No political events today</div>`}
    </div>
    <div class="panel">
      <div class="panel-head">
        <div class="panel-title">Economic Calendar</div>
        <div class="panel-count">${econEvents.length}</div>
      </div>
      ${
        econEvents.length
          ? `<div class="econ-table">
        <div class="econ-row head"><div>Time</div><div>Event</div><div>Impact</div></div>
        ${econRows}
      </div>`
          : `<div class="empty-panel">No economic events today</div>`
      }
    </div>
    <div class="panel">
      <div class="panel-head">
        <div class="panel-title">Earnings</div>
        <div class="panel-count">${ernCount}</div>
      </div>
      ${
        ernCount
          ? `<div class="ern-body">${group('pre', preRows)}${group('after', afterRows)}${group('unknown', tbdRows)}</div>`
          : `<div class="empty-panel">No earnings today</div>`
      }
    </div>
  </div>
  ${input.markDataUrl ? `<div class="mark"><img src="${input.markDataUrl}" alt="CB Edge" /></div>` : ''}`

  return { css, html }
}

// ── Fetching, mounting, capturing ────────────────────────────────────────────

async function asDataUrl(url: string): Promise<string> {
  try {
    const res = await fetch(url, { cache: 'no-store' })
    if (!res.ok) return ''
    const blob = await res.blob()
    if (!blob.type.startsWith('image/') || blob.size === 0) return ''
    return await new Promise<string>((resolve) => {
      const fr = new FileReader()
      fr.onload = () => resolve(typeof fr.result === 'string' ? fr.result : '')
      fr.onerror = () => resolve('')
      fr.readAsDataURL(blob)
    })
  } catch {
    return ''
  }
}

interface QuoteResponse {
  quote?: string
}

/**
 * Every image on the poster, inlined.
 *
 * The capture engine drops any image it cannot re-encode (a cross-origin one
 * taints the canvas it reads through), and it drops it SILENTLY because an
 * unresolvable reference fails the whole render. These are all same-origin, so
 * inlining is belt and braces — but it also means the poster is built once and
 * cannot half-arrive.
 */
async function loadArt(earnings: EarnRow[]): Promise<{
  mark: string
  logos: Record<string, string>
}> {
  const [mark, ...pairs] = await Promise.all([
    asDataUrl('/cb-edge-square.png'),
    ...earnings.map(async (r) => {
      const url = `/proxy/ticker-logo?sym=${encodeURIComponent(r.symbol.toUpperCase())}&name=${encodeURIComponent(r.company || '')}`
      return [r.symbol, await asDataUrl(url)] as const
    }),
  ])
  const logos: Record<string, string> = {}
  for (const pair of pairs) if (pair[1]) logos[pair[0]] = pair[1]
  return { mark: mark ?? '', logos }
}

/**
 * Build the poster, photograph it, put it on the clipboard.
 *
 * The poster is mounted OFF-SCREEN IN THE LIVE DOCUMENT rather than in an
 * iframe: the capture engine inlines computed style off a laid-out element, and
 * `getComputedStyle` on another document's nodes is not something to rely on.
 * `left:-99999px` rather than `display:none` — a hidden element has no layout
 * and there would be nothing to measure.
 */
export async function captureEconPoster(input: EconPosterInput): Promise<ShotResult> {
  const { mark, logos } = await loadArt(input.earnings)
  const { css, html } = buildEconPoster({ ...input, markDataUrl: mark, tickerLogos: logos })

  const style = document.createElement('style')
  style.textContent = css
  const host = document.createElement('div')
  host.className = ROOT_CLASS
  host.setAttribute('aria-hidden', 'true')
  host.style.cssText = `position:fixed;left:-99999px;top:0;pointer-events:none`
  host.innerHTML = html

  document.head.appendChild(style)
  document.body.appendChild(host)
  try {
    // Two frames for layout, then the fonts. Same reason the engine waits on
    // document.fonts: text measured against a fallback face and re-laid out a
    // tick later would photograph mid-swap.
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)))
    await document.fonts?.ready?.catch(() => undefined)
    const { captureAndCopy } = await import('@/shell/snapshot')
    return await captureAndCopy(host, {
      // The poster carries its own title bar, its own date and its own mark.
      // The caption band would say all of it a second time.
      bare: true,
      filename: 'econ-calendar.png',
    })
  } finally {
    host.remove()
    style.remove()
  }
}

/** The quote of the day. Best-effort: the poster renders fine without it. */
export async function fetchQuote(): Promise<string> {
  try {
    const res = await fetch('/api/calendar-quote', { cache: 'no-store' })
    if (!res.ok) return ''
    const json: QuoteResponse = await res.json()
    return json.quote ?? ''
  } catch {
    return ''
  }
}
