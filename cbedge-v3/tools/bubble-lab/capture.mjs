#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// Freeze one real session into a fixture the lab can redraw forever.
//
//   node tools/bubble-lab/capture.mjs --name fri-pin --symbol SPX
//
// Hits the same three routes the card does, in the same order (the expiry is
// not knowable without the first call), and writes
// tools/bubble-lab/fixtures/<name>.json.
//
// ── Why fixtures at all ──────────────────────────────────────────────────────
// Every tuning round on this layer so far has been: look at ONE live chart,
// change a constant, deploy, look again tomorrow. One sample per twenty
// minutes, and the sample is whatever the market happened to do that day — so a
// change that fixes a pinned Friday quietly wrecks a trend day and nobody finds
// out for a week. A fixture is a session that cannot change under you. Capture
// the days that have broken this layer, and every future change is judged
// against all of them at once, in a second.
//
// Days worth having, roughly one of each:
//   • a hard pin      — one wall, price parked on it all afternoon
//   • a flat board    — six strikes within a few percent, nothing dominant
//   • a trend day     — price travels 50+ points, the ladder migrates with it
//   • a lopsided one  — the whole top of the board on one side of spot
//   • a half day      — a short session, so the time-of-day scale is stressed
//   • an overnight    — captured before the open, when the book is frozen
//
// ── AUTH ─────────────────────────────────────────────────────────────────────
// These routes sit behind the app's session cookie. Get it from devtools on a
// logged-in tab (Network -> any /api call -> Request Headers -> Cookie) and hand
// it over one of three ways, in this order of preference:
//
//   1. a file, which is what you want for a real cookie — no shell escaping, no
//      500-character command line, and it does not land in your bash history:
//        printf '%s' 'sb-access-token=eyJ...; sb-refresh-token=...' > /tmp/cb.cookie
//        node tools/bubble-lab/capture.mjs --name fri-pin --cookie-file /tmp/cb.cookie
//   2. the environment:  CB_COOKIE='sb-access-token=...' node …/capture.mjs …
//   3. --cookie "…"      fine for a quick one, awkward for anything long
// ─────────────────────────────────────────────────────────────────────────────

import { writeFileSync, mkdirSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const FIXTURES = join(HERE, 'fixtures')

const args = new Map()
for (let i = 2; i < process.argv.length; i += 2) {
  const k = process.argv[i]
  if (!k?.startsWith('--')) continue
  args.set(k.slice(2), process.argv[i + 1] ?? '')
}

const base = (args.get('base') ?? 'https://cbedge.net').replace(/\/+$/, '')
const symbol = (args.get('symbol') ?? 'SPX').toUpperCase()
const name = args.get('name') ?? `${symbol.toLowerCase()}-${new Date().toISOString().slice(0, 10)}`
const minutes = Number(args.get('minutes') ?? 2880)
const days = Number(args.get('days') ?? 5)
const interval = Number(args.get('interval') ?? 1)
// ── The cookie, and why it is checked this hard ──────────────────────────────
// Node builds request headers as a ByteString, so a single non-ASCII character
// anywhere in the value throws `Cannot convert argument to a ByteString` — from
// inside fetch, naming a character index and nothing else. The way you hit that
// is copying the README's own placeholder, which is a typographic ellipsis
// (U+2026) and looks exactly like three dots. Catch it here and say so, instead
// of handing back a stack trace about index 0.
function readCookie() {
  const file = args.get('cookie-file')
  if (file) {
    try {
      return readFileSync(file, 'utf8').trim()
    } catch (e) {
      throw new Error(`could not read --cookie-file ${file}: ${e.message}`)
    }
  }
  return (args.get('cookie') ?? process.env.CB_COOKIE ?? '').trim()
}
const cookie = readCookie()
if (cookie) {
  const bad = [...cookie].findIndex((ch) => ch.charCodeAt(0) > 255)
  if (bad >= 0) {
    const ch = cookie[bad]
    const looksLikePlaceholder = /^[\u2026.\s"']*$/.test(cookie)
    console.error(
      looksLikePlaceholder
        ? `\nThat cookie is the README's placeholder ("${cookie}"), not a real one.\n\n` +
          `  Get it from devtools on a logged-in cbedge.net tab:\n` +
          `  Network -> any /api/* request -> Request Headers -> Cookie -> copy the whole value.\n\n` +
          `  Then, easiest:\n` +
          `    printf '%s' 'PASTE_IT_HERE' > /tmp/cb.cookie\n` +
          `    node tools/bubble-lab/capture.mjs --name ${name} --cookie-file /tmp/cb.cookie\n`
        : `\nThe cookie contains a non-ASCII character (${JSON.stringify(ch)} at index ${bad}), ` +
          `which cannot go in an HTTP header.\nIt was probably smart-quoted or line-wrapped on the way in — ` +
          `use --cookie-file to avoid the shell entirely.\n`,
    )
    process.exit(1)
  }
}
const note = args.get('note') ?? ''

// Mirrors symbols.ts — the GEX ladder is keyed by `$SPX` while the candle route
// wants `SPX`, and the chain route wants the `$` stripped again.
const GEX_SYMBOL = { SPX: '$SPX', NDX: 'NDX', SPY: 'SPY', QQQ: 'QQQ', VIX: 'VIX' }
const gexSymbol = GEX_SYMBOL[symbol] ?? symbol
const chainTicker = gexSymbol.replace(/^\$/, '')

async function get(path) {
  const url = `${base}${path}`
  let res
  try {
    res = await fetch(url, { headers: cookie ? { cookie } : {} })
  } catch (e) {
    throw new Error(`could not reach ${url}\n  ${e.message}\n  (try --base http://localhost:3000 if you are on the VPS)`)
  }
  const text = await res.text()
  try {
    return JSON.parse(text)
  } catch {
    // The most common shape of this failure is the auth middleware handing back
    // the sign-in page, which is a 200 full of HTML. Say that, rather than
    // printing markup at someone who asked for a ladder.
    const html = /^\s*(<!doctype|<html)/i.test(text)
    throw new Error(
      html
        ? `${path} returned the sign-in page (HTTP ${res.status}) — the cookie is missing or expired.\n` +
          `  Grab a fresh one from devtools and pass it with --cookie-file.`
        : `${path} did not return JSON (HTTP ${res.status}). First 200 chars:\n${text.slice(0, 200)}`,
    )
  }
}

const run = async () => {
  process.stdout.write(`expiries … `)
  const expJson = await get(`/api/expirations?ticker=${encodeURIComponent(chainTicker)}`)
  const expiries = (expJson?.data?.items ?? []).map((i) => i['expiration-date'] ?? '').filter(Boolean)
  const expiry = args.get('expiry') || expiries[0]
  if (!expiry) {
    throw new Error(
      `no expirations came back for ${chainTicker}.\n` +
        `  base=${base}  cookie=${cookie ? `${cookie.length} chars` : 'NONE'}\n` +
        `  response: ${JSON.stringify(expJson).slice(0, 200)}`,
    )
  }
  process.stdout.write(`${expiry}\n`)

  process.stdout.write(`gex history (${minutes}m) … `)
  const gexJson = await get(
    `/api/snapshots/option-strike-gex-history?mode=heatmap&minutes=${minutes}` +
      `&expiry=${encodeURIComponent(expiry)}&symbol=${encodeURIComponent(gexSymbol)}&top=30`,
  )
  // Same shape check parseGexHistory does: every failure of this route is an
  // HTTP 200 with no `columns` key, so the array is the only real signal.
  const rawCols = Array.isArray(gexJson?.columns) ? gexJson.columns : []
  const columns = rawCols
    .map((c) => ({
      slotTs: Number(c?.slotTs) || 0,
      spot: Number(c?.spot) || 0,
      cells: (Array.isArray(c?.cells) ? c.cells : [])
        .map((x) => ({ strike: Number(x?.strike) || 0, net: Number(x?.net) || 0, netVol: Number(x?.netVol) || 0 }))
        .filter((x) => x.strike),
    }))
    .filter((c) => c.slotTs && c.cells.length)
    .sort((a, b) => a.slotTs - b.slotTs)
  process.stdout.write(`${columns.length} columns\n`)
  if (!columns.length) throw new Error(`no columns — ${gexJson?.error ?? 'route returned an empty ladder'}`)

  process.stdout.write(`candles … `)
  const barJson = await get(
    `/api/snapshots/etf-candles?symbol=${encodeURIComponent(symbol)}&days=${days}&interval=${interval}`,
  )
  const bars = (barJson?.rows ?? [])
    .map((r) => ({
      t: Number(r?.timestamp) || 0,
      o: Number(r?.open) || 0,
      h: Number(r?.high) || 0,
      l: Number(r?.low) || 0,
      c: Number(r?.close) || 0,
    }))
    .filter((b) => b.t)
    .sort((a, b) => a.t - b.t)
  process.stdout.write(`${bars.length} bars\n`)

  // Trim the candles to the ladder's own window. The candle route serves days
  // and the ladder serves hours, and a fixture that draws four days of bars
  // behind one session of gamma is a picture of nothing.
  const t0 = columns[0].slotTs
  const t1 = columns[columns.length - 1].slotTs
  const pad = 30 * 60_000
  const windowed = bars.filter((b) => b.t >= t0 - pad && b.t <= t1 + pad)

  mkdirSync(FIXTURES, { recursive: true })
  const out = {
    name,
    note,
    symbol,
    expiry,
    capturedAt: new Date().toISOString(),
    from: t0,
    to: t1,
    columns,
    bars: windowed.length ? windowed : bars,
  }
  const file = join(FIXTURES, `${name}.json`)
  writeFileSync(file, JSON.stringify(out))
  const kb = Math.round(JSON.stringify(out).length / 1024)
  console.log(`\nwrote ${file}  (${kb} KB, ${columns.length} columns, ${out.bars.length} bars)`)
  console.log(`now run:  node tools/bubble-lab/build.mjs   then open tools/bubble-lab/lab.html`)
}

run().catch((e) => {
  console.error(`\ncapture failed: ${e.message}`)
  process.exit(1)
})
