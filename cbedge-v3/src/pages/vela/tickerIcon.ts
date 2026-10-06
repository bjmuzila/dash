// ─────────────────────────────────────────────────────────────────────────────
// TICKER ICONS: one for every symbol on the Vela page (Brandon, 2026-10-04;
// mockup generated/2026-10-04-vela-legend-l4.html, v6).
//
//   a STOCK      its company's logo: the earnings calendar's own ladder
//                (economicCalendar/ChipLogo.tsx tickerLogoUrls: the /logos
//                mirror, then the live resolver /proxy/ticker-logo, then the
//                parent share class), so a name shows the same logo here as on
//                the earnings board. Nothing found: its ticker in a square.
//   an INDEX     our own mark in a rounded square: what it tracks
//   a FUTURE     (500 the S&P, 100 the Nasdaq-100, 2K the Russell, a spike the
//                VIX), with a badge for how it differs from its family:
//                F a future, m the mini.
//   a FUND       our own mark in a circle, for what it holds: 20Y a long
//                Treasury, Au gold, a chip for semiconductors, a drop for oil…
//                plus 3× / −3× / 2× for leverage and ETN for a note. A fund this
//                table does not know: its ticker in a circle.
//
// Why not the logo mirror for everything: it covers 11 of the 46 indexes,
// futures and funds the chart lists, mostly as issuer wordmarks that blur at
// 20 px, and its ES.png is Eversource Energy (the stock ES), not the future.
//
// One function for the top bar's chip, the ticker picker and the legend card,
// so the three can never disagree. Colours come from tokens.css through the
// `.cb-tki` rules in vela.css.
// ─────────────────────────────────────────────────────────────────────────────

import { tickerLogoUrls } from '@/pages/economicCalendar/ChipLogo'
import { resolveSym, type SymKind } from '@/pages/vela/cbedgeProvider'

const GLYPHS: Record<string, string> = {
  spike: '<path d="M4 14.5h3l1.9-5.5 2.7 9.5 2.7-12.5 2 8.5H20"/>',
  drop: '<path d="M12 4.8c2.9 3.6 4.6 6.2 4.6 8.6a4.6 4.6 0 0 1-9.2 0c0-2.4 1.7-5 4.6-8.6Z"/>',
  chip: '<rect x="7.5" y="7.5" width="9" height="9" rx="1.6"/><path d="M10 5v2.5M14 5v2.5M10 16.5V19M14 16.5V19M5 10h2.5M5 14h2.5M16.5 10H19M16.5 14H19"/>',
  bank: '<path d="M12 5.2 18.5 9h-13L12 5.2ZM7.3 10.5v5.5M10.4 10.5v5.5M13.6 10.5v5.5M16.7 10.5v5.5M5.5 18.3h13"/>',
  flame: '<path d="M12 4.6c.6 2.8 4.8 4.4 4.8 8.6a4.8 4.8 0 0 1-9.6 0c0-2 1-3.4 2.3-4.5.2 1.5.9 2.4 1.9 2.7-.6-2.4-.2-4.6.6-6.8Z"/>',
  screen: '<rect x="5.2" y="6.2" width="13.6" height="9.3" rx="1.5"/><path d="M9.5 18.4h5M12 15.5v2.9"/>',
  bubble: '<path d="M6 7.6A1.6 1.6 0 0 1 7.6 6h8.8A1.6 1.6 0 0 1 18 7.6v5.8a1.6 1.6 0 0 1-1.6 1.6H11l-3.5 3v-3A1.6 1.6 0 0 1 6 13.4Z"/>',
  bag: '<path d="M6.6 9.3h10.8l-.8 9H7.4l-.8-9ZM9.6 9.3V7.8a2.4 2.4 0 0 1 4.8 0v1.5"/>',
  cross: '<path d="M10.2 5.6h3.6v4.6h4.6v3.6h-4.6v4.6h-3.6v-4.6H5.6v-3.6h4.6Z"/>',
  pick: '<path d="M5.4 10Q12 4.2 18.6 10M12 7.3 7.6 18.6"/>',
  globe: '<circle cx="12" cy="12" r="6.6"/><path d="M5.4 12h13.2M12 5.4c1.9 2 2.8 4.2 2.8 6.6s-.9 4.6-2.8 6.6c-1.9-2-2.8-4.2-2.8-6.6s.9-4.6 2.8-6.6Z"/>',
  bulb: '<path d="M9.8 16h4.4M10.3 18.4h3.4M12 5.4a4.4 4.4 0 0 0-2.6 8c.4.3.6.8.6 1.3v.3h4v-.3c0-.5.2-1 .6-1.3A4.4 4.4 0 0 0 12 5.4Z"/>',
  code: '<path d="M9.4 8.4 5.8 12l3.6 3.6M14.6 8.4 18.2 12l-3.6 3.6"/>',
}

/** ticker → [text, or @glyph, or logo:TICKER; badge]. A stock is never here: it gets its logo. */
const MARKS: Record<string, readonly [string, string?]> = {
  // indexes and futures
  SPX: ['500'], NDX: ['100'], RUT: ['2K'], VIX: ['@spike'], XSP: ['500', 'm'], ES: ['500', 'F'], NQ: ['100', 'F'],
  // index funds and bonds
  SPY: ['500'], QQQ: ['100'], IWM: ['2K'], DIA: ['30'], TLT: ['20Y'], IEF: ['10Y'], HYG: ['HY'], LQD: ['IG'],
  // metals and oil
  GLD: ['Au'], SLV: ['Ag'], GDX: ['@pick'], USO: ['@drop'], BNO: ['@drop'],
  // sectors
  XLF: ['@bank'], XLE: ['@flame'], XLK: ['@screen'], XLC: ['@bubble'], XLY: ['@bag'], XLV: ['@cross'],
  SMH: ['@chip'], SOXX: ['@chip'], IGV: ['@code'], ARKK: ['@bulb'],
  // leveraged and notes
  SOXL: ['@chip', '3×'], SOXS: ['@chip', '−3×'], TQQQ: ['100', '3×'], SQQQ: ['100', '−3×'], TSLL: ['logo:TSLA', '2×'], VXX: ['@spike', 'ETN'],
  // crypto and countries
  IBIT: ['₿'], ETHA: ['Ξ'], FXI: ['CN'], KWEB: ['@globe', 'CN'], EEM: ['EM'], EFA: ['@globe'], EWZ: ['BR'], EWY: ['KR'],
}

/**
 * A company name for the logo resolver, for a ticker it cannot find by symbol
 * alone (a new listing the GitHub logo set does not have yet): the resolver then
 * searches Wikidata by this name. 2026-10-06: SPCX (SpaceX, a 2026 IPO).
 */
const LOGO_NAMES: Record<string, string> = {
  SPCX: 'SpaceX',
}

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => `&#${c.charCodeAt(0)};`)

function shape(round: boolean, inner: string): string {
  const base = round
    ? '<circle class="cb-tki-shape" cx="12" cy="12" r="11.3"/>'
    : '<rect class="cb-tki-shape" x=".7" y=".7" width="22.6" height="22.6" rx="6"/>'
  return `<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">${base}${inner}</svg>`
}

function textMark(s: string): string {
  const sym = /[₿Ξ]/.test(s)
  // SVG user units: the type scales with the icon, so no CSS font size is involved
  const fs = sym ? 12.5 : s.length <= 2 ? 9.6 : s.length === 3 ? 8 : 6.2
  return `<text class="cb-tki-t${sym ? ' cb-tki-sym' : ''}" x="12" y="12.6" text-anchor="middle" dominant-baseline="central" font-size="${fs}">${esc(s)}</text>`
}

const glyph = (k: string) => `<g class="cb-tki-g">${GLYPHS[k] ?? ''}</g>`

/** The symbol's kind on this page (the provider's own table). */
export function kindOfTicker(ticker: string): SymKind {
  return resolveSym(ticker).kind
}

/** The icon for `ticker`, `size` px square. */
export function tickerIconEl(doc: Document, ticker: string, size = 20, opts: { lazy?: boolean } = {}): HTMLElement {
  const t = ticker.toUpperCase()
  const kind = kindOfTicker(t)
  const box = doc.createElement('span')
  box.className = 'cb-tki'
  box.style.setProperty('--cb-tki-s', `${size}px`)
  box.dataset.kind = kind
  const round = kind === 'etf'
  const monogram = () => {
    box.dataset.mono = '1'
    box.insertAdjacentHTML('afterbegin', shape(round, textMark(t.slice(0, 4))))
  }
  const logo = (sym: string, then: () => void) => {
    const urls = tickerLogoUrls(sym, LOGO_NAMES[sym])
    const img = doc.createElement('img')
    img.alt = ''
    img.decoding = 'async'
    if (opts.lazy) img.loading = 'lazy'
    let i = 0
    img.addEventListener('error', () => {
      i++
      if (i < urls.length) img.src = urls[i]!
      else {
        img.remove()
        then()
      }
    })
    img.src = urls[0]!
    box.prepend(img)
  }
  const m = kind === 'stock' ? undefined : MARKS[t]
  if (kind === 'stock') logo(t, monogram)
  else if (!m) monogram()
  else {
    const [g, badge] = m
    if (g.startsWith('logo:')) logo(g.slice(5), monogram)
    else box.insertAdjacentHTML('afterbegin', shape(round, g.startsWith('@') ? glyph(g.slice(1)) : textMark(g)))
    if (badge) {
      const b = doc.createElement('span')
      b.className = 'cb-tki-b'
      b.textContent = badge
      box.append(b)
    }
  }
  box.setAttribute('aria-hidden', 'true')
  return box
}
