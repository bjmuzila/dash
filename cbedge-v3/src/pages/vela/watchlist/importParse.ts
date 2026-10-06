// ─────────────────────────────────────────────────────────────────────────────
// WATCHLIST IMPORT: reading a watchlist someone exported elsewhere (Brandon,
// 2026-10-05: "need an import a watchlist, not sure what format"). Pure: text
// in, sections of tickers out. The picker's import screen (symbolPickerView.ts)
// shows what this found and store.ts importList writes it.
//
//   TradingView   the .txt from a watchlist's menu → Export list:
//                 ###Section,EXCHANGE:TICKER,EXCHANGE:TICKER,###Other,…
//                 (commas and / or new lines). ### starts a section.
//   CSV           a header row with a Symbol / Ticker column (Thinkorswim,
//                 Webull, Fidelity, Schwab and most brokers export one); a
//                 Section / Group / Category / Watchlist column becomes
//                 sections; every other column is ignored. Comma, semicolon or
//                 tab separated, quotes allowed.
//   Any list      tickers split by commas, spaces, tabs or new lines. A line
//                 that is only "Name:" or starts with # starts a section.
//
// Every ticker loses its exchange (NASDAQ:NVDA → NVDA) and a future its
// contract (/ES, ES1!, ESZ2025, ESZ5 → ES; NQ the same), then goes through the
// lists' own normTicker. Duplicates keep their first place.
// ─────────────────────────────────────────────────────────────────────────────

export type ImportFormat = 'tradingview' | 'csv' | 'text'

export interface ImportSection {
  /** null: no section (the list's Unsorted). */
  name: string | null
  /** Tickers as written, cleaned (exchange and contract taken off), in order. */
  tickers: string[]
}

export interface ParsedImport {
  format: ImportFormat
  sections: ImportSection[]
  /** Tickers read, all sections, before any check against the chart's symbols. */
  total: number
}

/** The futures the chart has, by root: a contract or continuous code reads as the root. */
const FUTURE_ROOTS = new Set(['ES', 'NQ'])
const MONTHS = 'FGHJKMNQUVXZ'

/** One token as a ticker: exchange off, a future to its root, upper case. '' when it is not one. */
export function cleanTicker(raw: string): string {
  let t = raw.trim().replace(/^["']|["']$/g, '').trim().toUpperCase()
  if (!t) return ''
  t = t.replace(/^[A-Z0-9_]*:/, '')
  t = t.replace(/^\//, '')
  // ES1!, ES2!, NQ1!
  const cont = /^([A-Z]{1,3})\d!$/.exec(t)
  if (cont && FUTURE_ROOTS.has(cont[1]!)) return cont[1]!
  // ESZ2025, ESZ25, ESZ5
  const dated = new RegExp(`^([A-Z]{1,3})[${MONTHS}]\\d{1,4}$`).exec(t)
  if (dated && FUTURE_ROOTS.has(dated[1]!)) return dated[1]!
  // a share class written with a slash or dot stays as written (BRK.B); anything else odd is dropped
  return /^[A-Z0-9][A-Z0-9.\-^]{0,14}$/.test(t) ? t : ''
}

/** Split one CSV line, honouring double quotes. */
function splitCsv(line: string, sep: string): string[] {
  const out: string[] = []
  let cur = ''
  let q = false
  for (let i = 0; i < line.length; i++) {
    const c = line[i]!
    if (c === '"') {
      if (q && line[i + 1] === '"') {
        cur += '"'
        i++
      } else q = !q
    } else if (c === sep && !q) {
      out.push(cur)
      cur = ''
    } else cur += c
  }
  out.push(cur)
  return out.map((x) => x.trim())
}

const SYMBOL_COL = /^(symbol|symbols|ticker|tickers|sym|instrument|security|code)$/i
const SECTION_COL = /^(section|group|category|watchlist|watch list|list|sector)$/i

/** A section name as written ('' when it has none). */
const secName = (raw: string) => raw.replace(/^#+/, '').replace(/:$/, '').trim().slice(0, 40)

function push(sections: ImportSection[], name: string | null, ticker: string, seen: Set<string>): void {
  if (!ticker || seen.has(ticker)) return
  seen.add(ticker)
  let s = sections.find((x) => x.name === name)
  if (!s) {
    s = { name, tickers: [] }
    sections.push(s)
  }
  s.tickers.push(ticker)
}

function tradingView(text: string): ImportSection[] {
  const sections: ImportSection[] = []
  const seen = new Set<string>()
  let cur: string | null = null
  for (const tok of text.split(/[,\n\r]+/)) {
    const t = tok.trim()
    if (!t) continue
    if (t.startsWith('###')) {
      cur = secName(t) || null
      if (cur && !sections.some((x) => x.name === cur)) sections.push({ name: cur, tickers: [] })
      continue
    }
    push(sections, cur, cleanTicker(t), seen)
  }
  return sections
}

function csv(lines: string[], sep: string, symCol: number, secCol: number): ImportSection[] {
  const sections: ImportSection[] = []
  const seen = new Set<string>()
  for (const line of lines.slice(1)) {
    const cells = splitCsv(line, sep)
    const tk = cleanTicker(cells[symCol] ?? '')
    const sec = secCol >= 0 ? secName(cells[secCol] ?? '') || null : null
    push(sections, sec, tk, seen)
  }
  return sections
}

function plain(lines: string[]): ImportSection[] {
  const sections: ImportSection[] = []
  const seen = new Set<string>()
  let cur: string | null = null
  for (const raw of lines) {
    const line = raw.trim()
    if (!line) continue
    // "# Tech", "Tech:" alone on a line: a section
    if (line.startsWith('#') || /^[^,;\t]+:$/.test(line)) {
      const n = secName(line)
      if (n) {
        cur = n
        if (!sections.some((x) => x.name === cur)) sections.push({ name: cur, tickers: [] })
        continue
      }
    }
    for (const tok of line.split(/[\s,;]+/)) push(sections, cur, cleanTicker(tok), seen)
  }
  return sections
}

/** Read a pasted or uploaded watchlist. Never throws; an unreadable text gives no sections. */
export function parseWatchlist(text: string): ParsedImport {
  const src = text.replace(/^﻿/, '')
  const lines = src.split(/\r?\n/).filter((l) => l.trim())
  let format: ImportFormat = 'text'
  let sections: ImportSection[] = []
  if (/(^|[,\n])\s*###/.test(src)) {
    format = 'tradingview'
    sections = tradingView(src)
  } else {
    // a CSV: the first line names a symbol column
    const head = lines[0] ?? ''
    const sep = ['\t', ';', ','].find((s) => head.includes(s))
    const cells = sep ? splitCsv(head, sep) : []
    const symCol = cells.findIndex((c) => SYMBOL_COL.test(c.replace(/"/g, '')))
    if (sep && symCol >= 0) {
      format = 'csv'
      sections = csv(lines, sep, symCol, cells.findIndex((c) => SECTION_COL.test(c.replace(/"/g, ''))))
    } else if (/^[A-Z0-9_]+:[A-Z0-9]/i.test(src.trim()) && src.includes(',')) {
      // a TradingView list with no sections: EXCHANGE:TICKER,EXCHANGE:TICKER
      format = 'tradingview'
      sections = tradingView(src)
    } else sections = plain(lines)
  }
  // a section with nothing in it is still worth keeping only when named
  sections = sections.filter((s) => s.tickers.length || s.name)
  return { format, sections, total: sections.reduce((a, s) => a + s.tickers.length, 0) }
}

export const FORMAT_LABEL: Record<ImportFormat, string> = {
  tradingview: 'TradingView export',
  csv: 'CSV',
  text: 'List of tickers',
}
