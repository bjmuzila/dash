// ─────────────────────────────────────────────────────────────────────────────
// THE ECONOMIC CALENDAR TEMPLATE — the 1280×720 Discord card, Voltick theme.
//
// REDONE 2026-09-24 (Brandon picked layout "B · timeline" of four mockups; see
// generated/2026-09-24-econ-voltick-b-timeline.png). The three fixed lanes are
// gone: they broke on uneven days — one economic print and fourteen White House
// items left the middle lane empty while the presidential lane ran off the
// canvas. Now:
//
//   1. ONE LIST sized by content — economic prints and the presidential
//      schedule share a single time-sorted timeline on the left.
//   2. SQUEEZE — row height splits the list area; type steps down with it and
//      stops at a readable floor (13px titles).
//   3. CAP, NEVER CLIP — past MAX_ROWS the most important rows are kept (High
//      prints → market-relevant White House items → Medium → other WH → Low →
//      gaggles/travel) and the last row reads "+N more today · voltick.io/bzila".
//   4. Earnings chips on the right fill a fixed box; overflow becomes a "+N" chip.
//
// All type is Paper White or a colour that means something — no grey text.
// Colours are the Voltick design system's (Voltick DESIGN.md · theme.jsx), held
// as fixed --color-vt-* tokens in src/design/tokens.css and read through
// vtPalette() below: this poster is a Voltick brand asset, so it reads the
// Voltick tokens, never the v3 surface/text tokens.
//
// This is not a screenshot of the board card. It is a POSTER composed on demand
// and photographed; it never appears on screen.
//
// ── The scoping rule ─────────────────────────────────────────────────────────
// The poster is mounted into the LIVE document (off-screen) rather than an
// iframe, because the capture engine inlines computed style off a laid-out
// element and that means the element has to be in this document. So every rule
// below is scoped under `.${ROOT_CLASS}` — which also puts it at specificity
// (0,1,0), above Tailwind's preflight at (0,0,0).
// ─────────────────────────────────────────────────────────────────────────────

import { etToday, type CalEvent, type EarnRow } from '@/data/econCalendar'
import type { ShotResult } from '@/shell/snapshot'
import { tokenHex, tokenHexAlpha } from '@/design/theme'

/** Everything below is scoped under this, and nothing above it. */
const ROOT_CLASS = 'cbx-econ-poster'

/** The canvas. LOCKED — anything that overflows squeezes or caps, it never grows. */
const CANVAS_W = 1280
const CANVAS_H = 720

// ── Geometry ─────────────────────────────────────────────────────────────────
const LEFT_W = 860
const PAD_X = 30
/** Top of the timeline: brand row, the big date, the sub line. */
const LIST_TOP = 178
/** Height the timeline may use (bottom padding 26). */
const LIST_H = CANVAS_H - LIST_TOP - 26
const MIN_ROW_H = 34
const MAX_ROW_H = 60
/** Rows that fit at the floor height — the cap, "+N more" row included. */
const MAX_ROWS = Math.floor(LIST_H / MIN_ROW_H)
const TIME_COL = 78
const DOT_COL = 22
const TAG_COL = 66
const COL_GAP = 10
/** Right pane: earnings box area above the quote box. */
const ERN_H = 440
const ERN_GROUP_OVERHEAD = 14 + 14 + 11 + 10 + 14
const CHIP_H = 30
const CHIP_GAP = 8
const CHIPS_PER_ROW = 3

// ── Voltick palette (Voltick DESIGN.md · web/src/theme.jsx) ──────────────────
// Held as FIXED --color-vt-* tokens in src/design/tokens.css (not overridden by
// the UI theme switch) and resolved to hex at build time, so the SVG attributes
// and the capture engine get plain colours.
function vtPalette() {
  return {
    ink: tokenHex('--color-vt-ink'),
    panel: tokenHex('--color-vt-panel'),
    elev: tokenHex('--color-vt-elev'),
    line: tokenHex('--color-vt-line'),
    lineSoft: tokenHexAlpha('--color-vt-line', 0.6),
    rail: tokenHex('--color-vt-rail'),
    paper: tokenHex('--color-vt-paper'),
    accent: tokenHex('--color-vt-accent'),
    accentText: tokenHex('--color-vt-accent-text'),
    sky: tokenHex('--color-vt-sky'),
    bad: tokenHex('--color-vt-bad'),
  }
}
/** An alpha wash of a Voltick token, as #rrggbbaa. */
const vtA = (name: string, a: number) => tokenHexAlpha(`--color-vt-${name}`, a)

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
  /** Unused since the CB Edge mark came off the poster (2026-09-24). Kept so callers compile. */
  markDataUrl?: string
  /** symbol → data URI. A missing logo falls back to the ticker text. */
  tickerLogos?: Record<string, string>
}

/**
 * Rank for the "which rows make the cut" pass — LOWER is more important.
 * High prints first (in HEADLINE_PRIORITY order), then presidential items about
 * the economy / trade / the Fed, then Medium prints, then other presidential
 * items, then Low prints, and gaggles / travel / photo-ops last.
 */
const PRES_MARKET = /\b(econom\w*|trade|tariff\w*|fed(eral reserve)?|jobs?|inflation|tax\w*|budget|treasury|china|executive order|sign\w*|address|speech|remarks|bill|deal|sanction\w*|oil|energy)\b/i
const PRES_FLUFF = /\b(gaggle|depart\w*|arriv\w*|travel\w*|lunch|dinner|photo|marine one|air force one|motorcade|pool|lid|briefing|en route|returns?)\b/i

function rankOf(ev: CalEvent): number {
  if (ev.impact === 'President') {
    if (PRES_FLUFF.test(ev.title) && !PRES_MARKET.test(ev.title)) return 5
    return PRES_MARKET.test(ev.title) ? 1 : 3
  }
  const k = (ev.impact || '').trim().toLowerCase()
  const pri = Math.min(priorityOf(ev), 99) / 100
  if (k.startsWith('high')) return 0 + pri
  if (k.startsWith('med')) return 2 + pri
  return 4 + pri
}

type Tier = 'h' | 'm' | 'l' | 'p'
function tierOf(ev: CalEvent): Tier {
  if (ev.impact === 'President') return 'p'
  const k = (ev.impact || '').trim().toLowerCase()
  return k.startsWith('high') ? 'h' : k.startsWith('med') ? 'm' : 'l'
}
const TIER_LABEL: Record<Tier, string> = { h: 'High', m: 'Med', l: 'Low', p: 'POTUS' }

/** The Voltick bolt mark (Voltick brand sheet v3), inline so the capture needs no fetch. */
function voltickMark(size: number): string {
  const VT = vtPalette()
  return `<svg width="${size}" height="${size}" viewBox="0 0 64 64" xmlns="http://www.w3.org/2000/svg"><defs><linearGradient id="vtbolt" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${VT.sky}"/><stop offset="1" stop-color="${VT.accent}"/></linearGradient></defs><path d="M38 2 L12 34 L26 34 L22 49 L52 22 L35 22 Z" fill="url(#vtbolt)"/><line x1="6" y1="56" x2="58" y2="56" stroke="${VT.rail}" stroke-width="3" stroke-linecap="round"/><circle cx="18" cy="56" r="8" fill="${vtA('accent', 0.3)}"/><rect x="14" y="52" width="8" height="8" rx="1.6" transform="rotate(45 18 56)" fill="${VT.paper}"/></svg>`
}

function weekdayLong(): string {
  return new Date().toLocaleDateString('en-US', { timeZone: 'America/New_York', weekday: 'long' })
}
function monthDay(): string {
  return new Date().toLocaleDateString('en-US', { timeZone: 'America/New_York', month: 'short', day: 'numeric' })
}

/** `{ css, html }` for the poster, scoped under ROOT_CLASS. */
export function buildEconPoster(input: EconPosterInput): { css: string; html: string } {
  const VT = vtPalette()
  const today = etToday()

  // ── RULE 1 · ONE LIST, SIZED BY CONTENT ─────────────────────────────────
  // Economic prints and the presidential schedule share one time-sorted list,
  // so a day with 1 print and 14 White House items is simply 15 rows — no lane
  // sits empty while another overflows.
  const all = input.events.filter((e) => e.date === today && includeEvent(e))
  const econTotal = all.filter((e) => e.impact !== 'President').length
  const presTotal = all.length - econTotal

  // ── RULE 3 · CAP, NEVER CLIP SILENTLY ───────────────────────────────────
  // At most MAX_ROWS rows. Past that, the most important MAX_ROWS−1 are kept
  // (rankOf) and the last row says how many were left out and where to see them.
  const overflow = all.length > MAX_ROWS
  const kept = overflow
    ? all
        .slice()
        .sort((a, b) => rankOf(a) - rankOf(b) || a.time.localeCompare(b.time))
        .slice(0, MAX_ROWS - 1)
    : all
  const shown = kept.slice().sort((a, b) => a.time.localeCompare(b.time) || rankOf(a) - rankOf(b))
  const hidden = all.length - shown.length
  const nRows = shown.length + (hidden > 0 ? 1 : 0)

  // ── RULE 2 · SQUEEZE ────────────────────────────────────────────────────
  // Row height splits the list area; type steps down with it and stops at a
  // readable floor. A light day reads big instead of leaving a half-empty pane.
  const rowH = Math.max(MIN_ROW_H, Math.min(MAX_ROW_H, Math.floor(LIST_H / Math.max(nRows, 1))))
  const titleSize = Math.max(13, Math.min(20, Math.round(rowH * 0.34)))
  const timeSize = Math.max(12, Math.min(16, Math.round(rowH * 0.28)))
  const fpSize = Math.max(11, Math.min(14, Math.round(rowH * 0.24)))
  const pillH = Math.max(18, Math.min(24, Math.round(rowH * 0.46)))
  const pillSize = Math.max(10, Math.min(12, Math.round(rowH * 0.22)))
  const dot = Math.max(9, Math.min(13, Math.round(rowH * 0.22)))
  const anyFp = shown.some((e) => (e.forecast || e.previous) && e.impact !== 'President')
  const fpCol = anyFp ? 92 : 0
  const titleColW = LEFT_W - 2 * PAD_X - TIME_COL - DOT_COL - fpCol * 2 - TAG_COL - 5 * COL_GAP
  const titleMax = Math.max(14, Math.floor(titleColW / (titleSize * 0.56)))

  const rows = shown
    .map((ev) => {
      const t = tierOf(ev)
      const title = ev.impact === 'President' ? stripPresidentSubject(ev.title) : ev.title
      const f = ev.impact !== 'President' && ev.forecast ? `<span class="fp">F ${esc(ev.forecast)}</span>` : '<span></span>'
      const pv = ev.impact !== 'President' && ev.previous ? `<span class="fp">P ${esc(ev.previous)}</span>` : '<span></span>'
      return `<div class="row"><span class="t">${esc(ev.time ? fmtTime(ev) : 'All day')}</span><span class="dot d-${t}"></span><span class="ev">${esc(clip(title, titleMax))}</span>${anyFp ? f + pv : ''}<span class="tag tg-${t}">${TIER_LABEL[t]}</span></div>`
    })
    .join('')
  const moreRow = hidden > 0
    ? `<div class="row more"><span class="t"></span><span class="dot d-more"></span><span class="ev">+${hidden} more today · <b>voltick.io/bzila</b></span></div>`
    : ''
  const list = shown.length
    ? `<div class="tl">${rows}${moreRow}</div>`
    : `<div class="empty">No scheduled economic data or White House events today.</div>`

  // ── Earnings (right pane) ───────────────────────────────────────────────
  // Chips fill a fixed box; whatever does not fit collapses into a "+N" chip in
  // that group rather than running off the canvas.
  const logos = input.tickerLogos ?? {}
  const groups = (['pre', 'after', 'unknown'] as const)
    .map((k) => ({ k, rows: input.earnings.filter((e) => (k === 'unknown' ? e.session !== 'pre' && e.session !== 'after' : e.session === k)) }))
    .filter((g) => g.rows.length > 0)
  const ernTotal = groups.reduce((a, g) => a + g.rows.length, 0)
  const chipRowsAvail = Math.max(1, Math.floor((ERN_H - groups.length * ERN_GROUP_OVERHEAD) / (CHIP_H + CHIP_GAP)))
  // One row each to start, then hand out the rest one at a time to whichever
  // group is still short the most — a small group is shown whole before a big
  // one takes the room.
  const need = groups.map((g) => Math.ceil(g.rows.length / CHIPS_PER_ROW))
  const alloc = need.map(() => 1)
  let spare = chipRowsAvail - alloc.length
  while (spare > 0) {
    let best = -1
    for (let i = 0; i < need.length; i++) {
      const short = (need[i] ?? 0) - (alloc[i] ?? 0)
      if (short > 0 && (best === -1 || short < (need[best] ?? 0) - (alloc[best] ?? 0))) best = i
    }
    if (best === -1) break
    alloc[best] = (alloc[best] ?? 0) + 1
    spare--
  }
  const chip = (r: EarnRow) => {
    const src = logos[r.symbol]
    return `<span class="chip">${src ? `<img src="${src}" alt="" />` : ''}<span>${esc(r.symbol)}</span></span>`
  }
  const ernHtml = groups.length
    ? groups
        .map((g, i) => {
          const cap = (alloc[i] ?? 1) * CHIPS_PER_ROW
          const fits = g.rows.length <= cap
          const vis = fits ? g.rows : g.rows.slice(0, cap - 1)
          const extra = fits ? '' : `<span class="chip more">+${g.rows.length - vis.length}</span>`
          return `<div class="box"><div class="lbl">${EARN_GROUP_LABEL[g.k]} · ${g.rows.length}</div><div class="chips">${vis.map(chip).join('')}${extra}</div></div>`
        })
        .join('')
    : `<div class="box"><div class="lbl">No earnings today</div></div>`

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
    q = clip(q.replace(/^"+|"+$/g, '').trim(), 150)
    return author ? `“${q}” — ${author}` : `“${q}”`
  })()

  const R = `.${ROOT_CLASS}`
  const SANS = `'Inter',-apple-system,BlinkMacSystemFont,'Helvetica Neue',Arial,sans-serif`
  const MONO = `'JetBrains Mono',ui-monospace,'SF Mono','Cascadia Mono',Menlo,Consolas,monospace`

  // EVERY word on this poster is Paper White (VT.paper) or a colour that MEANS
  // something (impact, the accent). No grey text anywhere (Brandon, 2026-09-24).
  const css = `
${R},${R} *{box-sizing:border-box;margin:0;padding:0;border:0 solid transparent;font-family:${SANS}}
${R}{width:${CANVAS_W}px;height:${CANVAS_H}px;position:relative;overflow:hidden;background:${VT.ink};color:${VT.paper}}
${R} .lp{position:absolute;left:0;top:0;bottom:0;width:${LEFT_W}px;padding:26px ${PAD_X}px}
${R} .rp{position:absolute;right:0;top:0;bottom:0;width:${CANVAS_W - LEFT_W}px;background:${VT.panel};border-left:1px solid ${VT.line};padding:26px 26px}
${R} .brand{display:flex;align-items:center;gap:10px;height:32px}
${R} .wm{font-weight:800;font-size:var(--text-vt-wordmark);letter-spacing:.5px;color:${VT.paper}}
${R} .wm b{color:${VT.accent};font-weight:800}
${R} .eyebrow{font-weight:700;font-size:var(--text-xs);line-height:1;letter-spacing:.14em;text-transform:uppercase;color:${VT.paper}}
${R} .h1{font-weight:900;font-size:var(--text-vt-hero);line-height:1;letter-spacing:-.01em;margin-top:14px;white-space:nowrap}
${R} .h1 span{color:${VT.accentText}}
${R} .sub{font-weight:600;font-size:var(--text-base);line-height:1;margin-top:10px;color:${VT.paper}}
${R} .tl{position:absolute;left:${PAD_X}px;right:${PAD_X}px;top:${LIST_TOP}px}
${R} .tl:before{content:'';position:absolute;left:${TIME_COL + COL_GAP + DOT_COL / 2 - 1}px;top:${Math.round(rowH / 2)}px;bottom:${Math.round(rowH / 2)}px;width:2px;background:${VT.line}}
${R} .row{display:grid;grid-template-columns:${TIME_COL}px ${DOT_COL}px 1fr${anyFp ? ` ${fpCol}px ${fpCol}px` : ''} ${TAG_COL}px;column-gap:${COL_GAP}px;align-items:center;height:${rowH}px;border-bottom:1px solid ${VT.lineSoft}}
${R} .row.more{grid-template-columns:${TIME_COL}px ${DOT_COL}px 1fr;border-bottom:0}
${R} .t{font-family:${MONO};font-weight:700;font-size:${timeSize}px;color:${VT.paper};white-space:nowrap}
${R} .dot{width:${dot}px;height:${dot}px;border-radius:50%;justify-self:center;position:relative;z-index:1;box-shadow:0 0 0 4px ${VT.ink}}
${R} .d-h{background:${VT.bad}} ${R} .d-m{background:${VT.sky}} ${R} .d-l{background:${VT.paper}} ${R} .d-p{background:${VT.accent}}
${R} .d-more{background:transparent;border:2px solid ${VT.accentText}}
${R} .ev{font-weight:700;font-size:${titleSize}px;line-height:1.2;white-space:nowrap;min-width:0;color:${VT.paper}}
${R} .more .ev{font-weight:600;color:${VT.paper}} ${R} .more .ev b{font-family:${MONO};color:${VT.accentText}}
${R} .fp{font-family:${MONO};font-size:${fpSize}px;color:${VT.paper};white-space:nowrap}
${R} .tag{display:flex;align-items:center;justify-content:center;height:${pillH}px;border-radius:6px;border:1px solid;font-weight:800;font-size:${pillSize}px;line-height:1;letter-spacing:.06em;text-transform:uppercase}
${R} .tg-h{color:${VT.bad};border-color:${vtA('bad', 0.45)};background:${vtA('bad', 0.12)}}
${R} .tg-m{color:${VT.sky};border-color:${vtA('sky', 0.40)};background:${vtA('sky', 0.10)}}
${R} .tg-l{color:${VT.paper};border-color:${vtA('paper', 0.30)};background:${vtA('paper', 0.06)}}
${R} .tg-p{color:${VT.accentText};border-color:${vtA('accent', 0.45)};background:${vtA('accent', 0.12)}}
${R} .empty{position:absolute;left:${PAD_X}px;right:${PAD_X}px;top:${LIST_TOP}px;height:${LIST_H}px;display:flex;align-items:center;justify-content:center;border:1px dashed ${VT.line};border-radius:14px;font-size:var(--text-lg);font-weight:600;color:${VT.paper}}
${R} .box{background:${VT.elev};border:1px solid ${VT.line};border-radius:12px;padding:14px;margin-top:14px}
${R} .lbl{font-weight:700;font-size:var(--text-xs);line-height:1;letter-spacing:.14em;text-transform:uppercase;color:${VT.sky}}
${R} .chips{display:grid;grid-template-columns:repeat(${CHIPS_PER_ROW},1fr);gap:${CHIP_GAP}px;margin-top:10px}
${R} .chip{display:flex;align-items:center;justify-content:center;gap:6px;height:${CHIP_H}px;border-radius:8px;background:${VT.ink};border:1px solid ${VT.line};font-family:${MONO};font-weight:700;font-size:var(--text-sm);line-height:1;color:${VT.paper};white-space:nowrap;overflow:hidden}
${R} .chip img{width:18px;height:18px;border-radius:4px;object-fit:contain;display:block}
${R} .chip.more{color:${VT.accentText};border-style:dashed}
${R} .qbox{position:absolute;left:26px;right:26px;bottom:78px;border:1px solid ${vtA('accent', 0.3)};background:${vtA('accent', 0.06)};border-radius:12px;padding:14px}
${R} .qt{font-style:italic;font-weight:500;font-size:var(--text-base);line-height:1.4;margin-top:8px;color:${VT.paper}}
${R} .foot{position:absolute;left:26px;right:26px;bottom:26px;display:flex;justify-content:space-between;align-items:center}
${R} .url{font-family:${MONO};font-weight:800;font-size:var(--text-vt-url);line-height:1;color:${VT.paper};letter-spacing:.02em}
${R} .url b{color:${VT.accentText};font-weight:800}
`

  const subBits = [
    `${econTotal} release${econTotal === 1 ? '' : 's'}`,
    `${presTotal} White House event${presTotal === 1 ? '' : 's'}`,
    'all times ET',
  ]

  const html = `
  <div class="lp">
    <div class="brand">${voltickMark(30)}<span class="wm">Vol<b>tick</b></span><span class="eyebrow" style="margin-left:8px">Economic Calendar</span></div>
    <div class="h1">${esc(weekdayLong())}<span>.</span> ${esc(monthDay())}</div>
    <div class="sub">${subBits.join(' · ')}</div>
    ${list}
  </div>
  <div class="rp">
    <div class="eyebrow">Earnings today${ernTotal ? ` · ${ernTotal}` : ''}</div>
    ${ernHtml}
    ${quote ? `<div class="qbox"><div class="eyebrow">Quote of the day</div><div class="qt">${esc(quote)}</div></div>` : ''}
    <div class="foot"><span class="eyebrow">${esc(todayLong())}</span><span class="url">voltick.io/<b>bzila</b></span></div>
  </div>
  `

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
    // CB Edge mark removed from the poster (2026-09-24).
    Promise.resolve(''),
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

